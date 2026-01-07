# 000059 - Quantix-OS Build Guide

**Description:** Complete guide for building Quantix-OS from source, including all components (Alpine rootfs, Web Kiosk GUI, TUI fallback, Host UI integration).

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
| Rust | 1.83+ | Console GUI/TUI development |
| Node.js | 20+ | Host UI development |
| QEMU | 8.0+ | Testing |
| OVMF | Any | UEFI testing |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Quantix-KVM/LimiQuantix.git
cd LimiQuantix/Quantix-OS

# Build the complete ISO (recommended method)
./build.sh --clean

# Or use make
make iso

# Test in QEMU
make test-qemu
```

## Build Methods

### Method 1: build.sh (Recommended)

The `build.sh` script is the primary build method. It handles all Docker setup, component building, and ISO creation.

```bash
# Full clean build
./build.sh --clean

# Incremental build (faster, reuses cached components)
./build.sh

# Skip component builds (use existing binaries)
./build.sh --skip-components
```

### Method 2: Makefile

The Makefile provides granular control over individual build steps:

```bash
# Build everything
make iso

# Build individual components
make squashfs       # Alpine rootfs
make initramfs      # Boot initramfs
make docker-full    # Docker build environment
```

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
├── build.sh                    # Main build script
├── Makefile                    # Alternative build orchestration
├── README.md                   # Project overview
├── TESTING.md                  # Testing guide
│
├── builder/                    # Docker build scripts
│   ├── Dockerfile              # Alpine build environment
│   ├── Dockerfile.full         # Full build environment (Rust + Node.js)
│   ├── build-squashfs.sh       # Rootfs builder
│   ├── build-initramfs.sh      # Initramfs builder
│   ├── build-iso.sh            # ISO builder
│   └── build-all-components.sh # Component builder (runs in Docker)
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
│   │   │   └── quantix-console # Console service
│   │   ├── local.d/            # Early init scripts
│   │   ├── quantix/            # Default configuration
│   │   └── wpa_supplicant/     # WiFi configuration
│   └── usr/
│       ├── bin/                # Binaries (qx-node, qx-console-gui)
│       ├── local/bin/          # Scripts (qx-console-launcher)
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
├── console-gui/                # DEPRECATED: Slint GUI (replaced by Web Kiosk)
│   └── (No longer used - GUI now uses Cage + Cog)
│
├── console-tui/                # Ratatui TUI (Rust)
│   ├── Cargo.toml
│   └── src/
│
├── branding/                   # ASCII art, logos
│   ├── banner.txt
│   └── splash.txt
│
└── output/                     # Build artifacts
```

## Build Process Details

### Phase 1: Docker Environment

The build uses a unified Docker container (`Dockerfile.full`) that includes:
- Alpine Linux base
- Rust toolchain (via rustup for latest version)
- Node.js and npm
- All build dependencies

```bash
# Built automatically by build.sh
docker build -t quantix-full-builder -f builder/Dockerfile.full builder/
```

### Phase 2: Component Building

Inside the Docker container, `build-all-components.sh` builds:

1. **Node Daemon** (`qx-node`)
   - Built with `cargo build --release`
   - Statically linked for Alpine compatibility
   - Copied to `/usr/bin/qx-node`

2. **Host UI** (React web interface)
   - Built with `npm run build`
   - Copied to `/usr/share/quantix-host-ui/`
   - Symlinked to `/usr/share/quantix/webui`

3. **Console TUI** (`qx-console`)
   - Built with `cargo build --release`
   - Copied to `/usr/local/bin/qx-console`

4. **Console GUI** (Web Kiosk)
   - Uses `cage` (Wayland kiosk compositor)
   - Uses `cog` + `wpewebkit` (embedded browser)
   - Displays the React Host UI at http://localhost:8443
   - No Rust compilation needed - packages installed via packages.conf

### Phase 3: Alpine Rootfs (Squashfs)

The `build-squashfs.sh` script:

1. Creates Alpine rootfs via `apk --root`
2. Installs packages from `profiles/quantix/packages.conf`
3. Applies overlay files (services, configs, binaries)
4. Enables OpenRC services:
   - `quantix-network` (boot) - Auto DHCP on all interfaces
   - `quantix-node` (default) - Node daemon API server
   - `quantix-console` (default) - Management console
5. Creates squashfs with XZ compression

### Phase 4: Initramfs

The `build-initramfs.sh` script creates a custom initramfs that:

1. Uses statically-linked busybox
2. Includes kernel modules for:
   - Block devices (SCSI, USB, NVMe, SATA)
   - Filesystems (squashfs, overlay, iso9660)
   - Graphics (DRM, GPU drivers)
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
| `quantix-node` | default | Node daemon (API server on port 8443/9090) |
| `quantix-console` | default | Management console (GUI or TUI) |
| `seatd` | default | Seat management for GUI |
| `libvirtd` | default | Libvirt daemon |
| `chronyd` | default | NTP time sync |

## Network Configuration

### Automatic Configuration

The `quantix-network` service automatically:
- Detects all physical network interfaces
- Brings up interfaces
- Runs DHCP on each interface
- Supports WiFi (if configured)

### WiFi Setup

```bash
# Copy example config
cp /etc/wpa_supplicant/wpa_supplicant.conf.example \
   /etc/wpa_supplicant/wpa_supplicant.conf

# Edit with your network
vi /etc/wpa_supplicant/wpa_supplicant.conf

# Restart network
rc-service quantix-network restart
```

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
# Basic test (no port forwarding)
make test-qemu

# With port forwarding (access Web UI from host)
qemu-system-x86_64 -enable-kvm -m 4G \
    -cdrom output/quantix-os-1.0.0.iso \
    -device virtio-net-pci,netdev=net0 \
    -netdev user,id=net0,hostfwd=tcp::8443-:8443,hostfwd=tcp::9090-:9090

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

2. **Start node daemon** (if not auto-started):
   ```bash
   /usr/bin/qx-node --webui-path /usr/share/quantix-host-ui
   ```

3. **From host**, access:
   - Web UI: http://localhost:8443/
   - Health API: http://localhost:8443/api/v1/host/health
   - gRPC: localhost:9090

### Physical Hardware

```bash
# Create bootable USB
sudo dd if=output/quantix-os-1.0.0.iso of=/dev/sdX bs=4M status=progress
sync
```

## Troubleshooting

### Build Fails: "Permission denied"

```bash
# Make build script executable
chmod +x build.sh builder/*.sh

# Or run with bash explicitly
bash ./build.sh
```

### Build Fails: "Package not found"

Check Alpine package availability:
```bash
# Search Alpine packages
docker run --rm alpine:3.20 apk search <package-name>
```

### Build Fails: "Rust version too old"

The `Dockerfile.full` uses rustup to get the latest Rust. If building locally:
```bash
rustup update stable
```

### ISO Won't Boot (Black Screen)

1. Try "Safe Graphics" mode from GRUB menu
2. Add `nomodeset` to kernel command line
3. Check if UEFI/BIOS mode matches your hardware

### ISO Boots but "No block devices found"

This indicates missing kernel modules in initramfs. The build should automatically include them, but verify:
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

### GUI Console (Web Kiosk) Not Starting

The GUI uses Cage (Wayland kiosk) + Cog (WPE WebKit browser) to display the React Host UI.

1. Check for graphics:
   ```bash
   ls /dev/dri/
   ls /dev/fb0
   ```

2. Check seatd is running:
   ```bash
   rc-service seatd status
   ```

3. Check node daemon is running (Web UI must be available):
   ```bash
   rc-service quantix-node status
   curl http://localhost:8443/
   ```

4. Check cage and cog are installed:
   ```bash
   which cage
   which cog
   ```

5. Try TUI fallback:
   ```bash
   qx-console-launcher --tui
   ```

6. Manual kiosk launch for debugging:
   ```bash
   export XDG_RUNTIME_DIR=/run/user/0
   mkdir -p $XDG_RUNTIME_DIR
   seatd -g video &
   cage -- cog http://localhost:8443
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

## GUI Architecture (Web Kiosk)

The Quantix-OS GUI console uses a "Web Kiosk" pattern instead of a native GUI toolkit:

```
┌─────────────────────────────────────────┐
│     React Host UI (same as Web UI)      │  <- Your existing dashboard
├─────────────────────────────────────────┤
│       Cog (WPE WebKit Browser)          │  <- Embedded browser
├─────────────────────────────────────────┤
│     Cage (Wayland Kiosk Compositor)     │  <- Fullscreen kiosk mode
├─────────────────────────────────────────┤
│     wlroots → DRM/KMS → libinput        │  <- Hardware abstraction
└─────────────────────────────────────────┘
```

**Benefits:**
- Reuses existing React UI code
- Stable input handling via libinput/libseat
- No complex LinuxKMS/fbdev driver issues
- Proven Wayland infrastructure

**Packages:**
- `cage` - Wayland kiosk compositor (runs single app fullscreen)
- `cog` - Simple WPE WebKit launcher
- `wpewebkit` - Lightweight embedded WebKit engine

## USB Deployment

After building the ISO, use the `deploy-usb.sh` script for reliable USB deployment:

### Why Use deploy-usb.sh Instead of Manual DD

| Problem | Manual DD | deploy-usb.sh |
|---------|-----------|---------------|
| Windows "file not found" error | ❌ Leaves old partition signatures | ✅ Wipes all signatures with wipefs + sgdisk |
| "Device busy" errors | ❌ Must manually unmount | ✅ Auto-unmounts all partitions |
| Fake "2.5 GB/s" speed | ❌ Reports cached speed | ✅ Uses `conv=fsync` for true hardware sync |
| Corrupted writes | ❌ No verification | ✅ Optional MD5 verification |
| Wrong device | ❌ Easy to destroy system disk | ✅ Validates USB device, warns on non-USB |

### Usage

```bash
# List available USB devices
sudo ./builder/deploy-usb.sh --list

# Deploy to USB (interactive confirmation)
sudo ./builder/deploy-usb.sh /dev/sdb

# Deploy with verification (recommended)
sudo ./builder/deploy-usb.sh --verify /dev/sdb

# Deploy custom ISO
sudo ./builder/deploy-usb.sh /dev/sdb path/to/custom.iso

# Force mode (skip confirmation)
sudo ./builder/deploy-usb.sh --force /dev/sdb
```

### Using Make

```bash
# List USB devices
make list-usb

# Deploy to USB
make deploy-usb USB=/dev/sdb

# Deploy with verification
make deploy-usb USB=/dev/sdb VERIFY=1
```

### What the Script Does

1. **Unmount**: Detaches all partitions from the file manager
2. **Wipe Signatures**: Removes MBR/GPT/filesystem signatures that confuse Windows
3. **Write ISO**: Uses `dd` with `conv=fsync oflag=direct` for true hardware sync
4. **Final Sync**: Ensures all data is physically written before reporting success
5. **Verify** (optional): Compares checksums to catch bad USB drives

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Device does not exist" | Check device path with `lsblk` |
| "Permission denied" | Run with `sudo` |
| "Device is too small" | Use a larger USB drive (min: ISO size + 10%) |
| Verification fails | USB drive may be faulty, try a different one |

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000058 - Complete Vision](./000058-quantix-os-complete-vision.md)
- [000060 - Network and GUI Setup](./000060-network-and-gui-setup.md)
