# Bug Fix: ISO Scanning Not Working with Offline Assigned Nodes

**Document ID:** 000056  
**Date:** 2026-01-24  
**Component:** Control Plane - Storage Service (Image Service)  
**Severity:** Medium  
**Status:** Fixed

---

## Problem Description

When storage pools have an `/iso` folder with ISO files, the automatic ISO scanning feature was not discovering and registering these ISOs in the database. This meant that ISOs manually placed in storage pools would not appear in the UI.

### User Impact

- ISOs uploaded or copied to storage pool `/iso` folders were not visible in the dashboard
- Users had to manually register ISOs through the API instead of automatic discovery
- The "All Images" page would not show ISOs even though they existed on disk

---

## Root Cause

The issue was in the `scanISOsInternal()` method in `backend/internal/services/storage/image_service.go`.

The problematic code (line 119):

```go
// fallback to any connected node if pool has no explicit assignment or all assigned are offline
if selectedNodeID == "" && len(pool.Spec.AssignedNodeIDs) == 0 {
    connected := s.daemonPool.ConnectedNodes()
    if len(connected) > 0 {
        selectedNodeID = connected[0]
    }
}
```

### The Problem

This condition only allows fallback to other connected nodes if the pool has **NO assigned nodes** (`len(pool.Spec.AssignedNodeIDs) == 0`).

**Scenario that fails:**
1. Storage pool has assigned nodes: `[node-1, node-2]`
2. Both assigned nodes are offline/disconnected
3. There are other connected nodes available: `[node-3]`
4. The code skips the pool because `len(pool.Spec.AssignedNodeIDs) != 0`
5. ISOs in that pool's `/iso` folder are never scanned

This is the **same pattern** as the cloud image download bug (see 000055).

---

## Solution

The fix involves two changes:

### 1. Backend: Remove Restrictive Condition

Modified the node selection logic to try any connected node as a fallback, regardless of whether the pool has assigned nodes:

**Before:**
```go
// fallback to any connected node if pool has no explicit assignment or all assigned are offline
if selectedNodeID == "" && len(pool.Spec.AssignedNodeIDs) == 0 {
    connected := s.daemonPool.ConnectedNodes()
    if len(connected) > 0 {
        selectedNodeID = connected[0]
    }
}
```

**After:**
```go
// If no assigned node is connected, try to connect to the first assigned node
if selectedNodeID == "" && len(pool.Spec.AssignedNodeIDs) > 0 {
    // Similar to download manager, try to establish connection to assigned node
    s.logger.Debug("No connected assigned nodes for ISO scan, attempting to connect",
        zap.String("pool_id", pool.ID),
        zap.Strings("assigned_nodes", pool.Spec.AssignedNodeIDs),
    )
    // For now, just skip - the node should already be connected via registration
    // If we want to be more aggressive, we could try to connect here like in download_manager
}

// fallback to any connected node if pool has no explicit assignment or all assigned are offline
if selectedNodeID == "" {
    connected := s.daemonPool.ConnectedNodes()
    if len(connected) > 0 {
        selectedNodeID = connected[0]
        s.logger.Debug("Using fallback node for ISO scan",
            zap.String("pool_id", pool.ID),
            zap.String("node_id", selectedNodeID),
        )
    }
}

if selectedNodeID == "" {
    s.logger.Debug("No connected nodes available for ISO scan",
        zap.String("pool_id", pool.ID),
    )
    continue
}
```

Key changes:
- Removed the `len(pool.Spec.AssignedNodeIDs) == 0` check from the fallback condition
- Added debug logging to track node selection
- Added placeholder for future enhancement to actively connect to assigned nodes

### 2. Frontend: Add Manual Scan Button

Added a "Scan ISOs" button to the All Images page to allow users to manually trigger ISO scanning:

**New Hook (`frontend/src/hooks/useImages.ts`):**
```typescript
// Hook to scan ISOs from storage pools
export function useScanISOs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (storagePoolId?: string) => {
      const response = await imageClient.scanISOs({
        storagePoolId: storagePoolId || '',
      });
      return {
        discoveredCount: response.discoveredCount,
      };
    },
    onSuccess: () => {
      // Invalidate images list to show newly discovered ISOs
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
}
```

**UI Button (`frontend/src/pages/images/AllImagesPage.tsx`):**
```typescript
const handleScanISOs = async () => {
  scanISOs.mutate(undefined, {
    onSuccess: (data) => {
      if (data.discoveredCount > 0) {
        toast.success(`Discovered ${data.discoveredCount} new ISO${data.discoveredCount > 1 ? 's' : ''}`);
      } else {
        toast.info('No new ISOs found');
      }
      refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to scan ISOs');
    },
  });
};
```

---

## Behavior After Fix

### Scenario 1: Pool with Connected Assigned Node
- **Before:** Scans the assigned node ✅
- **After:** Scans the assigned node ✅ (no change)

### Scenario 2: Pool with Offline Assigned Nodes
- **Before:** Skips the pool entirely ❌
- **After:** Falls back to any connected node ✅

### Scenario 3: Pool with No Assigned Nodes
- **Before:** Uses any connected node ✅
- **After:** Uses any connected node ✅ (no change)

### Scenario 4: No Nodes Connected
- **Before:** Skips the pool (silent)
- **After:** Skips the pool with debug log ✅

---

## How to Use

### Automatic Scanning

ISO scanning happens automatically:
1. **On startup** - 5 seconds after the image service is configured
2. **Periodically** - Can be configured to run on a schedule (future enhancement)

### Manual Scanning

Users can now manually trigger ISO scanning:
1. Navigate to **Images > All Images** page
2. Click the **"Scan ISOs"** button
3. The system will:
   - Scan all storage pools for `/iso` folders
   - Register any new ISOs found
   - Show a toast notification with the count of discovered ISOs
   - Refresh the images list

---

## Testing

To verify the fix works:

### Test 1: Offline Assigned Node
1. Create a storage pool with an assigned node
2. Stop the node daemon (simulate disconnect)
3. Place an ISO file in the pool's `/iso` folder on another connected node
4. Click "Scan ISOs" button
5. **Expected:** The ISO is discovered and appears in the UI

### Test 2: No Assigned Nodes
1. Create a storage pool with no assigned nodes
2. Place an ISO file in the pool's `/iso` folder
3. Click "Scan ISOs" button
4. **Expected:** The ISO is discovered using any connected node

### Test 3: Manual Scan Feedback
1. Click "Scan ISOs" when no new ISOs exist
2. **Expected:** Toast shows "No new ISOs found"
3. Add a new ISO file
4. Click "Scan ISOs" again
5. **Expected:** Toast shows "Discovered 1 new ISO"

---

## Related Files

- `backend/internal/services/storage/image_service.go` - Backend fix
- `frontend/src/hooks/useImages.ts` - New `useScanISOs` hook
- `frontend/src/pages/images/AllImagesPage.tsx` - UI button

---

## Related Issues

This fix follows the same pattern as:
- **000055** - Cloud Image Download Node Connection Fix

Both issues stem from the same root cause: restrictive node selection logic that doesn't fall back to other connected nodes when assigned nodes are offline.

---

## Future Enhancements

1. **Automatic reconnection** - Like the download manager, actively try to connect to assigned nodes before falling back
2. **Scheduled scanning** - Run ISO scans periodically (e.g., every 5 minutes)
3. **Pool-specific scanning** - Allow users to scan a specific pool instead of all pools
4. **Real-time file system watching** - Use inotify/fswatch to detect new ISOs immediately
5. **Scan progress indicator** - Show which pools are being scanned in real-time

---

## Lessons Learned

1. **Consistent patterns** - The same node selection logic appears in multiple places (download manager, ISO scanning). Consider extracting to a shared helper function.
2. **Fallback logic** - Always provide fallback to any connected node, not just when there are no assigned nodes.
3. **Debug logging** - Added debug logs to track node selection decisions for easier troubleshooting.
4. **Manual triggers** - Providing manual UI buttons for automatic processes helps users troubleshoot and verify functionality.
