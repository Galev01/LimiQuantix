// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	storageservice "github.com/limiquantix/limiquantix/internal/services/storage"
)

// ImageUploadJob represents an active ISO upload.
type ImageUploadJob struct {
	ID              string    `json:"id"`
	ImageID         string    `json:"image_id"`
	Filename        string    `json:"filename"`
	Status          string    `json:"status"` // uploading, processing, completed, failed
	ProgressPercent uint32    `json:"progress_percent"`
	BytesUploaded   int64     `json:"bytes_uploaded"`
	BytesTotal      int64     `json:"bytes_total"`
	ErrorMessage    string    `json:"error_message,omitempty"`
	StartedAt       time.Time `json:"started_at"`
	CompletedAt     time.Time `json:"completed_at,omitempty"`
}

// ImageUploadHandler handles ISO image uploads.
type ImageUploadHandler struct {
	mu           sync.RWMutex
	jobs         map[string]*ImageUploadJob
	imageService *storageservice.ImageService
	poolRepo     storageservice.PoolRepository
	daemonPool   interface {
		GetNodeAddr(nodeID string) (string, error)
	}
	uploadDir string
	logger    *zap.Logger
}

// NewImageUploadHandler creates a new image upload handler.
func NewImageUploadHandler(imageService *storageservice.ImageService, logger *zap.Logger) *ImageUploadHandler {
	return &ImageUploadHandler{
		jobs:         make(map[string]*ImageUploadJob),
		imageService: imageService,
		uploadDir:    "/var/lib/limiquantix/iso-images",
		logger:       logger.Named("image-upload-handler"),
	}
}

// SetPoolRepository sets the pool repository for looking up pool info.
func (h *ImageUploadHandler) SetPoolRepository(repo storageservice.PoolRepository) {
	h.poolRepo = repo
}

// SetDaemonPool sets the daemon pool for forwarding uploads to nodes.
func (h *ImageUploadHandler) SetDaemonPool(dp interface {
	GetNodeAddr(nodeID string) (string, error)
}) {
	h.daemonPool = dp
}

// RegisterRoutes registers the upload routes.
func (h *ImageUploadHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/v1/images/upload", h.handleUpload)
	mux.HandleFunc("/api/v1/images/upload/status/", h.handleUploadStatus)
}

// handleUpload handles POST /api/v1/images/upload
func (h *ImageUploadHandler) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	h.logger.Info("Starting ISO upload")

	// Parse multipart form (max 10GB)
	if err := r.ParseMultipartForm(10 << 30); err != nil {
		h.logger.Error("Failed to parse multipart form", zap.Error(err))
		h.writeError(w, "Failed to parse upload", http.StatusBadRequest)
		return
	}

	// Get file
	file, header, err := r.FormFile("file")
	if err != nil {
		h.logger.Error("Failed to get file from form", zap.Error(err))
		h.writeError(w, "No file provided", http.StatusBadRequest)
		return
	}
	defer file.Close()

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext != ".iso" && ext != ".img" {
		h.writeError(w, "Invalid file type. Only .iso and .img files are allowed", http.StatusBadRequest)
		return
	}

	// Get metadata from form
	name := r.FormValue("name")
	if name == "" {
		name = strings.TrimSuffix(header.Filename, ext)
	}
	description := r.FormValue("description")
	osFamily := r.FormValue("os_family")
	distribution := r.FormValue("distribution")
	version := r.FormValue("version")
	storagePoolID := r.FormValue("storage_pool_id")
	nodeID := r.FormValue("node_id")

	// Create job
	jobID := uuid.New().String()
	imageID := uuid.New().String()

	job := &ImageUploadJob{
		ID:         jobID,
		ImageID:    imageID,
		Filename:   header.Filename,
		Status:     "uploading",
		BytesTotal: header.Size,
		StartedAt:  time.Now(),
	}

	h.mu.Lock()
	h.jobs[jobID] = job
	h.mu.Unlock()

	h.logger.Info("Created upload job",
		zap.String("job_id", jobID),
		zap.String("filename", header.Filename),
		zap.Int64("size", header.Size),
	)

	// Return job ID immediately and process in background
	h.writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"job_id":   jobID,
		"image_id": imageID,
		"message":  "Upload started",
	})

	// Process upload in background
	go h.processUpload(context.Background(), job, file, header.Size, name, description, osFamily, distribution, version, storagePoolID, nodeID)
}

// processUpload handles the actual file upload with progress tracking.
func (h *ImageUploadHandler) processUpload(
	ctx context.Context,
	job *ImageUploadJob,
	file io.Reader,
	totalSize int64,
	name, description, osFamily, distribution, version, storagePoolID, nodeID string,
) {
	logger := h.logger.With(
		zap.String("job_id", job.ID),
		zap.String("filename", job.Filename),
		zap.String("storage_pool_id", storagePoolID),
		zap.String("node_id", nodeID),
	)

	var targetPath string
	var uploaded int64

	// If we have a storage pool and node, forward to the node's upload endpoint
	if storagePoolID != "" && nodeID != "" && h.daemonPool != nil {
		logger.Info("Forwarding ISO upload to host node")

		nodeAddr, err := h.daemonPool.GetNodeAddr(nodeID)
		if err != nil {
			h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to get node address: %v", err))
			logger.Error("Failed to get node address", zap.Error(err))
			return
		}

		// Forward to node's upload endpoint with pool_id parameter
		// Note: Using HTTP since HTTPS is disabled by default on the node daemon
		uploadURL := fmt.Sprintf("http://%s/api/v1/storage/upload?pool_id=%s&subdir=iso", nodeAddr, storagePoolID)
		logger.Info("Forwarding to node", zap.String("url", uploadURL))

		// Create multipart writer
		bodyReader, bodyWriter := io.Pipe()
		multiWriter := multipart.NewWriter(bodyWriter)

		// Channel to signal goroutine errors
		errChan := make(chan error, 1)

		// Write multipart in goroutine
		go func() {
			var writeErr error
			defer func() {
				// IMPORTANT: Close multipart writer FIRST to write final boundary
				if closeErr := multiWriter.Close(); closeErr != nil && writeErr == nil {
					writeErr = closeErr
				}
				// Then close the pipe
				if writeErr != nil {
					bodyWriter.CloseWithError(writeErr)
				} else {
					bodyWriter.Close()
				}
				errChan <- writeErr
			}()

			part, err := multiWriter.CreateFormFile("file", job.Filename)
			if err != nil {
				logger.Error("Failed to create form file", zap.Error(err))
				writeErr = err
				return
			}

			buffer := make([]byte, 256*1024)
			for {
				n, readErr := file.Read(buffer)
				if n > 0 {
					if _, err := part.Write(buffer[:n]); err != nil {
						logger.Error("Failed to write to multipart", zap.Error(err))
						writeErr = err
						return
					}
					uploaded += int64(n)

					// Update progress
					if totalSize > 0 {
						percent := uint32(uploaded * 100 / totalSize)
						h.updateJobStatus(job.ID, "uploading", percent, uploaded, "")
					}
				}
				if readErr != nil {
					if readErr == io.EOF {
						break
					}
					logger.Error("Failed to read file", zap.Error(readErr))
					writeErr = readErr
					return
				}
			}
		}()

		// Make HTTP request to node (skip TLS verification for self-signed certs)
		httpClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
			Timeout: 30 * time.Minute, // Allow long uploads
		}

		req, err := http.NewRequestWithContext(ctx, "POST", uploadURL, bodyReader)
		if err != nil {
			h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Failed to create request: %v", err))
			logger.Error("Failed to create HTTP request", zap.Error(err))
			return
		}
		req.Header.Set("Content-Type", multiWriter.FormDataContentType())

		resp, err := httpClient.Do(req)
		
		// Wait for the writer goroutine to finish
		writerErr := <-errChan
		
		if err != nil {
			h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Failed to upload to node: %v", err))
			logger.Error("Failed to upload to node", zap.Error(err))
			return
		}
		defer resp.Body.Close()

		if writerErr != nil {
			h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Failed writing multipart data: %v", writerErr))
			logger.Error("Failed writing multipart data", zap.Error(writerErr))
			return
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			body, _ := io.ReadAll(resp.Body)
			h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Node upload failed: %s", string(body)))
			logger.Error("Node upload failed", zap.Int("status", resp.StatusCode), zap.String("body", string(body)))
			return
		}

		// Parse response to get the path
		var nodeResp map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&nodeResp); err == nil {
			if path, ok := nodeResp["path"].(string); ok {
				targetPath = path
			}
		}

		logger.Info("ISO uploaded to node successfully", zap.String("path", targetPath))
	} else {
		// Local upload (no node specified) - save to control plane
		logger.Info("Saving ISO locally (no node specified)")

		// Ensure upload directory exists
		if err := os.MkdirAll(h.uploadDir, 0755); err != nil {
			h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to create upload directory: %v", err))
			logger.Error("Failed to create upload directory", zap.Error(err))
			return
		}

		// Create target file
		targetPath = filepath.Join(h.uploadDir, fmt.Sprintf("%s-%s", job.ImageID, job.Filename))
		outFile, err := os.Create(targetPath)
		if err != nil {
			h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to create file: %v", err))
			logger.Error("Failed to create target file", zap.Error(err))
			return
		}
		defer outFile.Close()

		// Copy with progress tracking
		buffer := make([]byte, 256*1024) // 256KB buffer
		lastUpdate := time.Now()

		for {
			n, readErr := file.Read(buffer)
			if n > 0 {
				if _, writeErr := outFile.Write(buffer[:n]); writeErr != nil {
					os.Remove(targetPath)
					h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Write error: %v", writeErr))
					logger.Error("Failed to write to file", zap.Error(writeErr))
					return
				}
				uploaded += int64(n)

				// Update progress every 500ms
				if time.Since(lastUpdate) > 500*time.Millisecond {
					var percent uint32
					if totalSize > 0 {
						percent = uint32(uploaded * 100 / totalSize)
					}
					h.updateJobStatus(job.ID, "uploading", percent, uploaded, "")
					lastUpdate = time.Now()

					logger.Debug("Upload progress",
						zap.Int64("uploaded", uploaded),
						zap.Int64("total", totalSize),
						zap.Uint32("percent", percent),
					)
				}
			}

			if readErr != nil {
				if readErr == io.EOF {
					break
				}
				os.Remove(targetPath)
				h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Read error: %v", readErr))
				logger.Error("Failed to read from upload", zap.Error(readErr))
				return
			}
		}
	}

	// Update status to processing
	h.updateJobStatus(job.ID, "processing", 100, uploaded, "")

	// Create image record in the repository
	osInfo := domain.OSInfo{
		Family:             parseOSFamily(osFamily),
		Distribution:       distribution,
		Version:            version,
		Architecture:       "x86_64",
		ProvisioningMethod: domain.ProvisioningMethodNone,
	}

	image := &domain.Image{
		ID:          job.ImageID,
		Name:        name,
		Description: description,
		Spec: domain.ImageSpec{
			Format:     domain.ImageFormatISO,
			Visibility: domain.ImageVisibilityProject,
			OS:         osInfo,
		},
		Status: domain.ImageStatus{
			Phase:         domain.ImagePhaseReady,
			SizeBytes:     uint64(uploaded),
			Path:          targetPath,
			StoragePoolID: storagePoolID,
			NodeID:        nodeID,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Get the image repository from the service and create the image
	repo := h.imageService.GetRepository()
	if repo != nil {
		if _, err := repo.Create(ctx, image); err != nil {
			logger.Error("Failed to create image record", zap.Error(err))
			// Don't fail - file is uploaded successfully
		}
	}

	// Mark as completed
	h.updateJobStatus(job.ID, "completed", 100, uploaded, "")
	h.mu.Lock()
	if j, ok := h.jobs[job.ID]; ok {
		j.CompletedAt = time.Now()
	}
	h.mu.Unlock()

	logger.Info("Upload completed",
		zap.String("image_id", job.ImageID),
		zap.Int64("size", uploaded),
		zap.String("path", targetPath),
	)
}

// handleUploadStatus handles GET /api/v1/images/upload/status/{jobId}
func (h *ImageUploadHandler) handleUploadStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract job ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/images/upload/status/")
	jobID := strings.TrimSuffix(path, "/")

	if jobID == "" {
		h.writeError(w, "Job ID required", http.StatusBadRequest)
		return
	}

	h.mu.RLock()
	job, ok := h.jobs[jobID]
	h.mu.RUnlock()

	if !ok {
		h.writeError(w, "Job not found", http.StatusNotFound)
		return
	}

	// Return a copy
	h.mu.RLock()
	jobCopy := *job
	h.mu.RUnlock()

	h.writeJSON(w, http.StatusOK, jobCopy)
}

// updateJobStatus updates the status of an upload job.
func (h *ImageUploadHandler) updateJobStatus(jobID, status string, percent uint32, uploaded int64, errorMsg string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if job, ok := h.jobs[jobID]; ok {
		job.Status = status
		job.ProgressPercent = percent
		job.BytesUploaded = uploaded
		job.ErrorMessage = errorMsg
	}
}

// writeJSON writes a JSON response.
func (h *ImageUploadHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeError writes an error response.
func (h *ImageUploadHandler) writeError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// parseOSFamily converts a string to OSFamily.
func parseOSFamily(family string) domain.OSFamily {
	switch strings.ToUpper(family) {
	case "LINUX":
		return domain.OSFamilyLinux
	case "WINDOWS":
		return domain.OSFamilyWindows
	case "BSD":
		return domain.OSFamilyBSD
	case "OTHER":
		return domain.OSFamilyOther
	default:
		return domain.OSFamilyUnknown
	}
}

// CleanupOldJobs removes completed jobs older than the given duration.
func (h *ImageUploadHandler) CleanupOldJobs(maxAge time.Duration) {
	h.mu.Lock()
	defer h.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, job := range h.jobs {
		if job.CompletedAt.IsZero() {
			continue // Still running
		}
		if job.CompletedAt.Before(cutoff) {
			delete(h.jobs, id)
			h.logger.Debug("Cleaned up old upload job", zap.String("job_id", id))
		}
	}
}
