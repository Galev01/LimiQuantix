# Workflow State

## Current Status: IN PROGRESS - VM Creation Wizard Implementation

## Latest Workflow: VM Creation Wizard Complete Implementation

**Date:** January 11, 2026
**Plan Reference:** `vm_creation_wizard_implementation_2d0083d6.plan.md`

### Phase Overview

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Bug Fix - UUID "default" error | ✅ Completed |
| Phase 2.1 | Backend - Folder support | 🔄 In Progress |
| Phase 2.2 | Backend - Customization specs | ⏳ Pending |
| Phase 2.3 | Backend - Scheduling support | ⏳ Pending |
| Phase 3 | Scheduler enhancement | ⏳ Pending |
| Phase 4 | QvDC Frontend enhancements | ⏳ Pending |
| Phase 5 | QHCI Frontend enhancements | ⏳ Pending |
| Phase 6 | Agent installation via cloud-init | ⏳ Pending |
| Phase 7 | End-to-End testing | ⏳ Pending |

---

### Phase 1: Bug Fix - UUID "default" Error ✅

**Issue:** The VM service only checked for empty projectID, but not for the string "default" which the frontend may send.

**Fix Applied:**
```go
// Before
if projectID == "" {
    projectID = "00000000-0000-0000-0000-000000000001"
}

// After
if projectID == "" || projectID == "default" {
    projectID = "00000000-0000-0000-0000-000000000001"
}
```

**File:** `backend/internal/services/vm/service.go`

---

### Phase 2.1: Folder Support (In Progress)

**Objective:** Add folder hierarchy for organizing VMs (like vSphere folders).

**Files to create/modify:**
1. `backend/internal/domain/folder.go` - Folder domain model
2. `backend/migrations/000006_vm_folders.up.sql` - Database schema
3. `backend/migrations/000006_vm_folders.down.sql` - Rollback
4. `backend/internal/repository/postgres/folder_repository.go` - Repository
5. `backend/internal/services/folder/service.go` - CRUD service
6. `backend/internal/domain/vm.go` - Add FolderID field
7. `proto/limiquantix/compute/v1/vm.proto` - Add folder_id to proto

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Quantix-vDC (Control Plane) - localhost:8080                           │
│  ├── Go backend with Connect-RPC + REST APIs                            │
│  ├── PostgreSQL, etcd, Redis (Docker)                                   │
│  └── React frontend (localhost:5173)                                    │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ gRPC / REST
                              │
┌─────────────────────────────────────────────────────────────────────────┐
│  Quantix-OS (Hypervisor Host)                                           │
│  ├── Rust Node Daemon (limiquantix-node)                                │
│  │   ├── Reports storage pool status in heartbeats                      │
│  │   └── Serves file listing for storage pools                          │
│  ├── libvirt/QEMU for VM management                                     │
│  └── QHCI - Host UI (quantix-host-ui)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```
