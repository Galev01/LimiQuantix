// Package memory provides in-memory repository implementations for development and testing.
package memory

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// RegistrationTokenRepository is an in-memory implementation of the registration token repository.
type RegistrationTokenRepository struct {
	mu   sync.RWMutex
	data map[string]*domain.RegistrationToken
	// Index for token lookup (token string -> ID)
	tokenIndex map[string]string
}

// NewRegistrationTokenRepository creates a new in-memory registration token repository.
func NewRegistrationTokenRepository() *RegistrationTokenRepository {
	return &RegistrationTokenRepository{
		data:       make(map[string]*domain.RegistrationToken),
		tokenIndex: make(map[string]string),
	}
}

// Create stores a new registration token.
func (r *RegistrationTokenRepository) Create(ctx context.Context, token *domain.RegistrationToken) (*domain.RegistrationToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// Generate ID if not set
	if token.ID == "" {
		token.ID = uuid.New().String()
	}

	// Set timestamp if not set
	if token.CreatedAt.IsZero() {
		token.CreatedAt = time.Now()
	}

	// Clone and store
	stored := cloneToken(token)
	r.data[stored.ID] = stored
	r.tokenIndex[stored.Token] = stored.ID

	return cloneToken(stored), nil
}

// Get retrieves a token by ID.
func (r *RegistrationTokenRepository) Get(ctx context.Context, id string) (*domain.RegistrationToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	token, ok := r.data[id]
	if !ok {
		return nil, domain.ErrNotFound
	}

	return cloneToken(token), nil
}

// GetByToken retrieves a token by its token string value.
func (r *RegistrationTokenRepository) GetByToken(ctx context.Context, tokenStr string) (*domain.RegistrationToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	id, ok := r.tokenIndex[tokenStr]
	if !ok {
		return nil, domain.ErrNotFound
	}

	token, ok := r.data[id]
	if !ok {
		return nil, domain.ErrNotFound
	}

	return cloneToken(token), nil
}

// List returns all tokens.
func (r *RegistrationTokenRepository) List(ctx context.Context, includeExpired bool) ([]*domain.RegistrationToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*domain.RegistrationToken
	now := time.Now()

	for _, token := range r.data {
		// Skip expired tokens if requested
		if !includeExpired && now.After(token.ExpiresAt) {
			continue
		}
		result = append(result, cloneToken(token))
	}

	return result, nil
}

// Update updates an existing token.
func (r *RegistrationTokenRepository) Update(ctx context.Context, token *domain.RegistrationToken) (*domain.RegistrationToken, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	existing, ok := r.data[token.ID]
	if !ok {
		return nil, domain.ErrNotFound
	}

	// Update token index if token string changed
	if existing.Token != token.Token {
		delete(r.tokenIndex, existing.Token)
		r.tokenIndex[token.Token] = token.ID
	}

	stored := cloneToken(token)
	r.data[token.ID] = stored

	return cloneToken(stored), nil
}

// Delete removes a token by ID.
func (r *RegistrationTokenRepository) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	token, ok := r.data[id]
	if !ok {
		return domain.ErrNotFound
	}

	delete(r.tokenIndex, token.Token)
	delete(r.data, id)
	return nil
}

// IncrementUsage increments the use count and records the node ID.
func (r *RegistrationTokenRepository) IncrementUsage(ctx context.Context, id string, nodeID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	token, ok := r.data[id]
	if !ok {
		return domain.ErrNotFound
	}

	token.UseCount++
	token.UsedByNodes = append(token.UsedByNodes, nodeID)

	return nil
}

// Revoke marks a token as revoked.
func (r *RegistrationTokenRepository) Revoke(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	token, ok := r.data[id]
	if !ok {
		return domain.ErrNotFound
	}

	now := time.Now()
	token.RevokedAt = &now

	return nil
}

// cloneToken creates a deep copy of a RegistrationToken.
func cloneToken(t *domain.RegistrationToken) *domain.RegistrationToken {
	if t == nil {
		return nil
	}

	clone := *t

	// Clone slices
	if t.UsedByNodes != nil {
		clone.UsedByNodes = make([]string, len(t.UsedByNodes))
		copy(clone.UsedByNodes, t.UsedByNodes)
	}

	// Clone pointers
	if t.RevokedAt != nil {
		revoked := *t.RevokedAt
		clone.RevokedAt = &revoked
	}

	return &clone
}
