-- LimiQuantix Initial Schema - Rollback
-- Migration: 000001_init

-- Drop triggers
DROP TRIGGER IF EXISTS update_images_updated_at ON images;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_security_groups_updated_at ON security_groups;
DROP TRIGGER IF EXISTS update_networks_updated_at ON virtual_networks;
DROP TRIGGER IF EXISTS update_volumes_updated_at ON volumes;
DROP TRIGGER IF EXISTS update_storage_pools_updated_at ON storage_pools;
DROP TRIGGER IF EXISTS update_vms_updated_at ON virtual_machines;
DROP TRIGGER IF EXISTS update_nodes_updated_at ON nodes;
DROP TRIGGER IF EXISTS update_clusters_updated_at ON clusters;
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;

-- Drop function
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop tables in reverse order (respecting foreign keys)
DROP TABLE IF EXISTS images CASCADE;
DROP TABLE IF EXISTS vm_snapshots CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS drs_recommendations CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS vm_security_groups CASCADE;
DROP TABLE IF EXISTS security_rules CASCADE;
DROP TABLE IF EXISTS security_groups CASCADE;
DROP TABLE IF EXISTS virtual_networks CASCADE;
DROP TABLE IF EXISTS volumes CASCADE;
DROP TABLE IF EXISTS storage_pools CASCADE;
DROP TABLE IF EXISTS virtual_machines CASCADE;
DROP TABLE IF EXISTS nodes CASCADE;
DROP TABLE IF EXISTS clusters CASCADE;
DROP TABLE IF EXISTS projects CASCADE;

-- Drop extension
DROP EXTENSION IF EXISTS "uuid-ossp";

