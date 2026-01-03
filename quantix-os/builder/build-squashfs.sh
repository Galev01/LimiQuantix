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
    cat > "${ROOTFS}/etc/inittab" << 'EOF'
# Quantix-OS inittab
# 
# No traditional login - we run our TUI console instead

# Default runlevel
::sysinit:/sbin/openrc sysinit
::sysinit:/sbin/openrc boot
::wait:/sbin/openrc default

# TTY1: Our custom console (no login!)
tty1::respawn:/usr/local/bin/qx-console

# TTY2-6: Disabled by default (no getty)
# Uncomment for emergency access:
# tty2::respawn:/sbin/getty 38400 tty2

# Emergency shell (activated by kernel parameter: emergency)
ttyS0::respawn:/sbin/getty -L ttyS0 115200 vt100

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
    ln -sf /etc/init.d/libvirtd "${ROOTFS}/etc/runlevels/default/libvirtd" 2>/dev/null || true
    ln -sf /etc/init.d/ovsdb-server "${ROOTFS}/etc/runlevels/default/ovsdb-server" 2>/dev/null || true
    ln -sf /etc/init.d/ovs-vswitchd "${ROOTFS}/etc/runlevels/default/ovs-vswitchd" 2>/dev/null || true
    
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
    
    if [[ -d "${OVERLAY_DIR}" ]]; then
        # Copy overlay files into rootfs
        rsync -av --ignore-existing "${OVERLAY_DIR}/" "${ROOTFS}/"
        
        # Make scripts executable
        find "${ROOTFS}/etc/init.d" -type f -exec chmod +x {} \; 2>/dev/null || true
        find "${ROOTFS}/usr/local/bin" -type f -exec chmod +x {} \; 2>/dev/null || true
        
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
# Quantix-OS Live Boot Init
# All commands use explicit /bin/busybox prefix for reliability

BB=/bin/busybox

# Mount essential filesystems first
$BB mount -t proc none /proc 2>/dev/null
$BB mount -t sysfs none /sys 2>/dev/null
$BB mount -t devtmpfs none /dev 2>/dev/null

$BB echo ""
$BB echo "========================================"
$BB echo "       Quantix-OS Live Boot"
$BB echo "========================================"
$BB echo ""

# Load required modules
$BB echo "Loading kernel modules..."
$BB modprobe loop 2>/dev/null
$BB modprobe squashfs 2>/dev/null
$BB modprobe overlay 2>/dev/null
$BB modprobe iso9660 2>/dev/null
$BB modprobe sr_mod 2>/dev/null
$BB modprobe sd_mod 2>/dev/null
$BB modprobe usb-storage 2>/dev/null
$BB modprobe ata_piix 2>/dev/null
$BB modprobe ahci 2>/dev/null
$BB modprobe cdrom 2>/dev/null

# Wait for devices - simple counter loop
$BB echo "Waiting for devices..."
i=0; while [ $i -lt 3000000 ]; do i=$((i+1)); done
i=0; while [ $i -lt 3000000 ]; do i=$((i+1)); done

# Trigger mdev
if [ -x /sbin/mdev ]; then
    $BB echo /sbin/mdev > /proc/sys/kernel/hotplug
    /sbin/mdev -s 2>/dev/null
fi

# Create device nodes manually if needed
[ ! -b /dev/sr0 ] && $BB mknod /dev/sr0 b 11 0 2>/dev/null
[ ! -b /dev/sr1 ] && $BB mknod /dev/sr1 b 11 1 2>/dev/null

$BB mkdir -p /cdrom

# Find the boot device
$BB echo "Searching for boot media..."
BOOT_DEV=""
SQUASHFS_FILE=""
ATTEMPTS=0

while [ -z "$BOOT_DEV" ] && [ $ATTEMPTS -lt 15 ]; do
    ATTEMPTS=$((ATTEMPTS + 1))
    $BB echo "  Attempt $ATTEMPTS/15..."
    
    for dev in /dev/sr0 /dev/sr1 /dev/sda /dev/sda1 /dev/sdb /dev/sdb1 /dev/sdc /dev/nvme0n1 /dev/nvme0n1p1; do
        [ ! -b "$dev" ] && continue
        
        $BB echo "    Trying $dev..."
        if $BB mount -t iso9660 -o ro "$dev" /cdrom 2>/dev/null; then
            if [ -d /cdrom/quantix ]; then
                for sqfs in /cdrom/quantix/system-*.squashfs; do
                    if [ -f "$sqfs" ]; then
                        SQUASHFS_FILE="$sqfs"
                        BOOT_DEV="$dev"
                        $BB echo "    Found: $sqfs"
                        break 3
                    fi
                done
            fi
            $BB umount /cdrom 2>/dev/null
        fi
    done
    
    # Delay between attempts
    [ -z "$BOOT_DEV" ] && { i=0; while [ $i -lt 2000000 ]; do i=$((i+1)); done; }
done

if [ -z "$BOOT_DEV" ]; then
    $BB echo ""
    $BB echo "ERROR: Cannot find Quantix-OS boot media!"
    $BB echo ""
    $BB echo "Available block devices:"
    $BB ls -la /dev/sr* /dev/sd* /dev/nvme* 2>/dev/null
    $BB echo ""
    $BB echo "Try manually: mount -t iso9660 /dev/sr0 /cdrom"
    exec $BB sh
fi

# Mount the squashfs
$BB echo "Mounting squashfs: $SQUASHFS_FILE"

$BB mkdir -p /squashfs /overlay /newroot

if ! $BB mount -t squashfs -o ro "$SQUASHFS_FILE" /squashfs; then
    $BB echo "ERROR: Failed to mount squashfs!"
    exec $BB sh
fi

# Create tmpfs for overlay
$BB mount -t tmpfs tmpfs /overlay 2>/dev/null
$BB mkdir -p /overlay/upper /overlay/work

# Create overlayfs
$BB echo "Setting up overlay filesystem..."
if ! $BB mount -t overlay overlay -o lowerdir=/squashfs,upperdir=/overlay/upper,workdir=/overlay/work /newroot 2>/dev/null; then
    $BB echo "Overlay failed, using read-only root"
    $BB mount --bind /squashfs /newroot
fi

$BB echo "Root filesystem mounted"

# Prepare new root directories
$BB mkdir -p /newroot/cdrom /newroot/proc /newroot/sys /newroot/dev /newroot/run /newroot/tmp

# Move mounts to new root
$BB mount --move /cdrom /newroot/cdrom 2>/dev/null || $BB mount --bind /cdrom /newroot/cdrom
$BB mount --move /proc /newroot/proc 2>/dev/null
$BB mount --move /sys /newroot/sys 2>/dev/null
$BB mount --move /dev /newroot/dev 2>/dev/null

# Ensure essential device nodes
[ ! -c /newroot/dev/console ] && $BB mknod /newroot/dev/console c 5 1 2>/dev/null
[ ! -c /newroot/dev/null ] && $BB mknod /newroot/dev/null c 1 3 2>/dev/null
[ ! -c /newroot/dev/tty ] && $BB mknod /newroot/dev/tty c 5 0 2>/dev/null
[ ! -c /newroot/dev/tty0 ] && $BB mknod /newroot/dev/tty0 c 4 0 2>/dev/null
[ ! -c /newroot/dev/tty1 ] && $BB mknod /newroot/dev/tty1 c 4 1 2>/dev/null

$BB echo ""
$BB echo "Switching to Quantix-OS..."
$BB echo ""

# Switch root
exec $BB switch_root /newroot /sbin/init

# Fallback
$BB echo "switch_root failed!"
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
