package cluster

import (
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
	"k8s.io/client-go/tools/clientcmd"
)

func (cm *ClusterManager) GetClusters(c *gin.Context) {
	clusters, errors, defaultContext := cm.snapshotState()
	result := make([]common.ClusterInfo, 0, len(clusters))
	user := c.MustGet("user").(model.User)
	for name, cluster := range clusters {
		if !rbac.CanAccessCluster(user, name) {
			continue
		}
		result = append(result, common.ClusterInfo{
			Name:      name,
			Version:   cluster.Version,
			IsDefault: name == defaultContext,
		})
	}
	for name, errMsg := range errors {
		if !rbac.CanAccessCluster(user, name) {
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
		if !rbac.CanAccessCluster(user, cluster.Name) {
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
			"pool":          cluster.Pool,
		}

		if clientSet, exists := clusterState[cluster.Name]; exists {
			clusterInfo["version"] = clientSet.Version
		}
		if errMsg, exists := errorState[cluster.Name]; exists {
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

	if _, err := model.GetClusterByName(req.Name); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "cluster already exists"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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

	if req.ClusterID != "" && req.ClusterID != cluster.ClusterID {
		updates["cluster_id"] = req.ClusterID
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
