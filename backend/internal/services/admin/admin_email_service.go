// Package admin provides administrative services for the limiquantix platform.
package admin

import (
	"context"
	"fmt"
	"net/mail"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
)

// AdminEmailRepository defines the interface for admin email data access.
type AdminEmailRepository interface {
	Create(ctx context.Context, email *domain.AdminEmail) (*domain.AdminEmail, error)
	Get(ctx context.Context, id string) (*domain.AdminEmail, error)
	GetByEmail(ctx context.Context, email string) (*domain.AdminEmail, error)
	List(ctx context.Context, filter postgres.AdminEmailFilter) ([]*domain.AdminEmail, error)
	Update(ctx context.Context, email *domain.AdminEmail) (*domain.AdminEmail, error)
	Delete(ctx context.Context, id string) error
	SetVerified(ctx context.Context, id string, verified bool) error
	GetPrimary(ctx context.Context) (*domain.AdminEmail, error)
	GetByNotificationType(ctx context.Context, notificationType string) ([]*domain.AdminEmail, error)
}

// EmailSender defines the interface for sending emails.
type EmailSender interface {
	SendEmail(ctx context.Context, to, subject, body string) error
}

// AdminEmailService provides admin email management functionality.
type AdminEmailService struct {
	emailRepo   AdminEmailRepository
	emailSender EmailSender // Optional, can be nil
	logger      *zap.Logger
}

// NewAdminEmailService creates a new admin email service.
func NewAdminEmailService(emailRepo AdminEmailRepository, emailSender EmailSender, logger *zap.Logger) *AdminEmailService {
	return &AdminEmailService{
		emailRepo:   emailRepo,
		emailSender: emailSender,
		logger:      logger.With(zap.String("service", "admin_email")),
	}
}

// Add adds a new admin email.
func (s *AdminEmailService) Add(ctx context.Context, emailAddr, name string, role domain.AdminEmailRole) (*domain.AdminEmail, error) {
	s.logger.Info("Adding admin email", zap.String("email", emailAddr), zap.String("role", string(role)))

	// Validate email format
	if _, err := mail.ParseAddress(emailAddr); err != nil {
		return nil, fmt.Errorf("invalid email address format")
	}

	// Check if already exists
	existing, err := s.emailRepo.GetByEmail(ctx, emailAddr)
	if err == nil && existing != nil {
		return nil, domain.ErrAlreadyExists
	}

	// If setting as primary, check that no other primary exists or this replaces it
	if role == domain.AdminEmailPrimary {
		primary, err := s.emailRepo.GetPrimary(ctx)
		if err == nil && primary != nil {
			// Demote existing primary to secondary
			primary.Role = domain.AdminEmailSecondary
			if _, err := s.emailRepo.Update(ctx, primary); err != nil {
				s.logger.Warn("Failed to demote existing primary", zap.Error(err))
			}
		}
	}

	email := &domain.AdminEmail{
		Email:         emailAddr,
		Name:          name,
		Role:          role,
		Notifications: domain.DefaultNotificationSettings(),
		Verified:      false,
	}

	created, err := s.emailRepo.Create(ctx, email)
	if err != nil {
		s.logger.Error("Failed to add admin email", zap.Error(err), zap.String("email", emailAddr))
		return nil, fmt.Errorf("failed to add admin email: %w", err)
	}

	// Send verification email (async)
	if s.emailSender != nil {
		go s.sendVerificationEmail(context.Background(), created)
	}

	s.logger.Info("Added admin email", zap.String("id", created.ID), zap.String("email", emailAddr))
	return created, nil
}

// Get retrieves an admin email by ID.
func (s *AdminEmailService) Get(ctx context.Context, id string) (*domain.AdminEmail, error) {
	return s.emailRepo.Get(ctx, id)
}

// GetByEmail retrieves an admin email by email address.
func (s *AdminEmailService) GetByEmail(ctx context.Context, emailAddr string) (*domain.AdminEmail, error) {
	return s.emailRepo.GetByEmail(ctx, emailAddr)
}

// List returns all admin emails.
func (s *AdminEmailService) List(ctx context.Context, filter postgres.AdminEmailFilter) ([]*domain.AdminEmail, error) {
	return s.emailRepo.List(ctx, filter)
}

// ListAll returns all admin emails without filtering.
func (s *AdminEmailService) ListAll(ctx context.Context) ([]*domain.AdminEmail, error) {
	return s.emailRepo.List(ctx, postgres.AdminEmailFilter{})
}

// Update updates an admin email.
func (s *AdminEmailService) Update(ctx context.Context, id string, name string, role domain.AdminEmailRole, notifications domain.NotificationSettings) (*domain.AdminEmail, error) {
	s.logger.Info("Updating admin email", zap.String("id", id))

	email, err := s.emailRepo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	// If promoting to primary, demote existing primary
	if role == domain.AdminEmailPrimary && email.Role != domain.AdminEmailPrimary {
		primary, err := s.emailRepo.GetPrimary(ctx)
		if err == nil && primary != nil && primary.ID != id {
			primary.Role = domain.AdminEmailSecondary
			if _, err := s.emailRepo.Update(ctx, primary); err != nil {
				s.logger.Warn("Failed to demote existing primary", zap.Error(err))
			}
		}
	}

	email.Name = name
	email.Role = role
	email.Notifications = notifications

	updated, err := s.emailRepo.Update(ctx, email)
	if err != nil {
		s.logger.Error("Failed to update admin email", zap.Error(err), zap.String("id", id))
		return nil, fmt.Errorf("failed to update admin email: %w", err)
	}

	s.logger.Info("Updated admin email", zap.String("id", id))
	return updated, nil
}

// Remove deletes an admin email.
func (s *AdminEmailService) Remove(ctx context.Context, id string) error {
	s.logger.Info("Removing admin email", zap.String("id", id))

	email, err := s.emailRepo.Get(ctx, id)
	if err != nil {
		return err
	}

	// Cannot delete the only primary email
	if email.Role == domain.AdminEmailPrimary {
		emails, err := s.emailRepo.List(ctx, postgres.AdminEmailFilter{})
		if err != nil {
			return err
		}
		if len(emails) <= 1 {
			return fmt.Errorf("cannot delete the only admin email")
		}
	}

	if err := s.emailRepo.Delete(ctx, id); err != nil {
		s.logger.Error("Failed to remove admin email", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to remove admin email: %w", err)
	}

	s.logger.Info("Removed admin email", zap.String("id", id))
	return nil
}

// Verify marks an admin email as verified.
func (s *AdminEmailService) Verify(ctx context.Context, id string) error {
	s.logger.Info("Verifying admin email", zap.String("id", id))

	if err := s.emailRepo.SetVerified(ctx, id, true); err != nil {
		return fmt.Errorf("failed to verify admin email: %w", err)
	}

	s.logger.Info("Verified admin email", zap.String("id", id))
	return nil
}

// SendTestEmail sends a test email to an admin email address.
func (s *AdminEmailService) SendTestEmail(ctx context.Context, id string) error {
	s.logger.Info("Sending test email", zap.String("id", id))

	email, err := s.emailRepo.Get(ctx, id)
	if err != nil {
		return err
	}

	if s.emailSender == nil {
		return fmt.Errorf("email sending is not configured")
	}

	subject := "LimiQuantix - Test Email"
	body := fmt.Sprintf(`Hello %s,

This is a test email from your LimiQuantix platform.

If you received this email, your notification settings are working correctly.

Best regards,
LimiQuantix Platform`, email.Name)

	if err := s.emailSender.SendEmail(ctx, email.Email, subject, body); err != nil {
		s.logger.Error("Failed to send test email", zap.Error(err), zap.String("email", email.Email))
		return fmt.Errorf("failed to send test email: %w", err)
	}

	s.logger.Info("Sent test email", zap.String("email", email.Email))
	return nil
}

// GetPrimary returns the primary admin email.
func (s *AdminEmailService) GetPrimary(ctx context.Context) (*domain.AdminEmail, error) {
	return s.emailRepo.GetPrimary(ctx)
}

// GetRecipientsForNotification returns all verified emails that should receive a specific notification type.
func (s *AdminEmailService) GetRecipientsForNotification(ctx context.Context, notificationType string) ([]string, error) {
	emails, err := s.emailRepo.GetByNotificationType(ctx, notificationType)
	if err != nil {
		return nil, err
	}

	recipients := make([]string, len(emails))
	for i, email := range emails {
		recipients[i] = email.Email
	}

	return recipients, nil
}

// GetRecipientsForCriticalAlerts returns emails that should receive critical alerts.
func (s *AdminEmailService) GetRecipientsForCriticalAlerts(ctx context.Context) ([]string, error) {
	return s.GetRecipientsForNotification(ctx, "critical_alerts")
}

// GetRecipientsForSecurityEvents returns emails that should receive security events.
func (s *AdminEmailService) GetRecipientsForSecurityEvents(ctx context.Context) ([]string, error) {
	return s.GetRecipientsForNotification(ctx, "security_events")
}

// sendVerificationEmail sends a verification email to a new admin email.
func (s *AdminEmailService) sendVerificationEmail(ctx context.Context, email *domain.AdminEmail) {
	if s.emailSender == nil {
		return
	}

	subject := "LimiQuantix - Verify Your Admin Email"
	body := fmt.Sprintf(`Hello %s,

Your email address has been added as an admin contact for LimiQuantix.

Please verify your email by clicking the link below:
[Verification link would go here]

If you did not request this, please ignore this email.

Best regards,
LimiQuantix Platform`, email.Name)

	if err := s.emailSender.SendEmail(ctx, email.Email, subject, body); err != nil {
		s.logger.Warn("Failed to send verification email", zap.Error(err), zap.String("email", email.Email))
	}
}
