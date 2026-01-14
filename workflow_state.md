# Workflow State

## Quantix-vDC ISO Kernel Missing Fix

### Status: IN PROGRESS

### Goal
Prevent ISO boots from failing with "file '/boot/vmlinuz' not found" by
verifying the kernel is present and adding fallback extraction paths.

### Plan
1. Add kernel fallback from `/rootfs/boot` and verify `/boot/vmlinuz` exists.
2. Document the boot error and rebuild guidance in the appliance guide.
3. Rebuild the ISO and validate boot in QEMU/host.

### Log
- Added kernel fallback and explicit verification in ISO build.
- Documented boot error troubleshooting in appliance guide.

### References
- `Quantix-vDC/builder/build-iso.sh`
- `docs/000051-quantix-vdc-appliance.md`
