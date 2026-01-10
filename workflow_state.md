# Workflow State

## Current Status: COMPLETED - Architecture Validation

## Latest Workflow: QvDC-Orchestrated, Host-Executed Architecture

**Date:** January 11, 2026

### Objective

Validate and document the architecture pattern for Quantix-KVM.

### Confirmed Architecture: QvDC-Orchestrated, Host-Executed

The architecture follows a **"QvDC orchestrates, hosts execute and own state"** model:

1. **QvDC defines** what should exist (storage pools, networks, VMs)
2. **QvDC pushes** commands to assigned hosts
3. **Hosts execute** the commands (mount NFS, create VM, configure network)
4. **Hosts are source of truth** for actual state (capacity, usage, health)
5. **Hosts report back** actual state to QvDC

### Architecture Analysis (Revised)

| Data Type | Current Flow | Status |
|-----------|-------------|--------|
| **Nodes/Hosts** | Host → QvDC (registration push) | ✅ CORRECT |
| **VMs (existing)** | Host → QvDC (sync) | ✅ CORRECT |
| **VMs (create)** | QvDC → Host (command) → Host reports state | ✅ CORRECT |
| **Storage Pools** | QvDC → Host (push mount) → Host reports state | ✅ CORRECT |
| **Volumes** | QvDC → Host (create) → Host reports state | ✅ CORRECT |
| **Networks** | QvDC → Host (push config) → Host reports state | ✅ CORRECT |

### Storage Flow (Confirmed Correct)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     STORAGE POOL FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. DEFINE (QvDC)                                                        │
│     Admin creates NFS pool in QvDC Dashboard                             │
│     - Server: 192.168.1.100                                              │
│     - Export: /exports/vm-storage                                        │
│     - Assigned Hosts: [host-1, host-2, host-3]                           │
│                                                                          │
│  2. PUSH (QvDC → Hosts)                                                  │
│     QvDC sends InitStoragePool to each assigned host                     │
│                                                                          │
│  3. EXECUTE (Hosts)                                                      │
│     Each host mounts the NFS share                                       │
│     Host OWNS the mount - source of truth for capacity/health            │
│                                                                          │
│  4. REPORT (Hosts → QvDC)                                                │
│     Hosts report actual state via response/heartbeat:                    │
│     - "I have 2TB total, 500GB used"                                     │
│     - "Mount is healthy/degraded/failed"                                 │
│                                                                          │
│  5. AGGREGATE (QvDC)                                                     │
│     QvDC displays unified view of pool across all hosts                  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Principle

| Aspect | QvDC Responsibility | Host Responsibility |
|--------|--------------------|--------------------|
| **Storage Definition** | Define pool config (NFS/iSCSI/local) | N/A |
| **Host Assignment** | Track which hosts should have access | N/A |
| **Mount Execution** | Send mount command | Execute mount, report result |
| **Capacity/Usage** | Display aggregated view | **Source of truth** |
| **Health Status** | Display, alert | **Source of truth** |
| **Volume Operations** | Send create/delete commands | Execute, manage files |

### Current Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Host Registration | ✅ Correct | Host pushes hardware info |
| VM Sync (existing) | ✅ Correct | Host syncs VMs to QvDC |
| VM Create | ✅ Correct | QvDC → Host command |
| VM Operations | ✅ Correct | QvDC → Host command |
| Storage Pool Create | ✅ Correct | QvDC defines, pushes to hosts |
| Storage Pool Assignment | ✅ Correct | AssignedNodeIDs tracked |
| Storage Host Execution | ✅ Correct | Hosts mount and report back |
| Storage Heartbeat Reporting | ⚠️ Enhancement | Add pool state to heartbeat |
| Network Config | ⚠️ Enhancement | Apply same orchestrated pattern |

### Enhancements Identified (Future Work)

1. **Add storage pool state to heartbeat** - Hosts should continuously report pool health/capacity
2. **Per-host pool status tracking** - QvDC should track which hosts have healthy mounts
3. **Network orchestration** - Apply same pattern to vSwitch/network configs

### Documentation Created

- `docs/adr/000011-host-centric-data-architecture.md` - Full ADR with details

---

## Previous Workflow: Storage Pool Host Assignment

**Date:** January 11, 2026

### Completed Tasks

| Task | Status |
|------|--------|
| Domain Model - `AssignedNodeIDs` field | ✅ |
| Proto Updates - `assigned_node_ids` | ✅ |
| Backend Service - assign/unassign RPCs | ✅ |
| Node Daemon - file listing RPC | ✅ |
| Frontend - StoragePoolDetail page | ✅ |
| VM Wizard - host/pool compatibility | ✅ |
| Documentation | ✅ |

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
│  ├── libvirt/QEMU for VM management                             │
│  └── QHCI - Host UI (quantix-host-ui)                           │
└─────────────────────────────────────────────────────────────────┘
```
