#!/bin/sh
# =============================================================================
# Quantix-OS Installer TUI
# =============================================================================
# Dialog-based text user interface for Quantix-OS installation.
# Similar to VMware ESXi installer - simple, clean, and effective.
# =============================================================================

# Dialog settings
DIALOG=${DIALOG:-dialog}
DIALOG_OK=0
DIALOG_CANCEL=1
DIALOG_ESC=255

# Get version from VERSION file or embedded
VERSION_FILE="/mnt/cdrom/quantix/VERSION"
if [ -f "$VERSION_FILE" ]; then
    VERSION=$(cat "$VERSION_FILE" | tr -d '\n\r ')
else
    VERSION="0.0.1"
fi

BACKTITLE="Quantix-OS Installer v${VERSION}"

# Temp files for dialog output
DIALOG_TEMP="/tmp/dialog.$$"

# Installation parameters
TARGET_DISK=""
HOSTNAME="quantix"
ROOT_PASSWORD=""

# Cleanup on exit
cleanup() {
    rm -f "$DIALOG_TEMP"
}
trap cleanup EXIT

# Check for dialog
if ! command -v dialog >/dev/null 2>&1; then
    echo "ERROR: dialog not found. Falling back to text mode."
    exec /installer/install.sh
fi

# =============================================================================
# Welcome Screen
# =============================================================================
show_welcome() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Welcome to Quantix-OS Installer" \
        --msgbox "\n\
 ╔═══════════════════════════════════════════════════════════╗\n\
 ║          QUANTIX-OS HYPERVISOR INSTALLER                  ║\n\
 ║                    Version ${VERSION}                           ║\n\
 ╚═══════════════════════════════════════════════════════════╝\n\
\n\
 This wizard will install Quantix-OS, a high-performance\n\
 KVM-based hypervisor operating system.\n\
\n\
 Quantix-OS provides:\n\
   • Enterprise-grade virtualization\n\
   • Modern web-based management (QHMI)\n\
   • Simple cluster integration\n\
   • A/B partition for safe upgrades\n\
\n\
 Requirements:\n\
   • 4 GB RAM minimum (16 GB recommended)\n\
   • 50 GB disk space minimum\n\
   • VT-x/AMD-V enabled CPU\n\
\n\
 Press ENTER to continue or ESC to cancel." 24 65

    return $?
}

# =============================================================================
# Disk Selection
# =============================================================================
select_disk() {
    # Load storage drivers
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Scanning Hardware" \
        --infobox "\nLoading storage drivers and scanning for disks...\n\nPlease wait..." 8 55
    
    # Load NVMe drivers
    modprobe nvme 2>/dev/null || true
    modprobe nvme_core 2>/dev/null || true
    
    # Load AHCI/SATA drivers
    modprobe ahci 2>/dev/null || true
    modprobe libata 2>/dev/null || true
    modprobe ata_piix 2>/dev/null || true
    modprobe ata_generic 2>/dev/null || true
    
    # Load SCSI drivers
    modprobe sd_mod 2>/dev/null || true
    modprobe scsi_mod 2>/dev/null || true
    
    # Load USB storage
    modprobe usb_storage 2>/dev/null || true
    modprobe uas 2>/dev/null || true
    
    # Load VirtIO
    modprobe virtio_blk 2>/dev/null || true
    modprobe virtio_scsi 2>/dev/null || true
    
    # Trigger device detection
    if command -v mdev >/dev/null 2>&1; then
        mdev -s 2>/dev/null || true
    fi
    
    # Wait for devices
    sleep 3
    
    # Get list of available disks (exclude USB boot media)
    DISK_LIST=""
    BOOT_DEVICE=""
    
    # Try to identify the boot device
    if [ -f /proc/cmdline ]; then
        BOOT_DEVICE=$(cat /proc/cmdline | grep -oP 'root=\K[^ ]+' || true)
    fi
    
    for disk in $(lsblk -dpno NAME,SIZE,TYPE 2>/dev/null | grep disk | awk '{print $1}'); do
        SIZE=$(lsblk -dpno SIZE "$disk" 2>/dev/null | head -1)
        MODEL=$(lsblk -dno MODEL "$disk" 2>/dev/null | head -1 | tr -d '[:space:]' || echo "Unknown")
        
        # Skip if this is likely the boot USB
        if [ -n "$BOOT_DEVICE" ] && echo "$BOOT_DEVICE" | grep -q "$disk"; then
            continue
        fi
        
        # Get size in bytes for comparison
        SIZE_BYTES=$(lsblk -dpnbo SIZE "$disk" 2>/dev/null | head -1 || echo "0")
        
        # Skip very small disks (< 10GB) - likely USB drives
        if [ "$SIZE_BYTES" -lt 10737418240 ] 2>/dev/null; then
            continue
        fi
        
        DISK_LIST="$DISK_LIST $disk \"$SIZE - $MODEL\" off"
    done

    if [ -z "$DISK_LIST" ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Error" \
            --msgbox "No suitable disks found!\n\nPossible causes:\n- NVMe/SATA drivers not loaded\n- Disk not connected properly\n- All disks < 10GB\n\nAvailable block devices:\n$(ls -la /dev/sd* /dev/nvme* /dev/vd* 2>&1 | head -10)" 18 65
        return 1
    fi

    eval $DIALOG --backtitle "\"$BACKTITLE\"" \
        --title "\"Select Target Disk\"" \
        --radiolist "\"\\nSelect the disk to install Quantix-OS.\\n\\n⚠️  WARNING: ALL DATA ON THE SELECTED DISK WILL BE ERASED!\\n\"" \
        20 70 8 \
        $DISK_LIST 2>"$DIALOG_TEMP"

    if [ $? -ne 0 ]; then
        return 1
    fi

    TARGET_DISK=$(cat "$DIALOG_TEMP")
    
    if [ -z "$TARGET_DISK" ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Error" \
            --msgbox "No disk selected!" 8 40
        return 1
    fi

    return 0
}

# =============================================================================
# Confirm Disk Selection
# =============================================================================
confirm_disk() {
    DISK_SIZE=$(lsblk -dno SIZE "$TARGET_DISK" 2>/dev/null)
    DISK_MODEL=$(lsblk -dno MODEL "$TARGET_DISK" 2>/dev/null || echo "Unknown")
    
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Confirm Disk Selection" \
        --yesno "\n\
Target Disk:  $TARGET_DISK\n\
Size:         $DISK_SIZE\n\
Model:        $DISK_MODEL\n\
\n\
Partition Layout:\n\
  ├─ EFI System    (256 MB)\n\
  ├─ QUANTIX-A     (1.5 GB) - Active system\n\
  ├─ QUANTIX-B     (1.5 GB) - Upgrade slot\n\
  ├─ QUANTIX-CFG   (256 MB) - Configuration\n\
  └─ QUANTIX-DATA  (rest)   - VM storage\n\
\n\
⚠️  ALL DATA ON THIS DISK WILL BE PERMANENTLY ERASED!\n\
\n\
Are you sure you want to continue?" 22 65

    return $?
}

# =============================================================================
# Hostname Configuration
# =============================================================================
configure_hostname() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Hostname Configuration" \
        --inputbox "\nEnter a hostname for this hypervisor:\n\n(e.g., quantix-node-01)" 12 50 "$HOSTNAME" 2>"$DIALOG_TEMP"

    if [ $? -ne 0 ]; then
        return 1
    fi

    HOSTNAME=$(cat "$DIALOG_TEMP")
    [ -z "$HOSTNAME" ] && HOSTNAME="quantix"

    # Validate hostname
    if ! echo "$HOSTNAME" | grep -qE '^[a-zA-Z][a-zA-Z0-9-]*$'; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Invalid Hostname" \
            --msgbox "Hostname must start with a letter and contain\nonly letters, numbers, and hyphens." 8 50
        return 1
    fi

    return 0
}

# =============================================================================
# Root Password Configuration
# =============================================================================
configure_password() {
    while true; do
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Root Password" \
            --insecure \
            --passwordbox "\nEnter root password:\n\n(Minimum 6 characters)" 12 50 2>"$DIALOG_TEMP"
        [ $? -ne 0 ] && return 1
        PASS1=$(cat "$DIALOG_TEMP")

        $DIALOG --backtitle "$BACKTITLE" \
            --title "Root Password" \
            --insecure \
            --passwordbox "\nConfirm root password:" 10 50 2>"$DIALOG_TEMP"
        [ $? -ne 0 ] && return 1
        PASS2=$(cat "$DIALOG_TEMP")

        if [ "$PASS1" = "$PASS2" ]; then
            if [ ${#PASS1} -lt 6 ]; then
                $DIALOG --backtitle "$BACKTITLE" \
                    --title "Error" \
                    --msgbox "Password must be at least 6 characters." 8 50
            else
                ROOT_PASSWORD="$PASS1"
                break
            fi
        else
            $DIALOG --backtitle "$BACKTITLE" \
                --title "Error" \
                --msgbox "Passwords do not match. Please try again." 8 50
        fi
    done

    return 0
}

# =============================================================================
# Installation Summary
# =============================================================================
show_summary() {
    DISK_SIZE=$(lsblk -dno SIZE "$TARGET_DISK" 2>/dev/null)
    
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Installation Summary" \
        --yesno "\n\
Please review your installation settings:\n\
\n\
  Quantix-OS Version:  ${VERSION}\n\
  Target Disk:         ${TARGET_DISK} (${DISK_SIZE})\n\
  Hostname:            ${HOSTNAME}\n\
  Root Password:       ********\n\
\n\
⚠️  ALL DATA ON ${TARGET_DISK} WILL BE ERASED!\n\
\n\
Begin installation?" 18 60

    return $?
}

# =============================================================================
# Run Installation
# =============================================================================
run_installation() {
    # Build install command
    INSTALL_CMD="/installer/install.sh"
    INSTALL_CMD="$INSTALL_CMD --disk $TARGET_DISK"
    INSTALL_CMD="$INSTALL_CMD --hostname $HOSTNAME"
    INSTALL_CMD="$INSTALL_CMD --password $ROOT_PASSWORD"
    INSTALL_CMD="$INSTALL_CMD --version $VERSION"
    INSTALL_CMD="$INSTALL_CMD --auto"

    # Run installation with progress display
    clear
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║              Installing Quantix-OS v${VERSION}                      ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""

    # Execute installation
    if $INSTALL_CMD; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Installation Complete" \
            --msgbox "\n\
 ✅ Quantix-OS v${VERSION} has been installed successfully!\n\
\n\
 Next Steps:\n\
   1. Remove the installation media (USB/ISO)\n\
   2. Reboot the system\n\
   3. Access the console TUI on the local display\n\
   4. Access web management at:\n\
\n\
      https://<ip-address>:8443/\n\
\n\
 Default Credentials:\n\
   Username: root\n\
   Password: (as configured)\n\
\n\
 Press ENTER to reboot now." 20 60

        $DIALOG --backtitle "$BACKTITLE" \
            --title "Reboot" \
            --yesno "\nReboot now?" 8 30

        if [ $? -eq 0 ]; then
            reboot
        fi
    else
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Installation Failed" \
            --msgbox "\n\
 ❌ Installation failed!\n\
\n\
 Please check the console output for errors.\n\
 Press ENTER to drop to a shell for troubleshooting." 12 55

        exec /bin/sh
    fi
}

# =============================================================================
# Main Installation Flow
# =============================================================================
main() {
    show_welcome || exit 0
    select_disk || exit 0
    confirm_disk || exit 0
    configure_hostname || exit 0
    configure_password || exit 0
    show_summary || exit 0
    run_installation
}

# Start installer
main
