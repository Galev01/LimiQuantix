// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/registration"
)

// RegistrationHandler handles registration token REST API endpoints.
type RegistrationHandler struct {
	service *registration.Service
	logger  *zap.Logger
}

// NewRegistrationHandler creates a new registration handler.
func NewRegistrationHandler(service *registration.Service, logger *zap.Logger) *RegistrationHandler {
	return &RegistrationHandler{
		service: service,
		logger:  logger.Named("registration-handler"),
	}
}

// CreateTokenRequest is the JSON request body for creating a token.
type CreateTokenRequest struct {
	Description   string `json:"description,omitempty"`
	ExpiresInHours int    `json:"expires_in_hours,omitempty"` // Default 24
	MaxUses       int    `json:"max_uses,omitempty"`         // 0 = unlimited
}

// TokenResponse is the JSON response for a token.
type TokenResponse struct {
	ID          string   `json:"id"`
	Token       string   `json:"token"`
	Description string   `json:"description,omitempty"`
	ExpiresAt   string   `json:"expires_at"`
	MaxUses     int      `json:"max_uses"`
	UseCount    int      `json:"use_count"`
	UsedByNodes []string `json:"used_by_nodes,omitempty"`
	IsValid     bool     `json:"is_valid"`
	CreatedAt   string   `json:"created_at"`
	CreatedBy   string   `json:"created_by,omitempty"`
	RevokedAt   *string  `json:"revoked_at,omitempty"`
}

// ListTokensResponse is the JSON response for listing tokens.
type ListTokensResponse struct {
	Tokens     []TokenResponse `json:"tokens"`
	TotalCount int             `json:"total_count"`
}

// RegisterRoutes registers the registration token routes.
func (h *RegistrationHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/admin/registration-tokens", h.handleTokens)
	mux.HandleFunc("/api/admin/registration-tokens/", h.handleToken)
	h.logger.Info("Registered registration token routes")
}

// handleTokens handles GET (list) and POST (create) for /api/admin/registration-tokens
func (h *RegistrationHandler) handleTokens(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listTokens(w, r)
	case http.MethodPost:
		h.createToken(w, r)
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleToken handles GET, DELETE, POST for /api/admin/registration-tokens/{id}
func (h *RegistrationHandler) handleToken(w http.ResponseWriter, r *http.Request) {
	// Extract ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/registration-tokens/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Token ID required", http.StatusBadRequest)
		return
	}
	
	id := parts[0]
	
	// Check for action (e.g., /api/admin/registration-tokens/{id}/revoke)
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch r.Method {
	case http.MethodGet:
		h.getToken(w, r, id)
	case http.MethodDelete:
		h.deleteToken(w, r, id)
	case http.MethodPost:
		if action == "revoke" {
			h.revokeToken(w, r, id)
		} else {
			http.Error(w, "Invalid action", http.StatusBadRequest)
		}
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// listTokens handles GET /api/admin/registration-tokens
func (h *RegistrationHandler) listTokens(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	// Check query param for including expired
	includeExpired := r.URL.Query().Get("include_expired") == "true"
	
	tokens, err := h.service.ListTokens(ctx, includeExpired)
	if err != nil {
		h.logger.Error("Failed to list tokens", zap.Error(err))
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	
	response := ListTokensResponse{
		Tokens:     make([]TokenResponse, 0, len(tokens)),
		TotalCount: len(tokens),
	}
	
	for _, t := range tokens {
		response.Tokens = append(response.Tokens, toTokenResponse(t))
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// createToken handles POST /api/admin/registration-tokens
func (h *RegistrationHandler) createToken(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	var req CreateTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Allow empty body for defaults
		req = CreateTokenRequest{}
	}
	
	// Convert hours to duration (default 24h)
	expiresIn := time.Duration(req.ExpiresInHours) * time.Hour
	if expiresIn == 0 {
		expiresIn = 24 * time.Hour
	}
	
	createReq := registration.CreateTokenRequest{
		Description: req.Description,
		ExpiresIn:   expiresIn,
		MaxUses:     req.MaxUses,
		CreatedBy:   "admin", // TODO: Get from auth context
	}
	
	token, err := h.service.CreateToken(ctx, createReq)
	if err != nil {
		h.logger.Error("Failed to create token", zap.Error(err))
		http.Error(w, "Failed to create token", http.StatusInternalServerError)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(toTokenResponse(token))
}

// getToken handles GET /api/admin/registration-tokens/{id}
func (h *RegistrationHandler) getToken(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()
	
	token, err := h.service.GetToken(ctx, id)
	if err != nil {
		h.logger.Error("Failed to get token", zap.String("id", id), zap.Error(err))
		http.Error(w, "Token not found", http.StatusNotFound)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toTokenResponse(token))
}

// deleteToken handles DELETE /api/admin/registration-tokens/{id}
func (h *RegistrationHandler) deleteToken(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()
	
	if err := h.service.DeleteToken(ctx, id); err != nil {
		h.logger.Error("Failed to delete token", zap.String("id", id), zap.Error(err))
		http.Error(w, "Failed to delete token", http.StatusInternalServerError)
		return
	}
	
	w.WriteHeader(http.StatusNoContent)
}

// revokeToken handles POST /api/admin/registration-tokens/{id}/revoke
func (h *RegistrationHandler) revokeToken(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()
	
	if err := h.service.RevokeToken(ctx, id); err != nil {
		h.logger.Error("Failed to revoke token", zap.String("id", id), zap.Error(err))
		http.Error(w, "Failed to revoke token", http.StatusInternalServerError)
		return
	}
	
	// Return the updated token
	token, err := h.service.GetToken(ctx, id)
	if err != nil {
		h.logger.Error("Failed to get token after revoke", zap.String("id", id), zap.Error(err))
		http.Error(w, "Token revoked but failed to fetch updated token", http.StatusInternalServerError)
		return
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(toTokenResponse(token))
}

// toTokenResponse converts a domain token to a response.
func toTokenResponse(t *domain.RegistrationToken) TokenResponse {
	resp := TokenResponse{
		ID:          t.ID,
		Token:       t.Token,
		Description: t.Description,
		ExpiresAt:   t.ExpiresAt.Format(time.RFC3339),
		MaxUses:     t.MaxUses,
		UseCount:    t.UseCount,
		UsedByNodes: t.UsedByNodes,
		IsValid:     t.IsValid(),
		CreatedAt:   t.CreatedAt.Format(time.RFC3339),
		CreatedBy:   t.CreatedBy,
	}
	
	if t.RevokedAt != nil {
		revoked := t.RevokedAt.Format(time.RFC3339)
		resp.RevokedAt = &revoked
	}
	
	return resp
}
