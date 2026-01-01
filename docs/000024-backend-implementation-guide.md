# LimiQuantix Backend Implementation Guide

**Document ID:** 000024  
**Purpose:** Detailed implementation guide for Backend Phases 2-4  
**Prerequisites:** Backend Phase 1 (Foundation) must be complete

---

## Table of Contents

1. [Phase 2: Core Services](#phase-2-core-services)
2. [Phase 3: Data Persistence](#phase-3-data-persistence)
3. [Phase 4: Advanced Features](#phase-4-advanced-features)
4. [Testing Strategy](#testing-strategy)
5. [Deployment Checklist](#deployment-checklist)

---

## Phase 2: Core Services

**Objective:** Implement the primary gRPC/Connect-RPC services for managing virtualized resources.

### 2.1 VM Service Implementation

**File:** `internal/services/vm/service.go`

#### Required Methods

| Method | Priority | Description |
|--------|----------|-------------|
| `CreateVM` | P0 | Create a new virtual machine |
| `GetVM` | P0 | Retrieve VM by ID |
| `ListVMs` | P0 | List VMs with filtering/pagination |
| `UpdateVM` | P0 | Update VM specification |
| `DeleteVM` | P0 | Delete a VM |
| `StartVM` | P0 | Power on a VM |
| `StopVM` | P0 | Power off a VM |
| `RebootVM` | P1 | Reboot a VM |
| `SuspendVM` | P1 | Suspend VM state |
| `ResumeVM` | P1 | Resume suspended VM |
| `CreateSnapshot` | P1 | Create VM snapshot |
| `ListSnapshots` | P1 | List VM snapshots |
| `RevertSnapshot` | P2 | Revert to snapshot |
| `MigrateVM` | P2 | Live migrate to another host |
| `WatchVM` | P2 | Stream VM state changes |

#### Implementation Steps

1. **Create Service Interface**

```go
// internal/services/vm/interface.go
package vm

import (
    "context"
    
    "connectrpc.com/connect"
    computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
)

type Service interface {
    CreateVM(ctx context.Context, req *connect.Request[computev1.CreateVMRequest]) (*connect.Response[computev1.VirtualMachine], error)
    GetVM(ctx context.Context, req *connect.Request[computev1.GetVMRequest]) (*connect.Response[computev1.VirtualMachine], error)
    ListVMs(ctx context.Context, req *connect.Request[computev1.ListVMsRequest]) (*connect.Response[computev1.ListVMsResponse], error)
    UpdateVM(ctx context.Context, req *connect.Request[computev1.UpdateVMRequest]) (*connect.Response[computev1.VirtualMachine], error)
    DeleteVM(ctx context.Context, req *connect.Request[computev1.DeleteVMRequest]) (*connect.Response[computev1.Empty], error)
    StartVM(ctx context.Context, req *connect.Request[computev1.StartVMRequest]) (*connect.Response[computev1.VirtualMachine], error)
    StopVM(ctx context.Context, req *connect.Request[computev1.StopVMRequest]) (*connect.Response[computev1.VirtualMachine], error)
}
```

2. **Implement Repository Interface**

```go
// internal/services/vm/repository.go
package vm

import (
    "context"
    
    "github.com/limiquantix/limiquantix/internal/domain"
)

type Repository interface {
    Create(ctx context.Context, vm *domain.VM) (*domain.VM, error)
    Get(ctx context.Context, id string) (*domain.VM, error)
    List(ctx context.Context, filter domain.VMFilter, limit int, offset string) ([]*domain.VM, int64, error)
    Update(ctx context.Context, vm *domain.VM) (*domain.VM, error)
    Delete(ctx context.Context, id string) error
    UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error
}
```

3. **Create Service Implementation**

```go
// internal/services/vm/service.go
package vm

import (
    "context"
    "fmt"
    
    "connectrpc.com/connect"
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/domain"
    computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
)

type VMService struct {
    repo      Repository
    scheduler Scheduler
    events    EventPublisher
    logger    *zap.Logger
}

func NewService(repo Repository, scheduler Scheduler, events EventPublisher, logger *zap.Logger) *VMService {
    return &VMService{
        repo:      repo,
        scheduler: scheduler,
        events:    events,
        logger:    logger,
    }
}

func (s *VMService) CreateVM(
    ctx context.Context,
    req *connect.Request[computev1.CreateVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
    logger := s.logger.With(
        zap.String("method", "CreateVM"),
        zap.String("vm_name", req.Msg.Name),
    )
    
    logger.Info("Creating VM")
    
    // 1. Validate request
    if err := validateCreateRequest(req.Msg); err != nil {
        logger.Warn("Invalid request", zap.Error(err))
        return nil, connect.NewError(connect.CodeInvalidArgument, err)
    }
    
    // 2. Schedule placement (find best host)
    hostID, err := s.scheduler.Schedule(ctx, req.Msg.Spec)
    if err != nil {
        logger.Error("Scheduling failed", zap.Error(err))
        return nil, connect.NewError(connect.CodeResourceExhausted, err)
    }
    
    // 3. Create VM in database
    vm := &domain.VM{
        Name:        req.Msg.Name,
        ProjectID:   req.Msg.ProjectId,
        Description: req.Msg.Description,
        Labels:      req.Msg.Labels,
        Spec:        convertSpec(req.Msg.Spec),
        Status: domain.VMStatus{
            State:  domain.VMStatePending,
            NodeID: hostID,
        },
    }
    
    created, err := s.repo.Create(ctx, vm)
    if err != nil {
        logger.Error("Database create failed", zap.Error(err))
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    // 4. Publish event
    s.events.Publish(ctx, domain.EventVMCreated{
        VMID:   created.ID,
        Name:   created.Name,
        NodeID: hostID,
    })
    
    logger.Info("VM created successfully", zap.String("vm_id", created.ID))
    
    return connect.NewResponse(convertToProto(created)), nil
}

// ... implement other methods
```

4. **Register Service in Server**

```go
// internal/server/server.go - add to registerRoutes()
func (s *Server) registerRoutes() {
    // ... existing routes
    
    // VM Service
    vmService := vm.NewService(s.repos.VM, s.scheduler, s.events, s.logger)
    path, handler := computev1connect.NewVMServiceHandler(vmService)
    s.mux.Handle(path, handler)
}
```

#### Validation Rules

```go
// internal/services/vm/validation.go
func validateCreateRequest(req *computev1.CreateVMRequest) error {
    if req.Name == "" {
        return fmt.Errorf("name is required")
    }
    if len(req.Name) > 255 {
        return fmt.Errorf("name too long (max 255 characters)")
    }
    if req.Spec == nil {
        return fmt.Errorf("spec is required")
    }
    if req.Spec.Cpu == nil || req.Spec.Cpu.Cores < 1 {
        return fmt.Errorf("at least 1 CPU core is required")
    }
    if req.Spec.Memory == nil || req.Spec.Memory.SizeMib < 512 {
        return fmt.Errorf("at least 512 MiB memory is required")
    }
    return nil
}
```

---

### 2.2 Node Service Implementation

**File:** `internal/services/node/service.go`

#### Required Methods

| Method | Priority | Description |
|--------|----------|-------------|
| `RegisterNode` | P0 | Agent registers with control plane |
| `GetNode` | P0 | Retrieve node by ID |
| `ListNodes` | P0 | List all nodes |
| `UpdateNode` | P0 | Update node labels/spec |
| `Heartbeat` | P0 | Agent heartbeat |
| `DrainNode` | P1 | Prepare node for maintenance |
| `CordonNode` | P1 | Mark node unschedulable |
| `UncordonNode` | P1 | Mark node schedulable |
| `DeleteNode` | P1 | Remove node from cluster |
| `GetNodeMetrics` | P2 | Get real-time metrics |
| `WatchNode` | P2 | Stream node state changes |

#### Implementation Steps

1. **Node Registration Flow**

```go
func (s *NodeService) RegisterNode(
    ctx context.Context,
    req *connect.Request[computev1.RegisterNodeRequest],
) (*connect.Response[computev1.Node], error) {
    logger := s.logger.With(
        zap.String("hostname", req.Msg.Hostname),
        zap.String("ip", req.Msg.ManagementIp),
    )
    
    logger.Info("Node registration request")
    
    // 1. Validate node doesn't already exist
    existing, err := s.repo.GetByHostname(ctx, req.Msg.Hostname)
    if err == nil && existing != nil {
        // Update existing node
        existing.Spec = convertSpec(req.Msg.Spec)
        existing.Status.Phase = domain.NodePhaseReady
        existing.LastHeartbeat = time.Now()
        
        updated, err := s.repo.Update(ctx, existing)
        if err != nil {
            return nil, connect.NewError(connect.CodeInternal, err)
        }
        
        logger.Info("Node re-registered", zap.String("node_id", updated.ID))
        return connect.NewResponse(convertToProto(updated)), nil
    }
    
    // 2. Create new node
    node := &domain.Node{
        Hostname:     req.Msg.Hostname,
        ManagementIP: req.Msg.ManagementIp,
        Labels:       req.Msg.Labels,
        Spec:         convertSpec(req.Msg.Spec),
        Status: domain.NodeStatus{
            Phase:     domain.NodePhaseReady,
            Conditions: []domain.Condition{},
        },
        LastHeartbeat: time.Now(),
    }
    
    created, err := s.repo.Create(ctx, node)
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    // 3. Publish event
    s.events.Publish(ctx, domain.EventNodeRegistered{
        NodeID:   created.ID,
        Hostname: created.Hostname,
    })
    
    logger.Info("Node registered", zap.String("node_id", created.ID))
    return connect.NewResponse(convertToProto(created)), nil
}
```

2. **Heartbeat Handler**

```go
func (s *NodeService) Heartbeat(
    ctx context.Context,
    req *connect.Request[computev1.HeartbeatRequest],
) (*connect.Response[computev1.HeartbeatResponse], error) {
    nodeID := req.Msg.NodeId
    
    // Update last heartbeat and resources
    err := s.repo.UpdateHeartbeat(ctx, nodeID, domain.NodeResources{
        CPUUsed:    req.Msg.Resources.CpuUsedMillicores,
        MemoryUsed: req.Msg.Resources.MemoryUsedBytes,
        DiskUsed:   req.Msg.Resources.DiskUsedBytes,
    })
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    // Return any pending commands for the agent
    commands, err := s.getAgentCommands(ctx, nodeID)
    if err != nil {
        s.logger.Warn("Failed to get agent commands", zap.Error(err))
    }
    
    return connect.NewResponse(&computev1.HeartbeatResponse{
        Commands:      commands,
        NextHeartbeat: durationpb.New(30 * time.Second),
    }), nil
}
```

3. **Node Health Monitor**

```go
// internal/services/node/health.go
type HealthMonitor struct {
    repo     Repository
    events   EventPublisher
    logger   *zap.Logger
    timeout  time.Duration
    interval time.Duration
}

func (h *HealthMonitor) Start(ctx context.Context) {
    ticker := time.NewTicker(h.interval)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            h.checkNodes(ctx)
        }
    }
}

func (h *HealthMonitor) checkNodes(ctx context.Context) {
    nodes, err := h.repo.ListAll(ctx)
    if err != nil {
        h.logger.Error("Failed to list nodes", zap.Error(err))
        return
    }
    
    for _, node := range nodes {
        if time.Since(node.LastHeartbeat) > h.timeout {
            if node.Status.Phase != domain.NodePhaseNotReady {
                h.logger.Warn("Node unresponsive",
                    zap.String("node_id", node.ID),
                    zap.Duration("last_seen", time.Since(node.LastHeartbeat)),
                )
                
                // Update status
                node.Status.Phase = domain.NodePhaseNotReady
                h.repo.UpdateStatus(ctx, node.ID, node.Status)
                
                // Publish event
                h.events.Publish(ctx, domain.EventNodeUnhealthy{
                    NodeID:   node.ID,
                    Hostname: node.Hostname,
                    Reason:   "heartbeat timeout",
                })
            }
        }
    }
}
```

---

### 2.3 Storage Service Implementation

**File:** `internal/services/storage/service.go`

#### Required Methods

| Method | Priority | Description |
|--------|----------|-------------|
| `CreatePool` | P0 | Create storage pool |
| `GetPool` | P0 | Get pool by ID |
| `ListPools` | P0 | List storage pools |
| `DeletePool` | P1 | Delete pool |
| `GetPoolMetrics` | P1 | Get pool capacity/usage |
| `CreateVolume` | P0 | Create new volume |
| `GetVolume` | P0 | Get volume by ID |
| `ListVolumes` | P0 | List volumes |
| `AttachVolume` | P0 | Attach volume to VM |
| `DetachVolume` | P0 | Detach volume from VM |
| `ResizeVolume` | P1 | Expand volume |
| `DeleteVolume` | P0 | Delete volume |
| `CloneVolume` | P2 | Clone a volume |

#### Volume Lifecycle

```
CREATING → AVAILABLE → IN_USE → AVAILABLE → DELETING → (deleted)
                ↓                    ↓
              ERROR              DETACHING
```

#### Implementation Pattern

```go
// internal/services/storage/volume_service.go
func (s *VolumeService) CreateVolume(
    ctx context.Context,
    req *connect.Request[storagev1.CreateVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
    logger := s.logger.With(
        zap.String("volume_name", req.Msg.Name),
        zap.String("pool_id", req.Msg.PoolId),
    )
    
    // 1. Get pool and validate capacity
    pool, err := s.poolRepo.Get(ctx, req.Msg.PoolId)
    if err != nil {
        return nil, connect.NewError(connect.CodeNotFound, err)
    }
    
    available := pool.CapacityBytes - pool.UsedBytes
    if req.Msg.SizeBytes > available {
        return nil, connect.NewError(connect.CodeResourceExhausted, 
            fmt.Errorf("insufficient capacity: need %d, available %d", 
                req.Msg.SizeBytes, available))
    }
    
    // 2. Create volume record
    volume := &domain.Volume{
        Name:         req.Msg.Name,
        PoolID:       req.Msg.PoolId,
        SizeBytes:    req.Msg.SizeBytes,
        Provisioning: domain.ProvisioningThin,
        Status: domain.VolumeStatus{
            Phase: domain.VolumePhaseCreating,
        },
    }
    
    created, err := s.volumeRepo.Create(ctx, volume)
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    // 3. Call storage backend (async)
    go func() {
        if err := s.backend.CreateVolume(context.Background(), pool, created); err != nil {
            s.logger.Error("Backend volume creation failed", zap.Error(err))
            s.volumeRepo.UpdateStatus(context.Background(), created.ID, domain.VolumePhaseError)
            return
        }
        s.volumeRepo.UpdateStatus(context.Background(), created.ID, domain.VolumePhaseAvailable)
    }()
    
    logger.Info("Volume creation initiated", zap.String("volume_id", created.ID))
    return connect.NewResponse(convertToProto(created)), nil
}
```

---

### 2.4 Network Service Implementation

**File:** `internal/services/network/service.go`

#### Required Methods

| Method | Priority | Description |
|--------|----------|-------------|
| `CreateNetwork` | P0 | Create virtual network |
| `GetNetwork` | P0 | Get network by ID |
| `ListNetworks` | P0 | List networks |
| `DeleteNetwork` | P0 | Delete network |
| `CreateSecurityGroup` | P0 | Create security group |
| `GetSecurityGroup` | P0 | Get security group |
| `ListSecurityGroups` | P0 | List security groups |
| `AddRule` | P0 | Add firewall rule |
| `RemoveRule` | P0 | Remove firewall rule |
| `DeleteSecurityGroup` | P0 | Delete security group |
| `AssignSecurityGroup` | P1 | Assign SG to VM/port |

---

### 2.5 Scheduler Implementation

**File:** `internal/scheduler/scheduler.go`

The scheduler determines which host should run a new VM.

```go
// internal/scheduler/scheduler.go
type Scheduler struct {
    nodeRepo  NodeRepository
    vmRepo    VMRepository
    config    SchedulerConfig
    logger    *zap.Logger
}

type SchedulerConfig struct {
    PlacementStrategy string  // "spread" or "pack"
    OvercommitCPU     float64
    OvercommitMemory  float64
}

func (s *Scheduler) Schedule(ctx context.Context, spec *computev1.VmSpec) (string, error) {
    // 1. Get all schedulable nodes
    nodes, err := s.nodeRepo.ListSchedulable(ctx)
    if err != nil {
        return "", fmt.Errorf("failed to list nodes: %w", err)
    }
    
    if len(nodes) == 0 {
        return "", fmt.Errorf("no schedulable nodes available")
    }
    
    // 2. Filter nodes by predicates
    var feasible []*domain.Node
    for _, node := range nodes {
        if s.checkPredicates(ctx, node, spec) {
            feasible = append(feasible, node)
        }
    }
    
    if len(feasible) == 0 {
        return "", fmt.Errorf("no nodes satisfy scheduling requirements")
    }
    
    // 3. Score and rank nodes
    var best *domain.Node
    var bestScore float64
    
    for _, node := range feasible {
        score := s.scoreNode(ctx, node, spec)
        if best == nil || score > bestScore {
            best = node
            bestScore = score
        }
    }
    
    s.logger.Info("Scheduled VM",
        zap.String("node_id", best.ID),
        zap.String("hostname", best.Hostname),
        zap.Float64("score", bestScore),
    )
    
    return best.ID, nil
}

func (s *Scheduler) checkPredicates(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) bool {
    // Check CPU capacity
    allocatableCPU := float64(node.Spec.CPUCores) * s.config.OvercommitCPU
    usedCPU := s.getNodeCPUUsage(ctx, node.ID)
    if float64(spec.Cpu.Cores) > (allocatableCPU - usedCPU) {
        return false
    }
    
    // Check memory capacity
    allocatableMem := float64(node.Spec.MemoryMiB) * s.config.OvercommitMemory
    usedMem := s.getNodeMemoryUsage(ctx, node.ID)
    if float64(spec.Memory.SizeMib) > (allocatableMem - usedMem) {
        return false
    }
    
    // Check node labels/taints
    if !s.checkAffinity(node, spec) {
        return false
    }
    
    return true
}

func (s *Scheduler) scoreNode(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) float64 {
    switch s.config.PlacementStrategy {
    case "spread":
        // Prefer nodes with fewer VMs (spread load)
        vmCount := s.getNodeVMCount(ctx, node.ID)
        return 100.0 - float64(vmCount)
    case "pack":
        // Prefer nodes with more VMs (consolidate)
        vmCount := s.getNodeVMCount(ctx, node.ID)
        return float64(vmCount)
    default:
        return 50.0
    }
}
```

---

## Phase 3: Data Persistence

**Objective:** Integrate PostgreSQL, Redis, and etcd for state management.

### 3.1 PostgreSQL Repository Layer

**Directory:** `internal/repository/postgres/`

#### Setup pgx Connection Pool

```go
// internal/repository/postgres/db.go
package postgres

import (
    "context"
    "fmt"
    
    "github.com/jackc/pgx/v5/pgxpool"
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/config"
)

type DB struct {
    pool   *pgxpool.Pool
    logger *zap.Logger
}

func NewDB(ctx context.Context, cfg config.DatabaseConfig, logger *zap.Logger) (*DB, error) {
    dsn := fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Name, cfg.SSLMode,
    )
    
    poolConfig, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, fmt.Errorf("failed to parse config: %w", err)
    }
    
    poolConfig.MaxConns = int32(cfg.MaxOpenConns)
    poolConfig.MinConns = int32(cfg.MaxIdleConns)
    poolConfig.MaxConnLifetime = cfg.ConnMaxLifetime
    
    pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
    if err != nil {
        return nil, fmt.Errorf("failed to create pool: %w", err)
    }
    
    // Test connection
    if err := pool.Ping(ctx); err != nil {
        return nil, fmt.Errorf("failed to ping database: %w", err)
    }
    
    logger.Info("Connected to PostgreSQL",
        zap.String("host", cfg.Host),
        zap.Int("port", cfg.Port),
        zap.String("database", cfg.Name),
    )
    
    return &DB{pool: pool, logger: logger}, nil
}

func (db *DB) Close() {
    db.pool.Close()
}
```

#### VM Repository Implementation

```go
// internal/repository/postgres/vm_repository.go
package postgres

import (
    "context"
    "encoding/json"
    "fmt"
    
    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    
    "github.com/limiquantix/limiquantix/internal/domain"
)

type VMRepository struct {
    db *DB
}

func NewVMRepository(db *DB) *VMRepository {
    return &VMRepository{db: db}
}

func (r *VMRepository) Create(ctx context.Context, vm *domain.VM) (*domain.VM, error) {
    vm.ID = uuid.New().String()
    
    specJSON, err := json.Marshal(vm.Spec)
    if err != nil {
        return nil, fmt.Errorf("failed to marshal spec: %w", err)
    }
    
    labelsJSON, err := json.Marshal(vm.Labels)
    if err != nil {
        return nil, fmt.Errorf("failed to marshal labels: %w", err)
    }
    
    query := `
        INSERT INTO virtual_machines (
            id, name, project_id, description, labels, spec, 
            power_state, node_id, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING created_at, updated_at
    `
    
    err = r.db.pool.QueryRow(ctx, query,
        vm.ID,
        vm.Name,
        vm.ProjectID,
        vm.Description,
        labelsJSON,
        specJSON,
        vm.Status.State,
        vm.Status.NodeID,
        vm.CreatedBy,
    ).Scan(&vm.CreatedAt, &vm.UpdatedAt)
    
    if err != nil {
        return nil, fmt.Errorf("failed to insert VM: %w", err)
    }
    
    return vm, nil
}

func (r *VMRepository) Get(ctx context.Context, id string) (*domain.VM, error) {
    query := `
        SELECT id, name, project_id, description, labels, spec,
               power_state, node_id, ip_addresses, resources,
               created_at, updated_at, created_by
        FROM virtual_machines
        WHERE id = $1
    `
    
    var vm domain.VM
    var labelsJSON, specJSON, ipAddressesJSON, resourcesJSON []byte
    
    err := r.db.pool.QueryRow(ctx, query, id).Scan(
        &vm.ID,
        &vm.Name,
        &vm.ProjectID,
        &vm.Description,
        &labelsJSON,
        &specJSON,
        &vm.Status.State,
        &vm.Status.NodeID,
        &ipAddressesJSON,
        &resourcesJSON,
        &vm.CreatedAt,
        &vm.UpdatedAt,
        &vm.CreatedBy,
    )
    
    if err == pgx.ErrNoRows {
        return nil, domain.ErrNotFound
    }
    if err != nil {
        return nil, fmt.Errorf("failed to get VM: %w", err)
    }
    
    // Unmarshal JSON fields
    if len(labelsJSON) > 0 {
        json.Unmarshal(labelsJSON, &vm.Labels)
    }
    if len(specJSON) > 0 {
        json.Unmarshal(specJSON, &vm.Spec)
    }
    
    return &vm, nil
}

func (r *VMRepository) List(ctx context.Context, filter domain.VMFilter, limit int, cursor string) ([]*domain.VM, int64, error) {
    // Build dynamic query based on filter
    query := `
        SELECT id, name, project_id, description, labels, spec,
               power_state, node_id, ip_addresses,
               created_at, updated_at
        FROM virtual_machines
        WHERE 1=1
    `
    args := []interface{}{}
    argNum := 1
    
    if filter.ProjectID != "" {
        query += fmt.Sprintf(" AND project_id = $%d", argNum)
        args = append(args, filter.ProjectID)
        argNum++
    }
    
    if len(filter.States) > 0 {
        query += fmt.Sprintf(" AND power_state = ANY($%d)", argNum)
        args = append(args, filter.States)
        argNum++
    }
    
    // Cursor-based pagination
    if cursor != "" {
        query += fmt.Sprintf(" AND id > $%d", argNum)
        args = append(args, cursor)
        argNum++
    }
    
    query += " ORDER BY id"
    query += fmt.Sprintf(" LIMIT $%d", argNum)
    args = append(args, limit)
    
    rows, err := r.db.pool.Query(ctx, query, args...)
    if err != nil {
        return nil, 0, fmt.Errorf("failed to list VMs: %w", err)
    }
    defer rows.Close()
    
    var vms []*domain.VM
    for rows.Next() {
        vm := &domain.VM{}
        var labelsJSON, specJSON, ipAddressesJSON []byte
        
        err := rows.Scan(
            &vm.ID,
            &vm.Name,
            &vm.ProjectID,
            &vm.Description,
            &labelsJSON,
            &specJSON,
            &vm.Status.State,
            &vm.Status.NodeID,
            &ipAddressesJSON,
            &vm.CreatedAt,
            &vm.UpdatedAt,
        )
        if err != nil {
            return nil, 0, err
        }
        
        if len(labelsJSON) > 0 {
            json.Unmarshal(labelsJSON, &vm.Labels)
        }
        if len(specJSON) > 0 {
            json.Unmarshal(specJSON, &vm.Spec)
        }
        
        vms = append(vms, vm)
    }
    
    // Get total count
    countQuery := "SELECT COUNT(*) FROM virtual_machines WHERE project_id = $1"
    var total int64
    r.db.pool.QueryRow(ctx, countQuery, filter.ProjectID).Scan(&total)
    
    return vms, total, nil
}

func (r *VMRepository) UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error {
    query := `
        UPDATE virtual_machines
        SET power_state = $2, node_id = $3, ip_addresses = $4
        WHERE id = $1
    `
    
    ipJSON, _ := json.Marshal(status.IPAddresses)
    
    _, err := r.db.pool.Exec(ctx, query, id, status.State, status.NodeID, ipJSON)
    return err
}

func (r *VMRepository) Delete(ctx context.Context, id string) error {
    query := "DELETE FROM virtual_machines WHERE id = $1"
    result, err := r.db.pool.Exec(ctx, query, id)
    if err != nil {
        return fmt.Errorf("failed to delete VM: %w", err)
    }
    
    if result.RowsAffected() == 0 {
        return domain.ErrNotFound
    }
    
    return nil
}
```

---

### 3.2 Redis Cache Layer

**File:** `internal/repository/redis/cache.go`

```go
// internal/repository/redis/cache.go
package redis

import (
    "context"
    "encoding/json"
    "fmt"
    "time"
    
    "github.com/redis/go-redis/v9"
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/config"
)

type Cache struct {
    client *redis.Client
    logger *zap.Logger
}

func NewCache(cfg config.RedisConfig, logger *zap.Logger) (*Cache, error) {
    client := redis.NewClient(&redis.Options{
        Addr:     cfg.Address(),
        Password: cfg.Password,
        DB:       cfg.DB,
    })
    
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    
    if err := client.Ping(ctx).Err(); err != nil {
        return nil, fmt.Errorf("failed to connect to Redis: %w", err)
    }
    
    logger.Info("Connected to Redis", zap.String("addr", cfg.Address()))
    
    return &Cache{client: client, logger: logger}, nil
}

// Generic cache methods
func (c *Cache) Get(ctx context.Context, key string, dest interface{}) error {
    val, err := c.client.Get(ctx, key).Result()
    if err == redis.Nil {
        return ErrCacheMiss
    }
    if err != nil {
        return err
    }
    
    return json.Unmarshal([]byte(val), dest)
}

func (c *Cache) Set(ctx context.Context, key string, value interface{}, ttl time.Duration) error {
    data, err := json.Marshal(value)
    if err != nil {
        return err
    }
    
    return c.client.Set(ctx, key, data, ttl).Err()
}

func (c *Cache) Delete(ctx context.Context, key string) error {
    return c.client.Del(ctx, key).Err()
}

// VM-specific cache methods
func (c *Cache) GetVM(ctx context.Context, id string) (*domain.VM, error) {
    key := fmt.Sprintf("vm:%s", id)
    var vm domain.VM
    if err := c.Get(ctx, key, &vm); err != nil {
        return nil, err
    }
    return &vm, nil
}

func (c *Cache) SetVM(ctx context.Context, vm *domain.VM) error {
    key := fmt.Sprintf("vm:%s", vm.ID)
    return c.Set(ctx, key, vm, 5*time.Minute)
}

func (c *Cache) InvalidateVM(ctx context.Context, id string) error {
    key := fmt.Sprintf("vm:%s", id)
    return c.Delete(ctx, key)
}

// Pub/Sub for real-time updates
func (c *Cache) Publish(ctx context.Context, channel string, message interface{}) error {
    data, err := json.Marshal(message)
    if err != nil {
        return err
    }
    return c.client.Publish(ctx, channel, data).Err()
}

func (c *Cache) Subscribe(ctx context.Context, channel string) <-chan *redis.Message {
    pubsub := c.client.Subscribe(ctx, channel)
    return pubsub.Channel()
}

var ErrCacheMiss = fmt.Errorf("cache miss")
```

---

### 3.3 etcd Integration

**File:** `internal/repository/etcd/client.go`

```go
// internal/repository/etcd/client.go
package etcd

import (
    "context"
    "encoding/json"
    "fmt"
    "time"
    
    "go.etcd.io/etcd/client/v3"
    "go.etcd.io/etcd/client/v3/concurrency"
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/config"
)

type Client struct {
    client  *clientv3.Client
    session *concurrency.Session
    logger  *zap.Logger
}

func NewClient(cfg config.EtcdConfig, logger *zap.Logger) (*Client, error) {
    client, err := clientv3.New(clientv3.Config{
        Endpoints:   cfg.Endpoints,
        DialTimeout: cfg.DialTimeout,
        Username:    cfg.Username,
        Password:    cfg.Password,
    })
    if err != nil {
        return nil, fmt.Errorf("failed to connect to etcd: %w", err)
    }
    
    session, err := concurrency.NewSession(client)
    if err != nil {
        return nil, fmt.Errorf("failed to create session: %w", err)
    }
    
    logger.Info("Connected to etcd", zap.Strings("endpoints", cfg.Endpoints))
    
    return &Client{
        client:  client,
        session: session,
        logger:  logger,
    }, nil
}

// Key-Value operations
func (c *Client) Put(ctx context.Context, key string, value interface{}) error {
    data, err := json.Marshal(value)
    if err != nil {
        return err
    }
    _, err = c.client.Put(ctx, key, string(data))
    return err
}

func (c *Client) Get(ctx context.Context, key string, dest interface{}) error {
    resp, err := c.client.Get(ctx, key)
    if err != nil {
        return err
    }
    if len(resp.Kvs) == 0 {
        return ErrKeyNotFound
    }
    return json.Unmarshal(resp.Kvs[0].Value, dest)
}

func (c *Client) Delete(ctx context.Context, key string) error {
    _, err := c.client.Delete(ctx, key)
    return err
}

// Watch for changes
func (c *Client) Watch(ctx context.Context, key string) <-chan WatchEvent {
    events := make(chan WatchEvent, 10)
    
    go func() {
        defer close(events)
        
        watchCh := c.client.Watch(ctx, key, clientv3.WithPrefix())
        for resp := range watchCh {
            for _, ev := range resp.Events {
                events <- WatchEvent{
                    Type:  ev.Type.String(),
                    Key:   string(ev.Kv.Key),
                    Value: ev.Kv.Value,
                }
            }
        }
    }()
    
    return events
}

type WatchEvent struct {
    Type  string
    Key   string
    Value []byte
}

// Distributed locking
func (c *Client) Lock(ctx context.Context, key string) (*Lock, error) {
    mutex := concurrency.NewMutex(c.session, key)
    
    if err := mutex.Lock(ctx); err != nil {
        return nil, fmt.Errorf("failed to acquire lock: %w", err)
    }
    
    return &Lock{mutex: mutex}, nil
}

type Lock struct {
    mutex *concurrency.Mutex
}

func (l *Lock) Unlock(ctx context.Context) error {
    return l.mutex.Unlock(ctx)
}

// Leader election
func (c *Client) CampaignForLeader(ctx context.Context, name string) (*Leader, error) {
    election := concurrency.NewElection(c.session, fmt.Sprintf("/leaders/%s", name))
    
    if err := election.Campaign(ctx, c.session.Lease().String()); err != nil {
        return nil, fmt.Errorf("failed to campaign: %w", err)
    }
    
    c.logger.Info("Became leader", zap.String("name", name))
    
    return &Leader{election: election}, nil
}

type Leader struct {
    election *concurrency.Election
}

func (l *Leader) Resign(ctx context.Context) error {
    return l.election.Resign(ctx)
}

var ErrKeyNotFound = fmt.Errorf("key not found")
```

---

### 3.4 Database Migrations

**File:** `cmd/migrate/main.go`

```go
// cmd/migrate/main.go
package main

import (
    "flag"
    "fmt"
    "log"
    "os"
    
    "github.com/golang-migrate/migrate/v4"
    _ "github.com/golang-migrate/migrate/v4/database/postgres"
    _ "github.com/golang-migrate/migrate/v4/source/file"
    
    "github.com/limiquantix/limiquantix/internal/config"
)

func main() {
    cfg, err := config.Load("")
    if err != nil {
        log.Fatalf("Failed to load config: %v", err)
    }
    
    dsn := fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        cfg.Database.User,
        cfg.Database.Password,
        cfg.Database.Host,
        cfg.Database.Port,
        cfg.Database.Name,
        cfg.Database.SSLMode,
    )
    
    m, err := migrate.New("file://migrations", dsn)
    if err != nil {
        log.Fatalf("Failed to create migrator: %v", err)
    }
    defer m.Close()
    
    cmd := flag.Arg(0)
    switch cmd {
    case "up":
        if err := m.Up(); err != nil && err != migrate.ErrNoChange {
            log.Fatalf("Migration up failed: %v", err)
        }
        fmt.Println("Migrations applied successfully")
        
    case "down":
        if err := m.Down(); err != nil && err != migrate.ErrNoChange {
            log.Fatalf("Migration down failed: %v", err)
        }
        fmt.Println("Migrations rolled back")
        
    case "version":
        version, dirty, err := m.Version()
        if err != nil {
            log.Fatalf("Failed to get version: %v", err)
        }
        fmt.Printf("Version: %d, Dirty: %v\n", version, dirty)
        
    default:
        fmt.Println("Usage: migrate [up|down|version]")
        os.Exit(1)
    }
}
```

---

## Phase 4: Advanced Features

**Objective:** Implement authentication, monitoring, alerting, DRS, HA, and streaming.

### 4.1 JWT Authentication

**File:** `internal/services/auth/jwt.go`

```go
// internal/services/auth/jwt.go
package auth

import (
    "fmt"
    "time"
    
    "github.com/golang-jwt/jwt/v5"
    
    "github.com/limiquantix/limiquantix/internal/config"
    "github.com/limiquantix/limiquantix/internal/domain"
)

type JWTManager struct {
    secret        []byte
    tokenExpiry   time.Duration
    refreshExpiry time.Duration
}

type Claims struct {
    UserID   string `json:"user_id"`
    Username string `json:"username"`
    Email    string `json:"email"`
    Role     string `json:"role"`
    jwt.RegisteredClaims
}

func NewJWTManager(cfg config.AuthConfig) *JWTManager {
    return &JWTManager{
        secret:        []byte(cfg.JWTSecret),
        tokenExpiry:   cfg.TokenExpiry,
        refreshExpiry: cfg.RefreshExpiry,
    }
}

func (m *JWTManager) Generate(user *domain.User) (accessToken, refreshToken string, err error) {
    // Access token
    accessClaims := &Claims{
        UserID:   user.ID,
        Username: user.Username,
        Email:    user.Email,
        Role:     user.Role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.tokenExpiry)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Subject:   user.ID,
        },
    }
    
    access := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
    accessToken, err = access.SignedString(m.secret)
    if err != nil {
        return "", "", fmt.Errorf("failed to sign access token: %w", err)
    }
    
    // Refresh token
    refreshClaims := &Claims{
        UserID: user.ID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.refreshExpiry)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
            Subject:   user.ID,
        },
    }
    
    refresh := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
    refreshToken, err = refresh.SignedString(m.secret)
    if err != nil {
        return "", "", fmt.Errorf("failed to sign refresh token: %w", err)
    }
    
    return accessToken, refreshToken, nil
}

func (m *JWTManager) Verify(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
        if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
        }
        return m.secret, nil
    })
    
    if err != nil {
        return nil, fmt.Errorf("failed to parse token: %w", err)
    }
    
    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, fmt.Errorf("invalid token")
    }
    
    return claims, nil
}
```

### 4.2 Auth Middleware

```go
// internal/server/middleware/auth.go
package middleware

import (
    "context"
    "errors"
    "strings"
    
    "connectrpc.com/connect"
    
    "github.com/limiquantix/limiquantix/internal/services/auth"
)

type contextKey string

const ClaimsKey contextKey = "claims"

func NewAuthInterceptor(jwtManager *auth.JWTManager) connect.UnaryInterceptorFunc {
    return func(next connect.UnaryFunc) connect.UnaryFunc {
        return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
            // Skip auth for public endpoints
            if isPublicEndpoint(req.Spec().Procedure) {
                return next(ctx, req)
            }
            
            // Extract token from header
            authHeader := req.Header().Get("Authorization")
            if authHeader == "" {
                return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing authorization header"))
            }
            
            tokenString := strings.TrimPrefix(authHeader, "Bearer ")
            if tokenString == authHeader {
                return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid authorization format"))
            }
            
            // Verify token
            claims, err := jwtManager.Verify(tokenString)
            if err != nil {
                return nil, connect.NewError(connect.CodeUnauthenticated, err)
            }
            
            // Add claims to context
            ctx = context.WithValue(ctx, ClaimsKey, claims)
            
            return next(ctx, req)
        }
    }
}

func isPublicEndpoint(procedure string) bool {
    publicEndpoints := []string{
        "/limiquantix.auth.v1.AuthService/Login",
        "/limiquantix.auth.v1.AuthService/RefreshToken",
        "/health",
        "/ready",
    }
    
    for _, ep := range publicEndpoints {
        if strings.Contains(procedure, ep) {
            return true
        }
    }
    return false
}

func GetClaims(ctx context.Context) (*auth.Claims, bool) {
    claims, ok := ctx.Value(ClaimsKey).(*auth.Claims)
    return claims, ok
}
```

---

### 4.3 DRS Engine

**File:** `internal/drs/engine.go`

```go
// internal/drs/engine.go
package drs

import (
    "context"
    "time"
    
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/config"
    "github.com/limiquantix/limiquantix/internal/domain"
)

type Engine struct {
    config       config.DRSConfig
    nodeRepo     NodeRepository
    vmRepo       VMRepository
    recommRepo   RecommendationRepository
    etcdClient   EtcdClient
    logger       *zap.Logger
    isLeader     bool
}

func NewEngine(
    cfg config.DRSConfig,
    nodeRepo NodeRepository,
    vmRepo VMRepository,
    recommRepo RecommendationRepository,
    etcdClient EtcdClient,
    logger *zap.Logger,
) *Engine {
    return &Engine{
        config:     cfg,
        nodeRepo:   nodeRepo,
        vmRepo:     vmRepo,
        recommRepo: recommRepo,
        etcdClient: etcdClient,
        logger:     logger,
    }
}

func (e *Engine) Start(ctx context.Context) {
    if !e.config.Enabled {
        e.logger.Info("DRS engine disabled")
        return
    }
    
    // Try to become leader
    go e.runLeaderElection(ctx)
    
    ticker := time.NewTicker(e.config.Interval)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if e.isLeader {
                e.analyzeAndRecommend(ctx)
            }
        }
    }
}

func (e *Engine) analyzeAndRecommend(ctx context.Context) {
    e.logger.Debug("Running DRS analysis")
    
    // 1. Get all nodes and their metrics
    nodes, err := e.nodeRepo.ListAll(ctx)
    if err != nil {
        e.logger.Error("Failed to list nodes", zap.Error(err))
        return
    }
    
    // 2. Calculate cluster-wide stats
    var totalCPU, usedCPU, totalMem, usedMem float64
    nodeMetrics := make(map[string]NodeMetrics)
    
    for _, node := range nodes {
        if node.Status.Phase != domain.NodePhaseReady {
            continue
        }
        
        metrics := e.getNodeMetrics(ctx, node)
        nodeMetrics[node.ID] = metrics
        
        totalCPU += float64(node.Spec.CPUCores)
        usedCPU += metrics.CPUUsage
        totalMem += float64(node.Spec.MemoryMiB)
        usedMem += metrics.MemoryUsage
    }
    
    // 3. Identify imbalances
    for nodeID, metrics := range nodeMetrics {
        cpuPercent := (metrics.CPUUsage / float64(nodeMetrics[nodeID].TotalCPU)) * 100
        memPercent := (metrics.MemoryUsage / float64(nodeMetrics[nodeID].TotalMemory)) * 100
        
        // Check thresholds
        if cpuPercent > float64(e.config.ThresholdCPU) {
            e.generateMigrationRecommendation(ctx, nodeID, "CPU overload", cpuPercent)
        }
        if memPercent > float64(e.config.ThresholdMemory) {
            e.generateMigrationRecommendation(ctx, nodeID, "Memory overload", memPercent)
        }
    }
}

func (e *Engine) generateMigrationRecommendation(ctx context.Context, sourceNodeID string, reason string, usage float64) {
    // Find VMs on the overloaded node
    vms, err := e.vmRepo.ListByNode(ctx, sourceNodeID)
    if err != nil {
        e.logger.Error("Failed to list VMs", zap.Error(err))
        return
    }
    
    if len(vms) == 0 {
        return
    }
    
    // Find best target node
    targetNodeID, err := e.findBestTargetNode(ctx, sourceNodeID, vms[0])
    if err != nil {
        e.logger.Warn("No suitable target node found", zap.Error(err))
        return
    }
    
    // Create recommendation
    recommendation := &domain.DRSRecommendation{
        Priority:    e.calculatePriority(usage),
        Type:        domain.DRSTypeMigrate,
        Reason:      reason,
        VMID:        vms[0].ID,
        SourceNode:  sourceNodeID,
        TargetNode:  targetNodeID,
        ImpactCPU:   int(usage - float64(e.config.ThresholdCPU)),
        Status:      domain.DRSStatusPending,
    }
    
    if err := e.recommRepo.Create(ctx, recommendation); err != nil {
        e.logger.Error("Failed to create recommendation", zap.Error(err))
        return
    }
    
    e.logger.Info("Created DRS recommendation",
        zap.String("vm_id", vms[0].ID),
        zap.String("source", sourceNodeID),
        zap.String("target", targetNodeID),
        zap.String("reason", reason),
    )
}

func (e *Engine) calculatePriority(usage float64) domain.DRSPriority {
    if usage > 95 {
        return domain.DRSPriorityCritical
    } else if usage > 90 {
        return domain.DRSPriorityHigh
    } else if usage > 85 {
        return domain.DRSPriorityMedium
    }
    return domain.DRSPriorityLow
}
```

---

### 4.4 HA Manager

**File:** `internal/ha/manager.go`

```go
// internal/ha/manager.go
package ha

import (
    "context"
    "time"
    
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/config"
    "github.com/limiquantix/limiquantix/internal/domain"
)

type Manager struct {
    config     config.HAConfig
    nodeRepo   NodeRepository
    vmRepo     VMRepository
    scheduler  Scheduler
    events     EventPublisher
    logger     *zap.Logger
    isLeader   bool
}

func (m *Manager) Start(ctx context.Context) {
    if !m.config.Enabled {
        m.logger.Info("HA manager disabled")
        return
    }
    
    ticker := time.NewTicker(m.config.CheckInterval)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            if m.isLeader {
                m.checkForFailures(ctx)
            }
        }
    }
}

func (m *Manager) checkForFailures(ctx context.Context) {
    nodes, err := m.nodeRepo.ListAll(ctx)
    if err != nil {
        m.logger.Error("Failed to list nodes", zap.Error(err))
        return
    }
    
    for _, node := range nodes {
        // Check if node has been unresponsive
        if node.Status.Phase == domain.NodePhaseNotReady {
            failedTime := time.Since(node.LastHeartbeat)
            
            // If failed for too long, trigger failover
            if failedTime > time.Duration(m.config.FailureThreshold)*m.config.CheckInterval {
                m.triggerFailover(ctx, node)
            }
        }
    }
}

func (m *Manager) triggerFailover(ctx context.Context, failedNode *domain.Node) {
    m.logger.Warn("Triggering HA failover",
        zap.String("node_id", failedNode.ID),
        zap.String("hostname", failedNode.Hostname),
    )
    
    // Get all VMs on the failed node with HA enabled
    vms, err := m.vmRepo.ListByNode(ctx, failedNode.ID)
    if err != nil {
        m.logger.Error("Failed to list VMs", zap.Error(err))
        return
    }
    
    for _, vm := range vms {
        // Check if VM has HA policy
        if !vm.Spec.HAEnabled {
            continue
        }
        
        // Find new host
        newNodeID, err := m.scheduler.Schedule(ctx, vm.Spec)
        if err != nil {
            m.logger.Error("Failed to find new host for VM",
                zap.String("vm_id", vm.ID),
                zap.Error(err),
            )
            continue
        }
        
        // Update VM placement
        vm.Status.NodeID = newNodeID
        vm.Status.State = domain.VMStatePending
        
        if err := m.vmRepo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
            m.logger.Error("Failed to update VM", zap.Error(err))
            continue
        }
        
        // Publish event
        m.events.Publish(ctx, domain.EventVMFailover{
            VMID:           vm.ID,
            OldNodeID:      failedNode.ID,
            NewNodeID:      newNodeID,
            Reason:         "host failure",
        })
        
        m.logger.Info("VM failover initiated",
            zap.String("vm_id", vm.ID),
            zap.String("old_node", failedNode.ID),
            zap.String("new_node", newNodeID),
        )
    }
}
```

---

### 4.5 Alert Service

**File:** `internal/services/alert/service.go`

```go
// internal/services/alert/service.go
package alert

import (
    "context"
    "time"
    
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/domain"
)

type Service struct {
    repo     Repository
    rules    []AlertRule
    notifier Notifier
    logger   *zap.Logger
}

type AlertRule struct {
    Name       string
    Condition  func(metrics domain.Metrics) bool
    Severity   domain.AlertSeverity
    Message    string
    Cooldown   time.Duration
    lastFired  time.Time
}

func (s *Service) EvaluateRules(ctx context.Context, sourceType string, sourceID string, metrics domain.Metrics) {
    for i := range s.rules {
        rule := &s.rules[i]
        
        // Check cooldown
        if time.Since(rule.lastFired) < rule.Cooldown {
            continue
        }
        
        // Evaluate condition
        if rule.Condition(metrics) {
            alert := &domain.Alert{
                Severity:    rule.Severity,
                Title:       rule.Name,
                Message:     rule.Message,
                SourceType:  sourceType,
                SourceID:    sourceID,
            }
            
            if err := s.repo.Create(ctx, alert); err != nil {
                s.logger.Error("Failed to create alert", zap.Error(err))
                continue
            }
            
            // Send notification
            go s.notifier.Notify(ctx, alert)
            
            rule.lastFired = time.Now()
            
            s.logger.Info("Alert triggered",
                zap.String("rule", rule.Name),
                zap.String("severity", string(rule.Severity)),
            )
        }
    }
}

// Default alert rules
func DefaultRules() []AlertRule {
    return []AlertRule{
        {
            Name:     "High CPU Usage",
            Severity: domain.AlertSeverityWarning,
            Message:  "CPU usage exceeded 80%",
            Cooldown: 5 * time.Minute,
            Condition: func(m domain.Metrics) bool {
                return m.CPUPercent > 80
            },
        },
        {
            Name:     "Critical CPU Usage",
            Severity: domain.AlertSeverityCritical,
            Message:  "CPU usage exceeded 95%",
            Cooldown: 1 * time.Minute,
            Condition: func(m domain.Metrics) bool {
                return m.CPUPercent > 95
            },
        },
        {
            Name:     "High Memory Usage",
            Severity: domain.AlertSeverityWarning,
            Message:  "Memory usage exceeded 85%",
            Cooldown: 5 * time.Minute,
            Condition: func(m domain.Metrics) bool {
                return m.MemoryPercent > 85
            },
        },
        {
            Name:     "Low Disk Space",
            Severity: domain.AlertSeverityWarning,
            Message:  "Available disk space below 10%",
            Cooldown: 10 * time.Minute,
            Condition: func(m domain.Metrics) bool {
                return m.DiskAvailablePercent < 10
            },
        },
    }
}
```

---

### 4.6 Real-time Streaming

**File:** `internal/events/streaming.go`

```go
// internal/events/streaming.go
package events

import (
    "context"
    "sync"
    
    "go.uber.org/zap"
)

type StreamManager struct {
    mu          sync.RWMutex
    subscribers map[string][]chan Event
    logger      *zap.Logger
}

func NewStreamManager(logger *zap.Logger) *StreamManager {
    return &StreamManager{
        subscribers: make(map[string][]chan Event),
        logger:      logger,
    }
}

func (sm *StreamManager) Subscribe(topic string) <-chan Event {
    ch := make(chan Event, 100)
    
    sm.mu.Lock()
    sm.subscribers[topic] = append(sm.subscribers[topic], ch)
    sm.mu.Unlock()
    
    sm.logger.Debug("New subscriber", zap.String("topic", topic))
    
    return ch
}

func (sm *StreamManager) Unsubscribe(topic string, ch <-chan Event) {
    sm.mu.Lock()
    defer sm.mu.Unlock()
    
    subs := sm.subscribers[topic]
    for i, sub := range subs {
        if sub == ch {
            sm.subscribers[topic] = append(subs[:i], subs[i+1:]...)
            close(sub)
            break
        }
    }
}

func (sm *StreamManager) Publish(ctx context.Context, topic string, event Event) {
    sm.mu.RLock()
    subs := sm.subscribers[topic]
    sm.mu.RUnlock()
    
    for _, ch := range subs {
        select {
        case ch <- event:
        default:
            sm.logger.Warn("Subscriber channel full, dropping event",
                zap.String("topic", topic),
            )
        }
    }
}

// Implement WatchVM streaming RPC
func (s *VMService) WatchVM(
    ctx context.Context,
    req *connect.Request[computev1.WatchVMRequest],
    stream *connect.ServerStream[computev1.VirtualMachine],
) error {
    vmID := req.Msg.VmId
    topic := fmt.Sprintf("vm:%s", vmID)
    
    s.logger.Info("Starting VM watch", zap.String("vm_id", vmID))
    
    // Subscribe to updates
    events := s.streamManager.Subscribe(topic)
    defer s.streamManager.Unsubscribe(topic, events)
    
    // Send initial state
    vm, err := s.repo.Get(ctx, vmID)
    if err != nil {
        return connect.NewError(connect.CodeNotFound, err)
    }
    if err := stream.Send(convertToProto(vm)); err != nil {
        return err
    }
    
    // Stream updates
    for {
        select {
        case <-ctx.Done():
            return nil
        case event, ok := <-events:
            if !ok {
                return nil
            }
            
            vm, err := s.repo.Get(ctx, vmID)
            if err != nil {
                continue
            }
            if err := stream.Send(convertToProto(vm)); err != nil {
                return err
            }
        }
    }
}
```

---

## Testing Strategy

### Unit Tests

```go
// internal/services/vm/service_test.go
func TestVMService_CreateVM(t *testing.T) {
    ctrl := gomock.NewController(t)
    defer ctrl.Finish()
    
    mockRepo := mock.NewMockRepository(ctrl)
    mockScheduler := mock.NewMockScheduler(ctrl)
    mockEvents := mock.NewMockEventPublisher(ctrl)
    
    service := NewService(mockRepo, mockScheduler, mockEvents, zap.NewNop())
    
    // Test: successful creation
    t.Run("success", func(t *testing.T) {
        mockScheduler.EXPECT().
            Schedule(gomock.Any(), gomock.Any()).
            Return("node-1", nil)
        
        mockRepo.EXPECT().
            Create(gomock.Any(), gomock.Any()).
            Return(&domain.VM{ID: "vm-1", Name: "test"}, nil)
        
        mockEvents.EXPECT().
            Publish(gomock.Any(), gomock.Any())
        
        req := connect.NewRequest(&computev1.CreateVMRequest{
            Name:      "test",
            ProjectId: "project-1",
            Spec: &computev1.VmSpec{
                Cpu:    &computev1.CpuConfig{Cores: 2},
                Memory: &computev1.MemoryConfig{SizeMib: 2048},
            },
        })
        
        resp, err := service.CreateVM(context.Background(), req)
        
        assert.NoError(t, err)
        assert.Equal(t, "test", resp.Msg.Name)
    })
    
    // Test: validation error
    t.Run("validation_error", func(t *testing.T) {
        req := connect.NewRequest(&computev1.CreateVMRequest{
            Name: "", // Empty name
        })
        
        _, err := service.CreateVM(context.Background(), req)
        
        assert.Error(t, err)
        assert.Equal(t, connect.CodeInvalidArgument, connect.CodeOf(err))
    })
}
```

### Integration Tests

```go
// internal/integration/vm_test.go
func TestVMLifecycle(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test")
    }
    
    ctx := context.Background()
    
    // Setup test database
    db := setupTestDB(t)
    defer db.Close()
    
    // Create client
    client := computev1connect.NewVMServiceClient(
        http.DefaultClient,
        "http://localhost:8080",
    )
    
    // Create
    createResp, err := client.CreateVM(ctx, connect.NewRequest(&computev1.CreateVMRequest{
        Name:      "integration-test",
        ProjectId: "default",
        Spec: &computev1.VmSpec{
            Cpu:    &computev1.CpuConfig{Cores: 2},
            Memory: &computev1.MemoryConfig{SizeMib: 2048},
        },
    }))
    require.NoError(t, err)
    vmID := createResp.Msg.Id
    
    // Get
    getResp, err := client.GetVM(ctx, connect.NewRequest(&computev1.GetVMRequest{Id: vmID}))
    require.NoError(t, err)
    assert.Equal(t, "integration-test", getResp.Msg.Name)
    
    // Delete
    _, err = client.DeleteVM(ctx, connect.NewRequest(&computev1.DeleteVMRequest{Id: vmID}))
    require.NoError(t, err)
}
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] Load testing completed
- [ ] Security scan completed
- [ ] Database migrations tested
- [ ] Configuration reviewed
- [ ] Secrets properly managed

### Deployment Steps

1. **Apply database migrations**
   ```bash
   make migrate-up
   ```

2. **Build Docker image**
   ```bash
   make docker-build
   ```

3. **Deploy to Kubernetes/Docker Swarm**
   ```bash
   kubectl apply -f k8s/
   # or
   docker stack deploy -c docker-stack.yml limiquantix
   ```

4. **Verify health**
   ```bash
   curl http://api.limiquantix.local/health
   curl http://api.limiquantix.local/ready
   ```

5. **Run smoke tests**
   ```bash
   make test-smoke
   ```

### Post-Deployment

- [ ] Monitor error rates
- [ ] Check resource utilization
- [ ] Verify metrics collection
- [ ] Test critical user flows
- [ ] Document any issues

---

## Summary

| Phase | Estimated Time | Key Deliverables |
|-------|----------------|------------------|
| Phase 2 | 2-3 weeks | VM, Node, Storage, Network services |
| Phase 3 | 1-2 weeks | PostgreSQL repos, Redis cache, etcd integration |
| Phase 4 | 2-3 weeks | Auth, DRS, HA, Alerts, Streaming |
| Testing | 1 week | Unit tests, integration tests, load tests |
| Total | 6-9 weeks | Production-ready backend |

Each phase builds on the previous one. Start with Phase 2 (Core Services) which provides the fundamental CRUD operations, then add persistence (Phase 3), and finally advanced features (Phase 4).

