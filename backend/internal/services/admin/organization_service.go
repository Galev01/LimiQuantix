// Package admin provides administrative services for the limiquantix platform.
package admin

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// OrganizationRepository defines the interface for organization data access.
type OrganizationRepository interface {
	Get(ctx context.Context) (*domain.Organization, error)
	GetByID(ctx context.Context, id string) (*domain.Organization, error)
	Create(ctx context.Context, org *domain.Organization) (*domain.Organization, error)
	Update(ctx context.Context, org *domain.Organization) (*domain.Organization, error)
	UpdateSettings(ctx context.Context, id string, settings domain.OrganizationSettings) error
	UpdateBranding(ctx context.Context, id string, branding domain.OrganizationBranding) error
}

// OrganizationService provides organization management functionality.
type OrganizationService struct {
	orgRepo OrganizationRepository
	logger  *zap.Logger
}

// NewOrganizationService creates a new organization service.
func NewOrganizationService(orgRepo OrganizationRepository, logger *zap.Logger) *OrganizationService {
	return &OrganizationService{
		orgRepo: orgRepo,
		logger:  logger.With(zap.String("service", "organization")),
	}
}

// Get retrieves the organization settings.
func (s *OrganizationService) Get(ctx context.Context) (*domain.Organization, error) {
	return s.orgRepo.Get(ctx)
}

// GetByID retrieves an organization by ID.
func (s *OrganizationService) GetByID(ctx context.Context, id string) (*domain.Organization, error) {
	return s.orgRepo.GetByID(ctx, id)
}

// Update updates the organization.
func (s *OrganizationService) Update(ctx context.Context, org *domain.Organization) (*domain.Organization, error) {
	s.logger.Info("Updating organization", zap.String("id", org.ID))

	// Validate required fields
	if org.Name == "" {
		return nil, fmt.Errorf("organization name is required")
	}

	updated, err := s.orgRepo.Update(ctx, org)
	if err != nil {
		s.logger.Error("Failed to update organization", zap.Error(err), zap.String("id", org.ID))
		return nil, fmt.Errorf("failed to update organization: %w", err)
	}

	s.logger.Info("Updated organization", zap.String("id", org.ID))
	return updated, nil
}

// UpdateSettings updates only the organization settings.
func (s *OrganizationService) UpdateSettings(ctx context.Context, id string, settings domain.OrganizationSettings) error {
	s.logger.Info("Updating organization settings", zap.String("id", id))

	// Validate settings
	if err := s.validateSettings(settings); err != nil {
		return err
	}

	if err := s.orgRepo.UpdateSettings(ctx, id, settings); err != nil {
		s.logger.Error("Failed to update organization settings", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to update settings: %w", err)
	}

	s.logger.Info("Updated organization settings", zap.String("id", id))
	return nil
}

// UpdateBranding updates only the organization branding.
func (s *OrganizationService) UpdateBranding(ctx context.Context, id string, branding domain.OrganizationBranding) error {
	s.logger.Info("Updating organization branding", zap.String("id", id))

	// Validate branding
	if err := s.validateBranding(branding); err != nil {
		return err
	}

	if err := s.orgRepo.UpdateBranding(ctx, id, branding); err != nil {
		s.logger.Error("Failed to update organization branding", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to update branding: %w", err)
	}

	s.logger.Info("Updated organization branding", zap.String("id", id))
	return nil
}

// GetSettings retrieves just the organization settings.
func (s *OrganizationService) GetSettings(ctx context.Context) (domain.OrganizationSettings, error) {
	org, err := s.orgRepo.Get(ctx)
	if err != nil {
		return domain.OrganizationSettings{}, err
	}
	return org.Settings, nil
}

// GetBranding retrieves just the organization branding.
func (s *OrganizationService) GetBranding(ctx context.Context) (domain.OrganizationBranding, error) {
	org, err := s.orgRepo.Get(ctx)
	if err != nil {
		return domain.OrganizationBranding{}, err
	}
	return org.Branding, nil
}

// GetSessionTimeout returns the session timeout in minutes.
func (s *OrganizationService) GetSessionTimeout(ctx context.Context) (int, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return 60, err // Default to 60 minutes
	}
	return settings.SessionTimeout, nil
}

// GetMaxAPIKeysPerUser returns the maximum API keys per user.
func (s *OrganizationService) GetMaxAPIKeysPerUser(ctx context.Context) (int, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return 10, err // Default to 10
	}
	return settings.MaxAPIKeysPerUser, nil
}

// GetPasswordPolicy returns password policy settings.
func (s *OrganizationService) GetPasswordPolicy(ctx context.Context) (minLength int, requireMix bool, err error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return 8, true, err
	}
	return settings.PasswordMinLength, settings.PasswordRequireMix, nil
}

// IsMFARequired returns whether MFA is required for all users.
func (s *OrganizationService) IsMFARequired(ctx context.Context) (bool, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return false, err
	}
	return settings.RequireMFA, nil
}

// IsSelfSignupAllowed returns whether self-signup is allowed.
func (s *OrganizationService) IsSelfSignupAllowed(ctx context.Context) (bool, error) {
	settings, err := s.GetSettings(ctx)
	if err != nil {
		return false, err
	}
	return settings.AllowSelfSignup, nil
}

// validateSettings validates organization settings.
func (s *OrganizationService) validateSettings(settings domain.OrganizationSettings) error {
	if settings.SessionTimeout < 5 {
		return fmt.Errorf("session timeout must be at least 5 minutes")
	}
	if settings.SessionTimeout > 1440 { // 24 hours
		return fmt.Errorf("session timeout cannot exceed 24 hours")
	}

	if settings.MaxAPIKeysPerUser < 1 {
		return fmt.Errorf("max API keys per user must be at least 1")
	}
	if settings.MaxAPIKeysPerUser > 100 {
		return fmt.Errorf("max API keys per user cannot exceed 100")
	}

	if settings.PasswordMinLength < 6 {
		return fmt.Errorf("password minimum length must be at least 6")
	}
	if settings.PasswordMinLength > 128 {
		return fmt.Errorf("password minimum length cannot exceed 128")
	}

	if settings.AuditRetentionDays < 1 {
		return fmt.Errorf("audit retention must be at least 1 day")
	}
	if settings.AuditRetentionDays > 3650 { // 10 years
		return fmt.Errorf("audit retention cannot exceed 10 years")
	}

	return nil
}

// validateBranding validates organization branding.
func (s *OrganizationService) validateBranding(branding domain.OrganizationBranding) error {
	// Validate hex colors
	if branding.PrimaryColor != "" && !isValidHexColor(branding.PrimaryColor) {
		return fmt.Errorf("invalid primary color: must be a valid hex color (e.g., #4064DD)")
	}
	if branding.SecondaryColor != "" && !isValidHexColor(branding.SecondaryColor) {
		return fmt.Errorf("invalid secondary color: must be a valid hex color")
	}

	// Validate URLs
	if branding.LogoURL != "" && len(branding.LogoURL) > 2000 {
		return fmt.Errorf("logo URL is too long")
	}
	if branding.FaviconURL != "" && len(branding.FaviconURL) > 2000 {
		return fmt.Errorf("favicon URL is too long")
	}
	if branding.SupportURL != "" && len(branding.SupportURL) > 2000 {
		return fmt.Errorf("support URL is too long")
	}

	return nil
}

// isValidHexColor checks if a string is a valid hex color.
func isValidHexColor(color string) bool {
	if len(color) != 7 && len(color) != 4 {
		return false
	}
	if color[0] != '#' {
		return false
	}
	for _, c := range color[1:] {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
