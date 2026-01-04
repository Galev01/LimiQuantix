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

// SSOConfigRepository implements SSO configuration storage using PostgreSQL.
type SSOConfigRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewSSOConfigRepository creates a new PostgreSQL SSO config repository.
func NewSSOConfigRepository(db *DB, logger *zap.Logger) *SSOConfigRepository {
	return &SSOConfigRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "sso_config")),
	}
}

// Create stores a new SSO configuration.
func (r *SSOConfigRepository) Create(ctx context.Context, cfg *domain.SSOConfig) (*domain.SSOConfig, error) {
	if cfg.ID == "" {
		cfg.ID = uuid.New().String()
	}

	// Build config JSON based on provider type
	configJSON, err := r.marshalProviderConfig(cfg)
	if err != nil {
		return nil, err
	}

	groupMappingJSON, _ := json.Marshal(cfg.GroupMapping)
	allowedDomainsJSON, _ := json.Marshal(cfg.AllowedDomains)
	allowedGroupsJSON, _ := json.Marshal(cfg.AllowedGroups)

	query := `
		INSERT INTO sso_configs (
			id, provider_type, name, enabled, config,
			auto_provision, default_role, group_mapping,
			allowed_domains, allowed_groups, jit_provisioning, update_on_login
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		cfg.ID,
		string(cfg.ProviderType),
		cfg.Name,
		cfg.Enabled,
		configJSON,
		cfg.AutoProvision,
		string(cfg.DefaultRole),
		groupMappingJSON,
		allowedDomainsJSON,
		allowedGroupsJSON,
		cfg.JITProvisioning,
		cfg.UpdateOnLogin,
	).Scan(&cfg.CreatedAt, &cfg.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create SSO config", zap.Error(err), zap.String("name", cfg.Name))
		return nil, fmt.Errorf("failed to insert SSO config: %w", err)
	}

	r.logger.Info("Created SSO config", zap.String("id", cfg.ID), zap.String("provider", string(cfg.ProviderType)))
	return cfg, nil
}

// Get retrieves an SSO configuration by ID.
func (r *SSOConfigRepository) Get(ctx context.Context, id string) (*domain.SSOConfig, error) {
	query := `
		SELECT id, provider_type, name, enabled, config,
		       auto_provision, default_role, group_mapping,
		       allowed_domains, allowed_groups, jit_provisioning, update_on_login,
		       created_at, updated_at
		FROM sso_configs
		WHERE id = $1
	`

	cfg := &domain.SSOConfig{}
	var providerType, defaultRole string
	var configJSON, groupMappingJSON, allowedDomainsJSON, allowedGroupsJSON []byte

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&cfg.ID,
		&providerType,
		&cfg.Name,
		&cfg.Enabled,
		&configJSON,
		&cfg.AutoProvision,
		&defaultRole,
		&groupMappingJSON,
		&allowedDomainsJSON,
		&allowedGroupsJSON,
		&cfg.JITProvisioning,
		&cfg.UpdateOnLogin,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get SSO config: %w", err)
	}

	cfg.ProviderType = domain.SSOProviderType(providerType)
	cfg.DefaultRole = domain.Role(defaultRole)

	// Unmarshal provider-specific config
	if err := r.unmarshalProviderConfig(cfg, configJSON); err != nil {
		r.logger.Warn("Failed to unmarshal provider config", zap.Error(err))
	}

	if len(groupMappingJSON) > 0 {
		json.Unmarshal(groupMappingJSON, &cfg.GroupMapping)
	}
	if len(allowedDomainsJSON) > 0 {
		json.Unmarshal(allowedDomainsJSON, &cfg.AllowedDomains)
	}
	if len(allowedGroupsJSON) > 0 {
		json.Unmarshal(allowedGroupsJSON, &cfg.AllowedGroups)
	}

	return cfg, nil
}

// GetByProviderType retrieves an SSO configuration by provider type.
func (r *SSOConfigRepository) GetByProviderType(ctx context.Context, providerType domain.SSOProviderType) (*domain.SSOConfig, error) {
	query := `
		SELECT id, provider_type, name, enabled, config,
		       auto_provision, default_role, group_mapping,
		       allowed_domains, allowed_groups, jit_provisioning, update_on_login,
		       created_at, updated_at
		FROM sso_configs
		WHERE provider_type = $1 AND enabled = TRUE
		LIMIT 1
	`

	cfg := &domain.SSOConfig{}
	var pType, defaultRole string
	var configJSON, groupMappingJSON, allowedDomainsJSON, allowedGroupsJSON []byte

	err := r.db.pool.QueryRow(ctx, query, string(providerType)).Scan(
		&cfg.ID,
		&pType,
		&cfg.Name,
		&cfg.Enabled,
		&configJSON,
		&cfg.AutoProvision,
		&defaultRole,
		&groupMappingJSON,
		&allowedDomainsJSON,
		&allowedGroupsJSON,
		&cfg.JITProvisioning,
		&cfg.UpdateOnLogin,
		&cfg.CreatedAt,
		&cfg.UpdatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get SSO config by type: %w", err)
	}

	cfg.ProviderType = domain.SSOProviderType(pType)
	cfg.DefaultRole = domain.Role(defaultRole)

	if err := r.unmarshalProviderConfig(cfg, configJSON); err != nil {
		r.logger.Warn("Failed to unmarshal provider config", zap.Error(err))
	}

	if len(groupMappingJSON) > 0 {
		json.Unmarshal(groupMappingJSON, &cfg.GroupMapping)
	}
	if len(allowedDomainsJSON) > 0 {
		json.Unmarshal(allowedDomainsJSON, &cfg.AllowedDomains)
	}
	if len(allowedGroupsJSON) > 0 {
		json.Unmarshal(allowedGroupsJSON, &cfg.AllowedGroups)
	}

	return cfg, nil
}

// List returns all SSO configurations.
func (r *SSOConfigRepository) List(ctx context.Context) ([]*domain.SSOConfig, error) {
	query := `
		SELECT id, provider_type, name, enabled, config,
		       auto_provision, default_role, group_mapping,
		       allowed_domains, allowed_groups, jit_provisioning, update_on_login,
		       created_at, updated_at
		FROM sso_configs
		ORDER BY provider_type, name
	`

	rows, err := r.db.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to list SSO configs: %w", err)
	}
	defer rows.Close()

	var configs []*domain.SSOConfig
	for rows.Next() {
		cfg := &domain.SSOConfig{}
		var providerType, defaultRole string
		var configJSON, groupMappingJSON, allowedDomainsJSON, allowedGroupsJSON []byte

		err := rows.Scan(
			&cfg.ID,
			&providerType,
			&cfg.Name,
			&cfg.Enabled,
			&configJSON,
			&cfg.AutoProvision,
			&defaultRole,
			&groupMappingJSON,
			&allowedDomainsJSON,
			&allowedGroupsJSON,
			&cfg.JITProvisioning,
			&cfg.UpdateOnLogin,
			&cfg.CreatedAt,
			&cfg.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan SSO config: %w", err)
		}

		cfg.ProviderType = domain.SSOProviderType(providerType)
		cfg.DefaultRole = domain.Role(defaultRole)

		r.unmarshalProviderConfig(cfg, configJSON)
		if len(groupMappingJSON) > 0 {
			json.Unmarshal(groupMappingJSON, &cfg.GroupMapping)
		}
		if len(allowedDomainsJSON) > 0 {
			json.Unmarshal(allowedDomainsJSON, &cfg.AllowedDomains)
		}
		if len(allowedGroupsJSON) > 0 {
			json.Unmarshal(allowedGroupsJSON, &cfg.AllowedGroups)
		}

		configs = append(configs, cfg)
	}

	return configs, nil
}

// Update updates an SSO configuration.
func (r *SSOConfigRepository) Update(ctx context.Context, cfg *domain.SSOConfig) (*domain.SSOConfig, error) {
	configJSON, err := r.marshalProviderConfig(cfg)
	if err != nil {
		return nil, err
	}

	groupMappingJSON, _ := json.Marshal(cfg.GroupMapping)
	allowedDomainsJSON, _ := json.Marshal(cfg.AllowedDomains)
	allowedGroupsJSON, _ := json.Marshal(cfg.AllowedGroups)

	query := `
		UPDATE sso_configs
		SET name = $2, enabled = $3, config = $4,
		    auto_provision = $5, default_role = $6, group_mapping = $7,
		    allowed_domains = $8, allowed_groups = $9, jit_provisioning = $10, update_on_login = $11
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		cfg.ID,
		cfg.Name,
		cfg.Enabled,
		configJSON,
		cfg.AutoProvision,
		string(cfg.DefaultRole),
		groupMappingJSON,
		allowedDomainsJSON,
		allowedGroupsJSON,
		cfg.JITProvisioning,
		cfg.UpdateOnLogin,
	).Scan(&cfg.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update SSO config: %w", err)
	}

	r.logger.Info("Updated SSO config", zap.String("id", cfg.ID))
	return cfg, nil
}

// Delete removes an SSO configuration.
func (r *SSOConfigRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM sso_configs WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete SSO config: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted SSO config", zap.String("id", id))
	return nil
}

// SetEnabled enables or disables an SSO configuration.
func (r *SSOConfigRepository) SetEnabled(ctx context.Context, id string, enabled bool) error {
	query := `UPDATE sso_configs SET enabled = $2 WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id, enabled)
	if err != nil {
		return fmt.Errorf("failed to set SSO config enabled: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Set SSO config enabled", zap.String("id", id), zap.Bool("enabled", enabled))
	return nil
}

// marshalProviderConfig marshals provider-specific config to JSON.
func (r *SSOConfigRepository) marshalProviderConfig(cfg *domain.SSOConfig) ([]byte, error) {
	switch cfg.ProviderType {
	case domain.SSOProviderOIDC:
		if cfg.OIDCConfig != nil {
			return json.Marshal(cfg.OIDCConfig)
		}
	case domain.SSOProviderSAML:
		if cfg.SAMLConfig != nil {
			return json.Marshal(cfg.SAMLConfig)
		}
	case domain.SSOProviderLDAP:
		if cfg.LDAPConfig != nil {
			return json.Marshal(cfg.LDAPConfig)
		}
	}
	return []byte("{}"), nil
}

// unmarshalProviderConfig unmarshals provider-specific config from JSON.
func (r *SSOConfigRepository) unmarshalProviderConfig(cfg *domain.SSOConfig, data []byte) error {
	if len(data) == 0 {
		return nil
	}

	switch cfg.ProviderType {
	case domain.SSOProviderOIDC:
		cfg.OIDCConfig = &domain.OIDCConfig{}
		return json.Unmarshal(data, cfg.OIDCConfig)
	case domain.SSOProviderSAML:
		cfg.SAMLConfig = &domain.SAMLConfig{}
		return json.Unmarshal(data, cfg.SAMLConfig)
	case domain.SSOProviderLDAP:
		cfg.LDAPConfig = &domain.LDAPConfig{}
		return json.Unmarshal(data, cfg.LDAPConfig)
	}
	return nil
}
