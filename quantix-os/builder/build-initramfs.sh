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
mkdir -p "${INITRAMFS_DIR}"/mnt/{lower,upper,work,merged,quantix,data,system,cdrom,usb,toram,initramfs}
mkdir -p "${INITRAMFS_DIR}"/lib/modules
mkdir -p "${INITRAMFS_DIR}"/usr/{bin,sbin}

echo "✅ Structure created"

# -----------------------------------------------------------------------------
# Step 2: Copy busybox
# -----------------------------------------------------------------------------
echo "📦 Step 2: Installing busybox..."

cp /bin/busybox "${INITRAMFS_DIR}/bin/"
chmod +x "${INITRAMFS_DIR}/bin/busybox"

# Create busybox symlinks - include all commands needed for Live boot
for cmd in sh ash cat cp dd df dmesg echo grep ls mkdir mknod mount \
           mv rm sed sleep switch_root umount uname blkid findfs \
           losetup modprobe insmod lsmod pivot_root find head tail \
           mdev true false test expr; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/${cmd}"
done

echo "✅ Busybox installed"

# -----------------------------------------------------------------------------
# Step 3: Copy kernel modules
# -----------------------------------------------------------------------------
echo "📦 Step 3: Copying kernel modules..."

KERNEL_VERSION=$(ls /lib/modules/ 2>/dev/null | head -1)
if [ -n "$KERNEL_VERSION" ] && [ -d "/lib/modules/${KERNEL_VERSION}" ]; then
    # Copy essential modules for Live boot (CD-ROM, USB, filesystems)
    for mod in loop squashfs overlay ext4 xfs vfat iso9660 sr_mod cdrom \
               usb_storage uhci_hcd ohci_hcd ehci_hcd xhci_hcd xhci_pci \
               virtio virtio_pci virtio_blk virtio_scsi nvme; do
        find "/lib/modules/${KERNEL_VERSION}" -name "${mod}*.ko*" -exec cp {} "${INITRAMFS_DIR}/lib/modules/" \; 2>/dev/null || true
    done
    
    # Copy module dependencies
    cp "/lib/modules/${KERNEL_VERSION}/modules.dep" "${INITRAMFS_DIR}/lib/modules/" 2>/dev/null || true
    cp "/lib/modules/${KERNEL_VERSION}/modules.alias" "${INITRAMFS_DIR}/lib/modules/" 2>/dev/null || true
    echo "   Copied modules for kernel ${KERNEL_VERSION}"
else
    echo "   Warning: No kernel modules found (will rely on built-in modules)"
fi

echo "✅ Kernel modules copied"

# -----------------------------------------------------------------------------
# Step 4: Copy init script from source
# -----------------------------------------------------------------------------
echo "📦 Step 4: Installing init script..."

# Use our custom init script that supports Live boot
if [ -f "${WORK_DIR}/initramfs/init" ]; then
    cp "${WORK_DIR}/initramfs/init" "${INITRAMFS_DIR}/init"
    chmod +x "${INITRAMFS_DIR}/init"
    echo "   Using custom init from initramfs/init"
else
    echo "❌ Custom init script not found at ${WORK_DIR}/initramfs/init"
    exit 1
fi

echo "✅ Init script installed"

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
