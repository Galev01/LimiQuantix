#!/bin/sh
# ============================================================================
# Quantix-OS Installer
# ============================================================================
# This script installs Quantix-OS to a target disk with A/B partitioning.
#
# Partition Layout:
#   Part 1: EFI/Boot (100MB) - EFI system partition
#   Part 2: System A (300MB) - Active system (squashfs + kernel)
#   Part 3: System B (300MB) - Update target (empty initially)
#   Part 4: Config  (100MB)  - Persistent configuration
#   Part 5: Data    (REST)   - VM storage (XFS by default)
#
# Usage: ./install.sh [--auto] [--disk /dev/sdX] [--data-fs xfs|ext4|zfs]
# ============================================================================

set -e

# Configuration
VERSION="1.0.0"
SCRIPT_DIR="$(dirname "$0")"
SQUASHFS_PATH="/quantix/system-${VERSION}.squashfs"
KERNEL_PATH="/boot/vmlinuz"
INITRAMFS_PATH="/boot/initramfs"

# Partition sizes in MB
EFI_SIZE=100
SYSTEM_SIZE=300
CONFIG_SIZE=100

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# ============================================================================
# Banner
# ============================================================================
show_banner() {
    clear
    cat << 'EOF'

  ██████  ██    ██  █████  ███    ██ ████████ ██ ██   ██        ██████  ███████ 
 ██    ██ ██    ██ ██   ██ ████   ██    ██    ██  ██ ██        ██    ██ ██      
 ██    ██ ██    ██ ███████ ██ ██  ██    ██    ██   ███   █████ ██    ██ ███████ 
 ██ ▄▄ ██ ██    ██ ██   ██ ██  ██ ██    ██    ██  ██ ██        ██    ██      ██ 
  ██████   ██████  ██   ██ ██   ████    ██    ██ ██   ██        ██████  ███████ 
     ▀▀                                                                         

                     QUANTIX-OS INSTALLER v1.0.0
                       Quantix-HyperVisor

EOF
}

# ============================================================================
# Disk Detection
# ============================================================================
detect_disks() {
    log_step "Detecting available disks..."
    
    # Find block devices (exclude loop, ram, rom)
    DISKS=$(lsblk -d -n -o NAME,SIZE,TYPE,MODEL | grep disk | awk '{print "/dev/"$1" ("$2") - "$4}')
    
    if [ -z "$DISKS" ]; then
        log_error "No disks detected!"
        exit 1
    fi
    
    echo ""
    echo "Available disks:"
    echo "================"
    lsblk -d -n -o NAME,SIZE,TYPE,MODEL | grep disk | while read line; do
        DISK_NAME=$(echo "$line" | awk '{print $1}')
        DISK_SIZE=$(echo "$line" | awk '{print $2}')
        DISK_MODEL=$(echo "$line" | awk '{$1=$2=$3=""; print $0}' | xargs)
        echo "  /dev/$DISK_NAME - $DISK_SIZE - $DISK_MODEL"
    done
    echo ""
}

# ============================================================================
# Disk Selection (Interactive)
# ============================================================================
select_disk() {
    if [ -n "$AUTO_DISK" ]; then
        TARGET_DISK="$AUTO_DISK"
        return
    fi
    
    echo "Enter target disk (e.g., /dev/sda, /dev/nvme0n1):"
    read -p "> " TARGET_DISK
    
    # Validate disk exists
    if [ ! -b "$TARGET_DISK" ]; then
        log_error "Disk $TARGET_DISK not found!"
        exit 1
    fi
    
    # Confirm destruction
    echo ""
    log_warn "╔════════════════════════════════════════════════════════════════╗"
    log_warn "║                         WARNING                                ║"
    log_warn "╠════════════════════════════════════════════════════════════════╣"
    log_warn "║  ALL DATA ON $TARGET_DISK WILL BE DESTROYED!                   "
    log_warn "║  This action cannot be undone.                                 ║"
    log_warn "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    
    if [ -z "$AUTO_MODE" ]; then
        read -p "Type 'YES' to continue: " CONFIRM
        if [ "$CONFIRM" != "YES" ]; then
            log_info "Installation cancelled."
            exit 0
        fi
    fi
}

# ============================================================================
# Filesystem Selection
# ============================================================================
select_filesystem() {
    if [ -n "$DATA_FS" ]; then
        return
    fi
    
    DATA_FS="xfs"  # Default
    
    if [ -z "$AUTO_MODE" ]; then
        echo ""
        echo "Select filesystem for data partition:"
        echo "  1) XFS (recommended for large files, VM images)"
        echo "  2) EXT4 (traditional, well-tested)"
        echo "  3) ZFS (advanced features, requires more RAM)"
        read -p "Choice [1]: " FS_CHOICE
        
        case "$FS_CHOICE" in
            2) DATA_FS="ext4" ;;
            3) DATA_FS="zfs" ;;
            *) DATA_FS="xfs" ;;
        esac
    fi
    
    log_info "Using $DATA_FS for data partition"
}

# ============================================================================
# Partition Disk
# ============================================================================
partition_disk() {
    log_step "Partitioning disk..."
    
    # Unmount any existing partitions
    umount "${TARGET_DISK}"* 2>/dev/null || true
    
    # Wipe existing partition table
    wipefs -a "$TARGET_DISK"
    
    # Determine partition suffix (nvme uses 'p', sata uses nothing)
    if echo "$TARGET_DISK" | grep -q "nvme"; then
        PART_PREFIX="${TARGET_DISK}p"
    else
        PART_PREFIX="${TARGET_DISK}"
    fi
    
    # Calculate partition positions
    EFI_END=$EFI_SIZE
    SYSA_END=$((EFI_END + SYSTEM_SIZE))
    SYSB_END=$((SYSA_END + SYSTEM_SIZE))
    CFG_END=$((SYSB_END + CONFIG_SIZE))
    
    # Create GPT partition table
    parted -s "$TARGET_DISK" mklabel gpt
    
    # Create partitions
    parted -s "$TARGET_DISK" mkpart "EFI" fat32 1MiB "${EFI_END}MiB"
    parted -s "$TARGET_DISK" set 1 esp on
    
    parted -s "$TARGET_DISK" mkpart "QUANTIX-A" ext4 "${EFI_END}MiB" "${SYSA_END}MiB"
    
    parted -s "$TARGET_DISK" mkpart "QUANTIX-B" ext4 "${SYSA_END}MiB" "${SYSB_END}MiB"
    
    parted -s "$TARGET_DISK" mkpart "QUANTIX-CFG" ext4 "${SYSB_END}MiB" "${CFG_END}MiB"
    
    parted -s "$TARGET_DISK" mkpart "QUANTIX-DATA" xfs "${CFG_END}MiB" 100%
    
    # Wait for kernel to recognize partitions
    partprobe "$TARGET_DISK"
    sleep 2
    
    log_info "Partitions created:"
    lsblk "$TARGET_DISK"
}

# ============================================================================
# Format Partitions
# ============================================================================
format_partitions() {
    log_step "Formatting partitions..."
    
    # EFI partition (FAT32)
    log_info "Formatting EFI partition..."
    mkfs.vfat -F 32 -n "EFI" "${PART_PREFIX}1"
    
    # System A partition (ext4)
    log_info "Formatting System A partition..."
    mkfs.ext4 -L "QUANTIX-A" -F "${PART_PREFIX}2"
    
    # System B partition (ext4) - leave empty
    log_info "Formatting System B partition..."
    mkfs.ext4 -L "QUANTIX-B" -F "${PART_PREFIX}3"
    
    # Config partition (ext4)
    log_info "Formatting Config partition..."
    mkfs.ext4 -L "QUANTIX-CFG" -F "${PART_PREFIX}4"
    
    # Data partition (user choice)
    log_info "Formatting Data partition with $DATA_FS..."
    case "$DATA_FS" in
        xfs)
            mkfs.xfs -f -L "QUANTIX-DATA" "${PART_PREFIX}5"
            ;;
        ext4)
            mkfs.ext4 -L "QUANTIX-DATA" -F "${PART_PREFIX}5"
            ;;
        zfs)
            # ZFS requires special handling
            zpool create -f -o ashift=12 -O atime=off -O compression=lz4 \
                quantix-data "${PART_PREFIX}5"
            zfs set mountpoint=/data quantix-data
            ;;
    esac
    
    log_info "Partitions formatted"
}

# ============================================================================
# Install System
# ============================================================================
install_system() {
    log_step "Installing Quantix-OS..."
    
    # Create mount points
    INSTALL_ROOT="/mnt/install"
    mkdir -p "${INSTALL_ROOT}/efi"
    mkdir -p "${INSTALL_ROOT}/system"
    mkdir -p "${INSTALL_ROOT}/config"
    mkdir -p "${INSTALL_ROOT}/data"
    
    # Mount partitions
    mount "${PART_PREFIX}1" "${INSTALL_ROOT}/efi"
    mount "${PART_PREFIX}2" "${INSTALL_ROOT}/system"
    mount "${PART_PREFIX}4" "${INSTALL_ROOT}/config"
    
    if [ "$DATA_FS" != "zfs" ]; then
        mount "${PART_PREFIX}5" "${INSTALL_ROOT}/data"
    fi
    
    # =========================================================================
    # Copy system files
    # =========================================================================
    log_info "Copying system image..."
    
    # Create directory structure
    mkdir -p "${INSTALL_ROOT}/system/boot"
    mkdir -p "${INSTALL_ROOT}/system/quantix"
    
    # Copy kernel and initramfs
    cp "$KERNEL_PATH" "${INSTALL_ROOT}/system/boot/vmlinuz"
    cp "$INITRAMFS_PATH" "${INSTALL_ROOT}/system/boot/initramfs"
    
    # Copy squashfs
    cp "$SQUASHFS_PATH" "${INSTALL_ROOT}/system/quantix/system.squashfs"
    
    # Create version file
    echo "$VERSION" > "${INSTALL_ROOT}/system/quantix/version"
    echo "A" > "${INSTALL_ROOT}/system/quantix/active"
    
    # =========================================================================
    # Install EFI bootloader
    # =========================================================================
    log_info "Installing EFI bootloader..."
    
    mkdir -p "${INSTALL_ROOT}/efi/EFI/BOOT"
    mkdir -p "${INSTALL_ROOT}/efi/EFI/quantix"
    mkdir -p "${INSTALL_ROOT}/efi/boot/grub"
    
    # Copy GRUB EFI binary
    if [ -f /usr/lib/grub/x86_64-efi/grub.efi ]; then
        cp /usr/lib/grub/x86_64-efi/grub.efi "${INSTALL_ROOT}/efi/EFI/BOOT/BOOTX64.EFI"
    else
        # Create GRUB image
        grub-mkimage -o "${INSTALL_ROOT}/efi/EFI/BOOT/BOOTX64.EFI" \
            -O x86_64-efi -p /boot/grub \
            part_gpt part_msdos fat ext2 normal boot linux \
            configfile loopback search search_fs_uuid search_label \
            gfxterm all_video font
    fi
    
    # Get UUIDs
    EFI_UUID=$(blkid -s UUID -o value "${PART_PREFIX}1")
    SYSA_UUID=$(blkid -s UUID -o value "${PART_PREFIX}2")
    SYSB_UUID=$(blkid -s UUID -o value "${PART_PREFIX}3")
    CFG_UUID=$(blkid -s UUID -o value "${PART_PREFIX}4")
    DATA_UUID=$(blkid -s UUID -o value "${PART_PREFIX}5")
    
    # Create GRUB configuration
    cat > "${INSTALL_ROOT}/efi/boot/grub/grub.cfg" << EOF
# Quantix-OS GRUB Configuration
# Generated by installer on $(date)

set default=0
set timeout=5
set gfxmode=auto
set gfxpayload=keep

insmod all_video
insmod gfxterm
terminal_output gfxterm

set color_normal=white/black
set color_highlight=black/light-cyan

# System A (Active)
menuentry "Quantix-OS (System A)" --class quantix {
    echo "Loading Quantix-OS..."
    search --no-floppy --fs-uuid --set=root ${SYSA_UUID}
    linux /boot/vmlinuz root=UUID=${SYSA_UUID} ro quiet \
        modloop=/quantix/system.squashfs modules=loop,squashfs,overlay \
        quantix.config=UUID=${CFG_UUID} quantix.data=UUID=${DATA_UUID}
    initrd /boot/initramfs
}

# System B (Fallback/Update Target)
menuentry "Quantix-OS (System B)" --class quantix {
    echo "Loading Quantix-OS (System B)..."
    search --no-floppy --fs-uuid --set=root ${SYSB_UUID}
    linux /boot/vmlinuz root=UUID=${SYSB_UUID} ro quiet \
        modloop=/quantix/system.squashfs modules=loop,squashfs,overlay \
        quantix.config=UUID=${CFG_UUID} quantix.data=UUID=${DATA_UUID}
    initrd /boot/initramfs
}

# Recovery Mode
menuentry "Quantix-OS Recovery Shell" --class rescue {
    echo "Loading Recovery Shell..."
    search --no-floppy --fs-uuid --set=root ${SYSA_UUID}
    linux /boot/vmlinuz root=UUID=${SYSA_UUID} ro \
        modloop=/quantix/system.squashfs modules=loop,squashfs,overlay \
        quantix.config=UUID=${CFG_UUID} init=/bin/sh
    initrd /boot/initramfs
}
EOF

    # =========================================================================
    # Initialize config partition
    # =========================================================================
    log_info "Initializing configuration..."
    
    mkdir -p "${INSTALL_ROOT}/config/quantix"
    mkdir -p "${INSTALL_ROOT}/config/quantix/certificates"
    
    # Copy default config
    if [ -f /etc/quantix/defaults.yaml ]; then
        cp /etc/quantix/defaults.yaml "${INSTALL_ROOT}/config/quantix/node.yaml"
    fi
    
    # Mark for first boot
    touch "${INSTALL_ROOT}/config/quantix/.firstboot"
    
    # =========================================================================
    # Initialize data partition
    # =========================================================================
    log_info "Initializing data storage..."
    
    if [ "$DATA_FS" = "zfs" ]; then
        zfs create quantix-data/vms
        zfs create quantix-data/isos
        zfs create quantix-data/images
        zfs create quantix-data/backups
    else
        mkdir -p "${INSTALL_ROOT}/data/vms"
        mkdir -p "${INSTALL_ROOT}/data/isos"
        mkdir -p "${INSTALL_ROOT}/data/images"
        mkdir -p "${INSTALL_ROOT}/data/backups"
    fi
    
    # =========================================================================
    # Cleanup
    # =========================================================================
    log_info "Finishing installation..."
    
    sync
    
    # Unmount
    umount "${INSTALL_ROOT}/efi"
    umount "${INSTALL_ROOT}/system"
    umount "${INSTALL_ROOT}/config"
    
    if [ "$DATA_FS" = "zfs" ]; then
        zpool export quantix-data
    else
        umount "${INSTALL_ROOT}/data"
    fi
    
    rmdir "${INSTALL_ROOT}/efi" "${INSTALL_ROOT}/system" \
          "${INSTALL_ROOT}/config" "${INSTALL_ROOT}/data" "${INSTALL_ROOT}"
    
    log_info "Installation complete!"
}

# ============================================================================
# Summary
# ============================================================================
show_summary() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║              INSTALLATION COMPLETE!                           ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    echo "║                                                               ║"
    echo "║  Quantix-OS has been installed to: $TARGET_DISK"
    echo "║                                                               ║"
    echo "║  Partition Layout:                                            ║"
    echo "║    ${PART_PREFIX}1 - EFI Boot (${EFI_SIZE}MB)                  "
    echo "║    ${PART_PREFIX}2 - System A (${SYSTEM_SIZE}MB) [ACTIVE]     "
    echo "║    ${PART_PREFIX}3 - System B (${SYSTEM_SIZE}MB) [Updates]    "
    echo "║    ${PART_PREFIX}4 - Config (${CONFIG_SIZE}MB)                "
    echo "║    ${PART_PREFIX}5 - Data ($DATA_FS)                          "
    echo "║                                                               ║"
    echo "║  Next Steps:                                                  ║"
    echo "║    1. Remove installation media                               ║"
    echo "║    2. Reboot the system                                       ║"
    echo "║    3. Configure network via console (F2)                      ║"
    echo "║    4. Access web UI at https://<ip>:8443                      ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    if [ -z "$AUTO_MODE" ]; then
        read -p "Press Enter to reboot..."
        reboot
    fi
}

# ============================================================================
# Parse Arguments
# ============================================================================
parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --auto)
                AUTO_MODE=1
                ;;
            --disk)
                AUTO_DISK="$2"
                shift
                ;;
            --data-fs)
                DATA_FS="$2"
                shift
                ;;
            --help|-h)
                echo "Quantix-OS Installer"
                echo ""
                echo "Usage: $0 [options]"
                echo ""
                echo "Options:"
                echo "  --auto           Non-interactive mode"
                echo "  --disk /dev/X    Target disk"
                echo "  --data-fs TYPE   Data filesystem (xfs, ext4, zfs)"
                echo "  --help           Show this help"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
        shift
    done
}

# ============================================================================
# Main
# ============================================================================
main() {
    parse_args "$@"
    
    show_banner
    detect_disks
    select_disk
    select_filesystem
    partition_disk
    format_partitions
    install_system
    show_summary
}

main "$@"
