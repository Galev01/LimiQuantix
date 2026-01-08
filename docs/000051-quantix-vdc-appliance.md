# 000051 - Quantix-vDC Control Plane Appliance

**Description:** Documentation for the Quantix-vDC appliance - a pre-built virtual appliance that packages the centralized control plane for managing Quantix-KVM clusters.

## Overview

Quantix-vDC is the centralized management platform for Quantix-KVM virtualization clusters, similar to VMware vCenter Server Appliance (VCSA). It provides:

- **Web Dashboard** - Modern React-based management UI
- **REST API** - Full-featured API for automation (Terraform-ready)
- **Cluster Management** - Manage multiple Quantix-OS hypervisor hosts
- **VM Orchestration** - Create, migrate, and monitor virtual machines

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Quantix-vDC Appliance                       │
├─────────────────────────────────────────────────────────────────┤
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

## Deployment Options

### Option 1: Installation ISO

1. Download `quantix-vdc-1.0.0.iso`
2. Boot from ISO (supports UEFI and BIOS)
3. Follow the installation wizard
4. Reboot and access web console

### Option 2: OVA Import

1. Download `quantix-vdc-1.0.0.ova`
2. Import into VMware, VirtualBox, or Proxmox
3. Start the VM
4. Access web console

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

## Disk Layout

| Partition | Mount Point | Size | Purpose |
|-----------|-------------|------|---------|
| EFI | `/boot/efi` | 256 MB | UEFI boot |
| Root | `/` | 10 GB | System files |
| Data | `/var/lib` | Rest | Database, logs, certs |

## Services

| Service | Port | Description |
|---------|------|-------------|
| nginx | 443 | Web UI + API proxy |
| quantix-controlplane | 8080 | Control plane API |
| postgresql | 5432 | Primary database |
| etcd | 2379 | Cluster state |
| redis | 6379 | Caching |

## Installation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        QUANTIX-vDC INSTALLER                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Boot from ISO                                                        │
│     └─ GRUB menu → "Install Quantix-vDC"                                │
│                                                                          │
│  2. Installation TUI Wizard                                              │
│     ├─ Select target disk                                                │
│     ├─ Configure network (DHCP or Static IP)                            │
│     ├─ Set admin password                                                │
│     └─ Confirm installation                                              │
│                                                                          │
│  3. Disk Partitioning                                                    │
│     ├─ Part 1: EFI/Boot (256MB)                                         │
│     ├─ Part 2: Root (10GB) - System files                               │
│     └─ Part 3: Data (REST) - PostgreSQL, etcd, logs                     │
│                                                                          │
│  4. System Installation                                                  │
│     ├─ Extract rootfs to disk                                            │
│     ├─ Install bootloader (GRUB)                                         │
│     ├─ Generate SSH host keys                                            │
│     └─ Create admin user                                                 │
│                                                                          │
│  5. First Boot                                                           │
│     ├─ Initialize PostgreSQL database                                    │
│     ├─ Configure etcd cluster                                            │
│     ├─ Generate TLS certificates                                         │
│     ├─ Start all services                                                │
│     └─ Display web UI URL                                                │
│                                                                          │
│  6. Ready!                                                               │
│     └─ Access https://<ip>/ for management UI                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## First Boot Process

On first boot, the appliance automatically:

1. **Initialize PostgreSQL** - Creates database cluster and quantix_vdc database
2. **Configure etcd** - Sets up single-node cluster for distributed state
3. **Initialize Redis** - Configures caching layer
4. **Generate TLS Certificates** - Creates self-signed certs with SAN
5. **Generate Secrets** - Creates JWT secret and registration token
6. **Start Services** - Starts control plane and nginx

## Configuration

### Main Configuration File

`/etc/quantix-vdc/config.yaml`

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

tls:
  cert_file: "/var/lib/quantix-vdc/certs/server.crt"
  key_file: "/var/lib/quantix-vdc/certs/server.key"
```

### nginx Configuration

`/etc/nginx/conf.d/quantix-vdc.conf`

- Serves React dashboard from `/usr/share/quantix-vdc/dashboard/`
- Proxies `/api/*` to Go backend on :8080
- TLS termination with auto-generated certificates
- WebSocket support for real-time updates

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

## Registering Hosts

To add Quantix-OS hosts to the cluster:

1. Get the registration token:
```bash
cat /var/lib/quantix-vdc/registration.token
```

2. On the Quantix-OS host, configure the control plane:
```bash
vi /etc/limiquantix/node.yaml
# Set controlplane_url and registration_token
```

3. Restart the node daemon:
```bash
rc-service quantix-node restart
```

## Troubleshooting

### Check Service Status
```bash
rc-service quantix-controlplane status
rc-service postgresql status
rc-service nginx status
```

### View Logs
```bash
tail -f /var/log/quantix-controlplane.log
tail -f /var/log/nginx/error.log
```

### Regenerate TLS Certificate
```bash
rm -f /var/lib/quantix-vdc/certs/server.*
rc-service quantix-firstboot restart
rc-service nginx restart
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

## Related Documentation

- [000024 - Backend Implementation Guide](Backend/000024-backend-implementation-guide.md)
- [000007 - Hypervisor Integration](adr/000007-hypervisor-integration.md)
- [Quantix-OS Documentation](Quantix-OS/)
