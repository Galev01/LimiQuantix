# Backend Phase 3 Implementation - Data Persistence

**Document ID:** 000027  
**Purpose:** Documents the implementation of Backend Phase 3: Data Persistence  
**Status:** ✅ Complete  
**Date:** January 2026

---

## Overview

Backend Phase 3 integrates PostgreSQL, Redis, and etcd for production-grade data persistence, caching, and distributed coordination. The system supports both development mode (in-memory) and production mode (full infrastructure).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Control Plane Server                              │
│                                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                  │
│  │  Services   │───▶│ Repositories│───▶│   Storage   │                  │
│  └─────────────┘    └─────────────┘    └─────────────┘                  │
│                            │                  │                          │
│                            ▼                  ▼                          │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │                     Infrastructure Layer                             ││
│  │                                                                      ││
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              ││
│  │  │ PostgreSQL  │    │   Redis     │    │    etcd     │              ││
│  │  │   (Data)    │    │  (Cache)    │    │ (Coord)     │              ││
│  │  └─────────────┘    └─────────────┘    └─────────────┘              ││
│  └─────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. PostgreSQL Repository Layer

**Location:** `backend/internal/repository/postgres/`

#### Database Connection (`db.go`)

```go
// Creates a connection pool with configurable settings
db, err := postgres.NewDB(ctx, cfg.Database, logger)

// Configuration options:
- Host, Port, Name, User, Password
- SSLMode (disable, require, verify-full)
- MaxOpenConns, MaxIdleConns
- ConnMaxLifetime
```

#### VM Repository (`vm_repository.go`)

| Method | Description |
|--------|-------------|
| `Create` | Insert VM with JSON spec/labels |
| `Get` | Retrieve VM by ID |
| `List` | Filter/paginate VMs |
| `Update` | Update VM spec/labels |
| `UpdateStatus` | Update power state, node, IPs |
| `Delete` | Remove VM |
| `ListByNode` | Get VMs on a specific node |
| `CountByNodeID` | Count VMs on a node |

#### Node Repository (`node_repository.go`)

| Method | Description |
|--------|-------------|
| `Create` | Register a new node |
| `Get` | Retrieve node by ID |
| `GetByHostname` | Retrieve node by hostname |
| `List` | Filter nodes by phase, cluster, labels |
| `ListSchedulable` | Get nodes ready for VM placement |
| `Update` | Update node spec/labels |
| `UpdateStatus` | Update phase, conditions, resources |
| `UpdateHeartbeat` | Update last heartbeat time |
| `Delete` | Decommission node |

---

### 2. Redis Cache Layer

**Location:** `backend/internal/repository/redis/cache.go`

#### Features

| Feature | Description |
|---------|-------------|
| **Generic Cache** | `Get`, `Set`, `Delete` with TTL |
| **VM Cache** | `GetVM`, `SetVM`, `InvalidateVM` |
| **Node Cache** | `GetNode`, `SetNode`, `InvalidateNode` |
| **Pub/Sub** | `Publish`, `Subscribe` for real-time events |
| **Sessions** | `SetSession`, `GetSession`, `DeleteSession` |
| **Rate Limiting** | `CheckRateLimit` with sliding window |

#### TTL Defaults

- VM Cache: 5 minutes
- Node Cache: 1 minute (shorter due to status changes)
- Sessions: 24 hours

#### Event Publishing

```go
// Publish VM event
cache.PublishVMEvent(ctx, "vm.started", vm)

// Subscribe to VM events
events := cache.Subscribe(ctx, "events:vm")
for event := range events {
    log.Printf("Event: %s, Resource: %s", event.Type, event.ResourceID)
}
```

---

### 3. etcd Coordination

**Location:** `backend/internal/repository/etcd/client.go`

#### Features

| Feature | Description |
|---------|-------------|
| **Key-Value** | `Put`, `Get`, `Delete`, `List` |
| **Watch** | Watch keys/prefixes for changes |
| **Distributed Lock** | `AcquireLock`, `TryAcquireLock`, `Unlock` |
| **Leader Election** | `CampaignForLeader`, `IsLeader`, `Resign` |
| **Node Registry** | `RegisterNode`, `UpdateNodeHeartbeat`, `GetNodes` |

#### Leader Election

```go
// Campaign for leadership
leader, err := etcd.CampaignForLeader(ctx, "controlplane", func(isLeader bool) {
    if isLeader {
        // Start leader-only tasks (DRS, HA)
    } else {
        // Stop leader-only tasks
    }
})

// Check if leader
if leader.IsLeader() {
    // Execute leader operations
}
```

#### Distributed Locking

```go
// Acquire lock for VM migration
lock, err := etcd.AcquireLock(ctx, "migrate:vm-123")
if err != nil {
    return err
}
defer lock.Unlock(ctx)

// Perform migration (exclusive access guaranteed)
```

---

## Server Integration

### Development Mode

```bash
# Run with in-memory repositories
go run cmd/controlplane/main.go --dev
```

### Production Mode

```bash
# Run with full infrastructure
go run cmd/controlplane/main.go

# The server will attempt to connect to:
# - PostgreSQL (required for data persistence)
# - Redis (optional, for caching)
# - etcd (optional, for distributed features)
```

### Server Options

```go
// Create server with specific infrastructure
srv := server.New(cfg, logger,
    server.WithPostgreSQL(db),
    server.WithRedis(cache),
    server.WithEtcd(etcdClient),
)
```

### Health Checks

The `/ready` endpoint now checks all infrastructure:

```json
{
  "ready": true,
  "components": {
    "postgres": "healthy",
    "redis": "healthy",
    "etcd": "healthy"
  }
}
```

---

## Database Schema

The migration `migrations/000001_init.up.sql` creates:

| Table | Description |
|-------|-------------|
| `projects` | Multi-tenant project definitions |
| `clusters` | Cluster configurations |
| `nodes` | Hypervisor host records |
| `virtual_machines` | VM definitions and status |
| `storage_pools` | Storage backend configurations |
| `volumes` | Virtual disk records |
| `virtual_networks` | SDN network definitions |
| `security_groups` | Firewall rule groups |
| `security_rules` | Individual firewall rules |
| `alerts` | System alerts |
| `drs_recommendations` | DRS migration suggestions |
| `users` | User accounts |
| `audit_log` | Action audit trail |
| `vm_snapshots` | VM snapshots |
| `images` | OS template images |

---

## Configuration

### PostgreSQL (`config.yaml`)

```yaml
database:
  host: localhost
  port: 5432
  name: limiquantix
  user: limiquantix
  password: limiquantix
  sslmode: disable
  max_open_conns: 25
  max_idle_conns: 5
  conn_max_lifetime: 5m
```

### Redis

```yaml
redis:
  host: localhost
  port: 6379
  password: ""
  db: 0
```

### etcd

```yaml
etcd:
  endpoints:
    - localhost:2379
  dial_timeout: 5s
  username: ""
  password: ""
```

---

## Docker Compose

Update `docker-compose.yaml` to include all services:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: limiquantix
      POSTGRES_PASSWORD: limiquantix
      POSTGRES_DB: limiquantix
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  etcd:
    image: quay.io/coreos/etcd:v3.5.17
    command:
      - etcd
      - --name=etcd0
      - --advertise-client-urls=http://localhost:2379
      - --listen-client-urls=http://0.0.0.0:2379
    ports:
      - "2379:2379"

  controlplane:
    build: .
    depends_on:
      - postgres
      - redis
      - etcd
    environment:
      limiquantix_DATABASE_HOST: postgres
      limiquantix_REDIS_HOST: redis
      limiquantix_ETCD_ENDPOINTS: etcd:2379
    ports:
      - "8080:8080"

volumes:
  postgres_data:
```

---

## Running Migrations

```bash
# Install golang-migrate
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# Run migrations
migrate -path migrations -database "postgres://limiquantix:limiquantix@localhost:5432/limiquantix?sslmode=disable" up

# Rollback
migrate -path migrations -database "..." down 1
```

---

## Dependencies Added

```go
// go.mod additions
require (
    github.com/jackc/pgx/v5 v5.7.2          // PostgreSQL driver
    github.com/redis/go-redis/v9 v9.7.0     // Redis client
    go.etcd.io/etcd/client/v3 v3.5.17       // etcd client
)
```

Install with:
```bash
cd backend
go mod tidy
```

---

## File Summary

```
backend/internal/repository/
├── memory/                    # In-memory implementations
│   ├── vm_repository.go
│   ├── node_repository.go
│   ├── storage_pool_repository.go
│   ├── volume_repository.go
│   ├── network_repository.go
│   └── security_group_repository.go
├── postgres/                  # PostgreSQL implementations
│   ├── db.go                  # Connection pool
│   ├── vm_repository.go       # VM CRUD
│   └── node_repository.go     # Node CRUD
├── redis/
│   └── cache.go               # Cache, pub/sub, rate limiting
└── etcd/
    └── client.go              # K/V, locks, leader election
```

---

## Next Steps (Phase 4)

1. **JWT Authentication** - Implement auth middleware
2. **RBAC Authorization** - Role-based access control
3. **DRS Engine** - Automatic VM load balancing
4. **HA Manager** - Automatic VM failover
5. **Real-time Streaming** - gRPC streaming for live updates

---

## Testing

### Start Infrastructure

```bash
# Start PostgreSQL, Redis, etcd
docker compose up -d postgres redis etcd

# Run migrations
make migrate-up

# Start control plane
go run cmd/controlplane/main.go
```

### Development Mode

```bash
# Run without external dependencies
go run cmd/controlplane/main.go --dev
```

---

## References

- [Backend Plan](../backend-plan.md)
- [Backend Implementation Guide](./000024-backend-implementation-guide.md)
- [Phase 2 Implementation](./000026-backend-phase2-implementation.md)
- [Database Schema](../backend/migrations/000001_init.up.sql)
