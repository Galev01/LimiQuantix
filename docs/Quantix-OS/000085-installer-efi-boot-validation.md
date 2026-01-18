# Quantix-OS Installer EFI Boot Validation

**Document ID:** 000085  
**Date:** January 18, 2026  
**Scope:** Quantix-OS installer EFI bootloader validation

## Summary

This document covers the fixes that prevent "successful" installs from boot
looping due to missing GRUB packages or a missing `BOOTX64.EFI` on the ESP.

## Symptoms

- Installer reports success, but firmware shows "no bootable device."
- `/mnt/install/efi/EFI` is missing or empty during post-install checks.
- ESP does not contain `EFI/BOOT/BOOTX64.EFI`.
- Error in log: `grub-install: not found`

## Root Cause

The `grub` and `grub-efi` packages were missing from the live Quantix-OS ISO.
Without these packages, the installer cannot run `grub-install` to create
the UEFI bootloader, leaving the ESP empty and the system unbootable.

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

If `BOOTX64.EFI` is missing:

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

## Files Changed

- `Quantix-OS/profiles/quantix/packages.conf` - Added grub packages
- `Quantix-OS/installer/install.sh` - Improved bootloader installation

## References

- `docs/Quantix-OS/000084-installer-failure-debugging.md` - Related debugging docs
