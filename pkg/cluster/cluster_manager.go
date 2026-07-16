package cluster

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/zxh326/kite/pkg/common"
	"github.com/zxh326/kite/pkg/kube"
	"github.com/zxh326/kite/pkg/model"
	"github.com/zxh326/kite/pkg/prometheus"
	v1 "k8s.io/api/core/v1"
	"gorm.io/gorm"
	"k8s.io/apimachinery/pkg/version"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"
)

type ClientSet struct {
	Name       string
	ClusterID  string
	PoolID     string
	Version    string // Kubernetes version
	K8sClient  *kube.K8sClient
	PromClient *prometheus.Client

	DiscoveredPrometheusURL string
	AggTags                 []string
	config                  string
	prometheusURL           string
	lastVersionCheck        time.Time
}

type retryEntry struct {
	nextAttempt time.Time
	attempt     int
}

type ClusterManager struct {
	mu             sync.RWMutex
	syncMu         sync.Mutex
	clusters       map[string]*ClientSet
	errors         map[string]string
	retries        map[string]*retryEntry
	defaultContext string
}

const (
	clusterStartupSyncTimeout = 10 * time.Second
	versionCheckTimeout       = 10 * time.Second
	versionCheckConcurrency   = 10
	forceRebuildThreshold     = 5 * time.Minute
	backoffMaxInterval        = 30 * time.Minute
)

func buildClientSet(cluster *model.Cluster) (*ClientSet, error) {
	var restConfig *rest.Config
	var err error

	if cluster.InCluster {
		restConfig, err = rest.InClusterConfig()
	} else {
		restConfig, err = clientcmd.RESTConfigFromKubeConfig([]byte(string(cluster.Config)))
	}
	if err != nil {
		return nil, err
	}

	if cluster.Pool != nil && cluster.Pool.Proxy != "" {
		if applyErr := applyProxyToRestConfig(restConfig, cluster.Pool.Proxy); applyErr != nil {
			klog.Warningf("Failed to apply proxy for cluster %s: %v", cluster.Name, applyErr)
		} else {
			klog.Infof("Using proxy %s for cluster %s (pool %s)", cluster.Pool.Proxy, cluster.Name, cluster.Pool.PoolID)
		}
	}

	poolName := ""
	if cluster.Pool != nil {
		poolName = cluster.Pool.PoolName
	}
	cs, err := newClientSet(cluster.Name, poolName, restConfig, cluster.PrometheusURL)
	if err != nil {
		return nil, err
	}
	if !cluster.InCluster {
		cs.config = string(cluster.Config)
	}
	return cs, nil
}

func applyProxyToRestConfig(config *rest.Config, proxy string) error {
	proxyURL, err := url.Parse(proxy)
	if err != nil {
		return fmt.Errorf("invalid proxy URL %q: %w", proxy, err)
	}
	config.Proxy = http.ProxyURL(proxyURL)
	return nil
}

func newClientSet(name string, poolName string, k8sConfig *rest.Config, prometheusURL string) (*ClientSet, error) {
	cs := &ClientSet{
		Name:          name,
		prometheusURL: prometheusURL,
	}
	var err error
	cs.K8sClient, err = kube.NewClient(k8sConfig)
	if err != nil {
		klog.Warningf("Failed to create k8s client for cluster %s: %v", name, err)
		return nil, err
	}
	if prometheusURL == "" {
		prometheusURL = discoveryPrometheusURL(cs.K8sClient)
		if prometheusURL != "" {
			cs.DiscoveredPrometheusURL = prometheusURL
			klog.Infof("Discovered Prometheus URL for cluster %s: %s", name, cs.DiscoveredPrometheusURL)
		}
	}
	if prometheusURL != "" {
		var rt = http.DefaultTransport
		var err error
		if isClusterLocalURL(prometheusURL) {
			rt, err = createK8sProxyTransport(k8sConfig, prometheusURL)
			if err != nil {
				klog.Warningf("Failed to create k8s proxy transport for cluster %s: %v, using direct connection", name, err)
			} else {
				klog.Infof("Using k8s API proxy for Prometheus in cluster %s", name)
			}
		}
		cs.PromClient, err = prometheus.NewClientWithRoundTripper(prometheusURL, rt)
		if err != nil {
			klog.Warningf("Failed to create Prometheus client for cluster %s, some features may not work as expected, err: %v", name, err)
		}
	}
	v, err := getServerVersionWithTimeout(cs, versionCheckTimeout)
	if err != nil {
		klog.Warningf("Failed to get server version for cluster %s (pool: %s): %v", name, poolName, err)
	} else {
		cs.Version = v.String()
		cs.lastVersionCheck = time.Now()
	}
	klog.Infof("Loaded K8s client for cluster: %s, version: %s", name, cs.Version)

	nodeCount, accelTypes, err := fetchClusterNodeStats(cs.K8sClient)
	if err != nil {
		klog.Warningf("Failed to fetch node stats for cluster %s: %v", name, err)
	} else {
		cs.AggTags = computeClusterTags(nodeCount, accelTypes)
		klog.Infof("Cluster %s: %d nodes, agg tags: %v", name, nodeCount, cs.AggTags)
	}

	return cs, nil
}

func fetchClusterNodeStats(kc *kube.K8sClient) (int, []string, error) {
	ctx, cancel := context.WithTimeout(context.TODO(), 10*time.Second)
	defer cancel()

	var nodes v1.NodeList
	if err := kc.List(ctx, &nodes); err != nil {
		return 0, nil, err
	}

	accelSet := make(map[string]struct{})
	for i := range nodes.Items {
		for rn := range nodes.Items[i].Status.Allocatable {
			name := string(rn)
			for _, acc := range common.KnownAcceleratorResources {
				if name == acc || strings.HasPrefix(name, acc) {
					parts := strings.SplitN(name, "/", 2)
					if len(parts) == 2 {
						accelSet[parts[1]] = struct{}{}
					}
					break
				}
			}
		}
	}

	accelTypes := make([]string, 0, len(accelSet))
	for t := range accelSet {
		accelTypes = append(accelTypes, t)
	}
	sort.Strings(accelTypes)

	return len(nodes.Items), accelTypes, nil
}

func computeClusterTags(nodeCount int, accelTypes []string) []string {
	tags := make([]string, 0, 1+len(accelTypes))

	switch {
	case nodeCount < 10:
		tags = append(tags, "small")
	case nodeCount < 50:
		tags = append(tags, "medium")
	case nodeCount < 200:
		tags = append(tags, "large")
	default:
		tags = append(tags, "xlarge")
	}

	tags = append(tags, accelTypes...)
	return tags
}

func tagsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func isClusterLocalURL(urlStr string) bool {
	return strings.Contains(urlStr, ".svc.cluster.local") || strings.Contains(urlStr, ".svc:")
}

func createK8sProxyTransport(k8sConfig *rest.Config, prometheusURL string) (*k8sProxyTransport, error) {
	parsedURL, err := url.Parse(prometheusURL)
	if err != nil {
		return nil, err
	}

	parts := strings.Split(parsedURL.Host, ".")
	if len(parts) < 2 {
		return nil, fmt.Errorf("invalid cluster local URL format")
	}
	svcName := parts[0]
	namespace := parts[1]

	transport, err := rest.TransportFor(k8sConfig)
	if err != nil {
		return nil, err
	}

	transportWrapper := &k8sProxyTransport{
		transport:    transport,
		apiServerURL: k8sConfig.Host,
		namespace:    namespace,
		svcName:      svcName,
		scheme:       parsedURL.Scheme,
	}
	transportWrapper.port = parsedURL.Port()
	if transportWrapper.port == "" {
		if parsedURL.Scheme == "https" {
			transportWrapper.port = "443"
		} else {
			transportWrapper.port = "80"
		}
	}

	return transportWrapper, nil
}

type k8sProxyTransport struct {
	transport    http.RoundTripper
	apiServerURL string
	namespace    string
	svcName      string
	scheme       string
	port         string
}

func (t *k8sProxyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	proxyURL, err := url.Parse(t.apiServerURL)
	if err != nil {
		return nil, err
	}
	req.URL.Scheme = proxyURL.Scheme
	req.URL.Host = proxyURL.Host

	servicePath := fmt.Sprintf("/api/v1/namespaces/%s/services/%s:%s/proxy", t.namespace, t.svcName, t.port)
	req.URL.Path = servicePath + req.URL.Path

	return t.transport.RoundTrip(req)
}

func (cm *ClusterManager) GetClientSet(clusterID string) (*ClientSet, error) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	if len(cm.clusters) == 0 {
		return nil, fmt.Errorf("no clusters available")
	}
	if clusterID == "" {
		clusterID = cm.defaultContext
		if clusterID == "" {
			// If no default context is set, return the first available cluster
			for _, cs := range cm.clusters {
				return cs, nil
			}
		}
	}
	if cluster, ok := cm.clusters[clusterID]; ok {
		return cluster, nil
	}
	return nil, fmt.Errorf("cluster not ready: %s", clusterID)
}

func ImportClustersFromKubeconfig(kubeconfig *clientcmdapi.Config) int64 {
	if len(kubeconfig.Contexts) == 0 {
		return 0
	}

	importedCount := 0
	for contextName, context := range kubeconfig.Contexts {
		config := clientcmdapi.NewConfig()
		config.Contexts = map[string]*clientcmdapi.Context{
			contextName: context,
		}
		config.CurrentContext = contextName
		config.Clusters = map[string]*clientcmdapi.Cluster{
			context.Cluster: kubeconfig.Clusters[context.Cluster],
		}
		config.AuthInfos = map[string]*clientcmdapi.AuthInfo{
			context.AuthInfo: kubeconfig.AuthInfos[context.AuthInfo],
		}
		configStr, err := clientcmd.Write(*config)
		if err != nil {
			continue
		}
		cluster := model.Cluster{
			ClusterID: contextName,
			Name:      contextName,
			Config:    model.SecretString(configStr),
			IsDefault: contextName == kubeconfig.CurrentContext,
		}
		cluster.MetaHash = cluster.ComputeMetaHash()
		if _, err := model.GetClusterByName(contextName); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				if err := model.AddCluster(&cluster); err != nil {
					continue
				}
				importedCount++
				klog.Infof("Imported cluster success: %s", contextName)
			}
			continue
		}
	}
	return int64(importedCount)
}

var (
	syncNow = make(chan struct{}, 1)
)

func TriggerClusterSync() {
	select {
	case syncNow <- struct{}{}:
	default:
	}
}

func syncClusters(cm *ClusterManager, readyCh chan<- struct{}) error {
	if readyCh != nil {
		defer func() {
			select {
			case readyCh <- struct{}{}:
			default:
			}
		}()
	}

	clusters, err := model.ListClusters()
	if err != nil {
		klog.Warningf("list cluster err: %v", err)
		time.Sleep(5 * time.Second)
		return err
	}
	dbClusterMap := make(map[string]interface{})

	// Snapshot current clusters + retries (one read lock)
	cm.mu.RLock()
	snapshot := make(map[string]*ClientSet, len(cm.clusters))
	maps.Copy(snapshot, cm.clusters)
	retriesSnapshot := make(map[string]*retryEntry, len(cm.retries))
	maps.Copy(retriesSnapshot, cm.retries)
	cm.mu.RUnlock()

	// Phase 1: Parallel shouldUpdateCluster + collect buildQueue
	var buildQueue []*model.Cluster
	var queueMu sync.Mutex
	sem := make(chan struct{}, versionCheckConcurrency)
	var wg sync.WaitGroup
	var defaultClusterID string
	for _, cluster := range clusters {
		dbClusterMap[cluster.ClusterID] = cluster
		if cluster.IsDefault {
			defaultClusterID = cluster.ClusterID
		}
		// Backoff check: skip clusters still in backoff
		entry, hasBackoff := retriesSnapshot[cluster.ClusterID]
		if hasBackoff && time.Now().Before(entry.nextAttempt) {
			klog.Infof("Cluster %s skipped due to backoff (attempt %d, next: %s)",
				cluster.Name, entry.attempt, entry.nextAttempt.Format(time.RFC3339))
			continue
		}
		wg.Add(1)
		go func(cluster *model.Cluster) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			current := snapshot[cluster.ClusterID]
			if !shouldUpdateCluster(current, cluster) {
				return
			}
			// Needs update: cleanup old ClientSet + enqueue
			if current != nil {
				cm.mu.Lock()
				delete(cm.clusters, cluster.ClusterID)
				cm.mu.Unlock()
				current.K8sClient.Stop(cluster.ClusterID)
			}
			if cluster.Enable {
				queueMu.Lock()
				buildQueue = append(buildQueue, cluster)
				queueMu.Unlock()
			} else {
				cm.mu.Lock()
				delete(cm.errors, cluster.ClusterID)
				cm.mu.Unlock()
			}
		}(cluster)
	}
	if defaultClusterID != "" {
		cm.mu.Lock()
		cm.defaultContext = defaultClusterID
		cm.mu.Unlock()
	}
	wg.Wait()

	// Phase 2: Parallel buildClientSet + backoff management
	type buildResult struct {
		cluster   *model.Cluster
		clientSet *ClientSet
		err       error
	}
	buildResults := make(chan buildResult, len(buildQueue))
	var buildWg sync.WaitGroup
	for _, cluster := range buildQueue {
		buildWg.Add(1)
		go func(cluster *model.Cluster) {
			defer buildWg.Done()
			clientSet, err := buildClientSet(cluster)
			if err == nil {
				clientSet.ClusterID = cluster.ClusterID
				clientSet.PoolID = cluster.PoolID
			}
			buildResults <- buildResult{cluster, clientSet, err}
		}(cluster)
	}
	go func() {
		buildWg.Wait()
		close(buildResults)
	}()
	for r := range buildResults {
		if r.err != nil {
			poolName := ""
			if r.cluster.Pool != nil {
				poolName = r.cluster.Pool.PoolName
			}
			klog.Errorf("Failed to build k8s client for cluster %s (pool: %s), in cluster: %t, err: %v",
				r.cluster.Name, poolName, r.cluster.InCluster, r.err)
			cm.recordFailure(r.cluster.ClusterID, r.cluster.Name, r.err)
			continue
		}
		cm.recordSuccess(r.cluster.ClusterID, r.clientSet)

		// Update computed tags in DB if changed
		if len(r.clientSet.AggTags) > 0 {
			existing := r.cluster.GetAggTags()
			if !tagsEqual(existing, r.clientSet.AggTags) {
				tmp := &model.Cluster{}
				if err := tmp.SetAggTags(r.clientSet.AggTags); err == nil {
					if err := model.UpdateCluster(r.cluster, map[string]interface{}{
						"agg_tags": tmp.AggTags,
					}); err != nil {
						klog.Warningf("Failed to update computed tags for cluster %s: %v", r.cluster.Name, err)
					}
				}
			}
		}
	}

	// Cleanup: remove clusters that no longer exist in DB
	cm.mu.Lock()
	for clusterID, clientSet := range cm.clusters {
		if _, ok := dbClusterMap[clusterID]; !ok {
			delete(cm.clusters, clusterID)
			clientSet.K8sClient.Stop(clusterID)
		}
	}
	for clusterID := range cm.errors {
		if _, ok := dbClusterMap[clusterID]; !ok {
			delete(cm.errors, clusterID)
		}
	}
	for clusterID := range cm.retries {
		if _, ok := dbClusterMap[clusterID]; !ok {
			delete(cm.retries, clusterID)
		}
	}
	cm.mu.Unlock()

	return nil
}

func (cm *ClusterManager) recordFailure(clusterID, name string, err error) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	cm.errors[clusterID] = err.Error()
	entry := cm.retries[clusterID]
	if entry == nil {
		entry = &retryEntry{}
		cm.retries[clusterID] = entry
	}
	entry.attempt++
	backoff := (1 << uint(entry.attempt-1)) * time.Minute
	if backoff > backoffMaxInterval {
		backoff = backoffMaxInterval
	}
	entry.nextAttempt = time.Now().Add(backoff)
	klog.Warningf("Cluster %s build failed (attempt %d), backing off for %v until %s",
		name, entry.attempt, backoff, entry.nextAttempt.Format(time.RFC3339))
}

func (cm *ClusterManager) recordSuccess(clusterID string, cs *ClientSet) {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	delete(cm.errors, clusterID)
	delete(cm.retries, clusterID)
	cm.clusters[clusterID] = cs
}

// shouldUpdateCluster decides whether the cached ClientSet needs to be updated
// based on the desired state from the database.
func shouldUpdateCluster(cs *ClientSet, cluster *model.Cluster) bool {
	// enable/disable toggle
	if (cs == nil && cluster.Enable) || (cs != nil && !cluster.Enable) {
		klog.Infof("Cluster %s status changed, updating, enabled -> %v", cluster.Name, cluster.Enable)
		return true
	}
	if cs == nil && !cluster.Enable {
		return false
	}

	if cs == nil || cs.K8sClient == nil || cs.K8sClient.ClientSet == nil {
		return true
	}

	// kubeconfig change
	if cs.config != string(cluster.Config) {
		klog.Infof("Kubeconfig changed for cluster %s, updating", cluster.Name)
		return true
	}

	// prometheus URL change
	if cs.prometheusURL != cluster.PrometheusURL {
		klog.Infof("Prometheus URL changed for cluster %s, updating", cluster.Name)
		return true
	}

	// k8s version change
	// TODO: Replace direct ClientSet.Discovery() call with a small DiscoveryInterface.
	// current code depends on *kubernetes.Clientset, which is hard to mock in tests.
	version, err := getServerVersionWithTimeout(cs, versionCheckTimeout)
	if err != nil {
		poolName := ""
		if cluster.Pool != nil {
			poolName = cluster.Pool.PoolName
		}
		klog.Warningf("Failed to get server version for cluster %s (pool: %s): %v", cluster.Name, poolName, err)
		if time.Since(cs.lastVersionCheck) > forceRebuildThreshold {
			klog.Infof("Forcing rebuild for cluster %s, last version check was %v ago", cluster.Name, time.Since(cs.lastVersionCheck))
			return true
		}
	} else if version.String() != cs.Version {
		klog.Infof("Server version changed for cluster %s, updating, old: %s, new: %s", cluster.Name, cs.Version, version.String())
		cs.Version = version.String()
		cs.lastVersionCheck = time.Now()
		return true
	} else {
		cs.lastVersionCheck = time.Now()
	}

	return false
}

func getServerVersionWithTimeout(cs *ClientSet, timeout time.Duration) (*version.Info, error) {
	type result struct {
		v   *version.Info
		err error
	}
	ch := make(chan result, 1)
	go func() {
		v, err := cs.K8sClient.ClientSet.Discovery().ServerVersion()
		ch <- result{v, err}
	}()
	select {
	case r := <-ch:
		return r.v, r.err
	case <-time.After(timeout):
		return nil, fmt.Errorf("server version check timed out after %s", timeout)
	}
}

func (cm *ClusterManager) syncClusters() error {
	cm.syncMu.Lock()
	defer cm.syncMu.Unlock()

	return syncClusters(cm, nil)
}

func (cm *ClusterManager) syncClustersUntilReady(readyCh chan<- struct{}) error {
	cm.syncMu.Lock()
	defer cm.syncMu.Unlock()

	return syncClusters(cm, readyCh)
}

func (cm *ClusterManager) snapshotState() (map[string]*ClientSet, map[string]string, string) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	clusters := make(map[string]*ClientSet, len(cm.clusters))
	maps.Copy(clusters, cm.clusters)

	errors := make(map[string]string, len(cm.errors))
	maps.Copy(errors, cm.errors)

	return clusters, errors, cm.defaultContext
}

func NewClusterManager() (*ClusterManager, error) {
	cm := new(ClusterManager)
	cm.clusters = make(map[string]*ClientSet)
	cm.errors = make(map[string]string)
	cm.retries = make(map[string]*retryEntry)

	initialReady := make(chan struct{}, 1)
	go func() {
		if err := cm.syncClustersUntilReady(initialReady); err != nil {
			klog.Warningf("Failed to sync clusters: %v", err)
		}
	}()

	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
			case <-syncNow:
			}
			if err := cm.syncClusters(); err != nil {
				klog.Warningf("Failed to sync clusters: %v", err)
			}
		}
	}()

	timer := time.NewTimer(clusterStartupSyncTimeout)
	defer timer.Stop()

	select {
	case <-initialReady:
	case <-timer.C:
		klog.Warningf("Timed out waiting for cluster readiness after %s, continuing startup", clusterStartupSyncTimeout)
	}
	return cm, nil
}
