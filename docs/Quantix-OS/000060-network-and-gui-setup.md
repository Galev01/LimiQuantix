# 000060 - Quantix-OS Network and TUI Console Setup

**Document Type:** Implementation Guide  
**Created:** 2026-01-07  
**Last Updated:** 2026-01-07  
**Status:** Active

## Overview

This document describes the automatic network configuration and TUI console setup for Quantix-OS.

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

## TUI Console (DCUI)

### Overview

Quantix-OS uses a **TUI (Text User Interface)** for local console management, built with [Ratatui](https://ratatui.rs/). It provides:

- System status dashboard
- Network configuration
- SSH management with security timer
- Cluster join interface
- Service management
- Power operations

### Why TUI Over GUI?

| Feature | TUI (Ratatui) | GUI (Slint/Wayland) |
|---------|---------------|---------------------|
| RAM Usage | ~5 MB | ~50-500 MB |
| Works Everywhere | ✅ All hardware | ⚠️ Requires GPU |
| Boot Time | Milliseconds | Seconds |
| Dependencies | Single binary | GPU drivers, Mesa |
| Reliability | Very high | GPU driver dependent |

### Console Features

```
╔═══════════════════════════════════════════════════════════════╗
║                     QUANTIX-OS v1.0.0                         ║
║                   The VMware Killer                           ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   Node:     quantix-01.local                                  ║
║   Status:   Cluster Member                                    ║
║   IP:       192.168.1.100                                     ║
║                                                               ║
║   CPU:      [████████░░░░░░░░] 48%                           ║
║   Memory:   [██████████░░░░░░] 64% (32GB / 50GB)            ║
║   VMs:      12 running                                        ║
║   Uptime:   5 days, 3 hours                                   ║
║                                                               ║
║   Management URL: https://192.168.1.100:8443                  ║
║                                                               ║
╠═══════════════════════════════════════════════════════════════╣
║  [F2] Configure Network    [F5] Refresh Display               ║
║  [F3] Configure SSH        [F6] Restart Services              ║
║  [F4] Join Cluster         [F10] Shutdown/Reboot              ║
╚═══════════════════════════════════════════════════════════════╝
```

### Menu Functions

| Key | Function | Description |
|-----|----------|-------------|
| F2 | Configure Network | DHCP/Static IP, DNS, Gateway |
| F3 | Configure SSH | Enable/disable with security timer |
| F4 | Join Cluster | Enter control plane URL + token |
| F5 | Refresh Display | Update system status |
| F6 | Restart Services | Node daemon, libvirt, OVS |
| F7 | View Diagnostics | System logs, hardware info |
| F10 | Power Menu | Reboot/Shutdown |
| F12 | Emergency Shell | Break-glass access (logged) |

### SSH Security Timer

The TUI includes a security feature for SSH access:

- **Timed Access**: Enable SSH for 5-120 minutes
- **Auto-Disable**: SSH automatically disables when timer expires
- **Permanent Mode**: Optional for trusted environments
- **Audit Logging**: All enable/disable actions are logged

Access via F3:

```
╔═══════════════════════════════════════════════════════════════╗
║                     SSH Configuration                          ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   Status: ● SSH ENABLED                                       ║
║   Auto-disable in: 14:32                                      ║
║                                                               ║
║   Timer: ◀ 15 minutes ▶                                       ║
║                                                               ║
║   [E] Enable SSH (with timer)                                 ║
║   [D] Disable SSH                                             ║
║   [P] Toggle Permanent SSH                                    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
```

### Starting the Console Manually

```bash
# Start console service
rc-service quantix-console start

# Or run directly
/usr/local/bin/qx-console
```

### Troubleshooting TUI Issues

| Issue | Solution |
|-------|----------|
| Console not starting | Check `rc-service quantix-console status` |
| Blank screen | Try running `/usr/local/bin/qx-console` directly |
| Keyboard not working | Check terminal is TTY1 |
| Display garbled | Reset terminal with `reset` command |

## Service Management

### Quantix Services

| Service | Purpose | Default |
|---------|---------|---------|
| `quantix-network` | Auto-configure network | boot |
| `quantix-node` | Node daemon (API server) | default |
| `quantix-console` | TUI console | default |

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
| `/usr/local/bin/qx-console` | TUI binary |
| `/usr/local/bin/qx-console-launcher` | Console launcher script |
| `/usr/share/quantix-host-ui/` | React Host UI files |
| `/var/log/quantix-node.log` | Node daemon logs |
| `/var/log/quantix-console.log` | Console logs |

## Web UI Access

The React Host UI is served by the node daemon at port 8443:

- **URL**: `https://<node-ip>:8443`
- **Features**: VM management, storage, performance monitoring
- **API**: REST API at `/api/v1/*`

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/host` | GET | Host information |
| `/api/v1/host/health` | GET | Health check |
| `/api/v1/vms` | GET | List VMs |
| `/api/v1/vms` | POST | Create VM |
| `/api/v1/storage/pools` | GET | List storage pools |
| `/api/v1/cluster/status` | GET | Cluster status |

## Building with Network and TUI Support

To rebuild the ISO with these features:

```bash
cd Quantix-OS
make iso
```

The build will:
1. Install network packages (`wpa_supplicant`, `wireless-tools`, etc.)
2. Build the TUI console with Ratatui
3. Build the Node daemon
4. Build the React Host UI
5. Configure services to start at boot
6. Include the network auto-configuration service

## Related Documents

- [000052 - Quantix-OS Architecture](./000052-quantix-os-architecture.md)
- [000058 - Complete Vision](./000058-quantix-os-complete-vision.md)
- [000059 - Build Guide](./000059-quantix-os-build-guide.md)
- [000061 - Agent Architecture](./000061-agent-architecture.md)
