# Local Network Testing Guide

**Document ID:** 000056  
**Date:** January 9, 2026  
**Category:** Development  

This guide explains how to run the Quantix Node Daemon on an Ubuntu host and connect it to the Control Plane running on Windows over your local network.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Windows Machine (e.g., 192.168.1.100)                          │
│  ├── Docker: PostgreSQL, etcd, Redis                            │
│  ├── Go Backend (0.0.0.0:8080)                                  │
│  └── vDC Frontend (localhost:5173)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Local Network (WiFi/Ethernet)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Ubuntu Host (e.g., 192.168.1.101)                              │
│  ├── libvirt + QEMU/KVM                                         │
│  ├── Rust Node Daemon (0.0.0.0:8443, 0.0.0.0:9443)              │
│  └── Host UI (optional, 0.0.0.0:3001)                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Set Up Ubuntu Host

### 1.1 Install Prerequisites

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install KVM/QEMU and libvirt
sudo apt install -y \
    qemu-kvm \
    libvirt-daemon-system \
    libvirt-clients \
    bridge-utils \
    virtinst \
    virt-manager

# Install development tools
sudo apt install -y \
    build-essential \
    pkg-config \
    libvirt-dev \
    protobuf-compiler \
    git \
    curl

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Add user to libvirt group
sudo usermod -aG libvirt $USER
sudo usermod -aG kvm $USER

# Log out and back in for group changes to take effect
# Or run: newgrp libvirt
```

### 1.2 Verify KVM/libvirt is Working

```bash
# Check KVM support
kvm-ok

# Check libvirt is running
sudo systemctl status libvirtd

# Test virsh
virsh list --all
```

### 1.3 Get Your Ubuntu IP Address

```bash
# Find your IP address on the local network
ip addr show | grep "inet " | grep -v 127.0.0.1

# Or specifically for WiFi (usually wlan0 or wlp*)
ip addr show wlan0 2>/dev/null || ip addr show wlp* 2>/dev/null

# Example output: inet 192.168.1.101/24 ...
# Your IP is: 192.168.1.101
```

---

## Step 2: Clone and Build the Node Daemon

### 2.1 Clone the Repository

```bash
# Clone your repo (adjust URL as needed)
cd ~
git clone <your-repo-url> LimiQuantix
cd LimiQuantix
```

### 2.2 Build the Node Daemon

```bash
cd agent

# Delete any stale generated proto files
rm -rf limiquantix-proto/src/generated/

# Build with libvirt support (release mode for better performance)
cargo build --release -p limiquantix-node --features libvirt

# Verify the binary
./target/release/limiquantix-node --help
```

---

## Step 3: Configure and Run the Node Daemon

### 3.1 Create Configuration Directory

```bash
sudo mkdir -p /etc/limiquantix
sudo mkdir -p /var/lib/libvirt/images/cloud
sudo mkdir -p /var/lib/libvirt/images/iso
```

### 3.2 Run the Node Daemon

```bash
# Run with explicit bind to all interfaces (0.0.0.0)
cd ~/LimiQuantix/agent

# The --http-listen and --grpc-listen flags take address:port format
sudo ./target/release/limiquantix-node \
    --http-listen 0.0.0.0:8443 \
    --grpc-listen 0.0.0.0:9443

# Or run in background with logging
sudo ./target/release/limiquantix-node \
    --http-listen 0.0.0.0:8443 \
    --grpc-listen 0.0.0.0:9443 \
    2>&1 | tee /tmp/node-daemon.log &
```

### 3.3 Verify It's Running

```bash
# Check it's listening on all interfaces
ss -tlnp | grep -E "8443|9443"

# Test the health endpoint locally
curl -k https://localhost:8443/api/v1/health

# Test from another terminal on Ubuntu
curl -k https://$(hostname -I | awk '{print $1}'):8443/api/v1/health
```

---

## Step 4: Configure Firewall (if needed)

```bash
# If UFW is enabled, allow the ports
sudo ufw allow 8443/tcp
sudo ufw allow 9443/tcp

# Or temporarily disable firewall for testing
sudo ufw disable
```

---

## Step 5: Connect from Windows

### 5.1 Find Your Ubuntu IP

On Ubuntu:
```bash
hostname -I | awk '{print $1}'
# Example: 192.168.1.101
```

### 5.2 Test Connection from Windows

Open PowerShell on Windows:
```powershell
# Test if you can reach the Ubuntu host
ping 192.168.1.101

# Test the node daemon (ignore SSL warning for self-signed cert)
curl -k https://192.168.1.101:8443/api/v1/health
```

### 5.3 Connect Host UI to Ubuntu Node

The Host UI now has a built-in connection setup page. No need to edit config files!

1. **Start the Host UI:**
   ```powershell
   cd quantix-host-ui
   npm run dev
   ```

2. **Open http://localhost:3001** in your browser

3. **You'll see the "Connect to Node Daemon" page:**
   - Enter your Ubuntu IP: `https://192.168.1.101:8443`
   - Optionally give it a name (e.g., "Ubuntu Dev Server")
   - Click "Test Connection" to verify
   - Click "Connect" to save and use

4. **Once connected:**
   - A banner shows at the top indicating the remote connection
   - Click "Disconnect" anytime to switch nodes
   - Recent connections are remembered for quick switching

---

## Step 6: Register Node with Control Plane (Optional)

If you want the node to register with the vDC control plane:

```bash
# On Ubuntu, run with control plane URL
sudo ./target/release/limiquantix-node \
    --http-listen 0.0.0.0:8443 \
    --grpc-listen 0.0.0.0:9443 \
    --control-plane http://192.168.1.100:8080 \
    --register
```

Replace `192.168.1.100` with your Windows machine's IP.

---

## Troubleshooting

### Can't connect from Windows

1. **Check firewall on Ubuntu:**
   ```bash
   sudo ufw status
   # If active, allow ports or disable
   ```

2. **Check the daemon is listening on 0.0.0.0:**
   ```bash
   ss -tlnp | grep 8443
   # Should show: 0.0.0.0:8443
   # NOT: 127.0.0.1:8443
   ```

3. **Check both machines are on same network:**
   ```bash
   # On Ubuntu
   ip route | grep default
   
   # On Windows
   ipconfig | findstr "Gateway"
   ```

### libvirt permission denied

```bash
# Make sure you're in the libvirt group
groups | grep libvirt

# If not, add yourself and re-login
sudo usermod -aG libvirt $USER
newgrp libvirt
```

### Proto compilation errors

```bash
# Force regenerate protos
cd ~/LimiQuantix/agent
rm -rf limiquantix-proto/src/generated/
cargo build -p limiquantix-proto
cargo build --release -p limiquantix-node --features libvirt
```

---

## Quick Reference

| Component | Location | Port | URL |
|-----------|----------|------|-----|
| Control Plane (Go) | Windows | 8080 | http://WINDOWS_IP:8080 |
| vDC Frontend | Windows | 5173 | http://localhost:5173 |
| Node Daemon HTTP | Ubuntu | 8443 | https://UBUNTU_IP:8443 |
| Node Daemon gRPC | Ubuntu | 9443 | grpc://UBUNTU_IP:9443 |
| Host UI | Windows | 3001 | http://localhost:3001 |

Replace `WINDOWS_IP` and `UBUNTU_IP` with your actual IP addresses.
