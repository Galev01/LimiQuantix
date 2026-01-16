# Workflow State

## Completed Task: Fix Quantix-vDC Database Migration Issue

### Problem (RESOLVED)
After installing Quantix-vDC from ISO, the web UI showed HTTP 500 errors because the PostgreSQL database tables didn't exist. The `firstboot.sh` script created the database but never ran the schema migrations.

### Root Cause
1. `firstboot.sh` created database `quantix_vdc` and user `quantix`
2. But the migration SQL files from `/backend/migrations/` were never executed
3. Tables like `nodes`, `virtual_machines`, `storage_pools`, `volumes` didn't exist
4. Config file had wrong database name (`limiquantix` instead of `quantix_vdc`)

### Solution Applied
1. **Fixed config.yaml** - Changed database name from `limiquantix` to `quantix_vdc`
2. **Updated build-rootfs.sh** - Added Step 7b to copy migration SQL files to `/usr/share/quantix-vdc/migrations/`
3. **Updated firstboot.sh** - Added migration execution after PostgreSQL initialization
4. **Updated overlay/installer/firstboot.sh** - Same migration changes

### Files Modified
- `Quantix-vDC/overlay/etc/quantix-vdc/config.yaml` - Database name fix
- `Quantix-vDC/builder/build-rootfs.sh` - Bundle migrations into ISO
- `Quantix-vDC/installer/firstboot.sh` - Run migrations on first boot
- `Quantix-vDC/overlay/installer/firstboot.sh` - Run migrations on first boot

### Next Steps
To apply this fix:
1. Rebuild the Quantix-vDC ISO using `make iso` or the build scripts
2. Reinstall from the new ISO
3. The firstboot process will now:
   - Create the database
   - Run all 8 migration files in order
   - Grant permissions to the quantix user
   - Start the control plane with working database tables

### For Existing Installations (Manual Fix)
If you have an existing installation without rebuilding the ISO, you can manually run the migrations:

```bash
# SSH into the Quantix-vDC appliance
ssh root@192.168.0.95

# Copy migrations from the backend repo (if available)
# Or download them from the repo

# Run migrations manually
cd /path/to/migrations
for f in $(ls -1 *.up.sql | sort); do
    echo "Applying: $f"
    su -s /bin/sh postgres -c "psql -d quantix_vdc -f '$f'"
done

# Grant permissions
su -s /bin/sh postgres -c "psql -d quantix_vdc -c 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO quantix;'"
su -s /bin/sh postgres -c "psql -d quantix_vdc -c 'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO quantix;'"

# Restart control plane
rc-service quantix-controlplane restart
```

### Status: COMPLETE
