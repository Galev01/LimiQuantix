# Workflow State

## Active Task: Fix Cloud Image Download to Storage Pools

**Date:** January 23, 2026
**Status:** Implementation Complete - Ready for Testing

### Problem Statement

Cloud images appeared as "downloaded" in the Image Library UI, but they were **not actually present on NFS storage**. The Create VM wizard showed "Download required" for these images.

**Root Cause:**
1. The `DownloadManager` downloaded images to `/var/lib/limiquantix/cloud-images` on the **QvDC control plane machine**
2. Downloads should go to the **Node Daemon's storage** (NFS mount or local storage pool)
3. The `storagePoolId` and `nodeId` parameters were captured but never used to route downloads

### Solution Implemented

#### 1. Node Daemon Download Endpoint (Rust)

Added `POST /api/v1/images/download` endpoint to the Node Daemon HTTP server that:
- Accepts URL, target directory, image metadata
- Downloads with progress tracking
- Stores downloaded images in the storage pool's mount path
- Reports completion/failure back to control plane

**Files changed:**
- `agent/limiquantix-node/src/http_server.rs` - Added download handlers
- `agent/limiquantix-node/Cargo.toml` - Added `once_cell` dependency

#### 2. Backend Download Routing (Go)

Modified `DownloadManager` to route downloads to nodes:
- Added `StartDownloadWithPool()` method that finds a node with access to the pool
- Looks up the storage pool's mount path (NFS, LocalDir, etc.)
- Makes HTTP POST to node's `/api/v1/images/download` endpoint
- Polls node for progress updates
- Updates image record on completion

**Files changed:**
- `backend/internal/services/storage/download_manager.go` - Complete rewrite with node routing
- `backend/internal/services/storage/image_service.go` - Added `ConfigureNodeDownloads()` method
- `backend/internal/server/server.go` - Wire up daemon pool and pool repo to image service

#### 3. Frontend Storage Pool Selection (React)

Updated Image Library's Downloads page to:
- Show a storage pool selector before downloading
- Auto-select first available pool
- Pass `storagePoolId` when calling download API
- Show which pool images will be downloaded to

**Files changed:**
- `frontend/src/pages/images/DownloadsPage.tsx` - Added pool selector and routing

### Architecture After Fix

```
Frontend → Backend (DownloadImage RPC with poolId)
                    ↓
                Backend looks up pool → finds mount path & assigned nodes
                    ↓
                Backend calls Node Daemon HTTP: POST /api/v1/images/download
                    ↓
                Node Daemon downloads to: {pool_mount_path}/cloud-images/{catalogId}.qcow2
                    ↓
                Node reports progress → Backend updates job status
                    ↓
                On completion → Image marked READY with correct path
```

### Testing Required

1. **Create NFS storage pool** in the UI (if not already done)
2. **Go to Image Library → Downloads**
3. **Select the NFS pool** in the dropdown
4. **Download a cloud image** (e.g., Debian 12)
5. **Verify on NFS server**: `ls -la /srv/nfs/qVDS01/cloud-images/`
6. **Create VM** using the downloaded image
7. **Verify VM boots** with the cloud image

### Known Limitations

- Download progress polling is basic (2-second intervals)
- No retry logic for failed node connections
- Checksum verification is stubbed out (TODO: implement SHA256)

---

## Progress Log

### Step 1: Analysis Complete
- Identified that `download_manager.go` downloads locally
- `DownloadImage` RPC receives `storagePoolId` but doesn't use it
- Node Daemon had no image download capability

### Step 2: Node Daemon Endpoint
- Added download job tracking with `once_cell::Lazy`
- Implemented background download with progress
- Integrated with iso_manager for metadata tracking

### Step 3: Backend Routing
- Rewrote `DownloadManager` with `StartDownloadWithPool()`
- Added pool lookup and mount path resolution
- Added node HTTP client calls

### Step 4: Frontend Integration
- Added `useStoragePools` hook to DownloadsPage
- Added pool selector UI component
- Pass `storagePoolId` in download request

### Step 5: Ready for Testing
- Code compiles (Rust with `--no-default-features`, Go)
- No linter errors in frontend
- Documentation updated
