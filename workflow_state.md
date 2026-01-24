# Workflow State - CD-ROM Operations Implementation

## Completed

### Problem
User got 404 error when trying to attach a CD-ROM device to a VM:
```
POST https://192.168.0.100/limiquantix.compute.v1.VMService/AttachCDROM 404 (Not Found)
```

### Solution
Implemented the missing CD-ROM operations in the backend:

1. **Added RPC definitions to proto file** (`proto/limiquantix/compute/v1/vm_service.proto`):
   - `AttachCDROM` - Add a CD-ROM device to a VM
   - `DetachCDROM` - Remove a CD-ROM device from a VM
   - `MountISO` - Mount an ISO file to an existing CD-ROM device
   - `EjectISO` - Eject the ISO from a CD-ROM device

2. **Regenerated Go code** with `buf generate`

3. **Implemented handlers** in `backend/internal/services/vm/service.go`:
   - `AttachCDROM()` - Creates a new CD-ROM device with optional ISO
   - `DetachCDROM()` - Removes a CD-ROM device by ID
   - `MountISO()` - Mounts an ISO to an existing CD-ROM device
   - `EjectISO()` - Ejects the ISO from a CD-ROM device

### Files Changed
- `proto/limiquantix/compute/v1/vm_service.proto` - Added RPC definitions and request messages
- `backend/pkg/api/limiquantix/compute/v1/*.go` - Regenerated proto code
- `backend/internal/services/vm/service.go` - Implemented handlers

## Deployment

To deploy this change:

1. Build and publish the update:
   ```bash
   ./scripts/publish-vdc-update.sh
   ```

2. In QvDC UI:
   - Check for updates
   - Apply update

## Testing

1. Open a VM in the dashboard
2. Go to the CD-ROM section
3. Click "Add CD-ROM" - should work now
4. Mount an ISO to the CD-ROM
5. Eject the ISO
6. Remove the CD-ROM device

## Log

- Added 4 new RPC methods to vm_service.proto
- Added request messages: AttachCDROMRequest, DetachCDROMRequest, MountISORequest, EjectISORequest
- Implemented handlers following the same pattern as AttachDisk/DetachDisk
- Added generateCDROMID() helper function
- Fixed field name: CDROMs → Cdroms (to match domain model)
- Backend compiles successfully
