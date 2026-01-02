# Backend Phase 2 Implementation - Complete

**Document ID:** 000026  
**Purpose:** Documents the implementation of Backend Phase 2: Core Services  
**Status:** ✅ Complete  
**Date:** January 2026

---

## Overview

Backend Phase 2 implements the core gRPC/Connect-RPC services for the limiquantix control plane. This phase establishes the foundation for managing virtual machines, nodes, storage, networks, and VM scheduling.

## Architecture

The implementation follows a **Clean Architecture** pattern with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP/Connect-RPC Layer                    │
│              (backend/internal/server/server.go)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Service Layer                           │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │ VMService │ │NodeService│ │NetworkSvc │ │ Scheduler │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Repository Layer                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
│  │  VMRepo   │ │ NodeRepo  │ │NetworkRepo│ │PoolRepo   │   │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Domain Models                            │
│        (backend/internal/domain/*.go)                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Implemented Services

### 1. VM Service (`compute/v1/VMService`)

**Location:** `backend/internal/services/vm/`

| Method | Description | Status |
|--------|-------------|--------|
| `CreateVM` | Create a new virtual machine | ✅ |
| `GetVM` | Retrieve VM by ID | ✅ |
| `ListVMs` | List VMs with filtering/pagination | ✅ |
| `UpdateVM` | Update VM specification | ✅ |
| `DeleteVM` | Delete a VM | ✅ |
| `StartVM` | Power on a VM | ✅ |
| `StopVM` | Power off a VM | ✅ |

**Files:**
- `service.go` - Service implementation
- `repository.go` - Repository interface
- `converter.go` - Proto ↔ Domain conversion
- `validation.go` - Request validation

---

### 2. Node Service (`compute/v1/NodeService`)

**Location:** `backend/internal/services/node/`

| Method | Description | Status |
|--------|-------------|--------|
| `RegisterNode` | Register a new hypervisor node | ✅ |
| `GetNode` | Retrieve node by ID | ✅ |
| `ListNodes` | List nodes with filtering | ✅ |
| `UpdateNode` | Update node configuration | ✅ |
| `DeleteNode` | Decommission a node | ✅ |
| `Heartbeat` | Receive node health updates | ✅ |

**Files:**
- `service.go` - Service implementation
- `repository.go` - Repository interface
- `converter.go` - Proto ↔ Domain conversion

---

### 3. Virtual Network Service (`network/v1/VirtualNetworkService`)

**Location:** `backend/internal/services/network/`

| Method | Description | Status |
|--------|-------------|--------|
| `CreateNetwork` | Create a virtual network | ✅ |
| `GetNetwork` | Retrieve network by ID | ✅ |
| `ListNetworks` | List networks with filtering | ✅ |
| `UpdateNetwork` | Update network configuration | ✅ |
| `DeleteNetwork` | Delete a virtual network | ✅ |
| `GetNetworkTopology` | Get network topology graph | ✅ |

**Files:**
- `network_service.go` - Network service implementation
- `network_repository.go` - Repository interface
- `converter.go` - Proto ↔ Domain conversion

---

### 4. Security Group Service (`network/v1/SecurityGroupService`)

**Location:** `backend/internal/services/network/`

| Method | Description | Status |
|--------|-------------|--------|
| `CreateSecurityGroup` | Create a security group | ✅ |
| `GetSecurityGroup` | Retrieve security group by ID | ✅ |
| `ListSecurityGroups` | List security groups | ✅ |
| `UpdateSecurityGroup` | Update security group | ✅ |
| `DeleteSecurityGroup` | Delete a security group | ✅ |
| `AddRule` | Add a firewall rule | ✅ |
| `RemoveRule` | Remove a firewall rule | ✅ |

**Files:**
- `security_group_service.go` - Security group service implementation

---

### 5. Scheduler (`internal/scheduler`)

**Location:** `backend/internal/scheduler/`

The scheduler implements VM placement logic with:

- **Predicate-based filtering**: Hard constraints (CPU, memory, affinity)
- **Score-based ranking**: Soft preferences (spread/pack strategies)
- **Affinity/Anti-affinity**: VM co-location rules
- **Overcommit support**: Configurable CPU/memory overcommit ratios

**Placement Strategies:**
- `spread` - Distribute VMs evenly across nodes (default, better HA)
- `pack` - Consolidate VMs on fewer nodes (better efficiency)
- `balance` - Balance by remaining capacity

**Files:**
- `scheduler.go` - Main scheduling logic
- `config.go` - Scheduler configuration
- `repository.go` - Repository interfaces

---

## Domain Models

### Compute Domain (`domain/vm.go`, `domain/node.go`)

- `VirtualMachine` - VM entity with spec/status pattern
- `Node` - Physical hypervisor host
- `VMSpec`, `VMStatus` - VM configuration and runtime state
- `NodeSpec`, `NodeStatus` - Node capabilities and health

### Network Domain (`domain/network.go`)

- `VirtualNetwork` - SDN network
- `SecurityGroup` - Firewall rules
- `Port` - VM network attachment point (placeholder)

### Storage Domain (`domain/storage.go`)

- `StoragePool` - Storage backend (Ceph, LVM, NFS)
- `Volume` - Virtual disk
- `VolumeSnapshot` - Point-in-time snapshot
- `Image` - OS template image

---

## In-Memory Repositories

For development and testing, in-memory repositories are provided:

**Location:** `backend/internal/repository/memory/`

| Repository | Description |
|------------|-------------|
| `VMRepository` | VM data storage with demo data |
| `NodeRepository` | Node data storage with demo data |
| `StoragePoolRepository` | Storage pool data |
| `VolumeRepository` | Volume data |
| `NetworkRepository` | Virtual network data |
| `SecurityGroupRepository` | Security group data |

All repositories implement thread-safe access using `sync.Map` or `sync.RWMutex`.

---

## Server Registration

Services are registered in `backend/internal/server/server.go`:

```go
// Compute services
vmPath, vmHandler := computev1connect.NewVMServiceHandler(s.vmService)
nodePath, nodeHandler := computev1connect.NewNodeServiceHandler(s.nodeService)

// Network services
networkPath, networkHandler := networkv1connect.NewVirtualNetworkServiceHandler(s.networkService)
sgPath, sgHandler := networkv1connect.NewSecurityGroupServiceHandler(s.securityGroupService)
```

---

## Configuration

Scheduler configuration in `configs/config.yaml`:

```yaml
scheduler:
  placement_strategy: "spread"  # spread, pack, balance
  overcommit_cpu: 2.0           # 2x CPU overcommit
  overcommit_memory: 1.5        # 1.5x memory overcommit
```

---

## API Endpoints

The server exposes these endpoints:

| Path | Description |
|------|-------------|
| `/health` | Health check |
| `/ready` | Readiness probe |
| `/live` | Liveness probe |
| `/api/v1/info` | API information |
| `/limiquantix.compute.v1.VMService/*` | VM gRPC methods |
| `/limiquantix.compute.v1.NodeService/*` | Node gRPC methods |
| `/limiquantix.network.v1.VirtualNetworkService/*` | Network gRPC methods |
| `/limiquantix.network.v1.SecurityGroupService/*` | Security group gRPC methods |

---

## Next Steps (Phase 3)

1. **PostgreSQL Integration** - Replace in-memory repos with persistent storage
2. **Redis Caching** - Add caching layer for frequently accessed data
3. **Etcd Coordination** - Leader election and distributed locking
4. **Authentication** - JWT-based auth with RBAC

---

## File Summary

```
backend/
├── internal/
│   ├── domain/
│   │   ├── vm.go              # VM domain model
│   │   ├── node.go            # Node domain model
│   │   ├── storage.go         # Storage domain models
│   │   ├── network.go         # Network domain models
│   │   └── errors.go          # Domain errors
│   ├── services/
│   │   ├── vm/
│   │   │   ├── service.go     # VM service
│   │   │   ├── repository.go  # VM repository interface
│   │   │   ├── converter.go   # Proto ↔ Domain
│   │   │   └── validation.go  # Request validation
│   │   ├── node/
│   │   │   ├── service.go     # Node service
│   │   │   ├── repository.go  # Node repository interface
│   │   │   └── converter.go   # Proto ↔ Domain
│   │   ├── storage/
│   │   │   ├── pool_repository.go    # Pool interface
│   │   │   ├── volume_repository.go  # Volume interface
│   │   │   ├── pool_converter.go     # Pool conversions
│   │   │   └── volume_converter.go   # Volume conversions
│   │   └── network/
│   │       ├── network_service.go         # Network service
│   │       ├── security_group_service.go  # Security group service
│   │       ├── network_repository.go      # Repository interfaces
│   │       └── converter.go               # Proto ↔ Domain
│   ├── scheduler/
│   │   ├── scheduler.go       # VM placement logic
│   │   ├── config.go          # Scheduler config
│   │   └── repository.go      # Repository interfaces
│   ├── repository/
│   │   └── memory/
│   │       ├── vm_repository.go           # In-memory VM repo
│   │       ├── node_repository.go         # In-memory Node repo
│   │       ├── storage_pool_repository.go # In-memory Pool repo
│   │       ├── volume_repository.go       # In-memory Volume repo
│   │       ├── network_repository.go      # In-memory Network repo
│   │       └── security_group_repository.go # In-memory SG repo
│   ├── server/
│   │   └── server.go          # HTTP/Connect-RPC server
│   └── config/
│       └── config.go          # Application config
└── cmd/
    └── controlplane/
        └── main.go            # Entry point
```

---

## Testing

To run the server:

```bash
cd backend
go run cmd/controlplane/main.go
```

The server starts on `http://localhost:8080` by default.

Test endpoints:
- `curl http://localhost:8080/health`
- `curl http://localhost:8080/api/v1/info`

---

## References

- [Backend Plan](../backend-plan.md)
- [Backend Implementation Guide](./000024-backend-implementation-guide.md)
- [Proto Definitions](../proto/limiquantix/)
