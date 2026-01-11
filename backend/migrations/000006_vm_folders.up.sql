-- Folders table for organizing VMs (vSphere-like folder hierarchy)
-- Document ID: 000006

CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
    project_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    type VARCHAR(50) NOT NULL DEFAULT 'VM',
    description TEXT,
    labels JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255),
    
    -- Prevent duplicate folder names at the same level
    CONSTRAINT unique_folder_name_per_parent UNIQUE (parent_id, name, project_id)
);

-- Index for fast parent lookups (tree traversal)
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);

-- Index for project-level queries
CREATE INDEX IF NOT EXISTS idx_folders_project_id ON folders(project_id);

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_folders_type ON folders(type);

-- Add folder_id column to virtual_machines table
ALTER TABLE virtual_machines 
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

-- Index for folder membership queries
CREATE INDEX IF NOT EXISTS idx_virtual_machines_folder_id ON virtual_machines(folder_id);

-- Create default root folders for VM organization
INSERT INTO folders (id, name, parent_id, project_id, type, description) VALUES
    ('10000000-0000-0000-0000-000000000001', 'Virtual Machines', NULL, '00000000-0000-0000-0000-000000000001', 'VM', 'Root folder for all virtual machines'),
    ('10000000-0000-0000-0000-000000000002', 'Templates', NULL, '00000000-0000-0000-0000-000000000001', 'VM', 'Folder for VM templates'),
    ('10000000-0000-0000-0000-000000000003', 'Discovered VMs', NULL, '00000000-0000-0000-0000-000000000001', 'VM', 'Automatically discovered VMs')
ON CONFLICT (parent_id, name, project_id) DO NOTHING;

COMMENT ON TABLE folders IS 'Hierarchical folder structure for organizing VMs, similar to vSphere folders';
COMMENT ON COLUMN folders.parent_id IS 'Parent folder ID (NULL for root folders)';
COMMENT ON COLUMN folders.type IS 'Folder type: VM, DATASTORE, NETWORK, HOST';
COMMENT ON COLUMN virtual_machines.folder_id IS 'Optional folder for organizing VMs';
