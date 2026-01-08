// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"go.uber.org/zap"

	storageservice "github.com/limiquantix/limiquantix/internal/services/storage"
)

// OVAUploadHandler handles OVA file uploads via HTTP multipart.
type OVAUploadHandler struct {
	ovaService *storageservice.OVAService
	logger     *zap.Logger
}

// NewOVAUploadHandler creates a new OVA upload handler.
func NewOVAUploadHandler(ovaService *storageservice.OVAService, logger *zap.Logger) *OVAUploadHandler {
	return &OVAUploadHandler{
		ovaService: ovaService,
		logger:     logger.Named("ova-upload"),
	}
}

// ServeHTTP handles OVA upload requests.
func (h *OVAUploadHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/ova")

	switch {
	case path == "/upload" && r.Method == http.MethodPost:
		h.handleUpload(w, r)
	case strings.HasPrefix(path, "/status/") && r.Method == http.MethodGet:
		jobID := strings.TrimPrefix(path, "/status/")
		h.handleGetStatus(w, r, jobID)
	default:
		http.Error(w, "Not Found", http.StatusNotFound)
	}
}

// handleUpload handles POST /api/v1/ova/upload
func (h *OVAUploadHandler) handleUpload(w http.ResponseWriter, r *http.Request) {
	// Parse multipart form with 50GB max memory
	// This is a large limit because OVA files can be very large
	maxSize := int64(50 * 1024 * 1024 * 1024) // 50GB
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)

	if err := r.ParseMultipartForm(32 << 20); err != nil { // 32MB in memory
		h.logger.Error("Failed to parse multipart form", zap.Error(err))
		h.writeError(w, http.StatusBadRequest, "Failed to parse upload: "+err.Error())
		return
	}

	// Get the uploaded file
	file, header, err := r.FormFile("file")
	if err != nil {
		h.logger.Error("Failed to get file from form", zap.Error(err))
		h.writeError(w, http.StatusBadRequest, "No file provided: "+err.Error())
		return
	}
	defer file.Close()

	// Validate file extension
	filename := header.Filename
	if !strings.HasSuffix(strings.ToLower(filename), ".ova") {
		h.writeError(w, http.StatusBadRequest, "File must have .ova extension")
		return
	}

	// Get file size
	var fileSize int64
	if header.Size > 0 {
		fileSize = header.Size
	} else {
		// Try to get size from Content-Length or seek
		if seeker, ok := file.(io.Seeker); ok {
			size, err := seeker.Seek(0, io.SeekEnd)
			if err == nil {
				fileSize = size
				seeker.Seek(0, io.SeekStart)
			}
		}
	}

	h.logger.Info("Received OVA upload",
		zap.String("filename", filename),
		zap.Int64("size", fileSize),
	)

	// Create upload job
	job, err := h.ovaService.CreateUploadJob(filename, fileSize)
	if err != nil {
		h.logger.Error("Failed to create upload job", zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, "Failed to create upload job: "+err.Error())
		return
	}

	// Save the uploaded file
	outFile, err := os.Create(job.TempFilePath)
	if err != nil {
		h.logger.Error("Failed to create temp file", zap.Error(err))
		h.writeError(w, http.StatusInternalServerError, "Failed to save file: "+err.Error())
		return
	}

	// Copy with progress tracking
	var written int64
	buf := make([]byte, 1024*1024) // 1MB buffer
	for {
		n, err := file.Read(buf)
		if n > 0 {
			nw, werr := outFile.Write(buf[:n])
			if werr != nil {
				outFile.Close()
				os.Remove(job.TempFilePath)
				h.logger.Error("Failed to write file", zap.Error(werr))
				h.writeError(w, http.StatusInternalServerError, "Failed to save file: "+werr.Error())
				return
			}
			written += int64(nw)

			// Update progress
			h.ovaService.UpdateJobProgress(job.JobID, written)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			outFile.Close()
			os.Remove(job.TempFilePath)
			h.logger.Error("Failed to read file", zap.Error(err))
			h.writeError(w, http.StatusInternalServerError, "Failed to read file: "+err.Error())
			return
		}
	}
	outFile.Close()

	h.logger.Info("OVA file saved",
		zap.String("job_id", job.JobID),
		zap.String("path", job.TempFilePath),
		zap.Int64("bytes", written),
	)

	// Start async processing
	go func() {
		ctx := r.Context()
		if err := h.ovaService.ProcessOVA(ctx, job.JobID); err != nil {
			h.logger.Error("OVA processing failed",
				zap.String("job_id", job.JobID),
				zap.Error(err),
			)
		}
	}()

	// Return job ID for status polling
	h.writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"job_id":   job.JobID,
		"message":  "OVA upload accepted, processing started",
		"filename": filename,
		"size":     written,
	})
}

// handleGetStatus handles GET /api/v1/ova/status/{jobId}
func (h *OVAUploadHandler) handleGetStatus(w http.ResponseWriter, r *http.Request, jobID string) {
	job, err := h.ovaService.GetJob(jobID)
	if err != nil {
		h.writeError(w, http.StatusNotFound, "Job not found: "+err.Error())
		return
	}

	response := map[string]interface{}{
		"job_id":           job.JobID,
		"status":           string(job.Status),
		"progress_percent": job.ProgressPercent,
		"current_step":     job.CurrentStep,
		"bytes_uploaded":   job.BytesUploaded,
		"bytes_total":      job.BytesTotal,
	}

	if job.ImageID != "" {
		response["image_id"] = job.ImageID
	}
	if job.ErrorMessage != "" {
		response["error_message"] = job.ErrorMessage
	}
	if job.Metadata != nil {
		response["metadata"] = map[string]interface{}{
			"vm_name":     job.Metadata.VMName,
			"description": job.Metadata.Description,
			"hardware": map[string]interface{}{
				"cpu_count":  job.Metadata.Hardware.CPUCount,
				"memory_mib": job.Metadata.Hardware.MemoryMiB,
				"firmware":   job.Metadata.Hardware.Firmware,
			},
			"disks":    job.Metadata.Disks,
			"networks": job.Metadata.Networks,
			"product":  job.Metadata.Product,
		}
	}

	h.writeJSON(w, http.StatusOK, response)
}

// writeJSON writes a JSON response.
func (h *OVAUploadHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// writeError writes an error response.
func (h *OVAUploadHandler) writeError(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, map[string]interface{}{
		"error":   http.StatusText(status),
		"message": message,
	})
}

// RegisterRoutes registers the OVA upload routes on the given mux.
func (h *OVAUploadHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("/api/v1/ova/", h)
}

// OVAUploadResponse represents the response from an OVA upload.
type OVAUploadResponse struct {
	JobID    string `json:"job_id"`
	Message  string `json:"message"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
}

// OVAStatusResponse represents the status of an OVA upload job.
type OVAStatusResponse struct {
	JobID           string      `json:"job_id"`
	Status          string      `json:"status"`
	ProgressPercent uint32      `json:"progress_percent"`
	CurrentStep     string      `json:"current_step"`
	BytesUploaded   uint64      `json:"bytes_uploaded"`
	BytesTotal      uint64      `json:"bytes_total"`
	ImageID         string      `json:"image_id,omitempty"`
	ErrorMessage    string      `json:"error_message,omitempty"`
	Metadata        interface{} `json:"metadata,omitempty"`
}

// parseContentLength parses the Content-Length header.
func parseContentLength(r *http.Request) int64 {
	cl := r.Header.Get("Content-Length")
	if cl == "" {
		return 0
	}
	size, err := strconv.ParseInt(cl, 10, 64)
	if err != nil {
		return 0
	}
	return size
}

// formatBytes formats bytes as a human-readable string.
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}
