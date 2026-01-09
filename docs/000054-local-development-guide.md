# Local Development Guide - Testing Without ISO Builds

**Document ID:** 000054  
**Date:** January 9, 2026  
**Scope:** Development workflow for Quantix-OS ↔ Quantix-vDC testing

## Overview

Building ISOs for every code change is slow and painful. This guide shows how to run the entire Quantix-KVM stack locally on your development machine, enabling rapid iteration and testing.

**Time saved:** From 30+ minutes (ISO build + upload) → ~30 seconds (hot reload)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Your Development Machine                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────┐    ┌────────────────────────────────┐   │
│  │     QUANTIX-VDC STACK      │    │      QUANTIX-OS STACK          │   │
│  │  (Control Plane)           │    │  (Hypervisor Host Simulator)   │   │
│  │                            │    │                                │   │
│  │  frontend/ (Vite)          │    │  quantix-host-ui/ (Vite)       │   │
│  │  http://localhost:5173     │    │  http://localhost:3001         │   │
│  │         │                  │    │         │                      │   │
│  │         ▼                  │    │         ▼                      │   │
│  │  backend/ (Go)             │    │  limiquantix-node (Rust)       │   │
│  │  http://localhost:8080     │◄───┤  https://localhost:8443        │   │
│  │         │                  │    │  gRPC: localhost:9443          │   │
│  └─────────┼──────────────────┘    └────────────────────────────────┘   │
│            │                                                             │
│            ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Docker Services                               │    │
│  │  PostgreSQL:5432  │  etcd:2379  │  Redis:6379                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### Windows

1. **Docker Desktop** - https://docker.com/products/docker-desktop
2. **Go 1.21+** - https://go.dev/dl/
3. **Node.js 18+** - https://nodejs.org/
4. **Rust** - https://rustup.rs/
5. **Git Bash** (optional, for shell scripts)

### Linux/macOS

1. **Docker** - `brew install docker` or your distro's package manager
2. **Go 1.21+** - `brew install go` or https://go.dev/dl/
3. **Node.js 18+** - `brew install node` or https://nodejs.org/
4. **Rust** - `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### Note on Windows Rust Build

The Rust node daemon uses the `ring` crypto library which compiles without cmake/NASM on Windows. If you encounter build issues, ensure you have Visual Studio Build Tools installed.

## Quick Start

### Windows (PowerShell)

```powershell
# Start everything
.\scripts\dev-start.ps1

# Or start individual components
.\scripts\dev-start.ps1 -Component docker    # Just Docker services
.\scripts\dev-start.ps1 -Component backend   # Just Go backend
.\scripts\dev-start.ps1 -Component node      # Just Rust node daemon
.\scripts\dev-start.ps1 -Component frontend  # Just React frontend
.\scripts\dev-start.ps1 -Component hostui    # Just Quantix-OS UI

# Stop everything
.\scripts\dev-start.ps1 -Stop
```

### Linux/macOS (Bash)

```bash
# Make script executable
chmod +x scripts/dev-start.sh

# Start everything
./scripts/dev-start.sh

# Or start individual components
./scripts/dev-start.sh docker
./scripts/dev-start.sh backend
./scripts/dev-start.sh node
./scripts/dev-start.sh frontend
./scripts/dev-start.sh hostui

# Stop everything
./scripts/dev-start.sh stop

# Check status
./scripts/dev-start.sh status
```

## Manual Setup (Step by Step)

If you prefer to start components manually:

### 1. Start Docker Services

```bash
cd backend
docker compose up -d
```

This starts:
- **PostgreSQL** on port 5432
- **etcd** on port 2379
- **Redis** on port 6379

### 2. Start Go Backend (Control Plane)

```bash
cd backend
go build -o controlplane ./cmd/controlplane
./controlplane --dev
```

The `--dev` flag runs in development mode with in-memory fallbacks if databases aren't available.

**Runs on:** http://localhost:8080

### 3. Start Rust Node Daemon (Quantix-OS Agent)

```bash
cd agent
cargo build --package limiquantix-node
./target/debug/limiquantix-node --http-port 8443 --grpc-port 9443
```

**Runs on:**
- REST/WebSocket: https://localhost:8443
- gRPC: localhost:9443

### 4. Start React Frontend (vDC Dashboard)

```bash
cd frontend
npm install
npm run dev
```

**Runs on:** http://localhost:5173

### 5. Start React Host UI (Quantix-OS UI)

```bash
cd quantix-host-ui
npm install
npm run dev
```

**Runs on:** http://localhost:3001

## Testing Host Registration

The main workflow you want to test is adding a Quantix-OS host to the Quantix-vDC control plane.

### Steps

1. **Open vDC Dashboard:** http://localhost:5173
2. **Navigate to Hosts** (sidebar)
3. **Click "Add Host"**
4. **Enter host address:** `localhost:8443`
5. **Click Discover**

The node daemon will:
1. Respond to the discovery request
2. Return its system information
3. Register with the control plane

### What's Being Tested

| Component | What It Does |
|-----------|--------------|
| Frontend | Sends discovery request to backend |
| Backend | Proxies request to node daemon (handles TLS) |
| Node Daemon | Returns system info, registers with control plane |
| Backend | Stores node in database, returns to frontend |
| Frontend | Shows node in host list |

## Development Workflows

### Frontend Changes (Hot Reload)

Both React apps support hot module replacement:

1. Edit any `.tsx` file
2. Save
3. Browser updates automatically (~100ms)

### Backend Changes (Rebuild Required)

```bash
cd backend
go build -o controlplane ./cmd/controlplane
# Restart the process
```

**Tip:** Use `air` for auto-reload:
```bash
go install github.com/cosmtrek/air@latest
air
```

### Node Daemon Changes (Rebuild Required)

```bash
cd agent
cargo build --package limiquantix-node
# Restart the process
```

**Tip:** Use `cargo watch` for auto-reload:
```bash
cargo install cargo-watch
cargo watch -x 'build --package limiquantix-node'
```

## Port Reference

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| vDC Dashboard | 5173 | HTTP | React dev server |
| vDC API | 8080 | HTTP | Go control plane |
| Host UI | 3001 | HTTP | React dev server |
| Node Daemon REST | 8443 | HTTPS | Rust HTTP API |
| Node Daemon gRPC | 9443 | gRPC | Rust gRPC API |
| PostgreSQL | 5432 | TCP | Database |
| etcd | 2379 | HTTP | Distributed KV |
| Redis | 6379 | TCP | Cache |

## Troubleshooting

### "Connection refused" to Node Daemon

The node daemon uses HTTPS with a self-signed certificate. The backend proxy handles this, but if you're testing directly:

```bash
# Use -k to skip certificate verification
curl -k https://localhost:8443/api/v1/system/info
```

### Docker Services Won't Start

Check if ports are already in use:

```bash
# Windows
netstat -ano | findstr "5432 2379 6379"

# Linux/macOS
lsof -i :5432 -i :2379 -i :6379
```

### Node Daemon Build Fails

Make sure you have the required system dependencies:

```bash
# Ubuntu/Debian
sudo apt install build-essential pkg-config libssl-dev

# macOS
xcode-select --install
brew install openssl pkg-config

# Windows
# Install Visual Studio Build Tools
```

### Frontend Can't Connect to Backend

Check that the Vite proxy is configured correctly in `vite.config.ts`:

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
  },
}
```

## When to Build ISOs

You still need to build ISOs for:

1. **Final integration testing** - Before release
2. **Hardware-specific testing** - Network drivers, storage, etc.
3. **Boot process testing** - initramfs, GRUB, installer
4. **Performance benchmarking** - Real hardware metrics

But for day-to-day development of:
- UI features
- API endpoints
- Host registration flow
- VM management logic

**Use local development!**

## IDE Configuration

### VS Code / Cursor

Recommended extensions:
- Go (golang.go)
- rust-analyzer
- ESLint
- Tailwind CSS IntelliSense

### Launch Configurations

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Go Backend",
      "type": "go",
      "request": "launch",
      "mode": "auto",
      "program": "${workspaceFolder}/backend/cmd/controlplane",
      "args": ["--dev"],
      "cwd": "${workspaceFolder}/backend"
    },
    {
      "name": "Rust Node",
      "type": "lldb",
      "request": "launch",
      "program": "${workspaceFolder}/agent/target/debug/limiquantix-node",
      "args": ["--http-port", "8443", "--grpc-port", "9443"],
      "cwd": "${workspaceFolder}/agent"
    }
  ]
}
```

## Summary

| Task | Old Way | New Way |
|------|---------|---------|
| Test UI change | Build ISO → Upload → Boot → Test | Save file → Auto-reload |
| Test API change | Build ISO → Upload → Boot → Test | Rebuild → Restart → Test |
| Test registration | Build both ISOs → Deploy → Test | Run both locally → Test |
| Debug issue | Add logging → Rebuild ISO → Deploy | Add breakpoint → Debug |

**Total time saved per iteration: 20-40 minutes**
