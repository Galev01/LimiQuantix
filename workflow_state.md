# Workflow State - VM State Reset Feature

## Feature: Reset Stuck VM State

Added a new `reset_state` REST endpoint and UI buttons to recover VMs stuck in transitional states (STOPPING, STARTING, CREATING, etc.).

### Problem Solved

When a VM operation fails mid-way (e.g., stop command times out, node becomes unreachable during operation), the VM can get stuck in a transitional state like `STOPPING`. In this state:
- `CanStart()` returns false (only allows STOPPED or PAUSED)
- `CanStop()` returns false (only allows RUNNING or PAUSED)
- The VM is effectively orphaned and cannot be controlled

### Implementation

#### 1. VM Service Method (`backend/internal/services/vm/service.go`)
- Added `ResetVMState(ctx, vmID, forceToStopped)` method
- If `forceToStopped=false` and VM is assigned to a node:
  - Queries the actual VM state from the hypervisor via `GetVMStatus`
  - Maps the hypervisor state to domain state
  - Updates control plane to match reality
- If `forceToStopped=true` or node is unreachable:
  - Forces state to STOPPED
- Added `mapNodePowerStateToDomain()` helper to convert node daemon PowerState enum to domain VMState

#### 2. REST Endpoint (`backend/internal/server/vm_rest.go`)
- Added `POST /api/vms/{id}/reset_state` endpoint
- Query parameter: `force=true` to force state to STOPPED without querying hypervisor
- Returns updated VM state

#### 3. Frontend API Client (`frontend/src/lib/api-client.ts`)
- Added `vmApi.resetState(id, force)` method for REST API call

#### 4. Frontend Hook (`frontend/src/hooks/useVMs.ts`)
- Added `useResetVMState()` hook with success/error handling

#### 5. Frontend UI (`frontend/src/pages/VMDetail.tsx`)
- Added "Reset State" and "Force Reset State" options to the VM dropdown menu
- "Reset State" queries the hypervisor for actual state
- "Force Reset State" forces state to STOPPED (for when node is unreachable)

#### 6. Fixed Rust Compilation Errors
- Fixed `http_server.rs` and `service.rs` to use `list_vms()` instead of non-existent `get_vm()` method
- Changed from `state.hypervisor` to `state.service.hypervisor` to access hypervisor through service

### Files Changed

```
backend/internal/services/vm/service.go (MODIFIED)
backend/internal/server/vm_rest.go (MODIFIED)
frontend/src/lib/api-client.ts (MODIFIED)
frontend/src/hooks/useVMs.ts (MODIFIED)
frontend/src/pages/VMDetail.tsx (MODIFIED)
agent/limiquantix-node/src/http_server.rs (MODIFIED - fixed compilation error)
agent/limiquantix-node/src/service.rs (MODIFIED - fixed compilation error)
```

### Usage

**From UI:**
1. Go to VM detail page
2. Click the "..." dropdown menu
3. Select "Reset State" to query hypervisor for actual state
4. Or select "Force Reset State" to force state to STOPPED

**From CLI:**
```bash
# Query hypervisor for actual state (recommended)
curl -X POST "http://192.168.0.100:8080/api/vms/{vm-id}/reset_state"

# Force state to STOPPED (when node is unreachable)
curl -X POST "http://192.168.0.100:8080/api/vms/{vm-id}/reset_state?force=true"
```

### Response Example
```json
{
  "success": true,
  "message": "VM state reset to STOPPED",
  "vm": {
    "id": "vm-123",
    "name": "Test-VM",
    "state": "STOPPED",
    "node_id": "node-1"
  }
}
```

---

# Previous: VM QEMU Logs Feature

## Feature: VM Logs Tab

Added a new "Logs" tab to the VM detail page in both QvDC and QHCI that displays QEMU/libvirt logs for troubleshooting VM issues.

### Problem Solved

When VMs fail to start or crash during operation, it's difficult to diagnose the issue without SSH access to the hypervisor host. Common issues like:
- Disk I/O errors ("No space left on device")
- CPU/memory configuration problems
- Network issues
- Boot failures

Are all logged in `/var/log/libvirt/qemu/{vm_name}.log` but weren't accessible from the UI.

### Implementation

#### 1. Node Daemon HTTP API (`agent/limiquantix-node/src/http_server.rs`)
- Added `GET /api/v1/vms/:vm_id/logs?lines=N` endpoint
- Returns JSON with:
  - `qemuLog`: Last N lines of the QEMU log
  - `logPath`: Path to the log file
  - `logSizeBytes`: Total file size
  - `linesReturned`: Number of lines returned
  - `truncated`: Whether the log was truncated
  - `lastModified`: Timestamp of last modification

#### 2. Node Daemon gRPC Service (`agent/limiquantix-node/src/service.rs`)
- Added `GetVMLogs` gRPC method
- Reads from `/var/log/libvirt/qemu/{vm_name}.log`

#### 3. QvDC Backend Proxy (`backend/internal/server/vm_rest.go`)
- Added `GET /api/vms/{id}/logs` endpoint
- Proxies request to the node daemon where the VM is running
- Looks up VM's node assignment and forwards request

#### 4. QvDC Frontend (`frontend/src/components/vm/VMLogsPanel.tsx`)
- New `VMLogsPanel` component with:
  - Line count selector (50, 100, 200, 500, 1000)
  - Auto-refresh toggle (5 second interval)
  - Manual refresh button
  - Copy to clipboard
  - Download as file
  - Error highlighting (red for errors, yellow for warnings)
  - Help text showing common issues to look for

#### 5. QvDC VM Detail Page (`frontend/src/pages/VMDetail.tsx`)
- Added "Logs" tab between "Monitoring" and "Events"
- Displays `VMLogsPanel` component

#### 6. QHCI Frontend (`quantix-host-ui/src/components/vm/VMLogsPanel.tsx`)
- Same component adapted for QHCI (direct node daemon access)

#### 7. QHCI VM Detail Page (`quantix-host-ui/src/pages/VMDetail.tsx`)
- Added "Logs" tab to the tab list
- Added `FileText` icon import

### Files Changed

```
frontend/src/components/vm/VMLogsPanel.tsx (NEW)
frontend/src/pages/VMDetail.tsx (MODIFIED)
quantix-host-ui/src/components/vm/VMLogsPanel.tsx (NEW)
quantix-host-ui/src/pages/VMDetail.tsx (MODIFIED)
backend/internal/server/vm_rest.go (MODIFIED)
backend/internal/server/server.go (MODIFIED)
agent/limiquantix-node/src/http_server.rs (MODIFIED - previous session)
agent/limiquantix-node/src/service.rs (MODIFIED - previous session)
agent/limiquantix-proto/proto/node_daemon.proto (MODIFIED - previous session)
```

### Usage

1. Navigate to a VM's detail page
2. Click the "Logs" tab
3. Select number of lines to display (default: 100)
4. Enable auto-refresh if monitoring a running VM
5. Look for highlighted errors (red) and warnings (yellow)
6. Copy or download logs for sharing

### Common Issues Highlighted

- **IO error** - Disk space full or storage issues
- **terminating on signal** - VM was force-stopped
- **permission denied** - File/device access issues
- **timeout** - Network or storage latency

---

## Previous Workflow States

(Moved to completed_workflow.md)
