#!/bin/bash
# =============================================================================
# Quantix-vDC Boot Initramfs Builder
# =============================================================================
# This creates a minimal initramfs for booting the INSTALLED system (not the
# installer). It's used as a fallback if Alpine's mkinitfs doesn't work.
#
# Key differences from build-installer-initramfs.sh:
# - Mounts root filesystem by UUID/LABEL
# - Does switch_root to /sysroot
# - No installer TUI or squashfs mounting
# =============================================================================

set -e

# Configuration
VERSION="${1:-1.0.0}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
WORK_DIR="${WORK_DIR:-/work}"
BOOT_INITRAMFS_NAME="boot-initramfs-${VERSION}.cpio.gz"
INITRAMFS_DIR="/tmp/boot-initramfs"

echo "=========================================="
echo "Building Boot Initramfs for Installed System"
echo "=========================================="
echo "Version: ${VERSION}"
echo "Output: ${OUTPUT_DIR}/${BOOT_INITRAMFS_NAME}"
echo ""

# Clean up any previous build
rm -rf "${INITRAMFS_DIR}"

# Create directory structure
echo "📦 Creating boot initramfs structure..."
mkdir -p "${INITRAMFS_DIR}"/{bin,sbin,lib,proc,sys,dev,mnt,newroot,etc,usr/bin,usr/sbin}

# =============================================================================
# Copy busybox (static)
# =============================================================================
echo "   Copying busybox..."
if [ -f /bin/busybox.static ]; then
    cp /bin/busybox.static "${INITRAMFS_DIR}/bin/busybox"
elif [ -f /bin/busybox ]; then
    cp /bin/busybox "${INITRAMFS_DIR}/bin/busybox"
else
    echo "❌ ERROR: busybox not found!"
    exit 1
fi
chmod +x "${INITRAMFS_DIR}/bin/busybox"

# Create essential symlinks
for cmd in sh ash mount umount switch_root pivot_root mkdir mknod cat echo ls sleep modprobe insmod blkid; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/$cmd"
done

for cmd in modprobe insmod switch_root; do
    ln -sf ../bin/busybox "${INITRAMFS_DIR}/sbin/$cmd"
done

# =============================================================================
# Copy kernel modules
# =============================================================================
echo "   Copying kernel modules..."
if [ -d "${OUTPUT_DIR}/modules" ]; then
    KERNEL_VERSION=$(ls "${OUTPUT_DIR}/modules" 2>/dev/null | head -1)
    if [ -n "$KERNEL_VERSION" ]; then
        mkdir -p "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}"
        cp -a "${OUTPUT_DIR}/modules/${KERNEL_VERSION}"/* \
            "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}/" 2>/dev/null || true
        
        MODULE_COUNT=$(find "${INITRAMFS_DIR}/lib/modules" -name "*.ko*" 2>/dev/null | wc -l)
        echo "   ✅ Copied ${MODULE_COUNT} modules for kernel ${KERNEL_VERSION}"
        
        # Run depmod
        depmod -b "${INITRAMFS_DIR}" "${KERNEL_VERSION}" 2>/dev/null || true
    fi
fi

# =============================================================================
# Create /init script for boot
# =============================================================================
echo "   Creating /init script..."
cat > "${INITRAMFS_DIR}/init" << 'INITEOF'
#!/bin/sh
# Quantix-vDC Boot Init Script
# This mounts the root filesystem and switches to it

# Mount essential filesystems
mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts

# Parse kernel command line
ROOT=""
ROOTFSTYPE="ext4"
for param in $(cat /proc/cmdline); do
    case "$param" in
        root=*)
            ROOT="${param#root=}"
            ;;
        rootfstype=*)
            ROOTFSTYPE="${param#rootfstype=}"
            ;;
    esac
done

echo "[INIT] Root device: $ROOT"

# Load essential modules
for mod in loop squashfs overlay ext4 nvme nvme_core ahci sd_mod sr_mod usb_storage xhci_hcd xhci_pci virtio_blk virtio_pci; do
    modprobe $mod 2>/dev/null || true
done

# Wait for devices
sleep 2
mdev -s 2>/dev/null || true

# Resolve UUID/LABEL to device
REAL_ROOT="$ROOT"
case "$ROOT" in
    UUID=*)
        UUID="${ROOT#UUID=}"
        echo "[INIT] Looking for UUID: $UUID"
        sleep 1
        REAL_ROOT=$(blkid -U "$UUID" 2>/dev/null)
        ;;
    LABEL=*)
        LABEL="${ROOT#LABEL=}"
        echo "[INIT] Looking for LABEL: $LABEL"
        REAL_ROOT=$(blkid -L "$LABEL" 2>/dev/null)
        ;;
esac

if [ -z "$REAL_ROOT" ]; then
    echo "[INIT] ERROR: Could not resolve root device: $ROOT"
    echo "[INIT] Available devices:"
    blkid
    echo "[INIT] Dropping to shell..."
    exec /bin/sh
fi

echo "[INIT] Resolved root to: $REAL_ROOT"

# Create mount point and mount root
mkdir -p /newroot
echo "[INIT] Mounting $REAL_ROOT..."
if ! mount -t "$ROOTFSTYPE" -o ro "$REAL_ROOT" /newroot; then
    echo "[INIT] ERROR: Failed to mount root filesystem!"
    echo "[INIT] Trying other filesystem types..."
    for fs in ext4 ext3 ext2 xfs btrfs; do
        if mount -t "$fs" -o ro "$REAL_ROOT" /newroot 2>/dev/null; then
            echo "[INIT] Mounted with $fs"
            break
        fi
    done
fi

# Verify mount
if ! mountpoint -q /newroot; then
    echo "[INIT] ERROR: Root not mounted!"
    echo "[INIT] Dropping to shell..."
    exec /bin/sh
fi

echo "[INIT] Root mounted successfully"

# Check for init in new root
if [ -x /newroot/sbin/init ]; then
    INIT=/sbin/init
elif [ -x /newroot/sbin/openrc-init ]; then
    INIT=/sbin/openrc-init
elif [ -x /newroot/lib/systemd/systemd ]; then
    INIT=/lib/systemd/systemd
else
    echo "[INIT] WARNING: No init found, trying /sbin/init anyway"
    INIT=/sbin/init
fi

echo "[INIT] Switching to real root with init: $INIT"

# Clean up
umount /dev/pts 2>/dev/null || true
umount /proc 2>/dev/null || true
umount /sys 2>/dev/null || true
umount /dev 2>/dev/null || true

# Switch to real root
exec switch_root /newroot "$INIT"

# If switch_root fails
echo "[INIT] ERROR: switch_root failed!"
exec /bin/sh
INITEOF

chmod +x "${INITRAMFS_DIR}/init"

# =============================================================================
# Create the initramfs archive
# =============================================================================
echo "   Creating initramfs archive..."
(cd "${INITRAMFS_DIR}" && find . | cpio -H newc -o 2>/dev/null | gzip -9) > "${OUTPUT_DIR}/${BOOT_INITRAMFS_NAME}"

# Calculate size
INITRAMFS_SIZE=$(du -h "${OUTPUT_DIR}/${BOOT_INITRAMFS_NAME}" | cut -f1)

echo ""
echo "✅ Boot initramfs created:"
echo "   File: ${OUTPUT_DIR}/${BOOT_INITRAMFS_NAME}"
echo "   Size: ${INITRAMFS_SIZE}"

# Cleanup
rm -rf "${INITRAMFS_DIR}"
