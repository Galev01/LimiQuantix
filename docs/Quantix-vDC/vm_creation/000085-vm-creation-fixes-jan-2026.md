# VM Creation & Troubleshooting Fixes - January 2026

**Document ID:** 000085  
**Date:** January 24, 2026  
**Scope:** Fixes for VM creation issues including Guest OS profiles, storage pool selection, and VM logs troubleshooting

---

## Overview

This document covers a series of interconnected fixes that resolved VM creation and operation issues, particularly for RHEL-based distributions like Rocky Linux. The fixes span multiple components:

1. **Guest OS Profiles** - VMware-style OS selection for optimal VM hardware configuration
2. **Storage Pool Selection** - Ensuring VMs are created on the correct storage pool
3. **VM Logs Feature** - UI access to QEMU logs for troubleshooting
4. **CIDR IP Fix** - Correcting malformed URLs in node communication

---

## 1. Guest OS Profiles (VMware-Style OS Selection)

### Problem

Rocky Linux 9/10 installations were failing mid-way with kernel panics or freezes. The root cause was a mismatch between the virtual hardware configuration and what modern RHEL-based distributions expect:

- **x86-64-v3 CPU requirement**: RHEL 9+ requires AVX, AVX2, BMI1/2, FMA instructions
- **HPET timer conflicts**: RHEL kernels are sensitive to timer configuration
- **Video driver issues**: Default `qxl` driver causes hangs during installation

### Solution

Implemented a **Guest OS Profile** system similar to VMware's Guest OS selection. When a user selects an OS type, the system automatically configures optimal virtual hardware.

### Files Changed

#### Rust (Hypervisor Agent)

| File | Changes |
|------|---------|
| `agent/limiquantix-hypervisor/src/guest_os.rs` | **NEW** - Defines `GuestOSFamily` enum and `GuestOSProfile` struct with OS-specific configurations |
| `agent/limiquantix-hypervisor/src/types.rs` | Added `guest_os: GuestOSFamily` field to `VmConfig` |
| `agent/limiquantix-hypervisor/src/xml.rs` | Modified XML generation to apply OS profile settings (CPU mode, timers, video) |
| `agent/limiquantix-hypervisor/src/lib.rs` | Added `pub mod guest_os;` |

#### Protobuf Definitions

| File | Changes |
|------|---------|
| `proto/limiquantix/compute/v1/vm.proto` | Added `GuestOSProfile guest_os = 23;` to `VmSpec` and `GuestOSFamily` enum |
| `agent/limiquantix-proto/proto/node_daemon.proto` | Added `string guest_os = 13;` to `VMSpec` |

#### Go (Control Plane)

| File | Changes |
|------|---------|
| `backend/internal/domain/vm.go` | Added `GuestOS GuestOSFamily` to `VMSpec` |
| `backend/internal/services/vm/converter.go` | Added mapping between proto and domain `GuestOS` field |
| `backend/internal/services/vm/service.go` | Added `guest_os` to Node Daemon request conversion |

#### Node Daemon (Rust)

| File | Changes |
|------|---------|
| `agent/limiquantix-node/src/http_server.rs` | Added `guest_os: Option<String>` to `CreateVmRequest` |
| `agent/limiquantix-node/src/service.rs` | Map `guest_os` string to `GuestOSFamily` enum and apply to `VmConfig` |

#### Frontend (React/TypeScript)

| File | Changes |
|------|---------|
| `frontend/src/components/vm/VMCreationWizard.tsx` | Added Guest OS dropdown in Boot Media step with auto-detection |
| `frontend/src/lib/api-client.ts` | Added `guestOs` field to `ApiVM.spec` interface |
| `quantix-host-ui/src/components/vm/CreateVMWizard.tsx` | Added Guest OS dropdown with auto-detection |
| `quantix-host-ui/src/api/types.ts` | Added `GuestOSFamily` type and `guestOS` to `CreateVmRequest` |

### Guest OS Families

| Family | CPU Mode | HPET | Video | Use Case |
|--------|----------|------|-------|----------|
| `RHEL` | host-passthrough | Disabled | VGA | Rocky, AlmaLinux, CentOS, RHEL |
| `DEBIAN` | host-model | Enabled | VirtIO | Debian, Ubuntu |
| `FEDORA` | host-passthrough | Disabled | VirtIO | Fedora |
| `WINDOWS_SERVER` | host-model | Enabled | QXL + Hyper-V | Windows Server |
| `WINDOWS_DESKTOP` | host-model | Enabled | QXL + Hyper-V | Windows 10/11 |
| `GENERIC_LINUX` | host-model | Enabled | VirtIO | Other Linux |

### Libvirt XML Changes for RHEL

```xml
<!-- CPU: Pass through host CPU features for x86-64-v3 support -->
<cpu mode='host-passthrough' check='none' migratable='off'>
  <topology sockets='1' dies='1' clusters='1' cores='2' threads='1'/>
</cpu>

<!-- Clock: Disable HPET which causes issues with RHEL kernels -->
<clock offset='utc'>
  <timer name='rtc' tickpolicy='catchup'/>
  <timer name='pit' tickpolicy='delay'/>
  <timer name='hpet' present='no'/>
  <timer name='kvmclock' present='yes'/>
</clock>

<!-- Video: Use VGA instead of QXL/VirtIO for installer compatibility -->
<video>
  <model type='vga' vram='16384' heads='1' primary='yes'/>
</video>
```

---

## 2. Storage Pool Selection Fix

### Problem

VMs were being created on the host's root overlay filesystem (`/var/lib/limiquantix/vms/`) instead of the user-selected storage pool (e.g., NFS datastore). This caused:

- "No space left on device" errors when the overlay filled up
- VMs not using the intended storage backend
- Storage pool selection in the UI being ignored

### Root Cause

The `pool_id` field was not being passed through the entire stack:
1. Frontend sent `storagePoolId` but it wasn't mapped to the disk spec
2. Node Daemon proto didn't have a `pool_id` field in `DiskSpec`
3. Node Daemon disk creation logic hardcoded the path

### Solution

Added `pool_id` field throughout the stack and updated disk creation to use the pool's mount path.

### Files Changed

#### Protobuf

| File | Changes |
|------|---------|
| `agent/limiquantix-proto/proto/node_daemon.proto` | Added `string pool_id = 11;` to `DiskSpec` |
| `proto/limiquantix/node/v1/node_daemon.proto` | Added `string pool_id = 11;` to `DiskSpec` |

#### Node Daemon (Rust)

| File | Changes |
|------|---------|
| `agent/limiquantix-node/src/http_server.rs` | Added `pool_id: Option<String>` to `DiskSpecRequest` |
| `agent/limiquantix-node/src/service.rs` | Updated disk creation to use pool's mount path instead of hardcoded path |

#### Go (Control Plane)

| File | Changes |
|------|---------|
| `backend/internal/services/vm/service.go` | Added `PoolId: disk.GetStoragePoolId()` to Node Daemon request |

#### Frontend

| File | Changes |
|------|---------|
| `frontend/src/components/vm/VMCreationWizard.tsx` | Added `storagePoolId` to disk spec in API call |
| `quantix-host-ui/src/components/vm/CreateVMWizard.tsx` | Added `poolId` to disk spec |
| `quantix-host-ui/src/api/types.ts` | Added `poolId?: string` to `DiskSpec` |

### Disk Path Resolution

```rust
// Before (hardcoded):
let vm_dir = PathBuf::from("/var/lib/limiquantix/vms").join(&vm_uuid);

// After (pool-aware):
let base_path = if !disk_spec.pool_id.is_empty() {
    // Look up pool mount path from storage manager
    // e.g., /var/lib/limiquantix/pools/{pool_id}
    storage_manager.get_pool_path(&disk_spec.pool_id)?
} else {
    // Fallback to default data partition
    PathBuf::from("/data/limiquantix/vms")
};
let vm_dir = base_path.join("vms").join(&vm_uuid);
```

### Storage Pool Filtering (QvDC UI)

Added smart filtering in the VM creation wizard to only show accessible pools based on host selection:

```typescript
const isPoolAccessibleFromHost = (pool: StoragePoolUI, hostId: string | undefined): boolean => {
  // No host selected = all pools accessible (auto-placement)
  if (!hostId) return true;

  // Network storage (NFS, Ceph, iSCSI) accessible from any host
  const networkStorageTypes = ['NFS', 'CEPH_RBD', 'ISCSI'];
  if (networkStorageTypes.includes(pool.type)) return true;

  // Local storage requires host assignment
  return pool.assignedNodeIds.includes(hostId);
};
```

---

## 3. VM Logs Feature

### Problem

When VMs fail to start or crash, troubleshooting required SSH access to the hypervisor host to view QEMU logs. This made debugging difficult, especially for issues like:

- Disk I/O errors ("No space left on device")
- CPU/memory configuration problems
- Boot failures

### Solution

Added a "Logs" tab to the VM detail page that displays QEMU logs from `/var/log/libvirt/qemu/{vm_name}.log`.

### Files Changed

#### Node Daemon (Rust)

| File | Changes |
|------|---------|
| `agent/limiquantix-node/src/http_server.rs` | Added `GET /api/v1/vms/:vm_id/logs` endpoint |
| `agent/limiquantix-node/src/service.rs` | Added `get_vm_logs` gRPC handler |
| `agent/limiquantix-proto/proto/node_daemon.proto` | Added `GetVMLogs` RPC and request/response messages |

#### Go (Control Plane)

| File | Changes |
|------|---------|
| `backend/internal/server/vm_rest.go` | Added `GET /api/vms/{id}/logs` proxy endpoint |
| `backend/internal/server/server.go` | Added `getInsecureHTTPClient()` helper for node communication |

#### Frontend

| File | Changes |
|------|---------|
| `frontend/src/components/vm/VMLogsPanel.tsx` | **NEW** - Log viewer component with error highlighting |
| `frontend/src/pages/VMDetail.tsx` | Added "Logs" tab |
| `quantix-host-ui/src/components/vm/VMLogsPanel.tsx` | **NEW** - Same component for QHCI |
| `quantix-host-ui/src/pages/VMDetail.tsx` | Added "Logs" tab |

### API Response

```json
{
  "vmId": "d1f4c124-9735-488f-af1a-a06c3136494f",
  "vmName": "Test-ISO-Rocky",
  "qemuLog": "...(last N lines)...",
  "logPath": "/var/log/libvirt/qemu/Test-ISO-Rocky.log",
  "logSizeBytes": 12345,
  "linesReturned": 100,
  "truncated": false,
  "lastModified": "2026-01-24T21:46:10Z"
}
```

### UI Features

- **Line count selector**: 50, 100, 200, 500, 1000 lines
- **Auto-refresh**: Toggle 5-second refresh for live monitoring
- **Error highlighting**: Red for errors, yellow for warnings
- **Copy/Download**: Export logs for sharing
- **Common issues guide**: Help text for interpreting errors

---

## 4. CIDR IP Address Fix

### Problem

The VM logs feature returned a 502 error:
```
Failed to reach node: Get "https://192.168.0.101/32:8443/api/v1/vms/.../logs": 
dial tcp 192.168.0.101:443: connect: connection refused
```

The URL was malformed because `node.ManagementIP` contained CIDR notation (`192.168.0.101/32`).

### Solution

Strip CIDR suffix before using IP in URLs:

```go
// Strip CIDR notation from IP if present (e.g., "192.168.0.101/32" -> "192.168.0.101")
nodeIP := node.ManagementIP
if idx := strings.Index(nodeIP, "/"); idx != -1 {
    nodeIP = nodeIP[:idx]
}
```

### Files Changed

| File | Changes |
|------|---------|
| `backend/internal/server/vm_rest.go` | Strip CIDR from IP in `handleGetLogs` |
| `backend/internal/server/console.go` | Strip CIDR from IP in daemon connection |

---

## Deployment

### Build Commands

```bash
# Backend (Go)
cd backend && go build ./...

# Node Daemon (Rust - on Linux)
cd agent/limiquantix-node && cargo build --release

# Frontend (QvDC)
cd frontend && npm run build

# Host UI (QHCI)
cd quantix-host-ui && npm run build

# Regenerate Protobuf
cd proto && buf generate
```

### Restart Services

```bash
# QvDC Control Plane
rc-service quantix-controlplane restart

# QHCI Node Daemon
rc-service qx-node restart
```

### Or Use Update Script

```bash
./scripts/publish-update.sh
```

---

## Testing Checklist

### Guest OS Profiles

- [ ] Create VM with Rocky Linux ISO, select "RHEL/CentOS" profile
- [ ] Verify XML has `host-passthrough` CPU mode
- [ ] Verify XML has `hpet present='no'`
- [ ] Verify XML has `vga` video driver
- [ ] Complete Rocky Linux installation without freeze

### Storage Pool Selection

- [ ] Create VM and select NFS datastore for disk
- [ ] Verify disk is created in `/var/lib/limiquantix/pools/{pool_id}/vms/`
- [ ] Verify disk is NOT in `/var/lib/limiquantix/vms/` (overlay)
- [ ] Test with local storage pool assigned to specific host

### VM Logs

- [ ] Navigate to VM detail page → Logs tab
- [ ] Verify logs load without errors
- [ ] Test auto-refresh toggle
- [ ] Test copy and download buttons
- [ ] Verify error lines are highlighted in red

---

## Related Issues

- Rocky Linux installation freeze at `libicu` package
- "No space left on device" errors during VM creation
- Storage pool selection being ignored
- 502 errors when fetching VM logs

---

## References

- [Proxmox Forum: Kernel panic on install Rocky Linux](https://forum.proxmox.com/threads/solved-kernel-panic-on-install-rocky-linux.119841/)
- [Red Hat: x86-64-v2 baseline requirement](https://access.redhat.com/solutions/6969351)
- VMware Guest OS Profiles documentation
