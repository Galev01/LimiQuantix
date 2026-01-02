# Backend Phase 2: Core Services Implementation

**Document ID:** 000025  
**Purpose:** Documents the VM and Node services implementation for Backend Phase 2  
**Status:** Complete (VM + Node Services)

---

## Overview

This document describes the core services implemented in Backend Phase 2. These services provide the business logic layer between the Connect-RPC API handlers and the data persistence layer.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Connect-RPC Layer                        │
│                  (Generated from Proto)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Service Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ VM Service  │  │Node Service │  │ Storage/Network     │ │
│  │  (service.go)│  │ (service.go)│  │ (TODO)             │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────┘ │
│         │                │                                   │
│  ┌──────▼──────┐  ┌──────▼──────┐                           │
│  │ Validation  │  │ Validation  │   Proto/Domain Converters │
│  │ Converters  │  │ Converters  │                           │
│  └─────────────┘  └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Repository Layer                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  Repository Interface                   │ │
│  │    (Defines contract for data access operations)       │ │
│  └────────────────────────────────────────────────────────┘ │
│                              │                               │
│         ┌────────────────────┼────────────────────┐         │
│         ▼                    ▼                    ▼         │
│  ┌─────────────┐      ┌─────────────┐      ┌───────────┐   │
│  │  In-Memory  │      │ PostgreSQL  │      │  etcd     │   │
│  │ (Dev/Test)  │      │ (Production)│      │ (State)   │   │
│  └─────────────┘      └─────────────┘      └───────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## VM Service

### File Structure

```
internal/services/vm/
├── service.go       # Service implementation (VMServiceHandler)
├── repository.go    # Repository interface definition
├── validation.go    # Request validation logic
└── converter.go     # Proto <-> Domain type converters
```

### Implemented Methods

| Method | Priority | Description | Status |
|--------|----------|-------------|--------|
| `CreateVM` | P0 | Create a new VM | ✅ |
| `GetVM` | P0 | Get VM by ID | ✅ |
| `ListVMs` | P0 | List VMs with filtering/pagination | ✅ |
| `UpdateVM` | P0 | Update VM specification | ✅ |
| `DeleteVM` | P0 | Delete a VM | ✅ |
| `StartVM` | P0 | Power on a VM | ✅ |
| `StopVM` | P0 | Power off a VM | ✅ |
| `RebootVM` | P1 | Reboot a VM | ✅ |
| `PauseVM` | P1 | Pause VM execution | ✅ |
| `ResumeVM` | P1 | Resume paused VM | ✅ |
| `SuspendVM` | P1 | Hibernate VM to disk | ✅ |

### Repository Interface

```go
type Repository interface {
    Create(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error)
    Get(ctx context.Context, id string) (*domain.VirtualMachine, error)
    List(ctx context.Context, filter VMFilter, limit int, cursor string) ([]*domain.VirtualMachine, int64, error)
    Update(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error)
    UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error
    Delete(ctx context.Context, id string) error
    ListByNode(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error)
    CountByProject(ctx context.Context, projectID string) (int64, error)
}
```

### Validation Rules

| Field | Rule |
|-------|------|
| `name` | Required, 1-255 chars, alphanumeric + hyphen/underscore |
| `spec.cpu.cores` | Required, 1-256 |
| `spec.memory.size_mib` | Required, 256-1048576 (1 TiB) |
| `spec.disks[].size_gib` | 1-65536 (64 TiB) |
| `labels` | Max 50 labels, key max 63 chars, value max 255 chars |

---

## Node Service

### File Structure

```
internal/services/node/
├── service.go       # Service implementation (NodeServiceHandler)
├── repository.go    # Repository interface definition
└── converter.go     # Proto <-> Domain type converters
```

### Implemented Methods

| Method | Priority | Description | Status |
|--------|----------|-------------|--------|
| `RegisterNode` | P0 | Agent registers with control plane | ✅ |
| `GetNode` | P0 | Get node by ID | ✅ |
| `ListNodes` | P0 | List all nodes | ✅ |
| `UpdateNode` | P0 | Update node labels/spec | ✅ |
| `DecommissionNode` | P1 | Remove node from cluster | ✅ |
| `EnableNode` | P1 | Mark node as schedulable | ✅ |
| `DisableNode` | P1 | Mark node as unschedulable | ✅ |
| `DrainNode` | P1 | Migrate VMs off node | ✅ |
| `GetNodeMetrics` | P2 | Get real-time metrics | ✅ |

### Repository Interface

```go
type Repository interface {
    Create(ctx context.Context, node *domain.Node) (*domain.Node, error)
    Get(ctx context.Context, id string) (*domain.Node, error)
    GetByHostname(ctx context.Context, hostname string) (*domain.Node, error)
    List(ctx context.Context, filter NodeFilter) ([]*domain.Node, error)
    ListSchedulable(ctx context.Context) ([]*domain.Node, error)
    Update(ctx context.Context, node *domain.Node) (*domain.Node, error)
    UpdateStatus(ctx context.Context, id string, status domain.NodeStatus) error
    UpdateHeartbeat(ctx context.Context, id string, resources domain.Resources) error
    Delete(ctx context.Context, id string) error
    ListByCluster(ctx context.Context, clusterID string) ([]*domain.Node, error)
}
```

---

## In-Memory Repositories

For development and testing, in-memory implementations are provided:

### File Structure

```
internal/repository/memory/
├── vm_repository.go    # In-memory VM repository
└── node_repository.go  # In-memory Node repository
```

### Features

- Thread-safe with `sync.RWMutex`
- Deep cloning to prevent external mutations
- Demo data seeding for development
- Full filter support (project, state, labels, etc.)

### Demo Data

The in-memory repositories come pre-seeded with realistic demo data:

**VMs:**
- `web-server-01` - Running, 4 CPU, 8 GB RAM
- `db-server-01` - Running, 8 CPU, 32 GB RAM
- `dev-workstation` - Stopped, 2 CPU, 4 GB RAM
- `cache-server` - Running, 2 CPU, 16 GB RAM

**Nodes:**
- `hypervisor-01` - Ready, Intel Xeon, 256 GB RAM, 2 TB NVMe
- `hypervisor-02` - Ready, Intel Xeon, 256 GB RAM, 1 TB NVMe
- `hypervisor-03` - Ready, AMD EPYC, 512 GB RAM, 4 TB NVMe

---

## Type Converters

Each service includes converters between Proto and Domain types:

### Proto to Domain

```go
// Convert proto VmSpec to domain VMSpec
func convertSpecFromProto(spec *computev1.VmSpec) domain.VMSpec

// Convert proto PowerState to domain VMState
func convertPowerStateFromProto(state computev1.PowerState) domain.VMState
```

### Domain to Proto

```go
// Convert domain VirtualMachine to proto VirtualMachine
func ToProto(vm *domain.VirtualMachine) *computev1.VirtualMachine

// Convert domain VMStatus to proto VmStatus
func convertStatusToProto(status domain.VMStatus) *computev1.VmStatus
```

---

## Server Integration

Services are registered in `internal/server/server.go`:

```go
func (s *Server) initServices() {
    s.vmService = vmservice.NewService(s.vmRepo, s.logger)
    s.nodeService = nodeservice.NewService(s.nodeRepo, s.logger)
}

func (s *Server) registerRoutes() {
    // VM Service
    vmPath, vmHandler := computev1connect.NewVMServiceHandler(s.vmService)
    s.mux.Handle(vmPath, vmHandler)

    // Node Service
    nodePath, nodeHandler := computev1connect.NewNodeServiceHandler(s.nodeService)
    s.mux.Handle(nodePath, nodeHandler)
}
```

---

## Error Handling

Services use Connect-RPC error codes:

| Scenario | Error Code |
|----------|------------|
| Resource not found | `CodeNotFound` |
| Invalid request | `CodeInvalidArgument` |
| Already exists | `CodeAlreadyExists` |
| Precondition failed | `CodeFailedPrecondition` |
| Internal error | `CodeInternal` |
| Resource exhausted | `CodeResourceExhausted` |

Example:
```go
if errors.Is(err, domain.ErrNotFound) {
    return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", id))
}
```

---

## Logging

All services use structured logging with Zap:

```go
logger := s.logger.With(
    zap.String("method", "CreateVM"),
    zap.String("vm_name", req.Msg.Name),
    zap.String("project_id", req.Msg.ProjectId),
)

logger.Info("Creating VM")
// ... operation ...
logger.Info("VM created successfully", zap.String("vm_id", created.ID))
```

---

## Testing the API

### List VMs

```bash
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/ListVMs \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Create a VM

```bash
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/CreateVM \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-vm",
    "projectId": "00000000-0000-0000-0000-000000000001",
    "spec": {
      "cpu": {"cores": 2},
      "memory": {"sizeMib": 4096}
    }
  }'
```

### Start a VM

```bash
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.VMService/StartVM \
  -H "Content-Type: application/json" \
  -d '{"id": "11111111-1111-1111-1111-111111111111"}'
```

### List Nodes

```bash
curl -X POST http://localhost:8080/Quantixkvm.compute.v1.NodeService/ListNodes \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Next Steps

1. **Storage Service** - StoragePoolService and VolumeService
2. **Network Service** - VirtualNetworkService and SecurityGroupService
3. **Scheduler** - VM placement algorithm
4. **PostgreSQL Repositories** - Replace in-memory with persistent storage
5. **Authentication** - JWT and RBAC implementation
