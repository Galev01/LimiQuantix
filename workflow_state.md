# Workflow State

## Quantix-OS Installer XFS Superblock Fix

### Status: COMPLETED

### Goal
Eliminate `XFS ... Invalid superblock magic number` after installation by
ensuring stale filesystem signatures are wiped and the correct data partition
is created and verified.

### Root Cause
The error `XFS (nvme0n1p3): Invalid superblock magic number` occurred because:
1. Previous installation left XFS metadata on the disk
2. New partition boundaries overlapped old XFS superblock locations
3. Kernel's XFS driver probed and found stale metadata, causing errors

### Solution Applied
Updated `Quantix-OS/installer/install.sh` with:

1. **Aggressive disk wiping** (Step 1):
   - Added `sgdisk --zap-all` for complete GPT table destruction
   - Extended `dd` zeroing from 1MB to 10MB at disk start and end
   - Added verification that disk is clean before partitioning

2. **Better kernel synchronization**:
   - Added `blockdev --rereadpt` after partitioning
   - Added `mdev -s` trigger for device re-detection
   - Added double `partprobe` calls with delays

3. **Per-partition wiping** (Step 2):
   - Wipe each partition with `wipefs -a --force`
   - Zero first 10MB of each partition with `dd` before formatting
   - This ensures no stale XFS/ext4 superblocks remain

4. **Enhanced logging**:
   - All operations logged to `/tmp/install.log`
   - Detailed blkid output for debugging
   - Better error messages with partition device paths

### Log
- 2026-01-16: Initial wipefs + GPT header wipe
- 2026-01-16: Added sgdisk --zap-all and 10MB zeroing
- 2026-01-16: Added per-partition dd zeroing before mkfs
- 2026-01-16: Added blockdev --rereadpt and enhanced logging

### Testing
After rebuilding the ISO, test installation on:
1. QEMU with NVMe disk (previous XFS data)
2. Physical hardware with prior Quantix install
3. Verify no XFS superblock errors in dmesg after boot

### References
- `Quantix-OS/installer/install.sh`
- `docs/Quantix-OS/000057-installer-storage-pool-configuration.md`
