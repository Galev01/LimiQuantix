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

// Ensure VolumeRepository implements storage.VolumeRepository
var _ storage.VolumeRepository = (*VolumeRepository)(nil)

// VolumeRepository implements storage.VolumeRepository using PostgreSQL.
type VolumeRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewVolumeRepository creates a new PostgreSQL volume repository.
func NewVolumeRepository(db *DB, logger *zap.Logger) *VolumeRepository {
	return &VolumeRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "volume")),
	}
}

// Create adds a new volume.
func (r *VolumeRepository) Create(ctx context.Context, vol *domain.Volume) (*domain.Volume, error) {
	if vol.ID == "" {
		vol.ID = uuid.New().String()
	}

	now := time.Now()
	vol.CreatedAt = now
	vol.UpdatedAt = now

	specJSON, err := json.Marshal(vol.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(vol.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		INSERT INTO volumes (
			id, name, pool_id, project_id, size_bytes, provisioning,
			labels, spec, phase, attached_vm_id, path, device_path,
			actual_size_bytes, error_message, backend_id, snapshot_count,
			created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		vol.ID,
		vol.Name,
		vol.PoolID,
		nullString(vol.ProjectID),
		vol.Spec.SizeBytes,
		string(vol.Spec.Provisioning),
		labelsJSON,
		specJSON,
		string(vol.Status.Phase),
		nullString(vol.Status.AttachedVMID),
		vol.Status.DevicePath,
		vol.Status.DevicePath,
		vol.Status.ActualSizeBytes,
		vol.Status.ErrorMessage,
		vol.Status.BackendID,
		vol.Status.SnapshotCount,
		vol.CreatedAt,
		vol.UpdatedAt,
	).Scan(&vol.CreatedAt, &vol.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create volume", zap.Error(err), zap.String("name", vol.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert volume: %w", err)
	}

	r.logger.Info("Created volume",
		zap.String("id", vol.ID),
		zap.String("name", vol.Name),
		zap.String("pool_id", vol.PoolID),
	)
	return vol, nil
}

// Get retrieves a volume by ID.
func (r *VolumeRepository) Get(ctx context.Context, id string) (*domain.Volume, error) {
	query := `
		SELECT id, name, pool_id, project_id, size_bytes, provisioning,
		       labels, spec, phase, attached_vm_id, path, device_path,
		       actual_size_bytes, error_message, backend_id, snapshot_count,
		       created_at, updated_at
		FROM volumes
		WHERE id = $1
	`

	vol, err := r.scanVolume(r.db.pool.QueryRow(ctx, query, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get volume: %w", err)
	}

	return vol, nil
}

// GetByName retrieves a volume by name within a project.
func (r *VolumeRepository) GetByName(ctx context.Context, projectID, name string) (*domain.Volume, error) {
	query := `
		SELECT id, name, pool_id, project_id, size_bytes, provisioning,
		       labels, spec, phase, attached_vm_id, path, device_path,
		       actual_size_bytes, error_message, backend_id, snapshot_count,
		       created_at, updated_at
		FROM volumes
		WHERE name = $1 AND (project_id = $2 OR project_id IS NULL)
	`

	vol, err := r.scanVolume(r.db.pool.QueryRow(ctx, query, name, projectID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get volume by name: %w", err)
	}

	return vol, nil
}

// List retrieves volumes based on filter criteria.
func (r *VolumeRepository) List(ctx context.Context, filter storage.VolumeFilter, limit int, offset int) ([]*domain.Volume, int, error) {
	// Build query with filters
	baseQuery := `FROM volumes WHERE 1=1`
	args := []interface{}{}
	argNum := 1

	if filter.ProjectID != "" {
		baseQuery += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, filter.ProjectID)
		argNum++
	}

	if filter.PoolID != "" {
		baseQuery += fmt.Sprintf(" AND pool_id = $%d", argNum)
		args = append(args, filter.PoolID)
		argNum++
	}

	if filter.AttachedVMID != "" {
		baseQuery += fmt.Sprintf(" AND attached_vm_id = $%d", argNum)
		args = append(args, filter.AttachedVMID)
		argNum++
	}

	if filter.Phase != "" {
		baseQuery += fmt.Sprintf(" AND phase = $%d", argNum)
		args = append(args, string(filter.Phase))
		argNum++
	}

	// Count total
	var total int
	countQuery := "SELECT COUNT(*) " + baseQuery
	err := r.db.pool.QueryRow(ctx, countQuery, args...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count volumes: %w", err)
	}

	// Get volumes
	selectQuery := `
		SELECT id, name, pool_id, project_id, size_bytes, provisioning,
		       labels, spec, phase, attached_vm_id, path, device_path,
		       actual_size_bytes, error_message, backend_id, snapshot_count,
		       created_at, updated_at
	` + baseQuery + fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argNum, argNum+1)

	args = append(args, limit, offset)

	rows, err := r.db.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list volumes: %w", err)
	}
	defer rows.Close()

	var volumes []*domain.Volume
	for rows.Next() {
		vol, err := r.scanVolumeFromRows(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan volume: %w", err)
		}
		volumes = append(volumes, vol)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("error iterating volumes: %w", err)
	}

	return volumes, total, nil
}

// Update modifies an existing volume.
func (r *VolumeRepository) Update(ctx context.Context, vol *domain.Volume) (*domain.Volume, error) {
	vol.UpdatedAt = time.Now()

	specJSON, err := json.Marshal(vol.Spec)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal spec: %w", err)
	}

	labelsJSON, err := json.Marshal(vol.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		UPDATE volumes SET
			name = $2,
			pool_id = $3,
			project_id = $4,
			size_bytes = $5,
			provisioning = $6,
			labels = $7,
			spec = $8,
			phase = $9,
			attached_vm_id = $10,
			path = $11,
			device_path = $12,
			actual_size_bytes = $13,
			error_message = $14,
			backend_id = $15,
			snapshot_count = $16,
			updated_at = $17
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		vol.ID,
		vol.Name,
		vol.PoolID,
		nullString(vol.ProjectID),
		vol.Spec.SizeBytes,
		string(vol.Spec.Provisioning),
		labelsJSON,
		specJSON,
		string(vol.Status.Phase),
		nullString(vol.Status.AttachedVMID),
		vol.Status.DevicePath,
		vol.Status.DevicePath,
		vol.Status.ActualSizeBytes,
		vol.Status.ErrorMessage,
		vol.Status.BackendID,
		vol.Status.SnapshotCount,
		vol.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update volume: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, domain.ErrNotFound
	}

	r.logger.Info("Updated volume",
		zap.String("id", vol.ID),
		zap.String("name", vol.Name),
	)
	return vol, nil
}

// Delete removes a volume by ID.
func (r *VolumeRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM volumes WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete volume: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted volume", zap.String("id", id))
	return nil
}

// UpdateStatus updates the status of a volume.
func (r *VolumeRepository) UpdateStatus(ctx context.Context, id string, status domain.VolumeStatus) error {
	query := `
		UPDATE volumes SET
			phase = $2,
			attached_vm_id = $3,
			device_path = $4,
			actual_size_bytes = $5,
			error_message = $6,
			backend_id = $7,
			snapshot_count = $8,
			updated_at = NOW()
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		id,
		string(status.Phase),
		nullString(status.AttachedVMID),
		status.DevicePath,
		status.ActualSizeBytes,
		status.ErrorMessage,
		status.BackendID,
		status.SnapshotCount,
	)

	if err != nil {
		return fmt.Errorf("failed to update volume status: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Debug("Updated volume status",
		zap.String("id", id),
		zap.String("phase", string(status.Phase)),
	)
	return nil
}

// ListByPoolID retrieves all volumes in a specific pool.
func (r *VolumeRepository) ListByPoolID(ctx context.Context, poolID string) ([]*domain.Volume, error) {
	query := `
		SELECT id, name, pool_id, project_id, size_bytes, provisioning,
		       labels, spec, phase, attached_vm_id, path, device_path,
		       actual_size_bytes, error_message, backend_id, snapshot_count,
		       created_at, updated_at
		FROM volumes
		WHERE pool_id = $1
		ORDER BY created_at DESC
	`

	rows, err := r.db.pool.Query(ctx, query, poolID)
	if err != nil {
		return nil, fmt.Errorf("failed to list volumes by pool: %w", err)
	}
	defer rows.Close()

	var volumes []*domain.Volume
	for rows.Next() {
		vol, err := r.scanVolumeFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan volume: %w", err)
		}
		volumes = append(volumes, vol)
	}

	return volumes, nil
}

// ListByVMID retrieves all volumes attached to a specific VM.
func (r *VolumeRepository) ListByVMID(ctx context.Context, vmID string) ([]*domain.Volume, error) {
	query := `
		SELECT id, name, pool_id, project_id, size_bytes, provisioning,
		       labels, spec, phase, attached_vm_id, path, device_path,
		       actual_size_bytes, error_message, backend_id, snapshot_count,
		       created_at, updated_at
		FROM volumes
		WHERE attached_vm_id = $1
		ORDER BY created_at DESC
	`

	rows, err := r.db.pool.Query(ctx, query, vmID)
	if err != nil {
		return nil, fmt.Errorf("failed to list volumes by VM: %w", err)
	}
	defer rows.Close()

	var volumes []*domain.Volume
	for rows.Next() {
		vol, err := r.scanVolumeFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan volume: %w", err)
		}
		volumes = append(volumes, vol)
	}

	return volumes, nil
}

// scanVolume scans a single row into a Volume.
func (r *VolumeRepository) scanVolume(row pgx.Row) (*domain.Volume, error) {
	var vol domain.Volume
	var projectID, attachedVMID, path *string
	var provisioning string
	var specJSON, labelsJSON []byte

	err := row.Scan(
		&vol.ID,
		&vol.Name,
		&vol.PoolID,
		&projectID,
		&vol.Spec.SizeBytes,
		&provisioning,
		&labelsJSON,
		&specJSON,
		&vol.Status.Phase,
		&attachedVMID,
		&path,
		&vol.Status.DevicePath,
		&vol.Status.ActualSizeBytes,
		&vol.Status.ErrorMessage,
		&vol.Status.BackendID,
		&vol.Status.SnapshotCount,
		&vol.CreatedAt,
		&vol.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if projectID != nil {
		vol.ProjectID = *projectID
	}
	if attachedVMID != nil {
		vol.Status.AttachedVMID = *attachedVMID
	}

	// Parse provisioning
	vol.Spec.Provisioning = domain.ProvisioningType(provisioning)

	// Parse spec JSON (contains source, qos, encryption, access_mode)
	if len(specJSON) > 0 {
		if err := json.Unmarshal(specJSON, &vol.Spec); err != nil {
			r.logger.Warn("Failed to unmarshal spec", zap.Error(err), zap.String("id", vol.ID))
		}
	}

	// Parse labels
	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &vol.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err), zap.String("id", vol.ID))
		}
	}

	return &vol, nil
}

// scanVolumeFromRows scans a row from a Rows object.
func (r *VolumeRepository) scanVolumeFromRows(rows pgx.Rows) (*domain.Volume, error) {
	var vol domain.Volume
	var projectID, attachedVMID, path *string
	var provisioning string
	var specJSON, labelsJSON []byte

	err := rows.Scan(
		&vol.ID,
		&vol.Name,
		&vol.PoolID,
		&projectID,
		&vol.Spec.SizeBytes,
		&provisioning,
		&labelsJSON,
		&specJSON,
		&vol.Status.Phase,
		&attachedVMID,
		&path,
		&vol.Status.DevicePath,
		&vol.Status.ActualSizeBytes,
		&vol.Status.ErrorMessage,
		&vol.Status.BackendID,
		&vol.Status.SnapshotCount,
		&vol.CreatedAt,
		&vol.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if projectID != nil {
		vol.ProjectID = *projectID
	}
	if attachedVMID != nil {
		vol.Status.AttachedVMID = *attachedVMID
	}

	// Parse provisioning
	vol.Spec.Provisioning = domain.ProvisioningType(provisioning)

	// Parse spec JSON
	if len(specJSON) > 0 {
		if err := json.Unmarshal(specJSON, &vol.Spec); err != nil {
			r.logger.Warn("Failed to unmarshal spec", zap.Error(err), zap.String("id", vol.ID))
		}
	}

	// Parse labels
	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &vol.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err), zap.String("id", vol.ID))
		}
	}

	return &vol, nil
}
