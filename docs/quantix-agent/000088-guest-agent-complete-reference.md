# Quantix Guest Agent - Complete Reference

**Document ID:** 000088  
**Created:** 2026-01-25  
**Last Updated:** 2026-01-25  
**Status:** Active  
**Component:** `agent/limiquantix-guest-agent`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Communication Protocol](#3-communication-protocol)
4. [Feature Reference](#4-feature-reference)
5. [Configuration](#5-configuration)
6. [Security](#6-security)
7. [Error Codes](#7-error-codes)
8. [Packaging & Installation](#8-packaging--installation)
9. [API Reference](#9-api-reference)
10. [Troubleshooting](#10-troubleshooting)
11. [Development Guide](#11-development-guide)
12. [Performance Metrics](#12-performance-metrics)

---

## 1. Executive Summary

The **Quantix Guest Agent** (`limiquantix-agent`) is a lightweight Rust binary that runs inside guest VMs to provide deep integration with the Quantix hypervisor platform. It serves as a **VMware Tools replacement** with enterprise-grade features for both server and desktop virtualization workloads.

### Key Capabilities

| Category | Features |
|----------|----------|
| **Telemetry** | Real-time CPU, memory, disk, network metrics; IP address reporting |
| **Execution** | Remote command execution with user context support |
| **File Operations** | Chunked file read/write, directory listing, file browser API |
| **Lifecycle** | Graceful shutdown/reboot, password reset, network configuration |
| **Desktop** | Dynamic display resize, bi-directional clipboard sharing |
| **Management** | Process listing/kill, service control (start/stop/restart) |
| **Inventory** | Hardware info, installed software, BIOS details |
| **Snapshots** | Filesystem quiescing (fsfreeze/VSS) for consistent snapshots |
| **Self-Update** | Automatic agent updates with checksum verification |

### Platform Support

| Platform | Status | Package Format |
|----------|--------|----------------|
| Linux (Debian/Ubuntu) | ✅ Full | `.deb` |
| Linux (RHEL/CentOS/Fedora) | ✅ Full | `.rpm` |
| Linux (Alpine) | ✅ Full | `.tar.gz` |
| Windows 10/11/Server | ✅ Full | `.msi`, `.exe` |
| Linux ARM64 | ✅ Full | `.deb`, `.rpm` |

---

## 2. Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              QUANTIX ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────────┐ │
│  │  Frontend   │────▶│  Control    │────▶│   Node      │────▶│    Guest      │ │
│  │  (React)    │     │   Plane     │     │   Daemon    │     │    Agent      │ │
│  │  Dashboard  │◀────│   (Go)      │◀────│   (Rust)    │◀────│    (Rust)     │ │
│  │  + QVMC     │     │   QvDC      │     │   QHCI      │     │  Inside VM    │ │
│  └─────────────┘     └─────────────┘     └─────────────┘     └───────────────┘ │
│        │                   │                   │                     │          │
│   HTTP/WS            Connect-RPC           gRPC              virtio-serial     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Agent Internal Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          GUEST AGENT INTERNALS                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                           Main Loop (main.rs)                              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │ Config      │  │ Health      │  │ Telemetry   │  │ Message     │      │  │
│  │  │ Loader      │  │ Monitor     │  │ Loop        │  │ Handler     │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                        │                                         │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                         Handler Modules                                    │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │  │
│  │  │Telemetry │ │ Execute  │ │   File   │ │Directory │ │Lifecycle │       │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │  │
│  │  │ Display  │ │Clipboard │ │ Process  │ │ Service  │ │ Quiesce  │       │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                                  │  │
│  │  │Inventory │ │ Update   │ │TimeSync  │                                  │  │
│  │  └──────────┘ └──────────┘ └──────────┘                                  │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                        │                                         │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                         Transport Layer                                    │  │
│  │  ┌──────────────────────────┐  ┌──────────────────────────┐              │  │
│  │  │   Virtio-Serial          │  │   VSOCK (optional)       │              │  │
│  │  │   /dev/virtio-ports/     │  │   AF_VSOCK socket        │              │  │
│  │  │   org.limiquantix.agent.0│  │   High-bandwidth ops     │              │  │
│  │  └──────────────────────────┘  └──────────────────────────┘              │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Data Paths

| Location | Path |
|----------|------|
| **Host (Unix Socket)** | `/var/run/limiquantix/vms/{vm_id}.agent.sock` |
| **Guest (Linux)** | `/dev/virtio-ports/org.limiquantix.agent.0` |
| **Guest (Windows)** | `\\.\Global\org.limiquantix.agent.0` |

### Libvirt XML Configuration

The agent channel is configured in the VM's libvirt domain XML:

```xml
<channel type='unix'>
  <source mode='bind' path='/var/run/limiquantix/vms/{vm_id}.agent.sock'/>
  <target type='virtio' name='org.limiquantix.agent.0'/>
</channel>
```

---

## 3. Communication Protocol

### Message Framing

The agent uses **length-prefixed Protobuf** over virtio-serial:

```
┌──────────────────┬───────────────────────────────────────────┐
│  4 bytes (BE)    │          N bytes                          │
│  Message Length  │          Protobuf Payload                 │
└──────────────────┴───────────────────────────────────────────┘
```

- **Length**: 4-byte big-endian unsigned integer
- **Payload**: Protobuf-encoded `AgentMessage`

### Message Structure

```protobuf
message AgentMessage {
  string message_id = 1;                    // UUID for request correlation
  google.protobuf.Timestamp timestamp = 2; // Message timestamp
  oneof payload {
    // Requests (Host → Guest)
    PingRequest ping = 10;
    ExecuteRequest execute = 11;
    FileWriteRequest file_write = 12;
    FileReadRequest file_read = 13;
    ShutdownRequest shutdown = 14;
    ResetPasswordRequest reset_password = 15;
    ConfigureNetworkRequest configure_network = 16;
    QuiesceRequest quiesce = 17;
    ThawRequest thaw = 18;
    SyncTimeRequest sync_time = 19;
    ListDirectoryRequest list_directory = 20;
    CreateDirectoryRequest create_directory = 21;
    FileDeleteRequest file_delete = 22;
    FileStatRequest file_stat = 23;
    DisplayResizeRequest display_resize = 24;
    ClipboardUpdateRequest clipboard_update = 25;
    ClipboardGetRequest clipboard_get = 26;
    ListProcessesRequest list_processes = 27;
    KillProcessRequest kill_process = 28;
    ListServicesRequest list_services = 29;
    ServiceControlRequest service_control = 30;
    GetHardwareInfoRequest get_hardware_info = 31;
    ListInstalledSoftwareRequest list_installed_software = 32;
    AgentUpdateRequest agent_update = 33;
    GetCapabilitiesRequest get_capabilities = 34;
    
    // Responses (Guest → Host)
    PongResponse pong = 50;
    ExecuteResponse execute_response = 51;
    // ... (corresponding responses)
    
    // Events (Guest → Host, unsolicited)
    TelemetryReport telemetry = 100;
    AgentReadyEvent agent_ready = 101;
    ErrorEvent error = 102;
    ClipboardChangedEvent clipboard_changed = 103;
  }
}
```

---

## 4. Feature Reference

### 4.1 Telemetry

**Purpose:** Report real-time system metrics from inside the VM.

**Interval:** Configurable (default: 5 seconds)

**Metrics Collected:**

| Metric | Description | Source |
|--------|-------------|--------|
| CPU Usage % | Per-core and aggregate | `/proc/stat` / `sysinfo` |
| Memory Total/Used/Available | Actual RAM usage | `/proc/meminfo` / `sysinfo` |
| Disk Usage | Per-mount point | `/proc/mounts` |
| Network Interfaces | Name, MAC, IP addresses | `getifaddrs()` |
| IP Addresses | IPv4 and IPv6 | Filtered (no loopback/docker) |
| Hostname | Guest hostname | `gethostname()` |
| OS Info | Name, version, kernel | `/etc/os-release` |
| Uptime | Seconds since boot | `sysinfo` |

**Why This Matters:** The hypervisor only sees *allocated* resources. The agent reports *actual* usage inside the VM.

### 4.2 Command Execution

**Purpose:** Run commands inside the VM remotely.

**Features:**
- Timeout support (configurable, default 300s)
- User context execution (run as specific user)
- Supplementary groups support
- Working directory specification
- Environment variable injection

**Request:**
```protobuf
message ExecuteRequest {
  string command = 1;
  repeated string args = 2;
  string working_directory = 3;
  map<string, string> environment = 4;
  uint32 timeout_seconds = 5;
  string run_as_user = 6;
  string run_as_group = 7;
  bool include_supplementary_groups = 8;
}
```

**Response:**
```protobuf
message ExecuteResponse {
  int32 exit_code = 1;
  string stdout = 2;
  string stderr = 3;
  uint64 duration_ms = 4;
  bool timed_out = 5;
}
```

### 4.3 File Operations

#### File Read (Chunked)

**Purpose:** Download files from the VM without SSH.

**Chunk Size:** 64KB (configurable)

**Request:**
```protobuf
message FileReadRequest {
  string path = 1;
  uint64 offset = 2;
  uint32 max_bytes = 3;
}
```

#### File Write (Chunked)

**Purpose:** Upload files to the VM without SSH.

**Request:**
```protobuf
message FileWriteRequest {
  string path = 1;
  bytes data = 2;
  uint64 offset = 3;
  bool truncate = 4;
  uint32 mode = 5;
}
```

#### Directory Listing

**Purpose:** Browse filesystem for file browser UI.

**Features:**
- Pagination via continuation tokens
- Hidden file filtering
- Symlink detection
- Owner/group resolution

**Request:**
```protobuf
message ListDirectoryRequest {
  string path = 1;
  bool include_hidden = 2;
  uint32 max_entries = 3;
  string continuation_token = 4;
}
```

**Response:**
```protobuf
message DirectoryEntry {
  string name = 1;
  string path = 2;
  bool is_directory = 3;
  bool is_symlink = 4;
  string symlink_target = 5;
  uint64 size_bytes = 6;
  uint32 mode = 7;
  google.protobuf.Timestamp modified_at = 8;
  google.protobuf.Timestamp created_at = 9;
  string owner = 10;
  string group = 11;
}
```

### 4.4 Lifecycle Operations

#### Graceful Shutdown/Reboot

**Commands:**
- Linux: `shutdown -h now` / `shutdown -r now`
- Windows: `shutdown /s /t 0` / `shutdown /r /t 0`

**Request:**
```protobuf
message ShutdownRequest {
  ShutdownType type = 1;  // POWEROFF, REBOOT, HALT
  uint32 delay_seconds = 2;
  string message = 3;
}
```

#### Password Reset

**Purpose:** Reset user password without console access.

**Implementation:**
- Linux: `chpasswd` command
- Windows: `net user` command

**Request:**
```protobuf
message ResetPasswordRequest {
  string username = 1;
  string new_password = 2;
}
```

#### Network Configuration

**Purpose:** Configure network settings via API.

**Supported Network Managers:**
- Netplan (Ubuntu/Debian)
- NetworkManager (RHEL/CentOS/Fedora)
- netsh (Windows)

**Request:**
```protobuf
message ConfigureNetworkRequest {
  string interface = 1;
  string ip_address = 2;
  string netmask = 3;
  string gateway = 4;
  repeated string dns_servers = 5;
  bool dhcp = 6;
}
```

### 4.5 Desktop Integration

#### Display Resize

**Purpose:** Resize guest display when QVMC window resizes.

**Implementation:**
- **Linux (X11):** `xrandr --output Virtual-1 --mode WxH` with automatic modeline creation via `cvt`
- **Linux (Wayland):** `wlr-randr` command
- **Windows:** `ChangeDisplaySettingsExW()` Win32 API

**Request:**
```protobuf
message DisplayResizeRequest {
  uint32 width = 1;
  uint32 height = 2;
  uint32 dpi = 3;
  string display_id = 4;  // For multi-monitor
}
```

#### Clipboard Sharing

**Purpose:** Bi-directional copy/paste between host and guest.

**Supported Types:**
- Text (UTF-8)
- Images (PNG/JPEG)
- HTML (future)
- Files (future)

**Implementation:**
- Cross-platform via `arboard` crate
- Linux: X11 selection / Wayland clipboard
- Windows: Win32 Clipboard API

**Request:**
```protobuf
message ClipboardUpdateRequest {
  ClipboardType type = 1;  // TEXT, IMAGE, FILES, HTML
  bytes data = 2;
  string mime_type = 3;
}
```

### 4.6 Process Management

#### List Processes

**Purpose:** View running processes inside the VM.

**Information Returned:**
- PID, PPID
- Process name, command line
- User
- CPU %, Memory bytes
- State (running, sleeping, stopped, zombie)
- Start time
- Working directory

**Request:**
```protobuf
message ListProcessesRequest {
  string filter = 1;        // Name filter
  bool include_threads = 2;
  uint32 max_entries = 3;
}
```

#### Kill Process

**Purpose:** Terminate processes remotely.

**Signals Supported:**
- SIGTERM (15) - default
- SIGKILL (9)
- SIGHUP (1)
- SIGINT (2)
- SIGQUIT (3)

**Request:**
```protobuf
message KillProcessRequest {
  uint32 pid = 1;
  int32 signal = 2;  // Default: SIGTERM
}
```

### 4.7 Service Management

#### List Services

**Purpose:** View system services and their status.

**Implementation:**
- Linux: `systemctl list-units --type=service`
- Windows: `sc query`

**Information Returned:**
- Service name, display name
- State (running, stopped, starting, stopping)
- Start type (auto, manual, disabled)
- Description
- PID (if running)
- Memory usage

**Request:**
```protobuf
message ListServicesRequest {
  string filter = 1;
  bool include_disabled = 2;
}
```

#### Service Control

**Actions:**
- START
- STOP
- RESTART
- ENABLE
- DISABLE

**Request:**
```protobuf
message ServiceControlRequest {
  string name = 1;
  ServiceAction action = 2;
}
```

### 4.8 System Inventory

#### Hardware Information

**Purpose:** Collect detailed hardware inventory.

**Information Collected:**

| Component | Details |
|-----------|---------|
| **CPU** | Model, vendor, cores, threads, frequency, flags, architecture |
| **Memory** | Total, available, type, speed, slots |
| **Disks** | Device, model, type (SSD/HDD/NVMe), size, partitions |
| **Network** | Adapters, MAC, type (Ethernet/WiFi), speed |
| **BIOS** | Vendor, version, release date, system info |
| **OS** | Name, version, kernel, hostname, install date, boot time |
| **GPU** | Name, vendor, driver, VRAM (via lspci/WMIC) |

**Sources:**
- Linux: `/proc/*`, `/sys/*`, DMI files, `lspci`, `lscpu`
- Windows: WMIC, Registry, Win32 API

#### Installed Software

**Purpose:** List installed packages/applications.

**Implementation:**
- Debian/Ubuntu: `dpkg-query -W`
- RHEL/CentOS: `rpm -qa`
- Windows: Registry `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`

**Information Returned:**
- Package name, version
- Publisher/vendor
- Install date
- Size

### 4.9 Filesystem Quiescing

**Purpose:** Freeze filesystem I/O for consistent snapshots.

**Implementation:**
- **Linux:** `fsfreeze -f` / `fsfreeze -u`
- **Windows:** VSS (Volume Shadow Copy Service) via `diskshadow`

**Pre/Post Scripts:**
- Linux: `/etc/limiquantix/pre-freeze.d/`, `/etc/limiquantix/post-thaw.d/`
- Windows: `C:\ProgramData\LimiQuantix\pre-freeze.d\`, `C:\ProgramData\LimiQuantix\post-thaw.d\`

**Flow:**
1. Execute pre-freeze scripts (flush databases)
2. Freeze filesystems
3. Hypervisor takes snapshot
4. Thaw filesystems
5. Execute post-thaw scripts

### 4.10 Time Synchronization

**Purpose:** Sync guest clock after resume from suspend/pause.

**Implementation:**
- Chrony: `chronyc makestep`
- systemd-timesyncd: `timedatectl set-ntp true`
- ntpd: `ntpdate -u pool.ntp.org`
- Windows: `w32tm /resync`

### 4.11 Agent Self-Update

**Purpose:** Update the agent binary remotely.

**Flow:**
1. Receive chunked binary data
2. Write to temporary file
3. Verify SHA256 checksum
4. Backup current binary
5. Atomic rename to replace
6. Schedule service restart

**States:**
- IDLE → DOWNLOADING → VERIFYING → APPLYING → COMPLETE
- On failure: FAILED → ROLLING_BACK → IDLE

---

## 5. Configuration

### Configuration File Locations

| Platform | Path |
|----------|------|
| Linux | `/etc/limiquantix/agent.yaml` |
| Windows | `C:\ProgramData\LimiQuantix\agent.yaml` |

### Complete Configuration Reference

```yaml
# =============================================================================
# Quantix Guest Agent Configuration
# =============================================================================

# -----------------------------------------------------------------------------
# Telemetry Settings
# -----------------------------------------------------------------------------
telemetry_interval_secs: 5      # How often to send telemetry (seconds)
max_exec_timeout_secs: 300      # Maximum command execution time
max_chunk_size: 65536           # File transfer chunk size (bytes)

# -----------------------------------------------------------------------------
# Logging Settings
# -----------------------------------------------------------------------------
log_level: info                 # trace, debug, info, warn, error
log_format: json                # json or pretty
log_file: ""                    # Empty = stdout only
                                # Linux: /var/log/limiquantix/agent.log
                                # Windows: C:\ProgramData\LimiQuantix\Logs\agent.log
log_max_size_bytes: 10485760    # 10MB per log file
log_max_files: 5                # Keep 5 rotated files

# -----------------------------------------------------------------------------
# Transport Settings
# -----------------------------------------------------------------------------
device_path: auto               # auto-detect or explicit path
                                # Linux: /dev/virtio-ports/org.limiquantix.agent.0
                                # Windows: \\.\Global\org.limiquantix.agent.0

# -----------------------------------------------------------------------------
# Quiescing Scripts
# -----------------------------------------------------------------------------
pre_freeze_script_dir: /etc/limiquantix/pre-freeze.d
post_thaw_script_dir: /etc/limiquantix/post-thaw.d

# -----------------------------------------------------------------------------
# Security Settings
# -----------------------------------------------------------------------------
security:
  # Command allowlist (empty = allow all)
  command_allowlist: []
  # Example:
  # command_allowlist:
  #   - /usr/bin/systemctl
  #   - /usr/bin/journalctl
  #   - /bin/cat
  
  # Command blocklist (takes precedence over allowlist)
  command_blocklist: []
  # Example:
  # command_blocklist:
  #   - /bin/rm
  #   - /sbin/reboot
  
  # File write path restrictions (empty = allow all)
  allow_file_write_paths: []
  # Example:
  # allow_file_write_paths:
  #   - /tmp
  #   - /var/log
  
  # File read path restrictions
  deny_file_read_paths: []
  # Example:
  # deny_file_read_paths:
  #   - /etc/shadow
  #   - /etc/sudoers
  
  # Rate limiting (0 = unlimited)
  max_commands_per_minute: 0
  max_file_ops_per_second: 0
  
  # Audit logging
  audit_logging: false
  audit_log_file: /var/log/limiquantix/audit.log

# -----------------------------------------------------------------------------
# Health Check Settings
# -----------------------------------------------------------------------------
health:
  enabled: true
  interval_secs: 30             # Health check interval
  telemetry_timeout_secs: 60    # Alert if no telemetry sent
```

### Windows-Specific Configuration

```yaml
# C:\ProgramData\LimiQuantix\agent.yaml
device_path: "\\\\?\\Global\\org.limiquantix.agent.0"
log_file: "C:\\ProgramData\\LimiQuantix\\Logs\\agent.log"
pre_freeze_script_dir: "C:\\ProgramData\\LimiQuantix\\pre-freeze.d"
post_thaw_script_dir: "C:\\ProgramData\\LimiQuantix\\post-thaw.d"
```

---

## 6. Security

### 6.1 Authentication Model

The virtio-serial channel provides **inherent authentication** through VM isolation:
- Only the specific VM can access its character device
- Only the Node Daemon can access the host-side Unix socket
- No network exposure

### 6.2 Authorization

Commands are authorized at multiple levels:
1. **Control Plane:** User must have permission on the VM
2. **Node Daemon:** Validates request source
3. **Guest Agent:** Applies allowlist/blocklist rules

### 6.3 Command Allowlisting

Restrict which commands can be executed:

```yaml
security:
  command_allowlist:
    - /usr/bin/systemctl
    - /usr/bin/journalctl
    - /bin/cat
    - /usr/bin/df
  command_blocklist:
    - /bin/rm
    - /sbin/reboot
    - /sbin/shutdown
```

### 6.4 File Path Restrictions

Control file access:

```yaml
security:
  allow_file_write_paths:
    - /tmp
    - /var/log
    - /home
  deny_file_read_paths:
    - /etc/shadow
    - /etc/sudoers
    - /root/.ssh
```

### 6.5 Rate Limiting

Prevent abuse:

```yaml
security:
  max_commands_per_minute: 100
  max_file_ops_per_second: 10
```

### 6.6 Audit Logging

Log all operations for compliance:

```yaml
security:
  audit_logging: true
  audit_log_file: /var/log/limiquantix/audit.log
```

**Audit Log Format (JSON):**
```json
{
  "timestamp": "2026-01-25T10:30:00.000Z",
  "operation": "execute",
  "command": "systemctl restart nginx",
  "user": "root",
  "exit_code": 0,
  "duration_ms": 150,
  "source": "control_plane",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "allowed": true
}
```

### 6.7 Input Validation

The agent validates all inputs:
- **Path Validation:** Prevents directory traversal (`../`)
- **Command Sanitization:** Validates against allow/blocklist
- **Size Limits:** Truncates large outputs
- **Timeouts:** Prevents runaway processes

---

## 7. Error Codes

### Error Code Format

All agent errors follow this format:

```
QXGA-XXXX: Description
```

Where:
- `QX` = Quantix
- `GA` = Guest Agent
- `XXXX` = 4-digit error code

### Error Code Categories

| Range | Category |
|-------|----------|
| 1000-1999 | Transport/Connection Errors |
| 2000-2999 | Protocol/Message Errors |
| 3000-3999 | Execution Errors |
| 4000-4999 | File Operation Errors |
| 5000-5999 | Lifecycle Errors |
| 6000-6999 | Desktop Integration Errors |
| 7000-7999 | Process/Service Errors |
| 8000-8999 | Security Errors |
| 9000-9999 | Internal Errors |

### Complete Error Code Reference

#### Transport Errors (1000-1999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-1001 | DEVICE_NOT_FOUND | Virtio-serial device not found | Ensure VM has virtio-serial channel configured |
| QXGA-1002 | DEVICE_OPEN_FAILED | Failed to open device | Check permissions, device may be in use |
| QXGA-1003 | CONNECTION_LOST | Connection to host lost | Agent will auto-reconnect |
| QXGA-1004 | WRITE_FAILED | Failed to write to device | Check device health |
| QXGA-1005 | READ_FAILED | Failed to read from device | Check device health |
| QXGA-1006 | DEVICE_BUSY | Device is busy | Another process may be using it |
| QXGA-1007 | VSOCK_UNAVAILABLE | VSOCK not available | Kernel may not support AF_VSOCK |

#### Protocol Errors (2000-2999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-2001 | INVALID_MESSAGE | Message failed to decode | Check protobuf version compatibility |
| QXGA-2002 | UNKNOWN_MESSAGE_TYPE | Unknown message type received | Update agent to latest version |
| QXGA-2003 | MESSAGE_TOO_LARGE | Message exceeds size limit | Reduce payload size |
| QXGA-2004 | MISSING_PAYLOAD | Message has no payload | Include payload in request |
| QXGA-2005 | INVALID_MESSAGE_ID | Invalid or missing message ID | Provide valid UUID |
| QXGA-2006 | ENCODING_ERROR | Failed to encode response | Internal error, check logs |

#### Execution Errors (3000-3999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-3001 | COMMAND_NOT_FOUND | Command not found | Check command path |
| QXGA-3002 | PERMISSION_DENIED | Permission denied | Run as appropriate user |
| QXGA-3003 | EXECUTION_TIMEOUT | Command timed out | Increase timeout or optimize command |
| QXGA-3004 | COMMAND_BLOCKED | Command blocked by policy | Check security.command_blocklist |
| QXGA-3005 | USER_NOT_FOUND | Specified user not found | Check run_as_user value |
| QXGA-3006 | GROUP_NOT_FOUND | Specified group not found | Check run_as_group value |
| QXGA-3007 | SETUID_FAILED | Failed to set user context | Agent may need root privileges |
| QXGA-3008 | WORKING_DIR_NOT_FOUND | Working directory not found | Check working_directory path |

#### File Operation Errors (4000-4999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-4001 | FILE_NOT_FOUND | File not found | Check file path |
| QXGA-4002 | FILE_ACCESS_DENIED | Access denied | Check file permissions |
| QXGA-4003 | FILE_ALREADY_EXISTS | File already exists | Use truncate=true or different path |
| QXGA-4004 | DIRECTORY_NOT_FOUND | Directory not found | Create parent directories |
| QXGA-4005 | NOT_A_DIRECTORY | Path is not a directory | Check path |
| QXGA-4006 | NOT_A_FILE | Path is not a file | Check path |
| QXGA-4007 | PATH_TRAVERSAL_BLOCKED | Path traversal detected | Remove ../ from path |
| QXGA-4008 | WRITE_PATH_BLOCKED | Write to path blocked | Check security.allow_file_write_paths |
| QXGA-4009 | READ_PATH_BLOCKED | Read from path blocked | Check security.deny_file_read_paths |
| QXGA-4010 | DISK_FULL | Disk is full | Free up disk space |
| QXGA-4011 | FILE_TOO_LARGE | File exceeds size limit | Use chunked transfer |
| QXGA-4012 | INVALID_OFFSET | Invalid file offset | Check offset value |
| QXGA-4013 | DELETE_FAILED | Failed to delete | Check permissions |
| QXGA-4014 | MKDIR_FAILED | Failed to create directory | Check permissions |

#### Lifecycle Errors (5000-5999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-5001 | SHUTDOWN_FAILED | Shutdown command failed | Check system state |
| QXGA-5002 | REBOOT_FAILED | Reboot command failed | Check system state |
| QXGA-5003 | PASSWORD_RESET_FAILED | Password reset failed | Check username, permissions |
| QXGA-5004 | NETWORK_CONFIG_FAILED | Network configuration failed | Check network manager |
| QXGA-5005 | QUIESCE_FAILED | Filesystem quiesce failed | Check mount points |
| QXGA-5006 | THAW_FAILED | Filesystem thaw failed | May need manual intervention |
| QXGA-5007 | ALREADY_QUIESCED | Filesystems already quiesced | Call thaw first |
| QXGA-5008 | NOT_QUIESCED | Filesystems not quiesced | Call quiesce first |
| QXGA-5009 | TIME_SYNC_FAILED | Time synchronization failed | Check NTP service |

#### Desktop Integration Errors (6000-6999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-6001 | DISPLAY_NOT_FOUND | Display not found | Check display_id |
| QXGA-6002 | RESOLUTION_NOT_SUPPORTED | Resolution not supported | Try different resolution |
| QXGA-6003 | DISPLAY_RESIZE_FAILED | Display resize failed | Check display driver |
| QXGA-6004 | CLIPBOARD_ACCESS_FAILED | Clipboard access failed | Check display server |
| QXGA-6005 | CLIPBOARD_EMPTY | Clipboard is empty | Nothing to read |
| QXGA-6006 | CLIPBOARD_TYPE_UNSUPPORTED | Clipboard type not supported | Use text or image |
| QXGA-6007 | NO_DISPLAY_SERVER | No display server running | Start X11/Wayland |
| QXGA-6008 | XRANDR_NOT_FOUND | xrandr not found | Install xrandr |

#### Process/Service Errors (7000-7999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-7001 | PROCESS_NOT_FOUND | Process not found | Check PID |
| QXGA-7002 | KILL_FAILED | Failed to kill process | Check permissions |
| QXGA-7003 | SERVICE_NOT_FOUND | Service not found | Check service name |
| QXGA-7004 | SERVICE_START_FAILED | Service start failed | Check service logs |
| QXGA-7005 | SERVICE_STOP_FAILED | Service stop failed | Check service state |
| QXGA-7006 | SERVICE_ALREADY_RUNNING | Service already running | No action needed |
| QXGA-7007 | SERVICE_NOT_RUNNING | Service not running | Start service first |
| QXGA-7008 | SYSTEMCTL_NOT_FOUND | systemctl not found | Not a systemd system |

#### Security Errors (8000-8999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-8001 | RATE_LIMIT_EXCEEDED | Rate limit exceeded | Wait and retry |
| QXGA-8002 | COMMAND_NOT_ALLOWED | Command not in allowlist | Add to allowlist |
| QXGA-8003 | PATH_NOT_ALLOWED | Path access not allowed | Update path restrictions |
| QXGA-8004 | AUDIT_LOG_FAILED | Failed to write audit log | Check audit log path |

#### Internal Errors (9000-9999)

| Code | Name | Description | Resolution |
|------|------|-------------|------------|
| QXGA-9001 | CONFIG_LOAD_FAILED | Failed to load configuration | Check config file syntax |
| QXGA-9002 | CONFIG_INVALID | Configuration validation failed | Check config values |
| QXGA-9003 | INTERNAL_ERROR | Internal agent error | Check agent logs |
| QXGA-9004 | UPDATE_FAILED | Agent update failed | Check update logs |
| QXGA-9005 | CHECKSUM_MISMATCH | Update checksum mismatch | Re-download update |
| QXGA-9006 | ROLLBACK_FAILED | Update rollback failed | Manual intervention needed |

---

## 8. Packaging & Installation

### 8.1 Linux (Debian/Ubuntu)

**Build:**
```bash
cd agent/limiquantix-guest-agent/packaging
./build-packages.sh deb
```

**Output:** `limiquantix-guest-agent_0.1.0_amd64.deb`

**Install:**
```bash
sudo dpkg -i limiquantix-guest-agent_0.1.0_amd64.deb
```

**Uninstall:**
```bash
sudo apt remove limiquantix-guest-agent
```

### 8.2 Linux (RHEL/CentOS/Fedora)

**Build:**
```bash
cd agent/limiquantix-guest-agent/packaging
./build-packages.sh rpm
```

**Output:** `limiquantix-guest-agent-0.1.0-1.x86_64.rpm`

**Install:**
```bash
sudo rpm -ivh limiquantix-guest-agent-0.1.0-1.x86_64.rpm
```

**Uninstall:**
```bash
sudo rpm -e limiquantix-guest-agent
```

### 8.3 Windows (MSI)

**Build:**
```powershell
cd agent\limiquantix-guest-agent\packaging\windows
.\build-msi.ps1 -Version "0.1.0"
```

**Output:** `limiquantix-agent-0.1.0-x64.msi`

**Install (Silent):**
```powershell
msiexec /i limiquantix-agent-0.1.0-x64.msi /quiet /log install.log
```

**Uninstall:**
```powershell
msiexec /x limiquantix-agent-0.1.0-x64.msi /quiet
```

### 8.4 Windows (EXE - Inno Setup)

**Build:**
```powershell
iscc packaging\windows\inno\setup.iss
```

**Output:** `limiquantix-agent-0.1.0-setup.exe`

### 8.5 Cloud-Init Auto-Installation

Include in VM's `user_data` during creation:

```yaml
#cloud-config
runcmd:
  - |
    # Detect OS and architecture
    if [ -f /etc/os-release ]; then
      . /etc/os-release
      DISTRO_ID="$ID"
    fi
    ARCH=$(uname -m)
    
    # Download and install
    if [ "$DISTRO_ID" = "ubuntu" ] || [ "$DISTRO_ID" = "debian" ]; then
      curl -sL https://releases.quantix.io/agent/latest/linux-${ARCH}.deb -o /tmp/agent.deb
      dpkg -i /tmp/agent.deb
    elif [ "$DISTRO_ID" = "centos" ] || [ "$DISTRO_ID" = "rhel" ] || [ "$DISTRO_ID" = "fedora" ]; then
      curl -sL https://releases.quantix.io/agent/latest/linux-${ARCH}.rpm -o /tmp/agent.rpm
      rpm -ivh /tmp/agent.rpm
    elif [ "$DISTRO_ID" = "alpine" ]; then
      curl -sL https://releases.quantix.io/agent/latest/linux-${ARCH}.tar.gz -o /tmp/agent.tar.gz
      tar -xzf /tmp/agent.tar.gz -C /usr/local/bin
      rc-update add limiquantix-agent default
      rc-service limiquantix-agent start
    fi
```

### 8.6 Service Management

**Linux (systemd):**
```bash
# Start
sudo systemctl start limiquantix-agent

# Stop
sudo systemctl stop limiquantix-agent

# Restart
sudo systemctl restart limiquantix-agent

# Status
sudo systemctl status limiquantix-agent

# Enable on boot
sudo systemctl enable limiquantix-agent

# View logs
sudo journalctl -u limiquantix-agent -f
```

**Linux (OpenRC - Alpine):**
```bash
# Start
sudo rc-service limiquantix-agent start

# Stop
sudo rc-service limiquantix-agent stop

# Status
sudo rc-service limiquantix-agent status

# Enable on boot
sudo rc-update add limiquantix-agent default
```

**Windows:**
```powershell
# Start
Start-Service LimiQuantixAgent

# Stop
Stop-Service LimiQuantixAgent

# Restart
Restart-Service LimiQuantixAgent

# Status
Get-Service LimiQuantixAgent

# View logs
Get-EventLog -LogName Application -Source LimiQuantixAgent
```

---

## 9. API Reference

### 9.1 REST API (via Node Daemon)

The Node Daemon exposes REST endpoints for agent operations:

#### Ping Agent
```
POST /api/v1/vms/{vm_id}/agent/ping
```

**Response:**
```json
{
  "connected": true,
  "version": "0.1.0",
  "uptime_seconds": 3600
}
```

#### Execute Command
```
POST /api/v1/vms/{vm_id}/agent/execute
```

**Request:**
```json
{
  "command": "systemctl status nginx",
  "timeout_seconds": 30,
  "run_as_user": "root"
}
```

**Response:**
```json
{
  "exit_code": 0,
  "stdout": "● nginx.service - A high performance web server...",
  "stderr": "",
  "duration_ms": 45
}
```

#### List Directory
```
POST /api/v1/vms/{vm_id}/agent/files/list
```

**Request:**
```json
{
  "path": "/var/log",
  "include_hidden": false,
  "max_entries": 100
}
```

#### Read File
```
POST /api/v1/vms/{vm_id}/agent/files/read
```

**Request:**
```json
{
  "path": "/etc/hosts"
}
```

#### Write File
```
POST /api/v1/vms/{vm_id}/agent/files/write
```

**Request:**
```json
{
  "path": "/tmp/test.txt",
  "content": "Hello, World!",
  "mode": 420
}
```

#### Delete File
```
POST /api/v1/vms/{vm_id}/agent/files/delete
```

**Request:**
```json
{
  "path": "/tmp/test.txt",
  "recursive": false
}
```

#### List Processes
```
GET /api/v1/vms/{vm_id}/agent/processes
```

**Query Parameters:**
- `filter` - Process name filter
- `max_entries` - Maximum entries to return

#### Kill Process
```
POST /api/v1/vms/{vm_id}/agent/processes/{pid}/kill
```

**Request:**
```json
{
  "signal": 15
}
```

#### List Services
```
GET /api/v1/vms/{vm_id}/agent/services
```

#### Control Service
```
POST /api/v1/vms/{vm_id}/agent/services/{name}/control
```

**Request:**
```json
{
  "action": "restart"
}
```

#### Get Hardware Info
```
GET /api/v1/vms/{vm_id}/agent/hardware
```

#### Get Installed Software
```
GET /api/v1/vms/{vm_id}/agent/software
```

#### Resize Display
```
POST /api/v1/vms/{vm_id}/agent/display/resize
```

**Request:**
```json
{
  "width": 1920,
  "height": 1080,
  "dpi": 96
}
```

#### Get Clipboard
```
GET /api/v1/vms/{vm_id}/agent/clipboard
```

#### Set Clipboard
```
POST /api/v1/vms/{vm_id}/agent/clipboard
```

**Request:**
```json
{
  "type": "text",
  "data": "Hello from host!"
}
```

#### Quiesce Filesystems
```
POST /api/v1/vms/{vm_id}/agent/quiesce
```

**Request:**
```json
{
  "mount_points": ["/"],
  "timeout_seconds": 60
}
```

#### Thaw Filesystems
```
POST /api/v1/vms/{vm_id}/agent/thaw
```

#### Sync Time
```
POST /api/v1/vms/{vm_id}/agent/sync-time
```

**Request:**
```json
{
  "force": true
}
```

#### Get Capabilities
```
GET /api/v1/vms/{vm_id}/agent/capabilities
```

**Response:**
```json
{
  "version": "0.1.0",
  "os": "linux",
  "architecture": "x86_64",
  "capabilities": [
    "telemetry",
    "execute",
    "file_read",
    "file_write",
    "file_list",
    "file_delete",
    "directory_create",
    "shutdown",
    "reboot",
    "reset_password",
    "configure_network",
    "quiesce",
    "thaw",
    "sync_time",
    "display_resize",
    "clipboard_read",
    "clipboard_write",
    "process_list",
    "process_kill",
    "service_list",
    "service_control",
    "hardware_info",
    "software_list",
    "self_update"
  ],
  "features": {
    "user_context_exec": "true",
    "fsfreeze": "true"
  }
}
```

---

## 10. Troubleshooting

### 10.1 Agent Not Connecting

**Symptoms:**
- "Guest Agent: Disconnected" in UI
- No telemetry data

**Checks:**

1. **Verify device exists (Linux):**
   ```bash
   ls -la /dev/virtio-ports/
   # Should show: org.limiquantix.agent.0
   ```

2. **Verify device exists (Windows):**
   ```powershell
   Get-WmiObject Win32_PnPEntity | Where-Object { $_.Name -like "*virtio*" }
   ```

3. **Check agent service:**
   ```bash
   # Linux
   systemctl status limiquantix-agent
   
   # Windows
   Get-Service LimiQuantixAgent
   ```

4. **Check agent logs:**
   ```bash
   # Linux
   journalctl -u limiquantix-agent -n 100
   
   # Windows
   Get-EventLog -LogName Application -Source LimiQuantixAgent -Newest 100
   ```

5. **Verify VM has virtio-serial channel:**
   ```bash
   virsh dumpxml <vm_name> | grep -A5 "channel type='unix'"
   ```

### 10.2 Commands Failing

**Symptoms:**
- Execute returns error
- QXGA-3004 (Command Blocked)

**Checks:**

1. **Check command allowlist:**
   ```bash
   cat /etc/limiquantix/agent.yaml | grep -A10 security
   ```

2. **Test command manually:**
   ```bash
   # Run the exact command inside VM
   /usr/bin/systemctl status nginx
   ```

3. **Check user permissions:**
   ```bash
   # If using run_as_user
   sudo -u <user> <command>
   ```

### 10.3 File Operations Failing

**Symptoms:**
- QXGA-4007 (Path Traversal Blocked)
- QXGA-4008 (Write Path Blocked)

**Checks:**

1. **Check path restrictions:**
   ```bash
   cat /etc/limiquantix/agent.yaml | grep -A10 security
   ```

2. **Verify path exists:**
   ```bash
   ls -la <path>
   ```

3. **Check permissions:**
   ```bash
   stat <path>
   ```

### 10.4 Display Resize Not Working

**Symptoms:**
- QXGA-6003 (Display Resize Failed)
- Resolution doesn't change

**Checks:**

1. **Check display server (Linux):**
   ```bash
   echo $DISPLAY
   echo $WAYLAND_DISPLAY
   ```

2. **Check xrandr (Linux X11):**
   ```bash
   xrandr --query
   ```

3. **Check available modes:**
   ```bash
   xrandr --output Virtual-1 --query
   ```

4. **Try manual resize:**
   ```bash
   xrandr --output Virtual-1 --mode 1920x1080
   ```

### 10.5 Quiesce Failing

**Symptoms:**
- QXGA-5005 (Quiesce Failed)
- Snapshots not consistent

**Checks:**

1. **Check fsfreeze availability (Linux):**
   ```bash
   which fsfreeze
   ```

2. **Test manually:**
   ```bash
   sudo fsfreeze -f /
   sudo fsfreeze -u /
   ```

3. **Check VSS (Windows):**
   ```powershell
   vssadmin list writers
   ```

### 10.6 High CPU/Memory Usage

**Symptoms:**
- Agent using excessive resources

**Checks:**

1. **Check telemetry interval:**
   ```yaml
   # Increase if too frequent
   telemetry_interval_secs: 10
   ```

2. **Check log level:**
   ```yaml
   # Reduce logging
   log_level: warn
   ```

3. **Check for stuck operations:**
   ```bash
   journalctl -u limiquantix-agent | grep -i error
   ```

---

## 11. Development Guide

### 11.1 Project Structure

```
agent/limiquantix-guest-agent/
├── Cargo.toml                 # Dependencies and features
├── README.md                  # Quick start guide
├── packaging/
│   ├── build-packages.sh      # Linux package builder
│   ├── config/
│   │   └── agent.yaml         # Default configuration
│   ├── debian/
│   │   ├── control            # DEB metadata
│   │   ├── postinst           # Post-install script
│   │   └── prerm              # Pre-remove script
│   ├── rpm/
│   │   └── limiquantix-guest-agent.spec
│   ├── systemd/
│   │   └── limiquantix-agent.service
│   ├── windows/
│   │   ├── wix/               # MSI configuration
│   │   └── inno/              # EXE installer
│   └── cloud-init/
│       └── install-agent.yaml
├── src/
│   ├── main.rs                # Entry point
│   ├── config.rs              # Configuration management
│   ├── protocol.rs            # Message framing
│   ├── telemetry.rs           # Metrics collection
│   ├── transport.rs           # Virtio-serial transport
│   ├── security.rs            # Security module
│   ├── vsock.rs               # VSOCK transport (optional)
│   └── handlers/
│       ├── mod.rs             # Message routing
│       ├── clipboard.rs       # Clipboard operations
│       ├── directory.rs       # Directory operations
│       ├── display.rs         # Display resize
│       ├── execute.rs         # Command execution
│       ├── file.rs            # File read/write
│       ├── inventory.rs       # Hardware/software info
│       ├── lifecycle.rs       # Shutdown, password, network
│       ├── process.rs         # Process management
│       ├── quiesce.rs         # Filesystem quiescing
│       ├── service.rs         # Service management
│       ├── timesync.rs        # Time synchronization
│       └── update.rs          # Agent self-update
└── tests/
    └── integration_test.rs    # Integration tests
```

### 11.2 Building

**Debug Build:**
```bash
cd agent
cargo build -p limiquantix-guest-agent
```

**Release Build:**
```bash
cargo build --release -p limiquantix-guest-agent
```

**Cross-Compile for Windows:**
```bash
cargo build --release --target x86_64-pc-windows-msvc -p limiquantix-guest-agent
```

**Cross-Compile for ARM64:**
```bash
cross build --release --target aarch64-unknown-linux-gnu -p limiquantix-guest-agent
```

### 11.3 Testing

**Run Unit Tests:**
```bash
cargo test -p limiquantix-guest-agent
```

**Run Integration Tests:**
```bash
cargo test -p limiquantix-guest-agent --test integration_test
```

### 11.4 Adding a New Handler

1. **Create handler file:**
   ```rust
   // src/handlers/myfeature.rs
   use limiquantix_proto::agent::{agent_message, MyFeatureRequest, MyFeatureResponse};
   use tracing::info;
   
   pub async fn handle_my_feature(req: MyFeatureRequest) -> agent_message::Payload {
       info!(param = %req.param, "Handling my feature request");
       
       // Implementation...
       
       agent_message::Payload::MyFeatureResponse(MyFeatureResponse {
           success: true,
           error: String::new(),
       })
   }
   ```

2. **Add to mod.rs:**
   ```rust
   mod myfeature;
   
   // In handle() match:
   agent_message::Payload::MyFeature(req) => {
       info!("Handling my feature request");
       Some(myfeature::handle_my_feature(req).await)
   }
   ```

3. **Add proto messages:**
   ```protobuf
   // agent.proto
   message MyFeatureRequest {
     string param = 1;
   }
   
   message MyFeatureResponse {
     bool success = 1;
     string error = 2;
   }
   ```

4. **Regenerate proto:**
   ```bash
   cd agent/limiquantix-proto
   cargo build
   ```

### 11.5 Dependencies

```toml
[dependencies]
# Async runtime
tokio = { version = "1", features = ["full", "fs", "process", "signal"] }

# Protobuf
prost = "0.13"
prost-types = "0.13"

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
tracing-appender = "0.2"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1.0"
serde_yaml = "0.9"

# System info
sysinfo = "0.32"

# Error handling
thiserror = "1"
anyhow = "1"

# Utilities
uuid = { version = "1", features = ["v4"] }
chrono = "0.4"
hostname = "0.4"

# Clipboard
arboard = "3.4"

# Checksums
sha2 = "0.10"

# Platform-specific
[target.'cfg(unix)'.dependencies]
nix = { version = "0.28", features = ["fs", "net", "user"] }
libc = "0.2"

[target.'cfg(windows)'.dependencies]
windows = { version = "0.52", features = [...] }
```

---

## 12. Performance Metrics

### Target Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Binary Size | < 5 MB | ~3 MB |
| Memory Usage (idle) | < 20 MB | ~10 MB |
| CPU Usage (idle) | < 0.5% | ~0.1% |
| Telemetry Latency | < 100ms | ~20ms |
| Command Overhead | < 50ms | ~10ms |
| File Transfer | > 50 MB/s | ~80 MB/s |
| Install Time | < 30 seconds | ~5 seconds |

### Optimization Tips

1. **Reduce telemetry frequency for idle VMs:**
   ```yaml
   telemetry_interval_secs: 30
   ```

2. **Disable unused features:**
   ```yaml
   # Disable clipboard monitoring
   clipboard_monitoring: false
   ```

3. **Use VSOCK for large file transfers:**
   ```yaml
   prefer_vsock: true
   ```

4. **Reduce log verbosity:**
   ```yaml
   log_level: warn
   ```

---

## Related Documents

| Document | Description |
|----------|-------------|
| [000044 - Guest Agent Architecture](./Agent/000044-guest-agent-architecture.md) | Original architecture design |
| [000045 - Guest Agent Integration](./Agent/000045-guest-agent-integration-complete.md) | Integration with Node Daemon |
| [000049 - Windows Support](./quantix-agent/000049-guest-agent-windows-support.md) | Windows-specific features |
| [000061 - Agent Crates](./Quantix-OS/000061-agent-architecture.md) | Rust crate structure |
| [000086 - Desktop Enhancements](./000086-guest-agent-enhancements.md) | Desktop integration plan |
| [000087 - Implementation Summary](./000087-guest-agent-implementation.md) | Phase 1-10 implementation |

---

## Error Code Implementation

The error codes are implemented in `agent/limiquantix-guest-agent/src/error.rs` and provide:

### AgentError Structure

```rust
pub struct AgentError {
    pub code: ErrorCode,           // Numeric code (e.g., 4001)
    pub category: ErrorCategory,   // Category enum
    pub name: String,              // Error name (e.g., "FILE_NOT_FOUND")
    pub message: String,           // Detailed message
    pub context: Option<String>,   // Additional context
    pub resolution: Option<String>, // Suggested fix
}
```

### Usage Examples

```rust
use limiquantix_guest_agent::error::{AgentError, file_ops};

// Create error with convenience constructor
let err = AgentError::file_not_found("/etc/hosts");

// Create error with full details
let err = AgentError::new(file_ops::FILE_ACCESS_DENIED, "Cannot read file")
    .with_context("User: nobody")
    .with_resolution("Check file permissions");

// Get formatted error code
println!("{}", err.code_string()); // "QXGA-4002"

// Serialize to JSON
let json = err.to_json();
```

### Error Categories

```rust
pub enum ErrorCategory {
    Transport,      // 1000-1999
    Protocol,       // 2000-2999
    Execution,      // 3000-3999
    FileOperation,  // 4000-4999
    Lifecycle,      // 5000-5999
    Desktop,        // 6000-6999
    ProcessService, // 7000-7999
    Security,       // 8000-8999
    Internal,       // 9000-9999
}
```

---

## Changelog

### Version 0.1.0 (2026-01-25)

**Initial Release with Full Feature Set:**
- Core telemetry and execution
- File operations (read, write, list, delete, stat)
- Lifecycle operations (shutdown, reboot, password reset, network config)
- Desktop integration (display resize, clipboard)
- Process and service management
- System inventory (hardware, software)
- Filesystem quiescing (fsfreeze, VSS)
- Time synchronization
- Agent self-update
- Security features (allowlist, rate limiting, audit logging)
- Full packaging (DEB, RPM, MSI, EXE, Cloud-Init)
- VSOCK transport option
- Comprehensive error codes
