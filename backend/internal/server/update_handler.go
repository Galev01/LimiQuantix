// Package server provides HTTP handlers for the control plane.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/services/update"
)

// UpdateHandler handles update-related REST API requests
type UpdateHandler struct {
	service *update.Service
	logger  *zap.Logger
}

// NewUpdateHandler creates a new update handler
func NewUpdateHandler(service *update.Service, logger *zap.Logger) *UpdateHandler {
	return &UpdateHandler{
		service: service,
		logger:  logger.Named("update-handler"),
	}
}

// RegisterRoutes registers the update API routes
func (h *UpdateHandler) RegisterRoutes(mux *http.ServeMux) {
	// vDC self-update endpoints
	mux.HandleFunc("/api/v1/updates/vdc/status", h.handleVDCStatus)
	mux.HandleFunc("/api/v1/updates/vdc/check", h.handleVDCCheck)
	mux.HandleFunc("/api/v1/updates/vdc/apply", h.handleVDCApply)

	// Host update endpoints
	mux.HandleFunc("/api/v1/updates/hosts", h.handleHostsStatus)
	mux.HandleFunc("/api/v1/updates/hosts/check", h.handleHostsCheck)
	mux.HandleFunc("/api/v1/updates/hosts/", h.handleHostUpdate)

	// Configuration endpoints
	mux.HandleFunc("/api/v1/updates/config", h.handleConfig)
}

// ========================================================================
// vDC Update Handlers
// ========================================================================

// handleVDCStatus returns the current vDC update status
func (h *UpdateHandler) handleVDCStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	state := h.service.GetVDCState()
	h.writeJSON(w, state)
}

// handleVDCCheck checks for vDC updates
func (h *UpdateHandler) handleVDCCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	manifest, err := h.service.CheckVDCUpdate(r.Context())
	if err != nil {
		h.logger.Error("Failed to check vDC update", zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	state := h.service.GetVDCState()
	h.writeJSON(w, map[string]interface{}{
		"status":            state.Status,
		"current_version":   state.CurrentVersion,
		"available_version": state.AvailableVersion,
		"manifest":          manifest,
	})
}

// handleVDCApply applies the available vDC update
func (h *UpdateHandler) handleVDCApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Start update in background
	go func() {
		if err := h.service.ApplyVDCUpdate(r.Context()); err != nil {
			h.logger.Error("Failed to apply vDC update", zap.Error(err))
		}
	}()

	h.writeJSON(w, map[string]interface{}{
		"status":  "applying",
		"message": "Update started in background",
	})
}

// ========================================================================
// Host Update Handlers
// ========================================================================

// handleHostsStatus returns update status for all connected hosts
func (h *UpdateHandler) handleHostsStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	states := h.service.GetHostStates()

	// Convert to slice for JSON
	var hosts []*update.HostUpdateInfo
	for _, info := range states {
		hosts = append(hosts, info)
	}

	h.writeJSON(w, map[string]interface{}{
		"hosts": hosts,
		"count": len(hosts),
	})
}

// handleHostsCheck checks for updates on all hosts
func (h *UpdateHandler) handleHostsCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	hosts, err := h.service.CheckAllHostUpdates(r.Context())
	if err != nil {
		h.logger.Error("Failed to check host updates", zap.Error(err))
		// Don't fail completely - return partial results
	}

	// Count available updates
	available := 0
	for _, host := range hosts {
		if host.Status == update.StatusAvailable {
			available++
		}
	}

	h.writeJSON(w, map[string]interface{}{
		"hosts":              hosts,
		"total":              len(hosts),
		"updates_available":  available,
	})
}

// handleHostUpdate handles individual host update operations
func (h *UpdateHandler) handleHostUpdate(w http.ResponseWriter, r *http.Request) {
	// Parse node ID from path: /api/v1/updates/hosts/{nodeId}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/updates/hosts/")
	parts := strings.Split(path, "/")

	if len(parts) < 1 || parts[0] == "" {
		http.Error(w, "Node ID required", http.StatusBadRequest)
		return
	}

	nodeID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	switch {
	case r.Method == http.MethodGet && action == "":
		h.handleHostStatus(w, r, nodeID)
	case r.Method == http.MethodPost && action == "check":
		h.handleHostCheck(w, r, nodeID)
	case r.Method == http.MethodPost && action == "apply":
		h.handleHostApply(w, r, nodeID)
	default:
		http.Error(w, "Not found", http.StatusNotFound)
	}
}

func (h *UpdateHandler) handleHostStatus(w http.ResponseWriter, r *http.Request, nodeID string) {
	states := h.service.GetHostStates()
	info, exists := states[nodeID]
	if !exists {
		h.writeError(w, http.StatusNotFound, "Host not found")
		return
	}
	h.writeJSON(w, info)
}

func (h *UpdateHandler) handleHostCheck(w http.ResponseWriter, r *http.Request, nodeID string) {
	info, err := h.service.CheckHostUpdate(r.Context(), nodeID)
	if err != nil {
		h.logger.Error("Failed to check host update", zap.String("node_id", nodeID), zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.writeJSON(w, info)
}

func (h *UpdateHandler) handleHostApply(w http.ResponseWriter, r *http.Request, nodeID string) {
	if err := h.service.ApplyHostUpdate(r.Context(), nodeID); err != nil {
		h.logger.Error("Failed to apply host update", zap.String("node_id", nodeID), zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"status":  "applying",
		"message": "Update triggered on host",
		"node_id": nodeID,
	})
}

// ========================================================================
// Configuration Handlers
// ========================================================================

// handleConfig handles update configuration get/set
func (h *UpdateHandler) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		config := h.service.GetConfig()
		h.writeJSON(w, config)

	case http.MethodPut, http.MethodPost:
		var config update.Config
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid JSON: "+err.Error())
			return
		}
		h.service.UpdateConfig(config)
		h.writeJSON(w, map[string]interface{}{
			"status":  "updated",
			"config":  config,
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// ========================================================================
// Helper Methods
// ========================================================================

func (h *UpdateHandler) writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to encode JSON response", zap.Error(err))
	}
}

func (h *UpdateHandler) writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
