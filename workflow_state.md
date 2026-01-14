# Workflow State

## Quantix-vDC gRPC/Connect Proxy Fix

### Status: IN PROGRESS

### Goal
Resolve HTTP 405 errors from the web UI by proxying Connect RPC endpoints
(`/limiquantix.*`) through nginx to the control plane.

### Plan
1. Add nginx proxy route for `/limiquantix.*` Connect endpoints.
2. Document the 405 symptom and fix in the appliance guide.
3. Rebuild the ISO and verify UI API calls succeed.

### Log
- Added nginx proxy route for direct Connect service paths.

### References
- `Quantix-vDC/overlay/etc/nginx/conf.d/quantix-vdc.conf`
- `docs/000051-quantix-vdc-appliance.md`
