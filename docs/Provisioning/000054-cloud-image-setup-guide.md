# Cloud Image Setup Guide

**Document ID:** 000054  
**Date:** January 4, 2026  
**Status:** Active  
**Purpose:** Step-by-step guide for setting up cloud images on LimiQuantix hypervisors

---

## Overview

Cloud images are pre-built operating system images that support **cloud-init** for automated provisioning. Unlike ISO installations, cloud images boot in seconds and automatically configure themselves based on your specified user-data.

### Why Use Cloud Images?

| Feature | Cloud Image | ISO Install |
|---------|-------------|-------------|
| Boot time | ~30 seconds | 15-30 minutes |
| Automation | Full (cloud-init) | Manual |
| Reproducibility | 100% | Depends on installer |
| Disk usage | Copy-on-write overlay | Full copy |
| Windows support | ❌ | ✅ |

---

## Quick Start

### 1. SSH into Your Hypervisor

```bash
ssh root@<hypervisor-ip>
```

### 2. Download the Setup Script

```bash
# Download the setup script
curl -fsSL https://raw.githubusercontent.com/limiquantix/limiquantix/main/scripts/setup-cloud-images.sh \
  -o /usr/local/bin/setup-cloud-images
chmod +x /usr/local/bin/setup-cloud-images

# Or copy from local installation
cp /opt/limiquantix/scripts/setup-cloud-images.sh /usr/local/bin/setup-cloud-images
```

### 3. Download Cloud Images

```bash
# List available images
setup-cloud-images --list

# Download Ubuntu 22.04 (recommended)
setup-cloud-images ubuntu-22.04

# Download multiple images
setup-cloud-images ubuntu-22.04 debian-12 almalinux-9

# Download all standard images
setup-cloud-images --all
```

### 4. Create a VM in the UI

1. Go to **Virtual Machines** → **Create VM**
2. In **Boot Media** step, select **Cloud Image**
3. Choose your downloaded image (e.g., Ubuntu 22.04)
4. Configure **Cloud-Init**:
   - Set username and password
   - Add your SSH public key
5. Review and create

### 5. Start and Connect

The VM will:
1. Boot from the cloud image (~30 seconds)
2. Run cloud-init to configure hostname, users, SSH keys
3. Be ready for SSH access

```bash
# SSH into your new VM
ssh ubuntu@<vm-ip>
```

---

## Manual Setup (Without Script)

If you prefer to download images manually:

### Create Directories

```bash
mkdir -p /var/lib/limiquantix/cloud-images
mkdir -p /var/lib/limiquantix/isos
mkdir -p /var/log/limiquantix
```

### Install Dependencies

```bash
# Ubuntu/Debian
apt update && apt install -y wget qemu-utils genisoimage

# RHEL/AlmaLinux/Rocky
dnf install -y wget qemu-img genisoimage
```

### Download Cloud Images

```bash
cd /var/lib/limiquantix/cloud-images

# Ubuntu 22.04 LTS (Jammy)
wget -O ubuntu-22.04.qcow2 \
  https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img

# Ubuntu 24.04 LTS (Noble)
wget -O ubuntu-24.04.qcow2 \
  https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

# Debian 12 (Bookworm)
wget -O debian-12.qcow2 \
  https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2

# AlmaLinux 9
wget -O almalinux-9.qcow2 \
  https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2

# Rocky Linux 9
wget -O rocky-9.qcow2 \
  https://download.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2
```

### Verify Images

```bash
# Check image integrity
qemu-img check ubuntu-22.04.qcow2

# View image info
qemu-img info ubuntu-22.04.qcow2
```

---

## How Cloud Images Work

### Copy-on-Write (CoW) Overlays

When you create a VM with a cloud image, LimiQuantix creates a **copy-on-write overlay**:

```
┌─────────────────────────────────────────────────┐
│              VM Disk (overlay)                   │
│  /var/lib/limiquantix/vms/<vm-id>/boot.qcow2   │
│                                                  │
│  Only stores changes (new files, modifications) │
│  Typically starts at ~1MB, grows as needed      │
└──────────────────────┬──────────────────────────┘
                       │ reads unchanged blocks
                       ▼
┌─────────────────────────────────────────────────┐
│           Base Cloud Image (read-only)           │
│  /var/lib/limiquantix/cloud-images/ubuntu.qcow2 │
│                                                  │
│  Shared by all VMs using this image             │
│  Never modified directly                         │
└─────────────────────────────────────────────────┘
```

**Benefits:**
- Fast VM creation (no full copy)
- Storage efficient (VMs share base image)
- Instant cloning capability

### Cloud-Init Boot Process

```
1. VM boots from overlay disk
              │
              ▼
2. Kernel starts, looks for cloud-init datasource
              │
              ▼
3. Finds NoCloud datasource (cidata ISO)
              │
              ▼
4. Reads configuration:
   - meta-data (instance-id, hostname)
   - user-data (users, packages, scripts)
   - network-config (optional)
              │
              ▼
5. Applies configuration:
   - Sets hostname
   - Creates users
   - Installs SSH keys
   - Runs packages & scripts
              │
              ▼
6. VM ready for use!
```

---

## Cloud-Init Configuration

### Basic User Setup

```yaml
#cloud-config
hostname: my-server
fqdn: my-server.local
manage_etc_hosts: true

users:
  - name: admin
    groups: sudo
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    ssh_authorized_keys:
      - ssh-rsa AAAAB3NzaC1yc2E... user@laptop

# Enable password authentication for SSH
ssh_pwauth: true

# Set password (use single quotes to avoid YAML issues)
chpasswd:
  expire: false
  list:
    - admin:MySecurePassword123

# Install packages
package_update: true
packages:
  - qemu-guest-agent
  - vim
  - htop

# Run commands after boot
runcmd:
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
```

### Static IP Configuration

```yaml
#cloud-config
hostname: db-server

# Network configuration (Netplan v2)
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.0.1.10/24
      routes:
        - to: default
          via: 10.0.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
```

### Install Docker

```yaml
#cloud-config
package_update: true

packages:
  - docker.io
  - docker-compose

groups:
  - docker

users:
  - name: deploy
    groups: [docker, sudo]
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-rsa AAAAB3...

runcmd:
  - systemctl enable docker
  - systemctl start docker
```

### Install Quantix Agent

```yaml
#cloud-config
packages:
  - qemu-guest-agent
  - curl

write_files:
  - path: /etc/limiquantix/pre-freeze.d/.keep
    content: ""
  - path: /etc/limiquantix/post-thaw.d/.keep
    content: ""

runcmd:
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
  - curl -fsSL http://control-plane:8080/api/agent/install.sh | bash
```

---

## Available Cloud Images

### Official Sources

| Distribution | Default User | URL |
|-------------|--------------|-----|
| **Ubuntu 22.04 LTS** | `ubuntu` | https://cloud-images.ubuntu.com/jammy/current/ |
| **Ubuntu 24.04 LTS** | `ubuntu` | https://cloud-images.ubuntu.com/noble/current/ |
| **Debian 12** | `debian` | https://cloud.debian.org/images/cloud/bookworm/ |
| **AlmaLinux 9** | `almalinux` | https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/ |
| **Rocky Linux 9** | `rocky` | https://download.rockylinux.org/pub/rocky/9/images/x86_64/ |
| **Fedora 39** | `fedora` | https://download.fedoraproject.org/pub/fedora/linux/releases/39/Cloud/ |
| **CentOS Stream 9** | `cloud-user` | https://cloud.centos.org/centos/9-stream/x86_64/images/ |
| **openSUSE 15.5** | `root` | https://download.opensuse.org/distribution/leap/15.5/appliances/ |

### Disk Space Requirements

| Image | Download Size | Virtual Size |
|-------|--------------|--------------|
| Ubuntu 22.04 | ~650 MB | 2.2 GB |
| Ubuntu 24.04 | ~700 MB | 2.5 GB |
| Debian 12 | ~350 MB | 2 GB |
| AlmaLinux 9 | ~550 MB | 10 GB |
| Rocky Linux 9 | ~1.2 GB | 10 GB |

**Note:** VMs use copy-on-write, so actual disk usage is much lower.

---

## Troubleshooting

### VM Won't Boot

**Symptom:** VM shows "No bootable device" or iPXE screen

**Causes & Solutions:**

1. **Cloud image not downloaded**
   ```bash
   ls -la /var/lib/limiquantix/cloud-images/
   # Should show your downloaded images
   ```

2. **Backing file path incorrect**
   ```bash
   # Check VM disk backing file
   qemu-img info /var/lib/limiquantix/vms/<vm-id>/boot.qcow2
   # Should show "backing file:" pointing to your cloud image
   ```

3. **Proto regeneration needed** (see below)

### Cloud-Init Not Running

**Symptom:** VM boots but no users/packages configured

1. **Check cloud-init datasource**
   ```bash
   # Inside VM, check cloud-init status
   cloud-init status
   cloud-init query -a
   ```

2. **Check cloud-init ISO mounted**
   ```bash
   # On hypervisor, check VM XML
   virsh dumpxml <vm-id> | grep -A5 "cidata"
   ```

3. **View cloud-init logs**
   ```bash
   # Inside VM
   cat /var/log/cloud-init.log
   cat /var/log/cloud-init-output.log
   ```

### SSH Connection Refused

1. **Wait for cloud-init to complete** (can take 1-2 minutes)
2. **Check VM IP address**
   ```bash
   virsh domifaddr <vm-id>
   ```
3. **Verify SSH key was added**
   ```bash
   # Inside VM (via console)
   cat /home/ubuntu/.ssh/authorized_keys
   ```

---

## Proto Regeneration (Required for Cloud Images)

If cloud images aren't working, you may need to regenerate the protobuf files.

### On the Hypervisor (Linux)

```bash
# Install protobuf compiler
apt install -y protobuf-compiler

# Install buf
curl -sSL https://github.com/bufbuild/buf/releases/download/v1.28.1/buf-Linux-x86_64 \
  -o /usr/local/bin/buf
chmod +x /usr/local/bin/buf

# Navigate to agent directory
cd /opt/limiquantix/agent/limiquantix-proto

# Regenerate Rust protos
buf generate

# Rebuild Node Daemon
cd /opt/limiquantix/agent
cargo build --release --bin limiquantix-node --features libvirt

# Restart Node Daemon
systemctl restart limiquantix-node
```

### Key Fields Required

The following fields must be in the generated proto:

**DiskSpec:**
- `backing_file` (string, tag 10) - Path to cloud image
- `iops_limit` (uint64, tag 8)
- `throughput_mbps` (uint64, tag 9)

**VMSpec:**
- `cloud_init` (CloudInitConfig, tag 12)

**CloudInitConfig:**
- `user_data` (string, tag 1)
- `meta_data` (string, tag 2)
- `network_config` (string, tag 3)
- `vendor_data` (string, tag 4)

---

## Windows VMs

Windows doesn't support cloud-init. Use ISO installation instead:

1. Download Windows ISO and VirtIO drivers:
   ```bash
   setup-cloud-images --iso virtio-win
   ```

2. Create VM with **ISO Image** boot media

3. Install Windows manually

4. Install VirtIO drivers from the mounted ISO

5. For automation, consider **Sysprep** with an answer file

---

## Best Practices

### 1. Use a Dedicated Image Server

For large deployments, host cloud images on a local HTTP server:

```bash
# On a dedicated image server
mkdir -p /srv/cloud-images
cd /srv/cloud-images

# Download images
wget -O ubuntu-22.04.qcow2 https://cloud-images.ubuntu.com/...

# Serve via nginx
apt install nginx
ln -s /srv/cloud-images /var/www/html/cloud-images
```

Then configure hypervisors to pull from `http://image-server/cloud-images/`.

### 2. Keep Images Updated

Cloud images are updated regularly with security patches:

```bash
# Monthly cron job to update images
cat > /etc/cron.monthly/update-cloud-images << 'EOF'
#!/bin/bash
/usr/local/bin/setup-cloud-images --all
EOF
chmod +x /etc/cron.monthly/update-cloud-images
```

### 3. Pre-configure Common Packages

Create a "golden" overlay with your standard packages:

```bash
# Create a customized base
qemu-img create -f qcow2 -b ubuntu-22.04.qcow2 -F qcow2 ubuntu-22.04-custom.qcow2

# Boot it, install packages, then flatten
# (This becomes your new base image)
```

### 4. Use SSH Keys, Not Passwords

For production, always use SSH keys:

```yaml
#cloud-config
users:
  - name: admin
    ssh_authorized_keys:
      - ssh-rsa AAAAB3... admin@company
    lock_passwd: true  # Disable password auth
```

---

## Related Documentation

- [Cloud-Init Provisioning](./000039-cloud-init-provisioning.md) - Technical implementation details
- [VM Creation Wizard](../ui/000015-vm-creation-wizard.md) - UI usage guide
- [Guest Agent Architecture](../Agent/000044-guest-agent-architecture.md) - Quantix Agent integration
- [Node Daemon Implementation](../node-daemon/000031-node-daemon-implementation-plan.md) - Backend details
