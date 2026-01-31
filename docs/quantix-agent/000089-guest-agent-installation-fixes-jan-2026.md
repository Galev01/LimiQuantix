# Quantix Guest Agent - Installation & Connectivity Fixes

**Document ID:** 000089  
**Created:** 2026-01-27  
**Last Updated:** 2026-01-27  
**Status:** Active  
**Component:** `agent/limiquantix-guest-agent`, `agent/limiquantix-node`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Root Cause Analysis](#3-root-cause-analysis)
4. [Solutions Implemented](#4-solutions-implemented)
5. [Technical Deep Dive](#5-technical-deep-dive)
6. [Version History](#6-version-history)
7. [Testing & Verification](#7-testing--verification)
8. [Architecture Diagrams](#8-architecture-diagrams)

---

## 1. Executive Summary

This document details the comprehensive fixes implemented in January 2026 to achieve **seamless, network-free installation** of the Quantix Guest Agent, similar to VMware Tools. The fixes addressed multiple layers:

1. **Binary Compatibility** - Created a truly statically linked binary that works on any Linux distribution
2. **SELinux Compatibility** - Added automatic SELinux context fixes for RHEL-based distributions
3. **Connectivity Reporting** - Fixed the Dashboard to correctly detect and display agent connection status

### Key Achievements

| Metric | Before | After |
|--------|--------|-------|
| One-Click Installation | Failed on Rocky/RHEL | Works on all Linux |
| Binary Compatibility | Dynamic (glibc-specific) | Static (universal) |
| SELinux Support | Permission denied | Automatic context fix |
| Dashboard Status | "Not connected" (false) | Real-time accurate status |

---

## 2. Problem Statement

### 2.1 Initial Symptom

Users clicking "Install Quantix Agent" in the QvDC Dashboard experienced failures:

1. **Rocky Linux VMs**: "Permission denied" when executing the transferred binary
2. **After SELinux fix**: "No such file or directory" - the shell couldn't find the dynamic linker
3. **After binary fix**: Dashboard still showed "Quantix Agent not connected" even though agent logs showed it was running

### 2.2 User Impact

- Unable to get in-guest telemetry (actual RAM usage, disk space)
- Unable to use remote command execution
- Unable to perform graceful shutdowns
- Unable to see guest IP addresses in the Dashboard

---

## 3. Root Cause Analysis

### 3.1 Issue #1: SELinux Blocking Execution

**Environment**: Rocky Linux 9, CentOS, RHEL, Fedora (any SELinux-enabled system)

**Root Cause**: When a binary is transferred via virtio-serial and written to `/tmp`, SELinux assigns it the `user_tmp_t` context which is not executable.

**Evidence**:
```bash
[root@rocky ~]# ls -laZ /usr/local/bin/limiquantix-agent
-rwxr-xr-x. 1 root root user_tmp_t ... /usr/local/bin/limiquantix-agent

[root@rocky ~]# /usr/local/bin/limiquantix-agent
-bash: /usr/local/bin/limiquantix-agent: Permission denied
```

**Fix Applied**: Added SELinux context correction to the installation script:
```bash
# Fix SELinux context if SELinux is enabled
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    echo "[Quantix] Fixing SELinux context..."
    if command -v chcon &> /dev/null; then
        chcon -t bin_t /usr/local/bin/limiquantix-agent 2>/dev/null || true
    fi
    if command -v restorecon &> /dev/null; then
        restorecon -v /usr/local/bin/limiquantix-agent 2>/dev/null || true
    fi
fi
```

### 3.2 Issue #2: Dynamic Linker Incompatibility

**Environment**: Any Linux system where the guest agent was built with dynamic linking

**Root Cause**: The original build produced a dynamically linked binary that required:
- For glibc builds: Specific glibc version (e.g., glibc 2.34+)
- For musl "static-pie" builds: The musl dynamic linker (`ld-musl-x86_64.so.1`)

**Evidence**:
```bash
# "Static-pie" musl build still required dynamic linker!
[root@rocky ~]# file /usr/local/bin/limiquantix-agent
/usr/local/bin/limiquantix-agent: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), 
static-pie linked, BuildID[sha1]=..., with debug_info, not stripped

[root@rocky ~]# /usr/local/bin/limiquantix-agent
-bash: /usr/local/bin/limiquantix-agent: No such file or directory

# The "No such file or directory" error happens because the kernel
# can't find the dynamic linker specified in the ELF header
```

**Fix Applied**: Modified `Dockerfile.guest-agent` to produce a **truly static binary**:

```dockerfile
# Key RUSTFLAGS to produce a truly static binary:
# -C target-feature=+crt-static : Link C runtime statically
# -C relocation-model=static    : Disable PIE, no dynamic linker needed
RUSTFLAGS='-C target-feature=+crt-static -C relocation-model=static' \
cargo build --release --target x86_64-unknown-linux-musl -p limiquantix-guest-agent
```

**Verification**:
```bash
# Truly static binary - no dependencies!
[root@rocky ~]# file /usr/local/bin/limiquantix-agent
/usr/local/bin/limiquantix-agent: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), 
statically linked, BuildID[sha1]=..., with debug_info, not stripped

[root@rocky ~]# ldd /usr/local/bin/limiquantix-agent
not a dynamic executable
```

### 3.3 Issue #3: Dashboard Showing "Not Connected"

**Environment**: QvDC Dashboard querying QHCI node for agent status

**Root Cause**: The `/api/v1/vms/:vm_id/agent/ping` endpoint was attempting to create a **new connection** to the virtio-serial socket on every request. However:

1. The socket is a **single-connection** resource (like a serial port)
2. A background process was already maintaining a persistent connection
3. Each HTTP request tried to connect, but the socket was already in use
4. This caused timeouts and "Node unreachable" errors

**Evidence** (node logs showing repeated connection attempts):
```
2026-01-27 09:45:15 INFO Connecting to guest agent vm_id=be1c0964... socket=/var/run/limiquantix/vms/be1c0964....agent.sock
2026-01-27 09:45:15 INFO Connected to guest agent vm_id=be1c0964...
2026-01-27 09:45:27 INFO Agent ready vm_id=be1c0964... version=0.1.0 hostname=Rocky
2026-01-27 09:45:45 INFO Connecting to guest agent vm_id=be1c0964...  # Another attempt!
2026-01-27 09:46:05 INFO Connecting to guest agent vm_id=be1c0964...  # And another!
# ... repeated every ~10-20 seconds
```

**Fix Applied**: Modified `ping_quantix_agent` to use a **cached state** instead of creating new connections:

1. **Primary**: Query the `agent_cache` (populated by background telemetry/AgentReady events)
2. **Fallback**: If no cache, check `virsh dumpxml` for channel state (`state='connected'`)
3. **No new connections**: Never attempt to create a new socket connection in the HTTP handler

---

## 4. Solutions Implemented

### 4.1 Static Binary Build (Dockerfile.guest-agent)

**File**: `Quantix-OS/builder/Dockerfile.guest-agent`

The Dockerfile now produces a **truly statically linked** binary using musl libc:

```dockerfile
FROM rust:1.87-alpine

# Install build dependencies including static libraries
RUN apk add --no-cache \
    musl-dev \
    openssl-dev \
    openssl-libs-static \
    pkgconfig \
    build-base \
    perl \
    linux-headers \
    libx11-dev \
    libx11-static \
    libxcb-dev \
    libxcb-static \
    file

# Configure for static linking
ENV OPENSSL_STATIC=1
ENV PKG_CONFIG_ALL_STATIC=1
ENV OPENSSL_DIR=/usr

# Build command with RUSTFLAGS for truly static binary
CMD ["sh", "-c", "\
    RUSTFLAGS='-C target-feature=+crt-static -C relocation-model=static' \
    cargo build --release --target x86_64-unknown-linux-musl -p limiquantix-guest-agent && \
    file /build/target/x86_64-unknown-linux-musl/release/limiquantix-agent && \
    ldd /build/target/x86_64-unknown-linux-musl/release/limiquantix-agent 2>&1 || true \
"]
```

**Key Flags Explained**:

| Flag | Purpose |
|------|---------|
| `--target x86_64-unknown-linux-musl` | Use musl libc instead of glibc |
| `-C target-feature=+crt-static` | Link the C runtime statically |
| `-C relocation-model=static` | Disable PIE (Position-Independent Executable) |
| `OPENSSL_STATIC=1` | Link OpenSSL statically |

### 4.2 SELinux-Aware Installation Script

**File**: `agent/limiquantix-node/src/http_server.rs` (install_quantix_agent handler)

The installation script now automatically handles SELinux:

```bash
#!/bin/bash
set -e
echo "[Quantix] Installing agent..."

# Create directories
mkdir -p /etc/limiquantix/pre-freeze.d
mkdir -p /etc/limiquantix/post-thaw.d
mkdir -p /var/log/limiquantix

# Move binary to final location
mv /tmp/limiquantix-agent /usr/local/bin/limiquantix-agent
chmod +x /usr/local/bin/limiquantix-agent

# Fix SELinux context if SELinux is enabled (Rocky, CentOS, RHEL, Fedora)
if command -v getenforce &> /dev/null && [ "$(getenforce)" != "Disabled" ]; then
    echo "[Quantix] Fixing SELinux context..."
    # Set the correct SELinux type for executables
    if command -v chcon &> /dev/null; then
        chcon -t bin_t /usr/local/bin/limiquantix-agent 2>/dev/null || true
    fi
    # Also try restorecon if available
    if command -v restorecon &> /dev/null; then
        restorecon -v /usr/local/bin/limiquantix-agent 2>/dev/null || true
    fi
fi

# Create systemd service
cat > /etc/systemd/system/limiquantix-agent.service << 'EOF'
[Unit]
Description=Quantix Guest Agent
After=network.target
ConditionVirtualization=vm

[Service]
Type=simple
ExecStart=/usr/local/bin/limiquantix-agent
Restart=always
RestartSec=5
Environment=RUST_LOG=info

[Install]
WantedBy=multi-user.target
EOF

# Reload and start
systemctl daemon-reload
systemctl enable limiquantix-agent
systemctl restart limiquantix-agent

echo "[Quantix] Agent installed successfully!"
systemctl status limiquantix-agent --no-pager || true
```

### 4.3 Cache-Based Connectivity Detection

**File**: `agent/limiquantix-node/src/http_server.rs` (ping_quantix_agent handler)

The ping endpoint now uses a multi-tier detection strategy:

```rust
async fn ping_quantix_agent(...) -> Result<Json<QuantixAgentPingResponse>, ...> {
    // 1. Check cached agent info (populated by background connection)
    if let Some(agent_info) = state.service.get_agent_info(&vm.id).await {
        return Ok(Json(QuantixAgentPingResponse {
            connected: true,
            version: Some(agent_info.version),
            hostname: Some(agent_info.hostname),
            os_name: Some(agent_info.os_name),
            error: None,
        }));
    }
    
    // 2. Fallback: Check virsh for channel connection state
    let socket_path = format!("/var/run/limiquantix/vms/{}.agent.sock", vm.id);
    if std::path::Path::new(&socket_path).exists() {
        let output = tokio::process::Command::new("virsh")
            .args(["dumpxml", &vm.name])
            .output()
            .await;
        
        if let Ok(result) = output {
            let xml = String::from_utf8_lossy(&result.stdout);
            // Check if our agent channel shows state='connected'
            if xml.contains("org.limiquantix.agent.0") && xml.contains("state='connected'") {
                // Update cache and return connected
                state.service.set_agent_connected(&vm.id, "unknown", "unknown").await;
                return Ok(Json(QuantixAgentPingResponse {
                    connected: true,
                    ...
                }));
            }
        }
        
        // Socket exists but not connected yet
        return Ok(Json(QuantixAgentPingResponse {
            connected: false,
            error: Some("Agent socket exists but not yet connected...".to_string()),
        }));
    }
    
    // 3. No socket - agent not installed
    Ok(Json(QuantixAgentPingResponse {
        connected: false,
        error: Some("Quantix Agent not installed or not running...".to_string()),
    }))
}
```

---

## 5. Technical Deep Dive

### 5.1 Virtio-Serial Communication Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         QHCI Host (Quantix-OS)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐      ┌──────────────────────────────────────────┐ │
│  │   qx-node       │      │        QEMU/KVM Process                  │ │
│  │  (Node Daemon)  │      │                                          │ │
│  │                 │      │  ┌──────────────────────────────────┐   │ │
│  │  ┌───────────┐  │      │  │     VM: Test-ISO                 │   │ │
│  │  │ HTTP API  │  │      │  │                                  │   │ │
│  │  │ :8443     │  │      │  │  ┌────────────────────────────┐ │   │ │
│  │  └─────┬─────┘  │      │  │  │   limiquantix-agent        │ │   │ │
│  │        │        │      │  │  │   (Guest Agent)            │ │   │ │
│  │  ┌─────▼─────┐  │      │  │  │                            │ │   │ │
│  │  │ Service   │  │      │  │  │  Connects to:              │ │   │ │
│  │  │  + cache  │◄─┼──────┼──┼──┤  /dev/virtio-ports/        │ │   │ │
│  │  └─────┬─────┘  │      │  │  │    org.limiquantix.agent.0 │ │   │ │
│  │        │        │      │  │  └────────────────────────────┘ │   │ │
│  │  ┌─────▼─────┐  │      │  └──────────────────────────────────┘   │ │
│  │  │ AgentMgr  │  │      │                    ▲                     │ │
│  │  │  (bg conn)│◄─┼──────┼────────────────────┘                     │ │
│  │  └─────┬─────┘  │      │      virtio-serial channel               │ │
│  │        │        │      │                                          │ │
│  │        ▼        │      └──────────────────────────────────────────┘ │
│  │  Unix Socket:   │                                                   │
│  │  /var/run/limiquantix/vms/{vm-id}.agent.sock                       │
│  │                 │                                                   │
│  └─────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 One-Click Installation Flow

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│   QvDC Dashboard │       │   QHCI Node      │       │   Guest VM       │
│   (Browser)      │       │   (qx-node)      │       │   (Rocky Linux)  │
└────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
         │                          │                          │
         │ 1. Click "Install"       │                          │
         │─────────────────────────►│                          │
         │                          │                          │
         │                          │ 2. Fetch agent binary    │
         │                          │    from Update Server    │
         │                          │◄─────────────────────────│
         │                          │                          │
         │                          │ 3. QEMU guest-file-open  │
         │                          │    (via QEMU GA)         │
         │                          │─────────────────────────►│
         │                          │                          │
         │                          │ 4. Transfer binary       │
         │                          │    in 512KB chunks       │
         │                          │─────────────────────────►│
         │                          │                          │ /tmp/limiquantix-agent
         │                          │ 5. QEMU guest-exec       │
         │                          │    (run install script)  │
         │                          │─────────────────────────►│
         │                          │                          │ • mv to /usr/local/bin
         │                          │                          │ • chmod +x
         │                          │                          │ • chcon -t bin_t (SELinux)
         │                          │                          │ • Create systemd service
         │                          │                          │ • systemctl start
         │                          │                          │
         │                          │                          │ 6. Agent starts
         │                          │                          │    Connects to virtio-serial
         │                          │◄─────────────────────────│
         │                          │    AgentReady message    │
         │                          │                          │
         │                          │ 7. Update agent_cache    │
         │                          │                          │
         │ 8. Return success        │                          │
         │◄─────────────────────────│                          │
         │                          │                          │
```

### 5.3 Static vs Dynamic Linking Comparison

| Aspect | Dynamic (glibc) | Static-PIE (musl) | Truly Static (musl) |
|--------|-----------------|-------------------|---------------------|
| **File output** | `dynamically linked` | `static-pie linked` | `statically linked` |
| **ldd output** | Shows libraries | Shows `ld-musl-x86_64.so.1` | `not a dynamic executable` |
| **Requires linker** | Yes (`ld-linux-x86-64.so.2`) | Yes (`ld-musl-x86_64.so.1`) | **No** |
| **glibc version** | Must match host | N/A | N/A |
| **Works on Alpine** | ❌ | ❌ (no musl loader) | ✅ |
| **Works on Rocky** | ⚠️ (version-dependent) | ❌ (no musl loader) | ✅ |
| **Works on Ubuntu** | ⚠️ (version-dependent) | ❌ (no musl loader) | ✅ |
| **Works on Debian** | ⚠️ (version-dependent) | ❌ (no musl loader) | ✅ |
| **Binary size** | ~8MB | ~9MB | ~9MB |

---

## 6. Version History

| Version | Date | Component | Change |
|---------|------|-----------|--------|
| **0.0.70** | 2026-01-26 | qx-node | Initial glibc-compatible build (failed on version mismatch) |
| **0.0.71** | 2026-01-26 | qx-node | Added SELinux context fix (`chcon`, `restorecon`) |
| **0.0.72** | 2026-01-26 | guest-agent | Switched to musl static build (still PIE) |
| **0.0.73** | 2026-01-26 | guest-agent | Added X11 static libs for arboard clipboard |
| **0.0.74** | 2026-01-26 | guest-agent | **Truly static binary** (`-C relocation-model=static`) |
| **0.0.75** | 2026-01-27 | qx-node | Initial attempt at fixing ping connectivity |
| **0.0.76** | 2026-01-27 | qx-node | Fixed `PongResponse` struct (removed `hostname` field) |
| **0.0.77** | 2026-01-27 | qx-node | Added 5-second timeout to `UnixStream::connect()` |
| **0.0.78** | 2026-01-27 | qx-node | **Cache-based ping** (query `agent_cache` instead of new connections) |
| **0.0.79** | 2026-01-27 | qx-node | **Virsh fallback** (check `state='connected'` in XML) |

---

## 7. Testing & Verification

### 7.1 Verify Static Binary

```bash
# On build machine
file agent/target/x86_64-unknown-linux-musl/release/limiquantix-agent
# Expected: ELF 64-bit LSB executable, x86-64, version 1 (SYSV), statically linked...

ldd agent/target/x86_64-unknown-linux-musl/release/limiquantix-agent
# Expected: not a dynamic executable
```

### 7.2 Test One-Click Installation

1. Create a VM with QEMU Guest Agent installed
2. Navigate to VM Details → Quantix Agent tab
3. Click "Install Quantix Agent"
4. Wait for installation to complete
5. Dashboard should show "Connected" with version info

### 7.3 Verify Agent Connectivity

```bash
# On the guest VM
systemctl status limiquantix-agent
# Should show: Active: active (running)

# On the host (QHCI)
virsh dumpxml <vm-name> | grep -A5 "org.limiquantix.agent"
# Should show: state='connected'

# Check node logs
tail -50 /var/log/quantix-node.log | grep -i agent
# Should show: "Agent ready" and/or telemetry messages
```

### 7.4 Test on Multiple Distributions

| Distribution | SELinux | Test Result |
|--------------|---------|-------------|
| Rocky Linux 9 | Enforcing | ✅ Works |
| Rocky Linux 9 | Disabled | ✅ Works |
| Ubuntu 22.04 | N/A | ✅ Works |
| Debian 12 | N/A | ✅ Works |
| Alpine Linux | N/A | ✅ Works |
| Fedora 39 | Enforcing | ✅ Works |

---

## 8. Architecture Diagrams

### 8.1 Agent Cache Population Flow

```
                                    ┌─────────────────────┐
                                    │  NodeDaemonService  │
                                    │                     │
                                    │  ┌───────────────┐  │
                                    │  │  agent_cache  │  │
                                    │  │  HashMap<     │  │
                                    │  │    vm_id,     │  │
                                    │  │    CachedInfo │  │
                                    │  │  >            │  │
                                    │  └───────┬───────┘  │
                                    │          │          │
                                    └──────────┼──────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
                    ▼                          ▼                          ▼
         ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
         │ update_agent_    │      │ set_agent_       │      │ get_agent_info   │
         │ cache()          │      │ connected()      │      │ ()               │
         │                  │      │                  │      │                  │
         │ Called when:     │      │ Called when:     │      │ Called by:       │
         │ • Telemetry recv │      │ • virsh shows    │      │ • HTTP ping      │
         │                  │      │   connected      │      │   endpoint       │
         └──────────────────┘      └──────────────────┘      └──────────────────┘
                    ▲                          ▲
                    │                          │
         ┌──────────────────┐      ┌──────────────────┐
         │ Background task  │      │ ping_quantix_    │
         │ (AgentManager)   │      │ agent() fallback │
         │                  │      │                  │
         │ Maintains        │      │ Checks virsh     │
         │ persistent conn  │      │ dumpxml for      │
         │ to virtio socket │      │ state='connected'│
         └──────────────────┘      └──────────────────┘
```

### 8.2 Error Handling Matrix

| Scenario | Socket Exists | Cache Populated | Virsh State | HTTP Response |
|----------|---------------|-----------------|-------------|---------------|
| Agent running, telemetry received | ✅ | ✅ | connected | `connected: true` + full info |
| Agent running, no telemetry yet | ✅ | ❌ | connected | `connected: true` (via virsh) |
| Agent starting up | ✅ | ❌ | not connected | `error: "Agent may be starting up"` |
| Agent not installed | ❌ | ❌ | N/A | `error: "Agent not installed"` |
| VM not running | N/A | N/A | N/A | `error: "VM is not running"` |

---

## Related Documents

- [000088 - Guest Agent Complete Reference](./000088-guest-agent-complete-reference.md)
- [000087 - Guest Agent Implementation](./000087-guest-agent-implementation.md)
- [000044 - Guest Agent Architecture](./Agent/000044-guest-agent-architecture.md)
- [000045 - Guest Agent Integration Complete](./Agent/000045-guest-agent-integration-complete.md)
- [000061 - Agent Architecture (Quantix-OS)](./Quantix-OS/000061-agent-architecture.md)
