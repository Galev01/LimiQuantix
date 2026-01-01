# LimiQuantix Backend Implementation Plan

## Executive Summary

This document outlines the comprehensive plan for building the LimiQuantix backend - a Go-based control plane that orchestrates virtualization infrastructure. The backend will provide gRPC/Connect-RPC APIs consumed by the React frontend, manage cluster state via etcd, and communicate with hypervisor agents.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Core Components](#4-core-components)
5. [API Layer](#5-api-layer)
6. [Data Layer](#6-data-layer)
7. [Service Implementation](#7-service-implementation)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Real-time Updates](#9-real-time-updates)
10. [Implementation Phases](#10-implementation-phases)
11. [Testing Strategy](#11-testing-strategy)
12. [Deployment](#12-deployment)

---

## 1. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                               │
│                         Connect-ES / gRPC-Web                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         API Gateway / Load Balancer                      │
│                            (Traefik / Envoy)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      LimiQuantix Control Plane (Go)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ VM Service  │  │Node Service │  │Storage Svc  │  │Network Svc  │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ Alert Svc   │  │ DRS Engine  │  │ HA Manager  │  │ Auth Service│    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     Scheduler / Orchestrator                       │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│      etcd       │  │   PostgreSQL    │  │     Redis       │
│  (Cluster State)│  │  (Persistent)   │  │    (Cache)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Hypervisor Agents (Rust)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  node-01    │  │  node-02    │  │  node-03    │  │  node-04    │    │
│  │   Agent     │  │   Agent     │  │   Agent     │  │   Agent     │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Communication Patterns

| Component | Protocol | Purpose |
|-----------|----------|---------|
| Frontend → Backend | Connect-RPC (HTTP/2) | API calls, streaming |
| Backend → etcd | gRPC | State management |
| Backend → PostgreSQL | SQL | Persistent storage |
| Backend → Redis | Redis Protocol | Caching, pub/sub |
| Backend → Agents | gRPC (mTLS) | Host control |

---

## 2. Technology Stack

### Core Technologies

| Category | Technology | Version | Rationale |
|----------|------------|---------|-----------|
| Language | Go | 1.22+ | Performance, concurrency, ecosystem |
| RPC Framework | Connect-RPC | Latest | gRPC + HTTP/JSON compatibility |
| State Store | etcd | 3.5+ | Distributed, consistent, watch support |
| Database | PostgreSQL | 16+ | Reliability, JSON support, extensions |
| Cache | Redis | 7+ | Speed, pub/sub, data structures |
| ORM | sqlc | Latest | Type-safe SQL, no runtime overhead |
| Migrations | golang-migrate | Latest | Versioned schema changes |
| Config | Viper | Latest | Multi-source configuration |
| Logging | Zap | Latest | Structured, high-performance |
| Metrics | Prometheus | Latest | Industry standard |
| Tracing | OpenTelemetry | Latest | Distributed tracing |

### Development Tools

| Tool | Purpose |
|------|---------|
| Buf | Proto management |
| Air | Hot reload during development |
| golangci-lint | Code quality |
| mockery | Mock generation |
| testcontainers-go | Integration testing |

---

## 3. Project Structure

```
backend/
├── cmd/
│   ├── controlplane/          # Main control plane binary
│   │   └── main.go
│   ├── migrate/               # Database migration tool
│   │   └── main.go
│   └── cli/                   # CLI tool (limiqctl)
│       └── main.go
├── internal/
│   ├── config/                # Configuration management
│   │   ├── config.go
│   │   └── config_test.go
│   ├── server/                # HTTP/gRPC server setup
│   │   ├── server.go
│   │   ├── middleware/
│   │   │   ├── auth.go
│   │   │   ├── logging.go
│   │   │   ├── recovery.go
│   │   │   └── ratelimit.go
│   │   └── interceptors/
│   │       ├── auth.go
│   │       └── logging.go
│   ├── services/              # Business logic
│   │   ├── vm/
│   │   │   ├── service.go
│   │   │   ├── service_test.go
│   │   │   ├── repository.go
│   │   │   └── scheduler.go
│   │   ├── node/
│   │   │   ├── service.go
│   │   │   ├── repository.go
│   │   │   └── health.go
│   │   ├── storage/
│   │   │   ├── pool_service.go
│   │   │   ├── volume_service.go
│   │   │   └── ceph_client.go
│   │   ├── network/
│   │   │   ├── service.go
│   │   │   └── ovn_client.go
│   │   ├── cluster/
│   │   │   ├── service.go
│   │   │   └── drs.go
│   │   ├── alert/
│   │   │   ├── service.go
│   │   │   ├── rules.go
│   │   │   └── notifier.go
│   │   └── auth/
│   │       ├── service.go
│   │       ├── jwt.go
│   │       └── rbac.go
│   ├── repository/            # Data access layer
│   │   ├── postgres/
│   │   │   ├── vm.go
│   │   │   ├── node.go
│   │   │   ├── storage.go
│   │   │   └── queries/       # sqlc queries
│   │   ├── etcd/
│   │   │   ├── client.go
│   │   │   ├── vm_state.go
│   │   │   └── node_state.go
│   │   └── redis/
│   │       ├── client.go
│   │       └── cache.go
│   ├── domain/                # Domain models (not proto-generated)
│   │   ├── vm.go
│   │   ├── node.go
│   │   ├── cluster.go
│   │   └── errors.go
│   ├── scheduler/             # VM scheduling
│   │   ├── scheduler.go
│   │   ├── placement.go
│   │   ├── affinity.go
│   │   └── predicates/
│   │       ├── cpu.go
│   │       ├── memory.go
│   │       └── network.go
│   ├── drs/                   # Distributed Resource Scheduler
│   │   ├── engine.go
│   │   ├── analyzer.go
│   │   ├── recommender.go
│   │   └── migrator.go
│   ├── ha/                    # High Availability
│   │   ├── manager.go
│   │   ├── monitor.go
│   │   └── failover.go
│   ├── agent/                 # Agent communication
│   │   ├── client.go
│   │   ├── pool.go
│   │   └── rpc.go
│   └── events/                # Event system
│       ├── bus.go
│       ├── handlers.go
│       └── types.go
├── pkg/
│   ├── api/                   # Generated proto code
│   │   └── limiquantix/
│   │       ├── compute/v1/
│   │       ├── storage/v1/
│   │       └── network/v1/
│   ├── errors/                # Error types
│   │   └── errors.go
│   └── utils/                 # Shared utilities
│       ├── uuid.go
│       ├── retry.go
│       └── validation.go
├── migrations/                # Database migrations
│   ├── 000001_init.up.sql
│   ├── 000001_init.down.sql
│   └── ...
├── scripts/
│   ├── generate.sh            # Code generation
│   ├── migrate.sh             # Run migrations
│   └── seed.sh                # Seed data
├── configs/
│   ├── config.yaml            # Default config
│   ├── config.dev.yaml        # Dev overrides
│   └── config.prod.yaml       # Prod overrides
├── Dockerfile
├── docker-compose.yaml
├── Makefile
└── go.mod
```

---

## 4. Core Components

### 4.1 Control Plane Server

The main server that handles all API requests:

```go
// internal/server/server.go
type Server struct {
    config     *config.Config
    httpServer *http.Server
    services   *Services
    db         *sql.DB
    etcd       *clientv3.Client
    redis      *redis.Client
}

func NewServer(cfg *config.Config) (*Server, error) {
    // Initialize connections
    // Register services
    // Setup middleware
    // Return server
}

func (s *Server) Run(ctx context.Context) error {
    // Start HTTP/2 server with Connect-RPC
    // Start background workers
    // Handle graceful shutdown
}
```

### 4.2 Service Registry

```go
// internal/server/services.go
type Services struct {
    VM      *vm.Service
    Node    *node.Service
    Storage *storage.Service
    Network *network.Service
    Cluster *cluster.Service
    Alert   *alert.Service
    Auth    *auth.Service
}

func NewServices(deps *Dependencies) *Services {
    return &Services{
        VM:      vm.NewService(deps.VMRepo, deps.Scheduler, deps.AgentPool),
        Node:    node.NewService(deps.NodeRepo, deps.AgentPool),
        // ...
    }
}
```

### 4.3 Configuration

```yaml
# configs/config.yaml
server:
  host: "0.0.0.0"
  port: 8080
  grpc_port: 9090
  read_timeout: 30s
  write_timeout: 30s
  shutdown_timeout: 10s

database:
  host: "localhost"
  port: 5432
  name: "limiquantix"
  user: "limiquantix"
  password: "${DB_PASSWORD}"
  max_open_conns: 25
  max_idle_conns: 5
  conn_max_lifetime: 5m

etcd:
  endpoints:
    - "localhost:2379"
  dial_timeout: 5s
  username: ""
  password: ""

redis:
  host: "localhost"
  port: 6379
  password: ""
  db: 0

auth:
  jwt_secret: "${JWT_SECRET}"
  token_expiry: 24h
  refresh_expiry: 168h

scheduler:
  placement_strategy: "spread"  # spread, pack
  overcommit_cpu: 2.0
  overcommit_memory: 1.5

drs:
  enabled: true
  automation_level: "partial"  # manual, partial, full
  interval: 5m
  threshold_cpu: 80
  threshold_memory: 85

ha:
  enabled: true
  check_interval: 30s
  failure_threshold: 3
  restart_priority: "high"

logging:
  level: "info"
  format: "json"
  output: "stdout"

metrics:
  enabled: true
  path: "/metrics"
  port: 9091
```

---

## 5. API Layer

### 5.1 Connect-RPC Server Setup

```go
// internal/server/server.go
func (s *Server) setupRoutes() http.Handler {
    mux := http.NewServeMux()
    
    // Health check
    mux.HandleFunc("/health", s.healthHandler)
    mux.HandleFunc("/ready", s.readyHandler)
    
    // Connect-RPC services
    interceptors := connect.WithInterceptors(
        interceptors.NewAuthInterceptor(s.authService),
        interceptors.NewLoggingInterceptor(s.logger),
        interceptors.NewRecoveryInterceptor(),
    )
    
    // Register services
    path, handler := computev1connect.NewVMServiceHandler(
        s.services.VM,
        interceptors,
    )
    mux.Handle(path, handler)
    
    path, handler = computev1connect.NewNodeServiceHandler(
        s.services.Node,
        interceptors,
    )
    mux.Handle(path, handler)
    
    // ... register other services
    
    // CORS middleware for browser clients
    return cors.New(cors.Options{
        AllowedOrigins:   []string{"http://localhost:5173"},
        AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
        AllowedHeaders:   []string{"*"},
        AllowCredentials: true,
    }).Handler(mux)
}
```

### 5.2 Service Implementation Example

```go
// internal/services/vm/service.go
package vm

import (
    "context"
    
    "connectrpc.com/connect"
    computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
    "go.uber.org/zap"
)

type Service struct {
    repo      Repository
    scheduler Scheduler
    agents    AgentPool
    events    EventBus
    logger    *zap.Logger
}

func NewService(repo Repository, scheduler Scheduler, agents AgentPool, events EventBus, logger *zap.Logger) *Service {
    return &Service{
        repo:      repo,
        scheduler: scheduler,
        agents:    agents,
        events:    events,
        logger:    logger,
    }
}

// CreateVM implements the CreateVM RPC
func (s *Service) CreateVM(
    ctx context.Context,
    req *connect.Request[computev1.CreateVMRequest],
) (*connect.Response[computev1.VirtualMachine], error) {
    logger := s.logger.With(
        zap.String("request_id", req.Header().Get("X-Request-ID")),
        zap.String("vm_name", req.Msg.Name),
    )
    
    logger.Info("Creating VM")
    
    // Validate request
    if err := validateCreateVMRequest(req.Msg); err != nil {
        return nil, connect.NewError(connect.CodeInvalidArgument, err)
    }
    
    // Schedule VM placement
    hostID, err := s.scheduler.Schedule(ctx, req.Msg.Spec)
    if err != nil {
        logger.Error("Failed to schedule VM", zap.Error(err))
        return nil, connect.NewError(connect.CodeResourceExhausted, err)
    }
    
    // Create VM in database
    vm, err := s.repo.Create(ctx, &domain.VM{
        Name:      req.Msg.Name,
        ProjectID: req.Msg.ProjectId,
        Spec:      convertSpec(req.Msg.Spec),
        Status: domain.VMStatus{
            State:  domain.VMStatePending,
            NodeID: hostID,
        },
    })
    if err != nil {
        logger.Error("Failed to create VM", zap.Error(err))
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    // Send to agent for creation
    agent, err := s.agents.Get(hostID)
    if err != nil {
        logger.Error("Failed to get agent", zap.Error(err))
        return nil, connect.NewError(connect.CodeUnavailable, err)
    }
    
    if err := agent.CreateVM(ctx, vm); err != nil {
        logger.Error("Agent failed to create VM", zap.Error(err))
        // Update status to failed
        s.repo.UpdateStatus(ctx, vm.ID, domain.VMStateFailed)
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    // Emit event
    s.events.Publish(events.VMCreated{VMID: vm.ID, NodeID: hostID})
    
    logger.Info("VM created successfully", zap.String("vm_id", vm.ID))
    
    return connect.NewResponse(convertToProto(vm)), nil
}

// WatchVM implements the server streaming RPC for real-time updates
func (s *Service) WatchVM(
    ctx context.Context,
    req *connect.Request[computev1.WatchVMRequest],
    stream *connect.ServerStream[computev1.VirtualMachine],
) error {
    logger := s.logger.With(zap.String("vm_id", req.Msg.VmId))
    logger.Info("Starting VM watch")
    
    // Subscribe to VM updates
    updates := s.events.Subscribe(fmt.Sprintf("vm:%s", req.Msg.VmId))
    defer s.events.Unsubscribe(updates)
    
    // Send initial state
    vm, err := s.repo.Get(ctx, req.Msg.VmId)
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
        case update := <-updates:
            vm, err := s.repo.Get(ctx, req.Msg.VmId)
            if err != nil {
                continue
            }
            if err := stream.Send(convertToProto(vm)); err != nil {
                return err
            }
        }
    }
}

// ListVMs implements pagination and filtering
func (s *Service) ListVMs(
    ctx context.Context,
    req *connect.Request[computev1.ListVMsRequest],
) (*connect.Response[computev1.ListVMsResponse], error) {
    filter := domain.VMFilter{
        ProjectID: req.Msg.ProjectId,
        States:    convertStates(req.Msg.States),
        Labels:    req.Msg.Labels,
    }
    
    vms, total, err := s.repo.List(ctx, filter, int(req.Msg.PageSize), req.Msg.PageToken)
    if err != nil {
        return nil, connect.NewError(connect.CodeInternal, err)
    }
    
    resp := &computev1.ListVMsResponse{
        Vms:       convertToProtos(vms),
        TotalSize: int32(total),
    }
    
    if len(vms) == int(req.Msg.PageSize) {
        resp.NextPageToken = vms[len(vms)-1].ID
    }
    
    return connect.NewResponse(resp), nil
}
```

---

## 6. Data Layer

### 6.1 PostgreSQL Schema

```sql
-- migrations/000001_init.up.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects (multi-tenancy)
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    quota JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Virtual Machines
CREATE TABLE virtual_machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id),
    description TEXT,
    labels JSONB DEFAULT '{}',
    
    -- Spec (desired state)
    spec JSONB NOT NULL,
    
    -- Status (current state)
    power_state VARCHAR(50) NOT NULL DEFAULT 'STOPPED',
    node_id UUID REFERENCES nodes(id),
    ip_addresses JSONB DEFAULT '[]',
    
    -- Metadata
    hardware_version VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    
    UNIQUE(project_id, name)
);

CREATE INDEX idx_vms_project ON virtual_machines(project_id);
CREATE INDEX idx_vms_node ON virtual_machines(node_id);
CREATE INDEX idx_vms_state ON virtual_machines(power_state);
CREATE INDEX idx_vms_labels ON virtual_machines USING GIN(labels);

-- Nodes (Hypervisor Hosts)
CREATE TABLE nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname VARCHAR(255) NOT NULL UNIQUE,
    management_ip INET NOT NULL,
    labels JSONB DEFAULT '{}',
    
    -- Spec (capabilities)
    spec JSONB NOT NULL,
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    conditions JSONB DEFAULT '[]',
    allocatable JSONB,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ
);

CREATE INDEX idx_nodes_phase ON nodes(phase);
CREATE INDEX idx_nodes_labels ON nodes USING GIN(labels);

-- Clusters
CREATE TABLE clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    
    -- Configuration
    ha_enabled BOOLEAN DEFAULT FALSE,
    drs_enabled BOOLEAN DEFAULT FALSE,
    drs_automation VARCHAR(50) DEFAULT 'manual',
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cluster membership
CREATE TABLE cluster_nodes (
    cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (cluster_id, node_id)
);

-- Storage Pools
CREATE TABLE storage_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    pool_type VARCHAR(50) NOT NULL, -- CEPH_RBD, LOCAL_LVM, NFS
    
    -- Configuration
    spec JSONB NOT NULL,
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    capacity_bytes BIGINT,
    used_bytes BIGINT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Volumes
CREATE TABLE volumes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    pool_id UUID NOT NULL REFERENCES storage_pools(id),
    
    -- Spec
    size_bytes BIGINT NOT NULL,
    provisioning VARCHAR(50) DEFAULT 'THIN',
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    attached_vm_id UUID REFERENCES virtual_machines(id),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(pool_id, name)
);

CREATE INDEX idx_volumes_pool ON volumes(pool_id);
CREATE INDEX idx_volumes_vm ON volumes(attached_vm_id);

-- Virtual Networks
CREATE TABLE virtual_networks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    network_type VARCHAR(50) NOT NULL, -- VLAN, OVERLAY, EXTERNAL
    
    -- Configuration
    vlan_id INTEGER,
    cidr CIDR,
    gateway INET,
    dhcp_enabled BOOLEAN DEFAULT FALSE,
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security Groups
CREATE TABLE security_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Security Rules
CREATE TABLE security_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    security_group_id UUID NOT NULL REFERENCES security_groups(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL, -- INBOUND, OUTBOUND
    protocol VARCHAR(10) NOT NULL,  -- TCP, UDP, ICMP, ANY
    port_range VARCHAR(50),
    source_dest VARCHAR(255),       -- CIDR or "Anywhere"
    action VARCHAR(10) NOT NULL,    -- ALLOW, DENY
    priority INTEGER DEFAULT 100,
    description TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rules_sg ON security_rules(security_group_id);

-- Alerts
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    severity VARCHAR(20) NOT NULL,  -- CRITICAL, WARNING, INFO
    title VARCHAR(500) NOT NULL,
    message TEXT,
    source_type VARCHAR(50),        -- HOST, VM, STORAGE, NETWORK, CLUSTER
    source_id UUID,
    
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_severity ON alerts(severity);
CREATE INDEX idx_alerts_resolved ON alerts(resolved);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);

-- DRS Recommendations
CREATE TABLE drs_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    priority VARCHAR(20) NOT NULL,  -- CRITICAL, HIGH, MEDIUM, LOW
    recommendation_type VARCHAR(50) NOT NULL, -- MIGRATE, POWER_ON, POWER_OFF
    reason TEXT,
    
    vm_id UUID REFERENCES virtual_machines(id),
    source_node_id UUID REFERENCES nodes(id),
    target_node_id UUID REFERENCES nodes(id),
    
    impact_cpu INTEGER,             -- Improvement percentage
    impact_memory INTEGER,
    estimated_duration VARCHAR(50),
    
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, APPLIED, REJECTED
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ
);

CREATE INDEX idx_drs_status ON drs_recommendations(status);

-- Audit Log
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer', -- admin, operator, viewer
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_vms_updated_at
    BEFORE UPDATE ON virtual_machines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_nodes_updated_at
    BEFORE UPDATE ON nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Similar triggers for other tables...
```

### 6.2 sqlc Configuration

```yaml
# sqlc.yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "internal/repository/postgres/queries/"
    schema: "migrations/"
    gen:
      go:
        package: "db"
        out: "internal/repository/postgres/db"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_db_tags: true
        emit_prepared_queries: true
        emit_interface: true
```

### 6.3 sqlc Queries Example

```sql
-- internal/repository/postgres/queries/vm.sql

-- name: GetVM :one
SELECT * FROM virtual_machines
WHERE id = $1;

-- name: ListVMs :many
SELECT * FROM virtual_machines
WHERE project_id = $1
  AND ($2::varchar[] IS NULL OR power_state = ANY($2))
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;

-- name: CreateVM :one
INSERT INTO virtual_machines (
    name, project_id, description, labels, spec, power_state, created_by
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: UpdateVMStatus :one
UPDATE virtual_machines
SET power_state = $2, node_id = $3, ip_addresses = $4, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteVM :exec
DELETE FROM virtual_machines WHERE id = $1;

-- name: CountVMsByProject :one
SELECT COUNT(*) FROM virtual_machines WHERE project_id = $1;

-- name: GetVMsByNode :many
SELECT * FROM virtual_machines
WHERE node_id = $1 AND power_state = 'RUNNING';
```

### 6.4 etcd State Keys

```
# VM runtime state (fast access, watch support)
/limiquantix/vms/{vm_id}/state          # Running state
/limiquantix/vms/{vm_id}/metrics        # Real-time metrics

# Node state
/limiquantix/nodes/{node_id}/state      # Node health
/limiquantix/nodes/{node_id}/resources  # Available resources
/limiquantix/nodes/{node_id}/heartbeat  # Last heartbeat

# Cluster state
/limiquantix/clusters/{cluster_id}/leader  # DRS leader election
/limiquantix/clusters/{cluster_id}/config  # Runtime config

# Locks
/limiquantix/locks/vm/{vm_id}           # VM operation lock
/limiquantix/locks/node/{node_id}       # Node operation lock
```

---

## 7. Service Implementation

### 7.1 VM Service

| Method | Description |
|--------|-------------|
| CreateVM | Create a new virtual machine |
| GetVM | Get VM by ID |
| ListVMs | List VMs with filtering and pagination |
| UpdateVM | Update VM spec |
| DeleteVM | Delete a VM |
| StartVM | Power on a VM |
| StopVM | Power off a VM |
| RebootVM | Reboot a VM |
| MigrateVM | Live migrate VM to another host |
| CreateSnapshot | Create VM snapshot |
| WatchVM | Stream VM state changes |

### 7.2 Node Service

| Method | Description |
|--------|-------------|
| RegisterNode | Agent registers with control plane |
| GetNode | Get node by ID |
| ListNodes | List all nodes |
| UpdateNode | Update node labels/spec |
| DrainNode | Prepare node for maintenance |
| CordonNode | Mark node as unschedulable |
| WatchNode | Stream node state changes |

### 7.3 Storage Service

| Method | Description |
|--------|-------------|
| CreatePool | Create storage pool |
| ListPools | List storage pools |
| CreateVolume | Create new volume |
| AttachVolume | Attach volume to VM |
| DetachVolume | Detach volume from VM |
| ResizeVolume | Expand volume size |
| DeleteVolume | Delete a volume |

### 7.4 Network Service

| Method | Description |
|--------|-------------|
| CreateNetwork | Create virtual network |
| ListNetworks | List networks |
| CreateSecurityGroup | Create security group |
| AddRule | Add firewall rule |
| AssignSecurityGroup | Assign SG to VM |

### 7.5 Alert Service

| Method | Description |
|--------|-------------|
| ListAlerts | List alerts with filtering |
| AcknowledgeAlert | Mark alert as acknowledged |
| ResolveAlert | Mark alert as resolved |
| CreateAlertRule | Create new alert rule |

### 7.6 DRS Service

| Method | Description |
|--------|-------------|
| GetRecommendations | Get pending DRS recommendations |
| ApproveRecommendation | Approve a recommendation |
| RejectRecommendation | Reject a recommendation |
| ApplyRecommendation | Execute a recommendation |
| GetDRSStatus | Get DRS engine status |

---

## 8. Authentication & Authorization

### 8.1 JWT Authentication

```go
// internal/services/auth/jwt.go
type JWTManager struct {
    secretKey     []byte
    tokenExpiry   time.Duration
    refreshExpiry time.Duration
}

type Claims struct {
    UserID   string `json:"user_id"`
    Username string `json:"username"`
    Role     string `json:"role"`
    jwt.RegisteredClaims
}

func (m *JWTManager) Generate(user *domain.User) (string, string, error) {
    // Generate access token
    accessClaims := &Claims{
        UserID:   user.ID,
        Username: user.Username,
        Role:     user.Role,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.tokenExpiry)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
    accessString, err := accessToken.SignedString(m.secretKey)
    if err != nil {
        return "", "", err
    }
    
    // Generate refresh token
    refreshClaims := &Claims{
        UserID: user.ID,
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.refreshExpiry)),
            IssuedAt:  jwt.NewNumericDate(time.Now()),
        },
    }
    refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
    refreshString, err := refreshToken.SignedString(m.secretKey)
    if err != nil {
        return "", "", err
    }
    
    return accessString, refreshString, nil
}

func (m *JWTManager) Verify(tokenString string) (*Claims, error) {
    token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
        return m.secretKey, nil
    })
    if err != nil {
        return nil, err
    }
    
    claims, ok := token.Claims.(*Claims)
    if !ok || !token.Valid {
        return nil, errors.New("invalid token")
    }
    
    return claims, nil
}
```

### 8.2 RBAC

```go
// internal/services/auth/rbac.go
type Role string

const (
    RoleAdmin    Role = "admin"
    RoleOperator Role = "operator"
    RoleViewer   Role = "viewer"
)

type Permission struct {
    Resource string
    Actions  []string
}

var rolePermissions = map[Role][]Permission{
    RoleAdmin: {
        {Resource: "*", Actions: []string{"*"}},
    },
    RoleOperator: {
        {Resource: "vm", Actions: []string{"create", "read", "update", "delete", "start", "stop"}},
        {Resource: "node", Actions: []string{"read", "drain"}},
        {Resource: "storage", Actions: []string{"create", "read", "update", "delete"}},
        {Resource: "network", Actions: []string{"create", "read", "update", "delete"}},
        {Resource: "alert", Actions: []string{"read", "acknowledge", "resolve"}},
    },
    RoleViewer: {
        {Resource: "vm", Actions: []string{"read"}},
        {Resource: "node", Actions: []string{"read"}},
        {Resource: "storage", Actions: []string{"read"}},
        {Resource: "network", Actions: []string{"read"}},
        {Resource: "alert", Actions: []string{"read"}},
    },
}

func (r Role) Can(resource, action string) bool {
    permissions := rolePermissions[r]
    for _, p := range permissions {
        if (p.Resource == "*" || p.Resource == resource) &&
           (contains(p.Actions, "*") || contains(p.Actions, action)) {
            return true
        }
    }
    return false
}
```

### 8.3 Auth Interceptor

```go
// internal/server/interceptors/auth.go
func NewAuthInterceptor(auth *auth.Service) connect.UnaryInterceptorFunc {
    return func(next connect.UnaryFunc) connect.UnaryFunc {
        return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
            // Skip auth for public endpoints
            if isPublicEndpoint(req.Spec().Procedure) {
                return next(ctx, req)
            }
            
            // Extract token
            authHeader := req.Header().Get("Authorization")
            if authHeader == "" {
                return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("missing authorization"))
            }
            
            token := strings.TrimPrefix(authHeader, "Bearer ")
            claims, err := auth.VerifyToken(token)
            if err != nil {
                return nil, connect.NewError(connect.CodeUnauthenticated, err)
            }
            
            // Check permissions
            resource, action := extractResourceAction(req.Spec().Procedure)
            if !Role(claims.Role).Can(resource, action) {
                return nil, connect.NewError(connect.CodePermissionDenied, errors.New("insufficient permissions"))
            }
            
            // Add claims to context
            ctx = context.WithValue(ctx, claimsKey, claims)
            
            return next(ctx, req)
        }
    }
}
```

---

## 9. Real-time Updates

### 9.1 Event Bus

```go
// internal/events/bus.go
type EventBus struct {
    mu          sync.RWMutex
    subscribers map[string][]chan Event
    redis       *redis.Client
}

type Event struct {
    Type      string
    Payload   interface{}
    Timestamp time.Time
}

func (eb *EventBus) Publish(topic string, event Event) error {
    // Local subscribers
    eb.mu.RLock()
    subs := eb.subscribers[topic]
    eb.mu.RUnlock()
    
    for _, ch := range subs {
        select {
        case ch <- event:
        default:
            // Channel full, skip
        }
    }
    
    // Publish to Redis for cluster-wide distribution
    data, _ := json.Marshal(event)
    return eb.redis.Publish(context.Background(), topic, data).Err()
}

func (eb *EventBus) Subscribe(topic string) <-chan Event {
    ch := make(chan Event, 100)
    
    eb.mu.Lock()
    eb.subscribers[topic] = append(eb.subscribers[topic], ch)
    eb.mu.Unlock()
    
    return ch
}
```

### 9.2 etcd Watch for State Changes

```go
// internal/repository/etcd/watch.go
func (r *Repository) WatchVMState(ctx context.Context, vmID string) <-chan *VMState {
    ch := make(chan *VMState, 10)
    key := fmt.Sprintf("/limiquantix/vms/%s/state", vmID)
    
    go func() {
        defer close(ch)
        
        watchCh := r.client.Watch(ctx, key)
        for resp := range watchCh {
            for _, event := range resp.Events {
                var state VMState
                if err := json.Unmarshal(event.Kv.Value, &state); err != nil {
                    continue
                }
                ch <- &state
            }
        }
    }()
    
    return ch
}
```

---

## 10. Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goals:** Basic server setup, database, proto generation

| Task | Priority | Estimate |
|------|----------|----------|
| Project structure setup | P0 | 2h |
| Configuration management | P0 | 4h |
| PostgreSQL connection | P0 | 2h |
| Database migrations | P0 | 4h |
| Proto code generation | P0 | 2h |
| Basic HTTP server | P0 | 4h |
| Health endpoints | P0 | 1h |
| Logging setup | P0 | 2h |
| Docker Compose | P0 | 2h |

**Deliverables:**
- Running server with `/health` endpoint
- Database connection
- Generated proto code
- Basic logging

### Phase 2: Core Services (Week 3-4)

**Goals:** Implement VM, Node, Storage services

| Task | Priority | Estimate |
|------|----------|----------|
| VM Service (CRUD) | P0 | 8h |
| Node Service (CRUD) | P0 | 6h |
| Storage Pool Service | P0 | 6h |
| Volume Service | P0 | 6h |
| Basic Scheduler | P0 | 8h |
| sqlc queries | P0 | 4h |
| Unit tests | P0 | 8h |

**Deliverables:**
- Working VM/Node/Storage APIs
- Basic VM scheduling
- 80% test coverage

### Phase 3: Networking & Security (Week 5-6)

**Goals:** Network service, auth, RBAC

| Task | Priority | Estimate |
|------|----------|----------|
| Network Service | P0 | 6h |
| Security Group Service | P0 | 4h |
| JWT Authentication | P0 | 6h |
| RBAC implementation | P0 | 4h |
| Auth middleware | P0 | 4h |
| User management | P1 | 4h |

**Deliverables:**
- Complete network APIs
- Working authentication
- Role-based access control

### Phase 4: Real-time & Advanced (Week 7-8)

**Goals:** Streaming, DRS, Alerts

| Task | Priority | Estimate |
|------|----------|----------|
| Event bus | P0 | 4h |
| etcd integration | P0 | 6h |
| Streaming RPCs | P0 | 6h |
| Alert Service | P0 | 6h |
| DRS Engine | P1 | 12h |
| Redis caching | P1 | 4h |

**Deliverables:**
- Real-time streaming
- Alert system
- DRS recommendations

### Phase 5: Integration & Polish (Week 9-10)

**Goals:** Frontend integration, testing, docs

| Task | Priority | Estimate |
|------|----------|----------|
| Frontend integration testing | P0 | 8h |
| Integration tests | P0 | 8h |
| API documentation | P0 | 4h |
| Performance testing | P1 | 4h |
| Security audit | P1 | 4h |
| Bug fixes | P0 | 8h |

**Deliverables:**
- Fully integrated frontend-backend
- Complete test suite
- API documentation

---

## 11. Testing Strategy

### Unit Tests

```go
// internal/services/vm/service_test.go
func TestVMService_CreateVM(t *testing.T) {
    // Setup
    ctrl := gomock.NewController(t)
    defer ctrl.Finish()
    
    mockRepo := mock.NewMockRepository(ctrl)
    mockScheduler := mock.NewMockScheduler(ctrl)
    mockAgents := mock.NewMockAgentPool(ctrl)
    
    service := NewService(mockRepo, mockScheduler, mockAgents, nil, zap.NewNop())
    
    // Expectations
    mockScheduler.EXPECT().
        Schedule(gomock.Any(), gomock.Any()).
        Return("node-1", nil)
    
    mockRepo.EXPECT().
        Create(gomock.Any(), gomock.Any()).
        Return(&domain.VM{ID: "vm-1", Name: "test-vm"}, nil)
    
    mockAgents.EXPECT().
        Get("node-1").
        Return(mockAgent, nil)
    
    // Execute
    req := connect.NewRequest(&computev1.CreateVMRequest{
        Name: "test-vm",
        Spec: &computev1.VmSpec{},
    })
    
    resp, err := service.CreateVM(context.Background(), req)
    
    // Assert
    assert.NoError(t, err)
    assert.Equal(t, "test-vm", resp.Msg.Name)
}
```

### Integration Tests

```go
// internal/integration/vm_test.go
func TestVMLifecycle(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test")
    }
    
    // Setup test containers
    ctx := context.Background()
    postgres := testcontainers.NewPostgres(ctx)
    defer postgres.Terminate(ctx)
    
    // Create client
    client := computev1connect.NewVMServiceClient(
        http.DefaultClient,
        "http://localhost:8080",
    )
    
    // Create VM
    createResp, err := client.CreateVM(ctx, connect.NewRequest(&computev1.CreateVMRequest{
        Name: "integration-test-vm",
        Spec: &computev1.VmSpec{
            Cpu:    &computev1.CpuConfig{Cores: 2},
            Memory: &computev1.MemoryConfig{SizeMib: 2048},
        },
    }))
    require.NoError(t, err)
    vmID := createResp.Msg.Id
    
    // Get VM
    getResp, err := client.GetVM(ctx, connect.NewRequest(&computev1.GetVMRequest{
        Id: vmID,
    }))
    require.NoError(t, err)
    assert.Equal(t, "integration-test-vm", getResp.Msg.Name)
    
    // Delete VM
    _, err = client.DeleteVM(ctx, connect.NewRequest(&computev1.DeleteVMRequest{
        Id: vmID,
    }))
    require.NoError(t, err)
}
```

---

## 12. Deployment

### Docker Compose (Development)

```yaml
# docker-compose.yaml
version: '3.8'

services:
  controlplane:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
      - "9090:9090"
    environment:
      - DB_HOST=postgres
      - DB_PASSWORD=limiquantix
      - ETCD_ENDPOINTS=etcd:2379
      - REDIS_HOST=redis
    depends_on:
      - postgres
      - etcd
      - redis

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: limiquantix
      POSTGRES_PASSWORD: limiquantix
      POSTGRES_DB: limiquantix
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  etcd:
    image: quay.io/coreos/etcd:v3.5.9
    command:
      - etcd
      - --name=etcd0
      - --advertise-client-urls=http://etcd:2379
      - --listen-client-urls=http://0.0.0.0:2379
    ports:
      - "2379:2379"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

### Dockerfile

```dockerfile
# Dockerfile
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /controlplane ./cmd/controlplane

# Runtime
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /controlplane /app/controlplane
COPY configs/config.yaml /app/configs/

EXPOSE 8080 9090

CMD ["/app/controlplane"]
```

### Makefile

```makefile
# Makefile
.PHONY: all build run test lint proto migrate

all: build

build:
	go build -o bin/controlplane ./cmd/controlplane

run:
	go run ./cmd/controlplane

test:
	go test -v -cover ./...

test-integration:
	go test -v -tags=integration ./internal/integration/...

lint:
	golangci-lint run

proto:
	cd ../proto && buf generate

migrate-up:
	go run ./cmd/migrate up

migrate-down:
	go run ./cmd/migrate down

docker-build:
	docker build -t limiquantix/controlplane:latest .

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

seed:
	go run ./cmd/seed
```

---

## Summary

This backend plan provides a comprehensive roadmap for building the LimiQuantix control plane:

1. **Solid Foundation**: Go 1.22+, Connect-RPC, PostgreSQL, etcd, Redis
2. **Clean Architecture**: Clear separation of concerns (services, repositories, domain)
3. **Type-Safe APIs**: Proto-generated code with Connect-RPC
4. **Scalable State**: etcd for runtime state, PostgreSQL for persistence
5. **Real-time Updates**: Event-driven with streaming RPCs
6. **Security First**: JWT auth, RBAC, mTLS for agents
7. **Observable**: Structured logging, metrics, tracing
8. **Testable**: Unit and integration tests with mocks

The implementation follows the 5-phase plan over 10 weeks, delivering incremental value while building toward the complete vision.

---

## Next Steps

1. ✅ Create backend directory structure
2. ✅ Initialize Go module  
3. ✅ Set up Docker Compose
4. ✅ Implement Phase 1 (Foundation)
   - ✅ Configuration management (Viper)
   - ✅ Structured logging (Zap)
   - ✅ HTTP server with health endpoints
   - ✅ Domain models (VM, Node, errors)
   - ✅ Database migrations
   - ✅ Dockerfile
   - ✅ Makefile
5. ✅ Generate proto code for Go
   - Generated Go protobuf code (`backend/pkg/api/limiquantix/`)
   - Generated TypeScript code (`frontend/src/api/limiquantix/`)
   - Connect-Go support for browser-friendly APIs
6. ⏳ Implement Phase 2 (Core Services)
   - See `docs/000024-backend-implementation-guide.md` for detailed implementation steps
   - VM Service (CRUD, power ops, snapshots)
   - Node Service (CRUD, heartbeat, health monitoring)
   - Storage Service (pools, volumes)
   - Network Service (VNets, security groups)
   - Scheduler (VM placement)

