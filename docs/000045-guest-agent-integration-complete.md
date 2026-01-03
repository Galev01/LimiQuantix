# 000045 - Guest Agent Integration Complete

> **Purpose:** This document summarizes the complete Guest Agent implementation, including integration with the Node Daemon, Control Plane, and Frontend.

---

## 1. Summary

The LimiQuantix Guest Agent integration is **complete**. This enables VMware Tools-equivalent functionality for deep VM integration.

### Implemented Features

| Feature | Component | Status |
|---------|-----------|--------|
| **Telemetry Collection** | Guest Agent | ✅ Complete |
| **IP Reporting** | Guest Agent → Node Daemon | ✅ Complete |
| **Command Execution** | Full Stack | ✅ Complete |
| **File Transfer** | Guest Agent | ✅ Complete |
| **Graceful Shutdown** | Full Stack | ✅ Complete |
| **Frontend Display** | VMDetail Page | ✅ Complete |
| **Linux Packaging** | .deb/.rpm | ✅ Complete |
| **Cloud-Init Install** | Auto-install Script | ✅ Complete |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Complete Integration Flow                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌───────────┐ │
│  │  Frontend   │────▶│  Control    │────▶│   Node      │────▶│  Guest    │ │
│  │  (React)    │     │   Plane     │     │   Daemon    │     │   Agent   │ │
│  │             │◀────│   (Go)      │◀────│   (Rust)    │◀────│   (Rust)  │ │
│  └─────────────┘     └─────────────┘     └─────────────┘     └───────────┘ │
│                                                                              │
│  User clicks      Connect-RPC         gRPC                 virtio-serial    │
│  "Run Script"     VMService           NodeDaemonService    (Unix Socket)    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Components Implemented

### 3.1 Guest Agent (Inside VM)

**Location:** `agent/limiquantix-guest-agent/`

| File | Purpose |
|------|---------|
| `src/main.rs` | Entry point, message loop |
| `src/transport.rs` | Virtio-serial connection |
| `src/protocol.rs` | Length-prefixed protobuf |
| `src/telemetry.rs` | System metrics collection |
| `src/handlers/mod.rs` | Message routing |
| `src/handlers/execute.rs` | Command execution |
| `src/handlers/file.rs` | File read/write |
| `src/handlers/lifecycle.rs` | Shutdown, password reset |

### 3.2 Node Daemon (Host Side)

**Location:** `agent/limiquantix-node/`

| File | Purpose |
|------|---------|
| `src/agent_client.rs` | **NEW** - Agent client for Unix socket |
| `src/service.rs` | Extended with agent integration |

**New RPC Methods:**
- `PingAgent` - Check agent connectivity
- `ExecuteInGuest` - Run commands
- `ReadGuestFile` - Read files from VM
- `WriteGuestFile` - Write files to VM
- `GuestShutdown` - Graceful shutdown/reboot

### 3.3 Control Plane (Go Backend)

**Location:** `backend/internal/services/`

| File | Purpose |
|------|---------|
| `node/daemon_client.go` | Extended with agent methods |
| `vm/service.go` | Extended with guest agent operations |

**New API Endpoints (Connect-RPC):**
- `VMService.PingAgent`
- `VMService.ExecuteScript`
- `VMService.ReadGuestFile`
- `VMService.WriteGuestFile`
- `VMService.GuestShutdown`

### 3.4 Frontend (React)

**Location:** `frontend/src/components/vm/`

| File | Purpose |
|------|---------|
| `ExecuteScriptModal.tsx` | **NEW** - Script execution UI |
| `GuestAgentStatus.tsx` | **NEW** - Agent status & telemetry display |

**Updated:**
- `VMDetail.tsx` - Added "Run Script" button, "Agent" tab

---

## 4. Protocol Updates

### 4.1 Agent Protocol (`agent.proto`)

```protobuf
message AgentMessage {
  string message_id = 1;
  google.protobuf.Timestamp timestamp = 2;
  oneof payload {
    // Requests
    PingRequest ping = 10;
    ExecuteRequest execute = 11;
    FileWriteRequest file_write = 12;
    FileReadRequest file_read = 13;
    ShutdownRequest shutdown = 14;
    // Responses
    PongResponse pong = 50;
    ExecuteResponse execute_response = 51;
    // Events
    TelemetryReport telemetry = 100;
    AgentReadyEvent agent_ready = 101;
  }
}
```

### 4.2 Node Daemon Protocol (`node_daemon.proto`)

Added:
- `GuestAgentInfo` - Agent info in VM status
- `GuestResourceUsage` - Real resource usage
- `AgentPingResponse`
- `ExecuteInGuestRequest/Response`
- `ReadGuestFileRequest/Response`
- `WriteGuestFileRequest/Response`
- `GuestShutdownRequest/Response`

### 4.3 VM Service Protocol (`vm_service.proto`)

Added:
- `PingAgent` RPC
- `ExecuteScript` RPC
- `ReadGuestFile` RPC
- `WriteGuestFile` RPC
- `GuestShutdown` RPC

---

## 5. Packaging

### 5.1 Debian Package

**Location:** `agent/limiquantix-guest-agent/packaging/debian/`

```bash
# Build .deb package
cd agent
./limiquantix-guest-agent/packaging/build-packages.sh deb
```

### 5.2 RPM Package

```bash
# Build .rpm package
./limiquantix-guest-agent/packaging/build-packages.sh rpm
```

### 5.3 Cloud-Init Auto-Install

**Location:** `agent/limiquantix-guest-agent/packaging/cloud-init/install-agent.yaml`

Include in VM's `user_data` during creation:

```yaml
#cloud-config
runcmd:
  - curl -sL https://releases.limiquantix.io/install-agent.sh | bash
```

---

## 6. Usage

### 6.1 Install Agent in VM

**Ubuntu/Debian:**
```bash
sudo dpkg -i limiquantix-guest-agent_0.1.0_amd64.deb
```

**RHEL/CentOS:**
```bash
sudo rpm -ivh limiquantix-guest-agent-0.1.0-1.x86_64.rpm
```

**Manual:**
```bash
curl -sL https://releases.limiquantix.io/agent/latest/linux-amd64 -o /usr/local/bin/limiquantix-agent
chmod +x /usr/local/bin/limiquantix-agent
# Create systemd service and enable
```

### 6.2 Verify Agent Status

```bash
# Inside VM
systemctl status limiquantix-agent

# From Frontend
# Go to VM → Guest Agent tab
# Or check VM status for "Guest Agent: Connected"
```

### 6.3 Execute Scripts

1. Open VM Detail page
2. Click "Run Script" button (or go to Agent tab)
3. Enter command and click Execute
4. View stdout/stderr results

---

## 7. Security Considerations

### 7.1 Authentication

- Virtio-serial provides inherent authentication via VM isolation
- Only the specific VM can access its character device
- Only Node Daemon can access the host-side Unix socket

### 7.2 Authorization

- Control Plane validates user permissions before forwarding requests
- Commands are logged with user and VM context

### 7.3 Input Validation

- Agent validates all file paths (no directory traversal)
- Command output is truncated to prevent memory exhaustion
- Timeouts prevent runaway processes

---

## 8. Testing

### 8.1 Test Agent Connection

```bash
# Ping the agent from control plane
curl -X POST http://localhost:8080/limiquantix.compute.v1.VMService/PingAgent \
  -H "Content-Type: application/json" \
  -d '{"vmId": "your-vm-id"}'
```

### 8.2 Test Script Execution

```bash
curl -X POST http://localhost:8080/limiquantix.compute.v1.VMService/ExecuteScript \
  -H "Content-Type: application/json" \
  -d '{
    "vmId": "your-vm-id",
    "command": "uname -a",
    "timeoutSeconds": 30
  }'
```

---

## 9. Related Documents

| Document | Path |
|----------|------|
| Guest Agent Architecture | `docs/000044-guest-agent-architecture.md` |
| Console Access | `docs/000042-console-access-implementation.md` |
| Cloud-Init Provisioning | `docs/000039-cloud-init-provisioning.md` |
| Node Daemon Plan | `docs/000031-node-daemon-implementation-plan.md` |

---

## 10. Next Steps

1. **Windows Support** - Cross-compile agent for Windows, create MSI installer
2. **Agent Metrics Dashboard** - Aggregate telemetry across all VMs
3. **Agent Auto-Update** - Self-updating mechanism
4. **File Browser UI** - Visual file manager via agent
5. **Database Quiescing** - Pre-snapshot hooks for databases
