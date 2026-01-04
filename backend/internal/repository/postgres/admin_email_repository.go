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

// AdminEmailRepository implements admin email storage using PostgreSQL.
type AdminEmailRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewAdminEmailRepository creates a new PostgreSQL admin email repository.
func NewAdminEmailRepository(db *DB, logger *zap.Logger) *AdminEmailRepository {
	return &AdminEmailRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "admin_email")),
	}
}

// Create stores a new admin email.
func (r *AdminEmailRepository) Create(ctx context.Context, email *domain.AdminEmail) (*domain.AdminEmail, error) {
	if email.ID == "" {
		email.ID = uuid.New().String()
	}

	notificationsJSON, err := json.Marshal(email.Notifications)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal notifications: %w", err)
	}

	query := `
		INSERT INTO admin_emails (id, email, name, role, notifications, verified, verified_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING created_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		email.ID,
		email.Email,
		email.Name,
		string(email.Role),
		notificationsJSON,
		email.Verified,
		email.VerifiedAt,
	).Scan(&email.CreatedAt)

	if err != nil {
		r.logger.Error("Failed to create admin email", zap.Error(err), zap.String("email", email.Email))
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to insert admin email: %w", err)
	}

	r.logger.Info("Created admin email", zap.String("id", email.ID), zap.String("email", email.Email))
	return email, nil
}

// Get retrieves an admin email by ID.
func (r *AdminEmailRepository) Get(ctx context.Context, id string) (*domain.AdminEmail, error) {
	query := `
		SELECT id, email, name, role, notifications, verified, verified_at, created_at
		FROM admin_emails
		WHERE id = $1
	`

	email := &domain.AdminEmail{}
	var role string
	var notificationsJSON []byte

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&email.ID,
		&email.Email,
		&email.Name,
		&role,
		&notificationsJSON,
		&email.Verified,
		&email.VerifiedAt,
		&email.CreatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get admin email: %w", err)
	}

	email.Role = domain.AdminEmailRole(role)
	if len(notificationsJSON) > 0 {
		if err := json.Unmarshal(notificationsJSON, &email.Notifications); err != nil {
			r.logger.Warn("Failed to unmarshal notifications", zap.Error(err))
			email.Notifications = domain.DefaultNotificationSettings()
		}
	}

	return email, nil
}

// GetByEmail retrieves an admin email by email address.
func (r *AdminEmailRepository) GetByEmail(ctx context.Context, emailAddr string) (*domain.AdminEmail, error) {
	query := `
		SELECT id, email, name, role, notifications, verified, verified_at, created_at
		FROM admin_emails
		WHERE email = $1
	`

	email := &domain.AdminEmail{}
	var role string
	var notificationsJSON []byte

	err := r.db.pool.QueryRow(ctx, query, emailAddr).Scan(
		&email.ID,
		&email.Email,
		&email.Name,
		&role,
		&notificationsJSON,
		&email.Verified,
		&email.VerifiedAt,
		&email.CreatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get admin email by address: %w", err)
	}

	email.Role = domain.AdminEmailRole(role)
	if len(notificationsJSON) > 0 {
		json.Unmarshal(notificationsJSON, &email.Notifications)
	}

	return email, nil
}

// List returns all admin emails with optional filtering.
func (r *AdminEmailRepository) List(ctx context.Context, filter AdminEmailFilter) ([]*domain.AdminEmail, error) {
	query := `
		SELECT id, email, name, role, notifications, verified, verified_at, created_at
		FROM admin_emails
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.Role != "" {
		query += fmt.Sprintf(" AND role = $%d", argNum)
		args = append(args, string(filter.Role))
		argNum++
	}

	if filter.VerifiedOnly {
		query += " AND verified = TRUE"
	}

	query += " ORDER BY role ASC, email ASC"

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list admin emails: %w", err)
	}
	defer rows.Close()

	var emails []*domain.AdminEmail
	for rows.Next() {
		email := &domain.AdminEmail{}
		var role string
		var notificationsJSON []byte

		err := rows.Scan(
			&email.ID,
			&email.Email,
			&email.Name,
			&role,
			&notificationsJSON,
			&email.Verified,
			&email.VerifiedAt,
			&email.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan admin email: %w", err)
		}

		email.Role = domain.AdminEmailRole(role)
		if len(notificationsJSON) > 0 {
			json.Unmarshal(notificationsJSON, &email.Notifications)
		}

		emails = append(emails, email)
	}

	return emails, nil
}

// Update updates an admin email.
func (r *AdminEmailRepository) Update(ctx context.Context, email *domain.AdminEmail) (*domain.AdminEmail, error) {
	notificationsJSON, err := json.Marshal(email.Notifications)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal notifications: %w", err)
	}

	query := `
		UPDATE admin_emails
		SET email = $2, name = $3, role = $4, notifications = $5
		WHERE id = $1
	`

	result, err := r.db.pool.Exec(ctx, query,
		email.ID,
		email.Email,
		email.Name,
		string(email.Role),
		notificationsJSON,
	)

	if err != nil {
		if isUniqueViolation(err) {
			return nil, domain.ErrAlreadyExists
		}
		return nil, fmt.Errorf("failed to update admin email: %w", err)
	}

	if result.RowsAffected() == 0 {
		return nil, domain.ErrNotFound
	}

	r.logger.Info("Updated admin email", zap.String("id", email.ID))
	return email, nil
}

// Delete removes an admin email.
func (r *AdminEmailRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM admin_emails WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete admin email: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted admin email", zap.String("id", id))
	return nil
}

// SetVerified marks an admin email as verified.
func (r *AdminEmailRepository) SetVerified(ctx context.Context, id string, verified bool) error {
	var verifiedAt *time.Time
	if verified {
		now := time.Now()
		verifiedAt = &now
	}

	query := `UPDATE admin_emails SET verified = $2, verified_at = $3 WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id, verified, verifiedAt)
	if err != nil {
		return fmt.Errorf("failed to set admin email verified: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Set admin email verified", zap.String("id", id), zap.Bool("verified", verified))
	return nil
}

// GetPrimary returns the primary admin email.
func (r *AdminEmailRepository) GetPrimary(ctx context.Context) (*domain.AdminEmail, error) {
	query := `
		SELECT id, email, name, role, notifications, verified, verified_at, created_at
		FROM admin_emails
		WHERE role = 'primary'
		LIMIT 1
	`

	email := &domain.AdminEmail{}
	var role string
	var notificationsJSON []byte

	err := r.db.pool.QueryRow(ctx, query).Scan(
		&email.ID,
		&email.Email,
		&email.Name,
		&role,
		&notificationsJSON,
		&email.Verified,
		&email.VerifiedAt,
		&email.CreatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get primary admin email: %w", err)
	}

	email.Role = domain.AdminEmailRole(role)
	if len(notificationsJSON) > 0 {
		json.Unmarshal(notificationsJSON, &email.Notifications)
	}

	return email, nil
}

// GetByNotificationType returns all admin emails that have a specific notification enabled.
func (r *AdminEmailRepository) GetByNotificationType(ctx context.Context, notificationType string) ([]*domain.AdminEmail, error) {
	query := `
		SELECT id, email, name, role, notifications, verified, verified_at, created_at
		FROM admin_emails
		WHERE verified = TRUE AND notifications->$1 = 'true'
		ORDER BY role ASC, email ASC
	`

	rows, err := r.db.pool.Query(ctx, query, notificationType)
	if err != nil {
		return nil, fmt.Errorf("failed to get admin emails by notification type: %w", err)
	}
	defer rows.Close()

	var emails []*domain.AdminEmail
	for rows.Next() {
		email := &domain.AdminEmail{}
		var role string
		var notificationsJSON []byte

		err := rows.Scan(
			&email.ID,
			&email.Email,
			&email.Name,
			&role,
			&notificationsJSON,
			&email.Verified,
			&email.VerifiedAt,
			&email.CreatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan admin email: %w", err)
		}

		email.Role = domain.AdminEmailRole(role)
		if len(notificationsJSON) > 0 {
			json.Unmarshal(notificationsJSON, &email.Notifications)
		}

		emails = append(emails, email)
	}

	return emails, nil
}

// AdminEmailFilter defines filter criteria for listing admin emails.
type AdminEmailFilter struct {
	Role         domain.AdminEmailRole
	VerifiedOnly bool
}
