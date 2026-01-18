# Workflow State

## Active Task: State Reconciliation System Implementation

**Date:** January 18, 2026
**Status:** Proto + Code Implementation Complete - Needs Proto Generation

### Overview
Implementing automatic state synchronization between Node Daemon (QHCI hosts) and Control Plane (QvDC) using an agent-push model with eventual consistency.

### Completed Work

#### Phase 1: Proto API Extensions ✅
- Added `SyncFullState`, `NotifyVMChange`, `NotifyStorageChange` RPCs to `node_service.proto`
- Added `state_hash` to `UpdateHeartbeatRequest`
- Added `request_full_sync` to `UpdateHeartbeatResponse`
- Added `LOST`, `TERMINATED` states to `VmStatus.PowerState` enum
- Added `VMOrigin` enum and `origin`, `is_managed` fields to `VirtualMachine`
- Added new message types: `SyncFullStateRequest/Response`, `VMChangeNotification`, `VMChangeAck`, etc.

#### Phase 2: Rust Agent Implementation ✅
- Created `state_watcher.rs` module with:
  - 2-second polling interval for responsive UI
  - UUID validation (skips nil/transient UUIDs)
  - Change detection (Created, Updated, Deleted events)
  - Minimal state hash calculation (`{id}:{state}:{count}`)
  - Immediate poll trigger support for mutations
- Updated `registration.rs` with:
  - Full state sync via StateWatcher
  - 0-5s startup jitter (thundering herd protection)
  - Heartbeat with state hash and `request_full_sync` handling
- Updated `server.rs` to wire StateWatcher into registration
- Updated `service.rs` with `trigger_immediate_poll()` calls after VM mutations

#### Phase 3: Go Backend Implementation ✅
- Updated `domain/vm.go` with:
  - `VMStateLost`, `VMStateTerminated` states
  - `VMOrigin` type (`control-plane`, `host-discovered`, `imported`)
  - `Origin`, `IsManaged` fields on `VirtualMachine`
  - `LastSeen`, `LostReason`, `LostAt` fields on `VMStatus`
- Implemented `SyncFullState` handler (Status-only updates)
- Implemented `NotifyVMChange` handler with race protection
- Implemented `handleVMDeleted` with LOST/TERMINATED state handling
- Updated `UpdateHeartbeat` to handle state_hash and return `request_full_sync`

### Next Steps

**1. Generate Proto Code (Required)**
```bash
cd proto && buf generate
# OR
make proto
```

**2. Database Migration (Required)**
Create migration to add new columns to `virtual_machines` table:
```sql
ALTER TABLE virtual_machines ADD COLUMN origin VARCHAR(50) DEFAULT 'control-plane';
ALTER TABLE virtual_machines ADD COLUMN is_managed BOOLEAN DEFAULT true;
ALTER TABLE virtual_machines ADD COLUMN last_seen TIMESTAMP;
ALTER TABLE virtual_machines ADD COLUMN lost_reason TEXT;
ALTER TABLE virtual_machines ADD COLUMN lost_at TIMESTAMP;
```

**3. Build and Test**
```bash
# Backend
cd backend && go build ./...

# Agent (on Linux with libvirt)
cd agent && cargo build --release -p limiquantix-node --features libvirt
```

### Key Design Decisions

1. **Polling vs Events**: Using 2-second polling (simpler, reliable) over libvirt events
2. **Spec vs Status Separation**: Agent only reports Status, never overwrites Spec
3. **Race Protection**: NotifyVMChange checks DB first, preserves Origin/ProjectID/IsManaged
4. **Thundering Herd Protection**: Random 0-5s jitter before SyncFullState
5. **State Hash**: Minimal input (id:state:count) for performance
6. **LOST State**: Managed VMs deleted outside CP are marked LOST (not deleted)

### Files Modified

**Proto:**
- `proto/limiquantix/compute/v1/node_service.proto` - New RPCs + messages
- `proto/limiquantix/compute/v1/vm.proto` - LOST/TERMINATED states, Origin/IsManaged

**Rust Agent:**
- `agent/limiquantix-node/src/state_watcher.rs` (NEW)
- `agent/limiquantix-node/src/registration.rs`
- `agent/limiquantix-node/src/server.rs`
- `agent/limiquantix-node/src/service.rs`
- `agent/limiquantix-node/src/main.rs`

**Go Backend:**
- `backend/internal/services/node/service.go` - New handlers
- `backend/internal/domain/vm.go` - New states and fields

---

## Previous Tasks

### Node Registration IP Fix (Completed)
- Fixed management_ip detection and registration

### QvDC Database Fix (Completed)
- Fixed database initialization and migrations
