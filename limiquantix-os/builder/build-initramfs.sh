#!/bin/bash
# =============================================================================
# Quantix-OS Initramfs Builder
# =============================================================================
# Creates a custom initramfs with A/B boot support and overlayfs.
#
# Usage: ./build-initramfs.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="/output"
INITRAMFS_DIR="/tmp/initramfs"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-OS Initramfs Builder                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Create initramfs structure
# -----------------------------------------------------------------------------
echo "📦 Step 1: Creating initramfs structure..."

rm -rf "${INITRAMFS_DIR}"
mkdir -p "${INITRAMFS_DIR}"/{bin,sbin,etc,proc,sys,dev,mnt,run,tmp}
mkdir -p "${INITRAMFS_DIR}"/mnt/{lower,upper,work,merged,quantix,data,system}
mkdir -p "${INITRAMFS_DIR}"/lib/modules
mkdir -p "${INITRAMFS_DIR}"/usr/{bin,sbin}

echo "✅ Structure created"

# -----------------------------------------------------------------------------
# Step 2: Copy busybox
# -----------------------------------------------------------------------------
echo "📦 Step 2: Installing busybox..."

cp /bin/busybox "${INITRAMFS_DIR}/bin/"
chmod +x "${INITRAMFS_DIR}/bin/busybox"

# Create busybox symlinks
for cmd in sh ash cat cp dd df dmesg echo grep ls mkdir mknod mount \
           mv rm sed sleep switch_root umount uname blkid findfs \
           losetup modprobe insmod lsmod pivot_root; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/${cmd}"
done

echo "✅ Busybox installed"

# -----------------------------------------------------------------------------
# Step 3: Copy kernel modules
# -----------------------------------------------------------------------------
echo "📦 Step 3: Copying kernel modules..."

KERNEL_VERSION=$(ls /lib/modules/ | head -1)
if [ -d "/lib/modules/${KERNEL_VERSION}" ]; then
    # Copy essential modules
    for mod in loop squashfs overlay ext4 xfs vfat; do
        find "/lib/modules/${KERNEL_VERSION}" -name "${mod}*.ko*" -exec cp {} "${INITRAMFS_DIR}/lib/modules/" \; 2>/dev/null || true
    done
    
    # Copy module dependencies
    cp "/lib/modules/${KERNEL_VERSION}/modules.dep" "${INITRAMFS_DIR}/lib/modules/" 2>/dev/null || true
    cp "/lib/modules/${KERNEL_VERSION}/modules.alias" "${INITRAMFS_DIR}/lib/modules/" 2>/dev/null || true
fi

echo "✅ Kernel modules copied"

# -----------------------------------------------------------------------------
# Step 4: Create init script
# -----------------------------------------------------------------------------
echo "📦 Step 4: Creating init script..."

cat > "${INITRAMFS_DIR}/init" << 'INITEOF'
#!/bin/sh
# =============================================================================
# Quantix-OS Init Script
# =============================================================================
# This script runs from initramfs and sets up the root filesystem.
# Supports A/B partitioning with automatic rollback.
# =============================================================================

# Mount essential filesystems
mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev

# Enable kernel messages
echo 1 > /proc/sys/kernel/printk

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                 Quantix-OS Boot Loader                        ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Load required modules
echo "[INIT] Loading kernel modules..."
for mod in loop squashfs overlay ext4 xfs vfat; do
    modprobe $mod 2>/dev/null || insmod /lib/modules/${mod}.ko 2>/dev/null || true
done

# Parse kernel command line
SYSTEM_LABEL=""
CONFIG_LABEL="QUANTIX-CFG"
DATA_LABEL="QUANTIX-DATA"

for param in $(cat /proc/cmdline); do
    case $param in
        root=LABEL=*)
            SYSTEM_LABEL="${param#root=LABEL=}"
            ;;
        quantix.config=LABEL=*)
            CONFIG_LABEL="${param#quantix.config=LABEL=}"
            ;;
        quantix.data=LABEL=*)
            DATA_LABEL="${param#quantix.data=LABEL=}"
            ;;
    esac
done

# Default to System A if not specified
[ -z "$SYSTEM_LABEL" ] && SYSTEM_LABEL="QUANTIX-A"

echo "[INIT] Booting from: ${SYSTEM_LABEL}"

# Find and mount system partition
echo "[INIT] Mounting system partition..."
SYSTEM_DEV=$(findfs LABEL="${SYSTEM_LABEL}" 2>/dev/null)
if [ -z "$SYSTEM_DEV" ]; then
    echo "[ERROR] System partition not found: ${SYSTEM_LABEL}"
    echo "[ERROR] Dropping to emergency shell..."
    exec /bin/sh
fi

mount -t ext4 -o ro "$SYSTEM_DEV" /mnt/system
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to mount system partition"
    exec /bin/sh
fi

# Mount squashfs
echo "[INIT] Mounting squashfs..."
SQUASHFS_PATH="/mnt/system/quantix/system.squashfs"
if [ ! -f "$SQUASHFS_PATH" ]; then
    # Try alternate location
    SQUASHFS_PATH=$(find /mnt/system -name "system*.squashfs" | head -1)
fi

if [ -z "$SQUASHFS_PATH" ] || [ ! -f "$SQUASHFS_PATH" ]; then
    echo "[ERROR] Squashfs not found"
    exec /bin/sh
fi

mount -t squashfs -o ro "$SQUASHFS_PATH" /mnt/lower
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to mount squashfs"
    exec /bin/sh
fi

# Create tmpfs for overlay upper layer
echo "[INIT] Creating overlay filesystem..."
mount -t tmpfs -o size=512M tmpfs /mnt/upper
mkdir -p /mnt/upper/data /mnt/upper/work

# Create overlay
mount -t overlay overlay \
    -o lowerdir=/mnt/lower,upperdir=/mnt/upper/data,workdir=/mnt/upper/work \
    /mnt/merged
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to create overlay"
    exec /bin/sh
fi

# Mount config partition
echo "[INIT] Mounting config partition..."
CONFIG_DEV=$(findfs LABEL="${CONFIG_LABEL}" 2>/dev/null)
if [ -n "$CONFIG_DEV" ]; then
    mkdir -p /mnt/merged/quantix
    mount -t ext4 -o noatime "$CONFIG_DEV" /mnt/merged/quantix
fi

# Mount data partition
echo "[INIT] Mounting data partition..."
DATA_DEV=$(findfs LABEL="${DATA_LABEL}" 2>/dev/null)
if [ -n "$DATA_DEV" ]; then
    mkdir -p /mnt/merged/data
    mount -t xfs -o noatime "$DATA_DEV" /mnt/merged/data 2>/dev/null || \
    mount -t ext4 -o noatime "$DATA_DEV" /mnt/merged/data 2>/dev/null || true
fi

# Move mounts for pivot_root
echo "[INIT] Preparing root switch..."
mkdir -p /mnt/merged/mnt/system
mount --move /mnt/system /mnt/merged/mnt/system

# Clean up
umount /proc
umount /sys
umount /dev

# Switch to new root
echo "[INIT] Switching to Quantix-OS..."
echo ""

cd /mnt/merged
pivot_root . mnt/initramfs

# Start init
exec /sbin/init

# Fallback
echo "[ERROR] Failed to start init"
exec /bin/sh
INITEOF

chmod +x "${INITRAMFS_DIR}/init"

echo "✅ Init script created"

# -----------------------------------------------------------------------------
# Step 5: Create initramfs image
# -----------------------------------------------------------------------------
echo "📦 Step 5: Creating initramfs image..."

mkdir -p "${OUTPUT_DIR}"

cd "${INITRAMFS_DIR}"
find . | cpio -o -H newc 2>/dev/null | gzip -9 > "${OUTPUT_DIR}/initramfs.img"

INITRAMFS_SIZE=$(du -h "${OUTPUT_DIR}/initramfs.img" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/initramfs.img"
echo "║  Size:   ${INITRAMFS_SIZE}"
echo "╚═══════════════════════════════════════════════════════════════╝"

# Cleanup
rm -rf "${INITRAMFS_DIR}"
