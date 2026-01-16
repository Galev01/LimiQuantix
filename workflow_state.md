# Workflow State

## Quantix-vDC Post-Install Issues

### Status: FIXED - REBUILD REQUIRED

---

### Issue 1: TUI shows Control Plane as "Stopped" (but it's running)

**Root Cause:** The `get_service_status()` function in `qx-dcui` looks for the word "started" in `rc-service status` output:

```sh
if rc-service "$service" status 2>/dev/null | grep -q "started"; then
```

But the custom `status()` function in `/etc/init.d/quantix-controlplane` outputted `"$name is running (PID: xxx)"` which doesn't contain "started".

**Fix Applied:** Removed the custom `status()` function from `/etc/init.d/quantix-controlplane` and added a comment explaining why. OpenRC's default status handler outputs "started" when the service is running, which is what the TUI expects.

**File Changed:** `Quantix-vDC/overlay/etc/init.d/quantix-controlplane`

---

### Issue 2: nginx fails - `bind() to 0.0.0.0:80 failed (98: Address in use)`

**Root Cause:** Stale nginx processes from a previous boot (that didn't shut down cleanly) were still holding ports 80 and 443.

**Fix Applied:** Added stale process cleanup in `99-start-services.start` before starting nginx:

1. Check for stale PID file and remove if process doesn't exist
2. If service shows stopped but nginx processes exist, kill them
3. Wait and remove stale PID file

**File Changed:** `Quantix-vDC/overlay/etc/local.d/99-start-services.start`

---

### Files Modified

| File | Change |
|------|--------|
| `overlay/etc/init.d/quantix-controlplane` | Removed custom `status()` function |
| `overlay/etc/local.d/99-start-services.start` | Added stale nginx process cleanup |

---

### Next Steps

1. Rebuild the ISO: `cd Quantix-vDC && make iso`
2. Reinstall or update the appliance
3. Verify:
   - TUI shows Control Plane as "Running"
   - nginx starts successfully on ports 80/443
   - Web UI is accessible at `https://<ip>/`

---

### Immediate Workaround (without rebuild)

If you want to fix the running appliance without rebuilding:

```sh
# Fix 1: TUI detection issue
# SSH into appliance and edit the init script:
vi /etc/init.d/quantix-controlplane
# Remove the status() function (lines 86-95)

# Fix 2: nginx port conflict
# Kill stale nginx and restart:
pkill -9 nginx
rm -f /run/nginx.pid
rc-service nginx start

# Verify
rc-service nginx status
curl -k https://localhost/
```
