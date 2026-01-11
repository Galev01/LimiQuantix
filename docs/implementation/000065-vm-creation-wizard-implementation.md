# VM Creation Wizard Implementation

**Document ID:** 000065  
**Date:** January 11, 2026  
**Status:** Completed  
**Related Documents:** [000064-vm-creation-wizard-plan.md](../planning/000064-vm-creation-wizard-plan.md)

## Overview

This document details the implementation of the VM Creation Wizard enhancements for both Quantix-vDC (centralized dashboard) and QHCI (host UI). The implementation adds folder organization, customization specifications, enhanced scheduling, and agent installation capabilities.

---

## Phase 1: Fix UUID 'default' Error in VM Service

### Problem
The VM service was receiving `"default"` as a project ID from the frontend, but PostgreSQL expected a valid UUID, causing creation failures.

### Solution
Normalized the `project_id` in the VM service to convert empty strings or `"default"` to a predefined UUID.

### Files Modified

**`backend/internal/services/vm/service.go`**

```go
// 2. Use default project if not specified
projectID := req.Msg.ProjectId
if projectID == "" || projectID == "default" {
    projectID = "00000000-0000-0000-0000-000000000001" // Default project
}
```

### Testing
```bash
# Test VM creation with default project
curl -X POST http://localhost:8080/api/v1/vms \
  -H "Content-Type: application/json" \
  -d '{"name":"test-vm","project_id":"default","spec":{...}}'
```

---

## Phase 2.1: Add Folder Support

### Overview
Implemented hierarchical folder organization for VMs, similar to VMware vSphere's folder structure.

### Database Schema

**Migration:** `backend/migrations/000006_vm_folders.up.sql`

```sql
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    project_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_folder_path_per_project UNIQUE (project_id, path)
);

-- Add folder_id to virtual_machines
ALTER TABLE virtual_machines
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

-- Default root folder
INSERT INTO folders (id, name, parent_id, path, project_id)
VALUES ('00000000-0000-0000-0000-000000000002', '/', NULL, '/', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (project_id, path) DO NOTHING;
```

### Domain Model

**`backend/internal/domain/folder.go`**

```go
type Folder struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    ParentID  string    `json:"parent_id,omitempty"`
    Path      string    `json:"path"`
    ProjectID string    `json:"project_id"`
    CreatedAt time.Time `json:"created_at"`
    UpdatedAt time.Time `json:"updated_at"`
}

func NewFolder(name, projectID, parentID, path string) (*Folder, error) {
    if name == "" || projectID == "" || path == "" {
        return nil, ErrInvalidArgument
    }
    now := time.Now()
    return &Folder{
        ID:        uuid.New().String(),
        Name:      name,
        ParentID:  parentID,
        Path:      path,
        ProjectID: projectID,
        CreatedAt: now,
        UpdatedAt: now,
    }, nil
}
```

### Repository Layer

**`backend/internal/repository/postgres/folder_repository.go`**

Implements CRUD operations:
- `Create(ctx, folder)` - Create new folder
- `Get(ctx, id)` - Retrieve folder by ID
- `List(ctx, projectID)` - List all folders in a project
- `Update(ctx, folder)` - Update folder metadata
- `Delete(ctx, id)` - Delete folder (cascades to children)

### Service Layer

**`backend/internal/services/folder/service.go`**

Provides business logic:
- Path validation and normalization
- Parent-child relationship management
- Duplicate path prevention
- Cascade deletion handling

### Proto Definitions

**`proto/limiquantix/compute/v1/folder.proto`**

```protobuf
message Folder {
  string id = 1;
  string name = 2;
  string parent_id = 3;
  string path = 4;
  string project_id = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
}
```

**`proto/limiquantix/compute/v1/folder_service.proto`**

```protobuf
service FolderService {
  rpc CreateFolder(CreateFolderRequest) returns (Folder);
  rpc GetFolder(GetFolderRequest) returns (Folder);
  rpc ListFolders(ListFoldersRequest) returns (ListFoldersResponse);
  rpc UpdateFolder(UpdateFolderRequest) returns (Folder);
  rpc DeleteFolder(DeleteFolderRequest) returns (google.protobuf.Empty);
}
```

### VM Integration

**`backend/internal/domain/vm.go`**

```go
type VirtualMachine struct {
    ID              string            `json:"id"`
    Name            string            `json:"name"`
    ProjectID       string            `json:"project_id"`
    FolderID        string            `json:"folder_id"` // Added
    // ... rest of fields
}
```

**`proto/limiquantix/compute/v1/vm.proto`**

```protobuf
message VirtualMachine {
  string id = 1;
  string name = 2;
  string project_id = 3;
  string folder_id = 12; // Added
  // ... rest of fields
}
```

### Testing
```bash
# Run migrations
cd backend && go run ./cmd/migrate up

# Test folder creation
curl -X POST http://localhost:8080/api/v1/folders \
  -H "Content-Type: application/json" \
  -d '{"name":"Production","project_id":"00000000-0000-0000-0000-000000000001","path":"/Production"}'

# List folders
curl http://localhost:8080/api/v1/folders?project_id=00000000-0000-0000-0000-000000000001
```

---

## Phase 2.2: Add Customization Specification Support

### Overview
Implemented reusable customization templates for guest OS configuration (timezone, hostname, agent installation, cloud-init).

### Database Schema

**Migration:** `backend/migrations/000007_customization_specs.up.sql`

```sql
CREATE TABLE IF NOT EXISTS customization_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    project_id UUID NOT NULL,
    os_family VARCHAR(50) NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    hostname VARCHAR(255) NOT NULL,
    install_agent BOOLEAN NOT NULL DEFAULT FALSE,
    user_data TEXT,
    meta_data TEXT,
    network_config TEXT,
    ssh_keys JSONB DEFAULT '[]',
    admin_password TEXT,
    labels JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_customization_spec_name_per_project UNIQUE (project_id, name)
);
```

### Domain Model

**`backend/internal/domain/customization_spec.go`**

```go
type CustomizationSpec struct {
    ID            string            `json:"id"`
    Name          string            `json:"name"`
    Description   string            `json:"description"`
    ProjectID     string            `json:"project_id"`
    OSFamily      string            `json:"os_family"` // "Linux", "Windows"
    Timezone      string            `json:"timezone"`
    Hostname      string            `json:"hostname"` // Template: "{{.VMName}}-{{.Random}}"
    InstallAgent  bool              `json:"install_agent"`
    UserData      string            `json:"user_data,omitempty"` // Base64 cloud-init
    MetaData      string            `json:"meta_data,omitempty"`
    NetworkConfig string            `json:"network_config,omitempty"`
    SSHKeys       []string          `json:"ssh_keys,omitempty"`
    AdminPassword string            `json:"admin_password,omitempty"` // Hashed
    Labels        map[string]string `json:"labels,omitempty"`
    CreatedAt     time.Time         `json:"created_at"`
    UpdatedAt     time.Time         `json:"updated_at"`
}
```

### Use Cases

1. **Linux Server Template**
   - OS Family: Linux
   - Timezone: America/New_York
   - Hostname: `{{.VMName}}-{{.Random}}`
   - Install Agent: true
   - SSH Keys: [admin_key, backup_key]

2. **Windows Desktop Template**
   - OS Family: Windows
   - Timezone: America/Los_Angeles
   - Hostname: `WIN-{{.Random}}`
   - Install Agent: true
   - Admin Password: (hashed)

3. **Development VM Template**
   - OS Family: Linux
   - Timezone: UTC
   - Hostname: `dev-{{.VMName}}`
   - Install Agent: false
   - User Data: (custom cloud-init with dev tools)

### Testing
```bash
# Create customization spec
curl -X POST http://localhost:8080/api/v1/customization-specs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Linux-Production",
    "project_id": "00000000-0000-0000-0000-000000000001",
    "os_family": "Linux",
    "timezone": "America/New_York",
    "hostname": "{{.VMName}}-{{.Random}}",
    "install_agent": true,
    "ssh_keys": ["ssh-rsa AAAAB3..."]
  }'
```

---

## Phase 2.3: Add Scheduling Support

### Overview
Added scheduling metadata to VM domain model for tracking placement decisions.

### Changes

**`backend/internal/domain/vm.go`**

```go
type VirtualMachine struct {
    // ... existing fields
    ScheduledAt *time.Time `json:"scheduled_at,omitempty"` // When scheduler placed VM
}
```

This field tracks:
- When the scheduler last evaluated placement
- Whether a VM needs rescheduling (nil = pending)
- Audit trail for DRS decisions

---

## Phase 3: Scheduler Enhancement

### Overview
Enhanced the VM scheduler with storage pool affinity checking and scoring.

### Storage Pool Affinity

**Problem:** VMs with specific storage pool requirements were being scheduled on nodes without access to those pools.

**Solution:** Added storage pool awareness to the scheduler.

### Repository Interface

**`backend/internal/scheduler/repository.go`**

```go
type StoragePoolRepository interface {
    // ListByNodeID returns all storage pools assigned to a specific node.
    ListByNodeID(ctx context.Context, nodeID string) ([]*domain.StoragePool, error)
}
```

### Scheduler Updates

**`backend/internal/scheduler/scheduler.go`**

```go
type Scheduler struct {
    nodeRepo        NodeRepository
    vmRepo          VMRepository
    storagePoolRepo StoragePoolRepository // Added
    config          Config
    logger          *zap.Logger
}

func New(nodeRepo NodeRepository, vmRepo VMRepository, storagePoolRepo StoragePoolRepository, config Config, logger *zap.Logger) *Scheduler {
    return &Scheduler{
        nodeRepo:        nodeRepo,
        vmRepo:          vmRepo,
        storagePoolRepo: storagePoolRepo,
        config:          config,
        logger:          logger.With(zap.String("component", "scheduler")),
    }
}
```

### Predicate: Storage Pool Affinity

**Hard Constraint** - Node MUST have all required storage pools.

```go
func (s *Scheduler) checkStoragePoolAffinity(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) bool {
    if s.storagePoolRepo == nil {
        return true // No storage pool repo, skip check
    }

    // Get all storage pools on the target node
    nodePools, err := s.storagePoolRepo.ListByNodeID(ctx, node.ID)
    if err != nil {
        s.logger.Warn("Failed to list storage pools for node", zap.String("node_id", node.ID), zap.Error(err))
        return false // Treat as unfeasible if we can't get pool info
    }

    nodePoolIDs := make(map[string]struct{})
    for _, p := range nodePools {
        nodePoolIDs[p.ID] = struct{}{}
    }

    // Check each disk's required storage pool
    for _, disk := range spec.GetDisks() {
        if disk.GetStoragePoolId() != "" {
            if _, found := nodePoolIDs[disk.GetStoragePoolId()]; !found {
                s.logger.Debug("Node does not have required storage pool for disk",
                    zap.String("node_id", node.ID),
                    zap.String("disk_id", disk.GetId()),
                    zap.String("required_pool_id", disk.GetStoragePoolId()),
                )
                return false
            }
        }
    }
    return true
}
```

### Scoring: Storage Pool Affinity

**Soft Preference** - Prefer nodes with better storage pool availability.

```go
func (s *Scheduler) scoreStoragePoolAffinity(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) float64 {
    if s.storagePoolRepo == nil {
        return 0.0
    }

    nodePools, err := s.storagePoolRepo.ListByNodeID(ctx, node.ID)
    if err != nil {
        s.logger.Warn("Failed to list storage pools for node for scoring", zap.String("node_id", node.ID), zap.Error(err))
        return 0.0
    }

    nodePoolIDs := make(map[string]struct{})
    for _, p := range nodePools {
        nodePoolIDs[p.ID] = struct{}{}
    }

    // Calculate score based on how many required pools are present
    var affinityScore float64
    requiredPoolsCount := 0
    matchedPoolsCount := 0

    for _, disk := range spec.GetDisks() {
        if disk.GetStoragePoolId() != "" {
            requiredPoolsCount++
            if _, found := nodePoolIDs[disk.GetStoragePoolId()]; found {
                matchedPoolsCount++
            }
        }
    }

    if requiredPoolsCount > 0 {
        affinityScore = (float64(matchedPoolsCount) / float64(requiredPoolsCount)) * 10.0 // Max 10 points
    }

    return affinityScore
}
```

### Integration

**`backend/internal/scheduler/scheduler.go`**

```go
func (s *Scheduler) checkPredicates(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) bool {
    // ... existing predicates
    if !s.checkStoragePoolAffinity(ctx, node, spec) {
        return false
    }
    return true
}

func (s *Scheduler) scoreNode(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) float64 {
    var score float64
    // ... existing scoring
    score += s.scoreStoragePoolAffinity(ctx, node, spec)
    return score
}
```

### Testing
```bash
# Test VM scheduling with storage pool requirements
curl -X POST http://localhost:8080/api/v1/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-vm",
    "project_id": "default",
    "spec": {
      "cpu": {"cores": 2},
      "memory": {"size_mib": 4096},
      "disks": [{
        "id": "disk-0",
        "size_bytes": 10737418240,
        "storage_pool_id": "ceph-pool-1"
      }]
    }
  }'

# Verify placement on node with ceph-pool-1
```

---

## Phase 4: QvDC Frontend Enhancements

### Phase 4.1: Folder Selection Step

**File:** `frontend/src/hooks/useFolders.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';
import { ListFoldersRequest } from '@/lib/api/limiquantix/compute/v1/folder_service_pb';
import { Folder } from '@/lib/api/limiquantix/compute/v1/folder_pb';

export interface FolderUI extends Folder {
  path: string;
}

export function useFolders(projectId?: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['folders', projectId],
    queryFn: async () => {
      const request = new ListFoldersRequest();
      if (projectId) {
        request.setProjectId(projectId);
      }
      const response = await client.folderService.listFolders(request);
      return response.folders.map(f => ({
        ...f,
        path: f.path || '/',
      }));
    },
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
  });

  return {
    folders: data || [],
    isLoading,
    error,
  };
}
```

**File:** `frontend/src/components/vm/VMCreationWizard.tsx`

```typescript
// Add hook
const { folders, isLoading: foldersLoading } = useFolders(formData.projectId);

// Pass to StepFolder
<StepFolder
  formData={formData}
  updateFormData={updateFormData}
  folders={folders}
  foldersLoading={foldersLoading}
/>

// StepFolder component
function StepFolder({
  formData,
  updateFormData,
  folders,
  foldersLoading,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  folders: FolderUI[];
  foldersLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-text-primary mb-4">
        Folder & Organization
      </h3>
      
      <div className="space-y-4">
        <Label htmlFor="folder">Folder *</Label>
        <select
          id="folder"
          className="form-select"
          value={formData.folderId}
          onChange={(e) => updateFormData({ folderId: e.target.value })}
        >
          {foldersLoading ? (
            <option disabled>Loading folders...</option>
          ) : (
            folders.map(folder => (
              <option key={folder.id} value={folder.id}>
                {folder.path}
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}
```

### Phase 4.2: Timezone Selector

**File:** `frontend/src/components/vm/VMCreationWizard.tsx`

Expanded timezone options from 5 to 50+ timezones:

```typescript
<select
  id="timezone"
  className="form-select"
  value={formData.timezone}
  onChange={(e) => updateFormData({ timezone: e.target.value })}
>
  <optgroup label="Americas">
    <option value="America/New_York">Eastern Time (New York)</option>
    <option value="America/Chicago">Central Time (Chicago)</option>
    <option value="America/Denver">Mountain Time (Denver)</option>
    <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
    <option value="America/Toronto">Toronto</option>
    <option value="America/Vancouver">Vancouver</option>
    <option value="America/Mexico_City">Mexico City</option>
    <option value="America/Sao_Paulo">São Paulo</option>
    <option value="America/Buenos_Aires">Buenos Aires</option>
  </optgroup>
  
  <optgroup label="Europe">
    <option value="Europe/London">London (GMT)</option>
    <option value="Europe/Paris">Paris (CET)</option>
    <option value="Europe/Berlin">Berlin (CET)</option>
    <option value="Europe/Rome">Rome (CET)</option>
    <option value="Europe/Madrid">Madrid (CET)</option>
    <option value="Europe/Amsterdam">Amsterdam (CET)</option>
    <option value="Europe/Brussels">Brussels (CET)</option>
    <option value="Europe/Vienna">Vienna (CET)</option>
    <option value="Europe/Zurich">Zurich (CET)</option>
    <option value="Europe/Stockholm">Stockholm (CET)</option>
    <option value="Europe/Copenhagen">Copenhagen (CET)</option>
    <option value="Europe/Oslo">Oslo (CET)</option>
    <option value="Europe/Helsinki">Helsinki (EET)</option>
    <option value="Europe/Athens">Athens (EET)</option>
    <option value="Europe/Istanbul">Istanbul (TRT)</option>
    <option value="Europe/Moscow">Moscow (MSK)</option>
  </optgroup>
  
  <optgroup label="Asia">
    <option value="Asia/Dubai">Dubai (GST)</option>
    <option value="Asia/Kolkata">India (IST)</option>
    <option value="Asia/Shanghai">China (CST)</option>
    <option value="Asia/Tokyo">Tokyo (JST)</option>
    <option value="Asia/Seoul">Seoul (KST)</option>
    <option value="Asia/Singapore">Singapore (SGT)</option>
    <option value="Asia/Hong_Kong">Hong Kong (HKT)</option>
    <option value="Asia/Bangkok">Bangkok (ICT)</option>
    <option value="Asia/Jakarta">Jakarta (WIB)</option>
    <option value="Asia/Manila">Manila (PHT)</option>
  </optgroup>
  
  <optgroup label="Pacific">
    <option value="Australia/Sydney">Sydney (AEDT)</option>
    <option value="Australia/Melbourne">Melbourne (AEDT)</option>
    <option value="Australia/Brisbane">Brisbane (AEST)</option>
    <option value="Australia/Perth">Perth (AWST)</option>
    <option value="Pacific/Auckland">Auckland (NZDT)</option>
  </optgroup>
  
  <optgroup label="Other">
    <option value="UTC">UTC</option>
  </optgroup>
</select>
```

### Phase 4.3: Customization Specifications

**File:** `frontend/src/hooks/useCustomizationSpecs.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/api';
import { ListCustomizationSpecsRequest } from '@/lib/api/limiquantix/compute/v1/customization_spec_service_pb';
import { CustomizationSpec } from '@/lib/api/limiquantix/compute/v1/customization_spec_pb';

export interface CustomizationSpecUI extends CustomizationSpec {}

export function useCustomizationSpecs(projectId?: string) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['customizationSpecs', projectId],
    queryFn: async () => {
      const request = new ListCustomizationSpecsRequest();
      if (projectId) {
        request.setProjectId(projectId);
      }
      const response = await client.customizationSpecService.listCustomizationSpecs(request);
      return response.customizationSpecs;
    },
    refetchInterval: 60 * 1000, // Refetch every minute
  });

  return {
    customizationSpecs: data || [],
    isLoading,
    error,
  };
}
```

**File:** `frontend/src/components/vm/VMCreationWizard.tsx`

```typescript
// Add hook
const { customizationSpecs, isLoading: customizationSpecsLoading } = useCustomizationSpecs(formData.projectId);

// Pass to StepCustomization
<StepCustomization
  formData={formData}
  updateFormData={updateFormData}
  customizationSpecs={customizationSpecs}
  customizationSpecsLoading={customizationSpecsLoading}
/>

// StepCustomization component
function StepCustomization({
  formData,
  updateFormData,
  customizationSpecs,
  customizationSpecsLoading,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  customizationSpecs: CustomizationSpecUI[];
  customizationSpecsLoading: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Label htmlFor="customizationSpec">Customization Specification</Label>
        <select
          id="customizationSpec"
          className="form-select"
          value={formData.customizationSpecId}
          onChange={(e) => updateFormData({ customizationSpecId: e.target.value })}
        >
          <option value="">-- None (manual configuration) --</option>
          {customizationSpecsLoading ? (
            <option disabled>Loading specifications...</option>
          ) : (
            customizationSpecs.map(spec => (
              <option key={spec.id} value={spec.id}>
                {spec.name} ({spec.osFamily})
              </option>
            ))
          )}
        </select>
      </div>
    </div>
  );
}
```

---

## Phase 5: QHCI Frontend - Cloud Image Support

### Overview
Enhanced the QHCI (Host UI) VM creation wizard with boot media selection, including cloud image support.

### Cloud Images Hook

**File:** `quantix-host-ui/src/hooks/useImages.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { nodeDaemonClient } from '@/lib/api';
import { ListCloudImagesRequest } from '@/lib/api/limiquantix/node/v1/node_daemon_pb';
import { CloudImage } from '@/lib/api/limiquantix/node/v1/node_daemon_pb';

export interface CloudImageUI extends CloudImage {}

export function useCloudImages() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['cloudImages'],
    queryFn: async () => {
      const request = new ListCloudImagesRequest();
      const response = await nodeDaemonClient.listCloudImages(request);
      return response.images;
    },
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  return {
    cloudImages: data || [],
    isLoading,
    error,
  };
}
```

### Wizard Enhancement

**File:** `quantix-host-ui/src/components/vm/CreateVMWizard.tsx`

Added new "Boot Media" step:

```typescript
// Add to steps array
const steps: { id: Step; title: string; icon: React.ReactNode }[] = [
  { id: 'basics', title: 'Basics', icon: <Server className="w-4 h-4" /> },
  { id: 'boot-media', title: 'Boot Media', icon: <Disc className="w-4 h-4" /> }, // Added
  { id: 'compute', title: 'Compute', icon: <Cpu className="w-4 h-4" /> },
  // ... rest
];

// Add state
const [bootMediaType, setBootMediaType] = useState<'none' | 'cloud-image' | 'iso'>('cloud-image');
const [selectedCloudImageId, setSelectedCloudImageId] = useState('');
const [selectedISOPath, setSelectedISOPath] = useState('');

// Add hook
const { cloudImages, isLoading: cloudImagesLoading } = useCloudImages();

// Add validation
case 'boot-media':
  if (bootMediaType === 'cloud-image') {
    return selectedCloudImageId !== '';
  }
  if (bootMediaType === 'iso') {
    return selectedISOPath !== '';
  }
  return true; // 'none' is valid

// Update VM creation request
const request: CreateVmRequest = {
  name: vmName,
  cpuCores,
  memoryMib,
  disks: disks.map(d => {
    if (bootMediaType === 'cloud-image' && selectedCloudImageId) {
      const selectedImage = cloudImages.find(img => img.id === selectedCloudImageId);
      if (selectedImage && d.bootable) {
        return { ...d, backingFile: selectedImage.path };
      }
    }
    return d;
  }),
  nics,
  cloudInit: useCloudInit ? cloudInit : undefined,
};

// Add UI
{currentStep === 'boot-media' && (
  <div className="space-y-6">
    <h3 className="text-lg font-semibold text-text-primary mb-4">Boot Media</h3>
    
    <div className="flex gap-4">
      <Button
        variant={bootMediaType === 'cloud-image' ? 'default' : 'outline'}
        onClick={() => setBootMediaType('cloud-image')}
      >
        Cloud Image
      </Button>
      <Button
        variant={bootMediaType === 'iso' ? 'default' : 'outline'}
        onClick={() => setBootMediaType('iso')}
      >
        ISO Image
      </Button>
      <Button
        variant={bootMediaType === 'none' ? 'default' : 'outline'}
        onClick={() => setBootMediaType('none')}
      >
        None
      </Button>
    </div>

    {bootMediaType === 'cloud-image' && (
      <div className="space-y-4">
        <Label htmlFor="cloudImage">Select Cloud Image *</Label>
        <select
          id="cloudImage"
          className="form-select"
          value={selectedCloudImageId}
          onChange={(e) => setSelectedCloudImageId(e.target.value)}
        >
          <option value="">-- Select an image --</option>
          {cloudImagesLoading ? (
            <option disabled>Loading images...</option>
          ) : (
            cloudImages.map(image => (
              <option key={image.id} value={image.id}>
                {image.name} ({formatBytes(image.sizeBytes)})
              </option>
            ))
          )}
        </select>
      </div>
    )}
  </div>
)}
```

### Features
- **Cloud Image Selection**: Browse available cloud images (Ubuntu, Debian, CentOS, etc.)
- **ISO Mounting**: Mount ISO files for custom installations
- **Empty Disk**: Create VM without boot media
- **Automatic Cloud-Init**: Enables cloud-init when cloud image is selected
- **Backing File**: Uses cloud image as backing file for boot disk (CoW)

---

## Phase 6: Agent Installation via Cloud-Init

### Overview
Enhanced the cloud-init generator to optionally install the Quantix guest agent during VM provisioning.

### Agent Installation Flow

1. **VM Creation** → User enables "Install Quantix Agent" in wizard
2. **Cloud-Init Generation** → Hypervisor includes agent installation commands
3. **First Boot** → Cloud-init downloads and installs agent
4. **Agent Start** → Agent connects to control plane and registers VM

### Hypervisor Changes

**File:** `agent/limiquantix-hypervisor/src/cloudinit.rs`

```rust
pub struct CloudInitConfig {
    // ... existing fields
    
    /// Whether to install the Quantix agent
    pub install_quantix_agent: bool,
    
    /// URL of the control plane for agent download
    pub control_plane_url: Option<String>,
}

impl CloudInitConfig {
    pub fn generate_default_user_data(&self) -> String {
        let mut lines = vec!["#cloud-config".to_string()];
        
        // ... existing hostname, users, ssh_keys, password logic
        
        // Common packages
        lines.push("package_update: true".to_string());
        lines.push("packages:".to_string());
        lines.push("  - qemu-guest-agent".to_string());
        
        lines.push("runcmd:".to_string());
        lines.push("  - systemctl enable qemu-guest-agent".to_string());
        lines.push("  - systemctl start qemu-guest-agent".to_string());

        // Quantix Agent Installation
        if self.install_quantix_agent {
            if let Some(control_plane_url) = &self.control_plane_url {
                info!("Including Quantix agent installation in cloud-init user-data");
                lines.push(format!("  - curl -o /tmp/quantix-agent {}/api/agent/linux-amd64", control_plane_url));
                lines.push("  - chmod +x /tmp/quantix-agent".to_string());
                lines.push(format!("  - /tmp/quantix-agent install --control-plane {}", control_plane_url));
                lines.push("  - systemctl enable limiquantix-agent".to_string());
                lines.push("  - systemctl start limiquantix-agent".to_string());
            } else {
                warn!("Quantix agent installation requested but control_plane_url is not set.");
            }
        }
        
        lines.join("\n")
    }
    
    /// Builder method for agent installation
    pub fn with_quantix_agent_install(mut self, install: bool) -> Self {
        self.install_quantix_agent = install;
        self
    }

    /// Builder method for control plane URL
    pub fn with_control_plane_url(mut self, url: impl Into<String>) -> Self {
        self.control_plane_url = Some(url.into());
        self
    }
}
```

### Usage Example

```rust
let cloud_init = CloudInitConfig::new()
    .with_hostname("prod-web-01")
    .with_timezone("America/New_York")
    .with_ssh_keys(vec!["ssh-rsa AAAAB3...".to_string()])
    .with_quantix_agent_install(true)
    .with_control_plane_url("https://quantix-vdc.example.com")
    .build();

let user_data = cloud_init.generate_default_user_data();
```

### Generated Cloud-Init

```yaml
#cloud-config
hostname: prod-web-01
timezone: America/New_York

users:
  - name: admin
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-rsa AAAAB3...

package_update: true
packages:
  - qemu-guest-agent

runcmd:
  - systemctl enable qemu-guest-agent
  - systemctl start qemu-guest-agent
  - curl -o /tmp/quantix-agent https://quantix-vdc.example.com/api/agent/linux-amd64
  - chmod +x /tmp/quantix-agent
  - /tmp/quantix-agent install --control-plane https://quantix-vdc.example.com
  - systemctl enable limiquantix-agent
  - systemctl start limiquantix-agent
```

### Agent Installation Steps

1. **Download**: `curl` fetches agent binary from control plane
2. **Permissions**: `chmod +x` makes binary executable
3. **Install**: Agent self-installs (creates systemd service, config)
4. **Enable**: Systemd service enabled for auto-start on boot
5. **Start**: Agent starts immediately and connects to control plane

### Security Considerations

- **HTTPS Required**: Control plane URL should use HTTPS in production
- **Binary Verification**: Future enhancement: verify agent binary signature
- **Network Access**: VM must have network access during first boot
- **Firewall**: Control plane must allow agent downloads (port 443)

---

## Migration Guide

### Running Migrations

```bash
# Windows (with Docker running)
cd backend
go mod tidy
go run ./cmd/migrate up

# Linux/macOS
cd backend
make migrate-up
```

### Generating Proto Code

```bash
# Install buf (if not installed)
# macOS: brew install bufbuild/buf/buf
# Linux: curl -sSL https://github.com/bufbuild/buf/releases/download/v1.62.1/buf-Linux-x86_64 -o buf && chmod +x buf && sudo mv buf /usr/local/bin/
# Windows: scoop install buf

# Generate code
cd proto
buf generate

# Or from project root
make proto
```

### Database Schema Verification

```bash
# Check current migration version
cd backend
go run ./cmd/migrate version

# Should output: version=7, dirty=false

# Verify tables exist
psql -h localhost -U limiquantix -d limiquantix -c "\dt"

# Should show:
# - folders
# - customization_specs
# - virtual_machines (with folder_id column)
```

---

## Testing

### End-to-End Test: VM Creation with All Features

```bash
# 1. Create a folder
curl -X POST http://localhost:8080/api/v1/folders \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production",
    "project_id": "00000000-0000-0000-0000-000000000001",
    "path": "/Production"
  }'

# 2. Create a customization spec
curl -X POST http://localhost:8080/api/v1/customization-specs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Linux-Production",
    "project_id": "00000000-0000-0000-0000-000000000001",
    "os_family": "Linux",
    "timezone": "America/New_York",
    "hostname": "{{.VMName}}-{{.Random}}",
    "install_agent": true,
    "ssh_keys": ["ssh-rsa AAAAB3..."]
  }'

# 3. Create a VM with folder and customization spec
curl -X POST http://localhost:8080/api/v1/vms \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prod-web-01",
    "project_id": "default",
    "folder_id": "<folder-id-from-step-1>",
    "customization_spec_id": "<spec-id-from-step-2>",
    "spec": {
      "cpu": {"cores": 4},
      "memory": {"size_mib": 8192},
      "disks": [{
        "id": "disk-0",
        "size_bytes": 107374182400,
        "storage_pool_id": "ceph-pool-1"
      }],
      "network_interfaces": [{
        "id": "nic-0",
        "network_id": "default-network"
      }]
    }
  }'

# 4. Verify VM placement
curl http://localhost:8080/api/v1/vms/<vm-id>

# Should show:
# - folder_id: <folder-id>
# - node_id: <scheduled-node-id>
# - scheduled_at: <timestamp>
# - power_state: RUNNING
```

### Frontend Testing

**QvDC (Dashboard):**
```bash
cd frontend
npm run dev
# Navigate to http://localhost:5174
# Click "Create VM"
# Verify all steps work:
# - Folder selection dropdown populated
# - Timezone selector has 50+ options
# - Customization spec dropdown populated
```

**QHCI (Host UI):**
```bash
cd quantix-host-ui
npm run dev
# Navigate to http://localhost:3001
# Click "Create VM"
# Verify boot media step:
# - Cloud image selection works
# - Images load from node daemon
# - Backing file applied to boot disk
```

---

## Performance Considerations

### Database Indexes

All critical queries are indexed:

```sql
-- Folders
CREATE INDEX idx_folders_project_id ON folders(project_id);
CREATE INDEX idx_folders_parent_id ON folders(parent_id);
CREATE INDEX idx_folders_path ON folders(path);

-- Customization Specs
CREATE INDEX idx_customization_specs_project_id ON customization_specs(project_id);

-- VMs
CREATE INDEX idx_virtual_machines_folder_id ON virtual_machines(folder_id);
```

### Query Optimization

- **Folder Listing**: Uses `project_id` index for fast filtering
- **VM Listing**: Can filter by `folder_id` for hierarchical views
- **Scheduler**: Storage pool affinity check is O(n) where n = number of disks

### Caching Strategy

- **Frontend**: React Query caches folders (30s) and customization specs (60s)
- **Backend**: Consider adding Redis cache for frequently accessed folders
- **Scheduler**: Storage pool data could be cached per node

---

## Security Considerations

### Folder Permissions

**Current:** All users in a project can see all folders.

**Future Enhancement:** Add folder-level permissions:
```sql
CREATE TABLE folder_permissions (
    folder_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    permission VARCHAR(20) NOT NULL, -- read, write, admin
    PRIMARY KEY (folder_id, user_id)
);
```

### Customization Spec Security

- **SSH Keys**: Stored in plain text (acceptable for public keys)
- **Admin Passwords**: MUST be hashed with bcrypt before storage
- **Cloud-Init User Data**: Can contain sensitive data, consider encryption at rest

### Agent Installation Security

- **Binary Integrity**: Future: Verify agent binary with SHA256 checksum
- **HTTPS Only**: Control plane URL must use HTTPS in production
- **Agent Authentication**: Agent should use JWT or API key to authenticate with control plane

---

## Future Enhancements

### Folder Features
- [ ] Nested folder creation UI (drag-and-drop)
- [ ] Folder-level permissions
- [ ] Bulk VM move between folders
- [ ] Folder templates (auto-apply settings to VMs)

### Customization Specs
- [ ] Windows support (Sysprep, Unattend.xml)
- [ ] Custom script execution
- [ ] Network configuration templates
- [ ] Variable interpolation ({{.VMName}}, {{.ProjectID}}, etc.)

### Scheduler
- [ ] Anti-affinity rules (don't place VMs on same node)
- [ ] Affinity rules (place VMs together)
- [ ] Cluster-level DRS (automatic load balancing)
- [ ] Storage pool capacity awareness

### Agent Installation
- [ ] Windows agent support
- [ ] Agent version management
- [ ] Automatic agent updates
- [ ] Agent health monitoring

---

## Troubleshooting

### Migration Errors

**Error:** `relation "folders" already exists`

**Solution:**
```bash
cd backend
go run ./cmd/migrate version
# If dirty=true:
go run ./cmd/migrate force <version>
go run ./cmd/migrate up
```

**Error:** `connection refused` (PostgreSQL not running)

**Solution:**
```bash
cd backend
docker compose up -d
sleep 5
go run ./cmd/migrate up
```

### Proto Generation Errors

**Error:** `buf: command not found`

**Solution:**
```bash
# Install buf
curl -sSL https://github.com/bufbuild/buf/releases/download/v1.62.1/buf-Linux-x86_64 -o buf
chmod +x buf
sudo mv buf /usr/local/bin/
```

### Frontend Hook Errors

**Error:** `Cannot find module '@/lib/api'`

**Solution:**
```bash
# Regenerate proto code
cd proto && buf generate

# Verify generated files exist
ls frontend/src/lib/api/limiquantix/compute/v1/
```

### Scheduler Not Placing VMs

**Check logs:**
```bash
# Backend logs
cd backend
go run ./cmd/controlplane 2>&1 | grep scheduler

# Look for:
# - "No feasible nodes found"
# - "Node does not have required storage pool"
# - "Insufficient resources"
```

**Solution:** Verify node has required storage pools:
```bash
curl http://localhost:8080/api/v1/nodes/<node-id>
curl http://localhost:8080/api/v1/storage-pools?node_id=<node-id>
```

---

## References

- [VM Creation Wizard Plan](../planning/000064-vm-creation-wizard-plan.md)
- [Protocol Buffer Guide](../000006-proto-and-build-system-guide.md)
- [Scheduler Architecture](../adr/000008-vm-scheduler-design.md)
- [Cloud-Init Documentation](https://cloudinit.readthedocs.io/)
- [VMware vSphere Folders](https://docs.vmware.com/en/VMware-vSphere/8.0/vsphere-vcenter-esxi-management/GUID-031BDB12-D3B2-4E2D-80E6-604F304B4D0C.html)

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-11 | 1.0 | Initial implementation documentation |
