#!/bin/bash
# =============================================================================
# Quantix-vDC ISO Builder
# =============================================================================
# Creates a bootable installation ISO for Quantix-vDC appliance.
# Supports both UEFI and BIOS boot.
#
# Usage: ./build-iso.sh [VERSION]
# =============================================================================

set -e

VERSION="${1:-1.0.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
ISO_DIR="/tmp/iso"
ISO_NAME="quantix-vdc-${VERSION}.iso"

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Quantix-vDC ISO Builder v${VERSION}                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Verify required files
# -----------------------------------------------------------------------------
echo "📦 Step 1: Verifying required files..."

SQUASHFS="${OUTPUT_DIR}/system-${VERSION}.squashfs"
if [ ! -f "$SQUASHFS" ]; then
    echo "❌ Squashfs not found: ${SQUASHFS}"
    echo "   Run 'make rootfs' first"
    echo ""
    echo "   Contents of ${OUTPUT_DIR}:"
    ls -la "${OUTPUT_DIR}/" || echo "   (cannot list directory)"
    exit 1
fi

# Verify squashfs is not empty/corrupted
SQUASH_SIZE=$(stat -c%s "$SQUASHFS" 2>/dev/null || echo "0")
if [ "$SQUASH_SIZE" -lt 1000000 ]; then
    echo "❌ Squashfs file is too small (${SQUASH_SIZE} bytes)"
    echo "   Expected at least 600MB. File may be corrupted."
    echo "   Please run 'make clean && make rootfs' to rebuild."
    ls -la "$SQUASHFS"
    exit 1
fi

echo "✅ Files verified (squashfs: $(du -h "$SQUASHFS" | cut -f1))"

# -----------------------------------------------------------------------------
# Step 2: Create ISO structure
# -----------------------------------------------------------------------------
echo "📦 Step 2: Creating ISO structure..."

rm -rf "${ISO_DIR}"
mkdir -p "${ISO_DIR}"/{boot/grub,EFI/BOOT,quantix-vdc,installer}

echo "✅ ISO structure created"

# -----------------------------------------------------------------------------
# Step 3: Copy boot files and extract kernel
# -----------------------------------------------------------------------------
echo "📦 Step 3: Copying boot files..."

# Copy squashfs with verification
echo "   Copying squashfs ($(du -h "$SQUASHFS" | cut -f1))..."
cp -v "$SQUASHFS" "${ISO_DIR}/quantix-vdc/system.squashfs"

# Verify the copy
COPIED_SIZE=$(stat -c%s "${ISO_DIR}/quantix-vdc/system.squashfs" 2>/dev/null || echo "0")
if [ "$COPIED_SIZE" != "$SQUASH_SIZE" ]; then
    echo "❌ Squashfs copy verification failed!"
    echo "   Source: ${SQUASH_SIZE} bytes"
    echo "   Copied: ${COPIED_SIZE} bytes"
    exit 1
fi
echo "   ✅ Squashfs copied and verified"

# Extract kernel from squashfs
echo "   Extracting kernel from squashfs..."
mkdir -p /tmp/sqmount

# Try different mount methods
MOUNT_SUCCESS=0

# Method 1: Direct mount with loop
if mount -t squashfs -o loop "$SQUASHFS" /tmp/sqmount 2>/dev/null; then
    MOUNT_SUCCESS=1
fi

# Method 2: Explicit loop device
if [ "$MOUNT_SUCCESS" -eq 0 ]; then
    LOOP_DEV=$(losetup -f --show "$SQUASHFS" 2>/dev/null)
    if [ -n "$LOOP_DEV" ] && mount -t squashfs "$LOOP_DEV" /tmp/sqmount 2>/dev/null; then
        MOUNT_SUCCESS=1
    fi
fi

# Method 3: Use unsquashfs to extract directly
if [ "$MOUNT_SUCCESS" -eq 0 ]; then
    echo "   Mount failed, extracting with unsquashfs..."
    rm -rf /tmp/sqmount
    unsquashfs -d /tmp/sqmount "$SQUASHFS" || {
        echo "❌ Failed to extract squashfs"
        exit 1
    }
    MOUNT_SUCCESS=2  # Extracted, not mounted
fi

if [ "$MOUNT_SUCCESS" -eq 0 ]; then
    echo "❌ Failed to access squashfs"
    exit 1
fi

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

# Extract kernel modules for initramfs
echo "   Extracting kernel modules..."
rm -rf "${OUTPUT_DIR}/modules"
mkdir -p "${OUTPUT_DIR}/modules"

if [ -d "/tmp/sqmount/lib/modules" ]; then
    cp -r /tmp/sqmount/lib/modules/* "${OUTPUT_DIR}/modules/" 2>&1 | tail -5
    MODULE_COUNT=$(find "${OUTPUT_DIR}/modules" -name "*.ko*" 2>/dev/null | wc -l)
    echo "   ✅ Extracted ${MODULE_COUNT} kernel modules"
fi

# Cleanup squashfs mount/extraction
if [ "$MOUNT_SUCCESS" -eq 1 ]; then
    umount /tmp/sqmount 2>/dev/null || true
    [ -n "$LOOP_DEV" ] && losetup -d "$LOOP_DEV" 2>/dev/null || true
fi
rm -rf /tmp/sqmount

# Download kernel if not found
if [ "$KERNEL_FOUND" = "false" ]; then
    echo "⚠️  No kernel found in squashfs, downloading..."
    ALPINE_MIRROR="https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/x86_64"
    curl -sL "${ALPINE_MIRROR}/netboot/vmlinuz-lts" -o "${ISO_DIR}/boot/vmlinuz" || {
        echo "❌ Failed to download kernel"
        exit 1
    }
fi

# Build installer initramfs
echo "   Building installer initramfs..."
"${SCRIPT_DIR}/build-installer-initramfs.sh"
if [ -f "${OUTPUT_DIR}/installer-initramfs.img" ]; then
    cp "${OUTPUT_DIR}/installer-initramfs.img" "${ISO_DIR}/boot/initramfs"
    echo "   ✅ Installer initramfs created"
else
    echo "❌ Failed to build installer initramfs"
    exit 1
fi

# Copy installer scripts
cp "${WORK_DIR}/installer/"*.sh "${ISO_DIR}/installer/" 2>/dev/null || true
chmod +x "${ISO_DIR}/installer/"* 2>/dev/null || true

echo "✅ Boot files copied"

# -----------------------------------------------------------------------------
# Step 4: Create GRUB configuration
# -----------------------------------------------------------------------------
echo "📦 Step 4: Creating GRUB configuration..."

cat > "${ISO_DIR}/boot/grub/grub.cfg" << 'GRUBEOF'
# Quantix-vDC GRUB Configuration

set timeout=10
set default=0

# Text mode for maximum compatibility
terminal_output console

# Set colors
set menu_color_normal=white/black
set menu_color_highlight=black/light-gray

menuentry "Install Quantix-vDC" {
    linux /boot/vmlinuz boot=installer console=tty0 console=ttyS0,115200
    initrd /boot/initramfs
}

menuentry "Install Quantix-vDC (Debug Mode)" {
    linux /boot/vmlinuz boot=installer debug console=tty0 console=ttyS0,115200 loglevel=7
    initrd /boot/initramfs
}

menuentry "Rescue Shell (Emergency)" {
    linux /boot/vmlinuz boot=installer break=premount console=tty0 console=ttyS0,115200 loglevel=7
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

mkdir -p "${ISO_DIR}/EFI/BOOT"
mkdir -p "${ISO_DIR}/boot/grub/x86_64-efi"

# Find GRUB modules directory
GRUB_EFI_DIR=""
for dir in /usr/lib/grub/x86_64-efi /usr/share/grub/x86_64-efi; do
    if [ -d "$dir" ]; then
        GRUB_EFI_DIR="$dir"
        break
    fi
done

if [ -n "$GRUB_EFI_DIR" ]; then
    echo "   Using GRUB modules from: $GRUB_EFI_DIR"
    
    # Copy GRUB EFI modules
    cp -r "$GRUB_EFI_DIR"/*.mod "${ISO_DIR}/boot/grub/x86_64-efi/" 2>/dev/null || true
    cp -r "$GRUB_EFI_DIR"/*.lst "${ISO_DIR}/boot/grub/x86_64-efi/" 2>/dev/null || true
    
    # Build GRUB EFI image
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
    
    # Create EFI boot image for ISO
    echo "   Creating EFI boot partition image..."
    dd if=/dev/zero of="${ISO_DIR}/boot/efi.img" bs=1M count=16
    mkfs.vfat -F 12 "${ISO_DIR}/boot/efi.img"
    mmd -i "${ISO_DIR}/boot/efi.img" ::/EFI ::/EFI/BOOT
    mcopy -i "${ISO_DIR}/boot/efi.img" "${ISO_DIR}/EFI/BOOT/BOOTX64.EFI" ::/EFI/BOOT/
    mmd -i "${ISO_DIR}/boot/efi.img" ::/boot ::/boot/grub 2>/dev/null || true
    mcopy -i "${ISO_DIR}/boot/efi.img" "${ISO_DIR}/boot/grub/grub.cfg" ::/boot/grub/ 2>/dev/null || true
else
    echo "⚠️  GRUB EFI modules not found"
fi

echo "✅ UEFI boot image created"

# -----------------------------------------------------------------------------
# Step 6: Create BIOS boot image
# -----------------------------------------------------------------------------
echo "📦 Step 6: Creating BIOS boot image..."

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
# Step 7: Create ISO
# -----------------------------------------------------------------------------
echo "📦 Step 7: Creating ISO image..."

mkdir -p "${OUTPUT_DIR}"

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
        -V "QUANTIX-VDC" \
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
        -V "QUANTIX-VDC" \
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
echo "║                    ISO Build Complete!                        ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/${ISO_NAME}"
echo "║  Size:   ${ISO_SIZE}"
echo "║                                                               ║"
echo "║  To test:                                                     ║"
echo "║    make test-qemu       (BIOS mode)                           ║"
echo "║    make test-qemu-uefi  (UEFI mode)                           ║"
echo "║    make test-qemu-install (with virtual disk)                 ║"
echo "║                                                               ║"
echo "║  To create bootable USB:                                      ║"
echo "║    sudo dd if=${OUTPUT_DIR}/${ISO_NAME} of=/dev/sdX bs=4M     ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

# Cleanup
rm -rf "${ISO_DIR}"
