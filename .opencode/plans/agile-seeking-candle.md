# ESK Cluster Sync Implementation Plan

## Overview

Add periodic synchronization of Kubernetes clusters from an external ESK system into Kite's cluster database. The syncer fetches cluster lists and kubeconfigs from ESK APIs (via HTTP forward proxy), creates/updates/disables clusters in the database, and triggers the existing ClusterManager to rebuild K8s clients.

## Architecture

```
ESK API (10.22.58.63:32077)
    |
    | HTTP Forward Proxy (uos.cn:18080)
    |
    v
pkg/esk/ (new package)
    |
    | Writes to DB (model.Cluster)
    | Calls cluster.TriggerClusterSync()
    v
ClusterManager (existing, picks up DB changes every 1min)
```

The ESK syncer operates at the **database level** only. It does not directly build K8s clients. After each sync cycle that produces changes, it triggers `cluster.TriggerClusterSync()` which causes the existing ClusterManager to rebuild clients from the updated DB.

## Configuration (Environment Variables)

Add to `pkg/common/common.go`:

| Env Variable | Default | Description |
|---|---|---|
| `ESK_BASE_URL` | `""` (empty = disabled) | ESK API base URL, e.g. `http://10.22.58.63:32077/ops-esk-backend-service` |
| `ESK_PROXY_URL` | `""` | HTTP forward proxy URL, e.g. `http://uos.cn:18080` |
| `ESK_SYNC_INTERVAL` | `"5m"` | Sync interval duration |

When `ESK_BASE_URL` is empty, the ESK syncer is **not started** (feature disabled).

## New Files

### 1. `pkg/esk/types.go` — ESK API response types

```go
package esk

// ESK API common response wrapper
type APIResponse struct {
    State        string          `json:"state"`
    ErrorCode    *string         `json:"errorCode"`
    ErrorMessage *string         `json:"errorMessage"`
    Body         json.RawMessage `json:"body"`
}

// Paginated cluster list body
type ClusterListBody struct {
    Content []ESKCluster `json:"content"`
    Total   int          `json:"total"`
}

// Single ESK cluster from list API
type ESKCluster struct {
    ClusterID      string  `json:"clusterId"`
    ClusterName    string  `json:"clusterName"`
    ProductVersion string  `json:"productVersion"`
    AZ             string  `json:"az"`
    Description    *string `json:"description"`
    Provider       string  `json:"provider"`
    KubeVersion    string  `json:"kubeVersion"`
    Status         string  `json:"status"`
    Frozen         bool    `json:"frozen"`
    GmtCreateTime  string  `json:"gmtCreateTime"`
    EdgeType       string  `json:"edgeType"`
    ErrorMessage   *string `json:"errorMessage"`
}

// Kubeconfig response body (body is a string)
type KubeconfigBody string
```

### 2. `pkg/esk/client.go` — ESK HTTP API client

- `type Client struct` with `baseURL`, `*http.Client` (transport configured with proxy)
- `NewClient(baseURL, proxyURL string) *Client`
  - Creates `http.Transport` with `Proxy: http.ProxyURL(proxyURL)` when proxyURL is non-empty
  - HTTP timeout: 30s
- `ListClusters(pageNum, pageSize int) (*ClusterListBody, error)`
  - GET `{baseURL}/v1/clusters?pageSize={pageSize}&pageNum={pageNum}`
  - Parses `APIResponse`, checks `state == "OK"`, unmarshals `body` into `ClusterListBody`
- `GetKubeconfig(clusterID string) (string, error)`
  - GET `{baseURL}/v1/clusters/{clusterID}/kubeconfig`
  - Parses `APIResponse`, checks `state == "OK"`, unmarshals `body` as string
  - Returns empty string if body is empty/null

### 3. `pkg/esk/syncer.go` — Sync loop and logic

**`StartSyncer(ctx context.Context)`**
- Reads `ESK_BASE_URL`, `ESK_PROXY_URL`, `ESK_SYNC_INTERVAL` from `common` package
- If `ESK_BASE_URL` is empty, logs and returns (feature disabled)
- Creates `Client`, starts goroutine with `time.Ticker`
- Runs initial sync immediately, then on each tick

**`syncOnce(client *Client) error`** — core sync logic:

1. **Paginate all ESK clusters** (pageSize=100):
   - Call `client.ListClusters(pageNum, pageSize)` repeatedly until all pages fetched
   - Collect all `ESKCluster` into a flat slice

2. **Build lookup map**: `eskMap[clusterId] = ESKCluster`

3. **For each ESK cluster**:
   - Fetch kubeconfig via `client.GetKubeconfig(clusterId)`
   - Look up existing Kite cluster: `model.GetClusterByClusterID(clusterId)`
   - **If not found** → Create new `model.Cluster`:
     - `Name` = `eskCluster.ClusterName`
     - `ClusterID` = `eskCluster.ClusterID` (UUID)
     - `Config` = kubeconfig content (SecretString, AES-GCM encrypted)
     - `Category` = `"ESK"`
     - `Description` = build from ESK fields (az, productVersion, kubeVersion)
     - `Enable` = `(status == "available" && !frozen)`
     - `Enable` = false if kubeconfig is empty
     - `Tags` = `["esk-synced"]`
   - **If found** (and `Category == "ESK"`) → Compare and update:
     - Compute `shouldBeEnabled = (status == "available" && !frozen)`
     - Skip if ALL of these are unchanged: Name, Config (kubeconfig), Enable status, Description
     - Otherwise, call `model.UpdateCluster()` with changed fields
     - If kubeconfig fetch failed, log warning and skip

4. **Handle removed clusters**:
   - Query all Kite clusters with `Category = "ESK"` via new `model.GetClustersByCategory()`
   - For each, if its `ClusterID` is NOT in `eskMap` AND it's currently enabled → disable it
   - (Never delete, per user requirement)

5. **Trigger ClusterManager sync** if any changes were made:
   - Call `cluster.TriggerClusterSync()` once at the end

## Modified Files

### 4. `pkg/common/common.go` — Add ESK env vars

Add variables and load in `LoadEnvs()`:
```go
var (
    ESKBaseURL      = ""
    ESKProxyURL     = ""
    ESKSyncInterval = "5m"
)
```

### 5. `pkg/model/cluster.go` — Add query helper

Add function:
```go
func GetClusterByClusterID(clusterID string) (*Cluster, error) {
    var cluster Cluster
    if err := DB.Where("cluster_id = ?", clusterID).First(&cluster).Error; err != nil {
        return nil, err
    }
    return &cluster, nil
}

func GetClustersByCategory(category string) ([]*Cluster, error) {
    var clusters []*Cluster
    if err := DB.Where("category = ?", category).Find(&clusters).Error; err != nil {
        return nil, err
    }
    return clusters, nil
}
```

### 6. `app.go` — Start ESK syncer

After `cluster.NewClusterManager()` and `internal.StartConfigWatcher()`, add:
```go
esk.StartSyncer(ctx)
```

## Sync Behavior Summary

| Scenario | Action |
|---|---|
| ESK cluster not in Kite DB | Create with `Category=ESK`, `Enable=(status=="available" && !frozen)` |
| ESK cluster exists, kubeconfig changed | Update `Config` field |
| ESK cluster exists, name changed | Update `Name` field |
| ESK cluster status changed to non-available | Set `Enable=false` |
| ESK cluster status changed to available | Set `Enable=true` (if kubeconfig present) |
| ESK cluster removed from ESK | Set `Enable=false` (do NOT delete) |
| No changes detected | Skip update (no DB write, no sync trigger) |
| Kite cluster with `Category != "ESK"` | Never touched by syncer |
| Kubeconfig fetch fails for a cluster | Log warning, skip that cluster |

## Verification

1. **Build**: `make build` — ensure compilation succeeds
2. **Lint**: `make lint` — no lint errors
3. **Manual test** (if ESK accessible via proxy):
   - Set `ESK_BASE_URL=http://10.22.58.63:32077/ops-esk-backend-service`
   - Set `ESK_PROXY_URL=http://uos.cn:18080`
   - Start Kite, observe logs for ESK sync messages
   - Check cluster list in UI — ESK clusters should appear with `Category=ESK`
4. **Unit test**: Can mock the ESK client to test sync logic without network access
