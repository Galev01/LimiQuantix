# Workflow State - Image Persistence, VM Creation Wizard & Pool Sync

## All Tasks Completed

### 1. Image Persistence (PostgreSQL)

**Problem**: Downloaded images (cloud images and ISOs) were lost after control plane restart because they were stored in-memory.

**Solution**:
- Created new PostgreSQL migration (`backend/migrations/000012_images_extended.up.sql`) with extended schema
- Created PostgreSQL image repository (`backend/internal/repository/postgres/image_repository.go`)
- Updated `server.go` to use PostgreSQL repository when available

**Files Changed**:
- `backend/migrations/000012_images_extended.up.sql` (new)
- `backend/migrations/000012_images_extended.down.sql` (new)
- `backend/internal/repository/postgres/image_repository.go` (new)
- `backend/internal/server/server.go` (modified)

### 2. VM Creation Wizard Image Selection

**Problem**: The VM Creation Wizard wasn't properly fetching and displaying images from the database.

**Solution**:
- Updated `useAvailableImages()` hook to fetch cloud images from DB and merge with catalog
- Updated `useISOs()` hook to properly filter and display ISO images from DB
- Updated `toCloudImage()` to use the actual `path` from the database
- Added `storagePoolId` and proper `nodeId` to CloudImage interface
- Updated StepISO component to show image status (ready/downloading/needs download)
- Added validation to ensure selected image has a valid path before VM creation
- Show image path in the UI when available

**Files Changed**:
- `frontend/src/hooks/useImages.ts` (modified)
- `frontend/src/components/vm/VMCreationWizard.tsx` (modified)

### 3. Pool Sync Mechanism (ISO Scanning Fix)

**Problem**: ISO scanning fails because the node daemon doesn't have pool info after restart.

**Root Cause**: 
- Node daemon stores pool info in memory
- After restart, the pool cache is empty
- `try_discover_pool()` only checks standard paths (`/var/lib/limiquantix/pools/{pool_id}`)
- User's NFS pool is at `/srv/nfs/qVDS01` which isn't discovered

**Solution**:
- Added `OnConnectCallback` to `DaemonPool` - called when a node connects/reconnects
- Added `SyncPoolsToNode()` method to `PoolService` - pushes pool configs to a specific node
- Added `SyncPoolsToAllNodes()` method for bulk sync
- Wired up the callback in `server.go` so pools are automatically synced when nodes connect

**How it works**:
1. When a node connects to the control plane (via `DaemonPool.Connect()`)
2. The `OnConnectCallback` is triggered
3. `PoolService.SyncPoolsToNode()` is called
4. All relevant pools (assigned to node + shared storage like NFS/Ceph) are initialized on the node
5. Node daemon now has pool info in its cache for `ListStoragePoolFiles` requests

**Files Changed**:
- `backend/internal/services/node/daemon_pool.go` (modified - added callback mechanism)
- `backend/internal/services/storage/pool_service.go` (modified - added SyncPoolsToNode)
- `backend/internal/server/server.go` (modified - wired up callback)

## Deployment

Run the publish script to build and deploy everything:

```bash
./scripts/publish-vdc-update.sh
```

This will:
1. Build control plane with pool sync mechanism
2. Build dashboard with updated image hooks
3. Package migrations (including new images table)
4. Upload to update server

Then in QvDC UI:
1. Check for updates
2. Apply update
3. Migrations will run automatically

## Testing

1. **Image Persistence**:
   - Download a cloud image
   - Restart control plane
   - Verify image is still listed

2. **ISO Scanning**:
   - Ensure a node is connected
   - Click "Scan ISOs" in the Images page
   - ISOs in storage pools should be discovered

3. **VM Creation**:
   - Open VM Creation Wizard
   - Go to Boot Media step
   - Verify downloaded images show "Ready" status
   - Verify image path is displayed
   - Select a ready image and complete VM creation

## Log

- Created PostgreSQL image repository with full CRUD operations
- Extended images table schema to match domain model
- Updated frontend hooks to properly fetch and display images from DB
- Added image path display in VM Creation Wizard
- Added validation to ensure selected image is downloaded before VM creation
- Added pool sync mechanism to push pool configs to nodes on connect
- ISO scanning should now work after node reconnects
