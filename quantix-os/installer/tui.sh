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

# Storage pool configuration (disk:name pairs, space separated)
STORAGE_POOLS=""

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
# Storage Pool Configuration (Optional)
# =============================================================================
configure_storage_pools() {
    # Get list of available disks EXCLUDING the target disk
    AVAILABLE_DISKS=""
    DISK_COUNT=0
    
    for disk in $(lsblk -dpno NAME,SIZE,TYPE 2>/dev/null | grep disk | awk '{print $1}'); do
        # Skip the target (boot) disk
        if [ "$disk" = "$TARGET_DISK" ]; then
            continue
        fi
        
        SIZE=$(lsblk -dpno SIZE "$disk" 2>/dev/null | head -1)
        MODEL=$(lsblk -dno MODEL "$disk" 2>/dev/null | head -1 | tr -d '[:space:]' || echo "Unknown")
        
        # Get size in bytes for comparison
        SIZE_BYTES=$(lsblk -dpnbo SIZE "$disk" 2>/dev/null | head -1 || echo "0")
        
        # Skip very small disks (< 10GB) - likely USB drives
        if [ "$SIZE_BYTES" -lt 10737418240 ] 2>/dev/null; then
            continue
        fi
        
        # Format: /dev/nvme0n1 "500G - Samsung_SSD" off
        AVAILABLE_DISKS="$AVAILABLE_DISKS $disk \"$SIZE - $MODEL\" off"
        DISK_COUNT=$((DISK_COUNT + 1))
    done
    
    # If no additional disks available, skip this step
    if [ $DISK_COUNT -eq 0 ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Storage Pools" \
            --msgbox "\n\
No additional disks found for storage pools.\n\
\n\
The OS DATA partition on $TARGET_DISK will be used\n\
as the default storage location for VMs.\n\
\n\
You can configure additional storage pools later\n\
through the web management interface (QHMI)." 14 60
        return 0
    fi
    
    # Ask if user wants to configure additional storage pools
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Configure Storage Pools?" \
        --yesno "\n\
Found $DISK_COUNT additional disk(s) that can be configured\n\
as storage pools for VM storage.\n\
\n\
Storage pools are where your VMs, ISOs, and disk images\n\
will be stored. Using dedicated disks for storage:\n\
\n\
  • Improves performance (separate from OS)\n\
  • Provides more space for VMs and images\n\
  • Recommended for production use\n\
\n\
Would you like to configure storage pools now?\n\
\n\
(You can always configure this later via QHMI)" 20 65
    
    if [ $? -ne 0 ]; then
        return 0  # User chose not to configure - that's OK
    fi
    
    # Show disk selection for storage pools
    eval $DIALOG --backtitle "\"$BACKTITLE\"" \
        --title "\"Select Storage Disks\"" \
        --checklist "\"\\nSelect disks to initialize as storage pools.\\n\\n⚠️  WARNING: SELECTED DISKS WILL BE FORMATTED!\\n   All existing data will be erased.\\n\\nBoot disk: $TARGET_DISK (excluded)\\n\"" \
        22 70 8 \
        $AVAILABLE_DISKS 2>"$DIALOG_TEMP"
    
    if [ $? -ne 0 ]; then
        return 0  # User cancelled - that's OK
    fi
    
    SELECTED_DISKS=$(cat "$DIALOG_TEMP")
    
    if [ -z "$SELECTED_DISKS" ]; then
        return 0  # No disks selected - that's OK
    fi
    
    # Configure each selected disk
    for disk in $SELECTED_DISKS; do
        # Remove quotes if present
        disk=$(echo "$disk" | tr -d '"')
        
        # Get disk info
        DISK_SIZE=$(lsblk -dno SIZE "$disk" 2>/dev/null)
        DISK_MODEL=$(lsblk -dno MODEL "$disk" 2>/dev/null | head -1 | tr -d '[:space:]' || echo "Unknown")
        DISK_NAME=$(basename "$disk")
        
        # Suggest a pool name based on disk name
        DEFAULT_POOL_NAME="local-${DISK_NAME}"
        
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Configure Storage Pool: $disk" \
            --inputbox "\n\
Disk: $disk ($DISK_SIZE)\n\
Model: $DISK_MODEL\n\
\n\
Enter a name for this storage pool:\n\
(Alphanumeric and hyphens only)" 14 55 "$DEFAULT_POOL_NAME" 2>"$DIALOG_TEMP"
        
        if [ $? -ne 0 ]; then
            continue  # User cancelled this disk
        fi
        
        POOL_NAME=$(cat "$DIALOG_TEMP")
        [ -z "$POOL_NAME" ] && POOL_NAME="$DEFAULT_POOL_NAME"
        
        # Validate pool name
        if ! echo "$POOL_NAME" | grep -qE '^[a-zA-Z][a-zA-Z0-9-]*$'; then
            $DIALOG --backtitle "$BACKTITLE" \
                --title "Invalid Pool Name" \
                --msgbox "Pool name must start with a letter and contain\nonly letters, numbers, and hyphens.\n\nUsing default: $DEFAULT_POOL_NAME" 10 55
            POOL_NAME="$DEFAULT_POOL_NAME"
        fi
        
        # Add to storage pools list (disk:name format)
        if [ -z "$STORAGE_POOLS" ]; then
            STORAGE_POOLS="${disk}:${POOL_NAME}"
        else
            STORAGE_POOLS="${STORAGE_POOLS} ${disk}:${POOL_NAME}"
        fi
    done
    
    # Show summary of storage pool configuration
    if [ -n "$STORAGE_POOLS" ]; then
        POOL_SUMMARY=""
        for pool in $STORAGE_POOLS; do
            POOL_DISK=$(echo "$pool" | cut -d: -f1)
            POOL_NAME=$(echo "$pool" | cut -d: -f2)
            POOL_SIZE=$(lsblk -dno SIZE "$POOL_DISK" 2>/dev/null)
            POOL_SUMMARY="${POOL_SUMMARY}  • ${POOL_NAME} on ${POOL_DISK} (${POOL_SIZE})\n"
        done
        
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Storage Pool Summary" \
            --msgbox "\n\
The following storage pools will be created:\n\
\n\
${POOL_SUMMARY}\n\
These disks will be formatted with XFS filesystem\n\
and configured as libvirt storage pools.\n\
\n\
⚠️  ALL DATA ON THESE DISKS WILL BE ERASED!" 16 60
    fi
    
    return 0
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
    
    # Build storage pool summary
    POOL_SUMMARY="  Storage Pools:       (none - using OS DATA partition)\n"
    if [ -n "$STORAGE_POOLS" ]; then
        POOL_SUMMARY="  Storage Pools:\n"
        for pool in $STORAGE_POOLS; do
            POOL_DISK=$(echo "$pool" | cut -d: -f1)
            POOL_NAME=$(echo "$pool" | cut -d: -f2)
            POOL_SIZE=$(lsblk -dno SIZE "$POOL_DISK" 2>/dev/null)
            POOL_SUMMARY="${POOL_SUMMARY}    • ${POOL_NAME} on ${POOL_DISK} (${POOL_SIZE})\n"
        done
    fi
    
    # List disks to be formatted
    DISKS_TO_FORMAT="${TARGET_DISK}"
    for pool in $STORAGE_POOLS; do
        POOL_DISK=$(echo "$pool" | cut -d: -f1)
        DISKS_TO_FORMAT="${DISKS_TO_FORMAT}, ${POOL_DISK}"
    done
    
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Installation Summary" \
        --yesno "\n\
Please review your installation settings:\n\
\n\
  Quantix-OS Version:  ${VERSION}\n\
  Boot Disk:           ${TARGET_DISK} (${DISK_SIZE})\n\
  Hostname:            ${HOSTNAME}\n\
  Root Password:       ********\n\
\n\
${POOL_SUMMARY}\n\
⚠️  ALL DATA ON THESE DISKS WILL BE ERASED:\n\
   ${DISKS_TO_FORMAT}\n\
\n\
Begin installation?" 22 65

    return $?
}

# =============================================================================
# Run Installation
# =============================================================================
run_installation() {
    # Find install.sh in various locations
    INSTALL_SCRIPT=""
    for path in \
        "/installer/install.sh" \
        "/mnt/cdrom/installer/install.sh" \
        "$(dirname "$0")/install.sh"; do
        if [ -f "$path" ]; then
            INSTALL_SCRIPT="$path"
            break
        fi
    done
    
    if [ -z "$INSTALL_SCRIPT" ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Error" \
            --msgbox "\n\
 ❌ install.sh not found!\n\
\n\
 Checked locations:\n\
   - /installer/install.sh\n\
   - /mnt/cdrom/installer/install.sh\n\
   - $(dirname "$0")/install.sh\n\
\n\
 The installation media may be corrupt.\n" 16 55
        exec /bin/sh
    fi
    
    # Make sure it's executable
    chmod +x "$INSTALL_SCRIPT" 2>/dev/null || true
    
    # Build install command
    INSTALL_CMD="$INSTALL_SCRIPT"
    INSTALL_CMD="$INSTALL_CMD --disk $TARGET_DISK"
    INSTALL_CMD="$INSTALL_CMD --hostname $HOSTNAME"
    INSTALL_CMD="$INSTALL_CMD --password $ROOT_PASSWORD"
    INSTALL_CMD="$INSTALL_CMD --version $VERSION"
    INSTALL_CMD="$INSTALL_CMD --auto"
    
    # Pass storage pools if configured
    if [ -n "$STORAGE_POOLS" ]; then
        INSTALL_CMD="$INSTALL_CMD --storage-pools \"$STORAGE_POOLS\""
    fi

    # Run installation with progress display
    clear
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║              Installing Quantix-OS v${VERSION}                      ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""
    
    # Debug: Show what we're about to run
    echo "[DEBUG] Install script: $INSTALL_SCRIPT"
    echo "[DEBUG] Target disk: $TARGET_DISK"
    echo "[DEBUG] Hostname: $HOSTNAME"
    echo "[DEBUG] Version: $VERSION"
    echo ""
    
    # Test that install script is readable and executable
    if [ ! -f "$INSTALL_SCRIPT" ]; then
        echo "[ERROR] Install script not found: $INSTALL_SCRIPT"
        sleep 5
    elif [ ! -x "$INSTALL_SCRIPT" ]; then
        echo "[WARN] Install script not executable, fixing..."
        chmod +x "$INSTALL_SCRIPT"
    fi
    
    # Show first few lines of install script to verify it's valid
    echo "[DEBUG] First 5 lines of install script:"
    head -5 "$INSTALL_SCRIPT" 2>&1 || echo "(failed to read)"
    echo ""
    
    echo "Starting installation in 3 seconds..."
    sleep 3

    # Execute installation directly with explicit shell
    # This avoids issues with command string parsing
    # Build args array
    INSTALL_RESULT=0
    if [ -n "$STORAGE_POOLS" ]; then
        /bin/sh "$INSTALL_SCRIPT" \
            --disk "$TARGET_DISK" \
            --hostname "$HOSTNAME" \
            --password "$ROOT_PASSWORD" \
            --version "$VERSION" \
            --storage-pools "$STORAGE_POOLS" \
            --auto || INSTALL_RESULT=$?
    else
        /bin/sh "$INSTALL_SCRIPT" \
            --disk "$TARGET_DISK" \
            --hostname "$HOSTNAME" \
            --password "$ROOT_PASSWORD" \
            --version "$VERSION" \
            --auto || INSTALL_RESULT=$?
    fi
    
    if [ "$INSTALL_RESULT" -eq 0 ]; then
        # Build storage pool info for success message
        POOL_INFO=""
        if [ -n "$STORAGE_POOLS" ]; then
            POOL_INFO="\n Storage Pools Configured:\n"
            for pool in $STORAGE_POOLS; do
                POOL_NAME=$(echo "$pool" | cut -d: -f2)
                POOL_INFO="${POOL_INFO}   • ${POOL_NAME}\n"
            done
        fi

        $DIALOG --backtitle "$BACKTITLE" \
            --title "Installation Complete" \
            --msgbox "\n\
 ✅ Quantix-OS v${VERSION} has been installed successfully!\n\
${POOL_INFO}\n\
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
 Press ENTER to reboot now." 24 60

        $DIALOG --backtitle "$BACKTITLE" \
            --title "Reboot" \
            --yesno "\nReboot now?" 8 30

        if [ $? -eq 0 ]; then
            reboot
        fi
    else
        # Show diagnostic info before dropping to shell
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Installation Failed" \
            --msgbox "\n\
 ❌ Installation failed!\n\
\n\
 Diagnostic information will be shown.\n\
 Check /tmp/install.log for detailed errors.\n\
\n\
 Press ENTER to see diagnostics..." 14 55

        # Clear screen and show diagnostics
        clear
        echo ""
        echo "╔═══════════════════════════════════════════════════════════════╗"
        echo "║              INSTALLATION DIAGNOSTIC                          ║"
        echo "╚═══════════════════════════════════════════════════════════════╝"
        echo ""
        
        echo "=== Install Exit Code ==="
        echo "Exit code: $INSTALL_RESULT"
        echo ""
        
        echo "=== Install Script Location ==="
        echo "Script: $INSTALL_SCRIPT"
        ls -la "$INSTALL_SCRIPT" 2>&1 || echo "(not found)"
        echo ""
        
        echo "=== Install Script Shebang ==="
        head -1 "$INSTALL_SCRIPT" 2>&1 || echo "(cannot read)"
        echo ""
        
        echo "=== Syntax Check ==="
        /bin/sh -n "$INSTALL_SCRIPT" 2>&1 && echo "OK - no syntax errors" || echo "SYNTAX ERROR DETECTED!"
        echo ""
        
        echo "=== Install Log (last 50 lines) ==="
        if [ -f /tmp/install.log ]; then
            tail -50 /tmp/install.log
        else
            echo "(no install log found - script never started!)"
            echo ""
            echo "Possible causes:"
            echo "  1. Script has syntax errors (check above)"
            echo "  2. /bin/sh not available"
            echo "  3. Script permissions issue"
        fi
        echo ""
        
        echo "=== Partition Table on ${TARGET_DISK} ==="
        parted -s "${TARGET_DISK}" print 2>&1 || echo "(failed to read)"
        echo ""
        
        echo "=== blkid (filesystem signatures) ==="
        blkid 2>&1 || echo "(blkid failed)"
        echo ""
        
        echo "=== dmesg XFS errors ==="
        dmesg 2>/dev/null | grep -i "xfs\|superblock" | tail -10 || echo "(no XFS messages)"
        echo ""
        
        echo "=== dmesg last 20 lines ==="
        dmesg 2>/dev/null | tail -20 || echo "(dmesg failed)"
        echo ""
        
        echo "Press ENTER to drop to shell for manual troubleshooting..."
        read dummy
        
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
    configure_storage_pools  # Optional - user can skip
    configure_hostname || exit 0
    configure_password || exit 0
    show_summary || exit 0
    run_installation
}

# Start installer
main
