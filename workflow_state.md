# Workflow State - VM Snapshot Fix

## Feature: Fix Snapshot Creation with invtsc CPU Flag

Fixed the VM snapshot creation to support disk-only snapshots when the VM has the `invtsc` (invariant TSC) CPU flag enabled, which prevents memory state migration.

### Problem Solved

When trying to create a snapshot of a running VM with `invtsc` CPU flag or `host-passthrough` CPU model, the operation would fail with:
```
cannot migrate domain: State blocked by non-migratable CPU device (invtsc flag)
```

This happened because the snapshot was trying to save the memory state, which requires the CPU state to be migratable.

### Solution

Added `disk_only` parameter throughout the snapshot creation chain:
- When `includeMemory` checkbox is unchecked (default), use `--disk-only` flag
- This allows snapshots of VMs with any CPU configuration
- Memory snapshots (`includeMemory=true`) still work for VMs without invtsc

### Implementation

#### 1. Proto Definition (`agent/limiquantix-proto/proto/node_daemon.proto`)
- Added `disk_only` field (field 5) to `CreateSnapshotRequest` message

#### 2. Hypervisor Trait (`agent/limiquantix-hypervisor/src/traits.rs`)
- Updated `create_snapshot()` signature to accept `disk_only: bool` parameter

#### 3. Libvirt Backend (`agent/limiquantix-hypervisor/src/libvirt/backend.rs`)
- Updated implementation to pass `--disk-only` flag to virsh when `disk_only=true`

#### 4. Mock Backend (`agent/limiquantix-hypervisor/src/mock.rs`)
- Updated implementation to accept `disk_only` parameter
- Updated test to pass `disk_only: false`

#### 5. Node Service (`agent/limiquantix-node/src/service.rs`)
- Updated `create_snapshot()` to pass `req.disk_only` to hypervisor

#### 6. HTTP Server (`agent/limiquantix-node/src/http_server.rs`)
- Added `include_memory` field to `CreateSnapshotRequest` struct
- Logic: `disk_only = !include_memory.unwrap_or(false)`
- Default: disk-only (safer, works with all CPU configs)

### Files Changed

```
agent/limiquantix-proto/proto/node_daemon.proto (MODIFIED)
agent/limiquantix-hypervisor/src/traits.rs (MODIFIED)
agent/limiquantix-hypervisor/src/libvirt/backend.rs (MODIFIED)
agent/limiquantix-hypervisor/src/mock.rs (MODIFIED)
agent/limiquantix-node/src/service.rs (MODIFIED)
agent/limiquantix-node/src/http_server.rs (MODIFIED)
```

### Usage

From the UI:
1. Go to VM detail page → Snapshots tab
2. Click "Create Snapshot"
3. Leave "Include memory state" **unchecked** (default) for disk-only snapshot
4. Check "Include memory state" only if you need memory state AND the VM doesn't have invtsc/host-passthrough CPU

From API:
```bash
# Disk-only snapshot (works with any CPU config)
curl -X POST "http://host:8443/api/v1/vms/{vm_id}/snapshots" \
  -H "Content-Type: application/json" \
  -d '{"name": "snap1", "includeMemory": false}'

# Memory snapshot (requires migratable CPU)
curl -X POST "http://host:8443/api/v1/vms/{vm_id}/snapshots" \
  -H "Content-Type: application/json" \
  -d '{"name": "snap1", "includeMemory": true}'
```

### Rebuild Instructions

After these changes, rebuild the agent:
```bash
cd agent
cargo build --release -p limiquantix-node
```

Deploy to hosts:
```bash
scp target/release/qx-node root@192.168.0.101:/usr/local/bin/
ssh root@192.168.0.101 "rc-service qx-node restart"
```

---

## Previous Workflow States

(Moved to completed_workflow.md)
