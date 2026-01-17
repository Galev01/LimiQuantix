## Quantix-OS Installer Failure Debugging

**Document ID:** 000084  
**Date:** January 17, 2026  
**Scope:** Quantix-OS installer troubleshooting and diagnostics

### Summary
This document captures the debugging workflow and fixes for silent installer failures
that occur after partition creation. The main issue was the installer exiting without
clear error output, compounded by incorrect partition resolution on some devices.

### Symptoms
- Installer exits after partitioning with "Installation Failed."
- No actionable error message in the TUI.
- `dmesg` shows `XFS: Invalid superblock magic number` on a system partition.
- Installer loop repeats multiple times.

### Root Causes
1. **Aggressive process killing** during unmount attempts could terminate PID 1.
2. **Partition resolution by index** (`/dev/nvme0n1p5`) was unreliable when device
   enumeration differed, leading to XFS mounts on non-XFS partitions.
3. **No error trap** for failed commands, leaving no line-level context in logs.

### Fixes Applied
- **Removed `fuser -km`** from partition unmounting to avoid killing init.
- **Resolved partitions by PARTLABEL** using `lsblk` to ensure correct mapping:
  - `EFI`, `QUANTIX-A`, `QUANTIX-B`, `QUANTIX-CFG`, `QUANTIX-DATA`
- **Explicit filesystem mounts** to surface errors early:
  - `ext4` for A/B and config
  - `vfat` for EFI
  - `xfs` for data
- **Error trap with diagnostics** to capture the failing line and dump:
  - `blkid`
  - `lsblk`
  - `dmesg`
- **Bootloader hardening** to ensure a valid EFI binary and GRUB config are
  always written to the ESP (`EFI/BOOT/BOOTX64.EFI` + `EFI/BOOT/grub.cfg`).

### Troubleshooting Steps
1. Drop to shell when prompted after failure.
2. Inspect the log:
   ```sh
   cat /tmp/install.log
   ```
3. Verify partitions and filesystems:
   ```sh
   lsblk -o NAME,PATH,PARTLABEL,FSTYPE,SIZE,MOUNTPOINT
   blkid
   ```
4. Inspect recent kernel errors:
   ```sh
   dmesg | tail -n 120
   ```

### Related Docs
- `docs/Quantix-OS/000051-quantix-os-logging-diagnostics.md`
- `docs/Quantix-OS/000079-installer-xfs-troubleshooting.md`
