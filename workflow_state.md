# Workflow State

## Current Status: IN PROGRESS - vDC and Quantix-OS Integration Testing

## Latest Workflow: Local Network Testing Setup

**Date:** January 9, 2026

### Architecture Clarification

```
┌─────────────────────────────────────────────────────────────────┐
│  Quantix-vDC (Control Plane) - Windows                         │
│  ├── Go Backend (localhost:8080) - manages cluster             │
│  ├── Frontend (localhost:5173) - shows ALL hosts/VMs           │
│  ├── PostgreSQL, etcd, Redis (Docker)                          │
│  └── Nodes register HERE                                       │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Node Registration (REST/gRPC)
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Quantix-OS (Hypervisor Host) - Ubuntu 192.168.0.53            │
│  ├── Node Daemon (Rust) - registers with vDC                   │
│  ├── Host UI (quantix-host-ui) - LOCAL management only         │
│  └── Runs VMs via libvirt/QEMU                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Steps Completed

| Step | Status |
|------|--------|
| 1. Run database migrations | ✅ Done |
| 2. Start Go backend with PostgreSQL | ✅ Running on :8080 |
| 3. Start vDC Frontend | ⏳ User to start |
| 4. Restart node daemon with --control-plane | ⏳ User to do on Ubuntu |
| 5. Verify node appears in vDC UI | ⏳ Pending |

### Commands Run on Windows

```powershell
# 1. Ran migrations
cd backend
docker exec -i limiquantix-postgres psql -U limiquantix -d limiquantix -f - < migrations/000001_init.up.sql
docker exec -i limiquantix-postgres psql -U limiquantix -d limiquantix -f - < migrations/000002_admin_tables.up.sql

# 2. Started backend (with PostgreSQL, NOT --dev mode)
go run ./cmd/controlplane
```

### Commands to Run on Ubuntu

```bash
# Restart node daemon with control plane URL
sudo ./target/release/limiquantix-node \
    --http-listen 0.0.0.0:8080 \
    --grpc-listen 0.0.0.0:9090 \
    --control-plane http://192.168.0.148:8080
```

### Commands to Run on Windows (Frontend)

```powershell
cd frontend
npm run dev
# Open http://localhost:5173 - should show the Ubuntu host
```

### Key Points

1. **quantix-host-ui** is for managing a SINGLE host locally (embedded in Quantix-OS)
2. **frontend/** is the vDC dashboard that shows ALL hosts in the cluster
3. Node daemon must register with vDC backend for hosts to appear
4. Database migrations must be run for PostgreSQL to work

---

## Previous Workflow: Node Daemon Build Fixed

Fixed the node daemon build issues:
- Downloaded protoc for Windows
- Regenerated proto files
- Fixed axum WebSocket feature
- Fixed rcgen API (pem feature)
- Fixed platform-specific code (statvfs)
- Fixed libvirt backend types (DiskCache, DiskIoMode, backing_file)

### Build Status

```
[OK] limiquantix-proto
[OK] limiquantix-hypervisor
[OK] limiquantix-telemetry
[OK] limiquantix-node
```
