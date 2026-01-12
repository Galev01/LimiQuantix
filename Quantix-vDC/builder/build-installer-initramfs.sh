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
           modprobe insmod lsmod depmod losetup setsid cttyhack \
           fdisk sfdisk blkid lsblk dd clear dmesg \
           ip ifconfig route ping hostname uname date \
           mdev find xargs head tail sort uniq wc cut tr \
           tar gzip gunzip zcat cpio vi ps kill killall \
           sync reboot poweroff halt true false test [ expr; do
    ln -sf busybox "${INITRAMFS_DIR}/bin/$cmd" 2>/dev/null || true
done

# Also create in /sbin for compatibility
for cmd in modprobe insmod lsmod depmod mdev blkid losetup switch_root pivot_root reboot poweroff halt init; do
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
# Copy WiFi firmware (CRITICAL for WiFi during install)
# =============================================================================
echo "   Copying WiFi firmware..."
mkdir -p "${INITRAMFS_DIR}/lib/firmware"

# Get firmware from rootfs squashfs if available
if [ -f "${OUTPUT_DIR}/system-"*".squashfs" ]; then
    SQUASHFS_FILE=$(ls ${OUTPUT_DIR}/system-*.squashfs 2>/dev/null | head -1)
    if [ -n "$SQUASHFS_FILE" ]; then
        mkdir -p /tmp/squashfs_mount
        if mount -t squashfs -o ro "$SQUASHFS_FILE" /tmp/squashfs_mount 2>/dev/null; then
            if [ -d /tmp/squashfs_mount/lib/firmware ]; then
                # Copy essential WiFi firmware (being selective to keep size reasonable)
                for fw_dir in iwlwifi ath9k_htc ath10k ath11k brcm rtlwifi rtw88 rtw89 mediatek mrvl intel; do
                    if [ -d "/tmp/squashfs_mount/lib/firmware/${fw_dir}" ]; then
                        cp -a "/tmp/squashfs_mount/lib/firmware/${fw_dir}" "${INITRAMFS_DIR}/lib/firmware/" 2>/dev/null || true
                    fi
                done
                # Also copy regulatory database (needed for WiFi)
                cp /tmp/squashfs_mount/lib/firmware/regulatory.db* "${INITRAMFS_DIR}/lib/firmware/" 2>/dev/null || true
                
                FW_COUNT=$(find "${INITRAMFS_DIR}/lib/firmware" -type f 2>/dev/null | wc -l)
                echo "   ✅ Copied ${FW_COUNT} firmware files from squashfs"
            fi
            umount /tmp/squashfs_mount 2>/dev/null || true
        fi
        rmdir /tmp/squashfs_mount 2>/dev/null || true
    fi
fi

# Fallback: copy from host system if squashfs mount failed
if [ "$(find "${INITRAMFS_DIR}/lib/firmware" -type f 2>/dev/null | wc -l)" -lt 10 ]; then
    echo "   Trying host firmware as fallback..."
    for fw_dir in iwlwifi ath9k_htc ath10k ath11k brcm rtlwifi rtw88 rtw89 mediatek mrvl intel; do
        if [ -d "/lib/firmware/${fw_dir}" ]; then
            cp -a "/lib/firmware/${fw_dir}" "${INITRAMFS_DIR}/lib/firmware/" 2>/dev/null || true
        fi
    done
    cp /lib/firmware/regulatory.db* "${INITRAMFS_DIR}/lib/firmware/" 2>/dev/null || true
    FW_COUNT=$(find "${INITRAMFS_DIR}/lib/firmware" -type f 2>/dev/null | wc -l)
    echo "   ✅ Copied ${FW_COUNT} firmware files from host"
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
# Copy WiFi tools for wireless network configuration during install
# =============================================================================
echo "   Copying WiFi tools..."
for tool in wpa_supplicant wpa_cli iwlist iwconfig; do
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

# Copy wpa_supplicant support files
mkdir -p "${INITRAMFS_DIR}/etc/wpa_supplicant"
mkdir -p "${INITRAMFS_DIR}/var/run/wpa_supplicant"

# Copy wireless libraries
for lib in libnl*.so* libssl*.so* libcrypto*.so*; do
    find /lib /usr/lib -name "$lib" -exec cp {} "${INITRAMFS_DIR}/lib/" \; 2>/dev/null || true
done
echo "   ✅ WiFi tools copied"

# =============================================================================
# Copy terminal definitions (REQUIRED for dialog to render)
# =============================================================================
echo "   Copying terminal definitions..."
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/l"
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/v"
mkdir -p "${INITRAMFS_DIR}/usr/share/terminfo/x"
mkdir -p "${INITRAMFS_DIR}/etc/terminfo/l"

# Copy the 'linux' terminfo used by the kernel console
# Alpine can have terminfo in different locations
for terminfo_base in /usr/share/terminfo /lib/terminfo /etc/terminfo; do
    if [ -f "${terminfo_base}/l/linux" ]; then
        cp "${terminfo_base}/l/linux" "${INITRAMFS_DIR}/usr/share/terminfo/l/"
        cp "${terminfo_base}/l/linux" "${INITRAMFS_DIR}/etc/terminfo/l/"
        echo "      Found linux terminfo in ${terminfo_base}"
        break
    fi
done

# Also copy vt100 and xterm as fallbacks
for term in vt100 vt102 vt220; do
    for terminfo_base in /usr/share/terminfo /lib/terminfo /etc/terminfo; do
        if [ -f "${terminfo_base}/v/${term}" ]; then
            cp "${terminfo_base}/v/${term}" "${INITRAMFS_DIR}/usr/share/terminfo/v/" 2>/dev/null || true
            break
        fi
    done
done

for term in xterm xterm-256color; do
    for terminfo_base in /usr/share/terminfo /lib/terminfo /etc/terminfo; do
        if [ -f "${terminfo_base}/x/${term}" ]; then
            cp "${terminfo_base}/x/${term}" "${INITRAMFS_DIR}/usr/share/terminfo/x/" 2>/dev/null || true
            break
        fi
    done
done

echo "   ✅ Terminal definitions copied"

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

# Create essential TTY devices if not present
# These are needed for dialog and the TUI to work properly
[ -c /dev/tty ] || mknod /dev/tty c 5 0
[ -c /dev/tty0 ] || mknod /dev/tty0 c 4 0
[ -c /dev/tty1 ] || mknod /dev/tty1 c 4 1
[ -c /dev/console ] || mknod /dev/console c 5 1
[ -c /dev/null ] || mknod /dev/null c 1 3

# Set proper permissions
chmod 666 /dev/tty /dev/tty0 /dev/tty1 /dev/console /dev/null 2>/dev/null || true

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
modprobe vfat
modprobe fat
modprobe nls_cp437
modprobe nls_iso8859_1
modprobe ext4
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

# Graphics/Framebuffer (CRITICAL for real hardware display)
log "Loading graphics drivers..."
for mod in efifb vesafb simplefb drm drm_kms_helper i915 nouveau amdgpu radeon; do
    modprobe $mod >/dev/null 2>&1 || true
done

# WiFi/Wireless (CRITICAL for network during install)
log "Loading WiFi drivers..."
# Core wireless stack
for mod in cfg80211 mac80211 rfkill; do
    modprobe $mod >/dev/null 2>&1 || true
done
# Intel WiFi
for mod in iwlwifi iwlmvm iwldvm; do
    modprobe $mod >/dev/null 2>&1 || true
done
# Atheros WiFi
for mod in ath ath9k ath9k_htc ath10k_core ath10k_pci ath11k ath11k_pci ath12k; do
    modprobe $mod >/dev/null 2>&1 || true
done
# Realtek WiFi
for mod in rtlwifi rtl8192ce rtl8192cu rtl8192de rtl8192se rtl8723ae rtl8723be rtl8188ee rtl8821ae rtw88_core rtw88_pci rtw88_usb rtw89_core rtw89_pci; do
    modprobe $mod >/dev/null 2>&1 || true
done
# Broadcom WiFi
for mod in brcmfmac brcmsmac b43 b43legacy; do
    modprobe $mod >/dev/null 2>&1 || true
done
# Mediatek WiFi
for mod in mt76 mt7601u mt7603e mt7615e mt7663s mt7663u mt7915e mt7921e mt7921s mt7921u; do
    modprobe $mod >/dev/null 2>&1 || true
done
# Marvell WiFi
for mod in mwifiex mwifiex_pcie mwifiex_sdio mwifiex_usb; do
    modprobe $mod >/dev/null 2>&1 || true
done

# Let all devices settle
log "Waiting for devices to settle..."
mdev -s
sleep 3

# Re-run mdev to catch any late-detected devices (NVMe can be slow)
mdev -s
sleep 1

# Log detected storage devices
log "Detected storage devices:"
ls -la /dev/nvme* /dev/sd* /dev/sr* > /dev/kmsg 2>&1 || true

# 6. Find Boot Media
log "Searching for boot media..."
BOOT_DEVICE=""
SQUASHFS_FILE=""

# List devices for debug
ls -la /dev/sr* /dev/sd* /dev/nvme* > /dev/kmsg 2>&1 || true

# Check CD-ROM first, then USB drives and their partitions
for dev in /dev/sr0 /dev/sr1 /dev/cdrom /dev/sda1 /dev/sda2 /dev/sda /dev/sdb1 /dev/sdb2 /dev/sdb /dev/nvme0n1p1 /dev/nvme0n1p2; do
    if [ -b "$dev" ]; then
        log "Checking device: $dev"
        mkdir -p /mnt/check
        
        # Try mounting (try iso9660 first for CDs, then auto-detect)
        MOUNTED=0
        for fstype in iso9660 vfat ext4 auto; do
            if mount -t $fstype -o ro "$dev" /mnt/check 2>/dev/null; then
                MOUNTED=1
                break
            fi
        done
        
        if [ $MOUNTED -eq 1 ]; then
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

# Create base overlay mount point
mkdir -p /mnt/overlay

# Mount tmpfs FIRST - this will be used for the writable layer
mount -t tmpfs tmpfs /mnt/overlay

# NOW create the directories inside the mounted tmpfs
mkdir -p /mnt/overlay/upper
mkdir -p /mnt/overlay/work 
mkdir -p /mnt/overlay/merged

# Mount overlay filesystem
if mount -t overlay overlay -o lowerdir=/mnt/rootfs,upperdir=/mnt/overlay/upper,workdir=/mnt/overlay/work /mnt/overlay/merged; then
    log "OverlayFS mounted successfully"
else
    log "OverlayFS mount failed, continuing without overlay..."
fi

# 9. Handover to Installer
log "Launching installer..."
export TERM=linux
export PATH=/bin:/sbin:/usr/bin:/usr/sbin

# Determine the root to use - prefer overlay merged, fallback to direct rootfs
if [ -d "/mnt/overlay/merged/installer" ]; then
    INSTALL_ROOT="/mnt/overlay/merged"
    log "Using overlay merged root"
elif [ -d "/mnt/rootfs/installer" ]; then
    INSTALL_ROOT="/mnt/rootfs"
    log "Using direct rootfs (read-only)"
else
    log "No installer found in rootfs!"
    ls -la /mnt/rootfs/ > /dev/kmsg 2>&1 || true
    exec /bin/sh
fi

# Set up chroot environment
log "Preparing chroot environment..."

# Create necessary directories in chroot
mkdir -p "${INSTALL_ROOT}/dev"
mkdir -p "${INSTALL_ROOT}/dev/pts"
mkdir -p "${INSTALL_ROOT}/sys"
mkdir -p "${INSTALL_ROOT}/proc"
mkdir -p "${INSTALL_ROOT}/tmp"

# Mount essential filesystems
mount --bind /dev "${INSTALL_ROOT}/dev"
mount -t devpts devpts "${INSTALL_ROOT}/dev/pts" 2>/dev/null || true
mount --bind /sys "${INSTALL_ROOT}/sys"
mount --bind /proc "${INSTALL_ROOT}/proc"
mount -t tmpfs tmpfs "${INSTALL_ROOT}/tmp"

# Keep CD-ROM mounted for potential use during installation
mkdir -p "${INSTALL_ROOT}/mnt/cdrom"
mount --bind /mnt/cdrom "${INSTALL_ROOT}/mnt/cdrom"

# Ensure console is accessible in chroot
if [ ! -e "${INSTALL_ROOT}/dev/console" ]; then
    mknod "${INSTALL_ROOT}/dev/console" c 5 1 2>/dev/null || true
fi
if [ ! -e "${INSTALL_ROOT}/dev/tty" ]; then
    mknod "${INSTALL_ROOT}/dev/tty" c 5 0 2>/dev/null || true
fi

# Determine which console device to use (needed for TUI and fallback shell)
CONSOLE_DEV="/dev/console"
if [ -c /dev/tty1 ]; then
    CONSOLE_DEV="/dev/tty1"
elif [ -c /dev/tty0 ]; then
    CONSOLE_DEV="/dev/tty0"
fi
log "Console device: ${CONSOLE_DEV}"

if [ -f "${INSTALL_ROOT}/installer/tui.sh" ]; then
    log "Running TUI in chroot..."
    
    # Diagnostics: Check if dialog and terminfo exist
    log "Checking dialog..."
    if [ -f "${INSTALL_ROOT}/usr/bin/dialog" ]; then
        log "  dialog found at /usr/bin/dialog"
    else
        log "  ERROR: dialog NOT found!"
        ls -la "${INSTALL_ROOT}/usr/bin/" > /dev/kmsg 2>&1 || true
    fi
    
    log "Checking terminfo..."
    if [ -d "${INSTALL_ROOT}/usr/share/terminfo/l" ]; then
        ls -la "${INSTALL_ROOT}/usr/share/terminfo/l/" > /dev/kmsg 2>&1 || true
    else
        log "  Terminfo directory not found, checking alternatives..."
        ls -la "${INSTALL_ROOT}/etc/terminfo/" > /dev/kmsg 2>&1 || true
    fi
    
    # Clear the screen before launching TUI
    clear > ${CONSOLE_DEV} 2>&1 || true
    
    # Set terminal environment variables
    export TERM=linux
    export HOME=/root
    export SHELL=/bin/sh
    export TERMINFO=/usr/share/terminfo
    
    # Run the TUI with proper terminal access
    log "Launching chroot with console: ${CONSOLE_DEV}"
    
    # Create a wrapper script that sets up the controlling terminal
    # This replaces cttyhack which isn't available in Alpine busybox
    cat > /tmp/run-tui.sh << 'TUISCRIPT'
#!/bin/sh
export TERM=linux
export HOME=/root
export TERMINFO=/usr/share/terminfo
export PATH=/bin:/sbin:/usr/bin:/usr/sbin

# Test dialog before running TUI
if command -v dialog >/dev/null 2>&1; then
    exec /installer/tui.sh
else
    echo 'ERROR: dialog command not found!'
    echo 'Available in /usr/bin:'
    ls /usr/bin/ | head -20
    echo 'Falling back to shell...'
    exec /bin/sh
fi
TUISCRIPT
    chmod +x /tmp/run-tui.sh
    cp /tmp/run-tui.sh "${INSTALL_ROOT}/tmp/run-tui.sh"
    
    # Use setsid to create new session, and run chroot with explicit I/O
    # The key is opening the tty for stdin/stdout/stderr
    setsid sh -c "exec chroot ${INSTALL_ROOT} /tmp/run-tui.sh <${CONSOLE_DEV} >${CONSOLE_DEV} 2>&1"
    
    INSTALL_EXIT=$?
    log "Installer exited with ${INSTALL_EXIT}"
else
    log "Installer script not found inside rootfs!"
    ls -la "${INSTALL_ROOT}/installer/" > /dev/kmsg 2>&1 || true
fi

# Cleanup mounts
umount "${INSTALL_ROOT}/mnt/cdrom" 2>/dev/null || true
umount "${INSTALL_ROOT}/tmp" 2>/dev/null || true
umount "${INSTALL_ROOT}/proc" 2>/dev/null || true
umount "${INSTALL_ROOT}/sys" 2>/dev/null || true
umount "${INSTALL_ROOT}/dev/pts" 2>/dev/null || true
umount "${INSTALL_ROOT}/dev" 2>/dev/null || true

# Handle post-installation
log "Installer finished with exit code: ${INSTALL_EXIT}"

# Check if a reboot was requested (installer creates this file)
if [ -f "/tmp/reboot_requested" ] || [ "${INSTALL_EXIT}" = "0" ]; then
    log "Installation complete. Rebooting in 5 seconds..."
    log "Remove installation media now!"
    sleep 5
    
    # Sync filesystems
    sync
    
    # Unmount everything
    umount -a 2>/dev/null || true
    
    # Force reboot
    log "Rebooting now..."
    reboot -f
    
    # If reboot fails, try alternative
    echo 1 > /proc/sys/kernel/sysrq
    echo b > /proc/sysrq-trigger
fi

# If we get here, installation failed or user chose not to reboot
# Drop to shell - but keep it running as PID 1
log "Dropping to interactive shell..."
log "Type 'reboot -f' to restart or 'poweroff -f' to shutdown."

# Use exec to replace init with sh, keeping PID 1
# The -l flag makes it a login shell
exec setsid sh -c "exec sh -l <${CONSOLE_DEV} >${CONSOLE_DEV} 2>&1"
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
