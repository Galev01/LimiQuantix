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

# Create library symlinks for compatibility (Fix C from Gemini)
ln -sf lib "${INITRAMFS_DIR}/lib64" 2>/dev/null || true
ln -sf ../lib "${INITRAMFS_DIR}/usr/lib" 2>/dev/null || true

# =============================================================================
# Install STATIC Busybox (CRITICAL - must be statically linked!)
# =============================================================================
echo "   Installing STATIC busybox..."

BUSYBOX_PATH="${INITRAMFS_DIR}/bin/busybox"

# Method 1: Install busybox-static from Alpine (most reliable)
echo "   Trying to install busybox-static from Alpine..."
apk add --no-cache busybox-static >/dev/null 2>&1 || true

if [ -f /bin/busybox.static ]; then
    echo "   Using Alpine busybox-static from /bin"
    cp /bin/busybox.static "${BUSYBOX_PATH}"
elif [ -f /usr/bin/busybox.static ]; then
    echo "   Using Alpine busybox-static from /usr/bin"
    cp /usr/bin/busybox.static "${BUSYBOX_PATH}"
else
    # Method 2: Download static busybox
    echo "   busybox-static not found, downloading..."
    BUSYBOX_URL="https://www.busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox"
    
    if command -v curl >/dev/null 2>&1; then
        curl -L -f --connect-timeout 10 "${BUSYBOX_URL}" -o "${BUSYBOX_PATH}" 2>/dev/null || true
    fi
    
    if [ ! -f "${BUSYBOX_PATH}" ] || [ ! -s "${BUSYBOX_PATH}" ]; then
        if command -v wget >/dev/null 2>&1; then
            wget -q --timeout=10 "${BUSYBOX_URL}" -O "${BUSYBOX_PATH}" 2>/dev/null || true
        fi
    fi
fi

# Verify we have busybox
if [ ! -f "${BUSYBOX_PATH}" ] || [ ! -s "${BUSYBOX_PATH}" ]; then
    echo "❌ ERROR: Failed to get static busybox!"
    exit 1
fi

chmod +x "${BUSYBOX_PATH}"

# Verify it's actually static
if file "${BUSYBOX_PATH}" 2>/dev/null | grep -q "dynamically linked"; then
    echo "⚠️  WARNING: busybox appears to be dynamically linked!"
    echo "   This will cause kernel panic! Trying to find static version..."
    
    # Last resort: try downloading again
    rm -f "${BUSYBOX_PATH}"
    BUSYBOX_URL="https://www.busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox"
    curl -L -f "${BUSYBOX_URL}" -o "${BUSYBOX_PATH}" 2>/dev/null || \
    wget -q "${BUSYBOX_URL}" -O "${BUSYBOX_PATH}" 2>/dev/null || {
        echo "❌ ERROR: Cannot get static busybox!"
        exit 1
    }
    chmod +x "${BUSYBOX_PATH}"
fi

echo "   ✅ Static busybox installed"

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
for cmd in modprobe insmod lsmod depmod mdev blkid switch_root pivot_root reboot poweroff halt init; do
    ln -sf ../bin/busybox "${INITRAMFS_DIR}/sbin/$cmd" 2>/dev/null || true
done

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
#
# IMPORTANT: /bin/sh is a symlink to busybox which is STATICALLY linked.
# CRITICAL: This script must NEVER exit or the kernel will panic!
# =============================================================================

# CRITICAL: Define rescue function FIRST before anything else
rescue_shell() {
    echo ""
    echo "============================================================"
    echo "  RESCUE SHELL - Init encountered an error"
    echo "  The system will stay alive for debugging."
    echo "  Type 'reboot' to restart."
    echo "============================================================"
    echo ""
    # Infinite loop to keep PID 1 alive
    while true; do
        /bin/busybox sh || /bin/sh || sleep 9999
    done
}

# CRITICAL: Trap ALL signals and errors to prevent exit
trap rescue_shell EXIT INT TERM HUP

# Use busybox applets explicitly to avoid any path issues
BB=/bin/busybox

# Mount essential filesystems FIRST
$BB mount -t proc proc /proc 2>/dev/null || true
$BB mount -t sysfs sysfs /sys 2>/dev/null || true
$BB mount -t devtmpfs devtmpfs /dev 2>/dev/null || {
    # Fallback: create minimal /dev manually
    $BB mkdir -p /dev
    $BB mknod -m 622 /dev/console c 5 1 2>/dev/null || true
    $BB mknod -m 666 /dev/null c 1 3 2>/dev/null || true
    $BB mknod -m 666 /dev/tty c 5 0 2>/dev/null || true
}

# Enable kernel messages to console
$BB echo 8 > /proc/sys/kernel/printk 2>/dev/null || true

# Create essential device nodes if devtmpfs didn't
[ -c /dev/console ] || $BB mknod -m 622 /dev/console c 5 1 2>/dev/null || true
[ -c /dev/null ] || $BB mknod -m 666 /dev/null c 1 3 2>/dev/null || true
[ -c /dev/tty ] || $BB mknod -m 666 /dev/tty c 5 0 2>/dev/null || true
[ -c /dev/tty0 ] || $BB mknod -m 666 /dev/tty0 c 4 0 2>/dev/null || true
[ -c /dev/tty1 ] || $BB mknod -m 666 /dev/tty1 c 4 1 2>/dev/null || true

# Redirect output to console (with fallback)
exec 0</dev/console 2>/dev/null || true
exec 1>/dev/console 2>/dev/null || true
exec 2>/dev/console 2>/dev/null || true

# Create additional mount points
$BB mkdir -p /dev/pts /dev/shm /run /tmp 2>/dev/null || true
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
    
    # Loop device support (CRITICAL for squashfs mounting)
    $BB echo "[INIT] Loading loop device driver..."
    $BB modprobe loop 2>/dev/null && $BB echo "[INIT]   + loop" || true
    
    # Filesystem drivers
    $BB echo "[INIT] Loading filesystem drivers..."
    for mod in squashfs overlay isofs iso9660 vfat fat ext4 xfs; do
        $BB modprobe $mod 2>/dev/null && $BB echo "[INIT]   + $mod" || true
    done
    
    # CD-ROM driver
    $BB modprobe cdrom 2>/dev/null && $BB echo "[INIT]   + cdrom" || true
else
    $BB echo "[INIT] WARNING: No kernel modules available!"
    $BB echo "[INIT] Block devices may not be detected."
fi

# =============================================================================
# CRITICAL: Create loop device nodes (needed for squashfs mounting)
# =============================================================================
$BB echo "[INIT] Creating loop device nodes..."
for i in 0 1 2 3 4 5 6 7; do
    if [ ! -b /dev/loop$i ]; then
        $BB mknod /dev/loop$i b 7 $i 2>/dev/null && $BB echo "[INIT]   + /dev/loop$i" || true
    fi
done
# Create loop-control if it doesn't exist
if [ ! -c /dev/loop-control ]; then
    $BB mknod /dev/loop-control c 10 237 2>/dev/null || true
fi

# =============================================================================
# Scan for devices using mdev
# =============================================================================
$BB echo ""
$BB echo "[INIT] Scanning for devices..."

# Run mdev multiple times to catch slow devices
for scan in 1 2 3 4 5; do
    $BB echo "[INIT] Device scan $scan/5..."
    $BB mdev -s 2>/dev/null || true
    
    # Check if we found any block devices
    if $BB ls /dev/sr* /dev/sd* /dev/vd* /dev/nvme* 2>/dev/null | $BB grep -q .; then
        $BB echo "[INIT] Block devices detected!"
        break
    fi
    $BB sleep 1
done

# Show what we found
$BB echo "[INIT] Block devices found:"
$BB ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* /dev/loop* 2>/dev/null || $BB echo "  (none detected)"
$BB echo ""

# Debug: Show kernel messages about block devices
$BB echo "[DEBUG] Recent kernel messages about devices:"
$BB dmesg 2>/dev/null | $BB grep -iE "(sr0|cdrom|scsi|ata|usb|virtio|block)" | $BB tail -15 || true
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

# Debug: Show all block devices before searching
$BB echo "[DEBUG] All block devices in /dev:"
$BB ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* /dev/hd* 2>/dev/null || $BB echo "  (none found)"
$BB echo ""

# Try CD-ROM devices first
for dev in /dev/sr0 /dev/sr1 /dev/cdrom /dev/hdc /dev/hdd; do
    if [ -b "$dev" ]; then
        $BB echo "[INIT] Trying CD-ROM: $dev"
        $BB mkdir -p /mnt/cdrom
        
        # Debug: try to read first sector to see if device is accessible
        $BB dd if="$dev" of=/dev/null bs=512 count=1 2>/dev/null && \
            $BB echo "[DEBUG]   Device is readable" || \
            $BB echo "[DEBUG]   Device may not be ready"
        
        $BB echo "[DEBUG]   Attempting iso9660 mount..."
        if $BB mount -t iso9660 -o ro "$dev" /mnt/cdrom 2>&1; then
            $BB echo "[DEBUG]   Mount succeeded! Checking contents..."
            $BB echo "[DEBUG]   /mnt/cdrom contents:"
            $BB ls -la /mnt/cdrom/ 2>/dev/null | $BB head -10
            
            if [ -f "/mnt/cdrom/quantix-vdc/system.squashfs" ]; then
                CDROM_DEV="$dev"
                SQUASHFS_PATH="/mnt/cdrom/quantix-vdc/system.squashfs"
                $BB echo "[INIT] ✓ Found installation media on CD-ROM: $dev"
                break
            else
                $BB echo "[DEBUG]   quantix-vdc/system.squashfs NOT found"
                $BB echo "[DEBUG]   Looking for squashfs files:"
                $BB find /mnt/cdrom -name "*.squashfs" 2>/dev/null || $BB echo "    (none found)"
            fi
            $BB umount /mnt/cdrom 2>/dev/null
        else
            $BB echo "[DEBUG]   Mount failed"
        fi
    else
        $BB echo "[DEBUG] Device $dev does not exist or is not a block device"
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

# Debug: Check if squashfs file exists and is readable
$BB echo "[DEBUG] Checking squashfs file..."
if [ -f "$SQUASHFS_PATH" ]; then
    SQFS_SIZE=$($BB ls -lh "$SQUASHFS_PATH" 2>/dev/null | $BB awk '{print $5}')
    $BB echo "[DEBUG]   File exists, size: $SQFS_SIZE"
else
    $BB echo "[ERROR]   Squashfs file NOT found at $SQUASHFS_PATH!"
    $BB echo "[DEBUG]   Contents of /mnt/cdrom:"
    $BB ls -la /mnt/cdrom/ 2>/dev/null || $BB echo "    (cannot list)"
    $BB echo "[DEBUG]   Contents of /mnt/cdrom/quantix-vdc:"
    $BB ls -la /mnt/cdrom/quantix-vdc/ 2>/dev/null || $BB echo "    (cannot list)"
fi

# Debug: Check loop devices
$BB echo "[DEBUG] Loop devices:"
$BB ls -la /dev/loop* 2>/dev/null || $BB echo "  (none)"

$BB mkdir -p /mnt/rootfs

# Try mounting with explicit loop option
$BB echo "[DEBUG] Attempting mount with -o loop,ro..."
if $BB mount -t squashfs -o loop,ro "$SQUASHFS_PATH" /mnt/rootfs 2>&1; then
    $BB echo "[INIT] + System image mounted successfully"
else
    $BB echo "[ERROR] Mount failed! Trying alternative methods..."
    
    # Try without explicit loop option
    $BB echo "[DEBUG] Trying mount without loop option..."
    if $BB mount -t squashfs -o ro "$SQUASHFS_PATH" /mnt/rootfs 2>&1; then
        $BB echo "[INIT] + System image mounted (no loop)"
    else
        $BB echo "[ERROR] All mount attempts failed!"
        $BB echo "[DEBUG] dmesg tail:"
        $BB dmesg 2>/dev/null | $BB tail -20
        $BB echo ""
        $BB echo "Dropping to rescue shell..."
        # Don't exec, fall through to infinite loop
    fi
fi

# Verify mount succeeded
if $BB mountpoint -q /mnt/rootfs 2>/dev/null || [ -d /mnt/rootfs/bin ]; then
    $BB echo "[INIT] + System image verified"
else
    $BB echo "[ERROR] /mnt/rootfs does not appear to be mounted!"
    $BB echo "[DEBUG] Contents of /mnt/rootfs:"
    $BB ls -la /mnt/rootfs/ 2>/dev/null || $BB echo "  (empty or not mounted)"
fi

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

# Check if installer scripts exist
if [ -f /installer/tui.sh ]; then
    $BB echo "[INIT] Found TUI installer, launching..."
    # Disable trap and exec into installer
    trap - EXIT INT TERM HUP
    exec $BB sh /installer/tui.sh
elif [ -f /installer/install.sh ]; then
    $BB echo "[INIT] Found install script, launching..."
    trap - EXIT INT TERM HUP
    exec $BB sh /installer/install.sh
else
    $BB echo "[INIT] No installer scripts found!"
    $BB echo ""
    $BB echo "You can manually install by:"
    $BB echo "  1. Partition target disk with fdisk"
    $BB echo "  2. Format partitions"
    $BB echo "  3. Mount target at /mnt/target"
    $BB echo "  4. Copy system: cp -a /mnt/rootfs/* /mnt/target/"
    $BB echo ""
fi

# =============================================================================
# CRITICAL: Never let init exit! Use infinite loop as safety net.
# If we reach here, something went wrong. Keep PID 1 alive!
# =============================================================================
$BB echo ""
$BB echo "============================================================"
$BB echo "  Dropping to interactive shell."
$BB echo "  Type 'reboot' to restart."
$BB echo "============================================================"
$BB echo ""

# Disable trap before entering shell loop
trap - EXIT INT TERM HUP

# Infinite loop - NEVER let this script exit
while :; do
    $BB sh -i 2>/dev/null || $BB sh || {
        $BB echo "Shell failed, sleeping..."
        $BB sleep 5
    }
done

# This line should NEVER be reached
$BB echo "FATAL: Reached end of init script!"
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
