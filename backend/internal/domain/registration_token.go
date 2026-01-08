// Package domain contains domain models for the control plane.
package domain

import (
	"crypto/rand"
	"encoding/base32"
	"strings"
	"time"
)

// RegistrationToken represents a token used for host registration.
// Hosts must provide a valid token to join the cluster.
type RegistrationToken struct {
	ID          string    `json:"id"`
	Token       string    `json:"token"`
	Description string    `json:"description,omitempty"`
	ClusterID   string    `json:"cluster_id,omitempty"`
	ExpiresAt   time.Time `json:"expires_at"`
	MaxUses     int       `json:"max_uses"`     // 0 = unlimited
	UseCount    int       `json:"use_count"`    // How many times it has been used
	UsedByNodes []string  `json:"used_by_nodes"` // Node IDs that used this token
	CreatedAt   time.Time `json:"created_at"`
	CreatedBy   string    `json:"created_by,omitempty"`
	RevokedAt   *time.Time `json:"revoked_at,omitempty"`
}

// IsExpired returns true if the token has expired.
func (t *RegistrationToken) IsExpired() bool {
	return time.Now().After(t.ExpiresAt)
}

// IsRevoked returns true if the token has been revoked.
func (t *RegistrationToken) IsRevoked() bool {
	return t.RevokedAt != nil
}

// IsExhausted returns true if the token has reached its usage limit.
func (t *RegistrationToken) IsExhausted() bool {
	return t.MaxUses > 0 && t.UseCount >= t.MaxUses
}

// IsValid returns true if the token can be used for registration.
func (t *RegistrationToken) IsValid() bool {
	return !t.IsExpired() && !t.IsRevoked() && !t.IsExhausted()
}

// RemainingUses returns the number of remaining uses, or -1 for unlimited.
func (t *RegistrationToken) RemainingUses() int {
	if t.MaxUses == 0 {
		return -1
	}
	remaining := t.MaxUses - t.UseCount
	if remaining < 0 {
		return 0
	}
	return remaining
}

// GenerateToken creates a cryptographically secure registration token.
// Format: QUANTIX-XXXX-XXXX-XXXX-XXXX (20 chars + prefix/dashes)
func GenerateToken() (string, error) {
	// Generate 12 random bytes (will give us 20 base32 chars)
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	
	// Encode to base32 and format
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(bytes)
	encoded = strings.ToUpper(encoded)
	
	// Format as QUANTIX-XXXX-XXXX-XXXX-XXXX
	if len(encoded) >= 16 {
		return "QUANTIX-" + encoded[0:4] + "-" + encoded[4:8] + "-" + encoded[8:12] + "-" + encoded[12:16], nil
	}
	
	return "QUANTIX-" + encoded, nil
}
