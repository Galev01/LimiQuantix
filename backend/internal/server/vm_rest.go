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
//   - GET  /api/vms/{id}/qemu-agent/ping - Check if QEMU Guest Agent is available
//   - GET  /api/vms/{id}/agent/ping - Check if Quantix Agent is connected
//   - POST /api/vms/{id}/agent/install - Install Quantix Agent via QEMU Guest Agent
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

	// Handle QEMU Guest Agent ping (GET)
	if action == "qemu-agent" && len(parts) >= 3 && parts[2] == "ping" && r.Method == http.MethodGet {
		h.handleQemuAgentPing(w, r, vmID)
		return
	}

	// Handle Quantix Agent ping (GET)
	if action == "agent" && len(parts) >= 3 && parts[2] == "ping" && r.Method == http.MethodGet {
		h.handleAgentPing(w, r, vmID)
		return
	}

	// Handle Quantix Agent install (POST)
	if action == "agent" && len(parts) >= 3 && parts[2] == "install" && r.Method == http.MethodPost {
		h.handleAgentInstall(w, r, vmID)
		return
	}

	// Handle Quantix Agent update (POST)
	if action == "agent" && len(parts) >= 3 && parts[2] == "update" && r.Method == http.MethodPost {
		h.handleAgentUpdate(w, r, vmID)
		return
	}

	// Handle Quantix Agent refresh (POST)
	if action == "agent" && len(parts) >= 3 && parts[2] == "refresh" && r.Method == http.MethodPost {
		h.handleAgentRefresh(w, r, vmID)
		return
	}

	// Handle Quantix Agent logs (GET)
	if action == "agent" && len(parts) >= 3 && parts[2] == "logs" && r.Method == http.MethodGet {
		h.handleAgentLogs(w, r, vmID)
		return
	}

	// Handle Quantix Agent shutdown (POST)
	if action == "agent" && len(parts) >= 3 && parts[2] == "shutdown" && r.Method == http.MethodPost {
		h.handleAgentShutdown(w, r, vmID)
		return
	}

	// Handle Quantix Agent reboot (POST)
	if action == "agent" && len(parts) >= 3 && parts[2] == "reboot" && r.Method == http.MethodPost {
		h.handleAgentReboot(w, r, vmID)
		return
	}

	// Handle Quantix Agent file browser (GET)
	if action == "agent" && len(parts) >= 4 && parts[2] == "files" {
		switch parts[3] {
		case "list":
			if r.Method == http.MethodGet {
				h.handleListFiles(w, r, vmID)
				return
			}
		case "read":
			if r.Method == http.MethodGet {
				h.handleReadFile(w, r, vmID)
				return
			}
		}
	}

	// Handle command execution (POST)
	if action == "execute" && r.Method == http.MethodPost {
		h.handleExecuteScript(w, r, vmID)
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

// handleQemuAgentPing checks if QEMU Guest Agent is available in the VM.
// GET /api/vms/{id}/qemu-agent/ping
func (h *VMRestHandler) handleQemuAgentPing(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	h.logger.Debug("Checking QEMU Guest Agent availability", zap.String("vm_id", vmID))

	// Get the VM to find its node
	vmReq := connect.NewRequest(&computev1.GetVMRequest{Id: vmID})
	vmResp, err := h.server.vmService.GetVM(ctx, vmReq)
	if err != nil {
		h.handleConnectError(w, err)
		return
	}

	nodeID := vmResp.Msg.Status.GetNodeId()
	if nodeID == "" {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"available": false,
			"error":     "VM is not assigned to a node",
		})
		return
	}

	// Get the node's API URL
	node, err := h.server.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		h.logger.Error("Failed to get node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"available": false,
			"error":     "Failed to find node for VM",
		})
		return
	}

	// Strip CIDR notation from IP
	nodeIP := node.ManagementIP
	if idx := strings.Index(nodeIP, "/"); idx != -1 {
		nodeIP = nodeIP[:idx]
	}

	// Try to ping the QEMU Guest Agent via the node daemon
	// The node daemon exposes a /api/v1/vms/{id}/qemu-agent/ping endpoint
	nodeURL := fmt.Sprintf("https://%s:8443/api/v1/vms/%s/qemu-agent/ping", nodeIP, vmID)

	client := h.server.getInsecureHTTPClient()
	nodeReq, err := http.NewRequestWithContext(ctx, http.MethodGet, nodeURL, nil)
	if err != nil {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"available": false,
			"error":     "Failed to create request",
		})
		return
	}

	resp, err := client.Do(nodeReq)
	if err != nil {
		// Node unreachable - QEMU agent status unknown
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"available": false,
			"error":     fmt.Sprintf("Node unreachable: %v", err),
		})
		return
	}
	defer resp.Body.Close()

	// Parse the response from the node daemon
	var nodeResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&nodeResp); err != nil {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"available": false,
			"error":     "Invalid response from node",
		})
		return
	}

	// Forward the node's response
	h.writeJSON(w, http.StatusOK, nodeResp)
}

// handleAgentPing checks if Quantix Agent is available in the VM.
// GET /api/vms/{id}/agent/ping
func (h *VMRestHandler) handleAgentPing(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	h.logger.Debug("Checking Quantix Agent availability", zap.String("vm_id", vmID))

	// Get the VM to find its node
	vmReq := connect.NewRequest(&computev1.GetVMRequest{Id: vmID})
	vmResp, err := h.server.vmService.GetVM(ctx, vmReq)
	if err != nil {
		h.handleConnectError(w, err)
		return
	}

	nodeID := vmResp.Msg.Status.GetNodeId()
	if nodeID == "" {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"error":     "VM is not assigned to a node",
		})
		return
	}

	// Get the node's API URL
	node, err := h.server.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		h.logger.Error("Failed to get node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"error":     "Failed to find node for VM",
		})
		return
	}

	// Strip CIDR notation from IP
	nodeIP := node.ManagementIP
	if idx := strings.Index(nodeIP, "/"); idx != -1 {
		nodeIP = nodeIP[:idx]
	}

	// Ping the Quantix Agent via the node daemon's gRPC service
	nodeURL := fmt.Sprintf("https://%s:8443/api/v1/vms/%s/agent/ping", nodeIP, vmID)

	client := h.server.getInsecureHTTPClient()
	nodeReq, err := http.NewRequestWithContext(ctx, http.MethodGet, nodeURL, nil)
	if err != nil {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"error":     "Failed to create request",
		})
		return
	}

	resp, err := client.Do(nodeReq)
	if err != nil {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"error":     fmt.Sprintf("Node unreachable: %v", err),
		})
		return
	}
	defer resp.Body.Close()

	// Parse and forward the response
	var nodeResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&nodeResp); err != nil {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"connected": false,
			"error":     "Invalid response from node",
		})
		return
	}

	h.writeJSON(w, http.StatusOK, nodeResp)
}

// handleAgentInstall triggers Quantix Agent installation in the VM.
// POST /api/vms/{id}/agent/install
//
// This uses the node daemon's agent/install endpoint which:
// 1. Transfers the agent binary via QEMU Guest Agent file operations (virtio-serial, no network needed)
// 2. Transfers the install script via virtio-serial
// 3. Attempts to run the install script via guest-exec
// 4. If guest-exec is disabled, instructs the user to run the script manually
func (h *VMRestHandler) handleAgentInstall(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	h.logger.Info("Installing Quantix Agent in VM (virtio-serial method)", zap.String("vm_id", vmID))

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

	// Strip CIDR notation from IP
	nodeIP := node.ManagementIP
	if idx := strings.Index(nodeIP, "/"); idx != -1 {
		nodeIP = nodeIP[:idx]
	}

	// Use the node daemon's new agent install endpoint
	// This transfers the agent binary via virtio-serial (no network required in the VM)
	nodeURL := fmt.Sprintf("https://%s:8443/api/v1/vms/%s/agent/install", nodeIP, vmID)

	requestBody := map[string]interface{}{
		"force": false,
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "marshal_failed", "Failed to create request body")
		return
	}

	client := h.server.getInsecureHTTPClient()
	nodeReq, err := http.NewRequestWithContext(ctx, http.MethodPost, nodeURL, strings.NewReader(string(bodyBytes)))
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "request_failed", "Failed to create request")
		return
	}
	nodeReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(nodeReq)
	if err != nil {
		h.logger.Error("Failed to execute install command on node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeError(w, http.StatusBadGateway, "node_unreachable", fmt.Sprintf("Failed to reach node: %v", err))
		return
	}
	defer resp.Body.Close()

	// Parse the response
	var nodeResp map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&nodeResp); err != nil {
		// Even if we can't parse the response, the command may have been executed
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "Installation command sent. The agent should connect within a minute.",
		})
		return
	}

	// Check if execution was successful
	if success, ok := nodeResp["success"].(bool); ok && success {
		h.writeJSON(w, http.StatusOK, map[string]interface{}{
			"success": true,
			"message": "Quantix Agent installation started. The agent should connect within a minute.",
			"details": nodeResp,
		})
	} else {
		errorMsg := "Installation command failed"
		if errStr, ok := nodeResp["error"].(string); ok {
			errorMsg = errStr
		}
		h.writeError(w, http.StatusInternalServerError, "install_failed", errorMsg)
	}
}

// =============================================================================
// NEW AGENT HANDLERS
// =============================================================================

// handleAgentUpdate triggers an agent update in the VM.
// POST /api/vms/{id}/agent/update
func (h *VMRestHandler) handleAgentUpdate(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "update", http.MethodPost)
}

// handleAgentRefresh requests fresh telemetry from the agent.
// POST /api/vms/{id}/agent/refresh
func (h *VMRestHandler) handleAgentRefresh(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "refresh", http.MethodPost)
}

// handleAgentLogs fetches agent logs from the guest VM.
// GET /api/vms/{id}/agent/logs
func (h *VMRestHandler) handleAgentLogs(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "logs", http.MethodGet)
}

// handleAgentShutdown sends a graceful shutdown signal via the agent.
// POST /api/vms/{id}/agent/shutdown
func (h *VMRestHandler) handleAgentShutdown(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "shutdown", http.MethodPost)
}

// handleAgentReboot sends a graceful reboot signal via the agent.
// POST /api/vms/{id}/agent/reboot
func (h *VMRestHandler) handleAgentReboot(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "reboot", http.MethodPost)
}

// handleListFiles lists directory contents in the guest VM.
// GET /api/vms/{id}/agent/files/list?path=/home
func (h *VMRestHandler) handleListFiles(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "files/list", http.MethodGet)
}

// handleReadFile reads a file from the guest VM.
// GET /api/vms/{id}/agent/files/read?path=/etc/hosts
func (h *VMRestHandler) handleReadFile(w http.ResponseWriter, r *http.Request, vmID string) {
	h.proxyAgentRequest(w, r, vmID, "files/read", http.MethodGet)
}

// handleExecuteScript executes a command in the guest VM.
// POST /api/vms/{id}/execute
// WARNING: Maximum timeout is 30 seconds for synchronous execution.
func (h *VMRestHandler) handleExecuteScript(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	h.logger.Info("Executing command in VM", zap.String("vm_id", vmID))

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

	// Strip CIDR notation from IP
	nodeIP := node.ManagementIP
	if idx := strings.Index(nodeIP, "/"); idx != -1 {
		nodeIP = nodeIP[:idx]
	}

	// Construct the node daemon URL
	nodeURL := fmt.Sprintf("https://%s:8443/api/v1/vms/%s/execute", nodeIP, vmID)

	h.logger.Debug("Proxying execute request to node",
		zap.String("node_id", nodeID),
		zap.String("node_url", nodeURL),
	)

	// Read the request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		h.writeError(w, http.StatusBadRequest, "read_body_failed", "Failed to read request body")
		return
	}

	// Create HTTP client
	client := h.server.getInsecureHTTPClient()

	// Forward the request to the node daemon
	nodeReq, err := http.NewRequestWithContext(ctx, http.MethodPost, nodeURL, strings.NewReader(string(body)))
	if err != nil {
		h.logger.Error("Failed to create node request", zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, "request_failed", "Failed to create request to node")
		return
	}
	nodeReq.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(nodeReq)
	if err != nil {
		h.logger.Error("Failed to execute command on node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeError(w, http.StatusBadGateway, "node_unreachable", fmt.Sprintf("Failed to reach node %s: %v", nodeID, err))
		return
	}
	defer resp.Body.Close()

	// Forward the response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// proxyAgentRequest is a helper that proxies requests to the node daemon's agent endpoints.
func (h *VMRestHandler) proxyAgentRequest(w http.ResponseWriter, r *http.Request, vmID, endpoint, method string) {
	ctx := r.Context()

	h.logger.Debug("Proxying agent request",
		zap.String("vm_id", vmID),
		zap.String("endpoint", endpoint),
		zap.String("method", method),
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

	// Strip CIDR notation from IP
	nodeIP := node.ManagementIP
	if idx := strings.Index(nodeIP, "/"); idx != -1 {
		nodeIP = nodeIP[:idx]
	}

	// Construct the node daemon URL with query parameters
	nodeURL := fmt.Sprintf("https://%s:8443/api/v1/vms/%s/agent/%s", nodeIP, vmID, endpoint)
	if r.URL.RawQuery != "" {
		nodeURL += "?" + r.URL.RawQuery
	}

	h.logger.Debug("Proxying to node",
		zap.String("node_id", nodeID),
		zap.String("node_url", nodeURL),
	)

	// Create HTTP client
	client := h.server.getInsecureHTTPClient()

	// Read body for POST requests
	var bodyReader io.Reader
	if method == http.MethodPost {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			h.writeError(w, http.StatusBadRequest, "read_body_failed", "Failed to read request body")
			return
		}
		if len(body) > 0 {
			bodyReader = strings.NewReader(string(body))
		} else {
			bodyReader = strings.NewReader("{}")
		}
	}

	// Forward the request to the node daemon
	nodeReq, err := http.NewRequestWithContext(ctx, method, nodeURL, bodyReader)
	if err != nil {
		h.logger.Error("Failed to create node request", zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, "request_failed", "Failed to create request to node")
		return
	}
	if method == http.MethodPost {
		nodeReq.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(nodeReq)
	if err != nil {
		h.logger.Error("Failed to reach node", zap.Error(err), zap.String("node_id", nodeID))
		h.writeError(w, http.StatusBadGateway, "node_unreachable", fmt.Sprintf("Failed to reach node %s: %v", nodeID, err))
		return
	}
	defer resp.Body.Close()

	// Forward the response
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
