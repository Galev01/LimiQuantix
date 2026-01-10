# Storage Pool Host Assignment

**Document ID:** 000057  
**Date:** January 11, 2026  
**Scope:** Storage Pool management, VM placement, Host assignment

## Overview

This document describes the storage pool host assignment feature, which allows administrators to control which hypervisor nodes have access to specific storage pools. This is essential for proper VM placement, as VMs can only be created on nodes that have access to their configured storage pool.

## Concepts

### Storage Pool Assignment

A **storage pool assignment** links a storage pool to one or more hypervisor nodes:

- **Shared storage** (NFS, Ceph): Can be assigned to multiple nodes simultaneously
- **Local storage** (LocalDir, LVM): Typically assigned to a single node

### VM Placement Constraints

When creating a VM:
1. User selects a storage pool for the VM's virtual disks
2. Only nodes assigned to that storage pool can host the VM
3. If "Auto Placement" is enabled, the scheduler only considers eligible nodes

## API Changes

### New RPCs in `StoragePoolService`

```protobuf
// Assign a storage pool to a specific node
rpc AssignPoolToNode(AssignPoolToNodeRequest) returns (StoragePool);

// Remove a storage pool assignment from a node  
rpc UnassignPoolFromNode(UnassignPoolFromNodeRequest) returns (StoragePool);

// List files inside a storage pool's mount path
rpc ListPoolFiles(ListPoolFilesRequest) returns (ListPoolFilesResponse);
```

### Updated `StoragePoolSpec`

```protobuf
message StoragePoolSpec {
  // ... existing fields ...
  
  // Assigned node IDs - nodes that have access to this storage pool
  repeated string assigned_node_ids = 7;
}
```

### File Listing Types

```protobuf
message ListPoolFilesRequest {
  string pool_id = 1;
  string path = 2;  // Relative path within the pool (empty for root)
}

message ListPoolFilesResponse {
  repeated PoolFileEntry entries = 1;
  string current_path = 2;
}

message PoolFileEntry {
  string name = 1;
  string path = 2;  // Full path relative to pool root
  bool is_directory = 3;
  uint64 size_bytes = 4;
  string modified_at = 5;  // ISO 8601 timestamp
  string file_type = 6;    // "qcow2", "iso", "vmdk", "directory", etc.
  string permissions = 7;  // Unix-style permissions string
}
```

## Domain Changes

### `StoragePool` Domain Object

Added methods to `domain.StoragePool`:

```go
// IsAssignedToNode returns true if the pool is assigned to the given node
func (p *StoragePool) IsAssignedToNode(nodeID string) bool

// AssignToNode adds a node to the assigned nodes list
func (p *StoragePool) AssignToNode(nodeID string) bool

// UnassignFromNode removes a node from the assigned nodes list  
func (p *StoragePool) UnassignFromNode(nodeID string) bool

// GetAssignedNodeIDs returns the list of assigned node IDs
func (p *StoragePool) GetAssignedNodeIDs() []string

// IsSharedStorage returns true if the backend is shared (NFS, Ceph)
func (p *StoragePool) IsSharedStorage() bool
```

## Frontend Changes

### Storage Pool Detail Page

New page at `/storage/pools/:id` with:

1. **Overview** - Pool status, capacity metrics, usage bar
2. **Files tab** - File browser for navigating pool contents
3. **Nodes tab** - Assign/unassign nodes to the pool
4. **Settings tab** - View pool configuration details

### VM Creation Wizard Updates

The storage selection step now:

1. Shows which nodes have access to each pool
2. Displays a warning badge if selected pool is "Not available on selected host"
3. Shows an error banner if host/pool are incompatible

### React Hooks

New hooks in `useStorage.ts`:

```typescript
// Assign a pool to a node
export function useAssignPoolToNode()

// Unassign a pool from a node
export function useUnassignPoolFromNode()

// List files in a storage pool
export function usePoolFiles(poolId: string, path = '', enabled = true)
```

## Node Daemon Changes

### File Listing Implementation

The node daemon implements `ListStoragePoolFiles` to:

1. Resolve the pool's mount path
2. Validate the requested path is within the pool mount (prevent directory traversal)
3. Read directory contents asynchronously
4. Return file metadata including size, modification time, type, and permissions

Security measures:
- Path sanitization (strips leading `/`, rejects `..`)
- Canonical path validation (ensures path stays within mount)

## Usage Examples

### Assign Pool to Node (Frontend)

```typescript
const assignToNode = useAssignPoolToNode();

// Assign pool to node
await assignToNode.mutateAsync({
  poolId: 'pool-123',
  nodeId: 'node-456'
});
```

### Check Pool Compatibility (Frontend)

```typescript
const pool = useStoragePool(poolId);
const selectedHostId = formData.hostId;

// Check if host has access
const hasAccess = pool.assignedNodeIds.length === 0 || 
                  pool.assignedNodeIds.includes(selectedHostId);
```

### Browse Pool Files (Frontend)

```typescript
const { data: files } = usePoolFiles(poolId, currentPath);

// Navigate to subfolder
const handleNavigate = (path: string) => {
  setCurrentPath(path);
};
```

## Migration Notes

Existing storage pools will have an empty `assigned_node_ids` list. This means:
- They are accessible from all nodes by default
- Administrators should explicitly assign pools to nodes for stricter control

## Related Documents

- [000001-vm-model-design.md](../adr/000001-vm-model-design.md) - VM placement and scheduling
- [000003-storage-model-design.md](../adr/000003-storage-model-design.md) - Storage pool architecture
