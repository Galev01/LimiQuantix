// Package admin provides administrative services for the limiquantix platform.
package admin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
)

// APIKeyRepository defines the interface for API key data access.
type APIKeyRepository interface {
	Create(ctx context.Context, key *domain.APIKey) (*domain.APIKey, error)
	Get(ctx context.Context, id string) (*domain.APIKey, error)
	GetByPrefix(ctx context.Context, prefix string) (*domain.APIKey, error)
	List(ctx context.Context, filter postgres.APIKeyFilter) ([]*domain.APIKey, error)
	Delete(ctx context.Context, id string) error
	Revoke(ctx context.Context, id string) error
	TrackUsage(ctx context.Context, id string) error
	ExpireOld(ctx context.Context) (int64, error)
	CountByUser(ctx context.Context, userID string) (int, error)
}

// APIKeyService provides API key management functionality.
type APIKeyService struct {
	keyRepo       APIKeyRepository
	maxKeysPerUser int
	logger        *zap.Logger
}

// NewAPIKeyService creates a new API key service.
func NewAPIKeyService(keyRepo APIKeyRepository, maxKeysPerUser int, logger *zap.Logger) *APIKeyService {
	if maxKeysPerUser <= 0 {
		maxKeysPerUser = 10 // Default limit
	}
	return &APIKeyService{
		keyRepo:       keyRepo,
		maxKeysPerUser: maxKeysPerUser,
		logger:        logger.With(zap.String("service", "api_key")),
	}
}

// GenerateKeyRequest contains parameters for generating a new API key.
type GenerateKeyRequest struct {
	Name        string
	Permissions []domain.Permission
	ExpiresIn   *time.Duration // nil = no expiry
	CreatedBy   string         // User ID
}

// GenerateKeyResponse contains the generated API key (only returned once).
type GenerateKeyResponse struct {
	Key      *domain.APIKey
	RawKey   string // The actual key (only shown once!)
}

// Generate creates a new API key.
func (s *APIKeyService) Generate(ctx context.Context, req *GenerateKeyRequest) (*GenerateKeyResponse, error) {
	s.logger.Info("Generating API key", zap.String("name", req.Name), zap.String("created_by", req.CreatedBy))

	// Validate name
	if req.Name == "" {
		return nil, fmt.Errorf("API key name is required")
	}

	// Check user's key limit
	count, err := s.keyRepo.CountByUser(ctx, req.CreatedBy)
	if err != nil {
		return nil, fmt.Errorf("failed to check key count: %w", err)
	}
	if count >= s.maxKeysPerUser {
		return nil, fmt.Errorf("maximum API keys per user (%d) reached", s.maxKeysPerUser)
	}

	// Generate random key
	rawKey, prefix, err := s.generateRawKey()
	if err != nil {
		return nil, fmt.Errorf("failed to generate key: %w", err)
	}

	// Hash the key
	keyHash, err := bcrypt.GenerateFromPassword([]byte(rawKey), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash key: %w", err)
	}

	// Calculate expiry
	var expiresAt *time.Time
	if req.ExpiresIn != nil {
		exp := time.Now().Add(*req.ExpiresIn)
		expiresAt = &exp
	}

	key := &domain.APIKey{
		Name:        req.Name,
		Prefix:      prefix,
		KeyHash:     string(keyHash),
		Permissions: req.Permissions,
		CreatedBy:   req.CreatedBy,
		ExpiresAt:   expiresAt,
		Status:      domain.APIKeyStatusActive,
	}

	created, err := s.keyRepo.Create(ctx, key)
	if err != nil {
		s.logger.Error("Failed to create API key", zap.Error(err), zap.String("name", req.Name))
		return nil, fmt.Errorf("failed to create API key: %w", err)
	}

	s.logger.Info("Generated API key",
		zap.String("id", created.ID),
		zap.String("prefix", created.Prefix),
		zap.String("created_by", req.CreatedBy),
	)

	return &GenerateKeyResponse{
		Key:    created,
		RawKey: rawKey,
	}, nil
}

// Validate validates an API key and returns the key info if valid.
func (s *APIKeyService) Validate(ctx context.Context, rawKey string) (*domain.APIKey, error) {
	// Extract prefix from key
	prefix := s.extractPrefix(rawKey)
	if prefix == "" {
		return nil, fmt.Errorf("invalid API key format")
	}

	// Find key by prefix
	key, err := s.keyRepo.GetByPrefix(ctx, prefix)
	if err != nil {
		return nil, fmt.Errorf("API key not found")
	}

	// Check if key is valid
	if !key.IsValid() {
		if key.Status == domain.APIKeyStatusRevoked {
			return nil, fmt.Errorf("API key has been revoked")
		}
		if key.Status == domain.APIKeyStatusExpired {
			return nil, fmt.Errorf("API key has expired")
		}
		return nil, fmt.Errorf("API key is not active")
	}

	// Verify key hash
	if err := bcrypt.CompareHashAndPassword([]byte(key.KeyHash), []byte(rawKey)); err != nil {
		s.logger.Warn("API key validation failed: hash mismatch", zap.String("prefix", prefix))
		return nil, fmt.Errorf("invalid API key")
	}

	// Track usage asynchronously
	go func() {
		if err := s.keyRepo.TrackUsage(context.Background(), key.ID); err != nil {
			s.logger.Warn("Failed to track API key usage", zap.Error(err), zap.String("id", key.ID))
		}
	}()

	return key, nil
}

// Get retrieves an API key by ID.
func (s *APIKeyService) Get(ctx context.Context, id string) (*domain.APIKey, error) {
	return s.keyRepo.Get(ctx, id)
}

// List returns all API keys with optional filtering.
func (s *APIKeyService) List(ctx context.Context, filter postgres.APIKeyFilter) ([]*domain.APIKey, error) {
	return s.keyRepo.List(ctx, filter)
}

// ListByUser returns all API keys created by a specific user.
func (s *APIKeyService) ListByUser(ctx context.Context, userID string) ([]*domain.APIKey, error) {
	return s.keyRepo.List(ctx, postgres.APIKeyFilter{CreatedBy: userID})
}

// Revoke revokes an API key.
func (s *APIKeyService) Revoke(ctx context.Context, id string) error {
	s.logger.Info("Revoking API key", zap.String("id", id))

	if err := s.keyRepo.Revoke(ctx, id); err != nil {
		s.logger.Error("Failed to revoke API key", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to revoke API key: %w", err)
	}

	s.logger.Info("Revoked API key", zap.String("id", id))
	return nil
}

// Delete removes an API key.
func (s *APIKeyService) Delete(ctx context.Context, id string) error {
	s.logger.Info("Deleting API key", zap.String("id", id))

	if err := s.keyRepo.Delete(ctx, id); err != nil {
		s.logger.Error("Failed to delete API key", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to delete API key: %w", err)
	}

	s.logger.Info("Deleted API key", zap.String("id", id))
	return nil
}

// ExpireOld marks all expired keys as expired.
func (s *APIKeyService) ExpireOld(ctx context.Context) (int64, error) {
	return s.keyRepo.ExpireOld(ctx)
}

// HasPermission checks if an API key has a specific permission.
func (s *APIKeyService) HasPermission(key *domain.APIKey, permission domain.Permission) bool {
	return key.HasPermission(permission)
}

// generateRawKey generates a secure random API key.
func (s *APIKeyService) generateRawKey() (rawKey, prefix string, err error) {
	// Generate 32 bytes of random data
	randomBytes := make([]byte, 32)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", "", err
	}

	// Create base64-encoded key
	encoded := base64.RawURLEncoding.EncodeToString(randomBytes)

	// Create prefix (first 12 chars for identification)
	prefix = "qx_" + encoded[:8] + "_"

	// Full key is prefix + rest of encoded data
	rawKey = prefix + encoded[8:]

	return rawKey, prefix, nil
}

// extractPrefix extracts the prefix from a raw API key.
func (s *APIKeyService) extractPrefix(rawKey string) string {
	// Key format: qx_XXXXXXXX_YYYYYYYY...
	// Prefix is: qx_XXXXXXXX_
	if !strings.HasPrefix(rawKey, "qx_") {
		return ""
	}

	parts := strings.SplitN(rawKey, "_", 3)
	if len(parts) < 3 {
		return ""
	}

	return parts[0] + "_" + parts[1] + "_"
}
