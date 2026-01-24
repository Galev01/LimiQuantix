// Package server provides REST API handlers for VM operations.
// These handlers wrap the Connect-RPC service to provide simple REST endpoints
// for frontend clients that prefer REST over gRPC-Web.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"go.uber.org/zap"

	"connectrpc.com/connect"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	vmservice "github.com/limiquantix/limiquantix/internal/services/vm"
)

// VMRestHandler provides REST API endpoints for VM operations.
type VMRestHandler struct {
	server              *Server
	logger              *zap.Logger
	fileTransferHandler *FileTransferHandler
}

// NewVMRestHandler creates a new VM REST handler.
func NewVMRestHandler(s *Server) *VMRestHandler {
	return &VMRestHandler{
		server:              s,
		logger:              s.logger.Named("vm-rest"),
		fileTransferHandler: NewFileTransferHandler(s),
	}
}

// ServeHTTP handles REST API requests for VMs.
// Routes:
//   - POST /api/vms/{id}/start - Power on VM
//   - POST /api/vms/{id}/stop - Graceful shutdown
//   - POST /api/vms/{id}/reboot - Graceful reboot
//   - POST /api/vms/{id}/force_stop - Force power off
//   - POST /api/vms/{id}/reset_state - Reset stuck VM state (query hypervisor or force to STOPPED)
//   - POST /api/vms/{id}/files/write - Write file to guest
//   - POST /api/vms/{id}/files/read - Read file from guest
//   - GET  /api/vms/{id}/files/list - List directory in guest
//   - GET  /api/vms/{id}/files/stat - Get file info in guest
//   - DELETE /api/vms/{id}/files/delete - Delete file in guest
//   - GET  /api/vms/{id}/logs - Get QEMU logs for troubleshooting
func (h *VMRestHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Parse path: /api/vms/{id}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/api/vms/")
	parts := strings.Split(path, "/")

	if len(parts) < 2 {
		h.writeError(w, http.StatusBadRequest, "invalid_path", "Expected /api/vms/{id}/{action}")
		return
	}

	vmID := parts[0]
	action := parts[1]

	if vmID == "" {
		h.writeError(w, http.StatusBadRequest, "missing_vm_id", "VM ID is required")
		return
	}

	// Route file transfer requests to the file transfer handler
	if action == "files" {
		h.fileTransferHandler.ServeHTTP(w, r)
		return
	}

	// Handle logs endpoint (GET)
	if action == "logs" && r.Method == http.MethodGet {
		h.handleGetLogs(w, r, vmID)
		return
	}

	// Only accept POST for power actions
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only POST method is allowed for power actions")
		return
	}

	h.logger.Info("VM power action",
		zap.String("vm_id", vmID),
		zap.String("action", action),
	)

	ctx := r.Context()

	switch action {
	case "start":
		// Power on VM
		req := connect.NewRequest(&computev1.StartVMRequest{
			Id: vmID,
		})
		resp, err := h.server.vmService.StartVM(ctx, req)
		if err != nil {
			h.handleConnectError(w, err)
			return
		}
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "VM started successfully",
			"vm":      vmToMap(resp.Msg),
		})

	case "stop":
		// Graceful shutdown (ACPI)
		req := connect.NewRequest(&computev1.StopVMRequest{
			Id:    vmID,
			Force: false,
		})
		resp, err := h.server.vmService.StopVM(ctx, req)
		if err != nil {
			h.handleConnectError(w, err)
			return
		}
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "Shutdown signal sent",
			"vm":      vmToMap(resp.Msg),
		})

	case "reboot":
		// Graceful reboot
		req := connect.NewRequest(&computev1.RebootVMRequest{
			Id:    vmID,
			Force: false,
		})
		resp, err := h.server.vmService.RebootVM(ctx, req)
		if err != nil {
			h.handleConnectError(w, err)
			return
		}
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "Reboot signal sent",
			"vm":      vmToMap(resp.Msg),
		})

	case "force_stop":
		// Force power off (like pulling the plug)
		req := connect.NewRequest(&computev1.StopVMRequest{
			Id:    vmID,
			Force: true,
		})
		resp, err := h.server.vmService.StopVM(ctx, req)
		if err != nil {
			h.handleConnectError(w, err)
			return
		}
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "VM forcefully powered off",
			"vm":      vmToMap(resp.Msg),
		})

	case "reset_state":
		// Reset stuck VM state - queries hypervisor for actual state or forces to STOPPED
		// Query param: force=true to force state to STOPPED without querying hypervisor
		forceToStopped := r.URL.Query().Get("force") == "true"

		h.logger.Info("Resetting VM state",
			zap.String("vm_id", vmID),
			zap.Bool("force_to_stopped", forceToStopped),
		)

		vm, err := h.server.vmService.ResetVMState(ctx, vmID, forceToStopped)
		if err != nil {
			h.handleConnectError(w, err)
			return
		}

		// Convert domain VM to proto for consistent response format
		protoVM := vmservice.ToProto(vm)
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": fmt.Sprintf("VM state reset to %s", vm.Status.State),
			"vm":      vmToMap(protoVM),
		})

	default:
		h.writeError(w, http.StatusBadRequest, "unknown_action",
			"Unknown action. Supported: start, stop, reboot, force_stop")
	}
}

// handleConnectError converts Connect-RPC errors to HTTP responses.
func (h *VMRestHandler) handleConnectError(w http.ResponseWriter, err error) {
	connectErr, ok := err.(*connect.Error)
	if !ok {
		h.writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}

	var statusCode int
	switch connectErr.Code() {
	case connect.CodeNotFound:
		statusCode = http.StatusNotFound
	case connect.CodeInvalidArgument:
		statusCode = http.StatusBadRequest
	case connect.CodeFailedPrecondition:
		statusCode = http.StatusConflict
	case connect.CodeUnavailable:
		statusCode = http.StatusServiceUnavailable
	case connect.CodePermissionDenied:
		statusCode = http.StatusForbidden
	case connect.CodeUnauthenticated:
		statusCode = http.StatusUnauthorized
	default:
		statusCode = http.StatusInternalServerError
	}

	h.writeError(w, statusCode, connectErr.Code().String(), connectErr.Message())
}

// writeJSON writes a JSON response.
func (h *VMRestHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to write JSON response", zap.Error(err))
	}
}

// writeError writes an error JSON response.
func (h *VMRestHandler) writeError(w http.ResponseWriter, status int, code, message string) {
	h.logger.Warn("API error",
		zap.Int("status", status),
		zap.String("code", code),
		zap.String("message", message),
	)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"code":    code,
		"message": message,
	})
}

// vmToMap converts a VM proto to a simple map for JSON responses.
func vmToMap(vm *computev1.VirtualMachine) map[string]interface{} {
	if vm == nil {
		return nil
	}

	result := map[string]interface{}{
		"id":   vm.Id,
		"name": vm.Name,
	}

	if vm.Status != nil {
		result["state"] = vm.Status.State.String()
		if vm.Status.ErrorMessage != "" {
			result["error_message"] = vm.Status.ErrorMessage
		}
		if vm.Status.NodeId != "" {
			result["node_id"] = vm.Status.NodeId
		}
	}

	return result
}

// handleGetLogs fetches QEMU logs from the node daemon for troubleshooting.
// This proxies the request to the node where the VM is running.
func (h *VMRestHandler) handleGetLogs(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	// Parse lines query parameter (default: 100)
	lines := 100
	if linesStr := r.URL.Query().Get("lines"); linesStr != "" {
		if parsed, err := strconv.Atoi(linesStr); err == nil && parsed > 0 && parsed <= 1000 {
			lines = parsed
		}
	}

	h.logger.Info("Fetching VM logs",
		zap.String("vm_id", vmID),
		zap.Int("lines", lines),
	)

	// Get the VM to find its node
	vmReq := connect.NewRequest(&computev1.GetVMRequest{Id: vmID})
	vmResp, err := h.server.vmService.GetVM(ctx, vmReq)
	if err != nil {
		h.handleConnectError(w, err)
		return
	}

	nodeID := vmResp.Msg.Status.GetNodeId()
	if nodeID == "" {
		h.writeError(w, http.StatusBadRequest, "no_node", "VM is not assigned to a node")
		return
	}

	// Get the node's API URL
	node, err := h.server.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		h.logger.Error("Failed to get node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeError(w, http.StatusInternalServerError, "node_lookup_failed", "Failed to find node for VM")
		return
	}

	// Strip CIDR notation from IP if present (e.g., "192.168.0.101/32" -> "192.168.0.101")
	nodeIP := node.ManagementIP
	if idx := strings.Index(nodeIP, "/"); idx != -1 {
		nodeIP = nodeIP[:idx]
	}

	// Construct the node daemon URL
	nodeURL := fmt.Sprintf("https://%s:8443/api/v1/vms/%s/logs?lines=%d", nodeIP, vmID, lines)

	h.logger.Debug("Proxying logs request to node",
		zap.String("node_id", nodeID),
		zap.String("node_url", nodeURL),
	)

	// Create HTTP client that skips TLS verification (for internal cluster communication)
	client := h.server.getInsecureHTTPClient()

	// Forward the request to the node daemon
	nodeReq, err := http.NewRequestWithContext(ctx, http.MethodGet, nodeURL, nil)
	if err != nil {
		h.logger.Error("Failed to create node request", zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, "request_failed", "Failed to create request to node")
		return
	}

	resp, err := client.Do(nodeReq)
	if err != nil {
		h.logger.Error("Failed to fetch logs from node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeError(w, http.StatusBadGateway, "node_unreachable", fmt.Sprintf("Failed to reach node %s: %v", nodeID, err))
		return
	}
	defer resp.Body.Close()

	// Forward the response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
