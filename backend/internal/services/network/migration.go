// Package network provides live migration port binding management.
// This handles atomic OVN port binding transfer during VM live migration
// to prevent network blackholes.
package network

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"go.uber.org/zap"
)

// =============================================================================
// LIVE MIGRATION PORT BINDING SERVICE
// =============================================================================

// MigrationPortBindingService handles OVN port binding during live migration.
// Key principle: The destination node should not claim the port until the VM
// is ready to receive traffic, and the source node should not release until
// the destination is ready.
type MigrationPortBindingService struct {
	logger *zap.Logger
}

// NewMigrationPortBindingService creates a new migration port binding service.
func NewMigrationPortBindingService(logger *zap.Logger) *MigrationPortBindingService {
	return &MigrationPortBindingService{
		logger: logger.Named("migration-port-binding"),
	}
}

// MigrationState tracks the state of a port binding during migration.
type MigrationState struct {
	// Port UUID (OVN logical switch port)
	PortID string
	// VM ID
	VMID string
	// Source chassis (node)
	SourceChassis string
	// Destination chassis (node)
	DestChassis string
	// Current phase
	Phase MigrationPhase
	// Timestamp of last phase change
	LastUpdate time.Time
	// Error message if failed
	ErrorMessage string
}

// MigrationPhase represents phases of port binding migration.
type MigrationPhase string

const (
	// MigrationPhaseInit - Migration initiated
	MigrationPhaseInit MigrationPhase = "init"
	// MigrationPhasePrepareDest - Destination chassis preparing
	MigrationPhasePrepareDest MigrationPhase = "prepare_dest"
	// MigrationPhaseClaimRequested - Destination requesting claim
	MigrationPhaseClaimRequested MigrationPhase = "claim_requested"
	// MigrationPhaseSwitching - Traffic switching in progress
	MigrationPhaseSwitching MigrationPhase = "switching"
	// MigrationPhaseComplete - Migration complete
	MigrationPhaseComplete MigrationPhase = "complete"
	// MigrationPhaseFailed - Migration failed
	MigrationPhaseFailed MigrationPhase = "failed"
	// MigrationPhaseRolledBack - Migration rolled back
	MigrationPhaseRolledBack MigrationPhase = "rolled_back"
)

// =============================================================================
// ATOMIC PORT BINDING TRANSFER
// =============================================================================

// PrepareMigration prepares for a port binding migration.
// This is called before the VM migration begins.
func (s *MigrationPortBindingService) PrepareMigration(ctx context.Context, portID, sourceNode, destNode string) (*MigrationState, error) {
	s.logger.Info("Preparing port binding migration",
		zap.String("port_id", portID),
		zap.String("source", sourceNode),
		zap.String("dest", destNode),
	)

	state := &MigrationState{
		PortID:        portID,
		SourceChassis: sourceNode,
		DestChassis:   destNode,
		Phase:         MigrationPhaseInit,
		LastUpdate:    time.Now(),
	}

	// 1. Verify port exists and is bound to source chassis
	currentChassis, err := s.getPortChassis(ctx, portID)
	if err != nil {
		return nil, fmt.Errorf("failed to get current port chassis: %w", err)
	}

	if currentChassis != sourceNode {
		return nil, fmt.Errorf("port %s is bound to %s, not source %s", portID, currentChassis, sourceNode)
	}

	// 2. Set up destination chassis as backup binding (OVN 21.03+)
	// This creates a "shadow" binding that will take over
	if err := s.prepareDestinationBinding(ctx, portID, destNode); err != nil {
		s.logger.Warn("Failed to prepare destination binding",
			zap.Error(err),
			zap.String("port_id", portID),
		)
		// Continue - we'll do full switchover
	}

	state.Phase = MigrationPhasePrepareDest
	state.LastUpdate = time.Now()

	return state, nil
}

// RequestPortClaim requests the destination chassis to claim the port.
// This should be called when the VM is almost ready on the destination.
func (s *MigrationPortBindingService) RequestPortClaim(ctx context.Context, state *MigrationState) error {
	s.logger.Info("Requesting port claim for migration",
		zap.String("port_id", state.PortID),
		zap.String("dest", state.DestChassis),
	)

	state.Phase = MigrationPhaseClaimRequested
	state.LastUpdate = time.Now()

	// Set the requested-chassis option to signal claim intent
	// This tells OVN that the destination wants to claim this port
	cmd := exec.CommandContext(ctx, "ovn-nbctl",
		"set", "Logical_Switch_Port", state.PortID,
		fmt.Sprintf("options:requested-chassis=%s", state.DestChassis),
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		s.logger.Error("Failed to set requested-chassis",
			zap.Error(err),
			zap.String("output", string(output)),
		)
		return fmt.Errorf("failed to set requested-chassis: %w", err)
	}

	return nil
}

// SwitchPortBinding atomically switches the port binding to the destination.
// This is the critical moment - traffic will switch to the new location.
func (s *MigrationPortBindingService) SwitchPortBinding(ctx context.Context, state *MigrationState) error {
	s.logger.Info("Switching port binding",
		zap.String("port_id", state.PortID),
		zap.String("from", state.SourceChassis),
		zap.String("to", state.DestChassis),
	)

	state.Phase = MigrationPhaseSwitching
	state.LastUpdate = time.Now()

	// Atomic update: Set chassis binding directly in Southbound DB
	// This is faster than waiting for NB->SB sync
	cmd := exec.CommandContext(ctx, "ovn-sbctl",
		"--", "set", "Port_Binding", state.PortID,
		fmt.Sprintf("chassis=%s", state.DestChassis),
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		s.logger.Error("Failed to switch port binding",
			zap.Error(err),
			zap.String("output", string(output)),
		)

		state.Phase = MigrationPhaseFailed
		state.ErrorMessage = fmt.Sprintf("failed to switch binding: %s", string(output))
		state.LastUpdate = time.Now()

		return fmt.Errorf("failed to switch port binding: %w", err)
	}

	// Verify the switch was successful
	newChassis, err := s.getPortChassis(ctx, state.PortID)
	if err != nil {
		s.logger.Warn("Failed to verify new chassis binding", zap.Error(err))
	} else if newChassis != state.DestChassis {
		s.logger.Error("Port binding switch verification failed",
			zap.String("expected", state.DestChassis),
			zap.String("actual", newChassis),
		)
		return fmt.Errorf("port binding verification failed: expected %s, got %s", state.DestChassis, newChassis)
	}

	state.Phase = MigrationPhaseComplete
	state.LastUpdate = time.Now()

	s.logger.Info("Port binding switch completed",
		zap.String("port_id", state.PortID),
		zap.String("chassis", state.DestChassis),
	)

	return nil
}

// RollbackMigration rolls back a failed migration to the source chassis.
func (s *MigrationPortBindingService) RollbackMigration(ctx context.Context, state *MigrationState) error {
	s.logger.Warn("Rolling back port binding migration",
		zap.String("port_id", state.PortID),
		zap.String("to", state.SourceChassis),
	)

	// Switch back to source chassis
	cmd := exec.CommandContext(ctx, "ovn-sbctl",
		"--", "set", "Port_Binding", state.PortID,
		fmt.Sprintf("chassis=%s", state.SourceChassis),
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		s.logger.Error("Failed to rollback port binding",
			zap.Error(err),
			zap.String("output", string(output)),
		)
		return fmt.Errorf("failed to rollback port binding: %w", err)
	}

	// Clear requested-chassis
	cmd = exec.CommandContext(ctx, "ovn-nbctl",
		"remove", "Logical_Switch_Port", state.PortID,
		"options", "requested-chassis",
	)
	_, _ = cmd.CombinedOutput() // Ignore error if option doesn't exist

	state.Phase = MigrationPhaseRolledBack
	state.LastUpdate = time.Now()

	return nil
}

// CleanupMigration cleans up after a completed migration.
func (s *MigrationPortBindingService) CleanupMigration(ctx context.Context, state *MigrationState) error {
	s.logger.Info("Cleaning up after migration",
		zap.String("port_id", state.PortID),
	)

	// Clear requested-chassis option
	cmd := exec.CommandContext(ctx, "ovn-nbctl",
		"remove", "Logical_Switch_Port", state.PortID,
		"options", "requested-chassis",
	)
	_, _ = cmd.CombinedOutput() // Ignore error if option doesn't exist

	return nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// getPortChassis gets the current chassis binding for a port.
func (s *MigrationPortBindingService) getPortChassis(ctx context.Context, portID string) (string, error) {
	cmd := exec.CommandContext(ctx, "ovn-sbctl",
		"--bare", "--columns=chassis", "find", "Port_Binding",
		fmt.Sprintf("logical_port=%s", portID),
	)

	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to query port binding: %w", err)
	}

	chassis := string(output)
	chassis = strings.TrimSpace(chassis)

	if chassis == "" {
		return "", fmt.Errorf("port %s is not bound to any chassis", portID)
	}

	return chassis, nil
}

// prepareDestinationBinding prepares the destination chassis for binding.
func (s *MigrationPortBindingService) prepareDestinationBinding(ctx context.Context, portID, destChassis string) error {
	// In OVN 21.03+, we can use additional-chassis for gradual migration
	// This creates a secondary binding that can take over quickly
	cmd := exec.CommandContext(ctx, "ovn-nbctl",
		"--", "add", "Logical_Switch_Port", portID,
		"options", fmt.Sprintf("additional-chassis=%s", destChassis),
	)

	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to set additional-chassis: %w (output: %s)", err, string(output))
	}

	return nil
}
