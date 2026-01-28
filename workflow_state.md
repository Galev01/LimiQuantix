# Workflow State - VM Deletion Consistency

## Status: ✅ COMPLETE (January 28, 2026)

Ensured all VM deletion flows use the same `DeleteVMModal` component for consistent behavior.

---

## Problem

Different pages used different deletion methods:
- **VMDetail.tsx**: Used `DeleteVMModal` with proper options (deleteVolumes, removeFromInventoryOnly)
- **VMList.tsx**: Used simple `confirm()` dialog
- **ClusterView.tsx**: Used simple `confirm()` dialog  
- **VMFolderView.tsx**: Used simple `confirm()` dialog

This caused inconsistent behavior - only VMDetail properly passed `deleteVolumes: true` to clean up disk files.

## Solution

1. **Backend fix**: Enhanced `delete_vm` in the hypervisor to clean up disk files and VM folders from datastores
2. **Frontend fix**: Updated all pages to use the `DeleteVMModal` component

## Files Modified

### Backend (Rust)
| File | Change |
|------|--------|
| `agent/limiquantix-hypervisor/src/libvirt/backend.rs` | Enhanced `delete_vm` to clean up disk files and VM folders |
| `agent/limiquantix-node/src/service.rs` | Updated comments, kept legacy path cleanup |

### Frontend (React/TypeScript)
| File | Change |
|------|--------|
| `frontend/src/pages/VMList.tsx` | Added `DeleteVMModal`, updated context menu and bulk delete |
| `frontend/src/pages/ClusterView.tsx` | Added `DeleteVMModal`, updated VM context menu |
| `frontend/src/pages/VMFolderView.tsx` | Added `DeleteVMModal`, updated context menu and toolbar delete |

---

## Implementation Details

### Backend Changes

The `delete_vm` function now:
1. Gets disk paths from VM XML before undefining
2. Deletes each disk file
3. Identifies and deletes VM folders (under `vms/` directories)
4. Only deletes folders that are empty or contain auto-generated files

### Frontend Changes

All pages now:
1. Import and use `DeleteVMModal` component
2. Store delete modal state: `{ isOpen: boolean, vm: VirtualMachine | null }`
3. Open the modal instead of using `confirm()` dialogs
4. Pass proper options to `deleteVM.mutateAsync()`:
   - `deleteVolumes`: true/false based on user choice
   - `removeFromInventoryOnly`: true/false based on user choice
   - `force`: true if VM is running

### Deletion Options

Users now have two choices in the modal:
1. **Delete from Disk**: Permanently deletes VM definition and all disk files
2. **Remove from Inventory**: Only removes from vDC, keeps VM on hypervisor

---

## Previous Workflow States

(Moved to completed_workflow.md)
