# CPU Mode User Selection Implementation

## Status: COMPLETED ✓

## Summary

Added CPU configuration selector to the VM creation wizard that lets users choose between performance-optimized and flexibility-optimized CPU modes, using user-friendly names.

## User-Facing Names

| Internal Name        | User-Friendly Name       | Description                                      |
| -------------------- | ------------------------ | ------------------------------------------------ |
| `host-passthrough`   | **Quantix Performance**  | Maximum performance, single-host workloads       |
| `host-model`         | **Quantix Flexible**     | Cluster-ready, supports migration and snapshots  |

## Changes Made

### 1. Proto (Node Daemon)
- `proto/limiquantix/node/v1/node_daemon.proto`:
  - Added `cpu_mode` field (field 14) to `VMSpec` message
  - Supports "host-model" (default) and "host-passthrough"

### 2. QvDC Backend (Go)
- `backend/internal/services/vm/service.go`:
  - Updated `convertToNodeDaemonCreateRequest()` to pass CPU mode from spec

### 3. qx-node (Rust)
- `agent/limiquantix-node/src/service.rs`:
  - Added CPU mode handling in `create_vm()`
  - Defaults to "host-model" for cluster compatibility

### 4. Hypervisor (Rust)
- `agent/limiquantix-hypervisor/src/xml.rs`:
  - Changed default CPU mode from "host-passthrough" to "host-model"

- `agent/limiquantix-hypervisor/src/libvirt/backend.rs`:
  - Added `parse_cpu_mode_from_xml()` function to detect VM's CPU mode
  - Updated snapshot logic to allow memory snapshots for "host-model"
  - Memory snapshots still blocked for "host-passthrough" (limitation)

- `agent/limiquantix-hypervisor/src/guest_os.rs`:
  - Changed all Guest OS profile defaults to "host-model"
  - Updated tests to expect "host-model"

### 5. Frontend (React/TypeScript)
- `frontend/src/components/vm/VMCreationWizard.tsx`:
  - Added `CpuMode` type
  - Added `cpuMode` to `VMCreationData` interface
  - Set default to 'host-model' (Quantix Flexible)
  - Added CPU mode selector UI with two cards in Hardware step
  - Updated API submission to include `model` in cpu spec
  - Added CPU mode to Review section

## UI Design

The selector appears in the Hardware step with two selectable cards:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CPU Configuration                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐    │
│  │ ○ Quantix Flexible          │  │ ○ Quantix Performance        │    │
│  │   (Recommended)             │  │                              │    │
│  │                             │  │                              │    │
│  │   ✓ Live migration          │  │   ✓ Maximum CPU performance  │    │
│  │   ✓ Memory snapshots        │  │   ✓ All CPU features exposed │    │
│  │   ✓ HA failover             │  │   ✓ Nested virtualization    │    │
│  │   ✓ Cluster-ready           │  │                              │    │
│  │                             │  │   ✗ No live migration        │    │
│  │   Best for: Production      │  │   ✗ No memory snapshots      │    │
│  │   clusters, general use     │  │   ✗ Single-host only         │    │
│  │                             │  │                              │    │
│  │                             │  │   Best for: HPC, AI/ML,      │    │
│  │                             │  │   nested virtualization      │    │
│  └──────────────────────────────┘  └──────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Files Modified

| File                                                   | Change                                 |
| ------------------------------------------------------ | -------------------------------------- |
| `proto/limiquantix/node/v1/node_daemon.proto`          | Add `cpu_mode` field                   |
| `backend/internal/services/vm/service.go`              | Pass `cpu_mode` to node                |
| `agent/limiquantix-node/src/service.rs`                | Apply `cpu_mode` from spec             |
| `agent/limiquantix-hypervisor/src/xml.rs`              | Change default to `host-model`         |
| `agent/limiquantix-hypervisor/src/libvirt/backend.rs`  | Allow memory snapshots for host-model  |
| `agent/limiquantix-hypervisor/src/guest_os.rs`         | Update profile defaults                |
| `frontend/src/components/vm/VMCreationWizard.tsx`      | Add CPU mode selector UI               |

## Deployment

After changes:

1. Run `make proto` to regenerate proto code
2. Rebuild and deploy QvDC backend
3. Rebuild and deploy qx-node (via `./scripts/publish-update.sh`)
4. Rebuild frontend

Existing VMs are unaffected - they keep their current CPU mode.

## Build Status
- [ ] Proto regeneration pending
- [ ] Go Backend: Needs rebuild
- [ ] Rust Agent: Needs rebuild  
- [ ] Frontend: Needs rebuild
