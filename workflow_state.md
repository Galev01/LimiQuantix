# Workflow State

## Quantix-vDC Web UI Connection Refused

### Status: FIXED - REBUILD REQUIRED

---

### Issues Found

1. **Database name mismatch** - Config file used wrong field names
2. **Config YAML field names wrong** - Didn't match Go struct mapstructure tags

---

### Fixes Applied

#### 1. Fixed config.yaml Field Names

**Before (wrong):**
```yaml
database:
  database: "quantix_vdc"  # Wrong field name!
  ssl_mode: "disable"      # Wrong field name!
  
server:
  bind: "127.0.0.1"        # Wrong field name!
```

**After (correct):**
```yaml
database:
  name: "limiquantix"      # Matches mapstructure:"name"
  sslmode: "disable"       # Matches mapstructure:"sslmode"
  
server:
  host: "0.0.0.0"          # Matches mapstructure:"host"
```

#### 2. Fixed Database Creation

Updated `99-start-services.start` to properly create the `limiquantix` database with error handling.

---

### Files Modified

| File | Change |
|------|--------|
| `overlay/etc/quantix-vdc/config.yaml` | Fixed field names to match Go struct |
| `overlay/etc/local.d/99-start-services.start` | Better database creation with fallback |

---

### Root Cause Analysis

The control plane logs showed:
```
FATAL: database "limiquantix" does not exist
```

This happened because:
1. The config YAML had `database: "quantix_vdc"` but the Go field is `name`
2. Since the field name was wrong, viper used the default value `"limiquantix"`
3. The startup script was creating `limiquantix` but database creation was failing silently

---

### To Verify After Rebuild

1. Check database exists:
```sh
su -s /bin/sh postgres -c "psql -l" | grep limiquantix
```

2. Check control plane connects to PostgreSQL:
```sh
cat /var/log/quantix-controlplane.err.log | grep -i postgres
```

3. Check nginx serves frontend:
```sh
curl -k https://localhost/
ls -la /usr/share/quantix-vdc/dashboard/
```

---

### Immediate Fix on Running System

```sh
# Create the database manually
su -s /bin/sh postgres -c "createdb limiquantix"

# Restart control plane to reconnect
rc-service quantix-controlplane restart

# Check it connected
cat /var/log/quantix-controlplane.err.log | tail -20
```
