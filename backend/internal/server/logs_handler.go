// Package server provides HTTP handlers for system logs.
package server

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp  string                 `json:"timestamp"`
	Level      string                 `json:"level"`
	Message    string                 `json:"message"`
	Source     string                 `json:"source,omitempty"`
	Fields     map[string]interface{} `json:"fields,omitempty"`
	StackTrace string                 `json:"stackTrace,omitempty"`
	RequestID  string                 `json:"requestId,omitempty"`
	VMID       string                 `json:"vmId,omitempty"`
	NodeID     string                 `json:"nodeId,omitempty"`
	DurationMs int64                  `json:"durationMs,omitempty"`
}

// LogsResponse is the response for the logs endpoint
type LogsResponse struct {
	Logs    []LogEntry `json:"logs"`
	Total   int        `json:"total"`
	HasMore bool       `json:"hasMore"`
}

// LogsHandler handles log-related HTTP endpoints
type LogsHandler struct {
	logger   *zap.Logger
	upgrader websocket.Upgrader
	
	// In-memory log buffer for recent logs
	logBuffer []LogEntry
	bufferMu  sync.RWMutex
	maxBuffer int
	
	// WebSocket clients for streaming
	clients   map[*websocket.Conn]bool
	clientsMu sync.RWMutex
}

// NewLogsHandler creates a new logs handler
func NewLogsHandler(logger *zap.Logger) *LogsHandler {
	h := &LogsHandler{
		logger: logger.Named("logs"),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins in development
			},
		},
		logBuffer: make([]LogEntry, 0, 1000),
		maxBuffer: 1000,
		clients:   make(map[*websocket.Conn]bool),
	}
	
	// Start background log collection
	go h.collectLogs()
	
	return h
}

// RegisterRoutes registers the logs routes
func (h *LogsHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/logs", h.handleGetLogs)
	mux.HandleFunc("/api/logs/sources", h.handleGetSources)
	mux.HandleFunc("/api/logs/stream", h.handleLogStream)
}

// handleGetLogs handles GET /api/logs
func (h *LogsHandler) handleGetLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse query parameters
	query := r.URL.Query()
	level := query.Get("level")
	source := query.Get("source")
	search := query.Get("search")
	limitStr := query.Get("limit")
	offsetStr := query.Get("offset")

	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}

	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	// Get logs from buffer
	h.bufferMu.RLock()
	allLogs := make([]LogEntry, len(h.logBuffer))
	copy(allLogs, h.logBuffer)
	h.bufferMu.RUnlock()

	// Filter logs
	var filtered []LogEntry
	for _, log := range allLogs {
		// Level filter
		if level != "" && !strings.EqualFold(log.Level, level) {
			continue
		}
		// Source filter
		if source != "" && !strings.Contains(strings.ToLower(log.Source), strings.ToLower(source)) {
			continue
		}
		// Search filter
		if search != "" {
			searchLower := strings.ToLower(search)
			if !strings.Contains(strings.ToLower(log.Message), searchLower) &&
				!strings.Contains(strings.ToLower(log.Source), searchLower) {
				continue
			}
		}
		filtered = append(filtered, log)
	}

	// Apply pagination
	total := len(filtered)
	if offset >= total {
		filtered = []LogEntry{}
	} else {
		end := offset + limit
		if end > total {
			end = total
		}
		filtered = filtered[offset:end]
	}

	hasMore := offset+len(filtered) < total

	// Return response
	resp := LogsResponse{
		Logs:    filtered,
		Total:   total,
		HasMore: hasMore,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// handleGetSources handles GET /api/logs/sources
func (h *LogsHandler) handleGetSources(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Return known log sources
	sources := []string{
		"controlplane",
		"vm-service",
		"node-service",
		"storage-service",
		"network-service",
		"scheduler",
		"api",
		"grpc",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sources)
}

// handleLogStream handles WebSocket connections for log streaming
func (h *LogsHandler) handleLogStream(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error("Failed to upgrade WebSocket", zap.Error(err))
		return
	}
	defer conn.Close()

	h.logger.Info("Log stream client connected")

	// Register client
	h.clientsMu.Lock()
	h.clients[conn] = true
	h.clientsMu.Unlock()

	// Unregister on disconnect
	defer func() {
		h.clientsMu.Lock()
		delete(h.clients, conn)
		h.clientsMu.Unlock()
		h.logger.Info("Log stream client disconnected")
	}()

	// Keep connection alive and handle pings
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

// broadcastLog sends a log entry to all connected WebSocket clients
func (h *LogsHandler) broadcastLog(log LogEntry) {
	h.clientsMu.RLock()
	defer h.clientsMu.RUnlock()

	data, err := json.Marshal(log)
	if err != nil {
		return
	}

	for client := range h.clients {
		err := client.WriteMessage(websocket.TextMessage, data)
		if err != nil {
			h.logger.Debug("Failed to send log to client", zap.Error(err))
		}
	}
}

// addLog adds a log entry to the buffer and broadcasts it
func (h *LogsHandler) addLog(log LogEntry) {
	h.bufferMu.Lock()
	h.logBuffer = append(h.logBuffer, log)
	// Keep only the last maxBuffer entries
	if len(h.logBuffer) > h.maxBuffer {
		h.logBuffer = h.logBuffer[len(h.logBuffer)-h.maxBuffer:]
	}
	h.bufferMu.Unlock()

	// Broadcast to WebSocket clients
	h.broadcastLog(log)
}

// collectLogs collects logs from the system
func (h *LogsHandler) collectLogs() {
	// Try to read from journald on Linux
	cmd := exec.Command("journalctl", "-f", "-o", "json", "-n", "0")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		h.logger.Warn("Failed to start journalctl, using sample logs", zap.Error(err))
		h.generateSampleLogs()
		return
	}

	if err := cmd.Start(); err != nil {
		h.logger.Warn("Failed to start journalctl, using sample logs", zap.Error(err))
		h.generateSampleLogs()
		return
	}

	h.logger.Info("Started journalctl log collection")

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		log := h.parseJournaldEntry(line)
		if log != nil {
			h.addLog(*log)
		}
	}

	if err := scanner.Err(); err != nil {
		h.logger.Error("Error reading journalctl output", zap.Error(err))
	}
}

// parseJournaldEntry parses a journald JSON entry
func (h *LogsHandler) parseJournaldEntry(line string) *LogEntry {
	var entry map[string]interface{}
	if err := json.Unmarshal([]byte(line), &entry); err != nil {
		return nil
	}

	// Parse timestamp
	timestamp := time.Now().Format(time.RFC3339)
	if ts, ok := entry["__REALTIME_TIMESTAMP"].(string); ok {
		if us, err := strconv.ParseInt(ts, 10, 64); err == nil {
			timestamp = time.Unix(us/1_000_000, (us%1_000_000)*1000).Format(time.RFC3339)
		}
	}

	// Parse priority to level
	level := "info"
	if p, ok := entry["PRIORITY"].(string); ok {
		if priority, err := strconv.Atoi(p); err == nil {
			switch {
			case priority <= 3:
				level = "error"
			case priority == 4:
				level = "warn"
			case priority == 5, priority == 6:
				level = "info"
			case priority == 7:
				level = "debug"
			default:
				level = "trace"
			}
		}
	}

	// Parse message
	message := ""
	if m, ok := entry["MESSAGE"].(string); ok {
		message = m
	}

	// Parse source
	source := ""
	if s, ok := entry["SYSLOG_IDENTIFIER"].(string); ok {
		source = s
	} else if s, ok := entry["_COMM"].(string); ok {
		source = s
	}

	return &LogEntry{
		Timestamp: timestamp,
		Level:     level,
		Message:   message,
		Source:    source,
	}
}

// generateSampleLogs generates sample logs for development/testing
func (h *LogsHandler) generateSampleLogs() {
	sampleLogs := []struct {
		level   string
		source  string
		message string
	}{
		{"info", "controlplane", "Control plane server started on 0.0.0.0:8080"},
		{"info", "api", "HTTP request: GET /healthz"},
		{"debug", "scheduler", "Evaluating placement for new VM request"},
		{"info", "vm-service", "VM 'test-vm' created successfully"},
		{"warn", "node-service", "Node 'node-1' memory usage at 85%"},
		{"info", "storage-service", "Storage pool 'default' initialized"},
		{"debug", "grpc", "gRPC request: VMService.CreateVM"},
		{"error", "network-service", "Failed to create virtual network: VLAN already exists"},
		{"info", "scheduler", "VM scheduled to node 'node-2'"},
		{"info", "api", "HTTP request: POST /api/vms"},
	}

	// Add initial sample logs
	for i, sample := range sampleLogs {
		h.addLog(LogEntry{
			Timestamp: time.Now().Add(-time.Duration(len(sampleLogs)-i) * time.Minute).Format(time.RFC3339),
			Level:     sample.level,
			Source:    sample.source,
			Message:   sample.message,
			Fields: map[string]interface{}{
				"request_id": fmt.Sprintf("req-%08x", time.Now().UnixNano()),
			},
		})
	}

	// Generate new logs periodically
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		sample := sampleLogs[time.Now().Unix()%int64(len(sampleLogs))]
		h.addLog(LogEntry{
			Timestamp: time.Now().Format(time.RFC3339),
			Level:     sample.level,
			Source:    sample.source,
			Message:   sample.message,
			Fields: map[string]interface{}{
				"request_id": fmt.Sprintf("req-%08x", time.Now().UnixNano()),
			},
		})
	}
}
