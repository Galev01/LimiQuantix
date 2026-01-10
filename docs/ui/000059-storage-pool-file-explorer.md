# Storage Pool File Explorer

**Document ID:** 000059  
**Date:** January 11, 2026  
**Scope:** File browsing feature for storage pools

## Overview

The Storage Pool File Explorer allows administrators to browse files and directories within a storage pool directly from the Quantix-vDC dashboard. This is similar to VMware's "Browse Datastore" feature.

## Architecture

### Request Flow

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌─────────────┐
│   Frontend   │─────▶│   Backend    │─────▶│ Node Daemon  │─────▶│  Filesystem │
│  (React)     │      │   (Go)       │      │   (Rust)     │      │  (NFS/Local)│
└──────────────┘      └──────────────┘      └──────────────┘      └─────────────┘
     │                      │                     │                      │
     │  ListPoolFiles       │                     │                      │
     │  {poolId, path}      │                     │                      │
     ├─────────────────────▶│                     │                      │
     │                      │  gRPC               │                      │
     │                      │  ListStoragePoolFiles                      │
     │                      ├────────────────────▶│                      │
     │                      │                     │  tokio::fs::read_dir │
     │                      │                     ├─────────────────────▶│
     │                      │                     │◀─────────────────────┤
     │                      │◀────────────────────┤                      │
     │◀─────────────────────┤                     │                      │
     │  PoolFileEntry[]     │                     │                      │
```

## API Definition

### Proto Messages

```protobuf
// Request
message ListPoolFilesRequest {
  string pool_id = 1;
  string path = 2;  // Relative path (empty = root)
}

// Response
message ListPoolFilesResponse {
  repeated PoolFileEntry entries = 1;
  string current_path = 2;
}

// File Entry
message PoolFileEntry {
  string name = 1;
  string path = 2;        // Relative to pool root
  bool is_directory = 3;
  uint64 size_bytes = 4;
  string modified_at = 5; // ISO 8601
  string file_type = 6;   // "qcow2", "directory", etc.
  string permissions = 7; // "755", "644"
}
```

### React Hook

```typescript
export function usePoolFiles(poolId: string, path = '', enabled = true) {
  return useQuery({
    queryKey: [...storageKeys.pools.detail(poolId), 'files', path],
    queryFn: async (): Promise<PoolFileEntry[]> => {
      const response = await poolClient.listPoolFiles({ poolId, path });
      return response.entries.map(entry => ({
        name: entry.name,
        path: entry.path,
        isDirectory: entry.isDirectory,
        sizeBytes: Number(entry.sizeBytes),
        modifiedAt: entry.modifiedAt,
        fileType: entry.fileType,
        permissions: entry.permissions,
      }));
    },
    enabled: enabled && !!poolId,
    staleTime: 10_000,
  });
}
```

## Security

### Path Traversal Prevention

The Node Daemon implements strict path validation:

```rust
// 1. Reject paths containing ".."
if clean_path.contains("..") {
    return Err(Status::invalid_argument("Invalid path: contains '..'"));
}

// 2. Canonicalize and verify bounds
let canonical_base = base_path.canonicalize()?;
let canonical_target = target_path.canonicalize()?;

if !canonical_target.starts_with(&canonical_base) {
    return Err(Status::invalid_argument("Path is outside pool mount"));
}
```

### Path Sanitization

1. Leading slashes stripped: `/folder/file` → `folder/file`
2. Double dots rejected: `../etc/passwd` → Error
3. Symlinks resolved and checked against base path

## File Types

The explorer recognizes these file types by extension:

| Extension | Type | Icon |
|-----------|------|------|
| (directory) | `directory` | `FolderOpen` |
| `.qcow2` | `qcow2` | `FileImage` |
| `.vmdk` | `vmdk` | `FileImage` |
| `.vhd`, `.vhdx` | `vhd` | `FileImage` |
| `.raw`, `.img` | `raw` | `FileImage` |
| `.iso` | `iso` | `FileArchive` |
| `.ova` | `ova` | `FileArchive` |
| `.ovf` | `ovf` | `File` |
| (other) | (extension) | `File` |

## UI Components

### Breadcrumb Navigation

```
Root  /  folder1  /  folder2  /  current
  ↑       ↑           ↑
 click  click       click
```

Each segment is clickable to navigate directly to that path.

### File List

```
┌──────────────────────────────────────────────────────────────────┐
│  📁 ..                                                           │
├──────────────────────────────────────────────────────────────────┤
│  📂 images/                                      2026-01-10 ▶    │
│  📂 volumes/                                     2026-01-09 ▶    │
│  💿 ubuntu-22.04.qcow2               2.5 GB     2026-01-08      │
│  📀 windows-server-2022.iso          4.8 GB     2026-01-05      │
└──────────────────────────────────────────────────────────────────┘
```

### Sorting

Files are sorted:
1. Directories first
2. Then alphabetically by name (case-insensitive)

```rust
entries.sort_by(|a, b| {
    match (a.is_directory, b.is_directory) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    }
});
```

## Storage Backend Behavior

### NFS Pools

- Mount path: `/mnt/storage/pools/{pool_id}` or custom mount point
- Files accessible immediately after mount
- Supports all standard POSIX operations

### Local Directory Pools

- Direct path access (e.g., `/var/lib/limiquantix/storage/local`)
- Fast performance, no network latency

### Ceph Pools (Future)

- Would use `ceph-fuse` mount or RBD image listing
- May show RBD images as virtual files

## Error Handling

| Error | Cause | Message |
|-------|-------|---------|
| `NOT_FOUND` | Pool doesn't exist | "Pool not found: {id}" |
| `NOT_FOUND` | Path doesn't exist | "Path not found: {path}" |
| `FAILED_PRECONDITION` | Pool has no mount | "Pool has no mount path" |
| `INVALID_ARGUMENT` | Path traversal | "Invalid path: contains '..'" |
| `INTERNAL` | IO error | "Failed to read directory: {error}" |

## Performance Considerations

1. **Lazy Loading**: Only loads current directory, not recursive
2. **Caching**: React Query caches results for 10 seconds
3. **Pagination**: Not currently implemented (loads all entries)
4. **Large Directories**: May need pagination for 1000+ files

## VMware Comparison

| VMware Datastore Browser | Quantix Pool Explorer |
|--------------------------|----------------------|
| Right-click → Browse Datastore | Click pool → Files tab |
| Java-based (slow) | Web-based (fast) |
| Upload/download/delete | Browse only (currently) |
| VMFS-specific | Backend-agnostic |

## Future Enhancements

### Planned Features

- [ ] **File upload** - Drag-and-drop to pool
- [ ] **File download** - Stream file to browser
- [ ] **Delete files** - With confirmation dialog
- [ ] **Create folder** - New directory creation
- [ ] **Rename** - Inline rename editing
- [ ] **Move/Copy** - Cross-pool operations
- [ ] **Search** - Find files by name pattern
- [ ] **Filtering** - By type, size, date

### API Extensions Needed

```protobuf
rpc UploadFile(stream UploadFileRequest) returns (PoolFileEntry);
rpc DownloadFile(DownloadFileRequest) returns (stream DownloadFileResponse);
rpc DeleteFile(DeleteFileRequest) returns (google.protobuf.Empty);
rpc CreateDirectory(CreateDirectoryRequest) returns (PoolFileEntry);
rpc RenameFile(RenameFileRequest) returns (PoolFileEntry);
```

## Related Documents

- [000057-storage-pool-host-assignment.md](../Storage/000057-storage-pool-host-assignment.md)
- [000058-storage-pool-details-page.md](000058-storage-pool-details-page.md)
- [000003-storage-model-design.md](../adr/000003-storage-model-design.md)
