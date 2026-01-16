# Quantix-vDC Post-Installation Troubleshooting Guide

**Document ID:** 000053  
**Date:** January 16, 2026  
**Scope:** Quantix-vDC appliance post-installation issues and fixes

## Overview

This document describes the troubleshooting process and fixes applied to resolve multiple issues encountered after installing Quantix-vDC from the ISO. The issues affected service status detection, nginx startup, PostgreSQL database connectivity, and web UI accessibility.

---

## Issue Summary

| Issue | Symptom | Root Cause | Status |
|-------|---------|------------|--------|
| 1. TUI shows services as "Stopped" | Control plane running but TUI shows "Stopped" | Custom `status()` function output didn't match OpenRC format | ✅ Fixed |
| 2. nginx port conflict | `bind() to 0.0.0.0:80 failed (Address in use)` | Stale nginx processes or PID file mismatch | ✅ Fixed |
| 3. nginx not starting via OpenRC | OpenRC says "started" but no process running | Overly complex `start_pre()` logic with false positive detection | ✅ Fixed |
| 4. Database doesn't exist | `FATAL: database "limiquantix" does not exist` | Config YAML field names didn't match Go struct tags | ✅ Fixed |
| 5. Web UI connection refused | Browser can't connect to HTTPS | nginx not running | ✅ Fixed |

---

## Issue 1: TUI Shows Services as "Stopped" (But They're Running)

### Symptom
The DCUI (console TUI) displayed "Stopped" for the Control Plane service, but the process was actually running and logs showed successful startup.

### Diagnosis
```bash
# Check if process is running
ps aux | grep qx-controlplane
# Shows process running

# Check OpenRC status
rc-service quantix-controlplane status
# Shows "stopped" or custom text
```

### Root Cause
The custom `status()` function in `/etc/init.d/quantix-controlplane` outputted:
```
"Quantix Control Plane is running (PID xxx)"
```

But the TUI's `get_service_status()` function greps for the word `"started"`:
```sh
if rc-service "$service" status 2>/dev/null | grep -q "started"; then
    echo "Running"
```

OpenRC's default status function outputs `"started"` or `"stopped"`, which the TUI expects.

### Fix Applied
**File:** `Quantix-vDC/overlay/etc/init.d/quantix-controlplane`

Removed the custom `status()` function entirely. Added a comment explaining why:

```sh
# Note: We intentionally do NOT override status() here.
# OpenRC's default status function outputs "started" or "stopped" which is
# what our DCUI's get_service_status() function expects to see.
# Custom status() functions that output different text break the TUI detection.
```

### Additional Enhancement
Updated `qx-dcui`'s `get_service_status()` to fallback to checking actual processes if OpenRC status fails:

```sh
get_service_status() {
    local service="$1"
    
    # First try OpenRC status
    if rc-service "$service" status 2>/dev/null | grep -q "started"; then
        echo "Running"
        return
    fi
    
    # Fallback: Check if process is actually running
    case "$service" in
        nginx)
            if pgrep -x nginx >/dev/null 2>&1; then
                echo "Running*"  # Asterisk indicates OpenRC out of sync
                return
            fi
            ;;
        quantix-controlplane)
            if pgrep -f qx-controlplane >/dev/null 2>&1; then
                echo "Running*"
                return
            fi
            ;;
        # ... other services
    esac
    
    echo "Stopped"
}
```

---

## Issue 2: nginx Port Conflict

### Symptom
When trying to start nginx, the error log showed:
```
nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address in use)
nginx: [emerg] bind() to [::]:80 failed (98: Address in use)
nginx: [emerg] bind() to 0.0.0.0:443 failed (98: Address in use)
nginx: [emerg] still could not bind()
```

### Diagnosis
```bash
# Check what's using the ports
netstat -tlnp | grep -E ':80|:443'

# Check for nginx processes
ps aux | grep nginx

# Check PID file
cat /run/nginx.pid
```

### Root Cause
Two possible causes:
1. **Stale nginx processes** from a previous unclean shutdown still holding the ports
2. **nginx already running** but OpenRC thinks it's stopped (PID file mismatch)

### Fix Applied
**File:** `Quantix-vDC/overlay/usr/bin/qx-dcui`

Added special nginx handling in the TUI that force-kills processes and frees ports:

```sh
nginx_service_action() {
    local ACTION="$1"
    
    case "$ACTION" in
        stop|restart)
            # 1. Try graceful stop
            rc-service nginx stop >/dev/null 2>&1
            sleep 1
            
            # 2. Kill remaining processes (QUIT → TERM → KILL)
            pkill -QUIT nginx 2>/dev/null; sleep 1
            pkill -TERM nginx 2>/dev/null; sleep 1
            pkill -9 nginx 2>/dev/null; sleep 1
            
            # 3. Force-free ports 80 and 443
            fuser -k 80/tcp 2>/dev/null || true
            fuser -k 443/tcp 2>/dev/null || true
            
            # 4. Clean up PID file
            rm -f /run/nginx.pid
            ;;
    esac
    
    # Start nginx fresh
    if [ "$ACTION" = "start" ] || [ "$ACTION" = "restart" ]; then
        nginx -t && rc-service nginx start
    fi
}
```

---

## Issue 3: nginx Not Starting via OpenRC

### Symptom
```bash
rc-service nginx status
# Output: * status: started

netstat -tlnp | grep ':80'
# No output - nothing listening!

ps aux | grep nginx
# No nginx processes
```

OpenRC claimed nginx was "started" but no process was running.

### Diagnosis
The custom nginx init script had overly complex "already running" detection:
```
* Found running nginx (PID 4969) - updating PID file
* nginx already running - skipping start
```

But `ps aux | grep nginx` showed no nginx process.

### Root Cause
The `start_pre()` function used `pgrep -o -x nginx` which was returning false positives, causing the script to skip starting nginx entirely.

### Fix Applied
**File:** `Quantix-vDC/overlay/etc/init.d/nginx`

Simplified the init script to follow Alpine's standard pattern:

```sh
#!/sbin/openrc-run

name="nginx"
command="/usr/sbin/nginx"
pidfile="/run/nginx.pid"

start_pre() {
    # Ensure directories exist
    mkdir -p /var/lib/nginx/logs
    mkdir -p /var/lib/nginx/tmp/client_body
    mkdir -p /var/log/nginx
    chown -R nginx:nginx /var/lib/nginx /var/log/nginx 2>/dev/null || true
    
    # Remove stale PID file
    if [ -f "$pidfile" ]; then
        OLD_PID=$(cat "$pidfile" 2>/dev/null)
        if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
            rm -f "$pidfile"
        fi
    fi
    
    # Validate configuration
    $command -t -q || return 1
}

start() {
    ebegin "Starting $name"
    start-stop-daemon --start --exec $command --pidfile "$pidfile"
    eend $?
}

stop() {
    ebegin "Stopping $name"
    start-stop-daemon --stop --pidfile "$pidfile" --exec $command --retry QUIT/5/TERM/5/KILL/5
    rm -f "$pidfile"
    eend $?
}
```

---

## Issue 4: Database Does Not Exist

### Symptom
Control plane logs showed:
```json
{"level":"warn","msg":"PostgreSQL connection failed, falling back to in-memory",
 "error":"FATAL: database \"limiquantix\" does not exist (SQLSTATE 3D000)"}
```

### Diagnosis
```bash
# List databases
su -s /bin/sh postgres -c "psql -l"
# Shows: quantix_vdc exists, but limiquantix does not

# Check config file
cat /etc/quantix-vdc/config.yaml | grep -A5 database
```

### Root Cause
The config YAML had incorrect field names that didn't match the Go struct's `mapstructure` tags:

| YAML Field (Wrong) | Go Struct Field | Correct YAML |
|--------------------|-----------------|--------------|
| `database:` | `Name` | `name:` |
| `ssl_mode:` | `SSLMode` | `sslmode:` |
| `bind:` | `Host` | `host:` |

Since viper couldn't find `database:`, it used the default value `"limiquantix"`.

### Fix Applied
**File:** `Quantix-vDC/overlay/etc/quantix-vdc/config.yaml`

Fixed field names to match Go struct:
```yaml
database:
  host: "localhost"
  port: 5432
  name: "quantix_vdc"    # Was incorrectly: database: "quantix_vdc"
  user: "postgres"
  password: ""
  sslmode: "disable"     # Was incorrectly: ssl_mode: "disable"
  max_open_conns: 50
  max_idle_conns: 10

server:
  host: "0.0.0.0"        # Was incorrectly: bind: "127.0.0.1"
  port: 8080
```

### Database Migration Fix
**Files:** 
- `Quantix-vDC/builder/build-rootfs.sh` - Bundle migrations into ISO
- `Quantix-vDC/installer/firstboot.sh` - Run migrations on first boot

The firstboot script now runs all migration SQL files after creating the database.

---

## Issue 5: Web UI Connection Refused

### Symptom
Browser showed "Connection refused" when accessing `https://<ip>/`

### Diagnosis
```bash
# Check what's listening
netstat -tlnp | grep -E ':80|:443'
# Only shows control plane on :8080, nothing on :80 or :443

# Check nginx status
rc-service nginx status
# Shows "started" but no process running (Issue #3)
```

### Root Cause
nginx wasn't running due to Issue #3 (OpenRC out of sync).

### Immediate Workaround
```bash
# Start nginx directly
/usr/sbin/nginx

# Verify
netstat -tlnp | grep -E ':80|:443'
curl -k https://localhost/
```

### Permanent Fix
After fixing Issue #3 (simplified nginx init script), nginx starts correctly via OpenRC.

---

## Quick Reference: Manual Fixes for Running System

If you encounter these issues on a running system without rebuilding the ISO:

### Fix Service Status Detection
```bash
# Edit the init script
vi /etc/init.d/quantix-controlplane
# Remove the status() function (last ~10 lines before EOF)
```

### Fix nginx Not Starting
```bash
# Force stop and restart
pkill -9 nginx
rm -f /run/nginx.pid
fuser -k 80/tcp 443/tcp 2>/dev/null
/usr/sbin/nginx
```

### Fix Database Connection
```bash
# Create the correct database
su -s /bin/sh postgres -c "createdb quantix_vdc"

# Or fix the config to use existing database
vi /etc/quantix-vdc/config.yaml
# Change database.name to match existing database

# Restart control plane
rc-service quantix-controlplane restart
```

### Verify Everything Works
```bash
# Check all services
netstat -tlnp

# Expected output:
# :5432  - PostgreSQL
# :6379  - Redis  
# :2379  - etcd
# :8080  - Control Plane
# :80    - nginx (HTTP redirect)
# :443   - nginx (HTTPS)

# Test web UI
curl -k https://localhost/
```

---

## Files Modified Summary

| File | Change |
|------|--------|
| `overlay/etc/init.d/quantix-controlplane` | Removed custom `status()` function |
| `overlay/etc/init.d/nginx` | Simplified init script, removed false-positive detection |
| `overlay/usr/bin/qx-dcui` | Added smart status detection + nginx force restart |
| `overlay/etc/quantix-vdc/config.yaml` | Fixed YAML field names to match Go struct |
| `overlay/etc/local.d/99-start-services.start` | Improved database creation with fallback |
| `builder/build-rootfs.sh` | Bundle database migrations |
| `installer/firstboot.sh` | Run migrations on first boot |

---

## Lessons Learned

1. **Never override `status()` in OpenRC init scripts** unless you output exactly `"started"` or `"stopped"`. Other tools rely on this format.

2. **Keep init scripts simple** - Complex "already running" detection can cause false positives. Trust OpenRC's default behavior.

3. **Match YAML field names to Go struct tags** - Viper's `mapstructure` tags must match the YAML keys exactly (case-sensitive).

4. **PID files are critical** - Stale PID files cause OpenRC to lose track of services. Always clean up PID files on stop.

5. **Test with netstat, not just rc-service** - `rc-service status` can lie. Always verify with `netstat -tlnp` or `ps aux`.
