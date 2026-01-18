-- Migration: Add VM and Storage Pool state reconciliation fields
-- Purpose: Support for automatic state sync between Node Daemon and Control Plane
-- Related: State Reconciliation System (agent-push model with eventual consistency)

-- =============================================================================
-- Virtual Machines State Reconciliation
-- =============================================================================

-- Add origin field to track where VMs came from
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'control-plane';

-- Add is_managed flag to indicate if QvDC controls the VM's lifecycle
-- false = discovered VM that user hasn't "adopted" yet
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS is_managed BOOLEAN DEFAULT true;

-- Add last_seen timestamp to track when VM was last reported by agent
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE;

-- Add lost_reason to explain why VM is in LOST state
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Add lost_at timestamp to track when VM was marked as LOST
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS lost_at TIMESTAMP WITH TIME ZONE;

-- Add index for filtering by origin (used in UI to show discovered vs managed VMs)
CREATE INDEX IF NOT EXISTS idx_vms_origin ON virtual_machines(origin);

-- Add index for filtering unmanaged VMs (for adoption workflow)
CREATE INDEX IF NOT EXISTS idx_vms_is_managed ON virtual_machines(is_managed) WHERE is_managed = false;

-- Add index for finding stale/lost VMs (for cleanup and alerting)
CREATE INDEX IF NOT EXISTS idx_vms_last_seen ON virtual_machines(last_seen) WHERE last_seen IS NOT NULL;

COMMENT ON COLUMN virtual_machines.origin IS 'Where the VM came from: control-plane, host-discovered, imported';
COMMENT ON COLUMN virtual_machines.is_managed IS 'Whether QvDC controls this VM lifecycle (false for discovered VMs)';
COMMENT ON COLUMN virtual_machines.last_seen IS 'Last time this VM was reported by the Node Daemon';
COMMENT ON COLUMN virtual_machines.lost_reason IS 'Reason why VM is in LOST state (e.g., deleted outside control plane)';
COMMENT ON COLUMN virtual_machines.lost_at IS 'When the VM was marked as LOST';

-- =============================================================================
-- Storage Pools State Reconciliation
-- =============================================================================

-- Add origin field to track where storage pools came from
ALTER TABLE storage_pools ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'control-plane';

-- Add is_managed flag to indicate if QvDC controls the pool's lifecycle
-- false = discovered pool that user hasn't "adopted" yet
ALTER TABLE storage_pools ADD COLUMN IF NOT EXISTS is_managed BOOLEAN DEFAULT true;

-- Add index for filtering by origin (used in UI to show discovered vs managed pools)
CREATE INDEX IF NOT EXISTS idx_pools_origin ON storage_pools(origin);

-- Add index for filtering unmanaged pools (for adoption workflow)
CREATE INDEX IF NOT EXISTS idx_pools_is_managed ON storage_pools(is_managed) WHERE is_managed = false;

COMMENT ON COLUMN storage_pools.origin IS 'Where the pool came from: control-plane, host-discovered, imported';
COMMENT ON COLUMN storage_pools.is_managed IS 'Whether QvDC controls this pool lifecycle (false for discovered pools)';
