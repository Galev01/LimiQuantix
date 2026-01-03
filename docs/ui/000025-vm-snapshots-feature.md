# 000025 - VM Snapshots Feature

**Document ID:** 000025  
**Category:** UI / Feature Implementation  
**Status:** Implemented  
**Created:** January 4, 2026  

---

## Overview

This document describes the VM Snapshot feature implementation across the full stack - from the React frontend UI to the Go control plane backend and Rust Node Daemon integration. Snapshots allow users to capture the state of a VM at a specific point in time, enabling easy recovery and rollback.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React + TypeScript)                      │
│  ┌──────────────────────┐    ┌─────────────────────┐    ┌────────────────┐  │
│  │   VMDetail.tsx       │    │  useSnapshots.ts    │    │ api-client.ts  │  │
│  │   Snapshots Tab      │───▶│  React Query Hooks  │───▶│ HTTP Client    │  │
│  └──────────────────────┘    └─────────────────────┘    └────────┬───────┘  │
└─────────────────────────────────────────────────────────────────┬───────────┘
                                                                  │ HTTP/gRPC
┌─────────────────────────────────────────────────────────────────▼───────────┐
│                         Control Plane (Go)                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      VMService (service.go)                           │   │
│  │  CreateSnapshot() | ListSnapshots() | RevertToSnapshot() | Delete()   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      DaemonClient (daemon_client.go)                  │   │
│  │  CreateSnapshot() | ListSnapshots() | RevertSnapshot() | Delete()     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┬──────────┘
                                                                   │ gRPC
┌──────────────────────────────────────────────────────────────────▼──────────┐
│                         Node Daemon (Rust)                                   │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      NodeDaemonService (service.rs)                   │   │
│  │  create_snapshot() | list_snapshots() | revert_snapshot() | delete()  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      LibvirtBackend (backend.rs)                      │   │
│  │           virsh snapshot-create-as | snapshot-list | etc.             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                            ┌───────────────┐
                            │  libvirt/KVM  │
                            └───────────────┘
```

---

## Frontend Implementation

### Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/lib/api-client.ts` | Modified | Added snapshot API methods |
| `frontend/src/hooks/useSnapshots.ts` | Created | React Query hooks for snapshots |
| `frontend/src/pages/VMDetail.tsx` | Modified | Full Snapshots tab implementation |

### API Client (`api-client.ts`)

Added snapshot methods to the VM API:

```typescript
export interface ApiSnapshot {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  memoryIncluded?: boolean;
  quiesced?: boolean;
  createdAt?: string;
  sizeBytes?: number;
}

export interface ListSnapshotsResponse {
  snapshots: ApiSnapshot[];
}

export const vmApi = {
  // ... existing methods ...
  
  async createSnapshot(data: {
    vmId: string;
    name: string;
    description?: string;
    includeMemory?: boolean;
    quiesce?: boolean;
  }): Promise<ApiSnapshot>;

  async listSnapshots(vmId: string): Promise<ListSnapshotsResponse>;

  async revertToSnapshot(vmId: string, snapshotId: string, startAfterRevert?: boolean): Promise<ApiVM>;

  async deleteSnapshot(vmId: string, snapshotId: string): Promise<void>;
};
```

### React Query Hooks (`useSnapshots.ts`)

```typescript
// Query keys for cache invalidation
export const snapshotKeys = {
  all: ['snapshots'] as const,
  lists: () => [...snapshotKeys.all, 'list'] as const,
  list: (vmId: string) => [...snapshotKeys.lists(), vmId] as const,
};

// Hooks
export function useSnapshots(vmId: string, enabled = true);
export function useCreateSnapshot();
export function useRevertToSnapshot();
export function useDeleteSnapshot();

// Helper
export function formatSnapshotSize(bytes?: number): string;
```

### Snapshots Tab UI (`VMDetail.tsx`)

The Snapshots tab includes:

1. **Create Snapshot Form**
   - Collapsible form panel
   - Name input (required)
   - Description input (optional)
   - "Include memory state" checkbox (hot snapshot)
   - "Quiesce filesystem" checkbox (requires guest agent)
   - Create and Cancel buttons

2. **Snapshot List**
   - Card for each snapshot with:
     - Name and description
     - Creation timestamp
     - Size (formatted)
     - Memory/Quiesced badges
   - Action buttons:
     - Revert (with confirmation)
     - Delete (with confirmation)

3. **Empty State**
   - Displayed when no snapshots exist
   - Quick action to create first snapshot

4. **Info Panel**
   - Explains snapshot behavior
   - Warnings about reverting

---

## Backend Implementation

### Files Modified

| File | Action | Description |
|------|--------|-------------|
| `backend/internal/services/vm/service.go` | Modified | Added 4 snapshot methods |
| `backend/internal/services/vm/converter.go` | Modified | Added `SnapshotToProto()` |
| `backend/internal/domain/vm.go` | Modified | Added `Snapshot` struct |

### Domain Model (`vm.go`)

```go
type Snapshot struct {
    ID             string    `json:"id"`
    VMID           string    `json:"vm_id"`
    Name           string    `json:"name"`
    Description    string    `json:"description"`
    ParentID       string    `json:"parent_id,omitempty"`
    MemoryIncluded bool      `json:"memory_included"`
    Quiesced       bool      `json:"quiesced"`
    SizeBytes      uint64    `json:"size_bytes"`
    CreatedAt      time.Time `json:"created_at"`
}
```

### Service Methods (`service.go`)

#### CreateSnapshot

```go
func (s *Service) CreateSnapshot(
    ctx context.Context,
    req *connect.Request[computev1.CreateSnapshotRequest],
) (*connect.Response[computev1.Snapshot], error)
```

Flow:
1. Validate request (VM ID and name required)
2. Get VM from repository
3. Verify VM is assigned to a node
4. Get Node Daemon client for the assigned node
5. Call `client.CreateSnapshot()` on Node Daemon
6. Return snapshot info to frontend

#### ListSnapshots

```go
func (s *Service) ListSnapshots(
    ctx context.Context,
    req *connect.Request[computev1.ListSnapshotsRequest],
) (*connect.Response[computev1.ListSnapshotsResponse], error)
```

Flow:
1. Validate request (VM ID required)
2. Get VM from repository
3. If VM has no node, return empty list
4. Get snapshots from Node Daemon
5. Convert and return snapshot list

#### RevertToSnapshot

```go
func (s *Service) RevertToSnapshot(
    ctx context.Context,
    req *connect.Request[computev1.RevertToSnapshotRequest],
) (*connect.Response[computev1.VirtualMachine], error)
```

Flow:
1. Validate request (VM ID and snapshot ID required)
2. Get VM from repository
3. Call `client.RevertSnapshot()` on Node Daemon
4. Optionally start VM if `startAfterRevert` is true
5. Return updated VM

#### DeleteSnapshot

```go
func (s *Service) DeleteSnapshot(
    ctx context.Context,
    req *connect.Request[computev1.DeleteSnapshotRequest],
) (*connect.Response[emptypb.Empty], error)
```

Flow:
1. Validate request (VM ID and snapshot ID required)
2. Get VM from repository
3. Call `client.DeleteSnapshot()` on Node Daemon
4. Return success

---

## Node Daemon Implementation

### DaemonClient Methods (`daemon_client.go`)

The Go control plane uses `DaemonClient` to communicate with the Rust Node Daemon:

```go
func (c *DaemonClient) CreateSnapshot(ctx context.Context, vmID, name, description string, quiesce bool) (*nodev1.SnapshotResponse, error)
func (c *DaemonClient) ListSnapshots(ctx context.Context, vmID string) (*nodev1.ListSnapshotsResponse, error)
func (c *DaemonClient) RevertSnapshot(ctx context.Context, vmID, snapshotID string) error
func (c *DaemonClient) DeleteSnapshot(ctx context.Context, vmID, snapshotID string) error
```

### Libvirt Backend (`backend.rs`)

The Rust Node Daemon uses `virsh` commands as a fallback (since the virt crate v0.4 doesn't expose snapshot APIs directly):

```rust
// Create snapshot
async fn create_snapshot(&self, vm_id: &str, name: &str, description: &str) -> Result<SnapshotInfo> {
    // Uses: virsh snapshot-create-as <domain> --name <name> --description <desc>
}

// List snapshots
async fn list_snapshots(&self, vm_id: &str) -> Result<Vec<SnapshotInfo>> {
    // Uses: virsh snapshot-list <domain> --name
}

// Revert to snapshot
async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
    // Uses: virsh snapshot-revert <domain> <snapshot>
}

// Delete snapshot
async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
    // Uses: virsh snapshot-delete <domain> <snapshot>
}
```

---

## Proto Definitions

### VMService (`compute/v1/vm_service.proto`)

```protobuf
service VMService {
  // ... other methods ...
  
  // Snapshot Operations
  rpc CreateSnapshot(CreateSnapshotRequest) returns (Snapshot);
  rpc ListSnapshots(ListSnapshotsRequest) returns (ListSnapshotsResponse);
  rpc RevertToSnapshot(RevertToSnapshotRequest) returns (VirtualMachine);
  rpc DeleteSnapshot(DeleteSnapshotRequest) returns (google.protobuf.Empty);
}

message CreateSnapshotRequest {
  string vm_id = 1;
  string name = 2;
  string description = 3;
  bool include_memory = 4;
  bool quiesce = 5;
}

message ListSnapshotsRequest {
  string vm_id = 1;
}

message ListSnapshotsResponse {
  repeated Snapshot snapshots = 1;
}

message RevertToSnapshotRequest {
  string vm_id = 1;
  string snapshot_id = 2;
  bool start_after_revert = 3;
}

message DeleteSnapshotRequest {
  string vm_id = 1;
  string snapshot_id = 2;
}
```

### Snapshot Message (`compute/v1/vm.proto`)

```protobuf
message Snapshot {
  string id = 1;
  string name = 2;
  string description = 3;
  string parent_id = 4;
  bool memory_included = 5;
  bool quiesced = 6;
  google.protobuf.Timestamp created_at = 7;
  uint64 size_bytes = 8;
}
```

### NodeDaemonService (`node/v1/node_daemon.proto`)

```protobuf
service NodeDaemonService {
  // ... other methods ...
  
  rpc CreateSnapshot(CreateSnapshotRequest) returns (SnapshotResponse);
  rpc RevertSnapshot(RevertSnapshotRequest) returns (google.protobuf.Empty);
  rpc DeleteSnapshot(DeleteSnapshotRequest) returns (google.protobuf.Empty);
  rpc ListSnapshots(VMIdRequest) returns (ListSnapshotsResponse);
}
```

---

## Error Handling

### Frontend

- API errors are caught and logged to console
- React Query handles retries (default 3 attempts)
- User feedback via error states in UI

### Backend (Go)

- Validates all required fields
- Returns appropriate gRPC error codes:
  - `InvalidArgument`: Missing required fields
  - `NotFound`: VM doesn't exist
  - `FailedPrecondition`: VM not assigned to node
  - `Unavailable`: Cannot connect to Node Daemon
  - `Internal`: Node Daemon operation failed

### Node Daemon (Rust)

- Verifies VM domain exists before operations
- Captures virsh stderr for error messages
- Returns gRPC `Internal` error with details

---

## Bug Fix: virsh Command

During implementation, a bug was discovered where the Rust libvirt backend was using an invalid virsh option:

**Before (broken):**
```rust
.args(["snapshot-create", vm_id, "--xmldesc", "/dev/stdin"])
```

**After (fixed):**
```rust
.args(["snapshot-create-as", vm_id, "--name", name, "--description", description])
```

The `--xmldesc` option doesn't exist in virsh. The correct approach is to use `snapshot-create-as` which accepts name and description directly.

---

## Testing

### Manual Testing Steps

1. **Create Snapshot**
   - Navigate to VM Detail → Snapshots tab
   - Click "Create Snapshot"
   - Enter name and optional description
   - Click Create
   - Verify snapshot appears in list

2. **List Snapshots**
   - Navigate to VM Detail → Snapshots tab
   - Verify all snapshots are displayed with correct info

3. **Revert to Snapshot**
   - Click "Revert" on a snapshot
   - Confirm in dialog
   - Verify VM state is restored

4. **Delete Snapshot**
   - Click delete button on a snapshot
   - Confirm in dialog
   - Verify snapshot is removed from list

### Prerequisites

- VM must be assigned to a node
- Node Daemon must be running on the host
- libvirt must be installed and accessible

---

## Future Improvements

1. **Snapshot Tree View**: Display parent-child relationships between snapshots
2. **Schedule Snapshots**: Create snapshots on a schedule
3. **Snapshot Policies**: Automatic cleanup of old snapshots
4. **Memory Snapshot Support**: Include VM memory state in snapshots
5. **Quiesced Snapshots**: Integration with guest agent for filesystem consistency

---

## Related Documents

- [000032 - VMService to Node Daemon Integration](../node-daemon/000032-vmservice-node-daemon-integration.md)
- [000010 - VM Detail Page](000010-vm-detail-page.md)
- [000007 - Hypervisor Integration ADR](../adr/000007-hypervisor-integration.md)
