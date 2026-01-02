# Cloud-Init Provisioning & ISO Mounting

**Document ID:** 000039  
**Date:** January 2, 2026  
**Status:** Implementation Complete  
**Purpose:** Document cloud-init provisioning and ISO mounting capabilities

---

## Overview

LimiQuantix supports two methods for provisioning VMs:

1. **Cloud-Init** (Recommended) - Automated provisioning using cloud images
2. **ISO Mounting** - Manual OS installation from ISO files

## Cloud-Init Provisioning

### What is Cloud-Init?

Cloud-init is the industry standard for automating the initial setup of cloud instances. It runs on first boot and configures:

- Hostname and networking
- User accounts and SSH keys
- Package installation
- Custom scripts
- Disk partitioning

### Supported Datasources

LimiQuantix implements the **NoCloud** datasource, which uses a small ISO containing:

- `meta-data` - Instance identification (instance-id, hostname)
- `user-data` - Cloud-config YAML or shell script
- `network-config` (optional) - Netplan v2 network configuration
- `vendor-data` (optional) - Provider-specific configuration

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         VM Creation Request                  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │ CloudImage  │  │  cloud-init  │  │   VmSpec           │ │
│  │ backing_file│  │  user_data   │  │   (CPU, RAM, etc.) │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────────────┘ │
└─────────┼────────────────┼───────────────────────────────────┘
          │                │
          ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                      Node Daemon                             │
│                                                              │
│  1. Create overlay disk from cloud image (qemu-img)         │
│  2. Generate cloud-init ISO (genisoimage)                   │
│  3. Define VM in libvirt with disk + ISO attached           │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                         libvirt/KVM                          │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                    Virtual Machine                     │ │
│  │  ┌──────────────┐  ┌──────────────────────────────┐  │ │
│  │  │ vda (Boot)   │  │ sdb (cloud-init ISO)          │  │ │
│  │  │ Overlay on   │  │ cidata volume                 │  │ │
│  │  │ cloud image  │  │ - meta-data                   │  │ │
│  │  └──────────────┘  │ - user-data                   │  │ │
│  │                    │ - network-config              │  │ │
│  │                    └──────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Usage Example

#### 1. Download a Cloud Image

```bash
# Ubuntu 22.04 Cloud Image
wget https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img

# Move to images directory
sudo mv jammy-server-cloudimg-amd64.img /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2
```

#### 2. Create VM via API

```json
{
  "name": "web-server-01",
  "spec": {
    "cpu_cores": 4,
    "memory_mib": 4096,
    "disks": [{
      "id": "boot-disk",
      "size_gib": 50,
      "bootable": true,
      "backing_file": "/var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2"
    }],
    "cloud_init": {
      "user_data": "#cloud-config\nhostname: web-server-01\nusers:\n  - name: admin\n    sudo: ALL=(ALL) NOPASSWD:ALL\n    ssh_authorized_keys:\n      - ssh-rsa AAAAB3...",
      "meta_data": "instance-id: web-server-01\nlocal-hostname: web-server-01"
    }
  }
}
```

#### 3. User-Data Examples

**Basic User Setup:**

```yaml
#cloud-config
hostname: my-server
fqdn: my-server.local

users:
  - name: admin
    groups: sudo
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-rsa AAAAB3NzaC1yc2E...

packages:
  - nginx
  - docker.io
  - qemu-guest-agent

runcmd:
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
  - systemctl enable nginx
```

**Static IP Configuration:**

```yaml
#cloud-config
hostname: db-server

# Disable cloud-init network after first boot
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.0.0.10/24
      gateway4: 10.0.0.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
```

**Install Docker:**

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
    groups: docker, sudo
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-rsa AAAAB3...

runcmd:
  - systemctl enable docker
  - docker run -d -p 80:80 nginx
```

### Proto Definition

**Node Daemon Proto (`node_daemon.proto`):**

```protobuf
message VMSpec {
  // ... other fields ...
  
  // Cloud-init / provisioning configuration
  CloudInitConfig cloud_init = 12;
}

message CloudInitConfig {
  // User-data (YAML format, typically #cloud-config)
  string user_data = 1;
  
  // Meta-data (JSON format)
  string meta_data = 2;
  
  // Network configuration (Netplan v2 format, optional)
  string network_config = 3;
  
  // Vendor-data (optional)
  string vendor_data = 4;
}

message DiskSpec {
  // ... other fields ...
  
  // Path to backing image (for cloud images)
  string backing_file = 10;
}
```

---

## ISO Mounting (For Manual Installs)

### When to Use

- Windows VM installations (no cloud-init support)
- Custom Linux distributions
- Installing from vendor ISOs

### Implementation

ISOs can be mounted via the `cdroms` field in VmSpec:

```json
{
  "name": "windows-server",
  "spec": {
    "cpu_cores": 4,
    "memory_mib": 8192,
    "disks": [{
      "id": "boot-disk",
      "size_gib": 100,
      "bootable": true
    }],
    "cdroms": [{
      "id": "os-iso",
      "iso_path": "/var/lib/limiquantix/isos/windows-server-2022.iso",
      "bootable": true
    }, {
      "id": "virtio-drivers",
      "iso_path": "/var/lib/limiquantix/isos/virtio-win.iso",
      "bootable": false
    }],
    "firmware": "FIRMWARE_UEFI",
    "boot_order": ["BOOT_DEVICE_CDROM", "BOOT_DEVICE_DISK"]
  }
}
```

### Setting Up ISO Storage

```bash
# Create ISO storage directory
sudo mkdir -p /var/lib/limiquantix/isos

# Download Windows VirtIO drivers
wget https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso \
  -O /var/lib/limiquantix/isos/virtio-win.iso

# Copy your Windows ISO
cp /path/to/windows-server-2022.iso /var/lib/limiquantix/isos/
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `agent/limiquantix-hypervisor/src/cloudinit.rs` | Cloud-init ISO generation |
| `agent/limiquantix-hypervisor/src/storage.rs` | Disk creation with backing files |
| `agent/limiquantix-node/src/service.rs` | Service handler integration |
| `agent/limiquantix-proto/proto/node_daemon.proto` | Proto definitions |

---

## Dependencies

### Required Packages on Hypervisor

```bash
# Ubuntu/Debian
sudo apt install -y genisoimage qemu-utils

# RHEL/CentOS
sudo dnf install -y genisoimage qemu-img
```

### Cloud Images Repository

Common cloud images:

| OS | URL |
|----|-----|
| Ubuntu 22.04 | https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img |
| Ubuntu 24.04 | https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img |
| Debian 12 | https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2 |
| AlmaLinux 9 | https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2 |

---

## Testing

### Test Cloud-Init Locally

```bash
# Create test cloud-init files
mkdir /tmp/cloud-test
echo "instance-id: test-vm" > /tmp/cloud-test/meta-data
cat > /tmp/cloud-test/user-data << 'EOF'
#cloud-config
hostname: test-vm
users:
  - name: test
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-rsa YOUR_KEY
EOF

# Generate ISO
genisoimage -output /tmp/cloud-init.iso -volid cidata -joliet -rock /tmp/cloud-test/

# Verify ISO
isoinfo -d -i /tmp/cloud-init.iso
```

### Test Full VM Creation

```bash
# 1. Download cloud image
wget -O /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2 \
  https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img

# 2. Create VM via dashboard
# - Use backing_file pointing to the cloud image
# - Provide user_data with SSH key

# 3. Start VM and verify
virsh start <vm-id>
ssh admin@<vm-ip>
```

---

## Next Steps

1. **Frontend Integration** - Add cloud-init fields to VM Creation Wizard
2. **Image Library** - Build a UI for managing cloud images
3. **Windows Sysprep** - Implement Windows automated provisioning
4. **Ignition Support** - Add support for Fedora CoreOS/Flatcar
