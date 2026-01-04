#!/bin/bash
# ============================================================================
# Quantix-OS Root Filesystem Builder
# ============================================================================
# Creates the immutable squashfs root filesystem for Quantix-OS
#
# This script:
# 1. Creates a minimal Alpine-based rootfs
# 2. Installs hypervisor packages (KVM, libvirt, OVS)
# 3. Applies the overlay (our custom configs and binaries)
# 4. Compresses to squashfs
#
# Usage: ./build-squashfs.sh
# Environment:
#   VERSION        - OS version (default: 1.0.0)
#   ARCH           - Architecture (default: x86_64)
#   ALPINE_VERSION - Alpine version (default: 3.20)
# ============================================================================

set -euo pipefail

# Configuration
VERSION="${VERSION:-1.0.0}"
ARCH="${ARCH:-x86_64}"
ALPINE_VERSION="${ALPINE_VERSION:-3.20}"
KERNEL_FLAVOR="${KERNEL_FLAVOR:-lts}"

# Directories
WORK_DIR="/work/rootfs-${VERSION}"
ROOTFS="${WORK_DIR}/rootfs"
OUTPUT_DIR="/output"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ============================================================================
# Step 1: Initialize root filesystem
# ============================================================================
init_rootfs() {
    log_info "Initializing root filesystem..."
    
    # Clean previous builds
    rm -rf "${WORK_DIR}"
    mkdir -p "${ROOTFS}"
    
    # Set up APK directories
    mkdir -p "${ROOTFS}/etc/apk/keys"
    
    # Copy APK keys from the build container to target rootfs
    cp -a /etc/apk/keys/* "${ROOTFS}/etc/apk/keys/"
    
    # Set up APK repositories
    cat > "${ROOTFS}/etc/apk/repositories" << EOF
https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION}/main
https://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VERSION}/community
EOF

    # Initialize APK database with keys directory specified
    apk add --root "${ROOTFS}" --initdb --no-cache \
        --keys-dir "${ROOTFS}/etc/apk/keys" \
        --repositories-file "${ROOTFS}/etc/apk/repositories" \
        --arch "${ARCH}" \
        alpine-base
    
    log_info "Root filesystem initialized"
}

# ============================================================================
# Step 2: Install packages
# ============================================================================
install_packages() {
    log_info "Installing packages..."
    
    # Read package list from profile
    PACKAGES_FILE="/profiles/quantix/packages.conf"
    
    if [[ -f "${PACKAGES_FILE}" ]]; then
        # Filter comments and empty lines
        PACKAGES=$(grep -v '^#' "${PACKAGES_FILE}" | grep -v '^$' | tr '\n' ' ')
    else
        log_warn "No packages.conf found, using defaults"
        PACKAGES="
            linux-lts
            linux-firmware
            busybox
            busybox-suid
            openrc
            e2fsprogs
            util-linux
            blkid
            lvm2
            mdadm
            eudev
            udev-init-scripts
            
            # Virtualization
            qemu-system-x86_64
            qemu-img
            libvirt
            libvirt-daemon
            libvirt-qemu
            
            # Networking
            openvswitch
            iproute2
            iptables
            bridge-utils
            dnsmasq
            
            # Storage
            lvm2
            xfsprogs
            nfs-utils
            open-iscsi
            
            # Tools
            openssh
            curl
            jq
            
            # TUI
            ncurses
            ncurses-terminfo-base
        "
    fi
    
    # Install packages into rootfs
    apk add --root "${ROOTFS}" --no-cache \
        --keys-dir "${ROOTFS}/etc/apk/keys" \
        --repositories-file "${ROOTFS}/etc/apk/repositories" \
        --arch "${ARCH}" \
        ${PACKAGES}
    
    log_info "Packages installed"
}

# ============================================================================
# Step 3: Configure base system
# ============================================================================
configure_system() {
    log_info "Configuring base system..."
    
    # Set up basic configuration
    echo "quantix" > "${ROOTFS}/etc/hostname"
    
    # Configure /etc/hosts
    cat > "${ROOTFS}/etc/hosts" << 'EOF'
127.0.0.1   localhost
::1         localhost ip6-localhost ip6-loopback
ff02::1     ip6-allnodes
ff02::2     ip6-allrouters
EOF

    # Configure resolv.conf (symlink to runtime)
    rm -f "${ROOTFS}/etc/resolv.conf"
    ln -s /run/resolv.conf "${ROOTFS}/etc/resolv.conf"
    
    # Configure /etc/fstab
    cat > "${ROOTFS}/etc/fstab" << 'EOF'
# Quantix-OS Filesystem Table
# Device          Mountpoint  Type      Options         Dump Pass
/dev/root         /           squashfs  ro              0    0
tmpfs             /tmp        tmpfs     nosuid,nodev    0    0
tmpfs             /run        tmpfs     nosuid,nodev    0    0
devpts            /dev/pts    devpts    gid=5,mode=620  0    0
sysfs             /sys        sysfs     defaults        0    0
proc              /proc       proc      defaults        0    0
# Config partition (set by initramfs)
LABEL=QUANTIX-CFG /quantix    ext4      defaults        0    2
# Data partition (set by initramfs)
LABEL=QUANTIX-DATA /data      xfs       defaults        0    2
EOF

    # Configure inittab - disable regular login, start our console
    # Uses the launcher which tries Slint GUI first, then falls back to TUI
    cat > "${ROOTFS}/etc/inittab" << 'EOF'
# Quantix-OS inittab
# 
# No traditional login - we run our graphical console instead
# The launcher tries Slint GUI first, falls back to TUI if needed

# Default runlevel
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default

# TTY1: Quantix Console (GUI with TUI fallback)
tty1::respawn:/usr/local/bin/qx-console-launcher

# TTY2-6: Disabled by default (no getty)
# Uncomment for emergency access:
# tty2::respawn:/sbin/getty 38400 tty2

# Serial console (for headless servers / IPMI / VMs)
ttyS0::respawn:/sbin/getty -L 115200 ttyS0 vt100
hvc0::respawn:/sbin/getty -L 115200 hvc0 vt100

# Shutdown
::shutdown:/sbin/openrc shutdown
::ctrlaltdel:/sbin/reboot
EOF

    # Set up OpenRC runlevels
    mkdir -p "${ROOTFS}/etc/runlevels/default"
    mkdir -p "${ROOTFS}/etc/runlevels/boot"
    mkdir -p "${ROOTFS}/etc/runlevels/sysinit"
    
    # Enable essential services
    ln -sf /etc/init.d/devfs "${ROOTFS}/etc/runlevels/sysinit/devfs" 2>/dev/null || true
    ln -sf /etc/init.d/dmesg "${ROOTFS}/etc/runlevels/sysinit/dmesg" 2>/dev/null || true
    ln -sf /etc/init.d/mdev "${ROOTFS}/etc/runlevels/sysinit/mdev" 2>/dev/null || true
    
    # Quantix setup - runs early to create writable directories
    ln -sf /etc/init.d/quantix-setup "${ROOTFS}/etc/runlevels/boot/quantix-setup" 2>/dev/null || true
    
    ln -sf /etc/init.d/hwclock "${ROOTFS}/etc/runlevels/boot/hwclock" 2>/dev/null || true
    ln -sf /etc/init.d/modules "${ROOTFS}/etc/runlevels/boot/modules" 2>/dev/null || true
    ln -sf /etc/init.d/sysctl "${ROOTFS}/etc/runlevels/boot/sysctl" 2>/dev/null || true
    ln -sf /etc/init.d/hostname "${ROOTFS}/etc/runlevels/boot/hostname" 2>/dev/null || true
    ln -sf /etc/init.d/networking "${ROOTFS}/etc/runlevels/boot/networking" 2>/dev/null || true
    ln -sf /etc/init.d/local "${ROOTFS}/etc/runlevels/boot/local" 2>/dev/null || true
    
    # Enable our services
    # NOTE: libvirtd AND virtlogd are NOT added to runlevel - they're started by local.d script
    # This prevents boot hangs when KVM/nested virtualization isn't available
    # See: overlay/etc/local.d/20-start-libvirtd.start
    # virtlogd can also hang if libvirt sockets aren't ready, so we start it manually too
    ln -sf /etc/init.d/ovsdb-server "${ROOTFS}/etc/runlevels/default/ovsdb-server" 2>/dev/null || true
    ln -sf /etc/init.d/ovs-vswitchd "${ROOTFS}/etc/runlevels/default/ovs-vswitchd" 2>/dev/null || true
    
    # Enable seatd for KMS/DRM session management (required for Slint GUI)
    ln -sf /etc/init.d/seatd "${ROOTFS}/etc/runlevels/boot/seatd" 2>/dev/null || true
    
    # Configure modules to load
    cat > "${ROOTFS}/etc/modules" << 'EOF'
# Virtualization
kvm
kvm_intel
kvm_amd
vhost_net
vhost_vsock

# Networking
openvswitch
bridge
vxlan
geneve
tun
tap

# Storage
virtio_blk
virtio_scsi
nbd
loop
dm_mod
dm_thin_pool

# Graphics/Console (for Slint GUI with KMS)
# DRM core
drm
drm_kms_helper

# Virtual GPU drivers (VMs) - load first for VM environments
virtio_gpu
simpledrm
bochs
cirrus

# Physical GPU drivers (bare metal)
i915
amdgpu
nouveau

# Legacy framebuffer drivers (fallback for basic VGA)
efifb
simplefb
vesafb

# Input devices (for Slint GUI)
uinput
evdev
EOF

    # Configure sysctl for virtualization
    cat > "${ROOTFS}/etc/sysctl.d/99-quantix.conf" << 'EOF'
# Quantix-OS Kernel Parameters

# Enable IP forwarding for VM networking
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1

# Increase inotify limits for many VMs
fs.inotify.max_user_instances = 8192
fs.inotify.max_user_watches = 524288

# Increase file descriptor limits
fs.file-max = 2097152

# Memory management for VMs
vm.swappiness = 10
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5

# Network performance
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# Enable ARP proxy for OVN
net.ipv4.conf.all.proxy_arp = 1
EOF

    log_info "Base system configured"
}

# ============================================================================
# Step 4: Apply overlay
# ============================================================================
apply_overlay() {
    log_info "Applying overlay..."
    
    OVERLAY_DIR="/overlay"
    
    # Debug: Show what's in the overlay mount
    log_info "=== DEBUG: Overlay directory contents ==="
    log_info "Listing ${OVERLAY_DIR}/usr/bin:"
    ls -la "${OVERLAY_DIR}/usr/bin/" 2>&1 || log_warn "No ${OVERLAY_DIR}/usr/bin directory"
    log_info "Listing ${OVERLAY_DIR}/usr/local/bin:"
    ls -la "${OVERLAY_DIR}/usr/local/bin/" 2>&1 || log_warn "No ${OVERLAY_DIR}/usr/local/bin directory"
    log_info "=== END DEBUG ==="
    
    if [[ -d "${OVERLAY_DIR}" ]]; then
        # Ensure target directories exist
        mkdir -p "${ROOTFS}/usr/bin"
        mkdir -p "${ROOTFS}/usr/local/bin"
        
        # Copy overlay files into rootfs (overwrite existing)
        rsync -av "${OVERLAY_DIR}/" "${ROOTFS}/"
        
        # Make scripts and binaries executable
        find "${ROOTFS}/etc/init.d" -type f -exec chmod +x {} \; 2>/dev/null || true
        find "${ROOTFS}/usr/local/bin" -type f -exec chmod +x {} \; 2>/dev/null || true
        find "${ROOTFS}/usr/bin" -type f -exec chmod +x {} \; 2>/dev/null || true
        
        # Debug: Verify what was copied
        log_info "=== DEBUG: Rootfs after overlay ==="
        log_info "Listing ${ROOTFS}/usr/bin:"
        ls -la "${ROOTFS}/usr/bin/" 2>&1 || log_warn "No ${ROOTFS}/usr/bin directory"
        log_info "Listing ${ROOTFS}/usr/local/bin:"
        ls -la "${ROOTFS}/usr/local/bin/" 2>&1 || log_warn "No ${ROOTFS}/usr/local/bin directory"
        log_info "=== END DEBUG ==="
        
        # Verify GUI binary was copied
        if [[ -f "${ROOTFS}/usr/bin/qx-console-gui" ]]; then
            log_info "✓ GUI console binary installed: $(ls -lh ${ROOTFS}/usr/bin/qx-console-gui)"
        else
            log_error "✗ GUI console binary NOT found after applying overlay!"
            log_error "  Expected at: ${ROOTFS}/usr/bin/qx-console-gui"
            log_error "  Source was: ${OVERLAY_DIR}/usr/bin/qx-console-gui"
            if [[ -f "${OVERLAY_DIR}/usr/bin/qx-console-gui" ]]; then
                log_info "  Source file exists in overlay with size: $(ls -lh ${OVERLAY_DIR}/usr/bin/qx-console-gui)"
            else
                log_error "  Source file does NOT exist in overlay mount!"
            fi
        fi
        
        # Verify TUI binary was copied
        if [[ -f "${ROOTFS}/usr/local/bin/qx-console" ]]; then
            log_info "✓ TUI console binary installed: $(ls -lh ${ROOTFS}/usr/local/bin/qx-console)"
        else
            log_error "✗ TUI console binary NOT found after applying overlay!"
        fi
        
        # Verify launcher script was copied
        if [[ -f "${ROOTFS}/usr/local/bin/qx-console-launcher" ]]; then
            log_info "✓ Console launcher installed: $(ls -lh ${ROOTFS}/usr/local/bin/qx-console-launcher)"
        else
            log_error "✗ Console launcher NOT found after applying overlay!"
        fi
        
        log_info "Overlay applied"
    else
        log_warn "No overlay directory found at ${OVERLAY_DIR}"
    fi
}

# ============================================================================
# Step 5: Create initramfs with custom init for live boot
# ============================================================================
create_initramfs() {
    log_info "Creating initramfs..."
    
    # Get kernel version
    KERNEL_VERSION=$(ls "${ROOTFS}/lib/modules" | head -1)
    
    if [[ -z "${KERNEL_VERSION}" ]]; then
        log_error "No kernel found in rootfs!"
        exit 1
    fi
    
    log_info "Kernel version: ${KERNEL_VERSION}"
    
    # Configure mkinitfs with all needed features
    mkdir -p "${ROOTFS}/etc/mkinitfs"
    cat > "${ROOTFS}/etc/mkinitfs/mkinitfs.conf" << 'EOF'
features="ata base cdrom ext4 keymap kms lvm mmc nvme raid scsi squashfs usb virtio xfs"
EOF

    # Create custom initramfs overlay with our init script
    INITRAMFS_OVERLAY="${WORK_DIR}/initramfs-overlay"
    mkdir -p "${INITRAMFS_OVERLAY}"
    
    # Create our custom init script that will be appended to initramfs
    cat > "${INITRAMFS_OVERLAY}/init-quantix" << 'INITEOF'
#!/bin/busybox sh
# Quantix-OS Init
# Supports both Live ISO boot and Installed disk boot
# All commands use explicit /bin/busybox prefix for reliability

BB=/bin/busybox

# Mount essential filesystems first
$BB mount -t proc none /proc 2>/dev/null
$BB mount -t sysfs none /sys 2>/dev/null
$BB mount -t devtmpfs none /dev 2>/dev/null

$BB echo ""
$BB echo "========================================"
$BB echo "         QUANTIX-OS v1.0.0"
$BB echo "========================================"
$BB echo ""

# Parse kernel command line for boot mode
BOOT_MODE="auto"
CONFIG_UUID=""
DATA_UUID=""
for param in $($BB cat /proc/cmdline); do
    case "$param" in
        quantix.mode=*) BOOT_MODE="${param#quantix.mode=}" ;;
        quantix.config=UUID=*) CONFIG_UUID="${param#quantix.config=UUID=}" ;;
        quantix.data=UUID=*) DATA_UUID="${param#quantix.data=UUID=}" ;;
    esac
done

# Load required modules
$BB echo "[*] Loading kernel modules..."
$BB modprobe loop 2>/dev/null
$BB modprobe squashfs 2>/dev/null
$BB modprobe overlay 2>/dev/null
$BB modprobe ext4 2>/dev/null
$BB modprobe xfs 2>/dev/null
$BB modprobe iso9660 2>/dev/null
$BB modprobe sr_mod 2>/dev/null
$BB modprobe sd_mod 2>/dev/null
$BB modprobe nvme 2>/dev/null
$BB modprobe usb-storage 2>/dev/null
$BB modprobe ata_piix 2>/dev/null
$BB modprobe ahci 2>/dev/null
$BB modprobe cdrom 2>/dev/null

# Wait for devices
$BB echo "[*] Waiting for devices..."
i=0; while [ $i -lt 2000000 ]; do i=$((i+1)); done

# Trigger mdev
if [ -x /sbin/mdev ]; then
    $BB echo /sbin/mdev > /proc/sys/kernel/hotplug 2>/dev/null
    /sbin/mdev -s 2>/dev/null
fi

# Create device nodes manually if needed
[ ! -b /dev/sr0 ] && $BB mknod /dev/sr0 b 11 0 2>/dev/null
[ ! -b /dev/sr1 ] && $BB mknod /dev/sr1 b 11 1 2>/dev/null

$BB mkdir -p /mnt /cdrom /squashfs /overlay /newroot

# ============================================================================
# STEP 1: Find and mount the squashfs
# ============================================================================
BOOT_DEV=""
SQUASHFS_FILE=""
BOOT_TYPE=""
ATTEMPTS=0

$BB echo "[*] Searching for Quantix-OS..."

while [ -z "$BOOT_DEV" ] && [ $ATTEMPTS -lt 10 ]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    
    # Try installed disk first (ext4/xfs partitions with /quantix/system.squashfs)
    for dev in /dev/sda2 /dev/sdb2 /dev/nvme0n1p2 /dev/sda /dev/sdb /dev/nvme0n1p1; do
        [ ! -b "$dev" ] && continue
        
        # Try ext4 mount
        if $BB mount -t ext4 -o ro "$dev" /mnt 2>/dev/null; then
            if [ -f /mnt/quantix/system.squashfs ]; then
                SQUASHFS_FILE="/mnt/quantix/system.squashfs"
                BOOT_DEV="$dev"
                BOOT_TYPE="installed"
                $BB echo "[OK] Found installed system on $dev"
                break 2
            fi
            $BB umount /mnt 2>/dev/null
        fi
    done
    
    # Try ISO/CD-ROM (iso9660 with /quantix/system-*.squashfs)
    for dev in /dev/sr0 /dev/sr1 /dev/sda /dev/sda1 /dev/sdb /dev/sdb1; do
        [ ! -b "$dev" ] && continue
        
        if $BB mount -t iso9660 -o ro "$dev" /cdrom 2>/dev/null; then
            for sqfs in /cdrom/quantix/system-*.squashfs; do
                if [ -f "$sqfs" ]; then
                    SQUASHFS_FILE="$sqfs"
                    BOOT_DEV="$dev"
                    BOOT_TYPE="live"
                    $BB echo "[OK] Found live system on $dev"
                    break 3
                fi
            done
            $BB umount /cdrom 2>/dev/null
        fi
    done
    
    # Wait before retry
    [ -z "$BOOT_DEV" ] && { i=0; while [ $i -lt 1000000 ]; do i=$((i+1)); done; }
done

if [ -z "$BOOT_DEV" ]; then
    $BB echo ""
    $BB echo "[ERROR] Cannot find Quantix-OS!"
    $BB echo ""
    $BB echo "Available block devices:"
    $BB ls -la /dev/sr* /dev/sd* /dev/nvme* 2>/dev/null || $BB echo "(none found)"
    $BB echo ""
    $BB echo "Manual recovery:"
    $BB echo "  mount -t ext4 /dev/sdX2 /mnt"
    $BB echo "  mount -t squashfs /mnt/quantix/system.squashfs /squashfs"
    exec $BB sh
fi

# ============================================================================
# STEP 2: Mount squashfs
# ============================================================================
$BB echo "[*] Mounting system image..."

if ! $BB mount -t squashfs -o ro "$SQUASHFS_FILE" /squashfs; then
    $BB echo "[ERROR] Failed to mount squashfs!"
    exec $BB sh
fi

# ============================================================================
# STEP 3: Create overlay filesystem
# ============================================================================
$BB echo "[*] Setting up overlay filesystem..."

$BB mount -t tmpfs -o size=512M tmpfs /overlay 2>/dev/null
$BB mkdir -p /overlay/upper /overlay/work

if ! $BB mount -t overlay overlay -o lowerdir=/squashfs,upperdir=/overlay/upper,workdir=/overlay/work /newroot 2>/dev/null; then
    $BB echo "[WARN] Overlay failed, using read-only root"
    $BB mount --bind /squashfs /newroot
fi

# ============================================================================
# STEP 4: Mount persistent partitions (installed mode)
# ============================================================================
if [ "$BOOT_TYPE" = "installed" ]; then
    $BB echo "[*] Mounting persistent storage..."
    
    # Mount config partition
    $BB mkdir -p /newroot/quantix
    if [ -n "$CONFIG_UUID" ]; then
        CONFIG_DEV=$($BB blkid -U "$CONFIG_UUID" 2>/dev/null)
        [ -n "$CONFIG_DEV" ] && $BB mount -t ext4 "$CONFIG_DEV" /newroot/quantix 2>/dev/null
    fi
    
    # Mount data partition  
    $BB mkdir -p /newroot/data
    if [ -n "$DATA_UUID" ]; then
        DATA_DEV=$($BB blkid -U "$DATA_UUID" 2>/dev/null)
        [ -n "$DATA_DEV" ] && $BB mount "$DATA_DEV" /newroot/data 2>/dev/null
    fi
fi

# ============================================================================
# STEP 5: Prepare for switch_root
# ============================================================================
$BB echo "[*] Preparing root filesystem..."

$BB mkdir -p /newroot/proc /newroot/sys /newroot/dev /newroot/run /newroot/tmp

# Keep boot media mounted for live mode
if [ "$BOOT_TYPE" = "live" ]; then
    $BB mkdir -p /newroot/cdrom
    $BB mount --move /cdrom /newroot/cdrom 2>/dev/null || $BB mount --bind /cdrom /newroot/cdrom
else
    $BB mkdir -p /newroot/boot
    $BB mount --move /mnt /newroot/boot 2>/dev/null || $BB mount --bind /mnt /newroot/boot
fi

$BB mount --move /proc /newroot/proc 2>/dev/null
$BB mount --move /sys /newroot/sys 2>/dev/null  
$BB mount --move /dev /newroot/dev 2>/dev/null

# Ensure essential device nodes
[ ! -c /newroot/dev/console ] && $BB mknod /newroot/dev/console c 5 1 2>/dev/null
[ ! -c /newroot/dev/null ] && $BB mknod /newroot/dev/null c 1 3 2>/dev/null
[ ! -c /newroot/dev/tty ] && $BB mknod /newroot/dev/tty c 5 0 2>/dev/null
[ ! -c /newroot/dev/tty0 ] && $BB mknod /newroot/dev/tty0 c 4 0 2>/dev/null
[ ! -c /newroot/dev/tty1 ] && $BB mknod /newroot/dev/tty1 c 4 1 2>/dev/null

# ============================================================================
# STEP 6: Switch to real root
# ============================================================================
$BB echo ""
$BB echo "[*] Starting Quantix-OS ($BOOT_TYPE mode)..."
$BB echo ""

exec $BB switch_root /newroot /sbin/init

# Fallback
$BB echo "[ERROR] switch_root failed!"
exec $BB sh
INITEOF
    chmod +x "${INITRAMFS_OVERLAY}/init-quantix"

    # Generate standard initramfs first
    mount --bind /dev "${ROOTFS}/dev"
    mount --bind /proc "${ROOTFS}/proc"
    mount --bind /sys "${ROOTFS}/sys"
    
    chroot "${ROOTFS}" mkinitfs -o "/boot/initramfs-${KERNEL_FLAVOR}" "${KERNEL_VERSION}" || true
    
    umount "${ROOTFS}/sys"
    umount "${ROOTFS}/proc"
    umount "${ROOTFS}/dev"
    
    # Now append our custom init to the initramfs
    # Extract the existing initramfs, add our script as init, and repack
    INITRAMFS_WORK="${WORK_DIR}/initramfs-work"
    mkdir -p "${INITRAMFS_WORK}"
    cd "${INITRAMFS_WORK}"
    
    # Extract existing initramfs (it's gzipped cpio)
    gunzip -c "${ROOTFS}/boot/initramfs-${KERNEL_FLAVOR}" | cpio -idm 2>/dev/null || true
    
    # Replace init with our custom init
    cp "${INITRAMFS_OVERLAY}/init-quantix" "${INITRAMFS_WORK}/init"
    chmod +x "${INITRAMFS_WORK}/init"
    
    # Repack initramfs
    find . | cpio -H newc -o 2>/dev/null | gzip -9 > "${ROOTFS}/boot/initramfs-${KERNEL_FLAVOR}"
    
    cd /
    rm -rf "${INITRAMFS_WORK}" "${INITRAMFS_OVERLAY}"
    
    log_info "Initramfs created with custom init"
}

# ============================================================================
# Step 6: Clean up and create squashfs
# ============================================================================
create_squashfs() {
    log_info "Creating squashfs image..."
    
    # Clean up unnecessary files
    rm -rf "${ROOTFS}/var/cache/apk"/*
    rm -rf "${ROOTFS}/tmp"/*
    rm -rf "${ROOTFS}/usr/share/man"/*
    rm -rf "${ROOTFS}/usr/share/doc"/*
    
    # Create version file
    cat > "${ROOTFS}/etc/quantix-release" << EOF
QUANTIX_VERSION="${VERSION}"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
ALPINE_VERSION="${ALPINE_VERSION}"
KERNEL_FLAVOR="${KERNEL_FLAVOR}"
EOF

    # Create squashfs
    OUTPUT_FILE="${OUTPUT_DIR}/system-${VERSION}.squashfs"
    
    mksquashfs "${ROOTFS}" "${OUTPUT_FILE}" \
        -comp xz \
        -b 1M \
        -Xdict-size 100% \
        -no-xattrs \
        -noappend
    
    # Calculate checksum
    sha256sum "${OUTPUT_FILE}" > "${OUTPUT_FILE}.sha256"
    
    # Report size
    SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)
    log_info "Squashfs created: ${OUTPUT_FILE} (${SIZE})"
}

# ============================================================================
# Main
# ============================================================================
main() {
    log_info "============================================"
    log_info "Building Quantix-OS ${VERSION} (${ARCH})"
    log_info "Alpine ${ALPINE_VERSION}, Kernel: ${KERNEL_FLAVOR}"
    log_info "============================================"
    
    init_rootfs
    install_packages
    configure_system
    apply_overlay
    create_initramfs
    create_squashfs
    
    log_info "============================================"
    log_info "Build complete!"
    log_info "Output: ${OUTPUT_DIR}/system-${VERSION}.squashfs"
    log_info "============================================"
}

main "$@"
