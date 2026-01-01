// Package alert provides system alerting and notification services.
package alert

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// Repository defines the interface for alert data access.
type Repository interface {
	Create(ctx context.Context, alert *domain.Alert) (*domain.Alert, error)
	Get(ctx context.Context, id string) (*domain.Alert, error)
	List(ctx context.Context, filter AlertFilter, limit int, offset int) ([]*domain.Alert, int, error)
	Update(ctx context.Context, alert *domain.Alert) (*domain.Alert, error)
	Delete(ctx context.Context, id string) error
	GetUnresolved(ctx context.Context, severity domain.AlertSeverity) ([]*domain.Alert, error)
	CountBySeverity(ctx context.Context) (map[domain.AlertSeverity]int, error)
}

// AlertFilter defines filter criteria for listing alerts.
type AlertFilter struct {
	Severity     domain.AlertSeverity
	SourceType   domain.AlertSourceType
	SourceID     string
	Acknowledged *bool
	Resolved     *bool
	StartTime    *time.Time
	EndTime      *time.Time
}

// EventPublisher publishes alert events for real-time updates.
type EventPublisher interface {
	PublishAlert(ctx context.Context, eventType string, alert *domain.Alert) error
}

// Service provides alert management functionality.
type Service struct {
	repo      Repository
	publisher EventPublisher
	logger    *zap.Logger
}

// NewService creates a new alert service.
func NewService(repo Repository, publisher EventPublisher, logger *zap.Logger) *Service {
	return &Service{
		repo:      repo,
		publisher: publisher,
		logger:    logger.With(zap.String("service", "alert")),
	}
}

// CreateAlert creates a new alert.
func (s *Service) CreateAlert(ctx context.Context, severity domain.AlertSeverity, sourceType domain.AlertSourceType, sourceID, sourceName, title, message string) (*domain.Alert, error) {
	alert := &domain.Alert{
		ID:         uuid.NewString(),
		Severity:   severity,
		Title:      title,
		Message:    message,
		SourceType: sourceType,
		SourceID:   sourceID,
		SourceName: sourceName,
		CreatedAt:  time.Now(),
	}

	created, err := s.repo.Create(ctx, alert)
	if err != nil {
		return nil, fmt.Errorf("failed to create alert: %w", err)
	}

	s.logger.Info("Alert created",
		zap.String("id", created.ID),
		zap.String("severity", string(created.Severity)),
		zap.String("title", created.Title),
		zap.String("source_type", string(created.SourceType)),
		zap.String("source_id", created.SourceID),
	)

	// Publish event for real-time updates
	if s.publisher != nil {
		if err := s.publisher.PublishAlert(ctx, "alert.created", created); err != nil {
			s.logger.Warn("Failed to publish alert event", zap.Error(err))
		}
	}

	return created, nil
}

// GetAlert retrieves an alert by ID.
func (s *Service) GetAlert(ctx context.Context, id string) (*domain.Alert, error) {
	return s.repo.Get(ctx, id)
}

// ListAlerts returns a paginated list of alerts.
func (s *Service) ListAlerts(ctx context.Context, filter AlertFilter, limit, offset int) ([]*domain.Alert, int, error) {
	return s.repo.List(ctx, filter, limit, offset)
}

// AcknowledgeAlert marks an alert as acknowledged.
func (s *Service) AcknowledgeAlert(ctx context.Context, id, acknowledgedBy string) (*domain.Alert, error) {
	alert, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	if alert.Acknowledged {
		return alert, nil // Already acknowledged
	}

	now := time.Now()
	alert.Acknowledged = true
	alert.AcknowledgedBy = acknowledgedBy
	alert.AcknowledgedAt = &now

	updated, err := s.repo.Update(ctx, alert)
	if err != nil {
		return nil, fmt.Errorf("failed to acknowledge alert: %w", err)
	}

	s.logger.Info("Alert acknowledged",
		zap.String("id", id),
		zap.String("acknowledged_by", acknowledgedBy),
	)

	if s.publisher != nil {
		s.publisher.PublishAlert(ctx, "alert.acknowledged", updated)
	}

	return updated, nil
}

// ResolveAlert marks an alert as resolved.
func (s *Service) ResolveAlert(ctx context.Context, id string) (*domain.Alert, error) {
	alert, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	if alert.Resolved {
		return alert, nil // Already resolved
	}

	now := time.Now()
	alert.Resolved = true
	alert.ResolvedAt = &now

	updated, err := s.repo.Update(ctx, alert)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve alert: %w", err)
	}

	s.logger.Info("Alert resolved", zap.String("id", id))

	if s.publisher != nil {
		s.publisher.PublishAlert(ctx, "alert.resolved", updated)
	}

	return updated, nil
}

// DeleteAlert removes an alert.
func (s *Service) DeleteAlert(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

// GetUnresolvedAlerts returns all unresolved alerts of a specific severity.
func (s *Service) GetUnresolvedAlerts(ctx context.Context, severity domain.AlertSeverity) ([]*domain.Alert, error) {
	return s.repo.GetUnresolved(ctx, severity)
}

// GetAlertSummary returns a count of alerts by severity.
func (s *Service) GetAlertSummary(ctx context.Context) (*AlertSummary, error) {
	counts, err := s.repo.CountBySeverity(ctx)
	if err != nil {
		return nil, err
	}

	return &AlertSummary{
		Critical: counts[domain.AlertSeverityCritical],
		Warning:  counts[domain.AlertSeverityWarning],
		Info:     counts[domain.AlertSeverityInfo],
	}, nil
}

// AlertSummary contains alert counts by severity.
type AlertSummary struct {
	Critical int `json:"critical"`
	Warning  int `json:"warning"`
	Info     int `json:"info"`
}

// =============================================================================
// Alert Generators - Create alerts from system events
// =============================================================================

// VMAlert creates a VM-related alert.
func (s *Service) VMAlert(ctx context.Context, severity domain.AlertSeverity, vmID, vmName, title, message string) (*domain.Alert, error) {
	return s.CreateAlert(ctx, severity, domain.AlertSourceVM, vmID, vmName, title, message)
}

// NodeAlert creates a node-related alert.
func (s *Service) NodeAlert(ctx context.Context, severity domain.AlertSeverity, nodeID, nodeName, title, message string) (*domain.Alert, error) {
	return s.CreateAlert(ctx, severity, domain.AlertSourceNode, nodeID, nodeName, title, message)
}

// StorageAlert creates a storage-related alert.
func (s *Service) StorageAlert(ctx context.Context, severity domain.AlertSeverity, storageID, storageName, title, message string) (*domain.Alert, error) {
	return s.CreateAlert(ctx, severity, domain.AlertSourceStorage, storageID, storageName, title, message)
}

// ClusterAlert creates a cluster-related alert.
func (s *Service) ClusterAlert(ctx context.Context, severity domain.AlertSeverity, clusterID, clusterName, title, message string) (*domain.Alert, error) {
	return s.CreateAlert(ctx, severity, domain.AlertSourceCluster, clusterID, clusterName, title, message)
}

// SystemAlert creates a system-wide alert.
func (s *Service) SystemAlert(ctx context.Context, severity domain.AlertSeverity, title, message string) (*domain.Alert, error) {
	return s.CreateAlert(ctx, severity, domain.AlertSourceSystem, "system", "LimiQuantix", title, message)
}
