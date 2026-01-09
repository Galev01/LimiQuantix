// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/services/cluster"
)

// ClusterHandler handles HTTP requests for cluster management.
type ClusterHandler struct {
	service *cluster.Service
	logger  *zap.Logger
}

// NewClusterHandler creates a new cluster handler.
func NewClusterHandler(service *cluster.Service, logger *zap.Logger) *ClusterHandler {
	return &ClusterHandler{
		service: service,
		logger:  logger.Named("cluster-handler"),
	}
}

// RegisterRoutes registers cluster API routes.
func (h *ClusterHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/clusters", h.handleClusters)
	mux.HandleFunc("/api/clusters/", h.handleClusterByID)
}

// handleClusters handles GET /api/clusters and POST /api/clusters
func (h *ClusterHandler) handleClusters(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.listClusters(w, r)
	case http.MethodPost:
		h.createCluster(w, r)
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleClusterByID handles requests to /api/clusters/{id}
func (h *ClusterHandler) handleClusterByID(w http.ResponseWriter, r *http.Request) {
	// Parse path: /api/clusters/{id} or /api/clusters/{id}/hosts/{hostId}
	path := strings.TrimPrefix(r.URL.Path, "/api/clusters/")
	parts := strings.Split(path, "/")

	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Cluster ID required", http.StatusBadRequest)
		return
	}

	clusterID := parts[0]

	// Check for sub-resources
	if len(parts) >= 2 {
		switch parts[1] {
		case "hosts":
			h.handleClusterHosts(w, r, clusterID, parts[2:])
			return
		}
	}

	// Handle cluster CRUD
	switch r.Method {
	case http.MethodGet:
		h.getCluster(w, r, clusterID)
	case http.MethodPut:
		h.updateCluster(w, r, clusterID)
	case http.MethodDelete:
		h.deleteCluster(w, r, clusterID)
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleClusterHosts handles /api/clusters/{id}/hosts endpoints
func (h *ClusterHandler) handleClusterHosts(w http.ResponseWriter, r *http.Request, clusterID string, parts []string) {
	switch r.Method {
	case http.MethodGet:
		// GET /api/clusters/{id}/hosts - List hosts in cluster
		h.listClusterHosts(w, r, clusterID)
	case http.MethodPost:
		// POST /api/clusters/{id}/hosts - Add host to cluster
		h.addHostToCluster(w, r, clusterID)
	case http.MethodDelete:
		// DELETE /api/clusters/{id}/hosts/{hostId} - Remove host from cluster
		if len(parts) == 0 || parts[0] == "" {
			http.Error(w, "Host ID required", http.StatusBadRequest)
			return
		}
		h.removeHostFromCluster(w, r, clusterID, parts[0])
	case http.MethodOptions:
		w.WriteHeader(http.StatusOK)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// listClusters handles GET /api/clusters
func (h *ClusterHandler) listClusters(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	projectID := r.URL.Query().Get("project_id")

	clusters, err := h.service.List(ctx, projectID)
	if err != nil {
		h.logger.Error("Failed to list clusters", zap.Error(err))
		h.writeError(w, "Failed to list clusters", http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"clusters": clusters,
		"total":    len(clusters),
	})
}

// createCluster handles POST /api/clusters
func (h *ClusterHandler) createCluster(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req cluster.CreateClusterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	h.logger.Info("Creating cluster",
		zap.String("name", req.Name),
		zap.Bool("ha_enabled", req.HAEnabled),
		zap.Bool("drs_enabled", req.DRSEnabled),
	)

	result, err := h.service.Create(ctx, &req)
	if err != nil {
		h.logger.Error("Failed to create cluster",
			zap.String("name", req.Name),
			zap.Error(err),
		)
		h.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.writeJSON(w, http.StatusCreated, result)
}

// getCluster handles GET /api/clusters/{id}
func (h *ClusterHandler) getCluster(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()

	result, err := h.service.Get(ctx, id)
	if err != nil {
		h.logger.Error("Failed to get cluster",
			zap.String("id", id),
			zap.Error(err),
		)
		h.writeError(w, "Cluster not found", http.StatusNotFound)
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

// updateCluster handles PUT /api/clusters/{id}
func (h *ClusterHandler) updateCluster(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()

	var req cluster.UpdateClusterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	req.ID = id

	result, err := h.service.Update(ctx, &req)
	if err != nil {
		h.logger.Error("Failed to update cluster",
			zap.String("id", id),
			zap.Error(err),
		)
		h.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.writeJSON(w, http.StatusOK, result)
}

// deleteCluster handles DELETE /api/clusters/{id}
func (h *ClusterHandler) deleteCluster(w http.ResponseWriter, r *http.Request, id string) {
	ctx := r.Context()

	if err := h.service.Delete(ctx, id); err != nil {
		h.logger.Error("Failed to delete cluster",
			zap.String("id", id),
			zap.Error(err),
		)
		h.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// listClusterHosts handles GET /api/clusters/{id}/hosts
func (h *ClusterHandler) listClusterHosts(w http.ResponseWriter, r *http.Request, clusterID string) {
	ctx := r.Context()

	hosts, err := h.service.GetHosts(ctx, clusterID)
	if err != nil {
		h.logger.Error("Failed to list cluster hosts",
			zap.String("cluster_id", clusterID),
			zap.Error(err),
		)
		h.writeError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"hosts": hosts,
		"total": len(hosts),
	})
}

// addHostToCluster handles POST /api/clusters/{id}/hosts
func (h *ClusterHandler) addHostToCluster(w http.ResponseWriter, r *http.Request, clusterID string) {
	ctx := r.Context()

	var req struct {
		HostID string `json:"host_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.HostID == "" {
		h.writeError(w, "host_id is required", http.StatusBadRequest)
		return
	}

	if err := h.service.AddHost(ctx, clusterID, req.HostID); err != nil {
		h.logger.Error("Failed to add host to cluster",
			zap.String("cluster_id", clusterID),
			zap.String("host_id", req.HostID),
			zap.Error(err),
		)
		h.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{
		"message": "Host added to cluster",
	})
}

// removeHostFromCluster handles DELETE /api/clusters/{id}/hosts/{hostId}
func (h *ClusterHandler) removeHostFromCluster(w http.ResponseWriter, r *http.Request, clusterID, hostID string) {
	ctx := r.Context()

	if err := h.service.RemoveHost(ctx, clusterID, hostID); err != nil {
		h.logger.Error("Failed to remove host from cluster",
			zap.String("cluster_id", clusterID),
			zap.String("host_id", hostID),
			zap.Error(err),
		)
		h.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// writeJSON writes a JSON response.
func (h *ClusterHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to encode JSON response", zap.Error(err))
	}
}

// writeError writes an error response.
func (h *ClusterHandler) writeError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
