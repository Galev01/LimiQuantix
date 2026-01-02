# 000036 - Linux Testing Guide

**Document ID:** 000036  
**Category:** Testing / Operations  
**Status:** Active  
**Created:** January 2, 2026  

---

## Overview

This guide explains how to set up a Linux environment for testing LimiQuantix with real KVM/libvirt VMs.

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores with VT-x/AMD-V | 8+ cores |
| RAM | 8 GB | 32+ GB |
| Storage | 50 GB SSD | 200+ GB NVMe |
| Network | 1 GbE | 10 GbE |

### Check Hardware Virtualization

```bash
# Check for VT-x (Intel) or AMD-V (AMD)
egrep -c '(vmx|svm)' /proc/cpuinfo
# Should return > 0

# Check KVM device
ls -la /dev/kvm
# Should exist and be accessible

# If /dev/kvm doesn't exist, load the module
sudo modprobe kvm
sudo modprobe kvm_intel  # or kvm_amd
```

---

## Installation

### Ubuntu 22.04 / 24.04

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install KVM, libvirt, and tools
sudo apt install -y \
  qemu-kvm \
  libvirt-daemon-system \
  libvirt-clients \
  bridge-utils \
  virtinst \
  virt-manager \
  qemu-utils \
  libvirt-dev \
  pkg-config

# Add user to libvirt and kvm groups
sudo usermod -aG libvirt $USER
sudo usermod -aG kvm $USER

# Apply group changes (or log out and back in)
newgrp libvirt

# Verify installation
virsh list --all
# Should show empty list or existing VMs
```

### Fedora / RHEL / Rocky Linux

```bash
# Install virtualization group
sudo dnf install -y @virtualization

# Install development headers
sudo dnf install -y libvirt-devel qemu-img

# Start and enable libvirt
sudo systemctl enable --now libvirtd

# Add user to groups
sudo usermod -aG libvirt $USER
sudo usermod -aG kvm $USER
```

### Verify libvirt

```bash
# Check libvirt is running
sudo systemctl status libvirtd

# Test connection
virsh -c qemu:///system list

# Check default network
virsh net-list --all
# Should show 'default' network

# If default network is inactive, start it
virsh net-start default
virsh net-autostart default
```

---

## Rust Toolchain

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Verify
rustc --version
cargo --version
```

---

## Build Node Daemon with Libvirt

### Clone and Build

```bash
# Clone repository
git clone https://github.com/your-org/LimiQuantix.git
cd LimiQuantix/agent

# Build with libvirt feature
cargo build --release --bin limiquantix-node --features libvirt

# The binary is at:
# ./target/release/limiquantix-node
```

### Common Build Errors

#### 1. libvirt headers not found

```
error: could not find libvirt
```

**Fix:**
```bash
# Ubuntu/Debian
sudo apt install libvirt-dev pkg-config

# Fedora/RHEL
sudo dnf install libvirt-devel
```

#### 2. pkg-config not found

```
error: could not run `pkg-config`
```

**Fix:**
```bash
sudo apt install pkg-config  # or dnf
```

---

## Configuration

### Create Config File

```bash
sudo mkdir -p /etc/limiquantix
sudo tee /etc/limiquantix/node-daemon.yaml << 'EOF'
# LimiQuantix Node Daemon Configuration

node:
  # Node identity (auto-generated if not set)
  # id: "your-node-uuid"
  
  # Labels for scheduling
  labels:
    environment: production
    datacenter: dc1
    rack: rack01

server:
  listen_address: "0.0.0.0:9090"

hypervisor:
  # Hypervisor type: mock, libvirt
  type: libvirt
  
  # Libvirt connection URI
  libvirt_uri: "qemu:///system"

storage:
  # Base path for disk images
  base_path: "/var/lib/limiquantix/images"

control_plane:
  # Control plane address
  address: "http://control-plane.example.com:8080"
  
  # Auto-register on startup
  registration_enabled: true
  
  # Heartbeat interval
  heartbeat_interval_secs: 30
EOF
```

### Create Storage Directory

```bash
sudo mkdir -p /var/lib/limiquantix/images
sudo chown -R $USER:$USER /var/lib/limiquantix
```

---

## Running Node Daemon

### Start with Config File

```bash
./target/release/limiquantix-node --config /etc/limiquantix/node-daemon.yaml
```

### Start with CLI Arguments

```bash
./target/release/limiquantix-node \
  --libvirt-uri qemu:///system \
  --listen 0.0.0.0:9090 \
  --control-plane http://control-plane:8080 \
  --register
```

### Run as Systemd Service

```bash
sudo tee /etc/systemd/system/limiquantix-node.service << 'EOF'
[Unit]
Description=LimiQuantix Node Daemon
After=network.target libvirtd.service
Wants=libvirtd.service

[Service]
Type=simple
User=root
Group=root
ExecStart=/usr/local/bin/limiquantix-node --config /etc/limiquantix/node-daemon.yaml
Restart=always
RestartSec=5

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=limiquantix-node

# Security
NoNewPrivileges=false
ProtectSystem=false
ProtectHome=false

[Install]
WantedBy=multi-user.target
EOF

# Copy binary
sudo cp target/release/limiquantix-node /usr/local/bin/

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable limiquantix-node
sudo systemctl start limiquantix-node

# Check status
sudo systemctl status limiquantix-node
journalctl -u limiquantix-node -f
```

---

## Testing VM Operations

### 1. Health Check

```bash
# Using grpcurl
grpcurl -plaintext localhost:9090 limiquantix.node.v1.NodeDaemonService/HealthCheck

# Expected output:
# {
#   "healthy": true,
#   "version": "0.1.0",
#   "hypervisor": "libvirt/QEMU",
#   "hypervisorVersion": "8.0.0"
# }
```

### 2. Get Node Info

```bash
grpcurl -plaintext localhost:9090 limiquantix.node.v1.NodeDaemonService/GetNodeInfo
```

### 3. Create a Test VM

First, download a test image:

```bash
# Download Cirros (minimal test image)
wget https://download.cirros-cloud.net/0.6.2/cirros-0.6.2-x86_64-disk.img \
  -O /var/lib/limiquantix/templates/cirros.qcow2

# Or download Ubuntu cloud image
wget https://cloud-images.ubuntu.com/minimal/releases/jammy/release/ubuntu-22.04-minimal-cloudimg-amd64.img \
  -O /var/lib/limiquantix/templates/ubuntu-22.04.qcow2
```

Create VM via API (through Control Plane):

```bash
curl -X POST http://control-plane:8080/limiquantix.compute.v1.VMService/CreateVM \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-vm-linux",
    "spec": {
      "cpu": {"cores": 2},
      "memory": {"sizeMib": 1024},
      "disks": [
        {
          "sizeGib": 10,
          "format": "QCOW2",
          "bus": "VIRTIO"
        }
      ],
      "nics": [
        {
          "bridge": "virbr0",
          "model": "VIRTIO"
        }
      ]
    }
  }'
```

### 4. Verify VM in libvirt

```bash
# List VMs
virsh list --all

# Get VM details
virsh dominfo test-vm-linux

# Get VNC port
virsh vncdisplay test-vm-linux
# Returns :0, :1, etc. (add 5900 for actual port)
```

### 5. Connect to Console

```bash
# Using virt-viewer
virt-viewer -c qemu:///system test-vm-linux

# Using VNC client (get port first)
virsh vncdisplay test-vm-linux
# Connect to localhost:5900 (or 5901, etc.)
```

---

## Troubleshooting

### 1. Permission Denied on /dev/kvm

```
error: Failed to connect socket to '/var/run/libvirt/libvirt-sock': Permission denied
```

**Fix:**
```bash
# Check groups
groups $USER
# Should include 'libvirt' and 'kvm'

# Add to groups
sudo usermod -aG libvirt,kvm $USER

# Apply changes
newgrp libvirt
# or log out and back in
```

### 2. libvirt Connection Failed

```
error: failed to connect to the hypervisor
error: Failed to connect socket to '/var/run/libvirt/libvirt-sock'
```

**Fix:**
```bash
# Start libvirtd
sudo systemctl start libvirtd
sudo systemctl enable libvirtd

# Check socket
ls -la /var/run/libvirt/libvirt-sock
```

### 3. No Network for VMs

```
error: Network 'default' is not active
```

**Fix:**
```bash
# Start default network
sudo virsh net-start default
sudo virsh net-autostart default

# Verify
virsh net-list
```

### 4. Disk Image Creation Failed

```
error: qemu-img: command not found
```

**Fix:**
```bash
# Install qemu-utils
sudo apt install qemu-utils  # or qemu-img on Fedora
```

### 5. UEFI Boot Not Working

```
error: cannot find OVMF firmware
```

**Fix:**
```bash
# Install OVMF
sudo apt install ovmf

# Check OVMF location
ls /usr/share/OVMF/
```

---

## Performance Tuning

### 1. CPU Pinning (for production)

```bash
# Pin VM vCPUs to physical CPUs
virsh vcpupin test-vm 0 2
virsh vcpupin test-vm 1 3
```

### 2. Huge Pages

```bash
# Allocate huge pages (2MB each)
echo 1024 | sudo tee /proc/sys/vm/nr_hugepages

# Make permanent
echo "vm.nr_hugepages=1024" | sudo tee /etc/sysctl.d/hugepages.conf
```

### 3. KSM (Kernel Same-page Merging)

```bash
# Enable KSM for memory deduplication
echo 1 | sudo tee /sys/kernel/mm/ksm/run
```

---

## Multi-Node Setup

For a multi-node cluster:

1. **Network**: Ensure all nodes can reach:
   - Control Plane (port 8080)
   - Each other (for live migration, port 49152-49215)
   - Shared storage (if using Ceph/NFS)

2. **Shared Storage**: For live migration, all nodes need access to the same storage:
   ```bash
   # Example NFS mount
   sudo mount -t nfs storage-server:/vms /var/lib/limiquantix/images
   ```

3. **SSH Keys**: For live migration, nodes need passwordless SSH:
   ```bash
   # On each node, generate and exchange keys
   ssh-keygen -t ed25519
   ssh-copy-id root@other-node
   ```

---

## Verification Checklist

- [ ] `/dev/kvm` exists and is accessible
- [ ] `libvirtd` is running
- [ ] User is in `libvirt` and `kvm` groups
- [ ] `virsh list` works without sudo
- [ ] Default network is active
- [ ] `qemu-img` is installed
- [ ] OVMF is installed (for UEFI)
- [ ] Storage directory exists with correct permissions
- [ ] Node Daemon starts and connects to libvirt
- [ ] Node Daemon registers with Control Plane
- [ ] Heartbeats are being sent
- [ ] Test VM can be created

---

## Next Steps

After successful testing:

1. **Test all VM operations**: start, stop, reboot, delete
2. **Test snapshots**: create, revert, delete
3. **Test hot-plug**: attach/detach disks and NICs
4. **Test console access**: VNC/SPICE connection
5. **Test live migration** (requires 2+ nodes with shared storage)

