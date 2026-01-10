# Quantix-OS

**Quantix-OS** is a custom, immutable, purpose-built hypervisor operating system designed to power the Quantix-KVM virtualization platform.

## Overview

Quantix-OS follows the ESXi/Nutanix AHV architecture pattern:
- **Immutable root filesystem** (squashfs, read-only)
- **A/B partitioning** for safe atomic updates
- **Minimal attack surface** (~150MB footprint)
- **Boots to RAM** in under 10 seconds

## Quick Start

### Prerequisites

- Docker (for reproducible builds)
- 4GB+ disk space
- Internet connection

### Build Commands

```bash
# Build complete bootable ISO
make iso

# Build only the squashfs rootfs
make squashfs

# Build console TUI (ratatui)
make console-tui

# Build node daemon
make node-daemon

# Test in QEMU
make test-qemu

# Clean build artifacts
make clean
```

## Directory Structure

```
Quantix-OS/
├── Makefile                    # Build orchestration
├── README.md                   # This file
├── builder/
│   ├── Dockerfile              # Alpine build environment
│   ├── Dockerfile.rust-tui     # TUI builder (Alpine + Rust)
│   ├── build-iso.sh            # ISO generation script
│   ├── build-squashfs.sh       # Rootfs builder
│   └── build-initramfs.sh      # Custom initramfs
├── profiles/
│   └── quantix/
│       ├── packages.conf       # APK package list
│       ├── mkinitfs.conf       # initramfs modules
│       └── kernel-modules.conf # Required kernel modules
├── overlay/                    # Files injected into rootfs
│   ├── etc/
│   │   ├── inittab
│   │   ├── fstab
│   │   ├── init.d/
│   │   ├── local.d/
│   │   └── quantix/
│   └── usr/
├── installer/
│   ├── install.sh              # Disk partitioner + installer
│   └── firstboot.sh            # First-boot initialization
├── console-tui/                # ratatui TUI console (primary)
├── grub/                       # GRUB configuration
├── initramfs/                  # Custom init scripts
├── branding/
└── output/                     # Built artifacts
```

## Disk Layout

```
┌─────────────────────────────────────────────────────────────┐
│                   QUANTIX-OS DISK LAYOUT                    │
├─────────────────────────────────────────────────────────────┤
│  Part 1: EFI/Boot (100MB)                                   │
│  Part 2: System A (300MB) ← Active System                   │
│  Part 3: System B (300MB) ← Update Target                   │
│  Part 4: Config (100MB)   ← /quantix                        │
│  Part 5: Data (REST)      ← /data (VMs, ISOs, etc.)         │
└─────────────────────────────────────────────────────────────┘
```

## Boot Process

1. UEFI → GRUB → vmlinuz + initramfs
2. initramfs mounts squashfs + overlayfs
3. OpenRC starts services
4. TUI Console appears on TTY1

## Components

### Console TUI (ratatui)

The Quantix-OS console uses a **TUI-only approach** (no GUI, no Web Kiosk).

See: [ADR-000010: TUI-Only Console](../docs/adr/000010-tui-only-console.md)

Features:
- First-boot installation wizard
- System status dashboard
- Network configuration (IP, gateway, DNS, VLAN)
- SSH enable/disable
- Root password management
- Cluster join/leave
- Emergency shell access

Benefits:
- Works on all hardware (including serial-only servers)
- Minimal resource usage
- Fast startup
- VMware ESXi DCUI-like experience

### Host UI (React)
- Web-based management at https://ip:8443
- VM lifecycle management
- Storage pool management
- Performance monitoring

### Node Daemon (Rust)
- gRPC API on port 9443
- REST/WebSocket on port 8443
- libvirt integration
- Guest agent communication

## License

Apache 2.0
