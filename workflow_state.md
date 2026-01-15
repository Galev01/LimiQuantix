# Workflow State

## Quantix-vDC Installer XFS Superblock Fix

### Status: COMPLETED

### Goal
Fix "XFS (nvme0n1p3): Invalid superblock magic number" error during Quantix-vDC installation by properly wiping stale filesystem signatures from previous OS installations.

### Root Cause Analysis
The error occurred because:
1. Previous OS installation left XFS superblocks on the disk
2. The old installer only wiped the first 34 sectors (GPT header), not filesystem metadata
3. Kernel auto-probed partitions and found stale XFS signatures, causing confusion
4. Partition 3 was being detected as XFS when it should be ext4

### Changes Made

#### `Quantix-vDC/installer/install.sh`
1. **Aggressive disk wiping** - Added multiple methods to ensure ALL old filesystem signatures are removed:
   - `sgdisk --zap-all` for thorough GPT wipe
   - `dd` to zero first 10MB (clears all superblocks at beginning)
   - `dd` to zero last 10MB (clears GPT backup and end-of-disk metadata)
   - `wipefs -a -f` to specifically remove filesystem signatures
   - Multiple `blockdev --rereadpt` and `partprobe` calls to sync kernel

2. **Post-partition signature wipe** - After creating partitions, wipe each partition's first 1MB before formatting:
   ```bash
   for part in "$PART1" "$PART2" "$PART3"; do
       wipefs -a -f "$part"
       dd if=/dev/zero of="$part" bs=1M count=1 conv=notrunc
   done
   ```

3. **Better partition detection** - Added support for mmcblk devices and wait loop with timeout:
   ```bash
   WAIT_COUNT=0
   while [ ! -b "$PART1" ] || [ ! -b "$PART2" ] || [ ! -b "$PART3" ]; do
       sleep 1
       WAIT_COUNT=$((WAIT_COUNT + 1))
       if [ $WAIT_COUNT -ge 10 ]; then
           log_error "Partitions did not appear after 10 seconds!"
           exit 1
       fi
       mdev -s
   done
   ```

4. **Enhanced logging** - Added partition info before/after formatting with blkid verification

5. **Better error handling** - Each mkfs command now properly checks return code and exits on failure

#### Files Updated
- `Quantix-vDC/installer/install.sh` - Main installer script
- `Quantix-vDC/overlay/installer/install.sh` - Overlay copy (synced)

### Testing Steps
1. Rebuild the ISO: `make iso` (in Quantix-vDC directory)
2. Boot from ISO on target hardware
3. Run installation through TUI
4. Verify no XFS errors in dmesg during/after installation
5. Reboot and verify system boots correctly

### Gemini's Suggestions Applied
| Suggestion | Applied |
|-----------|---------|
| Use sgdisk --zap-all | Yes |
| dd first 10MB of disk | Yes |
| blockdev --rereadpt after partitioning | Yes |
| wipefs on partitions after creation | Yes |
| Better logging to /tmp/install.log | Partial (inline logging improved) |
| Dynamic partition path detection | Yes (using lsblk-style approach) |

### References
- `Quantix-vDC/installer/install.sh`
- `Quantix-vDC/builder/build-iso.sh`
- `.cursor/rules/quantix-os.mdc`
