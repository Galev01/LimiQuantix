#!/bin/bash
# =============================================================================
# Quantix-vDC Installer Initramfs Builder
# =============================================================================
# Creates a minimal initramfs that boots into the Quantix-vDC installer TUI.
#
# Usage: ./build-installer-initramfs.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
INITRAMFS_DIR="/tmp/initramfs"
INITRAMFS_NAME="installer-initramfs.img"

echo "📦 Building Quantix-vDC installer initramfs..."

# Clean previous build
rm -rf "${INITRAMFS_DIR}"
mkdir -p "${INITRAMFS_DIR}"

# Create directory structure
mkdir -p "${INITRAMFS_DIR}"/{bin,sbin,lib,lib64,dev,proc,sys,mnt,tmp,run,etc,usr/bin,usr/sbin,usr/lib}
mkdir -p "${INITRAMFS_DIR}/mnt"/{cdrom,target,rootfs}
mkdir -p "${INITRAMFS_DIR}/installer"

# Copy busybox
if [ -f /bin/busybox ]; then
    cp /bin/busybox "${INITRAMFS_DIR}/bin/"
    chmod +x "${INITRAMFS_DIR}/bin/busybox"
    
    # Create symlinks for essential commands
    for cmd in sh ash bash ls cat cp mv rm mkdir mount umount mknod grep sed awk \
               sleep echo ln chmod chown chroot switch_root modprobe insmod \
               fdisk sfdisk parted mkfs.ext4 mkfs.vfat blkid lsblk dd clear \
               ip ifconfig route ping hostname; do
        ln -sf busybox "${INITRAMFS_DIR}/bin/$cmd" 2>/dev/null || true
    done
fi

# Copy dialog for TUI
if [ -f /usr/bin/dialog ]; then
    cp /usr/bin/dialog "${INITRAMFS_DIR}/usr/bin/"
    chmod +x "${INITRAMFS_DIR}/usr/bin/dialog"
    
    # Copy dialog dependencies
    for lib in $(ldd /usr/bin/dialog 2>/dev/null | grep "=>" | awk '{print $3}' | grep -v "not found"); do
        if [ -f "$lib" ]; then
            cp "$lib" "${INITRAMFS_DIR}/lib/" 2>/dev/null || true
        fi
    done
fi

# Copy ncurses libraries
for lib in libncursesw.so* libncurses.so* libtinfo.so*; do
    find /lib /usr/lib -name "$lib" -exec cp {} "${INITRAMFS_DIR}/lib/" \; 2>/dev/null || true
done

# Copy essential libraries
for lib in /lib/ld-musl* /lib/libc.musl* /lib/libblkid.so* /lib/libuuid.so* /lib/libfdisk.so*; do
    if [ -e "$lib" ]; then
        cp "$lib" "${INITRAMFS_DIR}/lib/" 2>/dev/null || true
    fi
done

# Copy parted and fdisk
for tool in parted fdisk sfdisk; do
    if [ -f "/sbin/$tool" ]; then
        cp "/sbin/$tool" "${INITRAMFS_DIR}/sbin/"
        chmod +x "${INITRAMFS_DIR}/sbin/$tool"
    elif [ -f "/usr/sbin/$tool" ]; then
        cp "/usr/sbin/$tool" "${INITRAMFS_DIR}/sbin/"
        chmod +x "${INITRAMFS_DIR}/sbin/$tool"
    fi
done

# Copy mkfs tools
for tool in mkfs.ext4 mkfs.vfat mke2fs; do
    if [ -f "/sbin/$tool" ]; then
        cp "/sbin/$tool" "${INITRAMFS_DIR}/sbin/"
        chmod +x "${INITRAMFS_DIR}/sbin/$tool"
    fi
done

# Copy kernel modules (essential for boot)
if [ -d "${OUTPUT_DIR}/modules" ]; then
    KERNEL_VERSION=$(ls "${OUTPUT_DIR}/modules" 2>/dev/null | head -1)
    if [ -n "$KERNEL_VERSION" ]; then
        mkdir -p "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}/kernel"
        
        # Copy essential modules for disk and USB access
        for mod_path in drivers/block drivers/scsi drivers/usb drivers/ata \
                        drivers/nvme drivers/virtio drivers/mmc fs/squashfs \
                        fs/ext4 fs/fat fs/vfat; do
            if [ -d "${OUTPUT_DIR}/modules/${KERNEL_VERSION}/kernel/${mod_path}" ]; then
                mkdir -p "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}/kernel/${mod_path}"
                cp -r "${OUTPUT_DIR}/modules/${KERNEL_VERSION}/kernel/${mod_path}"/* \
                    "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}/kernel/${mod_path}/" 2>/dev/null || true
            fi
        done
        
        # Copy modules.* files
        cp "${OUTPUT_DIR}/modules/${KERNEL_VERSION}"/modules.* \
            "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}/" 2>/dev/null || true
    fi
fi

# Copy installer scripts
cp "${WORK_DIR}/installer/install.sh" "${INITRAMFS_DIR}/installer/" 2>/dev/null || true
cp "${WORK_DIR}/installer/tui.sh" "${INITRAMFS_DIR}/installer/" 2>/dev/null || true
chmod +x "${INITRAMFS_DIR}/installer/"* 2>/dev/null || true

# Create /etc/passwd and /etc/group
cat > "${INITRAMFS_DIR}/etc/passwd" << 'EOF'
root:x:0:0:root:/root:/bin/sh
EOF

cat > "${INITRAMFS_DIR}/etc/group" << 'EOF'
root:x:0:
EOF

# Create init script
cat > "${INITRAMFS_DIR}/init" << 'INITEOF'
#!/bin/sh
# Quantix-vDC Installer Init

# Mount essential filesystems
mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev
mkdir -p /dev/pts /dev/shm
mount -t devpts devpts /dev/pts
mount -t tmpfs tmpfs /dev/shm
mount -t tmpfs tmpfs /run
mount -t tmpfs tmpfs /tmp

# Parse kernel command line
BOOT_MODE=""
DEBUG=""
BREAK=""

for opt in $(cat /proc/cmdline); do
    case "$opt" in
        boot=*) BOOT_MODE="${opt#boot=}" ;;
        debug) DEBUG=1 ;;
        break=*) BREAK="${opt#break=}" ;;
    esac
done

# Debug mode
if [ -n "$DEBUG" ]; then
    set -x
fi

# Load essential kernel modules
echo "Loading kernel modules..."
modprobe -q virtio_pci 2>/dev/null || true
modprobe -q virtio_blk 2>/dev/null || true
modprobe -q virtio_scsi 2>/dev/null || true
modprobe -q virtio_net 2>/dev/null || true
modprobe -q sd_mod 2>/dev/null || true
modprobe -q ahci 2>/dev/null || true
modprobe -q nvme 2>/dev/null || true
modprobe -q usb_storage 2>/dev/null || true
modprobe -q xhci_hcd 2>/dev/null || true
modprobe -q ehci_hcd 2>/dev/null || true
modprobe -q loop 2>/dev/null || true
modprobe -q squashfs 2>/dev/null || true
modprobe -q ext4 2>/dev/null || true
modprobe -q vfat 2>/dev/null || true

# Wait for devices to settle
sleep 2

# Break point for debugging
if [ "$BREAK" = "premount" ]; then
    echo ""
    echo "Break point: premount"
    echo "Dropping to shell..."
    exec /bin/sh
fi

# Find and mount the installation media
echo "Searching for installation media..."
CDROM_DEV=""

for dev in /dev/sr0 /dev/sr1 /dev/cdrom /dev/vda /dev/vdb /dev/sda /dev/sdb; do
    if [ -b "$dev" ]; then
        if mount -t iso9660 -o ro "$dev" /mnt/cdrom 2>/dev/null; then
            if [ -f /mnt/cdrom/quantix-vdc/system.squashfs ]; then
                CDROM_DEV="$dev"
                echo "Found installation media at $dev"
                break
            fi
            umount /mnt/cdrom
        fi
    fi
done

if [ -z "$CDROM_DEV" ]; then
    echo "ERROR: Could not find installation media!"
    echo "Looking for quantix-vdc/system.squashfs on removable media..."
    echo ""
    echo "Available block devices:"
    ls -la /dev/sd* /dev/vd* /dev/sr* /dev/nvme* 2>/dev/null || true
    echo ""
    echo "Dropping to rescue shell..."
    exec /bin/sh
fi

# Mount squashfs
echo "Mounting system image..."
mount -t squashfs -o ro /mnt/cdrom/quantix-vdc/system.squashfs /mnt/rootfs || {
    echo "ERROR: Failed to mount system image!"
    exec /bin/sh
}

# Launch installer
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-vDC Installer Starting...                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Export environment for installer
export CDROM_DEV
export SQUASHFS_PATH="/mnt/cdrom/quantix-vdc/system.squashfs"
export ROOTFS_PATH="/mnt/rootfs"

# Run installer TUI
if [ -f /installer/tui.sh ]; then
    exec /bin/sh /installer/tui.sh
elif [ -f /installer/install.sh ]; then
    exec /bin/sh /installer/install.sh
else
    echo "No installer scripts found!"
    echo "Dropping to shell..."
    exec /bin/sh
fi
INITEOF

chmod +x "${INITRAMFS_DIR}/init"

# Create the initramfs image
echo "   Creating initramfs archive..."
mkdir -p "${OUTPUT_DIR}"
(cd "${INITRAMFS_DIR}" && find . | cpio -H newc -o | gzip -9) > "${OUTPUT_DIR}/${INITRAMFS_NAME}"

# Calculate size
INITRAMFS_SIZE=$(du -h "${OUTPUT_DIR}/${INITRAMFS_NAME}" | cut -f1)

echo "✅ Installer initramfs created: ${OUTPUT_DIR}/${INITRAMFS_NAME} (${INITRAMFS_SIZE})"

# Cleanup
rm -rf "${INITRAMFS_DIR}"
