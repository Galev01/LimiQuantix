# 000089 - Guest Agent Communication Debugging Guide

*Document: Troubleshooting virtio-serial based host-guest communication*

---

## Overview

The Quantix guest agent (`quantix-kvm-agent`) communicates with the host's node daemon (`qx-node`) via virtio-serial channels. This document explains common failure modes and debugging procedures.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Guest VM                                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  quantix-kvm-agent                                       │   │
│  │  - Opens /dev/virtio-ports/org.quantix.agent.0          │   │
│  │  - Sends: AgentReady, Telemetry, Responses              │   │
│  │  - Receives: Ping, Execute, ReadFile requests           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                        │ virtio-serial                         │
└────────────────────────┼───────────────────────────────────────┘
                         │
┌────────────────────────┼───────────────────────────────────────┐
│  QEMU                  │                                       │
│  - fd 33: LISTEN socket (server)                               │
│  - fd 50: CONNECTED socket (to host client)                    │
│  - Bridges virtio device ↔ Unix socket                         │
└────────────────────────┼───────────────────────────────────────┘
                         │
┌────────────────────────┼───────────────────────────────────────┐
│  Host (Quantix-OS)     │                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  qx-node                                                 │   │
│  │  - Connects to /var/run/quantix-kvm/vms/<vm-id>.agent.sock │
│  │  - Sends: Ping, Execute, ReadFile requests              │   │
│  │  - Receives: AgentReady, Telemetry, Responses           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Socket Configuration (libvirt XML)

```xml
<channel type='unix'>
  <source mode='bind' path='/var/run/quantix-kvm/vms/<vm-id>.agent.sock'/>
  <target type='virtio' name='org.quantix.agent.0' state='connected'/>
  <address type='virtio-serial' controller='0' bus='0' port='1'/>
</channel>
```

- `mode='bind'` - QEMU creates the socket as a server
- `state='connected'` - Guest has opened the virtio-serial device

## Common Failure Modes

### 1. "Agent not responding" - Guest Started Before Host

**Symptoms:**
- Guest agent logs: `"Successfully opened virtio-serial device"`, `"Sent AgentReady event"`
- Then: `"Telemetry write timed out - host may not be reading"`
- Host ping returns: `"Agent not responding"`

**Root Cause:**
Guest agent starts and fills write buffer before host connects. When host connects, guest's writes are blocked (buffer full), and the message loop can't process incoming requests.

**Solution:**
Restart the guest agent AFTER the host is connected:
```bash
# Inside the VM
systemctl restart quantix-kvm-agent
```

### 2. "Resource temporarily unavailable" (EAGAIN)

**Symptoms:**
- Host logs: `Agent connection failed ... error=Resource temporarily unavailable (os error 11)`
- Multiple retry attempts all fail

**Root Cause:**
- Another host process is already connected to the socket
- Or the socket is in a transitional state after previous connection closed

**Debugging:**
```bash
# Check who is connected to the socket
ss -x -p | grep agent.sock

# Kill stale connections
pkill -f 'socat.*agent.sock'
pkill -f 'nc.*agent.sock'

# Restart qx-node
rc-service quantix-node restart
```

### 3. Connection Established but No Data Flow

**Symptoms:**
- Host logs: `"Connected to guest agent"`, `"Background connection established"`
- But ping still times out
- `lsof` shows both QEMU and qx-node connected to socket

**Debugging:**
```bash
# Check socket connections with peer info
ss -x -p | grep agent.sock

# Example output showing healthy connection:
# QEMU (peer 3408778) ↔ qx-node (inode 3408778)
u_str ESTAB 0 0 /var/run/.../agent.sock 3460011 * 3408778 (qemu)
u_str ESTAB 0 0                         * 3408778 * 3460011 (qx-node)

# Check for buffered data (Send-Q > 0 means data waiting to be read)
ss -x -p | grep 'qx-node.*ESTAB'
```

### 4. Guest Agent Crash (General Protection Fault)

**Symptoms:**
- Guest kernel log: `general protection fault`
- Guest agent service shows `failed` or restarts repeatedly

**Root Cause:**
Binary compiled with incompatible CPU instructions (e.g., AVX-512 on older CPU).

**Solution:**
Rebuild guest agent with baseline CPU target:
```bash
RUSTFLAGS='-C target-cpu=x86-64' cargo build --release
```

## Diagnostic Commands

### On Host (Quantix-OS)

```bash
# Check socket file exists
ls -la /var/run/quantix-kvm/vms/*.agent.sock

# Check who is connected
lsof /var/run/quantix-kvm/vms/<vm-id>.agent.sock

# Detailed socket state with peer info
ss -x -p | grep agent.sock

# Check qx-node file descriptors
ls -la /proc/$(pgrep -f qx-node)/fd/ | grep sock

# View qx-node logs
tail -f /var/log/quantix-node.log | grep -i agent

# Manual socket test (will show if data flows)
timeout 5 socat -d UNIX-CONNECT:/var/run/quantix-kvm/vms/<vm-id>.agent.sock - | xxd | head
```

### Inside Guest VM

```bash
# Check agent service status
systemctl status quantix-kvm-agent

# View agent logs
journalctl -u quantix-kvm-agent -n 50 --no-pager

# Check if virtio-serial device exists
ls -la /dev/virtio-ports/

# Check if agent has device open
lsof /dev/virtio-ports/org.quantix.agent.0

# Restart agent (fixes most issues)
systemctl restart quantix-kvm-agent
```

### From QEMU Guest Agent (alternative path)

```bash
# Check guest info via QEMU GA
virsh qemu-agent-command <vm-name> '{"execute": "guest-info"}'

# Get network interfaces (proves GA works)
virsh qemu-agent-command <vm-name> '{"execute": "guest-network-get-interfaces"}'

# Get OS info
virsh qemu-agent-command <vm-name> '{"execute": "guest-get-osinfo"}'
```

## Protocol Format

Both host and guest use length-prefixed protobuf messages:

```
┌─────────────┬──────────────────────────────────────┐
│ Length (4B) │ Protobuf-encoded AgentMessage        │
│ Big-endian  │ (variable length)                    │
└─────────────┴──────────────────────────────────────┘
```

Message types:
- `Ping` / `Pong` - Health check
- `AgentReady` - Sent by guest on startup
- `Telemetry` - Periodic metrics from guest
- `Execute` / `ExecuteResponse` - Command execution
- `ReadFile` / `WriteFile` - File operations

## Best Practices

1. **Start qx-node before guest agent** - Or restart guest agent after host connects
2. **Avoid multiple host connections** - Virtio-serial sockets support one host client
3. **Monitor socket state** - Use `ss -x -p | grep agent.sock` regularly
4. **Build with baseline CPU** - Always use `-C target-cpu=x86-64` for guest binaries
5. **Clean up stale connections** - Kill any orphaned socat/nc processes before debugging

## Related Documents

- 000087 - Guest Agent Implementation
- 000088 - Guest Agent Complete Reference
