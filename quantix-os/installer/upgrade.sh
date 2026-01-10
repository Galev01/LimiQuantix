#!/bin/bash
# =============================================================================
# Quantix-OS Upgrade Script
# =============================================================================
# Upgrades an existing Quantix-OS installation with a new squashfs image.
# This script PRESERVES all user data, configuration, and VMs.
#
# Usage: ./upgrade.sh
#
# Run this from the Quantix-OS live ISO after booting with the new version.
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQUASHFS_PATH=""
SYSTEM_PARTITION=""

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-OS Upgrade v1.0.0                        ║"
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
# Step 1: Find the new squashfs (from ISO)
# -----------------------------------------------------------------------------

find_new_squashfs() {
    log_info "Locating new system image from ISO..."
    
    # Try common ISO mount locations
    for path in \
        "/run/media/cdrom/quantix/system.squashfs" \
        "/mnt/cdrom/quantix/system.squashfs" \
        "/media/cdrom/quantix/system.squashfs" \
        "/cdrom/quantix/system.squashfs" \
        "${SCRIPT_DIR}/../quantix/system.squashfs" \
        "/quantix/system.squashfs"; do
        if [ -f "$path" ]; then
            SQUASHFS_PATH="$path"
            log_info "Found new system image: ${SQUASHFS_PATH}"
            return 0
        fi
    done
    
    # Search for any squashfs on mounted media
    SQUASHFS_PATH=$(find /mnt /media /run/media /cdrom -name "system*.squashfs" 2>/dev/null | head -1)
    
    if [ -z "$SQUASHFS_PATH" ]; then
        log_error "New system image not found!"
        log_error "Make sure you're booting from the Quantix-OS ISO."
        exit 1
    fi
    
    log_info "Found new system image: ${SQUASHFS_PATH}"
}

# -----------------------------------------------------------------------------
# Step 2: Find the existing system partition
# -----------------------------------------------------------------------------

find_existing_system() {
    log_info "Looking for existing Quantix-OS installation..."
    
    # Look for QUANTIX-A partition
    SYSTEM_PARTITION=$(lsblk -o NAME,LABEL -rn | grep "QUANTIX-A" | awk '{print "/dev/"$1}')
    
    if [ -z "$SYSTEM_PARTITION" ]; then
        log_error "No existing Quantix-OS installation found!"
        log_error "Use install.sh for fresh installation."
        exit 1
    fi
    
    log_info "Found existing installation: ${SYSTEM_PARTITION}"
    
    # Show current installation info
    echo ""
    echo "Existing installation:"
    echo "  Partition: ${SYSTEM_PARTITION}"
    echo "  Size:      $(lsblk -o SIZE -n ${SYSTEM_PARTITION})"
    echo ""
}

# -----------------------------------------------------------------------------
# Step 3: Show version info
# -----------------------------------------------------------------------------

show_version_info() {
    log_info "Checking versions..."
    
    # Mount the new squashfs to get version
    mkdir -p /tmp/new_version
    mount -t squashfs "${SQUASHFS_PATH}" /tmp/new_version 2>/dev/null || true
    
    if [ -f /tmp/new_version/etc/quantix-release ]; then
        echo "New version:"
        cat /tmp/new_version/etc/quantix-release
    fi
    
    if [ -f /tmp/new_version/usr/share/quantix-host-ui/BUILD_INFO.json ]; then
        echo "Build info:"
        cat /tmp/new_version/usr/share/quantix-host-ui/BUILD_INFO.json | head -10
    fi
    
    umount /tmp/new_version 2>/dev/null || true
    rmdir /tmp/new_version 2>/dev/null || true
    
    echo ""
}

# -----------------------------------------------------------------------------
# Step 4: Perform upgrade
# -----------------------------------------------------------------------------

perform_upgrade() {
    log_info "Starting upgrade..."
    
    # Mount the system partition
    mkdir -p /mnt/upgrade
    mount "${SYSTEM_PARTITION}" /mnt/upgrade
    
    # Verify it's a valid Quantix installation
    if [ ! -d /mnt/upgrade/quantix ]; then
        log_error "Invalid Quantix-OS installation - /quantix directory missing"
        umount /mnt/upgrade
        exit 1
    fi
    
    # Backup old squashfs (rename it)
    if [ -f /mnt/upgrade/quantix/system.squashfs ]; then
        log_info "Backing up old system image..."
        mv /mnt/upgrade/quantix/system.squashfs /mnt/upgrade/quantix/system.squashfs.old
    fi
    
    # Copy new squashfs
    log_info "Copying new system image (this may take a few minutes)..."
    cp "${SQUASHFS_PATH}" /mnt/upgrade/quantix/system.squashfs
    
    # Extract new boot files from squashfs
    log_info "Updating boot files..."
    mkdir -p /tmp/sqmount
    mount -t squashfs "${SQUASHFS_PATH}" /tmp/sqmount
    
    # Update kernel
    if [ -f /tmp/sqmount/boot/vmlinuz-lts ]; then
        cp /tmp/sqmount/boot/vmlinuz-lts /mnt/upgrade/boot/vmlinuz
        log_info "Kernel updated"
    fi
    
    # Update initramfs
    if [ -f /tmp/sqmount/boot/initramfs-lts ]; then
        cp /tmp/sqmount/boot/initramfs-lts /mnt/upgrade/boot/initramfs
        log_info "Initramfs updated"
    fi
    
    umount /tmp/sqmount
    rmdir /tmp/sqmount
    
    # Remove old backup if upgrade successful
    if [ -f /mnt/upgrade/quantix/system.squashfs ]; then
        log_info "Cleaning up old backup..."
        rm -f /mnt/upgrade/quantix/system.squashfs.old
    fi
    
    # Sync and unmount
    sync
    umount /mnt/upgrade
    
    log_info "Upgrade complete!"
}

# -----------------------------------------------------------------------------
# Step 5: Confirm and finish
# -----------------------------------------------------------------------------

finish_upgrade() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                 Upgrade Complete!                             ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  The system has been upgraded successfully.                   ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Your configuration, certificates, and VMs are preserved.    ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║  Please reboot to use the new version.                        ║${NC}"
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
    
    find_new_squashfs
    find_existing_system
    show_version_info
    
    if ! confirm "Do you want to upgrade Quantix-OS? (y/N): "; then
        log_info "Upgrade cancelled."
        exit 0
    fi
    
    perform_upgrade
    finish_upgrade
}

main "$@"
