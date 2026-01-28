# Workflow State - VM Deletion Storage Cleanup

## Status: ✅ COMPLETE (January 28, 2026)

Fixed VM deletion to properly clean up the VM folder from datastores (NFS, local, etc.)

---

## Problem

When deleting a VM:
1. The VM disks are stored in `{storage_pool}/vms/{VM_NAME}_{UUID_SHORT}/` folders
2. During deletion, the code only tried to delete `/var/lib/limiquantix/vms/{vm_id}` which doesn't match
3. The disk files may be deleted but the parent folder remains empty on the datastore

## Solution

Enhanced `delete_vm` in the hypervisor backend to:
1. Get disk paths from VM XML BEFORE undefining the domain
2. Delete each disk file
3. Collect and delete parent VM folders (if they're under a `vms/` directory and are empty or only contain auto-generated files like cloud-init ISOs)
4. Then undefine the domain

## Files Modified

| File | Change |
|------|--------|
| `agent/limiquantix-hypervisor/src/libvirt/backend.rs` | Enhanced `delete_vm` to clean up disk files and VM folders |
| `agent/limiquantix-node/src/service.rs` | Updated comments, kept legacy path cleanup for backwards compatibility |

---

## Implementation Details

The new `delete_vm` logic:

1. **Before undefining**: Parse the VM XML to get all disk paths
2. **Delete disk files**: Remove each disk file (qcow2, raw, etc.)
3. **Identify VM folders**: Collect parent directories that match the pattern `.../vms/{folder}/`
4. **Clean up folders**: Delete VM folders if they are:
   - Empty, OR
   - Only contain auto-generated files (cloud-init ISOs, NVRAM files, logs)
5. **Undefine domain**: Remove the VM from libvirt
6. **Legacy cleanup**: The service layer still checks `/var/lib/limiquantix/vms/{vm_id}` for backwards compatibility

---

## Previous Workflow States

(Moved to completed_workflow.md)
