-- VM Events table for tracking VM lifecycle events
-- ============================================================================

CREATE TABLE IF NOT EXISTS vm_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vm_id UUID NOT NULL REFERENCES virtual_machines(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,        -- power, config, snapshot, disk, network, error
    severity VARCHAR(20) NOT NULL,    -- info, warning, error
    message TEXT NOT NULL,
    "user" VARCHAR(255),              -- Who triggered the event (nullable for system events)
    metadata JSONB DEFAULT '{}',      -- Additional event-specific data
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying events by VM
CREATE INDEX IF NOT EXISTS idx_vm_events_vm_id ON vm_events(vm_id);

-- Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_vm_events_type ON vm_events(type);

-- Index for time-based queries (e.g., "events in last 24 hours")
CREATE INDEX IF NOT EXISTS idx_vm_events_created_at ON vm_events(created_at DESC);

-- Compound index for common queries
CREATE INDEX IF NOT EXISTS idx_vm_events_vm_type ON vm_events(vm_id, type, created_at DESC);

-- Comment on table
COMMENT ON TABLE vm_events IS 'Audit log of VM lifecycle events (power changes, config updates, etc.)';
COMMENT ON COLUMN vm_events.type IS 'Event category: power, config, snapshot, disk, network, error';
COMMENT ON COLUMN vm_events.severity IS 'Event severity: info, warning, error';
COMMENT ON COLUMN vm_events.metadata IS 'Additional event-specific data in JSON format';
