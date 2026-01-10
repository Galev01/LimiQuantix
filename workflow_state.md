# Workflow State

## Current Status: COMPLETED - Host-Centric Architecture Implementation

## Latest Workflow: Storage Pool Heartbeat Reporting

**Date:** January 11, 2026

### Objective

Implement the host-centric data architecture for storage pools, where hosts report their actual state (capacity, health) back to QvDC via heartbeats.

### Completed Implementation

| Task | Status | Details |
|------|--------|---------|
| Proto Updates | ✅ | Added `StoragePoolStatusReport` and `assigned_pool_ids` to heartbeat |
| Rust Heartbeat | ✅ | Node daemon now includes storage pool status in heartbeats |
| Go Backend | ✅ | UpdateHeartbeat handler processes pool status reports |
| Domain Model | ✅ | Added `PoolHostStatus` and `HostStatuses` map to StoragePool |
| Repository | ✅ | Added `ListAssignedToNode` and updated `UpdateStatus` for host statuses |
| Database Migration | ✅ | Added `host_statuses` JSONB column to storage_pools |
| Build Verification | ✅ | Both Go backend and Rust agent compile successfully |

### Architecture Flow (Now Implemented)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     STORAGE POOL HEARTBEAT FLOW                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. HOST COLLECTS (Node Daemon)                                          │
│     Every heartbeat interval (30s), host collects:                       │
│     - Pool ID                                                            │
│     - Health (HEALTHY/DEGRADED/ERROR/UNMOUNTED)                          │
│     - Capacity (total, used, available bytes)                            │
│     - Mount path                                                         │
│     - Volume count                                                       │
│                                                                          │
│  2. HOST REPORTS (Heartbeat Request)                                     │
│     Heartbeat now includes `storagePools` array                          │
│                                                                          │
│  3. QVDC PROCESSES (UpdateHeartbeat Handler)                             │
│     For each pool report:                                                │
│     - Look up pool by ID                                                 │
│     - Update HostStatuses[nodeId] with reported status                   │
│     - Recalculate aggregate capacity (AggregateCapacity())               │
│     - Recalculate overall phase (DetermineOverallPhase())                │
│     - Persist updated pool status                                        │
│                                                                          │
│  4. QVDC RESPONDS (Heartbeat Response)                                   │
│     Response includes `assignedPoolIds` - list of pools this host        │
│     should have mounted. Host can use this to detect missing mounts.     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Files Changed

**Proto:**
- `proto/limiquantix/compute/v1/node_service.proto` - Added StoragePoolStatusReport, updated heartbeat messages

**Go Backend:**
- `backend/internal/domain/storage.go` - Added PoolHostStatus, PoolHostHealth, helper methods
- `backend/internal/services/node/service.go` - Added StoragePoolRepository, updated UpdateHeartbeat
- `backend/internal/services/storage/pool_repository.go` - Added ListAssignedToNode interface
- `backend/internal/repository/postgres/storage_pool_repository.go` - Implemented ListAssignedToNode
- `backend/internal/repository/memory/storage_pool_repository.go` - Implemented ListAssignedToNode
- `backend/migrations/000005_pool_host_statuses.up.sql` - Added host_statuses column

**Rust Agent:**
- `agent/limiquantix-node/src/registration.rs` - Added storage manager, collect_storage_pool_status
- `agent/limiquantix-node/src/server.rs` - Pass storage manager to registration client
- `agent/limiquantix-node/src/service.rs` - Added get_storage_manager method
- `agent/limiquantix-hypervisor/src/storage/types.rs` - Added volume_count to PoolInfo
- All storage backends (nfs.rs, local.rs, ceph.rs, iscsi.rs) - Updated PoolInfo construction

### Remaining Work (Future)

| Task | Priority | Notes |
|------|----------|-------|
| Frontend per-host status display | Medium | Show which hosts have healthy/unhealthy mounts |
| Auto-mount missing pools | Low | When heartbeat response includes unassigned pools, mount them |
| Network config orchestration | Medium | Apply same host-centric pattern to vSwitches |

---

## Previous Workflow: Architecture Validation

**Date:** January 11, 2026

Confirmed the **"QvDC orchestrates, hosts execute and own state"** architecture pattern.

See: `docs/adr/000011-host-centric-data-architecture.md`

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────┐
│  Quantix-vDC (Control Plane) - localhost:8080                   │
│  ├── Go backend with Connect-RPC + REST APIs                    │
│  ├── PostgreSQL, etcd, Redis (Docker)                           │
│  └── React frontend (localhost:5173)                            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ gRPC / REST
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Quantix-OS (Hypervisor Host)                                   │
│  ├── Rust Node Daemon (limiquantix-node)                        │
│  │   └── Now reports storage pool status in heartbeats          │
│  ├── libvirt/QEMU for VM management                             │
│  └── QHCI - Host UI (quantix-host-ui)                           │
└─────────────────────────────────────────────────────────────────┘
```
