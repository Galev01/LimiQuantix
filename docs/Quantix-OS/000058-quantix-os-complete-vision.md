# 000058 - Quantix-OS: The Complete Vision

**Description:** Comprehensive documentation of Quantix-OS architecture, the TUI console, Host UI web interface, networking via QuantumNet, agent crates, and all subsystems. This document describes the **CURRENT DESIGN** and implementation.

**Last Updated:** January 7, 2026

---

## Executive Summary

**Quantix-OS** is a custom, immutable, purpose-built **Type-1 hypervisor operating system** designed to power the Quantix-KVM virtualization platform. It is the foundation layer of a "VMware Killer" — a distributed virtualization system that combines the simplicity of Proxmox with the enterprise capabilities of VMware vSphere.

### The Vision in One Sentence

> A user must be able to spin up a fully High-Availability virtualization cluster in **under 10 minutes** with platform overhead of **less than 1%** and a **consumer-grade UI experience**.

---

## Table of Contents

1. [Core Philosophy](#1-core-philosophy)
2. [Quantix-OS Architecture](#2-quantix-os-architecture)
3. [Console TUI (Ratatui)](#3-console-tui-ratatui)
4. [Host UI (React Web Interface)](#4-host-ui-react-web-interface)
5. [Agent Crates](#5-agent-crates)
6. [Guest Agent](#6-guest-agent)
7. [Networking (QuantumNet)](#7-networking-quantumnet)
8. [Storage Subsystem](#8-storage-subsystem)
9. [Control Plane](#9-control-plane)
10. [Building & Deployment](#10-building--deployment)
11. [The Complete Picture](#11-the-complete-picture)

---

## 1. Core Philosophy

### Why Quantix-OS Exists

The Broadcom acquisition of VMware created a vacuum in the virtualization market:
- **Nutanix** → Expensive
- **OpenStack** → Complex
- **Proxmox** → Limited enterprise features

**Our Sweet Spot:** The simplicity of Proxmox + the enterprise capabilities of vSphere.

### Four Pillars

| Pillar | Goal | Implementation |
|--------|------|----------------|
| **Simplicity** | 5-10 minute HA cluster setup | One-command clustering, zero-config defaults |
| **Performance** | <1% platform overhead | Rust/Go, minimal OS footprint, direct KVM |
| **Robustness** | Self-healing, auto-failover | Guest agent telemetry, automatic VM restart, re-balance |
| **API-First** | Terraform-native | Every feature is an API call first, CLI wraps API |

### The Smart Play

We are **NOT** writing a hypervisor from scratch. That requires 100+ kernel engineers and 5+ years.

Instead, we follow **Google, AWS, and Nutanix**: Wrap standard Linux subsystems (KVM, libvirt, Ceph, OVN) into a cohesive, beautiful, API-first platform.

**Innovation happens in:**
- The control plane (scheduling, orchestration)
- The agent (deep guest integration)  
- The UX (making complexity invisible)
- The automation (one-click everything)

---

## 2. Quantix-OS Architecture

### What Is Quantix-OS?

Quantix-OS is a **custom Alpine Linux-based Type-1 hypervisor operating system** following the ESXi/Nutanix AHV architecture pattern:

- **Immutable root filesystem** (squashfs, read-only)
- **A/B partitioning** for safe atomic updates
- **Minimal attack surface** (~200MB footprint)
- **Boots to RAM** in under 10 seconds
- **Type-1 Hypervisor**: Runs directly on hardware, VMs run on KVM

### The Appliance Philosophy

> "The OS is a detail, not the product."

| Traditional Linux | Quantix-OS |
|-------------------|------------|
| `apt upgrade` can break | Atomic updates, automatic rollback |
| Configuration drift over time | Immutable base, declarative config |
| Slow boot (30-60s) | Fast boot (< 10s from RAM) |
| Large attack surface | Minimal 200MB footprint |
| Shell access by default | No shell, API-only |

### Disk Layout

```
┌─────────────────────────────────────────────────────────────┐
│                   QUANTIX-OS DISK LAYOUT                    │
├─────────────────────────────────────────────────────────────┤
│  Part 1: EFI/Boot (100MB)                                   │
│  ├── /EFI/BOOT/BOOTX64.EFI (GRUB)                          │
│  └── /boot/grub/grub.cfg                                    │
├─────────────────────────────────────────────────────────────┤
│  Part 2: System A (300MB) ← Active System                   │
│  ├── /boot/vmlinuz                                          │
│  ├── /boot/initramfs                                        │
│  └── /quantix/system.squashfs                               │
├─────────────────────────────────────────────────────────────┤
│  Part 3: System B (300MB) ← Update Target                   │
│  └── (empty until first update)                             │
├─────────────────────────────────────────────────────────────┤
│  Part 4: Config (100MB)                                     │
│  └── /quantix/                                              │
│      ├── node.yaml           Node configuration             │
│      ├── network.yaml        Network settings               │
│      ├── admin.yaml          Admin credentials              │
│      ├── certificates/       TLS certificates               │
│      └── .installed_at       Installation timestamp         │
├─────────────────────────────────────────────────────────────┤
│  Part 5: Data (REST OF DISK)                                │
│  └── /data/                                                 │
│      ├── vms/                VM disk images                 │
│      ├── isos/               ISO library                    │
│      ├── images/             Template images                │
│      └── backups/            Backup storage                 │
└─────────────────────────────────────────────────────────────┘
```

### Boot Process

```
UEFI → GRUB → vmlinuz + initramfs
                    │
                    ▼
       ┌──────────────────────┐
       │  initramfs (BusyBox) │
       │  1. Load kernel mods │
       │  2. Mount squashfs   │
       │  3. Setup overlayfs  │
       │  4. Mount /quantix   │
       │  5. Mount /data      │
       │  6. pivot_root       │
       └──────────────────────┘
                    │
                    ▼
       ┌──────────────────────┐
       │     OpenRC Init      │
       │  1. Network setup    │
       │  2. libvirtd         │
       │  3. ovs-vswitchd     │
       │  4. quantix-node     │
       │  5. quantix-console  │
       └──────────────────────┘
                    │
                    ▼
    TTY1: TUI Console (qx-console)     Web: Host UI (port 8443)
    TTY2-6: Disabled                   SSH: Disabled by default
```

### Security Model

| Access Method | Default State | Enable Via |
|---------------|---------------|------------|
| Login prompt | Disabled | Cannot enable |
| SSH | Disabled | TUI Console → F3 (with timer) |
| Emergency Shell | Disabled | TUI Console F12 + auth |
| Serial Console | Available | For headless servers |

**Attack Surface Reduction:**
- No package manager in production
- No compiler/interpreter (no gcc, python, perl)
- Minimal userland: BusyBox only
- Read-only root: No persistent modifications

---

## 3. Console TUI (Ratatui)

### What Is the Console TUI?

The **Console TUI** (also called DCUI - Direct Console User Interface) is the local management interface that renders directly on the server's physical console (TTY1). It is built with **Ratatui**, a Rust terminal UI library.

### Why TUI Over GUI?

| Feature | TUI (Ratatui) | GUI (Slint/Wayland) |
|---------|---------------|---------------------|
| RAM Usage | ~5 MB | ~50-500 MB |
| Boot Time | Milliseconds | 2-10 seconds |
| Dependencies | Single binary | GPU drivers, Mesa, fonts |
| Works Everywhere | ✅ VMs, bare metal, serial | ⚠️ Requires graphics |
| Attack Surface | Minimal | Larger (graphics stack) |
| ISO Size Impact | +2 MB | +50-200 MB |
| Reliability | Very high | Depends on GPU drivers |

**Winner: TUI** - Maximum reliability, works on all hardware, minimal footprint.

### Visual Design

The TUI uses a dark theme optimized for server consoles:

```
╔═══════════════════════════════════════════════════════════════╗
║                     QUANTIX-OS v1.0.0                         ║
║                   The VMware Killer                           ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   Node:     quantix-01.local                                  ║
║   Status:   Cluster Member                                    ║
║   IP:       192.168.1.100                                     ║
║                                                               ║
║   CPU:      [████████░░░░░░░░] 48%                           ║
║   Memory:   [██████████░░░░░░] 64% (32GB / 50GB)            ║
║   VMs:      12 running                                        ║
║   Uptime:   5 days, 3 hours                                   ║
║                                                               ║
║   Management URL: https://192.168.1.100:8443                  ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║  [F2] Configure Network    [F5] Refresh Display               ║
║  [F3] Configure SSH        [F6] Restart Services              ║
║  [F4] Join Cluster         [F10] Shutdown/Reboot              ║
╚═══════════════════════════════════════════════════════════════╝
```

### Menu Functions

| Key | Function | Requires Auth | Description |
|-----|----------|---------------|-------------|
| F2 | Configure Network | ✅ | DHCP/Static, VLAN, DNS, Gateway |
| F3 | Configure SSH | ✅ | Enable/disable SSH with timer (security feature) |
| F4 | Join Cluster | ✅ | Enter control plane URL + join token |
| F5 | Refresh Display | ❌ | Refresh system status |
| F6 | Restart Services | ✅ | Node daemon, libvirt, OVS |
| F7 | View Diagnostics | ❌ | System logs, hardware info |
| F10 | Power Menu | ✅ | Reboot/Shutdown with confirmation |
| F12 | Emergency Shell | ✅ | Break-glass access, fully logged |

### SSH Security Feature

The TUI includes a dedicated SSH configuration screen with a **timer-based security feature**:

- **Timed SSH Access**: Enable SSH for 5-120 minutes, auto-disables when timer expires
- **Permanent Mode**: Optional permanent SSH (for trusted environments)
- **Visual Countdown**: Shows remaining time in the TUI
- **Audit Logging**: All SSH enable/disable actions are logged

```
╔═══════════════════════════════════════════════════════════════╗
║                     SSH Configuration                          ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   Status: ● SSH ENABLED                                       ║
║   Auto-disable in: 14:32                                      ║
║                                                               ║
║   Timer: ◀ 15 minutes ▶                                       ║
║                                                               ║
║   [E] Enable SSH (with timer)                                 ║
║   [D] Disable SSH                                             ║
║   [P] Toggle Permanent SSH                                    ║
║                                                               ║
║   Use ←/→ to adjust timer (5-120 min)                         ║
║   Press Esc to return                                         ║
╚═══════════════════════════════════════════════════════════════╝
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Language | Rust | Performance, safety |
| TUI Framework | ratatui + crossterm | Terminal rendering |
| System Info | sysinfo | CPU, memory, disk metrics |
| Build Target | x86_64-unknown-linux-musl | Static binary for Alpine |
| Binary Size | ~3 MB | Minimal footprint |

---

## 4. Host UI (React Web Interface)

### What Is the Host UI?

The **Host UI** is a React web application that runs on every Quantix-OS node, providing **remote management via web browser**. It's the equivalent of VMware's ESXi Host Client.

### Two Interfaces, One Node

| Feature | TUI Console (Ratatui) | Host UI (React) |
|---------|---------------------|-----------------|
| **Access** | Local TTY1 only | Remote via browser (https://ip:8443) |
| **Network Config** | ✅ Full control | ⚠️ View only |
| **SSH Management** | ✅ Enable/disable with timer | ⚠️ View only |
| **Emergency Shell** | ✅ Authenticated | ❌ Not available |
| **VM Management** | ❌ Not available | ✅ Full CRUD |
| **Storage Pools** | ❌ Status only | ✅ Full management |
| **Performance** | ❌ Basic stats | ✅ Charts + history |
| **Console Access** | ❌ N/A | ✅ qvmc deep link |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Quantix-OS Node                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LOCAL (Physical Console)     │    REMOTE (Web Browser)         │
│  ┌────────────────────────┐   │   ┌────────────────────────┐   │
│  │  Ratatui TUI Console   │   │   │   Quantix Host UI      │   │
│  │  (DCUI - TTY1)         │   │   │   (Port 8443)          │   │
│  │                        │   │   │                        │   │
│  │  - Network config      │   │   │  - Dashboard           │   │
│  │  - SSH enable/disable  │   │   │  - VM management       │   │
│  │  - Emergency shell     │   │   │  - Storage pools       │   │
│  │  - Cluster join        │   │   │  - Performance charts  │   │
│  └────────────────────────┘   │   │  - qvmc console       │   │
│            │                  │   └────────────────────────┘   │
│            └──────────────────┼──────────────┘                  │
│                               │                                 │
│                               ▼                                 │
│              ┌─────────────────────────────────┐                │
│              │       Node Daemon (Rust)        │                │
│              │  - gRPC API (port 9443)         │                │
│              │  - REST/HTTP (port 8443)        │                │
│              │  - HTTPS with TLS               │                │
│              │  - Static file serving          │                │
│              └─────────────────────────────────┘                │
│                               │                                 │
│              ┌────────────────┼────────────────┐                │
│              ▼                ▼                ▼                │
│         libvirtd          OVS/OVN         Storage               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Framework | React 19 | UI Components |
| Build Tool | Vite | Development & bundling |
| Type Safety | TypeScript | Static typing |
| State (Global) | Zustand | Theme, sidebar, preferences |
| State (Server) | TanStack Query | API caching, mutations |
| Styling | Tailwind CSS v4 | Design system |
| Icons | Lucide React | Consistent iconography |
| Charts | Recharts | Performance monitoring |
| Animations | Framer Motion | Smooth transitions |
| Toasts | Sonner | Notifications |

### API Communication

The Host UI communicates with the Node Daemon via REST API:

```typescript
// API endpoints use camelCase for JavaScript compatibility
const response = await fetch('/api/v1/host');
// Returns: { nodeId, hostname, cpuCores, memoryTotalBytes, ... }

const vms = await fetch('/api/v1/vms');
// Returns: { vms: [{ vmId, name, state, cpuUsagePercent, ... }] }
```

---

## 5. Agent Crates

The Quantix platform is built from several Rust crates (libraries/binaries) in the `agent/` directory:

### Crate Overview

```
agent/
├── limiquantix-common/        # Shared utilities and logging
├── limiquantix-guest-agent/   # Runs inside VMs
├── limiquantix-hypervisor/    # Hypervisor abstraction (libvirt, OVS)
├── limiquantix-node/          # Node daemon (main service)
├── limiquantix-proto/         # gRPC protocol definitions
└── limiquantix-telemetry/     # System metrics collection
```

### limiquantix-common

**Purpose:** Shared utilities used across all crates.

| Module | Description |
|--------|-------------|
| `logging.rs` | Structured logging setup with tracing |
| `lib.rs` | Common types and utilities |

### limiquantix-guest-agent

**Purpose:** Runs inside VMs to provide deep guest integration.

| Module | Description |
|--------|-------------|
| `main.rs` | Agent entry point, virtio-serial listener |
| `protocol.rs` | Length-prefixed protobuf protocol |
| `telemetry.rs` | Guest OS metrics (CPU, RAM, disk from inside) |
| `transport.rs` | Virtio-serial transport layer |
| `handlers/` | Command handlers |
| ├── `execute.rs` | Run commands inside VM |
| ├── `file.rs` | File transfer operations |
| ├── `lifecycle.rs` | Shutdown, reboot, password reset |
| ├── `quiesce.rs` | Filesystem freeze for snapshots |
| └── `timesync.rs` | NTP time synchronization |

**Packaging:**
- Linux: `.deb`, `.rpm` packages with systemd service
- Windows: MSI installer with Windows Service
- Cloud-init: YAML for automatic installation

### limiquantix-hypervisor

**Purpose:** Abstraction layer for hypervisor operations.

| Module | Description |
|--------|-------------|
| `lib.rs` | Public API and trait definitions |
| `traits.rs` | `HypervisorBackend` trait |
| `types.rs` | VM, Disk, NIC type definitions |
| `error.rs` | Error types |
| `xml.rs` | Libvirt XML generation |
| `cloudinit.rs` | Cloud-init ISO generation |
| `libvirt/` | Libvirt backend implementation |
| ├── `backend.rs` | VM lifecycle via libvirt |
| └── `mod.rs` | Module exports |
| `network/` | Network management |
| ├── `ovs.rs` | Open vSwitch integration |
| └── `types.rs` | Network types |
| `storage/` | Storage management |
| ├── `manager.rs` | Storage pool operations |
| ├── `local.rs` | Local directory backend |
| ├── `nfs.rs` | NFS backend |
| └── `volume.rs` | Volume operations |

### limiquantix-node

**Purpose:** The main node daemon that runs on each hypervisor host.

| Module | Description |
|--------|-------------|
| `main.rs` | Entry point, service startup |
| `cli.rs` | Command-line argument parsing |
| `config.rs` | Configuration loading (YAML) |
| `service.rs` | Core service implementation |
| `server.rs` | gRPC server (NodeDaemonService) |
| `http_server.rs` | HTTP/HTTPS server for Web UI + REST API |
| `tls.rs` | TLS certificate management (self-signed, ACME) |
| `agent_client.rs` | Communication with guest agents |
| `registration.rs` | Cluster registration logic |

**HTTP Server Features:**
- Serves React Host UI static files
- REST API at `/api/v1/*`
- HTTPS with self-signed or ACME certificates
- HTTP→HTTPS redirect option
- Certificate management API

### limiquantix-proto

**Purpose:** gRPC protocol definitions and generated code.

| File | Description |
|------|-------------|
| `proto/node_daemon.proto` | Node daemon service definition |
| `proto/agent.proto` | Guest agent protocol |
| `build.rs` | Protobuf code generation |
| `src/lib.rs` | Re-exports generated code |

**Services Defined:**
- `NodeDaemonService` - VM lifecycle, storage, network, metrics
- `GuestAgentService` - Guest operations (telemetry, execute, quiesce)

### limiquantix-telemetry

**Purpose:** System metrics collection for the host.

| Module | Description |
|--------|-------------|
| `lib.rs` | `TelemetryCollector` main struct |
| `cpu.rs` | CPU model, cores, usage |
| `memory.rs` | RAM total, available, swap |
| `disk.rs` | Disk info, partitions, usage |
| `network.rs` | NIC info, traffic stats |
| `system.rs` | Hostname, OS, kernel, uptime |

---

## 6. Guest Agent

### What Is the Guest Agent?

The **Guest Agent** (`limiquantix-guest-agent`) is a lightweight Rust binary that runs **inside each VM**. It enables deep integration between the hypervisor and the guest OS, bypassing the network layer.

### Why Does It Matter?

| Problem | Without Agent | With Agent |
|---------|---------------|------------|
| Actual RAM usage | Only see allocated RAM | Real usage from inside VM |
| IP addresses | Must scan network | Reported directly |
| Graceful shutdown | ACPI signal (may fail) | Guest-initiated shutdown |
| Consistent snapshots | Filesystem may be dirty | Quiesce filesystems first |
| Network-down VMs | Cannot manage | Works via virtio-serial |

### Architecture: Virtio-Serial Transport

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Virtio-Serial Architecture                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         HYPERVISOR HOST                               │   │
│  │  ┌──────────────┐                      ┌──────────────────────────┐  │   │
│  │  │ Node Daemon  │──writes/reads──────▶│ Unix Socket              │  │   │
│  │  │ (Agent       │                      │ /var/run/limiquantix/    │  │   │
│  │  │  Client)     │                      │   vms/{vm_id}.agent.sock │  │   │
│  │  └──────────────┘                      └───────────┬──────────────┘  │   │
│  └────────────────────────────────────────────────────┼─────────────────┘   │
│                                                       │                      │
│  ┌────────────────────────────────────────────────────┼─────────────────┐   │
│  │                          QEMU/KVM PROCESS          │                  │   │
│  │                      ┌─────────────────────────────┴────┐             │   │
│  │                      │   Virtio-Serial Controller       │             │   │
│  │                      └─────────────────────────────┬────┘             │   │
│  └────────────────────────────────────────────────────┼─────────────────┘   │
│                                                       │                      │
│  ┌────────────────────────────────────────────────────┼─────────────────┐   │
│  │                          GUEST VM                  │                  │   │
│  │                      ┌─────────────────────────────┴────┐             │   │
│  │                      │  /dev/virtio-ports/              │             │   │
│  │                      │     org.limiquantix.agent.0      │             │   │
│  │                      └─────────────────────────────┬────┘             │   │
│  │  ┌──────────────┐                                  │                  │   │
│  │  │ Guest Agent  │◀──────reads/writes───────────────┘                  │   │
│  │  │ (Rust Binary)│                                                     │   │
│  │  └──────────────┘                                                     │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Capabilities

| Feature | Description |
|---------|-------------|
| **Telemetry** | Report real RAM/Disk usage (not just allocated) |
| **Execution** | Run scripts/commands inside the VM (for automation) |
| **File Transfer** | Push/Pull files without SSH |
| **Lifecycle** | Clean shutdown, password reset, IP reporting |
| **Quiescing** | Freeze filesystems before snapshots (database-safe) |

### Platform Support

| Platform | Device Path | Installation |
|----------|-------------|--------------|
| Linux | `/dev/virtio-ports/org.limiquantix.agent.0` | Systemd service, .deb/.rpm |
| Windows | `\\.\Global\org.limiquantix.agent.0` | Windows Service, MSI installer |

---

## 7. Networking (QuantumNet)

### What Is QuantumNet?

**QuantumNet** is the distributed software-defined networking layer of Quantix-KVM, built on **OVN (Open Virtual Network)** and **OVS (Open vSwitch)**. It replaces VMware's vDS and NSX-T.

### Implementation in Code

The networking code is in `agent/limiquantix-hypervisor/src/network/`:

```rust
// network/ovs.rs - Open vSwitch management
pub struct OvsManager {
    // Manages OVS bridges, ports, and flows
}

impl OvsManager {
    pub fn create_bridge(&self, name: &str) -> Result<()>;
    pub fn add_port(&self, bridge: &str, port: &str) -> Result<()>;
    pub fn set_vlan(&self, port: &str, vlan_id: u16) -> Result<()>;
    pub fn get_status(&self) -> Result<OvsStatus>;
}

// network/types.rs - Network type definitions
pub struct NetworkPortConfig {
    pub port_id: String,
    pub bridge: String,
    pub vlan_id: Option<u16>,
    pub mac_address: Option<String>,
}
```

### Network Types

#### 1. Overlay (Default) - Like NSX Segments

Complete isolation, overlapping IP ranges per tenant, Geneve encapsulation.

#### 2. VLAN - Like VMware Port Groups

No encapsulation overhead, direct L2 access to physical network.

### Security Groups (Distributed Firewall)

Security groups are translated to OVN ACLs with support for:
- **IP-based rules**: Traditional firewall (allow 10.0.0.0/8 to port 22)
- **Tag-based rules**: Zero-trust microsegmentation

---

## 8. Storage Subsystem

### Storage Backend Types

| Type | Use Case | VMware Equivalent |
|------|----------|-------------------|
| **LOCAL_DIR** | Development, testing | Local VMFS |
| **NFS** | Enterprise NAS, shared storage | NFS Datastore |
| **CEPH_RBD** | vSAN replacement, HCI | vSAN |
| **iSCSI** | Enterprise SAN connectivity | iSCSI Datastore |

### Implementation in Code

The storage code is in `agent/limiquantix-hypervisor/src/storage/`:

```rust
// storage/manager.rs - Storage pool management
pub struct StorageManager {
    pools: HashMap<String, Box<dyn StorageBackend>>,
}

impl StorageManager {
    pub fn create_pool(&mut self, config: PoolConfig) -> Result<()>;
    pub fn create_volume(&self, pool: &str, spec: VolumeSpec) -> Result<Volume>;
    pub fn attach_volume(&self, volume_id: &str, vm_id: &str) -> Result<()>;
}

// storage/local.rs - Local directory backend
pub struct LocalStorageBackend {
    base_path: PathBuf,
}

// storage/nfs.rs - NFS backend
pub struct NfsStorageBackend {
    server: String,
    export: String,
    mount_path: PathBuf,
}
```

---

## 9. Control Plane

### What Is the Control Plane?

The **Control Plane** is the central brain of the Quantix-KVM cluster. Written in Go, it provides:

| Component | Responsibility |
|-----------|----------------|
| **VMService** | VM CRUD, power operations, migrations |
| **NodeService** | Node registration, health monitoring, scheduling |
| **StoragePoolService** | Pool management, capacity monitoring |
| **VolumeService** | Volume lifecycle, attachment |
| **NetworkService** | OVN integration, virtual networks |
| **Scheduler** | VM placement, load balancing, DRS |
| **HA Manager** | Failure detection, automatic restart |

### Cluster Join Process

From the TUI Console (F4 - Join Cluster):

1. Enter Control Plane URL (e.g., `https://control.example.com:8443`)
2. Enter Registration Token (generated by control plane)
3. Node daemon registers with control plane
4. Receives cluster configuration
5. Starts heartbeat loop

---

## 10. Building & Deployment

### Build Overview

```bash
cd Quantix-OS

# Build complete ISO with all components
make iso

# Individual build targets
make tui          # Build TUI console (qx-console)
make node-daemon  # Build node daemon (qx-node)
make host-ui      # Build React Host UI
make squashfs     # Build root filesystem
```

### Installer EFI Validation
The installer now validates that the EFI System Partition (ESP) is mounted and
writable before installing the bootloader. A successful install should leave
`EFI/BOOT/BOOTX64.EFI` on the ESP. If firmware reports "no bootable device",
verify the ESP contents in the installer shell before rebooting.

### Build Process

```
┌─────────────────────────────────────────────────────────────────┐
│                      BUILD PIPELINE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Docker Build Environment                                     │
│     └─ quantix-rust-tui-builder (Alpine + Rust + musl)          │
│     └─ node:20-alpine (for Host UI)                             │
│                                                                  │
│  2. Component Builds (in Docker)                                 │
│     ├─ qx-console (Rust TUI) → overlay/usr/local/bin/           │
│     ├─ qx-node (Rust daemon) → overlay/usr/bin/                 │
│     └─ Host UI (React) → overlay/usr/share/quantix-host-ui/     │
│                                                                  │
│  3. Alpine Rootfs (build-squashfs.sh)                           │
│     ├─ Install packages from packages.conf                      │
│     ├─ Apply overlay files                                       │
│     ├─ Enable OpenRC services                                    │
│     └─ Create system.squashfs                                    │
│                                                                  │
│  4. Initramfs (build-initramfs.sh)                              │
│     ├─ BusyBox static binary                                     │
│     ├─ Kernel modules (block, fs, net)                          │
│     └─ Init script (mount squashfs, pivot_root)                 │
│                                                                  │
│  5. ISO Creation (build-iso.sh)                                  │
│     ├─ GRUB bootloader (UEFI + BIOS)                            │
│     ├─ Kernel + initramfs                                        │
│     └─ Hybrid ISO (bootable from USB/CD)                        │
│                                                                  │
│  Output: output/quantix-os-1.0.0.iso (~800MB)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Cross-Compilation

All Rust binaries are built for Alpine Linux (musl libc):

```bash
# TUI Console - built in Docker with Alpine
docker run --rm -v $(pwd):/build quantix-rust-tui-builder \
    cargo build --release --target x86_64-unknown-linux-musl

# Node Daemon - same process
# Host UI - built with Node.js in Alpine container
```

### Testing

```bash
# Test in QEMU
make test-qemu

# With port forwarding for Web UI access
qemu-system-x86_64 -enable-kvm -m 4G \
    -cdrom output/quantix-os-1.0.0.iso \
    -device virtio-net-pci,netdev=net0 \
    -netdev user,id=net0,hostfwd=tcp::8443-:8443

# Create bootable USB
sudo dd if=output/quantix-os-1.0.0.iso of=/dev/sdX bs=4M status=progress
```

---

## 11. The Complete Picture

### End-to-End: Creating a VM

1. **User** → Opens Host UI in browser (https://192.168.1.100:8443)
2. **Host UI** → Calls REST API `/api/v1/vms` (POST)
3. **Node Daemon** → Receives request, generates libvirt XML
4. **libvirtd** → Creates QEMU process with KVM acceleration
5. **OVS** → Connects VM NIC to virtual network
6. **Guest Agent** → Starts inside VM, reports IP
7. **Node Daemon** → Streams events to control plane
8. **Host UI** → Shows VM running with IP address

### The Two Interfaces Working Together

| Scenario | Use TUI Console | Use Host UI |
|----------|-----------------|-------------|
| Initial server setup | ✅ Network, SSH | ❌ Not accessible yet |
| Network configuration | ✅ Only way | ⚠️ View only |
| Enable SSH for troubleshooting | ✅ Toggle with timer | ❌ |
| Create a new VM | ❌ | ✅ Full wizard |
| Monitor performance | ❌ Basic stats | ✅ Charts |
| Access VM console | ❌ | ✅ qvmc |
| Emergency shell access | ✅ F12 | ❌ |

### Why This Architecture Wins

1. **Simplicity**: Plug in 3 servers → Run one command → HA cluster in 5 minutes
2. **Performance**: Rust + Go, minimal OS, <1% overhead
3. **Beautiful UI**: Consumer-grade experience (Vercel/Linear aesthetics)
4. **API-First**: Terraform provider from Day 1
5. **Self-Healing**: Guest agent detects and recovers from failures
6. **Enterprise Features**: Security groups, live migration, HA, DRS
7. **Reliability**: TUI works on all hardware, no GPU driver issues

---

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000059 - Build Guide](./000059-quantix-os-build-guide.md)
- [000061 - Agent Architecture](./000061-agent-architecture.md)
- [000056 - Host UI Architecture](../ui/000056-host-ui-architecture.md)
- [ADR-009 - QuantumNet Architecture](../adr/000009-quantumnet-architecture.md)
- [000044 - Guest Agent Architecture](../Agent/000044-guest-agent-architecture.md)
