// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/vm"
)

// Ensure VMRepository implements vm.Repository
var _ vm.Repository = (*VMRepository)(nil)

// VMRepository implements vm.Repository using PostgreSQL.
type VMRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewVMRepository creates a new PostgreSQL VM repository.
func NewVMRepository(db *DB, logger *zap.Logger) *VMRepository {
	return &VMRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "vm")),
	}
}

// Create stores a new virtual machine.
func (r *VMRepository) Create(ctx context.Context, vmObj *domain.VirtualMachine) (*domain.VirtualMachine, error) {
	if vmObj.ID == "" {
		vmObj.ID = uuid.New().String()
	}

	specJSON, err := json.Marshal(vmObj.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(vmObj.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	resourcesJSON, err := json.Marshal(vmObj.Status.Resources)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal resources: %w", err)
	}

	ipAddressesJSON, err := json.Marshal(vmObj.Status.IPAddresses)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal ip_addresses: %w", err)
	}

	query := `
		INSERT INTO virtual_machines (
			id, name, project_id, description, labels, hardware_version, spec,
			power_state, node_id, ip_addresses, resources, status_message, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		vmObj.ID,
		vmObj.Name,
		vmObj.ProjectID,
		vmObj.Description,
		labelsJSON,
		vmObj.HardwareVersion,
		specJSON,
		string(vmObj.Status.State),
		nullString(vmObj.Status.NodeID),
		ipAddressesJSON,
		resourcesJSON,
		vmObj.Status.Message,
		vmObj.CreatedBy,
	).Scan(&vmObj.CreatedAt, &vmObj.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create VM", zap.Error(err), zap.String("name", vmObj.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert VM: %w", err)
	}

	r.logger.Info("Created VM", zap.String("id", vmObj.ID), zap.String("name", vmObj.Name))
	return vmObj, nil
}

// Get retrieves a virtual machine by ID.
func (r *VMRepository) Get(ctx context.Context, id string) (*domain.VirtualMachine, error) {
	query := `
		SELECT id, name, project_id, description, labels, hardware_version, spec,
		       power_state, node_id, ip_addresses, resources, status_message,
		       created_at, updated_at, created_by
		FROM virtual_machines
		WHERE id = $1
	`

	vmObj := &domain.VirtualMachine{}
	var labelsJSON, specJSON, ipAddressesJSON, resourcesJSON []byte
	var nodeID *string
	var powerState string

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&vmObj.ID,
		&vmObj.Name,
		&vmObj.ProjectID,
		&vmObj.Description,
		&labelsJSON,
		&vmObj.HardwareVersion,
		&specJSON,
		&powerState,
		&nodeID,
		&ipAddressesJSON,
		&resourcesJSON,
		&vmObj.Status.Message,
		&vmObj.CreatedAt,
		&vmObj.UpdatedAt,
		&vmObj.CreatedBy,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get VM: %w", err)
	}

	// Unmarshal JSON fields
	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &vmObj.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err))
		}
	}
	if len(specJSON) > 0 {
		if err := json.Unmarshal(specJSON, &vmObj.Spec); err != nil {
			r.logger.Warn("Failed to unmarshal spec", zap.Error(err))
		}
	}
	if len(ipAddressesJSON) > 0 {
		if err := json.Unmarshal(ipAddressesJSON, &vmObj.Status.IPAddresses); err != nil {
			r.logger.Warn("Failed to unmarshal ip_addresses", zap.Error(err))
		}
	}
	if len(resourcesJSON) > 0 {
		if err := json.Unmarshal(resourcesJSON, &vmObj.Status.Resources); err != nil {
			r.logger.Warn("Failed to unmarshal resources", zap.Error(err))
		}
	}

	vmObj.Status.State = domain.VMState(powerState)
	if nodeID != nil {
		vmObj.Status.NodeID = *nodeID
	}

	return vmObj, nil
}

// List returns a paginated list of virtual machines matching the filter.
func (r *VMRepository) List(ctx context.Context, filter vm.VMFilter, limit int, cursor string) ([]*domain.VirtualMachine, int64, error) {
	// Build dynamic query
	query := `
		SELECT id, name, project_id, description, labels, hardware_version, spec,
		       power_state, node_id, ip_addresses, resources, status_message,
		       created_at, updated_at, created_by
		FROM virtual_machines
		WHERE 1=1
	`
	countQuery := `SELECT COUNT(*) FROM virtual_machines WHERE 1=1`
	args := []interface{}{}
	countArgs := []interface{}{}
	argNum := 1

	// Project filter
	if filter.ProjectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argNum)
		countQuery += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, filter.ProjectID)
		countArgs = append(countArgs, filter.ProjectID)
		argNum++
	}

	// Node filter
	if filter.NodeID != "" {
		query += fmt.Sprintf(" AND node_id = $%d", argNum)
		countQuery += fmt.Sprintf(" AND node_id = $%d", argNum)
		args = append(args, filter.NodeID)
		countArgs = append(countArgs, filter.NodeID)
		argNum++
	}

	// State filter
	if len(filter.States) > 0 {
		query += fmt.Sprintf(" AND power_state = ANY($%d)", argNum)
		countQuery += fmt.Sprintf(" AND power_state = ANY($%d)", argNum)
		states := make([]string, len(filter.States))
		for i, s := range filter.States {
			states[i] = string(s)
		}
		args = append(args, states)
		countArgs = append(countArgs, states)
		argNum++
	}

	// Name contains filter
	if filter.NameContains != "" {
		query += fmt.Sprintf(" AND name ILIKE $%d", argNum)
		countQuery += fmt.Sprintf(" AND name ILIKE $%d", argNum)
		args = append(args, "%"+filter.NameContains+"%")
		countArgs = append(countArgs, "%"+filter.NameContains+"%")
		argNum++
	}

	// Cursor-based pagination
	if cursor != "" {
		query += fmt.Sprintf(" AND id > $%d", argNum)
		args = append(args, cursor)
		argNum++
	}

	// Order and limit
	query += " ORDER BY created_at DESC, id"
	query += fmt.Sprintf(" LIMIT $%d", argNum)
	args = append(args, limit)

	// Execute main query
	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list VMs: %w", err)
	}
	defer rows.Close()

	var vms []*domain.VirtualMachine
	for rows.Next() {
		vmObj := &domain.VirtualMachine{}
		var labelsJSON, specJSON, ipAddressesJSON, resourcesJSON []byte
		var nodeID *string
		var powerState string

		err := rows.Scan(
			&vmObj.ID,
			&vmObj.Name,
			&vmObj.ProjectID,
			&vmObj.Description,
			&labelsJSON,
			&vmObj.HardwareVersion,
			&specJSON,
			&powerState,
			&nodeID,
			&ipAddressesJSON,
			&resourcesJSON,
			&vmObj.Status.Message,
			&vmObj.CreatedAt,
			&vmObj.UpdatedAt,
			&vmObj.CreatedBy,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan VM: %w", err)
		}

		// Unmarshal JSON fields
		if len(labelsJSON) > 0 {
			json.Unmarshal(labelsJSON, &vmObj.Labels)
		}
		if len(specJSON) > 0 {
			json.Unmarshal(specJSON, &vmObj.Spec)
		}
		if len(ipAddressesJSON) > 0 {
			json.Unmarshal(ipAddressesJSON, &vmObj.Status.IPAddresses)
		}
		if len(resourcesJSON) > 0 {
			json.Unmarshal(resourcesJSON, &vmObj.Status.Resources)
		}

		vmObj.Status.State = domain.VMState(powerState)
		if nodeID != nil {
			vmObj.Status.NodeID = *nodeID
		}

		vms = append(vms, vmObj)
	}

	// Get total count
	var total int64
	err = r.db.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)
	if err != nil {
		r.logger.Warn("Failed to get count", zap.Error(err))
	}

	return vms, total, nil
}

// Update updates an existing virtual machine.
func (r *VMRepository) Update(ctx context.Context, vmObj *domain.VirtualMachine) (*domain.VirtualMachine, error) {
	specJSON, err := json.Marshal(vmObj.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(vmObj.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		UPDATE virtual_machines
		SET name = $2, description = $3, labels = $4, hardware_version = $5, spec = $6
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		vmObj.ID,
		vmObj.Name,
		vmObj.Description,
		labelsJSON,
		vmObj.HardwareVersion,
		specJSON,
	).Scan(&vmObj.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update VM: %w", err)
	}

	r.logger.Info("Updated VM", zap.String("id", vmObj.ID))
	return vmObj, nil
}

// UpdateStatus updates only the status fields of a VM.
func (r *VMRepository) UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error {
	ipAddressesJSON, err := json.Marshal(status.IPAddresses)
	if err != nil {
		return fmt.Errorf("failed to marshal ip_addresses: %w", err)
	}

	resourcesJSON, err := json.Marshal(status.Resources)
	if err != nil {
		return fmt.Errorf("failed to marshal resources: %w", err)
	}

	query := `
		UPDATE virtual_machines
		SET power_state = $2, node_id = $3, ip_addresses = $4, resources = $5, status_message = $6
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		id,
		string(status.State),
		nullString(status.NodeID),
		ipAddressesJSON,
		resourcesJSON,
		status.Message,
	)

	if err != nil {
		return fmt.Errorf("failed to update VM status: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}

// Delete removes a virtual machine by ID.
func (r *VMRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM virtual_machines WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete VM: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted VM", zap.String("id", id))
	return nil
}

// ListByNode returns all VMs running on a specific node.
func (r *VMRepository) ListByNode(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error) {
	filter := vm.VMFilter{NodeID: nodeID}
	vms, _, err := r.List(ctx, filter, 1000, "")
	return vms, err
}

// ListByNodeID is an alias for ListByNode (for scheduler interface compatibility).
func (r *VMRepository) ListByNodeID(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error) {
	return r.ListByNode(ctx, nodeID)
}

// CountByNodeID returns the number of VMs on a specific node.
func (r *VMRepository) CountByNodeID(ctx context.Context, nodeID string) (int, error) {
	query := `SELECT COUNT(*) FROM virtual_machines WHERE node_id = $1`
	var count int
	err := r.db.pool.QueryRow(ctx, query, nodeID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count VMs: %w", err)
	}
	return count, nil
}

// CountByProject returns the number of VMs in a project.
func (r *VMRepository) CountByProject(ctx context.Context, projectID string) (int64, error) {
	query := `SELECT COUNT(*) FROM virtual_machines WHERE project_id = $1`
	var count int64
	err := r.db.pool.QueryRow(ctx, query, projectID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count VMs: %w", err)
	}
	return count, nil
}

// SeedDemoData is a no-op for PostgreSQL (use migrations instead).
func (r *VMRepository) SeedDemoData() {
	// Demo data is handled via migrations for PostgreSQL
	r.logger.Debug("SeedDemoData called on PostgreSQL repository (no-op)")
}

// =============================================================================
// Helper functions
// =============================================================================

// nullString returns a pointer to a string, or nil if empty.
func nullString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// nullTime returns a pointer to time, or nil if zero.
func nullTime(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// isUniqueViolation checks if the error is a unique constraint violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	// pgx returns error codes in the format "23505" for unique violation
	return containsString(err.Error(), "23505") || containsString(err.Error(), "unique constraint")
}

func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
