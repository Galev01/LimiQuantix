#!/bin/bash
# =============================================================================
# Quantix-vDC Installer Initramfs Builder
# =============================================================================
# Creates a minimal initramfs that boots into the Quantix-vDC installer TUI.
# Based on the proven Quantix-OS initramfs architecture.
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
mkdir -p "${INITRAMFS_DIR}"/{bin,sbin,lib,lib64,dev,proc,sys,mnt,tmp,run,etc,usr/bin,usr/sbin,usr/lib,root}
mkdir -p "${INITRAMFS_DIR}/mnt"/{cdrom,target,rootfs,usb}
mkdir -p "${INITRAMFS_DIR}/installer"
mkdir -p "${INITRAMFS_DIR}/lib/modules"

# =============================================================================
# Copy busybox (CRITICAL - provides all basic commands)
# =============================================================================
echo "   Copying busybox..."
if [ -f /bin/busybox ]; then
    cp /bin/busybox "${INITRAMFS_DIR}/bin/"
    chmod +x "${INITRAMFS_DIR}/bin/busybox"
    
    # Create symlinks for ALL essential commands
    for cmd in sh ash ls cat cp mv rm mkdir rmdir mount umount mknod grep sed awk \
               sleep echo ln chmod chown chroot switch_root pivot_root \
               modprobe insmod lsmod depmod \
               fdisk sfdisk blkid lsblk dd clear dmesg \
               ip ifconfig route ping hostname uname date \
               mdev find xargs head tail sort uniq wc cut tr \
               tar gzip gunzip zcat cpio vi ps kill killall \
               sync reboot poweroff halt true false test [ expr; do
        ln -sf busybox "${INITRAMFS_DIR}/bin/$cmd" 2>/dev/null || true
    done
    
    # Also create in /sbin for compatibility
    for cmd in modprobe insmod lsmod depmod mdev blkid switch_root pivot_root reboot poweroff halt; do
        ln -sf ../bin/busybox "${INITRAMFS_DIR}/sbin/$cmd" 2>/dev/null || true
    done
else
    echo "❌ ERROR: busybox not found!"
    exit 1
fi

# =============================================================================
# Copy kernel modules (CRITICAL for device detection)
# =============================================================================
echo "   Copying kernel modules..."

if [ -d "${OUTPUT_DIR}/modules" ]; then
    KERNEL_VERSION=$(ls "${OUTPUT_DIR}/modules" 2>/dev/null | head -1)
    if [ -n "$KERNEL_VERSION" ] && [ -d "${OUTPUT_DIR}/modules/${KERNEL_VERSION}" ]; then
        echo "   Found kernel version: ${KERNEL_VERSION}"
        
        mkdir -p "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}"
        
        # Copy ALL kernel modules - we need them for hardware detection
        # This is essential for USB, SATA, NVMe, and VirtIO devices
        cp -a "${OUTPUT_DIR}/modules/${KERNEL_VERSION}"/* \
            "${INITRAMFS_DIR}/lib/modules/${KERNEL_VERSION}/" 2>/dev/null || true
        
        # Count modules
        MODULE_COUNT=$(find "${INITRAMFS_DIR}/lib/modules" -name "*.ko*" 2>/dev/null | wc -l)
        echo "   ✅ Copied ${MODULE_COUNT} kernel modules"
        
        # Run depmod to generate module dependencies
        if command -v depmod >/dev/null 2>&1; then
            depmod -b "${INITRAMFS_DIR}" "${KERNEL_VERSION}" 2>/dev/null || true
        fi
    else
        echo "   ⚠️  No kernel version directory found in ${OUTPUT_DIR}/modules"
    fi
else
    echo "   ⚠️  No modules directory found at ${OUTPUT_DIR}/modules"
    echo "   Block devices may not be detected!"
fi

# =============================================================================
# Copy dialog for TUI installer
# =============================================================================
echo "   Copying dialog..."
if [ -f /usr/bin/dialog ]; then
    cp /usr/bin/dialog "${INITRAMFS_DIR}/usr/bin/"
    chmod +x "${INITRAMFS_DIR}/usr/bin/dialog"
    ln -sf ../usr/bin/dialog "${INITRAMFS_DIR}/bin/dialog"
    
    # Copy dialog dependencies
    for lib in $(ldd /usr/bin/dialog 2>/dev/null | grep "=>" | awk '{print $3}' | grep -v "not found"); do
        if [ -f "$lib" ]; then
            cp "$lib" "${INITRAMFS_DIR}/lib/" 2>/dev/null || true
        fi
    done
fi

# =============================================================================
# Copy ncurses libraries (needed for dialog)
# =============================================================================
echo "   Copying ncurses libraries..."
for lib in libncursesw.so* libncurses.so* libtinfo.so* libformw.so* libmenuw.so*; do
    find /lib /usr/lib -name "$lib" -exec cp {} "${INITRAMFS_DIR}/lib/" \; 2>/dev/null || true
done

# =============================================================================
# Copy essential system libraries
# =============================================================================
echo "   Copying system libraries..."
for lib in /lib/ld-musl* /lib/libc.musl* /lib/libblkid.so* /lib/libuuid.so* \
           /lib/libfdisk.so* /lib/libsmartcols.so* /lib/libmount.so*; do
    if [ -e "$lib" ]; then
        cp "$lib" "${INITRAMFS_DIR}/lib/" 2>/dev/null || true
    fi
done

# =============================================================================
# Copy disk partitioning tools
# =============================================================================
echo "   Copying disk tools..."
for tool in parted fdisk sfdisk mkfs.ext4 mkfs.vfat mke2fs e2fsck; do
    for path in /sbin /usr/sbin /bin /usr/bin; do
        if [ -f "${path}/${tool}" ]; then
            cp "${path}/${tool}" "${INITRAMFS_DIR}/sbin/"
            chmod +x "${INITRAMFS_DIR}/sbin/${tool}"
            
            # Copy tool dependencies
            for lib in $(ldd "${path}/${tool}" 2>/dev/null | grep "=>" | awk '{print $3}' | grep -v "not found"); do
                if [ -f "$lib" ]; then
                    cp "$lib" "${INITRAMFS_DIR}/lib/" 2>/dev/null || true
                fi
            done
            break
        fi
    done
done

# =============================================================================
# Copy installer scripts
# =============================================================================
echo "   Copying installer scripts..."
cp "${WORK_DIR}/installer/install.sh" "${INITRAMFS_DIR}/installer/" 2>/dev/null || true
cp "${WORK_DIR}/installer/tui.sh" "${INITRAMFS_DIR}/installer/" 2>/dev/null || true
cp "${WORK_DIR}/installer/firstboot.sh" "${INITRAMFS_DIR}/installer/" 2>/dev/null || true
chmod +x "${INITRAMFS_DIR}/installer/"* 2>/dev/null || true

# =============================================================================
# Create /etc files
# =============================================================================
cat > "${INITRAMFS_DIR}/etc/passwd" << 'EOF'
root:x:0:0:root:/root:/bin/sh
EOF

cat > "${INITRAMFS_DIR}/etc/group" << 'EOF'
root:x:0:
EOF

cat > "${INITRAMFS_DIR}/etc/mdev.conf" << 'EOF'
# Provide user, group, and mode information for devices
# Syntax: <regex> <uid>:<gid> <mode> [<@|$|*> <cmd>]
null        root:root 0666
zero        root:root 0666
full        root:root 0666
random      root:root 0666
urandom     root:root 0666
console     root:root 0600
tty         root:root 0666
tty[0-9]*   root:root 0660
ptmx        root:root 0666
sd[a-z].*   root:root 0660
sr[0-9]*    root:root 0660
vd[a-z].*   root:root 0660
nvme.*      root:root 0660
loop[0-9]*  root:root 0660
EOF

# =============================================================================
# Create init script (CRITICAL - this is what runs at boot)
# =============================================================================
cat > "${INITRAMFS_DIR}/init" << 'INITEOF'
#!/bin/sh
# =============================================================================
# Quantix-vDC Installer Init Script
# =============================================================================
# This script runs from initramfs and launches the installer.
# Based on the proven Quantix-OS init architecture.
# =============================================================================

# Mount essential filesystems FIRST
/bin/busybox mount -t proc none /proc 2>/dev/null || mount -t proc none /proc
/bin/busybox mount -t sysfs none /sys 2>/dev/null || mount -t sysfs none /sys
/bin/busybox mount -t devtmpfs none /dev 2>/dev/null || mount -t devtmpfs none /dev

# Enable kernel messages to console
echo 8 > /proc/sys/kernel/printk 2>/dev/null

# Create essential device nodes if devtmpfs didn't
[ -c /dev/console ] || mknod -m 622 /dev/console c 5 1 2>/dev/null
[ -c /dev/null ] || mknod -m 666 /dev/null c 1 3 2>/dev/null
[ -c /dev/tty ] || mknod -m 666 /dev/tty c 5 0 2>/dev/null
[ -c /dev/tty0 ] || mknod -m 666 /dev/tty0 c 4 0 2>/dev/null
[ -c /dev/tty1 ] || mknod -m 666 /dev/tty1 c 4 1 2>/dev/null

# Redirect output to console
exec 0</dev/console
exec 1>/dev/console
exec 2>/dev/console

# Create additional mount points
mkdir -p /dev/pts /dev/shm /run /tmp
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs tmpfs /dev/shm 2>/dev/null || true
mount -t tmpfs tmpfs /run 2>/dev/null || true
mount -t tmpfs tmpfs /tmp 2>/dev/null || true

echo ""
echo "============================================================"
echo "     QUANTIX-VDC INSTALLER STARTING"
echo "============================================================"
echo ""
echo "[INIT] Script is running!"
echo "[INIT] Date: $(date 2>/dev/null || echo 'unknown')"
echo ""

# =============================================================================
# Parse kernel command line
# =============================================================================
echo "[INIT] Parsing kernel command line..."
echo "[INIT] cmdline: $(cat /proc/cmdline)"

BOOT_MODE=""
DEBUG_MODE=""
BREAK_POINT=""

for param in $(cat /proc/cmdline); do
    case $param in
        boot=*)
            BOOT_MODE="${param#boot=}"
            echo "[INIT]   Found: boot=$BOOT_MODE"
            ;;
        debug)
            DEBUG_MODE="1"
            echo "[INIT]   Found: debug mode"
            ;;
        break=*)
            BREAK_POINT="${param#break=}"
            echo "[INIT]   Found: break=$BREAK_POINT"
            ;;
    esac
done

# =============================================================================
# CRITICAL: Load kernel modules for block devices
# =============================================================================
echo ""
echo "[INIT] Loading kernel modules..."

# Find kernel version
KVER=""
if [ -d /lib/modules ]; then
    KVER=$(ls /lib/modules 2>/dev/null | head -1)
    echo "[INIT] Kernel modules directory: /lib/modules/$KVER"
fi

if [ -n "$KVER" ] && [ -d "/lib/modules/$KVER" ]; then
    # SCSI subsystem (MUST load first)
    echo "[INIT] Loading SCSI subsystem..."
    for mod in scsi_mod sd_mod sr_mod; do
        modprobe $mod 2>/dev/null && echo "[INIT]   ✓ $mod" || true
    done
    
    # USB drivers (for USB boot)
    echo "[INIT] Loading USB drivers..."
    for mod in usbcore usb_common xhci_hcd xhci_pci ehci_hcd ehci_pci ohci_hcd uhci_hcd usb_storage uas; do
        modprobe $mod 2>/dev/null && echo "[INIT]   ✓ $mod" || true
    done
    
    # SATA/AHCI drivers
    echo "[INIT] Loading SATA/AHCI drivers..."
    for mod in libata ahci ata_piix ata_generic; do
        modprobe $mod 2>/dev/null && echo "[INIT]   ✓ $mod" || true
    done
    
    # NVMe drivers
    echo "[INIT] Loading NVMe drivers..."
    for mod in nvme nvme_core; do
        modprobe $mod 2>/dev/null && echo "[INIT]   ✓ $mod" || true
    done
    
    # VirtIO drivers (for QEMU/KVM)
    echo "[INIT] Loading VirtIO drivers..."
    for mod in virtio virtio_ring virtio_pci virtio_blk virtio_scsi virtio_net; do
        modprobe $mod 2>/dev/null && echo "[INIT]   ✓ $mod" || true
    done
    
    # Filesystem drivers
    echo "[INIT] Loading filesystem drivers..."
    for mod in loop squashfs overlay isofs iso9660 vfat fat ext4 xfs; do
        modprobe $mod 2>/dev/null && echo "[INIT]   ✓ $mod" || true
    done
    
    # CD-ROM driver
    modprobe cdrom 2>/dev/null && echo "[INIT]   ✓ cdrom" || true
else
    echo "[INIT] WARNING: No kernel modules available!"
    echo "[INIT] Block devices may not be detected."
fi

# =============================================================================
# Scan for devices using mdev
# =============================================================================
echo ""
echo "[INIT] Scanning for devices..."

# Run mdev to populate /dev
mdev -s 2>/dev/null || true
sleep 2
mdev -s 2>/dev/null || true

# Show what we found
echo "[INIT] Block devices found:"
ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* /dev/loop* 2>/dev/null || echo "  (none detected)"
echo ""

# =============================================================================
# Debug breakpoint
# =============================================================================
if [ "$BREAK_POINT" = "premount" ]; then
    echo ""
    echo "============================================================"
    echo "  DEBUG BREAKPOINT: premount"
    echo "  Dropping to shell for manual debugging."
    echo "  Type 'exit' to continue boot process."
    echo "============================================================"
    echo ""
    echo "Useful commands:"
    echo "  cat /proc/cmdline    - see kernel parameters"
    echo "  ls /dev/             - see available devices"
    echo "  blkid                - see block device labels"
    echo "  ls /lib/modules/     - see available modules"
    echo ""
    exec /bin/sh
fi

# Wait for devices to settle
echo "[INIT] Waiting for devices to settle..."
sleep 3

# Rescan
mdev -s 2>/dev/null || true

# =============================================================================
# Find and mount the installation media
# =============================================================================
echo ""
echo "[INIT] Searching for installation media..."

CDROM_DEV=""
SQUASHFS_PATH=""

# Try CD-ROM devices first
for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
    if [ -b "$dev" ]; then
        echo "[INIT] Trying CD-ROM: $dev"
        mkdir -p /mnt/cdrom
        if mount -t iso9660 -o ro "$dev" /mnt/cdrom 2>/dev/null; then
            if [ -f "/mnt/cdrom/quantix-vdc/system.squashfs" ]; then
                CDROM_DEV="$dev"
                SQUASHFS_PATH="/mnt/cdrom/quantix-vdc/system.squashfs"
                echo "[INIT] ✓ Found installation media on CD-ROM: $dev"
                break
            fi
            umount /mnt/cdrom 2>/dev/null
        fi
    fi
done

# Try USB/disk devices if CD-ROM not found
if [ -z "$SQUASHFS_PATH" ]; then
    for dev in /dev/sd[a-z] /dev/sd[a-z][0-9] /dev/vd[a-z] /dev/vd[a-z][0-9] /dev/nvme[0-9]n[0-9] /dev/nvme[0-9]n[0-9]p[0-9]; do
        if [ -b "$dev" ]; then
            echo "[INIT] Trying device: $dev"
            mkdir -p /mnt/usb
            # Try ISO9660 first (for USB with ISO written via dd)
            if mount -t iso9660 -o ro "$dev" /mnt/usb 2>/dev/null || \
               mount -t vfat -o ro "$dev" /mnt/usb 2>/dev/null || \
               mount -t ext4 -o ro "$dev" /mnt/usb 2>/dev/null; then
                if [ -f "/mnt/usb/quantix-vdc/system.squashfs" ]; then
                    CDROM_DEV="$dev"
                    # Move mount to /mnt/cdrom for consistency
                    umount /mnt/usb
                    mount -o ro "$dev" /mnt/cdrom 2>/dev/null
                    SQUASHFS_PATH="/mnt/cdrom/quantix-vdc/system.squashfs"
                    echo "[INIT] ✓ Found installation media on USB: $dev"
                    break
                fi
                umount /mnt/usb 2>/dev/null
            fi
        fi
    done
fi

# =============================================================================
# Handle media not found
# =============================================================================
if [ -z "$SQUASHFS_PATH" ]; then
    echo ""
    echo "============================================================"
    echo "  ERROR: Could not find Quantix-vDC installation media!"
    echo "============================================================"
    echo ""
    echo "Looking for: quantix-vdc/system.squashfs"
    echo ""
    echo "Available block devices:"
    ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* 2>/dev/null || echo "  (none found)"
    echo ""
    echo "Block device info:"
    blkid 2>/dev/null || echo "  (blkid not available)"
    echo ""
    echo "Loaded modules:"
    lsmod 2>/dev/null | head -20 || cat /proc/modules 2>/dev/null | head -20
    echo ""
    echo "Dropping to rescue shell..."
    echo "Type 'reboot' to restart."
    echo ""
    exec /bin/sh
fi

# =============================================================================
# Mount squashfs
# =============================================================================
echo ""
echo "[INIT] Mounting system image: $SQUASHFS_PATH"

mkdir -p /mnt/rootfs
if ! mount -t squashfs -o ro "$SQUASHFS_PATH" /mnt/rootfs; then
    echo "[ERROR] Failed to mount squashfs!"
    exec /bin/sh
fi

echo "[INIT] ✓ System image mounted"

# =============================================================================
# Launch installer
# =============================================================================
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-vDC Installer Starting...                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Export environment for installer
export CDROM_DEV
export SQUASHFS_PATH
export ROOTFS_PATH="/mnt/rootfs"
export TERM=linux

# Clear screen and run installer
clear 2>/dev/null || true

# Run installer TUI
if [ -f /installer/tui.sh ]; then
    exec /bin/sh /installer/tui.sh
elif [ -f /installer/install.sh ]; then
    exec /bin/sh /installer/install.sh
else
    echo "No installer scripts found!"
    echo ""
    echo "You can manually install by:"
    echo "  1. Partition target disk with fdisk"
    echo "  2. Format partitions"
    echo "  3. Mount target at /mnt/target"
    echo "  4. Copy system: cp -a /mnt/rootfs/* /mnt/target/"
    echo ""
    echo "Dropping to shell..."
    exec /bin/sh
fi
INITEOF

chmod +x "${INITRAMFS_DIR}/init"

# =============================================================================
# Create the initramfs image
# =============================================================================
echo "   Creating initramfs archive..."
mkdir -p "${OUTPUT_DIR}"
(cd "${INITRAMFS_DIR}" && find . | cpio -H newc -o 2>/dev/null | gzip -9) > "${OUTPUT_DIR}/${INITRAMFS_NAME}"

# Calculate size
INITRAMFS_SIZE=$(du -h "${OUTPUT_DIR}/${INITRAMFS_NAME}" | cut -f1)
MODULE_COUNT=$(find "${INITRAMFS_DIR}/lib/modules" -name "*.ko*" 2>/dev/null | wc -l)

echo ""
echo "✅ Installer initramfs created:"
echo "   File: ${OUTPUT_DIR}/${INITRAMFS_NAME}"
echo "   Size: ${INITRAMFS_SIZE}"
echo "   Modules: ${MODULE_COUNT}"

# Cleanup
rm -rf "${INITRAMFS_DIR}"
