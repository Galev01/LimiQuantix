# 000052 - Quantix-OS Architecture

**Document:** Quantix-OS Immutable Type-1 Hypervisor Operating System  
**Status:** Active  
**Created:** January 3, 2026  
**Last Updated:** January 7, 2026

---

## Overview

Quantix-OS is a custom Alpine Linux-based **Type-1 hypervisor operating system** designed specifically for running the Quantix-KVM virtualization platform. It follows the **ESXi/Nutanix AHV** architecture pattern: immutable root filesystem, A/B partitioning for safe updates, and a minimal attack surface.

This document describes the architecture, design decisions, and implementation details of Quantix-OS.

---

## Table of Contents

1. [Philosophy](#1-philosophy)
2. [Technology Choice](#2-technology-choice)
3. [Tech Stack](#3-tech-stack)
4. [Disk Layout](#4-disk-layout)
5. [Boot Process](#5-boot-process)
6. [Console TUI (DCUI)](#6-console-tui-dcui)
7. [Update Mechanism](#7-update-mechanism)
8. [Security Model](#8-security-model)
9. [Directory Structure](#9-directory-structure)
10. [Building](#10-building)
11. [Future Enhancements](#11-future-enhancements)

---

## 1. Philosophy

> "The OS is a detail, not the product."

Quantix-OS embodies the **appliance philosophy**:

| Principle | Description |
|-----------|-------------|
| **Immutable Root** | The OS lives in a read-only squashfs image. No packages to update, no drift. |
| **Stateless Boot** | The OS boots into RAM in seconds. A reboot resets to a known-good state. |
| **Config Separation** | Only `/quantix` (config) and `/data` (VMs) persist across reboots. |
| **A/B Updates** | Updates are atomic. Flash to inactive partition, reboot, auto-rollback on failure. |
| **Type-1 Hypervisor** | Runs directly on hardware, VMs run on KVM with minimal overhead. |

### Why This Matters

| Traditional Linux | Quantix-OS |
|-------------------|------------|
| `apt upgrade` can break | Atomic updates, automatic rollback |
| Configuration drift over time | Immutable base, declarative config |
| Slow boot (30-60s) | Fast boot (< 10s from RAM) |
| Large attack surface | Minimal 200MB footprint |
| Shell access by default | No shell, API-only |

---

## 2. Technology Choice

### Why Alpine Linux?

| Alternative | Pros | Cons | Verdict |
|-------------|------|------|---------|
| **Alpine Linux** | 200MB footprint, musl libc, OpenRC, designed for appliances | musl can cause binary issues | ✅ **Best choice** |
| **Talos Linux** | Immutable, Kubernetes-native | Too K8s-focused | ❌ Wrong use case |
| **Flatcar Container Linux** | Immutable, auto-updates | 800MB+, systemd | ⚠️ Too big |
| **NixOS** | Declarative, reproducible | Complex, 1GB+ | ❌ Too complex |
| **Buildroot** | Tiny, full control | Maintenance nightmare | ❌ Too much work |

### Key Alpine Benefits

1. **Size**: ~200MB total footprint vs. 2GB+ for Ubuntu
2. **Init System**: OpenRC (simple, fast, scriptable) vs. systemd
3. **Userland**: BusyBox (same as ESXi!)
4. **Package Manager**: APK (only at build time, not runtime)
5. **musl libc**: Static linking friendly for Rust binaries

---

## 3. Tech Stack

### Quantix-OS Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Base OS** | Alpine Linux 3.20 | Minimal immutable base |
| **Kernel** | Linux LTS 6.6 | Hardware support, KVM |
| **Init System** | OpenRC | Service management |
| **Hypervisor** | KVM + QEMU + libvirt | VM execution |
| **Networking** | OVS + OVN | Software-defined networking |
| **Storage** | Local/NFS/Ceph/iSCSI | VM disk storage |

### Node Daemon (Rust)

| Crate | Purpose |
|-------|---------|
| `limiquantix-node` | Main daemon service, HTTP/gRPC server |
| `limiquantix-hypervisor` | libvirt abstraction, VM lifecycle |
| `limiquantix-telemetry` | System metrics collection |
| `limiquantix-proto` | gRPC protocol definitions |
| `limiquantix-common` | Shared utilities, logging |

### Console TUI (Rust)

| Library | Purpose |
|---------|---------|
| `ratatui` | Terminal UI rendering |
| `crossterm` | Cross-platform terminal control |
| `sysinfo` | System information gathering |

### Host UI (React)

| Technology | Purpose |
|------------|---------|
| React 19 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| TanStack Query | Server state management |
| Tailwind CSS v4 | Styling |
| Zustand | Client state management |

### Control Plane (Go)

| Technology | Purpose |
|------------|---------|
| Go 1.22+ | Language |
| Gin | HTTP router |
| gRPC-Go | Node communication |
| etcd | Distributed state |
| PostgreSQL | Persistent storage |

---

## 4. Disk Layout

Quantix-OS uses a GPT partition layout optimized for A/B updates:

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

### Partition Details

| Part | Label | Size | Filesystem | Purpose |
|------|-------|------|------------|---------|
| 1 | EFI | 100MB | FAT32 | UEFI bootloader |
| 2 | QUANTIX-A | 300MB | ext4 | Active system image |
| 3 | QUANTIX-B | 300MB | ext4 | Update target |
| 4 | QUANTIX-CFG | 100MB | ext4 | Persistent configuration |
| 5 | QUANTIX-DATA | Rest | XFS/ext4/ZFS | VM storage |

---

## 5. Boot Process

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
    TTY1: qx-console (TUI)    TTY2-6: Disabled
                              SSH: Disabled by default
```

### Boot Kernel Parameters

```
root=UUID=<system-partition>
ro
quiet
modloop=/quantix/system.squashfs
modules=loop,squashfs,overlay
quantix.config=UUID=<config-partition>
quantix.data=UUID=<data-partition>
```

### OverlayFS for Runtime Changes

```bash
# Lower layer: Read-only squashfs
mount -t squashfs /quantix/system.squashfs /mnt/lower

# Upper layer: Tmpfs for runtime changes (lost on reboot)
mount -t tmpfs tmpfs /mnt/upper

# Merged view: What the system sees
mount -t overlay overlay \
    -o lowerdir=/mnt/lower,upperdir=/mnt/upper/data,workdir=/mnt/upper/work \
    /mnt/merged
```

---

## 6. Console TUI (DCUI)

The "yellow screen" Direct Console User Interface provides local management via a Ratatui-based TUI:

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
║   Management URL: https://192.168.1.100:8443                  ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║  [F2] Configure Network    [F5] Refresh Display               ║
║  [F3] Configure SSH        [F6] Restart Services              ║
║  [F4] Join Cluster         [F10] Shutdown/Reboot              ║
╚═══════════════════════════════════════════════════════════════╝
```

### Features

| Key | Function | Description |
|-----|----------|-------------|
| F2 | Configure Network | DHCP/Static, VLAN, DNS |
| F3 | Configure SSH | Enable/disable with security timer |
| F4 | Join Cluster | Enter control plane URL + token |
| F5 | Refresh Display | Update system status |
| F6 | Restart Services | Node daemon, libvirt, OVS |
| F7 | View Diagnostics | System logs, hardware info |
| F10 | Power Menu | Reboot/Shutdown |
| F12 | Emergency Shell | Break-glass access |

### Technology

- **Language**: Rust
- **Framework**: ratatui + crossterm
- **Binary Size**: ~3MB (static musl)
- **Startup Time**: < 100ms

---

## 7. Update Mechanism

### A/B Update Process

```
┌─────────────────────────────────────────────────────────────┐
│                   A/B UPDATE PROCESS                        │
└─────────────────────────────────────────────────────────────┘

1. Control plane pushes new system.squashfs to inactive partition
   
   [System A: ACTIVE]  ←── Running
   [System B: EMPTY ]  ←── Write new image here

2. Update bootloader to point to System B
   
   grub.cfg: set default="quantix-b"

3. Reboot node (can be graceful - migrate VMs first)

4. Boot into System B
   
   [System A: BACKUP]  
   [System B: ACTIVE]  ←── Now running

5. Health check passes → Mark B as "good"
   If health check fails → Auto-reboot into A (watchdog)

6. Next update goes to System A, cycle repeats
```

### Rollback Protection

A watchdog timer ensures safety:

1. Bootloader sets `quantix.pending=1` on first boot of new system
2. Node daemon must call "I'm healthy" within 5 minutes
3. If not called, system reboots automatically into previous partition
4. On successful health check, `quantix.pending` is cleared

---

## 8. Security Model

### No Shell Access by Default

| Access Method | Default State | Enable Via |
|---------------|---------------|------------|
| Login prompt | Disabled | Cannot enable |
| SSH | Disabled | TUI F3 → Enable with timer |
| Emergency Shell | Disabled | TUI F12 + confirm |
| Serial Console | Available | For headless servers |

### Attack Surface Reduction

- **No package manager** in production (removed after build)
- **No compiler/interpreter** (no gcc, python, perl)
- **Minimal userland**: BusyBox only
- **No development tools**: No git, make, etc.
- **Read-only root**: No persistent modifications

### Firewall (nftables)

Default policy is **DROP** with these exceptions:

| Port | Service | Direction |
|------|---------|-----------|
| 8443 | Web UI (HTTPS) | Inbound |
| 9443 | Node Daemon (gRPC) | Inbound |
| 5900-5999 | VNC | Inbound |
| 16509 | Libvirt | Internal |
| 6081 | Geneve (OVN) | Internal |

### TLS Everywhere

- All node-to-control-plane communication is TLS 1.3
- Self-signed certificates generated on first boot
- ACME (Let's Encrypt) support for public certificates
- CA can be provided via cluster join

---

## 9. Directory Structure

### Repository Layout

```
Quantix-OS/
├── Makefile                    # Build orchestration
├── README.md                   # Documentation
├── build.sh                    # Main build script
│
├── builder/
│   ├── Dockerfile.rust-tui     # TUI build environment
│   ├── build-iso.sh            # ISO builder
│   ├── build-squashfs.sh       # Rootfs builder
│   ├── build-initramfs.sh      # Initramfs builder
│   ├── build-node-daemon.sh    # Node daemon builder
│   └── build-host-ui.sh        # Host UI builder
│
├── profiles/
│   └── quantix/
│       ├── packages.conf       # Package list
│       ├── mkinitfs.conf       # initramfs config
│       └── kernel.conf         # Kernel notes
│
├── overlay/                    # Injected into rootfs
│   ├── etc/
│   │   ├── inittab            # TTY config
│   │   ├── fstab              # Mounts
│   │   ├── init.d/
│   │   │   ├── quantix-node   # Node service
│   │   │   ├── quantix-console# TUI service
│   │   │   └── quantix-firstboot
│   │   └── quantix/
│   │       └── defaults.yaml
│   ├── usr/local/bin/
│   │   ├── qx-console          # TUI binary
│   │   └── qx-console-launcher # Launcher script
│   ├── usr/bin/
│   │   └── qx-node             # Node daemon binary
│   └── usr/share/
│       └── quantix-host-ui/    # React Host UI
│
├── console-tui/                # Rust TUI
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
│
├── grub/
│   └── grub.cfg
│
├── initramfs/
│   └── init
│
├── installer/
│   ├── install.sh
│   └── firstboot.sh
│
├── branding/
│   ├── banner.txt
│   └── splash.txt
│
└── output/
    ├── quantix-os-1.0.0.iso
    └── system-1.0.0.squashfs
```

### Runtime Filesystem

```
/                               # OverlayFS (lower=squashfs, upper=tmpfs)
├── bin/                        # BusyBox symlinks
├── etc/                        # Configuration (overlay)
├── lib/                        # Libraries
├── proc/                       # Procfs
├── sys/                        # Sysfs
├── dev/                        # Devtmpfs
├── run/                        # Tmpfs (runtime)
├── tmp/                        # Tmpfs
├── var/log/                    # Tmpfs (logs in RAM)
│
├── quantix/                    # Persistent config (Part 4)
│   ├── node.yaml
│   ├── network.yaml
│   ├── certificates/
│   └── .installed_at
│
└── data/                       # Persistent storage (Part 5)
    ├── vms/
    ├── isos/
    ├── images/
    └── backups/
```

---

## 10. Building

### Prerequisites

- Docker (for reproducible builds)
- 4GB+ disk space
- Internet connection

### Build Commands

```bash
cd Quantix-OS

# Build bootable ISO (includes all components)
make iso

# Build individual components
make tui              # TUI console
make node-daemon      # Node daemon
make host-ui          # React Host UI
make squashfs         # Root filesystem

# Test ISO in QEMU
make test-qemu

# Clean
make clean
```

### Docker Build Process

```bash
# What happens inside the builder container:
1. Build TUI console (Rust, musl target)
2. Build Node daemon (Rust, musl target)
3. Build Host UI (React, npm build)
4. Create Alpine rootfs with apk
5. Install packages (KVM, libvirt, OVS, etc.)
6. Apply overlay files
7. Generate initramfs
8. Create squashfs
9. Build ISO with GRUB (UEFI + BIOS)
```

---

## 11. Future Enhancements

### Phase 1 (Complete)

- [x] Basic Alpine rootfs builder
- [x] A/B partition layout
- [x] OpenRC services
- [x] Rust TUI console
- [x] Node daemon with HTTP/gRPC
- [x] Host UI (React)
- [x] Installer script

### Phase 2 (Current)

- [ ] PXE boot support
- [ ] Automated testing in QEMU
- [ ] Secure Boot signing
- [ ] Hardware compatibility testing

### Phase 3 (Future)

- [ ] OVN controller integration
- [ ] Automatic cluster discovery (mDNS)
- [ ] IPMI/BMC integration for fencing
- [ ] GPU passthrough validation
- [ ] SR-IOV network testing

### Phase 4 (Enterprise)

- [ ] Signed update images
- [ ] TPM-based disk encryption
- [ ] FIPS 140-2 compliance mode
- [ ] Audit logging to remote syslog
- [ ] SNMP monitoring integration

---

## References

- [Alpine Linux Wiki](https://wiki.alpinelinux.org/)
- [mkinitfs Documentation](https://wiki.alpinelinux.org/wiki/Mkinitfs)
- [GRUB Manual](https://www.gnu.org/software/grub/manual/)
- [SquashFS Tools](https://github.com/plougher/squashfs-tools)
- [ESXi Architecture](https://docs.vmware.com/en/VMware-vSphere/index.html)
- [Ratatui Documentation](https://ratatui.rs/)

---

## Appendix A: Package List

See `profiles/quantix/packages.conf` for the complete list. Key packages:

| Category | Packages |
|----------|----------|
| Kernel | linux-lts, linux-firmware |
| Virtualization | qemu-system-x86_64, libvirt, libvirt-daemon |
| Networking | openvswitch, iproute2, iptables |
| Storage | lvm2, xfsprogs, nfs-utils, open-iscsi |
| Security | openssl, tpm2-tools, audit |
| TUI | kbd, libinput |

---

## Appendix B: Comparison with ESXi

| Feature | ESXi | Quantix-OS |
|---------|------|------------|
| Base | Custom Linux | Alpine Linux |
| Init | Custom | OpenRC |
| Userland | BusyBox | BusyBox |
| Hypervisor | VMkernel | KVM |
| Management Agent | hostd | qx-node (Rust) |
| Console | DCUI | qx-console (Rust TUI) |
| Footprint | ~150MB | ~200MB |
| Boot Time | ~20s | ~10s |
| Update | VIBs | A/B Squashfs |
| Licensing | Proprietary | Apache 2.0 |
