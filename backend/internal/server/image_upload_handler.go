// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
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
	mux.HandleFunc("/api/v1/images/notify", h.handleISONotification)
	mux.HandleFunc("/api/v1/images/folders", h.handleFolders)
	mux.HandleFunc("/api/v1/images/move", h.handleMoveImage)
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
// For shared storage (NFS), it writes directly to the share from QvDC.
// For local storage, it falls back to the control plane's local directory.
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
	var useLocalStorage = true

	// Determine where to write the ISO based on storage pool type
	logger.Info("Checking storage destination",
		zap.Bool("has_pool_id", storagePoolID != ""),
		zap.Bool("pool_repo_set", h.poolRepo != nil),
	)
	if storagePoolID != "" && h.poolRepo != nil {
		// Look up the storage pool to determine write strategy
		pool, err := h.poolRepo.Get(ctx, storagePoolID)
		if err != nil {
			h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to get storage pool: %v", err))
			logger.Error("Failed to get storage pool", zap.Error(err))
			return
		}

		// For NFS pools, write directly to the NFS share from QvDC
		if pool.Spec.Backend != nil && pool.Spec.Backend.NFSConfig != nil {
			useLocalStorage = false
			nfsConfig := pool.Spec.Backend.NFSConfig
			logger.Info("Writing ISO directly to NFS share",
				zap.String("server", nfsConfig.Server),
				zap.String("export", nfsConfig.ExportPath),
			)

			// Determine mount point - use custom mount point or generate one
			mountPoint := nfsConfig.MountPoint
			if mountPoint == "" {
				mountPoint = fmt.Sprintf("/var/lib/limiquantix/mnt/nfs-%s", pool.ID)
			}

			// Ensure NFS is mounted on QvDC
			if err := h.ensureNFSMounted(nfsConfig.Server, nfsConfig.ExportPath, mountPoint, nfsConfig.Options); err != nil {
				h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to mount NFS: %v", err))
				logger.Error("Failed to mount NFS share", zap.Error(err))
				return
			}

			// Create iso subdirectory
			isoDir := filepath.Join(mountPoint, "iso")
			if err := os.MkdirAll(isoDir, 0755); err != nil {
				h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to create ISO directory: %v", err))
				logger.Error("Failed to create ISO directory", zap.Error(err))
				return
			}

			// Write directly to NFS
			targetPath = filepath.Join(isoDir, job.Filename)
			outFile, err := os.Create(targetPath)
			if err != nil {
				h.updateJobStatus(job.ID, "failed", 0, 0, fmt.Sprintf("Failed to create file: %v", err))
				logger.Error("Failed to create file on NFS", zap.Error(err))
				return
			}
			defer outFile.Close()

			// Stream with progress updates
			buffer := make([]byte, 256*1024)
			for {
				n, readErr := file.Read(buffer)
				if n > 0 {
					if _, writeErr := outFile.Write(buffer[:n]); writeErr != nil {
						h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Write error: %v", writeErr))
						logger.Error("Failed to write to NFS", zap.Error(writeErr))
						return
					}
					uploaded += int64(n)

					if totalSize > 0 {
						percent := uint32(uploaded * 100 / totalSize)
						h.updateJobStatus(job.ID, "uploading", percent, uploaded, "")
					}
				}
				if readErr != nil {
					if readErr == io.EOF {
						break
					}
					h.updateJobStatus(job.ID, "failed", 0, uploaded, fmt.Sprintf("Read error: %v", readErr))
					logger.Error("Failed to read upload", zap.Error(readErr))
					return
				}
			}

			logger.Info("ISO uploaded directly to NFS share", zap.String("path", targetPath))
		} else {
			// For local/other storage types, fall back to control plane local storage
			logger.Info("Storage pool is not NFS, saving to control plane local storage")
		}
	}

	if useLocalStorage {
		// Local upload (no shared storage) - save to control plane
		logger.Info("Saving ISO locally on control plane")

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

// ensureNFSMounted ensures an NFS share is mounted at the specified mount point.
// If already mounted, it returns nil. If not mounted, it mounts the NFS share.
func (h *ImageUploadHandler) ensureNFSMounted(server, exportPath, mountPoint, options string) error {
	// Check if already mounted by looking at /proc/mounts
	mountsData, err := os.ReadFile("/proc/mounts")
	if err != nil {
		// On non-Linux systems (e.g., Windows dev), just ensure directory exists
		h.logger.Warn("Cannot read /proc/mounts, assuming non-Linux system", zap.Error(err))
		return os.MkdirAll(mountPoint, 0755)
	}

	nfsSource := fmt.Sprintf("%s:%s", server, exportPath)
	mounts := string(mountsData)

	// Check if this NFS share is already mounted at the mount point
	for _, line := range strings.Split(mounts, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 {
			if fields[0] == nfsSource && fields[1] == mountPoint {
				h.logger.Debug("NFS already mounted", zap.String("source", nfsSource), zap.String("mount", mountPoint))
				return nil
			}
		}
	}

	// Create mount point directory
	if err := os.MkdirAll(mountPoint, 0755); err != nil {
		return fmt.Errorf("failed to create mount point %s: %w", mountPoint, err)
	}

	// Build mount command
	args := []string{"-t", "nfs"}
	if options != "" {
		args = append(args, "-o", options)
	} else {
		// Default options for reliability
		args = append(args, "-o", "rw,soft,intr,timeo=30")
	}
	args = append(args, nfsSource, mountPoint)

	h.logger.Info("Mounting NFS share",
		zap.String("source", nfsSource),
		zap.String("mount", mountPoint),
		zap.Strings("args", args),
	)

	cmd := exec.Command("mount", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("mount failed: %s: %w", string(output), err)
	}

	h.logger.Info("NFS share mounted successfully", zap.String("mount", mountPoint))
	return nil
}

// =============================================================================
// ISO SYNC & FOLDER MANAGEMENT HANDLERS
// =============================================================================

// handleISONotification handles POST /api/v1/images/notify
// This endpoint receives ISO change notifications from QHCI nodes.
func (h *ImageUploadHandler) handleISONotification(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var notif storageservice.ISONotification
	if err := json.NewDecoder(r.Body).Decode(&notif); err != nil {
		h.logger.Error("Failed to decode ISO notification", zap.Error(err))
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	h.logger.Info("Received ISO notification",
		zap.String("node_id", notif.NodeID),
		zap.String("event_type", notif.EventType),
		zap.String("path", notif.Path),
	)

	if err := h.imageService.HandleISONotification(r.Context(), &notif); err != nil {
		h.logger.Error("Failed to process ISO notification", zap.Error(err))
		h.writeError(w, fmt.Sprintf("Failed to process notification: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "ISO notification processed",
	})
}

// handleFolders handles GET/POST /api/v1/images/folders
func (h *ImageUploadHandler) handleFolders(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleListFolders(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleListFolders returns all folders with optional tree structure.
func (h *ImageUploadHandler) handleListFolders(w http.ResponseWriter, r *http.Request) {
	// Check if tree format requested
	treeFormat := r.URL.Query().Get("format") == "tree"

	if treeFormat {
		tree, err := h.imageService.BuildFolderTree(r.Context())
		if err != nil {
			h.logger.Error("Failed to build folder tree", zap.Error(err))
			h.writeError(w, "Failed to get folders", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"tree": tree,
		})
	} else {
		folders, err := h.imageService.ListFolders(r.Context())
		if err != nil {
			h.logger.Error("Failed to list folders", zap.Error(err))
			h.writeError(w, "Failed to get folders", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"folders": folders,
		})
	}
}

// handleMoveImage handles POST /api/v1/images/move
// Request body: { "image_id": "...", "folder_path": "/windows/10" }
func (h *ImageUploadHandler) handleMoveImage(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ImageID    string `json:"image_id"`
		FolderPath string `json:"folder_path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.ImageID == "" {
		h.writeError(w, "image_id is required", http.StatusBadRequest)
		return
	}

	image, err := h.imageService.MoveImageToFolder(r.Context(), req.ImageID, req.FolderPath)
	if err != nil {
		h.logger.Error("Failed to move image",
			zap.String("image_id", req.ImageID),
			zap.String("folder", req.FolderPath),
			zap.Error(err),
		)
		// Check error type for proper status code
		if strings.Contains(err.Error(), "not found") {
			h.writeError(w, err.Error(), http.StatusNotFound)
		} else if strings.Contains(err.Error(), "invalid") {
			h.writeError(w, err.Error(), http.StatusBadRequest)
		} else {
			h.writeError(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"image": map[string]interface{}{
			"id":          image.ID,
			"name":        image.Name,
			"folder_path": image.Status.FolderPath,
		},
	})
}
