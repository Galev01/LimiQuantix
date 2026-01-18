# Quantix-OS Installer Boot Validation

**Document ID:** 000085  
**Date:** January 18, 2026  
**Scope:** Quantix-OS installer bootloader and initramfs validation

## Summary

This document covers the fixes that prevent "successful" installs from boot
looping due to missing GRUB packages, missing `BOOTX64.EFI`, or wrong initramfs.

## Symptoms

### Problem 1: No bootable device
- Installer reports success, but firmware shows "no bootable device."
- `/mnt/install/efi/EFI` is missing or empty during post-install checks.
- ESP does not contain `EFI/BOOT/BOOTX64.EFI`.
- Error in log: `grub-install: not found`

### Problem 2: Initramfs mount failure
- GRUB boots successfully, shows Quantix-OS menu.
- Error during boot: `mount: mounting /dev/nvme0n1p2 on /sysroot failed: No such file or directory`
- System drops to initramfs emergency shell.

## Root Causes

### Problem 1: Missing GRUB packages
The `grub` and `grub-efi` packages were missing from the live Quantix-OS ISO.
Without these packages, the installer cannot run `grub-install` to create
the UEFI bootloader, leaving the ESP empty and the system unbootable.

### Problem 2: Wrong initramfs
The installer was extracting the **Alpine initramfs from inside the squashfs**
(`/tmp/sqmount/boot/initramfs-lts`), but this is the standard Alpine initramfs
that expects a normal root filesystem.

Quantix-OS requires the **custom Quantix-OS initramfs** (built by
`build-initramfs.sh`) which knows how to:
1. Find and mount the squashfs at `/mnt/system/quantix/system.squashfs`
2. Set up an overlay filesystem for writable root
3. Mount config and data partitions
4. Switch to the overlayed root

The custom initramfs is on the **live ISO at `/boot/initramfs`**, not inside
the squashfs.

## Fixes Applied

### 1. Added Required Packages

Added to `Quantix-OS/profiles/quantix/packages.conf`:
```
# Bootloader (required for installer to set up UEFI boot)
grub
grub-efi
```

### 2. Improved Installer Fallback Mechanisms

The installer now:
- **Checks if `grub-install` is available** before attempting to run it
- **Tries multiple fallback locations** to copy a pre-existing GRUB EFI binary
- **Uses `grub-mkimage` as last resort** to generate a standalone EFI binary
- **Provides clear error messages** if BOOTX64.EFI cannot be created

### 3. ESP Mount Validation

Before installing the bootloader:
- Verify the ESP is mounted at `${TARGET_MOUNT}/efi`
- Verify the ESP is writable
- Create `EFI/BOOT` and `EFI/quantix` directories

### 4. Fail-Fast Enforcement

If `EFI/` or `BOOTX64.EFI` cannot be created, the installer now provides
detailed troubleshooting steps instead of falsely reporting success.

### 5. Fixed Initramfs Copying (Problem 2)

The installer now copies the **custom Quantix-OS initramfs** from the live ISO
boot media instead of extracting the Alpine initramfs from the squashfs:

```sh
# Search for Quantix-OS initramfs on boot media:
# 1. /mnt/cdrom/boot/initramfs (boot media still mounted)
# 2. /mnt/iso/boot/initramfs (alternative mount point)
# 3. /cdrom/boot/initramfs
# 4. /boot/initramfs

# Only fall back to squashfs as last resort (with warning)
```

This ensures the installed system has the initramfs that knows how to:
- Mount the squashfs from `/mnt/system/quantix/system.squashfs`
- Create an overlay filesystem
- Mount config and data partitions by label
- Switch to the overlayed root

## Verification Steps (Installer Shell)

Run these before reboot:
```sh
# Check if GRUB packages are installed
apk info | grep grub

# Check EFI partition contents
mount | grep /mnt/install/efi
ls -la /mnt/install/efi
ls -la /mnt/install/efi/EFI/BOOT

# Check grub-install output
cat /tmp/install.log.grub
```

Expected:
- `apk info` shows `grub-2.x` and `grub-efi-2.x`
- `EFI/BOOT/BOOTX64.EFI` exists
- `EFI/quantix/grubx64.efi` exists (optional but preferred)

## Troubleshooting

### BOOTX64.EFI missing

1. **Check if grub packages are installed:**
   ```sh
   apk info | grep grub
   ```
   If empty, the ISO needs to be rebuilt with grub packages.

2. **Check grub-install output:**
   ```sh
   cat /tmp/install.log.grub
   ```

3. **Manually copy EFI binary from live ISO:**
   ```sh
   cp /mnt/cdrom/EFI/BOOT/BOOTX64.EFI /mnt/install/efi/EFI/BOOT/
   ```

### Initramfs mount failure

If you see `mount: mounting /dev/nvme0n1p2 on /sysroot failed: No such file or directory`:

1. **Check which initramfs was installed:**
   ```sh
   # From installer shell, check initramfs size
   ls -lh /mnt/install/system/boot/initramfs
   ```
   - Quantix-OS initramfs: ~50-100MB (includes kernel modules)
   - Alpine initramfs: ~5-10MB (minimal)

2. **Check if boot media is still mounted:**
   ```sh
   mount | grep cdrom
   ls -la /mnt/cdrom/boot/
   ```

3. **Manually copy correct initramfs:**
   ```sh
   # From installer shell
   cp /mnt/cdrom/boot/initramfs /mnt/install/system/boot/initramfs
   ```

4. **If boot media was unmounted, remount it:**
   ```sh
   mount /dev/sr0 /mnt/cdrom   # CD-ROM
   # or
   mount /dev/sda1 /mnt/cdrom  # USB
   ```

## Additional Fixes for Server Hardware

### Problem 3: XFS Label Too Long

**Symptom:** `Invalid value local-nvme1n1 for -L option`

**Root Cause:** XFS labels have a 12-character maximum. Pool names like `local-nvme1n1`
(13 characters) exceed this limit.

**Fixes Applied:**
1. Installer now truncates pool names to 12 characters for XFS label
2. TUI generates shorter default names: `SSD-local01` instead of `local-nvme0n1`
3. TUI warns user if entered name exceeds 12 characters
4. Full pool name is preserved for config files and mount points

### Problem 4: Inconsistent Partition Detection

**Symptom:** Installation sometimes fails, sometimes succeeds (race condition)

**Root Cause:** Server hardware (especially with RAID controllers or multiple NVMe
drives) may need more time for kernel to recognize new partitions.

**Fixes Applied:**
1. Increased retry attempts from 5 to 10 for main disk partitions
2. Increased retry attempts from 5 to 10 for storage pool partitions
3. Added exponential backoff (longer waits on later attempts)
4. Added explicit verification of all 5 partitions before proceeding
5. Storage pool failures no longer break the entire installation

## Files Changed

- `Quantix-OS/profiles/quantix/packages.conf` - Added grub packages
- `Quantix-OS/installer/install.sh` - Fixed bootloader, initramfs, XFS labels, retries
- `Quantix-OS/installer/tui.sh` - Shorter default pool names, length validation

## References

- `docs/Quantix-OS/000084-installer-failure-debugging.md` - Related debugging docs
- `Quantix-OS/builder/build-initramfs.sh` - Custom initramfs build script
- `Quantix-OS/initramfs/init` - Initramfs init script
