# VMDetail Page Fixes and Enhancements

**Document ID:** 000086  
**Date:** January 24, 2026  
**Status:** Implemented  
**Purpose:** Document fixes and enhancements to the VMDetail.tsx page in the Quantix-vDC frontend

---

## Overview

This document describes the fixes and enhancements made to the VMDetail page (`frontend/src/pages/VMDetail.tsx`) to address 8 reported issues with the VM configuration UI.

---

## Issues Fixed

### 1. Storage Display Bug (Issue #1)
**Problem:** Storage showed "05050 GB" instead of "100 GB" for two 50GB disks.

**Root Cause:** String concatenation instead of numeric addition when reducing disk sizes.

**Fix:** Added `Number()` conversion in the reduce function:
```typescript
value={`${vm.spec.disks.reduce((a, d) => a + Number(d.sizeGib), 0)} GB`}
```

**File:** `frontend/src/pages/VMDetail.tsx`

---

### 2. CD-ROM Management (Issue #2)
**Problem:** No way to attach/mount ISO images after VM creation.

**Solution:** Created full CD-ROM device management system:

**New Components:**
- `CDROMModal.tsx` - Unified modal for CD-ROM management

**Features:**
- List available ISO images from the Images page
- Add CD-ROM device to VM
- Mount ISO to CD-ROM device
- Eject ISO from CD-ROM
- Remove CD-ROM device
- Hot-plug support (operations while VM is running)

**New Hooks:**
- `useAttachCDROM` - Add CD-ROM device
- `useDetachCDROM` - Remove CD-ROM device
- `useMountISO` - Mount ISO to CD-ROM
- `useEjectISO` - Eject ISO from CD-ROM

**API Methods Added:**
- `vmApi.attachCDROM(vmId)`
- `vmApi.detachCDROM(vmId, cdromId)`
- `vmApi.mountISO(vmId, cdromId, isoPath)`
- `vmApi.ejectISO(vmId, cdromId)`

**Files:**
- `frontend/src/components/vm/CDROMModal.tsx` (new)
- `frontend/src/hooks/useVMs.ts` (modified)
- `frontend/src/lib/api-client.ts` (modified)

---

### 3. Disk Resize Default Bug (Issue #3)
**Problem:** Resize modal showed "5010" instead of "60" (50 + 10) as default.

**Root Cause:** String concatenation when `currentSizeGib` was passed as string.

**Fix:** Added `Number()` conversion throughout the component:
```typescript
const [newSizeGib, setNewSizeGib] = useState(Number(currentSizeGib) + 10);
```

**File:** `frontend/src/components/vm/ResizeDiskModal.tsx`

---

### 4 & 7. Broken Toggle Button UI (Issues #4 & #7)
**Problem:** Toggle buttons had no visual indicator (knob/slider).

**Solution:** Created reusable `Toggle` component with proper UI:

**Features:**
- Sliding knob animation
- Background color change (gray → green)
- Smooth CSS transitions
- Proper accessibility (aria-checked, role="switch")
- Three sizes: sm, md, lg
- Optional label and description

**Files:**
- `frontend/src/components/ui/Toggle.tsx` (new)
- `frontend/src/components/vm/EditHAPolicyModal.tsx` (modified)
- `frontend/src/components/vm/EditDisplaySettingsModal.tsx` (modified)
- `frontend/src/components/vm/EditBootOptionsModal.tsx` (modified)

---

### 5. Guest Agent Edit Button (Issue #5)
**Problem:** Edit button existed but did nothing.

**Solution:** Created `EditGuestAgentModal.tsx` with partial editing:

**Editable Settings:**
- Freeze on Snapshot (toggle)
- Time Sync (toggle)

**Read-Only Settings (displayed but not editable):**
- Status (system-determined)
- Agent Version (system-determined)
- Communication method (set at VM creation)

**File:** `frontend/src/components/vm/EditGuestAgentModal.tsx` (new)

---

### 6. Provisioning Section Incorrect Data (Issue #6)
**Problem:** Showed cloud-init config for non-cloud-init VMs.

**Solution:** Implemented proper cloud-init detection using both checks:

**Detection Logic:**
```typescript
function detectCloudInit(vm: ApiVM): { hasCloudInit: boolean; reason: string } {
  // Check if cloudInit is explicitly configured in spec
  if (vm.spec?.cloudInit) {
    return { hasCloudInit: true, reason: 'Cloud-init configuration present in VM spec' };
  }

  // Check if any disk has a backing file that suggests a cloud image
  const hasCloudImageDisk = vm.spec?.disks?.some(disk => {
    const backingFile = disk.backingFile || '';
    return backingFile.toLowerCase().includes('cloud') ||
           backingFile.toLowerCase().includes('generic') ||
           backingFile.endsWith('.qcow2');
  });

  if (hasCloudImageDisk) {
    return { hasCloudInit: true, reason: 'VM created from cloud image' };
  }

  return { hasCloudInit: false, reason: 'No cloud-init configuration detected' };
}
```

**UI Behavior:**
- If `hasCloudInit === false`: Shows "Not configured" message
- If `hasCloudInit === true`: Shows cloud-init details with edit capability

**File:** `frontend/src/components/vm/EditProvisioningModal.tsx` (new)

---

### 8. Advanced Options Not Editable (Issue #8)
**Problem:** Edit button existed but did nothing.

**Solution:** Created `EditAdvancedOptionsModal.tsx` with VM-stopped-only editing:

**Editable Settings (when VM is STOPPED):**
- Hardware Version (v5, v6, v7)
- Machine Type (q35, i440fx, virt)
- RTC Base (UTC, localtime)
- Watchdog (none, i6300esb, ib700, diag288)
- RNG Device (enabled/disabled)

**UI Behavior:**
- If VM is RUNNING: Shows warning message, edit disabled
- If VM is STOPPED: Allows editing all settings

**File:** `frontend/src/components/vm/EditAdvancedOptionsModal.tsx` (new)

---

## New Files Created

| File | Purpose |
|------|---------|
| `frontend/src/components/ui/Toggle.tsx` | Reusable toggle switch component |
| `frontend/src/components/vm/EditGuestAgentModal.tsx` | Guest agent settings editor |
| `frontend/src/components/vm/EditProvisioningModal.tsx` | Cloud-init provisioning editor |
| `frontend/src/components/vm/EditAdvancedOptionsModal.tsx` | Advanced VM options editor |
| `frontend/src/components/vm/CDROMModal.tsx` | CD-ROM device management |

---

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/pages/VMDetail.tsx` | Fixed storage display, added new modals, CD-ROM section |
| `frontend/src/components/vm/ResizeDiskModal.tsx` | Fixed numeric calculations |
| `frontend/src/components/vm/EditHAPolicyModal.tsx` | Replaced toggle with Toggle component |
| `frontend/src/components/vm/EditDisplaySettingsModal.tsx` | Replaced toggles with Toggle component |
| `frontend/src/components/vm/EditBootOptionsModal.tsx` | Replaced toggle with Toggle component |
| `frontend/src/hooks/useVMs.ts` | Added CD-ROM hooks |
| `frontend/src/lib/api-client.ts` | Added CD-ROM API methods |

---

## Backend API Requirements

The following backend endpoints are required for CD-ROM functionality:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/vms/{id}/cdroms` | Attach CD-ROM device |
| DELETE | `/api/vms/{id}/cdroms/{cdromId}` | Detach CD-ROM device |
| POST | `/api/vms/{id}/cdroms/{cdromId}/mount` | Mount ISO to CD-ROM |
| POST | `/api/vms/{id}/cdroms/{cdromId}/eject` | Eject ISO from CD-ROM |

These endpoints should be implemented in the backend `VMService` if not already present.

---

## Testing Checklist

- [ ] Storage display shows correct total (e.g., 100 GB for two 50 GB disks)
- [ ] Disk resize modal shows correct default (current + 10)
- [ ] Toggle buttons show sliding knob animation
- [ ] Guest Agent modal allows editing freeze/time sync settings
- [ ] Provisioning section shows "Not configured" for non-cloud-init VMs
- [ ] Advanced Options modal is disabled when VM is running
- [ ] CD-ROM modal allows adding/removing devices
- [ ] CD-ROM modal allows mounting/ejecting ISOs

---

## Related Documentation

- [Cloud Image Setup Guide](../Provisioning/000054-cloud-image-setup-guide.md)
- [VM Creation Wizard](../ui/000015-vm-creation-wizard.md)
