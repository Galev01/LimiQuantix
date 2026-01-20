# Workflow State

## Active Task: Volume Selection in VM Creation Wizard

**Date:** January 20, 2026
**Status:** ✅ Complete

### Overview

Implemented volume selection in VM creation wizards for both Quantix-vDC (frontend) and Quantix-OS Host UI (quantix-host-ui). This is a key differentiator from VMware's datastore model.

### Why Volumes Matter (vs VMware Datastores)

| Feature | VMware Datastore | Quantix Volumes |
|---------|------------------|-----------------|
| Granularity | Entire datastore | Individual volumes |
| Lifecycle | Tied to datastore | Independent |
| Snapshots | VM-level only | Volume-level |
| Migration | Whole VM | Per-volume |
| Sharing | Limited | Multi-attach capable |
| Cloning | VM clone only | Volume clone |
| Templates | OVF/OVA | Volume templates |

### Implementation Summary

#### Changes Made

**1. Host UI (quantix-host-ui)**
- Updated `DiskConfig` interface with `sourceType`, `existingVolumeId`, `existingVolumePath` fields
- Enhanced `StepStorage` component with:
  - Volume fetching via `useVolumes(poolId)` hook
  - Toggle between "Create New" and "Use Existing Volume" for each disk
  - Volume selection dropdown showing available (unattached) volumes
  - Visual indicators for existing volumes vs new disks
  - Info panel explaining volume benefits
- Updated `StepReview` to display volume information

**2. vDC Dashboard (frontend)**
- Same changes as Host UI
- Adapted for vDC API structure (`VolumeUI` type from `useStorage` hook)
- Added volume count badge to storage pool selection

### Files Modified

1. `quantix-host-ui/src/components/vm/CreateVMWizard.tsx`
   - Added `useVolumes` import
   - Extended `DiskConfig` interface
   - Rewrote `StepStorage` with volume selection
   - Updated `StepReview` storage section

2. `frontend/src/components/vm/VMCreationWizard.tsx`
   - Added `useVolumes`, `VolumeUI` imports
   - Extended `DiskConfig` interface
   - Rewrote `StepStorage` with volume selection
   - Updated `StepReview` storage section

### UI Features

- **Source Type Toggle**: Each disk can be "Create New" or "Use Existing Volume"
- **Volume List**: Shows available volumes in selected pool (filters out attached volumes)
- **Volume Selection**: Click to select, shows confirmation with size
- **Boot Disk Badge**: First disk marked as boot disk
- **Existing Volume Badge**: Visual indicator for volumes vs new disks
- **Summary**: Shows count of new disks vs existing volumes
- **Capacity Validation**: Only validates capacity for new disks
- **Info Panel**: Explains benefits of using existing volumes

### Next Steps (Optional Enhancements)

1. Backend verification that CreateVM API supports existing volume attachment
2. Add volume creation inline (create volume without leaving wizard)
3. Add volume cloning option (clone existing volume for new VM)
4. Add volume template support

---

## Current Task: QvDC API Issues Fix

**Date:** January 20, 2026
**Status:** ISO Rebuild in Progress - Fixes Applied, Awaiting Deployment

### Summary

Multiple issues discovered during VM creation testing. Code fixes applied, ISO being rebuilt.

### Issues Tracker

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | Cloud image not found on QHCI02 | ⏳ Pending | Run `setup-cloud-images.sh ubuntu-22.04` |
| 2 | `/api/customization-specs` 404 | ✅ Code Fixed | Backend needs rebuild/restart |
| 3 | `ListPoolFiles` 500 errors | ⏳ Needs investigation | Check backend logs |
| 4 | `/api/v1/images/upload` 502 | ⏳ Needs investigation | Check Nginx + backend |
| 5 | `DownloadImage` 404 | ⏳ Needs investigation | Check ImageService routes |
| 6 | Video model errors (virtio→qxl→vga) | ✅ Code Fixed | Changed to `vga` for max compatibility |
| 7 | `CreateVM` 500 | Same as #1 | Cloud image issue |

### Code Fixes Applied

1. **Video Model Fix** (`agent/limiquantix-hypervisor/src/xml.rs`):
   - Changed from `virtio-gpu-pci` → `qxl` → `vga`
   - `vga` is universally supported across all QEMU builds

2. **Customization Specs API** (Backend):
   - `backend/internal/repository/postgres/customization_spec_repository.go` - New
   - `backend/internal/server/customization_spec_handler.go` - New
   - `backend/internal/server/server.go` - Updated routes

3. **Build System** (`Quantix-OS/builder/build-node-daemon.sh`):
   - Enforces musl target for Alpine compatibility
   - `libvirt` feature now default in `agent/limiquantix-node/Cargo.toml`

### Critical Discovery: Binary Compatibility

**Problem:** Ubuntu-built binaries (glibc) don't run on Quantix-OS (Alpine/musl).

**Solution:** Always use Docker-based build or cross-compile with musl target:
```bash
# Option 1: Docker build (recommended)
cd Quantix-OS && ./build.sh --skip-pull

# Option 2: Manual cross-compile
rustup target add x86_64-unknown-linux-musl
cargo build --release -p limiquantix-node --target x86_64-unknown-linux-musl --features libvirt
```

### Next Steps After ISO Rebuild

1. Install new ISO on QHCI02
2. Rebuild and restart backend on QvDC for customization-specs fix
3. Test VM creation with new `vga` video model
4. Investigate remaining issues (#3, #4, #5)
