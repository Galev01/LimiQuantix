# Workflow State: Fix Cloud Image Boot Issue

## Problem

Ubuntu 22.04 cloud image VMs fail to boot with "Boot failed: not a bootable disk" and "No bootable device".

## Root Cause

The disk creation logic in `service.rs` had a bug:
```rust
// OLD (buggy): Skip disk creation if size_gib = 0
if disk_spec.path.is_empty() && disk_spec.size_gib > 0 {
```

When using a cloud image with a backing file:
1. Users often set `size_gib = 0` (since the backing file has its own size)
2. This caused the overlay disk creation to be **skipped entirely**
3. The VM had no bootable disk attached!

## Fix Applied

Modified `agent/limiquantix-node/src/service.rs`:

1. **Fixed disk creation condition** - Now creates overlay even when `size_gib = 0`:
```rust
// NEW: Create disk if we have a backing file OR a size specified
let needs_disk_creation = disk_spec.path.is_empty() && (disk_spec.size_gib > 0 || has_backing_file);
```

2. **Added backing file validation** - Verify cloud image exists before creating overlay:
```rust
if !backing_path.exists() {
    return Err(Status::failed_precondition(format!(
        "Cloud image not found: {}. Download it with: setup-cloud-images.sh ubuntu-22.04",
        bf
    )));
}
```

3. **Added debug logging** - Log the full qemu-img command for troubleshooting

## How Cloud Image VMs Work

```
1. Cloud image downloaded to: /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2
2. VM creation request specifies:
   - disk.backing_file = "/var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2"
   - disk.size_gib = 0 (inherit size) or larger
3. Node daemon creates:
   - Overlay disk: /var/lib/limiquantix/vms/{vm_id}/{disk_id}.qcow2
     └── qemu-img create -f qcow2 -b <backing_file> -F qcow2 <overlay_path>
   - Cloud-init ISO: /var/lib/limiquantix/vms/{vm_id}/cloud-init.iso
4. VM boots from overlay disk → cloud-init configures system
```

## Testing

1. Rebuild node daemon:
```bash
cd ~/LimiQuantix/agent/limiquantix-node
cargo build --release
sudo systemctl restart limiquantix-node
```

2. Ensure cloud image exists:
```bash
ls -la /var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2
# If missing:
./scripts/setup-cloud-images.sh ubuntu-22.04
```

3. Create VM with cloud image

## Status: COMPLETE ✅
