// Package server provides REST API handlers for VM operations.
// These handlers wrap the Connect-RPC service to provide simple REST endpoints
// for frontend clients that prefer REST over gRPC-Web.
package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"connectrpc.com/connect"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
)

// VMRestHandler provides REST API endpoints for VM operations.
type VMRestHandler struct {
	server *Server
	logger *zap.Logger
}

// NewVMRestHandler creates a new VM REST handler.
func NewVMRestHandler(s *Server) *VMRestHandler {
	return &VMRestHandler{
		server: s,
		logger: s.logger.Named("vm-rest"),
	}
}

// ServeHTTP handles REST API requests for VMs.
// Routes:
//   - POST /api/vms/{id}/start - Power on VM
//   - POST /api/vms/{id}/stop - Graceful shutdown
//   - POST /api/vms/{id}/reboot - Graceful reboot
//   - POST /api/vms/{id}/force_stop - Force power off
func (h *VMRestHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only accept POST for power actions
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Only POST method is allowed")
		return
	}

	// Parse path: /api/vms/{id}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/api/vms/")
	parts := strings.Split(path, "/")

	if len(parts) != 2 {
		h.writeError(w, http.StatusBadRequest, "invalid_path", "Expected /api/vms/{id}/{action}")
		return
	}

	vmID := parts[0]
	action := parts[1]

	if vmID == "" {
		h.writeError(w, http.StatusBadRequest, "missing_vm_id", "VM ID is required")
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
