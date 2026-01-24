# Bug Fix: Cloud Image Download Node Connection Error

**Document ID:** 000055  
**Date:** 2026-01-24  
**Component:** Control Plane - Storage Service  
**Severity:** High  
**Status:** Fixed

---

## Problem Description

When attempting to download a cloud image from the catalog, users encountered the following error:

```
[internal] failed to get node address: no connection to node 0148d5a8-0fbb-4cdc-b93f-04eb4fed4a6a
```

This error occurred even when the node was registered in the database but not actively connected to the control plane's daemon pool.

---

## Root Cause

The issue was in the `DownloadManager.DownloadCatalogImage()` method in `backend/internal/services/storage/download_manager.go`.

The problematic code (lines 240-243):

```go
// If no assigned node is connected, try the first assigned node anyway
if nodeID == "" && len(pool.Spec.AssignedNodeIDs) > 0 {
    nodeID = pool.Spec.AssignedNodeIDs[0]
}
```

This fallback logic would select a node from the pool's assigned nodes **without verifying** that the node was actually connected to the daemon pool. When the code later tried to get the node's address via `dm.daemonPool.GetNodeAddr(nodeID)`, it would fail with "no connection to node" error.

### Why This Happened

1. A storage pool has assigned nodes in its spec
2. The download manager checks if any assigned node is connected
3. If none are connected, it falls back to using the first assigned node ID
4. Later, when trying to get the node's HTTP address, it fails because the node isn't in the daemon pool's connection map

---

## Solution

The fix involves three changes:

### 1. Add Node Repository to DownloadManager

Added a `nodeRepo` field to the `DownloadManager` struct to allow looking up node information:

```go
type DownloadManager struct {
    mu         sync.RWMutex
    jobs       map[string]*DownloadJob
    imageRepo  ImageRepository
    poolRepo   PoolRepository
    nodeRepo   node.Repository  // NEW
    daemonPool *node.DaemonPool
    catalog    []CatalogEntry
    logger     *zap.Logger
    httpClient *http.Client
}
```

### 2. Attempt to Connect Before Using Node

Modified the fallback logic to **actively attempt to connect** to the node before using it:

```go
// If no assigned node is connected, try to connect to the first assigned node
if nodeID == "" && len(pool.Spec.AssignedNodeIDs) > 0 && dm.nodeRepo != nil {
    firstNodeID := pool.Spec.AssignedNodeIDs[0]
    dm.logger.Info("No connected assigned nodes, attempting to connect to first assigned node",
        zap.String("node_id", firstNodeID),
        zap.String("pool_id", poolID),
    )
    
    // Get node info to get management IP
    nodeInfo, err := dm.nodeRepo.Get(ctx, firstNodeID)
    if err == nil {
        // Build daemon address
        daemonAddr := nodeInfo.ManagementIP
        // Strip CIDR notation if present
        if idx := strings.Index(daemonAddr, "/"); idx != -1 {
            daemonAddr = daemonAddr[:idx]
        }
        // Ensure port is included
        if !strings.Contains(daemonAddr, ":") {
            daemonAddr = daemonAddr + ":9090"
        }
        
        // Try to connect
        _, connectErr := dm.daemonPool.Connect(firstNodeID, daemonAddr)
        if connectErr == nil {
            nodeID = firstNodeID
            dm.logger.Info("Successfully connected to assigned node",
                zap.String("node_id", firstNodeID),
                zap.String("daemon_addr", daemonAddr),
            )
        } else {
            dm.logger.Warn("Failed to connect to assigned node",
                zap.String("node_id", firstNodeID),
                zap.String("daemon_addr", daemonAddr),
                zap.Error(connectErr),
            )
        }
    } else {
        dm.logger.Warn("Failed to get node info for assigned node",
            zap.String("node_id", firstNodeID),
            zap.Error(err),
        )
    }
}
```

### 3. Improved Error Message

Updated the error message to be more helpful:

```go
if nodeID == "" {
    return fmt.Errorf("no connected nodes available to download image. Please ensure at least one Quantix-OS node is running and connected to the control plane")
}
```

### 4. Wire Up Node Repository

Updated the service initialization:

**`image_service.go`:**
```go
func (s *ImageService) ConfigureNodeDownloads(daemonPool *node.DaemonPool, poolRepo PoolRepository, nodeRepo node.Repository) {
    s.daemonPool = daemonPool
    s.poolRepo = poolRepo
    s.downloadManager.SetDaemonPool(daemonPool)
    s.downloadManager.SetPoolRepository(poolRepo)
    s.downloadManager.SetNodeRepository(nodeRepo)  // NEW
    s.logger.Info("Image service configured for node-based downloads")
    // ...
}
```

**`server.go`:**
```go
// Configure image service to route downloads to nodes
if s.daemonPool != nil && s.storagePoolRepo != nil && s.nodeRepo != nil {
    s.imageService.ConfigureNodeDownloads(s.daemonPool, s.storagePoolRepo, s.nodeRepo)
}
```

---

## Behavior After Fix

### Scenario 1: Assigned Node Already Connected
- **Before:** Uses the connected node ✅
- **After:** Uses the connected node ✅ (no change)

### Scenario 2: Assigned Node Not Connected
- **Before:** Tries to use node without connection → **ERROR** ❌
- **After:** Attempts to connect to node → Uses it if successful ✅

### Scenario 3: No Assigned Nodes
- **Before:** Falls back to any connected node ✅
- **After:** Falls back to any connected node ✅ (no change)

### Scenario 4: No Nodes Available
- **Before:** Generic error message
- **After:** Clear error message with instructions ✅

---

## Testing

To verify the fix works:

1. **Register a node** but don't start the node daemon
2. **Create a storage pool** with that node assigned
3. **Attempt to download a cloud image**
4. **Expected:** The download should fail with a clear error message, not a cryptic "no connection" error

OR

1. **Register a node** and start the node daemon
2. **Create a storage pool** with that node assigned
3. **Stop the node daemon** (simulate disconnect)
4. **Attempt to download a cloud image**
5. **Expected:** The control plane attempts to reconnect to the node before downloading

---

## Related Files

- `backend/internal/services/storage/download_manager.go` - Main fix
- `backend/internal/services/storage/image_service.go` - Configuration update
- `backend/internal/server/server.go` - Service wiring

---

## Lessons Learned

1. **Always verify connections before using them** - Don't assume a node ID means the node is reachable
2. **Lazy connection establishment** - The daemon pool should attempt to connect when needed, not just at registration
3. **Clear error messages** - Users need actionable guidance, not internal error messages
4. **Dependency injection** - The DownloadManager needed access to the node repository to look up connection info

---

## Future Improvements

1. **Connection health monitoring** - Periodically check and refresh stale connections
2. **Automatic retry logic** - If a node disconnects mid-download, try another node
3. **Node affinity** - Prefer nodes that are geographically closer or have better network performance
4. **Download resume** - Support resuming interrupted downloads instead of starting over
