# 000072 - Host UI Build Notes

## Status

The Quantix Host UI frontend implementation is complete. However, the backend Rust code requires proto regeneration before it can compile.

## Frontend (Complete)

All frontend pages and components are implemented:

### Pages
- `Dashboard.tsx` - Main dashboard with system overview
- `VirtualMachines.tsx` - VM list with power controls
- `VMDetail.tsx` - VM detail page with tabs (summary, hardware, snapshots, console, events)
- `StoragePools.tsx` - Storage pool management
- `Volumes.tsx` - Volume management within pools
- `Hardware.tsx` - Hardware inventory display
- `Network.tsx` - Network configuration
- `Performance.tsx` - Real-time performance monitoring
- `Events.tsx` - System event log
- `Settings.tsx` - System configuration

### Components
- `CreateVMWizard.tsx` - Multi-step VM creation wizard
- `CreatePoolModal.tsx` - Storage pool creation modal
- `CreateVolumeModal.tsx` - Volume creation modal
- `DnsConfigModal.tsx` - DNS configuration modal

### API Clients
- `host.ts` - Host information and metrics
- `vm.ts` - VM operations
- `storage.ts` - Storage pool and volume operations
- `network.ts` - Network configuration
- `cluster.ts` - Cluster management
- `settings.ts` - Settings management
- `events.ts` - Events retrieval

## Backend (Requires Proto Regeneration)

The backend HTTP API handlers in `agent/limiquantix-node/src/http_server.rs` and service implementations in `agent/limiquantix-node/src/service.rs` reference proto types that were added to `proto/limiquantix/node/v1/node_daemon.proto` but the generated Rust code hasn't been updated.

### Proto Types Added (Need Regeneration)
- `ListVolumesRequest` / `ListVolumesResponse`
- `VolumeInfoResponse`
- `ListImagesResponse` / `ImageInfoResponse`
- Various other types

### To Fix

1. Install protoc (Protocol Buffer compiler)
2. Run `make proto` from project root
3. The generated files in `agent/limiquantix-proto/src/generated/` will be updated
4. The Rust code should then compile

### Workaround (Without Proto Regeneration)

If protoc is not available, the backend can still function with the existing proto types by:
1. Removing references to non-existent types in service.rs and http_server.rs
2. Using the existing `VolumeIdRequest` and other types
3. Implementing volume listing through the storage manager directly

## Build Commands

```bash
# Build frontend
cd quantix-host-ui
npm install
npm run build

# Build backend (after proto regeneration)
cd agent/limiquantix-node
cargo build --release
```

## Testing

The frontend can be tested standalone by running:
```bash
cd quantix-host-ui
npm run dev
```

The backend requires a Linux environment with libvirt for full functionality.
