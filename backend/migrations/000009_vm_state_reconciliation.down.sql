-- Rollback: Remove VM state reconciliation fields

DROP INDEX IF EXISTS idx_vms_last_seen;
DROP INDEX IF EXISTS idx_vms_is_managed;
DROP INDEX IF EXISTS idx_vms_origin;

ALTER TABLE virtual_machines DROP COLUMN IF EXISTS lost_at;
ALTER TABLE virtual_machines DROP COLUMN IF EXISTS lost_reason;
ALTER TABLE virtual_machines DROP COLUMN IF EXISTS last_seen;
ALTER TABLE virtual_machines DROP COLUMN IF EXISTS is_managed;
ALTER TABLE virtual_machines DROP COLUMN IF EXISTS origin;
