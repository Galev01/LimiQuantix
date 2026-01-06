#!/bin/bash
# =============================================================================
# Quantix-OS Initramfs Builder
# =============================================================================
# Creates a custom initramfs with STATIC busybox for Live boot support.
#
# Key insight: We MUST use a statically-linked busybox because the initramfs
# has no shared libraries. A dynamically-linked busybox will silently fail.
#
# Usage: ./build-initramfs.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
INITRAMFS_DIR="/tmp/initramfs-build"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-OS Initramfs Builder                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Create initramfs structure
# -----------------------------------------------------------------------------
echo "📦 Step 1: Creating initramfs structure..."

rm -rf "${INITRAMFS_DIR}"
mkdir -p "${INITRAMFS_DIR}"/{bin,sbin,etc,proc,sys,dev,run,tmp}
mkdir -p "${INITRAMFS_DIR}"/mnt/{iso,squash,cdrom,usb}
mkdir -p "${INITRAMFS_DIR}"/newroot
mkdir -p "${INITRAMFS_DIR}"/usr/{bin,sbin}
mkdir -p "${INITRAMFS_DIR}"/lib/modules

echo "✅ Structure created"

# -----------------------------------------------------------------------------
# Step 2: Install STATIC Busybox
# -----------------------------------------------------------------------------
echo "📦 Step 2: Installing STATIC busybox..."

# Critical: We MUST use a statically-linked busybox
# The one in Alpine/Docker containers is dynamically linked and won't work

BUSYBOX_URL="https://www.busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox"
BUSYBOX_PATH="${INITRAMFS_DIR}/bin/busybox"

# Try to download static busybox
if command -v curl >/dev/null 2>&1; then
    echo "   Downloading static busybox via curl..."
    curl -L -f "${BUSYBOX_URL}" -o "${BUSYBOX_PATH}" || {
        echo "   curl download failed, trying wget..."
        wget -q "${BUSYBOX_URL}" -O "${BUSYBOX_PATH}"
    }
elif command -v wget >/dev/null 2>&1; then
    echo "   Downloading static busybox via wget..."
    wget -q "${BUSYBOX_URL}" -O "${BUSYBOX_PATH}"
else
    echo "❌ Neither curl nor wget available!"
    exit 1
fi

if [ ! -f "${BUSYBOX_PATH}" ] || [ ! -s "${BUSYBOX_PATH}" ]; then
    echo "❌ Failed to download static busybox"
    exit 1
fi

chmod +x "${BUSYBOX_PATH}"

# Verify it's actually static
if file "${BUSYBOX_PATH}" | grep -q "dynamically linked"; then
    echo "⚠️  Warning: busybox appears to be dynamically linked!"
else
    echo "   Verified: busybox is statically linked"
fi

echo "✅ Static busybox installed"

# -----------------------------------------------------------------------------
# Step 3: Create busybox symlinks
# -----------------------------------------------------------------------------
echo "📦 Step 3: Creating busybox symlinks..."

# Essential commands needed by init script
COMMANDS="sh ash mount umount mkdir mknod cat echo ls sleep switch_root \
          chroot exec grep sed awk find cp mv rm ln chmod chown \
          mdev modprobe insmod lsmod blkid losetup dmesg \
          true false test [ expr head tail cut tr sort uniq wc \
          kill ps reboot poweroff halt sync"

for cmd in $COMMANDS; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/${cmd}"
done

# Also create in sbin for compatibility
ln -sf ../bin/busybox "${INITRAMFS_DIR}/sbin/init"
ln -sf ../bin/busybox "${INITRAMFS_DIR}/sbin/modprobe"

echo "✅ Symlinks created"

# -----------------------------------------------------------------------------
# Step 4: Create the /init script
# -----------------------------------------------------------------------------
echo "📦 Step 4: Creating init script..."

# Use the custom init script if it exists, otherwise create embedded one
if [ -f "${WORK_DIR}/initramfs/init" ]; then
    echo "   Using custom init from ${WORK_DIR}/initramfs/init"
    
    # But we need to fix the shebang to use busybox sh
    sed '1s|^#!/bin/sh|#!/bin/busybox sh|; 1s|^#!/bin/ash|#!/bin/busybox sh|' \
        "${WORK_DIR}/initramfs/init" > "${INITRAMFS_DIR}/init"
else
    echo "   Creating embedded init script..."
    cat > "${INITRAMFS_DIR}/init" << 'INITEOF'
#!/bin/busybox sh
# Quantix-OS Initramfs Init Script

# Use busybox applets explicitly to avoid any path issues
BB=/bin/busybox

# Mount essential filesystems
$BB mount -t proc proc /proc
$BB mount -t sysfs sysfs /sys
$BB mount -t devtmpfs devtmpfs /dev 2>/dev/null || {
    # Fallback: create minimal /dev manually
    $BB mknod -m 622 /dev/console c 5 1
    $BB mknod -m 666 /dev/null c 1 3
    $BB mknod -m 666 /dev/tty c 5 0
}

# Populate /dev with device nodes
$BB mdev -s 2>/dev/null || true

# Enable kernel messages
$BB echo 8 > /proc/sys/kernel/printk

$BB echo ""
$BB echo "============================================================"
$BB echo "     QUANTIX-OS INITRAMFS v1.0"
$BB echo "============================================================"
$BB echo ""
$BB echo "Kernel command line: $($BB cat /proc/cmdline)"
$BB echo ""

# Parse command line
LIVE_BOOT=""
DEBUG=""
for param in $($BB cat /proc/cmdline); do
    case $param in
        boot=live) LIVE_BOOT=1 ;;
        debug) DEBUG=1 ;;
        break=*) BREAK="${param#break=}" ;;
    esac
done

# Debug breakpoint
if [ "$BREAK" = "premount" ]; then
    $BB echo "DEBUG: Dropping to shell (break=premount)"
    $BB echo "Type 'exit' to continue boot"
    exec $BB sh
fi

# Wait for devices to settle
$BB echo "Waiting for devices..."
$BB sleep 3
$BB mdev -s 2>/dev/null || true

# Show available devices
$BB echo "Available block devices:"
$BB ls -la /dev/sd* /dev/sr* /dev/vd* /dev/nvme* 2>/dev/null || $BB echo "  (none found yet)"

# Find boot media
$BB echo ""
$BB echo "Searching for Quantix-OS boot media..."
FOUND=0

for attempt in 1 2 3 4 5; do
    $BB echo "  Attempt $attempt/5..."
    
    # Scan for new devices
    $BB mdev -s 2>/dev/null || true
    
    # Try CD-ROM devices first
    for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
        [ -b "$dev" ] || continue
        $BB echo "    Trying $dev..."
        $BB mkdir -p /mnt/iso
        if $BB mount -t iso9660 -o ro "$dev" /mnt/iso 2>/dev/null; then
            if [ -f "/mnt/iso/quantix/system.squashfs" ]; then
                $BB echo "  ✓ Found boot media at $dev"
                FOUND=1
                break 2
            fi
            $BB umount /mnt/iso 2>/dev/null
        fi
    done
    
    # Try USB/disk devices
    for dev in /dev/sda /dev/sda1 /dev/sdb /dev/sdb1 /dev/vda /dev/vda1; do
        [ -b "$dev" ] || continue
        $BB echo "    Trying $dev..."
        $BB mkdir -p /mnt/iso
        if $BB mount -t iso9660 -o ro "$dev" /mnt/iso 2>/dev/null || \
           $BB mount -t vfat -o ro "$dev" /mnt/iso 2>/dev/null; then
            if [ -f "/mnt/iso/quantix/system.squashfs" ]; then
                $BB echo "  ✓ Found boot media at $dev"
                FOUND=1
                break 2
            fi
            $BB umount /mnt/iso 2>/dev/null
        fi
    done
    
    $BB sleep 2
done

if [ $FOUND -eq 0 ]; then
    $BB echo ""
    $BB echo "❌ FATAL: Could not find Quantix-OS boot media!"
    $BB echo ""
    $BB echo "Available devices:"
    $BB ls -la /dev/ | $BB grep -E "sd|sr|vd|nvme"
    $BB echo ""
    $BB echo "Dropping to emergency shell..."
    exec $BB sh
fi

# Mount squashfs
$BB echo "Mounting system root..."
$BB mkdir -p /mnt/squash
if ! $BB mount -t squashfs -o ro /mnt/iso/quantix/system.squashfs /mnt/squash; then
    $BB echo "❌ Failed to mount squashfs"
    exec $BB sh
fi

# Setup OverlayFS for live mode
$BB echo "Setting up OverlayFS (Live Mode)..."
$BB mkdir -p /newroot /run/overlay
$BB mount -t tmpfs -o size=50% tmpfs /run/overlay
$BB mkdir -p /run/overlay/upper /run/overlay/work

if $BB mount -t overlay overlay \
    -o lowerdir=/mnt/squash,upperdir=/run/overlay/upper,workdir=/run/overlay/work \
    /newroot; then
    $BB echo "  ✓ OverlayFS mounted"
else
    $BB echo "  ⚠ OverlayFS failed, using read-only root"
    $BB mount --bind /mnt/squash /newroot
fi

# Move ISO mount into new root
$BB mkdir -p /newroot/mnt/iso
$BB mount --move /mnt/iso /newroot/mnt/iso 2>/dev/null || true

# Prepare for switch
$BB echo ""
$BB echo "Switching to main system..."
$BB umount /proc 2>/dev/null
$BB umount /sys 2>/dev/null

# Switch root and execute init
exec $BB switch_root /newroot /sbin/init

# If we get here, something went wrong
$BB echo "❌ switch_root failed!"
exec $BB sh
INITEOF
fi

chmod +x "${INITRAMFS_DIR}/init"

echo "✅ Init script created"

# -----------------------------------------------------------------------------
# Step 5: Create initramfs image
# -----------------------------------------------------------------------------
echo "📦 Step 5: Packaging initramfs..."

mkdir -p "${OUTPUT_DIR}"

cd "${INITRAMFS_DIR}"

# Use find with -print0 and cpio for robust handling
find . -print0 | cpio --null -ov --format=newc 2>/dev/null | gzip -9 > "${OUTPUT_DIR}/initramfs.img"

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
