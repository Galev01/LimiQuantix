// Package registration provides the registration token service for host enrollment.
package registration

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// Repository defines the interface for registration token persistence.
type Repository interface {
	Create(ctx context.Context, token *domain.RegistrationToken) (*domain.RegistrationToken, error)
	Get(ctx context.Context, id string) (*domain.RegistrationToken, error)
	GetByToken(ctx context.Context, tokenStr string) (*domain.RegistrationToken, error)
	List(ctx context.Context, includeExpired bool) ([]*domain.RegistrationToken, error)
	Update(ctx context.Context, token *domain.RegistrationToken) (*domain.RegistrationToken, error)
	Delete(ctx context.Context, id string) error
	IncrementUsage(ctx context.Context, id string, nodeID string) error
	Revoke(ctx context.Context, id string) error
}

// Service handles registration token operations.
type Service struct {
	repo   Repository
	logger *zap.Logger
}

// NewService creates a new registration token service.
func NewService(repo Repository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		logger: logger.Named("registration-service"),
	}
}

// CreateTokenRequest contains parameters for creating a new token.
type CreateTokenRequest struct {
	Description   string        // Optional description
	ExpiresIn     time.Duration // How long until expiration (default 24h)
	MaxUses       int           // Maximum number of uses (0 = unlimited)
	ClusterID     string        // Optional cluster ID
	CreatedBy     string        // User who created the token
}

// CreateToken generates a new registration token.
func (s *Service) CreateToken(ctx context.Context, req CreateTokenRequest) (*domain.RegistrationToken, error) {
	logger := s.logger.With(
		zap.String("method", "CreateToken"),
		zap.String("description", req.Description),
		zap.Duration("expires_in", req.ExpiresIn),
		zap.Int("max_uses", req.MaxUses),
	)

	// Generate token string
	tokenStr, err := domain.GenerateToken()
	if err != nil {
		logger.Error("Failed to generate token", zap.Error(err))
		return nil, errors.New("failed to generate token")
	}

	// Set defaults
	expiresIn := req.ExpiresIn
	if expiresIn == 0 {
		expiresIn = 24 * time.Hour
	}

	now := time.Now()
	token := &domain.RegistrationToken{
		Token:       tokenStr,
		Description: req.Description,
		ClusterID:   req.ClusterID,
		ExpiresAt:   now.Add(expiresIn),
		MaxUses:     req.MaxUses,
		UseCount:    0,
		UsedByNodes: []string{},
		CreatedAt:   now,
		CreatedBy:   req.CreatedBy,
	}

	created, err := s.repo.Create(ctx, token)
	if err != nil {
		logger.Error("Failed to create token", zap.Error(err))
		return nil, err
	}

	logger.Info("Registration token created",
		zap.String("token_id", created.ID),
		zap.Time("expires_at", created.ExpiresAt),
	)

	return created, nil
}

// GetToken retrieves a token by ID.
func (s *Service) GetToken(ctx context.Context, id string) (*domain.RegistrationToken, error) {
	return s.repo.Get(ctx, id)
}

// ListTokens returns all tokens.
func (s *Service) ListTokens(ctx context.Context, includeExpired bool) ([]*domain.RegistrationToken, error) {
	return s.repo.List(ctx, includeExpired)
}

// ValidateToken checks if a token is valid for registration.
// Returns the token if valid, or an error explaining why it's invalid.
func (s *Service) ValidateToken(ctx context.Context, tokenStr string) (*domain.RegistrationToken, error) {
	logger := s.logger.With(
		zap.String("method", "ValidateToken"),
	)

	token, err := s.repo.GetByToken(ctx, tokenStr)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			logger.Debug("Token not found")
			return nil, errors.New("invalid registration token")
		}
		logger.Error("Failed to lookup token", zap.Error(err))
		return nil, err
	}

	if token.IsExpired() {
		logger.Debug("Token expired",
			zap.String("token_id", token.ID),
			zap.Time("expired_at", token.ExpiresAt),
		)
		return nil, errors.New("registration token has expired")
	}

	if token.IsRevoked() {
		logger.Debug("Token revoked", zap.String("token_id", token.ID))
		return nil, errors.New("registration token has been revoked")
	}

	if token.IsExhausted() {
		logger.Debug("Token exhausted",
			zap.String("token_id", token.ID),
			zap.Int("max_uses", token.MaxUses),
			zap.Int("use_count", token.UseCount),
		)
		return nil, errors.New("registration token has reached maximum uses")
	}

	return token, nil
}

// UseToken marks a token as used by a node.
// This should be called after successful node registration.
func (s *Service) UseToken(ctx context.Context, tokenStr string, nodeID string) error {
	logger := s.logger.With(
		zap.String("method", "UseToken"),
		zap.String("node_id", nodeID),
	)

	token, err := s.repo.GetByToken(ctx, tokenStr)
	if err != nil {
		return err
	}

	if err := s.repo.IncrementUsage(ctx, token.ID, nodeID); err != nil {
		logger.Error("Failed to increment token usage", zap.Error(err))
		return err
	}

	logger.Info("Registration token used",
		zap.String("token_id", token.ID),
		zap.Int("new_use_count", token.UseCount+1),
	)

	return nil
}

// RevokeToken revokes a token, preventing further use.
func (s *Service) RevokeToken(ctx context.Context, id string) error {
	logger := s.logger.With(
		zap.String("method", "RevokeToken"),
		zap.String("token_id", id),
	)

	if err := s.repo.Revoke(ctx, id); err != nil {
		logger.Error("Failed to revoke token", zap.Error(err))
		return err
	}

	logger.Info("Registration token revoked")
	return nil
}

// DeleteToken permanently deletes a token.
func (s *Service) DeleteToken(ctx context.Context, id string) error {
	logger := s.logger.With(
		zap.String("method", "DeleteToken"),
		zap.String("token_id", id),
	)

	if err := s.repo.Delete(ctx, id); err != nil {
		logger.Error("Failed to delete token", zap.Error(err))
		return err
	}

	logger.Info("Registration token deleted")
	return nil
}
