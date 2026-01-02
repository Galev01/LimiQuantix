# limiquantix Agent

The limiquantix Agent is a Rust-based daemon that runs on each hypervisor node in the cluster. It manages virtual machines through the hypervisor abstraction layer and communicates with the control plane via gRPC.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Control Plane (Go)                          │
└─────────────────────────────┬───────────────────────────────┘
                              │ gRPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Node Daemon (Rust)                       │
│               limiquantix-node binary                       │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────┐  ┌───────────────────┐               │
│  │ limiquantix-      │  │ limiquantix-      │               │
│  │   hypervisor      │  │   telemetry       │               │
│  │ (VM management)   │  │ (System metrics)  │               │
│  └─────────┬─────────┘  └───────────────────┘               │
│            │                                                │
│  ┌─────────┴─────────────────────────────────┐              │
│  │          Hypervisor Abstraction           │              │
│  │  ┌────────────┐    ┌─────────────────┐    │              │
│  │  │   Mock     │    │    Libvirt      │    │              │
│  │  │  Backend   │    │    Backend      │    │              │
│  │  │  (dev)     │    │   (production)  │    │              │
│  │  └────────────┘    └─────────────────┘    │              │
│  └───────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Crate Structure

| Crate | Description |
|-------|-------------|
| `limiquantix-node` | Node Daemon binary - main entry point |
| `limiquantix-hypervisor` | Hypervisor abstraction layer (libvirt, mock) |
| `limiquantix-telemetry` | System metrics collection (CPU, memory, disk) |
| `limiquantix-proto` | Generated protobuf/gRPC code |
| `limiquantix-common` | Shared utilities (logging, config) |

## Building

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# For libvirt backend (Linux)
apt install libvirt-dev pkg-config

# For libvirt backend (macOS - dev only)
brew install libvirt
```

### Build

```bash
# Development build (mock hypervisor)
cargo build

# Release build
cargo build --release

# With libvirt support (requires libvirt installed)
cargo build --release --features libvirt
```

### Run

```bash
# Development mode (mock hypervisor)
cargo run --bin limiquantix-node -- --dev

# With config file
cargo run --bin limiquantix-node -- --config /etc/limiquantix/node.yaml

# See all options
cargo run --bin limiquantix-node -- --help
```

## Configuration

Create `/etc/limiquantix/node.yaml`:

```yaml
node:
  id: null  # Auto-generated
  hostname: null  # Auto-detected
  labels:
    rack: "A1"
    zone: "us-east-1a"

server:
  listen_address: "0.0.0.0:9090"
  metrics_port: 9091

hypervisor:
  backend: libvirt  # or "mock" for development
  libvirt_uri: "qemu:///system"
  storage_path: "/var/lib/limiquantix/vms"

control_plane:
  address: "http://localhost:8080"
  registration_enabled: true
  heartbeat_interval_secs: 30

tls:
  enabled: false
  cert_path: "/etc/limiquantix/certs/node.crt"
  key_path: "/etc/limiquantix/certs/node.key"
```

## Testing

```bash
# Run all tests
cargo test

# Run specific crate tests
cargo test -p limiquantix-hypervisor

# Run with logging
RUST_LOG=debug cargo test
```

## API Reference

See [Node Daemon Proto](../proto/limiquantix/node/v1/node_daemon.proto) for the gRPC API definition.

### Key Operations

| RPC | Description |
|-----|-------------|
| `HealthCheck` | Check daemon health |
| `CreateVM` | Create a new VM |
| `StartVM` | Start a VM |
| `StopVM` | Stop a VM gracefully |
| `ForceStopVM` | Force stop a VM |
| `DeleteVM` | Delete a VM |
| `GetVMStatus` | Get VM status |
| `ListVMs` | List all VMs |
| `GetConsole` | Get VNC/SPICE console info |
| `CreateSnapshot` | Create a snapshot |
| `MigrateVM` | Live migrate a VM |
| `StreamMetrics` | Stream node metrics |
| `StreamEvents` | Stream node events |

## Hypervisor Backends

### Mock Backend (Development)

The mock backend simulates VM operations in memory. Useful for:
- Development without libvirt
- Unit/integration testing
- Demo environments

### Libvirt Backend (Production)

The libvirt backend uses libvirt to manage VMs via QEMU/KVM. Requires:
- libvirt daemon running
- libvirt development libraries
- KVM kernel module loaded

Features:
- Full VM lifecycle management
- Live migration
- Snapshots
- Hot-plug (disk, NIC)
- VNC/SPICE console
- GPU passthrough

## Related Documentation

- [ADR-000007: Hypervisor Integration](../docs/adr/000007-hypervisor-integration.md)
- [Node Daemon Implementation Plan](../docs/000031-node-daemon-implementation-plan.md)

