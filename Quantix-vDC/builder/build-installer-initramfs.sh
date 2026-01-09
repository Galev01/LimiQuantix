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

# =============================================================================
# CRITICAL: Verify busybox is truly static
# =============================================================================
echo "   Verifying busybox linkage..."
BUSYBOX_IS_STATIC=0

# Method 1: Check with ldd
if ldd "${BUSYBOX_PATH}" 2>&1 | grep -q "not a dynamic executable"; then
    BUSYBOX_IS_STATIC=1
elif ldd "${BUSYBOX_PATH}" 2>&1 | grep -q "statically linked"; then
    BUSYBOX_IS_STATIC=1
fi

# Method 2: Check with file command
if file "${BUSYBOX_PATH}" 2>/dev/null | grep -q "statically linked"; then
    BUSYBOX_IS_STATIC=1
fi

if [ $BUSYBOX_IS_STATIC -eq 0 ]; then
    echo "   ❌ ERROR: Busybox is DYNAMICALLY linked!"
    echo "   This WILL cause kernel panic!"
    echo ""
    echo "   File info:"
    file "${BUSYBOX_PATH}"
    echo ""
    echo "   Library dependencies:"
    ldd "${BUSYBOX_PATH}" 2>&1 || true
    echo ""
    echo "   Please install busybox-static or download static binary"
    exit 1
fi

echo "   ✅ Busybox is statically linked (verified)"


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
# Using the EXACT same structure as the working Quantix-OS init script
# =============================================================================
# Quantix-vDC Installer Init Script (Debug Version)
# =============================================================================
cat > "${INITRAMFS_DIR}/init" << 'INITEOF'
#!/bin/sh

# 1. Enable shell tracing (prints every command executed)
set -x

# 2. Define logger function to write to Kernel Log (always visible)
log() {
    echo "[INIT] $@" > /dev/kmsg
    echo "[INIT] $@" > /dev/console
}

log "Starting init script..."

# 3. Mount essential filesystems
mount -t proc none /proc
mount -t sysfs none /sys
mount -t devtmpfs none /dev
mkdir -p /dev/pts
mount -t devpts devpts /dev/pts

# 4. Enable console output
echo 8 > /proc/sys/kernel/printk

log "Filesystems mounted. PID: $$"

# 5. Load Modules
log "Loading modules..."
modprobe scsi_mod
modprobe sd_mod
modprobe sr_mod
modprobe cdrom
modprobe isofs
modprobe squashfs
modprobe overlay
modprobe loop

# Load Hardware Drivers (CRITICAL for QEMU/Hardware detection)
log "Loading hardware drivers..."

# SATA/AHCI
for mod in libata ahci ata_piix ata_generic; do
    modprobe $mod >/dev/null 2>&1
done

# NVMe
for mod in nvme nvme_core; do
    modprobe $mod >/dev/null 2>&1
done

# VirtIO (QEMU)
for mod in virtio virtio_ring virtio_pci virtio_blk virtio_scsi virtio_net; do
    modprobe $mod >/dev/null 2>&1
done

# USB
for mod in usbcore usb_common xhci_hcd xhci_pci ehci_hcd ehci_pci uhci_hcd usb_storage uas; do
    modprobe $mod >/dev/null 2>&1
done

mdev -s
sleep 2

# 6. Find Boot Media
log "Searching for boot media..."
BOOT_DEVICE=""
SQUASHFS_FILE=""

# List devices for debug
ls -la /dev/sr* /dev/sd* > /dev/kmsg 2>&1 || true

for dev in /dev/sr0 /dev/sr1 /dev/cdrom /dev/sda /dev/sdb; do
    if [ -b "$dev" ]; then
        log "Checking device: $dev"
        mkdir -p /mnt/check
        if mount -o ro "$dev" /mnt/check 2>/dev/null; then
             if [ -f "/mnt/check/quantix-vdc/system.squashfs" ]; then
                 log "Found media on $dev"
                 BOOT_DEVICE="$dev"
                 # Keep mounted at /mnt/cdrom
                 mkdir -p /mnt/cdrom
                 mount --move /mnt/check /mnt/cdrom
                 # IMPORTANT: Update path to the new mount point!
                 SQUASHFS_FILE="/mnt/cdrom/quantix-vdc/system.squashfs"
                 break
             fi
             umount /mnt/check
        fi
    fi
done

if [ -z "$SQUASHFS_FILE" ]; then
    log "CRITICAL: No boot media found!"
    log "Dropping to emergency shell..."
    exec /bin/sh
fi

# Verify the squashfs file is accessible
if [ ! -f "$SQUASHFS_FILE" ]; then
    log "ERROR: Squashfs file not accessible at $SQUASHFS_FILE"
    log "Listing /mnt/cdrom:"
    ls -la /mnt/cdrom/ > /dev/kmsg 2>&1 || true
    ls -la /mnt/cdrom/quantix-vdc/ > /dev/kmsg 2>&1 || true
    exec /bin/sh
fi

# Show file info for debugging
log "Squashfs file: $(ls -lh $SQUASHFS_FILE 2>&1)"

log "Mounting system image: $SQUASHFS_FILE"
mkdir -p /mnt/rootfs

# 7. Mount SquashFS 
log "Attempting mount..."

# First, ensure loop devices exist
if [ ! -e /dev/loop0 ]; then
    mknod /dev/loop0 b 7 0
    mknod /dev/loop1 b 7 1
    mknod /dev/loop2 b 7 2
fi

# Try mounting with explicit losetup first (more reliable)
log "Setting up loop device..."
losetup /dev/loop0 "$SQUASHFS_FILE"
LOSETUP_RES=$?

if [ $LOSETUP_RES -ne 0 ]; then
    log "losetup failed with code $LOSETUP_RES"
    log "Trying direct mount -o loop..."
    mount -t squashfs -o ro,loop "$SQUASHFS_FILE" /mnt/rootfs
else
    log "Loop device ready, mounting..."
    mount -t squashfs -o ro /dev/loop0 /mnt/rootfs
fi

MOUNT_RES=$?

if [ $MOUNT_RES -ne 0 ]; then
    log "Mount failed with code $MOUNT_RES"
    log "Loop device status:"
    losetup -a > /dev/kmsg 2>&1 || true
    log "Dropping to shell for debugging..."
    exec /bin/sh
fi

log "System mounted successfully!"

# 8. OverlayFS Setup (Required for writable root)
log "Setting up OverlayFS..."
mkdir -p /mnt/overlay/upper
mkdir -p /mnt/overlay/work
mount -t tmpfs tmpfs /mnt/overlay
mkdir -p /mnt/overlay/max
mount -t overlay overlay -o lowerdir=/mnt/rootfs,upperdir=/mnt/overlay/upper,workdir=/mnt/overlay/work /mnt/overlay/max

# 9. Handover to Installer
log "Launching installer..."
export TERM=linux
export PATH=/bin:/sbin:/usr/bin:/usr/sbin

if [ -f "/mnt/rootfs/installer/tui.sh" ]; then
    log "Running TUI..."
    /bin/sh /mnt/rootfs/installer/tui.sh
    log "Installer exited with $?"
else
    log "Installer script not found inside squashfs!"
    ls -la /mnt/rootfs/installer/ > /dev/kmsg
fi

# Fallback
log "Init process finished. Dropping to shell."
exec /bin/sh
INITEOF


chmod +x "${INITRAMFS_DIR}/init"

# =============================================================================
# Validate initramfs before packing (CRITICAL)
# =============================================================================
echo "   Validating initramfs structure..."

VALIDATION_FAILED=0

# Check /init exists and is executable
if [ ! -f "${INITRAMFS_DIR}/init" ]; then
    echo "   ❌ ERROR: /init is missing!"
    VALIDATION_FAILED=1
elif [ ! -x "${INITRAMFS_DIR}/init" ]; then
    echo "   ❌ ERROR: /init is not executable!"
    VALIDATION_FAILED=1
else
    echo "   ✅ /init exists and is executable"
fi

# Check /bin/busybox exists and is executable
if [ ! -f "${INITRAMFS_DIR}/bin/busybox" ]; then
    echo "   ❌ ERROR: /bin/busybox is missing!"
    VALIDATION_FAILED=1
elif [ ! -x "${INITRAMFS_DIR}/bin/busybox" ]; then
    echo "   ❌ ERROR: /bin/busybox is not executable!"
    VALIDATION_FAILED=1
else
    echo "   ✅ /bin/busybox exists and is executable"
fi

# Check /bin/sh exists (symlink or file)
if [ ! -L "${INITRAMFS_DIR}/bin/sh" ] && [ ! -f "${INITRAMFS_DIR}/bin/sh" ]; then
    echo "   ❌ ERROR: /bin/sh is missing!"
    VALIDATION_FAILED=1
else
    echo "   ✅ /bin/sh exists"
fi

# Verify init shebang
if [ -f "${INITRAMFS_DIR}/init" ]; then
    SHEBANG=$(head -1 "${INITRAMFS_DIR}/init")
    if [ "$SHEBANG" != "#!/bin/sh" ]; then
        echo "   ⚠️  WARNING: /init shebang is '$SHEBANG' (expected '#!/bin/sh')"
    else
        echo "   ✅ /init has correct shebang"
    fi
fi

# Check essential directories
for dir in dev proc sys mnt bin sbin lib; do
    if [ ! -d "${INITRAMFS_DIR}/$dir" ]; then
        echo "   ⚠️  WARNING: /$dir directory is missing"
    fi
done

if [ $VALIDATION_FAILED -eq 1 ]; then
    echo ""
    echo "   ❌ Initramfs validation FAILED!"
    echo "   Listing initramfs root:"
    ls -la "${INITRAMFS_DIR}/" || true
    echo ""
    echo "   Listing /bin:"
    ls -la "${INITRAMFS_DIR}/bin/" || true
    exit 1
fi

echo "   ✅ Initramfs validation passed"

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
echo "✅ The Installer initramfs created:"
echo "   File: ${OUTPUT_DIR}/${INITRAMFS_NAME}"
echo "   Size: ${INITRAMFS_SIZE}"
echo "   Modules: ${MODULE_COUNT}"

# Cleanup
rm -rf "${INITRAMFS_DIR}"
