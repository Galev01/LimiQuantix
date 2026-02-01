-- limiquantix Network Schema
-- Migration: 000013_networks
-- Adds persistent storage for virtual networks, security groups, and related entities
-- This migration is idempotent (safe to re-run)

-- ============================================================================
-- VIRTUAL NETWORKS - Add missing columns to existing table or create new
-- ============================================================================

-- Create table if it doesn't exist
CREATE TABLE IF NOT EXISTS virtual_networks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    description TEXT,
    labels JSONB DEFAULT '{}',
    spec JSONB NOT NULL DEFAULT '{}',
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    ovn_logical_switch VARCHAR(255),
    ovn_logical_router VARCHAR(255),
    port_count INTEGER DEFAULT 0,
    ip_allocation_status JSONB DEFAULT '{}',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns if table already exists
DO $$
BEGIN
    -- Add project_id if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'project_id') THEN
        ALTER TABLE virtual_networks ADD COLUMN project_id VARCHAR(255) NOT NULL DEFAULT 'default';
    END IF;
    
    -- Add labels if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'labels') THEN
        ALTER TABLE virtual_networks ADD COLUMN labels JSONB DEFAULT '{}';
    END IF;
    
    -- Add description if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'description') THEN
        ALTER TABLE virtual_networks ADD COLUMN description TEXT;
    END IF;
    
    -- Add spec if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'spec') THEN
        ALTER TABLE virtual_networks ADD COLUMN spec JSONB NOT NULL DEFAULT '{}';
    END IF;
    
    -- Add phase if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'phase') THEN
        ALTER TABLE virtual_networks ADD COLUMN phase VARCHAR(50) NOT NULL DEFAULT 'PENDING';
    END IF;
    
    -- Add ovn_logical_switch if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'ovn_logical_switch') THEN
        ALTER TABLE virtual_networks ADD COLUMN ovn_logical_switch VARCHAR(255);
    END IF;
    
    -- Add ovn_logical_router if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'ovn_logical_router') THEN
        ALTER TABLE virtual_networks ADD COLUMN ovn_logical_router VARCHAR(255);
    END IF;
    
    -- Add port_count if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'port_count') THEN
        ALTER TABLE virtual_networks ADD COLUMN port_count INTEGER DEFAULT 0;
    END IF;
    
    -- Add ip_allocation_status if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'ip_allocation_status') THEN
        ALTER TABLE virtual_networks ADD COLUMN ip_allocation_status JSONB DEFAULT '{}';
    END IF;
    
    -- Add error_message if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'error_message') THEN
        ALTER TABLE virtual_networks ADD COLUMN error_message TEXT;
    END IF;
    
    -- Add timestamps if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'created_at') THEN
        ALTER TABLE virtual_networks ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'virtual_networks' AND column_name = 'updated_at') THEN
        ALTER TABLE virtual_networks ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

-- Create indexes (IF NOT EXISTS is implicit - errors are ignored)
CREATE INDEX IF NOT EXISTS idx_virtual_networks_project ON virtual_networks(project_id);
CREATE INDEX IF NOT EXISTS idx_virtual_networks_phase ON virtual_networks(phase);
CREATE INDEX IF NOT EXISTS idx_virtual_networks_labels ON virtual_networks USING GIN(labels);

-- ============================================================================
-- SECURITY GROUPS - Add missing columns to existing table or create new
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    description TEXT,
    labels JSONB DEFAULT '{}',
    stateful BOOLEAN DEFAULT TRUE,
    rules JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add missing columns if table already exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'project_id') THEN
        ALTER TABLE security_groups ADD COLUMN project_id VARCHAR(255) NOT NULL DEFAULT 'default';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'labels') THEN
        ALTER TABLE security_groups ADD COLUMN labels JSONB DEFAULT '{}';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'description') THEN
        ALTER TABLE security_groups ADD COLUMN description TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'stateful') THEN
        ALTER TABLE security_groups ADD COLUMN stateful BOOLEAN DEFAULT TRUE;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'rules') THEN
        ALTER TABLE security_groups ADD COLUMN rules JSONB DEFAULT '[]';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'created_at') THEN
        ALTER TABLE security_groups ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'security_groups' AND column_name = 'updated_at') THEN
        ALTER TABLE security_groups ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_security_groups_project ON security_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_security_groups_labels ON security_groups USING GIN(labels);

-- ============================================================================
-- NETWORK PORTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS network_ports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255),
    network_id UUID NOT NULL REFERENCES virtual_networks(id) ON DELETE CASCADE,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    labels JSONB DEFAULT '{}',
    spec JSONB NOT NULL DEFAULT '{}',
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    mac_address VARCHAR(17),
    ip_addresses JSONB DEFAULT '[]',
    ovn_port VARCHAR(255),
    vm_id UUID,
    host_id UUID,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_ports_network ON network_ports(network_id);
CREATE INDEX IF NOT EXISTS idx_network_ports_project ON network_ports(project_id);
CREATE INDEX IF NOT EXISTS idx_network_ports_vm ON network_ports(vm_id);
CREATE INDEX IF NOT EXISTS idx_network_ports_phase ON network_ports(phase);

-- ============================================================================
-- LOAD BALANCERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS load_balancers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    network_id UUID REFERENCES virtual_networks(id) ON DELETE SET NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    description TEXT,
    labels JSONB DEFAULT '{}',
    spec JSONB NOT NULL DEFAULT '{}',
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    provisioned_ip INET,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_load_balancers_project ON load_balancers(project_id);
CREATE INDEX IF NOT EXISTS idx_load_balancers_network ON load_balancers(network_id);

-- ============================================================================
-- VPN SERVICES
-- ============================================================================
CREATE TABLE IF NOT EXISTS vpn_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    network_id UUID REFERENCES virtual_networks(id) ON DELETE SET NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    description TEXT,
    labels JSONB DEFAULT '{}',
    spec JSONB NOT NULL DEFAULT '{}',
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    public_ip INET,
    public_key TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vpn_services_project ON vpn_services(project_id);

-- ============================================================================
-- BGP SPEAKERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS bgp_speakers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    node_id UUID NOT NULL,
    local_asn INTEGER NOT NULL,
    router_id INET NOT NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    labels JSONB DEFAULT '{}',
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    established_peers INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgp_speakers_project ON bgp_speakers(project_id);
CREATE INDEX IF NOT EXISTS idx_bgp_speakers_node ON bgp_speakers(node_id);

-- ============================================================================
-- BGP PEERS
-- ============================================================================
CREATE TABLE IF NOT EXISTS bgp_peers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    speaker_id UUID NOT NULL REFERENCES bgp_speakers(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    peer_address INET NOT NULL,
    peer_asn INTEGER NOT NULL,
    password TEXT,
    state VARCHAR(50) DEFAULT 'IDLE',
    prefixes_received INTEGER DEFAULT 0,
    prefixes_sent INTEGER DEFAULT 0,
    uptime VARCHAR(100),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgp_peers_speaker ON bgp_peers(speaker_id);

-- ============================================================================
-- BGP ADVERTISEMENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS bgp_advertisements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    speaker_id UUID NOT NULL REFERENCES bgp_speakers(id) ON DELETE CASCADE,
    prefix CIDR NOT NULL,
    next_hop INET,
    communities JSONB DEFAULT '[]',
    local_pref INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bgp_advertisements_speaker ON bgp_advertisements(speaker_id);

-- ============================================================================
-- FLOATING IPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS floating_ips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address INET NOT NULL,
    external_network_id UUID REFERENCES virtual_networks(id) ON DELETE SET NULL,
    project_id VARCHAR(255) NOT NULL DEFAULT 'default',
    description TEXT,
    labels JSONB DEFAULT '{}',
    port_id UUID REFERENCES network_ports(id) ON DELETE SET NULL,
    fixed_ip INET,
    phase VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    vm_id UUID,
    router_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_floating_ips_project ON floating_ips(project_id);
CREATE INDEX IF NOT EXISTS idx_floating_ips_port ON floating_ips(port_id);

-- Migration complete
SELECT 'Migration 000013_networks completed successfully' AS status;
