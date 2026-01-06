# 000060 - Quantix-OS Network and GUI Setup

**Document Type:** Implementation Guide  
**Created:** 2026-01-07  
**Status:** Active

## Overview

This document describes the automatic network configuration and graphical console (GUI) setup for Quantix-OS.

## Network Auto-Configuration

### How It Works

Quantix-OS automatically configures network interfaces at boot via the `quantix-network` service:

1. **Boot Process**: The `quantix-network` service starts early in the boot sequence
2. **Interface Detection**: Scans `/sys/class/net/` for physical interfaces
3. **DHCP**: Runs `udhcpc` on each detected interface (Ethernet and WiFi)
4. **WiFi**: If `wpa_supplicant.conf` exists, starts WiFi authentication first

### Supported Interfaces

- **Ethernet**: All physical NICs are auto-configured via DHCP
- **WiFi**: Requires manual configuration (see below)
- **Virtual**: Bridges, bonds, and virtual interfaces are skipped

### Manual Network Configuration

#### Check Current Status

```bash
# View all interfaces
ip addr show

# Check service status
rc-service quantix-network status

# View DHCP logs
cat /var/log/messages | grep udhcpc
```

#### Restart Network

```bash
rc-service quantix-network restart
```

#### Static IP Configuration

Edit `/etc/network/interfaces`:

```bash
auto eth0
iface eth0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
```

Then restart:

```bash
rc-service quantix-network restart
```

### WiFi Configuration

1. **Copy the example configuration:**

```bash
cp /etc/wpa_supplicant/wpa_supplicant.conf.example \
   /etc/wpa_supplicant/wpa_supplicant.conf
```

2. **Edit the configuration:**

```bash
vi /etc/wpa_supplicant/wpa_supplicant.conf
```

Add your network:

```
network={
    ssid="YourNetworkName"
    psk="YourPassword"
    key_mgmt=WPA-PSK
}
```

3. **Restart network:**

```bash
rc-service quantix-network restart
```

4. **Verify connection:**

```bash
ip addr show wlan0
ping -c 3 8.8.8.8
```

### Troubleshooting Network Issues

| Issue | Solution |
|-------|----------|
| No IP address | `udhcpc -i eth0` manually |
| Interface down | `ip link set eth0 up` |
| WiFi not connecting | Check `/var/log/messages` for wpa_supplicant errors |
| DNS not working | Check `/etc/resolv.conf` |

## Graphical Console (Slint GUI)

### Overview

Quantix-OS includes a graphical management console built with [Slint](https://slint.dev/). It provides:

- First-boot setup wizard
- System status dashboard
- Network configuration
- SSH management
- Cluster join interface

### Display Modes

The console launcher (`qx-console-launcher`) automatically selects the best mode:

| Environment | Mode | Backend |
|-------------|------|---------|
| Physical console with GPU | GUI | Slint + LinuxKMS |
| Serial console | TUI | Ratatui |
| SSH session | TUI | Ratatui |
| No graphics | TUI | Ratatui |

### Manual Mode Selection

```bash
# Force GUI mode
qx-console-launcher --gui

# Force TUI mode
qx-console-launcher --tui
```

### Requirements for GUI Mode

1. **Framebuffer or DRM device**: `/dev/fb0` or `/dev/dri/card*`
2. **Seat daemon**: `seatd` must be running
3. **Runtime directory**: `/run/user/0` must exist

### Starting the Console Manually

```bash
# Start console service
rc-service quantix-console start

# Or run directly
export XDG_RUNTIME_DIR=/run/user/0
export SLINT_BACKEND=linuxkms
/usr/bin/qx-console-gui
```

### Troubleshooting GUI Issues

| Issue | Solution |
|-------|----------|
| Black screen | Add `nomodeset` to kernel command line |
| "No DRM device" | Check `/dev/dri/` exists, load GPU drivers |
| Permission denied | Ensure `seatd` is running |
| Crashes immediately | Check `/var/log/quantix-console.log` |

### Kernel Parameters for Graphics

Add to GRUB command line if needed:

```
# For problematic GPUs
nomodeset video=efifb

# For specific resolution
video=1920x1080

# For Intel graphics issues
i915.modeset=1
```

## Service Management

### Quantix Services

| Service | Purpose | Default |
|---------|---------|---------|
| `quantix-network` | Auto-configure network | boot |
| `quantix-node` | Node daemon (API server) | default |
| `quantix-console` | Management console | default |

### Commands

```bash
# List all services
rc-status

# Start/stop/restart a service
rc-service quantix-node start
rc-service quantix-node stop
rc-service quantix-node restart

# Enable/disable at boot
rc-update add quantix-node default
rc-update del quantix-node default
```

## Files Reference

| Path | Purpose |
|------|---------|
| `/etc/init.d/quantix-network` | Network service script |
| `/etc/init.d/quantix-node` | Node daemon service |
| `/etc/init.d/quantix-console` | Console service |
| `/etc/wpa_supplicant/wpa_supplicant.conf` | WiFi configuration |
| `/usr/bin/qx-node` | Node daemon binary |
| `/usr/bin/qx-console-gui` | Slint GUI binary |
| `/usr/local/bin/qx-console` | TUI binary |
| `/usr/local/bin/qx-console-launcher` | Console mode selector |
| `/var/log/quantix-node.log` | Node daemon logs |
| `/var/log/quantix-console.log` | Console logs |

## Building with Network and GUI Support

To rebuild the ISO with these features:

```bash
cd Quantix-OS
./build.sh --clean
```

The build will:
1. Install WiFi packages (`wpa_supplicant`, `wireless-tools`, etc.)
2. Build the Slint GUI with LinuxKMS backend
3. Configure services to start at boot
4. Include the network auto-configuration service
