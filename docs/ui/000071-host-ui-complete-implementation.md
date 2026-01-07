# 000071 - Quantix Host UI Complete Implementation

This document describes the complete implementation of the Quantix Host UI, a standalone web interface for managing a single Quantix-OS hypervisor node.

## Overview

The Quantix Host UI is a React-based web application that provides a comprehensive management interface for a single hypervisor host. It runs directly on the Quantix-OS node and communicates with the `qx-node` daemon via REST APIs over HTTPS.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Quantix-OS Host                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐                   ┌───────────────────────┐   │
│  │   Browser       │                   │   HTTP Redirect       │   │
│  │                 │─────HTTP :80──────►   Server              │   │
│  │                 │                   │   (redirects to HTTPS)│   │
│  │                 │                   └───────────────────────┘   │
│  │                 │                                                │
│  │                 │    HTTPS :8443    ┌───────────────────────┐   │
│  │  Host UI        │◄─────────────────►│   qx-node             │   │
│  │  (React/TS)     │   (TLS/rustls)    │   (Rust Daemon)       │   │
│  │                 │                   │                       │   │
│  │  - Dashboard    │                   │  - HTTPS Server       │   │
│  │  - VMs          │                   │  - gRPC Server        │   │
│  │  - Storage      │                   │  - TLS Manager        │   │
│  │  - Network      │                   │  - Hypervisor         │   │
│  │  - Settings     │                   │  - Storage Mgr        │   │
│  │  - Certificates │                   │  - ACME Client        │   │
│  └─────────────────┘                   └───────────────────────┘   │
│                                                                      │
│  Certificate Storage: /etc/limiquantix/certs/                       │
│  ├── server.crt       (TLS certificate)                             │
│  ├── server.key       (TLS private key)                             │
│  ├── ca.crt           (CA cert, optional)                           │
│  └── acme/            (ACME account & state)                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Features Implemented

### Phase 1: Storage Management
- **Storage Pools Page** (`/storage/pools`)
  - List all configured storage pools
  - Create new pools (Local, NFS, Ceph RBD, iSCSI)
  - View pool capacity and volume count
  - Navigate to volumes within each pool

- **Volumes Page** (`/storage/pools/:poolId/volumes`)
  - List volumes in a specific pool
  - Create new volumes (empty, from image, clone, snapshot)
  - Delete volumes
  - View volume details (size, format, path, attachment status)

### Phase 2: Hardware Inventory
- **Hardware Page** (`/hardware`)
  - CPU information (model, cores, sockets, threads, features)
  - Memory information (total, used, available, swap)
  - Storage devices (disks with SMART status)
  - Network devices (NICs with link state)
  - GPU information (with passthrough capability)

### Phase 3: VM Management
- **VM List Page** (`/vms`)
  - List all VMs with power state
  - Power operations (start, stop, reboot, pause, resume)
  - Console access via QVMRC
  - Quick actions menu

- **VM Detail Page** (`/vms/:vmId`)
  - Summary tab with resource usage
  - Hardware configuration tab
  - Snapshots tab (create, revert, delete)
  - Console access tab
  - Events tab (placeholder)

- **VM Creation Wizard**
  - Multi-step wizard for creating new VMs
  - Basic info, compute, storage, network, cloud-init steps
  - Review and confirmation

### Phase 4: Performance Monitoring
- **Performance Page** (`/monitor`)
  - Real-time CPU usage chart
  - Memory usage chart
  - Disk I/O metrics
  - Network I/O metrics
  - Load averages
  - VM count summary

### Phase 5: Events
- **Events Page** (`/events`)
  - Filterable event list
  - Level filtering (info, warning, error, debug)
  - Category filtering
  - Expandable event details

### Phase 6: Settings
- **Settings Page** (`/settings`)
  - General settings (node name, log level)
  - Cluster status display
  - Storage defaults
  - Network defaults (VNC configuration)
  - System services management
  - About/System information

### Phase 7: HTTPS & Certificate Management
- **TLS/HTTPS Support**
  - Secure HTTPS connections on port 8443
  - Automatic HTTP→HTTPS redirect (port 80)
  - Uses rustls for TLS implementation
  
- **Certificate Types**
  - **Self-Signed** (default): Auto-generated on first boot
  - **Manual Upload**: Upload your own certificate and key
  - **ACME/Let's Encrypt**: Automatic certificate provisioning
  
- **Certificate Management UI** (`/settings` → Certificates tab)
  - View current certificate info (expiry, fingerprint, issuer)
  - Upload custom certificates (PEM format)
  - Generate new self-signed certificate
  - Configure ACME (Let's Encrypt) for automatic certificates
  - Certificate expiry warnings

## API Endpoints

### Host APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/host` | Get host information |
| GET | `/api/v1/host/health` | Health check |
| GET | `/api/v1/host/hardware` | Get hardware inventory |
| GET | `/api/v1/host/metrics` | Get current metrics |
| POST | `/api/v1/host/reboot` | Reboot host |
| POST | `/api/v1/host/shutdown` | Shutdown host |

### VM APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/vms` | List all VMs |
| POST | `/api/v1/vms` | Create a new VM |
| GET | `/api/v1/vms/:vmId` | Get VM details |
| DELETE | `/api/v1/vms/:vmId` | Delete a VM |
| POST | `/api/v1/vms/:vmId/start` | Start VM |
| POST | `/api/v1/vms/:vmId/stop` | Stop VM |
| POST | `/api/v1/vms/:vmId/force-stop` | Force stop VM |
| POST | `/api/v1/vms/:vmId/reboot` | Reboot VM |
| POST | `/api/v1/vms/:vmId/pause` | Pause VM |
| POST | `/api/v1/vms/:vmId/resume` | Resume VM |
| GET | `/api/v1/vms/:vmId/console` | Get console info |
| GET | `/api/v1/vms/:vmId/snapshots` | List snapshots |
| POST | `/api/v1/vms/:vmId/snapshots` | Create snapshot |
| DELETE | `/api/v1/vms/:vmId/snapshots/:snapshotId` | Delete snapshot |
| POST | `/api/v1/vms/:vmId/snapshots/:snapshotId/revert` | Revert to snapshot |

### Storage APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/storage/pools` | List storage pools |
| POST | `/api/v1/storage/pools` | Create storage pool |
| GET | `/api/v1/storage/pools/:poolId` | Get pool details |
| DELETE | `/api/v1/storage/pools/:poolId` | Delete pool |
| GET | `/api/v1/storage/pools/:poolId/volumes` | List volumes |
| POST | `/api/v1/storage/pools/:poolId/volumes` | Create volume |
| DELETE | `/api/v1/storage/pools/:poolId/volumes/:volumeId` | Delete volume |
| GET | `/api/v1/storage/images` | List disk images |

### Network APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/network/interfaces` | List network interfaces |
| GET | `/api/v1/network/interfaces/:name` | Get interface details |
| POST | `/api/v1/network/interfaces/:name/configure` | Configure interface |
| POST | `/api/v1/network/bridges` | Create bridge |
| GET | `/api/v1/network/dns` | Get DNS config |
| POST | `/api/v1/network/dns` | Set DNS config |
| GET | `/api/v1/network/hostname` | Get hostname |
| POST | `/api/v1/network/hostname` | Set hostname |

### Cluster APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/cluster/status` | Get cluster status |
| POST | `/api/v1/cluster/join` | Join cluster |
| POST | `/api/v1/cluster/leave` | Leave cluster |
| GET | `/api/v1/cluster/config` | Get cluster config |

### Settings APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/settings` | Get current settings |
| POST | `/api/v1/settings` | Update settings |
| GET | `/api/v1/settings/services` | List system services |
| POST | `/api/v1/settings/services/:name/restart` | Restart service |

### Events API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/events` | List events |

### Certificate Management APIs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/settings/certificates` | Get current certificate info |
| DELETE | `/api/v1/settings/certificates` | Reset to self-signed certificate |
| POST | `/api/v1/settings/certificates/upload` | Upload custom certificate |
| POST | `/api/v1/settings/certificates/generate` | Generate new self-signed cert |
| GET | `/api/v1/settings/certificates/acme` | Get ACME account info |
| POST | `/api/v1/settings/certificates/acme/register` | Register ACME account |
| POST | `/api/v1/settings/certificates/acme/issue` | Issue cert via ACME |

## Technology Stack

### Frontend
- **React 19** with TypeScript
- **Vite** for build tooling
- **TanStack Query** for server state management
- **Zustand** for client state management
- **React Router** for navigation
- **Tailwind CSS** for styling
- **Lucide React** for icons
- **Sonner** for toast notifications

### Backend (Node Daemon)
- **Rust** with async/await (Tokio)
- **Axum** + **axum-server** for HTTPS server
- **rustls** for TLS implementation
- **rcgen** for self-signed certificate generation
- **instant-acme** for ACME/Let's Encrypt client
- **Tonic** for gRPC server
- **sysinfo** crate for system telemetry
- **tracing** for structured logging

## File Structure

```
quantix-host-ui/
├── src/
│   ├── api/              # API client functions
│   │   ├── client.ts     # Base HTTP client
│   │   ├── host.ts       # Host API
│   │   ├── vm.ts         # VM API
│   │   ├── storage.ts    # Storage API
│   │   ├── network.ts    # Network API
│   │   ├── cluster.ts    # Cluster API
│   │   ├── settings.ts   # Settings API
│   │   ├── events.ts     # Events API
│   │   └── types.ts      # Shared types
│   ├── components/
│   │   ├── layout/       # Layout components
│   │   ├── ui/           # UI primitives
│   │   ├── vm/           # VM-specific components
│   │   ├── storage/      # Storage components
│   │   └── network/      # Network components
│   ├── hooks/            # React Query hooks
│   ├── pages/            # Page components
│   ├── stores/           # Zustand stores
│   ├── lib/              # Utilities
│   └── App.tsx           # Main app with routes
└── index.html
```

## Building and Deployment

The Host UI is built as part of the Quantix-OS ISO build process:

```bash
# Build the Host UI
cd quantix-host-ui
npm install
npm run build

# The build output goes to dist/
# This is copied to /usr/share/quantix-host-ui/ in the ISO
```

The `qx-node` daemon serves the static files:
- Static files are served from `/usr/share/quantix-host-ui/`
- The daemon is started with `--webui-path /usr/share/quantix-host-ui`
- SPA fallback routes all non-API requests to `index.html`

## HTTPS Configuration

### Default Behavior

By default, the Host UI:
1. Runs HTTPS on port 8443
2. Auto-generates a self-signed certificate on first boot
3. Redirects HTTP (port 80) to HTTPS

### Command-Line Options

```bash
# Disable TLS (use HTTP instead - NOT RECOMMENDED)
limiquantix-node --no-tls

# Custom certificate paths
limiquantix-node --tls-cert /path/to/cert.pem --tls-key /path/to/key.pem

# Enable HTTP→HTTPS redirect
limiquantix-node --redirect-http --redirect-port 80
```

### Configuration File

```yaml
# /etc/limiquantix/node.yaml
server:
  http:
    enabled: true
    listen_address: "0.0.0.0:8443"
    webui_path: "/usr/share/quantix-host-ui"
    
    tls:
      enabled: true
      redirect_http: true
      redirect_port: 80
      cert_path: "/etc/limiquantix/certs/server.crt"
      key_path: "/etc/limiquantix/certs/server.key"
      mode: "self-signed"  # or "manual" or "acme"
      
      self_signed:
        validity_days: 365
        
      acme:
        enabled: false
        email: "admin@example.com"
        directory_url: "https://acme-v02.api.letsencrypt.org/directory"
        domains: ["quantix.example.com"]
        challenge_type: "http-01"
        auto_renew: true
        renew_before_days: 30
```

### Certificate Types

#### 1. Self-Signed (Default)
- Generated automatically on first boot
- Browser will show security warning (expected)
- Users can add the certificate to their trusted root CA
- Valid for 365 days by default

#### 2. Manual Upload
- Upload your own certificate via the UI or API
- Supports PEM format
- Optional CA certificate for chain

```bash
# Upload via API
curl -X POST https://host:8443/api/v1/settings/certificates/upload \
  -H "Content-Type: application/json" \
  -d '{
    "certificate": "-----BEGIN CERTIFICATE-----\n...",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...",
    "caCertificate": "-----BEGIN CERTIFICATE-----\n..."
  }'
```

#### 3. ACME (Let's Encrypt)
- Automatic certificate provisioning
- Requires public domain and DNS configuration
- HTTP-01 challenge supported
- Auto-renewal before expiration

```bash
# Register ACME account
curl -X POST https://host:8443/api/v1/settings/certificates/acme/register \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com"}'

# Issue certificate
curl -X POST https://host:8443/api/v1/settings/certificates/acme/issue \
  -H "Content-Type: application/json" \
  -d '{"domains": ["quantix.example.com"]}'
```

## Future Enhancements

1. **Real-time Updates**: Implement WebSocket/SSE for live updates
2. **Metrics History**: Store and display historical metrics with charts
3. **Event Persistence**: Store events in a database for querying
4. **Authentication**: Add JWT-based authentication with PAM backend
5. **Dark/Light Theme**: Complete theme switching support
6. **Localization**: Add i18n support for multiple languages
7. **Accessibility**: Improve ARIA labels and keyboard navigation
8. **DNS-01 ACME Challenge**: Support for wildcard certificates
9. **Certificate Auto-Renewal Monitoring**: Dashboard widget for cert expiry