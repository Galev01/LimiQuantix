-- limiquantix Admin Panel Tables
-- Migration: 000002_admin_tables
-- Description: Adds tables for roles, API keys, organizations, SSO, admin emails, and global rules

-- ============================================================================
-- CUSTOM ROLES
-- ============================================================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'custom', -- 'system' or 'custom'
    parent_id UUID REFERENCES roles(id) ON DELETE SET NULL,
    permissions JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_roles_type ON roles(type);
CREATE INDEX idx_roles_parent ON roles(parent_id);

-- Trigger for updated_at
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed system roles
INSERT INTO roles (id, name, description, type, permissions) VALUES
    ('00000000-0000-0000-0001-000000000001', 'admin', 'Full system access', 'system', 
     '["vm:create","vm:read","vm:update","vm:delete","vm:start","vm:stop","vm:migrate","node:create","node:read","node:update","node:delete","node:drain","network:create","network:read","network:update","network:delete","storage:create","storage:read","storage:update","storage:delete","user:create","user:read","user:update","user:delete","system:config","system:audit"]'),
    ('00000000-0000-0000-0001-000000000002', 'operator', 'Can manage VMs and resources', 'system',
     '["vm:create","vm:read","vm:update","vm:delete","vm:start","vm:stop","vm:migrate","node:read","node:drain","network:create","network:read","network:update","storage:create","storage:read","storage:update","user:read"]'),
    ('00000000-0000-0000-0001-000000000003', 'viewer', 'Read-only access', 'system',
     '["vm:read","node:read","network:read","storage:read"]');

-- ============================================================================
-- API KEYS
-- ============================================================================
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    prefix VARCHAR(20) NOT NULL, -- e.g., "qx_prod_"
    key_hash VARCHAR(255) NOT NULL, -- bcrypt hash
    permissions JSONB DEFAULT '[]',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, expired, revoked
    usage_count BIGINT DEFAULT 0,
    last_used TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX idx_api_keys_status ON api_keys(status);
CREATE INDEX idx_api_keys_created_by ON api_keys(created_by);
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- AUDIT LOGS (Enhanced - optimized for time-series queries)
-- Note: This extends the existing audit_log table with additional columns
-- ============================================================================
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'success';

-- Add index for status filtering
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit_log(status);

-- ============================================================================
-- SSO CONFIGURATION
-- ============================================================================
CREATE TABLE sso_configs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_type VARCHAR(20) NOT NULL, -- oidc, saml, ldap
    name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT FALSE,
    
    -- Provider-specific config (encrypted in production via application layer)
    config JSONB NOT NULL DEFAULT '{}',
    
    -- Common SSO settings
    auto_provision BOOLEAN DEFAULT FALSE,
    default_role VARCHAR(50) DEFAULT 'viewer',
    group_mapping JSONB DEFAULT '{}',
    allowed_domains JSONB DEFAULT '[]',
    allowed_groups JSONB DEFAULT '[]',
    jit_provisioning BOOLEAN DEFAULT FALSE,
    update_on_login BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sso_provider_type ON sso_configs(provider_type);
CREATE INDEX idx_sso_enabled ON sso_configs(enabled) WHERE enabled = TRUE;

-- Trigger for updated_at
CREATE TRIGGER update_sso_configs_updated_at
    BEFORE UPDATE ON sso_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- ORGANIZATIONS
-- ============================================================================
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255),
    settings JSONB DEFAULT '{
        "session_timeout_minutes": 60,
        "max_api_keys_per_user": 10,
        "require_mfa": false,
        "allow_self_signup": false,
        "password_min_length": 8,
        "password_require_mix": true,
        "audit_retention_days": 90
    }',
    branding JSONB DEFAULT '{
        "primary_color": "#4064DD",
        "secondary_color": "#D974FE"
    }',
    billing_contact JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger for updated_at
CREATE TRIGGER update_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed default organization
INSERT INTO organizations (id, name, domain) VALUES
    ('00000000-0000-0000-0002-000000000001', 'Default Organization', 'localhost');

-- ============================================================================
-- ADMIN EMAILS
-- ============================================================================
CREATE TABLE admin_emails (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'secondary', -- primary, secondary, billing, security
    notifications JSONB DEFAULT '{
        "critical_alerts": true,
        "warning_alerts": true,
        "security_events": true,
        "system_updates": false,
        "billing_alerts": true,
        "weekly_reports": false,
        "maintenance_mode": true
    }',
    verified BOOLEAN DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_emails_role ON admin_emails(role);
CREATE INDEX idx_admin_emails_verified ON admin_emails(verified);

-- Seed default admin email from existing admin user
INSERT INTO admin_emails (id, email, name, role, verified, verified_at)
SELECT 
    uuid_generate_v4(), 
    email, 
    username,
    'primary',
    TRUE,
    NOW()
FROM users WHERE username = 'admin'
ON CONFLICT (email) DO NOTHING;

-- ============================================================================
-- GLOBAL RULES
-- ============================================================================
CREATE TABLE global_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- compute, storage, network, security
    priority INT DEFAULT 100, -- Lower = higher priority
    enabled BOOLEAN DEFAULT TRUE,
    conditions JSONB NOT NULL DEFAULT '[]',
    actions JSONB NOT NULL DEFAULT '[]',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_global_rules_category ON global_rules(category);
CREATE INDEX idx_global_rules_enabled ON global_rules(enabled) WHERE enabled = TRUE;
CREATE INDEX idx_global_rules_priority ON global_rules(priority);

-- Trigger for updated_at
CREATE TRIGGER update_global_rules_updated_at
    BEFORE UPDATE ON global_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Seed example global rules
INSERT INTO global_rules (name, description, category, priority, conditions, actions) VALUES
    ('Max VM CPU Cores', 'Limit maximum CPU cores per VM to 32', 'compute', 10, 
     '[{"field": "vm.cpu.cores", "operator": "gt", "value": 32}]',
     '[{"type": "deny", "message": "VMs cannot have more than 32 CPU cores"}]'),
    ('Max VM Memory', 'Limit maximum memory per VM to 256GB', 'compute', 10,
     '[{"field": "vm.memory.size_mib", "operator": "gt", "value": 262144}]',
     '[{"type": "deny", "message": "VMs cannot have more than 256GB RAM"}]'),
    ('Max Disk Size', 'Limit maximum disk size to 10TB', 'storage', 20,
     '[{"field": "volume.size_bytes", "operator": "gt", "value": 10995116277760}]',
     '[{"type": "deny", "message": "Disk volumes cannot exceed 10TB"}]');

-- ============================================================================
-- CERTIFICATES (TLS certificate metadata)
-- ============================================================================
CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    domains JSONB DEFAULT '[]', -- Subject Alternative Names
    issuer VARCHAR(255),
    serial_number VARCHAR(255),
    fingerprint VARCHAR(255), -- SHA256 fingerprint
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, expiring, expired, revoked
    issued_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    auto_renew BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_certificates_domain ON certificates(domain);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_certificates_expires_at ON certificates(expires_at);

-- Trigger for updated_at
CREATE TRIGGER update_certificates_updated_at
    BEFORE UPDATE ON certificates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- USER ROLE ASSIGNMENT (link users to custom roles)
-- ============================================================================
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_role ON user_roles(role_id);
