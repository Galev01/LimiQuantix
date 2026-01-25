# Guest Agent Phase 6-10 Implementation

**Document ID:** 000087  
**Created:** 2026-01-25  
**Status:** Implemented  
**Component:** limiquantix-guest-agent

---

## Overview

This document describes the implementation of Phases 6-10 of the Guest Agent feature plan, transforming it into a full VMware Tools replacement with enterprise-grade features.

## Implementation Summary

### Phase 2: File System Operations (Extended)

| Feature | Status | Handler File |
|---------|--------|--------------|
| Directory Listing | ✅ Implemented | `handlers/directory.rs` |
| Directory Creation | ✅ Implemented | `handlers/directory.rs` |
| File Delete | ✅ Implemented | `handlers/directory.rs` |
| File Stat | ✅ Implemented | `handlers/directory.rs` |

**Key Features:**
- Pagination support via continuation tokens
- Hidden file filtering
- Symlink detection and target resolution
- Unix owner/group resolution
- Path safety validation (prevents directory traversal)

### Phase 3: Desktop Integration

| Feature | Status | Handler File |
|---------|--------|--------------|
| Display Resize | ✅ Implemented | `handlers/display.rs` |
| Clipboard Update (Set) | ✅ Implemented | `handlers/clipboard.rs` |
| Clipboard Get (Read) | ✅ Implemented | `handlers/clipboard.rs` |

**Display Resize:**
- Linux: Uses `xrandr` with automatic mode creation via `cvt`
- Windows: Uses `ChangeDisplaySettingsExW` Win32 API
- Auto-detects primary display
- Supports custom display identifiers for multi-monitor

**Clipboard:**
- Cross-platform via `arboard` crate
- Supports text and image content
- Automatic format detection
- Fallback between text and image

### Phase 4: Process and Service Management

| Feature | Status | Handler File |
|---------|--------|--------------|
| Process Listing | ✅ Implemented | `handlers/process.rs` |
| Process Kill | ✅ Implemented | `handlers/process.rs` |
| Service Listing | ✅ Implemented | `handlers/service.rs` |
| Service Control | ✅ Implemented | `handlers/service.rs` |

**Process Management:**
- Uses `sysinfo` crate for cross-platform support
- Includes CPU%, memory, state, command line
- Filter by process name
- Signal support (SIGTERM, SIGKILL, SIGHUP, SIGINT, SIGQUIT)

**Service Management:**
- Linux: Uses `systemctl` commands
- Windows: Uses `sc.exe` commands
- Actions: start, stop, restart, enable, disable, status
- Includes service state, start type, PID, memory usage

### Phase 5: System Information

| Feature | Status | Handler File |
|---------|--------|--------------|
| Hardware Info | ✅ Implemented | `handlers/inventory.rs` |
| Installed Software | ✅ Implemented | `handlers/inventory.rs` |

**Hardware Inventory:**
- CPU: model, cores, threads, frequency, flags, vendor
- Memory: total, available, type, speed
- Disks: device, model, type (SSD/HDD), partitions
- Network: adapters, MAC, type, speed
- BIOS: vendor, version, system info (from DMI)
- OS: name, version, kernel, hostname, boot time
- GPU: name, vendor, driver, VRAM (via lspci)

**Software Inventory:**
- Linux: dpkg-query (Debian/Ubuntu) or rpm (RHEL/CentOS)
- Windows: Registry query via PowerShell
- Includes name, version, publisher, size, package type

### Phase 6: Agent Self-Management

| Feature | Status | Handler File |
|---------|--------|--------------|
| Agent Update | ✅ Implemented | `handlers/update.rs` |
| Get Capabilities | ✅ Implemented | `handlers/update.rs` |

**Self-Update Mechanism:**
- Chunked binary transfer
- SHA256 checksum verification
- Atomic binary replacement
- Backup of current binary
- Progress tracking
- State machine: IDLE → DOWNLOADING → VERIFYING → APPLYING → COMPLETE

**Capabilities Query:**
- Returns all supported features
- Platform-specific feature flags
- Build information (version, time, commit)

---

## Proto Message Definitions

All message types have been added to `agent/limiquantix-proto/proto/agent.proto`:

### Directory Operations
```protobuf
message ListDirectoryRequest { ... }
message ListDirectoryResponse { ... }
message DirectoryEntry { ... }
message CreateDirectoryRequest { ... }
message CreateDirectoryResponse { ... }
message FileDeleteRequest { ... }
message FileDeleteResponse { ... }
message FileStatRequest { ... }
message FileStatResponse { ... }
```

### Display Operations
```protobuf
message DisplayResizeRequest { ... }
message DisplayResizeResponse { ... }
```

### Clipboard Operations
```protobuf
message ClipboardUpdateRequest { ... }
message ClipboardUpdateResponse { ... }
message ClipboardGetRequest { ... }
message ClipboardGetResponse { ... }
enum ClipboardType { TEXT, IMAGE, FILES, HTML }
```

### Process Management
```protobuf
message ListProcessesRequest { ... }
message ListProcessesResponse { ... }
message ProcessInfo { ... }
message KillProcessRequest { ... }
message KillProcessResponse { ... }
```

### Service Management
```protobuf
message ListServicesRequest { ... }
message ListServicesResponse { ... }
message ServiceInfo { ... }
message ServiceControlRequest { ... }
message ServiceControlResponse { ... }
enum ServiceAction { START, STOP, RESTART, ENABLE, DISABLE, STATUS }
```

### System Inventory
```protobuf
message GetHardwareInfoRequest { ... }
message GetHardwareInfoResponse { ... }
message HardwareInfo { ... }
message CpuInfo { ... }
message MemoryInfo { ... }
message DiskInfo { ... }
message PartitionInfo { ... }
message NetworkAdapterInfo { ... }
message BiosInfo { ... }
message OsInfo { ... }
message GpuInfo { ... }
message ListInstalledSoftwareRequest { ... }
message ListInstalledSoftwareResponse { ... }
message InstalledSoftware { ... }
```

### Agent Self-Update
```protobuf
message AgentUpdateRequest { ... }
message AgentUpdateResponse { ... }
enum UpdateState { IDLE, DOWNLOADING, VERIFYING, APPLYING, COMPLETE, FAILED, ROLLING_BACK }
message GetCapabilitiesRequest { ... }
message GetCapabilitiesResponse { ... }
```

---

## File Structure

```
agent/limiquantix-guest-agent/src/
├── main.rs                    # Entry point, message loop
├── config.rs                  # Configuration management
├── protocol.rs                # Message framing
├── telemetry.rs               # System metrics collection
├── transport.rs               # Virtio-serial transport
└── handlers/
    ├── mod.rs                 # Message routing (updated)
    ├── clipboard.rs           # NEW: Clipboard operations
    ├── directory.rs           # NEW: Directory operations
    ├── display.rs             # NEW: Display resize
    ├── execute.rs             # Command execution
    ├── file.rs                # File read/write
    ├── inventory.rs           # NEW: Hardware/software inventory
    ├── lifecycle.rs           # Shutdown, password reset, network
    ├── process.rs             # NEW: Process management
    ├── quiesce.rs             # Filesystem quiescing
    ├── service.rs             # NEW: Service management
    ├── timesync.rs            # Time synchronization
    └── update.rs              # NEW: Agent self-update
```

---

## Dependencies Added

```toml
# Cargo.toml additions
arboard = "3.4"      # Cross-platform clipboard
sha2 = "0.10"        # SHA256 for update verification
```

---

## Capabilities List

The agent now reports the following capabilities:

```
telemetry, execute, file_read, file_write, file_list, file_delete,
file_stat, directory_create, shutdown, reboot, reset_password,
configure_network, quiesce, thaw, sync_time, display_resize,
clipboard, process_list, process_kill, service_list, service_control,
hardware_info, software_list, self_update
```

Platform-specific:
- Linux: `user_context_exec`, `fsfreeze`
- Windows: `vss_quiesce`

---

## Usage Examples

### List Directory
```json
{
  "message_id": "uuid",
  "payload": {
    "list_directory": {
      "path": "/home/user",
      "include_hidden": false,
      "max_entries": 100
    }
  }
}
```

### Resize Display
```json
{
  "message_id": "uuid",
  "payload": {
    "display_resize": {
      "width": 1920,
      "height": 1080,
      "dpi": 96
    }
  }
}
```

### List Processes
```json
{
  "message_id": "uuid",
  "payload": {
    "list_processes": {
      "filter": "nginx",
      "max_entries": 50
    }
  }
}
```

### Control Service
```json
{
  "message_id": "uuid",
  "payload": {
    "service_control": {
      "name": "nginx",
      "action": "RESTART"
    }
  }
}
```

### Get Hardware Info
```json
{
  "message_id": "uuid",
  "payload": {
    "get_hardware_info": {
      "include_cpu_details": true,
      "include_disk_details": true,
      "include_network_details": true
    }
  }
}
```

---

## Testing

### Unit Tests
Each handler module includes unit tests:
- `directory.rs`: Path safety validation
- `process.rs`: Process listing, state conversion
- `inventory.rs`: CPU/OS info collection
- `update.rs`: Capabilities query, hex encoding

### Integration Testing
To test the agent:

1. Build the agent:
   ```bash
   cd agent/limiquantix-guest-agent
   cargo build --release
   ```

2. Run in a VM with virtio-serial configured

3. Send test messages from the node daemon

---

## Security Considerations

1. **Path Validation**: All file/directory operations validate paths to prevent directory traversal attacks

2. **Command Allowlisting**: Configuration supports command allow/block lists

3. **Rate Limiting**: Configurable rate limits for commands and file operations

4. **Audit Logging**: All operations can be logged for compliance

5. **Checksum Verification**: Agent updates require SHA256 verification

---

## Future Enhancements

### Not Yet Implemented
- Drag-and-drop file transfer
- Multi-monitor support for display resize
- ARM64 builds
- VSOCK transport option
- Clipboard file transfer

### Planned Improvements
- PNG/JPEG image encoding for clipboard
- Service dependency tracking
- GPU utilization metrics
- Network speed detection

---

## References

- [Guest Agent Master Plan](/.cursor/plans/guest_agent_master_plan_2d63f525.plan.md)
- [Guest Agent Architecture](000044-guest-agent-architecture.md)
- [Windows Support](../quantix-agent/000049-guest-agent-windows-support.md)
