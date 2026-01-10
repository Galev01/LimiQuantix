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
	"github.com/limiquantix/limiquantix/internal/services/storage"
)

// Ensure StoragePoolRepository implements storage.PoolRepository
var _ storage.PoolRepository = (*StoragePoolRepository)(nil)

// StoragePoolRepository implements storage.PoolRepository using PostgreSQL.
type StoragePoolRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewStoragePoolRepository creates a new PostgreSQL storage pool repository.
func NewStoragePoolRepository(db *DB, logger *zap.Logger) *StoragePoolRepository {
	return &StoragePoolRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "storage_pool")),
	}
}

// Create adds a new storage pool.
func (r *StoragePoolRepository) Create(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error) {
	if pool.ID == "" {
		pool.ID = uuid.New().String()
	}

	now := time.Now()
	pool.CreatedAt = now
	pool.UpdatedAt = now

	specJSON, err := json.Marshal(pool.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(pool.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	assignedNodesJSON, err := json.Marshal(pool.Spec.AssignedNodeIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal assigned_node_ids: %w", err)
	}

	// Determine pool type from backend
	poolType := ""
	if pool.Spec.Backend != nil {
		poolType = string(pool.Spec.Backend.Type)
	}

	query := `
		INSERT INTO storage_pools (
			id, name, project_id, description, pool_type, spec, labels, assigned_node_ids,
			phase, capacity_bytes, used_bytes, available_bytes, error_message, volume_count,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		pool.ID,
		pool.Name,
		nullString(pool.ProjectID),
		pool.Description,
		poolType,
		specJSON,
		labelsJSON,
		assignedNodesJSON,
		string(pool.Status.Phase),
		pool.Status.Capacity.TotalBytes,
		pool.Status.Capacity.UsedBytes,
		pool.Status.Capacity.AvailableBytes,
		pool.Status.ErrorMessage,
		pool.Status.VolumeCount,
		pool.CreatedAt,
		pool.UpdatedAt,
	).Scan(&pool.CreatedAt, &pool.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create storage pool", zap.Error(err), zap.String("name", pool.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert storage pool: %w", err)
	}

	r.logger.Info("Created storage pool",
		zap.String("id", pool.ID),
		zap.String("name", pool.Name),
		zap.String("type", poolType),
	)
	return pool, nil
}

// Get retrieves a storage pool by ID.
func (r *StoragePoolRepository) Get(ctx context.Context, id string) (*domain.StoragePool, error) {
	query := `
		SELECT id, name, project_id, description, pool_type, spec, labels, assigned_node_ids,
		       phase, capacity_bytes, used_bytes, available_bytes, error_message, volume_count,
		       created_at, updated_at
		FROM storage_pools
		WHERE id = $1
	`

	pool, err := r.scanPool(ctx, r.db.pool.QueryRow(ctx, query, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get storage pool: %w", err)
	}

	return pool, nil
}

// GetByName retrieves a storage pool by name within a project.
func (r *StoragePoolRepository) GetByName(ctx context.Context, projectID, name string) (*domain.StoragePool, error) {
	query := `
		SELECT id, name, project_id, description, pool_type, spec, labels, assigned_node_ids,
		       phase, capacity_bytes, used_bytes, available_bytes, error_message, volume_count,
		       created_at, updated_at
		FROM storage_pools
		WHERE name = $1 AND (project_id = $2 OR project_id IS NULL)
	`

	pool, err := r.scanPool(ctx, r.db.pool.QueryRow(ctx, query, name, projectID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get storage pool by name: %w", err)
	}

	return pool, nil
}

// List retrieves storage pools based on filter criteria.
func (r *StoragePoolRepository) List(ctx context.Context, filter storage.PoolFilter, limit int, offset int) ([]*domain.StoragePool, int, error) {
	// Build query with filters
	baseQuery := `
		FROM storage_pools
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.ProjectID != "" {
		baseQuery += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, filter.ProjectID)
		argNum++
	}

	if filter.BackendType != "" {
		baseQuery += fmt.Sprintf(" AND pool_type = $%d", argNum)
		args = append(args, string(filter.BackendType))
		argNum++
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*) " + baseQuery
	err := r.db.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count storage pools: %w", err)
	}

	// Get pools
	selectQuery := `
		SELECT id, name, project_id, description, pool_type, spec, labels, assigned_node_ids,
		       phase, capacity_bytes, used_bytes, available_bytes, error_message, volume_count,
		       created_at, updated_at
	` + baseQuery + fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list storage pools: %w", err)
	}
	defer rows.Close()

	var pools []*domain.StoragePool
	for rows.Next() {
		pool, err := r.scanPoolFromRows(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan storage pool: %w", err)
		}
		pools = append(pools, pool)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("error iterating storage pools: %w", err)
	}

	return pools, total, nil
}

// Update modifies an existing storage pool.
func (r *StoragePoolRepository) Update(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error) {
	pool.UpdatedAt = time.Now()

	specJSON, err := json.Marshal(pool.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(pool.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	assignedNodesJSON, err := json.Marshal(pool.Spec.AssignedNodeIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal assigned_node_ids: %w", err)
	}

	poolType := ""
	if pool.Spec.Backend != nil {
		poolType = string(pool.Spec.Backend.Type)
	}

	query := `
		UPDATE storage_pools SET
			name = $2,
			project_id = $3,
			description = $4,
			pool_type = $5,
			spec = $6,
			labels = $7,
			assigned_node_ids = $8,
			phase = $9,
			capacity_bytes = $10,
			used_bytes = $11,
			available_bytes = $12,
			error_message = $13,
			volume_count = $14,
			updated_at = $15
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		pool.ID,
		pool.Name,
		nullString(pool.ProjectID),
		pool.Description,
		poolType,
		specJSON,
		labelsJSON,
		assignedNodesJSON,
		string(pool.Status.Phase),
		pool.Status.Capacity.TotalBytes,
		pool.Status.Capacity.UsedBytes,
		pool.Status.Capacity.AvailableBytes,
		pool.Status.ErrorMessage,
		pool.Status.VolumeCount,
		pool.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update storage pool: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, domain.ErrNotFound
	}

	r.logger.Info("Updated storage pool",
		zap.String("id", pool.ID),
		zap.String("name", pool.Name),
	)
	return pool, nil
}

// Delete removes a storage pool by ID.
func (r *StoragePoolRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM storage_pools WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete storage pool: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted storage pool", zap.String("id", id))
	return nil
}

// UpdateStatus updates the status of a storage pool.
func (r *StoragePoolRepository) UpdateStatus(ctx context.Context, id string, status domain.StoragePoolStatus) error {
	// Serialize host statuses to JSON
	hostStatusesJSON, err := json.Marshal(status.HostStatuses)
	if err != nil {
		return fmt.Errorf("failed to marshal host_statuses: %w", err)
	}

	query := `
		UPDATE storage_pools SET
			phase = $2,
			capacity_bytes = $3,
			used_bytes = $4,
			available_bytes = $5,
			error_message = $6,
			volume_count = $7,
			host_statuses = $8,
			updated_at = NOW()
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		id,
		string(status.Phase),
		status.Capacity.TotalBytes,
		status.Capacity.UsedBytes,
		status.Capacity.AvailableBytes,
		status.ErrorMessage,
		status.VolumeCount,
		hostStatusesJSON,
	)

	if err != nil {
		return fmt.Errorf("failed to update storage pool status: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Debug("Updated storage pool status",
		zap.String("id", id),
		zap.String("phase", string(status.Phase)),
	)
	return nil
}

// ListAssignedToNode retrieves all storage pools assigned to a specific node.
func (r *StoragePoolRepository) ListAssignedToNode(ctx context.Context, nodeID string) ([]*domain.StoragePool, error) {
	query := `
		SELECT id, name, project_id, description, pool_type, spec, labels, assigned_node_ids,
		       phase, capacity_bytes, used_bytes, available_bytes, error_message, volume_count,
		       created_at, updated_at
		FROM storage_pools
		WHERE assigned_node_ids @> $1::jsonb
	`

	// PostgreSQL jsonb contains operator @> requires the search value in jsonb format
	nodeIDJSON := fmt.Sprintf(`["%s"]`, nodeID)

	rows, err := r.db.pool.Query(ctx, query, nodeIDJSON)
	if err != nil {
		return nil, fmt.Errorf("failed to query storage pools assigned to node: %w", err)
	}
	defer rows.Close()

	var pools []*domain.StoragePool
	for rows.Next() {
		pool, err := r.scanPoolFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan storage pool: %w", err)
		}
		pools = append(pools, pool)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating storage pool rows: %w", err)
	}

	r.logger.Debug("Listed storage pools assigned to node",
		zap.String("node_id", nodeID),
		zap.Int("count", len(pools)),
	)
	return pools, nil
}

// scanPool scans a single row into a StoragePool.
func (r *StoragePoolRepository) scanPool(ctx context.Context, row pgx.Row) (*domain.StoragePool, error) {
	var pool domain.StoragePool
	var projectID *string
	var poolType string
	var specJSON, labelsJSON, assignedNodesJSON []byte

	err := row.Scan(
		&pool.ID,
		&pool.Name,
		&projectID,
		&pool.Description,
		&poolType,
		&specJSON,
		&labelsJSON,
		&assignedNodesJSON,
		&pool.Status.Phase,
		&pool.Status.Capacity.TotalBytes,
		&pool.Status.Capacity.UsedBytes,
		&pool.Status.Capacity.AvailableBytes,
		&pool.Status.ErrorMessage,
		&pool.Status.VolumeCount,
		&pool.CreatedAt,
		&pool.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if projectID != nil {
		pool.ProjectID = *projectID
	}

	if len(specJSON) > 0 {
		if err := json.Unmarshal(specJSON, &pool.Spec); err != nil {
			r.logger.Warn("Failed to unmarshal spec", zap.Error(err), zap.String("id", pool.ID))
		}
	}

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &pool.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err), zap.String("id", pool.ID))
		}
	}

	if len(assignedNodesJSON) > 0 {
		if err := json.Unmarshal(assignedNodesJSON, &pool.Spec.AssignedNodeIDs); err != nil {
			r.logger.Warn("Failed to unmarshal assigned_node_ids", zap.Error(err), zap.String("id", pool.ID))
		}
	}

	// Ensure backend type is set from pool_type column if not in spec
	if pool.Spec.Backend == nil && poolType != "" {
		pool.Spec.Backend = &domain.StorageBackend{
			Type: domain.BackendType(poolType),
		}
	}

	return &pool, nil
}

// scanPoolFromRows scans a row from a Rows object.
func (r *StoragePoolRepository) scanPoolFromRows(rows pgx.Rows) (*domain.StoragePool, error) {
	var pool domain.StoragePool
	var projectID *string
	var poolType string
	var specJSON, labelsJSON, assignedNodesJSON []byte

	err := rows.Scan(
		&pool.ID,
		&pool.Name,
		&projectID,
		&pool.Description,
		&poolType,
		&specJSON,
		&labelsJSON,
		&assignedNodesJSON,
		&pool.Status.Phase,
		&pool.Status.Capacity.TotalBytes,
		&pool.Status.Capacity.UsedBytes,
		&pool.Status.Capacity.AvailableBytes,
		&pool.Status.ErrorMessage,
		&pool.Status.VolumeCount,
		&pool.CreatedAt,
		&pool.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if projectID != nil {
		pool.ProjectID = *projectID
	}

	if len(specJSON) > 0 {
		if err := json.Unmarshal(specJSON, &pool.Spec); err != nil {
			r.logger.Warn("Failed to unmarshal spec", zap.Error(err), zap.String("id", pool.ID))
		}
	}

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &pool.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err), zap.String("id", pool.ID))
		}
	}

	if len(assignedNodesJSON) > 0 {
		if err := json.Unmarshal(assignedNodesJSON, &pool.Spec.AssignedNodeIDs); err != nil {
			r.logger.Warn("Failed to unmarshal assigned_node_ids", zap.Error(err), zap.String("id", pool.ID))
		}
	}

	// Ensure backend type is set from pool_type column if not in spec
	if pool.Spec.Backend == nil && poolType != "" {
		pool.Spec.Backend = &domain.StorageBackend{
			Type: domain.BackendType(poolType),
		}
	}

	return &pool, nil
}
