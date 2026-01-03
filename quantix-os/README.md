# Quantix-OS

**The Immutable Hypervisor Operating System for Quantix-KVM**

Quantix-OS is a custom Alpine Linux-based operating system designed specifically for running the Quantix-KVM hypervisor. It follows the ESXi/Nutanix AHV architecture pattern: immutable root filesystem, A/B partitioning for safe updates, and a minimal attack surface.

## Philosophy

> "The OS is a detail, not the product."

- **Immutable Root**: The OS lives in a read-only squashfs image. No packages to update, no drift.
- **Stateless Boot**: The OS boots into RAM in seconds. A reboot resets to a known-good state.
- **Config Separation**: Only configuration (`/quantix`) and VM data (`/data`) persist.
- **A/B Updates**: Updates are atomic. Flash to inactive partition, reboot, auto-rollback on failure.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   QUANTIX-OS DISK LAYOUT                    │
├─────────────────────────────────────────────────────────────┤
│  Part 1: EFI/Boot (100MB)                                   │
│  ├── /EFI/BOOT/BOOTX64.EFI                                  │
│  └── /grub/grub.cfg                                         │
├─────────────────────────────────────────────────────────────┤
│  Part 2: System A (300MB) ← Active System                   │
│  ├── vmlinuz-lts                                            │
│  ├── initramfs-lts                                          │
│  └── system.squashfs                                        │
├─────────────────────────────────────────────────────────────┤
│  Part 3: System B (300MB) ← Update Target                   │
│  └── (empty until first update)                             │
├─────────────────────────────────────────────────────────────┤
│  Part 4: Config (100MB)                                     │
│  └── /quantix/                                              │
│      ├── node.yaml           Node configuration             │
│      ├── network.yaml        Network settings               │
│      ├── certificates/       TLS certificates               │
│      └── firstboot.done      First boot marker              │
├─────────────────────────────────────────────────────────────┤
│  Part 5: Data (REST OF DISK)                                │
│  └── LVM/ZFS/XFS for VM storage pools                       │
└─────────────────────────────────────────────────────────────┘
```

## Boot Flow

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
       │  5. pivot_root       │
       └──────────────────────┘
                    │
                    ▼
       ┌──────────────────────┐
       │     OpenRC Init      │
       │  1. Network setup    │
       │  2. Mount /data      │
       │  3. Start libvirtd   │
       │  4. Start ovs-vswitc │
       │  5. Start qx-node    │
       │  6. Start qx-console │
       └──────────────────────┘
                    │
                    ▼
    TTY1: qx-console         Web UI: https://<ip>:8443
    (Shows connection info)   SSH: Disabled by default
```

## Features

### Immutable & Secure
- Read-only root filesystem (squashfs)
- No shell access by default (F12 for emergency)
- Minimal attack surface (~150MB total)
- Secure boot compatible

### Fast & Efficient
- Boots in < 10 seconds
- Runs entirely from RAM
- < 1% platform overhead
- BusyBox userland

### Safe Updates
- A/B partition scheme
- Atomic updates (never half-applied)
- Automatic rollback on boot failure
- No package manager in production

### Enterprise Ready
- PXE boot support
- Headless or console UI
- REST API configuration

## Building

### Prerequisites

- **Docker Desktop** (Windows, Mac, or Linux)
  - Windows: [Download Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - Must be in **Linux containers mode** (default)
- 4GB+ disk space
- Internet connection (to download Alpine packages)

### Quick Build (Windows)

```powershell
# Option 1: PowerShell (recommended)
cd quantix-os
.\build.ps1

# Option 2: Command Prompt
cd quantix-os
build.bat
```

### Quick Build (Linux/Mac)

```bash
cd quantix-os
make iso
```

### Build Options

| Command | Description |
|---------|-------------|
| `.\build.ps1` | Build bootable ISO (default) |
| `.\build.ps1 -Target squashfs` | Build update image only |
| `.\build.ps1 -Version 1.2.0` | Build with custom version |
| `.\build.ps1 -Clean` | Remove build artifacts |

### What Gets Built

```
output/
├── quantix-os-1.0.0.iso      # Bootable installer (~200MB)
├── quantix-os-1.0.0.iso.sha256
├── system-1.0.0.squashfs     # Update image (~150MB)
└── system-1.0.0.squashfs.sha256
```

### Build Process

The build runs entirely inside Docker, so it works on any OS:

```
┌─────────────────────────────────────────────────────────────┐
│  Your Machine (Windows/Mac/Linux)                           │
│  └── Docker Desktop                                         │
│      └── quantix-os-builder container (Alpine)              │
│          ├── Creates Alpine rootfs                          │
│          ├── Installs KVM, libvirt, OVS                     │
│          ├── Applies custom overlay                         │
│          ├── Compresses to squashfs                         │
│          └── Generates bootable ISO                         │
└─────────────────────────────────────────────────────────────┘
```
- Cluster auto-join

## Directory Structure

```
quantix-os/
├── Makefile                    # Build orchestration
├── README.md                   # This file
│
├── builder/
│   ├── Dockerfile              # Build environment
│   ├── build-iso.sh            # Main ISO build script
│   └── build-squashfs.sh       # Root filesystem builder
│
├── profiles/
│   └── quantix/
│       ├── packages.conf       # APK packages to include
│       ├── kernel.conf         # Kernel configuration
│       └── mkinitfs.conf       # initramfs configuration
│
├── overlay/                    # Injected into root filesystem
│   ├── etc/
│   │   ├── inittab            # TTY configuration
│   │   ├── hostname           # Default hostname
│   │   ├── motd               # Welcome message
│   │   ├── fstab              # Mount points
│   │   ├── init.d/
│   │   │   ├── quantix-node   # Node daemon service
│   │   │   ├── quantix-console# Console TUI service
│   │   │   └── quantix-firstboot
│   │   └── quantix/
│   │       └── defaults.yaml  # Default configuration
│   │
│   ├── usr/local/bin/
│   │   ├── qx-node            # Node daemon binary
│   │   ├── qx-console         # Console TUI binary
│   │   └── qx-update          # Update utility
│   │
│   └── var/lib/quantix/
│       └── .keep
│
├── installer/
│   ├── install.sh              # Disk installer script
│   └── firstboot.sh            # First boot configuration
│
├── console/                    # TUI Console (Rust + ratatui)
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
│
├── branding/
│   ├── splash.txt              # Boot splash ASCII art
│   └── banner.txt              # Console banner
│
└── output/                     # Build artifacts
    ├── quantix-os-1.0.0.iso    # Bootable installer
    └── system-1.0.0.squashfs   # Update image
```

## Building

### Prerequisites

- Docker (for reproducible builds)
- 4GB+ disk space
- Internet connection (to download Alpine packages)

### Quick Build

```bash
# Build the ISO
make iso

# Build just the squashfs (for updates)
make squashfs

# Clean build artifacts
make clean
```

### Manual Build (in Docker)

```bash
# Build the builder image
docker build -t quantix-os-builder builder/

# Run the build
docker run --rm -v $(pwd)/output:/output quantix-os-builder
```

## Installation

### From ISO

1. Boot the server from `quantix-os-1.0.0.iso`
2. The installer will auto-detect disks
3. Select target disk (WARNING: all data will be erased)
4. Wait for installation to complete (~2 minutes)
5. Reboot and remove installation media

### PXE Boot

See `docs/pxe-boot-guide.md` for network installation.

### First Boot

After installation, the system boots to the DCUI (Direct Console User Interface):

```
╔═══════════════════════════════════════════════════════════════╗
║                     QUANTIX-OS v1.0.0                         ║
║                   The VMware Killer                           ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   Node:     quantix-01.local                                  ║
║   Status:   Not Configured                                    ║
║   IP:       192.168.1.100 (DHCP)                             ║
║                                                               ║
║   Management URL: https://192.168.1.100:8443                  ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║  [F2] Configure Network    [F5] Restart Services              ║
║  [F3] View Logs            [F10] Shutdown                     ║
║  [F4] Join Cluster         [F12] Emergency Shell              ║
╚═══════════════════════════════════════════════════════════════╝
```

## Configuration

### Network Configuration (F2)

- Set static IP or DHCP
- Configure VLAN tagging
- Set DNS servers
- Configure management network

### Cluster Join (F4)

- Enter control plane URL
- Authenticate with join token
- Node auto-registers with cluster

### Persistent Configuration

All configuration is stored in `/quantix/`:

```yaml
# /quantix/node.yaml
node_id: "550e8400-e29b-41d4-a716-446655440000"
hostname: "quantix-01"
cluster_url: "https://control-plane.example.com:6443"
join_token: "xxxx.xxxxx"

# /quantix/network.yaml
management:
  interface: "eth0"
  mode: "static"
  address: "192.168.1.100/24"
  gateway: "192.168.1.1"
  dns:
    - "8.8.8.8"
    - "8.8.4.4"
```

## Updates

### Rolling Update (Recommended)

```bash
# From control plane
qxctl node update quantix-01 --image system-1.1.0.squashfs

# The node will:
# 1. Download image to inactive partition
# 2. Migrate VMs to other nodes (if in cluster)
# 3. Reboot to new system
# 4. Health check → mark as good
# 5. Resume hosting VMs
```

### Manual Update (Single Node)

```bash
# On the node (via emergency shell)
qx-update --image /tmp/system-1.1.0.squashfs
reboot
```

### Rollback

If the new system fails health checks within 5 minutes, the bootloader automatically reverts to the previous partition.

## Security

### No Shell Access

By default, there is no login prompt. The system runs headless or with the DCUI.

- **F12**: Emergency shell (requires IPMI/iLO password)
- **SSH**: Disabled by default, enable via DCUI for troubleshooting

### Secure Boot

Quantix-OS supports UEFI Secure Boot:

1. Sign the bootloader with your organization's keys
2. Enroll keys in firmware
3. Enable Secure Boot

### Integrity

The squashfs image can be verified:

```bash
# Verify signature
gpg --verify system-1.0.0.squashfs.sig system-1.0.0.squashfs
```

## Development

### Adding Packages

Edit `profiles/quantix/packages.conf`:

```
# Core
linux-lts
linux-firmware

# Virtualization
qemu-system-x86_64
libvirt
libvirt-daemon

# Add your package here
my-custom-package
```

### Custom Kernel Options

Edit `profiles/quantix/kernel.conf`:

```
# Enable IOMMU for passthrough
CONFIG_INTEL_IOMMU=y
CONFIG_AMD_IOMMU=y
CONFIG_VFIO=m
CONFIG_VFIO_PCI=m
```

### Building the Console TUI

```bash
cd console
cargo build --release --target x86_64-unknown-linux-musl
cp target/x86_64-unknown-linux-musl/release/qx-console ../overlay/usr/local/bin/
```

## Why Alpine Linux?

| Feature | Alpine | Ubuntu | Talos |
|---------|--------|--------|-------|
| Base Size | ~150MB | ~2GB | ~500MB |
| Init System | OpenRC | systemd | None (API) |
| Package Manager | APK | APT | None |
| RAM Boot | Native | Custom | Native |
| Musl libc | ✅ | ❌ | ✅ |
| Our Use Case | Perfect | Too big | Too K8s-focused |

## License

Apache 2.0

## Contributing

See `CONTRIBUTING.md` for development guidelines.
