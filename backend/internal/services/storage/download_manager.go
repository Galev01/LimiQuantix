// Package storage implements storage-related services including image downloads.
package storage

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	storagev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1"
)

// DownloadJob represents an active image download.
type DownloadJob struct {
	ID              string    `json:"id"`
	ImageID         string    `json:"image_id"`
	CatalogID       string    `json:"catalog_id"`
	URL             string    `json:"url"`
	TargetPath      string    `json:"target_path"`
	NodeID          string    `json:"node_id"`
	Status          string    `json:"status"` // pending, downloading, converting, completed, failed
	ProgressPercent uint32    `json:"progress_percent"`
	BytesDownloaded uint64    `json:"bytes_downloaded"`
	BytesTotal      uint64    `json:"bytes_total"`
	ErrorMessage    string    `json:"error_message,omitempty"`
	StartedAt       time.Time `json:"started_at"`
	CompletedAt     time.Time `json:"completed_at,omitempty"`
}

// DownloadManager manages image download jobs.
type DownloadManager struct {
	mu       sync.RWMutex
	jobs     map[string]*DownloadJob
	imageRepo ImageRepository
	catalog   []CatalogEntry
	logger   *zap.Logger
}

// NewDownloadManager creates a new download manager.
func NewDownloadManager(imageRepo ImageRepository, catalog []CatalogEntry, logger *zap.Logger) *DownloadManager {
	return &DownloadManager{
		jobs:      make(map[string]*DownloadJob),
		imageRepo: imageRepo,
		catalog:   catalog,
		logger:    logger.Named("download-manager"),
	}
}

// GetJob returns a download job by ID.
func (dm *DownloadManager) GetJob(jobID string) *DownloadJob {
	dm.mu.RLock()
	defer dm.mu.RUnlock()
	if job, ok := dm.jobs[jobID]; ok {
		// Return a copy
		jobCopy := *job
		return &jobCopy
	}
	return nil
}

// GetJobStatus returns the status of a download job.
func (dm *DownloadManager) GetJobStatus(jobID string) *storagev1.ImportStatus {
	job := dm.GetJob(jobID)
	if job == nil {
		return &storagev1.ImportStatus{
			JobId:  jobID,
			Status: storagev1.ImportStatus_UNKNOWN,
		}
	}

	var status storagev1.ImportStatus_Status
	switch job.Status {
	case "pending":
		status = storagev1.ImportStatus_PENDING
	case "downloading":
		status = storagev1.ImportStatus_DOWNLOADING
	case "converting":
		status = storagev1.ImportStatus_CONVERTING
	case "completed":
		status = storagev1.ImportStatus_COMPLETED
	case "failed":
		status = storagev1.ImportStatus_FAILED
	default:
		status = storagev1.ImportStatus_UNKNOWN
	}

	return &storagev1.ImportStatus{
		JobId:           job.ID,
		ImageId:         job.ImageID,
		Status:          status,
		ProgressPercent: job.ProgressPercent,
		BytesDownloaded: job.BytesDownloaded,
		BytesTotal:      job.BytesTotal,
		ErrorMessage:    job.ErrorMessage,
	}
}

// ListJobs returns all active jobs.
func (dm *DownloadManager) ListJobs() []*DownloadJob {
	dm.mu.RLock()
	defer dm.mu.RUnlock()

	jobs := make([]*DownloadJob, 0, len(dm.jobs))
	for _, job := range dm.jobs {
		jobCopy := *job
		jobs = append(jobs, &jobCopy)
	}
	return jobs
}

// StartDownload starts a download job for a catalog image.
func (dm *DownloadManager) StartDownload(ctx context.Context, jobID, imageID, catalogID, nodeID, targetDir string) error {
	// Find catalog entry
	var entry *CatalogEntry
	for _, e := range dm.catalog {
		if e.ID == catalogID {
			entry = &e
			break
		}
	}

	if entry == nil {
		return fmt.Errorf("catalog entry not found: %s", catalogID)
	}

	// Determine target path
	filename := fmt.Sprintf("%s.qcow2", catalogID)
	targetPath := filepath.Join(targetDir, filename)

	// Create job
	job := &DownloadJob{
		ID:              jobID,
		ImageID:         imageID,
		CatalogID:       catalogID,
		URL:             entry.URL,
		TargetPath:      targetPath,
		NodeID:          nodeID,
		Status:          "pending",
		ProgressPercent: 0,
		StartedAt:       time.Now(),
	}

	dm.mu.Lock()
	dm.jobs[jobID] = job
	dm.mu.Unlock()

	// Start download in background
	go dm.runDownload(ctx, job)

	dm.logger.Info("Started download job",
		zap.String("job_id", jobID),
		zap.String("catalog_id", catalogID),
		zap.String("url", entry.URL),
		zap.String("target", targetPath),
	)

	return nil
}

// runDownload performs the actual download.
func (dm *DownloadManager) runDownload(ctx context.Context, job *DownloadJob) {
	logger := dm.logger.With(
		zap.String("job_id", job.ID),
		zap.String("url", job.URL),
	)

	dm.updateJobStatus(job.ID, "downloading", 0, 0, 0, "")
	logger.Info("Starting download")

	// Create HTTP request
	req, err := http.NewRequestWithContext(ctx, "GET", job.URL, nil)
	if err != nil {
		dm.updateJobStatus(job.ID, "failed", 0, 0, 0, fmt.Sprintf("Failed to create request: %v", err))
		return
	}

	// Make request
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		dm.updateJobStatus(job.ID, "failed", 0, 0, 0, fmt.Sprintf("Download failed: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		dm.updateJobStatus(job.ID, "failed", 0, 0, 0, fmt.Sprintf("HTTP error: %d", resp.StatusCode))
		return
	}

	// Get total size
	totalBytes := uint64(resp.ContentLength)
	if totalBytes <= 0 {
		totalBytes = 0 // Unknown size
	}

	dm.updateJobStatus(job.ID, "downloading", 0, 0, totalBytes, "")

	// Ensure target directory exists
	if err := os.MkdirAll(filepath.Dir(job.TargetPath), 0755); err != nil {
		dm.updateJobStatus(job.ID, "failed", 0, 0, 0, fmt.Sprintf("Failed to create directory: %v", err))
		return
	}

	// Create target file
	file, err := os.Create(job.TargetPath)
	if err != nil {
		dm.updateJobStatus(job.ID, "failed", 0, 0, 0, fmt.Sprintf("Failed to create file: %v", err))
		return
	}
	defer file.Close()

	// Download with progress
	var downloaded uint64
	buffer := make([]byte, 32*1024) // 32KB buffer
	lastUpdate := time.Now()

	for {
		select {
		case <-ctx.Done():
			os.Remove(job.TargetPath)
			dm.updateJobStatus(job.ID, "failed", 0, downloaded, totalBytes, "Download cancelled")
			return
		default:
		}

		n, err := resp.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := file.Write(buffer[:n]); writeErr != nil {
				os.Remove(job.TargetPath)
				dm.updateJobStatus(job.ID, "failed", 0, downloaded, totalBytes, fmt.Sprintf("Write error: %v", writeErr))
				return
			}
			downloaded += uint64(n)

			// Update progress every second
			if time.Since(lastUpdate) > time.Second {
				var percent uint32
				if totalBytes > 0 {
					percent = uint32(downloaded * 100 / totalBytes)
				}
				dm.updateJobStatus(job.ID, "downloading", percent, downloaded, totalBytes, "")
				lastUpdate = time.Now()

				logger.Debug("Download progress",
					zap.Uint64("downloaded", downloaded),
					zap.Uint64("total", totalBytes),
					zap.Uint32("percent", percent),
				)
			}
		}

		if err != nil {
			if err == io.EOF {
				break // Download complete
			}
			os.Remove(job.TargetPath)
			dm.updateJobStatus(job.ID, "failed", 0, downloaded, totalBytes, fmt.Sprintf("Read error: %v", err))
			return
		}
	}

	// Update image status in repository
	dm.updateJobStatus(job.ID, "completed", 100, downloaded, totalBytes, "")

	// Update the image record
	image, err := dm.imageRepo.Get(ctx, job.ImageID)
	if err == nil && image != nil {
		image.Status.Phase = domain.ImagePhaseReady
		image.Status.SizeBytes = downloaded
		image.Status.Path = job.TargetPath
		image.Status.ProgressPercent = 100
		dm.imageRepo.Update(ctx, image)
	}

	logger.Info("Download completed",
		zap.Uint64("size_bytes", downloaded),
		zap.String("target", job.TargetPath),
	)
}

// updateJobStatus updates the status of a job.
func (dm *DownloadManager) updateJobStatus(jobID, status string, percent uint32, downloaded, total uint64, errorMsg string) {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	if job, ok := dm.jobs[jobID]; ok {
		job.Status = status
		job.ProgressPercent = percent
		job.BytesDownloaded = downloaded
		job.BytesTotal = total
		job.ErrorMessage = errorMsg
		if status == "completed" || status == "failed" {
			job.CompletedAt = time.Now()
		}
	}
}

// CleanupOldJobs removes completed jobs older than the given duration.
func (dm *DownloadManager) CleanupOldJobs(maxAge time.Duration) {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, job := range dm.jobs {
		if job.CompletedAt.IsZero() {
			continue // Still running
		}
		if job.CompletedAt.Before(cutoff) {
			delete(dm.jobs, id)
			dm.logger.Debug("Cleaned up old job", zap.String("job_id", id))
		}
	}
}
