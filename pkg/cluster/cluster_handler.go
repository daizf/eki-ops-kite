package cluster

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/rbac"
	"gorm.io/gorm"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// lookupCluster returns the model.Cluster for a snapshot key. The snapshot map
// (and the per-cluster error map) is keyed by ClusterID; if the DB record is
// missing (e.g. a transient state), a minimal Cluster with just the name set
// is returned so RBAC name-pattern matching still works while category/tag
// restrictions fall back to "match any" (empty values).
func lookupCluster(byID map[string]*model.Cluster, clusterID string) *model.Cluster {
	if db, ok := byID[clusterID]; ok {
		return db
	}
	return &model.Cluster{Name: clusterID}
}

func (cm *ClusterManager) GetClusters(c *gin.Context) {
	clusters, errors, defaultContext := cm.snapshotState()
	result := make([]common.ClusterInfo, 0, len(clusters))
	user := c.MustGet("user").(model.User)

	// Batch-fetch DB cluster records to perform category/tag-aware RBAC checks.
	// The snapshot map is keyed by clusterID, so we build a lookup by ClusterID.
	dbClusters, err := model.ListClusters()
	clusterByID := make(map[string]*model.Cluster, len(dbClusters))
	if err == nil {
		for _, db := range dbClusters {
			clusterByID[db.ClusterID] = db
		}
	}

	for name, cluster := range clusters {
		if !rbac.CanAccessCluster(user, lookupCluster(clusterByID, name)) {
			continue
		}
		result = append(result, common.ClusterInfo{
			Name:         name,
			Version:      cluster.Version,
			IsDefault:    name == defaultContext,
			AggTags:     cluster.AggTags,
		})
	}
	for name, errMsg := range errors {
		if !rbac.CanAccessCluster(user, lookupCluster(clusterByID, name)) {
			continue
		}
		result = append(result, common.ClusterInfo{
			Name:      name,
			Version:   "",
			IsDefault: false,
			Error:     errMsg,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	c.JSON(http.StatusOK, result)
}

func (cm *ClusterManager) GetClusterList(c *gin.Context) {
	clusters, err := model.ListClusters()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	user := c.MustGet("user").(model.User)
	clusterState, errorState, _ := cm.snapshotState()
	result := make([]gin.H, 0, len(clusters))
	for _, cluster := range clusters {
		if !rbac.CanAccessCluster(user, cluster) {
			continue
		}
		clusterInfo := gin.H{
			"id":            cluster.ID,
			"name":          cluster.Name,
			"clusterId":     cluster.ClusterID,
			"description":   cluster.Description,
			"enabled":       cluster.Enable,
			"inCluster":     cluster.InCluster,
			"isDefault":     cluster.IsDefault,
			"prometheusURL": cluster.PrometheusURL,
			"poolId":        cluster.PoolID,
			"category":      cluster.Category,
			"tags":          cluster.GetTags(),
			"aggTags":      cluster.GetAggTags(),
			"pool":          cluster.Pool,
		}

		if clientSet, exists := clusterState[cluster.ClusterID]; exists {
			clusterInfo["version"] = clientSet.Version
		}
		if errMsg, exists := errorState[cluster.ClusterID]; exists {
			clusterInfo["error"] = errMsg
		}

		result = append(result, clusterInfo)
	}

	c.JSON(http.StatusOK, result)
}

func (cm *ClusterManager) CreateCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var req struct {
		Name          string   `json:"name" binding:"required"`
		ClusterID     string   `json:"clusterId" binding:"required"`
		Description   string   `json:"description"`
		Config        string   `json:"config"`
		PrometheusURL string   `json:"prometheusURL"`
		PoolID        string   `json:"poolId"`
		Category      string   `json:"category"`
		Tags          []string `json:"tags"`
		InCluster     bool     `json:"inCluster"`
		IsDefault     bool     `json:"isDefault"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	existing, err := model.GetClusterByClusterID(req.ClusterID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "cluster ID already exists"})
		return
	}

	if req.IsDefault {
		if err := model.ClearDefaultCluster(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	normalizedTags := model.NormalizeTags(req.Tags)

	cluster := &model.Cluster{
		Name:          req.Name,
		ClusterID:     req.ClusterID,
		Description:   req.Description,
		Config:        model.SecretString(req.Config),
		PrometheusURL: req.PrometheusURL,
		PoolID:        req.PoolID,
		Category:      req.Category,
		Tags:          "",
		InCluster:     req.InCluster,
		IsDefault:     req.IsDefault,
		Enable:        true,
	}

	if err := cluster.SetTags(normalizedTags); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cluster.MetaHash = cluster.ComputeMetaHash()

	if err := model.AddCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	TriggerClusterSync()

	c.JSON(http.StatusCreated, gin.H{
		"id":      cluster.ID,
		"message": "cluster created successfully",
	})
}

func (cm *ClusterManager) UpdateCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	var req struct {
		Name          string   `json:"name"`
		ClusterID     string   `json:"clusterId"`
		Description   string   `json:"description"`
		Config        string   `json:"config"`
		PrometheusURL string   `json:"prometheusURL"`
		PoolID        string   `json:"poolId"`
		Category      string   `json:"category"`
		Tags          []string `json:"tags"`
		InCluster     bool     `json:"inCluster"`
		IsDefault     bool     `json:"isDefault"`
		Enabled       bool     `json:"enabled"`
		Pool          string   `json:"pool"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Pool != "" && req.PoolID == "" {
		req.PoolID = req.Pool
	}

	cluster, err := model.GetClusterByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if req.IsDefault && !cluster.IsDefault {
		if err := model.ClearDefaultCluster(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	updates := map[string]interface{}{
		"description":    req.Description,
		"prometheus_url": req.PrometheusURL,
		"pool_id":        req.PoolID,
		"category":       req.Category,
		"in_cluster":     req.InCluster,
		"is_default":     req.IsDefault,
		"enable":         req.Enabled,
	}

	if req.Name != "" && req.Name != cluster.Name {
		updates["name"] = req.Name
	}

	if req.Config != "" {
		updates["config"] = model.SecretString(req.Config)
	}

	normalizedTags := model.NormalizeTags(req.Tags)
	if err := cluster.SetTags(normalizedTags); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updates["tags"] = cluster.Tags

	// Recompute meta_hash from the values that will be persisted
	name := cluster.Name
	if v, ok := updates["name"]; ok {
		name, _ = v.(string)
	}
	clusterID := cluster.ClusterID
	if v, ok := updates["cluster_id"]; ok {
		clusterID, _ = v.(string)
	}
	config := string(cluster.Config)
	if v, ok := updates["config"]; ok {
		config, _ = v.(string)
	}
	prometheusURL := cluster.PrometheusURL
	if v, ok := updates["prometheus_url"]; ok {
		prometheusURL, _ = v.(string)
	}
	category := cluster.Category
	if v, ok := updates["category"]; ok {
		category, _ = v.(string)
	}
	tempCluster := &model.Cluster{
		Name:          name,
		ClusterID:     clusterID,
		Config:        model.SecretString(config),
		PrometheusURL: prometheusURL,
		Category:      category,
	}
	updates["meta_hash"] = tempCluster.ComputeMetaHash()

	if err := model.UpdateCluster(cluster, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	TriggerClusterSync()

	c.JSON(http.StatusOK, gin.H{"message": "cluster updated successfully"})
}

func (cm *ClusterManager) DeleteCluster(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	cluster, err := model.GetClusterByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if cluster.IsDefault {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete default cluster"})
		return
	}

	if err := model.DeleteCluster(cluster); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	TriggerClusterSync()

	c.JSON(http.StatusOK, gin.H{"message": "cluster deleted successfully"})
}

func (cm *ClusterManager) TestConnection(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cluster id"})
		return
	}

	cluster, err := model.GetClusterByIDWithPool(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "cluster not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	var restConfig *rest.Config
	if cluster.InCluster {
		restConfig, err = rest.InClusterConfig()
	} else {
		if string(cluster.Config) == "" {
			c.JSON(http.StatusBadRequest, gin.H{
				"success":   false,
				"elapsedMs": 0,
				"error":     "kubeconfig is empty",
			})
			return
		}
		restConfig, err = clientcmd.RESTConfigFromKubeConfig([]byte(string(cluster.Config)))
	}
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success":   false,
			"elapsedMs": 0,
			"error":     err.Error(),
		})
		return
	}

	if cluster.Pool != nil && cluster.Pool.Proxy != "" {
		if applyErr := applyProxyToRestConfig(restConfig, cluster.Pool.Proxy); applyErr != nil {
			c.JSON(http.StatusOK, gin.H{
				"success":   false,
				"elapsedMs": 0,
				"error":     fmt.Sprintf("apply proxy failed: %v", applyErr),
			})
			return
		}
	}

	restConfig.Timeout = 5 * time.Second

	discoveryClient, err := discovery.NewDiscoveryClientForConfig(restConfig)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success":   false,
			"elapsedMs": 0,
			"error":     err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	start := time.Now()
	done := make(chan struct{})
	var version string
	var versionErr error
	go func() {
		v, e := discoveryClient.ServerVersion()
		if e == nil && v != nil {
			version = v.String()
		}
		versionErr = e
		close(done)
	}()

	select {
	case <-done:
	case <-ctx.Done():
		versionErr = ctx.Err()
	}
	elapsedMs := time.Since(start).Milliseconds()

	if versionErr != nil {
		c.JSON(http.StatusOK, gin.H{
			"success":   false,
			"elapsedMs": elapsedMs,
			"error":     versionErr.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":   true,
		"version":   version,
		"elapsedMs": elapsedMs,
	})
}

func (cm *ClusterManager) ImportClustersFromKubeconfig(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var clusterReq common.ImportClustersRequest
	if err := c.ShouldBindJSON(&clusterReq); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !clusterReq.InCluster && clusterReq.Config == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config is required when inCluster is false"})
		return
	}

	cc, err := model.CountClusters()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if cc > 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "import not allowed when clusters exist"})
		return
	}

	if clusterReq.InCluster {
		cluster := &model.Cluster{
			Name:        "in-cluster",
			ClusterID:   "in-cluster",
			InCluster:   true,
			Description: "Kubernetes in-cluster config",
			IsDefault:   true,
			Enable:      true,
		}
		if err := cluster.SetTags([]string{}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		cluster.MetaHash = cluster.ComputeMetaHash()
		if err := model.AddCluster(cluster); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		TriggerClusterSync()
		time.Sleep(1 * time.Second)
		c.JSON(http.StatusCreated, gin.H{"message": fmt.Sprintf("imported %d clusters successfully", 1)})
		return
	}

	kubeconfig, err := clientcmd.Load([]byte(clusterReq.Config))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	importedCount := ImportClustersFromKubeconfig(kubeconfig)
	TriggerClusterSync()
	time.Sleep(1 * time.Second)
	c.JSON(http.StatusCreated, gin.H{"message": fmt.Sprintf("imported %d clusters successfully", importedCount)})
}

type BatchClusterImportRequest struct {
	Clusters []ClusterImportItem `json:"clusters" binding:"required"`
}

type ClusterImportItem struct {
	Name          string   `json:"name" binding:"required"`
	ClusterID     string   `json:"clusterId" binding:"required"`
	Description   string   `json:"description"`
	Config        string   `json:"config"`
	PrometheusURL string   `json:"prometheusURL"`
	PoolID        string   `json:"poolId"`
	Category      string   `json:"category"`
	Tags          []string `json:"tags"`
	InCluster     bool     `json:"inCluster"`
	IsDefault     bool     `json:"isDefault"`
	Enabled       bool     `json:"enabled"`
}

type BatchClusterImportResult struct {
	Imported []string `json:"imported"`
	Rejected []string `json:"rejected"`
}

func (cm *ClusterManager) BatchImportClusters(c *gin.Context) {
	if common.IsSectionManaged("clusters") {
		c.JSON(http.StatusForbidden, gin.H{"error": common.ManagedSectionError})
		return
	}

	var req BatchClusterImportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result := BatchClusterImportResult{
		Imported: []string{},
		Rejected: []string{},
	}

	existingClusters, err := model.ListClusters()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	existingClusterIDs := make(map[string]bool)
	for _, cluster := range existingClusters {
		existingClusterIDs[cluster.ClusterID] = true
	}

	for _, item := range req.Clusters {
		if existingClusterIDs[item.ClusterID] {
			result.Rejected = append(result.Rejected, item.ClusterID)
			continue
		}

		if item.IsDefault {
			for _, existingCluster := range existingClusters {
				if existingCluster.IsDefault {
					model.UpdateCluster(existingCluster, map[string]interface{}{
						"is_default": false,
					})
				}
			}
		}

		cluster := &model.Cluster{
			Name:          item.Name,
			ClusterID:     item.ClusterID,
			Description:   item.Description,
			Config:        model.SecretString(item.Config),
			PrometheusURL: item.PrometheusURL,
			PoolID:        item.PoolID,
			Category:      item.Category,
			Tags:          "",
			InCluster:     item.InCluster,
			IsDefault:     item.IsDefault,
			Enable:        item.Enabled,
		}

		normalizedTags := model.NormalizeTags(item.Tags)
		if err := cluster.SetTags(normalizedTags); err != nil {
			result.Rejected = append(result.Rejected, item.ClusterID+" (invalid tags)")
			continue
		}

		cluster.MetaHash = cluster.ComputeMetaHash()

		if err := model.AddCluster(cluster); err != nil {
			result.Rejected = append(result.Rejected, item.ClusterID+" ("+err.Error()+")")
			continue
		}

		result.Imported = append(result.Imported, item.ClusterID)
		existingClusterIDs[item.ClusterID] = true
	}

	if len(result.Imported) > 0 {
		TriggerClusterSync()
		time.Sleep(1 * time.Second)
	}

	c.JSON(http.StatusOK, result)
}
