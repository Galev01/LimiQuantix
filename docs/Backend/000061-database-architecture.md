# Database Architecture: Complete Guide

**Document ID:** 000061  
**Date:** January 11, 2026  
**Scope:** PostgreSQL, etcd, Redis - data layer for Quantix-vDC

## Overview

Quantix-vDC uses a three-tier data storage architecture:

| Component | Purpose | Data Type |
|-----------|---------|-----------|
| **PostgreSQL** | Primary persistent storage | VMs, Nodes, Storage Pools, Volumes, Users, Audit logs |
| **etcd** | Distributed coordination | Leader election, cluster state, distributed locks |
| **Redis** | Caching & sessions | API response cache, user sessions, real-time metrics |

---

## How It Starts

### Boot Sequence (Quantix-vDC Appliance)

```
┌──────────────────────────────────────────────────────────────────┐
│                    QUANTIX-vDC BOOT SEQUENCE                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. OpenRC boots Alpine Linux                                    │
│     └─> Mounts filesystems, starts networking                    │
│                                                                  │
│  2. postgresql service starts                                    │
│     └─> /etc/init.d/postgresql16                                 │
│     └─> Data dir: /var/lib/postgresql/16/data                    │
│                                                                  │
│  3. etcd service starts                                          │
│     └─> /etc/init.d/etcd                                         │
│     └─> Data dir: /var/lib/etcd                                  │
│                                                                  │
│  4. redis service starts                                         │
│     └─> /etc/init.d/redis                                        │
│                                                                  │
│  5. quantix-firstboot runs (first boot only)                     │
│     └─> Creates quantix_vdc database                             │
│     └─> Creates quantix user                                     │
│     └─> Generates TLS certs & JWT secret                         │
│                                                                  │
│  6. quantix-controlplane starts                                  │
│     └─> /usr/bin/qx-controlplane --config /etc/quantix-vdc/...   │
│     └─> Connects to PostgreSQL, etcd, Redis                      │
│     └─> Runs database migrations                                 │
│     └─> Starts HTTP/gRPC server on port 8080                     │
│                                                                  │
│  7. nginx starts                                                 │
│     └─> Proxies HTTPS :443 → localhost:8080                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Service Dependencies

```
# /etc/init.d/quantix-controlplane
depend() {
    need net localmount
    after postgresql redis etcd quantix-firstboot
    before nginx
}
```

---

## PostgreSQL Setup

### First Boot Initialization

Location: `Quantix-vDC/installer/firstboot.sh`

```bash
# Step 1: Initialize PostgreSQL cluster
PG_DATA="/var/lib/postgresql/16/data"
su -s /bin/sh postgres -c "initdb -D $PG_DATA --encoding=UTF8 --locale=C"

# Step 2: Configure authentication
cat > "$PG_DATA/pg_hba.conf" << 'EOF'
local   all   all                     trust
host    all   all   127.0.0.1/32      trust
host    all   all   ::1/128           trust
EOF

# Step 3: Start service
rc-service postgresql start

# Step 4: Create database and user
su -s /bin/sh postgres -c "createdb quantix_vdc"
su -s /bin/sh postgres -c "createuser quantix"
su -s /bin/sh postgres -c "psql -c 'GRANT ALL PRIVILEGES ON DATABASE quantix_vdc TO quantix;'"
```

### Database Configuration

Location: `/etc/quantix-vdc/config.yaml`

```yaml
database:
  host: "localhost"
  port: 5432
  user: "postgres"
  password: ""
  database: "quantix_vdc"
  ssl_mode: "disable"
  max_connections: 50
  max_idle_connections: 10
```

### Connection Pool

The backend uses `pgxpool` (high-performance PostgreSQL driver for Go):

```go
// backend/internal/repository/postgres/db.go
poolConfig.MaxConns = 50        // Maximum connections
poolConfig.MinConns = 10        // Keep 10 warm connections
poolConfig.MaxConnLifetime = 5m // Recycle connections every 5 minutes
```

---

## Database Schema

### Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `projects` | Multi-tenancy | id, name, quota |
| `clusters` | Cluster definitions | id, name, ha_enabled, drs_enabled |
| `nodes` | Hypervisor hosts | id, hostname, management_ip, spec, status |
| `virtual_machines` | VMs | id, name, project_id, spec, power_state, node_id |
| `storage_pools` | Storage backends | id, name, pool_type, spec, phase, capacity |
| `volumes` | Virtual disks | id, name, pool_id, size_bytes, attached_vm_id |
| `virtual_networks` | SDN networks | id, name, network_type, vlan_id, cidr |
| `security_groups` | Firewall rule groups | id, name, project_id |
| `security_rules` | Individual rules | security_group_id, direction, protocol |
| `users` | User accounts | id, username, email, password_hash, role |
| `audit_log` | Action history | user_id, action, resource_type, details |
| `vm_snapshots` | VM snapshots | vm_id, name, parent_id, state |
| `images` | OS templates | id, name, pool_id, format, path |
| `alerts` | System alerts | severity, title, source_type |
| `drs_recommendations` | DRS suggestions | cluster_id, vm_id, source_node, target_node |

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  projects   │───────│ virtual_    │───────│   nodes     │
│             │       │ machines    │       │             │
└─────────────┘       └─────────────┘       └─────────────┘
       │                     │                     │
       │              ┌──────┴──────┐              │
       │              │             │              │
       ▼              ▼             ▼              ▼
┌─────────────┐ ┌─────────┐  ┌──────────────┐ ┌─────────────┐
│  security_  │ │ volumes │  │ vm_snapshots │ │  clusters   │
│  groups     │ │         │  │              │ │             │
└─────────────┘ └─────────┘  └──────────────┘ └─────────────┘
       │              │
       │              │
       ▼              ▼
┌─────────────┐ ┌─────────────┐
│  security_  │ │ storage_    │
│  rules      │ │ pools       │
└─────────────┘ └─────────────┘
                      │
                      ▼
                ┌─────────────┐
                │   images    │
                └─────────────┘
```

### Migrations

Migrations are stored in `backend/migrations/` and follow the naming convention:

```
000001_init.up.sql          # Initial schema
000001_init.down.sql        # Rollback
000002_admin_tables.up.sql  # Admin panel tables
000003_storage_pool_extended.up.sql  # Storage pool persistence fix
000004_volume_extended.up.sql  # Volume persistence fix
```

**To run migrations:**

```bash
# Using golang-migrate
migrate -path migrations -database "postgres://postgres@localhost:5432/quantix_vdc?sslmode=disable" up

# Or using the Makefile
make migrate-up
```

---

## Repository Pattern

### Interface Definition

Each domain entity has a repository interface:

```go
// backend/internal/services/storage/pool_repository.go
type PoolRepository interface {
    Create(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error)
    Get(ctx context.Context, id string) (*domain.StoragePool, error)
    GetByName(ctx context.Context, projectID, name string) (*domain.StoragePool, error)
    List(ctx context.Context, filter PoolFilter, limit, offset int) ([]*domain.StoragePool, int, error)
    Update(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error)
    Delete(ctx context.Context, id string) error
    UpdateStatus(ctx context.Context, id string, status domain.StoragePoolStatus) error
}
```

### Implementation Selection

The server chooses implementations based on available backends:

```go
// backend/internal/server/server.go
func (s *Server) initRepositories() {
    if s.db != nil {
        // Production: PostgreSQL
        s.vmRepo = postgres.NewVMRepository(s.db, s.logger)
        s.nodeRepo = postgres.NewNodeRepository(s.db, s.logger)
        s.storagePoolRepo = postgres.NewStoragePoolRepository(s.db, s.logger)
        s.logger.Info("Using PostgreSQL repositories (persistent)")
    } else {
        // Development: In-memory
        s.vmRepo = memory.NewVMRepository()
        s.nodeRepo = memory.NewNodeRepository()
        s.storagePoolRepo = memory.NewStoragePoolRepository()
        s.logger.Warn("Using in-memory repositories (data lost on restart)")
    }
}
```

---

## Development vs Production Mode

### Development Mode (`--dev` flag)

```bash
# Start in dev mode (no database required)
./controlplane --dev
```

Behavior:
- ✅ Skips PostgreSQL, etcd, Redis connections
- ✅ Uses in-memory repositories
- ⚠️ **All data is lost on restart**
- ⚠️ Admin panel features disabled

### Production Mode (default)

```bash
# Start normally (connects to databases)
./controlplane --config /etc/quantix-vdc/config.yaml
```

Behavior:
- ✅ Connects to PostgreSQL (persistent storage)
- ✅ Connects to Redis (caching)
- ✅ Connects to etcd (distributed coordination)
- ✅ All data persists across restarts
- ✅ Full feature set available

### Fallback Behavior

If a database connection fails in production mode, the backend **falls back gracefully**:

```go
// Connect to PostgreSQL
db, err := connectPostgres(ctx, cfg.Database, logger)
if err != nil {
    logger.Warn("PostgreSQL connection failed, falling back to in-memory", zap.Error(err))
} else {
    opts = append(opts, server.WithPostgreSQL(db))
}
```

---

## etcd Usage

### Purpose

etcd is used for **distributed coordination** in multi-node control plane deployments:

| Feature | etcd Key Pattern | Description |
|---------|------------------|-------------|
| Leader Election | `/quantix/leader` | Ensures only one active control plane |
| Distributed Locks | `/quantix/locks/{resource}` | Prevents concurrent modifications |
| Cluster Membership | `/quantix/members/{id}` | Control plane instance discovery |
| Configuration | `/quantix/config/{key}` | Distributed configuration |

### Configuration

```yaml
etcd:
  endpoints:
    - "localhost:2379"
  dial_timeout: 5s
  request_timeout: 10s
```

### Connection

```go
// backend/internal/repository/etcd/client.go
func NewClient(cfg config.EtcdConfig, logger *zap.Logger) (*Client, error) {
    client, err := clientv3.New(clientv3.Config{
        Endpoints:   cfg.Endpoints,
        DialTimeout: cfg.DialTimeout,
    })
    // ...
}
```

---

## Redis Usage

### Purpose

Redis is used for **caching and real-time data**:

| Use Case | Key Pattern | TTL |
|----------|-------------|-----|
| API Response Cache | `cache:api:{hash}` | 60 seconds |
| User Sessions | `session:{token}` | 24 hours |
| Node Metrics | `metrics:node:{id}` | 30 seconds |
| Rate Limiting | `ratelimit:{ip}` | 1 minute |

### Configuration

```yaml
redis:
  host: "localhost"
  port: 6379
  password: ""
  database: 0
```

---

## Backup & Recovery

### PostgreSQL Backup

```bash
# Full database backup
pg_dump -U postgres quantix_vdc > backup_$(date +%Y%m%d).sql

# Restore from backup
psql -U postgres quantix_vdc < backup_20260111.sql
```

### Automated Backup Script

```bash
#!/bin/bash
# /etc/periodic/daily/backup-quantix
BACKUP_DIR="/var/backups/quantix"
mkdir -p "$BACKUP_DIR"

# PostgreSQL
pg_dump -U postgres quantix_vdc | gzip > "$BACKUP_DIR/db_$(date +%Y%m%d).sql.gz"

# Keep last 7 days
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +7 -delete
```

### etcd Backup

```bash
# Snapshot etcd data
etcdctl snapshot save /var/backups/quantix/etcd_$(date +%Y%m%d).snap

# Restore from snapshot
etcdctl snapshot restore /var/backups/quantix/etcd_20260111.snap
```

---

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Check PostgreSQL status
rc-service postgresql status

# Check if listening
netstat -tlnp | grep 5432

# Test connection
psql -U postgres -c "SELECT 1"

# Check logs
tail -f /var/log/postgresql/postgresql-16-main.log
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `connection refused` | PostgreSQL not running | `rc-service postgresql start` |
| `FATAL: database "quantix_vdc" does not exist` | First boot not completed | Run `firstboot.sh` |
| `FATAL: role "quantix" does not exist` | User not created | `createuser quantix` |
| `Too many connections` | Pool exhausted | Increase `max_connections` |

### View Current Connections

```sql
-- Check active connections
SELECT * FROM pg_stat_activity WHERE datname = 'quantix_vdc';

-- Kill all connections (for maintenance)
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'quantix_vdc' AND pid <> pg_backend_pid();
```

---

## Performance Tuning

### PostgreSQL Settings

Edit `/var/lib/postgresql/16/data/postgresql.conf`:

```ini
# Memory
shared_buffers = 256MB          # 25% of RAM for dedicated server
effective_cache_size = 768MB    # 75% of RAM
work_mem = 16MB                 # Per-query memory

# Connections
max_connections = 100           # Adjust based on load
superuser_reserved_connections = 5

# Logging
log_min_duration_statement = 1000  # Log queries > 1s
log_statement = 'ddl'              # Log schema changes
```

### Connection Pool Sizing

Rule of thumb for `max_connections`:
```
max_connections = (num_cpus * 2) + effective_spindle_count
```

For Quantix-vDC appliance with 4 cores and SSD:
```
max_connections = (4 * 2) + 1 = 9 (round to 25-50 for headroom)
```

---

## Security

### Network Isolation

PostgreSQL in Quantix-vDC only listens on localhost:

```sql
listen_addresses = '127.0.0.1'
```

The control plane is the only component that accesses the database directly.

### Authentication

```
# pg_hba.conf
local   all   all                trust   # Local socket (trusted)
host    all   all   127.0.0.1/32 trust   # Localhost only
```

> **Note:** `trust` authentication is used because the appliance is a dedicated VM with no external database access. For multi-tenant production deployments, use `scram-sha-256` authentication.

### Future Enhancements

- [ ] Move to password authentication for production
- [ ] Add TLS for PostgreSQL connections
- [ ] Implement encryption at rest for sensitive fields
- [ ] Add audit logging for database access

---

## Related Documents

- [000054-local-development-guide.md](000054-local-development-guide.md)
- [000024-backend-implementation-guide.md](000024-backend-implementation-guide.md)
- [000027-backend-phase3-data-persistence.md](000027-backend-phase3-data-persistence.md)
