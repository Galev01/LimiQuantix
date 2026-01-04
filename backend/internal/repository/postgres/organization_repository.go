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

// OrganizationRepository implements organization storage using PostgreSQL.
type OrganizationRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewOrganizationRepository creates a new PostgreSQL organization repository.
func NewOrganizationRepository(db *DB, logger *zap.Logger) *OrganizationRepository {
	return &OrganizationRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "organization")),
	}
}

// Get retrieves the organization (singleton).
func (r *OrganizationRepository) Get(ctx context.Context) (*domain.Organization, error) {
	query := `
		SELECT id, name, domain, settings, branding, billing_contact, metadata, created_at, updated_at
		FROM organizations
		ORDER BY created_at ASC
		LIMIT 1
	`

	org := &domain.Organization{}
	var settingsJSON, brandingJSON, billingJSON, metadataJSON []byte

	err := r.db.pool.QueryRow(ctx, query).Scan(
		&org.ID,
		&org.Name,
		&org.Domain,
		&settingsJSON,
		&brandingJSON,
		&billingJSON,
		&metadataJSON,
		&org.CreatedAt,
		&org.UpdatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get organization: %w", err)
	}

	// Unmarshal JSON fields
	if len(settingsJSON) > 0 {
		if err := json.Unmarshal(settingsJSON, &org.Settings); err != nil {
			r.logger.Warn("Failed to unmarshal settings", zap.Error(err))
			org.Settings = domain.DefaultOrganizationSettings()
		}
	}
	if len(brandingJSON) > 0 {
		if err := json.Unmarshal(brandingJSON, &org.Branding); err != nil {
			r.logger.Warn("Failed to unmarshal branding", zap.Error(err))
		}
	}
	if len(billingJSON) > 0 {
		if err := json.Unmarshal(billingJSON, &org.BillingContact); err != nil {
			r.logger.Warn("Failed to unmarshal billing contact", zap.Error(err))
		}
	}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &org.Metadata); err != nil {
			r.logger.Warn("Failed to unmarshal metadata", zap.Error(err))
		}
	}

	return org, nil
}

// GetByID retrieves an organization by ID.
func (r *OrganizationRepository) GetByID(ctx context.Context, id string) (*domain.Organization, error) {
	query := `
		SELECT id, name, domain, settings, branding, billing_contact, metadata, created_at, updated_at
		FROM organizations
		WHERE id = $1
	`

	org := &domain.Organization{}
	var settingsJSON, brandingJSON, billingJSON, metadataJSON []byte

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&org.ID,
		&org.Name,
		&org.Domain,
		&settingsJSON,
		&brandingJSON,
		&billingJSON,
		&metadataJSON,
		&org.CreatedAt,
		&org.UpdatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get organization: %w", err)
	}

	// Unmarshal JSON fields
	if len(settingsJSON) > 0 {
		json.Unmarshal(settingsJSON, &org.Settings)
	}
	if len(brandingJSON) > 0 {
		json.Unmarshal(brandingJSON, &org.Branding)
	}
	if len(billingJSON) > 0 {
		json.Unmarshal(billingJSON, &org.BillingContact)
	}
	if len(metadataJSON) > 0 {
		json.Unmarshal(metadataJSON, &org.Metadata)
	}

	return org, nil
}

// Create creates a new organization.
func (r *OrganizationRepository) Create(ctx context.Context, org *domain.Organization) (*domain.Organization, error) {
	if org.ID == "" {
		org.ID = uuid.New().String()
	}

	settingsJSON, _ := json.Marshal(org.Settings)
	brandingJSON, _ := json.Marshal(org.Branding)
	billingJSON, _ := json.Marshal(org.BillingContact)
	metadataJSON, _ := json.Marshal(org.Metadata)

	query := `
		INSERT INTO organizations (id, name, domain, settings, branding, billing_contact, metadata)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at, updated_at
	`

	err := r.db.pool.QueryRow(ctx, query,
		org.ID,
		org.Name,
		org.Domain,
		settingsJSON,
		brandingJSON,
		billingJSON,
		metadataJSON,
	).Scan(&org.CreatedAt, &org.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create organization: %w", err)
	}

	r.logger.Info("Created organization", zap.String("id", org.ID), zap.String("name", org.Name))
	return org, nil
}

// Update updates an organization.
func (r *OrganizationRepository) Update(ctx context.Context, org *domain.Organization) (*domain.Organization, error) {
	settingsJSON, _ := json.Marshal(org.Settings)
	brandingJSON, _ := json.Marshal(org.Branding)
	billingJSON, _ := json.Marshal(org.BillingContact)
	metadataJSON, _ := json.Marshal(org.Metadata)

	query := `
		UPDATE organizations
		SET name = $2, domain = $3, settings = $4, branding = $5, billing_contact = $6, metadata = $7
		WHERE id = $1
		RETURNING updated_at
	`

	err := r.db.pool.QueryRow(ctx, query,
		org.ID,
		org.Name,
		org.Domain,
		settingsJSON,
		brandingJSON,
		billingJSON,
		metadataJSON,
	).Scan(&org.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update organization: %w", err)
	}

	r.logger.Info("Updated organization", zap.String("id", org.ID))
	return org, nil
}

// UpdateSettings updates only the settings field.
func (r *OrganizationRepository) UpdateSettings(ctx context.Context, id string, settings domain.OrganizationSettings) error {
	settingsJSON, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	query := `UPDATE organizations SET settings = $2 WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id, settingsJSON)
	if err != nil {
		return fmt.Errorf("failed to update settings: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Updated organization settings", zap.String("id", id))
	return nil
}

// UpdateBranding updates only the branding field.
func (r *OrganizationRepository) UpdateBranding(ctx context.Context, id string, branding domain.OrganizationBranding) error {
	brandingJSON, err := json.Marshal(branding)
	if err != nil {
		return fmt.Errorf("failed to marshal branding: %w", err)
	}

	query := `UPDATE organizations SET branding = $2 WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id, brandingJSON)
	if err != nil {
		return fmt.Errorf("failed to update branding: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Updated organization branding", zap.String("id", id))
	return nil
}
