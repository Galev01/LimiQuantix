-- Rollback: 000002_admin_tables
-- Description: Removes admin panel tables

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS global_rules;
DROP TABLE IF EXISTS admin_emails;
DROP TABLE IF EXISTS organizations;
DROP TABLE IF EXISTS sso_configs;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS roles;

-- Remove added column from audit_log
ALTER TABLE audit_log DROP COLUMN IF EXISTS status;

-- Drop indexes that might have been created
DROP INDEX IF EXISTS idx_audit_status;
