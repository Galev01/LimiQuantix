// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/storage"
)

// Ensure ImageRepository implements storage.ImageRepository
var _ storage.ImageRepository = (*ImageRepository)(nil)

// defaultProjectIDImage is the UUID used for images without a specific project.
const defaultProjectIDImage = "00000000-0000-0000-0000-000000000001"

// ImageRepository implements storage.ImageRepository using PostgreSQL.
type ImageRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewImageRepository creates a new PostgreSQL image repository.
func NewImageRepository(db *DB, logger *zap.Logger) *ImageRepository {
	return &ImageRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "image")),
	}
}

// Create adds a new image.
func (r *ImageRepository) Create(ctx context.Context, image *domain.Image) (*domain.Image, error) {
	if image.ID == "" {
		image.ID = uuid.New().String()
	}

	now := time.Now()
	image.CreatedAt = now
	image.UpdatedAt = now

	labelsJSON, err := json.Marshal(image.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	supportedFirmwareJSON, err := json.Marshal(image.Spec.Requirements.SupportedFirmware)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal supported_firmware: %w", err)
	}

	var ovaMetadataJSON []byte
	if image.Spec.OvaMetadata != nil {
		ovaMetadataJSON, err = json.Marshal(image.Spec.OvaMetadata)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal ova_metadata: %w", err)
		}
	}

	// Normalize project ID
	projectID := image.ProjectID
	if projectID == "" || projectID == "default" {
		projectID = defaultProjectIDImage
	}

	query := `
		INSERT INTO images (
			id, name, description, project_id, labels,
			format, visibility, os_family, os_distribution, os_version,
			os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
			min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
			ova_metadata, catalog_id,
			phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
			storage_pool_id, path, node_id, folder_path, filename,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14,
			$15, $16, $17, $18, $19, $20,
			$21, $22,
			$23, $24, $25, $26, $27, $28,
			$29, $30, $31, $32, $33,
			$34, $35
		)
		RETURNING created_at, updated_at
	`

	// Handle nullable UUIDs
	var storagePoolID, nodeID *string
	if image.Status.StoragePoolID != "" {
		storagePoolID = &image.Status.StoragePoolID
	}
	if image.Status.NodeID != "" {
		nodeID = &image.Status.NodeID
	}

	err = r.db.pool.QueryRow(ctx, query,
		image.ID,
		image.Name,
		image.Description,
		projectID,
		labelsJSON,
		string(image.Spec.Format),
		string(image.Spec.Visibility),
		string(image.Spec.OS.Family),
		image.Spec.OS.Distribution,
		image.Spec.OS.Version,
		image.Spec.OS.Architecture,
		image.Spec.OS.DefaultUser,
		image.Spec.OS.CloudInitEnabled,
		string(image.Spec.OS.ProvisioningMethod),
		image.Spec.Requirements.MinCPU,
		image.Spec.Requirements.MinMemoryMiB,
		image.Spec.Requirements.MinDiskGiB,
		supportedFirmwareJSON,
		image.Spec.Requirements.RequiresSecureBoot,
		image.Spec.Requirements.RequiresTPM,
		ovaMetadataJSON,
		image.Spec.CatalogID,
		string(image.Status.Phase),
		image.Status.SizeBytes,
		image.Status.VirtualSizeBytes,
		image.Status.ProgressPercent,
		image.Status.Checksum,
		image.Status.ErrorMessage,
		storagePoolID,
		image.Status.Path,
		nodeID,
		image.Status.FolderPath,
		image.Status.Filename,
		image.CreatedAt,
		image.UpdatedAt,
	).Scan(&image.CreatedAt, &image.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create image", zap.Error(err), zap.String("name", image.Name))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert image: %w", err)
	}

	r.logger.Info("Created image",
		zap.String("id", image.ID),
		zap.String("name", image.Name),
		zap.String("format", string(image.Spec.Format)),
	)
	return image, nil
}

// Get retrieves an image by ID.
func (r *ImageRepository) Get(ctx context.Context, id string) (*domain.Image, error) {
	query := `
		SELECT id, name, description, project_id, labels,
			format, visibility, os_family, os_distribution, os_version,
			os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
			min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
			ova_metadata, catalog_id,
			phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
			storage_pool_id, path, node_id, folder_path, filename,
			created_at, updated_at
		FROM images
		WHERE id = $1
	`

	image, err := r.scanImage(r.db.pool.QueryRow(ctx, query, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get image: %w", err)
	}

	return image, nil
}

// List retrieves images based on filter criteria.
func (r *ImageRepository) List(ctx context.Context, filter storage.ImageFilter) ([]*domain.Image, error) {
	baseQuery := `
		SELECT id, name, description, project_id, labels,
			format, visibility, os_family, os_distribution, os_version,
			os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
			min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
			ova_metadata, catalog_id,
			phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
			storage_pool_id, path, node_id, folder_path, filename,
			created_at, updated_at
		FROM images
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.ProjectID != "" {
		baseQuery += fmt.Sprintf(" AND project_id = $%d", argNum)
		args = append(args, filter.ProjectID)
		argNum++
	}

	if filter.OSFamily != "" {
		baseQuery += fmt.Sprintf(" AND os_family = $%d", argNum)
		args = append(args, string(filter.OSFamily))
		argNum++
	}

	if filter.Visibility != "" {
		baseQuery += fmt.Sprintf(" AND visibility = $%d", argNum)
		args = append(args, string(filter.Visibility))
		argNum++
	}

	if filter.NodeID != "" {
		baseQuery += fmt.Sprintf(" AND node_id = $%d", argNum)
		args = append(args, filter.NodeID)
		argNum++
	}

	if filter.Phase != "" {
		baseQuery += fmt.Sprintf(" AND phase = $%d", argNum)
		args = append(args, string(filter.Phase))
		argNum++
	}

	if filter.FolderPath != "" {
		baseQuery += fmt.Sprintf(" AND folder_path = $%d", argNum)
		args = append(args, filter.FolderPath)
		argNum++
	}

	if filter.Format != "" {
		baseQuery += fmt.Sprintf(" AND format = $%d", argNum)
		args = append(args, string(filter.Format))
		argNum++
	}

	if filter.StoragePoolID != "" {
		baseQuery += fmt.Sprintf(" AND storage_pool_id = $%d", argNum)
		args = append(args, filter.StoragePoolID)
		argNum++
	}

	if filter.SearchQuery != "" {
		baseQuery += fmt.Sprintf(" AND (name ILIKE $%d OR description ILIKE $%d)", argNum, argNum+1)
		searchPattern := "%" + filter.SearchQuery + "%"
		args = append(args, searchPattern, searchPattern)
		argNum += 2
	}

	baseQuery += " ORDER BY created_at DESC"

	rows, err := r.db.pool.Query(ctx, baseQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list images: %w", err)
	}
	defer rows.Close()

	var images []*domain.Image
	for rows.Next() {
		image, err := r.scanImageFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan image: %w", err)
		}
		images = append(images, image)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating images: %w", err)
	}

	return images, nil
}

// Update modifies an existing image.
func (r *ImageRepository) Update(ctx context.Context, image *domain.Image) (*domain.Image, error) {
	image.UpdatedAt = time.Now()

	labelsJSON, err := json.Marshal(image.Labels)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal labels: %w", err)
	}

	supportedFirmwareJSON, err := json.Marshal(image.Spec.Requirements.SupportedFirmware)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal supported_firmware: %w", err)
	}

	var ovaMetadataJSON []byte
	if image.Spec.OvaMetadata != nil {
		ovaMetadataJSON, err = json.Marshal(image.Spec.OvaMetadata)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal ova_metadata: %w", err)
		}
	}

	// Normalize project ID
	projectID := image.ProjectID
	if projectID == "" || projectID == "default" {
		projectID = defaultProjectIDImage
	}

	// Handle nullable UUIDs
	var storagePoolID, nodeID *string
	if image.Status.StoragePoolID != "" {
		storagePoolID = &image.Status.StoragePoolID
	}
	if image.Status.NodeID != "" {
		nodeID = &image.Status.NodeID
	}

	query := `
		UPDATE images SET
			name = $2,
			description = $3,
			project_id = $4,
			labels = $5,
			format = $6,
			visibility = $7,
			os_family = $8,
			os_distribution = $9,
			os_version = $10,
			os_architecture = $11,
			os_default_user = $12,
			os_cloud_init_enabled = $13,
			os_provisioning_method = $14,
			min_cpu = $15,
			min_memory_mib = $16,
			min_disk_gib = $17,
			supported_firmware = $18,
			requires_secure_boot = $19,
			requires_tpm = $20,
			ova_metadata = $21,
			catalog_id = $22,
			phase = $23,
			size_bytes = $24,
			virtual_size_bytes = $25,
			progress_percent = $26,
			checksum = $27,
			error_message = $28,
			storage_pool_id = $29,
			path = $30,
			node_id = $31,
			folder_path = $32,
			filename = $33,
			updated_at = $34
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		image.ID,
		image.Name,
		image.Description,
		projectID,
		labelsJSON,
		string(image.Spec.Format),
		string(image.Spec.Visibility),
		string(image.Spec.OS.Family),
		image.Spec.OS.Distribution,
		image.Spec.OS.Version,
		image.Spec.OS.Architecture,
		image.Spec.OS.DefaultUser,
		image.Spec.OS.CloudInitEnabled,
		string(image.Spec.OS.ProvisioningMethod),
		image.Spec.Requirements.MinCPU,
		image.Spec.Requirements.MinMemoryMiB,
		image.Spec.Requirements.MinDiskGiB,
		supportedFirmwareJSON,
		image.Spec.Requirements.RequiresSecureBoot,
		image.Spec.Requirements.RequiresTPM,
		ovaMetadataJSON,
		image.Spec.CatalogID,
		string(image.Status.Phase),
		image.Status.SizeBytes,
		image.Status.VirtualSizeBytes,
		image.Status.ProgressPercent,
		image.Status.Checksum,
		image.Status.ErrorMessage,
		storagePoolID,
		image.Status.Path,
		nodeID,
		image.Status.FolderPath,
		image.Status.Filename,
		image.UpdatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("failed to update image: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, domain.ErrNotFound
	}

	r.logger.Info("Updated image",
		zap.String("id", image.ID),
		zap.String("name", image.Name),
	)
	return image, nil
}

// Delete removes an image by ID.
func (r *ImageRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM images WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete image: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted image", zap.String("id", id))
	return nil
}

// GetByPath retrieves an image by node ID and path.
func (r *ImageRepository) GetByPath(ctx context.Context, nodeID, path string) (*domain.Image, error) {
	query := `
		SELECT id, name, description, project_id, labels,
			format, visibility, os_family, os_distribution, os_version,
			os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
			min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
			ova_metadata, catalog_id,
			phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
			storage_pool_id, path, node_id, folder_path, filename,
			created_at, updated_at
		FROM images
		WHERE node_id = $1 AND path = $2
	`

	image, err := r.scanImage(r.db.pool.QueryRow(ctx, query, nodeID, path))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get image by path: %w", err)
	}

	return image, nil
}

// FindByCatalogIDs returns images that were downloaded from the given catalog IDs.
func (r *ImageRepository) FindByCatalogIDs(ctx context.Context, catalogIDs []string) (map[string]*domain.Image, error) {
	if len(catalogIDs) == 0 {
		return make(map[string]*domain.Image), nil
	}

	// Build placeholders for IN clause
	placeholders := make([]string, len(catalogIDs))
	args := make([]interface{}, len(catalogIDs))
	for i, id := range catalogIDs {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT id, name, description, project_id, labels,
			format, visibility, os_family, os_distribution, os_version,
			os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
			min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
			ova_metadata, catalog_id,
			phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
			storage_pool_id, path, node_id, folder_path, filename,
			created_at, updated_at
		FROM images
		WHERE catalog_id IN (%s)
	`, strings.Join(placeholders, ", "))

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to find images by catalog IDs: %w", err)
	}
	defer rows.Close()

	result := make(map[string]*domain.Image)
	for rows.Next() {
		image, err := r.scanImageFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan image: %w", err)
		}
		if image.Spec.CatalogID != "" {
			result[image.Spec.CatalogID] = image
		}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating images: %w", err)
	}

	return result, nil
}

// ListByFolder returns images in a specific folder.
func (r *ImageRepository) ListByFolder(ctx context.Context, folderPath string, includeSubfolders bool) ([]*domain.Image, error) {
	var query string
	var args []interface{}

	if includeSubfolders {
		query = `
			SELECT id, name, description, project_id, labels,
				format, visibility, os_family, os_distribution, os_version,
				os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
				min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
				ova_metadata, catalog_id,
				phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
				storage_pool_id, path, node_id, folder_path, filename,
				created_at, updated_at
			FROM images
			WHERE folder_path LIKE $1
			ORDER BY folder_path, name
		`
		args = []interface{}{folderPath + "%"}
	} else {
		query = `
			SELECT id, name, description, project_id, labels,
				format, visibility, os_family, os_distribution, os_version,
				os_architecture, os_default_user, os_cloud_init_enabled, os_provisioning_method,
				min_cpu, min_memory_mib, min_disk_gib, supported_firmware, requires_secure_boot, requires_tpm,
				ova_metadata, catalog_id,
				phase, size_bytes, virtual_size_bytes, progress_percent, checksum, error_message,
				storage_pool_id, path, node_id, folder_path, filename,
				created_at, updated_at
			FROM images
			WHERE folder_path = $1
			ORDER BY name
		`
		args = []interface{}{folderPath}
	}

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list images by folder: %w", err)
	}
	defer rows.Close()

	var images []*domain.Image
	for rows.Next() {
		image, err := r.scanImageFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan image: %w", err)
		}
		images = append(images, image)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating images: %w", err)
	}

	return images, nil
}

// ListFolders returns all unique folder paths.
func (r *ImageRepository) ListFolders(ctx context.Context) ([]string, error) {
	query := `
		SELECT DISTINCT folder_path
		FROM images
		WHERE folder_path IS NOT NULL AND folder_path != ''
		ORDER BY folder_path
	`

	rows, err := r.db.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list folders: %w", err)
	}
	defer rows.Close()

	var folders []string
	for rows.Next() {
		var folder string
		if err := rows.Scan(&folder); err != nil {
			return nil, fmt.Errorf("failed to scan folder: %w", err)
		}
		folders = append(folders, folder)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating folders: %w", err)
	}

	return folders, nil
}

// Upsert creates or updates an image based on nodeID + path combination.
func (r *ImageRepository) Upsert(ctx context.Context, image *domain.Image) (*domain.Image, error) {
	// Try to find existing image by path
	existing, err := r.GetByPath(ctx, image.Status.NodeID, image.Status.Path)
	if err != nil && err != domain.ErrNotFound {
		return nil, err
	}

	if existing != nil {
		// Update existing
		image.ID = existing.ID
		image.CreatedAt = existing.CreatedAt
		return r.Update(ctx, image)
	}

	// Create new
	return r.Create(ctx, image)
}

// scanImage scans a single row into an Image.
func (r *ImageRepository) scanImage(row pgx.Row) (*domain.Image, error) {
	var image domain.Image
	var projectID *string
	var labelsJSON, supportedFirmwareJSON, ovaMetadataJSON []byte
	var storagePoolID, nodeID *string
	var catalogID *string

	err := row.Scan(
		&image.ID,
		&image.Name,
		&image.Description,
		&projectID,
		&labelsJSON,
		&image.Spec.Format,
		&image.Spec.Visibility,
		&image.Spec.OS.Family,
		&image.Spec.OS.Distribution,
		&image.Spec.OS.Version,
		&image.Spec.OS.Architecture,
		&image.Spec.OS.DefaultUser,
		&image.Spec.OS.CloudInitEnabled,
		&image.Spec.OS.ProvisioningMethod,
		&image.Spec.Requirements.MinCPU,
		&image.Spec.Requirements.MinMemoryMiB,
		&image.Spec.Requirements.MinDiskGiB,
		&supportedFirmwareJSON,
		&image.Spec.Requirements.RequiresSecureBoot,
		&image.Spec.Requirements.RequiresTPM,
		&ovaMetadataJSON,
		&catalogID,
		&image.Status.Phase,
		&image.Status.SizeBytes,
		&image.Status.VirtualSizeBytes,
		&image.Status.ProgressPercent,
		&image.Status.Checksum,
		&image.Status.ErrorMessage,
		&storagePoolID,
		&image.Status.Path,
		&nodeID,
		&image.Status.FolderPath,
		&image.Status.Filename,
		&image.CreatedAt,
		&image.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if projectID != nil {
		image.ProjectID = *projectID
	}

	if catalogID != nil {
		image.Spec.CatalogID = *catalogID
	}

	if storagePoolID != nil {
		image.Status.StoragePoolID = *storagePoolID
	}

	if nodeID != nil {
		image.Status.NodeID = *nodeID
	}

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &image.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err), zap.String("id", image.ID))
		}
	}

	if len(supportedFirmwareJSON) > 0 {
		if err := json.Unmarshal(supportedFirmwareJSON, &image.Spec.Requirements.SupportedFirmware); err != nil {
			r.logger.Warn("Failed to unmarshal supported_firmware", zap.Error(err), zap.String("id", image.ID))
		}
	}

	if len(ovaMetadataJSON) > 0 {
		image.Spec.OvaMetadata = &domain.OvaMetadata{}
		if err := json.Unmarshal(ovaMetadataJSON, image.Spec.OvaMetadata); err != nil {
			r.logger.Warn("Failed to unmarshal ova_metadata", zap.Error(err), zap.String("id", image.ID))
			image.Spec.OvaMetadata = nil
		}
	}

	return &image, nil
}

// scanImageFromRows scans a row from a Rows object.
func (r *ImageRepository) scanImageFromRows(rows pgx.Rows) (*domain.Image, error) {
	var image domain.Image
	var projectID *string
	var labelsJSON, supportedFirmwareJSON, ovaMetadataJSON []byte
	var storagePoolID, nodeID *string
	var catalogID *string

	err := rows.Scan(
		&image.ID,
		&image.Name,
		&image.Description,
		&projectID,
		&labelsJSON,
		&image.Spec.Format,
		&image.Spec.Visibility,
		&image.Spec.OS.Family,
		&image.Spec.OS.Distribution,
		&image.Spec.OS.Version,
		&image.Spec.OS.Architecture,
		&image.Spec.OS.DefaultUser,
		&image.Spec.OS.CloudInitEnabled,
		&image.Spec.OS.ProvisioningMethod,
		&image.Spec.Requirements.MinCPU,
		&image.Spec.Requirements.MinMemoryMiB,
		&image.Spec.Requirements.MinDiskGiB,
		&supportedFirmwareJSON,
		&image.Spec.Requirements.RequiresSecureBoot,
		&image.Spec.Requirements.RequiresTPM,
		&ovaMetadataJSON,
		&catalogID,
		&image.Status.Phase,
		&image.Status.SizeBytes,
		&image.Status.VirtualSizeBytes,
		&image.Status.ProgressPercent,
		&image.Status.Checksum,
		&image.Status.ErrorMessage,
		&storagePoolID,
		&image.Status.Path,
		&nodeID,
		&image.Status.FolderPath,
		&image.Status.Filename,
		&image.CreatedAt,
		&image.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if projectID != nil {
		image.ProjectID = *projectID
	}

	if catalogID != nil {
		image.Spec.CatalogID = *catalogID
	}

	if storagePoolID != nil {
		image.Status.StoragePoolID = *storagePoolID
	}

	if nodeID != nil {
		image.Status.NodeID = *nodeID
	}

	if len(labelsJSON) > 0 {
		if err := json.Unmarshal(labelsJSON, &image.Labels); err != nil {
			r.logger.Warn("Failed to unmarshal labels", zap.Error(err), zap.String("id", image.ID))
		}
	}

	if len(supportedFirmwareJSON) > 0 {
		if err := json.Unmarshal(supportedFirmwareJSON, &image.Spec.Requirements.SupportedFirmware); err != nil {
			r.logger.Warn("Failed to unmarshal supported_firmware", zap.Error(err), zap.String("id", image.ID))
		}
	}

	if len(ovaMetadataJSON) > 0 {
		image.Spec.OvaMetadata = &domain.OvaMetadata{}
		if err := json.Unmarshal(ovaMetadataJSON, image.Spec.OvaMetadata); err != nil {
			r.logger.Warn("Failed to unmarshal ova_metadata", zap.Error(err), zap.String("id", image.ID))
			image.Spec.OvaMetadata = nil
		}
	}

	return &image, nil
}
