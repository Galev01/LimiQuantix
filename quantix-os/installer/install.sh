#!/bin/sh
# =============================================================================
# Quantix-OS Installer
# =============================================================================
# Installs Quantix-OS to a target disk with A/B partitioning.
#
# Usage:
#   ./install.sh                         # Interactive TUI mode
#   ./install.sh --disk /dev/sda --auto  # Non-interactive mode
#
# Partition Layout:
#   1. EFI (256MB)       - FAT32, UEFI bootloader
#   2. QUANTIX-A (1.5GB) - ext4, System A (active)
#   3. QUANTIX-B (1.5GB) - ext4, System B (upgrade slot)
#   4. QUANTIX-CFG (256MB) - ext4, Configuration
#   5. QUANTIX-DATA (rest) - XFS, VM storage
# =============================================================================

# =============================================================================
# IMMEDIATE LOG CREATION - Create log file FIRST for diagnostics
# =============================================================================
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

# DIAGNOSTIC: Confirm script is starting (also show on console)
echo ""
echo "========================================================"
echo "  QUANTIX-OS INSTALLER STARTING"
echo "  Script: $0"
echo "  Args: $*"
echo "  Date: $(date 2>/dev/null || echo 'unknown')"
echo "  Shell: $(readlink /proc/$$/exe 2>/dev/null || echo $SHELL)"
echo "  Log file: $INSTALL_LOG"
echo ""
echo "  Press Ctrl+C at any time to abort and drop to shell"
echo "========================================================"
echo ""

# Handle Ctrl+C gracefully
abort_install() {
    echo ""
    echo "Installation aborted by user."
    echo "Dropping to shell for troubleshooting..."
    echo ""
    echo "Useful commands:"
    echo "  cat /tmp/install.log   - View install log"
    echo "  reboot                 - Reboot system"
    echo ""
    # Increment fail counter so we don't loop
    FAIL_MARKER="/tmp/.quantix_install_failed"
    if [ -f "$FAIL_MARKER" ]; then
        FAIL_COUNT=$(cat "$FAIL_MARKER" 2>/dev/null || echo "0")
    else
        FAIL_COUNT=0
    fi
    echo "$((FAIL_COUNT + 1))" > "$FAIL_MARKER"
    exec /bin/sh
}
trap abort_install INT TERM

# NOTE: We use set -e later, after argument parsing
# This ensures we can capture errors and log them

# Colors (may not work in all terminals, but harmless)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
TARGET_DISK=""
HOSTNAME="quantix"
ROOT_PASSWORD=""
VERSION="0.0.1"
AUTO_MODE=0
STORAGE_POOLS=""  # Format: "/dev/disk1:pool-name /dev/disk2:pool-name"

# Partition sizes
EFI_SIZE="256M"
SYSTEM_SIZE="1500M"  # 1.5GB per system slot
CONFIG_SIZE="256M"

# Paths - use defensive approach
SCRIPT_DIR="$(dirname "$0" 2>/dev/null || echo '/installer')"
# Try to get absolute path, but don't fail if it doesn't work
if [ -d "$SCRIPT_DIR" ]; then
    SCRIPT_DIR="$(cd "$SCRIPT_DIR" 2>/dev/null && pwd)" || SCRIPT_DIR="/installer"
fi
SQUASHFS_PATH=""
TARGET_MOUNT="/mnt/install"

echo "[INIT] Script directory: $SCRIPT_DIR" >> "$INSTALL_LOG"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up mount points..."
    umount "${TARGET_MOUNT}/root/boot/efi" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root/dev" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root/proc" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root/sys" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root" 2>/dev/null || true
    umount "${TARGET_MOUNT}/data" 2>/dev/null || true
    umount "${TARGET_MOUNT}/config" 2>/dev/null || true
    umount "${TARGET_MOUNT}/efi" 2>/dev/null || true
    umount "${TARGET_MOUNT}/system" 2>/dev/null || true
    umount /tmp/sqmount 2>/dev/null || true
}

trap cleanup EXIT

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root"
    exit 1
fi

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------

while [ $# -gt 0 ]; do
    case "$1" in
        --disk)
            TARGET_DISK="$2"
            shift 2
            ;;
        --hostname)
            HOSTNAME="$2"
            shift 2
            ;;
        --password)
            ROOT_PASSWORD="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --auto)
            AUTO_MODE=1
            shift
            ;;
        --storage-pools)
            STORAGE_POOLS="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --disk DEVICE           Target disk (e.g., /dev/sda)"
            echo "  --hostname NAME         Hostname for the system"
            echo "  --password PASS         Root password"
            echo "  --version VER           Version string to embed"
            echo "  --storage-pools POOLS   Storage pools (format: /dev/disk1:name1 /dev/disk2:name2)"
            echo "  --auto                  Non-interactive mode"
            echo "  --help                  Show this help"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Interactive Mode (if not --auto)
# -----------------------------------------------------------------------------

if [ $AUTO_MODE -eq 0 ]; then
    # Try TUI first
    if [ -x "/installer/tui.sh" ] && command -v dialog >/dev/null 2>&1; then
        exec /installer/tui.sh
    fi
    
    # Fall back to simple prompts
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║              Quantix-OS Installer v${VERSION}                       ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Detect available disks
    echo "Available disks:"
    echo "----------------"
    lsblk -d -o NAME,SIZE,MODEL,TYPE | grep -E "disk|NAME"
    echo ""
    
    echo -n "Enter target disk (e.g., /dev/sda): "
    read TARGET_DISK
    
    if [ ! -b "$TARGET_DISK" ]; then
        log_error "Invalid disk: $TARGET_DISK"
        exit 1
    fi
    
    echo -n "Enter hostname [quantix]: "
    read input_hostname
    [ -n "$input_hostname" ] && HOSTNAME="$input_hostname"
    
    echo -n "Enter root password: "
    stty -echo
    read ROOT_PASSWORD
    stty echo
    echo ""
    
    echo ""
    echo -e "${RED}WARNING: ALL DATA ON ${TARGET_DISK} WILL BE DESTROYED!${NC}"
    echo -n "Type 'yes' to continue: "
    read confirm
    if [ "$confirm" != "yes" ]; then
        log_info "Installation cancelled."
        exit 0
    fi
fi

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

echo "[VALIDATION] Starting validation..." >> "$INSTALL_LOG"
echo "[VALIDATION] TARGET_DISK='$TARGET_DISK'" >> "$INSTALL_LOG"
echo "[VALIDATION] HOSTNAME='$HOSTNAME'" >> "$INSTALL_LOG"
echo "[VALIDATION] VERSION='$VERSION'" >> "$INSTALL_LOG"
echo "[VALIDATION] AUTO_MODE='$AUTO_MODE'" >> "$INSTALL_LOG"
echo "[VALIDATION] STORAGE_POOLS='$STORAGE_POOLS'" >> "$INSTALL_LOG"

if [ -z "$TARGET_DISK" ]; then
    log_error "TARGET_DISK is required"
    echo "[VALIDATION] FAILED: TARGET_DISK is empty" >> "$INSTALL_LOG"
    exit 1
fi

echo "[VALIDATION] Checking if $TARGET_DISK is block device..." >> "$INSTALL_LOG"
ls -la "$TARGET_DISK" >> "$INSTALL_LOG" 2>&1 || echo "[VALIDATION] ls failed for $TARGET_DISK" >> "$INSTALL_LOG"

if [ ! -b "$TARGET_DISK" ]; then
    log_error "Target disk not found: $TARGET_DISK"
    echo "[VALIDATION] FAILED: $TARGET_DISK is not a block device" >> "$INSTALL_LOG"
    echo "[VALIDATION] Available block devices:" >> "$INSTALL_LOG"
    ls -la /dev/nvme* /dev/sd* /dev/vd* >> "$INSTALL_LOG" 2>&1 || true
    exit 1
fi

echo "[VALIDATION] $TARGET_DISK is valid block device" >> "$INSTALL_LOG"

# -----------------------------------------------------------------------------
# Find System Image
# -----------------------------------------------------------------------------

find_squashfs() {
    log_info "Locating system image..."
    echo "[SQUASHFS] Searching for system image..." >> "$INSTALL_LOG"
    
    for path in \
        "/mnt/cdrom/quantix/system.squashfs" \
        "/mnt/iso/quantix/system.squashfs" \
        "/mnt/toram/system.squashfs" \
        "/cdrom/quantix/system.squashfs" \
        "/media/cdrom/quantix/system.squashfs" \
        "/run/media/cdrom/quantix/system.squashfs" \
        "${SCRIPT_DIR}/../quantix/system.squashfs"; do
        echo "[SQUASHFS] Checking: $path" >> "$INSTALL_LOG"
        if [ -f "$path" ]; then
            SQUASHFS_PATH="$path"
            log_info "Found system image: ${SQUASHFS_PATH}"
            echo "[SQUASHFS] FOUND: $SQUASHFS_PATH" >> "$INSTALL_LOG"
            return 0
        fi
    done
    
    # Search for any squashfs (include /mnt/toram for toram mode)
    echo "[SQUASHFS] Searching with find command..." >> "$INSTALL_LOG"
    SQUASHFS_PATH=$(find /mnt /media /run/media /cdrom -name "system*.squashfs" 2>/dev/null | head -1)
    
    # Also check /mnt/toram directly (toram mode puts it there)
    if [ -z "$SQUASHFS_PATH" ] && [ -f "/mnt/toram/system.squashfs" ]; then
        SQUASHFS_PATH="/mnt/toram/system.squashfs"
        echo "[SQUASHFS] Found in toram location" >> "$INSTALL_LOG"
    fi
    echo "[SQUASHFS] find result: '$SQUASHFS_PATH'" >> "$INSTALL_LOG"
    
    if [ -z "$SQUASHFS_PATH" ] || [ ! -f "$SQUASHFS_PATH" ]; then
        log_error "System image not found!"
        echo "[SQUASHFS] FAILED: System image not found!" >> "$INSTALL_LOG"
        echo "[SQUASHFS] Contents of /mnt/cdrom:" >> "$INSTALL_LOG"
        ls -laR /mnt/cdrom/ >> "$INSTALL_LOG" 2>&1 || echo "(no /mnt/cdrom)" >> "$INSTALL_LOG"
        echo "[SQUASHFS] Contents of /cdrom:" >> "$INSTALL_LOG"
        ls -laR /cdrom/ >> "$INSTALL_LOG" 2>&1 || echo "(no /cdrom)" >> "$INSTALL_LOG"
        exit 1
    fi
    
    log_info "Found system image: ${SQUASHFS_PATH}"
    echo "[SQUASHFS] Using: $SQUASHFS_PATH" >> "$INSTALL_LOG"
}

echo "[INSTALL] Calling find_squashfs..." >> "$INSTALL_LOG"
find_squashfs
echo "[INSTALL] find_squashfs completed, SQUASHFS_PATH='$SQUASHFS_PATH'" >> "$INSTALL_LOG"

# Also try to get version from ISO
VERSION_FILE="${SQUASHFS_PATH%/*}/VERSION"
if [ -f "$VERSION_FILE" ]; then
    VERSION=$(cat "$VERSION_FILE" | tr -d '\n\r ')
    log_info "Installing Quantix-OS version: ${VERSION}"
fi

# -----------------------------------------------------------------------------
# Installation
# -----------------------------------------------------------------------------

# Now enable strict error handling
echo "[INSTALL] Enabling set -e (strict mode)" >> "$INSTALL_LOG"
set -e

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Installing Quantix-OS v${VERSION}                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
    
log_info "Target Disk:  $TARGET_DISK"
log_info "Hostname:     $HOSTNAME"
log_info "Version:      $VERSION"
echo ""

echo "[INSTALL] Starting installation steps..." >> "$INSTALL_LOG"

# Calculate total steps (base 8 + storage pools if configured)
TOTAL_STEPS=8
if [ -n "$STORAGE_POOLS" ]; then
    TOTAL_STEPS=9
fi

# =============================================================================
# Step 1: Create Partitions
# =============================================================================
log_step "Step 1/${TOTAL_STEPS}: Creating partition table..."

# Log all operations for debugging (POSIX-compatible)
INSTALL_LOG="/tmp/install.log"
log_info "Detailed install log: ${INSTALL_LOG}"

# Start logging (append to log file while keeping console output)
{
    echo "=========================================="
    echo "Quantix-OS Installation Log"
    echo "Date: $(date)"
    echo "Target: ${TARGET_DISK}"
    echo "=========================================="
} > "${INSTALL_LOG}"

log_info "Target disk: ${TARGET_DISK}"
log_info "Current partition table:"
parted -s "${TARGET_DISK}" print 2>&1 | tee -a "${INSTALL_LOG}" || echo "(no existing partition table)"
log_info "Current blkid output:"
blkid 2>&1 | tee -a "${INSTALL_LOG}" || true

# Unmount any existing partitions
log_info "Unmounting any existing partitions..."
for part in ${TARGET_DISK}* ${TARGET_DISK}p*; do
    if [ -b "$part" ] && [ "$part" != "$TARGET_DISK" ]; then
        # Try normal unmount first, then lazy unmount
        umount "$part" 2>/dev/null || umount -l "$part" 2>/dev/null || true
        # NOTE: Do NOT use fuser -km here - it can kill init (PID 1) and crash the system
    fi
done

# Stop any LVM/RAID using this disk
log_info "Deactivating LVM/RAID..."
vgchange -an 2>/dev/null || true
mdadm --stop --scan 2>/dev/null || true

# Remove device-mapper entries that might hold the disk
log_info "Removing device-mapper entries..."
if command -v dmsetup >/dev/null 2>&1; then
    dmsetup remove_all 2>/dev/null || true
fi

# CRITICAL: Remove partition entries from kernel BEFORE wiping
# This prevents "partitions in use" errors
log_info "Removing kernel partition entries..."
if command -v partx >/dev/null 2>&1; then
    partx -d "${TARGET_DISK}" 2>/dev/null || true
fi
# Alternative method using blockdev
blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
sleep 1

# =============================================================================
# STEP 0: WIPE ALL EXISTING PARTITION SIGNATURES FIRST
# This is CRITICAL - removes old labels like QUANTIX-DATA that confuse findfs
# =============================================================================
log_info "Wiping filesystem signatures from ALL existing partitions..."
echo "[WIPE] Wiping individual partition signatures..." >> "${INSTALL_LOG}"

# Determine partition naming pattern for this disk
case "$TARGET_DISK" in
    /dev/nvme*|/dev/mmcblk*)
        PART_PATTERN="${TARGET_DISK}p"
        ;;
    *)
        PART_PATTERN="${TARGET_DISK}"
        ;;
esac

# Wipe each existing partition's filesystem signature
for i in 1 2 3 4 5 6 7 8 9; do
    PART="${PART_PATTERN}${i}"
    if [ -b "$PART" ]; then
        OLD_LABEL=$(blkid -o value -s LABEL "$PART" 2>/dev/null || echo "none")
        OLD_TYPE=$(blkid -o value -s TYPE "$PART" 2>/dev/null || echo "none")
        log_info "  Wiping ${PART} (was: LABEL=${OLD_LABEL} TYPE=${OLD_TYPE})"
        echo "[WIPE]   ${PART}: LABEL=${OLD_LABEL} TYPE=${OLD_TYPE}" >> "${INSTALL_LOG}"
        
        # Remove filesystem signature (clears label, UUID, magic bytes)
        wipefs -a "$PART" >> "${INSTALL_LOG}" 2>&1 || true
        
        # Zero first 10MB of partition to clear superblocks
        dd if=/dev/zero of="$PART" bs=1M count=10 conv=notrunc 2>/dev/null || true
    fi
done

log_info "Individual partition signatures wiped"

# =============================================================================
# AGGRESSIVE DISK WIPE - Prevents "Invalid superblock" errors
# This is CRITICAL to prevent "XFS Invalid superblock magic number" errors
# =============================================================================
log_info "Performing aggressive disk wipe..."
echo "[WIPE] Starting aggressive disk wipe..." >> "${INSTALL_LOG}"

# Method 1: sgdisk --zap-all (destroys GPT and MBR completely)
if command -v sgdisk >/dev/null 2>&1; then
    log_info "Using sgdisk to zap all partition data..."
    sgdisk --zap-all "${TARGET_DISK}" >> "${INSTALL_LOG}" 2>&1 || log_warn "sgdisk zap failed (continuing)"
else
    log_warn "sgdisk not available, using alternative wipe methods"
fi

# Method 2: wipefs on the whole disk
log_info "Wiping disk-level filesystem signatures..."
wipefs -a "${TARGET_DISK}" >> "${INSTALL_LOG}" 2>&1 || true

# Method 3: Zero first 100MB to clear ALL possible superblock locations
# XFS superblocks can be at: 0, 512, 32K, 64K, 128K, 1GB, etc.
# ext4 superblocks at: 1K, 32K+1K, etc.
log_info "Zeroing first 100MB to clear all superblocks..."
dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=100 conv=notrunc 2>/dev/null || true
echo "[WIPE] Zeroed first 100MB" >> "${INSTALL_LOG}"

# Zero end of disk to clear backup GPT
log_info "Zeroing last 10MB to clear backup GPT..."
DISK_SIZE_SECTORS=$(blockdev --getsz "${TARGET_DISK}" 2>/dev/null)
# Validate we got a number
if [ -n "$DISK_SIZE_SECTORS" ] && [ "$DISK_SIZE_SECTORS" -gt 0 ] 2>/dev/null; then
    if [ "$DISK_SIZE_SECTORS" -gt 20480 ]; then
        # Calculate seek position for last 10MB
        DISK_SIZE_MB=$((DISK_SIZE_SECTORS / 2048))
        SEEK_POS=$((DISK_SIZE_MB - 10))
        if [ "$SEEK_POS" -gt 0 ]; then
            dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=10 seek=$SEEK_POS conv=notrunc 2>/dev/null || true
            echo "[WIPE] Zeroed last 10MB at offset ${SEEK_POS}MB" >> "${INSTALL_LOG}"
        fi
    fi
else
    log_warn "Could not determine disk size, skipping end-of-disk wipe"
fi

# Force kernel to drop all partition info
log_info "Forcing kernel partition table re-read..."
sync
blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
partprobe "${TARGET_DISK}" 2>/dev/null || true
udevadm settle 2>/dev/null || true
sleep 3

# Re-trigger device detection
if command -v mdev >/dev/null 2>&1; then
    mdev -s 2>/dev/null || true
fi

# Verify disk is clean
log_info "Verifying disk is clean..."
REMAINING_SIGS=$(blkid "${TARGET_DISK}"* 2>/dev/null | grep -c TYPE || true)
REMAINING_SIGS=${REMAINING_SIGS:-0}
if [ "$REMAINING_SIGS" -gt 0 ] 2>/dev/null; then
    log_warn "Found ${REMAINING_SIGS} remaining signatures - performing deep wipe..."
    echo "[WIPE] ${REMAINING_SIGS} signatures remain, deep wiping..." >> "${INSTALL_LOG}"
    
    # Get disk size and wipe a significant portion
    DISK_SIZE_SECTORS=$(blockdev --getsz "${TARGET_DISK}" 2>/dev/null)
    if [ -n "$DISK_SIZE_SECTORS" ] && [ "$DISK_SIZE_SECTORS" -gt 0 ] 2>/dev/null; then
        DISK_SIZE_MB=$((DISK_SIZE_SECTORS / 2048))
        
        # Wipe at least 1GB or 10% of disk, whichever is larger (cap at 10GB)
        WIPE_SIZE=$((DISK_SIZE_MB / 10))
        [ "$WIPE_SIZE" -lt 1024 ] && WIPE_SIZE=1024
        [ "$WIPE_SIZE" -gt 10240 ] && WIPE_SIZE=10240
        
        log_info "Deep wiping first ${WIPE_SIZE}MB..."
        dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=${WIPE_SIZE} conv=notrunc 2>/dev/null || true
    else
        log_warn "Could not get disk size for deep wipe, using 1GB"
        dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=1024 conv=notrunc 2>/dev/null || true
    fi
    
    blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
    partprobe "${TARGET_DISK}" 2>/dev/null || true
    udevadm settle 2>/dev/null || true
    sleep 2
fi

echo "[WIPE] Disk wipe complete" >> "${INSTALL_LOG}"
log_info "Disk wipe complete"

# =============================================================================
# FINAL CLEANUP: Force kernel to completely forget about old partitions
# This is CRITICAL to prevent "partitions in use" errors
# =============================================================================
log_info "Final kernel partition cleanup..."

# Remove all partition entries using partx
if command -v partx >/dev/null 2>&1; then
    partx -d "${TARGET_DISK}" 2>/dev/null || true
    # Also try removing numbered partitions explicitly
    for i in 1 2 3 4 5 6 7 8 9 10; do
        partx -d --nr $i "${TARGET_DISK}" 2>/dev/null || true
    done
fi

# Force kernel re-read with multiple methods
sync
blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
sleep 1
partprobe "${TARGET_DISK}" 2>/dev/null || true
sleep 1

# Trigger udev to update device nodes
udevadm trigger 2>/dev/null || true
udevadm settle --timeout=5 2>/dev/null || true

# Final check - partition devices should not exist
for i in 1 2 3 4 5; do
    PART="${PART_PATTERN}${i}"
    if [ -b "$PART" ]; then
        log_warn "Partition $PART still exists after cleanup, attempting removal..."
        # Try dmsetup if it's a dm device
        dmsetup remove "$PART" 2>/dev/null || true
        # Force umount again
        umount -l "$PART" 2>/dev/null || true
    fi
done

blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
sleep 2
    
# Create GPT partition table (with retry)
log_info "Creating GPT partition table..."
PARTED_SUCCESS=0
for attempt in 1 2 3; do
    if parted -s "${TARGET_DISK}" mklabel gpt 2>&1; then
        PARTED_SUCCESS=1
        break
    else
        log_warn "parted mklabel failed (attempt $attempt/3), retrying..."
        # Additional cleanup before retry
        sync
        blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
        partprobe "${TARGET_DISK}" 2>/dev/null || true
        sleep 2
        
        # Try partx again
        if command -v partx >/dev/null 2>&1; then
            partx -d "${TARGET_DISK}" 2>/dev/null || true
        fi
        sleep 1
    fi
done

if [ "$PARTED_SUCCESS" -eq 0 ]; then
    log_error "Failed to create GPT partition table after 3 attempts"
    log_error "The disk may still be in use. Check:"
    log_error "  - Is any partition mounted? (mount | grep ${TARGET_DISK})"
    log_error "  - Any processes using it? (fuser -m ${TARGET_DISK}*)"
    log_error "  - Any device-mapper entries? (dmsetup ls)"
    exit 1
fi

# Calculate partition positions
# Layout: EFI(256M) + SysA(1.5G) + SysB(1.5G) + Cfg(256M) + Data(rest)
EFI_END="256M"
SYS_A_END="1756M"   # 256M + 1500M
SYS_B_END="3256M"   # 1756M + 1500M
CFG_END="3512M"     # 3256M + 256M

# Create partitions
log_info "Creating partitions..."
parted -s "${TARGET_DISK}" mkpart "EFI" fat32 1MiB ${EFI_END}
parted -s "${TARGET_DISK}" set 1 esp on

parted -s "${TARGET_DISK}" mkpart "QUANTIX-A" ext4 ${EFI_END} ${SYS_A_END}
parted -s "${TARGET_DISK}" mkpart "QUANTIX-B" ext4 ${SYS_A_END} ${SYS_B_END}
parted -s "${TARGET_DISK}" mkpart "QUANTIX-CFG" ext4 ${SYS_B_END} ${CFG_END}
parted -s "${TARGET_DISK}" mkpart "QUANTIX-DATA" xfs ${CFG_END} 100%

# CRITICAL: Force kernel to re-read partition table multiple times
log_info "Synchronizing kernel partition table..."
sync
blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
partprobe "${TARGET_DISK}" 2>/dev/null || true
udevadm settle 2>/dev/null || true
sleep 2

# Re-trigger device detection
if command -v mdev >/dev/null 2>&1; then
    mdev -s 2>/dev/null || true
fi

# Second sync to ensure stability
blockdev --rereadpt "${TARGET_DISK}" 2>/dev/null || true
partprobe "${TARGET_DISK}" 2>/dev/null || true
sleep 1

log_info "New partition table:"
parted -s "${TARGET_DISK}" print 2>&1 || true
    
# Determine partition naming
case "$TARGET_DISK" in
    /dev/nvme*|/dev/mmcblk*)
        P="p"
        ;;
    *)
        P=""
        ;;
esac

PART_EFI="${TARGET_DISK}${P}1"
PART_SYS_A="${TARGET_DISK}${P}2"
PART_SYS_B="${TARGET_DISK}${P}3"
PART_CFG="${TARGET_DISK}${P}4"
PART_DATA="${TARGET_DISK}${P}5"

log_info "Partitions created"

# Wait for all partition devices to appear
log_info "Waiting for partition devices..."
for i in 1 2 3 4 5; do
    if [ -b "${TARGET_DISK}${P}5" ]; then
        break
    fi
    sleep 1
done

if [ ! -b "${PART_DATA}" ]; then
    log_error "Data partition not found: ${PART_DATA}"
    log_error "Available partitions:"
    ls -la "${TARGET_DISK}"* 2>/dev/null || true
    exit 1
fi

# =============================================================================
# Step 2: Format Partitions
# =============================================================================
log_step "Step 2/${TOTAL_STEPS}: Formatting partitions..."

# CRITICAL: Wipe each partition thoroughly before formatting
# This prevents "Invalid superblock magic number" errors from old filesystems
log_info "Wiping partition signatures..."
for part in "${PART_EFI}" "${PART_SYS_A}" "${PART_SYS_B}" "${PART_CFG}" "${PART_DATA}"; do
    if [ -b "$part" ]; then
        log_info "  Wiping $part..."
        # Remove any filesystem signatures
        wipefs -a --force "$part" 2>/dev/null || true
        # Zero first 10MB of partition to clear all possible superblock locations
        # XFS superblocks: 0, 512, 32K, 64K, etc.
        # ext4 superblocks: 1K, 32K+1K, etc.
        dd if=/dev/zero of="$part" bs=1M count=10 conv=notrunc 2>/dev/null || true
    else
        log_warn "  Partition $part not found - waiting..."
        sleep 2
        if [ ! -b "$part" ]; then
            log_error "Partition $part still not found!"
            log_error "Available devices:"
            ls -la /dev/nvme* /dev/sd* 2>/dev/null || true
            exit 1
        fi
    fi
done

# Sync before formatting
sync
sleep 1

log_info "Formatting EFI partition (${PART_EFI})..."
mkfs.vfat -F 32 -n "EFI" "${PART_EFI}" || {
    log_error "Failed to format EFI partition"
    exit 1
}

log_info "Formatting System A partition (${PART_SYS_A})..."
mkfs.ext4 -L "QUANTIX-A" -F "${PART_SYS_A}" || {
    log_error "Failed to format System A partition"
    exit 1
}

log_info "Formatting System B partition (${PART_SYS_B})..."
mkfs.ext4 -L "QUANTIX-B" -F "${PART_SYS_B}" || {
    log_error "Failed to format System B partition"
    exit 1
}

log_info "Formatting Config partition (${PART_CFG})..."
mkfs.ext4 -L "QUANTIX-CFG" -F "${PART_CFG}" || {
    log_error "Failed to format Config partition"
    exit 1
}

log_info "Formatting Data partition (${PART_DATA}) with XFS..."
mkfs.xfs -L "QUANTIX-DATA" -f "${PART_DATA}" || {
    log_error "Failed to format Data partition"
    exit 1
}

# Sync to ensure all writes are flushed
sync
sleep 1

# Force kernel to update partition info after formatting
partprobe "${TARGET_DISK}" 2>/dev/null || true
udevadm settle 2>/dev/null || true
sleep 1
    
log_info "Partitions formatted successfully"

# Verify filesystem labels and types
log_info "Verifying filesystem labels..."
log_info "blkid output:"
blkid 2>&1 | tee -a "${INSTALL_LOG}" || true

DATA_LABEL=$(blkid -o value -s LABEL "${PART_DATA}" 2>/dev/null)
DATA_TYPE=$(blkid -o value -s TYPE "${PART_DATA}" 2>/dev/null)

log_info "Data partition: LABEL=$DATA_LABEL TYPE=$DATA_TYPE"

if [ "$DATA_LABEL" != "QUANTIX-DATA" ]; then
    log_error "Data partition label not set correctly (expected QUANTIX-DATA, got $DATA_LABEL)"
    exit 1
fi
if [ "$DATA_TYPE" != "xfs" ]; then
    log_error "Data partition is not XFS (expected xfs, got $DATA_TYPE)"
    exit 1
fi

log_info "All partitions verified successfully"

# =============================================================================
# Step 3: Mount Partitions
# =============================================================================
log_step "Step 3/${TOTAL_STEPS}: Mounting partitions..."

mkdir -p "${TARGET_MOUNT}"/{efi,system,config,data}
    
mount "${PART_SYS_A}" "${TARGET_MOUNT}/system"
mount "${PART_EFI}" "${TARGET_MOUNT}/efi"
mount "${PART_CFG}" "${TARGET_MOUNT}/config"
mount "${PART_DATA}" "${TARGET_MOUNT}/data"

log_info "Partitions mounted"

# =============================================================================
# Step 4: Install System
# =============================================================================
log_step "Step 4/${TOTAL_STEPS}: Installing system image..."

mkdir -p "${TARGET_MOUNT}/system"/{boot,quantix}
    
# Copy squashfs to system partition
log_info "Copying system image (this may take a few minutes)..."
cp "${SQUASHFS_PATH}" "${TARGET_MOUNT}/system/quantix/system.squashfs"
    
# Write version file
echo "${VERSION}" > "${TARGET_MOUNT}/system/quantix/VERSION"

# Extract boot files from squashfs
    log_info "Extracting boot files..."
    mkdir -p /tmp/sqmount
    mount -t squashfs "${SQUASHFS_PATH}" /tmp/sqmount
    
    if [ -f /tmp/sqmount/boot/vmlinuz-lts ]; then
    cp /tmp/sqmount/boot/vmlinuz-lts "${TARGET_MOUNT}/system/boot/vmlinuz"
    elif [ -f /tmp/sqmount/boot/vmlinuz ]; then
    cp /tmp/sqmount/boot/vmlinuz "${TARGET_MOUNT}/system/boot/vmlinuz"
else
    log_error "Kernel not found in system image!"
    exit 1
    fi
    
    if [ -f /tmp/sqmount/boot/initramfs-lts ]; then
    cp /tmp/sqmount/boot/initramfs-lts "${TARGET_MOUNT}/system/boot/initramfs"
    elif [ -f /tmp/sqmount/boot/initramfs ]; then
    cp /tmp/sqmount/boot/initramfs "${TARGET_MOUNT}/system/boot/initramfs"
else
    log_error "Initramfs not found in system image!"
    exit 1
    fi
    
    umount /tmp/sqmount
    rmdir /tmp/sqmount

log_info "System image installed"

# =============================================================================
# Step 5: Configure System
# =============================================================================
log_step "Step 5/${TOTAL_STEPS}: Configuring system..."
    
    # Create config directory structure
mkdir -p "${TARGET_MOUNT}/config"/{certificates,network,limiquantix}
chmod 700 "${TARGET_MOUNT}/config/certificates"

# Write hostname
echo "${HOSTNAME}" > "${TARGET_MOUNT}/config/hostname"

# Create node configuration
cat > "${TARGET_MOUNT}/config/limiquantix/node.yaml" << EOF
# Quantix-OS Node Configuration
# Generated by installer on $(date -Iseconds)

node:
  hostname: ${HOSTNAME}
  version: ${VERSION}

server:
  http_port: 8080
  https_port: 8443
  
hypervisor:
  backend: libvirt
  libvirt_uri: "qemu:///system"

storage:
  default_pool: /data

logging:
  level: info
EOF
    
    # Create data directory structure
mkdir -p "${TARGET_MOUNT}/data"/{vms,images,isos,backups,storage}

log_info "System configured"

# =============================================================================
# Step 6: Initialize Storage Pools (Optional)
# =============================================================================
if [ -n "$STORAGE_POOLS" ]; then
    log_step "Step 6/${TOTAL_STEPS}: Initializing storage pools..."
    
    # Create storage pools configuration
    POOLS_CONFIG="${TARGET_MOUNT}/config/limiquantix/storage-pools.yaml"
    mkdir -p "$(dirname "$POOLS_CONFIG")"
    
    cat > "$POOLS_CONFIG" << EOF
# Quantix-OS Storage Pools Configuration
# Generated by installer on $(date -Iseconds)
# These pools will be auto-created on first boot

storage_pools:
EOF
    
    for pool_spec in $STORAGE_POOLS; do
        POOL_DISK=$(echo "$pool_spec" | cut -d: -f1)
        POOL_NAME=$(echo "$pool_spec" | cut -d: -f2)
        
        if [ ! -b "$POOL_DISK" ]; then
            log_warn "Storage pool disk not found: $POOL_DISK - skipping"
            continue
        fi
        
        log_info "Initializing storage pool: $POOL_NAME on $POOL_DISK"
        
        # Determine partition suffix for this disk
        case "$POOL_DISK" in
            /dev/nvme*|/dev/mmcblk*)
                POOL_P="p"
                ;;
            *)
                POOL_P=""
                ;;
        esac
        
        # Wipe existing partitions
        dd if=/dev/zero of="$POOL_DISK" bs=512 count=34 2>/dev/null || true
        
        # Create single partition spanning entire disk
        parted -s "$POOL_DISK" mklabel gpt
        parted -s "$POOL_DISK" mkpart "${POOL_NAME}" xfs 1MiB 100%
        
        # Wait for partition to appear
        partprobe "$POOL_DISK" 2>/dev/null || true
        sleep 2
        
        POOL_PART="${POOL_DISK}${POOL_P}1"
        
        # Format with XFS (optimal for VM storage)
        log_info "Formatting $POOL_PART with XFS..."
        mkfs.xfs -L "$POOL_NAME" -f "$POOL_PART"
        
        # Get UUID for the partition
        POOL_UUID=$(blkid -s UUID -o value "$POOL_PART")
        
        # Add to storage pools config
        cat >> "$POOLS_CONFIG" << EOF
  - name: ${POOL_NAME}
    disk: ${POOL_DISK}
    partition: ${POOL_PART}
    uuid: ${POOL_UUID}
    filesystem: xfs
    mount_point: /data/pools/${POOL_NAME}
EOF
        
        # Create mount point in data partition
        mkdir -p "${TARGET_MOUNT}/data/pools/${POOL_NAME}"
        
        # Add to fstab configuration
        echo "UUID=${POOL_UUID} /data/pools/${POOL_NAME} xfs defaults,nofail 0 2" >> "${TARGET_MOUNT}/config/fstab.pools"
        
        log_info "Storage pool $POOL_NAME initialized (UUID: $POOL_UUID)"
    done
    
    log_info "Storage pools configured"
    
    CURRENT_STEP=7
else
    CURRENT_STEP=6
fi

# =============================================================================
# Step: Set Root Password
# =============================================================================
log_step "Step ${CURRENT_STEP}/${TOTAL_STEPS}: Setting root password..."

if [ -n "$ROOT_PASSWORD" ]; then
    # Mount squashfs to access shadow file
    mkdir -p "${TARGET_MOUNT}/root"
    mount -t squashfs "${TARGET_MOUNT}/system/quantix/system.squashfs" "${TARGET_MOUNT}/root"
    
    # Copy shadow file to config
    mkdir -p "${TARGET_MOUNT}/config/auth"
    
    # Generate password hash
    PASS_HASH=$(echo "$ROOT_PASSWORD" | openssl passwd -6 -stdin)
    
    # Create shadow override
    echo "root:${PASS_HASH}:19000:0:99999:7:::" > "${TARGET_MOUNT}/config/auth/shadow.override"
    chmod 600 "${TARGET_MOUNT}/config/auth/shadow.override"
    
    umount "${TARGET_MOUNT}/root"
    
    log_info "Root password configured"
else
    log_warn "No root password set"
fi

# Increment step counter
CURRENT_STEP=$((CURRENT_STEP + 1))

# =============================================================================
# Step: Install Bootloader
# =============================================================================
log_step "Step ${CURRENT_STEP}/${TOTAL_STEPS}: Installing bootloader..."
    
# Get partition UUIDs
UUID_SYS_A=$(blkid -s UUID -o value "${PART_SYS_A}")
UUID_CFG=$(blkid -s UUID -o value "${PART_CFG}")
UUID_DATA=$(blkid -s UUID -o value "${PART_DATA}")
    
    # Mount system for chroot
mkdir -p "${TARGET_MOUNT}/root"
mount -t squashfs "${TARGET_MOUNT}/system/quantix/system.squashfs" "${TARGET_MOUNT}/root"
    
    # Bind mount EFI
mkdir -p "${TARGET_MOUNT}/root/boot/efi"
mount --bind "${TARGET_MOUNT}/efi" "${TARGET_MOUNT}/root/boot/efi"
    
    # Bind mount required filesystems
mount --bind /dev "${TARGET_MOUNT}/root/dev"
mount --bind /proc "${TARGET_MOUNT}/root/proc"
mount --bind /sys "${TARGET_MOUNT}/root/sys"
    
    # Install GRUB for UEFI
    log_info "Installing GRUB for UEFI..."
chroot "${TARGET_MOUNT}/root" grub-install \
        --target=x86_64-efi \
        --efi-directory=/boot/efi \
        --bootloader-id=quantix \
    --removable \
        --recheck \
    "${TARGET_DISK}" 2>/dev/null || log_warn "UEFI GRUB failed (may be BIOS system)"
    
    # Create GRUB configuration
    log_info "Creating GRUB configuration..."
    
cat > "${TARGET_MOUNT}/root/boot/grub/grub.cfg" << EOF
# Quantix-OS GRUB Configuration
# Version: ${VERSION}

set timeout=5
set default=0

insmod all_video
insmod gfxterm
set gfxmode=auto
terminal_output gfxterm

set menu_color_normal=white/black
set menu_color_highlight=black/light-cyan

menuentry "Quantix-OS v${VERSION}" --id quantix {
    echo "Loading Quantix-OS v${VERSION}..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS v${VERSION} (System B)" --id quantix-b {
    echo "Loading Quantix-OS from System B..."
    search --label --set=root QUANTIX-B
    linux /boot/vmlinuz root=LABEL=QUANTIX-B ro quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS v${VERSION} (Safe Mode)" --id safe {
    echo "Loading Quantix-OS in safe mode..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro single nomodeset
    initrd /boot/initramfs
}

menuentry "Quantix-OS v${VERSION} (Recovery Shell)" --id recovery {
    echo "Loading recovery shell..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro init=/bin/sh
    initrd /boot/initramfs
}
EOF
    
    # Copy GRUB config to EFI partition
mkdir -p "${TARGET_MOUNT}/efi/EFI/quantix"
cp "${TARGET_MOUNT}/root/boot/grub/grub.cfg" "${TARGET_MOUNT}/efi/EFI/quantix/"
    
    # Cleanup mounts
umount "${TARGET_MOUNT}/root/sys" 2>/dev/null || true
umount "${TARGET_MOUNT}/root/proc" 2>/dev/null || true
umount "${TARGET_MOUNT}/root/dev" 2>/dev/null || true
umount "${TARGET_MOUNT}/root/boot/efi" 2>/dev/null || true
umount "${TARGET_MOUNT}/root" 2>/dev/null || true
    
    log_info "Bootloader installed"

# Increment step counter
CURRENT_STEP=$((CURRENT_STEP + 1))

# =============================================================================
# Step: Finalize
# =============================================================================
log_step "Step ${CURRENT_STEP}/${TOTAL_STEPS}: Finalizing installation..."

# Sync filesystems
sync
    
    # Unmount all partitions
umount "${TARGET_MOUNT}/data" 2>/dev/null || true
umount "${TARGET_MOUNT}/config" 2>/dev/null || true
umount "${TARGET_MOUNT}/efi" 2>/dev/null || true
umount "${TARGET_MOUNT}/system" 2>/dev/null || true
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                           ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
echo -e "${GREEN}║  Quantix-OS v${VERSION} has been installed successfully.          ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
echo -e "${GREEN}║  Next Steps:                                                  ║${NC}"
    echo -e "${GREEN}║  1. Remove the installation media                             ║${NC}"
    echo -e "${GREEN}║  2. Reboot the system                                         ║${NC}"
echo -e "${GREEN}║  3. Access the console TUI on the local display               ║${NC}"
echo -e "${GREEN}║  4. Access web management at https://<ip>:8443/               ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

# Clear fail marker on success
rm -f /tmp/.quantix_install_failed 2>/dev/null || true
rm -f /tmp/.quantix_install_mode 2>/dev/null || true
    
exit 0
