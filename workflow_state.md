# Workflow State

## Active Task: Quantix-OS Installer Robustness

**Date:** January 18, 2026

### Problems Fixed
1. ~~`grub-install: not found`~~ - Added grub packages
2. ~~Wrong initramfs~~ - Now copies from live ISO instead of squashfs
3. ~~XFS label too long~~ - Truncate to 12 chars, better default names
4. ~~Inconsistent partition detection in installer~~ - Increased retries, better error handling
5. ~~`findfs` not finding partitions~~ - Added multi-method partition finder in initramfs

### Changes Made

#### 1. GRUB Packages
- Added `grub` and `grub-efi` to `profiles/quantix/packages.conf`

#### 2. Initramfs Fix
- Installer now copies initramfs from `/mnt/cdrom/boot/initramfs` (live ISO)
- Falls back to squashfs only as last resort (with warning)

#### 3. XFS Label Fix
- XFS labels have 12-character maximum
- Pool names are now truncated for XFS label (full name kept for config/mount)
- TUI generates shorter default names: `SSD-local01` instead of `local-nvme0n1`
- TUI warns user if name is too long

#### 4. Partition Detection Robustness (Installer)
- Increased retry attempts from 5 to 10 for main disk
- Increased retry attempts from 5 to 10 for storage pools
- Added exponential backoff for server hardware
- Added explicit verification of all partitions before proceeding
- Storage pool failures no longer break the entire installation

#### 5. Partition Detection Robustness (Initramfs)
- Added `find_partition_by_label()` helper function
- Uses 4 methods: findfs, blkid -L, blkid grep, /dev/disk/by-label
- Retry loop with mdev rescan for server hardware
- Increased retries from 5 to 10 for system partition
- Applied to system, config, and data partition detection

### Next Steps
Rebuild ISO and test:
```bash
cd ~/LimiQuantix/Quantix-OS
sudo make clean && sudo make iso
```
