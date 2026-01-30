# 000090 - Guest Agent Communication Issue Analysis

**Date:** January 30, 2026  
**Status:** Under Investigation  
**Severity:** High - Core Feature Broken

## Executive Summary

The Quantix KVM Guest Agent (`quantix-kvm-agent`) running inside VMs cannot communicate with the host-side Node Daemon (`qx-node`). Despite both ends establishing connections to the virtio-serial channel, **data does not flow between them**. The guest agent's writes timeout, and the host's reads block forever.

---

## 1. Problem Description

### Symptoms

1. **QvDC Dashboard shows**: "Agent not responding" or "Not Installed"
2. **Host-side (`qx-node`) logs**:
   - `Response handler started - now listening for messages from guest agent`
   - No subsequent `AgentReady`, `Telemetry`, or message receipt logs
   - Eventually: `Failed to read message length` (corrupted data from stale buffer)
3. **Guest-side (`quantix-kvm-agent`) logs**:
   - `Telemetry write failures exceeded threshold, backing off`
   - `med out - host may not be reading` (5 second write timeout)
   - After 50 failures: `Telemetry loop failed` and service crashes/restarts
4. **QEMU Guest Agent WORKS** - `virsh qemu-agent-command` returns data successfully
5. **Virtio-serial channel shows**: `state='connected'` in `virsh dumpxml`

### What Works

- VM boots and runs normally
- QEMU Guest Agent (separate channel) functions correctly
- ISO mounting and agent installation inside VM
- Host can connect to the Unix socket
- Guest opens `/dev/virtio-ports/org.quantix.agent.0`

### What Doesn't Work

- Data doesn't flow through QEMU's virtio-serial bridge
- Guest writes timeout after 5 seconds
- Host reads block forever

---

## 2. Architecture Overview

### Data Flow (Intended)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HOST MACHINE                                    │
│  ┌─────────────────────┐     ┌─────────────────────┐                        │
│  │       qx-node       │     │        QEMU         │                        │
│  │  (Node Daemon)      │     │   (qemu-system)     │                        │
│  │                     │     │                     │                        │
│  │  ┌───────────────┐  │     │  ┌───────────────┐  │                        │
│  │  │ AgentClient   │  │     │  │ virtio-serial │  │                        │
│  │  │               │──┼─────┼──│    bridge     │  │                        │
│  │  │ read_message()│  │ Unix│  │               │  │                        │
│  │  │write_message()│  │Socket│ │ fd=78 (estab) │  │                        │
│  │  └───────────────┘  │     │  └───────────────┘  │                        │
│  │        fd=17        │     │        fd=34        │                        │
│  └─────────────────────┘     └─────────────────────┘                        │
│                                       │                                      │
│                          /var/run/quantix-kvm/vms/{vm_id}.agent.sock        │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │
                              virtio ring buffer
                                        │
┌───────────────────────────────────────┼─────────────────────────────────────┐
│                              GUEST VM │                                      │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    quantix-kvm-agent                                 │    │
│  │  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐       │    │
│  │  │  transport.rs │    │  protocol.rs  │    │   main.rs     │       │    │
│  │  │               │    │               │    │               │       │    │
│  │  │ /dev/virtio-  │    │ 4-byte len +  │    │ telemetry_    │       │    │
│  │  │ ports/org.    │    │ protobuf      │    │ loop()        │       │    │
│  │  │ quantix.      │    │               │    │               │       │    │
│  │  │ agent.0       │    │ read_message  │    │ send_agent_   │       │    │
│  │  │               │    │ write_message │    │ ready()       │       │    │
│  │  └───────────────┘    └───────────────┘    └───────────────┘       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Protocol (Updated Jan 30, 2026)

Both sides use **magic-header-prefixed protobuf** messages with resync capability:

```
┌──────────────────┬──────────────────┬───────────────────────────────────┐
│  4 bytes         │  4 bytes (BE)    │          N bytes                  │
│  Magic: "QTX1"   │  Message Length  │          Protobuf Payload         │
│  0x51 0x54 0x58  │                  │                                   │
│  0x01            │                  │                                   │
└──────────────────┴──────────────────┴───────────────────────────────────┘
```

**Why Magic Header?**

Prevents the deadlock scenario where:
1. Host connects AFTER guest has sent data
2. Host reads garbage/stale bytes as "message length" (e.g., 50,000)
3. Host blocks forever waiting for 50,000 bytes that never arrive
4. Guest's buffer fills and writes timeout

The magic header allows the reader to **resync** by scanning for `QTX1` and skipping garbage.

---

## 3. Files Involved

### Guest Agent (Inside VM)

| File | Purpose |
|------|---------|
| `agent/limiquantix-guest-agent/src/main.rs` | Entry point, `telemetry_loop()`, `send_agent_ready()` |
| `agent/limiquantix-guest-agent/src/transport.rs` | Device discovery, opens `/dev/virtio-ports/org.quantix.agent.0` |
| `agent/limiquantix-guest-agent/src/protocol.rs` | `read_message()`, `write_message()` with 4-byte length prefix |
| `agent/limiquantix-guest-agent/src/telemetry.rs` | Collects CPU, RAM, disk, network metrics |
| `agent/limiquantix-guest-agent/src/handlers.rs` | Handles requests from host (execute, file ops, etc.) |
| `agent/limiquantix-guest-agent/Cargo.toml` | Binary name: `quantix-kvm-agent` |
| `agent/limiquantix-guest-agent/packaging/iso/install.sh` | Installer script, creates systemd service |

### Host Node Daemon (qx-node)

| File | Purpose |
|------|---------|
| `agent/limiquantix-node/src/agent_client.rs` | `AgentClient`, `response_handler()`, socket connection |
| `agent/limiquantix-node/src/service.rs` | `start_agent_connection_manager()` - background connection loop |
| `agent/limiquantix-node/src/http_server.rs` | `/api/v1/vms/{id}/agent/ping` endpoint |

### Protocol Definition

| File | Purpose |
|------|---------|
| `agent/limiquantix-proto/proto/agent.proto` | Protobuf definitions for `AgentMessage`, `TelemetryReport`, etc. |

### Build & Deployment

| File | Purpose |
|------|---------|
| `scripts/build-agent-iso.sh` | Builds `quantix-agent.iso` with the agent binary |
| `Quantix-OS/builder/Dockerfile.guest-agent` | Docker build for static musl binary |

### VM Configuration (libvirt)

The virtio-serial channel is configured in the VM's XML:

```xml
<channel type='unix'>
  <source mode='bind' path='/var/run/quantix-kvm/vms/{vm_id}.agent.sock'/>
  <target type='virtio' name='org.quantix.agent.0' state='connected'/>
  <alias name='channel0'/>
  <address type='virtio-serial' controller='0' bus='0' port='1'/>
</channel>
```

---

## 4. Root Causes Identified

### Primary Issue: QEMU virtio-serial Bridge Not Passing Data

Despite both ends being connected, data doesn't flow through QEMU. Evidence:

1. **ss output shows**: Both QEMU and qx-node have ESTAB connections, but `Send-Q` and `Recv-Q` are both 0
2. **Guest writes timeout**: Indicating the virtio ring buffer is full and not being drained
3. **Host reads block forever**: No data arrives at the Unix socket

### Secondary Issue: Stale Data Corruption

When qx-node restarts AFTER the guest agent has already sent data:

1. Guest agent sends `AgentReady` + telemetry reports → data sits in QEMU's buffer
2. qx-node connects later → receives OLD, potentially incomplete data
3. `read_exact()` for 4-byte length gets garbage → **protocol desync**
4. Error: `Failed to read message length`

### Tertiary Issue: Startup Order Sensitivity

The system is sensitive to startup order:

| Scenario | Result |
|----------|--------|
| Guest agent starts FIRST, qx-node connects LATER | Stale data corruption |
| qx-node connects FIRST, guest agent starts LATER | Should work (untested) |
| Both restart simultaneously | Race condition |

---

## 5. Key Code Sections

### Guest Agent: Telemetry Loop (with timeout handling)

```rust
// agent/limiquantix-guest-agent/src/main.rs:316-400
async fn telemetry_loop<W: AsyncWriteExt + Unpin + Send + 'static>(
    collector: TelemetryCollector,
    writer: Arc<Mutex<W>>,
    interval_secs: u64,
    health: Arc<HealthState>,
) -> Result<()> {
    const WRITE_TIMEOUT_SECS: u64 = 5;
    const RECONNECT_THRESHOLD: u32 = 50;
    
    let mut consecutive_failures: u32 = 0;

    loop {
        interval.tick().await;

        // If too many failures, signal for reconnection
        if consecutive_failures >= RECONNECT_THRESHOLD {
            error!(
                consecutive_failures = consecutive_failures,
                "Telemetry write failures exceeded reconnection threshold"
            );
            return Err(anyhow!("Too many consecutive write failures"));
        }

        // Try to send telemetry with timeout
        let write_result = tokio::time::timeout(
            Duration::from_secs(WRITE_TIMEOUT_SECS),
            async {
                let mut guard = writer.lock().await;
                write_message(&mut *guard, &report).await
            }
        ).await;

        match write_result {
            Ok(Ok(())) => {
                consecutive_failures = 0;
                health.record_telemetry_success();
            }
            Ok(Err(e)) | Err(_) => {
                consecutive_failures += 1;
                warn!(
                    consecutive_failures = consecutive_failures,
                    "Telemetry write timed out - host may not be reading"
                );
            }
        }
    }
}
```

### Host: Response Handler (blocks on read)

```rust
// agent/limiquantix-node/src/agent_client.rs:730-819
async fn response_handler(
    mut reader: ReadHalf<UnixStream>,
    pending: Arc<Mutex<HashMap<String, PendingRequest>>>,
    telemetry_tx: Option<mpsc::Sender<TelemetryReport>>,
    vm_id: String,
) -> Result<()> {
    info!(vm_id = %vm_id, "Response handler started");
    
    loop {
        // THIS BLOCKS FOREVER if no data arrives
        let message = match read_message::<_, AgentMessage>(&mut reader).await {
            Ok(Some(msg)) => msg,
            Ok(None) => {
                info!(vm_id = %vm_id, "Agent connection closed");
                break;
            }
            Err(e) => {
                error!(vm_id = %vm_id, error = %e, "Failed to read message");
                return Err(e);
            }
        };

        // Process message (AgentReady, Telemetry, Pong, etc.)
        match &message.payload {
            Some(agent_message::Payload::Telemetry(report)) => { /* ... */ }
            Some(agent_message::Payload::AgentReady(ready)) => { /* ... */ }
            // ...
        }
    }
    Ok(())
}
```

### Guest: Device Discovery

```rust
// agent/limiquantix-guest-agent/src/transport.rs:16-21
const DEVICE_PATHS: &[&str] = &[
    "/dev/virtio-ports/org.quantix.agent.0",
    "/dev/virtio-ports/org.limiquantix.agent.0",  // Legacy
    "/dev/vport0p1",
    "/dev/vport1p1",
];
```

---

## 6. Debugging Timeline

| Time | Event | Finding |
|------|-------|---------|
| 01:26:26 | Guest agent starts | Service active, device open |
| 01:31:xx | Guest telemetry loop | Write failures start (consecutive_failures: 40-50) |
| 01:44:35 | Guest loop fails | "Too many consecutive write failures (50)" |
| 23:55:01 | qx-node restarts | Connects to socket |
| 23:55:01 | Response handler starts | "now listening for messages" |
| 23:55:16 | Response handler fails | "Failed to read message length" (stale data) |
| 23:56:xx | VM restarted | Fresh boot |
| 23:56:37 | qx-node connects | New response handler starts |
| 23:57:xx | Ping timeout | "Agent appears connected but failed to communicate" |

---

## 7. Diagnostic Commands Used

### On Host (192.168.0.102)

```bash
# Check virtio-serial channel state
virsh dumpxml Rocky-Linux-Test | grep -A5 "org.quantix.agent"

# Check socket connections
ss -x -p | grep "quantix-kvm/vms"

# Check qx-node file descriptors
ls -la /proc/$(pgrep qx-node)/fd | grep socket

# Check qx-node logs
tail -100 /var/log/quantix-node.log | grep -E "agent|Agent|telemetry"

# Test socket with socat
timeout 3 socat -v UNIX-CONNECT:/var/run/quantix-kvm/vms/{vm_id}.agent.sock -
```

### Inside Guest VM

```bash
# Check if agent service is running
systemctl status quantix-kvm-agent

# Check device exists
ls -la /dev/virtio-ports/

# Check if agent has device open
lsof /dev/virtio-ports/org.quantix.agent.0

# Check agent logs
journalctl -u quantix-kvm-agent -n 50 --no-pager
```

---

## 8. Current Status

| Component | Status | Notes |
|-----------|--------|-------|
| Guest agent binary | ✅ Correct | `/usr/local/bin/quantix-kvm-agent` version 0.1.17 |
| Guest systemd service | ✅ Running | Enabled, but fails after 50 write timeouts |
| Guest device symlink | ✅ Correct | `org.quantix.agent.0 -> ../vport1p1` |
| Host socket file | ✅ Exists | `/var/run/quantix-kvm/vms/{id}.agent.sock` |
| Host qx-node connection | ✅ Connected | fd=17 -> socket established |
| QEMU virtio bridge | ❌ NOT PASSING DATA | Both ends connected, no data flow |
| Protocol compatibility | ✅ Identical | Same 4-byte BE length + protobuf |

---

## 9. Fixes Applied

### Fix 1: Supervisor Loop Pattern (IMPLEMENTED - Jan 30, 2026)

**File:** `agent/limiquantix-guest-agent/src/main.rs`

The guest agent now uses a **Supervisor Loop** with `tokio::select!` to ensure resilience:

```rust
// The key pattern - if EITHER task fails, BOTH are cancelled and we reconnect
loop {
    // 1. Connect to device
    let transport = AgentTransport::connect_with_path(&device_path).await?;
    
    // 2. Setup resources
    let (reader, writer) = transport.split();
    
    // 3. Send AgentReady
    send_agent_ready(&writer, &telemetry, &config).await?;
    
    // 4. Run both tasks with tokio::select! - first failure triggers reconnect
    tokio::select! {
        res = telemetry_loop(...) => {
            // Telemetry failed - trigger reconnect
        }
        res = run_message_loop(...) => {
            // Read failed or EOF - trigger reconnect
        }
        _ = shutdown_check => {
            break; // Only way to exit
        }
    }
    
    // 5. Resources dropped, reconnect after delay
    tokio::time::sleep(reconnect_delay).await;
}
```

**Why this fixes the zombie state:**
- If `telemetry_loop` fails (50+ write timeouts), `run_message_loop` is immediately cancelled
- If `run_message_loop` gets EOF, `telemetry_loop` is immediately cancelled
- Both tasks are torn down, resources cleaned up, and a fresh connection is established
- The process never dies due to connection issues (only shutdown signals)

**Additional improvements:**
- Exponential backoff on reconnection (1s → 30s max)
- Health state persists across reconnections (tracks total reconnections)
- Timeout on initial AgentReady send (10s)
- Graceful shutdown handling

### Fix 2: Magic Header Protocol with Resync (IMPLEMENTED - Jan 30, 2026)

**Files:** 
- `agent/limiquantix-guest-agent/src/protocol.rs`
- `agent/limiquantix-node/src/agent_client.rs`

Added a **Magic Header** (`QTX1` = `0x51 0x54 0x58 0x01`) to enable protocol resync:

```rust
/// Magic header for protocol framing: "QTX1" (Quantix Protocol v1)
const MAGIC_HEADER: [u8; 4] = [0x51, 0x54, 0x58, 0x01];

async fn read_message<R, M>(reader: &mut R) -> Result<Option<M>> {
    loop {
        // 1. Scan for Magic Header (resync mechanism)
        let mut match_count = 0;
        while match_count < 4 {
            let byte = reader.read_u8().await?;
            if byte == MAGIC_HEADER[match_count] {
                match_count += 1;
            } else {
                // Mismatch - check if this starts a new sequence
                match_count = if byte == MAGIC_HEADER[0] { 1 } else { 0 };
            }
        }
        
        // 2. Read length (now we know we're aligned)
        let len = reader.read_u32().await? as usize;
        
        // 3. Validate and read payload
        if len > MAX_MESSAGE_SIZE {
            warn!("Invalid length {}, resyncing...", len);
            continue; // Go back to scanning for magic
        }
        
        let mut payload = vec![0u8; len];
        reader.read_exact(&mut payload).await?;
        
        // 4. Decode - if fails, resync
        match M::decode(&payload[..]) {
            Ok(msg) => return Ok(Some(msg)),
            Err(_) => continue, // Corrupted, resync
        }
    }
}
```

**How it prevents deadlock:**
- If garbage bytes are received, the reader scans for `QTX1`
- Invalid lengths or decode failures trigger resync
- Maximum 64KB scan before giving up (prevents infinite loops)

### Fix 3: Restart Both in Correct Order (Manual Workaround)

1. Stop guest agent inside VM: `systemctl stop quantix-kvm-agent`
2. Restart qx-node on host: `rc-service quantix-node restart`
3. Start guest agent inside VM: `systemctl start quantix-kvm-agent`

### Fix 4: Investigate QEMU virtio-serial Bridge (Pending)

The core issue may be in how QEMU bridges the virtio-serial device to the Unix socket:

1. Check QEMU version and known bugs
2. Test with different QEMU options
3. Compare with working QEMU GA channel configuration

---

## 10. Files to Modify for Fixes

| File | Change |
|------|--------|
| `agent/limiquantix-node/src/agent_client.rs` | Add resync mechanism to `read_message()` |
| `agent/limiquantix-guest-agent/packaging/iso/install.sh` | Add startup delay to systemd service |
| `agent/limiquantix-node/src/service.rs` | Connect to VMs earlier in boot process |

---

## 11. Related Documentation

- `docs/000087-guest-agent-implementation.md` - Original implementation design
- `docs/000088-guest-agent-complete-reference.md` - Full API reference
- `docs/000089-guest-agent-installation-fixes-jan-2026.md` - Recent installation fixes

---

## 12. Next Steps

1. **Immediate**: Verify guest agent service status inside VM via console
2. **Short-term**: Implement protocol resync mechanism
3. **Medium-term**: Add startup ordering guarantees
4. **Long-term**: Investigate QEMU virtio-serial bridge behavior

---

*Document created during live debugging session. Last updated: January 30, 2026*
