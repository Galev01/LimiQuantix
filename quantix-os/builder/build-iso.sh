#!/bin/bash
# =============================================================================
# Quantix-OS ISO Builder
# =============================================================================
# Creates a bootable ISO image with UEFI and BIOS support.
#
# Usage: ./build-iso.sh [VERSION]
# =============================================================================

set -e

VERSION="${1:-1.0.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${WORK_DIR}/output"
ISO_DIR="/tmp/iso"
ISO_NAME="quantix-os-${VERSION}.iso"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║              Quantix-OS ISO Builder v${VERSION}                     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Verify required files
# -----------------------------------------------------------------------------
echo "📦 Step 1: Verifying required files..."

SQUASHFS="${OUTPUT_DIR}/system-${VERSION}.squashfs"
if [ ! -f "$SQUASHFS" ]; then
    echo "❌ Squashfs not found: ${SQUASHFS}"
    echo "   Run 'make squashfs' first"
    exit 1
fi

# Kernel and initramfs will be extracted from squashfs
echo "✅ Files verified"

# -----------------------------------------------------------------------------
# Step 2: Create ISO structure
# -----------------------------------------------------------------------------
echo "📦 Step 2: Creating ISO structure..."

rm -rf "${ISO_DIR}"
mkdir -p "${ISO_DIR}"/{boot/grub,EFI/BOOT,quantix,isolinux}

echo "✅ ISO structure created"

# -----------------------------------------------------------------------------
# Step 3: Copy boot files
# -----------------------------------------------------------------------------
echo "📦 Step 3: Copying boot files..."

# Copy squashfs
cp "$SQUASHFS" "${ISO_DIR}/quantix/system.squashfs"

# Extract kernel from squashfs
echo "   Extracting kernel from squashfs..."
mkdir -p /tmp/sqmount
mount -t squashfs -o loop "$SQUASHFS" /tmp/sqmount || {
    echo "❌ Failed to mount squashfs"
    exit 1
}

# Find and copy kernel
KERNEL_FOUND=false
for kfile in /tmp/sqmount/boot/vmlinuz-lts /tmp/sqmount/boot/vmlinuz*; do
    if [ -f "$kfile" ]; then
        cp "$kfile" "${ISO_DIR}/boot/vmlinuz"
        echo "   Found kernel: $(basename $kfile)"
        KERNEL_FOUND=true
        break
    fi
done

umount /tmp/sqmount
rmdir /tmp/sqmount

# If no kernel found in squashfs, download from Alpine
if [ "$KERNEL_FOUND" = "false" ]; then
    echo "⚠️  No kernel found in squashfs!"
    echo "   Downloading Alpine kernel..."
    
    ALPINE_MIRROR="https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64"
    NETBOOT_URL="${ALPINE_MIRROR}/netboot/vmlinuz-lts"
    
    curl -sL "$NETBOOT_URL" -o "${ISO_DIR}/boot/vmlinuz" || wget -q "$NETBOOT_URL" -O "${ISO_DIR}/boot/vmlinuz" || {
        echo "❌ Failed to download kernel"
        exit 1
    }
fi

# Verify we have kernel
if [ ! -f "${ISO_DIR}/boot/vmlinuz" ]; then
    echo "❌ No kernel available for ISO"
    exit 1
fi

# ALWAYS build our custom initramfs for Live boot support
echo "   Building custom Quantix-OS initramfs..."
"${SCRIPT_DIR}/build-initramfs.sh"
if [ -f "${OUTPUT_DIR}/initramfs.img" ]; then
    cp "${OUTPUT_DIR}/initramfs.img" "${ISO_DIR}/boot/initramfs"
    echo "   Custom initramfs installed"
else
    echo "❌ Failed to build custom initramfs"
    exit 1
fi

echo "✅ Boot files copied"

# -----------------------------------------------------------------------------
# Step 4: Create GRUB configuration
# -----------------------------------------------------------------------------
echo "📦 Step 4: Creating GRUB configuration..."

cat > "${ISO_DIR}/boot/grub/grub.cfg" << 'GRUBEOF'
# Quantix-OS GRUB Configuration

set timeout=10
set default=0

# Text mode for maximum compatibility
terminal_output console

# Set colors
set menu_color_normal=white/black
set menu_color_highlight=black/light-gray

# Boot menu - Live mode boots from ISO/USB squashfs
menuentry "Quantix-OS Live" {
    linux /boot/vmlinuz boot=live toram quiet
    initrd /boot/initramfs
}

menuentry "Quantix-OS Live (Verbose)" {
    linux /boot/vmlinuz boot=live toram
    initrd /boot/initramfs
}

menuentry ">>> FULL DEBUG MODE <<<" {
    # Maximum kernel verbosity - shows ALL boot messages
    # earlyprintk: show messages before console is ready
    # debug: enable kernel debug messages
    # ignore_loglevel: show ALL messages regardless of level
    # initcall_debug: show every init function call
    # no_console_suspend: keep console active
    # console=tty0: output to main screen
    # console=ttyS0: also output to serial (for QEMU)
    linux /boot/vmlinuz boot=live debug earlyprintk=vga ignore_loglevel initcall_debug no_console_suspend console=tty0 console=ttyS0,115200 loglevel=7 printk.time=1
    initrd /boot/initramfs
}

menuentry ">>> DEBUG: Drop to initramfs shell <<<" {
    # This will boot and immediately drop to shell in initramfs
    # Allows manual inspection of what's available
    linux /boot/vmlinuz boot=live debug break=premount console=tty0 console=ttyS0,115200
    initrd /boot/initramfs
}

menuentry ">>> DEBUG: Alpine init (bypass our init) <<<" {
    # Try booting with Alpine's standard init parameters
    # This tests if the kernel/initramfs work at all
    linux /boot/vmlinuz modules=loop,squashfs,sd-mod,usb-storage quiet console=tty0
    initrd /boot/initramfs
}

menuentry "Quantix-OS Installer" {
    linux /boot/vmlinuz boot=live toram quantix.install=1
    initrd /boot/initramfs
}

menuentry "Boot from installed system" {
    linux /boot/vmlinuz root=LABEL=QUANTIX-A ro quiet
    initrd /boot/initramfs
}

menuentry "Reboot" {
    reboot
}

menuentry "Power Off" {
    halt
}
GRUBEOF

echo "✅ GRUB configuration created"

# -----------------------------------------------------------------------------
# Step 5: Create UEFI boot image
# -----------------------------------------------------------------------------
echo "📦 Step 5: Creating UEFI boot image..."

# Create EFI boot image
mkdir -p "${ISO_DIR}/EFI/BOOT"
mkdir -p "${ISO_DIR}/boot/grub/x86_64-efi"

# Copy GRUB EFI modules (needed for UEFI boot)
if [ -d "/usr/lib/grub/x86_64-efi" ]; then
    cp -r /usr/lib/grub/x86_64-efi/*.mod "${ISO_DIR}/boot/grub/x86_64-efi/" 2>/dev/null || true
    cp -r /usr/lib/grub/x86_64-efi/*.lst "${ISO_DIR}/boot/grub/x86_64-efi/" 2>/dev/null || true
elif [ -d "/usr/share/grub/x86_64-efi" ]; then
    cp -r /usr/share/grub/x86_64-efi/*.mod "${ISO_DIR}/boot/grub/x86_64-efi/" 2>/dev/null || true
    cp -r /usr/share/grub/x86_64-efi/*.lst "${ISO_DIR}/boot/grub/x86_64-efi/" 2>/dev/null || true
fi

# Build GRUB EFI image with all necessary modules embedded
# Note: linuxefi doesn't exist in Alpine, use linux module instead
echo "   Building GRUB EFI image..."

# Find GRUB modules directory
GRUB_EFI_DIR=""
for dir in /usr/lib/grub/x86_64-efi /usr/share/grub/x86_64-efi; do
    if [ -d "$dir" ]; then
        GRUB_EFI_DIR="$dir"
        break
    fi
done

if [ -z "$GRUB_EFI_DIR" ]; then
    echo "⚠️  GRUB EFI modules not found"
else
    echo "   Using GRUB modules from: $GRUB_EFI_DIR"
    
    # List available modules for debugging
    echo "   Available modules: $(ls $GRUB_EFI_DIR/*.mod 2>/dev/null | wc -l)"
    
    grub-mkimage \
        -O x86_64-efi \
        -o "${ISO_DIR}/EFI/BOOT/BOOTX64.EFI" \
        -p /boot/grub \
        -d "$GRUB_EFI_DIR" \
        part_gpt part_msdos fat ext2 iso9660 \
        linux normal boot echo configfile loopback chain \
        efi_gop efi_uga ls search search_label search_fs_uuid search_fs_file \
        gfxterm test all_video \
        loadenv reboot halt || echo "⚠️  GRUB EFI image creation failed"
fi

# Create EFI boot image for ISO (FAT filesystem containing EFI bootloader)
echo "   Creating EFI boot partition image..."
dd if=/dev/zero of="${ISO_DIR}/boot/efi.img" bs=1M count=16
mkfs.vfat -F 12 "${ISO_DIR}/boot/efi.img"
mmd -i "${ISO_DIR}/boot/efi.img" ::/EFI ::/EFI/BOOT
mcopy -i "${ISO_DIR}/boot/efi.img" "${ISO_DIR}/EFI/BOOT/BOOTX64.EFI" ::/EFI/BOOT/

# Also copy grub.cfg to EFI partition for standalone EFI boot
mmd -i "${ISO_DIR}/boot/efi.img" ::/boot ::/boot/grub 2>/dev/null || true
mcopy -i "${ISO_DIR}/boot/efi.img" "${ISO_DIR}/boot/grub/grub.cfg" ::/boot/grub/ 2>/dev/null || true

echo "✅ UEFI boot image created"

# -----------------------------------------------------------------------------
# Step 6: Create BIOS boot image
# -----------------------------------------------------------------------------
echo "📦 Step 6: Creating BIOS boot image..."

# Install GRUB for BIOS
grub-mkimage \
    -O i386-pc \
    -o "${ISO_DIR}/boot/grub/core.img" \
    -p /boot/grub \
    biosdisk iso9660 part_gpt part_msdos \
    linux normal boot configfile loopback chain \
    ls search search_label search_fs_uuid search_fs_file \
    gfxterm test all_video loadenv 2>/dev/null || echo "⚠️  GRUB BIOS image creation failed"

# Create BIOS boot catalog
if [ -f "/usr/lib/grub/i386-pc/cdboot.img" ]; then
    cat /usr/lib/grub/i386-pc/cdboot.img "${ISO_DIR}/boot/grub/core.img" > "${ISO_DIR}/boot/grub/bios.img"
elif [ -f "/usr/share/grub/i386-pc/cdboot.img" ]; then
    cat /usr/share/grub/i386-pc/cdboot.img "${ISO_DIR}/boot/grub/core.img" > "${ISO_DIR}/boot/grub/bios.img"
fi

echo "✅ BIOS boot image created"

# -----------------------------------------------------------------------------
# Step 7: Copy installer
# -----------------------------------------------------------------------------
echo "📦 Step 7: Copying installer..."

if [ -f "${WORK_DIR}/installer/install.sh" ]; then
    mkdir -p "${ISO_DIR}/installer"
    cp "${WORK_DIR}/installer/install.sh" "${ISO_DIR}/installer/"
    chmod +x "${ISO_DIR}/installer/install.sh"
fi

# Copy branding
if [ -d "${WORK_DIR}/branding" ]; then
    cp -r "${WORK_DIR}/branding" "${ISO_DIR}/"
fi

echo "✅ Installer copied"

# -----------------------------------------------------------------------------
# Step 8: Create ISO
# -----------------------------------------------------------------------------
echo "📦 Step 8: Creating ISO image..."

mkdir -p "${OUTPUT_DIR}"

# Check for required files
echo "   Checking boot files..."
ls -la "${ISO_DIR}/boot/" || true

# Determine hybrid MBR path
HYBRID_MBR=""
if [ -f "/usr/lib/grub/i386-pc/boot_hybrid.img" ]; then
    HYBRID_MBR="/usr/lib/grub/i386-pc/boot_hybrid.img"
elif [ -f "/usr/share/grub/i386-pc/boot_hybrid.img" ]; then
    HYBRID_MBR="/usr/share/grub/i386-pc/boot_hybrid.img"
fi

# Try full hybrid ISO first
ISO_CREATED=false

if [ -n "$HYBRID_MBR" ] && [ -f "${ISO_DIR}/boot/grub/bios.img" ] && [ -f "${ISO_DIR}/boot/efi.img" ]; then
    echo "   Creating hybrid BIOS/UEFI ISO..."
    if xorriso -as mkisofs \
    -o "${OUTPUT_DIR}/${ISO_NAME}" \
        -isohybrid-mbr "$HYBRID_MBR" \
    -c boot/boot.cat \
    -b boot/grub/bios.img \
    -no-emul-boot \
    -boot-load-size 4 \
    -boot-info-table \
    --grub2-boot-info \
    -eltorito-alt-boot \
    -e boot/efi.img \
    -no-emul-boot \
    -isohybrid-gpt-basdat \
    -V "QUANTIX-OS" \
    -R -J \
        "${ISO_DIR}" 2>&1; then
        ISO_CREATED=true
    fi
fi

# Fallback to simpler ISO if hybrid failed
if [ "$ISO_CREATED" = false ]; then
    echo "⚠️  Falling back to basic ISO creation..."
    xorriso -as mkisofs \
        -o "${OUTPUT_DIR}/${ISO_NAME}" \
        -V "QUANTIX-OS" \
        -R -J \
        "${ISO_DIR}" || {
        echo "❌ ISO creation failed!"
        exit 1
    }
fi

# Verify ISO was created
if [ ! -f "${OUTPUT_DIR}/${ISO_NAME}" ]; then
    echo "❌ ISO file was not created!"
    exit 1
fi

# Calculate size
ISO_SIZE=$(du -h "${OUTPUT_DIR}/${ISO_NAME}" | cut -f1)

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    Build Complete!                            ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/${ISO_NAME}"
echo "║  Size:   ${ISO_SIZE}"
echo "║                                                               ║"
echo "║  To test:                                                     ║"
echo "║    make test-qemu       (BIOS mode)                           ║"
echo "║    make test-qemu-uefi  (UEFI mode)                           ║"
echo "║                                                               ║"
echo "║  To create bootable USB:                                      ║"
echo "║    sudo dd if=${OUTPUT_DIR}/${ISO_NAME} of=/dev/sdX bs=4M     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

# Cleanup
rm -rf "${ISO_DIR}"
