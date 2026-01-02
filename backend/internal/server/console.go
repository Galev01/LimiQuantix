// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"context"
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

// ServeHTTP handles console WebSocket upgrade requests.
// Expected path: /api/console/{vmId}/ws
func (h *ConsoleHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract VM ID from path
	// Path format: /api/console/{vmId}/ws
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "console" || parts[3] != "ws" {
		http.Error(w, "Invalid console path", http.StatusBadRequest)
		return
	}
	vmID := parts[2]

	h.logger.Info("Console WebSocket request",
		zap.String("vm_id", vmID),
		zap.String("remote_addr", r.RemoteAddr),
	)

	// Get VM info to find which node it's on
	ctx := r.Context()
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.logger.Error("VM not found", zap.String("vm_id", vmID), zap.Error(err))
		http.Error(w, fmt.Sprintf("VM not found: %s", vmID), http.StatusNotFound)
		return
	}

	if vm.Status.NodeID == "" {
		h.logger.Error("VM has no node assignment", zap.String("vm_id", vmID))
		http.Error(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	// Get console info from the node daemon
	consoleInfo, err := h.getConsoleInfoFromNode(ctx, vm.Status.NodeID, vmID)
	if err != nil {
		h.logger.Error("Failed to get console info",
			zap.String("vm_id", vmID),
			zap.String("node_id", vm.Status.NodeID),
			zap.Error(err),
		)
		http.Error(w, fmt.Sprintf("Failed to get console info: %v", err), http.StatusInternalServerError)
		return
	}

	h.logger.Info("Console info retrieved",
		zap.String("vm_id", vmID),
		zap.String("host", consoleInfo.Host),
		zap.Uint32("port", consoleInfo.Port),
	)

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

		daemonAddr := fmt.Sprintf("http://%s:9090", node.ManagementIP)
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
