# Workflow State

## Current Status: COMPLETED - Storage Pool Host Assignment

## Latest Workflow: Storage Pool Host Assignment and File Browser

**Date:** January 11, 2026

### Objective

Implement storage pool host assignment feature and storage pool file browser:
1. Allow assigning/unassigning storage pools to specific hosts
2. When creating a VM, filter hosts based on storage pool availability
3. Create a StoragePoolDetail page with file explorer

### Completed Tasks

| Task | Description | Status |
|------|-------------|--------|
| Domain Model | Added `AssignedNodeIDs` field to `StoragePoolSpec` | ✅ |
| Domain Methods | Added `IsAssignedToNode`, `AssignToNode`, `UnassignFromNode` methods | ✅ |
| Proto Updates | Added `assigned_node_ids` to `StoragePoolSpec` | ✅ |
| Proto RPCs | Added `AssignPoolToNode`, `UnassignPoolFromNode`, `ListPoolFiles` RPCs | ✅ |
| Backend Service | Implemented assign/unassign and file listing in `pool_service.go` | ✅ |
| Node Daemon | Implemented `list_storage_pool_files` RPC in Rust | ✅ |
| Frontend Hooks | Added `useAssignPoolToNode`, `useUnassignPoolFromNode`, `usePoolFiles` | ✅ |
| StoragePoolDetail Page | Created new page with tabs for Files, Nodes, Settings | ✅ |
| VM Wizard Update | Added host/pool compatibility warnings and filtering | ✅ |
| Documentation | Created `000057-storage-pool-host-assignment.md` | ✅ |

### Key Changes

**Backend:**
- `backend/internal/domain/storage.go` - Added `AssignedNodeIDs` and helper methods
- `backend/internal/services/storage/pool_service.go` - New RPCs
- `backend/internal/services/storage/pool_converter.go` - Proto conversion
- `backend/internal/services/node/daemon_client.go` - `ListStoragePoolFiles` client method

**Proto:**
- `proto/limiquantix/storage/v1/storage.proto` - `assigned_node_ids` field
- `proto/limiquantix/storage/v1/storage_service.proto` - New RPCs and messages
- `proto/limiquantix/node/v1/node_daemon.proto` - File listing RPC

**Node Daemon:**
- `agent/limiquantix-node/src/service.rs` - `list_storage_pool_files` implementation

**Frontend:**
- `frontend/src/pages/StoragePoolDetail.tsx` - New detail page with file browser
- `frontend/src/pages/StoragePools.tsx` - Added onClick navigation
- `frontend/src/hooks/useStorage.ts` - New hooks and types
- `frontend/src/components/vm/VMCreationWizard.tsx` - Host/pool compatibility UI
- `frontend/src/App.tsx` - Added route for `/storage/pools/:id`

### VMware Equivalence

| VMware Concept | Quantix Equivalent |
|----------------|-------------------|
| Datastore | Storage Pool |
| VMDK | Volume (first-class API object) |
| Datastore mounting on host | Storage pool assignment to node |
| Browse Datastore | Pool file browser |

---

## Previous Workflow: Fix Host Registration API Communication

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

## Latest Workflow: Fix ISO Build - Node Daemon Compilation Failed

**Date:** January 10, 2026

### Problem

The `make iso` command completes but the node daemon (qx-node) binary is NOT actually built. Build logs show:

```
error: cannot produce proc-macro for `async-stream-impl v0.3.6` as the target `x86_64-unknown-linux-musl` does not support these crate types
cp: cannot stat '../agent/limiquantix-node-musl': No such file or directory
✅ Node daemon built (musl)  <-- FALSE POSITIVE!
```

**Root Cause:** The Docker image was setting `RUSTFLAGS="-C target-feature=+crt-static -C link-self-contained=yes"` which forces a musl cross-compilation target. On musl targets, proc-macro crates (like `async-stream-impl`, `darling_macro`, `tokio-macros`, etc.) cannot be compiled because they need to run on the **host** compiler.

### Fix Applied

#### 1. Fixed Dockerfile.rust-tui

Removed the problematic RUSTFLAGS that forced musl cross-compilation:

```dockerfile
# BEFORE (broken)
ENV RUSTFLAGS="-C target-feature=+crt-static -C link-self-contained=yes"

# AFTER (works)
# No RUSTFLAGS - Alpine is already musl-based, builds native musl binaries
ENV OPENSSL_STATIC=1
ENV OPENSSL_LIB_DIR=/usr/lib
ENV OPENSSL_INCLUDE_DIR=/usr/include
```

**Key insight:** Alpine Linux uses musl libc natively. When you `cargo build` on Alpine WITHOUT specifying a target, it produces musl binaries automatically. Explicitly setting `--target=x86_64-unknown-linux-musl` breaks proc-macro compilation.

#### 2. Fixed Makefile Error Handling

Added proper error detection so the build fails fast instead of silently continuing:

```makefile
# node-daemon target now:
# - Uses set -e for early exit on errors
# - Checks if binary exists after build
# - Prints error message if build fails
# - Uses exit 1 to fail the make target
```

#### 3. Added BUILD_INFO.json Generation

The Makefile now generates `BUILD_INFO.json` during the host-ui build with:
- Product version
- Build date
- Git commit
- Registration API flag

### Files Modified

| File | Changes |
|------|---------|
| `Quantix-OS/builder/Dockerfile.rust-tui` | Removed RUSTFLAGS, added git package |
| `Quantix-OS/Makefile` | Added error handling for node-daemon and console-tui builds, added BUILD_INFO.json generation |

### Testing

Rebuild the ISO:

```bash
cd Quantix-OS
sudo make clean-all  # Clear Docker images
sudo make iso
```

Watch for errors. The build should now FAIL if the node daemon doesn't compile correctly.

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
