# Workflow State: Fix Cloud Image Boot Issue

## Problem

Ubuntu cloud image VMs fail to boot with "Boot failed: not a bootable disk".

## Root Cause Found

**Multiple issues identified and fixed:**

### Issue 1: Empty disk ID (FIXED)
- Disk was being named `.qcow2` instead of `disk0.qcow2`
- Fixed by generating disk ID if empty

### Issue 2: Mock hypervisor (FIXED)
- Node daemon was using mock hypervisor instead of libvirt
- Fixed by building with `--features libvirt`

### Issue 3: camelCase vs snake_case JSON keys (FIXED)
- Frontend sends `backingFile` (camelCase)
- Go proto expects `backing_file` (snake_case in JSON tags)
- The backing file path was being silently dropped!
- **Fixed by adding `convertKeysToSnakeCase()` in api-client.ts**

## Changes Made

### 1. `agent/limiquantix-node/src/service.rs`
- Generate disk ID if empty: `disk0`, `disk1`, etc.
- Added logging for disk processing
- Fixed backing file validation

### 2. `frontend/src/lib/api-client.ts`
- Added `toSnakeCase()` and `convertKeysToSnakeCase()` functions
- Convert all request bodies from camelCase to snake_case before sending
- This ensures `backingFile` → `backing_file`, `sizeGib` → `size_gib`, etc.

## Testing

1. Restart the frontend:
```bash
cd ~/LimiQuantix/frontend
# Ctrl+C to stop, then:
npm run dev
```

2. Kill and restart node daemon with libvirt:
```bash
sudo pkill -f limiquantix-node
cd ~/LimiQuantix/agent
cargo build --release --features libvirt
sudo ./target/release/limiquantix-node
```

3. Create a new VM with Ubuntu cloud image

4. Check that the disk has a backing file:
```bash
virsh destroy <vm-name>
qemu-img info /var/lib/limiquantix/vms/<vm-id>/disk0.qcow2
# Should show: backing file: /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2
```

## Status: FIXED - Ready for Testing ✅
