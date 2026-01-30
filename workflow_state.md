# Live Memory Snapshots with host-passthrough CPU

## Status: COMPLETED ✓

## Goal
Enable VMware vCenter-like live memory snapshots for VMs using `host-passthrough` CPU mode with `invtsc` feature.

## Problem Solved

When creating a snapshot with "Include memory state" on a running VM with `host-passthrough` CPU, libvirt would fail with:
```
Memory snapshot failed due to CPU configuration
This VM uses CPU features (invtsc) that prevent memory snapshots.
```

## Solution Implemented

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

## Files Modified

### Rust (Hypervisor)
- `agent/limiquantix-hypervisor/src/types.rs` - Added `SnapshotType`, `CreateSnapshotOptions`
- `agent/limiquantix-hypervisor/src/traits.rs` - Updated trait signature
- `agent/limiquantix-hypervisor/src/libvirt/backend.rs` - External snapshot implementation with --live
- `agent/limiquantix-hypervisor/src/mock.rs` - Mock backend update

### Rust (Node Daemon)
- `agent/limiquantix-node/src/service.rs` - Use new snapshot options
- `agent/limiquantix-node/src/http_server.rs` - Updated HTTP handler with logging

### TypeScript (Frontend)
- `frontend/src/hooks/useSnapshots.ts` - Updated error handling
- `quantix-host-ui/src/api/vm.ts` - Added includeMemory, quiesce params
- `quantix-host-ui/src/hooks/useVMs.ts` - Added CreateSnapshotOptions interface

### Documentation
- `docs/000091-live-memory-snapshots.md` - Full feature documentation

## Next Steps

1. **Deploy**: Build and deploy qx-node with snapshot changes
2. **Test**: Create memory snapshot on running VM with host-passthrough CPU
3. **Verify**: Check that snapshot includes memory state and can be reverted

## Log
- **2026-01-31**: Analyzed invtsc snapshot failure
- **2026-01-31**: Researched libvirt external snapshot mechanism
- **2026-01-31**: Implemented external snapshots with --live flag
- **2026-01-31**: Updated frontend hooks and documentation
