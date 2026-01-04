// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// AuditRepository implements audit log storage using PostgreSQL.
type AuditRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewAuditRepository creates a new PostgreSQL audit repository.
func NewAuditRepository(db *DB, logger *zap.Logger) *AuditRepository {
	return &AuditRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "audit")),
	}
}

// Create stores a new audit log entry.
func (r *AuditRepository) Create(ctx context.Context, entry *domain.AuditEntry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now()
	}

	detailsJSON, err := json.Marshal(entry.Details)
	if err != nil {
		detailsJSON = []byte("{}")
	}

	query := `
		INSERT INTO audit_log (
			id, user_id, username, action, resource_type, resource_id, 
			resource_name, details, ip_address, user_agent, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11)
	`

	_, err = r.db.pool.Exec(ctx, query,
		entry.ID,
		nullString(entry.UserID),
		entry.Username,
		string(entry.Action),
		entry.ResourceType,
		nullString(entry.ResourceID),
		entry.ResourceName,
		detailsJSON,
		nullString(entry.IPAddress),
		entry.UserAgent,
		entry.CreatedAt,
	)

	if err != nil {
		r.logger.Error("Failed to create audit entry", zap.Error(err))
		return fmt.Errorf("failed to insert audit entry: %w", err)
	}

	return nil
}

// List returns paginated audit log entries matching the filter.
func (r *AuditRepository) List(ctx context.Context, filter AuditFilter, limit int, offset int) ([]*domain.AuditEntry, int64, error) {
	query := `
		SELECT id, user_id, username, action, resource_type, resource_id, 
		       resource_name, details, ip_address, user_agent, created_at
		FROM audit_log
		WHERE 1=1
	`
	countQuery := `SELECT COUNT(*) FROM audit_log WHERE 1=1`
	args := []interface{}{}
	countArgs := []interface{}{}
	argNum := 1

	if filter.UserID != "" {
		query += fmt.Sprintf(" AND user_id = $%d", argNum)
		countQuery += fmt.Sprintf(" AND user_id = $%d", argNum)
		args = append(args, filter.UserID)
		countArgs = append(countArgs, filter.UserID)
		argNum++
	}

	if filter.Username != "" {
		query += fmt.Sprintf(" AND username ILIKE $%d", argNum)
		countQuery += fmt.Sprintf(" AND username ILIKE $%d", argNum)
		args = append(args, "%"+filter.Username+"%")
		countArgs = append(countArgs, "%"+filter.Username+"%")
		argNum++
	}

	if filter.Action != "" {
		query += fmt.Sprintf(" AND action = $%d", argNum)
		countQuery += fmt.Sprintf(" AND action = $%d", argNum)
		args = append(args, string(filter.Action))
		countArgs = append(countArgs, string(filter.Action))
		argNum++
	}

	if filter.ResourceType != "" {
		query += fmt.Sprintf(" AND resource_type = $%d", argNum)
		countQuery += fmt.Sprintf(" AND resource_type = $%d", argNum)
		args = append(args, filter.ResourceType)
		countArgs = append(countArgs, filter.ResourceType)
		argNum++
	}

	if filter.ResourceID != "" {
		query += fmt.Sprintf(" AND resource_id = $%d", argNum)
		countQuery += fmt.Sprintf(" AND resource_id = $%d", argNum)
		args = append(args, filter.ResourceID)
		countArgs = append(countArgs, filter.ResourceID)
		argNum++
	}

	if filter.StartTime != nil {
		query += fmt.Sprintf(" AND created_at >= $%d", argNum)
		countQuery += fmt.Sprintf(" AND created_at >= $%d", argNum)
		args = append(args, *filter.StartTime)
		countArgs = append(countArgs, *filter.StartTime)
		argNum++
	}

	if filter.EndTime != nil {
		query += fmt.Sprintf(" AND created_at <= $%d", argNum)
		countQuery += fmt.Sprintf(" AND created_at <= $%d", argNum)
		args = append(args, *filter.EndTime)
		countArgs = append(countArgs, *filter.EndTime)
		argNum++
	}

	if filter.IPAddress != "" {
		query += fmt.Sprintf(" AND ip_address = $%d::inet", argNum)
		countQuery += fmt.Sprintf(" AND ip_address = $%d::inet", argNum)
		args = append(args, filter.IPAddress)
		countArgs = append(countArgs, filter.IPAddress)
		argNum++
	}

	// Order and pagination
	query += " ORDER BY created_at DESC"
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argNum, argNum+1)
	args = append(args, limit, offset)

	// Execute main query
	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to list audit logs: %w", err)
	}
	defer rows.Close()

	var entries []*domain.AuditEntry
	for rows.Next() {
		entry := &domain.AuditEntry{}
		var detailsJSON []byte
		var userID, resourceID, ipAddress *string

		err := rows.Scan(
			&entry.ID,
			&userID,
			&entry.Username,
			&entry.Action,
			&entry.ResourceType,
			&resourceID,
			&entry.ResourceName,
			&detailsJSON,
			&ipAddress,
			&entry.UserAgent,
			&entry.CreatedAt,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("failed to scan audit entry: %w", err)
		}

		if userID != nil {
			entry.UserID = *userID
		}
		if resourceID != nil {
			entry.ResourceID = *resourceID
		}
		if ipAddress != nil {
			entry.IPAddress = *ipAddress
		}
		if len(detailsJSON) > 0 {
			json.Unmarshal(detailsJSON, &entry.Details)
		}

		entries = append(entries, entry)
	}

	// Get total count
	var total int64
	err = r.db.pool.QueryRow(ctx, countQuery, countArgs...).Scan(&total)
	if err != nil {
		r.logger.Warn("Failed to get audit count", zap.Error(err))
	}

	return entries, total, nil
}

// GetStats returns audit log statistics.
func (r *AuditRepository) GetStats(ctx context.Context, startTime, endTime time.Time) (*AuditStats, error) {
	query := `
		SELECT 
			action,
			COUNT(*) as count
		FROM audit_log
		WHERE created_at >= $1 AND created_at <= $2
		GROUP BY action
		ORDER BY count DESC
	`

	rows, err := r.db.pool.Query(ctx, query, startTime, endTime)
	if err != nil {
		return nil, fmt.Errorf("failed to get audit stats: %w", err)
	}
	defer rows.Close()

	stats := &AuditStats{
		ActionCounts: make(map[domain.AuditAction]int64),
		StartTime:    startTime,
		EndTime:      endTime,
	}

	for rows.Next() {
		var action string
		var count int64
		if err := rows.Scan(&action, &count); err != nil {
			return nil, fmt.Errorf("failed to scan audit stats: %w", err)
		}
		stats.ActionCounts[domain.AuditAction(action)] = count
		stats.TotalEntries += count
	}

	// Get unique users
	userQuery := `
		SELECT COUNT(DISTINCT user_id) 
		FROM audit_log 
		WHERE created_at >= $1 AND created_at <= $2 AND user_id IS NOT NULL
	`
	err = r.db.pool.QueryRow(ctx, userQuery, startTime, endTime).Scan(&stats.UniqueUsers)
	if err != nil {
		r.logger.Warn("Failed to get unique user count", zap.Error(err))
	}

	return stats, nil
}

// DeleteOld removes audit entries older than the specified retention period.
func (r *AuditRepository) DeleteOld(ctx context.Context, retentionDays int) (int64, error) {
	query := `DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '1 day' * $1`

	result, err := r.db.pool.Exec(ctx, query, retentionDays)
	if err != nil {
		return 0, fmt.Errorf("failed to delete old audit entries: %w", err)
	}

	count := result.RowsAffected()
	if count > 0 {
		r.logger.Info("Deleted old audit entries",
			zap.Int64("count", count),
			zap.Int("retention_days", retentionDays),
		)
	}

	return count, nil
}

// Export returns audit entries for export in a streaming fashion.
func (r *AuditRepository) Export(ctx context.Context, filter AuditFilter) (<-chan *domain.AuditEntry, <-chan error) {
	entryChan := make(chan *domain.AuditEntry, 100)
	errChan := make(chan error, 1)

	go func() {
		defer close(entryChan)
		defer close(errChan)

		query := `
			SELECT id, user_id, username, action, resource_type, resource_id, 
			       resource_name, details, ip_address, user_agent, created_at
			FROM audit_log
			WHERE 1=1
		`
		args := []interface{}{}
		argNum := 1

		if filter.StartTime != nil {
			query += fmt.Sprintf(" AND created_at >= $%d", argNum)
			args = append(args, *filter.StartTime)
			argNum++
		}

		if filter.EndTime != nil {
			query += fmt.Sprintf(" AND created_at <= $%d", argNum)
			args = append(args, *filter.EndTime)
			argNum++
		}

		query += " ORDER BY created_at ASC"

		rows, err := r.db.pool.Query(ctx, query, args...)
		if err != nil {
			errChan <- fmt.Errorf("failed to export audit logs: %w", err)
			return
		}
		defer rows.Close()

		for rows.Next() {
			entry := &domain.AuditEntry{}
			var detailsJSON []byte
			var userID, resourceID, ipAddress *string

			err := rows.Scan(
				&entry.ID,
				&userID,
				&entry.Username,
				&entry.Action,
				&entry.ResourceType,
				&resourceID,
				&entry.ResourceName,
				&detailsJSON,
				&ipAddress,
				&entry.UserAgent,
				&entry.CreatedAt,
			)
			if err != nil {
				errChan <- fmt.Errorf("failed to scan export entry: %w", err)
				return
			}

			if userID != nil {
				entry.UserID = *userID
			}
			if resourceID != nil {
				entry.ResourceID = *resourceID
			}
			if ipAddress != nil {
				entry.IPAddress = *ipAddress
			}
			if len(detailsJSON) > 0 {
				json.Unmarshal(detailsJSON, &entry.Details)
			}

			select {
			case entryChan <- entry:
			case <-ctx.Done():
				errChan <- ctx.Err()
				return
			}
		}
	}()

	return entryChan, errChan
}

// AuditFilter defines filter criteria for listing audit logs.
type AuditFilter struct {
	UserID       string
	Username     string
	Action       domain.AuditAction
	ResourceType string
	ResourceID   string
	StartTime    *time.Time
	EndTime      *time.Time
	IPAddress    string
}

// AuditStats contains audit log statistics.
type AuditStats struct {
	TotalEntries int64                         `json:"total_entries"`
	UniqueUsers  int64                         `json:"unique_users"`
	ActionCounts map[domain.AuditAction]int64  `json:"action_counts"`
	StartTime    time.Time                     `json:"start_time"`
	EndTime      time.Time                     `json:"end_time"`
}
