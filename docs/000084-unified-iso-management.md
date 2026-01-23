# Unified ISO Management System

**Document ID:** 000084  
**Date:** January 23, 2026  
**Scope:** ISO/OVA management across QHCI (host) and QvDC (control plane)

## Overview

This document describes the design and implementation of a unified ISO management system that:
1. Aligns ISO upload experiences between QHCI and QvDC
2. Syncs ISO metadata from QHCI hosts to QvDC control plane
3. Supports hierarchical folder organization (e.g., `/windows/windows10/win10_21h2.iso`)
4. Integrates with storage pools for flexible storage placement
5. Provides a unified ISO picker for the Create VM wizard

## Current State

### QHCI (Node Daemon - Rust)

**Upload endpoint:** `POST /api/v1/storage/upload`

```rust
// Current implementation in http_server.rs
async fn upload_image(
    State(state): State<Arc<AppState>>,
    Query(params): Query<UploadImageParams>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, ...>
```

**Limitations:**
- No folder organization
- No OS metadata tracking
- No sync to control plane
- Simple response: `{ success, filename, size_bytes, path }`

### QvDC (Control Plane - Go)

**Image model:** `backend/internal/domain/storage.go`

```go
type Image struct {
    ID          string
    Name        string
    Description string
    ProjectID   string
    Labels      map[string]string
    Spec        ImageSpec
    Status      ImageStatus
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type ImageSpec struct {
    Format       ImageFormat
    Visibility   ImageVisibility
    OS           OSInfo
    Requirements ImageRequirements
}

type ImageStatus struct {
    Phase            ImagePhase
    SizeBytes        uint64
    VirtualSizeBytes uint64
    ProgressPercent  uint32
    Checksum         string
    ErrorMessage     string
    StoragePoolID    string
    Path             string
    NodeID           string
}
```

**Limitations:**
- No folder path support
- In-memory repository only
- No sync from QHCI uploads

## Design

### 1. Extended Image Model

Add folder path support to the Image domain model:

```go
// backend/internal/domain/storage.go
type ImageStatus struct {
    // ... existing fields ...
    
    // FolderPath is the virtual folder path for organization
    // e.g., "/windows/windows10" or "/linux/ubuntu"
    FolderPath string `json:"folder_path,omitempty"`
}
```

### 2. ISO Metadata Sync Structure

QHCI sends this to QvDC when an ISO is uploaded/changed:

```rust
// agent/limiquantix-node/src/iso_manager.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IsoMetadata {
    pub id: String,              // UUID
    pub name: String,            // Display name (sanitized filename)
    pub filename: String,        // Actual filename on disk
    pub folder_path: String,     // Virtual folder path
    pub size_bytes: u64,
    pub format: String,          // "iso", "img"
    pub storage_pool_id: Option<String>,
    pub path: String,            // Full absolute path on disk
    pub checksum: Option<String>,
    pub os_family: Option<String>,
    pub os_distribution: Option<String>,
    pub os_version: Option<String>,
    pub created_at: i64,         // Unix timestamp
}
```

### 3. Sync Protocol

Extend `state_watcher.rs` with image change detection:

```rust
// New event type
pub enum IsoChangeEvent {
    Created(IsoMetadata),
    Updated { iso: IsoMetadata, previous: IsoMetadata },
    Deleted { id: String, path: String },
}
```

New control plane endpoint:

```go
// POST /limiquantix.storage.v1.ImageService/NotifyImageChange
type NotifyImageChangeRequest struct {
    NodeId    string
    Image     *ImageInfo
    EventType int32  // 1=Created, 2=Updated, 3=Deleted
    Timestamp int64
}
```

### 4. Folder Organization

Folders are **virtual** - derived from image metadata, not physical directories on disk.

**Benefits:**
- Users can organize ISOs without moving files
- Same ISO can appear in multiple views
- Easy reorganization via metadata update

**Folder Path Format:**
- Root: `/`
- Single level: `/windows`
- Nested: `/windows/server/2022`
- Max depth: 5 levels

**Default folders:**
- `/windows` - Windows ISOs
- `/linux` - Linux distributions
- `/other` - Misc ISOs

### 5. Storage Pool Integration

ISOs can be stored on any storage pool:

```
Pool: "fast-nvme" (/data/nvme)
  └── iso/
      ├── windows10.iso
      └── ubuntu-24.04.iso

Pool: "bulk-hdd" (/data/hdd)
  └── iso/
      └── large-archive.iso
```

**Upload with pool selection:**
```
POST /api/v1/storage/upload?pool_id=fast-nvme&folder=/windows
```

### 6. API Endpoints

#### QHCI (Rust) - New/Updated Endpoints

```rust
// List all ISOs with metadata
GET /api/v1/images
// Response: { images: [IsoMetadata, ...] }

// Upload ISO with folder
POST /api/v1/storage/upload?pool_id=...&folder=/windows/10
// Request: multipart/form-data with file
// Response: IsoMetadata

// Move ISO to folder
POST /api/v1/images/{id}/move
// Request: { folder_path: "/linux/ubuntu" }
// Response: IsoMetadata

// Delete ISO
DELETE /api/v1/images/{id}

// List folders (computed from images)
GET /api/v1/images/folders
// Response: { folders: ["/", "/windows", "/linux", ...] }
```

#### QvDC (Go) - New/Updated Endpoints

```go
// List all images (existing, enhanced)
GET /api/v1/images
// Now includes folder_path and filters

// List by folder
GET /api/v1/images?folder=/windows

// Move image to folder
POST /api/v1/images/{id}/move
// Request: { "folder_path": "/linux/ubuntu" }

// Create folder (creates folder metadata)
POST /api/v1/images/folders
// Request: { "path": "/windows/server" }

// List folder tree
GET /api/v1/images/folders

// Receive sync from QHCI
POST /limiquantix.storage.v1.ImageService/NotifyImageChange
```

### 7. Frontend UI Changes

#### QHCI Host UI (`quantix-host-ui`)

**StorageImages.tsx** - Enhanced with:
- Folder tree sidebar
- Create folder button
- Drag-and-drop to organize
- Storage pool selector on upload

#### QvDC Dashboard (`frontend`)

**ImageLibraryLayout.tsx** - Enhanced with:
- Folder navigation (breadcrumb + tree)
- Filter by node/pool
- Shows sync status from hosts
- Unified view of all cluster ISOs

#### VM Create Wizard

**ISO Picker component:**
- Tree view of folders
- Search across all ISOs
- Shows node location
- Filter by OS family

## Implementation Plan

### Phase 1: Backend Data Model (Priority: High)

1. **Go (QvDC):**
   - Add `FolderPath` to `ImageStatus` in `domain/storage.go`
   - Add folder-related methods to `ImageRepository`
   - Update proto definitions if needed

2. **Rust (QHCI):**
   - Create `IsoMetadata` struct
   - Add folder tracking to upload handler
   - Store metadata in local JSON file

### Phase 2: Sync Protocol (Priority: High)

1. **Rust (state_watcher.rs):**
   - Add ISO file watcher
   - Detect new/modified/deleted ISOs
   - Send `NotifyImageChange` to control plane

2. **Go (image_service.go):**
   - Implement `NotifyImageChange` handler
   - Upsert images from node notifications

### Phase 3: API Endpoints (Priority: Medium)

1. Implement move/folder endpoints in both QHCI and QvDC
2. Add folder listing/creation
3. Update upload to accept folder parameter

### Phase 4: Frontend (Priority: Medium)

1. Update QHCI StorageImages page
2. Update QvDC Image Library
3. Create unified ISO picker component
4. Integrate into VM create wizard

## File Changes Summary

### Backend (Go)

| File | Changes |
|------|---------|
| `backend/internal/domain/storage.go` | Add `FolderPath` to `ImageStatus` |
| `backend/internal/services/storage/image_service.go` | Add `NotifyImageChange`, folder methods |
| `backend/internal/services/storage/image_repository.go` | Add folder queries |
| `backend/internal/server/image_handler.go` | Add move/folder endpoints |

### Node Daemon (Rust)

| File | Changes |
|------|---------|
| `agent/limiquantix-node/src/iso_manager.rs` | **NEW** - ISO metadata management |
| `agent/limiquantix-node/src/state_watcher.rs` | Add ISO sync logic |
| `agent/limiquantix-node/src/http_server.rs` | Update upload, add move/list endpoints |

### Frontend

| File | Changes |
|------|---------|
| `quantix-host-ui/src/pages/StorageImages.tsx` | Add folder UI, enhanced upload |
| `frontend/src/pages/images/AllImagesPage.tsx` | Add folder navigation |
| `frontend/src/components/vm/ISOPicker.tsx` | **NEW** - Unified ISO selector |

## Testing

1. **Unit tests:**
   - Folder path validation
   - Metadata serialization
   - Repository queries

2. **Integration tests:**
   - Upload with folder on QHCI
   - Sync to QvDC
   - Folder operations

3. **E2E tests:**
   - Upload ISO on QHCI → appears in QvDC
   - Move ISO between folders
   - Select ISO in VM create wizard

## Deployment

After implementation:

```bash
# Build and publish QHCI components
./scripts/publish-update.sh --channel dev --version 0.0.x

# Build and publish QvDC components  
./scripts/publish-vdc-update.sh --channel dev --version 0.0.x
```
