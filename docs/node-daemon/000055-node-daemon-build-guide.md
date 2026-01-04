# Node Daemon Build Guide

**Document ID:** 000055  
**Category:** Node Daemon  
**Created:** 2026-01-04  
**Status:** Active

This document explains how to build and deploy the Quantix Node Daemon on hypervisor nodes, including proper protobuf regeneration to avoid type mismatches.

---

## Overview

The Quantix Node Daemon (`limiquantix-node`) runs on each hypervisor and communicates with the Control Plane via gRPC. It uses Protocol Buffers for message definitions, which are compiled into Rust code at build time.

**Common Issue:** The generated proto files can become stale, causing compilation errors or runtime type mismatches between the Control Plane (Go) and Node Daemon (Rust).

**Solution:** Always regenerate proto files before building the Node Daemon.

---

## Quick Start

### Using the Build Script (Recommended)

```bash
cd ~/LimiQuantix
git pull

chmod +x scripts/build-node-daemon.sh
./scripts/build-node-daemon.sh
```

The script handles everything automatically:
1. Deletes stale generated proto files
2. Regenerates protos from `.proto` definitions
3. Builds the node daemon in release mode
4. Shows installation instructions

### Debug Build

For faster compilation during development:

```bash
./scripts/build-node-daemon.sh --debug
```

---

## Manual Build Process

If you prefer to build manually or need to troubleshoot:

### Step 1: Prerequisites

Ensure you have the required tools installed:

```bash
# Check Rust installation
rustc --version  # Should be 1.70+

# Check protobuf compiler
protoc --version  # Should be 3.x or higher

# Install if missing (Ubuntu/Debian)
sudo apt update
sudo apt install -y protobuf-compiler libprotobuf-dev
```

### Step 2: Force Proto Regeneration

**Critical:** Always delete the generated files before building to ensure fresh generation:

```bash
cd ~/LimiQuantix/agent

# Delete stale generated files
rm -rf limiquantix-proto/src/generated/

# Rebuild the proto crate (triggers build.rs)
cargo build -p limiquantix-proto
```

### Step 3: Verify Proto Generation

Check that the files were generated correctly:

```bash
ls -la limiquantix-proto/src/generated/
# Should show:
#   limiquantix.agent.v1.rs
#   limiquantix.node.v1.rs

# Verify the expected types exist
grep "CreateVmOnNodeRequest" limiquantix-proto/src/generated/limiquantix.node.v1.rs
# Should find the struct definition
```

### Step 4: Build the Node Daemon

```bash
# Release build (optimized, smaller binary)
cargo build --release --bin limiquantix-node --features libvirt

# Debug build (faster compilation)
cargo build --bin limiquantix-node --features libvirt
```

### Step 5: Verify the Binary

```bash
# Check the binary exists
ls -lh target/release/limiquantix-node

# Test it runs
./target/release/limiquantix-node --help
```

---

## Installation

### Option A: Direct Copy

```bash
sudo cp target/release/limiquantix-node /usr/local/bin/
sudo chmod +x /usr/local/bin/limiquantix-node
```

### Option B: Systemd Service

Create the service file:

```bash
sudo tee /etc/systemd/system/limiquantix-node.service << 'EOF'
[Unit]
Description=Quantix Node Daemon
After=network.target libvirtd.service
Requires=libvirtd.service

[Service]
Type=simple
ExecStart=/usr/local/bin/limiquantix-node \
    --listen 0.0.0.0:9090 \
    --control-plane http://YOUR_CONTROL_PLANE_IP:8080 \
    --register
Restart=always
RestartSec=5
User=root

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=limiquantix-node

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable limiquantix-node
sudo systemctl start limiquantix-node
sudo systemctl status limiquantix-node
```

### Configuration File

Create `/etc/limiquantix/node.yaml`:

```yaml
# Node daemon configuration
listen_address: "0.0.0.0:9090"
control_plane_url: "http://192.168.1.100:8080"
auto_register: true

# Hypervisor settings
hypervisor:
  type: libvirt
  uri: "qemu:///system"

# Storage paths
storage:
  vm_images: "/var/lib/libvirt/images"
  cloud_images: "/var/lib/libvirt/images/cloud"
  iso_images: "/var/lib/libvirt/images/iso"

# Agent settings
agent:
  socket_dir: "/var/run/limiquantix/vms"
```

---

## Troubleshooting

### Error: "unresolved import" or "no X in the root"

**Cause:** Stale generated proto files don't match the current `.proto` definitions.

**Fix:**
```bash
rm -rf limiquantix-proto/src/generated/
cargo build -p limiquantix-proto
cargo build --release --bin limiquantix-node --features libvirt
```

### Error: "not all trait items implemented"

**Cause:** The generated `NodeDaemonService` trait has methods that aren't implemented in `service.rs`.

**Fix:** Either:
1. Regenerate protos (see above)
2. Or implement the missing methods in `service.rs`

### Error: "struct X has no field named Y"

**Cause:** Proto field names changed but generated code is stale.

**Fix:** Force regeneration (see above).

### Error: "protoc not found"

**Fix:**
```bash
sudo apt install -y protobuf-compiler libprotobuf-dev
```

### Error: Port 9090 already in use

**Fix:**
```bash
# Find and kill the process
sudo lsof -i :9090
sudo kill -9 <PID>

# Or change the port
./limiquantix-node --listen 0.0.0.0:9091 ...
```

---

## Proto File Locations

| File | Description |
|------|-------------|
| `agent/limiquantix-proto/proto/node_daemon.proto` | Node daemon gRPC service definition |
| `agent/limiquantix-proto/proto/agent.proto` | Guest agent protocol (virtio-serial) |
| `agent/limiquantix-proto/src/generated/` | Generated Rust code (auto-created, gitignored) |
| `agent/limiquantix-proto/src/build.rs` | Build script that runs protoc |

---

## Development Workflow

### When You Make Proto Changes

1. Edit the `.proto` file(s)
2. Run the build script on the hypervisor:
   ```bash
   ./scripts/build-node-daemon.sh
   ```
3. The script automatically regenerates and rebuilds

### When You Pull Changes

Always use the build script after pulling:
```bash
git pull
./scripts/build-node-daemon.sh
```

### Viewing Logs

```bash
# If running as systemd service
sudo journalctl -u limiquantix-node -f

# If running directly
./limiquantix-node ... 2>&1 | tee node-daemon.log
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Control Plane (Go)                       │
│                    (Windows/Linux Dev)                       │
└───────────────────────────┬─────────────────────────────────┘
                            │ gRPC (port 8080)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Node Daemon (Rust)                         │
│                   (Linux Hypervisor)                         │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │  gRPC       │    │  Hypervisor  │    │  Agent        │  │
│  │  Service    │───▶│  Backend     │    │  Manager      │  │
│  │  (port 9090)│    │  (libvirt)   │    │  (virtio)     │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [000031-node-daemon-implementation-plan.md](000031-node-daemon-implementation-plan.md) - Implementation details
- [000033-node-registration-flow.md](000033-node-registration-flow.md) - How nodes register with control plane
- [000037-node-installation-requirements.md](000037-node-installation-requirements.md) - Hypervisor setup
- [adr/000006-proto-and-build-system-guide.md](../adr/000006-proto-and-build-system-guide.md) - Proto system overview
