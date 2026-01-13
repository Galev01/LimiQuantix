-- QuantumNet IPAM (IP Address Management) Tables
-- Document: 000070-quantumnet-implementation-plan.md

-- =============================================================================
-- SUBNET POOLS
-- =============================================================================
-- Tracks subnet configuration and allocation statistics per network

CREATE TABLE IF NOT EXISTS subnet_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id UUID NOT NULL UNIQUE,
    cidr CIDR NOT NULL,
    gateway INET NOT NULL,
    alloc_start INET NOT NULL,
    alloc_end INET NOT NULL,
    total_ips INTEGER NOT NULL,
    allocated_ips INTEGER DEFAULT 0,
    dhcp_enabled BOOLEAN DEFAULT true,
    dhcp_options_uuid VARCHAR(64),
    dns_servers TEXT[], -- Array of DNS server IPs
    ntp_servers TEXT[], -- Array of NTP server IPs
    domain_name VARCHAR(255),
    lease_time_sec INTEGER DEFAULT 86400, -- Default 24 hours
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by network
CREATE INDEX idx_subnet_pools_network ON subnet_pools(network_id);

-- =============================================================================
-- IP ALLOCATIONS
-- =============================================================================
-- Tracks individual IP address allocations within a subnet

CREATE TYPE ip_allocation_type AS ENUM (
    'gateway',     -- Reserved for network gateway
    'broadcast',   -- Reserved for broadcast address
    'reserved',    -- Manually reserved by admin
    'static',      -- Static assignment (user-specified)
    'dynamic'      -- Dynamic assignment (DHCP)
);

CREATE TABLE IF NOT EXISTS ip_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id UUID NOT NULL,
    pool_id UUID NOT NULL REFERENCES subnet_pools(id) ON DELETE CASCADE,
    port_id UUID, -- NULL for reserved IPs (gateway, broadcast)
    ip_address INET NOT NULL,
    mac_address MACADDR,
    hostname VARCHAR(255),
    allocation_type ip_allocation_type NOT NULL DEFAULT 'dynamic',
    description TEXT,
    expires_at TIMESTAMPTZ, -- For DHCP lease expiration
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure unique IP per network
    UNIQUE(network_id, ip_address)
);

-- Indexes for common queries
CREATE INDEX idx_ip_allocations_network ON ip_allocations(network_id);
CREATE INDEX idx_ip_allocations_pool ON ip_allocations(pool_id);
CREATE INDEX idx_ip_allocations_port ON ip_allocations(port_id);
CREATE INDEX idx_ip_allocations_mac ON ip_allocations(mac_address);
CREATE INDEX idx_ip_allocations_type ON ip_allocations(allocation_type);

-- =============================================================================
-- MAC ADDRESS REGISTRY
-- =============================================================================
-- Tracks MAC addresses to prevent duplicates across the cluster

CREATE TABLE IF NOT EXISTS mac_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mac_address MACADDR NOT NULL UNIQUE,
    port_id UUID,
    vm_id UUID,
    project_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mac_registry_port ON mac_registry(port_id);
CREATE INDEX idx_mac_registry_vm ON mac_registry(vm_id);
CREATE INDEX idx_mac_registry_project ON mac_registry(project_id);

-- =============================================================================
-- DHCP STATIC BINDINGS
-- =============================================================================
-- Static DHCP bindings that override dynamic allocation

CREATE TABLE IF NOT EXISTS dhcp_static_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id UUID NOT NULL,
    pool_id UUID NOT NULL REFERENCES subnet_pools(id) ON DELETE CASCADE,
    mac_address MACADDR NOT NULL,
    ip_address INET NOT NULL,
    hostname VARCHAR(255),
    description TEXT,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique MAC per network
    UNIQUE(network_id, mac_address),
    -- Unique IP per network
    UNIQUE(network_id, ip_address)
);

CREATE INDEX idx_dhcp_bindings_network ON dhcp_static_bindings(network_id);
CREATE INDEX idx_dhcp_bindings_mac ON dhcp_static_bindings(mac_address);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================

-- Function to update allocated_ips count when allocations change
CREATE OR REPLACE FUNCTION update_pool_allocation_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE subnet_pools 
        SET allocated_ips = allocated_ips + 1, updated_at = NOW()
        WHERE id = NEW.pool_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE subnet_pools 
        SET allocated_ips = allocated_ips - 1, updated_at = NOW()
        WHERE id = OLD.pool_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to keep allocation count in sync
CREATE TRIGGER trg_update_pool_allocation_count
    AFTER INSERT OR DELETE ON ip_allocations
    FOR EACH ROW
    EXECUTE FUNCTION update_pool_allocation_count();

-- Function to generate a random locally-administered MAC address
-- Format: fa:16:3e:xx:xx:xx (same prefix as OpenStack Neutron)
CREATE OR REPLACE FUNCTION generate_random_mac()
RETURNS MACADDR AS $$
DECLARE
    mac_bytes BYTEA;
BEGIN
    -- Generate 3 random bytes for the last 3 octets
    mac_bytes := gen_random_bytes(3);
    
    -- Return MAC with fa:16:3e prefix (locally administered, unicast)
    RETURN ('fa:16:3e:' || 
            encode(substring(mac_bytes from 1 for 1), 'hex') || ':' ||
            encode(substring(mac_bytes from 2 for 1), 'hex') || ':' ||
            encode(substring(mac_bytes from 3 for 1), 'hex'))::MACADDR;
END;
$$ LANGUAGE plpgsql;

-- Function to find the next available IP in a subnet pool
CREATE OR REPLACE FUNCTION find_next_available_ip(p_pool_id UUID)
RETURNS INET AS $$
DECLARE
    pool_rec RECORD;
    candidate_ip INET;
BEGIN
    -- Get pool info
    SELECT alloc_start, alloc_end, network_id INTO pool_rec
    FROM subnet_pools WHERE id = p_pool_id;
    
    IF pool_rec IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Find first available IP by checking against allocated IPs
    SELECT pool_rec.alloc_start + s.i INTO candidate_ip
    FROM generate_series(0, (pool_rec.alloc_end - pool_rec.alloc_start)::INTEGER) AS s(i)
    WHERE NOT EXISTS (
        SELECT 1 FROM ip_allocations 
        WHERE network_id = pool_rec.network_id 
        AND ip_address = pool_rec.alloc_start + s.i
    )
    ORDER BY s.i
    LIMIT 1;
    
    RETURN candidate_ip;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE subnet_pools IS 'Subnet configuration and allocation statistics for QuantumNet IPAM';
COMMENT ON TABLE ip_allocations IS 'Individual IP address allocations within subnet pools';
COMMENT ON TABLE mac_registry IS 'MAC address registry to prevent duplicates cluster-wide';
COMMENT ON TABLE dhcp_static_bindings IS 'Static DHCP bindings that override dynamic allocation';

COMMENT ON COLUMN ip_allocations.allocation_type IS 'Type of allocation: gateway, broadcast, reserved, static, or dynamic';
COMMENT ON COLUMN ip_allocations.expires_at IS 'DHCP lease expiration time (NULL for static/reserved)';
COMMENT ON COLUMN subnet_pools.dhcp_options_uuid IS 'OVN DHCP options UUID for this subnet';
