-- limiquantix Images Extended Schema
-- Migration: 000012_images_extended
-- Extends the images table to support full domain model

-- Drop the old images table and recreate with extended schema
DROP TABLE IF EXISTS images CASCADE;

CREATE TABLE images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    labels JSONB DEFAULT '{}',
    
    -- Spec (stored as JSONB for flexibility)
    format VARCHAR(50) NOT NULL DEFAULT 'QCOW2', -- RAW, QCOW2, VMDK, VHD, ISO, OVA
    visibility VARCHAR(50) NOT NULL DEFAULT 'PROJECT', -- PRIVATE, PROJECT, PUBLIC
    os_family VARCHAR(50) DEFAULT 'UNKNOWN', -- UNKNOWN, LINUX, WINDOWS, BSD, OTHER
    os_distribution VARCHAR(100),
    os_version VARCHAR(50),
    os_architecture VARCHAR(50) DEFAULT 'x86_64',
    os_default_user VARCHAR(100),
    os_cloud_init_enabled BOOLEAN DEFAULT FALSE,
    os_provisioning_method VARCHAR(50) DEFAULT 'NONE', -- UNKNOWN, CLOUD_INIT, IGNITION, SYSPREP, KICKSTART, PRESEED, NONE
    
    -- Requirements
    min_cpu INTEGER DEFAULT 1,
    min_memory_mib BIGINT DEFAULT 512,
    min_disk_gib BIGINT DEFAULT 10,
    supported_firmware JSONB DEFAULT '["bios", "uefi"]',
    requires_secure_boot BOOLEAN DEFAULT FALSE,
    requires_tpm BOOLEAN DEFAULT FALSE,
    
    -- OVA metadata (only for OVA format)
    ova_metadata JSONB,
    
    -- Catalog tracking
    catalog_id VARCHAR(255), -- Tracks which catalog entry this was downloaded from
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, DOWNLOADING, CONVERTING, READY, ERROR, DELETING, EXTRACTING, PARSING
    size_bytes BIGINT DEFAULT 0,
    virtual_size_bytes BIGINT DEFAULT 0,
    progress_percent INTEGER DEFAULT 0,
    checksum VARCHAR(255),
    error_message TEXT,
    storage_pool_id UUID REFERENCES storage_pools(id) ON DELETE SET NULL,
    path VARCHAR(500), -- Local file path on the node
    node_id UUID REFERENCES nodes(id) ON DELETE SET NULL, -- Node that hosts this image
    folder_path VARCHAR(500), -- Virtual folder path for organization
    filename VARCHAR(255), -- Original filename
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique constraint: name should be unique within a project (or globally if no project)
    UNIQUE(project_id, name)
);

-- Indexes for common queries
CREATE INDEX idx_images_project ON images(project_id);
CREATE INDEX idx_images_pool ON images(storage_pool_id);
CREATE INDEX idx_images_node ON images(node_id);
CREATE INDEX idx_images_phase ON images(phase);
CREATE INDEX idx_images_format ON images(format);
CREATE INDEX idx_images_catalog ON images(catalog_id);
CREATE INDEX idx_images_labels ON images USING GIN(labels);
CREATE INDEX idx_images_path ON images(path);
CREATE INDEX idx_images_folder ON images(folder_path);
CREATE INDEX idx_images_created ON images(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
