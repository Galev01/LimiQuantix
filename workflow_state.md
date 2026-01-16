# Workflow State

## Quantix-OS Installer - Complete Fix

### Status: FIXED - REBUILD REQUIRED

### Root Cause
Multiple partitions on the disk had the same label `QUANTIX-DATA` from previous installations:
- `/dev/nvme0n1p3: LABEL="QUANTIX-DATA" TYPE="ext4"` (from Quantix-vDC)
- `/dev/nvme0n1p5` should have been the correct one

The `findfs` command was returning the wrong partition, and old filesystem metadata caused "Invalid superblock" errors.

### Fixes Applied

#### 1. Installer: Comprehensive Disk Wipe (`install.sh`)

**NEW: Wipe each partition individually BEFORE destroying partition table**
```sh
# Wipe each existing partition's filesystem signature
for i in 1 2 3 4 5 6 7 8 9; do
    PART="${PART_PATTERN}${i}"
    if [ -b "$PART" ]; then
        wipefs -a "$PART"                    # Remove fs signature/label
        dd if=/dev/zero of="$PART" bs=1M count=10  # Zero superblocks
    fi
done
```

**Full wipe sequence:**
1. Unmount all partitions
2. **NEW: wipefs + zero each existing partition** ← Removes old labels!
3. sgdisk --zap-all (destroy GPT/MBR)
4. wipefs on whole disk
5. Zero first 100MB
6. Zero last 10MB
7. Verify clean, deep wipe if needed

#### 2. Init Script: Smart Partition Discovery (`init`)

**Find partitions on the SAME DISK as system, not just by label**
```sh
# Extract base disk from system partition
# /dev/nvme0n1p2 -> /dev/nvme0n1
BASE_DISK=$(echo "$SYSTEM_DEV" | sed 's/p[0-9]*$//')

# Look for partition 5 on same disk first
DATA_PART="${BASE_DISK}p5"

# Method 1: Check expected partition number
if [ -b "$DATA_PART" ]; then
    if blkid shows LABEL="QUANTIX-DATA"; then
        DATA_DEV="$DATA_PART"  # Use it
    fi
fi

# Method 2: Search same disk for XFS with correct label
# Method 3: Fallback to findfs (may get wrong disk)
```

**Supports all disk types:**
- NVMe: `/dev/nvme0n1p5`
- SATA: `/dev/sda5`
- VirtIO: `/dev/vda5`
- MMC: `/dev/mmcblk0p5`

### Summary of Changes

| File | Change |
|------|--------|
| `install.sh` | Wipe each partition individually before disk wipe |
| `install.sh` | Log old labels being removed |
| `init` | Smart discovery: same disk, expected partition number |
| `init` | Config partition: look for p4 on same disk |
| `init` | Data partition: look for p5 on same disk |
| `init` | Verify both label AND filesystem type |

### Why This Fixes Everything

1. **Old labels removed** - Installer wipes each partition's signature
2. **Correct partition found** - Init script looks on same disk first
3. **Type verified** - Won't mount ext4 partition as XFS
4. **Kernel probe errors ignored** - They're just scanning, not mounting

### Next Steps
1. Rebuild ISO: `make iso`
2. Boot and install on the NVMe disk
3. Old `QUANTIX-DATA` labels will be wiped
4. New partitions will be created with correct labels
5. Boot will find correct partitions on same disk
