# 000090 - Guest Agent Communication Issue Analysis

**Date:** January 27-31, 2026  
**Status:** ✅ RESOLVED  
**Severity:** High - Core Feature Broken  
**Resolution Time:** 4 days of intensive debugging

## Executive Summary

The Quantix KVM Guest Agent (`quantix-kvm-agent`) running inside VMs could not communicate with the host-side Node Daemon (`qx-node`). This issue manifested as write timeouts on the guest, blocked reads on the host, and "Agent not responding" in the QvDC dashboard.

**After 4 days of debugging, we identified and fixed 7 distinct bugs:**

1. **Protocol Mismatch (Magic Header)** - Host/Guest disagreed on message framing
2. **Partial Write Corruption** - `tokio::time::timeout` leaving incomplete messages
3. **Socket Hijacking** - Host connecting to wrong VM's socket
4. **Telemetry Channel Not Wired** - Host ignoring pushed telemetry
5. **AgentReadyEvent Not Forwarded** - OS/version info never reaching dashboard
6. **Character Device I/O Bug** - `tokio::fs::File` fails with virtio-serial
7. **ISO Mount Race Condition** - Old ISO versions being mounted

---

## 1. The Journey: 4 Days of Debugging

### Day 1 (Jan 27): Initial Investigation

**Symptoms:**
- QvDC Dashboard shows "Agent not responding" or "Not Installed"
- Guest logs: `Telemetry write timed out - host may not be reading`
- Host logs: `Response handler started` then silence

**Initial Hypothesis:** QEMU virtio-serial bridge not passing data.

**Discovery:** Both ends were connected (verified via `ss -x` and `lsof`), but data wasn't flowing.

### Day 2 (Jan 28): Protocol Mismatch Identified

**Key Finding:** The guest agent was sending a **Magic Header** (`QTX1`) but the host was expecting raw length-prefixed protobuf.

**The "1.3 Gigabyte Hallucination":**
```
Guest sends: QTX1 (4 bytes) + Length (4 bytes) + Payload
Host reads:  First 4 bytes as "length" = 0x51545801 = 1,364,547,585 bytes
Host waits:  Forever for 1.3GB of data that never arrives
```

**Fix Applied:** Updated both `protocol.rs` (guest) and `agent_client.rs` (host) to use identical magic-header framing with resync capability.

### Day 3 (Jan 29): Multiple Hidden Bugs Surface

After fixing the protocol, new errors emerged:

**Bug: Partial Write Corruption**
```
ERROR: Telemetry write timed out
```
When `tokio::time::timeout` cancelled a write, partial message data was left on the stream. The next message would be misaligned, causing host-side decode failures.

**Fix:** Treat write timeouts as FATAL - force immediate reconnection to reset stream state.

**Bug: Socket Hijacking**
```rust
// OLD CODE - blindly takes first socket found!
for entry in read_dir("/run/libvirt/qemu/channel") {
    if socket_path.exists() {
        return Some(socket_path);  // WRONG VM!
    }
}
```
When multiple VMs were running, the host would connect to the wrong VM's socket.

**Fix:** Verify VM ID exists in the directory name before accepting a socket path.

**Bug: Telemetry Channel Not Wired**
The `AgentClient` was initialized without a telemetry channel (`telemetry_tx = None`), so pushed telemetry was silently dropped.

**Fix:** Create and wire up `mpsc::channel` in `start_agent_connection_manager()`.

### Day 4 (Jan 30-31): Final Fixes

**Bug: AgentReadyEvent Ignored**
The host received `AgentReadyEvent` (containing OS, kernel, IPs) but just logged it and `continue`d without updating the cache.

**Fix:** Add `agent_ready_tx` channel to forward events to service for cache update.

**Bug: Character Device I/O Failure**
```
ERROR: Failed to open device: /dev/virtio-ports/org.quantix.agent.0
```
Despite the device existing and having correct permissions (crw-rw-rw-), `tokio::fs::File` couldn't open it. This is because **tokio's filesystem API doesn't work reliably with character devices**.

**Fix:** Replace `tokio::fs::File` with `std::fs::File` + `AsyncFd` + non-blocking mode:
```rust
// Set non-blocking mode for async I/O
let fd = file.as_raw_fd();
libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);

// Wrap in AsyncFd for proper async I/O on character devices
let async_fd = AsyncFd::new(file)?;
```

**Bug: ISO Mount Race Condition**
Clicking "Mount ISO" mounted an old cached version instead of the latest.

**Fix:** Use `virsh change-media --force` to reliably eject and insert ISOs.

---

## 2. Files Modified

### Guest Agent (`limiquantix-guest-agent`)

| File | Changes |
|------|---------|
| `src/main.rs` | Supervisor loop with `tokio::select!`, FATAL timeout handling, exponential backoff reconnection |
| `src/transport.rs` | Replaced `tokio::fs::File` with `AsyncFd<std::fs::File>` for character device support |
| `src/protocol.rs` | Magic header framing (`QTX1`), resync mechanism, byte-level scanning |

### Host Node Daemon (`limiquantix-node`)

| File | Changes |
|------|---------|
| `src/agent_client.rs` | Magic header support, resync mechanism, VM ID verification in socket discovery, `with_agent_ready_channel()` |
| `src/service.rs` | Wire up `telemetry_tx` and `agent_ready_tx` channels, update cache from `AgentReadyEvent` |
| `src/http_server.rs` | Use `virsh change-media --force` for reliable ISO mount/eject |

---

## 3. Technical Details of Each Fix

### Fix 1: Magic Header Protocol with Resync

**Problem:** If host connects after guest has sent data, stale bytes corrupt the protocol.

**Solution:** 4-byte magic header (`QTX1`) enables stream resynchronization.

```rust
// agent/limiquantix-guest-agent/src/protocol.rs
// agent/limiquantix-node/src/agent_client.rs

const MAGIC_HEADER: [u8; 4] = [0x51, 0x54, 0x58, 0x01]; // "QTX1"

async fn read_message<R, M>(reader: &mut R) -> Result<Option<M>> {
    loop {
        // 1. Scan for magic header
        let mut match_count = 0;
        while match_count < 4 {
            let byte = read_byte(reader).await?;
            if byte == MAGIC_HEADER[match_count] {
                match_count += 1;
            } else {
                match_count = if byte == MAGIC_HEADER[0] { 1 } else { 0 };
            }
        }
        
        // 2. Read length
        let len = read_u32_be(reader).await? as usize;
        
        // 3. Detect "magic as length" desync
        if len_buf == 0x51545801u32.to_be_bytes() {
            warn!("Detected magic header in length field - resyncing");
            continue;
        }
        
        // 4. Validate and read payload
        if len > MAX_MESSAGE_SIZE {
            warn!("Invalid length {}, resyncing", len);
            continue;
        }
        
        let mut payload = vec![0u8; len];
        reader.read_exact(&mut payload).await?;
        
        // 5. Decode protobuf
        match M::decode(&payload[..]) {
            Ok(msg) => return Ok(Some(msg)),
            Err(_) => continue, // Corrupted, resync
        }
    }
}
```

### Fix 2: FATAL Write Timeout

**Problem:** `tokio::time::timeout` cancels the write future, potentially leaving partial data on the stream (e.g., just the 4-byte header without the payload). Subsequent writes are misaligned.

**Solution:** Treat write timeouts as stream corruption - force reconnection.

```rust
// agent/limiquantix-guest-agent/src/main.rs

match write_result {
    Ok(Ok(())) => { /* success */ }
    Ok(Err(e)) => { /* write error, recoverable */ }
    Err(_timeout) => {
        // FATAL: Write timed out - stream is now CORRUPTED!
        error!("FATAL: Write timeout corrupted stream, forcing reconnect");
        return Err(anyhow!("Write timeout corrupted stream"));
    }
}
```

### Fix 3: Socket Path Verification

**Problem:** With multiple VMs running, `find_socket_path()` returned the first socket found, which could belong to a different VM.

**Solution:** Verify VM ID is present in the directory name.

```rust
// agent/limiquantix-node/src/agent_client.rs

fn find_socket_path(vm_id: &str) -> Option<PathBuf> {
    for entry in read_dir("/run/libvirt/qemu/channel") {
        let dir_name = entry.file_name().to_string_lossy();
        
        // ✅ CRITICAL: Verify this directory belongs to our VM!
        if !dir_name.contains(vm_id) {
            debug!("Skipping {} - does not match VM ID {}", dir_name, vm_id);
            continue;
        }
        
        // Directory matches - check for our socket
        let socket_path = entry.path().join("org.quantix.agent.0");
        if socket_path.exists() {
            return Some(socket_path);
        }
    }
    None
}
```

### Fix 4: Telemetry Channel Wiring

**Problem:** `AgentClient` was created without a telemetry channel, so pushed telemetry was never received.

**Solution:** Create and wire up the channel in the connection manager.

```rust
// agent/limiquantix-node/src/service.rs

let (telemetry_tx, mut telemetry_rx) = mpsc::channel::<TelemetryReport>(32);
let mut client = AgentClient::new(vm_id)
    .with_telemetry_channel(telemetry_tx);

// Spawn receiver task
tokio::spawn(async move {
    while let Some(telemetry) = telemetry_rx.recv().await {
        // Update cache with telemetry data
        let mut cache = agent_cache.write().await;
        let entry = cache.entry(vm_id.clone()).or_default();
        entry.hostname = telemetry.hostname.clone();
        entry.last_telemetry = Some(telemetry);
        entry.last_seen = Some(Instant::now());
    }
});
```

### Fix 5: AgentReadyEvent Forwarding

**Problem:** `AgentReadyEvent` contains OS name, kernel version, IP addresses - but the host just logged it and ignored it.

**Solution:** Add `agent_ready_tx` channel and update cache with system info.

```rust
// agent/limiquantix-node/src/agent_client.rs

pub fn with_agent_ready_channel(mut self, tx: mpsc::Sender<AgentReadyEvent>) -> Self {
    self.agent_ready_tx = Some(tx);
    self
}

// In response_handler:
Some(agent_message::Payload::AgentReady(ready)) => {
    info!(vm_id = %vm_id, version = %ready.version, os = %ready.os_name);
    if let Some(ref tx) = agent_ready_tx {
        tx.send(ready.clone()).await?;
    }
}

// agent/limiquantix-node/src/service.rs

let (agent_ready_tx, mut agent_ready_rx) = mpsc::channel::<AgentReadyEvent>(8);
let mut client = AgentClient::new(vm_id)
    .with_telemetry_channel(telemetry_tx)
    .with_agent_ready_channel(agent_ready_tx);

// Spawn receiver task
tokio::spawn(async move {
    while let Some(ready) = agent_ready_rx.recv().await {
        let mut cache = agent_cache.write().await;
        let entry = cache.entry(vm_id.clone()).or_default();
        entry.version = ready.version;
        entry.os_name = ready.os_name;
        entry.os_version = ready.os_version;
        entry.kernel_version = ready.kernel_version;
        entry.hostname = ready.hostname;
        entry.ip_addresses = ready.ip_addresses;
        entry.capabilities = ready.capabilities;
    }
});
```

### Fix 6: AsyncFd for Character Devices

**Problem:** `tokio::fs::File` uses a thread pool for async I/O, which doesn't work correctly with character devices (like virtio-serial). Symptoms included "Device or resource busy" errors and silent open failures.

**Solution:** Use `std::fs::File` with non-blocking mode, wrapped in `AsyncFd`.

```rust
// agent/limiquantix-guest-agent/src/transport.rs

#[cfg(unix)]
pub struct AgentTransport {
    inner: AsyncFd<std::fs::File>,
}

#[cfg(unix)]
async fn open(path: &PathBuf) -> Result<Self> {
    // Use std::fs::File - tokio::fs::File doesn't work with char devices
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)?;

    // Set non-blocking mode for async I/O
    let fd = file.as_raw_fd();
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
    }

    // Wrap in AsyncFd for proper async I/O
    let async_fd = AsyncFd::new(file)?;
    Ok(Self { inner: async_fd })
}

#[cfg(unix)]
impl AsyncRead for AgentTransport {
    fn poll_read(self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        loop {
            let mut guard = match self.inner.poll_read_ready(cx) {
                Poll::Ready(Ok(guard)) => guard,
                Poll::Ready(Err(e)) => return Poll::Ready(Err(e)),
                Poll::Pending => return Poll::Pending,
            };

            match guard.get_inner().read(buf.initialize_unfilled()) {
                Ok(n) => {
                    buf.advance(n);
                    return Poll::Ready(Ok(()));
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                    guard.clear_ready();
                    continue;
                }
                Err(e) => return Poll::Ready(Err(e)),
            }
        }
    }
}
```

### Fix 7: Force ISO Mount

**Problem:** "Mount ISO" button would mount a cached old version because libvirt's `change_media` API didn't properly eject the old media first.

**Solution:** Use `virsh change-media --force` for reliable eject+insert.

```rust
// agent/limiquantix-node/src/http_server.rs

// Step 1: Force eject existing media
tokio::process::Command::new("virsh")
    .args(["change-media", &vm_name, &device, "--eject", "--force"])
    .output()
    .await?;

tokio::time::sleep(Duration::from_millis(500)).await;

// Step 2: Force insert new ISO
tokio::process::Command::new("virsh")
    .args(["change-media", &vm_name, &device, &iso_path, "--insert", "--force"])
    .output()
    .await?;
```

---

## 4. Supervisor Loop Pattern

The guest agent now uses a **Supervisor Loop** for maximum resilience:

```rust
// agent/limiquantix-guest-agent/src/main.rs

loop {
    info!(reconnections = total_reconnections, "Connecting to host...");
    
    // 1. Connect to device
    let transport = match AgentTransport::connect_with_path(&device_path).await {
        Ok(t) => t,
        Err(e) => {
            warn!(error = %e, "Failed to connect, retrying...");
            tokio::time::sleep(reconnect_delay).await;
            reconnect_delay = (reconnect_delay * 2).min(MAX_RECONNECT_DELAY);
            continue;
        }
    };
    
    // 2. Setup resources
    let (reader, writer) = tokio::io::split(transport);
    let writer = Arc::new(Mutex::new(writer));
    
    // 3. Send AgentReady
    send_agent_ready(&writer, &telemetry, &config).await?;
    
    // 4. Run both tasks - first failure triggers reconnect
    tokio::select! {
        res = telemetry_loop(collector.clone(), writer.clone(), interval, health.clone()) => {
            match res {
                Ok(()) => info!("Telemetry loop exited normally"),
                Err(e) => warn!(error = %e, "Telemetry loop failed"),
            }
        }
        res = run_message_loop(reader, writer.clone()) => {
            match res {
                Ok(()) => info!("Message loop exited (EOF)"),
                Err(e) => warn!(error = %e, "Message loop failed"),
            }
        }
        _ = shutdown_rx.recv() => {
            info!("Received shutdown signal");
            break;
        }
    }
    
    // 5. Resources dropped, reset delay on successful connection, reconnect
    reconnect_delay = Duration::from_secs(1);
    total_reconnections += 1;
    tokio::time::sleep(Duration::from_secs(1)).await;
}
```

**Benefits:**
- If `telemetry_loop` fails (write timeout), `run_message_loop` is cancelled and vice versa
- All resources are dropped, stream is closed, fresh connection established
- Exponential backoff prevents tight reconnection loops
- Process never dies due to connection issues

---

## 5. Final Status

| Component | Status | Notes |
|-----------|--------|-------|
| Magic Header Protocol | ✅ Implemented | Both sides use `QTX1` + resync |
| Supervisor Loop | ✅ Implemented | Automatic reconnection on failure |
| FATAL Timeout | ✅ Implemented | Write timeout forces reconnect |
| Socket Verification | ✅ Implemented | VM ID checked in directory name |
| Telemetry Channel | ✅ Wired | Host receives pushed telemetry |
| AgentReady Channel | ✅ Wired | OS/version info reaches dashboard |
| AsyncFd Transport | ✅ Implemented | Character device I/O works |
| Force ISO Mount | ✅ Implemented | `--force` flag used |
| Socket Discovery | ✅ Implemented | Robust multi-path discovery via `discover_and_connect_agent()` |
| Connection Reuse | ✅ Implemented | Existing connections reused, not replaced |

### Dashboard Now Shows:

- ✅ Agent Version: `0.1.27`
- ✅ OS Name: Detected from guest
- ✅ Kernel Version: Detected from guest
- ✅ Hostname: From AgentReadyEvent and Telemetry
- ✅ IP Addresses: From `hostname -I` in guest
- ✅ CPU/Memory/Disk: From TelemetryReport
- ✅ Uptime: From TelemetryReport
- ✅ Load Averages: From TelemetryReport

---

## 6. Lessons Learned

1. **tokio::fs::File doesn't work with character devices** - Use `AsyncFd<std::fs::File>` instead.

2. **Write timeouts can corrupt streams** - When a timeout cancels a write, partial data may be left. Treat timeouts as fatal.

3. **Multi-VM environments need explicit verification** - Don't assume the first socket found is the right one.

4. **Magic headers enable protocol recovery** - Without them, a single corrupt byte causes permanent desync.

5. **Channel events must be wired up** - Creating a channel is not enough; you must actually receive from it.

6. **libvirt API needs `--force` for reliability** - The XML update API sometimes fails silently; `virsh` with `--force` is more reliable.

7. **Socket connections are exclusive** - A Unix socket from QEMU can only have ONE connection at a time. If the background manager has a connection, new connection attempts fail with EAGAIN (resource temporarily unavailable).

8. **Robust socket discovery is critical** - Use multiple fallback paths: primary socket, libvirt channel directories, and `virsh dumpxml` parsing.

---

## 8. Additional Fixes (Jan 31, 2026)

### Fix 8: Robust Socket Discovery via `discover_and_connect_agent()`

Added a helper function that implements multi-path socket discovery for all agent endpoints:

```rust
async fn discover_and_connect_agent(
    state: &Arc<AppState>,
    vm_id: &str,
    vm_name: &str,
) -> Result<(), String> {
    // 1. Check primary path: /var/run/quantix-kvm/vms/{vm_id}.agent.sock
    // 2. Check libvirt channel directories
    // 3. Parse virsh dumpxml to find actual socket path
    // 4. Use discovered path with get_agent_client_with_socket()
}
```

Updated endpoints: `get_agent_logs`, `agent_shutdown`, `agent_reboot`, `list_files`, `read_file`, `execute_command`, `request_telemetry`.

### Fix 9: Connection Reuse in `get_agent_client_with_socket()`

The function now properly checks if an agent is already connected before attempting a new connection:

```rust
// First, check with a read lock if agent already exists and is connected
{
    let agents = self.agent_manager.read().await;
    if let Some(client) = agents.get(vm_id) {
        if client.is_connected() {
            return Ok(()); // Reuse existing connection
        }
    }
}
```

This prevents the "Resource temporarily unavailable" error that occurred when attempting to connect to an already-connected socket.

---

## 7. Related Documentation

- `docs/000087-guest-agent-implementation.md` - Original implementation design
- `docs/000088-guest-agent-complete-reference.md` - Full API reference
- `docs/000089-guest-agent-installation-fixes-jan-2026.md` - Installation script fixes

---

*Document created during 4-day debugging session. Initial creation: January 27, 2026. Final update: January 31, 2026.*
*Contributors: Gal (user), Claude (AI assistant)*
