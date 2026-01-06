# 000059 - Quantix-OS Build Guide

**Description:** Complete guide for building Quantix-OS from source, including all components (Alpine rootfs, Slint console GUI, TUI fallback, Host UI integration).

**Last Updated:** January 6, 2026

---

## Overview

This document provides step-by-step instructions for building Quantix-OS, a custom immutable hypervisor operating system based on Alpine Linux.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| Docker | 20.10+ | Build environment isolation |
| Git | 2.0+ | Source control |
| Make | 4.0+ | Build orchestration |

### Optional (for local development)

| Software | Version | Purpose |
|----------|---------|---------|
| Rust | 1.75+ | Console GUI/TUI development |
| Node.js | 18+ | Host UI development |
| QEMU | 8.0+ | Testing |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/Quantix-KVM/LimiQuantix.git
cd LimiQuantix/limiquantix-os

# Build the complete ISO
make iso

# Test in QEMU
make test-qemu
```

## Build Targets

### Full ISO Build

```bash
make iso
```

This builds:
1. Docker build environment
2. Alpine rootfs with virtualization stack
3. Slint console GUI (in Alpine container)
4. Ratatui TUI fallback
5. Host UI web interface
6. Node daemon
7. Bootable ISO with GRUB (UEFI + BIOS)

Output: `output/quantix-os-1.0.0.iso`

### Individual Components

```bash
# Build just the squashfs rootfs
make squashfs

# Build just the Slint GUI console
make console-gui

# Build just the TUI console
make console-tui

# Build just the Host UI
make host-ui

# Build just the node daemon
make node-daemon
```

## Directory Structure

```
limiquantix-os/
├── Makefile                    # Build orchestration
├── README.md                   # Project overview
├── TESTING.md                  # Testing guide
│
├── builder/                    # Docker build scripts
│   ├── Dockerfile              # Alpine build environment
│   ├── Dockerfile.rust-gui     # Slint GUI builder
│   ├── Dockerfile.rust-tui     # TUI builder
│   ├── build-squashfs.sh       # Rootfs builder
│   ├── build-initramfs.sh      # Initramfs builder
│   ├── build-iso.sh            # ISO builder
│   ├── build-host-ui.sh        # Host UI builder
│   └── build-node-daemon.sh    # Node daemon builder
│
├── profiles/quantix/           # System configuration
│   ├── packages.conf           # APK packages to install
│   ├── mkinitfs.conf           # Initramfs configuration
│   └── kernel-modules.conf     # Kernel modules to load
│
├── overlay/                    # Files copied to rootfs
│   ├── etc/
│   │   ├── inittab             # TTY configuration
│   │   ├── fstab               # Filesystem mounts
│   │   ├── init.d/             # OpenRC services
│   │   ├── local.d/            # Early init scripts
│   │   └── quantix/            # Default configuration
│   └── usr/
│       ├── bin/                # Binaries (qx-node)
│       ├── local/bin/          # Scripts (launcher)
│       └── share/quantix-host-ui/  # Web UI
│
├── grub/                       # GRUB configuration
│   └── grub.cfg                # Boot menu
│
├── initramfs/                  # Custom initramfs
│   └── init                    # Init script
│
├── installer/                  # Installation scripts
│   ├── install.sh              # Disk installer
│   └── firstboot.sh            # First-boot setup
│
├── console-gui/                # Slint GUI (Rust)
│   ├── Cargo.toml
│   ├── build.rs
│   ├── src/
│   │   ├── main.rs
│   │   ├── auth.rs
│   │   ├── config.rs
│   │   ├── network.rs
│   │   ├── ssh.rs
│   │   └── system_info.rs
│   └── ui/
│       └── main.slint
│
├── console-tui/                # Ratatui TUI (Rust)
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── auth.rs
│       └── config.rs
│
├── branding/                   # ASCII art, logos
│   ├── banner.txt
│   └── splash.txt
│
└── output/                     # Build artifacts
    ├── quantix-os-1.0.0.iso
    └── system-1.0.0.squashfs
```

## Build Process Details

### Phase 1: Docker Environment

The build uses Docker containers for reproducibility:

```bash
# Build the base builder image
docker build -t quantix-builder -f builder/Dockerfile builder/

# Build the Rust GUI builder image
docker build -t quantix-rust-gui-builder -f builder/Dockerfile.rust-gui builder/
```

### Phase 2: Alpine Rootfs

The squashfs builder:

1. Creates Alpine rootfs via `apk --root`
2. Installs packages from `profiles/quantix/packages.conf`
3. Applies overlay files
4. Configures OpenRC services
5. Removes APK cache
6. Creates squashfs with XZ compression

```bash
docker run --rm --privileged \
    -v $(pwd):/work \
    -v $(pwd)/output:/output \
    quantix-builder \
    ./builder/build-squashfs.sh
```

### Phase 3: Console GUI

The Slint GUI must be built in an Alpine container for musl compatibility:

```bash
docker run --rm \
    -v $(pwd)/console-gui:/build \
    quantix-rust-gui-builder \
    cargo build --release --no-default-features --features linuxkms
```

Key features:
- `desktop` feature: Development mode (winit + femtovg)
- `linuxkms` feature: Production mode (direct framebuffer)

### Phase 4: ISO Creation

The ISO builder:

1. Creates ISO9660 directory structure
2. Copies kernel, initramfs, squashfs
3. Creates GRUB configuration
4. Generates UEFI boot image
5. Generates BIOS boot image
6. Creates hybrid ISO with xorriso

## Customization

### Adding Packages

Edit `profiles/quantix/packages.conf`:

```bash
# Add your package
my-custom-package
```

### Changing Boot Menu

Edit `grub/grub.cfg`:

```grub
menuentry "My Custom Entry" {
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro quiet
    initrd /boot/initramfs
}
```

### Modifying Console GUI

Edit `console-gui/ui/main.slint` for UI changes.

Edit `console-gui/src/*.rs` for backend logic.

### Adding Services

Create a new OpenRC script in `overlay/etc/init.d/`:

```bash
#!/sbin/openrc-run
name="My Service"
command="/usr/bin/my-service"
command_background="yes"
pidfile="/run/my-service.pid"

depend() {
    need net
}
```

## Testing

### QEMU (Quick Test)

```bash
make test-qemu        # BIOS mode
make test-qemu-uefi   # UEFI mode
```

### QEMU with Virtual Disk

```bash
make test-qemu-install
```

### Physical Hardware

```bash
# Create bootable USB
sudo dd if=output/quantix-os-1.0.0.iso of=/dev/sdX bs=4M status=progress
```

See `TESTING.md` for detailed testing instructions.

## Troubleshooting

### Build Fails: "Permission denied"

Run with sudo or ensure Docker is configured for rootless mode.

### Build Fails: "Package not found"

Some packages may not be available in Alpine. Check Alpine package repository.

### GUI Doesn't Render

Ensure the LinuxKMS backend has access to `/dev/dri/card0`.

### ISO Won't Boot

Check UEFI/BIOS settings. Try both boot modes.

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000053 - Console GUI (Slint)](./000053-console-gui-slint.md)
- [000058 - Complete Vision](./000058-quantix-os-complete-vision.md)
