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
#!/bin/busybox sh
# =============================================================================
# Quantix-vDC Installer Init Script
# =============================================================================
# This script runs from initramfs and launches the installer.
# Based on the proven Quantix-OS init architecture.
# =============================================================================

# CRITICAL: Ensure we don't exit - kernel panics if init exits
trap "exec /bin/busybox sh" EXIT

# Use busybox directly for maximum reliability
BB=/bin/busybox

# Mount essential filesystems FIRST
$BB mount -t proc none /proc 2>/dev/null
$BB mount -t sysfs none /sys 2>/dev/null
$BB mount -t devtmpfs none /dev 2>/dev/null

# Enable kernel messages to console
$BB echo 8 > /proc/sys/kernel/printk 2>/dev/null

# Create essential device nodes if devtmpfs didn't
[ -c /dev/console ] || $BB mknod -m 622 /dev/console c 5 1 2>/dev/null
[ -c /dev/null ] || $BB mknod -m 666 /dev/null c 1 3 2>/dev/null
[ -c /dev/tty ] || $BB mknod -m 666 /dev/tty c 5 0 2>/dev/null
[ -c /dev/tty0 ] || $BB mknod -m 666 /dev/tty0 c 4 0 2>/dev/null
[ -c /dev/tty1 ] || $BB mknod -m 666 /dev/tty1 c 4 1 2>/dev/null

# Redirect output to console
exec 0</dev/console
exec 1>/dev/console
exec 2>/dev/console

# Create additional mount points
$BB mkdir -p /dev/pts /dev/shm /run /tmp
$BB mount -t devpts devpts /dev/pts 2>/dev/null || true
$BB mount -t tmpfs tmpfs /dev/shm 2>/dev/null || true
$BB mount -t tmpfs tmpfs /run 2>/dev/null || true
$BB mount -t tmpfs tmpfs /tmp 2>/dev/null || true

$BB echo ""
$BB echo "============================================================"
$BB echo "     QUANTIX-VDC INSTALLER STARTING"
$BB echo "============================================================"
$BB echo ""
$BB echo "[INIT] Script is running!"
$BB echo "[INIT] Busybox location: $BB"
$BB echo "[INIT] Date: $($BB date 2>/dev/null || $BB echo 'unknown')"
$BB echo ""

# =============================================================================
# Parse kernel command line
# =============================================================================
$BB echo "[INIT] Parsing kernel command line..."
$BB echo "[INIT] cmdline: $($BB cat /proc/cmdline)"

BOOT_MODE=""
DEBUG_MODE=""
BREAK_POINT=""

for param in $($BB cat /proc/cmdline); do
    case $param in
        boot=*)
            BOOT_MODE="${param#boot=}"
            $BB echo "[INIT]   Found: boot=$BOOT_MODE"
            ;;
        debug)
            DEBUG_MODE="1"
            $BB echo "[INIT]   Found: debug mode"
            ;;
        break=*)
            BREAK_POINT="${param#break=}"
            $BB echo "[INIT]   Found: break=$BREAK_POINT"
            ;;
    esac
done

# =============================================================================
# CRITICAL: Load kernel modules for block devices
# =============================================================================
$BB echo ""
$BB echo "[INIT] Loading kernel modules..."

# Find kernel version
KVER=""
if [ -d /lib/modules ]; then
    KVER=$($BB ls /lib/modules 2>/dev/null | $BB head -1)
    $BB echo "[INIT] Kernel modules directory: /lib/modules/$KVER"
fi

if [ -n "$KVER" ] && [ -d "/lib/modules/$KVER" ]; then
    # SCSI subsystem (MUST load first)
    $BB echo "[INIT] Loading SCSI subsystem..."
    for mod in scsi_mod sd_mod sr_mod; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # USB drivers (for USB boot)
    $BB echo "[INIT] Loading USB drivers..."
    for mod in usbcore usb_common xhci_hcd xhci_pci ehci_hcd ehci_pci ohci_hcd uhci_hcd usb_storage uas; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # SATA/AHCI drivers
    $BB echo "[INIT] Loading SATA/AHCI drivers..."
    for mod in libata ahci ata_piix ata_generic; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # NVMe drivers
    $BB echo "[INIT] Loading NVMe drivers..."
    for mod in nvme nvme_core; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # VirtIO drivers (for QEMU/KVM)
    $BB echo "[INIT] Loading VirtIO drivers..."
    for mod in virtio virtio_ring virtio_pci virtio_blk virtio_scsi virtio_net; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # Filesystem drivers
    $BB echo "[INIT] Loading filesystem drivers..."
    for mod in loop squashfs overlay isofs iso9660 vfat fat ext4 xfs; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # CD-ROM driver
    $BB modprobe cdrom 2>/dev/null && $BB echo "[INIT]   + cdrom" || true
else
    $BB echo "[INIT] WARNING: No kernel modules available!"
    $BB echo "[INIT] Block devices may not be detected."
fi

# =============================================================================
# Scan for devices using mdev
# =============================================================================
$BB echo ""
$BB echo "[INIT] Scanning for devices..."

# Run mdev to populate /dev
$BB mdev -s 2>/dev/null || true
$BB sleep 2
$BB mdev -s 2>/dev/null || true

# Show what we found
$BB echo "[INIT] Block devices found:"
$BB ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* /dev/loop* 2>/dev/null || $BB echo "  (none detected)"
$BB echo ""

# =============================================================================
# Debug breakpoint
# =============================================================================
if [ "$BREAK_POINT" = "premount" ]; then
    $BB echo ""
    $BB echo "============================================================"
    $BB echo "  DEBUG BREAKPOINT: premount"
    $BB echo "  Dropping to shell for manual debugging."
    $BB echo "  Type 'exit' to continue boot process."
    $BB echo "============================================================"
    $BB echo ""
    $BB echo "Useful commands:"
    $BB echo "  cat /proc/cmdline    - see kernel parameters"
    $BB echo "  ls /dev/             - see available devices"
    $BB echo "  blkid                - see block device labels"
    $BB echo "  ls /lib/modules/     - see available modules"
    $BB echo ""
    # Disable exit trap and exec shell
    trap - EXIT
    exec $BB sh
fi

# Wait for devices to settle
$BB echo "[INIT] Waiting for devices to settle..."
$BB sleep 3

# Rescan
$BB mdev -s 2>/dev/null || true

# =============================================================================
# Find and mount the installation media
# =============================================================================
$BB echo ""
$BB echo "[INIT] Searching for installation media..."

CDROM_DEV=""
SQUASHFS_PATH=""

# Try CD-ROM devices first
for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
    if [ -b "$dev" ]; then
        $BB echo "[INIT] Trying CD-ROM: $dev"
        $BB mkdir -p /mnt/cdrom
        if $BB mount -t iso9660 -o ro "$dev" /mnt/cdrom 2>/dev/null; then
            if [ -f "/mnt/cdrom/quantix-vdc/system.squashfs" ]; then
                CDROM_DEV="$dev"
                SQUASHFS_PATH="/mnt/cdrom/quantix-vdc/system.squashfs"
                $BB echo "[INIT] + Found installation media on CD-ROM: $dev"
                break
            fi
            $BB umount /mnt/cdrom 2>/dev/null
        fi
    fi
done

# Try USB/disk devices if CD-ROM not found
if [ -z "$SQUASHFS_PATH" ]; then
    for dev in /dev/sd[a-z] /dev/sd[a-z][0-9] /dev/vd[a-z] /dev/vd[a-z][0-9] /dev/nvme[0-9]n[0-9] /dev/nvme[0-9]n[0-9]p[0-9]; do
        if [ -b "$dev" ]; then
            $BB echo "[INIT] Trying device: $dev"
            $BB mkdir -p /mnt/usb
            # Try ISO9660 first (for USB with ISO written via dd)
            if $BB mount -t iso9660 -o ro "$dev" /mnt/usb 2>/dev/null || \
               $BB mount -t vfat -o ro "$dev" /mnt/usb 2>/dev/null || \
               $BB mount -t ext4 -o ro "$dev" /mnt/usb 2>/dev/null; then
                if [ -f "/mnt/usb/quantix-vdc/system.squashfs" ]; then
                    CDROM_DEV="$dev"
                    # Move mount to /mnt/cdrom for consistency
                    $BB umount /mnt/usb
                    $BB mount -o ro "$dev" /mnt/cdrom 2>/dev/null
                    SQUASHFS_PATH="/mnt/cdrom/quantix-vdc/system.squashfs"
                    $BB echo "[INIT] + Found installation media on USB: $dev"
                    break
                fi
                $BB umount /mnt/usb 2>/dev/null
            fi
        fi
    done
fi

# =============================================================================
# Handle media not found
# =============================================================================
if [ -z "$SQUASHFS_PATH" ]; then
    $BB echo ""
    $BB echo "============================================================"
    $BB echo "  ERROR: Could not find Quantix-vDC installation media!"
    $BB echo "============================================================"
    $BB echo ""
    $BB echo "Looking for: quantix-vdc/system.squashfs"
    $BB echo ""
    $BB echo "Available block devices:"
    $BB ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* 2>/dev/null || $BB echo "  (none found)"
    $BB echo ""
    $BB echo "Block device info:"
    $BB blkid 2>/dev/null || $BB echo "  (blkid not available)"
    $BB echo ""
    $BB echo "Loaded modules:"
    $BB cat /proc/modules 2>/dev/null | $BB head -20
    $BB echo ""
    $BB echo "Dropping to rescue shell..."
    $BB echo "Type 'reboot' to restart."
    $BB echo ""
    # Disable exit trap and exec shell
    trap - EXIT
    exec $BB sh
fi

# =============================================================================
# Mount squashfs
# =============================================================================
$BB echo ""
$BB echo "[INIT] Mounting system image: $SQUASHFS_PATH"

$BB mkdir -p /mnt/rootfs
if ! $BB mount -t squashfs -o ro "$SQUASHFS_PATH" /mnt/rootfs; then
    $BB echo "[ERROR] Failed to mount squashfs!"
    trap - EXIT
    exec $BB sh
fi

$BB echo "[INIT] + System image mounted"

# =============================================================================
# Launch installer
# =============================================================================
$BB echo ""
$BB echo "============================================================"
$BB echo "         Quantix-vDC Installer Starting..."
$BB echo "============================================================"
$BB echo ""

# Export environment for installer
export CDROM_DEV
export SQUASHFS_PATH
export ROOTFS_PATH="/mnt/rootfs"
export TERM=linux
export PATH=/bin:/sbin:/usr/bin:/usr/sbin

# Clear screen and run installer
$BB clear 2>/dev/null || true

# Disable exit trap before exec
trap - EXIT

# Run installer TUI
if [ -f /installer/tui.sh ]; then
    exec $BB sh /installer/tui.sh
elif [ -f /installer/install.sh ]; then
    exec $BB sh /installer/install.sh
else
    $BB echo "No installer scripts found!"
    $BB echo ""
    $BB echo "You can manually install by:"
    $BB echo "  1. Partition target disk with fdisk"
    $BB echo "  2. Format partitions"
    $BB echo "  3. Mount target at /mnt/target"
    $BB echo "  4. Copy system: cp -a /mnt/rootfs/* /mnt/target/"
    $BB echo ""
    $BB echo "Dropping to shell..."
    exec $BB sh
fi

# This should never be reached, but just in case
exec $BB sh
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
