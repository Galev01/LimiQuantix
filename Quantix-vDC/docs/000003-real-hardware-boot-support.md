# Real Hardware Boot Support

**Document Number:** 000003  
**Created:** 2026-01-09  
**Last Updated:** 2026-01-09  
**Status:** Complete  
**Related:** 000001-tui-installer-boot-system.md, 000002-tui-installer-bug-fixes.md

---

## Overview

Quantix-vDC was initially designed for VM deployment but requires additional drivers and firmware packages to boot on real hardware. This document describes the additions made to support bare-metal installation.

---

## Problem

When booting from ISO on real hardware (laptop), the system would freeze immediately after:

```
EFI stub: Loaded initrd from LINUX_EFI_INITRD_MEDIA_GUID device path
```

The system would hang with no further output.

---

## Root Cause

The freeze was caused by:

1. **Missing Firmware Packages** - Real hardware requires CPU/GPU/NIC firmware blobs
2. **Missing Graphics Drivers** - The kernel couldn't initialize the framebuffer
3. **No Safe Mode Option** - Users with problematic GPUs had no fallback

---

## Solution

### 1. Added Firmware Packages

Updated `profiles/packages.conf` to include:

```bash
# Kernel & Firmware (ESSENTIAL for real hardware boot)
linux-lts
linux-firmware           # Base firmware blobs
linux-firmware-intel     # Intel CPU/GPU microcode
linux-firmware-amd       # AMD CPU/GPU microcode  
linux-firmware-nvidia    # NVIDIA GPU firmware
linux-firmware-bnx2      # Broadcom NetXtreme II
linux-firmware-bnx2x     # Broadcom NetXtreme II 10G
```

**Why These Packages:**

| Package                 | Purpose                                        |
| ----------------------- | ---------------------------------------------- |
| `linux-firmware`        | Base set of firmware blobs for common hardware |
| `linux-firmware-intel`  | Intel i915 GPU, CPU microcode, WiFi (iwlwifi)  |
| `linux-firmware-amd`    | AMD GPU (amdgpu), CPU microcode                |
| `linux-firmware-nvidia` | NVIDIA GPU firmware (nouveau driver)           |
| `linux-firmware-bnx2`   | Broadcom Gigabit NICs                          |
| `linux-firmware-bnx2x`  | Broadcom 10G NICs                              |

### 2. Added Graphics Driver Loading

Updated `builder/build-installer-initramfs.sh` to load graphics modules:

```bash
# Graphics/Framebuffer (CRITICAL for real hardware display)
log "Loading graphics drivers..."
for mod in efifb vesafb simplefb drm drm_kms_helper i915 nouveau amdgpu radeon; do
    modprobe $mod >/dev/null 2>&1 || true
done
```

**Module Descriptions:**

| Module           | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `efifb`          | EFI framebuffer (UEFI firmware display)  |
| `vesafb`         | VESA framebuffer (legacy BIOS display)   |
| `simplefb`       | Simple framebuffer (fallback)            |
| `drm`            | Direct Rendering Manager (core graphics) |
| `drm_kms_helper` | Kernel Mode Setting helper               |
| `i915`           | Intel integrated graphics                |
| `nouveau`        | NVIDIA open-source driver                |
| `amdgpu`         | AMD GPU driver                           |
| `radeon`         | Legacy AMD/ATI driver                    |

### 3. Added Safe Graphics Boot Option

Updated GRUB menu in `builder/build-iso.sh`:

```grub
menuentry "Install Quantix-vDC (Safe Graphics)" {
    linux /boot/vmlinuz boot=installer nomodeset console=tty0 console=ttyS0,115200
    initrd /boot/initramfs
}
```

The `nomodeset` parameter tells the kernel to:
- Not load GPU-specific drivers
- Use generic BIOS/EFI framebuffer
- Disable kernel mode setting (KMS)

---

## GRUB Boot Menu Options

After rebuild, the boot menu will show:

| Option                              | Description                                |
| ----------------------------------- | ------------------------------------------ |
| Install Quantix-vDC                 | Normal boot with all drivers               |
| Install Quantix-vDC (Safe Graphics) | Boot with `nomodeset` for problematic GPUs |
| Install Quantix-vDC (Debug Mode)    | Verbose logging for troubleshooting        |
| Rescue Shell (Emergency)            | Drop to shell before pivot_root            |
| Reboot                              | Restart the system                         |
| Power Off                           | Shut down                                  |

---

## Testing on Real Hardware

### Recommended Test Process

1. **First Attempt:** Try normal "Install Quantix-vDC" option
2. **If Screen Freezes:** Reboot and select "Safe Graphics" mode
3. **If Still Frozen:** Try "Debug Mode" to see where it stops
4. **Emergency Access:** Use "Rescue Shell" to drop to initramfs shell

### Known Problematic Hardware

| Hardware            | Issue                  | Solution               |
| ------------------- | ---------------------- | ---------------------- |
| Some NVIDIA laptops | Hybrid graphics freeze | Use Safe Graphics mode |
| Very old Intel GPUs | Driver compatibility   | Use Safe Graphics mode |
| Some AMD APUs       | Early KMS issues       | Use Safe Graphics mode |

---

## Rebuild and Deploy

```bash
# Clean previous build
cd ~/LimiQuantix/Quantix-vDC
make clean

# Rebuild ISO with firmware
make iso

# Write to USB
sudo dd if=output/quantix-vdc-1.0.0.iso of=/dev/sdX bs=4M status=progress
sync
```

---

## Files Modified

| File                                   | Changes                         |
| -------------------------------------- | ------------------------------- |
| `profiles/packages.conf`               | Added firmware packages         |
| `builder/build-installer-initramfs.sh` | Added graphics driver loading   |
| `builder/build-iso.sh`                 | Added Safe Graphics boot option |

---

## Comparison with Quantix-OS

Quantix-OS (the hypervisor node) had the same issue and was fixed by adding identical firmware packages. Both systems now share the same hardware support approach:

- Full firmware packages for real hardware
- Graphics driver pre-loading in initramfs
- Safe Graphics fallback option

---

## Additional Hardware Support

If you encounter hardware that still doesn't work, consider adding:

### Network Drivers
```bash
# In initramfs init script
for mod in e1000 e1000e igb ixgbe r8169 realtek atlantic iwlwifi ath9k ath10k_pci; do
    modprobe $mod >/dev/null 2>&1 || true
done
```

### Storage Controllers
```bash
# Already included, but verify these are loading:
modprobe megaraid_sas    # Dell/HP servers
modprobe mpt3sas         # LSI SAS controllers
modprobe hpsa            # HP Smart Array
```

### Firmware Packages
```bash
# Add to packages.conf if needed:
linux-firmware-mellanox  # Mellanox NICs
linux-firmware-other     # Misc hardware
```

---

## Post-Installation Boot Fix

### Problem: "Mounting root failed" After Installation

After successful installation and reboot, the system may fail with:

```
mount: mounting /dev/nvme0n1p2 on /sysroot failed: No such file or directory
Mounting root failed.
initramfs emergency recovery shell launched.
```

### Cause

Alpine's stock `initramfs-lts` may not include NVMe drivers by default. The installation process must regenerate the initramfs with proper hardware support.

### Solution

The installer now:

1. **Creates `/etc/mkinitfs/mkinitfs.conf`** with required features:
   ```
   features="ata base cdrom ext4 keymap kms mmc nvme scsi usb virtio"
   ```

2. **Runs `mkinitfs`** to regenerate the initramfs with these modules

3. **Requires `mkinitfs` package** in the rootfs (added to `packages.conf`)

### Features Explained

| Feature  | Purpose                        |
| -------- | ------------------------------ |
| `ata`    | SATA/AHCI disk drivers         |
| `base`   | Core initramfs functionality   |
| `cdrom`  | CD/DVD boot support            |
| `ext4`   | ext4 filesystem support        |
| `keymap` | Keyboard layout support        |
| `kms`    | Kernel Mode Setting (graphics) |
| `mmc`    | SD card/eMMC support           |
| `nvme`   | NVMe SSD drivers               |
| `scsi`   | SCSI disk drivers              |
| `usb`    | USB device support             |
| `virtio` | VirtIO drivers (QEMU/KVM)      |

### Manual Fix (If Already Installed)

If you have an installed system that won't boot:

1. Boot from the installation ISO
2. Select "Rescue Shell (Emergency)"
3. Mount the installed system:
   ```bash
   mount /dev/nvme0n1p2 /mnt
   mount --bind /dev /mnt/dev
   mount --bind /proc /mnt/proc
   mount --bind /sys /mnt/sys
   ```
4. Regenerate initramfs:
   ```bash
   chroot /mnt
   echo 'features="ata base cdrom ext4 keymap kms mmc nvme scsi usb virtio"' > /etc/mkinitfs/mkinitfs.conf
   mkinitfs $(ls /lib/modules | head -1)
   exit
   ```
5. Reboot:
   ```bash
   umount -R /mnt
   reboot
   ```
