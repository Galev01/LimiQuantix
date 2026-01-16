# 000079 - Quantix-OS Installer XFS Superblock Troubleshooting Guide

**Document ID:** 000079  
**Date:** January 16, 2026  
**Scope:** Quantix-OS installer debugging and disk partitioning issues  
**Status:** Resolved (multiple fixes applied)

---

## Problem Summary

The Quantix-OS installer was failing with the error:

```
XFS (nvme0n1p3): Invalid superblock magic number
```

This error appeared in `dmesg` after the installation failed, and the partition table showed only 3 partitions (from a previous Quantix-vDC installation) instead of the expected 5 partitions for Quantix-OS.

---

## Root Causes Identified

### 1. Bash-ism in POSIX Shell Script

**File:** `Quantix-OS/installer/install.sh`  
**Line:** 273 (original)

The installer script used bash-specific process substitution syntax:

```bash
# BAD - bash-specific syntax that fails silently in /bin/sh (busybox ash)
exec > >(tee -a "${INSTALL_LOG}") 2>&1
```

**Problem:** Alpine Linux uses busybox `ash` as `/bin/sh`, not bash. This syntax caused the script to fail immediately without creating any log file, making debugging impossible.

**Fix:** Replaced with POSIX-compliant logging:

```bash
# GOOD - POSIX-compliant logging
INSTALL_LOG="/tmp/install.log"
{
    echo "========================================================"
    echo "  QUANTIX-OS INSTALLER LOG"
    echo "  Started: $(date 2>/dev/null || echo 'unknown')"
    echo "  Script: $0"
    echo "  Args: $*"
    echo "  Shell: $(readlink /proc/$$/exe 2>/dev/null || echo $SHELL)"
    echo "  PWD: $(pwd)"
    echo "========================================================"
} > "$INSTALL_LOG" 2>&1
```

---

### 2. Insufficient Disk Wiping

**File:** `Quantix-OS/installer/install.sh`

The original disk wipe only cleared the first 1MB of the disk, which was not enough to remove old filesystem signatures (especially XFS superblocks which can be scattered).

**Original (insufficient):**

```bash
dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=1 conv=notrunc
wipefs -a "${TARGET_DISK}"
```

**Fixed (aggressive wipe):**

```bash
# 1. Destroy partition table completely
sgdisk --zap-all "${TARGET_DISK}" 2>/dev/null || true

# 2. Zero first 100MB to remove ALL filesystem signatures
dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=100 conv=notrunc 2>/dev/null || true

# 3. Zero last 10MB (backup GPT, secondary superblocks)
DISK_SIZE_BYTES=$(blockdev --getsize64 "${TARGET_DISK}" 2>/dev/null || echo 0)
if [ "$DISK_SIZE_BYTES" -gt 10485760 ]; then
    dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=10 seek=$((DISK_SIZE_BYTES/1048576 - 10)) conv=notrunc 2>/dev/null || true
fi

# 4. Force kernel to re-read partition table
blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
partprobe "${TARGET_DISK}" 2>/dev/null || true
udevadm settle 2>/dev/null || sleep 2

# 5. Wipe filesystem signatures
wipefs -a "${TARGET_DISK}" 2>/dev/null || true

# 6. Verify wipe
if blkid "${TARGET_DISK}"* 2>/dev/null | grep -q "TYPE="; then
    echo "[WARNING] Persistent signatures detected, performing deep wipe..."
    dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=1000 conv=notrunc 2>/dev/null || true
fi
```

---

### 3. Duplicate Partition Labels

**File:** `Quantix-OS/initramfs/init`

When multiple disks had partitions labeled `QUANTIX-DATA` (from previous Quantix-OS or Quantix-vDC installations), the `findfs` command would return the wrong partition:

```bash
# BAD - returns first match, could be wrong disk
DATA_DEV=$(findfs LABEL="QUANTIX-DATA" 2>/dev/null)
```

**Problem:** `blkid` showed:
```
/dev/nvme0n1p3: LABEL="QUANTIX-DATA" TYPE="ext4"   # Wrong! This is Quantix-vDC
/dev/nvme1n1p5: LABEL="QUANTIX-DATA" TYPE="xfs"    # Correct Quantix-OS partition
```

**Fix:** Smart partition discovery that:
1. Extracts the base disk from the system partition
2. Looks for partitions by their expected position (p4 for config, p5 for data)
3. Verifies both label AND filesystem type

```bash
# Determine base disk from system partition
case "$SYSTEM_DEV" in
    /dev/nvme*p*) BASE_DISK=$(echo "$SYSTEM_DEV" | sed 's/p[0-9]*$//'); DATA_PART="${BASE_DISK}p5";;
    /dev/sd*) BASE_DISK=$(echo "$SYSTEM_DEV" | sed 's/[0-9]*$//'); DATA_PART="${BASE_DISK}5";;
    /dev/vd*) BASE_DISK=$(echo "$SYSTEM_DEV" | sed 's/[0-9]*$//'); DATA_PART="${BASE_DISK}5";;
    *) DATA_PART="" ;;
esac

# Verify both label AND type
if [ -n "$DATA_PART" ] && [ -b "$DATA_PART" ]; then
    DATA_DEV_LABEL=$(blkid -o value -s LABEL "$DATA_PART" 2>/dev/null)
    DATA_DEV_TYPE=$(blkid -o value -s TYPE "$DATA_PART" 2>/dev/null)
    if [ "$DATA_DEV_LABEL" = "QUANTIX-DATA" ] && [ "$DATA_DEV_TYPE" = "xfs" ]; then
        DATA_DEV="$DATA_PART"
        msg "Found data partition by position: $DATA_DEV (verified label+type)"
    fi
fi

# Fallback to findfs only if not found
if [ -z "$DATA_DEV" ]; then
    DATA_DEV=$(findfs LABEL="QUANTIX-DATA" 2>/dev/null)
fi
```

---

### 4. Individual Partition Signature Wipe

**File:** `Quantix-OS/installer/install.sh`

Added a new "Step 0" to wipe filesystem signatures from each existing partition before destroying the partition table:

```bash
# STEP 0: WIPE ALL EXISTING PARTITION SIGNATURES FIRST
# This is CRITICAL - removes old labels like QUANTIX-DATA that confuse findfs
log_info "Wiping filesystem signatures from ALL existing partitions..."
echo "[WIPE] Wiping individual partition signatures..." >> "${INSTALL_LOG}"

# Determine partition naming scheme
case "${TARGET_DISK}" in
    /dev/nvme*|/dev/mmcblk*|/dev/loop*)
        PART_PATTERN="${TARGET_DISK}p"
        ;;
    *)
        PART_PATTERN="${TARGET_DISK}"
        ;;
esac

# Wipe partitions 1-9
for i in 1 2 3 4 5 6 7 8 9; do
    PART="${PART_PATTERN}${i}"
    if [ -b "$PART" ]; then
        OLD_LABEL=$(blkid -o value -s LABEL "$PART" 2>/dev/null || echo "none")
        OLD_TYPE=$(blkid -o value -s TYPE "$PART" 2>/dev/null || echo "none")
        log_info "  Wiping ${PART} (was: LABEL=${OLD_LABEL} TYPE=${OLD_TYPE})"
        echo "[WIPE]   ${PART}: LABEL=${OLD_LABEL} TYPE=${OLD_TYPE}" >> "${INSTALL_LOG}"
        wipefs -a "$PART" >> "${INSTALL_LOG}" 2>&1 || true
        dd if=/dev/zero of="$PART" bs=1M count=10 conv=notrunc 2>/dev/null || true
    fi
done
```

---

### 5. TUI Installer Script Path Issues

**File:** `Quantix-OS/installer/tui.sh`

The TUI script wasn't always finding `install.sh` correctly due to different mount points depending on boot method.

**Fix:** Multi-path search:

```bash
# Find install script
INSTALL_SCRIPT=""
for path in \
    "/installer/install.sh" \
    "/mnt/cdrom/installer/install.sh" \
    "$(dirname "$0")/install.sh"; do
    if [ -f "$path" ]; then
        INSTALL_SCRIPT="$path"
        break
    fi
done

if [ -z "$INSTALL_SCRIPT" ]; then
    show_error "Install script not found!"
    exit 1
fi

# Execute with explicit shell and arguments
/bin/sh "$INSTALL_SCRIPT" --disk "$DISK" --hostname "$HOSTNAME" \
    --password "$PASSWORD" --version "$VERSION" --auto
```

---

### 6. Enhanced Diagnostic Screen

**File:** `Quantix-OS/installer/tui.sh`

When installation fails, the TUI now shows comprehensive diagnostics:

```bash
# Show failure diagnostics
{
    echo "=== Install Exit Code ==="
    echo "Exit code: $INSTALL_EXIT"
    echo ""
    echo "=== Install Script Location ==="
    echo "Script: $INSTALL_SCRIPT"
    ls -la "$INSTALL_SCRIPT" 2>&1
    echo ""
    echo "=== Install Script Shebang ==="
    head -1 "$INSTALL_SCRIPT"
    echo ""
    echo "=== Syntax Check ==="
    if /bin/sh -n "$INSTALL_SCRIPT" 2>&1; then
        echo "OK - no syntax errors"
    else
        echo "SYNTAX ERRORS DETECTED"
    fi
    echo ""
    echo "=== Partition Table on $DISK ==="
    parted -s "$DISK" print 2>&1 || echo "(parted failed)"
    echo ""
    echo "=== blkid (filesystem signatures) ==="
    blkid 2>&1
    echo ""
    echo "=== dmesg XFS errors ==="
    dmesg 2>&1 | grep -i "xfs.*invalid\|xfs.*error" | tail -5 || echo "(none)"
    echo ""
    echo "=== dmesg last 20 lines ==="
    dmesg 2>&1 | tail -20
    echo ""
    echo "=== Install Log (last 50 lines) ==="
    if [ -f "/tmp/install.log" ]; then
        tail -50 /tmp/install.log
    else
        echo "Log file not found at /tmp/install.log"
        echo "This likely means the script failed before logging started."
    fi
} > /tmp/diag.txt

dialog --title "Installation Failed - Diagnostics" \
    --textbox /tmp/diag.txt 30 100
```

---

### 7. Delayed `set -e` Activation

**File:** `Quantix-OS/installer/install.sh`

The original script enabled `set -e` (exit on error) too early, causing silent failures before any logging could happen.

**Fix:** Enable `set -e` only after logging is set up and validation is complete:

```bash
# At the start - NO set -e, we need to log errors
INSTALL_LOG="/tmp/install.log"
# ... create log header ...

# After validation and squashfs found
echo "[INSTALL] Enabling set -e (strict mode)" >> "$INSTALL_LOG"
set -e
```

---

### 8. Detailed Step-by-Step Logging

**File:** `Quantix-OS/installer/install.sh`

Added logging at every critical point to identify where failures occur:

```bash
echo "[INIT] Script directory: $SCRIPT_DIR" >> "$INSTALL_LOG"

echo "[VALIDATION] Starting validation..." >> "$INSTALL_LOG"
echo "[VALIDATION] TARGET_DISK='$TARGET_DISK'" >> "$INSTALL_LOG"
echo "[VALIDATION] Checking if $TARGET_DISK is block device..." >> "$INSTALL_LOG"

echo "[SQUASHFS] Searching for system image..." >> "$INSTALL_LOG"
echo "[SQUASHFS] Checking: $path" >> "$INSTALL_LOG"

echo "[INSTALL] Starting installation steps..." >> "$INSTALL_LOG"
echo "[STEP 1] Wiping disk..." >> "$INSTALL_LOG"
echo "[STEP 2] Creating partitions..." >> "$INSTALL_LOG"
# etc.
```

---

## Quantix-OS vs Quantix-vDC Partition Layout

Understanding the different partition layouts helps diagnose cross-contamination issues:

### Quantix-OS (5 partitions)

| # | Name | Size | Type | Label |
|---|------|------|------|-------|
| 1 | EFI | 256MB | FAT32 | QUANTIX-EFI |
| 2 | System A | 1.5GB | ext4 | QUANTIX-A |
| 3 | System B | 1.5GB | ext4 | QUANTIX-B |
| 4 | Config | 256MB | ext4 | QUANTIX-CFG |
| 5 | Data | Remaining | XFS | QUANTIX-DATA |

### Quantix-vDC (3 partitions)

| # | Name | Size | Type | Label |
|---|------|------|------|-------|
| 1 | EFI | 256MB | FAT32 | QUANTIX-EFI |
| 2 | Root | ~10GB | ext4 | QUANTIX-ROOT |
| 3 | Data | Remaining | ext4 | QUANTIX-DATA |

**Key Difference:** Quantix-vDC partition 3 is `ext4` with label `QUANTIX-DATA`, while Quantix-OS partition 5 is `XFS` with the same label. This caused `findfs` to return the wrong partition when both existed on the system.

---

## Troubleshooting Checklist

When the installer fails:

1. **Check the log file exists:** `/tmp/install.log`
   - If missing: Script crashed before logging (likely bash-ism or early syntax error)
   - If empty header only: Failed during validation

2. **Look for the last log entry:**
   ```bash
   cat /tmp/install.log | tail -20
   ```
   The last line indicates where it failed.

3. **Check for duplicate labels:**
   ```bash
   blkid | grep QUANTIX
   ```
   Look for multiple partitions with the same label.

4. **Check partition table:**
   ```bash
   parted -s /dev/nvmeXn1 print
   ```
   Should show 5 partitions for Quantix-OS.

5. **Check dmesg for XFS errors:**
   ```bash
   dmesg | grep -i xfs
   ```

6. **Verify squashfs location:**
   ```bash
   ls -la /mnt/cdrom/quantix/
   ls -la /cdrom/quantix/
   ```

---

## Files Modified

| File | Changes |
|------|---------|
| `Quantix-OS/installer/install.sh` | POSIX logging, aggressive disk wipe, per-partition wipe, delayed set -e, detailed logging |
| `Quantix-OS/installer/tui.sh` | Multi-path script search, enhanced diagnostic screen, safer script execution |
| `Quantix-OS/initramfs/init` | Smart partition discovery, label+type verification, detailed boot diagnostics |

---

## Prevention

To prevent these issues in future:

1. **Always use POSIX shell syntax** - Test scripts with `sh -n` (busybox sh, not bash)
2. **Wipe disks thoroughly** - At least 100MB from start, 10MB from end
3. **Use unique labels** - Or verify both label AND filesystem type
4. **Log everything** - Create log file before `set -e`
5. **Test multi-disk scenarios** - Ensure installer handles existing partitions on other disks

---

## References

- `Quantix-OS/installer/install.sh` - Main installer script
- `Quantix-OS/installer/tui.sh` - TUI installer frontend
- `Quantix-OS/initramfs/init` - Boot init script
- Doc 000051 - Quantix-OS Logging and Diagnostics
- Doc 000052 - Quantix-OS Architecture
