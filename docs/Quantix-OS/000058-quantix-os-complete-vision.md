# 000058 - Quantix-OS: The Complete Vision

**Description:** Comprehensive documentation of Quantix-OS architecture, the Slint console GUI, Host UI web interface, networking via QuantumNet, and all subsystems. This document describes the **INTENDED DESIGN**, not current implementation state.

**Last Updated:** January 4, 2026

---

## Executive Summary

**Quantix-OS** is a custom, immutable, purpose-built hypervisor operating system designed to power the Quantix-KVM virtualization platform. It is the foundation layer of a "VMware Killer" — a distributed virtualization system that combines the simplicity of Proxmox with the enterprise capabilities of VMware vSphere.

### The Vision in One Sentence

> A user must be able to spin up a fully High-Availability virtualization cluster in **under 10 minutes** with platform overhead of **less than 1%** and a **consumer-grade UI experience**.

---

## Table of Contents

1. [Core Philosophy](#1-core-philosophy)
2. [Quantix-OS Architecture](#2-quantix-os-architecture)
3. [Console GUI (Slint)](#3-console-gui-slint)
4. [Host UI (React Web Interface)](#4-host-ui-react-web-interface)
5. [Node Daemon](#5-node-daemon)
6. [Guest Agent](#6-guest-agent)
7. [Networking (QuantumNet)](#7-networking-quantumnet)
8. [Storage Subsystem](#8-storage-subsystem)
9. [Control Plane](#9-control-plane)
10. [The Complete Picture](#10-the-complete-picture)

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

Quantix-OS is a **custom Alpine Linux-based operating system** following the ESXi/Nutanix AHV architecture pattern:

- **Immutable root filesystem** (squashfs, read-only)
- **A/B partitioning** for safe atomic updates
- **Minimal attack surface** (~150MB footprint)
- **Boots to RAM** in under 10 seconds

### The Appliance Philosophy

> "The OS is a detail, not the product."

| Traditional Linux | Quantix-OS |
|-------------------|------------|
| `apt upgrade` can break | Atomic updates, automatic rollback |
| Configuration drift over time | Immutable base, declarative config |
| Slow boot (30-60s) | Fast boot (< 10s from RAM) |
| Large attack surface | Minimal 150MB footprint |
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
    TTY1: Slint Console GUI      Web: Host UI (port 8443)
    TTY2: Emergency shell        SSH: Disabled by default
```

### A/B Update Mechanism

Updates are atomic and safe:

1. **Download** new `system.squashfs` to inactive partition (B)
2. **Update bootloader** to point to System B
3. **Reboot** (graceful - VMs migrated if in cluster)
4. **Health check** within 5 minutes
   - **Pass** → Mark B as "good"
   - **Fail** → Automatic reboot to A (rollback)
5. Next update goes to A, cycle repeats

### Security Model

| Access Method | Default State | Enable Via |
|---------------|---------------|------------|
| Login prompt | Disabled | Cannot enable |
| SSH | Disabled | Console GUI → SSH toggle |
| Emergency Shell | Disabled | Console GUI F12 + auth |
| Serial Console | Available | For headless servers |

**Attack Surface Reduction:**
- No package manager in production
- No compiler/interpreter (no gcc, python, perl)
- Minimal userland: BusyBox only
- Read-only root: No persistent modifications

---

## 3. Console GUI (Slint)

### What Is the Console GUI?

The **Console GUI** (also called DCUI - Direct Console User Interface) is the local management interface that renders directly on the server's physical console (TTY1). It is built with **Slint**, a modern declarative UI toolkit for Rust.

### Why Slint Over Wayland/Chromium?

| Feature | Slint | Wayland Kiosk (Chromium) |
|---------|-------|--------------------------|
| RAM Usage | ~10 MB | ~500 MB |
| Boot Time | Milliseconds | 5-10 seconds |
| Dependencies | Single binary | Chromium + Mesa + Fonts |
| Offline | ✅ Works offline | ❌ Needs web server |
| Attack Surface | Minimal | Large (Chromium CVEs) |
| ISO Size Impact | +3-5 MB | +150-200 MB |

### Rendering Backends

The Console GUI supports multiple rendering backends:

| Priority | Backend | Technology | Use Case |
|----------|---------|------------|----------|
| 1 | LinuxKMS + GPU | Slint + femtovg | Production (DRM/KMS) |
| 2 | LinuxKMS + Software | Slint + software | No GPU acceleration |
| 3 | Raw Framebuffer | embedded-graphics | VGA-only VMs, legacy |
| 4 | TUI | ratatui | Terminal fallback |

### Visual Design

The UI uses a dark theme optimized for server consoles:

```slint
global Theme {
    // Background layers (dark to light)
    out property <color> bg-dark: #0a0e14;      // Page background
    out property <color> bg-panel: #141a22;     // Panel backgrounds
    out property <color> bg-card: #1a222c;      // Card backgrounds
    out property <color> bg-hover: #242d3a;     // Hover states
    
    // Brand colors
    out property <color> accent-blue: #58a6ff;
    out property <color> accent-green: #3fb950;
    out property <color> accent-yellow: #d29922;
    out property <color> accent-red: #f85149;
}
```

### Two User Flows

#### Flow 1: First Boot (Installation Wizard)

When the system boots for the first time (no `/quantix/.setup_complete`), a 4-step wizard appears:

| Step | Title | Fields |
|------|-------|--------|
| 1 | Node Identity | Hostname |
| 2 | Admin Account | Username, Password, Confirm Password |
| 3 | Network Configuration | Interface, DHCP toggle, Static IP/Gateway/DNS |
| 4 | Security Settings | SSH enable toggle, Summary |

#### Flow 2: Normal Operation (Main Dashboard)

After setup, the main DCUI dashboard shows:

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
║  [F2] Configure Network    [F5] Restart Services              ║
║  [F3] SSH Management       [F10] Shutdown/Reboot              ║
║  [F4] Join Cluster         [F12] Emergency Shell              ║
╚═══════════════════════════════════════════════════════════════╝
```

### Menu Functions

| Key | Function | Requires Auth | Description |
|-----|----------|---------------|-------------|
| F2 | Configure Network | ✅ | DHCP/Static, VLAN, DNS, Gateway |
| F3 | SSH Management | ✅ | Enable/disable SSH, view active sessions |
| F4 | Join Cluster | ✅ | Enter control plane URL + join token |
| F5 | Restart Services | ✅ | Node daemon, libvirt, OVS |
| F7 | View Diagnostics | ❌ | System logs, hardware info |
| F10 | Power Menu | ✅ | Reboot/Shutdown with confirmation |
| F12 | Emergency Shell | ✅ | Break-glass access, fully logged |

### Authentication System

- **Password Hashing**: Argon2id (memory-hard, resistant to GPU attacks)
- **Storage**: `/quantix/admin.yaml` (mode 0600, root-only)
- **Account Lockout**: 5 failed attempts = 15-minute lockout
- **Audit Logging**: All auth attempts logged to `/var/log/quantix-console.log`

```yaml
# /quantix/admin.yaml
username: admin
password_hash: $argon2id$v=19$m=19456,t=2,p=1$...
ssh_enabled: false
created_at: 2026-01-04T12:00:00Z
last_login: 2026-01-04T12:30:00Z
failed_attempts: 0
```

### Real-Time Monitoring

The dashboard refreshes every 5 seconds displaying:
- CPU usage (percentage + animated progress bar)
- Memory usage (percentage + used/total)
- Running VM count
- System uptime
- SSH status (enabled/disabled, active session count)
- Recent log entries with error/warning counts

---

## 4. Host UI (React Web Interface)

### What Is the Host UI?

The **Host UI** is a lightweight React web application that runs on every Quantix-OS node, providing **remote management via web browser**. It's the equivalent of VMware's ESXi Host Client.

### Two Consoles, One Node

| Feature | Console GUI (Slint) | Host UI (React) |
|---------|---------------------|-----------------|
| **Access** | Local TTY1 only | Remote via browser (https://ip:8443) |
| **First Boot** | ✅ Setup wizard | ❌ Requires setup complete |
| **Network Config** | ✅ Full control | ⚠️ View only |
| **SSH Management** | ✅ Enable/disable | ⚠️ View only |
| **Emergency Shell** | ✅ Authenticated | ❌ Not available |
| **VM Management** | ❌ Not available | ✅ Full CRUD |
| **Storage Pools** | ❌ Status only | ✅ Full management |
| **Performance** | ❌ Basic stats | ✅ Charts + history |
| **Console Access** | ❌ N/A | ✅ QVMRC deep link |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Quantix-OS Node                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  LOCAL (Physical Console)     │    REMOTE (Web Browser)         │
│  ┌────────────────────────┐   │   ┌────────────────────────┐   │
│  │  Slint Console GUI     │   │   │   Quantix Host UI      │   │
│  │  (DCUI - TTY1)         │   │   │   (Port 8443)          │   │
│  │                        │   │   │                        │   │
│  │  - First boot wizard   │   │   │  - Dashboard           │   │
│  │  - Network config      │   │   │  - VM management       │   │
│  │  - SSH enable/disable  │   │   │  - Storage pools       │   │
│  │  - Emergency shell     │   │   │  - Performance charts  │   │
│  │  - Cluster join        │   │   │  - QVMRC console       │   │
│  └────────────────────────┘   │   └────────────────────────┘   │
│            │                  │              │                  │
│            └──────────────────┼──────────────┘                  │
│                               │                                 │
│                               ▼                                 │
│              ┌─────────────────────────────────┐                │
│              │       Node Daemon (Rust)        │                │
│              │  - gRPC API (port 9443)         │                │
│              │  - REST/WebSocket (port 8443)   │                │
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

### Pages

#### Dashboard
- Host identification (hostname, IP, version)
- Resource rings (CPU, Memory, Storage usage)
- Quick stats (VMs, cores, memory, uptime)
- Recent VMs list with status
- System information panel
- Storage pools overview

#### Virtual Machines
- Sortable/filterable VM table
- Power state badges with color coding
- One-click power operations (start, stop, reboot, pause)
- Console button (launches QVMRC native app)
- VM details with tabs (summary, console, settings, snapshots)

#### Storage
- Storage pools with capacity bars
- Volume management (create, resize, attach/detach, clone)
- ISO library with upload

#### Networking
- Virtual networks overview
- Physical NIC status
- OVS bridge configuration

#### Performance
- Real-time CPU/Memory/Disk/Network charts
- Historical data with Recharts

### QVMRC Integration

The Host UI can launch **QVMRC** (Quantix VM Remote Console), a native Electron/Tauri app for high-performance VM console access:

```typescript
// Deep link to launch native QVMRC app
launchQVMRC({
  hostUrl: 'https://192.168.1.100:8443',
  vmId: 'vm-abc123',
  vmName: 'Ubuntu Server',
});
// Opens: qvmrc://connect?url=https://...&vm=vm-abc123
```

---

## 5. Node Daemon

### What Is the Node Daemon?

The **Node Daemon** (`limiquantix-node`, or `qx-node`) is a Rust-based service that runs on each hypervisor node. It is the bridge between the Go control plane and the actual hypervisor (libvirt/QEMU/KVM).

### Responsibilities

| Component | Responsibility |
|-----------|----------------|
| gRPC Server | Receives commands from control plane |
| VM Manager | Create, start, stop, migrate VMs via libvirt |
| Telemetry | Collect and stream CPU/memory/disk/network metrics |
| Event Stream | Report VM state changes, hardware events |
| Storage Manager | Manage storage pools and volumes |
| Agent Client | Communicate with guest agents inside VMs |
| HTTP Server | Serve the Host UI web app + REST gateway |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Node Daemon (Rust)                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         gRPC Server                                  │   │
│  │              (NodeDaemonService implementation)                      │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                            │
│  ┌─────────────────────────────┴───────────────────────────────────────┐   │
│  │                      Core Engine                                     │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐            │   │
│  │  │  VM Manager   │  │Node Telemetry │  │ Event Stream  │            │   │
│  │  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘            │   │
│  └──────────┼──────────────────┼──────────────────┼────────────────────┘   │
│             │                  │                  │                         │
│  ┌──────────┴──────────────────┴──────────────────┴────────────────────┐   │
│  │                  Hypervisor Abstraction Layer                        │   │
│  │                                                                      │   │
│  │  ┌────────────────────────┐    ┌────────────────────────────┐       │   │
│  │  │    LibvirtBackend      │    │  CloudHypervisorBackend    │       │   │
│  │  │  (Primary - QEMU/KVM)  │    │    (Future - Linux only)   │       │   │
│  │  └───────────┬────────────┘    └─────────────┬──────────────┘       │   │
│  └──────────────┼───────────────────────────────┼──────────────────────┘   │
│                 │                               │                          │
└─────────────────┼───────────────────────────────┼──────────────────────────┘
                  │                               │
                  ▼                               ▼
         ┌────────────────┐             ┌─────────────────────┐
         │    libvirtd    │             │  cloud-hypervisor   │
         └────────────────┘             └─────────────────────┘
                  │                               │
                  └───────────────┬───────────────┘
                                  ▼
                        ┌─────────────────┐
                        │    Linux KVM    │
                        └─────────────────┘
```

### gRPC API

The Node Daemon exposes a gRPC service (`NodeDaemonService`) for:

```protobuf
service NodeDaemonService {
  // VM Lifecycle
  rpc CreateVM(CreateVMOnNodeRequest) returns (CreateVMOnNodeResponse);
  rpc StartVM(VMIdRequest) returns (Empty);
  rpc StopVM(StopVMRequest) returns (Empty);
  rpc ForceStopVM(VMIdRequest) returns (Empty);
  rpc RebootVM(VMIdRequest) returns (Empty);
  rpc PauseVM/ResumeVM/DeleteVM...
  
  // Status
  rpc GetVMStatus(VMIdRequest) returns (VMStatusResponse);
  rpc ListVMs(Empty) returns (ListVMsOnNodeResponse);
  
  // Console
  rpc GetConsole(VMIdRequest) returns (ConsoleInfoResponse);
  
  // Snapshots
  rpc CreateSnapshot/RevertSnapshot/DeleteSnapshot/ListSnapshots...
  
  // Hot-plug
  rpc AttachDisk/DetachDisk/AttachNIC/DetachNIC...
  
  // Migration
  rpc MigrateVM(MigrateVMRequest) returns (stream MigrationProgress);
  
  // Telemetry
  rpc GetNodeInfo(Empty) returns (Node);
  rpc StreamMetrics(StreamMetricsRequest) returns (stream NodeMetrics);
  rpc StreamEvents(Empty) returns (stream NodeEvent);
  
  // Guest Agent
  rpc QuiesceFilesystems/ThawFilesystems/SyncTime...
}
```

---

## 6. Guest Agent

### What Is the Guest Agent?

The **Guest Agent** is a lightweight Rust binary that runs **inside each VM**. It enables deep integration between the hypervisor and the guest OS, bypassing the network layer.

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

### Protocol

Uses **Length-Prefixed Protobuf** over the virtio-serial channel:

```
┌──────────────────┬───────────────────────────────────────────┐
│  4 bytes (BE)    │          N bytes                          │
│  Message Length  │          Protobuf Payload                 │
└──────────────────┴───────────────────────────────────────────┘
```

---

## 7. Networking (QuantumNet)

### What Is QuantumNet?

**QuantumNet** is the distributed software-defined networking layer of Quantix-KVM, built on **OVN (Open Virtual Network)** and **OVS (Open vSwitch)**. It replaces VMware's vDS and NSX-T.

### Why OVN?

| Requirement | OVN Capability |
|-------------|----------------|
| Distributed | OVN separates Logical State (NB DB) from Physical State (SB DB) |
| VLAN Support | Localnet ports with VLAN tags |
| Overlay | Geneve encapsulation (better than VXLAN) |
| Security Groups | Native ACLs compiled to OVS flows |
| DHCP | Built-in DHCP server per logical switch |
| NAT/Floating IPs | Logical router with SNAT/DNAT |
| Load Balancing | Native L4 load balancing |

### Network Types

#### 1. Overlay (Default) - Like NSX Segments

Complete isolation, overlapping IP ranges per tenant, Geneve encapsulation.

```protobuf
message VirtualNetworkSpec {
  NetworkType type = 1;  // OVERLAY
  IpAddressManagement ip_config = 2;  // 10.0.1.0/24
}
```

#### 2. VLAN - Like VMware Port Groups

No encapsulation overhead, direct L2 access to physical network.

```protobuf
message VirtualNetworkSpec {
  NetworkType type = 1;  // VLAN
  VlanConfig vlan = 3;   // vlan_id: 100, physical_network: "physnet1"
}
```

### Security Groups (Distributed Firewall)

Security groups are translated to OVN ACLs with support for:

- **IP-based rules**: Traditional firewall (allow 10.0.0.0/8 to port 22)
- **Tag-based rules**: Zero-trust microsegmentation

```yaml
# Allow Web-Servers to talk to DB-Servers
rule:
  source_tag: "role=web-server"
  destination_tag: "role=db-server"
  port: 5432
```

### Advanced Features

| Feature | Description |
|---------|-------------|
| **Magic DNS** | VMs reach each other via `<vm-name>.internal` |
| **Floating IPs** | Public IP assignment with automatic NAT |
| **WireGuard Bastion** | Users download VPN config to access overlay networks |
| **BGP ToR Integration** | Advertise overlay IPs to ToR switch |
| **L4 Load Balancing** | Native OVN load balancing |

---

## 8. Storage Subsystem

### Storage Backend Types

| Type | Use Case | VMware Equivalent |
|------|----------|-------------------|
| **LOCAL_DIR** | Development, testing | Local VMFS |
| **NFS** | Enterprise NAS, shared storage | NFS Datastore |
| **CEPH_RBD** | vSAN replacement, HCI | vSAN |
| **iSCSI** | Enterprise SAN connectivity | iSCSI Datastore |

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NODE DAEMON (Rust)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      StorageManager                                  │    │
│  │  - Implements StorageBackend trait                                  │    │
│  │  - Routes to appropriate backend implementation                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│       ┌────────────────────────────┼────────────────────────────┐           │
│       ▼                            ▼                            ▼           │
│  ┌──────────┐              ┌──────────┐                  ┌──────────┐       │
│  │   NFS    │              │   CEPH   │                  │  ISCSI   │       │
│  │ Backend  │              │  Backend │                  │ Backend  │       │
│  └──────────┘              └──────────┘                  └──────────┘       │
│       │                          │                            │             │
│       ▼                          ▼                            ▼             │
│  ┌──────────┐              ┌──────────┐                  ┌──────────┐       │
│  │ mount -t │              │  rbd://  │                  │ iscsiadm │       │
│  │   nfs    │              │  librbd  │                  │   + LVM  │       │
│  └──────────┘              └──────────┘                  └──────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Volume Operations

- **Create**: Provision new virtual disk (qcow2/raw/RBD)
- **Attach/Detach**: Hot-plug disks to running VMs
- **Resize**: Expand volumes online
- **Clone**: Instant clones via copy-on-write
- **Snapshot**: Point-in-time copies
- **Template**: Create images for rapid deployment

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

### Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ VM Service  │  │Node Service │  │  Scheduler  │  │  HA Manager │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    │ gRPC (TLS)
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
           ┌────────────────┐              ┌────────────────┐
           │  Node Daemon 1 │              │  Node Daemon 2 │
           │  (Rust)        │              │  (Rust)        │
           └────────────────┘              └────────────────┘
```

---

## 10. The Complete Picture

### End-to-End: Creating a VM

1. **User** → Opens Host UI in browser (https://192.168.1.100:8443)
2. **Host UI** → Calls REST API `/api/v1/vms` (POST)
3. **Node Daemon** → Receives request, generates libvirt XML
4. **libvirtd** → Creates QEMU process with KVM acceleration
5. **OVS** → Connects VM NIC to virtual network
6. **Guest Agent** → Starts inside VM, reports IP
7. **Node Daemon** → Streams events to control plane
8. **Host UI** → Shows VM running with IP address

### The Two UIs Working Together

| Scenario | Use Console GUI | Use Host UI |
|----------|-----------------|-------------|
| Initial server setup | ✅ First boot wizard | ❌ Not accessible yet |
| Network configuration | ✅ Only way | ⚠️ View only |
| Enable SSH for troubleshooting | ✅ Toggle in menu | ❌ |
| Create a new VM | ❌ | ✅ Full wizard |
| Monitor performance | ❌ Basic stats | ✅ Charts |
| Access VM console | ❌ | ✅ QVMRC |
| Emergency shell access | ✅ F12 | ❌ |

### Why This Architecture Wins

1. **Simplicity**: Plug in 3 servers → Run one command → HA cluster in 5 minutes
2. **Performance**: Rust + Go, minimal OS, <1% overhead
3. **Beautiful UI**: Consumer-grade experience (Vercel/Linear aesthetics)
4. **API-First**: Terraform provider from Day 1
5. **Self-Healing**: Guest agent detects and recovers from failures
6. **Enterprise Features**: Security groups, live migration, HA, DRS

---

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000053 - Console GUI (Slint)](./000053-console-gui-slint.md)
- [000056 - Host UI Architecture](../ui/000056-host-ui-architecture.md)
- [ADR-009 - QuantumNet Architecture](../adr/000009-quantumnet-architecture.md)
- [000044 - Guest Agent Architecture](../Agent/000044-guest-agent-architecture.md)
- [000031 - Node Daemon Implementation](../node-daemon/000031-node-daemon-implementation-plan.md)
- [000046 - Storage Backend Implementation](../Storage/000046-storage-backend-implementation.md)
