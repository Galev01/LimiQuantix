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

// FolderRepository implements folder storage using PostgreSQL.
type FolderRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewFolderRepository creates a new PostgreSQL folder repository.
func NewFolderRepository(db *DB, logger *zap.Logger) *FolderRepository {
	return &FolderRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "folder")),
	}
}

// Create stores a new folder.
func (r *FolderRepository) Create(ctx context.Context, folder *domain.Folder) (*domain.Folder, error) {
	if folder.ID == "" {
		folder.ID = uuid.New().String()
	}

	// Normalize project ID
	projectID := folder.ProjectID
	if projectID == "" || projectID == "default" {
		projectID = "00000000-0000-0000-0000-000000000001"
	}
	folder.ProjectID = projectID

	labelsJSON, err := json.Marshal(folder.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	query := `
		INSERT INTO folders (id, name, parent_id, project_id, type, description, labels, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING created_at, updated_at
	`

	var parentID *string
	if folder.ParentID != "" {
		parentID = &folder.ParentID
	}

	err = r.db.pool.QueryRow(ctx, query,
		folder.ID,
		folder.Name,
		parentID,
		folder.ProjectID,
		string(folder.Type),
		folder.Description,
		labelsJSON,
		folder.CreatedBy,
	).Scan(&folder.CreatedAt, &folder.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create folder", zap.Error(err), zap.String("name", folder.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert folder: %w", err)
	}

	r.logger.Info("Created folder", zap.String("id", folder.ID), zap.String("name", folder.Name))
	return folder, nil
}

// Get retrieves a folder by ID.
func (r *FolderRepository) Get(ctx context.Context, id string) (*domain.Folder, error) {
	query := `
		SELECT id, name, parent_id, project_id, type, description, labels, created_at, updated_at, created_by
		FROM folders
		WHERE id = $1
	`

	folder := &domain.Folder{}
	var parentID *string
	var labelsJSON []byte
	var folderType string

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&folder.ID,
		&folder.Name,
		&parentID,
		&folder.ProjectID,
		&folderType,
		&folder.Description,
		&labelsJSON,
		&folder.CreatedAt,
		&folder.UpdatedAt,
		&folder.CreatedBy,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get folder: %w", err)
	}

	if parentID != nil {
		folder.ParentID = *parentID
	}
	folder.Type = domain.FolderType(folderType)

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &folder.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err))
		}
	}

	return folder, nil
}

// List returns all folders matching the filter.
func (r *FolderRepository) List(ctx context.Context, filter domain.FolderFilter) ([]*domain.Folder, error) {
	query := `
		SELECT id, name, parent_id, project_id, type, description, labels, created_at, updated_at, created_by
		FROM folders
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	// Normalize project ID for filter
	if filter.ProjectID != "" {
		projectID := filter.ProjectID
		if projectID == "default" {
			projectID = "00000000-0000-0000-0000-000000000001"
		}
		query += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, projectID)
		argNum++
	}

	if filter.ParentID != "" {
		query += fmt.Sprintf(" AND parent_id = $%d", argNum)
		args = append(args, filter.ParentID)
		argNum++
	} else {
		// If no parent filter, show root folders by default
		query += " AND parent_id IS NULL"
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
		return nil, fmt.Errorf("failed to list folders: %w", err)
	}
	defer rows.Close()

	var folders []*domain.Folder
	for rows.Next() {
		folder := &domain.Folder{}
		var parentID *string
		var labelsJSON []byte
		var folderType string

		err := rows.Scan(
			&folder.ID,
			&folder.Name,
			&parentID,
			&folder.ProjectID,
			&folderType,
			&folder.Description,
			&labelsJSON,
			&folder.CreatedAt,
			&folder.UpdatedAt,
			&folder.CreatedBy,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan folder: %w", err)
		}

		if parentID != nil {
			folder.ParentID = *parentID
		}
		folder.Type = domain.FolderType(folderType)

		if len(labelsJSON) > 0 {
			json.Unmarshal(labelsJSON, &folder.Labels)
		}

		folders = append(folders, folder)
	}

	return folders, nil
}

// ListChildren returns immediate children of a folder.
func (r *FolderRepository) ListChildren(ctx context.Context, parentID string) ([]*domain.Folder, error) {
	query := `
		SELECT id, name, parent_id, project_id, type, description, labels, created_at, updated_at, created_by
		FROM folders
		WHERE parent_id = $1
		ORDER BY name ASC
	`

	rows, err := r.db.pool.Query(ctx, query, parentID)
	if err != nil {
		return nil, fmt.Errorf("failed to list folder children: %w", err)
	}
	defer rows.Close()

	var folders []*domain.Folder
	for rows.Next() {
		folder := &domain.Folder{}
		var pid *string
		var labelsJSON []byte
		var folderType string

		err := rows.Scan(
			&folder.ID,
			&folder.Name,
			&pid,
			&folder.ProjectID,
			&folderType,
			&folder.Description,
			&labelsJSON,
			&folder.CreatedAt,
			&folder.UpdatedAt,
			&folder.CreatedBy,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan folder: %w", err)
		}

		if pid != nil {
			folder.ParentID = *pid
		}
		folder.Type = domain.FolderType(folderType)

		if len(labelsJSON) > 0 {
			json.Unmarshal(labelsJSON, &folder.Labels)
		}

		folders = append(folders, folder)
	}

	return folders, nil
}

// Update updates an existing folder.
func (r *FolderRepository) Update(ctx context.Context, folder *domain.Folder) (*domain.Folder, error) {
	labelsJSON, err := json.Marshal(folder.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	var parentID *string
	if folder.ParentID != "" {
		parentID = &folder.ParentID
	}

	query := `
		UPDATE folders
		SET name = $2, parent_id = $3, description = $4, labels = $5, updated_at = NOW()
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		folder.ID,
		folder.Name,
		parentID,
		folder.Description,
		labelsJSON,
	).Scan(&folder.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update folder: %w", err)
	}

	r.logger.Info("Updated folder", zap.String("id", folder.ID))
	return folder, nil
}

// Delete removes a folder by ID.
func (r *FolderRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM folders WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete folder: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted folder", zap.String("id", id))
	return nil
}

// GetPath returns the full path of a folder from root.
func (r *FolderRepository) GetPath(ctx context.Context, id string) (string, error) {
	// Recursive CTE to build path
	query := `
		WITH RECURSIVE folder_path AS (
			SELECT id, name, parent_id, name::text as path
			FROM folders
			WHERE id = $1
			
			UNION ALL
			
			SELECT f.id, f.name, f.parent_id, f.name || '/' || fp.path
			FROM folders f
			INNER JOIN folder_path fp ON f.id = fp.parent_id
		)
		SELECT path FROM folder_path WHERE parent_id IS NULL
	`

	var path string
	err := r.db.pool.QueryRow(ctx, query, id).Scan(&path)
	if err == pgx.ErrNoRows {
		return "", domain.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("failed to get folder path: %w", err)
	}

	return "/" + path, nil
}

// CountVMs returns the number of VMs in a folder.
func (r *FolderRepository) CountVMs(ctx context.Context, folderID string) (int, error) {
	query := `SELECT COUNT(*) FROM virtual_machines WHERE folder_id = $1`
	var count int
	err := r.db.pool.QueryRow(ctx, query, folderID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count VMs: %w", err)
	}
	return count, nil
}

// MoveVMsToFolder moves all VMs from one folder to another.
func (r *FolderRepository) MoveVMsToFolder(ctx context.Context, fromFolderID, toFolderID string) error {
	query := `UPDATE virtual_machines SET folder_id = $2, updated_at = NOW() WHERE folder_id = $1`
	_, err := r.db.pool.Exec(ctx, query, fromFolderID, toFolderID)
	if err != nil {
		return fmt.Errorf("failed to move VMs: %w", err)
	}
	return nil
}

// SeedDefaultFolders creates default root folders if they don't exist.
func (r *FolderRepository) SeedDefaultFolders(ctx context.Context) error {
	folders := []struct {
		id          string
		name        string
		description string
	}{
		{"10000000-0000-0000-0000-000000000001", "Virtual Machines", "Root folder for all virtual machines"},
		{"10000000-0000-0000-0000-000000000002", "Templates", "Folder for VM templates"},
		{"10000000-0000-0000-0000-000000000003", "Discovered VMs", "Automatically discovered VMs"},
	}

	for _, f := range folders {
		query := `
			INSERT INTO folders (id, name, parent_id, project_id, type, description)
			VALUES ($1, $2, NULL, '00000000-0000-0000-0000-000000000001', 'VM', $3)
			ON CONFLICT (parent_id, name, project_id) DO NOTHING
		`
		_, err := r.db.pool.Exec(ctx, query, f.id, f.name, f.description)
		if err != nil {
			r.logger.Warn("Failed to seed default folder", zap.String("name", f.name), zap.Error(err))
		}
	}

	r.logger.Info("Seeded default folders")
	return nil
}

// unused but required for interface compatibility
var _ = time.Now
