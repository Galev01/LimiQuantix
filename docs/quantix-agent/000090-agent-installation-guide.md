# Quantix KVM Agent Installation Guide

**Document ID:** 000090  
**Created:** 2026-01-27  
**Status:** Active  
**Component:** `agent/limiquantix-guest-agent`

---

## Overview

The Quantix KVM Agent provides deep integration between guest VMs and the Quantix hypervisor, similar to VMware Tools. This guide covers all installation methods for Linux and Windows guests.

## Installation Methods

| Method | Best For | Prerequisites | Network Required |
|--------|----------|---------------|------------------|
| **ISO Mount** | Air-gapped environments, any Linux | CD-ROM support | No |
| **Cloud-Init** | Automated deployments, templates | Cloud-init enabled image | Yes (first boot) |
| **One-Click** | Quick setup with QEMU GA | QEMU Guest Agent | No |

---

## Method 1: ISO Installation (Recommended)

The ISO installation is the most reliable method, working on any Linux distribution without network access.

### Step 1: Mount the Agent Tools ISO

**From Dashboard:**
1. Navigate to VM Details → Quantix Agent tab
2. Click **"Mount Agent ISO"**
3. The ISO mounts automatically to the VM's CD-ROM

**Manual mounting (if needed):**
```bash
# In the VM, mount the CD-ROM
sudo mount /dev/cdrom /mnt/cdrom
# Or with a specific device
sudo mount /dev/sr0 /mnt/cdrom
```

### Step 2: Run the Universal Installer

```bash
sudo /mnt/cdrom/linux/install.sh
```

The installer:
1. Detects your Linux distribution and architecture
2. Installs QEMU Guest Agent (if not present)
3. Configures QEMU GA for file operations
4. Installs Quantix KVM Agent (DEB/RPM or binary)
5. Fixes SELinux context (RHEL-based systems)
6. Enables and starts both services

### Step 3: Verify Installation

```bash
# Check service status
systemctl status quantix-kvm-agent
systemctl status qemu-guest-agent

# Verify virtio-serial connection
ls -la /dev/virtio-ports/org.limiquantix.agent.0
```

### Installer Options

```bash
# Skip QEMU Guest Agent installation
sudo ./install.sh --skip-qemu-ga

# Install only the binary (no packages)
sudo ./install.sh --binary-only

# Uninstall the agent
sudo ./install.sh --uninstall
```

---

## Method 2: Cloud-Init (Automatic)

For VMs created from cloud images (Ubuntu, Debian, Rocky, CentOS), the agent can be installed automatically during first boot.

### During VM Creation

1. In the VM Creation Wizard, select a cloud image
2. Enable **"Install Quantix Agent"** checkbox
3. Complete the wizard and create the VM
4. The agent installs automatically on first boot

### Manual Cloud-Init Configuration

Add this to your cloud-init user-data:

```yaml
#cloud-config
runcmd:
  - curl -fsSL http://<control-plane>:8080/api/agent/install.sh | bash
```

Or use the pre-built cloud-init snippet:

```yaml
#cloud-config
write_files:
  - path: /opt/quantix-agent-install.sh
    permissions: '0755'
    content: |
      #!/bin/bash
      # Wait for network
      sleep 10
      # Download and install
      curl -fsSL http://<control-plane>:8080/api/agent/install.sh | bash

runcmd:
  - /opt/quantix-agent-install.sh
```

---

## Method 3: One-Click Install (via QEMU Guest Agent)

If the QEMU Guest Agent is already running in the VM with file operations enabled, use One-Click installation.

### Prerequisites

1. QEMU Guest Agent must be installed and running
2. File operations must not be blocked

**Install QEMU Guest Agent:**

```bash
# Debian/Ubuntu
apt install -y qemu-guest-agent
systemctl enable --now qemu-guest-agent

# RHEL/Rocky/CentOS
dnf install -y qemu-guest-agent
systemctl enable --now qemu-guest-agent

# Alpine
apk add qemu-guest-agent
rc-update add qemu-guest-agent default
rc-service qemu-guest-agent start
```

### Enable File Operations (if blocked)

Some distributions block file operations by default. Check:

```bash
cat /etc/sysconfig/qemu-ga
```

If `BLACKLIST_RPC` contains `guest-file-open`, remove it:

```bash
# Edit the file
sudo nano /etc/sysconfig/qemu-ga

# Change:
BLACKLIST_RPC=guest-file-open,guest-file-close,guest-file-read,guest-file-write,...

# To:
BLACKLIST_RPC=...  # Remove the file operations

# Restart QEMU GA
sudo systemctl restart qemu-guest-agent
```

### Install via Dashboard

1. Navigate to VM Details → Quantix Agent tab
2. Expand "One-Click Install" section
3. Click **"Install Quantix Agent"**
4. Wait for installation to complete (~30 seconds)

---

## Supported Distributions

### Fully Supported (Package Manager)

| Distribution | Package Manager | QEMU GA | Agent |
|--------------|-----------------|---------|-------|
| Ubuntu 18.04+ | apt | ✅ | DEB |
| Debian 10+ | apt | ✅ | DEB |
| Rocky Linux 8/9 | dnf | ✅ | RPM |
| AlmaLinux 8/9 | dnf | ✅ | RPM |
| CentOS 7/8/Stream | yum/dnf | ✅ | RPM |
| RHEL 7/8/9 | yum/dnf | ✅ | RPM |
| Fedora 35+ | dnf | ✅ | RPM |
| openSUSE Leap 15+ | zypper | ✅ | RPM |
| Arch Linux | pacman | ✅ | Binary |
| Alpine Linux 3.14+ | apk | ✅ | Binary |

### Binary Installation (Any Linux)

The static binary works on any Linux distribution:
- Void Linux
- Gentoo
- NixOS
- Any container/minimal environment

---

## Troubleshooting

### Agent Not Connecting

**1. Check if services are running:**
```bash
systemctl status quantix-kvm-agent
systemctl status qemu-guest-agent
```

**2. Check for SELinux issues (RHEL-based):**
```bash
# View SELinux context
ls -laZ /usr/local/bin/quantix-kvm-agent

# Fix context
sudo chcon -t bin_t /usr/local/bin/quantix-kvm-agent
sudo restorecon -v /usr/local/bin/quantix-kvm-agent
```

**3. Verify virtio-serial device exists:**
```bash
ls -la /dev/virtio-ports/
# Should show: org.limiquantix.agent.0
```

**4. Check agent logs:**
```bash
journalctl -u quantix-kvm-agent -n 100 --no-pager

# Or log file directly
tail -100 /var/log/quantix-kvm/agent.log
```

### No virtio-serial Device

The VM configuration must include a virtio-serial channel. This is added automatically when:
- Creating VMs through Quantix Dashboard
- Using Quantix cloud-init templates

For manual libvirt configuration, add:

```xml
<devices>
  <channel type='unix'>
    <target type='virtio' name='org.limiquantix.agent.0'/>
  </channel>
</devices>
```

### Binary "Permission Denied" on RHEL

This is an SELinux issue. The binary has the wrong context:

```bash
# Check context
ls -laZ /usr/local/bin/quantix-kvm-agent
# Shows: user_tmp_t (wrong)

# Fix it
sudo chcon -t bin_t /usr/local/bin/quantix-kvm-agent
sudo restorecon -v /usr/local/bin/quantix-kvm-agent

# Verify
ls -laZ /usr/local/bin/quantix-kvm-agent
# Should show: bin_t (correct)
```

### Binary "No such file or directory"

This happens with dynamically linked binaries. The ISO includes a **truly static binary** that doesn't require any libraries:

```bash
# Verify binary is static
file /usr/local/bin/quantix-kvm-agent
# Should show: "statically linked" (not "dynamically linked" or "static-pie")

ldd /usr/local/bin/quantix-kvm-agent
# Should show: "not a dynamic executable"
```

If the binary isn't static, download the correct one:
```bash
curl -fsSL http://<host>:8443/api/v1/agent/linux/binary/amd64 -o /tmp/quantix-kvm-agent
file /tmp/quantix-kvm-agent
```

---

## Uninstallation

### Using the Installer

```bash
sudo /mnt/cdrom/linux/install.sh --uninstall
```

### Manual Uninstallation

```bash
# Stop and disable service
sudo systemctl stop quantix-kvm-agent
sudo systemctl disable quantix-kvm-agent

# Remove service file
sudo rm /etc/systemd/system/quantix-kvm-agent.service
sudo systemctl daemon-reload

# Remove binary
sudo rm /usr/local/bin/quantix-kvm-agent

# Optionally remove config and logs
sudo rm -rf /etc/quantix-kvm
sudo rm -rf /var/log/quantix-kvm
```

---

## Building the ISO

To build the Agent Tools ISO:

```bash
# From project root
./scripts/build-agent-iso.sh --version 0.1.0

# Output: dist/quantix-kvm-agent-tools-0.1.0.iso
```

### ISO Contents

```
quantix-kvm-agent-tools.iso
├── linux/
│   ├── install.sh                    # Universal installer
│   ├── quantix-kvm-agent-amd64       # Static binary (x86_64)
│   ├── quantix-kvm-agent-arm64       # Static binary (ARM64)
│   ├── quantix-kvm-agent_0.1.0_amd64.deb
│   ├── quantix-kvm-agent_0.1.0_arm64.deb
│   ├── quantix-kvm-agent-0.1.0.x86_64.rpm
│   └── quantix-kvm-agent-0.1.0.aarch64.rpm
├── windows/
│   └── README.txt                    # Windows coming soon
├── README.txt                        # Installation guide
└── VERSION                           # ISO version
```

---

## Agent Features

Once installed, the Quantix KVM Agent provides:

| Feature | Description |
|---------|-------------|
| **Telemetry** | CPU, memory, disk, network metrics |
| **IP Reporting** | Guest IP addresses visible in Dashboard |
| **Command Execution** | Run scripts remotely |
| **File Operations** | Browse and transfer files |
| **Graceful Shutdown** | Clean OS shutdown from Dashboard |
| **Snapshot Quiescing** | Freeze filesystems for consistent snapshots |
| **Display Resize** | Dynamic resolution for desktop VMs |
| **Clipboard** | Host-guest clipboard sharing |
| **Process/Service Management** | View and control guest processes |
| **Hardware Inventory** | Detailed hardware information |
| **Self-Update** | OTA updates from Dashboard |

---

## Security Considerations

- **Air-gapped Installation**: ISO method requires no network access
- **SELinux Compatibility**: Automatic context fixing for RHEL-based systems
- **No Outbound Connections**: Agent only communicates via virtio-serial
- **QEMU GA Configuration**: Installer configures file ops for future updates

---

## Related Documents

- [000089 - Guest Agent Installation Fixes](./000089-guest-agent-installation-fixes-jan-2026.md)
- [000087 - Guest Agent Implementation](./Agent/000087-guest-agent-phase6-10-implementation.md)
- [000044 - Guest Agent Architecture](./Agent/000044-guest-agent-architecture.md)
