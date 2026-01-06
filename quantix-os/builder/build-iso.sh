#!/bin/bash
# ============================================================================
# Quantix-OS ISO Builder
# ============================================================================
# Creates a bootable ISO installer for Quantix-OS
#
# This script:
# 1. Builds the root filesystem squashfs
# 2. Creates a bootable ISO with GRUB (UEFI + BIOS)
# 3. Includes the installer script
#
# Usage: ./build-iso.sh
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
WORK_DIR="/work/iso-${VERSION}"
ISO_ROOT="${WORK_DIR}/iso"
OUTPUT_DIR="/output"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# ============================================================================
# Step 1: Build squashfs (calls the other script)
# ============================================================================
build_rootfs() {
    log_step "Building root filesystem..."
    /build/build-squashfs.sh
    log_info "Root filesystem built"
}

# ============================================================================
# Step 2: Create ISO structure
# ============================================================================
create_iso_structure() {
    log_step "Creating ISO structure..."
    
    # Clean and create
    rm -rf "${WORK_DIR}"
    mkdir -p "${ISO_ROOT}/boot/grub"
    mkdir -p "${ISO_ROOT}/EFI/BOOT"
    mkdir -p "${ISO_ROOT}/quantix"
    mkdir -p "${ISO_ROOT}/installer"
    
    # Copy squashfs
    cp "${OUTPUT_DIR}/system-${VERSION}.squashfs" "${ISO_ROOT}/quantix/"
    
    # Copy kernel and initramfs from rootfs
    ROOTFS="/work/rootfs-${VERSION}/rootfs"
    KERNEL_VERSION=$(ls "${ROOTFS}/lib/modules" | head -1)
    
    cp "${ROOTFS}/boot/vmlinuz-${KERNEL_FLAVOR}" "${ISO_ROOT}/boot/vmlinuz"
    cp "${ROOTFS}/boot/initramfs-${KERNEL_FLAVOR}" "${ISO_ROOT}/boot/initramfs"
    
    # Copy installer scripts
    if [[ -d "/installer" ]]; then
        cp -r /installer/* "${ISO_ROOT}/installer/"
        chmod +x "${ISO_ROOT}/installer/"*.sh 2>/dev/null || true
    fi
    
    # Copy branding
    if [[ -d "/branding" ]]; then
        cp -r /branding/* "${ISO_ROOT}/quantix/"
    fi
    
    log_info "ISO structure created"
}

# ============================================================================
# Step 3: Create GRUB configuration
# ============================================================================
create_grub_config() {
    log_step "Creating GRUB configuration..."
    
    # Main GRUB config
    # Uses search to find the correct partition regardless of boot method (USB, CD, Ventoy)
    cat > "${ISO_ROOT}/boot/grub/grub.cfg" << 'EOF'
# Quantix-OS GRUB Configuration

set default=0
set timeout=5
set gfxmode=auto
set gfxpayload=keep

# IMPORTANT: Search for Quantix-SPECIFIC files to avoid finding Ubuntu/other distros
# Priority 1: Search by volume label (most reliable for ISO/USB)
search --no-floppy --label QUANTIX_OS --set=root

# Priority 2: Search for Quantix-specific marker file
if [ -z "$root" ]; then
    search --no-floppy --file /quantix/system-1.0.0.squashfs --set=root
fi

# Priority 3: Search for our initramfs (not Ubuntu's initrd.img)
if [ -z "$root" ]; then
    search --no-floppy --file /boot/initramfs --set=root
fi

# Priority 4: Fallback to kernel (might find wrong disk!)
if [ -z "$root" ]; then
    search --no-floppy --file /boot/vmlinuz --set=root
fi

# Load video modules
insmod all_video
insmod gfxterm

# Set theme colors
set color_normal=white/black
set color_highlight=black/light-cyan

# Terminal output - fall back to console if gfxterm fails
terminal_output gfxterm
if [ "$?" != "0" ]; then
    terminal_output console
fi

# Menu entries
# IMPORTANT: rdinit=/init tells kernel to use our custom init from initramfs
# Without this, kernel uses its default init which expects root= parameter

menuentry "Quantix-OS Installer" --class quantix {
    echo "Loading Quantix-OS..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=4
    initrd /boot/initramfs
}

menuentry "Quantix-OS (Verbose)" --class quantix {
    echo "Loading Quantix-OS (Verbose)..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=7
    initrd /boot/initramfs
}

# ============================================================================
# VIDEO WORKAROUNDS - For Dell Latitude 5420 and similar Intel Xe laptops
# These fix "Blind Boot" where kernel outputs to wrong display
# ============================================================================

menuentry "Quantix-OS (Intel Fix - nomodeset)" --class quantix {
    echo "Loading with Intel GPU workaround..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=7 nomodeset i915.modeset=0
    initrd /boot/initramfs
}

menuentry "Quantix-OS (Force SimpleFB)" --class quantix {
    echo "Loading with SimpleFB (Proxmox fix)..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=7 video=simplefb:on nomodeset
    initrd /boot/initramfs
}

menuentry "Quantix-OS (Internal eDP Screen)" --class quantix {
    echo "Loading for laptop internal display..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=7 video=eDP-1:e video=DP-1:d video=DP-2:d video=DP-3:d video=DP-4:d video=HDMI-A-1:d
    initrd /boot/initramfs
}

menuentry "Quantix-OS (HDMI Only)" --class quantix {
    echo "Loading for HDMI output..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=7 video=HDMI-A-1:e video=eDP-1:d video=DP-1:d video=DP-2:d video=DP-3:d video=DP-4:d
    initrd /boot/initramfs
}

menuentry "Quantix-OS (DisplayPort Only)" --class quantix {
    echo "Loading for DisplayPort output..."
    linux /boot/vmlinuz rdinit=/init console=tty0 loglevel=7 video=DP-1:e video=eDP-1:d video=HDMI-A-1:d
    initrd /boot/initramfs
}

# ============================================================================
# DEBUG AND RESCUE OPTIONS
# ============================================================================

menuentry "Quantix-OS (Serial Console)" --class quantix {
    echo "Loading with serial console..."
    linux /boot/vmlinuz rdinit=/init console=ttyS0,115200n8 console=tty0
    initrd /boot/initramfs
}

menuentry "Rescue Shell" --class rescue {
    echo "Loading Rescue Shell..."
    linux /boot/vmlinuz rdinit=/init rescue
    initrd /boot/initramfs
}

menuentry "Debug: Show Boot Info" --class debug {
    echo "=== GRUB Debug Info ==="
    echo "Root device: $root"
    echo "Prefix: $prefix"
    echo ""
    echo "=== Checking Quantix files ==="
    if [ -f ($root)/boot/vmlinuz ]; then
        echo "vmlinuz: FOUND"
    else
        echo "vmlinuz: NOT FOUND"
    fi
    if [ -f ($root)/boot/initramfs ]; then
        echo "initramfs: FOUND"
    else
        echo "initramfs: NOT FOUND (check if this is Ubuntu!)"
    fi
    if [ -f ($root)/quantix/system-1.0.0.squashfs ]; then
        echo "squashfs: FOUND - This is Quantix!"
    else
        echo "squashfs: NOT FOUND - WRONG DISK!"
    fi
    echo ""
    echo "=== Listing /boot ==="
    ls ($root)/boot/
    echo ""
    echo "=== Listing /quantix (if exists) ==="
    ls ($root)/quantix/ 2>/dev/null || echo "(not found)"
    echo ""
    echo "=== Available disks ==="
    ls
    echo ""
    echo "Press Escape to return to menu..."
    sleep 30
}
EOF

    # Replace VERSION placeholder
    sed -i "s/\${VERSION}/${VERSION}/g" "${ISO_ROOT}/boot/grub/grub.cfg"
    
    log_info "GRUB configuration created"
}

# ============================================================================
# Step 4: Create EFI bootloader
# ============================================================================
create_efi_boot() {
    log_step "Creating EFI bootloader..."
    
    # Create a minimal early grub.cfg that searches for the real config
    # This is embedded into BOOTX64.EFI and executed first
    EARLY_CFG="${WORK_DIR}/early-grub.cfg"
    cat > "${EARLY_CFG}" << 'EARLYCFG'
# Early GRUB config - embedded in EFI binary
# Searches for the Quantix ISO/USB partition and loads the real config
# IMPORTANT: Must find QUANTIX, not Ubuntu or other installed distros!

# Priority 1: Search by volume label (most reliable)
search --no-floppy --label QUANTIX_OS --set=root

# Priority 2: Search for Quantix-specific squashfs
if [ -z "$root" ]; then
    search --no-floppy --file /quantix/system-1.0.0.squashfs --set=root
fi

# Priority 3: Search for our initramfs (Ubuntu uses initrd.img, we use initramfs)
if [ -z "$root" ]; then
    search --no-floppy --file /boot/initramfs --set=root
fi

# Set prefix to where grub.cfg lives on the found partition
set prefix=($root)/boot/grub

# Load the main config
configfile ($root)/boot/grub/grub.cfg
EARLYCFG

    # Create EFI GRUB image with embedded early config
    # The -c option embeds a config that runs before looking for grub.cfg
    grub-mkimage \
        -o "${ISO_ROOT}/EFI/BOOT/BOOTX64.EFI" \
        -O x86_64-efi \
        -c "${EARLY_CFG}" \
        -p /boot/grub \
        part_gpt part_msdos fat ext2 iso9660 normal boot linux \
        configfile loopback search search_fs_uuid search_fs_file \
        search_label gfxterm gfxterm_background gfxterm_menu \
        test all_video echo font gzio minicmd ls cat
    
    # Create EFI system partition image (larger to include grub.cfg backup)
    EFI_IMG="${WORK_DIR}/efi.img"
    dd if=/dev/zero of="${EFI_IMG}" bs=1M count=16
    mkfs.vfat -F 12 "${EFI_IMG}"
    
    # Mount and populate
    EFI_MNT="${WORK_DIR}/efi_mnt"
    mkdir -p "${EFI_MNT}"
    mount -o loop "${EFI_IMG}" "${EFI_MNT}"
    
    mkdir -p "${EFI_MNT}/EFI/BOOT"
    cp "${ISO_ROOT}/EFI/BOOT/BOOTX64.EFI" "${EFI_MNT}/EFI/BOOT/"
    
    # Also copy grub.cfg to EFI partition as fallback
    mkdir -p "${EFI_MNT}/boot/grub"
    cp "${ISO_ROOT}/boot/grub/grub.cfg" "${EFI_MNT}/boot/grub/"
    
    umount "${EFI_MNT}"
    
    # Clean up
    rm -f "${EARLY_CFG}"
    
    # Copy EFI image to ISO root for xorriso
    cp "${EFI_IMG}" "${ISO_ROOT}/efi.img"
    
    log_info "EFI bootloader created with embedded search config"
}

# ============================================================================
# Step 5: Create BIOS bootloader
# ============================================================================
create_bios_boot() {
    log_step "Creating BIOS bootloader..."
    
    # Create BIOS boot image for El Torito
    grub-mkimage \
        -o "${ISO_ROOT}/boot/grub/core.img" \
        -O i386-pc \
        -p /boot/grub \
        biosdisk part_gpt part_msdos fat ext2 normal boot linux \
        configfile loopback search iso9660
    
    # Prepend cdboot.img
    cat /usr/lib/grub/i386-pc/cdboot.img "${ISO_ROOT}/boot/grub/core.img" \
        > "${ISO_ROOT}/boot/grub/eltorito.img"
    
    log_info "BIOS bootloader created"
}

# ============================================================================
# Step 6: Create ISO
# ============================================================================
create_iso() {
    log_step "Creating ISO image..."
    
    OUTPUT_ISO="${OUTPUT_DIR}/quantix-os-${VERSION}.iso"
    EFI_IMG="${WORK_DIR}/efi.img"
    
    # Create hybrid ISO bootable from both CD and USB
    # -isohybrid-mbr is CRITICAL for USB boot (writes MBR boot code)
    xorriso -as mkisofs \
        -iso-level 3 \
        -full-iso9660-filenames \
        -joliet \
        -joliet-long \
        -rational-rock \
        -volid "QUANTIX_OS" \
        -appid "Quantix-OS ${VERSION}" \
        -publisher "Quantix Team" \
        -preparer "quantix-os-builder" \
        \
        -isohybrid-mbr /usr/lib/grub/i386-pc/boot_hybrid.img \
        \
        -eltorito-boot boot/grub/eltorito.img \
        -no-emul-boot \
        -boot-load-size 4 \
        -boot-info-table \
        --grub2-boot-info \
        \
        -eltorito-alt-boot \
        -e efi.img \
        -no-emul-boot \
        -isohybrid-gpt-basdat \
        \
        -append_partition 2 0xef "${EFI_IMG}" \
        \
        -output "${OUTPUT_ISO}" \
        "${ISO_ROOT}"
    
    # Calculate checksums
    sha256sum "${OUTPUT_ISO}" > "${OUTPUT_ISO}.sha256"
    
    # Report
    SIZE=$(du -h "${OUTPUT_ISO}" | cut -f1)
    log_info "ISO created: ${OUTPUT_ISO} (${SIZE})"
}

# ============================================================================
# Step 7: Cleanup
# ============================================================================
cleanup() {
    log_step "Cleaning up..."
    rm -rf "${WORK_DIR}"
    log_info "Cleanup complete"
}

# ============================================================================
# Main
# ============================================================================
main() {
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║              QUANTIX-OS ISO BUILDER v${VERSION}                    ║"
    echo "║                   Quantix-HyperVisor                           ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    log_info "Building Quantix-OS ${VERSION} (${ARCH})"
    log_info "Alpine ${ALPINE_VERSION}, Kernel: ${KERNEL_FLAVOR}"
    echo ""
    
    build_rootfs
    create_iso_structure
    create_grub_config
    create_efi_boot
    create_bios_boot
    create_iso
    cleanup
    
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                     BUILD COMPLETE!                           ║"
    echo "╠═══════════════════════════════════════════════════════════════╣"
    echo "║  ISO: ${OUTPUT_DIR}/quantix-os-${VERSION}.iso"
    echo "║  Squashfs: ${OUTPUT_DIR}/system-${VERSION}.squashfs"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
}

main "$@"
