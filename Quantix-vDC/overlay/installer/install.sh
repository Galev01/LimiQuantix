#!/bin/sh
# =============================================================================
# Quantix-vDC Installer
# =============================================================================
# Main installation script for Quantix-vDC appliance.
# Called by the TUI or can be run directly with parameters.
#
# Usage:
#   ./install.sh                    # Interactive TUI mode
#   ./install.sh --disk /dev/sda    # Non-interactive mode
#
# Environment Variables:
#   TARGET_DISK     - Target disk device (e.g., /dev/sda)
#   HOSTNAME        - Hostname for the appliance
#   NET_INTERFACE   - Network interface (e.g., eth0, wlan0)
#   NET_TYPE        - Network type: ethernet or wifi
#   WIFI_SSID       - WiFi network name (if NET_TYPE=wifi)
#   WIFI_PASSWORD   - WiFi password (if NET_TYPE=wifi)
#   IP_MODE         - Network mode: dhcp or static
#   IP_ADDRESS      - Static IP address (if IP_MODE=static)
#   IP_NETMASK      - Netmask (if IP_MODE=static)
#   IP_GATEWAY      - Gateway (if IP_MODE=static)
#   IP_DNS          - DNS server (if IP_MODE=static)
#   ADMIN_PASSWORD  - Admin password
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SQUASHFS_PATH="${SQUASHFS_PATH:-/mnt/cdrom/quantix-vdc/system.squashfs}"
TARGET_MOUNT="/mnt/target"

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up..."
    umount "${TARGET_MOUNT}/boot/efi" 2>/dev/null || true
    umount "${TARGET_MOUNT}/proc" 2>/dev/null || true
    umount "${TARGET_MOUNT}/sys" 2>/dev/null || true
    umount "${TARGET_MOUNT}/dev" 2>/dev/null || true
    umount "${TARGET_MOUNT}" 2>/dev/null || true
}

trap cleanup EXIT

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root"
    exit 1
fi

# Parse command line arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --disk)
            TARGET_DISK="$2"
            shift 2
            ;;
        --hostname)
            HOSTNAME="$2"
            shift 2
            ;;
        --interface)
            NET_INTERFACE="$2"
            shift 2
            ;;
        --wifi)
            NET_TYPE="wifi"
            shift
            ;;
        --ssid)
            WIFI_SSID="$2"
            shift 2
            ;;
        --wifi-password)
            WIFI_PASSWORD="$2"
            shift 2
            ;;
        --dhcp)
            IP_MODE="dhcp"
            shift
            ;;
        --static)
            IP_MODE="static"
            shift
            ;;
        --ip)
            IP_ADDRESS="$2"
            shift 2
            ;;
        --netmask)
            IP_NETMASK="$2"
            shift 2
            ;;
        --gateway)
            IP_GATEWAY="$2"
            shift 2
            ;;
        --dns)
            IP_DNS="$2"
            shift 2
            ;;
        --password)
            ADMIN_PASSWORD="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

# Verify required parameters
if [ -z "$TARGET_DISK" ]; then
    log_error "TARGET_DISK is required"
    exit 1
fi

if [ ! -b "$TARGET_DISK" ]; then
    log_error "Target disk not found: $TARGET_DISK"
    exit 1
fi

if [ ! -f "$SQUASHFS_PATH" ]; then
    log_error "System image not found: $SQUASHFS_PATH"
    exit 1
fi

# Defaults
HOSTNAME="${HOSTNAME:-quantix-vdc}"
IP_MODE="${IP_MODE:-dhcp}"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-vDC Installation Starting                ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

log_info "Installation Parameters:"
log_info "  Target Disk:  $TARGET_DISK"
log_info "  Hostname:     $HOSTNAME"
log_info "  Network:      $IP_MODE"
if [ "$IP_MODE" = "static" ]; then
    log_info "  IP Address:   $IP_ADDRESS"
    log_info "  Netmask:      $IP_NETMASK"
    log_info "  Gateway:      $IP_GATEWAY"
    log_info "  DNS:          $IP_DNS"
fi
echo ""

# =============================================================================
# Step 1: Partition the disk
# =============================================================================
log_step "Step 1: Partitioning disk..."

# Wipe existing partition table (beginning)
dd if=/dev/zero of="$TARGET_DISK" bs=512 count=34 2>/dev/null || true

# Wipe GPT backup at end of disk (if blockdev is available)
if command -v blockdev >/dev/null 2>&1; then
    DISK_SECTORS=$(blockdev --getsz "$TARGET_DISK" 2>/dev/null)
    if [ -n "$DISK_SECTORS" ] && [ "$DISK_SECTORS" -gt 34 ]; then
        dd if=/dev/zero of="$TARGET_DISK" bs=512 seek=$((DISK_SECTORS - 34)) count=34 2>/dev/null || true
    fi
else
    log_warn "blockdev not found, skipping GPT backup wipe"
fi

# Create GPT partition table
parted -s "$TARGET_DISK" mklabel gpt

# Partition layout:
# 1: EFI System Partition (256MB)
# 2: Root partition (10GB)
# 3: Data partition (rest)

parted -s "$TARGET_DISK" \
    mkpart ESP fat32 1MiB 257MiB \
    set 1 esp on \
    mkpart root ext4 257MiB 10497MiB \
    mkpart data ext4 10497MiB 100%

# Determine partition naming (nvme vs sd vs vd)
case "$TARGET_DISK" in
    /dev/nvme*)
        PART1="${TARGET_DISK}p1"
        PART2="${TARGET_DISK}p2"
        PART3="${TARGET_DISK}p3"
        ;;
    *)
        PART1="${TARGET_DISK}1"
        PART2="${TARGET_DISK}2"
        PART3="${TARGET_DISK}3"
        ;;
esac

# Wait for partitions to appear
sleep 2

log_info "Partitions created: $PART1, $PART2, $PART3"

# =============================================================================
# Step 2: Format partitions
# =============================================================================
log_step "Step 2: Formatting partitions..."

mkfs.vfat -F 32 -n QUANTIX-EFI "$PART1"
mkfs.ext4 -L QUANTIX-ROOT -F "$PART2"
mkfs.ext4 -L QUANTIX-DATA -F "$PART3"

log_info "Partitions formatted"

# =============================================================================
# Step 3: Mount partitions
# =============================================================================
log_step "Step 3: Mounting partitions..."

mkdir -p "${TARGET_MOUNT}"
mount "$PART2" "${TARGET_MOUNT}"

mkdir -p "${TARGET_MOUNT}/boot/efi"
mount "$PART1" "${TARGET_MOUNT}/boot/efi"

mkdir -p "${TARGET_MOUNT}/var/lib"

log_info "Partitions mounted"

# =============================================================================
# Step 4: Extract system
# =============================================================================
log_step "Step 4: Extracting system image..."

# Mount squashfs and copy contents
mkdir -p /tmp/sqfs
mount -t squashfs -o loop "$SQUASHFS_PATH" /tmp/sqfs

# Copy system files
cp -a /tmp/sqfs/* "${TARGET_MOUNT}/"

umount /tmp/sqfs
rmdir /tmp/sqfs

# Copy kernel and initramfs from ISO
log_info "Copying boot files from ISO..."
mkdir -p "${TARGET_MOUNT}/boot"

# Determine the cdrom path (may vary based on how the installer mounts it)
CDROM_PATH="/mnt/cdrom"
if [ ! -d "$CDROM_PATH/boot" ]; then
    # Try alternative paths
    for alt_path in "/cdrom" "/media/cdrom" "/mnt/iso"; do
        if [ -d "$alt_path/boot" ]; then
            CDROM_PATH="$alt_path"
            log_info "Found ISO at $CDROM_PATH"
            break
        fi
    done
fi

# Debug: Show what's available
log_info "Looking for boot files at ${CDROM_PATH}/boot/"
ls -la "${CDROM_PATH}/boot/" 2>&1 | while read line; do log_info "  $line"; done || log_warn "Could not list ${CDROM_PATH}/boot/"

# Copy kernel
if [ -f "${CDROM_PATH}/boot/vmlinuz" ]; then
    cp "${CDROM_PATH}/boot/vmlinuz" "${TARGET_MOUNT}/boot/vmlinuz-lts"
    log_info "Kernel copied to /boot/vmlinuz-lts"
else
    log_warn "Kernel not found at ${CDROM_PATH}/boot/vmlinuz"
    log_warn "Using kernel from squashfs (if available)"
fi

# Copy initramfs - prefer boot-initramfs (designed for installed system)
BOOT_INITRAMFS_USED=0
if [ -f "${CDROM_PATH}/boot/boot-initramfs" ]; then
    cp "${CDROM_PATH}/boot/boot-initramfs" "${TARGET_MOUNT}/boot/initramfs-lts"
    log_info "✅ Boot initramfs copied to /boot/initramfs-lts"
    BOOT_INITRAMFS_USED=1
elif [ -f "${CDROM_PATH}/boot/initramfs" ]; then
    cp "${CDROM_PATH}/boot/initramfs" "${TARGET_MOUNT}/boot/initramfs-lts"
    log_info "Installer initramfs copied to /boot/initramfs-lts (may need regeneration)"
else
    log_warn "No initramfs found at ${CDROM_PATH}/boot/"
    log_warn "Available files:"
    ls -la "${CDROM_PATH}/" 2>&1 | while read line; do log_warn "  $line"; done || true
fi

log_info "System extracted"

# =============================================================================
# Step 5: Configure fstab
# =============================================================================
log_step "Step 5: Configuring fstab..."

# Get UUIDs
UUID_EFI=$(blkid -s UUID -o value "$PART1")
UUID_ROOT=$(blkid -s UUID -o value "$PART2")
UUID_DATA=$(blkid -s UUID -o value "$PART3")

cat > "${TARGET_MOUNT}/etc/fstab" << EOF
# Quantix-vDC Filesystem Table
# <device>                                  <mount>         <type>  <options>           <dump> <pass>
UUID=${UUID_ROOT}   /               ext4    defaults,noatime    0      1
UUID=${UUID_EFI}    /boot/efi       vfat    defaults,umask=0077 0      2
UUID=${UUID_DATA}   /var/lib        ext4    defaults,noatime    0      2
EOF

log_info "fstab configured"

# =============================================================================
# Step 6: Configure hostname and network
# =============================================================================
log_step "Step 6: Configuring system..."

# Hostname
echo "$HOSTNAME" > "${TARGET_MOUNT}/etc/hostname"

# Copy version file to installed system
if [ -f "${CDROM_PATH}/quantix-vdc/VERSION" ]; then
    cp "${CDROM_PATH}/quantix-vdc/VERSION" "${TARGET_MOUNT}/etc/quantix-version"
    log_info "Version file installed: $(cat ${TARGET_MOUNT}/etc/quantix-version)"
else
    echo "unknown" > "${TARGET_MOUNT}/etc/quantix-version"
fi

# Hosts
cat > "${TARGET_MOUNT}/etc/hosts" << EOF
127.0.0.1       localhost
127.0.1.1       $HOSTNAME
::1             localhost ip6-localhost ip6-loopback
ff02::1         ip6-allnodes
ff02::2         ip6-allrouters
EOF

# Network configuration
# Use NET_INTERFACE if set, otherwise default to eth0
IFACE="${NET_INTERFACE:-eth0}"

if [ "$NET_TYPE" = "wifi" ] && [ -n "$WIFI_SSID" ]; then
    # WiFi configuration
    log_info "Configuring WiFi for $WIFI_SSID on $IFACE"
    
    # Create wpa_supplicant configuration
    mkdir -p "${TARGET_MOUNT}/etc/wpa_supplicant"
    if [ -n "$WIFI_PASSWORD" ]; then
        cat > "${TARGET_MOUNT}/etc/wpa_supplicant/wpa_supplicant.conf" << EOF
ctrl_interface=/var/run/wpa_supplicant
update_config=1

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASSWORD"
    key_mgmt=WPA-PSK
}
EOF
    else
        cat > "${TARGET_MOUNT}/etc/wpa_supplicant/wpa_supplicant.conf" << EOF
ctrl_interface=/var/run/wpa_supplicant
update_config=1

network={
    ssid="$WIFI_SSID"
    key_mgmt=NONE
}
EOF
    fi
    chmod 600 "${TARGET_MOUNT}/etc/wpa_supplicant/wpa_supplicant.conf"
    
    # Enable wpa_supplicant service
    chroot "${TARGET_MOUNT}" /sbin/rc-update add wpa_supplicant default 2>/dev/null || true
    
    # Network interfaces for WiFi
    if [ "$IP_MODE" = "static" ]; then
        cat > "${TARGET_MOUNT}/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet static
    address $IP_ADDRESS
    netmask $IP_NETMASK
    gateway $IP_GATEWAY
    pre-up wpa_supplicant -B -i $IFACE -c /etc/wpa_supplicant/wpa_supplicant.conf
    post-down killall wpa_supplicant
EOF
        echo "nameserver $IP_DNS" > "${TARGET_MOUNT}/etc/resolv.conf"
    else
        cat > "${TARGET_MOUNT}/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet dhcp
    pre-up wpa_supplicant -B -i $IFACE -c /etc/wpa_supplicant/wpa_supplicant.conf
    post-down killall wpa_supplicant
EOF
    fi
else
    # Ethernet configuration
    if [ "$IP_MODE" = "static" ]; then
        cat > "${TARGET_MOUNT}/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet static
    address $IP_ADDRESS
    netmask $IP_NETMASK
    gateway $IP_GATEWAY
EOF

        # DNS
        echo "nameserver $IP_DNS" > "${TARGET_MOUNT}/etc/resolv.conf"
    else
        cat > "${TARGET_MOUNT}/etc/network/interfaces" << EOF
auto lo
iface lo inet loopback

auto $IFACE
iface $IFACE inet dhcp
EOF
    fi
fi

log_info "System configured"

# =============================================================================
# Step 7: Set admin password
# =============================================================================
log_step "Step 7: Setting admin password..."

if [ -n "$ADMIN_PASSWORD" ]; then
    # Generate password hash
    PASS_HASH=$(echo "$ADMIN_PASSWORD" | openssl passwd -6 -stdin)
    
    # Update root password
    sed -i "s|^root:[^:]*:|root:${PASS_HASH}:|" "${TARGET_MOUNT}/etc/shadow"
    
    log_info "Admin password set"
else
    log_warn "No admin password set, root login disabled"
fi

# =============================================================================
# Step 8: Install bootloader
# =============================================================================
log_step "Step 8: Installing bootloader..."

# Mount virtual filesystems for chroot
mount --bind /dev "${TARGET_MOUNT}/dev"
mount --bind /proc "${TARGET_MOUNT}/proc"
mount --bind /sys "${TARGET_MOUNT}/sys"

# Configure mkinitfs to include necessary modules for boot (for future use)
log_info "Configuring initramfs modules..."

# Ensure mkinitfs directories exist
mkdir -p "${TARGET_MOUNT}/etc/mkinitfs"

# Create mkinitfs.conf with all essential features (for future kernel upgrades)
cat > "${TARGET_MOUNT}/etc/mkinitfs/mkinitfs.conf" << 'MKINITCONF'
# Quantix-vDC initramfs configuration
# Include all essential modules for boot on various hardware

# Core features
features="ata base cdrom ext4 keymap kms mmc nvme scsi usb virtio"

# Enable compression
disable_trigger=1
MKINITCONF

log_info "mkinitfs.conf created"

# Only regenerate initramfs if we didn't copy boot-initramfs
# (boot-initramfs is our custom initramfs designed for the installed system)
if [ "$BOOT_INITRAMFS_USED" = "1" ]; then
    log_info "Using pre-built boot-initramfs (skipping mkinitfs)"
    
    # Verify the initramfs exists
    if [ -f "${TARGET_MOUNT}/boot/initramfs-lts" ]; then
        INITRAMFS_SIZE=$(du -h "${TARGET_MOUNT}/boot/initramfs-lts" | cut -f1)
        log_info "✅ Boot initramfs ready: ${INITRAMFS_SIZE}"
    else
        log_error "Boot initramfs missing after copy!"
    fi
else
    # Try mkinitfs as fallback
    log_info "Regenerating initramfs with mkinitfs..."
    KERNEL_VERSION=$(ls "${TARGET_MOUNT}/lib/modules" 2>/dev/null | head -1)
    if [ -n "$KERNEL_VERSION" ]; then
        log_info "Kernel version: $KERNEL_VERSION"
        
        # Check if mkinitfs is available
        if chroot "${TARGET_MOUNT}" which mkinitfs >/dev/null 2>&1; then
            log_info "Running mkinitfs..."
            
            # Run mkinitfs with verbose output
            if chroot "${TARGET_MOUNT}" mkinitfs -c /etc/mkinitfs/mkinitfs.conf "$KERNEL_VERSION"; then
                log_info "✅ Initramfs regenerated successfully"
                
                # Verify initramfs was created
                if [ -f "${TARGET_MOUNT}/boot/initramfs-lts" ]; then
                    INITRAMFS_SIZE=$(du -h "${TARGET_MOUNT}/boot/initramfs-lts" | cut -f1)
                    log_info "Initramfs size: ${INITRAMFS_SIZE}"
                fi
            else
                log_error "mkinitfs failed!"
                log_warn "Attempting manual initramfs copy..."
                
                # Try copying the ISO's boot-initramfs as fallback
                if [ -f "/mnt/cdrom/boot/boot-initramfs" ]; then
                    cp /mnt/cdrom/boot/boot-initramfs "${TARGET_MOUNT}/boot/initramfs-lts"
                    log_warn "Copied boot-initramfs as fallback"
                elif [ -f "/mnt/cdrom/boot/initramfs" ]; then
                    cp /mnt/cdrom/boot/initramfs "${TARGET_MOUNT}/boot/initramfs-lts"
                    log_warn "Copied installer initramfs as fallback"
                fi
            fi
        else
            log_error "mkinitfs not found in installed system!"
            log_warn "Alpine initramfs tools may not be installed."
            
            # Try copying the ISO's boot-initramfs as fallback
            if [ -f "/mnt/cdrom/boot/boot-initramfs" ]; then
                cp /mnt/cdrom/boot/boot-initramfs "${TARGET_MOUNT}/boot/initramfs-lts"
                log_warn "Copied boot-initramfs as fallback"
            elif [ -f "/mnt/cdrom/boot/initramfs" ]; then
                cp /mnt/cdrom/boot/initramfs "${TARGET_MOUNT}/boot/initramfs-lts"
                log_warn "Copied installer initramfs as fallback"
            fi
        fi
    else
        log_error "Could not determine kernel version!"
        log_warn "Listing /lib/modules:"
        ls -la "${TARGET_MOUNT}/lib/modules/" || true
    fi
fi

# Install GRUB for UEFI
chroot "${TARGET_MOUNT}" grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=QUANTIX-VDC --removable 2>/dev/null || {
    log_warn "GRUB EFI install failed, trying fallback..."
    mkdir -p "${TARGET_MOUNT}/boot/efi/EFI/BOOT"
    if [ -f "${TARGET_MOUNT}/usr/lib/grub/x86_64-efi/grub.efi" ]; then
        cp "${TARGET_MOUNT}/usr/lib/grub/x86_64-efi/grub.efi" "${TARGET_MOUNT}/boot/efi/EFI/BOOT/BOOTX64.EFI"
    fi
}

# Create GRUB configuration
cat > "${TARGET_MOUNT}/boot/grub/grub.cfg" << EOF
set timeout=5
set default=0

menuentry "Quantix-vDC" {
    linux /boot/vmlinuz-lts root=UUID=${UUID_ROOT} ro console=tty0 quiet
    initrd /boot/initramfs-lts
}

menuentry "Quantix-vDC (Safe Graphics)" {
    linux /boot/vmlinuz-lts root=UUID=${UUID_ROOT} ro console=tty0 nomodeset
    initrd /boot/initramfs-lts
}

menuentry "Quantix-vDC (Recovery)" {
    linux /boot/vmlinuz-lts root=UUID=${UUID_ROOT} ro console=tty0 single
    initrd /boot/initramfs-lts
}

menuentry "Quantix-vDC (Debug)" {
    linux /boot/vmlinuz-lts root=UUID=${UUID_ROOT} ro console=tty0 console=ttyS0,115200 debug loglevel=7 earlyprintk=vga
    initrd /boot/initramfs-lts
}
EOF

# Unmount virtual filesystems
umount "${TARGET_MOUNT}/dev" 2>/dev/null || true
umount "${TARGET_MOUNT}/proc" 2>/dev/null || true
umount "${TARGET_MOUNT}/sys" 2>/dev/null || true

log_info "Bootloader installed"

# =============================================================================
# Step 9: Finalize
# =============================================================================
log_step "Step 9: Finalizing installation..."

# Sync filesystem
sync

# Unmount partitions
umount "${TARGET_MOUNT}/boot/efi"
umount "${TARGET_MOUNT}"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Installation Complete!                           ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║                                                               ║"
echo "║  Quantix-vDC has been installed successfully.                 ║"
echo "║                                                               ║"
echo "║  Next Steps:                                                  ║"
echo "║  1. Remove the installation media                             ║"
echo "║  2. Reboot the system                                         ║"
echo "║  3. Access the web console at https://<ip-address>/           ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

exit 0
