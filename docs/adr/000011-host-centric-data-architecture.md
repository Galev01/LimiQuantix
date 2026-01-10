# QvDC-Orchestrated, Host-Executed Architecture

**Document ID:** 000011  
**Date:** January 11, 2026  
**Status:** Accepted  
**Scope:** Core architecture principle for data flow between QHCI hosts and QvDC

## Context

Quantix-KVM follows the VMware ESXi/vCenter model where:
- **vCenter** defines configurations and orchestrates multi-host operations
- **ESXi hosts** execute commands and are the source of truth for actual state

Our implementation:
- **QvDC (Control Plane)** = vCenter equivalent - orchestration and central management
- **QHCI hosts (Node Daemon)** = ESXi equivalent - execution and source of truth

## Decision

### Principle: QvDC Orchestrates, Hosts Execute and Own State

This is a **"QvDC-Orchestrated, Host-Executed"** model where:

1. **QvDC defines** what should exist (storage pools, networks, VMs)
2. **QvDC pushes** commands to assigned hosts
3. **Hosts execute** the commands (mount NFS, create VM, configure network)
4. **Hosts are source of truth** for actual state (capacity, usage, health)
5. **Hosts report back** actual state to QvDC

| Concept | QvDC (Control Plane) | Host (Node Daemon) |
|---------|---------------------|-------------------|
| **Storage Pools** | Define config, assign to hosts, push mount commands | Execute mount, **source of truth** for capacity/usage/health |
| **Volumes** | Send create/delete commands | Execute, manage files, **source of truth** for actual state |
| **VMs** | Define spec, schedule placement, send commands | Execute, run VM, **source of truth** for power state |
| **Networks** | Define vSwitches, assign to hosts | Execute config, **source of truth** for connectivity |

### Data Flow Patterns

#### Pattern 1: Orchestrated Push (QvDC → Hosts → Report Back)

This is the primary pattern for storage, networks, and VMs.

```
┌──────────────┐                    ┌──────────────┐
│    QvDC      │                    │    Host(s)   │
│ (Orchestrator)│                   │ (Executors)  │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │ 1. Admin creates NFS pool         │
       │    - Server: 192.168.1.100        │
       │    - Assigns to [host-1, host-2]  │
       │                                   │
       │──────────────────────────────────>│
       │ 2. Push InitStoragePool to hosts  │
       │                                   │
       │                                   │ 3. Each host mounts NFS
       │                                   │    Host OWNS the mount
       │                                   │
       │<──────────────────────────────────│
       │ 4. Hosts return result:           │
       │    - Mount status                 │
       │    - Capacity: 2TB                │
       │    - Usage: 500GB                 │
       │                                   │
       │ 5. QvDC aggregates state          │
       │    from all assigned hosts        │
       │                                   │
       │<═══════════════════════════════════│
       │ 6. Continuous heartbeat updates   │
       │    (hosts push actual state)      │
       │                                   │
```

**Use cases:**
- Storage pool creation and assignment
- VM creation and power operations
- Network/vSwitch configuration
- Any multi-host orchestration

#### Pattern 2: Host Registration (Host → QvDC)

Initial discovery when host joins the cluster.

```
┌──────────────┐                    ┌──────────────┐
│    Host      │                    │    QvDC      │
│ (Node Daemon)│                    │ (Control)    │
└──────┬───────┘                    └──────┬───────┘
       │                                   │
       │ 1. Host starts, scans hardware    │
       │    (CPU, RAM, disks, NICs)        │
       │                                   │
       │──────────────────────────────────>│
       │ 2. Register with QvDC             │
       │    Push hardware inventory        │
       │                                   │
       │                                   │ 3. QvDC stores host info
       │                                   │
       │<──────────────────────────────────│
       │ 4. QvDC may push pending configs  │
       │    (assigned pools, networks)     │
       │                                   │
```

**Use cases:**
- Host registration
- Hardware discovery
- Existing VM sync

### Storage Pool Example (Shared NFS)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     NFS STORAGE POOL FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  STEP 1: DEFINE IN QVDC                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Admin creates pool in QvDC Dashboard:                             │ │
│  │    Name: "shared-nfs"                                              │ │
│  │    Type: NFS                                                       │ │
│  │    Server: 192.168.1.100                                           │ │
│  │    Export: /exports/vm-storage                                     │ │
│  │    Assigned Hosts: [host-1, host-2, host-3]                        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  STEP 2: PUSH TO HOSTS (gRPC: InitStoragePool)                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  QvDC → host-1: Mount NFS 192.168.1.100:/exports/vm-storage        │ │
│  │  QvDC → host-2: Mount NFS 192.168.1.100:/exports/vm-storage        │ │
│  │  QvDC → host-3: Mount NFS 192.168.1.100:/exports/vm-storage        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  STEP 3: HOSTS EXECUTE & OWN STATE                                       │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  host-1: Mounts at /var/lib/limiquantix/pools/shared-nfs           │ │
│  │          Reports: 2TB total, 500GB used, HEALTHY                   │ │
│  │  host-2: Mounts at /var/lib/limiquantix/pools/shared-nfs           │ │
│  │          Reports: 2TB total, 500GB used, HEALTHY                   │ │
│  │  host-3: Mount FAILED (network issue)                              │ │
│  │          Reports: ERROR, "Connection refused"                      │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  STEP 4: QVDC AGGREGATES                                                 │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Pool "shared-nfs" status:                                         │ │
│  │    - Total: 2TB (same pool, shared)                                │ │
│  │    - Used: 500GB                                                   │ │
│  │    - Healthy hosts: [host-1, host-2]                               │ │
│  │    - Failed hosts: [host-3] ⚠️                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Current Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| Host Registration | ✅ Correct | Host pushes hardware info |
| VM Sync (existing) | ✅ Correct | Host syncs VMs to QvDC |
| VM Create | ✅ Correct | QvDC → Host command pattern |
| VM Operations | ✅ Correct | QvDC → Host command pattern |
| Storage Pool Create | ✅ Correct | QvDC defines, pushes to hosts |
| Storage Pool Assignment | ✅ Correct | AssignedNodeIDs tracked |
| Storage Host Execution | ✅ Correct | Hosts mount and report back |
| Storage Heartbeat Reporting | ⚠️ Needs work | Add pool state to heartbeat |
| Network Config | ⚠️ Needs work | Need same orchestrated pattern |

### Enhancements Needed

#### 1. Add Storage State to Heartbeat

Hosts should continuously report storage pool state:

```rust
struct HeartbeatPayload {
    // ... existing fields ...
    
    // Storage Pool Status (Host is source of truth)
    storage_pools: Vec<PoolStatus>,
}

struct PoolStatus {
    pool_id: String,
    mount_path: String,
    status: PoolHealthStatus,  // HEALTHY, DEGRADED, ERROR
    total_bytes: u64,
    used_bytes: u64,
    available_bytes: u64,
    error_message: Option<String>,
}
```

#### 2. QvDC Aggregates Host Reports

```go
func (s *NodeService) HandleHeartbeat(ctx context.Context, hb *Heartbeat) {
    // Update node status
    s.nodeRepo.UpdateHeartbeat(ctx, hb.NodeID, hb.Timestamp)
    
    // Aggregate storage pool status from this host
    for _, poolStatus := range hb.StoragePools {
        s.poolService.UpdateHostPoolStatus(ctx, hb.NodeID, poolStatus)
    }
}
```

#### 3. Pool Status Aggregation

```go
// Aggregate status across all assigned hosts
func (s *PoolService) GetAggregatedPoolStatus(poolID string) *AggregatedStatus {
    pool := s.repo.Get(poolID)
    
    var healthyHosts, failedHosts []string
    for _, nodeID := range pool.AssignedNodeIDs {
        status := s.hostPoolStatus[poolID][nodeID]
        if status.Health == HEALTHY {
            healthyHosts = append(healthyHosts, nodeID)
        } else {
            failedHosts = append(failedHosts, nodeID)
        }
    }
    
    return &AggregatedStatus{
        TotalBytes:    pool.Capacity.TotalBytes,  // From healthy host
        UsedBytes:     pool.Capacity.UsedBytes,
        HealthyHosts:  healthyHosts,
        FailedHosts:   failedHosts,
        OverallHealth: determineOverallHealth(healthyHosts, failedHosts),
    }
}
```

## Consequences

### Positive
- Clear orchestration model (QvDC manages, hosts execute)
- Multi-host storage easily managed (assign pool to multiple hosts)
- Host remains source of truth for actual state
- Matches how VMware vCenter/ESXi works
- Current implementation is mostly correct

### Neutral
- ~~Need to enhance heartbeat with storage state~~ ✅ IMPLEMENTED
- ~~Need per-host pool status tracking~~ ✅ IMPLEMENTED

## Implementation Status (Updated January 11, 2026)

The following enhancements have been implemented:

### Completed:
1. **Proto Updates**: Added `StoragePoolStatusReport` message with health, capacity, mount path, volume count
2. **Rust Node Daemon**: Heartbeat now includes storage pool status via `collect_storage_pool_status()`
3. **Go Backend**: `UpdateHeartbeat` handler processes pool reports, updates `HostStatuses` map
4. **Domain Model**: Added `PoolHostStatus`, `PoolHostHealth`, helper methods (`AggregateCapacity`, `DetermineOverallPhase`)
5. **Repository**: Added `ListAssignedToNode` for efficient per-node pool lookup
6. **Database Migration**: Added `host_statuses` JSONB column to `storage_pools` table

### Remaining:
- Frontend: Display per-host pool health in Storage Pool detail page
- Network: Apply same orchestrated pattern to vSwitch/network configurations

## Related Documents

- [000001-vm-model-design.md](./000001-vm-model-design.md) - VM domain model
- [000002-node-model-design.md](./000002-node-model-design.md) - Node domain model
- [000003-storage-model-design.md](./000003-storage-model-design.md) - Storage domain model
- [000057-storage-pool-host-assignment.md](../Storage/000057-storage-pool-host-assignment.md) - Pool assignment feature

## Chart:

``` mermaid
graph TD
    %% Node Definitions
    Admin((Admin))
    QvDC[QvDC Dashboard/Controller]
    
    subgraph Execution_Hosts [Execution Layer: Virtualization Hosts]
        Host1[Host-1]
        Host2[Host-2]
        Host3[Host-3]
    end

    subgraph Storage_Backend [Physical Storage]
        NFS[(NFS Server: 192.168.1.100<br/>Path: /exports/vm-storage)]
    end

    %% Flow Steps
    Admin -->|1. Define Pool| QvDC
    
    QvDC -->|2. Push: InitStoragePool| Host1
    QvDC -->|2. Push: InitStoragePool| Host2
    QvDC -->|2. Push: InitStoragePool| Host3

    Host1 -->|3. Execute Mount| NFS
    Host2 -->|3. Execute Mount| NFS
    Host3 -->|3. Execute Mount| NFS

    Host1 -.->|4. Report: State/Health/Usage| QvDC
    Host2 -.->|4. Report: State/Health/Usage| QvDC
    Host3 -.->|4. Report: State/Health/Usage| QvDC

    %% Styling
    style QvDC fill:#f9f,stroke:#333,stroke-width:2px
    style Execution_Hosts fill:#f0f7ff,stroke:#005cc5,stroke-dasharray: 5 5
    style Storage_Backend fill:#fff4dd,stroke:#d4a017
```