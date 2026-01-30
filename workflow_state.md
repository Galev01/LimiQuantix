# Workflow State

## Current: Guest Agent Communication Bug - SUPERVISOR FIX APPLIED

### Status: Code fix implemented - needs rebuild and deployment

### Summary

Despite successful code fixes for the "zombie connection" issue, **data still doesn't flow** between the guest agent and qx-node. Both ends connect successfully, but:
- Guest writes timeout after 5 seconds
- Host reads block forever
- QEMU's virtio-serial bridge appears to not be passing data

### Key Findings (January 30, 2026)

#### Confirmed Working
| Component | Status |
|-----------|--------|
| Guest agent binary installed | ✅ `/usr/local/bin/quantix-kvm-agent` v0.1.17 |
| Guest systemd service | ✅ Active and running |
| Guest device symlink | ✅ `org.quantix.agent.0 -> ../vport1p1` |
| Host socket file | ✅ Exists at `/var/run/quantix-kvm/vms/{id}.agent.sock` |
| Host qx-node socket connection | ✅ fd=17 ESTAB to QEMU |
| QEMU virtio-serial channel | ✅ `state='connected'` |
| QEMU Guest Agent (different channel) | ✅ Works perfectly |

#### The Actual Problem
| Component | Status |
|-----------|--------|
| Data flowing guest → QEMU | ❌ Writes timeout |
| Data flowing QEMU → host | ❌ Socket Recv-Q always 0 |
| Host response_handler | ⏳ Blocked on `read_exact()` |

### Evidence from Logs

**Guest side** (inside VM):
```
Telemetry write timed out - host may not be reading
consecutive_failures: 40, 41, 42... 50
ERROR: Too many consecutive write failures (50)
Telemetry loop failed
```

**Host side** (qx-node):
```
Response handler started - now listening for messages
[NO subsequent logs - blocked on read]
Eventually: Failed to read message length (stale data corruption)
```

### Root Cause Hypotheses

1. **QEMU virtio-serial bridge issue**: Data enters guest virtio ring buffer but QEMU doesn't pass it to Unix socket
2. **Stale buffer corruption**: Old data in buffer corrupts protocol framing when qx-node connects late
3. **Startup order sensitivity**: Guest agent must start AFTER qx-node connects

### Files Involved

#### Guest Agent
- `agent/limiquantix-guest-agent/src/main.rs` - telemetry_loop(), send_agent_ready()
- `agent/limiquantix-guest-agent/src/transport.rs` - Device discovery
- `agent/limiquantix-guest-agent/src/protocol.rs` - Message framing

#### Host Node Daemon  
- `agent/limiquantix-node/src/agent_client.rs` - AgentClient, response_handler()
- `agent/limiquantix-node/src/service.rs` - Background connection manager

#### Protocol
- `agent/limiquantix-proto/proto/agent.proto` - Message definitions

### Comprehensive Documentation

Created: `docs/000090-guest-agent-communication-issue-analysis.md`

Contains:
- Full architecture diagram
- All files involved with descriptions
- Protocol specification
- Debugging timeline
- Diagnostic commands
- Proposed fixes

### Next Steps

1. **Verify guest agent status** in VM console:
   ```bash
   systemctl status quantix-kvm-agent
   journalctl -u quantix-kvm-agent -n 50 --no-pager
   ```

2. **Test correct startup order**:
   - Stop guest agent
   - Restart qx-node
   - Start guest agent
   - Check if data flows

3. **Implement protocol resync** in `agent_client.rs`:
   - Skip garbage/stale data
   - Find valid message boundary

### Fixes Applied

#### Fix 1: Track response_handler liveness (Host-side - already done)
```rust
// Added to AgentClient
response_handler_alive: Arc<AtomicBool>

// Updated is_connected()
pub fn is_connected(&self) -> bool {
    self.writer.is_some() && self.response_handler_alive.load(Ordering::SeqCst)
}
```

#### Fix 2: Supervisor Loop Pattern (Guest-side - NEW Jan 30, 2026)

**File:** `agent/limiquantix-guest-agent/src/main.rs`

Implemented a **Connection Supervisor** using `tokio::select!`:

```rust
loop {
    // 1. Connect
    let transport = AgentTransport::connect_with_path(&device_path).await?;
    
    // 2. Setup
    let (reader, writer) = transport.split();
    send_agent_ready(&writer, &telemetry, &config).await?;
    
    // 3. Run BOTH tasks - first failure triggers reconnect
    tokio::select! {
        res = telemetry_loop(...) => { /* reconnect */ }
        res = run_message_loop(...) => { /* reconnect */ }
        _ = shutdown_signal => { break; }
    }
    
    // 4. Reconnect with backoff
    tokio::time::sleep(reconnect_delay).await;
}
```

**Benefits:**
- Prevents zombie state (telemetry dies but process lives)
- Automatic reconnection on disconnect
- Graceful shutdown handling
- Health state persists across reconnections
- Exponential backoff (1s → 30s max)

#### Fix 3: Magic Header Protocol with Resync (NEW Jan 30, 2026)

**Files:** 
- `agent/limiquantix-guest-agent/src/protocol.rs`
- `agent/limiquantix-node/src/agent_client.rs`

Added **Magic Header** (`QTX1` = `0x51 0x54 0x58 0x01`) to prevent deadlock:

```
┌──────────────────┬──────────────────┬───────────────────────────────────┐
│  4 bytes         │  4 bytes (BE)    │          N bytes                  │
│  Magic: "QTX1"   │  Message Length  │          Protobuf Payload         │
└──────────────────┴──────────────────┴───────────────────────────────────┘
```

**How it prevents deadlock:**
1. If host connects after guest sent data → garbage bytes
2. Old protocol: Host reads garbage as huge length → blocks forever → deadlock
3. New protocol: Host scans for `QTX1` magic → skips garbage → finds valid message

### Next Steps
1. **Rebuild guest agent ISO**: `./scripts/build-agent-iso.sh`
2. **Mount new ISO in VM**
3. **Reinstall agent**: Run installer from ISO
4. **Test** connectivity

---
*Last updated: January 30, 2026 - Supervisor fix applied*
