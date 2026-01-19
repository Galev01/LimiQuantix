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
)

// CustomizationSpecRepository implements customization spec storage using PostgreSQL.
type CustomizationSpecRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewCustomizationSpecRepository creates a new PostgreSQL customization spec repository.
func NewCustomizationSpecRepository(db *DB, logger *zap.Logger) *CustomizationSpecRepository {
	return &CustomizationSpecRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "customization_spec")),
	}
}

// List retrieves all customization specs matching the filter.
func (r *CustomizationSpecRepository) List(ctx context.Context, filter domain.CustomizationSpecFilter) ([]*domain.CustomizationSpec, error) {
	query := `
		SELECT id, name, description, project_id, type, linux_spec, windows_spec, network,
		       install_agent, labels, created_at, updated_at, created_by
		FROM customization_specs
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.ProjectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, filter.ProjectID)
		argNum++
	}

	if filter.Type != "" {
		query += fmt.Sprintf(" AND type = $%d", argNum)
		args = append(args, string(filter.Type))
		argNum++
	}

	if filter.Name != "" {
		query += fmt.Sprintf(" AND name ILIKE $%d", argNum)
		args = append(args, "%"+filter.Name+"%")
		argNum++
	}

	query += " ORDER BY name ASC"

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		r.logger.Error("Failed to list customization specs", zap.Error(err))
		return nil, fmt.Errorf("failed to list customization specs: %w", err)
	}
	defer rows.Close()

	var specs []*domain.CustomizationSpec
	for rows.Next() {
		spec, err := r.scanSpec(rows)
		if err != nil {
			return nil, err
		}
		specs = append(specs, spec)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating customization specs: %w", err)
	}

	r.logger.Debug("Listed customization specs", zap.Int("count", len(specs)))
	return specs, nil
}

// Get retrieves a customization spec by ID.
func (r *CustomizationSpecRepository) Get(ctx context.Context, id string) (*domain.CustomizationSpec, error) {
	query := `
		SELECT id, name, description, project_id, type, linux_spec, windows_spec, network,
		       install_agent, labels, created_at, updated_at, created_by
		FROM customization_specs
		WHERE id = $1
	`

	row := r.db.pool.QueryRow(ctx, query, id)
	spec, err := r.scanSpecRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		r.logger.Error("Failed to get customization spec", zap.Error(err), zap.String("id", id))
		return nil, fmt.Errorf("failed to get customization spec: %w", err)
	}

	return spec, nil
}

// Create stores a new customization spec.
func (r *CustomizationSpecRepository) Create(ctx context.Context, spec *domain.CustomizationSpec) error {
	if spec.ID == "" {
		spec.ID = uuid.New().String()
	}

	linuxSpecJSON, err := json.Marshal(spec.LinuxSpec)
	if err != nil {
		return fmt.Errorf("failed to marshal linux_spec: %w", err)
	}

	windowsSpecJSON, err := json.Marshal(spec.WindowsSpec)
	if err != nil {
		return fmt.Errorf("failed to marshal windows_spec: %w", err)
	}

	networkJSON, err := json.Marshal(spec.Network)
	if err != nil {
		return fmt.Errorf("failed to marshal network: %w", err)
	}

	labelsJSON, err := json.Marshal(spec.Labels)
	if err != nil {
		return fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		INSERT INTO customization_specs (
			id, name, description, project_id, type, linux_spec, windows_spec, network,
			install_agent, labels, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		spec.ID,
		spec.Name,
		spec.Description,
		spec.ProjectID,
		string(spec.Type),
		linuxSpecJSON,
		windowsSpecJSON,
		networkJSON,
		spec.InstallAgent,
		labelsJSON,
		spec.CreatedBy,
	).Scan(&spec.CreatedAt, &spec.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create customization spec", zap.Error(err), zap.String("name", spec.Name))
		if isUniqueViolation(err) {
			return domain.ErrAlreadyExists
		}
		return fmt.Errorf("failed to insert customization spec: %w", err)
	}

	r.logger.Info("Created customization spec", zap.String("id", spec.ID), zap.String("name", spec.Name))
	return nil
}

// Update modifies an existing customization spec.
func (r *CustomizationSpecRepository) Update(ctx context.Context, spec *domain.CustomizationSpec) error {
	linuxSpecJSON, err := json.Marshal(spec.LinuxSpec)
	if err != nil {
		return fmt.Errorf("failed to marshal linux_spec: %w", err)
	}

	windowsSpecJSON, err := json.Marshal(spec.WindowsSpec)
	if err != nil {
		return fmt.Errorf("failed to marshal windows_spec: %w", err)
	}

	networkJSON, err := json.Marshal(spec.Network)
	if err != nil {
		return fmt.Errorf("failed to marshal network: %w", err)
	}

	labelsJSON, err := json.Marshal(spec.Labels)
	if err != nil {
		return fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		UPDATE customization_specs SET
			name = $2,
			description = $3,
			type = $4,
			linux_spec = $5,
			windows_spec = $6,
			network = $7,
			install_agent = $8,
			labels = $9,
			updated_at = NOW()
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		spec.ID,
		spec.Name,
		spec.Description,
		string(spec.Type),
		linuxSpecJSON,
		windowsSpecJSON,
		networkJSON,
		spec.InstallAgent,
		labelsJSON,
	).Scan(&spec.UpdatedAt)

	if err != nil {
		if err == pgx.ErrNoRows {
			return domain.ErrNotFound
		}
		r.logger.Error("Failed to update customization spec", zap.Error(err), zap.String("id", spec.ID))
		return fmt.Errorf("failed to update customization spec: %w", err)
	}

	r.logger.Info("Updated customization spec", zap.String("id", spec.ID), zap.String("name", spec.Name))
	return nil
}

// Delete removes a customization spec by ID.
func (r *CustomizationSpecRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM customization_specs WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		r.logger.Error("Failed to delete customization spec", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to delete customization spec: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted customization spec", zap.String("id", id))
	return nil
}

// scanSpec scans a customization spec from a pgx.Rows.
func (r *CustomizationSpecRepository) scanSpec(rows pgx.Rows) (*domain.CustomizationSpec, error) {
	var spec domain.CustomizationSpec
	var linuxSpecJSON, windowsSpecJSON, networkJSON, labelsJSON []byte
	var specType string
	var description, createdBy *string
	var createdAt, updatedAt time.Time

	err := rows.Scan(
		&spec.ID,
		&spec.Name,
		&description,
		&spec.ProjectID,
		&specType,
		&linuxSpecJSON,
		&windowsSpecJSON,
		&networkJSON,
		&spec.InstallAgent,
		&labelsJSON,
		&createdAt,
		&updatedAt,
		&createdBy,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to scan customization spec: %w", err)
	}

	spec.Type = domain.CustomizationSpecType(specType)
	spec.CreatedAt = createdAt
	spec.UpdatedAt = updatedAt

	if description != nil {
		spec.Description = *description
	}
	if createdBy != nil {
		spec.CreatedBy = *createdBy
	}

	if len(linuxSpecJSON) > 0 && string(linuxSpecJSON) != "null" {
		spec.LinuxSpec = &domain.LinuxCustomization{}
		if err := json.Unmarshal(linuxSpecJSON, spec.LinuxSpec); err != nil {
			r.logger.Warn("Failed to unmarshal linux_spec", zap.Error(err))
		}
	}

	if len(windowsSpecJSON) > 0 && string(windowsSpecJSON) != "null" {
		spec.WindowsSpec = &domain.WindowsCustomization{}
		if err := json.Unmarshal(windowsSpecJSON, spec.WindowsSpec); err != nil {
			r.logger.Warn("Failed to unmarshal windows_spec", zap.Error(err))
		}
	}

	if len(networkJSON) > 0 && string(networkJSON) != "null" {
		spec.Network = &domain.NetworkCustomization{}
		if err := json.Unmarshal(networkJSON, spec.Network); err != nil {
			r.logger.Warn("Failed to unmarshal network", zap.Error(err))
		}
	}

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &spec.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err))
			spec.Labels = make(map[string]string)
		}
	}

	return &spec, nil
}

// scanSpecRow scans a customization spec from a pgx.Row.
func (r *CustomizationSpecRepository) scanSpecRow(row pgx.Row) (*domain.CustomizationSpec, error) {
	var spec domain.CustomizationSpec
	var linuxSpecJSON, windowsSpecJSON, networkJSON, labelsJSON []byte
	var specType string
	var description, createdBy *string
	var createdAt, updatedAt time.Time

	err := row.Scan(
		&spec.ID,
		&spec.Name,
		&description,
		&spec.ProjectID,
		&specType,
		&linuxSpecJSON,
		&windowsSpecJSON,
		&networkJSON,
		&spec.InstallAgent,
		&labelsJSON,
		&createdAt,
		&updatedAt,
		&createdBy,
	)
	if err != nil {
		return nil, err
	}

	spec.Type = domain.CustomizationSpecType(specType)
	spec.CreatedAt = createdAt
	spec.UpdatedAt = updatedAt

	if description != nil {
		spec.Description = *description
	}
	if createdBy != nil {
		spec.CreatedBy = *createdBy
	}

	if len(linuxSpecJSON) > 0 && string(linuxSpecJSON) != "null" {
		spec.LinuxSpec = &domain.LinuxCustomization{}
		if err := json.Unmarshal(linuxSpecJSON, spec.LinuxSpec); err != nil {
			r.logger.Warn("Failed to unmarshal linux_spec", zap.Error(err))
		}
	}

	if len(windowsSpecJSON) > 0 && string(windowsSpecJSON) != "null" {
		spec.WindowsSpec = &domain.WindowsCustomization{}
		if err := json.Unmarshal(windowsSpecJSON, spec.WindowsSpec); err != nil {
			r.logger.Warn("Failed to unmarshal windows_spec", zap.Error(err))
		}
	}

	if len(networkJSON) > 0 && string(networkJSON) != "null" {
		spec.Network = &domain.NetworkCustomization{}
		if err := json.Unmarshal(networkJSON, spec.Network); err != nil {
			r.logger.Warn("Failed to unmarshal network", zap.Error(err))
		}
	}

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &spec.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err))
			spec.Labels = make(map[string]string)
		}
	}

	return &spec, nil
}
