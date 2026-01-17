# 000059 - Quantix-OS Build Guide

**Description:** Complete guide for building Quantix-OS from source, including all components (Alpine rootfs, TUI console, Node daemon, Host UI).

**Last Updated:** January 7, 2026

---

## Overview

This document provides step-by-step instructions for building Quantix-OS, a custom immutable hypervisor operating system based on Alpine Linux.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Docker | 20.10+ | Build environment isolation |
| Git | 2.0+ | Source control |
| Ubuntu/Debian | 22.04+ | Build host (recommended) |

### Optional (for local development)

| Software | Version | Purpose |
|----------|---------|---------|
| Rust | 1.83+ | TUI/Node daemon development |
| Node.js | 20+ | Host UI development |
| QEMU | 8.0+ | Testing |
| OVMF | Any | UEFI testing |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Quantix-KVM/LimiQuantix.git
cd LimiQuantix/Quantix-OS

# Build the complete ISO (recommended method)
make iso

# Test in QEMU
make test-qemu
```

## Build Targets

### Makefile Targets

```bash
# Build everything
make iso            # Complete bootable ISO

# Build individual components
make tui            # TUI console (qx-console)
make node-daemon    # Node daemon (qx-node)
make host-ui        # React Host UI
make squashfs       # Alpine rootfs only
make initramfs      # Boot initramfs only

# Testing
make test-qemu      # Test ISO in QEMU
make test-qemu-uefi # Test ISO in QEMU with UEFI

# Cleanup
make clean          # Remove build artifacts
```

## Installer EFI Verification
When testing on real hardware, validate the EFI System Partition before
rebooting after install:

```sh
mount | grep /mnt/install/efi
ls -la /mnt/install/efi/EFI/BOOT
```

Expected:
- `EFI/BOOT/BOOTX64.EFI` exists on the ESP.

## Build Output

After a successful build:

```
output/
├── quantix-os-1.0.0.iso      # Bootable ISO (~800MB)
├── system-1.0.0.squashfs     # Root filesystem
├── initramfs-1.0.0.cpio.gz   # Boot initramfs
└── modules/                   # Kernel modules (extracted)
```

## Directory Structure

```
Quantix-OS/
├── Makefile                    # Build orchestration
├── README.md                   # Project overview
├── TESTING.md                  # Testing guide
│
├── builder/                    # Docker build scripts
│   ├── Dockerfile.rust-tui     # TUI build environment (Alpine + Rust)
│   ├── build-squashfs.sh       # Rootfs builder
│   ├── build-initramfs.sh      # Initramfs builder
│   ├── build-iso.sh            # ISO builder
│   ├── build-node-daemon.sh    # Node daemon builder
│   └── build-host-ui.sh        # Host UI builder
│
├── profiles/quantix/           # System configuration
│   └── packages.conf           # APK packages to install
│
├── overlay/                    # Files copied to rootfs
│   ├── etc/
│   │   ├── inittab             # TTY configuration
│   │   ├── fstab               # Filesystem mounts
│   │   ├── init.d/             # OpenRC services
│   │   │   ├── quantix-network # Network auto-config
│   │   │   ├── quantix-node    # Node daemon service
│   │   │   └── quantix-console # TUI console service
│   │   ├── local.d/            # Early init scripts
│   │   ├── quantix/            # Default configuration
│   │   └── wpa_supplicant/     # WiFi configuration
│   └── usr/
│       ├── bin/                # Binaries (qx-node)
│       ├── local/bin/          # Scripts (qx-console, qx-console-launcher)
│       └── share/quantix-host-ui/  # Web UI
│
├── grub/                       # GRUB configuration
│   └── grub.cfg                # Boot menu
│
├── initramfs/                  # Custom initramfs
│   └── init                    # Init script (critical for boot)
│
├── installer/                  # Installation scripts
│   ├── install.sh              # Disk installer
│   └── firstboot.sh            # First-boot setup
│
├── console-tui/                # Ratatui TUI (Rust)
│   ├── Cargo.toml
│   └── src/
│       └── main.rs
│
├── branding/                   # ASCII art, logos
│   ├── banner.txt
│   └── splash.txt
│
└── output/                     # Build artifacts
```

## Build Process Details

### Phase 1: Docker Build Environments

The build uses specialized Docker containers for cross-compilation:

```bash
# TUI Console - Alpine + Rust + musl
docker build -t quantix-rust-tui-builder -f builder/Dockerfile.rust-tui builder/

# Host UI - Node.js Alpine
# Uses node:20-alpine directly

# Node Daemon - same as TUI builder
```

### Phase 2: Component Building

#### TUI Console (`qx-console`)

Built with Rust targeting musl for Alpine compatibility:

```bash
# Inside Docker container
cargo build --release --target x86_64-unknown-linux-musl
# Output: overlay/usr/local/bin/qx-console
```

Features:
- System status dashboard
- Network configuration (DHCP/Static)
- SSH management with security timer
- Cluster join interface
- Service management
- Power operations

#### Node Daemon (`qx-node`)

Built with Rust, provides HTTP/gRPC APIs:

```bash
# Inside Docker container
cargo build --release --target x86_64-unknown-linux-musl
# Output: overlay/usr/bin/qx-node
```

Features:
- REST API at `/api/v1/*`
- gRPC API at port 9443
- Static file serving for Host UI
- HTTPS with TLS certificate management
- VM lifecycle management via libvirt
- Storage pool management
- Network configuration via OVS

#### Host UI (React)

Built with Vite, produces static files:

```bash
# Inside Docker container
npm ci
npm run build
# Output: overlay/usr/share/quantix-host-ui/
```

Features:
- Dashboard with system status
- VM management (create, start, stop, console)
- Storage pool management
- Performance monitoring
- Cluster status

### Phase 3: Alpine Rootfs (Squashfs)

The `build-squashfs.sh` script:

1. Creates Alpine rootfs via `apk --root`
2. Installs packages from `profiles/quantix/packages.conf`
3. Installs firmware packages (Intel, AMD, Broadcom)
4. Applies overlay files (services, configs, binaries)
5. Enables OpenRC services:
   - `quantix-network` (boot) - Auto DHCP on all interfaces
   - `quantix-node` (default) - Node daemon API server
   - `quantix-console` (default) - TUI console
6. Creates squashfs with XZ compression

### Phase 4: Initramfs

The `build-initramfs.sh` script creates a custom initramfs that:

1. Uses statically-linked busybox
2. Includes kernel modules for:
   - Block devices (SCSI, USB, NVMe, SATA)
   - Filesystems (squashfs, overlay, iso9660)
   - Network (virtio, e1000, etc.)
3. Mounts the squashfs and pivots to it

**Critical**: The initramfs must include all kernel modules needed to detect boot media.

### Phase 5: ISO Creation

The `build-iso.sh` script:

1. Extracts kernel and modules from squashfs
2. Creates GRUB configuration for UEFI and BIOS
3. Generates EFI boot image
4. Creates hybrid ISO with xorriso

## Services Enabled at Boot

| Service | Runlevel | Purpose |
|---------|----------|---------|
| `quantix-network` | boot | Auto-configure network via DHCP |
| `quantix-node` | default | Node daemon (API server on port 8443/9443) |
| `quantix-console` | default | TUI console on TTY1 |
| `libvirtd` | default | Libvirt daemon |
| `chronyd` | default | NTP time sync |

## Network Configuration

### Automatic Configuration

The `quantix-network` service automatically:
- Detects all physical network interfaces
- Brings up interfaces
- Runs DHCP on each interface
- Supports WiFi (if configured)

### Manual Network

```bash
# Bring up interface
ip link set eth0 up

# Get IP via DHCP
udhcpc -i eth0

# Or set static IP
ip addr add 192.168.1.100/24 dev eth0
ip route add default via 192.168.1.1
```

## Testing

### QEMU (Quick Test)

```bash
# Basic test
make test-qemu

# With port forwarding (access Web UI from host)
qemu-system-x86_64 -enable-kvm -m 4G \
    -cdrom output/quantix-os-1.0.0.iso \
    -device virtio-net-pci,netdev=net0 \
    -netdev user,id=net0,hostfwd=tcp::8443-:8443,hostfwd=tcp::9443-:9443

# UEFI mode
make test-qemu-uefi
```

### Accessing Services in QEMU

After booting in QEMU with port forwarding:

1. **Inside QEMU VM**, configure network:
   ```bash
   ip link set eth0 up
   udhcpc -i eth0
   ```

2. **From host**, access:
   - Web UI: https://localhost:8443/
   - Health API: https://localhost:8443/api/v1/host/health
   - gRPC: localhost:9443

### Physical Hardware

```bash
# Create bootable USB
sudo dd if=output/quantix-os-1.0.0.iso of=/dev/sdX bs=4M status=progress
sync
```

## Troubleshooting

### Build Fails: "Permission denied"

```bash
# Make build scripts executable
chmod +x builder/*.sh

# Or run with bash explicitly
bash ./builder/build-squashfs.sh
```

### Build Fails: "Package not found"

Check Alpine package availability:
```bash
# Search Alpine packages
docker run --rm alpine:3.20 apk search <package-name>
```

### Build Fails: "Rust version too old"

The Dockerfile.rust-tui uses rustup for latest Rust. If building locally:
```bash
rustup update stable
```

### ISO Won't Boot (Black Screen)

1. Try "Safe Graphics" mode from GRUB menu
2. Add `nomodeset` to kernel command line
3. Check if UEFI/BIOS mode matches your hardware

### Post-Install Boot Stalls at "Start PXE over IPv4"

If the system stalls at PXE when Ethernet is connected, the firmware is
prioritizing network boot over the installed disk.

**Mitigation:**
1. Boot once with Ethernet disconnected (or disable PXE in BIOS/UEFI).
2. The first boot now promotes the Quantix boot entry to the front of UEFI
   `BootOrder` and sets `BootNext`, so future boots work with Ethernet connected.

### ISO Boots but "No block devices found"

This indicates missing kernel modules in initramfs. Verify:
```bash
# Check initramfs contents
zcat output/initramfs-*.cpio.gz | cpio -t | grep -E "\.ko"
```

### Network Not Working

Inside the VM:
```bash
# Check interface status
ip link show

# Bring up interface manually
ip link set eth0 up
udhcpc -i eth0

# Check service status
rc-service quantix-network status
```

### Web UI Not Loading

1. Check node daemon is running:
   ```bash
   ps aux | grep qx-node
   ```

2. Check it's listening:
   ```bash
   netstat -tlnp | grep 8443
   ```

3. Check Web UI files exist:
   ```bash
   ls -la /usr/share/quantix-host-ui/
   ```

### TUI Console Not Starting

1. Check console service:
   ```bash
   rc-service quantix-console status
   ```

2. Check logs:
   ```bash
   cat /var/log/quantix-console.log
   ```

3. Run manually:
   ```bash
   /usr/local/bin/qx-console
   ```

## Customization

### Adding Packages

Edit `profiles/quantix/packages.conf`:

```bash
# Add your package
my-custom-package
```

### Adding Services

1. Create service script in `overlay/etc/init.d/`:
   ```bash
   #!/sbin/openrc-run
   name="My Service"
   command="/usr/bin/my-service"
   command_background="yes"
   pidfile="/run/my-service.pid"

   depend() {
       need quantix-network
   }
   ```

2. Enable in `builder/build-squashfs.sh`:
   ```bash
   chroot "${ROOTFS_DIR}" /sbin/rc-update add my-service default || true
   ```

### Changing Boot Menu

Edit `grub/grub.cfg`:

```grub
menuentry "My Custom Entry" {
    linux /boot/vmlinuz boot=live toram quiet
    initrd /boot/initramfs
}
```

## Console Architecture

Quantix-OS uses a TUI (Text User Interface) for local console management:

```
┌─────────────────────────────────────────┐
│     qx-console (Ratatui TUI)            │  <- Rust binary
├─────────────────────────────────────────┤
│     crossterm (Terminal abstraction)    │  <- Cross-platform
├─────────────────────────────────────────┤
│     Linux TTY (TTY1)                    │  <- Physical console
└─────────────────────────────────────────┘
```

**Benefits:**
- Works on all hardware (no GPU required)
- Minimal footprint (~3MB binary)
- Fast startup (< 100ms)
- No graphics driver issues
- Works over serial console

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000058 - Complete Vision](./000058-quantix-os-complete-vision.md)
- [000060 - Network and TUI Setup](./000060-network-and-gui-setup.md)
- [000061 - Agent Architecture](./000061-agent-architecture.md)
