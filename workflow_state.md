# Workflow State

## Current Status: COMPLETED - VM Creation Wizard Implementation

## Latest Workflow: VM Creation Wizard Complete Implementation

**Date:** January 11, 2026
**Plan Reference:** `vm_creation_wizard_implementation_2d0083d6.plan.md`

### Phase Overview - ALL COMPLETED ✅

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Bug Fix - UUID "default" error | ✅ Completed |
| Phase 2.1 | Backend - Folder support | ✅ Completed |
| Phase 2.2 | Backend - Customization specs | ✅ Completed |
| Phase 2.3 | Backend - Scheduling support | ✅ Completed |
| Phase 3 | Scheduler enhancement | ✅ Completed |
| Phase 4.1 | QvDC - Folder selection | ✅ Completed |
| Phase 4.2 | QvDC - Timezone selector | ✅ Completed |
| Phase 4.3 | QvDC - Customization specs | ✅ Completed |
| Phase 5 | QHCI - Cloud image support | ✅ Completed |
| Phase 6 | Agent installation via cloud-init | ✅ Completed |

---

## Summary of Changes

### Backend Changes

1. **VM Service Bug Fix** (`backend/internal/services/vm/service.go`)
   - Fixed UUID normalization for "default" project ID

2. **Folder Support** (NEW)
   - `backend/internal/domain/folder.go` - Folder domain model
   - `backend/migrations/000006_vm_folders.up.sql` - Database schema with default folders
   - `backend/internal/repository/postgres/folder_repository.go` - CRUD operations
   - `backend/internal/services/folder/service.go` - Connect-RPC service
   - Proto files: `proto/limiquantix/compute/v1/folder.proto`, `folder_service.proto`

3. **Customization Specifications** (NEW)
   - `backend/internal/domain/customization_spec.go` - Spec domain model with Linux/Windows support
   - `backend/migrations/000007_customization_specs.up.sql` - Database schema with defaults

4. **Scheduler Enhancement** (`backend/internal/scheduler/scheduler.go`)
   - Added `StoragePoolRepository` interface
   - Added `NewWithStoragePools()` constructor
   - Added `checkStoragePoolAffinity()` for hard constraints
   - Added `scoreStoragePoolAffinity()` for soft preferences

5. **VM Domain Model** (`backend/internal/domain/vm.go`)
   - Added `FolderID` field
   - Added `ScheduledAt` field for scheduled creation
   - Added `CustomizationSpecID` field

6. **VM Repository** (`backend/internal/repository/postgres/vm_repository.go`)
   - Updated Create/Get/List to handle folder_id column

### Frontend Changes (QvDC)

1. **Folder Hook** (NEW): `frontend/src/hooks/useFolders.ts`
   - Fetch folders from API with fallback to static data
   - Create, update, delete folder mutations
   - Folder tree support

2. **Customization Specs Hook** (NEW): `frontend/src/hooks/useCustomizationSpecs.ts`
   - Fetch specs from API with fallback catalog
   - Linux and Windows spec types

3. **VM Creation Wizard** (`frontend/src/components/vm/VMCreationWizard.tsx`)
   - Integrated `useFolders` hook for dynamic folder selection
   - Integrated `useCustomizationSpecs` hook for specs
   - Enhanced timezone selector with 50+ timezones grouped by region
   - Updated StepFolder and StepCustomization components

### Frontend Changes (QHCI)

1. **Images Hook** (NEW): `quantix-host-ui/src/hooks/useImages.ts`
   - Cloud image catalog with 6 common images
   - Fetch images from node daemon API

2. **Create VM Wizard** (`quantix-host-ui/src/components/vm/CreateVMWizard.tsx`)
   - Added new "Boot Media" step
   - Cloud image selection with visual picker
   - ISO path input option
   - Empty disk option for PXE boot
   - Auto-enable cloud-init when cloud image selected
   - Backing file passed to disk spec

### Agent Changes

1. **Cloud-Init Generator** (`agent/limiquantix-hypervisor/src/cloudinit.rs`)
   - Added `install_agent` flag
   - Added `control_plane_url` for agent download
   - Added `timezone` support
   - Enhanced `generate_default_user_data()` to include agent installation
   - New builder methods: `with_agent_install()`, `with_timezone()`

---

## Key Files Changed

| Area | Files |
|------|-------|
| Backend Domain | `domain/folder.go`, `domain/customization_spec.go`, `domain/vm.go` |
| Backend Migrations | `000006_vm_folders.up.sql`, `000007_customization_specs.up.sql` |
| Backend Repository | `folder_repository.go`, `vm_repository.go` |
| Backend Services | `folder/service.go`, `vm/service.go` |
| Backend Scheduler | `scheduler.go`, `repository.go` |
| Proto | `folder.proto`, `folder_service.proto`, `vm.proto` |
| QvDC Frontend | `VMCreationWizard.tsx`, `useFolders.ts`, `useCustomizationSpecs.ts` |
| QHCI Frontend | `CreateVMWizard.tsx`, `useImages.ts` |
| Agent | `cloudinit.rs` |

---

## Next Steps

1. **Run Migrations**: Apply new database migrations
   ```bash
   cd backend && make migrate-up
   ```

2. **Regenerate Proto**: Generate code from new proto files
   ```bash
   make proto
   ```

3. **Test End-to-End**: Create a VM using cloud image with agent installation

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
│  │   ├── Cloud-init ISO generation with agent install                   │
│  │   └── VM creation with backing files for cloud images                │
│  ├── libvirt/QEMU for VM management                                     │
│  └── QHCI - Host UI (quantix-host-ui)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```
