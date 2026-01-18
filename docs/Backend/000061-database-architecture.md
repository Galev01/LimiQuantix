# Database Architecture: Complete Guide

**Document ID:** 000061  
**Date:** January 18, 2026  
**Scope:** PostgreSQL, etcd, Redis - data layer for Quantix-vDC

---

## Table of Contents

1. [Overview](#overview)
2. [Three-Tier Data Architecture](#three-tier-data-architecture)
3. [PostgreSQL Configuration](#postgresql-configuration)
4. [Database Users & Authentication](#database-users--authentication)
5. [QvDC Installation Integration](#qvdc-installation-integration)
6. [Database Schema](#database-schema)
7. [Migrations System](#migrations-system)
8. [Repository Pattern](#repository-pattern)
9. [Connection Pooling](#connection-pooling)
10. [etcd Usage](#etcd-usage)
11. [Redis Usage](#redis-usage)
12. [Development vs Production Mode](#development-vs-production-mode)
13. [Backup & Recovery](#backup--recovery)
14. [Troubleshooting](#troubleshooting)
15. [Performance Tuning](#performance-tuning)
16. [Security Considerations](#security-considerations)

---

## Overview

Quantix-vDC uses a three-tier data storage architecture designed for reliability, performance, and distributed coordination:

| Component | Purpose | Data Type | Port |
|-----------|---------|-----------|------|
| **PostgreSQL 16** | Primary persistent storage | VMs, Nodes, Storage Pools, Volumes, Users, Audit logs | 5432 |
| **etcd 3.5** | Distributed coordination | Leader election, cluster state, distributed locks | 2379 |
| **Redis 7.2** | Caching & sessions | API response cache, user sessions, real-time metrics | 6379 |

---

## Three-Tier Data Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         QUANTIX-vDC DATA LAYER                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    CONTROL PLANE (Go Backend)                         │   │
│  │                    /usr/bin/qx-controlplane                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│           │                    │                      │                      │
│           ▼                    ▼                      ▼                      │
│  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐              │
│  │  PostgreSQL    │   │     etcd       │   │     Redis      │              │
│  │  (Persistent)  │   │  (Distributed) │   │   (Caching)    │              │
│  ├────────────────┤   ├────────────────┤   ├────────────────┤              │
│  │ • VMs          │   │ • Leader elect │   │ • API cache    │              │
│  │ • Nodes        │   │ • Dist. locks  │   │ • Sessions     │              │
│  │ • Storage      │   │ • Cluster state│   │ • Rate limits  │              │
│  │ • Networks     │   │ • Config sync  │   │ • Metrics      │              │
│  │ • Users        │   │                │   │                │              │
│  │ • Audit logs   │   │                │   │                │              │
│  └────────────────┘   └────────────────┘   └────────────────┘              │
│         │                    │                      │                       │
│         ▼                    ▼                      ▼                       │
│  /var/lib/postgresql  /var/lib/etcd      In-memory (volatile)              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PostgreSQL Configuration

### Default Configuration

Location: `/etc/quantix-vdc/config.yaml`

```yaml
database:
  host: "localhost"
  port: 5432
  name: "quantix_vdc"
  user: "postgres"
  password: ""
  sslmode: "disable"
  max_open_conns: 50
  max_idle_conns: 10
```

### Data Directory

| Path | Purpose |
|------|---------|
| `/var/lib/postgresql/16/data` | PostgreSQL data directory |
| `/var/lib/postgresql/16/data/pg_hba.conf` | Client authentication config |
| `/var/lib/postgresql/16/data/postgresql.conf` | Server configuration |
| `/var/log/postgresql/` | PostgreSQL logs |
| `/run/postgresql/` | Runtime socket directory |

### PostgreSQL Configuration Files

**pg_hba.conf** (Client Authentication):
```
# TYPE  DATABASE        USER            ADDRESS                 METHOD
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
```

**postgresql.conf** (Key Settings):
```ini
listen_addresses = '127.0.0.1'
port = 5432
max_connections = 100
shared_buffers = 256MB
```

---

## Database Users & Authentication

### Users

| User | Password | Purpose | Permissions |
|------|----------|---------|-------------|
| `postgres` | (none - trust auth) | Superuser | ALL on all databases |
| `quantix` | (none - trust auth) | Application user | ALL on `quantix_vdc` database |

### Why Trust Authentication?

The QvDC appliance uses `trust` authentication because:

1. **Isolated Environment**: PostgreSQL only listens on `127.0.0.1` (localhost)
2. **Single-Purpose Appliance**: The VM is dedicated to running QvDC
3. **No External Access**: nginx proxies all external requests; database is never exposed
4. **Simplicity**: Eliminates password management complexity for appliance deployments

> **Production Note**: For multi-tenant or externally-accessible deployments, switch to `scram-sha-256` authentication and set passwords.

### Creating Users Manually

```bash
# Connect as postgres superuser
su -s /bin/sh postgres -c "psql"

# Create application user
CREATE USER quantix WITH PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE quantix_vdc TO quantix;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO quantix;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO quantix;
```

---

## QvDC Installation Integration

### Boot Sequence

```
┌──────────────────────────────────────────────────────────────────┐
│                    QUANTIX-vDC BOOT SEQUENCE                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. OpenRC boots Alpine Linux                                    │
│     └─> Mounts filesystems, starts networking                    │
│                                                                  │
│  2. quantix-firstboot service (boot runlevel)                    │
│     └─> Initializes PostgreSQL data directory (initdb)           │
│     └─> Configures pg_hba.conf for local trust                   │
│     └─> Creates /var/lib/quantix-vdc/.setup_complete marker      │
│                                                                  │
│  3. postgresql service starts (default runlevel)                 │
│     └─> /etc/init.d/postgresql16                                 │
│     └─> Data dir: /var/lib/postgresql/16/data                    │
│                                                                  │
│  4. redis service starts                                         │
│     └─> /etc/init.d/redis                                        │
│                                                                  │
│  5. etcd service starts                                          │
│     └─> /etc/init.d/etcd                                         │
│     └─> Data dir: /var/lib/etcd                                  │
│                                                                  │
│  6. quantix-controlplane starts                                  │
│     └─> start_pre(): Waits for PostgreSQL                        │
│     └─> start_pre(): Creates quantix_vdc database if missing     │
│     └─> start_pre(): Runs migrations if tables missing           │
│     └─> Connects to PostgreSQL, etcd, Redis                      │
│     └─> Starts HTTP/gRPC server on port 8080                     │
│                                                                  │
│  7. 99-start-services.start (local.d fallback)                   │
│     └─> Ensures all services are running                         │
│     └─> Creates database if not exists (backup check)            │
│     └─> Runs migrations if not applied                           │
│                                                                  │
│  8. nginx starts                                                 │
│     └─> Proxies HTTPS :443 → localhost:8080                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Service Dependencies

```bash
# /etc/init.d/quantix-controlplane
depend() {
    need net localmount
    after postgresql redis etcd quantix-firstboot
    before nginx
}
```

### Database Initialization in Control Plane Service

The `quantix-controlplane` service's `start_pre()` function handles database setup:

```bash
# From /etc/init.d/quantix-controlplane

start_pre() {
    # Wait for PostgreSQL to be ready
    for i in $(seq 1 30); do
        if pg_isready -q; then
            break
        fi
        sleep 1
    done
    
    # Create database if it doesn't exist
    if ! su -s /bin/sh postgres -c "psql -lqt | grep -qw quantix_vdc"; then
        su -s /bin/sh postgres -c "createdb quantix_vdc"
    fi
    
    # Run migrations if tables don't exist
    MIGRATIONS_DIR="/usr/share/quantix-vdc/migrations"
    if [ -d "$MIGRATIONS_DIR" ]; then
        if ! su -s /bin/sh postgres -c "psql -d quantix_vdc -c '\\dt' | grep -q 'virtual_machines'"; then
            for migration in $(ls -1 ${MIGRATIONS_DIR}/*.up.sql | sort); do
                su -s /bin/sh postgres -c "psql -d quantix_vdc -f '$migration'"
            done
        fi
    fi
}
```

### Migration Files Location

| Location | Purpose |
|----------|---------|
| `backend/migrations/` | Source migrations (development) |
| `/usr/share/quantix-vdc/migrations/` | Installed migrations (ISO) |

---

## Database Schema

### Core Tables (Migration 000001)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | Multi-tenancy | id, name, quota |
| `clusters` | Cluster definitions | id, name, ha_enabled, drs_enabled |
| `nodes` | Hypervisor hosts | id, hostname, management_ip, spec, status, phase |
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

### Admin Tables (Migration 000002)

| Table | Purpose |
|-------|---------|
| `roles` | Custom role definitions with permissions |
| `api_keys` | API key management |
| `sso_configs` | SSO provider configuration (OIDC, SAML, LDAP) |
| `organizations` | Multi-org support |
| `admin_emails` | Admin notification contacts |
| `global_rules` | Policy engine rules |
| `certificates` | TLS certificate metadata |
| `user_roles` | User-to-role assignments |

### Extended Tables (Migrations 000003-000010)

| Migration | Tables/Changes |
|-----------|----------------|
| 000003 | `storage_pools` extended with project_id, labels, assigned_node_ids |
| 000004 | `volumes` extended fields |
| 000005 | `pool_host_statuses` for per-host pool status |
| 000006 | `folders` for VM organization hierarchy |
| 000007 | `customization_specs` for VM templates |
| 000008 | IPAM tables: `subnet_pools`, `ip_allocations`, `mac_registry`, `dhcp_static_bindings` |
| 000009/10 | State reconciliation: `origin`, `is_managed`, `last_seen` fields |

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────────┐       ┌─────────────┐
│  projects   │───────│ virtual_machines│───────│   nodes     │
│             │       │                 │       │             │
└─────────────┘       └─────────────────┘       └─────────────┘
       │                     │    │                   │
       │              ┌──────┘    └──────┐            │
       │              │                  │            │
       ▼              ▼                  ▼            ▼
┌─────────────┐ ┌─────────┐      ┌──────────────┐ ┌─────────────┐
│  security_  │ │ volumes │      │ vm_snapshots │ │  clusters   │
│  groups     │ │         │      │              │ │             │
└─────────────┘ └─────────┘      └──────────────┘ └─────────────┘
       │              │                  │
       │              │                  │
       ▼              ▼                  ▼
┌─────────────┐ ┌─────────────┐   ┌─────────────┐
│  security_  │ │ storage_    │   │   folders   │
│  rules      │ │ pools       │   │             │
└─────────────┘ └─────────────┘   └─────────────┘
                      │
                      ▼
                ┌─────────────┐
                │   images    │
                └─────────────┘
```

### Default Seed Data

The initial migration creates default data:

```sql
-- Default project (ID: 00000000-0000-0000-0000-000000000001)
INSERT INTO projects (id, name, description) VALUES 
    ('00000000-0000-0000-0000-000000000001', 'default', 'Default project');

-- Default security group with allow-all rules
INSERT INTO security_groups (id, name, description, project_id, is_default) VALUES
    ('00000000-0000-0000-0000-000000000001', 'default', 'Default security group', 
     '00000000-0000-0000-0000-000000000001', TRUE);

-- Admin user (password: admin, bcrypt hash)
INSERT INTO users (id, username, email, password_hash, role) VALUES
    ('00000000-0000-0000-0000-000000000001', 'admin', 'admin@limiquantix.local', 
     '$2a$10$N9qo8uLOickgx2ZMRZoMye8.4Zu7QxQZqJzLz6.2eVCTQQjvMidjW', 'admin');

-- System roles (admin, operator, viewer)
INSERT INTO roles (id, name, description, type, permissions) VALUES
    ('00000000-0000-0000-0001-000000000001', 'admin', 'Full system access', 'system', '[...]'),
    ('00000000-0000-0000-0001-000000000002', 'operator', 'Can manage VMs', 'system', '[...]'),
    ('00000000-0000-0000-0001-000000000003', 'viewer', 'Read-only access', 'system', '[...]');
```

---

## Migrations System

### Migration File Naming Convention

```
{sequence}_{description}.{direction}.sql

Examples:
000001_init.up.sql          # Initial schema (apply)
000001_init.down.sql        # Initial schema (rollback)
000002_admin_tables.up.sql  # Admin tables (apply)
000002_admin_tables.down.sql # Admin tables (rollback)
```

### Current Migrations

| Migration | Description | Tables Created/Modified |
|-----------|-------------|------------------------|
| 000001 | Initial schema | projects, clusters, nodes, virtual_machines, storage_pools, volumes, virtual_networks, security_groups, security_rules, alerts, drs_recommendations, users, audit_log, vm_snapshots, images |
| 000002 | Admin panel | roles, api_keys, sso_configs, organizations, admin_emails, global_rules, certificates, user_roles |
| 000003 | Storage pool extended | storage_pools (add project_id, labels, assigned_node_ids) |
| 000004 | Volume extended | volumes (extended fields) |
| 000005 | Pool host statuses | pool_host_statuses |
| 000006 | VM folders | folders, virtual_machines.folder_id |
| 000007 | Customization specs | customization_specs |
| 000008 | IPAM | subnet_pools, ip_allocations, mac_registry, dhcp_static_bindings |
| 000009/10 | State reconciliation | virtual_machines/storage_pools (origin, is_managed, last_seen) |

### Running Migrations Manually

```bash
# On QvDC appliance
MIGRATIONS_DIR="/usr/share/quantix-vdc/migrations"

# Apply all migrations
for migration in $(ls -1 ${MIGRATIONS_DIR}/*.up.sql | sort); do
    echo "Applying: $(basename $migration)"
    su -s /bin/sh postgres -c "psql -d quantix_vdc -f '$migration'"
done

# Grant permissions after migrations
su -s /bin/sh postgres -c "psql -d quantix_vdc -c 'GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;'"
su -s /bin/sh postgres -c "psql -d quantix_vdc -c 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;'"
```

### Using golang-migrate (Development)

```bash
# Install migrate CLI
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

# Apply migrations
migrate -path backend/migrations -database "postgres://postgres@localhost:5432/quantix_vdc?sslmode=disable" up

# Rollback last migration
migrate -path backend/migrations -database "postgres://postgres@localhost:5432/quantix_vdc?sslmode=disable" down 1

# Check current version
migrate -path backend/migrations -database "postgres://postgres@localhost:5432/quantix_vdc?sslmode=disable" version
```

---

## Repository Pattern

### Interface Definition

Each domain entity has a repository interface in the service package:

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

### PostgreSQL Implementation

```go
// backend/internal/repository/postgres/storage_pool_repository.go
type StoragePoolRepository struct {
    db     *DB
    logger *zap.Logger
}

func NewStoragePoolRepository(db *DB, logger *zap.Logger) *StoragePoolRepository {
    return &StoragePoolRepository{
        db:     db,
        logger: logger.With(zap.String("repository", "storage_pool")),
    }
}

// Implements storage.PoolRepository
var _ storage.PoolRepository = (*StoragePoolRepository)(nil)
```

### Repository Files

| File | Entity |
|------|--------|
| `vm_repository.go` | Virtual Machines |
| `node_repository.go` | Hypervisor Nodes |
| `storage_pool_repository.go` | Storage Pools |
| `volume_repository.go` | Volumes |
| `cluster_repository.go` | Clusters |
| `folder_repository.go` | VM Folders |
| `audit_repository.go` | Audit Logs |
| `role_repository.go` | Roles |
| `api_key_repository.go` | API Keys |
| `sso_config_repository.go` | SSO Configurations |
| `organization_repository.go` | Organizations |
| `admin_email_repository.go` | Admin Emails |
| `global_rule_repository.go` | Global Rules |

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
        // Development: In-memory (data lost on restart)
        s.vmRepo = memory.NewVMRepository()
        s.nodeRepo = memory.NewNodeRepository()
        s.storagePoolRepo = memory.NewStoragePoolRepository()
        s.logger.Warn("Using in-memory repositories (data lost on restart)")
    }
}
```

---

## Connection Pooling

### pgxpool Configuration

The backend uses `pgxpool` (high-performance PostgreSQL driver for Go):

```go
// backend/internal/repository/postgres/db.go
func NewDB(ctx context.Context, cfg config.DatabaseConfig, logger *zap.Logger) (*DB, error) {
    dsn := fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        cfg.User, cfg.Password, cfg.Host, cfg.Port, cfg.Name, cfg.SSLMode,
    )

    poolConfig, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, fmt.Errorf("failed to parse PostgreSQL config: %w", err)
    }

    // Configure connection pool
    poolConfig.MaxConns = int32(cfg.MaxOpenConns)     // Maximum connections (default: 50)
    poolConfig.MinConns = int32(cfg.MaxIdleConns)     // Keep warm connections (default: 10)
    poolConfig.MaxConnLifetime = cfg.ConnMaxLifetime  // Recycle connections

    pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
    // ...
}
```

### Pool Sizing Guidelines

```
max_connections = (num_cpus * 2) + effective_spindle_count
```

| Appliance Size | CPUs | Recommended MaxConns |
|----------------|------|---------------------|
| Small (4 vCPU) | 4 | 25-50 |
| Medium (8 vCPU) | 8 | 50-100 |
| Large (16 vCPU) | 16 | 100-200 |

---

## etcd Usage

### Purpose

etcd is used for **distributed coordination** in multi-node control plane deployments:

| Feature | Key Pattern | Description |
|---------|-------------|-------------|
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

### Data Directory

| Path | Purpose |
|------|---------|
| `/var/lib/etcd` | etcd data directory |
| `/var/log/etcd.log` | etcd output log |
| `/var/log/etcd.err` | etcd error log |

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

## Development vs Production Mode

### Development Mode

```bash
# Start in dev mode (no database required)
./qx-controlplane --dev
```

| Feature | Behavior |
|---------|----------|
| PostgreSQL | Skipped - uses in-memory storage |
| etcd | Skipped |
| Redis | Skipped |
| Data Persistence | ⚠️ **All data lost on restart** |
| Admin Features | Disabled |

### Production Mode (Default)

```bash
# Start normally (connects to databases)
./qx-controlplane --config /etc/quantix-vdc/config.yaml
```

| Feature | Behavior |
|---------|----------|
| PostgreSQL | Connected - persistent storage |
| etcd | Connected - distributed coordination |
| Redis | Connected - caching |
| Data Persistence | ✅ All data persists |
| Admin Features | Fully available |

### Fallback Behavior

If PostgreSQL connection fails in production mode, the backend **falls back gracefully**:

```go
db, err := connectPostgres(ctx, cfg.Database, logger)
if err != nil {
    logger.Warn("PostgreSQL connection failed, falling back to in-memory", zap.Error(err))
    // Uses in-memory repositories - data not persisted
} else {
    opts = append(opts, server.WithPostgreSQL(db))
}
```

---

## Backup & Recovery

### PostgreSQL Backup

```bash
# Full database backup
su -s /bin/sh postgres -c "pg_dump quantix_vdc" > backup_$(date +%Y%m%d).sql

# Compressed backup
su -s /bin/sh postgres -c "pg_dump quantix_vdc" | gzip > backup_$(date +%Y%m%d).sql.gz

# Restore from backup
su -s /bin/sh postgres -c "psql quantix_vdc" < backup_20260118.sql
```

### Automated Backup Script

```bash
#!/bin/bash
# /etc/periodic/daily/backup-quantix
BACKUP_DIR="/var/backups/quantix"
mkdir -p "$BACKUP_DIR"

# PostgreSQL
su -s /bin/sh postgres -c "pg_dump quantix_vdc" | gzip > "$BACKUP_DIR/db_$(date +%Y%m%d).sql.gz"

# Keep last 7 days
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +7 -delete
```

### etcd Backup

```bash
# Snapshot etcd data
etcdctl snapshot save /var/backups/quantix/etcd_$(date +%Y%m%d).snap

# Restore from snapshot
etcdctl snapshot restore /var/backups/quantix/etcd_20260118.snap
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
su -s /bin/sh postgres -c "psql -c 'SELECT 1'"

# Check if database exists
su -s /bin/sh postgres -c "psql -lqt | grep quantix_vdc"

# Check logs
tail -f /var/log/postgresql/postmaster.log
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `connection refused` | PostgreSQL not running | `rc-service postgresql start` |
| `database "quantix_vdc" does not exist` | Database not created | `su -s /bin/sh postgres -c "createdb quantix_vdc"` |
| `relation "virtual_machines" does not exist` | Migrations not run | Run migrations manually |
| `Too many connections` | Pool exhausted | Increase `max_connections` in config |
| `503 Service Unavailable` on API | PostgreSQL not connected | Check database, restart control plane |

### View Current Connections

```sql
-- Connect to database
su -s /bin/sh postgres -c "psql -d quantix_vdc"

-- Check active connections
SELECT * FROM pg_stat_activity WHERE datname = 'quantix_vdc';

-- Count connections
SELECT count(*) FROM pg_stat_activity WHERE datname = 'quantix_vdc';

-- Kill all connections (for maintenance)
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'quantix_vdc' AND pid <> pg_backend_pid();
```

### Check Table Counts

```sql
-- Count rows in main tables
SELECT 
    'nodes' as table_name, count(*) as row_count FROM nodes
UNION ALL SELECT 'virtual_machines', count(*) FROM virtual_machines
UNION ALL SELECT 'storage_pools', count(*) FROM storage_pools
UNION ALL SELECT 'volumes', count(*) FROM volumes
UNION ALL SELECT 'users', count(*) FROM users;
```

---

## Performance Tuning

### PostgreSQL Settings

Edit `/var/lib/postgresql/16/data/postgresql.conf`:

```ini
# Memory (adjust based on available RAM)
shared_buffers = 256MB          # 25% of RAM for dedicated server
effective_cache_size = 768MB    # 75% of RAM
work_mem = 16MB                 # Per-query memory
maintenance_work_mem = 128MB    # For VACUUM, CREATE INDEX

# Connections
max_connections = 100           # Adjust based on load
superuser_reserved_connections = 5

# Write-Ahead Log
wal_buffers = 16MB
checkpoint_completion_target = 0.9

# Logging (for debugging)
log_min_duration_statement = 1000  # Log queries > 1s
log_statement = 'ddl'              # Log schema changes
```

### Index Optimization

Key indexes are created in migrations:

```sql
-- Nodes
CREATE INDEX idx_nodes_cluster ON nodes(cluster_id);
CREATE INDEX idx_nodes_phase ON nodes(phase);
CREATE INDEX idx_nodes_labels ON nodes USING GIN(labels);

-- Virtual Machines
CREATE INDEX idx_vms_project ON virtual_machines(project_id);
CREATE INDEX idx_vms_node ON virtual_machines(node_id);
CREATE INDEX idx_vms_state ON virtual_machines(power_state);
CREATE INDEX idx_vms_labels ON virtual_machines USING GIN(labels);

-- Storage Pools
CREATE INDEX idx_storage_pools_project ON storage_pools(project_id);
CREATE INDEX idx_storage_pools_type ON storage_pools(pool_type);
CREATE INDEX idx_storage_pools_phase ON storage_pools(phase);
```

---

## Security Considerations

### Network Isolation

PostgreSQL only listens on localhost:

```ini
listen_addresses = '127.0.0.1'
```

The control plane is the **only component** that accesses the database directly.

### Authentication Hardening (Production)

For production deployments with external access:

```bash
# 1. Set passwords
su -s /bin/sh postgres -c "psql -c \"ALTER USER postgres PASSWORD 'strong-password';\""
su -s /bin/sh postgres -c "psql -c \"ALTER USER quantix PASSWORD 'strong-password';\""

# 2. Update pg_hba.conf
cat > /var/lib/postgresql/16/data/pg_hba.conf << 'EOF'
local   all   all                     scram-sha-256
host    all   all   127.0.0.1/32      scram-sha-256
EOF

# 3. Update config.yaml
# database:
#   password: "strong-password"

# 4. Restart PostgreSQL
rc-service postgresql restart
```

### Encryption at Rest

For sensitive data, consider:

1. **Full Disk Encryption**: Encrypt the `/var/lib/postgresql` partition
2. **Column-Level Encryption**: Encrypt sensitive columns (passwords already use bcrypt)
3. **TLS for Connections**: Enable SSL in PostgreSQL for encrypted connections

### Audit Logging

All user actions are logged to the `audit_log` table:

```sql
SELECT 
    created_at,
    username,
    action,
    resource_type,
    resource_name,
    ip_address
FROM audit_log
ORDER BY created_at DESC
LIMIT 100;
```

---

## Update Server Integration

The Update Server (`update-server/`) has its own migration system for managing QvDC updates:

### Migration Phases

| Phase | Description |
|-------|-------------|
| `pre_check` | Validating prerequisites |
| `snapshot` | Creating database snapshot |
| `download` | Downloading new version |
| `migrating` | Running SQL migrations |
| `starting` | Starting new version |
| `health_check` | Verifying health |
| `completed` | Successfully completed |
| `failed` | Failed, needs rollback |
| `rolling_back` | Rollback in progress |
| `rolled_back` | Rollback completed |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/migrations/status` | GET | Get current migration state |
| `/api/migrations/start` | POST | Start a vDC update |
| `/api/migrations/snapshot` | POST | Create database snapshot |
| `/api/migrations/run` | POST | Run pending migrations |
| `/api/migrations/rollback` | POST | Rollback to snapshot |
| `/api/migrations/snapshots` | GET | List available snapshots |

---

## Related Documents

- [000024-backend-implementation-guide.md](000024-backend-implementation-guide.md)
- [000027-backend-phase3-data-persistence.md](000027-backend-phase3-data-persistence.md)
- [000051-quantix-vdc-appliance.md](../000051-quantix-vdc-appliance.md)
- [000053-quantix-vdc-post-install-troubleshooting.md](../000053-quantix-vdc-post-install-troubleshooting.md)
- [000054-local-development-guide.md](000054-local-development-guide.md)
