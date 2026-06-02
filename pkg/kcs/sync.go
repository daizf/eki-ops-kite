package kcs

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/zxh326/kite/pkg/cluster"
	"github.com/zxh326/kite/pkg/model"
	"k8s.io/klog/v2"
)

type kcsResponse struct {
	RequestID string      `json:"requestId"`
	State     string      `json:"state"`
	Body      interface{} `json:"body"`
}

type kcsCluster struct {
	ClusterID    string   `json:"clusterID"`
	ClusterName  string   `json:"clusterName"`
	UserID       string   `json:"userID"`
	ApiEndpoints []string `json:"apiEndpoints"`
	Status       bool     `json:"status"`
	CreateTime   string   `json:"createTime"`
	CheckTime    string   `json:"checkTime"`
}

type kcsKubeconfigResponse struct {
	State        string `json:"state"`
	ErrorMessage string `json:"errorMessage"`
	Body         *struct {
		Kubeconfig interface{} `json:"kubeconfig"`
	} `json:"body"`
}

func (s *Syncer) sync(ctx context.Context) error {
	allClusters, err := s.fetchAllClusters(ctx)
	if err != nil {
		return fmt.Errorf("fetch clusters: %w", err)
	}

	klog.Infof("KCS sync: fetched %d clusters from pool %s", len(allClusters), s.poolID)

	kcsClusterIDs := make(map[string]bool)
	changed := false

	for _, kc := range allClusters {
		kcsClusterIDs[kc.ClusterID] = true

		metaHash := computeMetaHash(kc)
		existing, err := model.GetClusterByClusterID(kc.ClusterID)
		if err != nil {
			klog.Warningf("KCS sync: failed to look up cluster %s: %v", kc.ClusterID, err)
			continue
		}

		if existing != nil && existing.MetaHash == metaHash {
			continue
		}

		kubeConfig, err := s.fetchKubeconfig(ctx, kc.ClusterID, kc.UserID, kc.ApiEndpoints)
		if err != nil {
			klog.Warningf("KCS sync: failed to fetch kubeconfig for %s: %v", kc.ClusterID, err)
			continue
		}

		enable := kc.Status

		if existing == nil {
			cl := &model.Cluster{
				Name:      kc.ClusterName,
				ClusterID: kc.ClusterID,
				Config:    model.SecretString(kubeConfig),
				Category:  "KCS",
				Enable:    enable,
				MetaHash:  metaHash,
				PoolID:    s.poolID,
			}
			if err := cl.SetTags(nil); err != nil {
				klog.Warningf("KCS sync: failed to set tags for %s: %v", kc.ClusterID, err)
				continue
			}
			if err := model.AddCluster(cl); err != nil {
				klog.Warningf("KCS sync: failed to create cluster %s: %v", kc.ClusterID, err)
				continue
			}
			klog.Infof("KCS sync: created cluster %s (%s) in pool %s", kc.ClusterName, kc.ClusterID, s.poolID)
			changed = true
		} else {
			updates := map[string]interface{}{
				"name":      kc.ClusterName,
				"category":  "kcs",
				"enable":    enable,
				"config":    model.SecretString(kubeConfig),
				"meta_hash": metaHash,
				"pool_id":   s.poolID,
			}
			if err := model.UpdateCluster(existing, updates); err != nil {
				klog.Warningf("KCS sync: failed to update cluster %s: %v", kc.ClusterID, err)
				continue
			}
			klog.Infof("KCS sync: updated cluster %s (%s) in pool %s", kc.ClusterName, kc.ClusterID, s.poolID)
			changed = true
		}
	}

	// Disable clusters that belong to this pool but are no longer in KCS
	poolClusters, err := model.ListClustersByPoolID(s.poolID)
	if err != nil {
		klog.Warningf("KCS sync: failed to list clusters for pool %s: %v", s.poolID, err)
	} else {
		for _, c := range poolClusters {
			if !kcsClusterIDs[c.ClusterID] && c.Enable {
				if err := model.DisableCluster(c); err != nil {
					klog.Warningf("KCS sync: failed to disable cluster %s: %v", c.ClusterID, err)
				} else {
					klog.Infof("KCS sync: disabled missing cluster %s (%s)", c.Name, c.ClusterID)
					changed = true
				}
			}
		}
	}

	if changed {
		cluster.TriggerClusterSync()
	}

	klog.Infof("KCS sync: pool %s completed", s.poolID)
	return nil
}

func (s *Syncer) fetchAllClusters(ctx context.Context) ([]kcsCluster, error) {
	u := fmt.Sprintf("%s/v2/clusters/all", s.baseURL)
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

	var kcsResp kcsResponse
	if err := json.Unmarshal(body, &kcsResp); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if kcsResp.State != "OK" {
		return nil, fmt.Errorf("KCS API error: state=%s", kcsResp.State)
	}

	// KCS returns body as a direct array of clusters
	clustersJSON, err := json.Marshal(kcsResp.Body)
	if err != nil {
		return nil, fmt.Errorf("marshal body: %w", err)
	}

	var clusters []kcsCluster
	if err := json.Unmarshal(clustersJSON, &clusters); err != nil {
		return nil, fmt.Errorf("decode clusters: %w", err)
	}

	return clusters, nil
}

func (s *Syncer) fetchKubeconfig(ctx context.Context, clusterID string, userID string, apiEndpoints []string) (string, error) {
	u := fmt.Sprintf("%s/v2/clusters/%s/kubeconfig", s.baseURL, clusterID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User_id", userID)

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

	var kubeResp kcsKubeconfigResponse
	if err := json.Unmarshal(body, &kubeResp); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if kubeResp.State != "OK" {
		return "", fmt.Errorf("KCS kubeconfig error: %s", kubeResp.ErrorMessage)
	}

	if kubeResp.Body == nil || kubeResp.Body.Kubeconfig == nil {
		return "", fmt.Errorf("empty kubeconfig")
	}

	// KCS returns kubeconfig as a JSON object, convert to YAML
	kubeJSON, err := json.Marshal(kubeResp.Body.Kubeconfig)
	if err != nil {
		return "", fmt.Errorf("marshal kubeconfig: %w", err)
	}

	return jsonToKubeconfigYAML(kubeJSON, apiEndpoints)
}

func computeMetaHash(c kcsCluster) string {
	data := c.ClusterName + "|" + fmt.Sprintf("%t", c.Status) + "|" + c.CreateTime + "|" + strings.Join(c.ApiEndpoints, ",")
	h := sha256.Sum256([]byte(data))
	return fmt.Sprintf("%x", h)
}
