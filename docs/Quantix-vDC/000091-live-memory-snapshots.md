# 000091 - Live Memory Snapshots with host-passthrough CPU

**Feature**: VMware vCenter-like live memory snapshots for VMs using `host-passthrough` CPU mode.

**Status**: Implemented  
**Date**: 2026-01-31

## Overview

This document describes the implementation of live memory snapshots for VMs using `host-passthrough` CPU mode with the `invtsc` (invariant TSC) feature. Previously, these VMs could only take disk-only snapshots because the `migratable='off'` attribute prevented memory state capture.

## Problem

When creating a snapshot with "Include memory state" on a running VM with `host-passthrough` CPU, libvirt would fail with:

```
Memory snapshot failed due to CPU configuration
This VM uses CPU features (invtsc) that prevent memory snapshots.
```

### Root Cause

The VM XML configuration uses:
```xml
<cpu mode='host-passthrough' check='none' migratable='off'>
```

The `migratable='off'` attribute combined with `invtsc` CPU feature prevents:
1. Live migration
2. Memory state snapshots (which internally use migration-like mechanisms)

## Solution

We implemented **external snapshots with the `--live` flag**, which is the same mechanism VMware vCenter uses for live snapshots.

### How It Works

When `include_memory=true` is requested for a running VM:

1. **External snapshot mode** is automatically selected
2. **Disk overlay files** (qcow2) are created for each disk
3. **Memory state** is saved to a separate file
4. **`--live` flag** keeps the VM running during memory capture

```bash
# What happens under the hood:
virsh snapshot-create-as $VM snapshot-name \
  --diskspec vda,snapshot=external,file=/var/lib/libvirt/snapshots/$VM/snapshot-name-vda.qcow2 \
  --memspec file=/var/lib/libvirt/snapshots/$VM/snapshot-name.mem,snapshot=external \
  --live
```

### Snapshot Types

| Type | When Used | Memory | VM State | CPU Compatibility |
|------|-----------|--------|----------|-------------------|
| **Internal (disk-only)** | `include_memory=false` | No | Paused | Any |
| **External with memory** | `include_memory=true` + running | Yes | Running | Any (including host-passthrough) |

### Storage Locations

- **Memory files**: `/var/lib/libvirt/snapshots/{vm_id}/{snapshot_name}.mem`
- **Disk overlays**: `/var/lib/libvirt/snapshots/{vm_id}/{snapshot_name}-{disk}.qcow2`

## API Changes

### HTTP API (Node Daemon)

```
POST /api/v1/vms/:vm_id/snapshots
```

Request body:
```json
{
  "name": "my-snapshot",
  "description": "Before upgrade",
  "includeMemory": true,
  "quiesce": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Snapshot name |
| `description` | string | "" | Optional description |
| `includeMemory` | boolean | false | Include memory state (uses external snapshot) |
| `quiesce` | boolean | false | Freeze filesystems before snapshot (requires guest agent) |

### gRPC API (Proto)

```protobuf
message CreateSnapshotRequest {
  string vm_id = 1;
  string name = 2;
  string description = 3;
  bool quiesce = 4;
  bool disk_only = 5;  // Inverse of include_memory
}
```

### Hypervisor Trait

```rust
pub struct CreateSnapshotOptions {
    pub name: String,
    pub description: String,
    pub include_memory: bool,
    pub live: bool,
    pub quiesce: bool,
}

async fn create_snapshot(
    &self, 
    vm_id: &str, 
    options: &CreateSnapshotOptions,
) -> Result<SnapshotInfo>;
```

### SnapshotInfo Response

```rust
pub struct SnapshotInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
    pub vm_state: VmState,
    pub parent_id: Option<String>,
    pub snapshot_type: SnapshotType,      // Internal or External
    pub memory_included: bool,
    pub memory_file: Option<String>,       // Path to .mem file
    pub memory_size_bytes: Option<u64>,
}
```

## Usage Examples

### QvDC Dashboard

1. Navigate to VM Details
2. Click "Snapshots" tab
3. Click "Create Snapshot"
4. Check "Include memory state" checkbox
5. Click "Create"

### QHCI Host UI

Same workflow as QvDC Dashboard.

### CLI (virsh)

```bash
# Disk-only snapshot (fast, any CPU)
virsh snapshot-create-as vm-123 snap1 --disk-only

# Memory snapshot with live capture (works with host-passthrough)
virsh snapshot-create-as vm-123 snap1 \
  --diskspec vda,snapshot=external \
  --memspec file=/var/lib/libvirt/snapshots/vm-123/snap1.mem,snapshot=external \
  --live
```

### REST API

```bash
# Disk-only snapshot
curl -X POST https://host:8443/api/v1/vms/vm-123/snapshots \
  -H "Content-Type: application/json" \
  -d '{"name": "snap1"}'

# Memory snapshot
curl -X POST https://host:8443/api/v1/vms/vm-123/snapshots \
  -H "Content-Type: application/json" \
  -d '{"name": "snap1", "includeMemory": true}'
```

## Reverting Snapshots

### External Snapshots

For external snapshots with memory, the VM must typically be stopped before reverting:

```bash
virsh snapshot-revert vm-123 snap1 --running
```

The `--running` flag starts the VM after revert, restoring it to the exact state when the snapshot was taken (including memory).

### Internal Snapshots

Internal (disk-only) snapshots can be reverted while the VM is running, but this will reset the VM to the snapshot state.

## Deleting External Snapshots

External snapshots require merging the overlay back into the base image. The implementation handles this automatically:

1. **Detect external snapshot** by checking for memory file at `/var/lib/libvirt/snapshots/{vm_id}/{snapshot_name}.mem`
2. **Merge disk overlays** using `virsh blockcommit` for each disk
3. **Delete memory file** from the snapshot directory
4. **Delete snapshot metadata** using `virsh snapshot-delete --metadata`
5. **Clean up empty directories**

### Manual Commands (if needed)

```bash
# Merge overlay into base (blockcommit)
virsh blockcommit vm-123 vda --active --pivot --wait

# Delete memory file
rm /var/lib/libvirt/snapshots/vm-123/snap1.mem

# Delete overlay file (after merge)
rm /var/lib/libvirt/snapshots/vm-123/snap1-vda.qcow2

# Delete snapshot metadata
virsh snapshot-delete vm-123 snap1 --metadata
```

## Snapshot Storage Architecture

### Where Snapshots Are Stored

| Location | What's Stored | Purpose |
|----------|---------------|---------|
| **QvDC PostgreSQL** (`vm_snapshots` table) | Metadata only (name, description, state, timestamps) | Centralized management, UI display |
| **QHCI Hypervisor** (libvirt) | Actual snapshot data | Disk state, memory state |

### Storage Paths on QHCI

| Snapshot Type | Storage Location |
|---------------|------------------|
| **Internal (disk-only)** | Inside the qcow2 disk image (managed by libvirt) |
| **External memory file** | `/var/lib/libvirt/snapshots/{vm_id}/{snapshot_name}.mem` |
| **External disk overlays** | `/var/lib/libvirt/snapshots/{vm_id}/{snapshot_name}-{disk}.qcow2` |

### Deletion Flow

```
User clicks "Delete" in QvDC Dashboard
         │
         ▼
QvDC Backend calls Node Daemon (QHCI) via gRPC
         │
         ▼
QHCI detects snapshot type (internal vs external)
         │
         ├─► Internal: virsh snapshot-delete
         │
         └─► External:
             1. virsh blockcommit (merge overlays)
             2. Delete .mem file
             3. Delete overlay .qcow2 files
             4. virsh snapshot-delete --metadata
         │
         ▼
QvDC deletes row from vm_snapshots table
```

Both ends are cleaned up automatically.

## Performance Considerations

| Aspect | Internal Snapshot | External with Memory |
|--------|-------------------|---------------------|
| **Creation time** | Fast | Depends on memory size |
| **Storage overhead** | Low | Higher (memory file + overlays) |
| **VM impact** | Brief pause | Minimal (--live) |
| **Revert time** | Fast | Slower (memory restore) |

### Memory File Sizes

Memory files are approximately the size of the VM's RAM:
- 4 GB RAM VM → ~4 GB memory file
- 16 GB RAM VM → ~16 GB memory file

## Troubleshooting

### "Quiesce failed - guest agent not running"

The guest agent must be installed and running for filesystem quiescing:
- Linux: `systemctl status limiquantix-guest-agent`
- Windows: Check Services for "Quantix Guest Agent"

### "Snapshot directory creation failed"

Ensure the libvirt user has write access to `/var/lib/libvirt/snapshots/`.

### "External snapshot revert failed"

External snapshots may require the VM to be stopped first:
```bash
virsh destroy vm-123
virsh snapshot-revert vm-123 snap1 --running
```

## Files Modified

### Rust (Hypervisor)
- `agent/limiquantix-hypervisor/src/types.rs` - Added `SnapshotType`, `CreateSnapshotOptions`
- `agent/limiquantix-hypervisor/src/traits.rs` - Updated trait signature
- `agent/limiquantix-hypervisor/src/libvirt/backend.rs` - External snapshot implementation
- `agent/limiquantix-hypervisor/src/mock.rs` - Mock backend update

### Rust (Node Daemon)
- `agent/limiquantix-node/src/service.rs` - Use new snapshot options
- `agent/limiquantix-node/src/http_server.rs` - Updated HTTP handler

## References

- [libvirt Snapshots Documentation](https://libvirt.org/kbase/snapshots.html)
- [libvirt Snapshot XML Format](https://libvirt.org/formatsnapshot.html)
- [QEMU/KVM CPU Models](https://www.qemu.org/docs/master/system/qemu-cpu-models.html)
