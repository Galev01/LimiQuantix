-- Rollback: Storage Pool Extended Fields Migration

-- Drop indexes
DROP INDEX IF EXISTS idx_storage_pools_labels;
DROP INDEX IF EXISTS idx_storage_pools_phase;
DROP INDEX IF EXISTS idx_storage_pools_type;
DROP INDEX IF EXISTS idx_storage_pools_project;

-- Drop columns
ALTER TABLE storage_pools DROP COLUMN IF EXISTS volume_count;
ALTER TABLE storage_pools DROP COLUMN IF EXISTS error_message;
ALTER TABLE storage_pools DROP COLUMN IF EXISTS assigned_node_ids;
ALTER TABLE storage_pools DROP COLUMN IF EXISTS labels;
ALTER TABLE storage_pools DROP COLUMN IF EXISTS project_id;
