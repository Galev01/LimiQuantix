# ADR-002: Node Model Design

**Status:** Accepted  
**Date:** 2025-01-01  
**Authors:** limiquantix Team

## Context

limiquantix requires a comprehensive representation of physical compute nodes (hypervisor hosts) to enable:
- Hardware inventory and capability discovery
- Resource scheduling and placement decisions
- Cluster management and high availability
- Monitoring and health checks

## Decision

We have designed a `Node` protobuf schema that captures complete hardware information while supporting enterprise operations like maintenance mode, draining, and tainting.

### Key Design Principles

#### 1. Complete Hardware Discovery

The node model captures detailed hardware information:
- **CPU**: Model, sockets, cores, threads, NUMA topology, features
- **Memory**: Total, allocatable, huge pages
- **Storage**: Device list with type detection (HDD/SSD/NVMe)
- **Network**: NICs with SR-IOV capability, driver info
- **GPU**: vGPU profiles, passthrough status

#### 2. Kubernetes-Inspired Scheduling

We borrow proven patterns from Kubernetes:

```protobuf
message SchedulingConfig {
  bool schedulable = 1;      // Enable/disable scheduling
  repeated Taint taints = 2; // Prevent unwanted VMs
  OvercommitConfig overcommit = 3;
  ReservedResources reserved = 4;
}
```

**Taints** prevent VMs from scheduling unless they "tolerate" the taint:
- `gpu:nvidia` with `NO_SCHEDULE` → Only GPU-aware VMs scheduled
- `maintenance:true` with `NO_EXECUTE` → Evict existing VMs

#### 3. Role-Based Configuration

Nodes can serve multiple roles:

```protobuf
message NodeRole {
  bool compute = 1;       // Run VMs
  bool storage = 2;       // Ceph OSD
  bool control_plane = 3; // API, scheduler, etcd
}
```

This enables hyper-converged deployments (all roles on one node) or dedicated infrastructure (separate compute/storage).

### Feature Coverage

| Feature | VMware Equivalent | limiquantix Implementation |
|---------|------------------|---------------------------|
| Host Inventory | vCenter Inventory | `NodeSpec.cpu/memory/storage` |
| Maintenance Mode | Maintenance Mode | `SchedulingConfig.schedulable` |
| Host Profiles | Host Profiles | Labels + Taints |
| DRS Affinity | DRS Rules | `Taint` system |
| vMotion Status | vMotion Enabled | `MigrationConfig` on VMs |
| Resource Pools | Resource Pools | `OvercommitConfig` + `ReservedResources` |

## Consequences

### Positive

- **Complete visibility** into cluster hardware
- **Flexible scheduling** with taints and labels
- **Enterprise operations** (drain, maintenance mode)
- **Multi-role support** for hyper-converged or distributed

### Negative

- **Agent dependency**: Accurate data requires limiquantix agent
- **Discovery overhead**: Initial hardware scan can be slow

## Implementation Notes

### Hardware Discovery

The agent performs hardware discovery on startup:

```go
// Pseudo-code for agent discovery
func DiscoverHardware() (*NodeSpec, error) {
    cpu := discoverCPU()      // /proc/cpuinfo, lscpu
    memory := discoverMemory() // /proc/meminfo
    storage := discoverStorage() // lsblk, smartctl
    network := discoverNetwork() // ip link, ethtool
    gpu := discoverGPU()      // nvidia-smi, lspci
    
    return &NodeSpec{
        Cpu: cpu,
        Memory: memory,
        Storage: storage,
        Network: network,
        Gpus: gpu,
    }, nil
}
```

### Node Lifecycle

```
PENDING → READY ↔ NOT_READY
            ↓
      MAINTENANCE → DRAINING → OFFLINE
```

## References

- [Kubernetes Node Documentation](https://kubernetes.io/docs/concepts/architecture/nodes/)
- [VMware vSphere Host Management](https://docs.vmware.com/en/VMware-vSphere/index.html)

