#!/bin/bash
# =============================================================================
# Quantix-vDC USB Deployment Script
# =============================================================================
# Writes the Quantix-vDC installation ISO to a USB drive for bare-metal
# deployment.
#
# Usage: sudo ./deploy-usb.sh <device> [iso-path]
# Example: sudo ./deploy-usb.sh /dev/sdb
#          sudo ./deploy-usb.sh /dev/sdb ./output/quantix-vdc-0.0.2.iso
#
# WARNING: This will DESTROY all data on the target device!
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
VERSION="${VERSION:-1.0.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${WORK_DIR}/output"
ISO_NAME="quantix-vdc-${VERSION}.iso"
ISO_PATH="${OUTPUT_DIR}/${ISO_NAME}"

# Will be potentially overwritten by direct ISO path argument
CUSTOM_ISO_PATH=""

# -----------------------------------------------------------------------------
# Functions
# -----------------------------------------------------------------------------

print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           Quantix-vDC USB Deployment Tool                     ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_error() {
    echo -e "${RED}❌ ERROR: $1${NC}" >&2
}

print_warning() {
    echo -e "${YELLOW}⚠️  WARNING: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

check_dependencies() {
    local missing=()
    
    for cmd in dd lsblk blockdev sync; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        print_error "Missing required commands: ${missing[*]}"
        exit 1
    fi
}

check_iso_exists() {
    if [ ! -f "$ISO_PATH" ]; then
        print_error "ISO not found: ${ISO_PATH}"
        echo ""
        echo "Build the ISO first with:"
        echo "  cd ${WORK_DIR}"
        echo "  make iso"
        exit 1
    fi
    
    ISO_SIZE=$(stat -c%s "$ISO_PATH")
    ISO_SIZE_MB=$((ISO_SIZE / 1024 / 1024))
    print_info "Found ISO: ${ISO_PATH} (${ISO_SIZE_MB} MB)"
}

validate_device() {
    local device="$1"
    
    # Check if device exists
    if [ ! -b "$device" ]; then
        print_error "Device not found: ${device}"
        echo ""
        echo "Available block devices:"
        lsblk -d -o NAME,SIZE,TYPE,MODEL | grep -E "disk|NAME"
        exit 1
    fi
    
    # Check it's not a partition
    if [[ "$device" =~ [0-9]$ ]]; then
        print_error "Please specify the whole device, not a partition"
        echo "  Use: /dev/sdb (not /dev/sdb1)"
        exit 1
    fi
    
    # Check it's a removable device (safety check)
    local removable=$(cat "/sys/block/$(basename "$device")/removable" 2>/dev/null || echo "0")
    local device_type=$(lsblk -d -n -o TYPE "$device" 2>/dev/null || echo "unknown")
    
    # Get device info
    local device_model=$(lsblk -d -n -o MODEL "$device" 2>/dev/null | xargs)
    local device_size=$(lsblk -d -n -o SIZE "$device" 2>/dev/null)
    local device_size_bytes=$(blockdev --getsize64 "$device" 2>/dev/null || echo "0")
    
    echo ""
    echo "Target Device Information:"
    echo "  Device:    ${device}"
    echo "  Model:     ${device_model:-Unknown}"
    echo "  Size:      ${device_size}"
    echo "  Type:      ${device_type}"
    echo "  Removable: $([ "$removable" = "1" ] && echo "Yes" || echo "No")"
    echo ""
    
    # Warn if not removable
    if [ "$removable" != "1" ]; then
        print_warning "This device is NOT marked as removable!"
        print_warning "Make absolutely sure this is the correct device!"
    fi
    
    # Check device is large enough
    if [ "$device_size_bytes" -lt "$ISO_SIZE" ]; then
        print_error "Device is too small (${device_size}) for ISO (${ISO_SIZE_MB} MB)"
        exit 1
    fi
    
    # Show partitions that will be destroyed
    echo "Current partitions on ${device}:"
    lsblk -o NAME,SIZE,FSTYPE,LABEL,MOUNTPOINT "$device" 2>/dev/null || true
    echo ""
}

confirm_write() {
    local device="$1"
    
    print_warning "ALL DATA ON ${device} WILL BE PERMANENTLY DESTROYED!"
    echo ""
    echo -n "Type 'YES' (uppercase) to confirm: "
    read -r confirmation
    
    if [ "$confirmation" != "YES" ]; then
        print_info "Operation cancelled"
        exit 0
    fi
}

unmount_device() {
    local device="$1"
    
    print_info "Unmounting any mounted partitions..."
    
    # Find and unmount all partitions
    for partition in "${device}"*; do
        if mountpoint -q "$partition" 2>/dev/null || mount | grep -q "^$partition "; then
            echo "  Unmounting ${partition}..."
            umount "$partition" 2>/dev/null || umount -f "$partition" 2>/dev/null || true
        fi
    done
    
    # Wait for device to settle
    sync
    sleep 1
}

write_iso() {
    local device="$1"
    
    echo ""
    print_info "Writing ISO to ${device}..."
    echo "  This may take several minutes depending on USB speed."
    echo ""
    
    # Write with progress
    dd if="$ISO_PATH" of="$device" bs=4M status=progress conv=fsync oflag=direct 2>&1
    
    # Final sync
    echo ""
    print_info "Syncing data to device..."
    sync
    
    # Flush device buffers
    blockdev --flushbufs "$device" 2>/dev/null || true
    
    print_success "ISO written successfully!"
}

verify_write() {
    local device="$1"
    
    echo ""
    print_info "Verifying written data..."
    
    # Calculate checksum of ISO
    local iso_checksum=$(head -c "$ISO_SIZE" "$ISO_PATH" | md5sum | awk '{print $1}')
    
    # Calculate checksum of device (same size as ISO)
    local device_checksum=$(head -c "$ISO_SIZE" "$device" | md5sum | awk '{print $1}')
    
    if [ "$iso_checksum" = "$device_checksum" ]; then
        print_success "Verification passed! Checksums match."
    else
        print_error "Verification FAILED! Checksums do not match."
        echo "  ISO checksum:    ${iso_checksum}"
        echo "  Device checksum: ${device_checksum}"
        exit 1
    fi
}

show_usage() {
    echo "Usage: sudo $0 <device> [options]"
    echo ""
    echo "Arguments:"
    echo "  <device>    Target USB device (e.g., /dev/sdb)"
    echo ""
    echo "Options:"
    echo "  -y, --yes       Skip confirmation prompt"
    echo "  -n, --no-verify Skip verification after write"
    echo "  -v, --version   Specify ISO version (default: 1.0.0)"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  sudo $0 /dev/sdb"
    echo "  sudo $0 /dev/sdb --yes --no-verify"
    echo "  sudo $0 /dev/sdb -v 2.0.0"
    echo ""
    echo "Available block devices:"
    lsblk -d -o NAME,SIZE,TYPE,MODEL | grep -E "disk|NAME"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

main() {
    local device=""
    local skip_confirm=false
    local skip_verify=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -h|--help)
                show_usage
                exit 0
                ;;
            -y|--yes)
                skip_confirm=true
                shift
                ;;
            -n|--no-verify)
                skip_verify=true
                shift
                ;;
            -v|--version)
                VERSION="$2"
                ISO_NAME="quantix-vdc-${VERSION}.iso"
                ISO_PATH="${OUTPUT_DIR}/${ISO_NAME}"
                shift 2
                ;;
            -*)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
            *)
                if [ -z "$device" ]; then
                    device="$1"
                else
                    print_error "Unexpected argument: $1"
                    show_usage
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    # Validate arguments
    if [ -z "$device" ]; then
        print_error "No device specified"
        echo ""
        show_usage
        exit 1
    fi
    
    print_banner
    
    # Run checks
    check_root
    check_dependencies
    check_iso_exists
    validate_device "$device"
    
    # Confirm
    if [ "$skip_confirm" = false ]; then
        confirm_write "$device"
    fi
    
    # Unmount
    unmount_device "$device"
    
    # Write
    write_iso "$device"
    
    # Verify
    if [ "$skip_verify" = false ]; then
        verify_write "$device"
    fi
    
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                    USB Creation Complete!                     ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    echo "║                                                               ║"
    echo "║  Your Quantix-vDC installation USB is ready!                  ║"
    echo "║                                                               ║"
    echo "║  To install:                                                  ║"
    echo "║    1. Insert USB into target server                           ║"
    echo "║    2. Boot from USB (may need BIOS/UEFI settings)             ║"
    echo "║    3. Follow the installation wizard                          ║"
    echo "║                                                               ║"
    echo "║  After installation, access the dashboard at:                 ║"
    echo "║    https://<server-ip>/                                       ║"
    echo "║                                                               ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
}

main "$@"
