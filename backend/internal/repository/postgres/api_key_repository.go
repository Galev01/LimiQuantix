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

// APIKeyRepository implements API key storage using PostgreSQL.
type APIKeyRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewAPIKeyRepository creates a new PostgreSQL API key repository.
func NewAPIKeyRepository(db *DB, logger *zap.Logger) *APIKeyRepository {
	return &APIKeyRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "api_key")),
	}
}

// Create stores a new API key.
func (r *APIKeyRepository) Create(ctx context.Context, key *domain.APIKey) (*domain.APIKey, error) {
	if key.ID == "" {
		key.ID = uuid.New().String()
	}

	permissionsJSON, err := json.Marshal(key.Permissions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal permissions: %w", err)
	}

	query := `
		INSERT INTO api_keys (id, name, prefix, key_hash, permissions, created_by, expires_at, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING created_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		key.ID,
		key.Name,
		key.Prefix,
		key.KeyHash,
		permissionsJSON,
		nullString(key.CreatedBy),
		key.ExpiresAt,
		string(key.Status),
	).Scan(&key.CreatedAt)

	if err != nil {
		r.logger.Error("Failed to create API key", zap.Error(err), zap.String("name", key.Name))
		return nil, fmt.Errorf("failed to insert API key: %w", err)
	}

	r.logger.Info("Created API key", zap.String("id", key.ID), zap.String("prefix", key.Prefix))
	return key, nil
}

// Get retrieves an API key by ID.
func (r *APIKeyRepository) Get(ctx context.Context, id string) (*domain.APIKey, error) {
	query := `
		SELECT id, name, prefix, key_hash, permissions, created_by, 
		       expires_at, status, usage_count, last_used, created_at
		FROM api_keys
		WHERE id = $1
	`

	key := &domain.APIKey{}
	var permissionsJSON []byte
	var status string
	var createdBy *string

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&key.ID,
		&key.Name,
		&key.Prefix,
		&key.KeyHash,
		&permissionsJSON,
		&createdBy,
		&key.ExpiresAt,
		&status,
		&key.UsageCount,
		&key.LastUsed,
		&key.CreatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get API key: %w", err)
	}

	key.Status = domain.APIKeyStatus(status)
	if createdBy != nil {
		key.CreatedBy = *createdBy
	}
	if len(permissionsJSON) > 0 {
		if err := json.Unmarshal(permissionsJSON, &key.Permissions); err != nil {
			r.logger.Warn("Failed to unmarshal permissions", zap.Error(err))
		}
	}

	return key, nil
}

// GetByPrefix retrieves an API key by its prefix (for validation).
func (r *APIKeyRepository) GetByPrefix(ctx context.Context, prefix string) (*domain.APIKey, error) {
	query := `
		SELECT id, name, prefix, key_hash, permissions, created_by, 
		       expires_at, status, usage_count, last_used, created_at
		FROM api_keys
		WHERE prefix = $1 AND status = 'active'
	`

	key := &domain.APIKey{}
	var permissionsJSON []byte
	var status string
	var createdBy *string

	err := r.db.pool.QueryRow(ctx, query, prefix).Scan(
		&key.ID,
		&key.Name,
		&key.Prefix,
		&key.KeyHash,
		&permissionsJSON,
		&createdBy,
		&key.ExpiresAt,
		&status,
		&key.UsageCount,
		&key.LastUsed,
		&key.CreatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get API key by prefix: %w", err)
	}

	key.Status = domain.APIKeyStatus(status)
	if createdBy != nil {
		key.CreatedBy = *createdBy
	}
	if len(permissionsJSON) > 0 {
		if err := json.Unmarshal(permissionsJSON, &key.Permissions); err != nil {
			r.logger.Warn("Failed to unmarshal permissions", zap.Error(err))
		}
	}

	return key, nil
}

// List returns all API keys with optional filtering.
func (r *APIKeyRepository) List(ctx context.Context, filter APIKeyFilter) ([]*domain.APIKey, error) {
	query := `
		SELECT id, name, prefix, key_hash, permissions, created_by, 
		       expires_at, status, usage_count, last_used, created_at
		FROM api_keys
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.CreatedBy != "" {
		query += fmt.Sprintf(" AND created_by = $%d", argNum)
		args = append(args, filter.CreatedBy)
		argNum++
	}

	if filter.Status != "" {
		query += fmt.Sprintf(" AND status = $%d", argNum)
		args = append(args, string(filter.Status))
		argNum++
	}

	if filter.NameContains != "" {
		query += fmt.Sprintf(" AND name ILIKE $%d", argNum)
		args = append(args, "%"+filter.NameContains+"%")
		argNum++
	}

	query += " ORDER BY created_at DESC"

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list API keys: %w", err)
	}
	defer rows.Close()

	var keys []*domain.APIKey
	for rows.Next() {
		key := &domain.APIKey{}
		var permissionsJSON []byte
		var status string
		var createdBy *string

		err := rows.Scan(
			&key.ID,
			&key.Name,
			&key.Prefix,
			&key.KeyHash,
			&permissionsJSON,
			&createdBy,
			&key.ExpiresAt,
			&status,
			&key.UsageCount,
			&key.LastUsed,
			&key.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan API key: %w", err)
		}

		key.Status = domain.APIKeyStatus(status)
		if createdBy != nil {
			key.CreatedBy = *createdBy
		}
		if len(permissionsJSON) > 0 {
			json.Unmarshal(permissionsJSON, &key.Permissions)
		}

		keys = append(keys, key)
	}

	return keys, nil
}

// Delete removes an API key by ID.
func (r *APIKeyRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM api_keys WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete API key: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted API key", zap.String("id", id))
	return nil
}

// Revoke marks an API key as revoked.
func (r *APIKeyRepository) Revoke(ctx context.Context, id string) error {
	query := `UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND status = 'active'`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to revoke API key: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Revoked API key", zap.String("id", id))
	return nil
}

// TrackUsage increments the usage count and updates last_used timestamp.
func (r *APIKeyRepository) TrackUsage(ctx context.Context, id string) error {
	query := `
		UPDATE api_keys 
		SET usage_count = usage_count + 1, last_used = $2
		WHERE id = $1
	`

	_, err := r.db.pool.Exec(ctx, query, id, time.Now())
	if err != nil {
		return fmt.Errorf("failed to track API key usage: %w", err)
	}

	return nil
}

// ExpireOld marks all expired keys as expired.
func (r *APIKeyRepository) ExpireOld(ctx context.Context) (int64, error) {
	query := `
		UPDATE api_keys 
		SET status = 'expired'
		WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < NOW()
	`

	result, err := r.db.pool.Exec(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("failed to expire old API keys: %w", err)
	}

	count := result.RowsAffected()
	if count > 0 {
		r.logger.Info("Expired old API keys", zap.Int64("count", count))
	}

	return count, nil
}

// CountByUser returns the number of active API keys for a user.
func (r *APIKeyRepository) CountByUser(ctx context.Context, userID string) (int, error) {
	query := `SELECT COUNT(*) FROM api_keys WHERE created_by = $1 AND status = 'active'`

	var count int
	err := r.db.pool.QueryRow(ctx, query, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count API keys: %w", err)
	}

	return count, nil
}

// APIKeyFilter defines filter criteria for listing API keys.
type APIKeyFilter struct {
	CreatedBy    string
	Status       domain.APIKeyStatus
	NameContains string
}
