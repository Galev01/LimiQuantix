-- Rollback: Remove folder support
-- Document ID: 000006

-- Remove folder_id from virtual_machines
ALTER TABLE virtual_machines DROP COLUMN IF EXISTS folder_id;

-- Drop folders table
DROP TABLE IF EXISTS folders;
