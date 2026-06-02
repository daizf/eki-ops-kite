package esk

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

const pageSize = 20

type eskResponse struct {
	State        string   `json:"state"`
	ErrorMessage string   `json:"errorMessage"`
	Body         *eskBody `json:"body"`
}

type eskBody struct {
	Content []eskCluster `json:"content"`
	Total   int          `json:"total"`
}

type eskCluster struct {
	ClusterID      string `json:"clusterId"`
	ClusterName    string `json:"clusterName"`
	ProductVersion string `json:"productVersion"`
	AZ             string `json:"az"`
	Description    string `json:"description"`
	KubeVersion    string `json:"kubeVersion"`
	Status         string `json:"status"`
	Frozen         bool   `json:"frozen"`
	GmtCreateTime  string `json:"gmtCreateTime"`
	EdgeType       string `json:"edgeType"`
	Provider       string `json:"provider"`
}

type eskKubeconfigResponse struct {
	State        string `json:"state"`
	ErrorMessage string `json:"errorMessage"`
	Body         *struct {
		KubeConfig string `json:"kubeConfig"`
	} `json:"body"`
}

func (s *Syncer) sync(ctx context.Context) error {
	allClusters, err := s.fetchAllClusters(ctx)
	if err != nil {
		return fmt.Errorf("fetch clusters: %w", err)
	}

	klog.Infof("ESK sync: fetched %d clusters from pool %s", len(allClusters), s.poolID)

	eskClusterIDs := make(map[string]bool)
	changed := false

	for _, ec := range allClusters {
		eskClusterIDs[ec.ClusterID] = true

		metaHash := computeMetaHash(ec)
		existing, err := model.GetClusterByClusterID(ec.ClusterID)
		if err != nil {
			klog.Warningf("ESK sync: failed to look up cluster %s: %v", ec.ClusterID, err)
			continue
		}

		if existing != nil && existing.MetaHash == metaHash {
			continue
		}

		kubeConfig, err := s.fetchKubeconfig(ctx, ec.ClusterID)
		if err != nil {
			klog.Warningf("ESK sync: failed to fetch kubeconfig for %s: %v", ec.ClusterID, err)
			continue
		}

		enable := ec.Status == "available"

		if existing == nil {
			cl := &model.Cluster{
				Name:        ec.ClusterName,
				ClusterID:   ec.ClusterID,
				Description: derefStr(ec.Description),
				Config:      model.SecretString(kubeConfig),
				Category:    "ESK",
				Enable:      enable,
				MetaHash:    metaHash,
				PoolID:      s.poolID,
			}
			if err := cl.SetTags([]string{ec.Provider, ec.ProductVersion}); err != nil {
				klog.Warningf("ESK sync: failed to set tags for %s: %v", ec.ClusterID, err)
				continue
			}
			if err := model.AddCluster(cl); err != nil {
				klog.Warningf("ESK sync: failed to create cluster %s: %v", ec.ClusterID, err)
				continue
			}
			klog.Infof("ESK sync: created cluster %s (%s) in pool %s", ec.ClusterName, ec.ClusterID, s.poolID)
			changed = true
		} else {
			updates := map[string]interface{}{
				"name":        ec.ClusterName,
				"description": derefStr(ec.Description),
				"category":    "ESK",
				"enable":      enable,
				"config":      model.SecretString(kubeConfig),
				"meta_hash":   metaHash,
				"pool_id":     s.poolID,
			}
			if err := model.UpdateCluster(existing, updates); err != nil {
				klog.Warningf("ESK sync: failed to update cluster %s: %v", ec.ClusterID, err)
				continue
			}
			klog.Infof("ESK sync: updated cluster %s (%s) in pool %s", ec.ClusterName, ec.ClusterID, s.poolID)
			changed = true
		}
	}

	// Disable clusters that belong to this pool but are no longer in ESK
	poolClusters, err := model.ListClustersByPoolID(s.poolID)
	if err != nil {
		klog.Warningf("ESK sync: failed to list clusters for pool %s: %v", s.poolID, err)
	} else {
		for _, c := range poolClusters {
			if !eskClusterIDs[c.ClusterID] && c.Enable {
				if err := model.DisableCluster(c); err != nil {
					klog.Warningf("ESK sync: failed to disable cluster %s: %v", c.ClusterID, err)
				} else {
					klog.Infof("ESK sync: disabled missing cluster %s (%s)", c.Name, c.ClusterID)
					changed = true
				}
			}
		}
	}

	if changed {
		cluster.TriggerClusterSync()
	}

	klog.Infof("ESK sync: pool %s completed", s.poolID)
	return nil
}

func (s *Syncer) fetchAllClusters(ctx context.Context) ([]eskCluster, error) {
	var all []eskCluster
	page := 1

	for {
		u := fmt.Sprintf("%s/v1/clusters?pageSize=%d&pageNum=%d", s.baseURL, pageSize, page)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, err
		}

		resp, err := s.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("request %s: %w", u, err)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("read response: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
		}

		var eskResp eskResponse
		if err := json.Unmarshal(body, &eskResp); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}

		if eskResp.State != "OK" {
			return nil, fmt.Errorf("ESK API error: %s", eskResp.ErrorMessage)
		}

		if eskResp.Body == nil {
			return nil, fmt.Errorf("ESK API returned nil body")
		}

		all = append(all, eskResp.Body.Content...)

		if len(all) >= eskResp.Body.Total {
			break
		}
		page++
	}

	return all, nil
}

func (s *Syncer) fetchKubeconfig(ctx context.Context, clusterID string) (string, error) {
	u := fmt.Sprintf("%s/v1/clusters/%s/kubeconfig", s.baseURL, clusterID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request: %w", err)
	}

	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %d: %s", resp.StatusCode, string(body))
	}

	var kubeResp eskKubeconfigResponse
	if err := json.Unmarshal(body, &kubeResp); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if kubeResp.State != "OK" {
		return "", fmt.Errorf("ESK kubeconfig error: %s", kubeResp.ErrorMessage)
	}

	if kubeResp.Body == nil || kubeResp.Body.KubeConfig == "" {
		return "", fmt.Errorf("empty kubeconfig")
	}

	return kubeResp.Body.KubeConfig, nil
}

func computeMetaHash(c eskCluster) string {
	data := c.ClusterName + "|" + c.AZ + "|" + derefStr(c.Description) + "|" + c.KubeVersion + "|" + c.Status
	h := sha256.Sum256([]byte(data))
	return fmt.Sprintf("%x", h)
}

func derefStr(s string) string {
	return s
}
