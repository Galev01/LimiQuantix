-- Remove host_statuses column from storage_pools table

DROP INDEX IF EXISTS idx_storage_pools_host_statuses;
ALTER TABLE storage_pools DROP COLUMN IF EXISTS host_statuses;
