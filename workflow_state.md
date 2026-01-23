# Workflow State

## Active Task: ISO Upload to NFS + UI Improvements + Storage Packages

**Date:** January 23, 2026
**Status:** Code Complete - Awaiting Deployment

### Issues Being Fixed

1. **ISO not uploading to NFS** - ISOs save to local QvDC storage instead of NFS pool
2. **Path not shown in UI** - No way to see where ISOs are stored
3. **Modal blocking UI** - Upload modal takes over screen, should be background task
4. **Missing NFS client** - QvDC appliance missing NFS utilities
5. **NFS permissions** - NFS export needs proper permissions for QvDC to write
6. **Missing storage packages** - QvDC needs iSCSI, Ceph RBD, and networking tools

### Changes Made

#### Issue 1: ISO Upload to NFS

**Root Cause:** `imageUploadHandler.SetPoolRepository()` was added to the codebase but the update hasn't been deployed yet. The running QvDC still has the old code.

**Files with the fix:**
- `backend/internal/server/server.go` (line 551) - Calls `SetPoolRepository`
- `backend/internal/server/image_upload_handler.go` - Added debug logging for pool repo status

#### Issue 2: Path Display in UI

**Changed:** `frontend/src/pages/images/AllImagesPage.tsx`
- Added path display at bottom of each ISO card in monospace font

#### Issue 3: Background Upload Progress

**New files:**
- `frontend/src/components/storage/UploadProgressToast.tsx` - Floating progress indicator
- `frontend/src/lib/upload-store.ts` - Zustand store for tracking uploads

**Changed files:**
- `frontend/src/components/storage/ISOUploadDialog.tsx` - Closes immediately, starts background upload
- `frontend/src/pages/images/ImageLibraryLayout.tsx` - Shows upload progress toast
- `frontend/src/components/storage/index.ts` - Exports new components

#### Issue 4-6: Storage & Networking Packages

**Added to `Quantix-vDC/profiles/packages.conf`:**

**Networking enhancements:**
- `iproute2-tc` - Traffic control
- `bridge-utils` - Bridge management
- `ethtool` - Network interface diagnostics
- `tcpdump` - Network packet analyzer
- `bind-tools` - DNS utilities (dig, nslookup)

**Shared Storage Clients:**
- `nfs-utils`, `rpcbind` - NFS client support (FIXED mount issue)
- `open-iscsi` - iSCSI initiator for iSCSI storage pools
- `ceph-common`, `py3-ceph-common`, `librbd1` - Ceph RBD client
- `multipath-tools` - Redundant storage path management

**Disk/Storage Tools:**
- `lvm2` - Logical Volume Manager
- `xfsprogs` - XFS filesystem tools
- `btrfs-progs` - Btrfs filesystem tools
- `smartmontools` - Disk health monitoring
- `hdparm` - Hard disk parameter tuning
- `nvme-cli` - NVMe management

**VM Image Tools:**
- `qemu-img` - Image format conversion/inspection
- `libguestfs-tools` - Guest filesystem access

**System Utilities:**
- `strace` - System call tracing for debugging

### NFS Server Configuration Required

On your NFS server (192.168.0.251), the exports are now configured with:

```bash
/srv/nfs/qVDS01 192.168.0.0/24(rw,sync,no_subtree_check,all_squash,anonuid=5000,anongid=5000)
/srv/nfs/qVDS02 192.168.0.0/24(rw,sync,no_subtree_check,all_squash,anonuid=5000,anongid=5000)
```

With ownership set to `quantix:quantix` (UID/GID 5000).

### Deployment Required

```bash
./scripts/publish-vdc-update.sh --channel dev
```

Then on QvDC (if not using auto-update):
```bash
# Apply update or restart control plane
rc-service limiquantix-controlplane restart
```

---

## Previous Task: Fix Cloud Image Download to Storage Pools

**Status:** Complete

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
