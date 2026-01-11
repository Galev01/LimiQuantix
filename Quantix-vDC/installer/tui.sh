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

# Variables for network config
NET_INTERFACE=""
NET_TYPE="ethernet"  # ethernet or wifi
WIFI_SSID=""
WIFI_PASSWORD=""

configure_network() {
    # First, let user select interface type
    $DIALOG --backtitle "$BACKTITLE" \
        --title "Network Configuration" \
        --menu "\nSelect network connection type:\n" 12 55 2 \
        "ethernet" "Ethernet (wired connection)" \
        "wifi"     "WiFi (wireless connection)" 2>"$DIALOG_TEMP"
    
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    NET_TYPE=$(cat "$DIALOG_TEMP")
    
    if [ "$NET_TYPE" = "wifi" ]; then
        configure_wifi_network
        [ $? -ne 0 ] && return 1
    else
        configure_ethernet_interface
        [ $? -ne 0 ] && return 1
    fi
    
    # Now configure IP (DHCP or static)
    $DIALOG --backtitle "$BACKTITLE" \
        --title "IP Configuration" \
        --menu "\nSelect IP configuration method:\n" 12 50 2 \
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

configure_ethernet_interface() {
    # Find ethernet interfaces
    IFACE_LIST=""
    for iface in $(ip link show | grep -E "^[0-9]+: (eth|enp|ens)" | awk -F: '{print $2}' | tr -d ' '); do
        STATUS="down"
        ip link show "$iface" 2>/dev/null | grep -q "state UP" && STATUS="up"
        IFACE_LIST="$IFACE_LIST \"$iface\" \"Ethernet ($STATUS)\" off"
    done
    
    if [ -z "$IFACE_LIST" ]; then
        # Default to eth0 if nothing found
        NET_INTERFACE="eth0"
        return 0
    fi
    
    eval $DIALOG --backtitle "\"$BACKTITLE\"" \
        --title "\"Select Ethernet Interface\"" \
        --radiolist "\"\\nSelect the network interface:\\n\"" \
        14 50 4 \
        $IFACE_LIST 2>"$DIALOG_TEMP"
    
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    NET_INTERFACE=$(cat "$DIALOG_TEMP")
    [ -z "$NET_INTERFACE" ] && NET_INTERFACE="eth0"
    
    return 0
}

configure_wifi_network() {
    # Find wireless interfaces
    WIFI_IFACE=$(ip link show | grep -E "^[0-9]+: (wlan|wlp)" | head -1 | awk -F: '{print $2}' | tr -d ' ')
    
    if [ -z "$WIFI_IFACE" ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "WiFi Error" \
            --msgbox "\nNo wireless interface detected!\n\nPlease check:\n- WiFi hardware is present\n- Drivers are loaded\n\nProceeding with ethernet configuration." 14 55
        NET_TYPE="ethernet"
        configure_ethernet_interface
        return $?
    fi
    
    NET_INTERFACE="$WIFI_IFACE"
    
    # Ask if user wants to scan or enter manually
    $DIALOG --backtitle "$BACKTITLE" \
        --title "WiFi Configuration" \
        --menu "\nWiFi Interface: $WIFI_IFACE\n\nSelect option:\n" 14 50 2 \
        "scan"   "Scan for networks" \
        "manual" "Enter network name manually" 2>"$DIALOG_TEMP"
    
    [ $? -ne 0 ] && return 1
    
    local WIFI_METHOD=$(cat "$DIALOG_TEMP")
    
    if [ "$WIFI_METHOD" = "scan" ]; then
        scan_wifi_installer
    else
        enter_wifi_manual
    fi
    
    return $?
}

scan_wifi_installer() {
    $DIALOG --backtitle "$BACKTITLE" \
        --infobox "\nScanning for WiFi networks...\n\nThis may take a few seconds." 8 45
    
    # Bring interface up
    ip link set "$NET_INTERFACE" up 2>/dev/null
    sleep 2
    
    # Scan and build list
    WIFI_LIST=""
    if command -v iwlist >/dev/null 2>&1; then
        for network in $(iwlist "$NET_INTERFACE" scan 2>/dev/null | grep "ESSID:" | sed 's/.*ESSID:"\([^"]*\)".*/\1/' | sort -u | head -10); do
            [ -n "$network" ] && WIFI_LIST="$WIFI_LIST \"$network\" \"\" off"
        done
    fi
    
    if [ -z "$WIFI_LIST" ]; then
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Scan Results" \
            --msgbox "\nNo networks found.\n\nPlease enter network name manually." 10 45
        enter_wifi_manual
        return $?
    fi
    
    eval $DIALOG --backtitle "\"$BACKTITLE\"" \
        --title "\"Select WiFi Network\"" \
        --radiolist "\"\\nSelect your WiFi network:\\n\"" \
        18 55 8 \
        $WIFI_LIST 2>"$DIALOG_TEMP"
    
    [ $? -ne 0 ] && return 1
    
    WIFI_SSID=$(cat "$DIALOG_TEMP")
    
    if [ -z "$WIFI_SSID" ]; then
        enter_wifi_manual
        return $?
    fi
    
    # Get password
    get_wifi_password
    return $?
}

enter_wifi_manual() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "WiFi Network" \
        --inputbox "\nEnter WiFi network name (SSID):\n" 10 50 2>"$DIALOG_TEMP"
    
    [ $? -ne 0 ] && return 1
    
    WIFI_SSID=$(cat "$DIALOG_TEMP")
    
    if [ -z "$WIFI_SSID" ]; then
        $DIALOG --msgbox "\nNetwork name cannot be empty!" 8 40
        return 1
    fi
    
    get_wifi_password
    return $?
}

get_wifi_password() {
    $DIALOG --backtitle "$BACKTITLE" \
        --title "WiFi Password" \
        --insecure \
        --passwordbox "\nEnter WiFi password for '$WIFI_SSID':\n\n(Leave empty for open network)" 12 55 2>"$DIALOG_TEMP"
    
    [ $? -ne 0 ] && return 1
    
    WIFI_PASSWORD=$(cat "$DIALOG_TEMP")
    
    # Test connection
    $DIALOG --backtitle "$BACKTITLE" \
        --infobox "\nTesting WiFi connection to '$WIFI_SSID'..." 6 50
    
    # Try to connect
    killall wpa_supplicant 2>/dev/null
    sleep 1
    
    if [ -n "$WIFI_PASSWORD" ]; then
        # WPA/WPA2
        cat > /tmp/wpa_test.conf << EOF
ctrl_interface=/var/run/wpa_supplicant
network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASSWORD"
    key_mgmt=WPA-PSK
}
EOF
    else
        # Open network
        cat > /tmp/wpa_test.conf << EOF
ctrl_interface=/var/run/wpa_supplicant
network={
    ssid="$WIFI_SSID"
    key_mgmt=NONE
}
EOF
    fi
    
    ip link set "$NET_INTERFACE" up 2>/dev/null
    wpa_supplicant -B -i "$NET_INTERFACE" -c /tmp/wpa_test.conf 2>/dev/null
    sleep 4
    
    # Check if associated
    if iwconfig "$NET_INTERFACE" 2>/dev/null | grep -q "Access Point: Not-Associated"; then
        killall wpa_supplicant 2>/dev/null
        $DIALOG --backtitle "$BACKTITLE" \
            --title "Connection Failed" \
            --yesno "\nFailed to connect to '$WIFI_SSID'.\n\nCheck your password and try again?" 10 50
        
        if [ $? -eq 0 ]; then
            get_wifi_password
            return $?
        fi
        return 1
    fi
    
    # Keep wpa_supplicant running for now
    $DIALOG --backtitle "$BACKTITLE" \
        --msgbox "\nWiFi connected to '$WIFI_SSID'!" 8 45
    
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
run_installation() {
    # Build install command
    INSTALL_CMD="/installer/install.sh"
    INSTALL_CMD="$INSTALL_CMD --disk $TARGET_DISK"
    INSTALL_CMD="$INSTALL_CMD --hostname $HOSTNAME"
    
    # Network interface
    if [ -n "$NET_INTERFACE" ]; then
        INSTALL_CMD="$INSTALL_CMD --interface $NET_INTERFACE"
    fi
    
    # WiFi configuration
    if [ "$NET_TYPE" = "wifi" ] && [ -n "$WIFI_SSID" ]; then
        INSTALL_CMD="$INSTALL_CMD --wifi"
        INSTALL_CMD="$INSTALL_CMD --ssid '$WIFI_SSID'"
        if [ -n "$WIFI_PASSWORD" ]; then
            INSTALL_CMD="$INSTALL_CMD --wifi-password '$WIFI_PASSWORD'"
        fi
    fi
    
    # IP configuration
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
