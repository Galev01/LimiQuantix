# Workflow State

## Current: Guest Agent Communication Bug Fix

### Status: Code Fixed - Needs Deployment & Testing

### Root Cause Analysis

Two interconnected bugs were causing "Agent not responding" errors:

#### Bug 1: Host's `is_connected()` was broken (agent_client.rs)
```rust
// BEFORE: Only checked if writer exists
pub fn is_connected(&self) -> bool {
    self.writer.is_some()  // Returns true even when response_handler is dead!
}
```

The `response_handler` task (which reads from the socket) could exit due to errors or EOF, but `is_connected()` would still return `true` because the writer still existed. This created "zombie" connections where:
1. Background manager thinks it's connected
2. Sends ping requests (write succeeds)
3. No response handler to read responses
4. Ping times out
5. Guest agent's writes fail (no one reading the socket)

#### Bug 2: Guest agent never signals for reconnection
When writes fail 50+ times, the guest agent just keeps trying forever. It should signal that the connection is dead so it can be restarted.

### Fixes Applied

#### Fix 1: Track response_handler liveness (agent_client.rs)
- Added `response_handler_alive: Arc<AtomicBool>` to `AgentClient`
- Set to `true` when spawning response_handler task
- Set to `false` when task exits (success or error)
- Updated `is_connected()` to check BOTH writer exists AND handler alive:
```rust
pub fn is_connected(&self) -> bool {
    self.writer.is_some() && self.response_handler_alive.load(Ordering::SeqCst)
}
```

#### Fix 2: Add reconnection threshold to guest agent (main.rs)
- Added `RECONNECT_THRESHOLD = 50` constant
- When consecutive failures exceed threshold, telemetry_loop returns `Err`
- This signals for device reconnection (requires service restart for now)

#### Fix 3: Better debug logging
- Added detailed logging to response_handler showing:
  - When it starts
  - Message counts
  - WHY it exits (EOF vs error)

### Files Changed
- `agent/limiquantix-node/src/agent_client.rs` - Host side fixes
- `agent/limiquantix-guest-agent/src/main.rs` - Guest side fixes

### Next Steps
1. **Rebuild and deploy** qx-node to QHCI02: `./scripts/publish-update.sh`
2. **Rebuild and deploy** guest agent ISO: `./scripts/build-agent-iso.sh`
3. **Test**:
   - Restart qx-node service
   - Restart quantix-kvm-agent in VM
   - Check ping response

### Documentation
- Created `docs/000089-guest-agent-communication-debugging.md` - Comprehensive debugging guide
