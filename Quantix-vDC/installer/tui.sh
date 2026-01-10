#!/bin/sh
# =============================================================================
# Quantix-vDC Installer TUI
# =============================================================================
# Dialog-based text user interface for Quantix-vDC installation.
# =============================================================================

# Dialog settings
DIALOG=${DIALOG:-dialog}
DIALOG_OK=0
DIALOG_CANCEL=1
DIALOG_ESC=255
BACKTITLE="Quantix-vDC Installer"

# Temp files for dialog output
DIALOG_TEMP="/tmp/dialog.$$"

# Installation parameters
TARGET_DISK=""
HOSTNAME="quantix-vdc"
IP_MODE="dhcp"
IP_ADDRESS=""
IP_NETMASK="255.255.255.0"
IP_GATEWAY=""
IP_DNS="8.8.8.8"
ADMIN_PASSWORD=""

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

# Get version from ISO or default
VERSION="unknown"
for ver_file in /mnt/cdrom/quantix-vdc/VERSION /VERSION /etc/quantix-version; do
    if [ -f "$ver_file" ]; then
        VERSION=$(cat "$ver_file" | tr -d '[:space:]')
        break
    fi
done

# Update backtitle with version
BACKTITLE="Quantix-vDC Installer v${VERSION}"

# =============================================================================
# Welcome Screen
# =============================================================================
show_welcome() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Welcome to Quantix-vDC Installer" \
        --msgbox "\n\
 ╔═══════════════════════════════════════════════════════════╗\n\
 ║            QUANTIX-vDC CONTROL PLANE APPLIANCE            ║\n\
 ╚═══════════════════════════════════════════════════════════╝\n\
\n\
 This wizard will guide you through the installation of\n\
 Quantix-vDC, the centralized control plane for managing\n\
 your Quantix-KVM virtualization cluster.\n\
\n\
 Requirements:\n\
   • 4 GB RAM minimum (8 GB recommended)\n\
   • 20 GB disk space minimum\n\
   • Network connectivity\n\
\n\
 Press ENTER to continue or ESC to cancel." 20 65

    return $?
}

# =============================================================================
# Disk Selection
# =============================================================================
select_disk() {
    # Load storage drivers to ensure all disks are visible
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Scanning Hardware" \
        --infobox "\nLoading storage drivers and scanning for disks...\n\nPlease wait..." 8 50
    
    # Load NVMe drivers
    modprobe nvme 2>/dev/null || true
    modprobe nvme_core 2>/dev/null || true
    
    # Load AHCI/SATA drivers
    modprobe ahci 2>/dev/null || true
    modprobe libata 2>/dev/null || true
    modprobe ata_piix 2>/dev/null || true
    modprobe ata_generic 2>/dev/null || true
    
    # Load SCSI drivers (for some SSDs)
    modprobe sd_mod 2>/dev/null || true
    modprobe scsi_mod 2>/dev/null || true
    
    # Load USB storage (for external drives)
    modprobe usb_storage 2>/dev/null || true
    modprobe uas 2>/dev/null || true
    
    # Trigger udev/mdev to detect devices
    if command -v mdev >/dev/null 2>&1; then
        mdev -s 2>/dev/null || true
    fi
    
    # Wait for devices to settle
    sleep 3
    
    # Get list of available disks
    DISK_LIST=""
    for disk in $(lsblk -dpno NAME,SIZE,TYPE 2>/dev/null | grep disk | awk '{print $1}'); do
        SIZE=$(lsblk -dpno SIZE "$disk" 2>/dev/null | head -1)
        DISK_LIST="$DISK_LIST $disk \"$SIZE\" off"
    done

    if [ -z "$DISK_LIST" ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "No Disks Found" \
            --msgbox "\nNo suitable disks found!\n\n\
COMMON FIX FOR NVME DRIVES:\n\
If your system has an NVMe SSD, you may need to\n\
change BIOS settings:\n\n\
  1. Enter BIOS/UEFI Setup\n\
  2. Find 'SATA Operation' or 'Storage Mode'\n\
  3. Change from 'RAID' to 'AHCI'\n\
  4. Save and restart\n\n\
This is required for Dell, HP, Lenovo laptops\n\
with Intel RST/VMD enabled.\n\n\
Detected devices: $(ls /dev/nvme* /dev/sd* 2>/dev/null | tr '\n' ' ' || echo 'none')" 22 60
        return 1
    fi

    eval $DIALOG --backtitle "\"$BACKTITLE\"" \
        --title "\"Select Target Disk\"" \
        --radiolist "\"\\nSelect the disk to install Quantix-vDC.\\n\\nWARNING: All data on the selected disk will be erased!\\n\"" \
        18 60 6 \
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
    DISK_INFO=$(lsblk -dno SIZE,MODEL "$TARGET_DISK" 2>/dev/null)
    
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Confirm Disk Selection" \
        --yesno "\n\
Target Disk: $TARGET_DISK\n\
Details: $DISK_INFO\n\
\n\
⚠️  WARNING: ALL DATA ON THIS DISK WILL BE PERMANENTLY ERASED!\n\
\n\
Are you sure you want to continue?" 14 60

    return $?
}

# =============================================================================
# Hostname Configuration
# =============================================================================
configure_hostname() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Hostname Configuration" \
        --inputbox "\nEnter a hostname for this appliance:\n" 10 50 "$HOSTNAME" 2>"$DIALOG_TEMP"

    if [ $? -ne 0 ]; then
        return 1
    fi

    HOSTNAME=$(cat "$DIALOG_TEMP")
    [ -z "$HOSTNAME" ] && HOSTNAME="quantix-vdc"

    return 0
}

# =============================================================================
# Network Configuration
# =============================================================================
configure_network() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Network Configuration" \
        --menu "\nSelect network configuration method:\n" 12 50 2 \
        "dhcp"   "Automatic (DHCP)" \
        "static" "Static IP Address" 2>"$DIALOG_TEMP"

    if [ $? -ne 0 ]; then
        return 1
    fi

    IP_MODE=$(cat "$DIALOG_TEMP")

    if [ "$IP_MODE" = "static" ]; then
        configure_static_ip
        return $?
    fi

    return 0
}

# =============================================================================
# Static IP Configuration
# =============================================================================
configure_static_ip() {
    # IP Address
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Static IP Configuration" \
        --inputbox "\nEnter IP address (e.g., 192.168.1.100):\n" 10 50 "$IP_ADDRESS" 2>"$DIALOG_TEMP"
    [ $? -ne 0 ] && return 1
    IP_ADDRESS=$(cat "$DIALOG_TEMP")

    # Netmask
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Static IP Configuration" \
        --inputbox "\nEnter netmask (e.g., 255.255.255.0):\n" 10 50 "$IP_NETMASK" 2>"$DIALOG_TEMP"
    [ $? -ne 0 ] && return 1
    IP_NETMASK=$(cat "$DIALOG_TEMP")

    # Gateway
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Static IP Configuration" \
        --inputbox "\nEnter gateway IP:\n" 10 50 "$IP_GATEWAY" 2>"$DIALOG_TEMP"
    [ $? -ne 0 ] && return 1
    IP_GATEWAY=$(cat "$DIALOG_TEMP")

    # DNS
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Static IP Configuration" \
        --inputbox "\nEnter DNS server:\n" 10 50 "$IP_DNS" 2>"$DIALOG_TEMP"
    [ $? -ne 0 ] && return 1
    IP_DNS=$(cat "$DIALOG_TEMP")

    return 0
}

# =============================================================================
# Admin Password
# =============================================================================
configure_password() {
    while true; do
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Admin Password" \
            --insecure \
            --passwordbox "\nEnter admin (root) password:\n" 10 50 2>"$DIALOG_TEMP"
        [ $? -ne 0 ] && return 1
        PASS1=$(cat "$DIALOG_TEMP")

        $DIALOG --backtitle "$BACKTITLE" \
            --title "Admin Password" \
            --insecure \
            --passwordbox "\nConfirm admin password:\n" 10 50 2>"$DIALOG_TEMP"
        [ $? -ne 0 ] && return 1
        PASS2=$(cat "$DIALOG_TEMP")

        if [ "$PASS1" = "$PASS2" ]; then
            if [ ${#PASS1} -lt 6 ]; then
                $DIALOG --backtitle "$BACKTITLE" \
                    --title "Error" \
                    --msgbox "Password must be at least 6 characters." 8 50
            else
                ADMIN_PASSWORD="$PASS1"
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
    NETWORK_INFO="$IP_MODE"
    if [ "$IP_MODE" = "static" ]; then
        NETWORK_INFO="Static: $IP_ADDRESS / $IP_NETMASK"
    fi

    $DIALOG --backtitle "$BACKTITLE" \
        --title "Installation Summary" \
        --yesno "\n\
Please review your installation settings:\n\
\n\
  Target Disk:    $TARGET_DISK\n\
  Hostname:       $HOSTNAME\n\
  Network:        $NETWORK_INFO\n\
  Admin Password: ********\n\
\n\
⚠️  All data on $TARGET_DISK will be erased!\n\
\n\
Begin installation?" 16 60

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
    
    if [ "$IP_MODE" = "static" ]; then
        INSTALL_CMD="$INSTALL_CMD --static"
        INSTALL_CMD="$INSTALL_CMD --ip $IP_ADDRESS"
        INSTALL_CMD="$INSTALL_CMD --netmask $IP_NETMASK"
        INSTALL_CMD="$INSTALL_CMD --gateway $IP_GATEWAY"
        INSTALL_CMD="$INSTALL_CMD --dns $IP_DNS"
    else
        INSTALL_CMD="$INSTALL_CMD --dhcp"
    fi
    
    INSTALL_CMD="$INSTALL_CMD --password $ADMIN_PASSWORD"

    # Run installation with progress
    clear
    echo ""
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║              Installing Quantix-vDC...                        ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo ""

    # Execute installation
    if $INSTALL_CMD; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Installation Complete" \
            --msgbox "\n\
 ✅ Quantix-vDC has been installed successfully!\n\
\n\
 Next Steps:\n\
   1. Remove the installation media\n\
   2. Reboot the system\n\
   3. Access the web console at:\n\
\n\
      https://<ip-address>/\n\
\n\
 Press ENTER to reboot now." 16 60

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
 Press ENTER to drop to a shell." 12 50

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
    configure_network || exit 0
    configure_password || exit 0
    show_summary || exit 0
    run_installation
}

# Start installer
main
