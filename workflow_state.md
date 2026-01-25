# Workflow State - Guest Agent OTA Distribution

## Feature: Guest Agent OTA Update Infrastructure

Added guest agent as a first-class component in the OTA update system, enabling automatic distribution of agent updates to VMs.

### Changes Made

#### 1. `scripts/publish-update.sh` - Guest Agent Build & Publish ✅

Added `guest-agent` as a new component that can be built and published:

```bash
# Build and publish guest agent
./scripts/publish-update.sh --component guest-agent

# Or build all components including guest-agent
./scripts/publish-update.sh
```

**Features:**
- Builds guest agent binary using Docker (for Alpine compatibility)
- Creates .deb package with systemd service and config
- Creates .rpm package (if fpm is available)
- Creates install.sh script for generic Linux
- Packages everything into `guest-agent.tar.zst`
- Publishes to update server under `quantix-os` product

#### 2. `update-server/main.go` - Guest Agent Endpoints ✅

Added dedicated endpoints for serving guest agent packages:

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/agent/version` | Returns latest agent version |
| `GET /api/v1/agent/install.sh` | Dynamic installer script |
| `GET /api/v1/agent/linux/:arch` | Raw binary (amd64/arm64) |
| `GET /api/v1/agent/linux/:arch.deb` | Debian package |
| `GET /api/v1/agent/linux/:arch.rpm` | RPM package |

**Features:**
- Extracts agent packages from published releases
- Supports multiple architectures (amd64, arm64)
- Dynamic install script with OS/arch detection
- Channel support (dev, beta, stable)

#### 3. `agent/limiquantix-node/src/http_server.rs` - Proxy Support ✅

Updated node daemon to proxy agent downloads from update server:

**Flow:**
1. VM requests agent from node daemon during cloud-init
2. Node daemon checks local paths first (offline/air-gapped support)
3. If not found locally, proxies request to update server
4. Returns package to VM

**Local paths checked:**
- `/data/share/quantix-agent/` (OTA-deployed)
- `/opt/limiquantix/agent/` (manual install)
- `/var/lib/limiquantix/agent/` (legacy)

**Environment variables:**
- `UPDATE_SERVER_URL` - Update server URL (e.g., `http://192.168.0.148:9000`)
- `QUANTIX_UPDATE_SERVER` - Alternative name

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     GUEST AGENT DISTRIBUTION FLOW                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Developer Machine                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ./scripts/publish-update.sh --component guest-agent            │    │
│  │    → Builds binary with Docker                                  │    │
│  │    → Creates .deb, .rpm, install.sh                            │    │
│  │    → Uploads to Update Server                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  Update Server (192.168.0.148:9000)                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  /data/releases/quantix-os/dev/X.Y.Z/guest-agent/               │    │
│  │    ├── limiquantix-agent-linux-amd64                            │    │
│  │    ├── limiquantix-guest-agent_X.Y.Z_amd64.deb                  │    │
│  │    ├── limiquantix-guest-agent-X.Y.Z.x86_64.rpm                 │    │
│  │    └── install.sh                                               │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  QHCI Node Daemon (192.168.0.101:8443)                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  GET /api/v1/agent/linux/amd64.deb                              │    │
│  │    1. Check local: /data/share/quantix-agent/                   │    │
│  │    2. If not found: Proxy to Update Server                      │    │
│  │    3. Return package to VM                                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                              │                                           │
│                              ▼                                           │
│  Guest VM (cloud-init)                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  curl -fsSL https://192.168.0.101:8443/api/v1/agent/install.sh  │    │
│  │    | sudo bash                                                   │    │
│  │                                                                  │    │
│  │  → Detects OS (ubuntu/debian/rhel/centos)                       │    │
│  │  → Detects arch (amd64/arm64)                                   │    │
│  │  → Downloads appropriate package                                 │    │
│  │  → Installs and starts limiquantix-agent service                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Files Modified

| File | Changes |
|------|---------|
| `scripts/publish-update.sh` | Added `guest-agent` component with .deb/.rpm build |
| `update-server/main.go` | Added `/api/v1/agent/*` endpoints |
| `agent/limiquantix-node/src/http_server.rs` | Added update server proxy support |
| `agent/limiquantix-node/Cargo.toml` | Added `glob` dependency |

---

# Previous: Guest Agent Phases 11-13

### Phase 11: Documentation Consolidation ✅

Created comprehensive documentation file: `docs/000088-guest-agent-complete-reference.md`

This single file consolidates all agent documentation including:
- Executive summary and architecture overview
- Communication protocol details
- Complete feature reference (all 11 feature categories)
- Full configuration reference with examples
- Security configuration (allowlisting, rate limiting, audit logging)
- Complete error code reference (70+ error codes)
- Packaging and installation instructions for all platforms
- Full API reference with request/response examples
- Troubleshooting guide
- Development guide with code examples
- Performance metrics

### Phase 12: VM Creation Wizard Agent Deployment ✅

Updated both VM creation wizards to properly deploy the guest agent:

**Files Modified:**
- `frontend/src/components/vm/VMCreationWizard.tsx` (QvDC)
- `quantix-host-ui/src/components/vm/CreateVMWizard.tsx` (QHCI)

**Improvements:**
1. Added full agent configuration file deployment via cloud-init
2. Added proper error handling for agent download failures
3. Added OS detection (Debian/Ubuntu vs RHEL/CentOS)
4. Added architecture detection (amd64/arm64)
5. Added fallback messaging when agent cannot be downloaded

**New Node Daemon Endpoints:**
Added agent download endpoints to `agent/limiquantix-node/src/http_server.rs`:
- `GET /api/v1/agent/version` - Get agent version info
- `GET /api/v1/agent/install.sh` - Linux installer script
- `GET /api/v1/agent/linux/:arch` - Download binary
- `GET /api/v1/agent/linux/:arch.deb` - Download DEB package
- `GET /api/v1/agent/linux/:arch.rpm` - Download RPM package

### Phase 13: Error Codes and Logging ✅

Created comprehensive error codes module: `agent/limiquantix-guest-agent/src/error.rs`

**Error Code Format:** `QXGA-XXXX`
- QX = Quantix
- GA = Guest Agent
- XXXX = 4-digit error code

**Error Code Ranges:**
| Range     | Category                    |
|-----------|----------------------------|
| 1000-1999 | Transport/Connection Errors |
| 2000-2999 | Protocol/Message Errors     |
| 3000-3999 | Execution Errors            |
| 4000-4999 | File Operation Errors       |
| 5000-5999 | Lifecycle Errors            |
| 6000-6999 | Desktop Integration Errors  |
| 7000-7999 | Process/Service Errors      |
| 8000-8999 | Security Errors             |
| 9000-9999 | Internal Errors             |

**Features:**
- Structured error type with code, category, name, message
- Optional context and resolution fields
- Convenience constructors for common errors
- JSON serialization support
- Unit tests for error handling

### Files Created/Modified

**New Files:**
- `docs/000088-guest-agent-complete-reference.md` - Comprehensive documentation
- `agent/limiquantix-guest-agent/src/error.rs` - Error codes module

**Modified Files:**
- `frontend/src/components/vm/VMCreationWizard.tsx` - Enhanced cloud-init
- `quantix-host-ui/src/components/vm/CreateVMWizard.tsx` - Enhanced cloud-init
- `agent/limiquantix-node/src/http_server.rs` - Agent download endpoints
- `agent/limiquantix-guest-agent/src/main.rs` - Added error module

---

## Previous Workflow States

(Moved to completed_workflow.md)
