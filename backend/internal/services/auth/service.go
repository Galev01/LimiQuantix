// Package auth provides authentication and authorization services.
package auth

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

// UserRepository defines the interface for user data access.
type UserRepository interface {
	Create(ctx context.Context, user *domain.User) (*domain.User, error)
	Get(ctx context.Context, id string) (*domain.User, error)
	GetByUsername(ctx context.Context, username string) (*domain.User, error)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	List(ctx context.Context, limit int, offset int) ([]*domain.User, int, error)
	Update(ctx context.Context, user *domain.User) (*domain.User, error)
	Delete(ctx context.Context, id string) error
	UpdateLastLogin(ctx context.Context, id string) error
}

// AuditRepository defines the interface for audit log storage.
type AuditRepository interface {
	Create(ctx context.Context, entry *domain.AuditEntry) error
	List(ctx context.Context, filter AuditFilter, limit int, offset int) ([]*domain.AuditEntry, int, error)
}

// AuditFilter defines filter criteria for audit logs.
type AuditFilter struct {
	UserID       string
	Action       domain.AuditAction
	ResourceType string
	ResourceID   string
	StartTime    *time.Time
	EndTime      *time.Time
}

// SessionStore defines the interface for session storage (e.g., Redis).
type SessionStore interface {
	SetSession(ctx context.Context, sessionID string, userID string) error
	GetSession(ctx context.Context, sessionID string) (string, error)
	DeleteSession(ctx context.Context, sessionID string) error
}

// Service provides authentication and user management functionality.
type Service struct {
	userRepo     UserRepository
	auditRepo    AuditRepository
	sessionStore SessionStore
	jwtManager   *JWTManager
	logger       *zap.Logger
}

// NewService creates a new auth service.
func NewService(
	userRepo UserRepository,
	auditRepo AuditRepository,
	sessionStore SessionStore,
	jwtManager *JWTManager,
	logger *zap.Logger,
) *Service {
	return &Service{
		userRepo:     userRepo,
		auditRepo:    auditRepo,
		sessionStore: sessionStore,
		jwtManager:   jwtManager,
		logger:       logger.With(zap.String("service", "auth")),
	}
}

// LoginRequest contains login credentials.
type LoginRequest struct {
	Username  string
	Password  string
	IPAddress string
	UserAgent string
}

// LoginResponse contains the result of a successful login.
type LoginResponse struct {
	User      *domain.User
	Tokens    *TokenPair
	SessionID string
}

// Login authenticates a user and returns tokens.
func (s *Service) Login(ctx context.Context, req *LoginRequest) (*LoginResponse, error) {
	s.logger.Info("Login attempt", zap.String("username", req.Username))

	// Find user by username
	user, err := s.userRepo.GetByUsername(ctx, req.Username)
	if err != nil {
		if err == domain.ErrNotFound {
			s.logger.Warn("Login failed: user not found", zap.String("username", req.Username))
			s.auditFailedLogin(ctx, req.Username, req.IPAddress, req.UserAgent, "user not found")
			return nil, fmt.Errorf("invalid credentials")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	// Check if user is enabled
	if !user.Enabled {
		s.logger.Warn("Login failed: user disabled", zap.String("username", req.Username))
		s.auditFailedLogin(ctx, req.Username, req.IPAddress, req.UserAgent, "user disabled")
		return nil, fmt.Errorf("account is disabled")
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		s.logger.Warn("Login failed: invalid password", zap.String("username", req.Username))
		s.auditFailedLogin(ctx, req.Username, req.IPAddress, req.UserAgent, "invalid password")
		return nil, fmt.Errorf("invalid credentials")
	}

	// Generate tokens
	tokens, err := s.jwtManager.Generate(user)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	// Create session
	sessionID := tokens.AccessToken[:32] // Use first 32 chars as session ID
	if s.sessionStore != nil {
		if err := s.sessionStore.SetSession(ctx, sessionID, user.ID); err != nil {
			s.logger.Warn("Failed to create session", zap.Error(err))
		}
	}

	// Update last login
	if err := s.userRepo.UpdateLastLogin(ctx, user.ID); err != nil {
		s.logger.Warn("Failed to update last login", zap.Error(err))
	}

	// Audit successful login
	s.auditLogin(ctx, user, req.IPAddress, req.UserAgent)

	s.logger.Info("Login successful",
		zap.String("user_id", user.ID),
		zap.String("username", user.Username),
		zap.String("role", string(user.Role)),
	)

	return &LoginResponse{
		User:      user,
		Tokens:    tokens,
		SessionID: sessionID,
	}, nil
}

// Logout invalidates a user session.
func (s *Service) Logout(ctx context.Context, sessionID string, userID string) error {
	if s.sessionStore != nil {
		if err := s.sessionStore.DeleteSession(ctx, sessionID); err != nil {
			s.logger.Warn("Failed to delete session", zap.Error(err))
		}
	}

	// Audit logout
	if s.auditRepo != nil {
		entry := &domain.AuditEntry{
			UserID:    userID,
			Action:    domain.AuditActionLogout,
			CreatedAt: time.Now(),
		}
		if err := s.auditRepo.Create(ctx, entry); err != nil {
			s.logger.Warn("Failed to audit logout", zap.Error(err))
		}
	}

	return nil
}

// RefreshTokens generates new tokens from a refresh token.
func (s *Service) RefreshTokens(ctx context.Context, refreshToken string) (*TokenPair, error) {
	// Verify refresh token
	userID, err := s.jwtManager.VerifyRefreshToken(refreshToken)
	if err != nil {
		return nil, fmt.Errorf("invalid refresh token: %w", err)
	}

	// Get user
	user, err := s.userRepo.Get(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	if !user.Enabled {
		return nil, fmt.Errorf("account is disabled")
	}

	// Generate new tokens
	tokens, err := s.jwtManager.Generate(user)
	if err != nil {
		return nil, fmt.Errorf("failed to generate tokens: %w", err)
	}

	return tokens, nil
}

// ValidateToken validates an access token and returns the claims.
func (s *Service) ValidateToken(ctx context.Context, token string) (*Claims, error) {
	return s.jwtManager.Verify(token)
}

// CreateUser creates a new user account.
func (s *Service) CreateUser(ctx context.Context, username, email, password string, role domain.Role) (*domain.User, error) {
	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &domain.User{
		Username:     username,
		Email:        email,
		PasswordHash: string(hashedPassword),
		Role:         role,
		Enabled:      true,
	}

	created, err := s.userRepo.Create(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	s.logger.Info("User created",
		zap.String("user_id", created.ID),
		zap.String("username", created.Username),
		zap.String("role", string(created.Role)),
	)

	return created, nil
}

// ChangePassword changes a user's password.
func (s *Service) ChangePassword(ctx context.Context, userID, oldPassword, newPassword string) error {
	user, err := s.userRepo.Get(ctx, userID)
	if err != nil {
		return fmt.Errorf("user not found: %w", err)
	}

	// Verify old password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return fmt.Errorf("invalid current password")
	}

	// Hash new password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	user.PasswordHash = string(hashedPassword)
	if _, err := s.userRepo.Update(ctx, user); err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}

	s.logger.Info("Password changed", zap.String("user_id", userID))
	return nil
}

// GetUser retrieves a user by ID.
func (s *Service) GetUser(ctx context.Context, id string) (*domain.User, error) {
	return s.userRepo.Get(ctx, id)
}

// ListUsers returns a paginated list of users.
func (s *Service) ListUsers(ctx context.Context, limit, offset int) ([]*domain.User, int, error) {
	return s.userRepo.List(ctx, limit, offset)
}

// UpdateUser updates a user's profile.
func (s *Service) UpdateUser(ctx context.Context, user *domain.User) (*domain.User, error) {
	return s.userRepo.Update(ctx, user)
}

// DeleteUser removes a user account.
func (s *Service) DeleteUser(ctx context.Context, id string) error {
	return s.userRepo.Delete(ctx, id)
}

// CheckPermission checks if a user has a specific permission.
func (s *Service) CheckPermission(ctx context.Context, userID string, permission domain.Permission) (bool, error) {
	user, err := s.userRepo.Get(ctx, userID)
	if err != nil {
		return false, err
	}

	if !user.Enabled {
		return false, nil
	}

	return domain.HasPermission(user.Role, permission), nil
}

// =============================================================================
// Audit helpers
// =============================================================================

func (s *Service) auditLogin(ctx context.Context, user *domain.User, ipAddress, userAgent string) {
	if s.auditRepo == nil {
		return
	}

	entry := &domain.AuditEntry{
		UserID:    user.ID,
		Username:  user.Username,
		Action:    domain.AuditActionLogin,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		CreatedAt: time.Now(),
	}

	if err := s.auditRepo.Create(ctx, entry); err != nil {
		s.logger.Warn("Failed to audit login", zap.Error(err))
	}
}

func (s *Service) auditFailedLogin(ctx context.Context, username, ipAddress, userAgent, reason string) {
	if s.auditRepo == nil {
		return
	}

	entry := &domain.AuditEntry{
		Username:  username,
		Action:    domain.AuditActionLogin,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		Details:   map[string]interface{}{"success": false, "reason": reason},
		CreatedAt: time.Now(),
	}

	if err := s.auditRepo.Create(ctx, entry); err != nil {
		s.logger.Warn("Failed to audit failed login", zap.Error(err))
	}
}
