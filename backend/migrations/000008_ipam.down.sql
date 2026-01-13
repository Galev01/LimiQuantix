-- Rollback QuantumNet IPAM tables

-- Drop triggers first
DROP TRIGGER IF EXISTS trg_update_pool_allocation_count ON ip_allocations;

-- Drop functions
DROP FUNCTION IF EXISTS update_pool_allocation_count();
DROP FUNCTION IF EXISTS generate_random_mac();
DROP FUNCTION IF EXISTS find_next_available_ip(UUID);

-- Drop tables in dependency order
DROP TABLE IF EXISTS dhcp_static_bindings;
DROP TABLE IF EXISTS ip_allocations;
DROP TABLE IF EXISTS mac_registry;
DROP TABLE IF EXISTS subnet_pools;

-- Drop custom types
DROP TYPE IF EXISTS ip_allocation_type;
