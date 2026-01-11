# Workflow State

## Current Status: IN PROGRESS - Storage Pool File Browser Implementation

## Latest Workflow: File Browser for NFS/iSCSI Pools

**Date:** January 11, 2026

### Objective

Implement the ability to browse files in NFS and iSCSI storage pools from the Quantix-vDC UI.

### Implementation Summary

The file browser feature allows users to navigate through files and directories stored in storage pools. This is essential for:
- Browsing uploaded ISOs
- Viewing disk images (QCOW2, VMDK)
- Managing pool contents

### Completed Implementation

| Task | Status | Details |
|------|--------|---------|
| Proto Definition | ✅ | `ListPoolFiles` RPC in storage_service.proto |
| Node Daemon Proto | ✅ | `ListStoragePoolFiles` RPC in node_daemon.proto |
| Node Daemon Implementation | ✅ | Rust service with path sanitization, file type detection |
| Backend Proxy | ✅ | Go `ListPoolFiles` calls node daemon |
| Pool Discovery | ✅ | Added `try_discover_pool` for cache miss recovery |
| Frontend Hook | ✅ | `usePoolFiles` hook with React Query |
| Frontend UI | ✅ | File browser in StoragePoolDetail.tsx |

### Technical Details

**Node Daemon (Rust):**
- `list_storage_pool_files` in `service.rs`
- Uses `get_pool_info_or_discover` to find pools even after daemon restart
- Path sanitization to prevent directory traversal attacks
- Returns file metadata: name, size, type, permissions, modified date

**Storage Manager Enhancements:**
- `register_pool(pool_info)` - Add pool to cache without initializing
- `try_discover_pool(pool_id)` - Check if mount exists at standard paths
- `get_pool_info_or_discover(pool_id)` - Cache lookup with discovery fallback

**Backend (Go):**
- `ListPoolFiles` in `pool_service.go`
- Routes to appropriate connected node
- Converts node daemon response to proto response

**Frontend (React):**
- `usePoolFiles(poolId, path)` hook in `useStorage.ts`
- File browser UI with breadcrumb navigation
- Icons for different file types (qcow2, iso, vmdk, etc.)

### Next Steps

1. **Deploy to Node**: Copy built `limiquantix-node` binary to Ubuntu host
2. **Restart Daemon**: `sudo systemctl restart limiquantix-node`
3. **Test in UI**: Navigate to Storage Pool Detail page and browse files

### Key Files Changed

**Rust Agent:**
- `agent/limiquantix-hypervisor/src/storage/mod.rs` - Added pool discovery methods
- `agent/limiquantix-node/src/service.rs` - Improved `list_storage_pool_files` with discovery fallback

---

## Previous Workflow: Storage Pool Heartbeat Reporting

**Date:** January 11, 2026

### Objective

Implement the host-centric data architecture for storage pools, where hosts report their actual state (capacity, health) back to QvDC via heartbeats.

### Architecture Flow (Implemented)

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

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Quantix-vDC (Control Plane) - localhost:8080                           │
│  ├── Go backend with Connect-RPC + REST APIs                            │
│  ├── PostgreSQL, etcd, Redis (Docker)                                   │
│  └── React frontend (localhost:5173)                                    │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ gRPC / REST
                              │
┌─────────────────────────────────────────────────────────────────────────┐
│  Quantix-OS (Hypervisor Host)                                           │
│  ├── Rust Node Daemon (limiquantix-node)                                │
│  │   ├── Reports storage pool status in heartbeats                      │
│  │   └── Serves file listing for storage pools                          │
│  ├── libvirt/QEMU for VM management                                     │
│  └── QHCI - Host UI (quantix-host-ui)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```
