-- Rollback: 000012_images_extended
-- Restore the original images table schema

DROP TABLE IF EXISTS images CASCADE;

-- Recreate original images table
CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    os_type VARCHAR(100), -- linux, windows
    os_variant VARCHAR(100), -- ubuntu-22.04, windows-server-2022
    
    -- Storage
    pool_id UUID REFERENCES storage_pools(id) ON DELETE SET NULL,
    size_bytes BIGINT DEFAULT 0,
    format VARCHAR(50), -- qcow2, raw, vmdk
    path VARCHAR(500),
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'AVAILABLE',
    
    -- Metadata
    min_cpu INTEGER DEFAULT 1,
    min_memory_mib INTEGER DEFAULT 512,
    min_disk_gib INTEGER DEFAULT 10,
    
    public BOOLEAN DEFAULT TRUE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_images_pool ON images(pool_id);
CREATE INDEX idx_images_project ON images(project_id);

CREATE TRIGGER update_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
