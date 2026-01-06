# Quantix-OS Testing Guide

This document provides instructions for testing Quantix-OS on various platforms.

## Quick Start

```bash
# Build the ISO
make iso

# Test in QEMU (BIOS mode)
make test-qemu

# Test in QEMU (UEFI mode)
make test-qemu-uefi
```

## Hardware Requirements

### Minimum Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | x86_64 with VT-x/AMD-V | Intel Core i5 / AMD Ryzen 5 |
| RAM | 8 GB | 16+ GB |
| Storage | 64 GB SSD | 256+ GB NVMe |
| Network | 1x Gigabit Ethernet | 2x NICs |
| Display | VGA/HDMI output | For console GUI |

### BIOS/UEFI Settings

Before testing on physical hardware, ensure these settings are enabled:

1. **Virtualization Technology (VT-x/AMD-V)** - Required for KVM
2. **VT-d / IOMMU** - Required for device passthrough
3. **Secure Boot** - Can be disabled for testing (not yet supported)
4. **Boot Mode** - UEFI recommended, Legacy BIOS supported

## Testing Matrix

### Boot Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| UEFI Boot | Boot from USB on UEFI system | GRUB menu appears, system boots |
| Legacy Boot | Boot from USB on BIOS system | GRUB menu appears, system boots |
| Boot Time | Measure time from power-on to console | < 30 seconds |

### Installation Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Disk Detection | Installer detects target disk | All disks listed |
| Partitioning | Create A/B partition layout | 5 partitions created |
| GRUB Install | Install bootloader | System boots after install |
| First Boot | System boots after installation | Console wizard appears |

### Console GUI Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Wizard Step 1 | Enter hostname | Hostname saved |
| Wizard Step 2 | Create admin account | Password hashed, saved |
| Wizard Step 3 | Configure network | Interface selected |
| Wizard Step 4 | Complete setup | Main dashboard appears |
| Dashboard | View system status | CPU/Memory/VMs displayed |
| Menu Navigation | Use F-keys and arrows | Menu items selectable |
| Auth Dialog | Enter credentials | Login succeeds/fails |

### Network Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| DHCP | Automatic IP acquisition | IP assigned |
| Static IP | Manual IP configuration | IP configured |
| DNS | Resolve hostnames | DNS works |
| Web UI | Access https://ip:8443 | Host UI loads |

### SSH Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| SSH Disabled | Default state | SSH connection refused |
| Enable SSH | Toggle via console | SSH connection accepted |
| SSH Login | Login with admin credentials | Shell access |
| Disable SSH | Toggle via console | SSH connection refused |

### Virtualization Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| KVM Loaded | Check KVM module | `lsmod | grep kvm` shows modules |
| Libvirt | Check libvirtd | `virsh list` works |
| Create VM | Create test VM | VM created via virsh |
| Start VM | Start test VM | VM runs |
| Console | Access VM console | VNC/SPICE works |

### Persistence Tests

| Test | Description | Expected Result |
|------|-------------|-----------------|
| Config Survives Reboot | Reboot system | Settings preserved |
| Logs in RAM | Check /var/log | Logs cleared on reboot |
| VM Data | Create VM, reboot | VM still exists |

## Creating Bootable USB

### Linux

```bash
# Find your USB device
lsblk

# Write ISO to USB (replace /dev/sdX with your device)
sudo dd if=output/quantix-os-1.0.0.iso of=/dev/sdX bs=4M status=progress
sync
```

### Windows

Use [Rufus](https://rufus.ie/) or [balenaEtcher](https://www.balena.io/etcher/):

1. Download and run the tool
2. Select the Quantix-OS ISO
3. Select your USB drive
4. Click "Flash" / "Start"

### macOS

```bash
# Find your USB device
diskutil list

# Unmount the USB
diskutil unmountDisk /dev/diskN

# Write ISO (replace N with your disk number)
sudo dd if=output/quantix-os-1.0.0.iso of=/dev/rdiskN bs=4m
```

## QEMU Testing

### Basic BIOS Test

```bash
qemu-system-x86_64 \
    -enable-kvm \
    -m 4G \
    -cpu host \
    -smp 2 \
    -cdrom output/quantix-os-1.0.0.iso \
    -boot d \
    -display gtk \
    -vga virtio
```

### UEFI Test (requires OVMF)

```bash
# Install OVMF
# Ubuntu: sudo apt install ovmf
# Fedora: sudo dnf install edk2-ovmf

qemu-system-x86_64 \
    -enable-kvm \
    -m 4G \
    -cpu host \
    -smp 2 \
    -drive if=pflash,format=raw,readonly=on,file=/usr/share/OVMF/OVMF_CODE.fd \
    -cdrom output/quantix-os-1.0.0.iso \
    -boot d \
    -display gtk \
    -vga virtio
```

### Installer Test (with virtual disk)

```bash
# Create virtual disk
qemu-img create -f qcow2 test-disk.qcow2 50G

# Boot with disk attached
qemu-system-x86_64 \
    -enable-kvm \
    -m 4G \
    -cpu host \
    -smp 2 \
    -cdrom output/quantix-os-1.0.0.iso \
    -drive file=test-disk.qcow2,format=qcow2,if=virtio \
    -boot d \
    -display gtk \
    -vga virtio \
    -device virtio-net-pci,netdev=net0 \
    -netdev user,id=net0,hostfwd=tcp::8443-:8443
```

### Nested Virtualization Test

```bash
# Enable nested virtualization on host
# Intel: echo "options kvm_intel nested=1" | sudo tee /etc/modprobe.d/kvm.conf
# AMD: echo "options kvm_amd nested=1" | sudo tee /etc/modprobe.d/kvm.conf

qemu-system-x86_64 \
    -enable-kvm \
    -m 8G \
    -cpu host \
    -smp 4 \
    -drive file=test-disk.qcow2,format=qcow2,if=virtio \
    -display gtk \
    -vga virtio
```

## VMware Workstation Testing

1. Create new VM:
   - Guest OS: Other Linux 5.x (64-bit)
   - RAM: 4GB+
   - CPU: 2+ cores with virtualization
   - Disk: 50GB+
   
2. VM Settings:
   - Enable "Virtualize Intel VT-x/EPT"
   - Enable "Accelerate 3D graphics" (for GUI)
   
3. Boot from ISO

## Troubleshooting

### "Cannot find root device"

- Check that the ISO was written correctly
- Verify boot mode matches (UEFI vs Legacy)
- Try adding `rootdelay=5` to kernel parameters

### "No display output"

- Try different video output (VGA, HDMI, DisplayPort)
- Boot with `nomodeset` kernel parameter
- Check if GPU is supported

### "Network not working"

- Check cable connection
- Verify interface name in console
- Try DHCP vs static IP

### "SSH connection refused"

- Verify SSH is enabled in console
- Check firewall rules
- Verify IP address

### "VM creation fails"

- Check KVM modules: `lsmod | grep kvm`
- Verify virtualization in BIOS
- Check libvirtd status: `rc-service libvirtd status`

## Reporting Issues

When reporting issues, please include:

1. Hardware specifications
2. Boot mode (UEFI/Legacy)
3. Test that failed
4. Console output / screenshots
5. Contents of `/var/log/quantix-node.log`
