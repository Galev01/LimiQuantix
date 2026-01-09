# Workflow State

## Current Status: COMPLETED - Remote Node Connection Feature

## Latest Workflow: Remote Node Connection in Host UI

**Date:** January 9, 2026

### Summary

Added a feature to the Host UI that allows connecting to a remote node daemon from the UI itself, instead of requiring vite proxy configuration changes.

### Changes Made

| File | Change |
|------|--------|
| `quantix-host-ui/src/api/client.ts` | Added configurable API base URL with localStorage persistence |
| `quantix-host-ui/src/components/ConnectionSetup.tsx` | New component for entering remote node URL |
| `quantix-host-ui/src/components/layout/Layout.tsx` | Added connection banner and disconnect button |
| `quantix-host-ui/src/App.tsx` | Show ConnectionSetup when in dev mode without connection |

### How to Use

1. **Start the Host UI** on your Windows machine:
   ```powershell
   cd quantix-host-ui
   npm run dev
   ```

2. **Open http://localhost:3001** - You'll see the "Connect to Node Daemon" page

3. **Enter your Ubuntu node daemon URL**: `https://192.168.1.101:8443`
   - Replace with your actual Ubuntu IP address
   - Give it a friendly name (optional)

4. **Click "Test Connection"** to verify connectivity

5. **Click "Connect"** to save and start using the UI

6. Once connected, a banner shows at the top with a "Disconnect" option

### Features
- Connection URL stored in localStorage (persists across browser refreshes)
- Recent connections remembered for quick switching
- Test connection before committing
- Visual indicator showing which node you're connected to
- One-click disconnect to switch nodes

---

## Previous Workflow: Node Daemon Build Fixed

Fixed the node daemon build issues by:

1. **Downloaded protoc** for Windows to enable proto regeneration
2. **Regenerated proto files** from the updated `node_daemon.proto`
3. **Fixed axum WebSocket feature** - Added `ws` and `query` features to axum
4. **Fixed rcgen API** - Added `pem` feature to rcgen for PEM output methods
5. **Fixed platform-specific code** - Made `libc::statvfs` Linux-only with `#[cfg]`

### Build Status

```
[OK] limiquantix-proto - Builds successfully
[OK] limiquantix-hypervisor - Builds successfully (warnings only)
[OK] limiquantix-telemetry - Builds successfully
[OK] limiquantix-node - Builds successfully (warnings only)
```

### Architecture

```
Windows Machine (Development)
+------------------------------------------------------------+
|  Host UI (localhost:3001)                                  |
|  - Connects to remote node daemon via HTTPS                |
|  - Connection URL configured in UI                         |
+------------------------------------------------------------+
             |
             | HTTPS (direct, no proxy)
             v
Ubuntu Machine (Hypervisor)
+------------------------------------------------------------+
|  Quantix-OS Node Daemon                                    |
|  - HTTPS API on port 8443                                  |
|  - gRPC on port 9443                                       |
|  - Runs VMs via libvirt/QEMU                               |
+------------------------------------------------------------+
```

### Running the Node Daemon on Ubuntu

```bash
# Build with libvirt support
cd ~/LimiQuantix/agent
cargo build --release -p limiquantix-node --features libvirt

# Run (listen on all interfaces)
# Note: Use --http-listen and --grpc-listen with address:port format
./target/release/limiquantix-node --http-listen 0.0.0.0:8443 --grpc-listen 0.0.0.0:9443
```
