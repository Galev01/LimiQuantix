# Workflow State - NFS Pool Type Fix

## Current Issue

**Problem:** NFS pools assigned from QvDC appear as "Ceph RBD" on QHCI hosts with wrong mount path.

**Root Cause:** Two issues:

1. **Protobuf enum mismatch**: The `backend.type` field from QvDC is sent as an integer (e.g., `4` for NFS), but the node daemon was trying to match it as a string.

2. **Different proto definitions**: 
   - `storage.proto` (QvDC): `CEPH_RBD=0, NFS=4, ISCSI=5`
   - `node_daemon.proto` (node): `LOCAL_DIR=1, NFS=3, CEPH_RBD=4, ISCSI=6`

## Fixes Applied

### 1. registration.rs - Parse integer enum values

**File:** `agent/limiquantix-node/src/registration.rs`

Added handling for both string and integer enum values from QvDC's `storage.proto`:

```rust
// Proto enum from storage.proto: CEPH_RBD=0, CEPH_CEPHFS=1, LOCAL_LVM=2, LOCAL_DIR=3, NFS=4, ISCSI=5
let backend_type: &str = match backend_type_value {
    Some(serde_json::Value::String(s)) => s.as_str(),
    Some(serde_json::Value::Number(n)) => {
        match n.as_u64() {
            Some(0) => "CEPH_RBD",
            Some(1) => "CEPH_CEPHFS",
            Some(2) => "LOCAL_LVM",
            Some(3) => "LOCAL_DIR",
            Some(4) => "NFS",
            Some(5) => "ISCSI",
            _ => "LOCAL_DIR",
        }
    }
    _ => "LOCAL_DIR",
};
```

### 2. http_server.rs - Fix pool_type_to_string

**File:** `agent/limiquantix-node/src/http_server.rs`

Fixed the `pool_type_to_string` function to match `node_daemon.proto`:

```rust
fn pool_type_to_string(pool_type: i32) -> String {
    // Matches node_daemon.proto StoragePoolType enum
    match pool_type {
        0 => "UNSPECIFIED".to_string(),
        1 => "LOCAL_DIR".to_string(),
        2 => "LOCAL_LVM".to_string(),
        3 => "NFS".to_string(),
        4 => "CEPH_RBD".to_string(),
        5 => "CEPH_FS".to_string(),
        6 => "ISCSI".to_string(),
        _ => "UNKNOWN".to_string(),
    }
}
```

## Deployment

```bash
./scripts/publish-update.sh
```

Then apply on QHCI01:
```bash
curl -k -X POST https://192.168.0.101:8443/api/v1/updates/apply
```

## Testing

1. Unassign the NFS pool from QHCI01 in QvDC
2. Re-assign the NFS pool to QHCI01
3. Check QHCI01 Host UI → Storage → Pools
4. Verify pool shows as "NFS" with mount path `/var/lib/limiquantix/mnt/nfs-{poolId}`

## Previous Fixes

### VNC Console Port (v0.0.81)
- Fixed naive port parsing that returned wrong VM's port

### CD-ROM Boot Order (v0.0.80)
- Added processing of CD-ROMs from `spec.cdroms` array
- Boot order adjusted when bootable CD-ROM present
