# 000032 - VMService to Node Daemon Integration

**Document ID:** 000032  
**Category:** Architecture / Integration  
**Status:** Implemented  
**Created:** January 2, 2026  

---

## Overview

This document describes how the Go Control Plane's **VMService** communicates with the Rust **Node Daemon** to execute VM lifecycle operations. This integration enables the control plane to schedule VMs to hypervisor hosts and manage their lifecycle through gRPC.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Control Plane (Go)                               │
│                                                                          │
│  ┌──────────────┐    ┌───────────────┐    ┌─────────────────────────┐   │
│  │   Frontend   │────│  VMService    │────│      Scheduler          │   │
│  │  (React/TS)  │    │ (Connect-RPC) │    │  (Node Selection)       │   │
│  └──────────────┘    └───────┬───────┘    └───────────┬─────────────┘   │
│                              │                        │                  │
│                              ▼                        ▼                  │
│                    ┌─────────────────────────────────────────────┐      │
│                    │              DaemonPool                      │      │
│                    │  (Connection Pool for Node Daemons)          │      │
│                    │  ┌─────────────┐ ┌─────────────┐            │      │
│                    │  │DaemonClient │ │DaemonClient │ ...        │      │
│                    │  │  (Node 1)   │ │  (Node 2)   │            │      │
│                    │  └──────┬──────┘ └──────┬──────┘            │      │
│                    └─────────┼───────────────┼───────────────────┘      │
└──────────────────────────────┼───────────────┼──────────────────────────┘
                               │ gRPC          │ gRPC
                               ▼               ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│    Node Daemon (Rust)    │  │    Node Daemon (Rust)    │
│     192.168.1.10:9090    │  │     192.168.1.11:9090    │
│  ┌────────────────────┐  │  │  ┌────────────────────┐  │
│  │ NodeDaemonService  │  │  │  │ NodeDaemonService  │  │
│  └─────────┬──────────┘  │  │  └─────────┬──────────┘  │
│            ▼             │  │            ▼             │
│  ┌────────────────────┐  │  │  ┌────────────────────┐  │
│  │ Hypervisor Backend │  │  │  │ Hypervisor Backend │  │
│  │ (libvirt / mock)   │  │  │  │ (libvirt / mock)   │  │
│  └────────────────────┘  │  │  └────────────────────┘  │
└──────────────────────────┘  └──────────────────────────┘
            │                             │
            ▼                             ▼
     ┌───────────┐                 ┌───────────┐
     │ KVM/QEMU  │                 │ KVM/QEMU  │
     └───────────┘                 └───────────┘
```

---

## Components

### 1. VMService (`backend/internal/services/vm/service.go`)

The VMService is the primary handler for VM-related Connect-RPC requests from the frontend. It has been enhanced with Node Daemon integration.

#### Constructor Options

```go
// Basic constructor (no daemon integration, for testing)
func NewService(repo Repository, logger *zap.Logger) *Service

// Full constructor with Node Daemon integration
func NewServiceWithDaemon(
    repo       Repository,           // VM persistence
    nodeRepo   node.Repository,      // Node information
    daemonPool *node.DaemonPool,     // Connection pool
    sched      *scheduler.Scheduler, // Placement logic
    logger     *zap.Logger,
) *Service
```

#### Dependencies

| Dependency | Purpose |
|------------|---------|
| `Repository` | Persist VM state to PostgreSQL/memory |
| `node.Repository` | Get node details (IP address, status) |
| `node.DaemonPool` | Manage gRPC connections to Node Daemons |
| `scheduler.Scheduler` | Select best node for VM placement |

---

### 2. DaemonPool (`backend/internal/services/node/daemon_pool.go`)

Manages a pool of gRPC connections to multiple Node Daemons.

```go
type DaemonPool struct {
    clients map[string]*DaemonClient  // nodeID -> client
    mu      sync.RWMutex
    logger  *zap.Logger
}

// Key methods
func NewDaemonPool(logger *zap.Logger) *DaemonPool
func (p *DaemonPool) Connect(nodeID, address string) (*DaemonClient, error)
func (p *DaemonPool) Get(nodeID string) *DaemonClient
func (p *DaemonPool) Close() error
```

---

### 3. DaemonClient (`backend/internal/services/node/daemon_client.go`)

A gRPC client for a single Node Daemon.

```go
type DaemonClient struct {
    client nodev1connect.NodeDaemonServiceClient
    addr   string
    logger *zap.Logger
}

// Available operations
func (c *DaemonClient) HealthCheck(ctx context.Context) (*nodev1.HealthCheckResponse, error)
func (c *DaemonClient) GetNodeInfo(ctx context.Context) (*nodev1.NodeInfoResponse, error)
func (c *DaemonClient) CreateVM(ctx context.Context, req *nodev1.CreateVMOnNodeRequest) (*nodev1.CreateVMOnNodeResponse, error)
func (c *DaemonClient) StartVM(ctx context.Context, vmID string) error
func (c *DaemonClient) StopVM(ctx context.Context, vmID string, timeoutSeconds uint32) error
func (c *DaemonClient) ForceStopVM(ctx context.Context, vmID string) error
func (c *DaemonClient) RebootVM(ctx context.Context, vmID string) error
func (c *DaemonClient) PauseVM(ctx context.Context, vmID string) error
func (c *DaemonClient) ResumeVM(ctx context.Context, vmID string) error
func (c *DaemonClient) DeleteVM(ctx context.Context, vmID string) error
```

---

## Operation Flows

### CreateVM Flow

```
1. Frontend sends CreateVMRequest via Connect-RPC
2. VMService.CreateVM() validates the request
3. Scheduler.Schedule() selects the best node based on:
   - Available CPU/memory
   - Placement policies (affinity/anti-affinity)
   - Overcommit ratios
4. VM is persisted to PostgreSQL with status=STOPPED, node_id=<selected>
5. DaemonPool.Connect() gets/creates connection to target node
6. DaemonClient.CreateVM() sends gRPC request to Node Daemon
7. Node Daemon creates VM definition via hypervisor backend
8. Response returned to frontend
```

```go
// Simplified CreateVM flow
func (s *Service) CreateVM(ctx context.Context, req *connect.Request[computev1.CreateVMRequest]) (*connect.Response[computev1.VirtualMachine], error) {
    // 1. Validate
    if err := validateCreateRequest(req.Msg); err != nil {
        return nil, connect.NewError(connect.CodeInvalidArgument, err)
    }
    
    // 2. Schedule to a node
    result, err := s.scheduler.Schedule(ctx, req.Msg.Spec)
    if err != nil {
        // Continue without scheduling - VM created but not placed
    }
    
    // 3. Persist to database
    vm := buildDomainModel(req.Msg, result.NodeID)
    created, err := s.repo.Create(ctx, vm)
    
    // 4. Create on Node Daemon
    if s.daemonPool != nil && result != nil {
        node, _ := s.nodeRepo.Get(ctx, result.NodeID)
        client, _ := s.daemonPool.Connect(result.NodeID, node.ManagementIP+":9090")
        daemonReq := convertToNodeDaemonCreateRequest(created, req.Msg.Spec)
        client.CreateVM(ctx, daemonReq)
    }
    
    return connect.NewResponse(ToProto(created)), nil
}
```

---

### StartVM Flow

```
1. Frontend sends StartVMRequest
2. VMService retrieves VM from database
3. Validates VM can be started (state check)
4. Updates status to STARTING
5. DaemonClient.StartVM() sends gRPC to Node Daemon
6. Node Daemon starts VM via hypervisor
7. Updates status to RUNNING
8. Returns updated VM to frontend
```

```go
func (s *Service) StartVM(ctx context.Context, req *connect.Request[computev1.StartVMRequest]) (*connect.Response[computev1.VirtualMachine], error) {
    vm, _ := s.repo.Get(ctx, req.Msg.Id)
    
    if !vm.CanStart() {
        return nil, connect.NewError(connect.CodeFailedPrecondition, 
            fmt.Errorf("VM cannot be started from state '%s'", vm.Status.State))
    }
    
    // Update to STARTING
    vm.Status.State = domain.VMStateStarting
    s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
    
    // Call Node Daemon
    if s.daemonPool != nil && vm.Status.NodeID != "" {
        client := s.daemonPool.Get(vm.Status.NodeID)
        if err := client.StartVM(ctx, vm.ID); err != nil {
            // Revert status on failure
            vm.Status.State = domain.VMStateStopped
            s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
            return nil, connect.NewError(connect.CodeInternal, err)
        }
    }
    
    // Update to RUNNING
    vm.Status.State = domain.VMStateRunning
    s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
    
    return connect.NewResponse(ToProto(vm)), nil
}
```

---

### StopVM Flow

```
1. Frontend sends StopVMRequest (with optional force flag)
2. VMService retrieves VM and validates state
3. Updates status to STOPPING
4. If force=true: DaemonClient.ForceStopVM()
   Else: DaemonClient.StopVM() with timeout
5. Node Daemon stops VM via hypervisor
6. Updates status to STOPPED
```

---

### DeleteVM Flow

```
1. Frontend sends DeleteVMRequest
2. VMService checks if VM is running (fails unless force=true)
3. If VM has a node assignment:
   - DaemonClient.DeleteVM() removes from hypervisor
4. VM deleted from PostgreSQL
5. Returns success
```

---

## Error Handling

### Graceful Degradation

The VMService gracefully handles Node Daemon failures:

```go
// Example: CreateVM with daemon failure
if s.daemonPool != nil && targetNode != nil {
    client, err := s.daemonPool.Connect(targetNodeID, daemonAddr)
    if err != nil {
        logger.Warn("Failed to connect to node daemon, VM created in control plane only",
            zap.String("node_id", targetNodeID),
            zap.Error(err),
        )
        // VM exists in control plane but not on hypervisor
        // Can be retried later or manually provisioned
    } else {
        _, err := client.CreateVM(ctx, daemonReq)
        if err != nil {
            // Update VM status to reflect the issue
            created.Status.Message = "VM created but failed to provision on node"
            s.repo.UpdateStatus(ctx, created.ID, created.Status)
        }
    }
}
```

### Status Rollback on Failure

Power operations (Start/Stop) rollback status on failure:

```go
err := client.StartVM(ctx, vm.ID)
if err != nil {
    // Revert to previous state
    vm.Status.State = domain.VMStateStopped
    vm.Status.Message = fmt.Sprintf("Failed to start: %s", err)
    s.repo.UpdateStatus(ctx, vm.ID, vm.Status)
    return nil, connect.NewError(connect.CodeInternal, err)
}
```

---

## Proto Conversion

The control plane uses `computev1` protos while the Node Daemon uses `nodev1` protos. Conversion is handled by:

```go
func convertToNodeDaemonCreateRequest(vm *domain.VirtualMachine, spec *computev1.VmSpec) *nodev1.CreateVMOnNodeRequest {
    req := &nodev1.CreateVMOnNodeRequest{
        VmId:   vm.ID,
        Name:   vm.Name,
        Labels: vm.Labels,
        Spec: &nodev1.VMSpec{
            CpuCores:   spec.GetCpu().GetCores(),
            MemoryMib:  spec.GetMemory().GetSizeMib(),
            // ... more fields
        },
    }
    
    // Convert disks
    for _, disk := range spec.GetDisks() {
        req.Spec.Disks = append(req.Spec.Disks, &nodev1.DiskSpec{
            Id:       disk.GetId(),
            Path:     disk.GetVolumeId(),
            SizeGib:  disk.GetSizeGib(),
            // ...
        })
    }
    
    return req
}
```

---

## Configuration

### Server Initialization

The DaemonPool is initialized during server startup:

```go
// backend/internal/server/server.go

func (s *Server) initServices() {
    // Initialize Node Daemon connection pool
    s.daemonPool = node.NewDaemonPool(s.logger)
    
    // Create VMService with full integration
    s.vmService = vmservice.NewServiceWithDaemon(
        s.vmRepo,
        s.nodeRepo,
        s.daemonPool,
        s.scheduler,
        s.logger,
    )
}
```

### Node Daemon Port

Node Daemons listen on port **9090** by default. The control plane connects using:

```go
daemonAddr := fmt.Sprintf("%s:9090", node.ManagementIP)
client, err := s.daemonPool.Connect(nodeID, daemonAddr)
```

---

## Testing

### Unit Testing (Mock Daemon)

VMService tests can use `NewService()` without daemon integration:

```go
func TestCreateVM(t *testing.T) {
    repo := memory.NewVMRepository()
    svc := vm.NewService(repo, zap.NewNop())
    
    // Test without Node Daemon calls
    resp, err := svc.CreateVM(ctx, req)
    // ...
}
```

### Integration Testing

Full integration testing requires:

1. Start Node Daemon on port 9090
2. Start Control Plane
3. Create a VM via API
4. Verify VM appears on Node Daemon

```bash
# Terminal 1: Node Daemon
cd agent && cargo run --bin limiquantix-node -- --dev --listen 127.0.0.1:9090

# Terminal 2: Control Plane
cd backend && go run ./cmd/controlplane --dev

# Terminal 3: Test
curl -X POST http://127.0.0.1:8080/limiquantix.compute.v1.VMService/CreateVM \
  -H "Content-Type: application/json" \
  -d '{"name": "test-vm", "spec": {"cpu": {"cores": 2}, "memory": {"size_mib": 2048}}}'
```

---

## Future Enhancements

1. **Connection Health Checks**: Periodic ping to detect dead connections
2. **Auto-Reconnection**: Automatically reconnect on transient failures
3. **Circuit Breaker**: Prevent cascading failures when Node Daemon is down
4. **Metrics**: Track gRPC call latency and error rates
5. **TLS**: Mutual TLS for secure communication

---

## Related Documents

- [000007 - Hypervisor Integration ADR](adr/000007-hypervisor-integration.md)
- [000031 - Node Daemon Implementation Plan](000031-node-daemon-implementation-plan.md)
- [000005 - gRPC Services Design](adr/000005-grpc-services-design.md)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| `computev1` | Control Plane proto package |
| `nodev1` | Node Daemon proto package |
| `Connect-RPC` | Frontend-to-Backend protocol |
| `gRPC` | Backend-to-Agent protocol |

