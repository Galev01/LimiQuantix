// Package network provides Live Migration handling for network ports.
// This ensures seamless network connectivity during VM live migration.
package network

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// =============================================================================
// MIGRATION HANDLER
// =============================================================================

// MigrationHandler manages network port transitions during VM live migration.
// It coordinates port binding updates between source and destination hosts.
type MigrationHandler struct {
	logger *zap.Logger
	mu     sync.RWMutex

	// Dependencies
	portService      PortServiceInterface
	floatingIPSvc    *FloatingIPService
	dnsService       *DNSService
	dhcpManager      *DHCPManager

	// In-flight migrations
	migrations map[string]*MigrationContext // vmID -> context

	// Configuration
	config MigrationConfig
}

// PortServiceInterface defines the port service interface for migration.
type PortServiceInterface interface {
	GetPort(ctx context.Context, id string) (*domain.Port, error)
	UpdatePort(ctx context.Context, id string, updates map[string]interface{}) (*domain.Port, error)
	BindPort(ctx context.Context, portID, vmID, hostID string) error
	UnbindPort(ctx context.Context, portID string) error
}

// MigrationConfig holds migration handler configuration.
type MigrationConfig struct {
	// PortUnbindTimeout is how long to wait for port unbind on source
	PortUnbindTimeout time.Duration

	// PortBindTimeout is how long to wait for port bind on destination
	PortBindTimeout time.Duration

	// ARPGratuitousCount is how many gratuitous ARP packets to send
	ARPGratuitousCount int

	// PreMigrationQuiesceTime is time to wait before migration starts
	PreMigrationQuiesceTime time.Duration

	// EnableFloatingIPMigration enables automatic floating IP migration
	EnableFloatingIPMigration bool

	// EnableDNSUpdate enables automatic DNS record updates
	EnableDNSUpdate bool
}

// DefaultMigrationConfig returns sensible defaults.
func DefaultMigrationConfig() MigrationConfig {
	return MigrationConfig{
		PortUnbindTimeout:         30 * time.Second,
		PortBindTimeout:           60 * time.Second,
		ARPGratuitousCount:        3,
		PreMigrationQuiesceTime:   1 * time.Second,
		EnableFloatingIPMigration: true,
		EnableDNSUpdate:           true,
	}
}

// MigrationContext holds the context for an in-flight migration.
type MigrationContext struct {
	VMID              string
	SourceHost        string
	DestinationHost   string
	Ports             []*PortMigrationState
	FloatingIPs       []string
	Phase             MigrationPhase
	StartedAt         time.Time
	CompletedAt       *time.Time
	Error             error
	RollbackRequired  bool
}

// PortMigrationState tracks port state during migration.
type PortMigrationState struct {
	PortID          string
	NetworkID       string
	MACAddress      string
	IPAddresses     []string
	OldOVNPortUUID  string
	NewOVNPortUUID  string
	SourceBound     bool
	DestinationBound bool
	Status          string
}

// MigrationPhase represents the current phase of migration.
type MigrationPhase string

const (
	MigrationPhaseInit          MigrationPhase = "INIT"
	MigrationPhasePreMigration  MigrationPhase = "PRE_MIGRATION"
	MigrationPhasePortSetup     MigrationPhase = "PORT_SETUP"
	MigrationPhaseMigrating     MigrationPhase = "MIGRATING"
	MigrationPhasePortSwitchover MigrationPhase = "PORT_SWITCHOVER"
	MigrationPhasePostMigration MigrationPhase = "POST_MIGRATION"
	MigrationPhaseCompleted     MigrationPhase = "COMPLETED"
	MigrationPhaseFailed        MigrationPhase = "FAILED"
	MigrationPhaseRolledBack    MigrationPhase = "ROLLED_BACK"
)

// NewMigrationHandler creates a new migration handler.
func NewMigrationHandler(
	config MigrationConfig,
	portService PortServiceInterface,
	floatingIPSvc *FloatingIPService,
	dnsService *DNSService,
	dhcpManager *DHCPManager,
	logger *zap.Logger,
) *MigrationHandler {
	return &MigrationHandler{
		logger:        logger.Named("migration-handler"),
		config:        config,
		portService:   portService,
		floatingIPSvc: floatingIPSvc,
		dnsService:    dnsService,
		dhcpManager:   dhcpManager,
		migrations:    make(map[string]*MigrationContext),
	}
}

// =============================================================================
// MIGRATION LIFECYCLE
// =============================================================================

// PrepareMigration prepares network ports for VM live migration.
// This should be called before the actual VM migration starts.
func (h *MigrationHandler) PrepareMigration(ctx context.Context, req *PrepareMigrationRequest) (*MigrationContext, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.logger.Info("Preparing migration",
		zap.String("vm_id", req.VMID),
		zap.String("source_host", req.SourceHost),
		zap.String("dest_host", req.DestinationHost),
		zap.Int("port_count", len(req.PortIDs)),
	)

	// Check if migration already in progress
	if existing, ok := h.migrations[req.VMID]; ok {
		if existing.Phase != MigrationPhaseCompleted && existing.Phase != MigrationPhaseFailed {
			return nil, fmt.Errorf("migration already in progress for VM %s", req.VMID)
		}
	}

	// Create migration context
	migCtx := &MigrationContext{
		VMID:            req.VMID,
		SourceHost:      req.SourceHost,
		DestinationHost: req.DestinationHost,
		Ports:           make([]*PortMigrationState, 0),
		Phase:           MigrationPhaseInit,
		StartedAt:       time.Now(),
	}

	// Get port information
	for _, portID := range req.PortIDs {
		port, err := h.portService.GetPort(ctx, portID)
		if err != nil {
			return nil, fmt.Errorf("failed to get port %s: %w", portID, err)
		}

		ipAddrs := make([]string, 0)
		for _, fip := range port.Spec.FixedIPs {
			ipAddrs = append(ipAddrs, fip.IPAddress)
		}

		migCtx.Ports = append(migCtx.Ports, &PortMigrationState{
			PortID:      portID,
			NetworkID:   port.Spec.NetworkID,
			MACAddress:  port.Spec.MACAddress,
			IPAddresses: ipAddrs,
			SourceBound: true,
			Status:      "PREPARING",
		})
	}

	// Get associated floating IPs
	if h.config.EnableFloatingIPMigration && h.floatingIPSvc != nil {
		migCtx.FloatingIPs = h.floatingIPSvc.GetFloatingIPsByVM(req.VMID)
	}

	h.migrations[req.VMID] = migCtx

	// Phase 1: Pre-migration setup
	migCtx.Phase = MigrationPhasePreMigration

	// Setup destination ports on OVN
	err := h.setupDestinationPorts(ctx, migCtx)
	if err != nil {
		migCtx.Phase = MigrationPhaseFailed
		migCtx.Error = err
		return migCtx, fmt.Errorf("failed to setup destination ports: %w", err)
	}

	migCtx.Phase = MigrationPhasePortSetup

	h.logger.Info("Migration prepared",
		zap.String("vm_id", req.VMID),
		zap.String("phase", string(migCtx.Phase)),
	)

	return migCtx, nil
}

// PrepareMigrationRequest is the request for preparing migration.
type PrepareMigrationRequest struct {
	VMID            string
	SourceHost      string
	DestinationHost string
	PortIDs         []string
}

// NotifyMigrationStarted notifies that VM migration has started.
func (h *MigrationHandler) NotifyMigrationStarted(ctx context.Context, vmID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	migCtx, ok := h.migrations[vmID]
	if !ok {
		return fmt.Errorf("no migration context for VM %s", vmID)
	}

	h.logger.Info("Migration started", zap.String("vm_id", vmID))

	migCtx.Phase = MigrationPhaseMigrating
	return nil
}

// CompleteMigration finalizes network setup after VM migration completes.
func (h *MigrationHandler) CompleteMigration(ctx context.Context, vmID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	migCtx, ok := h.migrations[vmID]
	if !ok {
		return fmt.Errorf("no migration context for VM %s", vmID)
	}

	h.logger.Info("Completing migration",
		zap.String("vm_id", vmID),
		zap.String("dest_host", migCtx.DestinationHost),
	)

	migCtx.Phase = MigrationPhasePortSwitchover

	// Switch over ports to destination
	for _, portState := range migCtx.Ports {
		err := h.switchoverPort(ctx, migCtx, portState)
		if err != nil {
			h.logger.Error("Failed to switchover port",
				zap.String("port_id", portState.PortID),
				zap.Error(err),
			)
			// Continue with other ports, but mark as needing attention
			portState.Status = "SWITCHOVER_FAILED"
		} else {
			portState.Status = "COMPLETED"
		}
	}

	// Update floating IPs
	if h.config.EnableFloatingIPMigration && h.floatingIPSvc != nil {
		for _, fip := range migCtx.FloatingIPs {
			for _, portState := range migCtx.Ports {
				if len(portState.IPAddresses) > 0 {
					err := h.floatingIPSvc.MigrateFloatingIP(ctx, fip, portState.PortID, portState.PortID, portState.IPAddresses[0])
					if err != nil {
						h.logger.Warn("Failed to migrate floating IP",
							zap.String("floating_ip", fip),
							zap.Error(err),
						)
					}
				}
			}
		}
	}

	// Update DNS if enabled
	if h.config.EnableDNSUpdate && h.dnsService != nil {
		// DNS records are typically IP-based, so no update needed unless IP changed
		h.logger.Debug("DNS records maintained", zap.String("vm_id", vmID))
	}

	// Post-migration cleanup
	migCtx.Phase = MigrationPhasePostMigration

	err := h.cleanupSourcePorts(ctx, migCtx)
	if err != nil {
		h.logger.Warn("Failed to cleanup source ports",
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		// Non-fatal, continue
	}

	// Mark completed
	now := time.Now()
	migCtx.Phase = MigrationPhaseCompleted
	migCtx.CompletedAt = &now

	h.logger.Info("Migration completed",
		zap.String("vm_id", vmID),
		zap.Duration("duration", now.Sub(migCtx.StartedAt)),
	)

	return nil
}

// AbortMigration aborts a migration and rolls back network changes.
func (h *MigrationHandler) AbortMigration(ctx context.Context, vmID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	migCtx, ok := h.migrations[vmID]
	if !ok {
		return fmt.Errorf("no migration context for VM %s", vmID)
	}

	h.logger.Info("Aborting migration", zap.String("vm_id", vmID))

	// Rollback destination port setup
	for _, portState := range migCtx.Ports {
		if portState.DestinationBound {
			// Remove destination binding
			err := h.rollbackDestinationPort(ctx, portState)
			if err != nil {
				h.logger.Warn("Failed to rollback destination port",
					zap.String("port_id", portState.PortID),
					zap.Error(err),
				)
			}
		}
		portState.Status = "ROLLED_BACK"
	}

	migCtx.Phase = MigrationPhaseRolledBack
	migCtx.RollbackRequired = false

	h.logger.Info("Migration aborted", zap.String("vm_id", vmID))
	return nil
}

// =============================================================================
// PORT OPERATIONS
// =============================================================================

// setupDestinationPorts prepares OVN ports on the destination host.
func (h *MigrationHandler) setupDestinationPorts(ctx context.Context, migCtx *MigrationContext) error {
	h.logger.Debug("Setting up destination ports",
		zap.String("vm_id", migCtx.VMID),
		zap.String("dest_host", migCtx.DestinationHost),
	)

	for _, portState := range migCtx.Ports {
		// In OVN, we update the port's requested-chassis option
		// This tells OVN to expect the port on the new chassis
		// The actual binding happens when the VM starts on the destination

		// Update port with new chassis hint
		updates := map[string]interface{}{
			"options.requested-chassis": migCtx.DestinationHost,
			"external_ids.migration-in-progress": "true",
			"external_ids.source-host": migCtx.SourceHost,
		}

		_, err := h.portService.UpdatePort(ctx, portState.PortID, updates)
		if err != nil {
			return fmt.Errorf("failed to update port %s: %w", portState.PortID, err)
		}

		portState.Status = "DESTINATION_PREPARED"
	}

	return nil
}

// switchoverPort switches a port from source to destination.
func (h *MigrationHandler) switchoverPort(ctx context.Context, migCtx *MigrationContext, portState *PortMigrationState) error {
	h.logger.Debug("Switching over port",
		zap.String("port_id", portState.PortID),
		zap.String("from", migCtx.SourceHost),
		zap.String("to", migCtx.DestinationHost),
	)

	// Bind port to new host in OVN
	err := h.portService.BindPort(ctx, portState.PortID, migCtx.VMID, migCtx.DestinationHost)
	if err != nil {
		return fmt.Errorf("failed to bind port: %w", err)
	}

	portState.DestinationBound = true
	portState.SourceBound = false

	// Clear migration flags
	updates := map[string]interface{}{
		"external_ids.migration-in-progress": nil,
		"external_ids.source-host": nil,
	}

	_, err = h.portService.UpdatePort(ctx, portState.PortID, updates)
	if err != nil {
		h.logger.Warn("Failed to clear migration flags",
			zap.String("port_id", portState.PortID),
			zap.Error(err),
		)
		// Non-fatal
	}

	// Trigger gratuitous ARP to update network neighbors
	// This is handled by the node daemon on the destination host
	h.logger.Debug("Port switchover complete",
		zap.String("port_id", portState.PortID),
	)

	return nil
}

// cleanupSourcePorts cleans up port state on the source host.
func (h *MigrationHandler) cleanupSourcePorts(ctx context.Context, migCtx *MigrationContext) error {
	h.logger.Debug("Cleaning up source ports",
		zap.String("vm_id", migCtx.VMID),
		zap.String("source_host", migCtx.SourceHost),
	)

	// Source cleanup is typically automatic in OVN
	// The old chassis will detect the port is no longer local

	return nil
}

// rollbackDestinationPort reverts destination port setup.
func (h *MigrationHandler) rollbackDestinationPort(ctx context.Context, portState *PortMigrationState) error {
	h.logger.Debug("Rolling back destination port", zap.String("port_id", portState.PortID))

	// Clear the requested-chassis hint
	updates := map[string]interface{}{
		"options.requested-chassis": nil,
		"external_ids.migration-in-progress": nil,
		"external_ids.source-host": nil,
	}

	_, err := h.portService.UpdatePort(ctx, portState.PortID, updates)
	return err
}

// =============================================================================
// QUERIES
// =============================================================================

// GetMigrationStatus returns the status of an in-flight migration.
func (h *MigrationHandler) GetMigrationStatus(vmID string) *MigrationContext {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.migrations[vmID]
}

// ListActiveMigrations returns all active migrations.
func (h *MigrationHandler) ListActiveMigrations() []*MigrationContext {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var active []*MigrationContext
	for _, ctx := range h.migrations {
		if ctx.Phase != MigrationPhaseCompleted && ctx.Phase != MigrationPhaseFailed && ctx.Phase != MigrationPhaseRolledBack {
			active = append(active, ctx)
		}
	}
	return active
}

// CleanupCompletedMigrations removes completed migration contexts older than duration.
func (h *MigrationHandler) CleanupCompletedMigrations(olderThan time.Duration) int {
	h.mu.Lock()
	defer h.mu.Unlock()

	cutoff := time.Now().Add(-olderThan)
	cleaned := 0

	for vmID, ctx := range h.migrations {
		if ctx.Phase == MigrationPhaseCompleted || ctx.Phase == MigrationPhaseFailed || ctx.Phase == MigrationPhaseRolledBack {
			if ctx.CompletedAt != nil && ctx.CompletedAt.Before(cutoff) {
				delete(h.migrations, vmID)
				cleaned++
			}
		}
	}

	return cleaned
}

// =============================================================================
// GRATUITOUS ARP
// =============================================================================

// GratuitousARPRequest represents a request to send gratuitous ARP.
type GratuitousARPRequest struct {
	HostID      string
	Interface   string
	MACAddress  string
	IPAddresses []string
	Count       int
}

// BuildGratuitousARPRequest builds a gratuitous ARP request for post-migration.
func (h *MigrationHandler) BuildGratuitousARPRequest(migCtx *MigrationContext, portState *PortMigrationState) *GratuitousARPRequest {
	return &GratuitousARPRequest{
		HostID:      migCtx.DestinationHost,
		Interface:   fmt.Sprintf("veth-%s", portState.PortID[:8]),
		MACAddress:  portState.MACAddress,
		IPAddresses: portState.IPAddresses,
		Count:       h.config.ARPGratuitousCount,
	}
}
