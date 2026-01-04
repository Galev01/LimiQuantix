// Package server provides file transfer endpoints for VM guest file operations.
//
// These endpoints proxy file operations to the guest agent running inside VMs,
// enabling upload/download of files between host and guest via virtio-serial.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.uber.org/zap"
)

// FileTransferHandler handles file transfer operations to/from VM guests.
type FileTransferHandler struct {
	server *Server
	logger *zap.Logger
}

// NewFileTransferHandler creates a new file transfer handler.
func NewFileTransferHandler(s *Server) *FileTransferHandler {
	return &FileTransferHandler{
		server: s,
		logger: s.logger.Named("file-transfer"),
	}
}

// ServeHTTP routes file transfer requests.
func (h *FileTransferHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Parse path: /api/vms/{vmId}/files/{operation}
	// e.g., /api/vms/abc123/files/write
	// e.g., /api/vms/abc123/files/read
	// e.g., /api/vms/abc123/files/list

	path := strings.TrimPrefix(r.URL.Path, "/api/vms/")
	parts := strings.SplitN(path, "/files/", 2)

	if len(parts) != 2 {
		h.jsonError(w, "Invalid path format", http.StatusBadRequest)
		return
	}

	vmID := parts[0]
	operation := parts[1]

	if vmID == "" {
		h.jsonError(w, "VM ID is required", http.StatusBadRequest)
		return
	}

	h.logger.Debug("File transfer request",
		zap.String("vm_id", vmID),
		zap.String("operation", operation),
		zap.String("method", r.Method),
	)

	switch operation {
	case "write":
		if r.Method != http.MethodPost {
			h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleWrite(w, r, vmID)

	case "read":
		if r.Method != http.MethodPost {
			h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleRead(w, r, vmID)

	case "list":
		if r.Method != http.MethodGet {
			h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleList(w, r, vmID)

	case "stat":
		if r.Method != http.MethodGet {
			h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleStat(w, r, vmID)

	case "delete":
		if r.Method != http.MethodDelete {
			h.jsonError(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		h.handleDelete(w, r, vmID)

	default:
		h.jsonError(w, fmt.Sprintf("Unknown operation: %s", operation), http.StatusNotFound)
	}
}

// FileWriteRequest represents a request to write a file to the guest.
type FileWriteRequest struct {
	Path    string `json:"path"`              // Guest filesystem path
	Content string `json:"content,omitempty"` // Base64-encoded file content (for small files)
	Mode    int    `json:"mode,omitempty"`    // Unix file mode (default 0644)
}

// FileReadRequest represents a request to read a file from the guest.
type FileReadRequest struct {
	Path   string `json:"path"`             // Guest filesystem path
	Offset int64  `json:"offset,omitempty"` // Read offset (for chunked reads)
	Length int64  `json:"length,omitempty"` // Max bytes to read (0 = entire file)
}

// FileReadResponse represents the response from reading a file.
type FileReadResponse struct {
	Path      string `json:"path"`
	Content   string `json:"content"`   // Base64-encoded content
	Size      int64  `json:"size"`      // Total file size
	ReadBytes int64  `json:"readBytes"` // Bytes actually read
	EOF       bool   `json:"eof"`       // True if end of file reached
}

// FileListRequest represents a request to list a directory.
type FileListRequest struct {
	Path      string `json:"path"`
	Recursive bool   `json:"recursive,omitempty"`
}

// FileEntry represents a file or directory entry.
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	Mode    int    `json:"mode"`
	ModTime string `json:"modTime"`
}

// FileListResponse represents the response from listing a directory.
type FileListResponse struct {
	Path    string      `json:"path"`
	Entries []FileEntry `json:"entries"`
}

// FileStatResponse represents file metadata.
type FileStatResponse struct {
	Path    string `json:"path"`
	Exists  bool   `json:"exists"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	Mode    int    `json:"mode"`
	ModTime string `json:"modTime"`
}

// handleWrite handles file upload to guest.
func (h *FileTransferHandler) handleWrite(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	// Check content type
	contentType := r.Header.Get("Content-Type")

	if strings.HasPrefix(contentType, "multipart/form-data") {
		// Handle multipart upload (for larger files or browser uploads)
		h.handleMultipartWrite(w, r, vmID)
		return
	}

	// JSON request for simple writes
	var req FileWriteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonError(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		h.jsonError(w, "Path is required", http.StatusBadRequest)
		return
	}

	h.logger.Info("File write request",
		zap.String("vm_id", vmID),
		zap.String("path", req.Path),
		zap.Int("content_length", len(req.Content)),
	)

	// Get VM to find the node it's running on
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("VM not found: %v", err), http.StatusNotFound)
		return
	}

	// Get the node daemon connection
	nodeID := vm.Status.NodeID
	if nodeID == "" {
		h.jsonError(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	// Get node daemon client
	daemon := h.server.daemonPool.Get(nodeID)
	if daemon == nil {
		h.jsonError(w, "Cannot connect to node daemon", http.StatusServiceUnavailable)
		return
	}

	// Forward file write request to guest agent via node daemon
	// The node daemon will relay this to the guest agent over virtio-serial
	err = daemon.WriteFile(ctx, vmID, req.Path, []byte(req.Content), req.Mode)
	if err != nil {
		h.logger.Error("File write failed",
			zap.String("vm_id", vmID),
			zap.String("path", req.Path),
			zap.Error(err),
		)
		h.jsonError(w, fmt.Sprintf("File write failed: %v", err), http.StatusInternalServerError)
		return
	}

	h.logger.Info("File write successful",
		zap.String("vm_id", vmID),
		zap.String("path", req.Path),
	)

	h.jsonResponse(w, map[string]interface{}{
		"success": true,
		"path":    req.Path,
		"vmId":    vmID,
	})
}

// handleMultipartWrite handles multipart file uploads.
func (h *FileTransferHandler) handleMultipartWrite(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	// Parse multipart form (max 100MB)
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		h.jsonError(w, fmt.Sprintf("Failed to parse multipart form: %v", err), http.StatusBadRequest)
		return
	}

	// Get destination path
	destPath := r.FormValue("path")
	if destPath == "" {
		h.jsonError(w, "Destination path is required", http.StatusBadRequest)
		return
	}

	// Get the uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Failed to get uploaded file: %v", err), http.StatusBadRequest)
		return
	}
	defer file.Close()

	h.logger.Info("Multipart file upload",
		zap.String("vm_id", vmID),
		zap.String("dest_path", destPath),
		zap.String("filename", header.Filename),
		zap.Int64("size", header.Size),
	)

	// Read file content
	content, err := io.ReadAll(file)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Failed to read file: %v", err), http.StatusInternalServerError)
		return
	}

	// Get VM
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("VM not found: %v", err), http.StatusNotFound)
		return
	}

	nodeID := vm.Status.NodeID
	if nodeID == "" {
		h.jsonError(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	daemon, err := h.server.daemonPool.Get(ctx, nodeID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Cannot connect to node daemon: %v", err), http.StatusServiceUnavailable)
		return
	}

	// Write file to guest
	err = daemon.WriteFile(ctx, vmID, destPath, content, 0644)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("File write failed: %v", err), http.StatusInternalServerError)
		return
	}

	h.jsonResponse(w, map[string]interface{}{
		"success":  true,
		"path":     destPath,
		"filename": header.Filename,
		"size":     len(content),
		"vmId":     vmID,
	})
}

// handleRead handles file download from guest.
func (h *FileTransferHandler) handleRead(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	var req FileReadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.jsonError(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		h.jsonError(w, "Path is required", http.StatusBadRequest)
		return
	}

	h.logger.Info("File read request",
		zap.String("vm_id", vmID),
		zap.String("path", req.Path),
		zap.Int64("offset", req.Offset),
		zap.Int64("length", req.Length),
	)

	// Get VM
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("VM not found: %v", err), http.StatusNotFound)
		return
	}

	nodeID := vm.Status.NodeID
	if nodeID == "" {
		h.jsonError(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	daemon, err := h.server.daemonPool.Get(ctx, nodeID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Cannot connect to node daemon: %v", err), http.StatusServiceUnavailable)
		return
	}

	// Read file from guest
	content, totalSize, err := daemon.ReadFile(ctx, vmID, req.Path, req.Offset, req.Length)
	if err != nil {
		h.logger.Error("File read failed",
			zap.String("vm_id", vmID),
			zap.String("path", req.Path),
			zap.Error(err),
		)
		h.jsonError(w, fmt.Sprintf("File read failed: %v", err), http.StatusInternalServerError)
		return
	}

	readBytes := int64(len(content))
	eof := req.Offset+readBytes >= totalSize

	h.jsonResponse(w, FileReadResponse{
		Path:      req.Path,
		Content:   string(content), // Already base64 encoded by daemon
		Size:      totalSize,
		ReadBytes: readBytes,
		EOF:       eof,
	})
}

// handleList handles directory listing.
func (h *FileTransferHandler) handleList(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	h.logger.Debug("Directory list request",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)

	// Get VM
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("VM not found: %v", err), http.StatusNotFound)
		return
	}

	nodeID := vm.Status.NodeID
	if nodeID == "" {
		h.jsonError(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	daemon, err := h.server.daemonPool.Get(ctx, nodeID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Cannot connect to node daemon: %v", err), http.StatusServiceUnavailable)
		return
	}

	// List directory in guest
	entries, err := daemon.ListDirectory(ctx, vmID, path)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Directory listing failed: %v", err), http.StatusInternalServerError)
		return
	}

	// Convert to response format
	var fileEntries []FileEntry
	for _, e := range entries {
		fileEntries = append(fileEntries, FileEntry{
			Name:    e.Name,
			Path:    e.Path,
			IsDir:   e.IsDir,
			Size:    e.Size,
			Mode:    e.Mode,
			ModTime: e.ModTime,
		})
	}

	h.jsonResponse(w, FileListResponse{
		Path:    path,
		Entries: fileEntries,
	})
}

// handleStat handles file stat requests.
func (h *FileTransferHandler) handleStat(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	path := r.URL.Query().Get("path")
	if path == "" {
		h.jsonError(w, "Path is required", http.StatusBadRequest)
		return
	}

	h.logger.Debug("File stat request",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)

	// Get VM
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("VM not found: %v", err), http.StatusNotFound)
		return
	}

	nodeID := vm.Status.NodeID
	if nodeID == "" {
		h.jsonError(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	daemon, err := h.server.daemonPool.Get(ctx, nodeID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Cannot connect to node daemon: %v", err), http.StatusServiceUnavailable)
		return
	}

	// Stat file in guest
	stat, err := daemon.StatFile(ctx, vmID, path)
	if err != nil {
		// Check if it's a "not found" error
		if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "no such file") {
			h.jsonResponse(w, FileStatResponse{
				Path:   path,
				Exists: false,
			})
			return
		}
		h.jsonError(w, fmt.Sprintf("File stat failed: %v", err), http.StatusInternalServerError)
		return
	}

	h.jsonResponse(w, FileStatResponse{
		Path:    path,
		Exists:  true,
		IsDir:   stat.IsDir,
		Size:    stat.Size,
		Mode:    stat.Mode,
		ModTime: stat.ModTime,
	})
}

// handleDelete handles file deletion requests.
func (h *FileTransferHandler) handleDelete(w http.ResponseWriter, r *http.Request, vmID string) {
	ctx := r.Context()

	path := r.URL.Query().Get("path")
	if path == "" {
		h.jsonError(w, "Path is required", http.StatusBadRequest)
		return
	}

	h.logger.Info("File delete request",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)

	// Get VM
	vm, err := h.server.vmRepo.Get(ctx, vmID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("VM not found: %v", err), http.StatusNotFound)
		return
	}

	nodeID := vm.Status.NodeID
	if nodeID == "" {
		h.jsonError(w, "VM is not running on any node", http.StatusBadRequest)
		return
	}

	daemon, err := h.server.daemonPool.Get(ctx, nodeID)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("Cannot connect to node daemon: %v", err), http.StatusServiceUnavailable)
		return
	}

	// Delete file in guest
	err = daemon.DeleteFile(ctx, vmID, path)
	if err != nil {
		h.jsonError(w, fmt.Sprintf("File delete failed: %v", err), http.StatusInternalServerError)
		return
	}

	h.jsonResponse(w, map[string]interface{}{
		"success": true,
		"path":    path,
		"vmId":    vmID,
	})
}

// jsonError sends a JSON error response.
func (h *FileTransferHandler) jsonError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error":   message,
		"success": false,
	})
}

// jsonResponse sends a JSON success response.
func (h *FileTransferHandler) jsonResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(data)
}
