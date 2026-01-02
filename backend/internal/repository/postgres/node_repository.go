// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	"github.com/Quantixkvm/Quantixkvm/internal/services/node"
)

// Ensure NodeRepository implements node.Repository
var _ node.Repository = (*NodeRepository)(nil)

// NodeRepository implements node.Repository using PostgreSQL.
type NodeRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewNodeRepository creates a new PostgreSQL Node repository.
func NewNodeRepository(db *DB, logger *zap.Logger) *NodeRepository {
	return &NodeRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "node")),
	}
}

// Create stores a new node.
func (r *NodeRepository) Create(ctx context.Context, n *domain.Node) (*domain.Node, error) {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}

	specJSON, err := json.Marshal(n.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(n.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	conditionsJSON, err := json.Marshal(n.Status.Conditions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal conditions: %w", err)
	}

	allocatableJSON, err := json.Marshal(n.Status.Allocatable)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal allocatable: %w", err)
	}

	allocatedJSON, err := json.Marshal(n.Status.Allocated)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal allocated: %w", err)
	}

	vmIDsJSON, err := json.Marshal(n.Status.VMIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal vm_ids: %w", err)
	}

	systemInfoJSON, err := json.Marshal(n.Status.SystemInfo)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal system_info: %w", err)
	}

	query := `
		INSERT INTO nodes (
			id, hostname, management_ip, cluster_id, labels, spec,
			phase, conditions, allocatable, allocated, vm_ids, system_info
		) VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		n.ID,
		n.Hostname,
		n.ManagementIP,
		nullString(n.ClusterID),
		labelsJSON,
		specJSON,
		string(n.Status.Phase),
		conditionsJSON,
		allocatableJSON,
		allocatedJSON,
		vmIDsJSON,
		systemInfoJSON,
	).Scan(&n.CreatedAt, &n.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create node", zap.Error(err), zap.String("hostname", n.Hostname))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert node: %w", err)
	}

	r.logger.Info("Created node", zap.String("id", n.ID), zap.String("hostname", n.Hostname))
	return n, nil
}

// Get retrieves a node by ID.
func (r *NodeRepository) Get(ctx context.Context, id string) (*domain.Node, error) {
	query := `
		SELECT id, hostname, management_ip, cluster_id, labels, spec,
		       phase, conditions, allocatable, allocated, vm_ids, system_info,
		       created_at, updated_at, last_heartbeat
		FROM nodes
		WHERE id = $1
	`

	return r.scanNode(ctx, query, id)
}

// GetByHostname retrieves a node by hostname.
func (r *NodeRepository) GetByHostname(ctx context.Context, hostname string) (*domain.Node, error) {
	query := `
		SELECT id, hostname, management_ip, cluster_id, labels, spec,
		       phase, conditions, allocatable, allocated, vm_ids, system_info,
		       created_at, updated_at, last_heartbeat
		FROM nodes
		WHERE hostname = $1
	`

	return r.scanNode(ctx, query, hostname)
}

// scanNode scans a single node from the database.
func (r *NodeRepository) scanNode(ctx context.Context, query string, arg interface{}) (*domain.Node, error) {
	n := &domain.Node{}
	var labelsJSON, specJSON, conditionsJSON, allocatableJSON, allocatedJSON, vmIDsJSON, systemInfoJSON []byte
	var clusterID *string
	var phase string
	var managementIP string

	err := r.db.pool.QueryRow(ctx, query, arg).Scan(
		&n.ID,
		&n.Hostname,
		&managementIP,
		&clusterID,
		&labelsJSON,
		&specJSON,
		&phase,
		&conditionsJSON,
		&allocatableJSON,
		&allocatedJSON,
		&vmIDsJSON,
		&systemInfoJSON,
		&n.CreatedAt,
		&n.UpdatedAt,
		&n.LastHeartbeat,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get node: %w", err)
	}

	n.ManagementIP = managementIP
	if clusterID != nil {
		n.ClusterID = *clusterID
	}
	n.Status.Phase = domain.NodePhase(phase)

	// Unmarshal JSON fields
	if len(labelsJSON) > 0 {
		json.Unmarshal(labelsJSON, &n.Labels)
	}
	if len(specJSON) > 0 {
		json.Unmarshal(specJSON, &n.Spec)
	}
	if len(conditionsJSON) > 0 {
		json.Unmarshal(conditionsJSON, &n.Status.Conditions)
	}
	if len(allocatableJSON) > 0 {
		json.Unmarshal(allocatableJSON, &n.Status.Allocatable)
	}
	if len(allocatedJSON) > 0 {
		json.Unmarshal(allocatedJSON, &n.Status.Allocated)
	}
	if len(vmIDsJSON) > 0 {
		json.Unmarshal(vmIDsJSON, &n.Status.VMIDs)
	}
	if len(systemInfoJSON) > 0 {
		json.Unmarshal(systemInfoJSON, &n.Status.SystemInfo)
	}

	return n, nil
}

// List returns all nodes matching the filter.
func (r *NodeRepository) List(ctx context.Context, filter node.NodeFilter) ([]*domain.Node, error) {
	query := `
		SELECT id, hostname, management_ip, cluster_id, labels, spec,
		       phase, conditions, allocatable, allocated, vm_ids, system_info,
		       created_at, updated_at, last_heartbeat
		FROM nodes
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	// Cluster filter
	if filter.ClusterID != "" {
		query += fmt.Sprintf(" AND cluster_id = $%d", argNum)
		args = append(args, filter.ClusterID)
		argNum++
	}

	// Phase filter
	if len(filter.Phases) > 0 {
		query += fmt.Sprintf(" AND phase = ANY($%d)", argNum)
		phases := make([]string, len(filter.Phases))
		for i, p := range filter.Phases {
			phases[i] = string(p)
		}
		args = append(args, phases)
		argNum++
	}

	// Compute only filter
	if filter.ComputeOnly {
		query += " AND (spec->'role'->>'compute')::boolean = true"
	}

	query += " ORDER BY hostname"

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}
	defer rows.Close()

	var nodes []*domain.Node
	for rows.Next() {
		n := &domain.Node{}
		var labelsJSON, specJSON, conditionsJSON, allocatableJSON, allocatedJSON, vmIDsJSON, systemInfoJSON []byte
		var clusterID *string
		var phase string
		var managementIP string

		err := rows.Scan(
			&n.ID,
			&n.Hostname,
			&managementIP,
			&clusterID,
			&labelsJSON,
			&specJSON,
			&phase,
			&conditionsJSON,
			&allocatableJSON,
			&allocatedJSON,
			&vmIDsJSON,
			&systemInfoJSON,
			&n.CreatedAt,
			&n.UpdatedAt,
			&n.LastHeartbeat,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan node: %w", err)
		}

		n.ManagementIP = managementIP
		if clusterID != nil {
			n.ClusterID = *clusterID
		}
		n.Status.Phase = domain.NodePhase(phase)

		// Unmarshal JSON fields
		if len(labelsJSON) > 0 {
			json.Unmarshal(labelsJSON, &n.Labels)
		}
		if len(specJSON) > 0 {
			json.Unmarshal(specJSON, &n.Spec)
		}
		if len(conditionsJSON) > 0 {
			json.Unmarshal(conditionsJSON, &n.Status.Conditions)
		}
		if len(allocatableJSON) > 0 {
			json.Unmarshal(allocatableJSON, &n.Status.Allocatable)
		}
		if len(allocatedJSON) > 0 {
			json.Unmarshal(allocatedJSON, &n.Status.Allocated)
		}
		if len(vmIDsJSON) > 0 {
			json.Unmarshal(vmIDsJSON, &n.Status.VMIDs)
		}
		if len(systemInfoJSON) > 0 {
			json.Unmarshal(systemInfoJSON, &n.Status.SystemInfo)
		}

		// Apply labels filter in Go (JSONB label queries are complex)
		if len(filter.Labels) > 0 {
			match := true
			for k, v := range filter.Labels {
				if n.Labels[k] != v {
					match = false
					break
				}
			}
			if !match {
				continue
			}
		}

		nodes = append(nodes, n)
	}

	return nodes, nil
}

// ListSchedulable returns nodes that can accept new VMs.
func (r *NodeRepository) ListSchedulable(ctx context.Context) ([]*domain.Node, error) {
	filter := node.NodeFilter{
		Phases:      []domain.NodePhase{domain.NodePhaseReady},
		ComputeOnly: true,
	}
	return r.List(ctx, filter)
}

// Update updates an existing node.
func (r *NodeRepository) Update(ctx context.Context, n *domain.Node) (*domain.Node, error) {
	specJSON, err := json.Marshal(n.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(n.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		UPDATE nodes
		SET hostname = $2, management_ip = $3::inet, cluster_id = $4, labels = $5, spec = $6
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		n.ID,
		n.Hostname,
		n.ManagementIP,
		nullString(n.ClusterID),
		labelsJSON,
		specJSON,
	).Scan(&n.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update node: %w", err)
	}

	r.logger.Info("Updated node", zap.String("id", n.ID))
	return n, nil
}

// UpdateStatus updates only the status fields of a node.
func (r *NodeRepository) UpdateStatus(ctx context.Context, id string, status domain.NodeStatus) error {
	conditionsJSON, err := json.Marshal(status.Conditions)
	if err != nil {
		return fmt.Errorf("failed to marshal conditions: %w", err)
	}

	allocatableJSON, err := json.Marshal(status.Allocatable)
	if err != nil {
		return fmt.Errorf("failed to marshal allocatable: %w", err)
	}

	allocatedJSON, err := json.Marshal(status.Allocated)
	if err != nil {
		return fmt.Errorf("failed to marshal allocated: %w", err)
	}

	vmIDsJSON, err := json.Marshal(status.VMIDs)
	if err != nil {
		return fmt.Errorf("failed to marshal vm_ids: %w", err)
	}

	systemInfoJSON, err := json.Marshal(status.SystemInfo)
	if err != nil {
		return fmt.Errorf("failed to marshal system_info: %w", err)
	}

	query := `
		UPDATE nodes
		SET phase = $2, conditions = $3, allocatable = $4, allocated = $5, vm_ids = $6, system_info = $7
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		id,
		string(status.Phase),
		conditionsJSON,
		allocatableJSON,
		allocatedJSON,
		vmIDsJSON,
		systemInfoJSON,
	)

	if err != nil {
		return fmt.Errorf("failed to update node status: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}

// UpdateHeartbeat updates the last heartbeat time and resources.
func (r *NodeRepository) UpdateHeartbeat(ctx context.Context, id string, resources domain.Resources) error {
	allocatedJSON, err := json.Marshal(resources)
	if err != nil {
		return fmt.Errorf("failed to marshal resources: %w", err)
	}

	query := `
		UPDATE nodes
		SET last_heartbeat = NOW(), allocated = $2
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query, id, allocatedJSON)
	if err != nil {
		return fmt.Errorf("failed to update heartbeat: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	return nil
}

// Delete removes a node by ID.
func (r *NodeRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM nodes WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete node: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted node", zap.String("id", id))
	return nil
}

// ListByCluster returns all nodes in a cluster.
func (r *NodeRepository) ListByCluster(ctx context.Context, clusterID string) ([]*domain.Node, error) {
	filter := node.NodeFilter{ClusterID: clusterID}
	return r.List(ctx, filter)
}

// SeedDemoData is a no-op for PostgreSQL (use migrations instead).
func (r *NodeRepository) SeedDemoData() {
	r.logger.Debug("SeedDemoData called on PostgreSQL repository (no-op)")
}
