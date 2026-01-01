// Package auth provides authentication and authorization services.
package auth

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/limiquantix/limiquantix/internal/config"
	"github.com/limiquantix/limiquantix/internal/domain"
)

// Claims represents the JWT claims for LimiQuantix.
type Claims struct {
	UserID   string      `json:"user_id"`
	Username string      `json:"username"`
	Email    string      `json:"email"`
	Role     domain.Role `json:"role"`
	jwt.RegisteredClaims
}

// JWTManager handles JWT token generation and verification.
type JWTManager struct {
	secret        []byte
	tokenExpiry   time.Duration
	refreshExpiry time.Duration
}

// NewJWTManager creates a new JWT manager with the given configuration.
func NewJWTManager(cfg config.AuthConfig) *JWTManager {
	return &JWTManager{
		secret:        []byte(cfg.JWTSecret),
		tokenExpiry:   cfg.TokenExpiry,
		refreshExpiry: cfg.RefreshExpiry,
	}
}

// TokenPair contains both access and refresh tokens.
type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"`
}

// Generate creates a new access and refresh token pair for a user.
func (m *JWTManager) Generate(user *domain.User) (*TokenPair, error) {
	now := time.Now()
	expiresAt := now.Add(m.tokenExpiry)

	// Access token claims
	accessClaims := &Claims{
		UserID:   user.ID,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "limiquantix",
			Subject:   user.ID,
			Audience:  jwt.ClaimStrings{"limiquantix-api"},
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        fmt.Sprintf("%s-%d", user.ID, now.UnixNano()),
		},
	}

	// Sign access token
	accessToken := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims)
	accessTokenString, err := accessToken.SignedString(m.secret)
	if err != nil {
		return nil, fmt.Errorf("failed to sign access token: %w", err)
	}

	// Refresh token claims (minimal claims for security)
	refreshClaims := &Claims{
		UserID: user.ID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "limiquantix",
			Subject:   user.ID,
			Audience:  jwt.ClaimStrings{"limiquantix-refresh"},
			ExpiresAt: jwt.NewNumericDate(now.Add(m.refreshExpiry)),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ID:        fmt.Sprintf("refresh-%s-%d", user.ID, now.UnixNano()),
		},
	}

	// Sign refresh token
	refreshToken := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims)
	refreshTokenString, err := refreshToken.SignedString(m.secret)
	if err != nil {
		return nil, fmt.Errorf("failed to sign refresh token: %w", err)
	}

	return &TokenPair{
		AccessToken:  accessTokenString,
		RefreshToken: refreshTokenString,
		ExpiresAt:    expiresAt,
		TokenType:    "Bearer",
	}, nil
}

// Verify validates a token and returns the claims if valid.
func (m *JWTManager) Verify(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to parse token: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}

	return claims, nil
}

// VerifyRefreshToken verifies a refresh token and returns the user ID.
func (m *JWTManager) VerifyRefreshToken(tokenString string) (string, error) {
	claims, err := m.Verify(tokenString)
	if err != nil {
		return "", err
	}

	// Check if it's a refresh token
	if len(claims.Audience) == 0 || claims.Audience[0] != "limiquantix-refresh" {
		return "", fmt.Errorf("not a refresh token")
	}

	return claims.UserID, nil
}

// GetTokenExpiry returns the access token expiry duration.
func (m *JWTManager) GetTokenExpiry() time.Duration {
	return m.tokenExpiry
}

// GetRefreshExpiry returns the refresh token expiry duration.
func (m *JWTManager) GetRefreshExpiry() time.Duration {
	return m.refreshExpiry
}
