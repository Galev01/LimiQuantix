-- limiquantix Initial Schema
-- Migration: 000001_init

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PROJECTS (Multi-tenancy)
-- ============================================================================
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    quota JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- CLUSTERS
-- ============================================================================
CREATE TABLE clusters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    ha_enabled BOOLEAN DEFAULT FALSE,
    drs_enabled BOOLEAN DEFAULT FALSE,
    drs_automation VARCHAR(50) DEFAULT 'manual',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- NODES (Hypervisor Hosts)
-- ============================================================================
CREATE TABLE nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname VARCHAR(255) NOT NULL UNIQUE,
    management_ip INET NOT NULL,
    cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL,
    labels JSONB DEFAULT '{}',
    
    -- Hardware spec
    spec JSONB NOT NULL DEFAULT '{}',
    
    -- Runtime status
    phase VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    conditions JSONB DEFAULT '[]',
    allocatable JSONB DEFAULT '{}',
    allocated JSONB DEFAULT '{}',
    vm_ids JSONB DEFAULT '[]',
    system_info JSONB,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ
);

CREATE INDEX idx_nodes_cluster ON nodes(cluster_id);
CREATE INDEX idx_nodes_phase ON nodes(phase);
CREATE INDEX idx_nodes_labels ON nodes USING GIN(labels);

-- ============================================================================
-- VIRTUAL MACHINES
-- ============================================================================
CREATE TABLE virtual_machines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    description TEXT,
    labels JSONB DEFAULT '{}',
    hardware_version VARCHAR(50),
    
    -- Desired configuration
    spec JSONB NOT NULL DEFAULT '{}',
    
    -- Runtime status
    power_state VARCHAR(50) NOT NULL DEFAULT 'STOPPED',
    node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
    ip_addresses JSONB DEFAULT '[]',
    resources JSONB DEFAULT '{}',
    guest_agent JSONB,
    console_info JSONB,
    status_message TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    
    UNIQUE(project_id, name)
);

CREATE INDEX idx_vms_project ON virtual_machines(project_id);
CREATE INDEX idx_vms_node ON virtual_machines(node_id);
CREATE INDEX idx_vms_state ON virtual_machines(power_state);
CREATE INDEX idx_vms_labels ON virtual_machines USING GIN(labels);
CREATE INDEX idx_vms_created ON virtual_machines(created_at DESC);

-- ============================================================================
-- STORAGE POOLS
-- ============================================================================
CREATE TABLE storage_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    pool_type VARCHAR(50) NOT NULL, -- CEPH_RBD, LOCAL_LVM, NFS
    description TEXT,
    
    -- Configuration
    spec JSONB NOT NULL DEFAULT '{}',
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
    capacity_bytes BIGINT DEFAULT 0,
    used_bytes BIGINT DEFAULT 0,
    available_bytes BIGINT DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- VOLUMES
-- ============================================================================
CREATE TABLE volumes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    pool_id UUID NOT NULL REFERENCES storage_pools(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Configuration
    size_bytes BIGINT NOT NULL,
    provisioning VARCHAR(50) DEFAULT 'THIN', -- THIN, THICK
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    attached_vm_id UUID REFERENCES virtual_machines(id) ON DELETE SET NULL,
    path VARCHAR(500),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(pool_id, name)
);

CREATE INDEX idx_volumes_pool ON volumes(pool_id);
CREATE INDEX idx_volumes_project ON volumes(project_id);
CREATE INDEX idx_volumes_vm ON volumes(attached_vm_id);
CREATE INDEX idx_volumes_phase ON volumes(phase);

-- ============================================================================
-- VIRTUAL NETWORKS
-- ============================================================================
CREATE TABLE virtual_networks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    network_type VARCHAR(50) NOT NULL, -- VLAN, OVERLAY, EXTERNAL
    description TEXT,
    
    -- Configuration
    vlan_id INTEGER,
    cidr CIDR,
    gateway INET,
    dhcp_enabled BOOLEAN DEFAULT FALSE,
    dhcp_range_start INET,
    dhcp_range_end INET,
    dns_servers JSONB DEFAULT '[]',
    
    -- Status
    phase VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SECURITY GROUPS
-- ============================================================================
CREATE TABLE security_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    is_default BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sg_project ON security_groups(project_id);

-- ============================================================================
-- SECURITY RULES
-- ============================================================================
CREATE TABLE security_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    security_group_id UUID NOT NULL REFERENCES security_groups(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL, -- INBOUND, OUTBOUND
    protocol VARCHAR(10) NOT NULL,  -- TCP, UDP, ICMP, ANY
    port_range_min INTEGER,
    port_range_max INTEGER,
    remote_cidr CIDR,
    remote_group_id UUID REFERENCES security_groups(id) ON DELETE CASCADE,
    action VARCHAR(10) NOT NULL DEFAULT 'ALLOW', -- ALLOW, DENY
    priority INTEGER DEFAULT 100,
    description TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rules_sg ON security_rules(security_group_id);

-- ============================================================================
-- VM SECURITY GROUP ASSOCIATION
-- ============================================================================
CREATE TABLE vm_security_groups (
    vm_id UUID REFERENCES virtual_machines(id) ON DELETE CASCADE,
    security_group_id UUID REFERENCES security_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (vm_id, security_group_id)
);

-- ============================================================================
-- ALERTS
-- ============================================================================
CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    severity VARCHAR(20) NOT NULL, -- CRITICAL, WARNING, INFO
    title VARCHAR(500) NOT NULL,
    message TEXT,
    source_type VARCHAR(50), -- HOST, VM, STORAGE, NETWORK, CLUSTER
    source_id UUID,
    source_name VARCHAR(255),
    
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMPTZ,
    
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_severity ON alerts(severity) WHERE NOT resolved;
CREATE INDEX idx_alerts_source ON alerts(source_type, source_id);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
CREATE INDEX idx_alerts_unresolved ON alerts(created_at DESC) WHERE NOT resolved;

-- ============================================================================
-- DRS RECOMMENDATIONS
-- ============================================================================
CREATE TABLE drs_recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cluster_id UUID REFERENCES clusters(id) ON DELETE CASCADE,
    priority VARCHAR(20) NOT NULL, -- CRITICAL, HIGH, MEDIUM, LOW
    recommendation_type VARCHAR(50) NOT NULL, -- MIGRATE, POWER_ON, POWER_OFF
    reason TEXT,
    
    vm_id UUID REFERENCES virtual_machines(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
    target_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL,
    
    impact_cpu INTEGER, -- Improvement percentage
    impact_memory INTEGER,
    estimated_duration VARCHAR(50),
    
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, APPLIED, REJECTED
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    applied_by VARCHAR(255)
);

CREATE INDEX idx_drs_cluster ON drs_recommendations(cluster_id);
CREATE INDEX idx_drs_status ON drs_recommendations(status) WHERE status = 'PENDING';
CREATE INDEX idx_drs_vm ON drs_recommendations(vm_id);

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer', -- admin, operator, viewer
    
    enabled BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login TIMESTAMPTZ
);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    resource_name VARCHAR(255),
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action);

-- ============================================================================
-- SNAPSHOTS
-- ============================================================================
CREATE TABLE vm_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vm_id UUID NOT NULL REFERENCES virtual_machines(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES vm_snapshots(id) ON DELETE SET NULL,
    
    -- Snapshot state
    state VARCHAR(50) NOT NULL DEFAULT 'CREATING',
    size_bytes BIGINT DEFAULT 0,
    
    -- Metadata
    vm_state JSONB, -- VM spec at time of snapshot
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    
    UNIQUE(vm_id, name)
);

CREATE INDEX idx_snapshots_vm ON vm_snapshots(vm_id);

-- ============================================================================
-- IMAGES (OS Templates)
-- ============================================================================
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

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clusters_updated_at
    BEFORE UPDATE ON clusters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nodes_updated_at
    BEFORE UPDATE ON nodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vms_updated_at
    BEFORE UPDATE ON virtual_machines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_storage_pools_updated_at
    BEFORE UPDATE ON storage_pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_volumes_updated_at
    BEFORE UPDATE ON volumes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_networks_updated_at
    BEFORE UPDATE ON virtual_networks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_security_groups_updated_at
    BEFORE UPDATE ON security_groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- Default project
INSERT INTO projects (id, name, description) VALUES 
    ('00000000-0000-0000-0000-000000000001', 'default', 'Default project');

-- Default security group
INSERT INTO security_groups (id, name, description, project_id, is_default) VALUES
    ('00000000-0000-0000-0000-000000000001', 'default', 'Default security group - allows all traffic', '00000000-0000-0000-0000-000000000001', TRUE);

-- Default security rules (allow all)
INSERT INTO security_rules (security_group_id, direction, protocol, remote_cidr, action, description) VALUES
    ('00000000-0000-0000-0000-000000000001', 'INBOUND', 'ANY', '0.0.0.0/0', 'ALLOW', 'Allow all inbound'),
    ('00000000-0000-0000-0000-000000000001', 'OUTBOUND', 'ANY', '0.0.0.0/0', 'ALLOW', 'Allow all outbound');

-- Admin user (password: admin)
INSERT INTO users (id, username, email, password_hash, role) VALUES
    ('00000000-0000-0000-0000-000000000001', 'admin', 'admin@limiquantix.local', '$2a$10$N9qo8uLOickgx2ZMRZoMye8.4Zu7QxQZqJzLz6.2eVCTQQjvMidjW', 'admin');

