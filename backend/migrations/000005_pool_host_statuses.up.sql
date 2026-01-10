-- Add host_statuses column to storage_pools table
-- This stores per-host status reports as JSON (host is source of truth for capacity/health)

ALTER TABLE storage_pools 
ADD COLUMN IF NOT EXISTS host_statuses JSONB DEFAULT '{}';

-- Add index for querying by health status (useful for alerts)
CREATE INDEX IF NOT EXISTS idx_storage_pools_host_statuses ON storage_pools USING gin (host_statuses);

COMMENT ON COLUMN storage_pools.host_statuses IS 
    'Per-host status reports (JSON). Keys are node_ids, values contain health, capacity, mount info.';
