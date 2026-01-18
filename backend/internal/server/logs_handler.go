// Package server provides HTTP handlers for system logs.
package server

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// LogEntry represents a single log entry
type LogEntry struct {
	Timestamp     string                 `json:"timestamp"`
	Level         string                 `json:"level"`
	Message       string                 `json:"message"`
	Source        string                 `json:"source,omitempty"`
	Fields        map[string]interface{} `json:"fields,omitempty"`
	StackTrace    string                 `json:"stackTrace,omitempty"`
	RequestID     string                 `json:"requestId,omitempty"`
	VMID          string                 `json:"vmId,omitempty"`
	NodeID        string                 `json:"nodeId,omitempty"`
	DurationMs    int64                  `json:"durationMs,omitempty"`
	// UI-specific fields
	Action        string                 `json:"action,omitempty"`
	Component     string                 `json:"component,omitempty"`
	Target        string                 `json:"target,omitempty"`
	CorrelationID string                 `json:"correlationId,omitempty"`
	UserID        string                 `json:"userId,omitempty"`
	SessionID     string                 `json:"sessionId,omitempty"`
	UserAction    bool                   `json:"userAction,omitempty"`
}

// UILogEntry represents a log entry submitted from the UI
type UILogEntry struct {
	Timestamp     string                 `json:"timestamp"`
	Level         string                 `json:"level"`
	Action        string                 `json:"action"`
	Component     string                 `json:"component"`
	Target        string                 `json:"target"`
	Message       string                 `json:"message"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
	CorrelationID string                 `json:"correlationId,omitempty"`
	UserID        string                 `json:"userId,omitempty"`
	SessionID     string                 `json:"sessionId,omitempty"`
	UserAction    bool                   `json:"userAction"`
}

// UILogsRequest is the request body for submitting UI logs
type UILogsRequest struct {
	Logs []UILogEntry `json:"logs"`
}

// UILogsResponse is the response for UI log submission
type UILogsResponse struct {
	Accepted int    `json:"accepted"`
	Message  string `json:"message"`
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

	// Add initial startup log
	h.addLog(LogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		Level:     "info",
		Source:    "controlplane",
		Message:   "Log collection started",
		Fields: map[string]interface{}{
			"os":   runtime.GOOS,
			"arch": runtime.GOARCH,
		},
	})

	// Start background log collection (only on Linux)
	if runtime.GOOS == "linux" {
		go h.collectJournaldLogs()
	}

	return h
}

// RegisterRoutes registers the logs routes
func (h *LogsHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/logs", h.handleGetLogs)
	mux.HandleFunc("/api/logs/sources", h.handleGetSources)
	mux.HandleFunc("/api/logs/stream", h.handleLogStream)
	mux.HandleFunc("/api/logs/ui", h.handleSubmitUILogs)
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

	// Return known log sources including UI components
	sources := []string{
		"controlplane",
		"vm-service",
		"node-service",
		"storage-service",
		"network-service",
		"scheduler",
		"api",
		"grpc",
		// UI components
		"ui-vm",
		"ui-storage",
		"ui-network",
		"ui-cluster",
		"ui-admin",
		"ui-settings",
		"ui-dashboard",
		"ui-console",
		"ui-auth",
		"ui-alerts",
		"ui-monitoring",
		"ui-logs",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sources)
}

// handleSubmitUILogs handles POST /api/logs/ui - receives UI action logs from the frontend
func (h *LogsHandler) handleSubmitUILogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req UILogsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Warn("Failed to parse UI logs request", zap.Error(err))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid request body"})
		return
	}

	// Process each UI log entry
	accepted := 0
	for _, uiLog := range req.Logs {
		// Convert UI log to standard log entry
		logEntry := LogEntry{
			Timestamp:     uiLog.Timestamp,
			Level:         uiLog.Level,
			Message:       uiLog.Message,
			Source:        "ui-" + uiLog.Component, // Prefix with "ui-" for easy filtering
			Fields:        uiLog.Metadata,
			Action:        uiLog.Action,
			Component:     uiLog.Component,
			Target:        uiLog.Target,
			CorrelationID: uiLog.CorrelationID,
			UserID:        uiLog.UserID,
			SessionID:     uiLog.SessionID,
			UserAction:    true,
		}

		// Add to buffer and broadcast
		h.addLog(logEntry)
		accepted++

		// Also log to zap for persistence
		h.logger.Info("UI action",
			zap.String("action", uiLog.Action),
			zap.String("component", uiLog.Component),
			zap.String("target", uiLog.Target),
			zap.String("message", uiLog.Message),
			zap.String("correlationId", uiLog.CorrelationID),
			zap.String("sessionId", uiLog.SessionID),
			zap.String("userId", uiLog.UserID),
		)
	}

	// Return success response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(UILogsResponse{
		Accepted: accepted,
		Message:  "Logs accepted",
	})
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

// AddLog adds a log entry to the buffer and broadcasts it.
// This is exported so other parts of the application can log to this handler.
func (h *LogsHandler) AddLog(log LogEntry) {
	h.addLog(log)
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

// collectJournaldLogs collects logs from journald (Linux only)
func (h *LogsHandler) collectJournaldLogs() {
	// Try to read from journald on Linux
	cmd := exec.Command("journalctl", "-f", "-o", "json", "-n", "100")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		h.logger.Warn("Failed to start journalctl", zap.Error(err))
		return
	}

	if err := cmd.Start(); err != nil {
		h.logger.Warn("Failed to start journalctl", zap.Error(err))
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

// ZapLogHook is a zap core that forwards logs to the LogsHandler
type ZapLogHook struct {
	handler *LogsHandler
	core    zapcore.Core
}

// NewZapLogHook creates a zap core that forwards logs to the LogsHandler
func NewZapLogHook(handler *LogsHandler, core zapcore.Core) zapcore.Core {
	return &ZapLogHook{
		handler: handler,
		core:    core,
	}
}

func (h *ZapLogHook) Enabled(level zapcore.Level) bool {
	return h.core.Enabled(level)
}

func (h *ZapLogHook) With(fields []zapcore.Field) zapcore.Core {
	return &ZapLogHook{
		handler: h.handler,
		core:    h.core.With(fields),
	}
}

func (h *ZapLogHook) Check(entry zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if h.core.Enabled(entry.Level) {
		return ce.AddCore(entry, h)
	}
	return ce
}

func (h *ZapLogHook) Write(entry zapcore.Entry, fields []zapcore.Field) error {
	// Forward to the underlying core
	if err := h.core.Write(entry, fields); err != nil {
		return err
	}

	// Convert zap level to string
	level := "info"
	switch entry.Level {
	case zapcore.DebugLevel:
		level = "debug"
	case zapcore.InfoLevel:
		level = "info"
	case zapcore.WarnLevel:
		level = "warn"
	case zapcore.ErrorLevel, zapcore.DPanicLevel, zapcore.PanicLevel, zapcore.FatalLevel:
		level = "error"
	}

	// Extract fields
	fieldsMap := make(map[string]interface{})
	for _, f := range fields {
		switch f.Type {
		case zapcore.StringType:
			fieldsMap[f.Key] = f.String
		case zapcore.Int64Type, zapcore.Int32Type, zapcore.Int16Type, zapcore.Int8Type:
			fieldsMap[f.Key] = f.Integer
		case zapcore.Float64Type:
			fieldsMap[f.Key] = f.Integer // This is actually the float bits
		case zapcore.BoolType:
			fieldsMap[f.Key] = f.Integer == 1
		case zapcore.DurationType:
			fieldsMap[f.Key] = time.Duration(f.Integer).String()
		default:
			if f.Interface != nil {
				fieldsMap[f.Key] = f.Interface
			}
		}
	}

	// Add to logs handler
	h.handler.addLog(LogEntry{
		Timestamp:  entry.Time.Format(time.RFC3339),
		Level:      level,
		Message:    entry.Message,
		Source:     entry.LoggerName,
		Fields:     fieldsMap,
		StackTrace: entry.Stack,
	})

	return nil
}

func (h *ZapLogHook) Sync() error {
	return h.core.Sync()
}
