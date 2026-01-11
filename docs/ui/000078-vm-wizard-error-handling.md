# VM Creation Wizard Error Handling

**Document ID:** 000078  
**Date:** January 11, 2026  
**Scope:** Frontend VM Creation Wizard validation and error handling  
**Related:** [000015-vm-creation-wizard.md](./000015-vm-creation-wizard.md), [000027-error-handling-patterns.md](./000027-error-handling-patterns.md)

## Overview

This document describes the comprehensive error handling and validation system implemented for the VM Creation Wizard. The implementation addresses a critical issue where users could select cloud images that may not exist on the target hypervisor node, leading to VM creation failures.

## Problem Statement

Prior to this implementation, the VM Creation Wizard had several validation gaps:

1. **Cloud images** could be selected even if not downloaded on the target host
2. **Storage pools** could be selected even if inaccessible from the target host
3. **Field validation** was minimal with poor user feedback
4. **Access credentials** (password/SSH key) for cloud images were not enforced

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          VM Creation Wizard                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────────────┐  │
│  │  Step 1     │───►│  Step 5          │───►│  Step 6                │  │
│  │  Basic Info │    │  Boot Media      │    │  Storage               │  │
│  │             │    │                  │    │                        │  │
│  │  ✓ VM Name  │    │  ✓ Image Avail.  │    │  ✓ Pool Accessibility  │  │
│  │  ✓ Desc Len │    │  ✓ Access Method │    │  ✓ Disk Capacity       │  │
│  └─────────────┘    │  ✓ Password      │    └────────────────────────┘  │
│                     └──────────────────┘                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                   wizard-validation.ts                            │   │
│  │  validateVMName() | validatePassword() | validateStoragePool()   │   │
│  │  validateAccessMethod() | checkNodeResources() | etc...          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                   useImageAvailability Hook                       │   │
│  │  Checks download status per catalog image                         │   │
│  │  Returns: READY | DOWNLOADING | NOT_DOWNLOADED | ERROR            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Files

| File | Description |
|------|-------------|
| `frontend/src/components/vm/wizard-validation.ts` | Validation utility functions |
| `frontend/src/hooks/useImages.ts` | Image availability hook |
| `frontend/src/components/vm/VMCreationWizard.tsx` | Main wizard component |

## Validation Utilities

### Location: `frontend/src/components/vm/wizard-validation.ts`

This module exports validation functions for each field type:

### VM Name Validation

```typescript
validateVMName(name: string): ValidationResult
```

Rules:
- **Required**: Cannot be empty
- **Length**: 3-63 characters
- **Format**: Alphanumeric characters and dashes only
- **No leading/trailing dashes**: Cannot start or end with `-`
- **No leading numbers**: Cannot start with a digit

### Password Validation

```typescript
validatePassword(password: string, confirmPassword: string): ValidationResult
```

Rules:
- **Minimum length**: 8 characters
- **Match**: Must match confirmation

### SSH Key Validation

```typescript
validateSSHKey(key: string): ValidationResult
```

Rules:
- **Valid prefix**: Must start with `ssh-rsa`, `ssh-ed25519`, `ecdsa-sha2-*`, etc.
- **Key data length**: Minimum 100 characters for the base64 portion
- **Complete format**: Must have at least 2 space-separated parts

### Access Method Validation

```typescript
validateAccessMethod(
  hasPassword: boolean,
  hasSSHKeys: boolean,
  cloudImage?: CloudImage
): ValidationResult
```

For cloud images with cloud-init enabled, at least one access method is required.

### Storage Pool Validation

```typescript
validateStoragePool(
  pool: StoragePoolUI | undefined,
  nodeId: string | undefined,
  totalDiskSizeGib: number
): ValidationResult
```

Checks:
- Pool exists and is not in ERROR/DELETING state
- Pool is accessible from the selected node (if specific node selected)
- Total disk size does not exceed available capacity

### Node Resource Validation

```typescript
checkNodeResources(
  node: NodeInfo,
  cpuRequired: number,
  memoryRequiredMib: number
): NodeResourceCheck
```

Verifies sufficient CPU and memory available on the target node.

## Image Availability Hook

### Location: `frontend/src/hooks/useImages.ts`

```typescript
useImageAvailability(
  catalogIds: string[],
  nodeId?: string,
  enabled?: boolean
)
```

### Return Values

```typescript
{
  availabilityMap: Map<string, ImageAvailabilityResult>;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  getAvailability: (catalogId: string) => ImageAvailabilityResult | undefined;
  isAvailable: (catalogId: string) => boolean;
  isAnyDownloading: boolean;
}
```

### Status Types

| Status | Description | Visual Indicator |
|--------|-------------|------------------|
| `READY` | Downloaded and available | Green "Ready" badge |
| `DOWNLOADING` | Download in progress | Blue badge with progress % |
| `NOT_DOWNLOADED` | Needs to be downloaded | Yellow "Download required" badge |
| `ERROR` | Download failed | Red error indicator |

## Step-by-Step Validation

### Step 1: Basic Info

| Field | Validation | Error Message |
|-------|------------|---------------|
| VM Name | Required, 3-63 chars, alphanumeric + dashes | "VM name must be 3-63 characters..." |
| VM Name | No leading/trailing dash | "VM name cannot start or end with a dash" |
| VM Name | No leading number | "VM name cannot start with a number" |
| Description | Max 500 chars | "Description cannot exceed 500 characters" |

### Step 2: Placement

| Scenario | Validation | Error Message |
|----------|------------|---------------|
| No nodes | Allow proceeding | Uses auto-placement |
| Node offline | Phase != READY | Next button disabled |
| Node selected | Must have cluster | "Select a cluster" |

### Step 4: Hardware

| Field | Validation | Error Message |
|-------|------------|---------------|
| CPU Cores | 1-128 | Next button disabled |
| Memory | 512 MiB - 1 TiB | Next button disabled |

### Step 5: Boot Media (Cloud Image)

| Scenario | Validation | Error Message |
|----------|------------|---------------|
| Image not downloaded | Availability check | Warning banner with download button |
| No access method | Password OR SSH key | "No password or SSH key configured" |
| Password mismatch | Confirm != Password | "Passwords do not match" |
| Password too short | Min 8 chars | "Password should be at least 8 characters" |

### Step 6: Storage

| Scenario | Validation | Error Message |
|----------|------------|---------------|
| Pool not on node | assignedNodeIds check | "Host not compatible with selected storage pool" |
| Insufficient space | Capacity check | "Total disk size exceeds available pool capacity" |
| No storage pools | Empty list | "No storage pools available" |

## UI Components

### FieldError Component

Inline error display for form fields:

```tsx
function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-1 mt-1 text-error text-xs">
      <AlertCircle className="w-3 h-3" />
      {error}
    </div>
  );
}
```

### Image Availability Badge

Visual indicator for cloud image status:

```tsx
{imageAvailable ? (
  <Badge variant="success" size="sm">
    <CheckCircle className="w-3 h-3" />
    Ready
  </Badge>
) : imageDownloading ? (
  <Badge variant="info" size="sm">
    <Loader2 className="w-3 h-3 animate-spin" />
    {downloadProgress}%
  </Badge>
) : (
  <Badge variant="warning" size="sm">
    <AlertCircle className="w-3 h-3" />
    Download required
  </Badge>
)}
```

### Download Progress Bar

Shows download progress for images being downloaded:

```tsx
{imageDownloading && (
  <div className="mt-2 h-1.5 bg-bg-surface rounded-full overflow-hidden">
    <div 
      className="h-full bg-info transition-all duration-300"
      style={{ width: `${downloadProgress}%` }}
    />
  </div>
)}
```

## isStepValid Function

The main validation gate that determines if the user can proceed to the next step:

```typescript
const isStepValid = (step: number): boolean => {
  switch (step) {
    case 0: // Basic Info
      return validateVMName(formData.name).valid;
      
    case 1: // Placement
      if (nodes.length === 0) return true;
      return formData.clusterId !== '' && 
             (formData.autoPlacement || formData.hostId !== '');
      
    case 4: // Hardware
      return formData.cpuCores > 0 && formData.cpuCores <= 128 && 
             formData.memoryMib >= 512 && formData.memoryMib <= 1048576;
             
    case 5: // Boot Media
      if (formData.bootMediaType === 'cloud-image') {
        const hasPassword = formData.cloudInit.password.length >= 8 && 
                           formData.cloudInit.password === formData.cloudInit.confirmPassword;
        const hasSSHKeys = formData.cloudInit.sshKeys.length > 0;
        return validateAccessMethod(hasPassword, hasSSHKeys, selectedCloudImage).valid;
      }
      return true;
      
    case 6: // Storage
      // Validates pool accessibility and capacity
      ...
  }
};
```

## Backend Integration

The validation system relies on the existing backend API:

### GetCatalogDownloadStatus RPC

```protobuf
rpc GetCatalogDownloadStatus(GetCatalogDownloadStatusRequest) 
    returns (GetCatalogDownloadStatusResponse);
```

Returns download status for each catalog image:
- `NOT_DOWNLOADED` (0)
- `DOWNLOADING` (1) 
- `READY` (2)
- `ERROR` (3)

### DownloadImage RPC

```protobuf
rpc DownloadImage(DownloadImageRequest) returns (DownloadImageResponse);
```

Used by the "Download" button to initiate image downloads.

## Testing

### Manual Testing Checklist

1. **VM Name Validation**
   - [ ] Enter name < 3 chars → Error shown
   - [ ] Enter name with special chars → Error shown
   - [ ] Enter name starting with dash → Error shown
   - [ ] Enter valid name → Success indicator shown

2. **Cloud Image Availability**
   - [ ] View cloud images → Status badges visible
   - [ ] Select unavailable image → Warning banner shown
   - [ ] Click Download button → Download starts, progress shown
   - [ ] Wait for download → Status changes to Ready

3. **Access Method Validation**
   - [ ] No password or SSH key → Warning message shown
   - [ ] Enter mismatched passwords → Error shown
   - [ ] Enter short password → Warning shown
   - [ ] Add valid SSH key → Success indicator

4. **Storage Validation**
   - [ ] Select pool not on target node → Error banner
   - [ ] Add disks exceeding capacity → Error shown
   - [ ] Select valid pool → Next enabled

## Future Enhancements

1. **VM Name Uniqueness Check**: Call backend to verify name is not already in use
2. **Real-time Node Status**: Check if node is still online before final submission
3. **Preflight Check Modal**: Show summary of all warnings before creation
4. **ISO Availability**: Extend availability checking to ISO images
5. **Network Validation**: Verify selected networks are accessible from node

## References

- [VM Creation Wizard Implementation](./000015-vm-creation-wizard.md)
- [Error Handling Patterns](./000027-error-handling-patterns.md)
- [Storage Backend Guide](../Storage/000046-storage-backend-implementation.md)
- [Cloud Image Setup Guide](../Provisioning/000054-cloud-image-setup-guide.md)
