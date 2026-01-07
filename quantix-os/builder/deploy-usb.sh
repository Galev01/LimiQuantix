#!/bin/bash
# =============================================================================
# Quantix-OS USB Deployment Script
# =============================================================================
#
# This script safely deploys Quantix-OS ISO to a USB drive, handling all the
# edge cases that cause issues with manual dd:
#
#   1. Signature Wiping - Removes partition table signatures that confuse
#      Windows ("The system cannot find the file specified")
#
#   2. Unmounting - Detaches all partitions so the OS doesn't interfere
#      with the write operation
#
#   3. Hardware Sync - Uses conv=fsync + standalone sync to ensure the
#      script doesn't report success until the USB controller has actually
#      finished the physical write (fixes "2.5 GB/s fake speed" issue)
#
# Usage:
#   sudo ./deploy-usb.sh                             # Interactive device selection
#   sudo ./deploy-usb.sh /dev/sdb                    # Use default ISO
#   sudo ./deploy-usb.sh /dev/sdb path/to/image.iso  # Use custom ISO
#   sudo ./deploy-usb.sh --list                      # List USB devices
#   sudo ./deploy-usb.sh --verify /dev/sdb           # Verify after write
#   sudo ./deploy-usb.sh --no-wipe /dev/sdb          # Skip signature wiping
#   sudo ./deploy-usb.sh --force /dev/sdb            # Skip confirmation prompt
#   sudo ./deploy-usb.sh --debug                     # Enable debug output
#   sudo ./deploy-usb.sh --help                      # Show this help
#
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QUANTIX_OS_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${QUANTIX_OS_DIR}/output"
VERSION="${VERSION:-1.0.0}"
DEFAULT_ISO="${OUTPUT_DIR}/quantix-os-${VERSION}.iso"

# Block size for dd (4MB is optimal for most USB controllers)
BLOCK_SIZE="4M"

# Minimum required space (in bytes) - ISO size + 10% buffer
MIN_SPACE_BUFFER=1.1

# =============================================================================
# Helper Functions
# =============================================================================

print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
╔═══════════════════════════════════════════════════════════════════════════╗
║                                                                           ║
║   ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗████████╗██╗██╗  ██╗                ║
║  ██╔═══██╗██║   ██║██╔══██╗████╗  ██║╚══██╔══╝██║╚██╗██╔╝                ║
║  ██║   ██║██║   ██║███████║██╔██╗ ██║   ██║   ██║ ╚███╔╝                 ║
║  ██║▄▄ ██║██║   ██║██╔══██║██║╚██╗██║   ██║   ██║ ██╔██╗                 ║
║  ╚██████╔╝╚██████╔╝██║  ██║██║ ╚████║   ██║   ██║██╔╝ ██╗                ║
║   ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═╝                ║
║                                                                           ║
║                     USB Deployment Tool                                   ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

log_step() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}▶ ${BOLD}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_info() {
    echo -e "${CYAN}  ℹ  $1${NC}"
}

log_success() {
    echo -e "${GREEN}  ✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}  ⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}  ❌ $1${NC}"
}

log_debug() {
    if [ "${DEBUG:-0}" = "1" ]; then
        echo -e "${MAGENTA}  🔍 $1${NC}"
    fi
}

# Format bytes to human-readable
format_bytes() {
    local bytes=$1
    if [ "$bytes" -ge 1073741824 ]; then
        echo "$(echo "scale=2; $bytes / 1073741824" | bc) GB"
    elif [ "$bytes" -ge 1048576 ]; then
        echo "$(echo "scale=2; $bytes / 1048576" | bc) MB"
    elif [ "$bytes" -ge 1024 ]; then
        echo "$(echo "scale=2; $bytes / 1024" | bc) KB"
    else
        echo "$bytes bytes"
    fi
}

# Check if running as root
check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check required tools
check_dependencies() {
    local missing=()
    
    for cmd in dd lsblk blockdev sync; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing[*]}"
        log_info "Install with: apt install coreutils util-linux"
        exit 1
    fi
    
    # Check optional tools (non-fatal)
    if ! command -v wipefs &> /dev/null; then
        log_warning "wipefs not found - signature wiping will be limited"
    fi
    if ! command -v sgdisk &> /dev/null; then
        log_warning "sgdisk not found - GPT wiping will be limited"
    fi
    
    log_success "All required tools available"
}

# Get list of USB devices as array
get_usb_devices() {
    local devices=()
    
    while IFS= read -r line; do
        local dev=$(echo "$line" | awk '{print $1}')
        [ -z "$dev" ] && continue
        
        # Check if it's USB
        local usb_path="/sys/block/${dev}"
        if [ -d "$usb_path" ]; then
            local devpath=$(readlink -f "$usb_path")
            if echo "$devpath" | grep -q "usb"; then
                devices+=("$dev")
            fi
        fi
    done < <(lsblk -dno NAME 2>/dev/null | grep -v "loop\|sr\|rom")
    
    echo "${devices[@]}"
}

# List available USB devices (display mode)
list_usb_devices() {
    log_step "Available USB Storage Devices"
    echo ""
    
    local found=0
    
    while IFS= read -r line; do
        local dev=$(echo "$line" | awk '{print $1}')
        local size=$(echo "$line" | awk '{print $2}')
        local model=$(echo "$line" | cut -d' ' -f3-)
        
        [ -z "$dev" ] && continue
        
        # Check if it's USB
        local usb_path="/sys/block/${dev}"
        if [ -d "$usb_path" ]; then
            local devpath=$(readlink -f "$usb_path")
            if echo "$devpath" | grep -q "usb"; then
                found=1
                echo -e "  ${GREEN}●${NC} ${BOLD}/dev/$dev${NC}"
                echo -e "    Size:  ${CYAN}$size${NC}"
                echo -e "    Model: ${CYAN}$model${NC}"
                
                # Show partitions
                lsblk -no NAME,SIZE,FSTYPE,LABEL "/dev/$dev" 2>/dev/null | tail -n +2 | while read pline; do
                    echo -e "    └─ ${YELLOW}$pline${NC}"
                done
                echo ""
            fi
        fi
    done < <(lsblk -dno NAME,SIZE,MODEL 2>/dev/null | grep -v "loop\|sr\|rom")
    
    if [ $found -eq 0 ]; then
        log_warning "No USB storage devices found"
        echo ""
        echo -e "  ${CYAN}Tip:${NC} Make sure your USB drive is connected and recognized by the system."
        echo -e "       Run ${BOLD}lsblk${NC} to see all block devices."
    fi
}

# Interactive device selector
select_usb_device() {
    log_step "Select Target USB Device"
    echo ""
    
    # Build array of USB devices
    local devices=()
    local device_info=()
    local index=1
    
    while IFS= read -r line; do
        local dev=$(echo "$line" | awk '{print $1}')
        local size=$(echo "$line" | awk '{print $2}')
        local model=$(echo "$line" | cut -d' ' -f3-)
        
        [ -z "$dev" ] && continue
        
        # Check if it's USB
        local usb_path="/sys/block/${dev}"
        if [ -d "$usb_path" ]; then
            local devpath=$(readlink -f "$usb_path")
            if echo "$devpath" | grep -q "usb"; then
                devices+=("/dev/$dev")
                device_info+=("$size - $model")
                
                echo -e "  ${GREEN}[$index]${NC} ${BOLD}/dev/$dev${NC}"
                echo -e "      Size:  ${CYAN}$size${NC}"
                echo -e "      Model: ${CYAN}$model${NC}"
                
                # Show partitions (indented)
                lsblk -no NAME,SIZE,FSTYPE,LABEL "/dev/$dev" 2>/dev/null | tail -n +2 | while read pline; do
                    echo -e "      └─ ${DIM}$pline${NC}"
                done
                echo ""
                
                index=$((index + 1))
            fi
        fi
    done < <(lsblk -dno NAME,SIZE,MODEL 2>/dev/null | grep -v "loop\|sr\|rom")
    
    local num_devices=${#devices[@]}
    
    if [ $num_devices -eq 0 ]; then
        log_error "No USB storage devices found"
        echo ""
        echo -e "  ${CYAN}Tip:${NC} Make sure your USB drive is connected and recognized."
        echo -e "       Run ${BOLD}lsblk${NC} to see all block devices."
        exit 1
    fi
    
    # If only one device, auto-select with confirmation
    if [ $num_devices -eq 1 ]; then
        echo -e "  ${CYAN}Only one USB device found.${NC}"
        echo ""
        read -p "  Use ${devices[0]}? (y/n): " confirm
        if [[ "$confirm" =~ ^[Yy] ]]; then
            SELECTED_DEVICE="${devices[0]}"
            return 0
        else
            log_info "Aborted by user"
            exit 0
        fi
    fi
    
    # Multiple devices - let user choose
    echo -e "  ${CYAN}Enter device number [1-$num_devices] or 'q' to quit:${NC}"
    echo ""
    
    while true; do
        read -p "  Selection: " choice
        
        if [ "$choice" = "q" ] || [ "$choice" = "Q" ]; then
            log_info "Aborted by user"
            exit 0
        fi
        
        # Validate input
        if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le $num_devices ]; then
            SELECTED_DEVICE="${devices[$((choice - 1))]}"
            log_success "Selected: $SELECTED_DEVICE"
            return 0
        else
            echo -e "  ${RED}Invalid selection. Enter 1-$num_devices or 'q' to quit.${NC}"
        fi
    done
}

# Validate target device
validate_device() {
    local device="$1"
    
    # Check device exists
    if [ ! -b "$device" ]; then
        log_error "Device $device does not exist or is not a block device"
        exit 1
    fi
    
    # Ensure it's a whole disk, not a partition
    if [[ "$device" =~ [0-9]$ ]]; then
        log_error "Please specify the whole disk (e.g., /dev/sdb), not a partition (e.g., /dev/sdb1)"
        exit 1
    fi
    
    # Check it's not a system disk (has mounted root, boot, or home)
    local mounts=$(lsblk -no MOUNTPOINT "$device" 2>/dev/null | grep -E "^/$|^/boot|^/home" || true)
    if [ -n "$mounts" ]; then
        log_error "Device $device appears to be a system disk!"
        log_error "Mounted system partitions detected: $mounts"
        exit 1
    fi
    
    # Check if it's USB (optional safety check)
    local devname="${device##*/}"
    local usb_path="/sys/block/$devname"
    if [ -d "$usb_path" ]; then
        local devpath=$(readlink -f "$usb_path")
        if ! echo "$devpath" | grep -q "usb"; then
            log_warning "Device $device does not appear to be a USB device"
            echo ""
            read -p "  Are you sure you want to continue? (yes/no): " confirm
            if [ "$confirm" != "yes" ]; then
                log_info "Aborted by user"
                exit 0
            fi
        fi
    fi
    
    log_success "Device validated: $device"
}

# Get device info
get_device_info() {
    local device="$1"
    
    local size_bytes=$(blockdev --getsize64 "$device" 2>/dev/null || echo "0")
    local size_human=$(format_bytes "$size_bytes")
    local model=$(lsblk -dno MODEL "$device" 2>/dev/null | xargs || echo "Unknown")
    local serial=$(lsblk -dno SERIAL "$device" 2>/dev/null | xargs || echo "Unknown")
    
    echo ""
    echo -e "  ${CYAN}Device:${NC}  $device"
    echo -e "  ${CYAN}Size:${NC}    $size_human ($size_bytes bytes)"
    echo -e "  ${CYAN}Model:${NC}   $model"
    echo -e "  ${CYAN}Serial:${NC}  $serial"
    echo ""
    
    # Return size for later use
    echo "$size_bytes"
}

# Unmount all partitions on device
unmount_device() {
    local device="$1"
    
    log_step "Step 1: Unmounting all partitions"
    
    local partitions=$(lsblk -nlo NAME "$device" 2>/dev/null | tail -n +2)
    local unmounted=0
    
    for part in $partitions; do
        local part_dev="/dev/$part"
        if mountpoint -q "$part_dev" 2>/dev/null || mount | grep -q "^$part_dev "; then
            log_info "Unmounting $part_dev..."
            umount -f "$part_dev" 2>/dev/null || true
            unmounted=$((unmounted + 1))
        fi
    done
    
    # Also try to unmount the main device (in case it's mounted directly)
    if mount | grep -q "^$device "; then
        log_info "Unmounting $device..."
        umount -f "$device" 2>/dev/null || true
        unmounted=$((unmounted + 1))
    fi
    
    # Use udisksctl if available (better for desktop environments)
    if command -v udisksctl &> /dev/null; then
        for part in $partitions; do
            udisksctl unmount -b "/dev/$part" 2>/dev/null || true
        done
        # Don't power off - we need the device!
    fi
    
    if [ $unmounted -gt 0 ]; then
        log_success "Unmounted $unmounted partition(s)"
    else
        log_success "No mounted partitions found"
    fi
    
    # Wait for device to settle
    sleep 1
}

# Wipe signatures (the key to Windows compatibility)
wipe_signatures() {
    local device="$1"
    
    log_step "Step 2: Wiping partition signatures"
    log_info "This removes metadata that confuses Windows..."
    
    # First, use wipefs to remove filesystem signatures
    if command -v wipefs &> /dev/null; then
        log_info "Running wipefs -a $device..."
        if ! wipefs -a "$device" 2>/dev/null; then
            log_debug "wipefs returned non-zero (may be normal for clean device)"
        fi
    else
        log_info "wipefs not available, skipping..."
    fi
    
    # Then use sgdisk to zap GPT and MBR structures
    if command -v sgdisk &> /dev/null; then
        log_info "Running sgdisk --zap-all $device..."
        if ! sgdisk --zap-all "$device" 2>/dev/null; then
            log_debug "sgdisk returned non-zero (may be normal for clean device)"
        fi
    else
        log_info "sgdisk not available, skipping..."
    fi
    
    # Zero out first and last 1MB (catches any remaining signatures)
    log_info "Zeroing first 1MB (MBR/GPT area)..."
    dd if=/dev/zero of="$device" bs=1M count=1 conv=notrunc status=none 2>/dev/null || true
    
    log_info "Zeroing last 1MB (backup GPT area)..."
    local size_bytes=$(blockdev --getsize64 "$device" 2>/dev/null || echo "0")
    if [ "$size_bytes" -gt 1048576 ]; then
        local last_mb_offset=$(( (size_bytes - 1048576) / 1048576 ))
        dd if=/dev/zero of="$device" bs=1M count=1 seek=$last_mb_offset conv=notrunc status=none 2>/dev/null || true
    fi
    
    # Force kernel to re-read partition table
    log_info "Notifying kernel of changes..."
    partprobe "$device" 2>/dev/null || true
    blockdev --rereadpt "$device" 2>/dev/null || true
    
    # Wait for udev to settle
    if command -v udevadm &> /dev/null; then
        udevadm settle 2>/dev/null || sleep 2
    else
        sleep 2
    fi
    
    log_success "Signatures wiped - device is now clean"
}

# Write ISO to device
write_iso() {
    local iso="$1"
    local device="$2"
    
    log_step "Step 3: Writing ISO to USB"
    
    local iso_size=$(stat -c%s "$iso")
    local iso_size_human=$(format_bytes "$iso_size")
    
    log_info "ISO: $(basename "$iso")"
    log_info "Size: $iso_size_human"
    log_info "Target: $device"
    echo ""
    
    log_info "Writing with hardware sync (this ensures real completion)..."
    echo ""
    
    # The magic: conv=fsync ensures each block is synced to hardware
    # status=progress shows real-time progress
    local start_time=$(date +%s)
    
    dd if="$iso" of="$device" bs="$BLOCK_SIZE" conv=fsync oflag=direct status=progress 2>&1 | \
        while IFS= read -r line; do
            echo -e "  ${CYAN}$line${NC}"
        done
    
    local dd_status=${PIPESTATUS[0]}
    
    if [ $dd_status -ne 0 ]; then
        log_error "dd failed with exit code $dd_status"
        exit 1
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    log_success "dd completed in ${duration}s"
}

# Final sync (belt and suspenders)
final_sync() {
    local device="$1"
    
    log_step "Step 4: Final hardware sync"
    log_info "Ensuring all data is physically written to USB..."
    
    # Sync the specific device
    sync
    
    # Force flush device buffers
    blockdev --flushbufs "$device" 2>/dev/null || true
    
    # Additional sync for good measure
    sync
    
    # Wait for any remaining I/O
    sleep 2
    
    log_success "All data synced to hardware"
}

# Verify the write (optional)
verify_write() {
    local iso="$1"
    local device="$2"
    
    log_step "Step 5: Verifying write integrity"
    
    local iso_size=$(stat -c%s "$iso")
    local blocks=$((iso_size / 1048576))  # 1MB blocks for verification
    
    log_info "Comparing first ${blocks}MB of ISO with USB..."
    
    # Calculate checksums
    local iso_hash=$(dd if="$iso" bs=1M count=$blocks status=none 2>/dev/null | md5sum | cut -d' ' -f1)
    local usb_hash=$(dd if="$device" bs=1M count=$blocks status=none 2>/dev/null | md5sum | cut -d' ' -f1)
    
    if [ "$iso_hash" = "$usb_hash" ]; then
        log_success "Verification passed! Checksums match."
        log_info "ISO MD5: $iso_hash"
        log_info "USB MD5: $usb_hash"
    else
        log_error "Verification FAILED! Checksums do not match."
        log_error "ISO MD5: $iso_hash"
        log_error "USB MD5: $usb_hash"
        log_error "The USB drive may be faulty or the write was interrupted."
        exit 1
    fi
}

# Print usage
usage() {
    echo "Usage: $0 [OPTIONS] [device] [iso_path]"
    echo ""
    echo "Deploy Quantix-OS ISO to a USB drive safely."
    echo ""
    echo "Arguments:"
    echo "  [device]     Target USB device (e.g., /dev/sdb)"
    echo "               If not specified, shows interactive device selector"
    echo "  [iso_path]   Path to ISO file (default: output/quantix-os-${VERSION}.iso)"
    echo ""
    echo "Options:"
    echo "  --list       List available USB devices"
    echo "  --verify     Verify write integrity after completion"
    echo "  --no-wipe    Skip signature wiping (not recommended)"
    echo "  --force      Skip confirmation prompt"
    echo "  --debug      Enable debug output"
    echo "  --help       Show this help"
    echo ""
    echo "Examples:"
    echo "  sudo $0                             # Interactive device selection"
    echo "  sudo $0 /dev/sdb                    # Deploy default ISO to /dev/sdb"
    echo "  sudo $0 /dev/sdb custom.iso         # Deploy custom ISO"
    echo "  sudo $0 --verify /dev/sdb           # Deploy and verify"
    echo "  sudo $0 --list                      # List USB devices"
    echo ""
    echo "Why this is better than manual dd:"
    echo "  • Wipes partition signatures (fixes Windows 'file not found' errors)"
    echo "  • Unmounts all partitions first (prevents interference)"
    echo "  • Uses conv=fsync (reports true completion, not fake 2.5GB/s)"
    echo "  • Optional verification (catches bad USB drives)"
    echo ""
}

# =============================================================================
# Main Script
# =============================================================================

# Parse arguments
DEVICE=""
ISO_PATH=""
DO_VERIFY=0
DO_WIPE=1
DO_FORCE=0
DO_LIST=0
SELECTED_DEVICE=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --list|-l)
            DO_LIST=1
            shift
            ;;
        --verify|-v)
            DO_VERIFY=1
            shift
            ;;
        --no-wipe)
            DO_WIPE=0
            shift
            ;;
        --force|-f)
            DO_FORCE=1
            shift
            ;;
        --debug|-d)
            export DEBUG=1
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        -*)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
        *)
            if [ -z "$DEVICE" ]; then
                DEVICE="$1"
            elif [ -z "$ISO_PATH" ]; then
                ISO_PATH="$1"
            else
                log_error "Too many arguments"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

# Show banner
print_banner

# Handle --list
if [ $DO_LIST -eq 1 ]; then
    check_root
    list_usb_devices
    exit 0
fi

# Check root first
check_root
check_dependencies

# If no device specified, use interactive selector
if [ -z "$DEVICE" ]; then
    select_usb_device
    DEVICE="$SELECTED_DEVICE"
fi

# Validate device
validate_device "$DEVICE"

# Set default ISO if not specified
if [ -z "$ISO_PATH" ]; then
    ISO_PATH="$DEFAULT_ISO"
fi

# Check ISO exists
if [ ! -f "$ISO_PATH" ]; then
    log_error "ISO file not found: $ISO_PATH"
    log_info "Run 'make iso' or './build.sh' to build the ISO first"
    exit 1
fi

# Show device info and get size
log_step "Target Device Information"
DEVICE_SIZE=$(get_device_info "$DEVICE" | tail -1)

# Check device is large enough
ISO_SIZE=$(stat -c%s "$ISO_PATH")
REQUIRED_SIZE=$(echo "$ISO_SIZE * $MIN_SPACE_BUFFER" | bc | cut -d. -f1)

if [ "$DEVICE_SIZE" -lt "$REQUIRED_SIZE" ]; then
    log_error "Device is too small!"
    log_error "ISO size: $(format_bytes $ISO_SIZE)"
    log_error "Device size: $(format_bytes $DEVICE_SIZE)"
    exit 1
fi

# Final confirmation
if [ $DO_FORCE -eq 0 ]; then
    echo ""
    echo -e "${RED}${BOLD}⚠️  WARNING: ALL DATA ON $DEVICE WILL BE DESTROYED! ⚠️${NC}"
    echo ""
    echo -e "  ISO:    ${CYAN}$(basename "$ISO_PATH")${NC} ($(format_bytes $ISO_SIZE))"
    echo -e "  Target: ${CYAN}$DEVICE${NC} ($(format_bytes $DEVICE_SIZE))"
    echo ""
    read -p "  Type 'yes' to continue: " confirm
    if [ "$confirm" != "yes" ]; then
        log_info "Aborted by user"
        exit 0
    fi
fi

# Execute deployment steps
START_TIME=$(date +%s)

unmount_device "$DEVICE"

if [ $DO_WIPE -eq 1 ]; then
    wipe_signatures "$DEVICE"
fi

write_iso "$ISO_PATH" "$DEVICE"
final_sync "$DEVICE"

if [ $DO_VERIFY -eq 1 ]; then
    verify_write "$ISO_PATH" "$DEVICE"
fi

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

# Success summary
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     DEPLOYMENT SUCCESSFUL! 🎉                             ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}ISO:${NC}      $(basename "$ISO_PATH")"
echo -e "${GREEN}║${NC}  ${CYAN}Device:${NC}   $DEVICE"
echo -e "${GREEN}║${NC}  ${CYAN}Size:${NC}     $(format_bytes $ISO_SIZE)"
echo -e "${GREEN}║${NC}  ${CYAN}Time:${NC}     ${TOTAL_TIME}s"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${YELLOW}The USB drive is ready to boot!${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}Next steps:${NC}"
echo -e "${GREEN}║${NC}    1. Safely eject the USB drive"
echo -e "${GREEN}║${NC}    2. Insert into target machine"
echo -e "${GREEN}║${NC}    3. Boot from USB (F12/F2/Del for boot menu)"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Safe eject hint
if command -v udisksctl &> /dev/null; then
    log_info "To safely eject: udisksctl power-off -b $DEVICE"
else
    log_info "To safely eject: eject $DEVICE"
fi

exit 0
