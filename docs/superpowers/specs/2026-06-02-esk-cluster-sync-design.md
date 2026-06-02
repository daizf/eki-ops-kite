# ESK Cluster Sync Design

## Overview

Periodically synchronize clusters from the external ESK system into Kite's local cluster database, with a 5-minute interval and change detection to skip unnecessary updates.

## Configuration

Environment variables:

| Variable | Description | Default |
|---|---|---|
| `ESK_SYNC_ENABLED` | Enable ESK sync | `false` |
| `ESK_SYNC_BASE_URL` | ESK API base URL (e.g. `http://10.22.58.63:32077/ops-esk-backend-service`) | empty |
| `ESK_SYNC_INTERVAL` | Sync interval | `5m` |
| `ESK_SYNC_PROXY` | HTTP proxy address (e.g. `http://uos.cn:18080`) | empty |

When proxy is set, all HTTP requests to ESK use the proxy. When base URL is empty, sync is disabled regardless of `ESK_SYNC_ENABLED`.

## Data Model Changes

### Cluster model — two new fields

```go
Source      string `json:"source" gorm:"type:varchar(50);default:'manual'"`  // "esk" or "manual"
EskMetaHash string `json:"-" gorm:"type:varchar(64)"`                           // SHA256 of ESK metadata
```

- **Source**: Distinguishes ESK-synced clusters from manually created ones. Only `Source=esk` clusters are subject to the "disable missing clusters" logic.
- **EskMetaHash**: SHA256 hash of ESK cluster metadata (clusterName + az + description + kubeVersion + status). When hash matches, skip the cluster entirely (including kubeconfig fetch).

### ESK API response mapping

| ESK field | Kite field |
|---|---|
| `clusterId` | `ClusterID` |
| `clusterName` | `Name` |
| `description` | `Description` |
| `az` | `Category` |
| status == "available" | `Enable = true`, otherwise `Enable = false` |
| kubeconfig API response | `Config` |
| (computed) | `Source = "esk"` |
| (computed) | `EskMetaHash` = SHA256 of metadata |

## Sync Logic

Every sync cycle:

1. **Fetch cluster list** from ESK API with pagination (pageSize=20, starting from pageNum=1).
2. **For each ESK cluster**:
   - Look up by `ClusterID` in local DB.
   - **Not found** → call kubeconfig API → create new cluster with `Source=esk`, `Enable=true` (if status=available).
   - **Found** → compute metadata hash → compare with `EskMetaHash`:
     - Same → skip entirely (no kubeconfig fetch).
     - Different → call kubeconfig API → update fields including `Config`, `EskMetaHash`, and metadata fields.
   - kubeconfig API errors (e.g. kubeconfig missing) → log warning, skip this cluster, do not disable.
3. **Disable missing clusters**: Local clusters with `Source=esk` that are not in ESK's response → set `Enable=false`.
4. **If any changes** → call `cluster.TriggerClusterSync()` to rebuild K8s clients.

## Lifecycle

- Started in `initializeApp()` via `esk.StartSyncer(ctx)`.
- Receives `context.Context` for graceful shutdown (cancelled by `main.go`'s `cancelApp()`).
- Runs one sync immediately on startup, then every interval.
- ESK API unreachable → log warning, do not modify any local cluster state.

## File Structure

```
pkg/esk/
  esk.go   — Config loading, syncer start/stop, HTTP client setup
  sync.go  — Core sync logic (fetch list, compare, update DB)
```

## Integration Points

- `pkg/common/common.go`: Add ESK config vars and `LoadEnvs()` entries.
- `pkg/model/cluster.go`: Add `Source` and `EskMetaHash` fields.
- `app.go`: Call `esk.StartSyncer(ctx)` after `NewClusterManager()`.
- `pkg/cluster/cluster_handler.go`: Include `source` field in cluster list API responses.