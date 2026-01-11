# Quantix-vDC DCUI (Direct Console User Interface)

**Document ID:** 000005  
**Date:** January 11, 2026  
**Scope:** Quantix-vDC appliance console management interface

---

## Overview

The DCUI is an interactive TUI (Text User Interface) that runs on tty1, providing system management capabilities similar to VMware ESXi's DCUI. It replaces the standard login prompt on the primary console.

## Access

- **Primary Console (tty1):** DCUI runs automatically on boot
- **Login Shell (tty2/tty3):** Press `Ctrl+Alt+F2` or `Ctrl+Alt+F3` for shell access

## Features

### 1. System Information

Displays:
- Hostname
- IP Address
- Web Console URL
- API Endpoint
- SSH Status
- Service Status (with indicators for missing binaries)

### 2. Network Configuration (Ethernet)

- **DHCP Mode:** Automatic IP configuration
- **Static IP Mode:** Manual configuration with:
  - IP Address
  - Subnet Mask (CIDR notation)
  - Gateway
  - DNS Server

### 3. WiFi Configuration

- **Scan Networks:** View available WiFi networks
- **Connect:** Enter SSID and password (WPA/WPA2)
- **Disconnect:** Stop WiFi connection
- **Status:** View current WiFi connection info

Requirements:
- WiFi hardware present
- Drivers loaded (`wpa_supplicant`, `wireless-tools`, `iw` packages)

### 4. SSH Configuration

- **Enable:** Start SSH and add to boot
- **Disable:** Stop SSH and remove from boot
- **Start/Stop:** Control SSH service without persistence

### 5. Service Management

Manage individual services:
- Control Plane (`quantix-controlplane`)
- PostgreSQL
- Redis
- nginx
- SSH

Actions:
- Start
- Stop
- Restart
- Restart All Services

### 6. Change Root Password

Securely change the root password with confirmation.

### 7. Troubleshooting

- **View Logs:** Display control plane logs
- **Test Network:** Ping test to external server
- **Restart Networking:** Restart network stack
- **Drop to Shell:** Exit to command line (type `exit` to return)

### 8. Power Options

- Reboot System
- Shutdown System

## Configuration

### inittab Entry

The DCUI is launched by init on tty1:

```
# /etc/inittab
tty1::respawn:/usr/bin/qx-dcui
```

### Required Packages

```
dialog
ncurses
ncurses-terminfo-base
wpa_supplicant (for WiFi)
wireless-tools (for WiFi)
iw (for WiFi)
```

## Files

| File                                      | Purpose               |
| ----------------------------------------- | --------------------- |
| `/usr/bin/qx-dcui`                        | Main DCUI script      |
| `/etc/inittab`                            | Launch DCUI on tty1   |
| `/etc/quantix-version`                    | Version display       |
| `/etc/network/interfaces`                 | Network configuration |
| `/etc/wpa_supplicant/wpa_supplicant.conf` | WiFi credentials      |

## Keyboard Navigation

| Key           | Action                     |
| ------------- | -------------------------- |
| Arrow Up/Down | Navigate menu              |
| Enter         | Select option              |
| Tab           | Switch buttons (OK/Cancel) |
| Escape        | Cancel/Back                |

## Services Not Starting

If services show as "Stopped":

### PostgreSQL

- First boot initialization may be required
- Check `/var/lib/postgresql/16/data` exists
- Run: `rc-service postgresql start`

### Control Plane

- Binary must be built: `make backend`
- Check if `/usr/bin/qx-controlplane` exists
- System Information shows "(binary not installed)" if missing

### nginx

- Depends on control plane configuration
- May fail if TLS certificates not generated

## Troubleshooting

### DCUI Not Showing

1. Check inittab: `cat /etc/inittab`
2. Verify script exists: `ls -la /usr/bin/qx-dcui`
3. Check dialog is installed: `which dialog`
4. Switch to tty1: `Ctrl+Alt+F1`

### Network Not Working

1. Check interface exists: `ip link show`
2. View logs: `cat /var/log/messages | grep -i network`
3. Try manual DHCP: `udhcpc -i eth0`

### WiFi Not Available

1. Check for wireless interface: `ip link | grep wlan`
2. Load drivers: `modprobe iwlwifi` (Intel) or appropriate driver
3. Check lspci: `lspci | grep -i wireless`

## Development

### Testing DCUI Locally

```bash
# In chroot or live system
export TERM=linux
/usr/bin/qx-dcui
```

### Exit to Shell

- Select "Exit to Login Prompt" from main menu
- Or use Ctrl+Alt+F2 for a separate terminal
