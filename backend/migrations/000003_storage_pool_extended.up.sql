-- Storage Pool Extended Fields Migration
-- Migration: 000003_storage_pool_extended
-- Purpose: Add project_id, labels, assigned_node_ids, and full spec/status columns

-- Add project_id column (nullable for backward compatibility)
ALTER TABLE storage_pools 
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- Add labels column
ALTER TABLE storage_pools 
ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '{}';

-- Add assigned_node_ids column (for host assignment)
ALTER TABLE storage_pools 
ADD COLUMN IF NOT EXISTS assigned_node_ids JSONB DEFAULT '[]';

-- Add error_message column for status
ALTER TABLE storage_pools 
ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT '';

-- Add volume_count for status tracking
ALTER TABLE storage_pools 
ADD COLUMN IF NOT EXISTS volume_count INTEGER DEFAULT 0;

-- Update existing records to have default project
UPDATE storage_pools 
SET project_id = '00000000-0000-0000-0000-000000000001' 
WHERE project_id IS NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_storage_pools_project ON storage_pools(project_id);
CREATE INDEX IF NOT EXISTS idx_storage_pools_type ON storage_pools(pool_type);
CREATE INDEX IF NOT EXISTS idx_storage_pools_phase ON storage_pools(phase);
CREATE INDEX IF NOT EXISTS idx_storage_pools_labels ON storage_pools USING GIN(labels);
