#!/bin/sh
# =============================================================================
# Quantix-OS Installer
# =============================================================================
# Installs Quantix-OS to a target disk with A/B partitioning.
#
# Usage:
#   ./install.sh                         # Interactive TUI mode
#   ./install.sh --disk /dev/sda --auto  # Non-interactive mode
#
# Partition Layout:
#   1. EFI (256MB)       - FAT32, UEFI bootloader
#   2. QUANTIX-A (1.5GB) - ext4, System A (active)
#   3. QUANTIX-B (1.5GB) - ext4, System B (upgrade slot)
#   4. QUANTIX-CFG (256MB) - ext4, Configuration
#   5. QUANTIX-DATA (rest) - XFS, VM storage
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
TARGET_DISK=""
HOSTNAME="quantix"
ROOT_PASSWORD=""
VERSION="0.0.1"
AUTO_MODE=0
STORAGE_POOLS=""  # Format: "/dev/disk1:pool-name /dev/disk2:pool-name"

# Partition sizes
EFI_SIZE="256M"
SYSTEM_SIZE="1500M"  # 1.5GB per system slot
CONFIG_SIZE="256M"

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQUASHFS_PATH=""
TARGET_MOUNT="/mnt/install"

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

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up mount points..."
    umount "${TARGET_MOUNT}/root/boot/efi" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root/dev" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root/proc" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root/sys" 2>/dev/null || true
    umount "${TARGET_MOUNT}/root" 2>/dev/null || true
    umount "${TARGET_MOUNT}/data" 2>/dev/null || true
    umount "${TARGET_MOUNT}/config" 2>/dev/null || true
    umount "${TARGET_MOUNT}/efi" 2>/dev/null || true
    umount "${TARGET_MOUNT}/system" 2>/dev/null || true
    umount /tmp/sqmount 2>/dev/null || true
}

trap cleanup EXIT

# Check if running as root
if [ "$(id -u)" -ne 0 ]; then
    log_error "This script must be run as root"
    exit 1
fi

# -----------------------------------------------------------------------------
# Parse Arguments
# -----------------------------------------------------------------------------

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
        --password)
            ROOT_PASSWORD="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --auto)
            AUTO_MODE=1
            shift
            ;;
        --storage-pools)
            STORAGE_POOLS="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --disk DEVICE           Target disk (e.g., /dev/sda)"
            echo "  --hostname NAME         Hostname for the system"
            echo "  --password PASS         Root password"
            echo "  --version VER           Version string to embed"
            echo "  --storage-pools POOLS   Storage pools (format: /dev/disk1:name1 /dev/disk2:name2)"
            echo "  --auto                  Non-interactive mode"
            echo "  --help                  Show this help"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# -----------------------------------------------------------------------------
# Interactive Mode (if not --auto)
# -----------------------------------------------------------------------------

if [ $AUTO_MODE -eq 0 ]; then
    # Try TUI first
    if [ -x "/installer/tui.sh" ] && command -v dialog >/dev/null 2>&1; then
        exec /installer/tui.sh
    fi
    
    # Fall back to simple prompts
    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║              Quantix-OS Installer v${VERSION}                       ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Detect available disks
    echo "Available disks:"
    echo "----------------"
    lsblk -d -o NAME,SIZE,MODEL,TYPE | grep -E "disk|NAME"
    echo ""
    
    echo -n "Enter target disk (e.g., /dev/sda): "
    read TARGET_DISK
    
    if [ ! -b "$TARGET_DISK" ]; then
        log_error "Invalid disk: $TARGET_DISK"
        exit 1
    fi
    
    echo -n "Enter hostname [quantix]: "
    read input_hostname
    [ -n "$input_hostname" ] && HOSTNAME="$input_hostname"
    
    echo -n "Enter root password: "
    stty -echo
    read ROOT_PASSWORD
    stty echo
    echo ""
    
    echo ""
    echo -e "${RED}WARNING: ALL DATA ON ${TARGET_DISK} WILL BE DESTROYED!${NC}"
    echo -n "Type 'yes' to continue: "
    read confirm
    if [ "$confirm" != "yes" ]; then
        log_info "Installation cancelled."
        exit 0
    fi
fi

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------

if [ -z "$TARGET_DISK" ]; then
    log_error "TARGET_DISK is required"
    exit 1
fi

if [ ! -b "$TARGET_DISK" ]; then
    log_error "Target disk not found: $TARGET_DISK"
    exit 1
fi

# -----------------------------------------------------------------------------
# Find System Image
# -----------------------------------------------------------------------------

find_squashfs() {
    log_info "Locating system image..."
    
    for path in \
        "/mnt/cdrom/quantix/system.squashfs" \
        "/cdrom/quantix/system.squashfs" \
        "/media/cdrom/quantix/system.squashfs" \
        "/run/media/cdrom/quantix/system.squashfs" \
        "${SCRIPT_DIR}/../quantix/system.squashfs"; do
        if [ -f "$path" ]; then
            SQUASHFS_PATH="$path"
            log_info "Found system image: ${SQUASHFS_PATH}"
            return 0
        fi
    done
    
    # Search for any squashfs
    SQUASHFS_PATH=$(find /mnt /media /run/media /cdrom -name "system*.squashfs" 2>/dev/null | head -1)
    
    if [ -z "$SQUASHFS_PATH" ] || [ ! -f "$SQUASHFS_PATH" ]; then
        log_error "System image not found!"
        exit 1
    fi
    
    log_info "Found system image: ${SQUASHFS_PATH}"
}

find_squashfs

# Also try to get version from ISO
VERSION_FILE="${SQUASHFS_PATH%/*}/VERSION"
if [ -f "$VERSION_FILE" ]; then
    VERSION=$(cat "$VERSION_FILE" | tr -d '\n\r ')
    log_info "Installing Quantix-OS version: ${VERSION}"
fi

# -----------------------------------------------------------------------------
# Installation
# -----------------------------------------------------------------------------

    echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Installing Quantix-OS v${VERSION}                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
log_info "Target Disk:  $TARGET_DISK"
log_info "Hostname:     $HOSTNAME"
log_info "Version:      $VERSION"
    echo ""

# Calculate total steps (base 8 + storage pools if configured)
TOTAL_STEPS=8
if [ -n "$STORAGE_POOLS" ]; then
    TOTAL_STEPS=9
fi

# =============================================================================
# Step 1: Create Partitions
# =============================================================================
log_step "Step 1/${TOTAL_STEPS}: Creating partition table..."
    
    # Unmount any existing partitions
    umount ${TARGET_DISK}* 2>/dev/null || true

    # Stop any LVM/RAID using this disk
    vgchange -an 2>/dev/null || true
    
    # Wipe ALL filesystem signatures from the disk
    # This prevents "Invalid superblock" errors from old filesystems
    log_info "Wiping existing filesystem signatures..."
    wipefs -a "${TARGET_DISK}" 2>/dev/null || true
    
    # Also wipe the first and last 1MB to clear GPT/MBR
    dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=1 2>/dev/null || true
    dd if=/dev/zero of="${TARGET_DISK}" bs=1M count=1 seek=$(($(blockdev --getsz "${TARGET_DISK}") / 2048 - 1)) 2>/dev/null || true
    
    # Inform kernel of partition changes
    partprobe "${TARGET_DISK}" 2>/dev/null || true
    udevadm settle 2>/dev/null || true
    sleep 1
    
    # Create GPT partition table
    parted -s "${TARGET_DISK}" mklabel gpt
    
    # Calculate partition positions
    # Layout: EFI(256M) + SysA(1.5G) + SysB(1.5G) + Cfg(256M) + Data(rest)
EFI_END="256M"
SYS_A_END="1756M"   # 256M + 1500M
SYS_B_END="3256M"   # 1756M + 1500M
CFG_END="3512M"     # 3256M + 256M
    
    # Create partitions
parted -s "${TARGET_DISK}" mkpart "EFI" fat32 1MiB ${EFI_END}
    parted -s "${TARGET_DISK}" set 1 esp on
    
parted -s "${TARGET_DISK}" mkpart "QUANTIX-A" ext4 ${EFI_END} ${SYS_A_END}
parted -s "${TARGET_DISK}" mkpart "QUANTIX-B" ext4 ${SYS_A_END} ${SYS_B_END}
parted -s "${TARGET_DISK}" mkpart "QUANTIX-CFG" ext4 ${SYS_B_END} ${CFG_END}
parted -s "${TARGET_DISK}" mkpart "QUANTIX-DATA" xfs ${CFG_END} 100%
    
    # Wait for kernel to recognize partitions
partprobe "${TARGET_DISK}" 2>/dev/null || true
    udevadm settle 2>/dev/null || true
    sleep 2
    
# Determine partition naming
case "$TARGET_DISK" in
    /dev/nvme*|/dev/mmcblk*)
        P="p"
        ;;
    *)
        P=""
        ;;
esac

PART_EFI="${TARGET_DISK}${P}1"
PART_SYS_A="${TARGET_DISK}${P}2"
PART_SYS_B="${TARGET_DISK}${P}3"
PART_CFG="${TARGET_DISK}${P}4"
PART_DATA="${TARGET_DISK}${P}5"

log_info "Partitions created"

# Wait for all partition devices to appear
log_info "Waiting for partition devices..."
for i in 1 2 3 4 5; do
    if [ -b "${TARGET_DISK}${P}5" ]; then
        break
    fi
    sleep 1
done

if [ ! -b "${PART_DATA}" ]; then
    log_error "Data partition not found: ${PART_DATA}"
    log_error "Available partitions:"
    ls -la "${TARGET_DISK}"* 2>/dev/null || true
    exit 1
fi

# =============================================================================
# Step 2: Format Partitions
# =============================================================================
log_step "Step 2/${TOTAL_STEPS}: Formatting partitions..."

# Wipe partition signatures before formatting (prevents stale superblock errors)
for part in "${PART_EFI}" "${PART_SYS_A}" "${PART_SYS_B}" "${PART_CFG}" "${PART_DATA}"; do
    wipefs -a "$part" 2>/dev/null || true
done

log_info "Formatting EFI partition..."
mkfs.vfat -F 32 -n "EFI" "${PART_EFI}"

log_info "Formatting System A partition..."
mkfs.ext4 -L "QUANTIX-A" -F "${PART_SYS_A}"

log_info "Formatting System B partition..."
mkfs.ext4 -L "QUANTIX-B" -F "${PART_SYS_B}"

log_info "Formatting Config partition..."
mkfs.ext4 -L "QUANTIX-CFG" -F "${PART_CFG}"

log_info "Formatting Data partition (XFS)..."
mkfs.xfs -L "QUANTIX-DATA" -f "${PART_DATA}"

# Sync to ensure all writes are flushed
sync
sleep 1
    
log_info "Partitions formatted"

# Verify filesystem labels and types
log_info "Verifying filesystem labels..."
if [ "$(blkid -o value -s LABEL "${PART_DATA}" 2>/dev/null)" != "QUANTIX-DATA" ]; then
    log_error "Data partition label not set correctly"
    blkid "${PART_DATA}" 2>/dev/null || true
    exit 1
fi
if [ "$(blkid -o value -s TYPE "${PART_DATA}" 2>/dev/null)" != "xfs" ]; then
    log_error "Data partition is not XFS"
    blkid "${PART_DATA}" 2>/dev/null || true
    exit 1
fi

# =============================================================================
# Step 3: Mount Partitions
# =============================================================================
log_step "Step 3/${TOTAL_STEPS}: Mounting partitions..."

mkdir -p "${TARGET_MOUNT}"/{efi,system,config,data}
    
mount "${PART_SYS_A}" "${TARGET_MOUNT}/system"
mount "${PART_EFI}" "${TARGET_MOUNT}/efi"
mount "${PART_CFG}" "${TARGET_MOUNT}/config"
mount "${PART_DATA}" "${TARGET_MOUNT}/data"

log_info "Partitions mounted"

# =============================================================================
# Step 4: Install System
# =============================================================================
log_step "Step 4/${TOTAL_STEPS}: Installing system image..."

mkdir -p "${TARGET_MOUNT}/system"/{boot,quantix}
    
# Copy squashfs to system partition
log_info "Copying system image (this may take a few minutes)..."
cp "${SQUASHFS_PATH}" "${TARGET_MOUNT}/system/quantix/system.squashfs"
    
# Write version file
echo "${VERSION}" > "${TARGET_MOUNT}/system/quantix/VERSION"

# Extract boot files from squashfs
    log_info "Extracting boot files..."
    mkdir -p /tmp/sqmount
    mount -t squashfs "${SQUASHFS_PATH}" /tmp/sqmount
    
    if [ -f /tmp/sqmount/boot/vmlinuz-lts ]; then
    cp /tmp/sqmount/boot/vmlinuz-lts "${TARGET_MOUNT}/system/boot/vmlinuz"
    elif [ -f /tmp/sqmount/boot/vmlinuz ]; then
    cp /tmp/sqmount/boot/vmlinuz "${TARGET_MOUNT}/system/boot/vmlinuz"
else
    log_error "Kernel not found in system image!"
    exit 1
    fi
    
    if [ -f /tmp/sqmount/boot/initramfs-lts ]; then
    cp /tmp/sqmount/boot/initramfs-lts "${TARGET_MOUNT}/system/boot/initramfs"
    elif [ -f /tmp/sqmount/boot/initramfs ]; then
    cp /tmp/sqmount/boot/initramfs "${TARGET_MOUNT}/system/boot/initramfs"
else
    log_error "Initramfs not found in system image!"
    exit 1
    fi
    
    umount /tmp/sqmount
    rmdir /tmp/sqmount

log_info "System image installed"

# =============================================================================
# Step 5: Configure System
# =============================================================================
log_step "Step 5/${TOTAL_STEPS}: Configuring system..."
    
    # Create config directory structure
mkdir -p "${TARGET_MOUNT}/config"/{certificates,network,limiquantix}
chmod 700 "${TARGET_MOUNT}/config/certificates"

# Write hostname
echo "${HOSTNAME}" > "${TARGET_MOUNT}/config/hostname"

# Create node configuration
cat > "${TARGET_MOUNT}/config/limiquantix/node.yaml" << EOF
# Quantix-OS Node Configuration
# Generated by installer on $(date -Iseconds)

node:
  hostname: ${HOSTNAME}
  version: ${VERSION}

server:
  http_port: 8080
  https_port: 8443
  
hypervisor:
  backend: libvirt
  libvirt_uri: "qemu:///system"

storage:
  default_pool: /data

logging:
  level: info
EOF
    
    # Create data directory structure
mkdir -p "${TARGET_MOUNT}/data"/{vms,images,isos,backups,storage}

log_info "System configured"

# =============================================================================
# Step 6: Initialize Storage Pools (Optional)
# =============================================================================
if [ -n "$STORAGE_POOLS" ]; then
    log_step "Step 6/${TOTAL_STEPS}: Initializing storage pools..."
    
    # Create storage pools configuration
    POOLS_CONFIG="${TARGET_MOUNT}/config/limiquantix/storage-pools.yaml"
    mkdir -p "$(dirname "$POOLS_CONFIG")"
    
    cat > "$POOLS_CONFIG" << EOF
# Quantix-OS Storage Pools Configuration
# Generated by installer on $(date -Iseconds)
# These pools will be auto-created on first boot

storage_pools:
EOF
    
    for pool_spec in $STORAGE_POOLS; do
        POOL_DISK=$(echo "$pool_spec" | cut -d: -f1)
        POOL_NAME=$(echo "$pool_spec" | cut -d: -f2)
        
        if [ ! -b "$POOL_DISK" ]; then
            log_warn "Storage pool disk not found: $POOL_DISK - skipping"
            continue
        fi
        
        log_info "Initializing storage pool: $POOL_NAME on $POOL_DISK"
        
        # Determine partition suffix for this disk
        case "$POOL_DISK" in
            /dev/nvme*|/dev/mmcblk*)
                POOL_P="p"
                ;;
            *)
                POOL_P=""
                ;;
        esac
        
        # Wipe existing partitions
        dd if=/dev/zero of="$POOL_DISK" bs=512 count=34 2>/dev/null || true
        
        # Create single partition spanning entire disk
        parted -s "$POOL_DISK" mklabel gpt
        parted -s "$POOL_DISK" mkpart "${POOL_NAME}" xfs 1MiB 100%
        
        # Wait for partition to appear
        partprobe "$POOL_DISK" 2>/dev/null || true
        sleep 2
        
        POOL_PART="${POOL_DISK}${POOL_P}1"
        
        # Format with XFS (optimal for VM storage)
        log_info "Formatting $POOL_PART with XFS..."
        mkfs.xfs -L "$POOL_NAME" -f "$POOL_PART"
        
        # Get UUID for the partition
        POOL_UUID=$(blkid -s UUID -o value "$POOL_PART")
        
        # Add to storage pools config
        cat >> "$POOLS_CONFIG" << EOF
  - name: ${POOL_NAME}
    disk: ${POOL_DISK}
    partition: ${POOL_PART}
    uuid: ${POOL_UUID}
    filesystem: xfs
    mount_point: /data/pools/${POOL_NAME}
EOF
        
        # Create mount point in data partition
        mkdir -p "${TARGET_MOUNT}/data/pools/${POOL_NAME}"
        
        # Add to fstab configuration
        echo "UUID=${POOL_UUID} /data/pools/${POOL_NAME} xfs defaults,nofail 0 2" >> "${TARGET_MOUNT}/config/fstab.pools"
        
        log_info "Storage pool $POOL_NAME initialized (UUID: $POOL_UUID)"
    done
    
    log_info "Storage pools configured"
    
    CURRENT_STEP=7
else
    CURRENT_STEP=6
fi

# =============================================================================
# Step: Set Root Password
# =============================================================================
log_step "Step ${CURRENT_STEP}/${TOTAL_STEPS}: Setting root password..."

if [ -n "$ROOT_PASSWORD" ]; then
    # Mount squashfs to access shadow file
    mkdir -p "${TARGET_MOUNT}/root"
    mount -t squashfs "${TARGET_MOUNT}/system/quantix/system.squashfs" "${TARGET_MOUNT}/root"
    
    # Copy shadow file to config
    mkdir -p "${TARGET_MOUNT}/config/auth"
    
    # Generate password hash
    PASS_HASH=$(echo "$ROOT_PASSWORD" | openssl passwd -6 -stdin)
    
    # Create shadow override
    echo "root:${PASS_HASH}:19000:0:99999:7:::" > "${TARGET_MOUNT}/config/auth/shadow.override"
    chmod 600 "${TARGET_MOUNT}/config/auth/shadow.override"
    
    umount "${TARGET_MOUNT}/root"
    
    log_info "Root password configured"
else
    log_warn "No root password set"
fi

# Increment step counter
CURRENT_STEP=$((CURRENT_STEP + 1))

# =============================================================================
# Step: Install Bootloader
# =============================================================================
log_step "Step ${CURRENT_STEP}/${TOTAL_STEPS}: Installing bootloader..."
    
# Get partition UUIDs
UUID_SYS_A=$(blkid -s UUID -o value "${PART_SYS_A}")
UUID_CFG=$(blkid -s UUID -o value "${PART_CFG}")
UUID_DATA=$(blkid -s UUID -o value "${PART_DATA}")
    
    # Mount system for chroot
mkdir -p "${TARGET_MOUNT}/root"
mount -t squashfs "${TARGET_MOUNT}/system/quantix/system.squashfs" "${TARGET_MOUNT}/root"
    
    # Bind mount EFI
mkdir -p "${TARGET_MOUNT}/root/boot/efi"
mount --bind "${TARGET_MOUNT}/efi" "${TARGET_MOUNT}/root/boot/efi"
    
    # Bind mount required filesystems
mount --bind /dev "${TARGET_MOUNT}/root/dev"
mount --bind /proc "${TARGET_MOUNT}/root/proc"
mount --bind /sys "${TARGET_MOUNT}/root/sys"
    
    # Install GRUB for UEFI
    log_info "Installing GRUB for UEFI..."
chroot "${TARGET_MOUNT}/root" grub-install \
        --target=x86_64-efi \
        --efi-directory=/boot/efi \
        --bootloader-id=quantix \
    --removable \
        --recheck \
    "${TARGET_DISK}" 2>/dev/null || log_warn "UEFI GRUB failed (may be BIOS system)"
    
    # Create GRUB configuration
    log_info "Creating GRUB configuration..."
    
cat > "${TARGET_MOUNT}/root/boot/grub/grub.cfg" << EOF
# Quantix-OS GRUB Configuration
# Version: ${VERSION}

set timeout=5
set default=0

insmod all_video
insmod gfxterm
set gfxmode=auto
terminal_output gfxterm

set menu_color_normal=white/black
set menu_color_highlight=black/light-cyan

menuentry "Quantix-OS v${VERSION}" --id quantix {
    echo "Loading Quantix-OS v${VERSION}..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS v${VERSION} (System B)" --id quantix-b {
    echo "Loading Quantix-OS from System B..."
    search --label --set=root QUANTIX-B
    linux /boot/vmlinuz root=LABEL=QUANTIX-B ro quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS v${VERSION} (Safe Mode)" --id safe {
    echo "Loading Quantix-OS in safe mode..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro single nomodeset
    initrd /boot/initramfs
}

menuentry "Quantix-OS v${VERSION} (Recovery Shell)" --id recovery {
    echo "Loading recovery shell..."
    search --label --set=root QUANTIX-A
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro init=/bin/sh
    initrd /boot/initramfs
}
EOF
    
    # Copy GRUB config to EFI partition
mkdir -p "${TARGET_MOUNT}/efi/EFI/quantix"
cp "${TARGET_MOUNT}/root/boot/grub/grub.cfg" "${TARGET_MOUNT}/efi/EFI/quantix/"
    
    # Cleanup mounts
umount "${TARGET_MOUNT}/root/sys" 2>/dev/null || true
umount "${TARGET_MOUNT}/root/proc" 2>/dev/null || true
umount "${TARGET_MOUNT}/root/dev" 2>/dev/null || true
umount "${TARGET_MOUNT}/root/boot/efi" 2>/dev/null || true
umount "${TARGET_MOUNT}/root" 2>/dev/null || true
    
    log_info "Bootloader installed"

# Increment step counter
CURRENT_STEP=$((CURRENT_STEP + 1))

# =============================================================================
# Step: Finalize
# =============================================================================
log_step "Step ${CURRENT_STEP}/${TOTAL_STEPS}: Finalizing installation..."

# Sync filesystems
sync
    
    # Unmount all partitions
umount "${TARGET_MOUNT}/data" 2>/dev/null || true
umount "${TARGET_MOUNT}/config" 2>/dev/null || true
umount "${TARGET_MOUNT}/efi" 2>/dev/null || true
umount "${TARGET_MOUNT}/system" 2>/dev/null || true
    
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              Installation Complete!                           ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
echo -e "${GREEN}║  Quantix-OS v${VERSION} has been installed successfully.          ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
echo -e "${GREEN}║  Next Steps:                                                  ║${NC}"
    echo -e "${GREEN}║  1. Remove the installation media                             ║${NC}"
    echo -e "${GREEN}║  2. Reboot the system                                         ║${NC}"
echo -e "${GREEN}║  3. Access the console TUI on the local display               ║${NC}"
echo -e "${GREEN}║  4. Access web management at https://<ip>:8443/               ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
exit 0
