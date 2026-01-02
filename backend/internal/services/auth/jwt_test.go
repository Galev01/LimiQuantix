// Package auth provides tests for the JWT manager.
package auth

import (
	"testing"
	"time"

	"github.com/Quantixkvm/Quantixkvm/internal/config"
	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

func TestJWTManager_Generate(t *testing.T) {
	cfg := config.AuthConfig{
		JWTSecret:     "test-secret-key-at-least-32-bytes-long",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	manager := NewJWTManager(cfg)

	user := &domain.User{
		ID:       "user-123",
		Username: "testuser",
		Email:    "test@example.com",
		Role:     domain.RoleAdmin,
	}

	tokens, err := manager.Generate(user)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	if tokens.AccessToken == "" {
		t.Error("Expected access token to be set")
	}

	if tokens.RefreshToken == "" {
		t.Error("Expected refresh token to be set")
	}

	if tokens.TokenType != "Bearer" {
		t.Errorf("Expected token type 'Bearer', got '%s'", tokens.TokenType)
	}

	if tokens.ExpiresAt.Before(time.Now()) {
		t.Error("Token should not be expired")
	}
}

func TestJWTManager_Verify_ValidToken(t *testing.T) {
	cfg := config.AuthConfig{
		JWTSecret:     "test-secret-key-at-least-32-bytes-long",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	manager := NewJWTManager(cfg)

	user := &domain.User{
		ID:       "user-123",
		Username: "testuser",
		Email:    "test@example.com",
		Role:     domain.RoleAdmin,
	}

	tokens, err := manager.Generate(user)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	claims, err := manager.Verify(tokens.AccessToken)
	if err != nil {
		t.Fatalf("Verify failed: %v", err)
	}

	if claims.UserID != "user-123" {
		t.Errorf("Expected user ID 'user-123', got '%s'", claims.UserID)
	}

	if claims.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", claims.Username)
	}

	if claims.Role != domain.RoleAdmin {
		t.Errorf("Expected role 'admin', got '%s'", claims.Role)
	}
}

func TestJWTManager_Verify_InvalidToken(t *testing.T) {
	cfg := config.AuthConfig{
		JWTSecret:     "test-secret-key-at-least-32-bytes-long",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	manager := NewJWTManager(cfg)

	_, err := manager.Verify("invalid-token")
	if err == nil {
		t.Fatal("Expected error for invalid token")
	}
}

func TestJWTManager_Verify_WrongSecret(t *testing.T) {
	cfg1 := config.AuthConfig{
		JWTSecret:     "secret-key-one-at-least-32-bytes",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	cfg2 := config.AuthConfig{
		JWTSecret:     "secret-key-two-at-least-32-bytes",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	manager1 := NewJWTManager(cfg1)
	manager2 := NewJWTManager(cfg2)

	user := &domain.User{
		ID:       "user-123",
		Username: "testuser",
		Email:    "test@example.com",
		Role:     domain.RoleAdmin,
	}

	tokens, err := manager1.Generate(user)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	// Try to verify with different secret
	_, err = manager2.Verify(tokens.AccessToken)
	if err == nil {
		t.Fatal("Expected error when verifying with wrong secret")
	}
}

func TestJWTManager_VerifyRefreshToken_Valid(t *testing.T) {
	cfg := config.AuthConfig{
		JWTSecret:     "test-secret-key-at-least-32-bytes-long",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	manager := NewJWTManager(cfg)

	user := &domain.User{
		ID:       "user-123",
		Username: "testuser",
		Email:    "test@example.com",
		Role:     domain.RoleAdmin,
	}

	tokens, err := manager.Generate(user)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	userID, err := manager.VerifyRefreshToken(tokens.RefreshToken)
	if err != nil {
		t.Fatalf("VerifyRefreshToken failed: %v", err)
	}

	if userID != "user-123" {
		t.Errorf("Expected user ID 'user-123', got '%s'", userID)
	}
}

func TestJWTManager_VerifyRefreshToken_UsingAccessToken(t *testing.T) {
	cfg := config.AuthConfig{
		JWTSecret:     "test-secret-key-at-least-32-bytes-long",
		TokenExpiry:   15 * time.Minute,
		RefreshExpiry: 24 * time.Hour,
	}

	manager := NewJWTManager(cfg)

	user := &domain.User{
		ID:       "user-123",
		Username: "testuser",
		Email:    "test@example.com",
		Role:     domain.RoleAdmin,
	}

	tokens, err := manager.Generate(user)
	if err != nil {
		t.Fatalf("Generate failed: %v", err)
	}

	// Try to use access token as refresh token
	_, err = manager.VerifyRefreshToken(tokens.AccessToken)
	if err == nil {
		t.Fatal("Expected error when using access token as refresh token")
	}
}
