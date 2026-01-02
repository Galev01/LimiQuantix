# Node Installation Requirements

> **Document ID:** 000037  
> **Purpose:** List all required packages and dependencies for running the Quantixkvm Node Daemon on a Linux host with KVM/libvirt support.

---

## Overview

This document details all the software packages, libraries, and system requirements needed to run the Quantixkvm Node Daemon on a Linux host. This is the foundation for the automated installer that will be created.

---

## Target Platform

- **Operating System:** Ubuntu 22.04 LTS or Ubuntu 24.04 LTS (recommended)
- **Architecture:** x86_64 with hardware virtualization support (Intel VT-x or AMD-V)
- **Minimum Resources:** 
  - 4 CPU cores
  - 8 GB RAM (more for running VMs)
  - 50 GB free disk space

---

## System Requirements

### 1. Hardware Virtualization

The host must have hardware virtualization enabled in BIOS/UEFI:

```bash
# Verify KVM support
kvm-ok
# Expected output: "KVM acceleration can be used"

# Alternative check
egrep -c '(vmx|svm)' /proc/cpuinfo
# Should return > 0
```

---

## Required Packages

### 2. KVM & Virtualization Stack

| Package | Description | Required |
|---------|-------------|----------|
| `qemu-kvm` | QEMU with KVM acceleration | ✅ Yes |
| `qemu-utils` | QEMU disk image utilities | ✅ Yes |
| `libvirt-daemon-system` | Libvirt virtualization daemon | ✅ Yes |
| `libvirt-clients` | Libvirt CLI tools (virsh) | ✅ Yes |
| `virtinst` | VM installation tools | ✅ Yes |
| `bridge-utils` | Network bridge utilities | ✅ Yes |

```bash
sudo apt install -y qemu-kvm qemu-utils libvirt-daemon-system libvirt-clients virtinst bridge-utils
```

### 3. Development Libraries (for building from source)

| Package | Description | Required |
|---------|-------------|----------|
| `libvirt-dev` | Libvirt development headers | ✅ Yes |
| `pkg-config` | Package configuration tool | ✅ Yes |
| `build-essential` | C/C++ compiler toolchain | ✅ Yes |
| `protobuf-compiler` | Protocol Buffers compiler | ✅ Yes |
| `libprotobuf-dev` | Protocol Buffers development headers | ✅ Yes |

```bash
sudo apt install -y libvirt-dev pkg-config build-essential protobuf-compiler libprotobuf-dev
```

### 4. Rust Toolchain

| Component | Version | Required |
|-----------|---------|----------|
| Rust | 1.75+ | ✅ Yes |
| Cargo | Latest stable | ✅ Yes |

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

### 5. Additional Utilities

| Package | Description | Required |
|---------|-------------|----------|
| `curl` | HTTP client | ✅ Yes |
| `git` | Version control | ✅ Yes |
| `uuid-runtime` | UUID generation tools | Optional |
| `cpu-checker` | CPU virtualization check | Optional |

```bash
sudo apt install -y curl git uuid-runtime cpu-checker
```

---

## User Group Configuration

The user running the Node Daemon must be in the following groups:

```bash
sudo usermod -aG libvirt,kvm $USER
newgrp libvirt
```

Verify group membership:

```bash
groups
# Should include: libvirt kvm
```

---

## Complete Installation Script

Run this one-liner to install everything:

```bash
#!/bin/bash
set -e

echo "=== Quantixkvm Node Daemon Installation ==="

# Update package list
sudo apt update

# Install KVM and virtualization packages
echo "Installing KVM and virtualization packages..."
sudo apt install -y \
  qemu-kvm \
  qemu-utils \
  libvirt-daemon-system \
  libvirt-clients \
  virtinst \
  bridge-utils

# Install development dependencies
echo "Installing development dependencies..."
sudo apt install -y \
  libvirt-dev \
  pkg-config \
  build-essential \
  protobuf-compiler \
  libprotobuf-dev \
  curl \
  git

# Add user to required groups
echo "Adding user to virtualization groups..."
sudo usermod -aG libvirt,kvm $USER

# Install Rust (if not already installed)
if ! command -v rustc &> /dev/null; then
  echo "Installing Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "$HOME/.cargo/env"
fi

# Verify installation
echo ""
echo "=== Verification ==="
echo "KVM support: $(kvm-ok 2>&1 | head -1)"
echo "Libvirt version: $(virsh --version)"
echo "Protoc version: $(protoc --version)"
echo "Rust version: $(rustc --version)"
echo ""
echo "=== Installation Complete ==="
echo "Please log out and log back in for group changes to take effect."
echo "Then run: newgrp libvirt"
```

---

## Package Summary Table

| Category | Package | apt command |
|----------|---------|-------------|
| **KVM** | `qemu-kvm` | `apt install qemu-kvm` |
| **KVM** | `qemu-utils` | `apt install qemu-utils` |
| **Libvirt** | `libvirt-daemon-system` | `apt install libvirt-daemon-system` |
| **Libvirt** | `libvirt-clients` | `apt install libvirt-clients` |
| **Libvirt** | `libvirt-dev` | `apt install libvirt-dev` |
| **VM Tools** | `virtinst` | `apt install virtinst` |
| **Networking** | `bridge-utils` | `apt install bridge-utils` |
| **Build** | `build-essential` | `apt install build-essential` |
| **Build** | `pkg-config` | `apt install pkg-config` |
| **Protobuf** | `protobuf-compiler` | `apt install protobuf-compiler` |
| **Protobuf** | `libprotobuf-dev` | `apt install libprotobuf-dev` |
| **Utilities** | `curl` | `apt install curl` |
| **Utilities** | `git` | `apt install git` |
| **Rust** | Rust toolchain | `rustup` |

---

## Post-Installation Verification

After installation, verify everything works:

```bash
# Check KVM
kvm-ok

# Check libvirt
virsh list --all

# Check protoc
protoc --version

# Check Rust
rustc --version
cargo --version

# Build the Node Daemon
cd ~/Quantixkvm/agent
cargo build --release --bin Quantixkvm-node --features libvirt
```

---

## Network Requirements

The Node Daemon communicates with:

| Component | Port | Protocol | Direction |
|-----------|------|----------|-----------|
| Control Plane | 8080 | HTTP/gRPC | Outbound |
| gRPC Server | 9090 | gRPC | Inbound (from Control Plane) |
| VNC Console | 5900-5999 | VNC | Inbound (for VM consoles) |

Ensure firewall allows these connections:

```bash
# Allow gRPC from Control Plane
sudo ufw allow 9090/tcp

# Allow VNC (optional, for console access)
sudo ufw allow 5900:5999/tcp
```

---

## Troubleshooting

### "Cannot connect to libvirt"

```bash
# Ensure libvirtd is running
sudo systemctl start libvirtd
sudo systemctl enable libvirtd

# Check user groups
groups | grep libvirt
# If not present, re-login or run: newgrp libvirt
```

### "KVM acceleration not available"

```bash
# Check BIOS settings - ensure VT-x/AMD-V is enabled
kvm-ok

# Load KVM module
sudo modprobe kvm-intel  # For Intel
sudo modprobe kvm-amd    # For AMD
```

### "protoc not found" during build

```bash
sudo apt install protobuf-compiler
```

---

## Version Matrix

| Dependency | Minimum Version | Tested Version |
|------------|-----------------|----------------|
| Ubuntu | 22.04 | 24.04 |
| QEMU | 6.0 | 8.x |
| Libvirt | 8.0 | 10.x |
| Rust | 1.75 | 1.83 |
| Protoc | 3.12 | 3.21 |

---

## References

- [Quantixkvm Linux Testing Guide](./000036-linux-testing-guide.md)
- [Node Daemon Implementation Plan](./000031-node-daemon-implementation-plan.md)
- [Hypervisor Integration ADR](./adr/000007-hypervisor-integration.md)
