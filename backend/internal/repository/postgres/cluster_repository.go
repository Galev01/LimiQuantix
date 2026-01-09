// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// Ensure ClusterRepository implements domain.ClusterRepository
var _ domain.ClusterRepository = (*ClusterRepository)(nil)

// ClusterRepository implements domain.ClusterRepository using PostgreSQL.
type ClusterRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewClusterRepository creates a new PostgreSQL Cluster repository.
func NewClusterRepository(db *DB, logger *zap.Logger) *ClusterRepository {
	return &ClusterRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "cluster")),
	}
}

// Create stores a new cluster.
func (r *ClusterRepository) Create(cluster *domain.Cluster) error {
	ctx := context.Background()

	if cluster.ID == "" {
		cluster.ID = uuid.New().String()
	}
	cluster.CreatedAt = time.Now()
	cluster.UpdatedAt = time.Now()

	query := `
		INSERT INTO clusters (
			id, name, description, ha_enabled, drs_enabled, drs_automation,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	_, err := r.db.pool.Exec(ctx, query,
		cluster.ID,
		cluster.Name,
		cluster.Description,
		cluster.HAEnabled,
		cluster.DRSEnabled,
		string(cluster.DRSMode),
		cluster.CreatedAt,
		cluster.UpdatedAt,
	)

	if err != nil {
		r.logger.Error("Failed to create cluster", zap.Error(err), zap.String("name", cluster.Name))
		if isUniqueViolation(err) {
			return domain.ErrAlreadyExists
		}
		return fmt.Errorf("failed to insert cluster: %w", err)
	}

	r.logger.Info("Created cluster", zap.String("id", cluster.ID), zap.String("name", cluster.Name))
	return nil
}

// Get retrieves a cluster by ID.
func (r *ClusterRepository) Get(id string) (*domain.Cluster, error) {
	ctx := context.Background()

	query := `
		SELECT id, name, description, ha_enabled, drs_enabled, drs_automation,
		       created_at, updated_at
		FROM clusters
		WHERE id = $1
	`

	return r.scanCluster(ctx, query, id)
}

// GetByName retrieves a cluster by name.
func (r *ClusterRepository) GetByName(name string) (*domain.Cluster, error) {
	ctx := context.Background()

	query := `
		SELECT id, name, description, ha_enabled, drs_enabled, drs_automation,
		       created_at, updated_at
		FROM clusters
		WHERE name = $1
	`

	return r.scanCluster(ctx, query, name)
}

// List returns all clusters, optionally filtered by project.
func (r *ClusterRepository) List(projectID string) ([]*domain.Cluster, error) {
	ctx := context.Background()

	// Note: The current schema doesn't have project_id on clusters table.
	// If needed, we can add it later. For now, list all clusters.
	query := `
		SELECT id, name, description, ha_enabled, drs_enabled, drs_automation,
		       created_at, updated_at
		FROM clusters
		ORDER BY name ASC
	`

	rows, err := r.db.pool.Query(ctx, query)
	if err != nil {
		r.logger.Error("Failed to list clusters", zap.Error(err))
		return nil, fmt.Errorf("failed to list clusters: %w", err)
	}
	defer rows.Close()

	var clusters []*domain.Cluster
	for rows.Next() {
		cluster, err := r.scanClusterFromRow(rows)
		if err != nil {
			return nil, err
		}
		clusters = append(clusters, cluster)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating clusters: %w", err)
	}

	return clusters, nil
}

// Update updates an existing cluster.
func (r *ClusterRepository) Update(cluster *domain.Cluster) error {
	ctx := context.Background()

	cluster.UpdatedAt = time.Now()

	query := `
		UPDATE clusters SET
			name = $2,
			description = $3,
			ha_enabled = $4,
			drs_enabled = $5,
			drs_automation = $6,
			updated_at = $7
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		cluster.ID,
		cluster.Name,
		cluster.Description,
		cluster.HAEnabled,
		cluster.DRSEnabled,
		string(cluster.DRSMode),
		cluster.UpdatedAt,
	)

	if err != nil {
		r.logger.Error("Failed to update cluster", zap.Error(err), zap.String("id", cluster.ID))
		return fmt.Errorf("failed to update cluster: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Updated cluster", zap.String("id", cluster.ID), zap.String("name", cluster.Name))
	return nil
}

// Delete removes a cluster by ID.
func (r *ClusterRepository) Delete(id string) error {
	ctx := context.Background()

	query := `DELETE FROM clusters WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		r.logger.Error("Failed to delete cluster", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to delete cluster: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted cluster", zap.String("id", id))
	return nil
}

// scanCluster scans a single cluster from the database.
func (r *ClusterRepository) scanCluster(ctx context.Context, query string, arg interface{}) (*domain.Cluster, error) {
	cluster := &domain.Cluster{}
	var drsAutomation *string

	err := r.db.pool.QueryRow(ctx, query, arg).Scan(
		&cluster.ID,
		&cluster.Name,
		&cluster.Description,
		&cluster.HAEnabled,
		&cluster.DRSEnabled,
		&drsAutomation,
		&cluster.CreatedAt,
		&cluster.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		r.logger.Error("Failed to scan cluster", zap.Error(err))
		return nil, fmt.Errorf("failed to scan cluster: %w", err)
	}

	if drsAutomation != nil {
		cluster.DRSMode = domain.DRSMode(*drsAutomation)
	}

	return cluster, nil
}

// scanClusterFromRow scans a cluster from a rows iterator.
func (r *ClusterRepository) scanClusterFromRow(rows pgx.Rows) (*domain.Cluster, error) {
	cluster := &domain.Cluster{}
	var drsAutomation *string

	err := rows.Scan(
		&cluster.ID,
		&cluster.Name,
		&cluster.Description,
		&cluster.HAEnabled,
		&cluster.DRSEnabled,
		&drsAutomation,
		&cluster.CreatedAt,
		&cluster.UpdatedAt,
	)

	if err != nil {
		r.logger.Error("Failed to scan cluster row", zap.Error(err))
		return nil, fmt.Errorf("failed to scan cluster row: %w", err)
	}

	if drsAutomation != nil {
		cluster.DRSMode = domain.DRSMode(*drsAutomation)
	}

	return cluster, nil
}
