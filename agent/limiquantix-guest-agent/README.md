# LimiQuantix Guest Agent

A lightweight Rust binary that runs **inside guest VMs** to enable deep integration with the LimiQuantix hypervisor platform.

## Features

- **Telemetry**: Report real RAM/Disk usage (hypervisor only sees allocated, not used)
- **Command Execution**: Run scripts/commands inside the VM for automation
- **File Transfer**: Push/pull files without SSH
- **Lifecycle Management**: Clean shutdown, password reset, IP reporting
- **Network Configuration**: Configure network via Netplan

## Communication Protocol

The agent communicates with the Node Daemon on the host via **virtio-serial**, a paravirtualized serial port that creates a direct data pipe:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Communication Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Host: /var/run/limiquantix/vms/{vm_id}.agent.sock                         │
│                                     │                                        │
│                          [virtio-serial]                                     │
│                                     │                                        │
│  Guest: /dev/virtio-ports/org.limiquantix.agent.0                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Framing Format

Messages use length-prefixed protobuf:

```
┌──────────────────┬───────────────────────────────────────────┐
│  4 bytes (BE)    │          N bytes                          │
│  Message Length  │          Protobuf Payload                 │
└──────────────────┴───────────────────────────────────────────┘
```

## Installation

### Linux

```bash
# Build
cargo build --release -p limiquantix-guest-agent

# Install
sudo cp target/release/limiquantix-agent /usr/local/bin/

# Create systemd service
sudo cat > /etc/systemd/system/limiquantix-agent.service <<EOF
[Unit]
Description=LimiQuantix Guest Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/limiquantix-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable limiquantix-agent
sudo systemctl start limiquantix-agent
```

### Windows

```powershell
# Build (requires Windows or cross-compilation)
cargo build --release -p limiquantix-guest-agent --target x86_64-pc-windows-msvc

# Install as service (requires NSSM or similar)
nssm install LimiQuantixAgent "C:\Program Files\LimiQuantix\limiquantix-agent.exe"
nssm start LimiQuantixAgent
```

## Configuration

The agent currently uses sensible defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `telemetry_interval_secs` | 5 | How often to report telemetry |
| `max_exec_timeout_secs` | 300 | Maximum command execution timeout |
| `max_chunk_size` | 65536 | Maximum file chunk size |

## Device Paths

| Platform | Path |
|----------|------|
| Linux | `/dev/virtio-ports/org.limiquantix.agent.0` |
| Windows | `\\.\Global\org.limiquantix.agent.0` |

## Security

The agent runs as root/SYSTEM to perform privileged operations. All commands come from the trusted virtio-serial channel, which is only accessible by the hypervisor host.

**Important:**
- The channel is inherently authenticated by VM isolation
- Only the specific VM can access its character device
- Only the Node Daemon can access the host-side socket

## Architecture

```
src/
├── main.rs           # Entry point, main loop
├── transport.rs      # Virtio-serial connection handling
├── protocol.rs       # Length-prefixed protobuf framing
├── telemetry.rs      # System metrics collection
└── handlers/
    ├── mod.rs        # Message routing
    ├── execute.rs    # Command execution
    ├── file.rs       # File read/write
    └── lifecycle.rs  # Shutdown, password reset
```

## Supported Operations

### Telemetry Report (automatic, every 5 seconds)

- CPU usage percentage
- Memory total/used/available
- Swap total/used
- Disk usage per mount point
- Network interfaces with IPs
- Load averages (Linux only)
- Process count
- System uptime

### Command Execution

Execute shell commands or binaries with:
- Custom environment variables
- Working directory
- Timeout
- Run as different user (Linux only)
- Output capture with size limits

### File Operations

- **Read**: Read files in chunks for large file support
- **Write**: Write files with chunked uploads, permission setting

### Lifecycle Operations

- **Shutdown/Reboot**: Graceful OS shutdown
- **Password Reset**: Change user passwords
- **Network Configuration**: Apply Netplan configuration

## Development

```bash
# Run tests
cargo test -p limiquantix-guest-agent

# Build for release
cargo build --release -p limiquantix-guest-agent

# Cross-compile for Linux from Windows (requires cross)
cross build --release -p limiquantix-guest-agent --target x86_64-unknown-linux-gnu
```

## Related Documentation

- [Guest Agent Architecture](../../docs/000044-guest-agent-architecture.md)
- [Node Daemon Implementation](../../docs/000031-node-daemon-implementation-plan.md)
- [Cloud-Init Provisioning](../../docs/000039-cloud-init-provisioning.md)
