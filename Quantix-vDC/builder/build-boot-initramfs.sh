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
# Copy busybox (static) - CRITICAL: must be statically linked for initramfs
# =============================================================================
echo "   Copying busybox-static..."

BUSYBOX_FOUND=0
for bb_path in /bin/busybox.static /usr/bin/busybox.static /bin/busybox-static; do
    if [ -f "$bb_path" ]; then
        cp "$bb_path" "${INITRAMFS_DIR}/bin/busybox"
        BUSYBOX_FOUND=1
        echo "   Found static busybox at $bb_path"
        break
    fi
done

# Fallback to regular busybox (may fail in initramfs if not static)
if [ $BUSYBOX_FOUND -eq 0 ]; then
    if [ -f /bin/busybox ]; then
        echo "   ⚠️  WARNING: Using non-static busybox (may not work in initramfs)"
        cp /bin/busybox "${INITRAMFS_DIR}/bin/busybox"
    else
        echo "❌ ERROR: No busybox found! Install busybox-static package."
        exit 1
    fi
fi

chmod +x "${INITRAMFS_DIR}/bin/busybox"

# Create essential symlinks for busybox applets
# Core utilities
for cmd in sh ash mount umount switch_root pivot_root mkdir mknod cat echo ls sleep \
           modprobe insmod blkid grep cut sed awk tr head tail find xargs test \
           cp mv rm ln chmod chown df du ps kill killall dmesg \
           true false expr seq wc sort uniq \
           mountpoint readlink basename dirname pwd date; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/$cmd"
done

# Sbin commands
for cmd in modprobe insmod switch_root pivot_root mdev; do
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

# Critical: Setup console FIRST before anything else
# Create dev directory and console device manually before devtmpfs
mkdir -p /dev
mknod -m 622 /dev/console c 5 1 2>/dev/null || true
mknod -m 666 /dev/null c 1 3 2>/dev/null || true
mknod -m 666 /dev/tty c 5 0 2>/dev/null || true
mknod -m 666 /dev/tty0 c 4 0 2>/dev/null || true
mknod -m 666 /dev/tty1 c 4 1 2>/dev/null || true

# Redirect stdout/stderr to console for visibility
exec 0</dev/console
exec 1>/dev/console
exec 2>/dev/console

echo "[BOOT] Quantix-vDC Boot Initramfs Starting..."
echo "[BOOT] $(date 2>/dev/null || echo 'Boot time')"

# Mount essential filesystems
echo "[BOOT] Mounting proc..."
mount -t proc none /proc
echo "[BOOT] Mounting sysfs..."
mount -t sysfs none /sys
echo "[BOOT] Mounting devtmpfs..."
mount -t devtmpfs none /dev 2>/dev/null || mount -t tmpfs none /dev

# Recreate console after devtmpfs mount
mknod -m 622 /dev/console c 5 1 2>/dev/null || true
mknod -m 666 /dev/null c 1 3 2>/dev/null || true
mknod -m 666 /dev/tty c 5 0 2>/dev/null || true
mknod -m 666 /dev/tty0 c 4 0 2>/dev/null || true

mkdir -p /dev/pts
mount -t devpts devpts /dev/pts 2>/dev/null || true

echo "[BOOT] Filesystems mounted"

# Load framebuffer/graphics drivers EARLY for console visibility
echo "[BOOT] Loading graphics drivers..."
for mod in efifb vesafb simplefb drm drm_kms_helper i915 nouveau amdgpu radeon; do
    modprobe $mod 2>/dev/null || true
done

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

echo "[BOOT] Root device from cmdline: $ROOT"

# Load essential storage modules
echo "[BOOT] Loading storage drivers..."
for mod in loop squashfs overlay ext4 nvme nvme_core ahci libata sd_mod sr_mod usb_storage xhci_hcd xhci_pci virtio_blk virtio_pci; do
    modprobe $mod 2>/dev/null || true
done

# Wait for devices
echo "[BOOT] Waiting for devices to settle..."
sleep 2
mdev -s 2>/dev/null || true
sleep 1
mdev -s 2>/dev/null || true

echo "[BOOT] Available block devices:"
ls -la /dev/nvme* /dev/sd* /dev/vd* 2>/dev/null || echo "[BOOT] No block devices found yet"

# Function to find device by UUID (busybox compatible)
find_by_uuid() {
    local target_uuid="$1"
    for dev in /dev/nvme*p* /dev/sd[a-z]* /dev/vd[a-z]*; do
        [ -b "$dev" ] || continue
        dev_uuid=$(blkid "$dev" 2>/dev/null | grep -o 'UUID="[^"]*"' | cut -d'"' -f2)
        if [ "$dev_uuid" = "$target_uuid" ]; then
            echo "$dev"
            return 0
        fi
    done
    return 1
}

# Function to find device by LABEL (busybox compatible)
find_by_label() {
    local target_label="$1"
    for dev in /dev/nvme*p* /dev/sd[a-z]* /dev/vd[a-z]*; do
        [ -b "$dev" ] || continue
        dev_label=$(blkid "$dev" 2>/dev/null | grep -o 'LABEL="[^"]*"' | cut -d'"' -f2)
        if [ "$dev_label" = "$target_label" ]; then
            echo "$dev"
            return 0
        fi
    done
    return 1
}

# Resolve UUID/LABEL to device
REAL_ROOT="$ROOT"
case "$ROOT" in
    UUID=*)
        UUID="${ROOT#UUID=}"
        echo "[BOOT] Looking for UUID: $UUID"
        # Try blkid -U first (works on full blkid)
        REAL_ROOT=$(blkid -U "$UUID" 2>/dev/null)
        # If that fails, parse blkid output (busybox compatible)
        if [ -z "$REAL_ROOT" ]; then
            echo "[BOOT] blkid -U failed, trying manual parse..."
            REAL_ROOT=$(find_by_uuid "$UUID")
        fi
        ;;
    LABEL=*)
        LABEL="${ROOT#LABEL=}"
        echo "[BOOT] Looking for LABEL: $LABEL"
        REAL_ROOT=$(blkid -L "$LABEL" 2>/dev/null)
        if [ -z "$REAL_ROOT" ]; then
            REAL_ROOT=$(find_by_label "$LABEL")
        fi
        ;;
esac

if [ -z "$REAL_ROOT" ]; then
    echo "[BOOT] ERROR: Could not resolve root device: $ROOT"
    echo "[BOOT] Running blkid to show available devices:"
    blkid
    echo "[BOOT] Dropping to emergency shell..."
    echo "[BOOT] You can try: mount /dev/nvme0n1p2 /newroot"
    echo "[BOOT] Type 'exit' to continue boot attempt"
    /bin/sh
    # After shell exit, try again with manual method
    if [ -n "$UUID" ]; then
        REAL_ROOT=$(find_by_uuid "$UUID")
    elif [ -n "$LABEL" ]; then
        REAL_ROOT=$(find_by_label "$LABEL")
    fi
fi

echo "[BOOT] Resolved root to: $REAL_ROOT"

# Create mount point and mount root
mkdir -p /newroot
echo "[BOOT] Mounting $REAL_ROOT as $ROOTFSTYPE..."
if ! mount -t "$ROOTFSTYPE" -o ro "$REAL_ROOT" /newroot; then
    echo "[BOOT] Failed with $ROOTFSTYPE, trying other filesystem types..."
    for fs in ext4 ext3 ext2 xfs btrfs; do
        if mount -t "$fs" -o ro "$REAL_ROOT" /newroot 2>/dev/null; then
            echo "[BOOT] Mounted with $fs"
            break
        fi
    done
fi

# Verify mount
if ! mountpoint -q /newroot; then
    echo "[BOOT] ERROR: Root not mounted!"
    echo "[BOOT] Dropping to emergency shell..."
    /bin/sh
fi

echo "[BOOT] Root mounted successfully"
echo "[BOOT] Checking for init system..."

# Check for init in new root
if [ -x /newroot/sbin/init ]; then
    INIT=/sbin/init
    echo "[BOOT] Found /sbin/init"
elif [ -x /newroot/sbin/openrc-init ]; then
    INIT=/sbin/openrc-init
    echo "[BOOT] Found OpenRC init"
elif [ -x /newroot/lib/systemd/systemd ]; then
    INIT=/lib/systemd/systemd
    echo "[BOOT] Found systemd"
else
    echo "[BOOT] WARNING: No init found, trying /sbin/init anyway"
    INIT=/sbin/init
fi

echo "[BOOT] =================================================="
echo "[BOOT] Switching to real root filesystem"
echo "[BOOT] Init: $INIT"
echo "[BOOT] =================================================="

# Clean up - only unmount what we can
umount /dev/pts 2>/dev/null || true

# Switch to real root
exec switch_root /newroot "$INIT"

# If switch_root fails
echo "[BOOT] FATAL: switch_root failed!"
echo "[BOOT] Dropping to emergency shell..."
/bin/sh
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
