// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// RoleRepository implements role storage using PostgreSQL.
type RoleRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewRoleRepository creates a new PostgreSQL role repository.
func NewRoleRepository(db *DB, logger *zap.Logger) *RoleRepository {
	return &RoleRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "role")),
	}
}

// Create stores a new custom role.
func (r *RoleRepository) Create(ctx context.Context, role *domain.CustomRole) (*domain.CustomRole, error) {
	if role.ID == "" {
		role.ID = uuid.New().String()
	}

	permissionsJSON, err := json.Marshal(role.Permissions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal permissions: %w", err)
	}

	query := `
		INSERT INTO roles (id, name, description, type, parent_id, permissions)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		role.ID,
		role.Name,
		role.Description,
		string(role.Type),
		role.ParentID,
		permissionsJSON,
	).Scan(&role.CreatedAt, &role.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create role", zap.Error(err), zap.String("name", role.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert role: %w", err)
	}

	r.logger.Info("Created role", zap.String("id", role.ID), zap.String("name", role.Name))
	return role, nil
}

// Get retrieves a role by ID.
func (r *RoleRepository) Get(ctx context.Context, id string) (*domain.CustomRole, error) {
	query := `
		SELECT r.id, r.name, r.description, r.type, r.parent_id, r.permissions,
		       r.created_at, r.updated_at,
		       COALESCE((SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id), 0) as user_count
		FROM roles r
		WHERE r.id = $1
	`

	role := &domain.CustomRole{}
	var permissionsJSON []byte
	var roleType string

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&role.ID,
		&role.Name,
		&role.Description,
		&roleType,
		&role.ParentID,
		&permissionsJSON,
		&role.CreatedAt,
		&role.UpdatedAt,
		&role.UserCount,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get role: %w", err)
	}

	role.Type = domain.RoleType(roleType)
	if len(permissionsJSON) > 0 {
		if err := json.Unmarshal(permissionsJSON, &role.Permissions); err != nil {
			r.logger.Warn("Failed to unmarshal permissions", zap.Error(err))
		}
	}

	return role, nil
}

// GetByName retrieves a role by name.
func (r *RoleRepository) GetByName(ctx context.Context, name string) (*domain.CustomRole, error) {
	query := `
		SELECT r.id, r.name, r.description, r.type, r.parent_id, r.permissions,
		       r.created_at, r.updated_at,
		       COALESCE((SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id), 0) as user_count
		FROM roles r
		WHERE r.name = $1
	`

	role := &domain.CustomRole{}
	var permissionsJSON []byte
	var roleType string

	err := r.db.pool.QueryRow(ctx, query, name).Scan(
		&role.ID,
		&role.Name,
		&role.Description,
		&roleType,
		&role.ParentID,
		&permissionsJSON,
		&role.CreatedAt,
		&role.UpdatedAt,
		&role.UserCount,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get role by name: %w", err)
	}

	role.Type = domain.RoleType(roleType)
	if len(permissionsJSON) > 0 {
		if err := json.Unmarshal(permissionsJSON, &role.Permissions); err != nil {
			r.logger.Warn("Failed to unmarshal permissions", zap.Error(err))
		}
	}

	return role, nil
}

// List returns all roles with optional filtering.
func (r *RoleRepository) List(ctx context.Context, filter RoleFilter) ([]*domain.CustomRole, error) {
	query := `
		SELECT r.id, r.name, r.description, r.type, r.parent_id, r.permissions,
		       r.created_at, r.updated_at,
		       COALESCE((SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id), 0) as user_count
		FROM roles r
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.Type != "" {
		query += fmt.Sprintf(" AND r.type = $%d", argNum)
		args = append(args, string(filter.Type))
		argNum++
	}

	if filter.NameContains != "" {
		query += fmt.Sprintf(" AND r.name ILIKE $%d", argNum)
		args = append(args, "%"+filter.NameContains+"%")
		argNum++
	}

	query += " ORDER BY r.type DESC, r.name ASC" // system roles first

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list roles: %w", err)
	}
	defer rows.Close()

	var roles []*domain.CustomRole
	for rows.Next() {
		role := &domain.CustomRole{}
		var permissionsJSON []byte
		var roleType string

		err := rows.Scan(
			&role.ID,
			&role.Name,
			&role.Description,
			&roleType,
			&role.ParentID,
			&permissionsJSON,
			&role.CreatedAt,
			&role.UpdatedAt,
			&role.UserCount,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan role: %w", err)
		}

		role.Type = domain.RoleType(roleType)
		if len(permissionsJSON) > 0 {
			json.Unmarshal(permissionsJSON, &role.Permissions)
		}

		roles = append(roles, role)
	}

	return roles, nil
}

// Update updates an existing role.
func (r *RoleRepository) Update(ctx context.Context, role *domain.CustomRole) (*domain.CustomRole, error) {
	// System roles cannot be updated
	existing, err := r.Get(ctx, role.ID)
	if err != nil {
		return nil, err
	}
	if existing.Type == domain.RoleTypeSystem {
		return nil, fmt.Errorf("cannot update system role")
	}

	permissionsJSON, err := json.Marshal(role.Permissions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal permissions: %w", err)
	}

	query := `
		UPDATE roles
		SET name = $2, description = $3, parent_id = $4, permissions = $5
		WHERE id = $1 AND type = 'custom'
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		role.ID,
		role.Name,
		role.Description,
		role.ParentID,
		permissionsJSON,
	).Scan(&role.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to update role: %w", err)
	}

	r.logger.Info("Updated role", zap.String("id", role.ID))
	return role, nil
}

// Delete removes a role by ID.
func (r *RoleRepository) Delete(ctx context.Context, id string) error {
	// System roles cannot be deleted
	existing, err := r.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.Type == domain.RoleTypeSystem {
		return fmt.Errorf("cannot delete system role")
	}

	query := `DELETE FROM roles WHERE id = $1 AND type = 'custom'`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete role: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted role", zap.String("id", id))
	return nil
}

// AssignToUser assigns a role to a user.
func (r *RoleRepository) AssignToUser(ctx context.Context, userID, roleID, assignedBy string) error {
	query := `
		INSERT INTO user_roles (user_id, role_id, assigned_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, role_id) DO NOTHING
	`

	_, err := r.db.pool.Exec(ctx, query, userID, roleID, nullString(assignedBy))
	if err != nil {
		return fmt.Errorf("failed to assign role to user: %w", err)
	}

	r.logger.Info("Assigned role to user",
		zap.String("user_id", userID),
		zap.String("role_id", roleID),
	)
	return nil
}

// RemoveFromUser removes a role from a user.
func (r *RoleRepository) RemoveFromUser(ctx context.Context, userID, roleID string) error {
	query := `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`

	result, err := r.db.pool.Exec(ctx, query, userID, roleID)
	if err != nil {
		return fmt.Errorf("failed to remove role from user: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Removed role from user",
		zap.String("user_id", userID),
		zap.String("role_id", roleID),
	)
	return nil
}

// GetUserRoles returns all roles assigned to a user.
func (r *RoleRepository) GetUserRoles(ctx context.Context, userID string) ([]*domain.CustomRole, error) {
	query := `
		SELECT r.id, r.name, r.description, r.type, r.parent_id, r.permissions,
		       r.created_at, r.updated_at, 0 as user_count
		FROM roles r
		INNER JOIN user_roles ur ON ur.role_id = r.id
		WHERE ur.user_id = $1
		ORDER BY r.type DESC, r.name ASC
	`

	rows, err := r.db.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user roles: %w", err)
	}
	defer rows.Close()

	var roles []*domain.CustomRole
	for rows.Next() {
		role := &domain.CustomRole{}
		var permissionsJSON []byte
		var roleType string

		err := rows.Scan(
			&role.ID,
			&role.Name,
			&role.Description,
			&roleType,
			&role.ParentID,
			&permissionsJSON,
			&role.CreatedAt,
			&role.UpdatedAt,
			&role.UserCount,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan role: %w", err)
		}

		role.Type = domain.RoleType(roleType)
		if len(permissionsJSON) > 0 {
			json.Unmarshal(permissionsJSON, &role.Permissions)
		}

		roles = append(roles, role)
	}

	return roles, nil
}

// RoleFilter defines filter criteria for listing roles.
type RoleFilter struct {
	Type         domain.RoleType
	NameContains string
}
