#!/bin/bash
# =============================================================================
# Quantix-OS Installer
# =============================================================================
# Installs Quantix-OS to a target disk with A/B partitioning.
#
# Usage: ./install.sh [TARGET_DISK]
#
# Partition Layout:
#   1. EFI (100MB)    - FAT32, UEFI bootloader
#   2. QUANTIX-A (300MB) - ext4, System A
#   3. QUANTIX-B (300MB) - ext4, System B (empty initially)
#   4. QUANTIX-CFG (100MB) - ext4, Configuration
#   5. QUANTIX-DATA (rest) - XFS, VM storage
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TARGET_DISK="${1:-}"
EFI_SIZE="256M"
SYSTEM_SIZE="1500M"  # 1.5GB - squashfs is ~700MB, room for growth
CONFIG_SIZE="256M"

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQUASHFS_PATH=""

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-OS Installer v1.0.0                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

confirm() {
    local prompt="$1"
    local response
    echo -e "${YELLOW}${prompt}${NC}"
    read -r response
    [[ "$response" =~ ^[Yy] ]]
}

# -----------------------------------------------------------------------------
# Step 1: Detect available disks
# -----------------------------------------------------------------------------

detect_disks() {
    echo ""
    log_info "Detecting available disks..."
    echo ""
    
    echo "Available disks:"
    echo "----------------"
    lsblk -d -o NAME,SIZE,MODEL,TYPE | grep -E "disk|NAME"
    echo ""
}

# -----------------------------------------------------------------------------
# Step 2: Select target disk
# -----------------------------------------------------------------------------

select_disk() {
    if [ -n "$TARGET_DISK" ]; then
        if [ -b "$TARGET_DISK" ]; then
            log_info "Using specified disk: ${TARGET_DISK}"
            return 0
        else
            log_error "Specified disk not found: ${TARGET_DISK}"
            exit 1
        fi
    fi
    
    detect_disks
    
    echo -n "Enter target disk (e.g., /dev/sda): "
    read -r TARGET_DISK
    
    if [ ! -b "$TARGET_DISK" ]; then
        log_error "Invalid disk: ${TARGET_DISK}"
        exit 1
    fi
}

# -----------------------------------------------------------------------------
# Step 3: Find squashfs
# -----------------------------------------------------------------------------

find_squashfs() {
    log_info "Locating system image..."
    
    # Try common locations
    for path in \
        "/run/media/cdrom/quantix/system.squashfs" \
        "/mnt/cdrom/quantix/system.squashfs" \
        "/media/cdrom/quantix/system.squashfs" \
        "/cdrom/quantix/system.squashfs" \
        "${SCRIPT_DIR}/../quantix/system.squashfs" \
        "/quantix/system.squashfs"; do
        if [ -f "$path" ]; then
            SQUASHFS_PATH="$path"
            log_info "Found system image: ${SQUASHFS_PATH}"
            return 0
        fi
    done
    
    # Search for any squashfs
    SQUASHFS_PATH=$(find /mnt /media /run/media /cdrom -name "system*.squashfs" 2>/dev/null | head -1)
    
    if [ -z "$SQUASHFS_PATH" ]; then
        log_error "System image not found!"
        log_error "Make sure you're booting from the Quantix-OS ISO."
        exit 1
    fi
    
    log_info "Found system image: ${SQUASHFS_PATH}"
}

# -----------------------------------------------------------------------------
# Step 4: Confirm installation
# -----------------------------------------------------------------------------

confirm_install() {
    echo ""
    echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                        WARNING                                ║${NC}"
    echo -e "${RED}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${RED}║  ALL DATA ON ${TARGET_DISK} WILL BE DESTROYED!${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Target disk: ${TARGET_DISK}"
    echo "Disk size:   $(lsblk -d -o SIZE -n ${TARGET_DISK})"
    echo ""
    
    if ! confirm "Are you sure you want to continue? (y/N): "; then
        log_info "Installation cancelled."
        exit 0
    fi
    
    echo ""
    if ! confirm "FINAL WARNING: This will ERASE ${TARGET_DISK}. Type 'y' to confirm: "; then
        log_info "Installation cancelled."
        exit 0
    fi
}

# -----------------------------------------------------------------------------
# Step 5: Create partitions
# -----------------------------------------------------------------------------

create_partitions() {
    log_info "Creating partition table..."
    
    # Unmount any existing partitions
    umount ${TARGET_DISK}* 2>/dev/null || true
    
    # Create GPT partition table
    parted -s "${TARGET_DISK}" mklabel gpt
    
    log_info "Creating partitions..."
    
    # Calculate partition positions
    # Layout: EFI(256M) + SysA(1.5G) + SysB(1.5G) + Cfg(256M) + Data(rest)
    local efi_end="256M"
    local sys_a_end="1756M"   # 256M + 1500M
    local sys_b_end="3256M"   # 1756M + 1500M  
    local cfg_end="3512M"     # 3256M + 256M
    
    # Create partitions
    parted -s "${TARGET_DISK}" mkpart "EFI" fat32 1MiB ${efi_end}
    parted -s "${TARGET_DISK}" set 1 esp on
    
    parted -s "${TARGET_DISK}" mkpart "QUANTIX-A" ext4 ${efi_end} ${sys_a_end}
    parted -s "${TARGET_DISK}" mkpart "QUANTIX-B" ext4 ${sys_a_end} ${sys_b_end}
    parted -s "${TARGET_DISK}" mkpart "QUANTIX-CFG" ext4 ${sys_b_end} ${cfg_end}
    parted -s "${TARGET_DISK}" mkpart "QUANTIX-DATA" xfs ${cfg_end} 100%
    
    # Wait for kernel to recognize partitions
    partprobe "${TARGET_DISK}"
    sleep 2
    
    log_info "Partitions created successfully"
}

# -----------------------------------------------------------------------------
# Step 6: Format partitions
# -----------------------------------------------------------------------------

format_partitions() {
    log_info "Formatting partitions..."
    
    # Determine partition naming (nvme vs sda)
    if [[ "${TARGET_DISK}" == *"nvme"* ]]; then
        P="p"
    else
        P=""
    fi
    
    # Format EFI partition
    mkfs.vfat -F 32 -n "EFI" "${TARGET_DISK}${P}1"
    
    # Format System A
    mkfs.ext4 -L "QUANTIX-A" -F "${TARGET_DISK}${P}2"
    
    # Format System B
    mkfs.ext4 -L "QUANTIX-B" -F "${TARGET_DISK}${P}3"
    
    # Format Config
    mkfs.ext4 -L "QUANTIX-CFG" -F "${TARGET_DISK}${P}4"
    
    # Format Data
    mkfs.xfs -L "QUANTIX-DATA" -f "${TARGET_DISK}${P}5"
    
    log_info "Partitions formatted successfully"
}

# -----------------------------------------------------------------------------
# Step 7: Install system
# -----------------------------------------------------------------------------

install_system() {
    log_info "Installing Quantix-OS..."
    
    # Determine partition naming
    if [[ "${TARGET_DISK}" == *"nvme"* ]]; then
        P="p"
    else
        P=""
    fi
    
    # Create mount points
    mkdir -p /mnt/install/{efi,system,config,data}
    
    # Mount partitions
    mount "${TARGET_DISK}${P}2" /mnt/install/system
    mount "${TARGET_DISK}${P}1" /mnt/install/efi
    mount "${TARGET_DISK}${P}4" /mnt/install/config
    mount "${TARGET_DISK}${P}5" /mnt/install/data
    
    # Create directory structure on System A
    mkdir -p /mnt/install/system/{boot,quantix}
    
    # Copy squashfs
    log_info "Copying system image..."
    cp "${SQUASHFS_PATH}" /mnt/install/system/quantix/system.squashfs
    
    # Extract kernel and initramfs from squashfs
    log_info "Extracting boot files..."
    mkdir -p /tmp/sqmount
    mount -t squashfs "${SQUASHFS_PATH}" /tmp/sqmount
    
    if [ -f /tmp/sqmount/boot/vmlinuz-lts ]; then
        cp /tmp/sqmount/boot/vmlinuz-lts /mnt/install/system/boot/vmlinuz
    elif [ -f /tmp/sqmount/boot/vmlinuz ]; then
        cp /tmp/sqmount/boot/vmlinuz /mnt/install/system/boot/vmlinuz
    fi
    
    if [ -f /tmp/sqmount/boot/initramfs-lts ]; then
        cp /tmp/sqmount/boot/initramfs-lts /mnt/install/system/boot/initramfs
    elif [ -f /tmp/sqmount/boot/initramfs ]; then
        cp /tmp/sqmount/boot/initramfs /mnt/install/system/boot/initramfs
    fi
    
    umount /tmp/sqmount
    rmdir /tmp/sqmount
    
    # Create config directory structure
    log_info "Creating configuration directories..."
    mkdir -p /mnt/install/config/certificates
    chmod 700 /mnt/install/config
    chmod 700 /mnt/install/config/certificates
    
    # Create data directory structure
    log_info "Creating data directories..."
    mkdir -p /mnt/install/data/{vms,isos,images,backups}
    
    log_info "System files installed"
}

# -----------------------------------------------------------------------------
# Step 8: Install bootloader
# -----------------------------------------------------------------------------

install_bootloader() {
    log_info "Installing GRUB bootloader..."
    
    # Determine partition naming
    if [[ "${TARGET_DISK}" == *"nvme"* ]]; then
        P="p"
    else
        P=""
    fi
    
    # Mount system for chroot
    mkdir -p /mnt/install/root
    mount -t squashfs /mnt/install/system/quantix/system.squashfs /mnt/install/root
    
    # Bind mount EFI
    mkdir -p /mnt/install/root/boot/efi
    mount --bind /mnt/install/efi /mnt/install/root/boot/efi
    
    # Bind mount required filesystems
    mount --bind /dev /mnt/install/root/dev
    mount --bind /proc /mnt/install/root/proc
    mount --bind /sys /mnt/install/root/sys
    
    # Install GRUB for UEFI
    log_info "Installing GRUB for UEFI..."
    chroot /mnt/install/root grub-install \
        --target=x86_64-efi \
        --efi-directory=/boot/efi \
        --bootloader-id=quantix \
        --recheck \
        "${TARGET_DISK}" 2>/dev/null || log_warn "UEFI GRUB installation failed (may be BIOS system)"
    
    # Install GRUB for BIOS
    log_info "Installing GRUB for BIOS..."
    chroot /mnt/install/root grub-install \
        --target=i386-pc \
        --recheck \
        "${TARGET_DISK}" 2>/dev/null || log_warn "BIOS GRUB installation failed (may be UEFI-only system)"
    
    # Create GRUB configuration
    log_info "Creating GRUB configuration..."
    
    cat > /mnt/install/root/boot/grub/grub.cfg << 'GRUBCFG'
set timeout=5
set default=0

insmod all_video
insmod gfxterm
set gfxmode=auto
terminal_output gfxterm

set menu_color_normal=white/black
set menu_color_highlight=black/light-cyan

menuentry "Quantix-OS" --id quantix {
    echo "Loading Quantix-OS..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS (System B)" --id quantix-b {
    echo "Loading Quantix-OS from System B..."
    search --label --set=root QUANTIX-B
    linux /boot/vmlinuz root=LABEL=QUANTIX-B ro quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS (Recovery)" --id recovery {
    echo "Loading Quantix-OS in recovery mode..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro single
    initrd /boot/initramfs
}
GRUBCFG
    
    # Copy GRUB config to EFI partition
    mkdir -p /mnt/install/efi/EFI/quantix
    cp /mnt/install/root/boot/grub/grub.cfg /mnt/install/efi/EFI/quantix/
    
    # Cleanup mounts
    umount /mnt/install/root/sys
    umount /mnt/install/root/proc
    umount /mnt/install/root/dev
    umount /mnt/install/root/boot/efi
    umount /mnt/install/root
    
    log_info "Bootloader installed"
}

# -----------------------------------------------------------------------------
# Step 9: Finalize installation
# -----------------------------------------------------------------------------

finalize_install() {
    log_info "Finalizing installation..."
    
    # Unmount all partitions
    umount /mnt/install/data
    umount /mnt/install/config
    umount /mnt/install/efi
    umount /mnt/install/system
    
    # Sync
    sync
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                           ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Quantix-OS has been installed to ${TARGET_DISK}${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Next steps:                                                  ║${NC}"
    echo -e "${GREEN}║  1. Remove the installation media                             ║${NC}"
    echo -e "${GREEN}║  2. Reboot the system                                         ║${NC}"
    echo -e "${GREEN}║  3. Complete the first-boot wizard                            ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if confirm "Would you like to reboot now? (y/N): "; then
        log_info "Rebooting..."
        reboot
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    # Check if running as root
    if [ "$(id -u)" -ne 0 ]; then
        log_error "This script must be run as root"
        exit 1
    fi
    
    select_disk
    find_squashfs
    confirm_install
    create_partitions
    format_partitions
    install_system
    install_bootloader
    finalize_install
}

main "$@"
