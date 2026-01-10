-- Volume Extended Fields Migration
-- Migration: 000004_volume_extended
-- Purpose: Add labels, spec JSONB, and full status columns for volumes

-- Add labels column
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS labels JSONB DEFAULT '{}';

-- Add full spec as JSONB (contains source, qos, encryption, access_mode)
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS spec JSONB DEFAULT '{}';

-- Add error_message for status
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT '';

-- Add actual_size_bytes for sparse volumes
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS actual_size_bytes BIGINT DEFAULT 0;

-- Add backend_id for tracking volume in backend storage
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS backend_id TEXT DEFAULT '';

-- Add device_path for attached path
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS device_path TEXT DEFAULT '';

-- Add snapshot_count
ALTER TABLE volumes 
ADD COLUMN IF NOT EXISTS snapshot_count INTEGER DEFAULT 0;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_volumes_labels ON volumes USING GIN(labels);
CREATE INDEX IF NOT EXISTS idx_volumes_provisioning ON volumes(provisioning);
