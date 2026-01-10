# Workflow State

## Current Status: IN PROGRESS - Host Registration Fix

## Latest Workflow: Fix Host Registration API Communication

**Date:** January 10, 2026

### Problem

When trying to add a Quantix-OS host to QvDC via token-based registration, the control plane receives HTML instead of JSON from the host API. Error: `Failed to parse host resources: invalid character '<' looking for beginning of value`

**Root Cause:** The Quantix-OS host running an older ISO does not have the registration API endpoints. The SPA fallback serves `index.html` for any unrecognized routes.

### Fix Applied

#### 1. Enhanced Error Handling in Go Backend (`host_registration_handler.go`)

Added enterprise-grade error handling with structured errors:

| Error Code | Description |
|------------|-------------|
| `HOST_FIRMWARE_OUTDATED` | Host running old Quantix-OS without registration API |
| `HOST_CONNECTION_FAILED` | Cannot connect to host (wrong IP, port, network issue) |
| `CONNECTION_TIMEOUT` | Host not responding within timeout |
| `TOKEN_INVALID` | Token doesn't match the one on the host |
| `TOKEN_EXPIRED` | Token has expired (valid for 1 hour) |
| `TOKEN_MISSING` | No token generated on the host yet |
| `HOST_API_NOT_AVAILABLE` | Host API endpoint returning errors |
| `NETWORK_UNREACHABLE` | Network/routing issue |
| `TLS_ERROR` | SSL certificate problem |
| `INVALID_RESPONSE` | Host returned HTML or unparseable data |

**Discovery Flow Phases:**
1. **Phase 1: API Check (Ping)** - Verify `/api/v1/registration/ping` is reachable
2. **Phase 2: Token Validation** - Validate the token with the host
3. **Phase 3: Discovery** - Fetch full hardware resources

Each phase has detailed logging with:
- URL being called
- HTTP status code
- Content-Type header
- Response body (for debugging)

#### 2. Added Diagnostic Ping Endpoint (`http_server.rs`)

New `/api/v1/registration/ping` endpoint that:
- Requires **no authentication**
- Returns JSON with status, version, and timestamp
- Helps diagnose if API is reachable vs firmware outdated

#### 3. Frontend Error Display (`AddHostModal.tsx`)

- User-friendly error messages with emojis and guidance
- Multi-line error display with proper formatting
- Specific advice for each error type

### Files Modified

| File | Changes |
|------|---------|
| `backend/internal/server/host_registration_handler.go` | Complete rewrite with phases, structured errors, detailed logging |
| `agent/limiquantix-node/src/http_server.rs` | Added `/api/v1/registration/ping` diagnostic endpoint |
| `frontend/src/components/host/AddHostModal.tsx` | Enhanced error handling and display |

### Testing

To test:
1. Rebuild the Go backend: `cd backend && go build -o controlplane.exe ./cmd/controlplane`
2. Rebuild the ISO with latest Rust code (must be built on Linux for x86_64-linux target)
3. Start the backend and observe detailed logs

**Logs to look for:**
- `Registration API ping response` - Shows if ping worked
- `Host API confirmed` - Shows version if ping succeeded
- `Token validated successfully` - Token accepted
- `Host discovery completed successfully` - All phases passed

### Build Status

- ✅ Go backend compiles successfully
- ✅ Rust node daemon compiles successfully (Windows build)
- ⚠️ ISO needs to be rebuilt with latest Rust code on Linux

---

## Previous Workflow: Quantix Host UI (QHMI) Complete Implementation

**Date:** January 9, 2026

### Objective

Configure and make the `quantix-host-ui` work correctly within the Quantix-OS ISO, enabling full host management capabilities after installation.

### Completed Tasks

| Task | Description | Status |
|------|-------------|--------|
| Fix Telemetry | Fixed CPU/memory/disk/network metrics collection (sysinfo double-refresh) | ✅ |
| Event Store | Implemented ring buffer event store with emit/list functionality | ✅ |
| Log Collection | Connected log endpoint to journald/syslog with file fallbacks | ✅ |
| Local Storage Discovery | Added endpoint to list physical disks and initialize as qDV | ✅ |
| Image Scanning | Fixed image scanning to include /var/lib/limiquantix/images/ | ✅ |
| Settings Storage Tab | Redesigned to show physical disks and shared storage pools | ✅ |
| Settings Network Tab | Added vSwitch management with physical uplinks display | ✅ |
| Settings Services | Added NFS client, firewall, NTP, SNMP to services list | ✅ |
| vDC Registration | Added complete_registration callback endpoint for vDC | ✅ |
| QHMI Branding | Updated About section from "Quantix-KVM" to "QHMI" | ✅ |
| Security Placeholders | Added password reset and MFA configuration placeholders | ✅ |
| Auto-detect Storage | Added automatic NFS mount and local storage detection on startup | ✅ |

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────┐
│  Quantix-vDC (Control Plane) - localhost:8080                   │
│  ├── Go backend with Connect-RPC + REST APIs                    │
│  ├── PostgreSQL, etcd, Redis (Docker)                           │
│  └── React frontend (localhost:5173)                            │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ gRPC / REST
                              │
┌─────────────────────────────────────────────────────────────────┐
│  Quantix-OS (Hypervisor Host)                                   │
│  ├── Rust Node Daemon (limiquantix-node)                        │
│  ├── libvirt/QEMU for VM management                             │
│  └── QHMI - Host UI (quantix-host-ui)                           │
└─────────────────────────────────────────────────────────────────┘
```

## Host Registration Flow

```
┌──────────────────┐    ┌───────────────────┐    ┌──────────────────┐
│   QvDC Frontend  │    │    Go Backend     │    │   Quantix-OS     │
│   (localhost)    │    │   (localhost)     │    │  (192.168.x.x)   │
└────────┬─────────┘    └─────────┬─────────┘    └────────┬─────────┘
         │                        │                       │
         │ POST /api/nodes/discover                       │
         │ { hostUrl, token }     │                       │
         ├───────────────────────>│                       │
         │                        │                       │
         │                        │ GET /api/v1/registration/ping
         │                        ├──────────────────────>│
         │                        │<──────────────────────┤
         │                        │ { status: "ok" }      │
         │                        │                       │
         │                        │ GET /api/v1/registration/token
         │                        │ Authorization: Bearer <token>
         │                        ├──────────────────────>│
         │                        │<──────────────────────┤
         │                        │ { token, hostname }   │
         │                        │                       │
         │                        │ GET /api/v1/registration/discovery
         │                        │ Authorization: Bearer <token>
         │                        ├──────────────────────>│
         │                        │<──────────────────────┤
         │                        │ { cpu, memory, ... }  │
         │                        │                       │
         │<───────────────────────┤                       │
         │ Discovery data         │                       │
         │                        │                       │
```
