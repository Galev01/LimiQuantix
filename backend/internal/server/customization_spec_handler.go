// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
)

// CustomizationSpecHandler handles HTTP requests for customization spec management.
type CustomizationSpecHandler struct {
	repo   *postgres.CustomizationSpecRepository
	logger *zap.Logger
}

// NewCustomizationSpecHandler creates a new customization spec handler.
func NewCustomizationSpecHandler(repo *postgres.CustomizationSpecRepository, logger *zap.Logger) *CustomizationSpecHandler {
	return &CustomizationSpecHandler{
		repo:   repo,
		logger: logger.Named("customization-spec-handler"),
	}
}

// RegisterRoutes registers customization spec API routes.
func (h *CustomizationSpecHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/customization-specs", h.handleSpecs)
	mux.HandleFunc("/api/customization-specs/", h.handleSpecByID)
}

// handleSpecs handles GET /api/customization-specs and POST /api/customization-specs
func (h *CustomizationSpecHandler) handleSpecs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listSpecs(w, r)
	case http.MethodPost:
		h.createSpec(w, r)
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleSpecByID handles requests to /api/customization-specs/{id}
func (h *CustomizationSpecHandler) handleSpecByID(w http.ResponseWriter, r *http.Request) {
	// Parse path: /api/customization-specs/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/customization-specs/")
	if path == "" {
		http.Error(w, "Spec ID required", http.StatusBadRequest)
		return
	}

	specID := path

	switch r.Method {
	case http.MethodGet:
		h.getSpec(w, r, specID)
	case http.MethodPut:
		h.updateSpec(w, r, specID)
	case http.MethodDelete:
		h.deleteSpec(w, r, specID)
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// listSpecs handles GET /api/customization-specs
func (h *CustomizationSpecHandler) listSpecs(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	filter := domain.CustomizationSpecFilter{
		ProjectID: r.URL.Query().Get("project_id"),
		Type:      domain.CustomizationSpecType(r.URL.Query().Get("type")),
		Name:      r.URL.Query().Get("name"),
	}

	specs, err := h.repo.List(ctx, filter)
	if err != nil {
		h.logger.Error("Failed to list customization specs", zap.Error(err))
		h.writeError(w, "Failed to list customization specs", http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"specs": specs,
		"total": len(specs),
	})
}

// createSpec handles POST /api/customization-specs
func (h *CustomizationSpecHandler) createSpec(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var spec domain.CustomizationSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if err := spec.Validate(); err != nil {
		h.writeError(w, "Validation failed: name, project_id, and type are required", http.StatusBadRequest)
		return
	}

	h.logger.Info("Creating customization spec",
		zap.String("name", spec.Name),
		zap.String("type", string(spec.Type)),
		zap.String("project_id", spec.ProjectID),
	)

	if err := h.repo.Create(ctx, &spec); err != nil {
		h.logger.Error("Failed to create customization spec",
			zap.String("name", spec.Name),
			zap.Error(err),
		)
		if err == domain.ErrAlreadyExists {
			h.writeError(w, "A customization spec with this name already exists in the project", http.StatusConflict)
			return
		}
		h.writeError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, http.StatusCreated, spec)
}

// getSpec handles GET /api/customization-specs/{id}
func (h *CustomizationSpecHandler) getSpec(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()

	spec, err := h.repo.Get(ctx, id)
	if err != nil {
		h.logger.Error("Failed to get customization spec",
			zap.String("id", id),
			zap.Error(err),
		)
		if err == domain.ErrNotFound {
			h.writeError(w, "Customization spec not found", http.StatusNotFound)
			return
		}
		h.writeError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, http.StatusOK, spec)
}

// updateSpec handles PUT /api/customization-specs/{id}
func (h *CustomizationSpecHandler) updateSpec(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()

	var spec domain.CustomizationSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	spec.ID = id

	// Validate required fields
	if err := spec.Validate(); err != nil {
		h.writeError(w, "Validation failed: name, project_id, and type are required", http.StatusBadRequest)
		return
	}

	if err := h.repo.Update(ctx, &spec); err != nil {
		h.logger.Error("Failed to update customization spec",
			zap.String("id", id),
			zap.Error(err),
		)
		if err == domain.ErrNotFound {
			h.writeError(w, "Customization spec not found", http.StatusNotFound)
			return
		}
		h.writeError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, http.StatusOK, spec)
}

// deleteSpec handles DELETE /api/customization-specs/{id}
func (h *CustomizationSpecHandler) deleteSpec(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()

	if err := h.repo.Delete(ctx, id); err != nil {
		h.logger.Error("Failed to delete customization spec",
			zap.String("id", id),
			zap.Error(err),
		)
		if err == domain.ErrNotFound {
			h.writeError(w, "Customization spec not found", http.StatusNotFound)
			return
		}
		h.writeError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// writeJSON writes a JSON response.
func (h *CustomizationSpecHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to encode JSON response", zap.Error(err))
	}
}

// writeError writes an error response.
func (h *CustomizationSpecHandler) writeError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
