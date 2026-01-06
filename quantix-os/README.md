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

# Build console GUI (Slint)
make console-gui

# Build console TUI (ratatui fallback)
make console-tui

# Test in QEMU
make test-qemu

# Clean build artifacts
make clean
```

## Directory Structure

```
limiquantix-os/
├── Makefile                    # Build orchestration
├── README.md                   # This file
├── builder/
│   ├── Dockerfile              # Alpine build environment
│   ├── Dockerfile.rust-gui     # Slint GUI builder (Alpine + Rust)
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
├── console-gui/                # Slint GUI (Rust)
├── console-tui/                # ratatui fallback TUI
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
4. Console GUI appears on TTY1

## Components

### Console GUI (Slint)
- First-boot installation wizard
- System status dashboard
- Network configuration
- SSH management
- Emergency shell access

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
