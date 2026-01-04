// Package admin provides administrative services for the limiquantix platform.
package admin

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
)

// AuditRepository defines the interface for audit log data access.
type AuditRepository interface {
	Create(ctx context.Context, entry *domain.AuditEntry) error
	List(ctx context.Context, filter postgres.AuditFilter, limit int, offset int) ([]*domain.AuditEntry, int64, error)
	GetStats(ctx context.Context, startTime, endTime time.Time) (*postgres.AuditStats, error)
	DeleteOld(ctx context.Context, retentionDays int) (int64, error)
	Export(ctx context.Context, filter postgres.AuditFilter) (<-chan *domain.AuditEntry, <-chan error)
}

// AuditService provides audit log management functionality.
type AuditService struct {
	auditRepo      AuditRepository
	retentionDays  int
	logger         *zap.Logger
}

// NewAuditService creates a new audit service.
func NewAuditService(auditRepo AuditRepository, retentionDays int, logger *zap.Logger) *AuditService {
	if retentionDays <= 0 {
		retentionDays = 90 // Default 90 days
	}
	return &AuditService{
		auditRepo:     auditRepo,
		retentionDays: retentionDays,
		logger:        logger.With(zap.String("service", "audit")),
	}
}

// Log creates a new audit log entry.
func (s *AuditService) Log(ctx context.Context, entry *domain.AuditEntry) error {
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now()
	}

	if err := s.auditRepo.Create(ctx, entry); err != nil {
		s.logger.Error("Failed to create audit entry",
			zap.Error(err),
			zap.String("action", string(entry.Action)),
			zap.String("resource_type", entry.ResourceType),
		)
		return fmt.Errorf("failed to log audit entry: %w", err)
	}

	return nil
}

// LogAction is a convenience method for logging common actions.
func (s *AuditService) LogAction(ctx context.Context, userID, username string, action domain.AuditAction, resourceType, resourceID, resourceName, ipAddress, userAgent string, details map[string]interface{}) error {
	entry := &domain.AuditEntry{
		UserID:       userID,
		Username:     username,
		Action:       action,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		ResourceName: resourceName,
		IPAddress:    ipAddress,
		UserAgent:    userAgent,
		Details:      details,
	}
	return s.Log(ctx, entry)
}

// Query returns audit log entries matching the filter.
func (s *AuditService) Query(ctx context.Context, filter postgres.AuditFilter, limit, offset int) ([]*domain.AuditEntry, int64, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 1000 {
		limit = 1000
	}

	return s.auditRepo.List(ctx, filter, limit, offset)
}

// QueryByUser returns audit entries for a specific user.
func (s *AuditService) QueryByUser(ctx context.Context, userID string, limit, offset int) ([]*domain.AuditEntry, int64, error) {
	return s.Query(ctx, postgres.AuditFilter{UserID: userID}, limit, offset)
}

// QueryByResource returns audit entries for a specific resource.
func (s *AuditService) QueryByResource(ctx context.Context, resourceType, resourceID string, limit, offset int) ([]*domain.AuditEntry, int64, error) {
	return s.Query(ctx, postgres.AuditFilter{
		ResourceType: resourceType,
		ResourceID:   resourceID,
	}, limit, offset)
}

// QueryByTimeRange returns audit entries within a time range.
func (s *AuditService) QueryByTimeRange(ctx context.Context, start, end time.Time, limit, offset int) ([]*domain.AuditEntry, int64, error) {
	return s.Query(ctx, postgres.AuditFilter{
		StartTime: &start,
		EndTime:   &end,
	}, limit, offset)
}

// GetStats returns audit statistics for a time period.
func (s *AuditService) GetStats(ctx context.Context, start, end time.Time) (*postgres.AuditStats, error) {
	return s.auditRepo.GetStats(ctx, start, end)
}

// GetRecentStats returns stats for the last N days.
func (s *AuditService) GetRecentStats(ctx context.Context, days int) (*postgres.AuditStats, error) {
	end := time.Now()
	start := end.AddDate(0, 0, -days)
	return s.GetStats(ctx, start, end)
}

// ExportToCSV exports audit logs to a CSV writer.
func (s *AuditService) ExportToCSV(ctx context.Context, filter postgres.AuditFilter, writer io.Writer) error {
	s.logger.Info("Exporting audit logs to CSV")

	csvWriter := csv.NewWriter(writer)
	defer csvWriter.Flush()

	// Write header
	header := []string{
		"Timestamp", "User ID", "Username", "Action",
		"Resource Type", "Resource ID", "Resource Name",
		"IP Address", "User Agent", "Details",
	}
	if err := csvWriter.Write(header); err != nil {
		return fmt.Errorf("failed to write CSV header: %w", err)
	}

	// Stream entries
	entryChan, errChan := s.auditRepo.Export(ctx, filter)
	
	for {
		select {
		case entry, ok := <-entryChan:
			if !ok {
				s.logger.Info("Audit export completed")
				return nil
			}

			detailsJSON := ""
			if entry.Details != nil {
				if b, err := json.Marshal(entry.Details); err == nil {
					detailsJSON = string(b)
				}
			}

			row := []string{
				entry.CreatedAt.Format(time.RFC3339),
				entry.UserID,
				entry.Username,
				string(entry.Action),
				entry.ResourceType,
				entry.ResourceID,
				entry.ResourceName,
				entry.IPAddress,
				entry.UserAgent,
				detailsJSON,
			}

			if err := csvWriter.Write(row); err != nil {
				return fmt.Errorf("failed to write CSV row: %w", err)
			}

		case err := <-errChan:
			if err != nil {
				return fmt.Errorf("export error: %w", err)
			}

		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// ExportToJSON exports audit logs to a JSON writer.
func (s *AuditService) ExportToJSON(ctx context.Context, filter postgres.AuditFilter, writer io.Writer) error {
	s.logger.Info("Exporting audit logs to JSON")

	encoder := json.NewEncoder(writer)

	// Write opening bracket
	if _, err := writer.Write([]byte("[\n")); err != nil {
		return fmt.Errorf("failed to write JSON opening: %w", err)
	}

	entryChan, errChan := s.auditRepo.Export(ctx, filter)
	first := true

	for {
		select {
		case entry, ok := <-entryChan:
			if !ok {
				// Write closing bracket
				if _, err := writer.Write([]byte("\n]")); err != nil {
					return fmt.Errorf("failed to write JSON closing: %w", err)
				}
				s.logger.Info("Audit export completed")
				return nil
			}

			// Add comma separator
			if !first {
				if _, err := writer.Write([]byte(",\n")); err != nil {
					return fmt.Errorf("failed to write separator: %w", err)
				}
			}
			first = false

			if err := encoder.Encode(entry); err != nil {
				return fmt.Errorf("failed to encode entry: %w", err)
			}

		case err := <-errChan:
			if err != nil {
				return fmt.Errorf("export error: %w", err)
			}

		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// Cleanup removes old audit entries based on retention policy.
func (s *AuditService) Cleanup(ctx context.Context) (int64, error) {
	s.logger.Info("Running audit log cleanup", zap.Int("retention_days", s.retentionDays))

	deleted, err := s.auditRepo.DeleteOld(ctx, s.retentionDays)
	if err != nil {
		s.logger.Error("Audit cleanup failed", zap.Error(err))
		return 0, fmt.Errorf("failed to cleanup old audit entries: %w", err)
	}

	if deleted > 0 {
		s.logger.Info("Audit cleanup completed", zap.Int64("deleted", deleted))
	}

	return deleted, nil
}

// SetRetentionDays updates the retention period.
func (s *AuditService) SetRetentionDays(days int) {
	if days > 0 {
		s.retentionDays = days
	}
}

// GetRetentionDays returns the current retention period.
func (s *AuditService) GetRetentionDays() int {
	return s.retentionDays
}
