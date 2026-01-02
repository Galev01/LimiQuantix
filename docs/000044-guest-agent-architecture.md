# 000044 - Guest Agent Architecture

> **Purpose:** This document describes the LimiQuantix Guest Agent architecture, protocol design, and implementation details. The Guest Agent enables deep integration between the Hypervisor (Node Daemon) and the Guest OS.

---

## 1. Executive Summary

The LimiQuantix Guest Agent is a lightweight Rust binary running **inside the Guest VM**. It enables deep integration between the Hypervisor (Node Daemon) and the Guest OS, bypassing the network layer to ensure management works even if the VM has no IP address.

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Telemetry** | Report real RAM/Disk usage (Hypervisor only sees allocated RAM, not used) |
| **Execution** | Run scripts/commands inside the VM (for automation/Ansible) |
| **File Transfer** | Push/Pull files without SSH |
| **Lifecycle** | Clean shutdown, password reset, IP reporting |

---

## 2. Architecture: Virtio-Serial Transport

We use **Virtio-Serial** (paravirtualized serial ports). This creates a direct data pipe between a Unix Socket on the Host and a Character Device inside the Guest.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Virtio-Serial Architecture                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         HYPERVISOR HOST                               │   │
│  │  ┌──────────────┐                      ┌──────────────────────────┐  │   │
│  │  │ Node Daemon  │──writes/reads──────▶│ Unix Socket              │  │   │
│  │  │ (Agent       │                      │ /var/run/limiquantix/    │  │   │
│  │  │  Client)     │                      │   vms/{vm_id}.agent.sock │  │   │
│  │  └──────────────┘                      └───────────┬──────────────┘  │   │
│  └────────────────────────────────────────────────────┼─────────────────┘   │
│                                                       │                      │
│  ┌────────────────────────────────────────────────────┼─────────────────┐   │
│  │                          QEMU/KVM PROCESS          │                  │   │
│  │                      ┌─────────────────────────────┴────┐             │   │
│  │                      │   Virtio-Serial Controller       │             │   │
│  │                      └─────────────────────────────┬────┘             │   │
│  └────────────────────────────────────────────────────┼─────────────────┘   │
│                                                       │                      │
│  ┌────────────────────────────────────────────────────┼─────────────────┐   │
│  │                          GUEST VM                  │                  │   │
│  │                      ┌─────────────────────────────┴────┐             │   │
│  │                      │  /dev/virtio-ports/              │             │   │
│  │                      │     org.limiquantix.agent.0      │             │   │
│  │                      └─────────────────────────────┬────┘             │   │
│  │  ┌──────────────┐                                  │                  │   │
│  │  │ Guest Agent  │◀──────reads/writes───────────────┘                  │   │
│  │  │ (Rust Binary)│                                                     │   │
│  │  └──────────────┘                                                     │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Paths

| Location | Path |
|----------|------|
| **Host (Unix Socket)** | `/var/run/limiquantix/vms/{vm_id}.agent.sock` |
| **Guest (Linux)** | `/dev/virtio-ports/org.limiquantix.agent.0` |
| **Guest (Windows)** | `\\.\Global\org.limiquantix.agent.0` |

---

## 3. Protocol Design

### 3.1 Framing Format

Since serial ports are byte streams without message boundaries, we use **Length-Prefixed Protobuf**:

```
┌──────────────────┬───────────────────────────────────────────┐
│  4 bytes (BE)    │          N bytes                          │
│  Message Length  │          Protobuf Payload                 │
└──────────────────┴───────────────────────────────────────────┘
```

- **Length**: 4-byte big-endian unsigned integer
- **Payload**: Protobuf-encoded `AgentMessage`

### 3.2 Message Types

```protobuf
// Host -> Guest (Requests)
- PingRequest          // Health check
- ExecuteRequest       // Run command
- FileWriteRequest     // Write file (chunked)
- FileReadRequest      // Read file
- ShutdownRequest      // Graceful shutdown
- ResetPasswordRequest // Reset user password

// Guest -> Host (Responses/Events)
- PongResponse         // Health check response
- ExecuteResponse      // Command output
- FileWriteResponse    // Write confirmation
- FileReadResponse     // File contents (chunked)
- TelemetryReport      // Periodic metrics (unsolicited)
- AgentReadyEvent      // Agent startup notification
```

---

## 4. Project Structure

```
agent/
├── limiquantix-guest-agent/    # NEW: Guest Agent binary
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs             # Entry point
│       ├── transport.rs        # Virtio-serial connection
│       ├── protocol.rs         # Length-prefixed framing
│       ├── handlers/
│       │   ├── mod.rs
│       │   ├── execute.rs      # Command execution
│       │   ├── file.rs         # File operations
│       │   └── lifecycle.rs    # Shutdown, password reset
│       └── telemetry.rs        # System metrics collection
│
├── limiquantix-node/           # UPDATED: Add agent client
│   └── src/
│       ├── agent_client.rs     # NEW: Host-side socket client
│       └── ...
│
└── limiquantix-proto/          # UPDATED: Add agent protocol
    └── proto/
        ├── node_daemon.proto
        └── agent.proto         # NEW: Guest agent protocol
```

---

## 5. Implementation Details

### 5.1 Guest Agent Main Loop

```rust
#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing
    init_logging();
    
    // 1. Wait for virtio-serial device to appear
    let device_path = find_agent_device().await?;
    info!(device = %device_path, "Found agent device");
    
    // 2. Open the serial port
    let stream = AsyncFile::open(&device_path).await?;
    let (reader, writer) = stream.split();
    let writer = Arc::new(Mutex::new(writer));
    
    // 3. Start telemetry loop (background task)
    let telemetry_writer = writer.clone();
    tokio::spawn(async move {
        telemetry_loop(telemetry_writer).await
    });
    
    // 4. Main message loop
    loop {
        let message = read_message(&mut reader).await?;
        let response = handle_message(message).await;
        write_message(&writer, response).await?;
    }
}
```

### 5.2 Telemetry Collection

The agent collects and reports:

| Metric | Source |
|--------|--------|
| CPU Usage % | `/proc/stat` or `sysinfo` crate |
| Memory Total/Used | `/proc/meminfo` or `sysinfo` |
| Disk Usage | Per-mount from `/proc/mounts` |
| Network Interfaces | `getifaddrs()` or `sysinfo` |
| IP Addresses | Filter loopback, docker bridges |

**Reporting Interval:** Every 5 seconds or on IP change (netlink listener)

### 5.3 Command Execution

```rust
async fn handle_execute(req: ExecuteRequest) -> ExecuteResponse {
    let output = Command::new("sh")
        .arg("-c")
        .arg(&req.command)
        .output()
        .await;
        
    match output {
        Ok(out) => ExecuteResponse {
            exit_code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).to_string(),
            stderr: String::from_utf8_lossy(&out.stderr).to_string(),
        },
        Err(e) => ExecuteResponse {
            exit_code: -1,
            stderr: format!("Failed to execute: {}", e),
            ..Default::default()
        }
    }
}
```

**Security:** The agent runs as root (systemd service). Input validation is critical.

### 5.4 File Transfer (Chunked)

For large files, we chunk the data (e.g., 64KB chunks):

**Host -> Guest (Upload):**
1. Frontend sends file to Backend (HTTP Upload)
2. Backend streams bytes to Node Daemon (gRPC Stream)
3. Node Daemon chunks bytes (64KB) -> Unix Socket
4. Guest Agent appends chunks to target file

**Guest -> Host (Download):**
1. Node Daemon sends FileReadRequest
2. Guest Agent reads file and sends chunks
3. Node Daemon reassembles and streams to Backend
4. Backend sends to Frontend (HTTP Download)

---

## 6. Libvirt XML Configuration

The guest agent channel is configured in the VM's libvirt domain XML:

```xml
<channel type='unix'>
  <source mode='bind' path='/var/run/limiquantix/vms/{vm_id}.agent.sock'/>
  <target type='virtio' name='org.limiquantix.agent.0'/>
</channel>
```

This creates:
- **Host:** Unix socket at the specified path
- **Guest:** Character device at `/dev/virtio-ports/org.limiquantix.agent.0`

---

## 7. Security Considerations

### 7.1 Authentication

The virtio-serial channel is inherently authenticated by VM isolation:
- Only the specific VM can access its character device
- Only the Node Daemon can access the host-side socket

### 7.2 Authorization

Commands are authorized at the Control Plane level:
- User must have permission on the VM
- Certain commands may require elevated permissions

### 7.3 Input Validation

The Guest Agent MUST validate all inputs:
- Command execution: Sanitize or whitelist allowed commands
- File operations: Validate paths, prevent directory traversal
- Resource limits: Limit output size, execution time

---

## 8. Platform Support

### 8.1 Linux

- **Device:** `/dev/virtio-ports/org.limiquantix.agent.0`
- **Installation:** Systemd service
- **Packaging:** `.deb` and `.rpm` packages
- **Auto-install:** Cloud-init user-data script

### 8.2 Windows

- **Device:** `\\.\Global\org.limiquantix.agent.0`
- **Installation:** Windows Service
- **Packaging:** MSI installer
- **Drivers:** Requires virtio-win drivers (installed separately)

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1)
- [x] Create `agent.proto` with message definitions
- [x] Create `limiquantix-guest-agent` crate skeleton
- [x] Implement virtio-serial transport layer
- [x] Update libvirt XML builder for agent channel

### Phase 2: Telemetry & IPs (Week 2)
- [ ] Implement telemetry collection (CPU, memory, disk)
- [ ] Implement IP address reporting
- [ ] Add agent client to Node Daemon
- [ ] Update Control Plane to receive telemetry
- [ ] Display IPs in Frontend

### Phase 3: Execution & Files (Week 3)
- [ ] Implement command execution
- [ ] Add "Run Script" button in Frontend
- [ ] Implement file upload/download
- [ ] Add file browser in Frontend

### Phase 4: Packaging (Week 4)
- [ ] Create Linux packages (.deb, .rpm)
- [ ] Cross-compile for Windows
- [ ] Create Windows MSI installer
- [ ] Add auto-install via Cloud-Init

---

## 10. Related Documents

| Document | Path |
|----------|------|
| Node Daemon Implementation | `docs/000031-node-daemon-implementation-plan.md` |
| Console Access | `docs/000042-console-access-implementation.md` |
| Cloud-Init Provisioning | `docs/000039-cloud-init-provisioning.md` |
| Proto Infrastructure | `.cursor/rules/proto-infrastructure.mdc` |

---

## 11. Appendix: Full Protocol Definition

See `agent/limiquantix-proto/proto/agent.proto` for the complete protobuf definition.
