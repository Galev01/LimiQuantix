# Workflow State - NFS Pool Name & Type Fix

## Issues Fixed

### 1. Pool Type Showing as "Ceph RBD" Instead of "NFS"

**Root Cause:** The `backend.type` field from QvDC is sent as an integer (protobuf enum), but the node daemon was trying to match it as a string.

**Fix in `registration.rs`:**
- Added handling for both string and integer enum values
- Maps QvDC's `storage.proto` enum: `NFS=4`, `CEPH_RBD=0`, etc.

**Fix in `http_server.rs`:**
- Corrected `pool_type_to_string()` to match `node_daemon.proto` enum values

### 2. Pool Name Showing as UUID Instead of Friendly Name

**Root Cause:** The pool name from QvDC wasn't being passed through to the Host UI.

**Files Changed:**

1. **`limiquantix-hypervisor/src/storage/types.rs`**
   - Added `name: Option<String>` to `PoolConfig`
   - Added `name: Option<String>` to `PoolInfo`

2. **`limiquantix-hypervisor/src/storage/*.rs`** (nfs, local, ceph, iscsi)
   - Updated `init_pool()` to include `config.name` in `PoolInfo`
   - Updated `get_pool_info()` to set `name: None` (preserved via refresh)

3. **`limiquantix-hypervisor/src/storage/mod.rs`**
   - Updated `refresh_pool_info()` to preserve the name from the original init

4. **`limiquantix-node/src/registration.rs`**
   - Extract `pool_name` from QvDC response
   - Pass `name` in `PoolConfig` for all pool types

5. **`limiquantix-node/src/http_server.rs`**
   - Added `name` field to `StoragePoolResponse`
   - Updated `list_storage_pools()` to get pools directly from storage manager
   - Updated `get_storage_pool()` similarly

6. **`quantix-host-ui/src/api/types.ts`**
   - Added `name?: string` to `StoragePool` interface

7. **`quantix-host-ui/src/pages/StoragePools.tsx`**
   - Display `pool.name` if available, fallback to `pool.poolId`
   - Show UUID below the name in smaller text

## Deployment

```bash
./scripts/publish-update.sh
```

Then on QHCI01:
```bash
curl -k -X POST https://192.168.0.101:8443/api/v1/updates/apply
```

## Testing

After the update:
1. **Unassign** the NFS pools from QHCI01 in QvDC
2. **Re-assign** them to trigger fresh mount with correct type and name
3. Check QHCI01 Host UI → Storage → Pools
4. Verify:
   - Pools show as "NFS" not "Ceph RBD"
   - Pools show friendly names like "NFS01" instead of UUIDs
   - Mount paths are correct: `/var/lib/limiquantix/mnt/nfs-{poolId}`

## Previous Fixes

### VNC Console Port (v0.0.81)
- Fixed naive port parsing that returned wrong VM's port

### CD-ROM Boot Order (v0.0.80)
- Added processing of CD-ROMs from `spec.cdroms` array
- Boot order adjusted when bootable CD-ROM present
