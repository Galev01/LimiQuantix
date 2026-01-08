#!/bin/bash
# =============================================================================
# Quantix-vDC OVA Builder
# =============================================================================
# Creates an OVA (Open Virtual Appliance) for easy import into VMware,
# VirtualBox, Proxmox, and other virtualization platforms.
#
# Usage: ./build-ova.sh [VERSION]
# =============================================================================

set -e

VERSION="${1:-1.0.0}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
OVA_DIR="/tmp/ova"
OVA_NAME="quantix-vdc-${VERSION}.ova"
VMDK_NAME="quantix-vdc-disk.vmdk"
VM_NAME="Quantix-vDC"

# VM specifications
VM_MEMORY_MB=4096
VM_CPUS=2
DISK_SIZE_GB=20

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║           Quantix-vDC OVA Builder v${VERSION}                       ║"
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
    exit 1
fi

echo "✅ Files verified"

# -----------------------------------------------------------------------------
# Step 2: Create disk image
# -----------------------------------------------------------------------------
echo "📦 Step 2: Creating disk image..."

rm -rf "${OVA_DIR}"
mkdir -p "${OVA_DIR}"

# Create raw disk image
RAW_DISK="${OVA_DIR}/disk.raw"
truncate -s ${DISK_SIZE_GB}G "$RAW_DISK"

# Create partition table
parted -s "$RAW_DISK" mklabel gpt
parted -s "$RAW_DISK" \
    mkpart ESP fat32 1MiB 257MiB \
    set 1 esp on \
    mkpart root ext4 257MiB 10497MiB \
    mkpart data ext4 10497MiB 100%

echo "✅ Disk image created"

# -----------------------------------------------------------------------------
# Step 3: Setup loop device and format partitions
# -----------------------------------------------------------------------------
echo "📦 Step 3: Formatting partitions..."

# Setup loop device
LOOP_DEV=$(losetup -f --show -P "$RAW_DISK")
echo "   Using loop device: $LOOP_DEV"

# Wait for partitions to appear
sleep 2

# Format partitions
mkfs.vfat -F 32 -n QUANTIX-EFI "${LOOP_DEV}p1"
mkfs.ext4 -L QUANTIX-ROOT -F "${LOOP_DEV}p2"
mkfs.ext4 -L QUANTIX-DATA -F "${LOOP_DEV}p3"

echo "✅ Partitions formatted"

# -----------------------------------------------------------------------------
# Step 4: Mount and install system
# -----------------------------------------------------------------------------
echo "📦 Step 4: Installing system to disk..."

TARGET_MOUNT="${OVA_DIR}/target"
mkdir -p "$TARGET_MOUNT"

# Mount root partition
mount "${LOOP_DEV}p2" "$TARGET_MOUNT"

# Create mount points and mount other partitions
mkdir -p "$TARGET_MOUNT/boot/efi"
mkdir -p "$TARGET_MOUNT/var/lib"
mount "${LOOP_DEV}p1" "$TARGET_MOUNT/boot/efi"
mount "${LOOP_DEV}p3" "$TARGET_MOUNT/var/lib"

# Extract squashfs
echo "   Extracting system image..."
mkdir -p /tmp/sqfs
mount -t squashfs -o loop "$SQUASHFS" /tmp/sqfs
cp -a /tmp/sqfs/* "$TARGET_MOUNT/"
umount /tmp/sqfs
rmdir /tmp/sqfs

echo "✅ System installed"

# -----------------------------------------------------------------------------
# Step 5: Configure fstab
# -----------------------------------------------------------------------------
echo "📦 Step 5: Configuring fstab..."

# Get UUIDs
UUID_EFI=$(blkid -s UUID -o value "${LOOP_DEV}p1")
UUID_ROOT=$(blkid -s UUID -o value "${LOOP_DEV}p2")
UUID_DATA=$(blkid -s UUID -o value "${LOOP_DEV}p3")

cat > "$TARGET_MOUNT/etc/fstab" << EOF
# Quantix-vDC Filesystem Table
UUID=${UUID_ROOT}   /               ext4    defaults,noatime    0      1
UUID=${UUID_EFI}    /boot/efi       vfat    defaults,umask=0077 0      2
UUID=${UUID_DATA}   /var/lib        ext4    defaults,noatime    0      2
EOF

echo "✅ fstab configured"

# -----------------------------------------------------------------------------
# Step 6: Install bootloader
# -----------------------------------------------------------------------------
echo "📦 Step 6: Installing bootloader..."

# Prepare for chroot
mount --bind /dev "$TARGET_MOUNT/dev"
mount --bind /proc "$TARGET_MOUNT/proc"
mount --bind /sys "$TARGET_MOUNT/sys"

# Install GRUB
chroot "$TARGET_MOUNT" grub-install \
    --target=x86_64-efi \
    --efi-directory=/boot/efi \
    --bootloader-id=QUANTIX-VDC \
    --removable 2>/dev/null || {
    echo "   Creating fallback EFI boot..."
    mkdir -p "$TARGET_MOUNT/boot/efi/EFI/BOOT"
    if [ -d "$TARGET_MOUNT/usr/lib/grub/x86_64-efi" ]; then
        GRUB_EFI_DIR="$TARGET_MOUNT/usr/lib/grub/x86_64-efi"
    elif [ -d "$TARGET_MOUNT/usr/share/grub/x86_64-efi" ]; then
        GRUB_EFI_DIR="$TARGET_MOUNT/usr/share/grub/x86_64-efi"
    fi
    
    if [ -n "$GRUB_EFI_DIR" ]; then
        grub-mkimage \
            -O x86_64-efi \
            -o "$TARGET_MOUNT/boot/efi/EFI/BOOT/BOOTX64.EFI" \
            -p /boot/grub \
            -d "$GRUB_EFI_DIR" \
            part_gpt part_msdos fat ext2 \
            linux normal boot echo configfile loopback \
            efi_gop efi_uga ls search search_label search_fs_uuid \
            test all_video loadenv reboot halt 2>/dev/null || true
    fi
}

# Create GRUB config
mkdir -p "$TARGET_MOUNT/boot/grub"
cat > "$TARGET_MOUNT/boot/grub/grub.cfg" << EOF
set timeout=5
set default=0

menuentry "Quantix-vDC" {
    linux /boot/vmlinuz-lts root=UUID=${UUID_ROOT} ro quiet
    initrd /boot/initramfs-lts
}

menuentry "Quantix-vDC (Recovery)" {
    linux /boot/vmlinuz-lts root=UUID=${UUID_ROOT} ro single
    initrd /boot/initramfs-lts
}
EOF

# Cleanup chroot mounts
umount "$TARGET_MOUNT/dev" 2>/dev/null || true
umount "$TARGET_MOUNT/proc" 2>/dev/null || true
umount "$TARGET_MOUNT/sys" 2>/dev/null || true

echo "✅ Bootloader installed"

# -----------------------------------------------------------------------------
# Step 7: Unmount and cleanup
# -----------------------------------------------------------------------------
echo "📦 Step 7: Finalizing disk image..."

# Sync and unmount
sync
umount "$TARGET_MOUNT/var/lib"
umount "$TARGET_MOUNT/boot/efi"
umount "$TARGET_MOUNT"
rmdir "$TARGET_MOUNT"

# Detach loop device
losetup -d "$LOOP_DEV"

echo "✅ Disk image finalized"

# -----------------------------------------------------------------------------
# Step 8: Convert to VMDK
# -----------------------------------------------------------------------------
echo "📦 Step 8: Converting to VMDK format..."

qemu-img convert -f raw -O vmdk -o subformat=streamOptimized \
    "$RAW_DISK" "${OVA_DIR}/${VMDK_NAME}"

# Get VMDK size
VMDK_SIZE=$(stat -c%s "${OVA_DIR}/${VMDK_NAME}")

echo "✅ VMDK created"

# -----------------------------------------------------------------------------
# Step 9: Create OVF descriptor
# -----------------------------------------------------------------------------
echo "📦 Step 9: Creating OVF descriptor..."

cat > "${OVA_DIR}/quantix-vdc.ovf" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:cim="http://schemas.dmtf.org/wbem/wscim/1/common"
          xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
          xmlns:vmw="http://www.vmware.com/schema/ovf"
          xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <References>
    <File ovf:href="${VMDK_NAME}" ovf:id="file1" ovf:size="${VMDK_SIZE}"/>
  </References>
  <DiskSection>
    <Info>Virtual disk information</Info>
    <Disk ovf:capacity="${DISK_SIZE_GB}" ovf:capacityAllocationUnits="byte * 2^30" 
          ovf:diskId="vmdisk1" ovf:fileRef="file1" 
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"/>
  </DiskSection>
  <NetworkSection>
    <Info>The list of logical networks</Info>
    <Network ovf:name="VM Network">
      <Description>The VM Network</Description>
    </Network>
  </NetworkSection>
  <VirtualSystem ovf:id="${VM_NAME}">
    <Info>A virtual machine</Info>
    <Name>${VM_NAME}</Name>
    <OperatingSystemSection ovf:id="101">
      <Info>The operating system installed</Info>
      <Description>Linux (64-bit)</Description>
    </OperatingSystemSection>
    <VirtualHardwareSection>
      <Info>Virtual hardware requirements</Info>
      <System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>${VM_NAME}</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>vmx-13</vssd:VirtualSystemType>
      </System>
      <Item>
        <rasd:AllocationUnits>hertz * 10^6</rasd:AllocationUnits>
        <rasd:Description>Number of Virtual CPUs</rasd:Description>
        <rasd:ElementName>${VM_CPUS} virtual CPU(s)</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>${VM_CPUS}</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>Memory Size</rasd:Description>
        <rasd:ElementName>${VM_MEMORY_MB}MB of memory</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>${VM_MEMORY_MB}</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:Address>0</rasd:Address>
        <rasd:Description>SCSI Controller</rasd:Description>
        <rasd:ElementName>SCSI Controller 0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>lsilogic</rasd:ResourceSubType>
        <rasd:ResourceType>6</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>Hard Disk 1</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AddressOnParent>7</rasd:AddressOnParent>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Connection>VM Network</rasd:Connection>
        <rasd:Description>E1000 Ethernet adapter</rasd:Description>
        <rasd:ElementName>Network Adapter 1</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>E1000</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
      </Item>
    </VirtualHardwareSection>
    <ProductSection>
      <Info>Product information</Info>
      <Product>${VM_NAME}</Product>
      <Vendor>Quantix-KVM</Vendor>
      <Version>${VERSION}</Version>
      <FullVersion>${VERSION}</FullVersion>
      <ProductUrl>https://github.com/Quantix-KVM</ProductUrl>
    </ProductSection>
    <AnnotationSection>
      <Info>Annotation</Info>
      <Annotation>Quantix-vDC Control Plane Appliance

A centralized management platform for Quantix-KVM virtualization clusters.

Requirements:
- 4 GB RAM minimum (8 GB recommended)
- 2 vCPUs minimum
- 20 GB disk space

After boot, access the web console at https://&lt;appliance-ip&gt;/
</Annotation>
    </AnnotationSection>
  </VirtualSystem>
</Envelope>
EOF

echo "✅ OVF descriptor created"

# -----------------------------------------------------------------------------
# Step 10: Create OVA manifest
# -----------------------------------------------------------------------------
echo "📦 Step 10: Creating OVA manifest..."

cd "${OVA_DIR}"

# Calculate SHA256 checksums
VMDK_SHA256=$(sha256sum "${VMDK_NAME}" | awk '{print $1}')
OVF_SHA256=$(sha256sum "quantix-vdc.ovf" | awk '{print $1}')

cat > "quantix-vdc.mf" << EOF
SHA256(${VMDK_NAME})= ${VMDK_SHA256}
SHA256(quantix-vdc.ovf)= ${OVF_SHA256}
EOF

echo "✅ Manifest created"

# -----------------------------------------------------------------------------
# Step 11: Create OVA archive
# -----------------------------------------------------------------------------
echo "📦 Step 11: Creating OVA archive..."

# OVA is just a tar archive with specific ordering
tar -cvf "${OUTPUT_DIR}/${OVA_NAME}" \
    --format=ustar \
    quantix-vdc.ovf \
    quantix-vdc.mf \
    "${VMDK_NAME}"

# Calculate final size
OVA_SIZE=$(du -h "${OUTPUT_DIR}/${OVA_NAME}" | cut -f1)

echo "✅ OVA created"

# -----------------------------------------------------------------------------
# Cleanup
# -----------------------------------------------------------------------------
echo "📦 Cleaning up..."

rm -rf "${OVA_DIR}"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                    OVA Build Complete!                        ║"
echo "╠═══════════════════════════════════════════════════════════════╣"
echo "║  Output: ${OUTPUT_DIR}/${OVA_NAME}"
echo "║  Size:   ${OVA_SIZE}"
echo "║                                                               ║"
echo "║  Import into:                                                 ║"
echo "║    • VMware vSphere/ESXi                                      ║"
echo "║    • VMware Workstation/Fusion                                ║"
echo "║    • VirtualBox                                               ║"
echo "║    • Proxmox VE                                               ║"
echo "║                                                               ║"
echo "║  VM Specifications:                                           ║"
echo "║    • Memory: ${VM_MEMORY_MB} MB                               ║"
echo "║    • CPUs:   ${VM_CPUS}                                       ║"
echo "║    • Disk:   ${DISK_SIZE_GB} GB                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
