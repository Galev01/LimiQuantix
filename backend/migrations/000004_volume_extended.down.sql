-- Rollback: Volume Extended Fields Migration

-- Drop indexes
DROP INDEX IF EXISTS idx_volumes_provisioning;
DROP INDEX IF EXISTS idx_volumes_labels;

-- Drop columns
ALTER TABLE volumes DROP COLUMN IF EXISTS snapshot_count;
ALTER TABLE volumes DROP COLUMN IF EXISTS device_path;
ALTER TABLE volumes DROP COLUMN IF EXISTS backend_id;
ALTER TABLE volumes DROP COLUMN IF EXISTS actual_size_bytes;
ALTER TABLE volumes DROP COLUMN IF EXISTS error_message;
ALTER TABLE volumes DROP COLUMN IF EXISTS spec;
ALTER TABLE volumes DROP COLUMN IF EXISTS labels;
