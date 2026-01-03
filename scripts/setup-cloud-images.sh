#!/bin/bash
#
# LimiQuantix Cloud Image Setup Script
# =====================================
# This script downloads and sets up cloud images for use with LimiQuantix.
# Run on your hypervisor node to prepare cloud images for VM provisioning.
#
# Usage:
#   ./setup-cloud-images.sh [options] [image-name]
#
# Options:
#   --list         List available cloud images
#   --all          Download all standard images
#   --verify       Verify existing images
#   --clean        Remove all downloaded images
#   -h, --help     Show this help message
#
# Examples:
#   ./setup-cloud-images.sh ubuntu-22.04
#   ./setup-cloud-images.sh --all
#   ./setup-cloud-images.sh --list

set -euo pipefail

# Configuration
CLOUD_IMAGES_DIR="/var/lib/limiquantix/cloud-images"
ISOS_DIR="/var/lib/limiquantix/isos"
LOG_FILE="/var/log/limiquantix/cloud-images.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Cloud image catalog
declare -A IMAGES
IMAGES["ubuntu-22.04"]="https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
IMAGES["ubuntu-24.04"]="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
IMAGES["ubuntu-20.04"]="https://cloud-images.ubuntu.com/focal/current/focal-server-cloudimg-amd64.img"
IMAGES["debian-12"]="https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2"
IMAGES["debian-11"]="https://cloud.debian.org/images/cloud/bullseye/latest/debian-11-generic-amd64.qcow2"
IMAGES["almalinux-9"]="https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2"
IMAGES["rocky-9"]="https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2"
IMAGES["fedora-39"]="https://download.fedoraproject.org/pub/fedora/linux/releases/39/Cloud/x86_64/images/Fedora-Cloud-Base-39-1.5.x86_64.qcow2"
IMAGES["centos-stream-9"]="https://cloud.centos.org/centos/9-stream/x86_64/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2"
IMAGES["opensuse-15"]="https://download.opensuse.org/distribution/leap/15.5/appliances/openSUSE-Leap-15.5-Minimal-VM.x86_64-Cloud.qcow2"

# ISO images (for manual installs)
declare -A ISOS
ISOS["virtio-win"]="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
ISOS["ubuntu-22.04-live"]="https://releases.ubuntu.com/22.04.4/ubuntu-22.04.4-live-server-amd64.iso"

# Logging
log() {
    local level="$1"
    shift
    local msg="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "[$timestamp] [$level] $msg" | tee -a "$LOG_FILE"
}

info() { log "INFO" "${GREEN}$*${NC}"; }
warn() { log "WARN" "${YELLOW}$*${NC}"; }
error() { log "ERROR" "${RED}$*${NC}"; }
debug() { log "DEBUG" "${BLUE}$*${NC}"; }

# Show help
show_help() {
    cat << EOF
LimiQuantix Cloud Image Setup Script
=====================================

This script downloads and sets up cloud images for use with LimiQuantix.
Cloud images are pre-built OS images that support cloud-init for automated provisioning.

Usage:
  $0 [options] [image-name...]

Options:
  --list         List all available cloud images
  --all          Download all standard images
  --verify       Verify integrity of existing images
  --clean        Remove all downloaded images
  --iso <name>   Download an ISO image instead of cloud image
  -h, --help     Show this help message

Available Cloud Images:
$(for img in "${!IMAGES[@]}"; do echo "  - $img"; done | sort)

Available ISOs:
$(for iso in "${!ISOS[@]}"; do echo "  - $iso"; done | sort)

Examples:
  # Download Ubuntu 22.04 cloud image
  $0 ubuntu-22.04

  # Download multiple images
  $0 ubuntu-22.04 debian-12 almalinux-9

  # Download all standard images
  $0 --all

  # Download VirtIO drivers for Windows
  $0 --iso virtio-win

  # Verify all downloaded images
  $0 --verify

Storage Locations:
  Cloud Images: $CLOUD_IMAGES_DIR
  ISO Files:    $ISOS_DIR
  Log File:     $LOG_FILE

After downloading, use these images in the VM Creation Wizard by selecting
"Cloud Image" as the boot media type.

EOF
}

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."
    
    local missing=()
    
    # Check for required commands
    for cmd in wget qemu-img; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done
    
    if [ ${#missing[@]} -gt 0 ]; then
        error "Missing required commands: ${missing[*]}"
        echo ""
        echo "Install them with:"
        echo "  # Ubuntu/Debian"
        echo "  apt install -y wget qemu-utils genisoimage"
        echo ""
        echo "  # RHEL/AlmaLinux/Rocky"
        echo "  dnf install -y wget qemu-img genisoimage"
        exit 1
    fi
    
    # Create directories
    for dir in "$CLOUD_IMAGES_DIR" "$ISOS_DIR" "$(dirname "$LOG_FILE")"; do
        if [ ! -d "$dir" ]; then
            info "Creating directory: $dir"
            mkdir -p "$dir"
        fi
    done
    
    # Check disk space (need at least 10GB free)
    local free_space=$(df -BG "$CLOUD_IMAGES_DIR" | awk 'NR==2 {print $4}' | tr -d 'G')
    if [ "$free_space" -lt 10 ]; then
        warn "Low disk space: ${free_space}GB available. Recommended: 10GB+"
    fi
    
    info "Prerequisites check passed"
}

# List available images
list_images() {
    echo ""
    echo "Available Cloud Images:"
    echo "========================"
    echo ""
    printf "%-20s %-s\n" "NAME" "URL"
    printf "%-20s %-s\n" "----" "---"
    for img in $(echo "${!IMAGES[@]}" | tr ' ' '\n' | sort); do
        local status=""
        local path="$CLOUD_IMAGES_DIR/${img}.qcow2"
        if [ -f "$path" ]; then
            local size=$(du -h "$path" | cut -f1)
            status=" [Downloaded: $size]"
        fi
        printf "%-20s %s%s\n" "$img" "${IMAGES[$img]}" "$status"
    done
    
    echo ""
    echo "Available ISOs:"
    echo "==============="
    echo ""
    printf "%-20s %-s\n" "NAME" "URL"
    printf "%-20s %-s\n" "----" "---"
    for iso in $(echo "${!ISOS[@]}" | tr ' ' '\n' | sort); do
        local status=""
        local path="$ISOS_DIR/${iso}.iso"
        if [ -f "$path" ]; then
            local size=$(du -h "$path" | cut -f1)
            status=" [Downloaded: $size]"
        fi
        printf "%-20s %s%s\n" "$iso" "${ISOS[$iso]}" "$status"
    done
    echo ""
}

# Download a cloud image
download_image() {
    local name="$1"
    local url="${IMAGES[$name]:-}"
    
    if [ -z "$url" ]; then
        error "Unknown image: $name"
        echo "Use --list to see available images"
        return 1
    fi
    
    local output_path="$CLOUD_IMAGES_DIR/${name}.qcow2"
    local temp_path="$CLOUD_IMAGES_DIR/.${name}.qcow2.download"
    
    info "Downloading $name..."
    debug "URL: $url"
    debug "Output: $output_path"
    
    # Check if already exists
    if [ -f "$output_path" ]; then
        local size=$(du -h "$output_path" | cut -f1)
        warn "Image already exists: $output_path ($size)"
        read -p "Re-download? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Skipping $name"
            return 0
        fi
    fi
    
    # Download with progress
    if wget --progress=bar:force:noscroll -O "$temp_path" "$url"; then
        mv "$temp_path" "$output_path"
        
        # Verify it's a valid qcow2 image
        if qemu-img info "$output_path" &> /dev/null; then
            local size=$(du -h "$output_path" | cut -f1)
            local format=$(qemu-img info "$output_path" | grep "file format" | awk '{print $3}')
            local vsize=$(qemu-img info "$output_path" | grep "virtual size" | awk '{print $3}')
            
            info "✓ Downloaded $name successfully"
            info "  Path: $output_path"
            info "  Size: $size (virtual: $vsize)"
            info "  Format: $format"
            
            # Convert raw images to qcow2 if needed
            if [ "$format" = "raw" ]; then
                info "Converting from raw to qcow2..."
                local qcow2_path="$CLOUD_IMAGES_DIR/${name}.converted.qcow2"
                qemu-img convert -f raw -O qcow2 "$output_path" "$qcow2_path"
                mv "$qcow2_path" "$output_path"
                info "Converted to qcow2"
            fi
        else
            error "Downloaded file is not a valid disk image"
            rm -f "$output_path"
            return 1
        fi
    else
        error "Failed to download $name"
        rm -f "$temp_path"
        return 1
    fi
}

# Download an ISO
download_iso() {
    local name="$1"
    local url="${ISOS[$name]:-}"
    
    if [ -z "$url" ]; then
        error "Unknown ISO: $name"
        echo "Use --list to see available ISOs"
        return 1
    fi
    
    local output_path="$ISOS_DIR/${name}.iso"
    local temp_path="$ISOS_DIR/.${name}.iso.download"
    
    info "Downloading ISO: $name..."
    debug "URL: $url"
    debug "Output: $output_path"
    
    if [ -f "$output_path" ]; then
        local size=$(du -h "$output_path" | cut -f1)
        warn "ISO already exists: $output_path ($size)"
        read -p "Re-download? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Skipping $name"
            return 0
        fi
    fi
    
    if wget --progress=bar:force:noscroll -O "$temp_path" "$url"; then
        mv "$temp_path" "$output_path"
        local size=$(du -h "$output_path" | cut -f1)
        info "✓ Downloaded ISO: $name ($size)"
        info "  Path: $output_path"
    else
        error "Failed to download ISO: $name"
        rm -f "$temp_path"
        return 1
    fi
}

# Verify images
verify_images() {
    info "Verifying cloud images..."
    
    local total=0
    local valid=0
    local invalid=0
    
    for name in "${!IMAGES[@]}"; do
        local path="$CLOUD_IMAGES_DIR/${name}.qcow2"
        if [ -f "$path" ]; then
            ((total++))
            if qemu-img check "$path" &> /dev/null; then
                ((valid++))
                local size=$(du -h "$path" | cut -f1)
                info "✓ $name ($size) - OK"
            else
                ((invalid++))
                error "✗ $name - CORRUPT"
            fi
        fi
    done
    
    echo ""
    info "Verification complete: $valid/$total images OK"
    if [ $invalid -gt 0 ]; then
        error "$invalid corrupted images found"
        return 1
    fi
}

# Clean all images
clean_images() {
    warn "This will remove all downloaded cloud images and ISOs!"
    read -p "Are you sure? [y/N] " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        info "Removing cloud images..."
        rm -rf "$CLOUD_IMAGES_DIR"/*.qcow2
        rm -rf "$CLOUD_IMAGES_DIR"/.*.download
        
        info "Removing ISOs..."
        rm -rf "$ISOS_DIR"/*.iso
        rm -rf "$ISOS_DIR"/.*.download
        
        info "Cleanup complete"
    else
        info "Cleanup cancelled"
    fi
}

# Download all images
download_all() {
    info "Downloading all standard cloud images..."
    
    local images=("ubuntu-22.04" "ubuntu-24.04" "debian-12" "almalinux-9" "rocky-9")
    
    for img in "${images[@]}"; do
        download_image "$img" || true
        echo ""
    done
    
    info "All standard images downloaded"
}

# Show image info
show_image_info() {
    local path="$1"
    
    if [ ! -f "$path" ]; then
        error "File not found: $path"
        return 1
    fi
    
    echo ""
    echo "Image Information:"
    echo "=================="
    qemu-img info "$path"
    echo ""
}

# Main function
main() {
    # Parse arguments
    if [ $# -eq 0 ]; then
        show_help
        exit 0
    fi
    
    local action=""
    local images=()
    local download_isos=false
    
    while [ $# -gt 0 ]; do
        case "$1" in
            --list)
                action="list"
                ;;
            --all)
                action="all"
                ;;
            --verify)
                action="verify"
                ;;
            --clean)
                action="clean"
                ;;
            --iso)
                download_isos=true
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            -*)
                error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
            *)
                images+=("$1")
                ;;
        esac
        shift
    done
    
    # Execute action
    case "$action" in
        list)
            list_images
            ;;
        all)
            check_prerequisites
            download_all
            ;;
        verify)
            verify_images
            ;;
        clean)
            clean_images
            ;;
        *)
            # Download specific images
            if [ ${#images[@]} -eq 0 ]; then
                show_help
                exit 0
            fi
            
            check_prerequisites
            
            for img in "${images[@]}"; do
                if $download_isos; then
                    download_iso "$img"
                else
                    download_image "$img"
                fi
                echo ""
            done
            ;;
    esac
}

# Run main
main "$@"
