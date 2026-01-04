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
┌───────────────────────────────────────────────────────────┐
│  LOCAL CONSOLE (TTY1)          │  REMOTE (Web Browser)   │
│  ┌──────────────────────────┐  │  ┌──────────────────┐   │
│  │  Slint Console GUI       │  │  │ Quantix Host UI  │   │
│  │  - First boot wizard     │  │  │ https://<ip>:8443│   │
│  │  - Network config        │  │  │                  │   │
│  │  - SSH enable/disable    │  │  │ - VM management  │   │
│  │  - Emergency shell       │  │  │ - Storage pools  │   │
│  └──────────────────────────┘  │  │ - Performance    │   │
│                                │  └──────────────────┘   │
└───────────────────────────────────────────────────────────┘
                    │
                    └───> SSH: Disabled by default
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
│   ├── Dockerfile.rust-gui     # Slint GUI builder (Alpine + Rust)
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
│   ├── usr/
│   │   ├── bin/
│   │   │   ├── qx-node            # Node daemon binary
│   │   │   ├── qx-console-gui     # Slint console GUI
│   │   │   └── qx-update          # Update utility
│   │   ├── local/bin/
│   │   │   ├── qx-console         # TUI console (fallback)
│   │   │   └── qx-console-launcher# Console launcher script
│   │   └── share/quantix/
│   │       └── webui/             # ← Host UI (React) build output
│   │           ├── index.html
│   │           └── assets/
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
├── console-gui/                # Slint Console GUI
│   ├── Cargo.toml
│   ├── ui/main.slint
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

../quantix-host-ui/             # Host UI (separate project)
├── package.json
├── src/
│   ├── App.tsx
│   ├── pages/
│   └── components/
└── dist/                       # → copied to overlay/usr/share/quantix/webui/
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

### Building the Console GUI

The console GUI uses Slint with multiple rendering backends for maximum compatibility:

```bash
# Build with all features (Slint + framebuffer fallback)
cd console-gui
make console-gui-binary
```

**Rendering Backend Priority:**
1. **LinuxKMS + GPU** (Slint with femtovg) - Best performance, requires DRM/KMS + GPU
2. **LinuxKMS + Software** (Slint with software renderer) - Works without GPU
3. **Raw Framebuffer** (embedded-graphics) - Fallback for VGA-only VMs, renders to `/dev/fb0`
4. **TUI** - Terminal-based fallback

The framebuffer fallback is useful for:
- VMs running with basic VGA (no virtio-gpu)
- Systems with broken DRM/KMS
- Legacy hardware without proper GPU drivers

To test framebuffer mode manually:
```bash
qx-console-gui --framebuffer
```

### Running Quantix-OS in a VM (Graphics Requirements)

When testing Quantix-OS in a virtual machine, you must configure a graphics device that the console GUI can use. The GUI requires either:

1. **DRM/KMS device** (`/dev/dri/card*`) - for Slint LinuxKMS backend
2. **Framebuffer device** (`/dev/fb0`) - for raw framebuffer fallback
3. **Terminal only** - TUI works without any graphics device

**Recommended QEMU Graphics Options:**

```bash
# Best: virtio-gpu (modern, GPU-accelerated)
qemu-system-x86_64 -device virtio-vga-gl -display gtk,gl=on ...

# Good: virtio-gpu without GL (software rendering)
qemu-system-x86_64 -device virtio-vga -display gtk ...

# Fallback: Standard VGA (creates /dev/fb0)
qemu-system-x86_64 -vga std ...

# Headless: Serial console only (TUI fallback)
qemu-system-x86_64 -nographic -serial mon:stdio ...
```

**Complete Example (Testing with QEMU):**

```bash
qemu-system-x86_64 \
    -name "Quantix-OS Test" \
    -machine q35,accel=kvm \
    -cpu host \
    -m 4G \
    -smp 4 \
    -device virtio-vga-gl \
    -display gtk,gl=on \
    -boot d \
    -cdrom output/quantix-os-1.0.0.iso \
    -drive file=test-disk.qcow2,if=virtio,format=qcow2
```

**Libvirt/virt-manager Configuration:**

In virt-manager, set the video device to one of:
- **Virtio** (recommended) - Modern GPU with 3D acceleration
- **VGA** - Legacy VGA, creates `/dev/fb0`
- **QXL** - For SPICE, but may not create framebuffer

**Troubleshooting GUI Fallback:**

If the GUI console fails and falls back to TUI, check:

1. **GRUB boot option**: Ensure you're NOT using "No KMS - Legacy" which disables DRM
2. **Kernel modules**: In the VM, verify DRM modules are loaded:
   ```bash
   lsmod | grep -E 'drm|virtio_gpu|simpledrm'
   ```
3. **Device nodes**: Check for graphics devices:
   ```bash
   ls -la /dev/dri/    # Should show card0, renderD128
   ls -la /dev/fb0     # Should exist for framebuffer mode
   ```
4. **Console log**: Check `/run/quantix/console-launcher.log` for details

### Enabling Nested Virtualization (Required for VM Testing)

Quantix-OS is a hypervisor that uses KVM for hardware-accelerated virtualization. When testing Quantix-OS inside a VM (inception-style), you must enable **nested virtualization** on the host.

**Check if nested virtualization is enabled:**

```bash
# On Linux host
cat /sys/module/kvm_intel/parameters/nested  # Intel: should show "Y" or "1"
cat /sys/module/kvm_amd/parameters/nested    # AMD: should show "Y" or "1"
```

**Enable nested virtualization (Linux host):**

```bash
# Intel CPU
sudo modprobe -r kvm_intel
sudo modprobe kvm_intel nested=1
# Make permanent:
echo "options kvm_intel nested=1" | sudo tee /etc/modprobe.d/kvm-nested.conf

# AMD CPU
sudo modprobe -r kvm_amd
sudo modprobe kvm_amd nested=1
# Make permanent:
echo "options kvm_amd nested=1" | sudo tee /etc/modprobe.d/kvm-nested.conf
```

**Enable nested virtualization (virt-manager/libvirt):**

Edit the VM's XML or use virt-manager:
1. Set CPU mode to "host-passthrough"
2. Or add to the domain XML:
   ```xml
   <cpu mode='host-passthrough' check='none'/>
   ```

**Enable nested virtualization (VMware/VirtualBox):**

- **VMware**: Edit .vmx file, add `vhv.enable = "TRUE"`
- **VirtualBox**: Not fully supported, use Linux/KVM instead

**Symptoms of missing nested virtualization:**

- Boot hangs at "Starting libvirtd ..." for a long time
- libvirtd starts but VMs fail to launch
- Error: "KVM acceleration not available"
- `/dev/kvm` device doesn't exist inside the VM

**Workaround (no nested virt):**

If you can't enable nested virtualization, Quantix-OS will still boot but:
- libvirtd may timeout during startup (30 second delay)
- VMs will use QEMU TCG emulation (very slow, for testing only)
- The console and web UI will still work

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
