# 000091 - Snapshots with host-passthrough CPU

**Feature**: Snapshot support for VMs using `host-passthrough` CPU mode.

**Status**: Implemented (disk-only snapshots only)  
**Date**: 2026-01-31

## Important Limitation

**Memory snapshots are NOT supported with `host-passthrough` CPU.**

This is a fundamental limitation of libvirt/QEMU, not Quantix. Memory snapshots require migration capability, but `invtsc` (invariant TSC) explicitly disables migration to ensure consistent timekeeping.

### Why VMware Can Do It

VMware vCenter uses proprietary checkpoint mechanisms that don't rely on migration. Unfortunately, there's no equivalent in the open-source libvirt/QEMU stack.

### Error Message

When attempting a memory snapshot with host-passthrough CPU:

```
Memory snapshots are not supported with host-passthrough CPU.
This VM uses the 'invtsc' CPU flag which prevents memory state capture.
This is a fundamental limitation of libvirt/QEMU (not Quantix).

Options:
1. Create a disk-only snapshot (uncheck 'Include memory state')
2. Stop the VM first, then take a snapshot
3. Reconfigure the VM to use 'host-model' CPU instead of 'host-passthrough'
```

## What Works

### Disk-Only Snapshots ✓

Disk-only snapshots work perfectly with any CPU configuration:

```bash
virsh snapshot-create-as $VM snapshot-name --disk-only
```

This captures the disk state at a point in time, allowing you to revert changes.

### Snapshots of Stopped VMs ✓

When a VM is stopped, you can take a full snapshot (which includes the disk state at shutdown):

```bash
virsh snapshot-create-as $VM snapshot-name
```

## What Doesn't Work

### Memory Snapshots with host-passthrough ✗

```bash
# This will FAIL with invtsc error:
virsh snapshot-create-as $VM snapshot-name --memspec file=/path/to/mem.img
```

The error occurs because libvirt's memory snapshot mechanism uses migration-like operations internally, and `invtsc` disables migration.

## Workarounds

### Option 1: Use Disk-Only Snapshots (Recommended)

Disk-only snapshots are fast and reliable. They capture the disk state, which is usually what you need for:
- Before software updates
- Before configuration changes
- Regular backup points

### Option 2: Stop the VM First

If you need to capture a consistent state:
1. Gracefully shut down the VM
2. Take a snapshot
3. Start the VM again

### Option 3: Change CPU Model

If you absolutely need memory snapshots, change the VM's CPU model:

```xml
<!-- Instead of: -->
<cpu mode='host-passthrough' check='none' migratable='off'>

<!-- Use: -->
<cpu mode='host-model' check='partial'>
```

**Trade-offs:**
- `host-model`: Slightly less performance, but supports migration and memory snapshots
- `host-passthrough`: Maximum performance, but no migration or memory snapshots

## Technical Background

### Why invtsc Prevents Migration

The `invtsc` (invariant TSC) CPU flag guarantees that the Time Stamp Counter runs at a constant rate. This is important for:
- High-precision timing applications
- Some database workloads
- Real-time applications

However, TSC frequency varies between physical CPUs. When migrating a VM, the TSC frequency would change, breaking applications that depend on it. Therefore, libvirt marks VMs with `invtsc` as non-migratable.

### Why Memory Snapshots Need Migration

Libvirt's memory snapshot mechanism:
1. Pauses the VM (or uses `--live` to minimize pause)
2. Saves CPU state, device state, and memory to a file
3. This uses the same code path as live migration

Since `invtsc` disables migration, it also disables memory snapshots.

### QEMU CPR (Future Possibility)

QEMU has an experimental "CheckPoint and Restart" (CPR) feature that might eventually support memory snapshots without migration. However:
- It's not exposed through libvirt yet
- It's still experimental
- No timeline for production readiness

## API Reference

### Create Snapshot

```
POST /api/v1/vms/:vm_id/snapshots
```

Request:
```json
{
  "name": "my-snapshot",
  "description": "Before upgrade",
  "includeMemory": false,  // Must be false for host-passthrough VMs
  "quiesce": false
}
```

### Error Response (if includeMemory=true)

```json
{
  "code": "internal",
  "message": "Memory snapshots are not supported with host-passthrough CPU..."
}
```

## Files Modified

- `agent/limiquantix-hypervisor/src/libvirt/backend.rs` - Returns clear error for memory snapshots
- `agent/limiquantix-hypervisor/src/types.rs` - Snapshot types
- `backend/internal/services/node/daemon_client.go` - Pass disk_only flag
- `backend/internal/services/vm/service.go` - Convert include_memory to disk_only
- `proto/limiquantix/node/v1/node_daemon.proto` - Added disk_only field

## Summary

| Snapshot Type | host-passthrough | host-model |
|---------------|------------------|------------|
| Disk-only | ✓ Works | ✓ Works |
| With memory | ✗ Not supported | ✓ Works |
| Stopped VM | ✓ Works | ✓ Works |

For most use cases, disk-only snapshots are sufficient. If you need memory snapshots, consider using `host-model` CPU mode instead.
