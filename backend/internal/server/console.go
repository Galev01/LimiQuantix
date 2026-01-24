// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// ConsoleErrorCode defines specific error codes for console connection failures.
type ConsoleErrorCode string

const (
	// ConsoleErrorVMNotFound - VM doesn't exist in the control plane database
	ConsoleErrorVMNotFound ConsoleErrorCode = "VM_NOT_FOUND"
	// ConsoleErrorVMNotRunning - VM exists but is not running
	ConsoleErrorVMNotRunning ConsoleErrorCode = "VM_NOT_RUNNING"
	// ConsoleErrorNodeNotAssigned - VM has no node assignment
	ConsoleErrorNodeNotAssigned ConsoleErrorCode = "NODE_NOT_ASSIGNED"
	// ConsoleErrorNodeNotFound - The assigned node doesn't exist
	ConsoleErrorNodeNotFound ConsoleErrorCode = "NODE_NOT_FOUND"
	// ConsoleErrorNodeUnreachable - Cannot connect to the node daemon
	ConsoleErrorNodeUnreachable ConsoleErrorCode = "NODE_UNREACHABLE"
	// ConsoleErrorVMNotOnNode - VM is not found on the assigned node (orphan/stale record)
	ConsoleErrorVMNotOnNode ConsoleErrorCode = "VM_NOT_ON_NODE"
	// ConsoleErrorVNCUnavailable - VNC server is not available on the node
	ConsoleErrorVNCUnavailable ConsoleErrorCode = "VNC_UNAVAILABLE"
	// ConsoleErrorInternal - Generic internal error
	ConsoleErrorInternal ConsoleErrorCode = "INTERNAL_ERROR"
)

// ConsoleErrorResponse is the JSON response for console errors.
type ConsoleErrorResponse struct {
	Code    ConsoleErrorCode `json:"code"`
	Message string           `json:"message"`
	Details string           `json:"details,omitempty"`
	VMID    string           `json:"vm_id,omitempty"`
	NodeID  string           `json:"node_id,omitempty"`
}

// ConsoleHandler handles WebSocket console connections.
type ConsoleHandler struct {
	server   *Server
	upgrader websocket.Upgrader
	logger   *zap.Logger
}

// NewConsoleHandler creates a new console handler.
func NewConsoleHandler(s *Server) *ConsoleHandler {
	return &ConsoleHandler{
		server: s,
		upgrader: websocket.Upgrader{
			ReadBufferSize:  64 * 1024,
			WriteBufferSize: 64 * 1024,
			CheckOrigin: func(r *http.Request) bool {
				// Allow all origins for development
				// In production, this should be restricted
				return true
			},
		},
		logger: s.logger.Named("console"),
	}
}

// writeConsoleError writes a structured JSON error response.
func (h *ConsoleHandler) writeConsoleError(w http.ResponseWriter, statusCode int, errResp ConsoleErrorResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(errResp)
}

// ServeHTTP handles console WebSocket upgrade requests.
// Expected path: /api/console/{vmId}/ws
// Also supports preflight checks via X-Console-Preflight header for better error messages.
func (h *ConsoleHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract VM ID from path
	// Path format: /api/console/{vmId}/ws
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "console" || parts[3] != "ws" {
		h.writeConsoleError(w, http.StatusBadRequest, ConsoleErrorResponse{
			Code:    ConsoleErrorInternal,
			Message: "Invalid console path format",
		})
		return
	}
	vmID := parts[2]

	// Check if this is a preflight check (for better error messages in the web UI)
	isPreflight := r.Header.Get("X-Console-Preflight") == "true"

	if isPreflight {
		h.logger.Debug("Console preflight check",
			zap.String("vm_id", vmID),
			zap.String("remote_addr", r.RemoteAddr),
		)
	} else {
		h.logger.Info("Console WebSocket request",
			zap.String("vm_id", vmID),
			zap.String("remote_addr", r.RemoteAddr),
		)
	}

	// Get VM info to find which node it's on
	ctx := r.Context()
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.logger.Error("VM not found", zap.String("vm_id", vmID), zap.Error(err))
		h.writeConsoleError(w, http.StatusNotFound, ConsoleErrorResponse{
			Code:    ConsoleErrorVMNotFound,
			Message: "Virtual machine not found",
			Details: fmt.Sprintf("No VM exists with ID '%s'. It may have been deleted.", vmID),
			VMID:    vmID,
		})
		return
	}

	// Check if VM is running
	if vm.Status.State != "RUNNING" {
		h.logger.Warn("VM is not running",
			zap.String("vm_id", vmID),
			zap.String("state", string(vm.Status.State)),
		)
		h.writeConsoleError(w, http.StatusPreconditionFailed, ConsoleErrorResponse{
			Code:    ConsoleErrorVMNotRunning,
			Message: "Virtual machine is not running",
			Details: fmt.Sprintf("VM '%s' is currently in state '%s'. Start the VM to access the console.", vm.Name, vm.Status.State),
			VMID:    vmID,
		})
		return
	}

	if vm.Status.NodeID == "" {
		h.logger.Error("VM has no node assignment", zap.String("vm_id", vmID))
		h.writeConsoleError(w, http.StatusPreconditionFailed, ConsoleErrorResponse{
			Code:    ConsoleErrorNodeNotAssigned,
			Message: "VM is not assigned to any node",
			Details: "The VM exists but is not scheduled on any hypervisor node. This may indicate a scheduling issue.",
			VMID:    vmID,
		})
		return
	}

	// Get console info from the node daemon
	consoleInfo, consoleErr := h.getConsoleInfoFromNode(ctx, vm.Status.NodeID, vmID)
	if consoleErr != nil {
		h.logger.Error("Failed to get console info",
			zap.String("vm_id", vmID),
			zap.String("node_id", vm.Status.NodeID),
			zap.Error(consoleErr),
		)

		// Parse the error to provide specific feedback
		errMsg := consoleErr.Error()
		var errResp ConsoleErrorResponse
		errResp.VMID = vmID
		errResp.NodeID = vm.Status.NodeID

		switch {
		case strings.Contains(errMsg, "node not found"):
			errResp.Code = ConsoleErrorNodeNotFound
			errResp.Message = "Hypervisor node not found"
			errResp.Details = fmt.Sprintf("The node '%s' assigned to this VM no longer exists in the cluster.", vm.Status.NodeID)
			h.writeConsoleError(w, http.StatusNotFound, errResp)

		case strings.Contains(errMsg, "failed to connect to node daemon"):
			errResp.Code = ConsoleErrorNodeUnreachable
			errResp.Message = "Cannot reach hypervisor node"
			errResp.Details = "The node daemon is not responding. The hypervisor may be offline or the network connection may be interrupted."
			h.writeConsoleError(w, http.StatusServiceUnavailable, errResp)

		case strings.Contains(errMsg, "Domain not found") || strings.Contains(errMsg, "VM not found"):
			errResp.Code = ConsoleErrorVMNotOnNode
			errResp.Message = "VM not found on hypervisor"
			errResp.Details = fmt.Sprintf("The VM '%s' is not running on node '%s'. The VM may have been migrated, stopped, or deleted outside of the control plane. Try refreshing the VM list or restarting the VM.", vm.Name, vm.Status.NodeID)
			h.writeConsoleError(w, http.StatusConflict, errResp)

		default:
			errResp.Code = ConsoleErrorInternal
			errResp.Message = "Failed to get console information"
			errResp.Details = errMsg
			h.writeConsoleError(w, http.StatusInternalServerError, errResp)
		}
		return
	}

	h.logger.Info("Console info retrieved",
		zap.String("vm_id", vmID),
		zap.String("host", consoleInfo.Host),
		zap.Uint32("port", consoleInfo.Port),
	)

	// For preflight checks, return success without WebSocket upgrade
	if isPreflight {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"ok":      true,
			"vm_id":   vmID,
			"vm_name": vm.Name,
			"node_id": vm.Status.NodeID,
		})
		return
	}

	// Upgrade to WebSocket
	clientConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("WebSocket upgrade failed", zap.Error(err))
		return
	}
	defer clientConn.Close()

	// Connect to the VNC server on the node
	vncAddr := fmt.Sprintf("%s:%d", consoleInfo.Host, consoleInfo.Port)
	vncConn, err := net.DialTimeout("tcp", vncAddr, 10*time.Second)
	if err != nil {
		h.logger.Error("Failed to connect to VNC server",
			zap.String("address", vncAddr),
			zap.Error(err),
		)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "VNC connection failed"))
		return
	}
	defer vncConn.Close()

	h.logger.Info("VNC connection established",
		zap.String("vm_id", vmID),
		zap.String("vnc_addr", vncAddr),
	)

	// Bidirectional proxy
	h.proxyVNC(clientConn, vncConn)

	h.logger.Info("Console session ended", zap.String("vm_id", vmID))
}

// consoleInfo holds VNC connection details.
type consoleInfo struct {
	Host     string
	Port     uint32
	Password string
}

// getConsoleInfoFromNode retrieves console info from the node daemon.
func (h *ConsoleHandler) getConsoleInfoFromNode(ctx context.Context, nodeID, vmID string) (*consoleInfo, error) {
	// Get node info
	node, err := h.server.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		return nil, fmt.Errorf("node not found: %w", err)
	}

	// Get or create connection to node daemon
	client := h.server.daemonPool.Get(nodeID)
	if client == nil {
		// Try to connect - use the node's ManagementIP field
		if node.ManagementIP == "" {
			return nil, fmt.Errorf("node has no management IP")
		}

		// Strip CIDR notation from IP if present (e.g., "192.168.0.101/32" -> "192.168.0.101")
		daemonAddr := node.ManagementIP
		if idx := strings.Index(daemonAddr, "/"); idx != -1 {
			daemonAddr = daemonAddr[:idx]
		}

		// ManagementIP may already include port (e.g., "192.168.0.53:9090")
		// Check if it has a port, if not add default port 9090
		// Note: gRPC expects just host:port, not http:// prefix
		if !strings.Contains(daemonAddr, ":") {
			daemonAddr = daemonAddr + ":9090"
		}

		h.logger.Debug("Connecting to node daemon",
			zap.String("node_id", nodeID),
			zap.String("daemon_addr", daemonAddr),
		)

		var connectErr error
		client, connectErr = h.server.daemonPool.Connect(nodeID, daemonAddr)
		if connectErr != nil {
			return nil, fmt.Errorf("failed to connect to node daemon: %w", connectErr)
		}
	}

	// Get console info
	info, err := client.GetConsole(ctx, vmID)
	if err != nil {
		return nil, fmt.Errorf("failed to get console info: %w", err)
	}

	return &consoleInfo{
		Host:     info.Host,
		Port:     info.Port,
		Password: info.Password,
	}, nil
}

// proxyVNC proxies data between WebSocket and VNC TCP connection.
func (h *ConsoleHandler) proxyVNC(ws *websocket.Conn, vnc net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	// WebSocket -> VNC
	go func() {
		defer wg.Done()
		defer vnc.Close()

		for {
			messageType, data, err := ws.ReadMessage()
			if err != nil {
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					h.logger.Debug("WebSocket read error", zap.Error(err))
				}
				return
			}

			// Only forward binary messages
			if messageType == websocket.BinaryMessage {
				_, err = vnc.Write(data)
				if err != nil {
					h.logger.Debug("VNC write error", zap.Error(err))
					return
				}
			}
		}
	}()

	// VNC -> WebSocket
	go func() {
		defer wg.Done()
		defer ws.Close()

		buf := make([]byte, 64*1024)
		for {
			n, err := vnc.Read(buf)
			if err != nil {
				if err != io.EOF {
					h.logger.Debug("VNC read error", zap.Error(err))
				}
				return
			}

			err = ws.WriteMessage(websocket.BinaryMessage, buf[:n])
			if err != nil {
				h.logger.Debug("WebSocket write error", zap.Error(err))
				return
			}
		}
	}()

	wg.Wait()
}
