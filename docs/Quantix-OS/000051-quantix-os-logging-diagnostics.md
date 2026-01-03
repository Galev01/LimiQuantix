# 000051 - Quantix-OS Logging & Diagnostics

**Document:** Comprehensive Logging and Debugging for Quantix-OS  
**Status:** Active  
**Created:** January 3, 2026

---

## Overview

Quantix-OS provides a comprehensive, emoji-rich logging system designed for easy debugging and quick problem identification. This document covers:

1. Node Daemon logging (Rust)
2. OS-level logging
3. Diagnostic tools
4. Console TUI log viewer
5. Log rotation and persistence

---

## 1. Node Daemon Logging (Rust)

### Logging Emojis

The logging system uses consistent emojis for quick visual scanning:

| Category | Emoji | Usage |
|----------|-------|-------|
| **Status** | | |
| Success | ✅ | Operation completed successfully |
| Error | ❌ | Operation failed |
| Warning | ⚠️ | Non-critical issue |
| Info | ℹ️ | Informational message |
| Debug | 🔍 | Debug details |
| **Components** | | |
| VM | 🖥️ | Virtual machine operations |
| Network | 🌐 | Network operations |
| Storage | 💾 | Storage operations |
| Security | 🔒 | Security events |
| Cluster | 🔗 | Cluster operations |
| Agent | 🤖 | Guest agent operations |
| **Actions** | | |
| Start | 🚀 | Starting operation |
| Stop | 🛑 | Stopping |
| Create | ➕ | Creating resource |
| Delete | 🗑️ | Deleting resource |
| Migrate | 🚚 | VM migration |
| Snapshot | 📸 | Taking snapshot |
| **States** | | |
| Running | 🟢 | Service/VM running |
| Stopped | 🔴 | Service/VM stopped |
| Paused | 🟡 | Paused/pending |
| Healthy | 💚 | Health check passed |
| Unhealthy | 💔 | Health check failed |
| **Performance** | | |
| Timer | ⏱️ | Timing measurement |
| Fast | ⚡ | Fast operation (<100ms) |
| Slow | 🐢 | Slow operation (>1s) |

### Using the Logging Macros

```rust
use limiquantix_common::{log_success, log_error, log_vm, log_network, log_storage, log_timing};

// Success logging
log_success!("vm", "VM {} created successfully", vm_id);

// Error logging with context
log_error!("storage", err, "Failed to create volume {}", volume_id);

// VM lifecycle events
log_vm!("start", vm_id, "Starting VM with {} cores, {}MB RAM", cores, ram);
log_vm!("migrate", vm_id, "Migrating to node {}", target_node);

// Network events
log_network!("connect", "Port {} attached to bridge {}", port_id, bridge);

// Storage events  
log_storage!("snapshot", "Created snapshot {} for volume {}", snap_id, vol_id);

// Performance timing
log_timing!("vm_start", duration_ms);
```

### Timed Operations

```rust
use limiquantix_common::TimedOperation;

// Automatically logs duration
let timer = TimedOperation::new("create_vm");
// ... do work ...
timer.success(); // Logs: "⚡ create_vm completed in 150ms"

// Or on failure:
timer.failure("disk not found");
```

### Log Output Format

Console output (colorful):
```
2024-01-03 12:34:56.789 INFO  qx_node::vm ✅ VM vm-abc123 created successfully
2024-01-03 12:34:57.123 ERROR qx_node::storage ❌ Failed to attach volume | Error: disk not found
2024-01-03 12:34:58.456 INFO  qx_node::perf ⚡ create_vm completed in 150ms
```

JSON output (for log aggregation):
```json
{
  "timestamp": "2024-01-03T12:34:56.789Z",
  "level": "INFO",
  "target": "qx_node::vm",
  "component": "vm",
  "vm_id": "vm-abc123",
  "message": "✅ VM vm-abc123 created successfully"
}
```

---

## 2. OS Diagnostic Tool (qx-diag)

The `qx-diag` command provides comprehensive system diagnostics with beautiful output.

### Quick Commands

```bash
# Quick health check (run this first!)
qx-diag health

# Full diagnostics
qx-diag

# Specific diagnostics
qx-diag system    # CPU, memory, disk
qx-diag services  # Service status
qx-diag network   # Network diagnostics
qx-diag storage   # Storage status
qx-diag vms       # VM status
```

### Log Viewing

```bash
# View recent logs (last 50 lines)
qx-diag logs

# View more lines
qx-diag logs 200

# View errors only
qx-diag errors

# Live log viewer (like tail -f)
qx-diag watch
```

### Generate Report

```bash
# Generate full diagnostic report for support
qx-diag report
# Creates: /tmp/quantix-diag-YYYYMMDD-HHMMSS.txt
```

### Sample Output

```
╔═══════════════════════════════════════════════════════════════════════════╗
║ 💓 QUICK HEALTH CHECK                                                      ║
╚═══════════════════════════════════════════════════════════════════════════╝

✅ Node daemon: Running
✅ Libvirt: Running
✅ OVS: Running
✅ Memory: 45%
✅ Disk: 23%
✅ No recent errors

✅✅✅ SYSTEM HEALTHY ✅✅✅
```

---

## 3. Console TUI Log Viewer

The Quantix Console (press F3) includes a beautiful log viewer:

### Features

- **📁 Multiple log files**: Switch between Node, Error, System, Libvirt logs
- **🔴 Error filtering**: Show only errors with 'E' key
- **⏸️ Pause/Resume**: Pause live updates with 'P' key
- **🔍 Search**: Filter logs by keyword
- **📊 Statistics**: Error/warning counts at a glance

### Key Bindings

| Key | Action |
|-----|--------|
| Tab | Switch log file |
| E | Toggle errors-only |
| P | Pause/resume live updates |
| R | Reload logs |
| ↑/↓ | Scroll |
| Home/End | Jump to start/end |
| Esc | Return to main menu |

### Screenshot

```
╔═══════════════════════════════════════════════════════════════════════════╗
║ 📁 Log Files                                                               ║
╚═══════════════════════════════════════════════════════════════════════════╝
  [ Node ]   Errors    System    Libvirt  

┌─────────────────────────────────────────────────────────────────────────────┐
│ 📊 Total: 1234 | ❌ Errors: 2 | ⚠️ Warnings: 15 | ▶️ LIVE                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─ 📜 /var/log/quantix-node.log ──────────────────────────────────────────────┐
│ ℹ️ [12:34:56] Starting VM vm-abc123                                         │
│ ✅ [12:34:57] VM vm-abc123 started successfully                             │
│ 🌐 [12:34:58] Port attached to br-int                                       │
│▶❌ [12:35:00] Failed to connect to guest agent                              │
│ ⚠️ [12:35:01] Retrying guest agent connection                               │
│ ✅ [12:35:05] Guest agent connected                                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ [Tab] Switch Log | [E] Errors Only | [P] Pause | [Home/End] Jump | [Esc]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Log File Locations

| Log | Path | Description |
|-----|------|-------------|
| Node Daemon | `/var/log/quantix-node.log` | Main node daemon log |
| Node Errors | `/var/log/quantix-node.err.log` | Errors only |
| System | `/var/log/messages` | Kernel and system |
| Libvirt | `/var/log/libvirt/libvirtd.log` | Libvirt daemon |
| OVS | `/var/log/openvswitch/*.log` | Open vSwitch |
| Auth | `/var/log/secure` | Authentication events |

---

## 5. Log Rotation

Logs are automatically rotated to prevent RAM exhaustion (logs are in tmpfs):

| Log | Max Size | Rotations Kept |
|-----|----------|----------------|
| quantix-node.log | 50MB | 5 |
| quantix-node.err.log | 10MB | 10 |
| libvirt/*.log | 20MB | 3 |
| openvswitch/*.log | 20MB | 3 |
| messages | 50MB | 3 |

Rotation runs every 5 minutes via the `quantix-logrotate` service.

---

## 6. Remote Logging

### Forward to Syslog Server

Edit `/quantix/syslog-remote.conf`:

```bash
# Forward all logs to remote server
*.*    @syslog.example.com:514

# Forward only errors
*.error    @syslog.example.com:514
```

### JSON Log Aggregation

For ELK/Loki/Datadog, use JSON logging:

```yaml
# In /quantix/node.yaml
logging:
  format: json
  level: info
```

Output:
```json
{"timestamp":"2024-01-03T12:34:56.789Z","level":"INFO","component":"vm","vm_id":"abc","message":"VM started"}
```

---

## 7. Debugging Workflows

### "VM Won't Start"

```bash
# 1. Quick health check
qx-diag health

# 2. Check recent errors
qx-diag errors

# 3. Check libvirt logs
qx-diag logs
# Press Tab to switch to Libvirt log

# 4. Check VM-specific logs
grep "vm-abc123" /var/log/quantix-node.log
```

### "Network Not Working"

```bash
# 1. Network diagnostics
qx-diag network

# 2. Check OVS status
ovs-vsctl show

# 3. Filter network logs
grep "🌐" /var/log/quantix-node.log
```

### "Performance Issues"

```bash
# 1. System status
qx-diag system

# 2. Find slow operations
grep "🐢" /var/log/quantix-node.log

# 3. Check timing logs
grep "completed in" /var/log/quantix-node.log | sort -t'n' -k4 -rn
```

### "Generate Support Report"

```bash
# Generate comprehensive report
qx-diag report

# Report location
/tmp/quantix-diag-YYYYMMDD-HHMMSS.txt
```

---

## 8. Log Level Configuration

Set log level in `/quantix/node.yaml`:

```yaml
logging:
  level: info  # trace, debug, info, warn, error
  format: text # text or json
```

Or via environment variable:
```bash
RUST_LOG=debug qx-node
```

### Level Descriptions

| Level | When to Use |
|-------|-------------|
| error | Production - only critical failures |
| warn | Production - includes warnings |
| info | Default - normal operations |
| debug | Troubleshooting - detailed info |
| trace | Development - very verbose |

---

## Quick Reference

### Most Useful Commands

```bash
# Is everything OK?
qx-diag health

# What's happening now?
qx-diag watch

# What went wrong?
qx-diag errors

# I need help from support
qx-diag report
```

### Console TUI Shortcuts

| Key | Action |
|-----|--------|
| F3 | Open log viewer |
| F7 | Open diagnostics |
| E | Errors only |
| P | Pause logs |

---

## Appendix: Emoji Quick Reference

```
Status:     ✅ success  ❌ error  ⚠️ warning  ℹ️ info  🔍 debug
Components: 🖥️ vm  🌐 network  💾 storage  🔒 security  🤖 agent
Actions:    🚀 start  🛑 stop  ➕ create  🗑️ delete  🚚 migrate  📸 snapshot
States:     🟢 running  🔴 stopped  🟡 pending  💚 healthy  💔 unhealthy
Perf:       ⏱️ timing  ⚡ fast  🐢 slow  🧠 memory  💻 cpu
```
