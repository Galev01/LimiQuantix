-- Customization Specifications table for guest OS provisioning
-- Document ID: 000007

CREATE TABLE IF NOT EXISTS customization_specs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    project_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    type VARCHAR(50) NOT NULL DEFAULT 'LINUX',
    linux_spec JSONB,
    windows_spec JSONB,
    network JSONB,
    install_agent BOOLEAN DEFAULT false,
    labels JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by VARCHAR(255),
    
    -- Unique name per project
    CONSTRAINT unique_customization_spec_name UNIQUE (project_id, name)
);

-- Index for project queries
CREATE INDEX IF NOT EXISTS idx_customization_specs_project_id ON customization_specs(project_id);

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_customization_specs_type ON customization_specs(type);

-- Create default Linux customization spec
INSERT INTO customization_specs (id, name, description, project_id, type, linux_spec, install_agent) VALUES
    ('20000000-0000-0000-0000-000000000001', 
     'Default Linux', 
     'Default Linux customization with Quantix agent installation', 
     '00000000-0000-0000-0000-000000000001', 
     'LINUX', 
     '{"timezone": "UTC", "hostname_template": "vm-{name}"}',
     true)
ON CONFLICT (project_id, name) DO NOTHING;

-- Create default Windows customization spec
INSERT INTO customization_specs (id, name, description, project_id, type, windows_spec, install_agent) VALUES
    ('20000000-0000-0000-0000-000000000002', 
     'Default Windows', 
     'Default Windows customization with Quantix agent installation', 
     '00000000-0000-0000-0000-000000000001', 
     'WINDOWS', 
     '{"timezone": "UTC", "workgroup": "WORKGROUP"}',
     true)
ON CONFLICT (project_id, name) DO NOTHING;

COMMENT ON TABLE customization_specs IS 'Reusable guest OS customization specifications (like vSphere Customization Specs)';
COMMENT ON COLUMN customization_specs.type IS 'Target OS type: LINUX or WINDOWS';
COMMENT ON COLUMN customization_specs.linux_spec IS 'Linux-specific settings (timezone, users, SSH keys, packages)';
COMMENT ON COLUMN customization_specs.windows_spec IS 'Windows-specific settings (product key, domain join, admin password)';
COMMENT ON COLUMN customization_specs.install_agent IS 'Whether to install Quantix guest agent during provisioning';
