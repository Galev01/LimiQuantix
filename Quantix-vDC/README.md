# Quantix-vDC Control Plane Appliance

> The centralized management platform for Quantix-KVM virtualization clusters - similar to VMware vCenter Server Appliance (VCSA).

## Overview

Quantix-vDC is a pre-built virtual appliance that packages the Quantix-KVM control plane for easy deployment. It provides:

- **Web Dashboard** - Modern React-based management UI
- **REST API** - Full-featured API for automation (Terraform-ready)
- **Cluster Management** - Manage multiple Quantix-OS hypervisor hosts
- **VM Orchestration** - Create, migrate, and monitor virtual machines
- **Storage Management** - Manage storage pools and volumes
- **Network Management** - SDN-based virtual networking

## Quick Start

### Option 1: Installation ISO

1. Download `quantix-vdc-1.0.0.iso`
2. Boot from ISO (UEFI or BIOS)
3. Follow the installation wizard
4. Access the web console at `https://<appliance-ip>/`

### Option 2: OVA Import

1. Download `quantix-vdc-1.0.0.ova`
2. Import into VMware, VirtualBox, or Proxmox
3. Start the VM
4. Access the web console at `https://<appliance-ip>/`

## Building from Source

### Prerequisites

- Docker
- Make
- 10GB free disk space

### Build Commands

```bash
cd Quantix-vDC

# Build installation ISO
make iso

# Build OVA appliance
make ova

# Build both
make all

# Test in QEMU
make test-qemu-install
```

### Build Artifacts

| File | Description | Size |
|------|-------------|------|
| `output/quantix-vdc-1.0.0.iso` | Installation ISO | ~400-500 MB |
| `output/quantix-vdc-1.0.0.ova` | OVA appliance | ~1.5 GB |

## System Requirements

### Minimum
- 4 GB RAM
- 2 vCPUs
- 20 GB disk space
- Network connectivity

### Recommended
- 8 GB RAM
- 4 vCPUs
- 50 GB disk space
- Dedicated network interface

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Quantix-vDC Appliance                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    nginx (HTTPS:443)                    │   │
│  │               Reverse Proxy + TLS Termination           │   │
│  └─────────────────────────────────────────────────────────┘   │
│           │                                │                    │
│           ▼                                ▼                    │
│  ┌─────────────────┐              ┌─────────────────┐          │
│  │ React Dashboard │              │  Control Plane  │          │
│  │   (Static SPA)  │              │     (Go API)    │          │
│  └─────────────────┘              └─────────────────┘          │
│                                            │                    │
│           ┌────────────────────────────────┼───────────┐        │
│           │                │               │           │        │
│           ▼                ▼               ▼           ▼        │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────┐  ┌───────┐    │
│  │ PostgreSQL   │  │    etcd     │  │  Redis   │  │ Hosts │    │
│  │   (Data)     │  │  (Cluster)  │  │ (Cache)  │  │ (API) │    │
│  └──────────────┘  └─────────────┘  └──────────┘  └───────┘    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                     Alpine Linux 3.20                           │
└─────────────────────────────────────────────────────────────────┘
```

## Disk Layout

| Partition | Mount Point | Size | Purpose |
|-----------|-------------|------|---------|
| EFI | `/boot/efi` | 256 MB | UEFI boot |
| Root | `/` | 10 GB | System files |
| Data | `/var/lib` | Rest | Database, logs, certs |

## Ports

| Port | Protocol | Service |
|------|----------|---------|
| 443 | HTTPS | Web UI + API |
| 80 | HTTP | Redirect to HTTPS |
| 22 | SSH | Remote access (disabled by default) |

Internal ports (not exposed):
- 8080: Control Plane API
- 5432: PostgreSQL
- 2379: etcd
- 6379: Redis

## First Boot

On first boot, the appliance automatically:

1. Initializes PostgreSQL database
2. Generates TLS certificates
3. Creates JWT secrets
4. Generates host registration token
5. Starts all services

## Registration Token

To add Quantix-OS hosts to the cluster, use the registration token:

```bash
# View token on appliance
cat /var/lib/quantix-vdc/registration.token

# Register a host
curl -X POST https://<vdc-ip>/api/v1/nodes/register \
  -H "Authorization: Bearer <registration-token>" \
  -d '{"hostname": "host1", "ip": "192.168.1.100"}'
```

## Configuration

Main configuration file: `/etc/quantix-vdc/config.yaml`

```yaml
server:
  port: 8080
  bind: "127.0.0.1"

database:
  host: "localhost"
  port: 5432
  database: "quantix_vdc"

etcd:
  endpoints:
    - "localhost:2379"

redis:
  host: "localhost"
  port: 6379
```

## Comparison with VMware VCSA

| Feature | VMware VCSA | Quantix-vDC |
|---------|-------------|-------------|
| Base OS | Photon OS | Alpine Linux |
| ISO Size | ~8 GB | ~500 MB |
| RAM Requirement | 16 GB | 4 GB |
| Boot Time | 5-10 minutes | 15-20 seconds |
| Database | PostgreSQL | PostgreSQL |
| Installer | Web-based | TUI wizard |
| License | Commercial | Open Source |

## Troubleshooting

### Check service status
```bash
rc-service quantix-controlplane status
rc-service postgresql status
rc-service nginx status
```

### View logs
```bash
tail -f /var/log/quantix-controlplane.log
tail -f /var/log/nginx/error.log
```

### Regenerate TLS certificate
```bash
rm -f /var/lib/quantix-vdc/certs/server.*
rc-service quantix-firstboot restart
rc-service nginx restart
```

### Reset admin password
```bash
# Generate new password hash
echo "newpassword" | openssl passwd -6 -stdin

# Update /etc/shadow with new hash
vi /etc/shadow
```

## Development

### Directory Structure

```
Quantix-vDC/
├── Makefile                    # Build orchestration
├── README.md                   # This file
├── builder/
│   ├── Dockerfile              # Build environment
│   ├── build-rootfs.sh         # Rootfs builder
│   ├── build-iso.sh            # ISO builder
│   ├── build-ova.sh            # OVA builder
│   └── build-installer-initramfs.sh
├── installer/
│   ├── install.sh              # Disk installer
│   ├── tui.sh                  # Installer TUI
│   └── firstboot.sh            # First boot script
├── overlay/
│   ├── etc/
│   │   ├── init.d/             # OpenRC services
│   │   ├── nginx/              # nginx configuration
│   │   └── quantix-vdc/        # Control plane config
│   └── usr/
│       ├── bin/                # Binaries (built)
│       └── share/              # Dashboard (built)
├── profiles/
│   └── packages.conf           # Alpine packages
└── output/                     # Build artifacts
```

## License

Open Source - Apache 2.0

## Contributing

Contributions welcome! Please see the main Quantix-KVM repository for guidelines.
