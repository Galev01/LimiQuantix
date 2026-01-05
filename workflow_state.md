# Workflow State: Fix Cloud Image Boot Issue

## Problem

Ubuntu cloud image VMs fail to boot with "Boot failed: not a bootable disk".

## Root Causes Found and Fixed

### Issue 1: Empty disk ID (FIXED)
- Disk was being named `.qcow2` instead of `disk0.qcow2`
- Fixed by generating disk ID if empty in Rust node daemon

### Issue 2: Mock hypervisor (FIXED)
- Node daemon was using mock hypervisor instead of libvirt
- Fixed by building with `--features libvirt`

### Issue 3: camelCase vs snake_case JSON keys (FIXED)
- Frontend sends `backingFile` (camelCase)
- Go proto expects `backing_file` (snake_case in JSON tags)
- Fixed by adding `convertKeysToSnakeCase()` in api-client.ts

### Issue 4: Cloud image path always undefined (FIXED - LATEST)
- The `toCloudImage()` function was returning `path: undefined` for all images
- Original code: `path: img.status?.storagePoolId ? undefined : undefined`
- This meant `backingFile` was always empty!
- **Fixed by adding `constructCloudImagePath()` function** that builds the path from OS info

## Changes Made

### 1. `agent/limiquantix-node/src/service.rs`
- Generate disk ID if empty: `disk0`, `disk1`, etc.
- Added logging for disk processing

### 2. `frontend/src/lib/api-client.ts`
- Added `toSnakeCase()` and `convertKeysToSnakeCase()` functions
- Convert all request bodies from camelCase to snake_case before sending
- Added debug console.log for CreateVM requests

### 3. `frontend/src/hooks/useImages.ts` (NEW FIX)
- Added `constructCloudImagePath()` function to build path from OS info
- Path convention: `/var/lib/limiquantix/cloud-images/{distro}-{version}.qcow2`
- Now API images properly include the path needed for backing files

### 4. `backend/internal/services/vm/service.go`
- Added debug logging to see what disk specs are received

## Testing

1. **Fully restart the frontend** (Ctrl+C then npm run dev)
2. **Hard refresh browser** (Ctrl+Shift+R)
3. Create a new VM with Ubuntu 22.04 cloud image
4. Check browser console for `[API] CreateVM request body` - should show `backing_file` with path
5. Check node daemon logs for `backing_file=Some(...)` instead of `None`

## Status: FIXED - Testing Required ✅
