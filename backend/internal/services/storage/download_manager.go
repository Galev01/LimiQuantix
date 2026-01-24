// Package storage implements storage-related services including image downloads.
package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/node"
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
	PoolID          string    `json:"pool_id"`
	Status          string    `json:"status"` // pending, downloading, converting, completed, failed
	ProgressPercent uint32    `json:"progress_percent"`
	BytesDownloaded uint64    `json:"bytes_downloaded"`
	BytesTotal      uint64    `json:"bytes_total"`
	ErrorMessage    string    `json:"error_message,omitempty"`
	StartedAt       time.Time `json:"started_at"`
	CompletedAt     time.Time `json:"completed_at,omitempty"`
	// RemoteJobID is the job ID on the node daemon (for node-based downloads)
	RemoteJobID string `json:"remote_job_id,omitempty"`
}

// DownloadManager manages image download jobs.
type DownloadManager struct {
	mu         sync.RWMutex
	jobs       map[string]*DownloadJob
	imageRepo  ImageRepository
	poolRepo   PoolRepository
	nodeRepo   node.Repository
	daemonPool *node.DaemonPool
	catalog    []CatalogEntry
	logger     *zap.Logger
	httpClient *http.Client
}

// NewDownloadManager creates a new download manager.
func NewDownloadManager(imageRepo ImageRepository, catalog []CatalogEntry, logger *zap.Logger) *DownloadManager {
	return &DownloadManager{
		jobs:      make(map[string]*DownloadJob),
		imageRepo: imageRepo,
		catalog:   catalog,
		logger:    logger.Named("download-manager"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SetDaemonPool sets the daemon pool for node communication.
func (dm *DownloadManager) SetDaemonPool(pool *node.DaemonPool) {
	dm.daemonPool = pool
}

// SetPoolRepository sets the pool repository for looking up storage pools.
func (dm *DownloadManager) SetPoolRepository(repo PoolRepository) {
	dm.poolRepo = repo
}

// SetNodeRepository sets the node repository for looking up node information.
func (dm *DownloadManager) SetNodeRepository(repo node.Repository) {
	dm.nodeRepo = repo
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

	// If this is a remote job, poll the node for status
	if job.RemoteJobID != "" && job.NodeID != "" && (job.Status == "pending" || job.Status == "downloading") {
		if updatedJob := dm.pollNodeJobStatus(job); updatedJob != nil {
			job = updatedJob
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
// This method now routes downloads to nodes based on the provided nodeID and poolID.
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

	// If a node is specified and we have a daemon pool, route to node
	if nodeID != "" && dm.daemonPool != nil {
		return dm.startDownloadOnNode(ctx, jobID, imageID, catalogID, nodeID, "", targetDir, entry)
	}

	// Fallback to local download (for dev mode or when no node is specified)
	return dm.startLocalDownload(ctx, jobID, imageID, catalogID, nodeID, targetDir, entry)
}

// StartDownloadWithPool starts a download job for a catalog image to a specific storage pool.
// It finds a suitable node that has access to the pool and downloads the image there.
func (dm *DownloadManager) StartDownloadWithPool(ctx context.Context, jobID, imageID, catalogID, poolID string) error {
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

	// Look up the storage pool to get its mount path
	if dm.poolRepo == nil {
		return fmt.Errorf("pool repository not configured")
	}

	pool, err := dm.poolRepo.Get(ctx, poolID)
	if err != nil {
		return fmt.Errorf("storage pool not found: %s: %w", poolID, err)
	}

	// Determine target directory based on pool backend
	targetDir := ""
	if pool.Spec.Backend != nil {
		switch pool.Spec.Backend.Type {
		case domain.StorageBackendTypeNFS:
			if pool.Spec.Backend.NFSConfig != nil {
				// Use the NFS mount point
				if pool.Spec.Backend.NFSConfig.MountPoint != "" {
					targetDir = pool.Spec.Backend.NFSConfig.MountPoint
				} else {
					// Default NFS mount point pattern (matches pool_service.go and image_upload_handler.go)
					targetDir = fmt.Sprintf("/var/lib/limiquantix/mnt/nfs-%s", pool.ID)
				}
			}
		case domain.StorageBackendTypeLocalDir:
			if pool.Spec.Backend.LocalDirConfig != nil {
				targetDir = pool.Spec.Backend.LocalDirConfig.Path
			}
		default:
			// For other backends, use a default images directory
			targetDir = fmt.Sprintf("/var/lib/limiquantix/pools/%s/images", pool.ID)
		}
	}

	if targetDir == "" {
		targetDir = "/var/lib/limiquantix/cloud-images"
	}

	// Add cloud-images subdirectory
	targetDir = filepath.Join(targetDir, "cloud-images")

	// Find a node that has access to this pool
	nodeID := ""
	if len(pool.Spec.AssignedNodeIDs) > 0 {
		// Check if any assigned node is connected
		for _, assignedNodeID := range pool.Spec.AssignedNodeIDs {
			if dm.daemonPool != nil && dm.daemonPool.Get(assignedNodeID) != nil {
				nodeID = assignedNodeID
				break
			}
		}

		// If no assigned node is connected, try to connect to the first assigned node
		if nodeID == "" && len(pool.Spec.AssignedNodeIDs) > 0 && dm.nodeRepo != nil {
			firstNodeID := pool.Spec.AssignedNodeIDs[0]
			dm.logger.Info("No connected assigned nodes, attempting to connect to first assigned node",
				zap.String("node_id", firstNodeID),
				zap.String("pool_id", poolID),
			)
			
			// Get node info to get management IP
			nodeInfo, err := dm.nodeRepo.Get(ctx, firstNodeID)
			if err == nil {
				// Build daemon address
				daemonAddr := nodeInfo.ManagementIP
				// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
				if idx := strings.Index(daemonAddr, "/"); idx != -1 {
					daemonAddr = daemonAddr[:idx]
				}
				// Ensure port is included
				if !strings.Contains(daemonAddr, ":") {
					daemonAddr = daemonAddr + ":9090"
				}
				
				// Try to connect
				_, connectErr := dm.daemonPool.Connect(firstNodeID, daemonAddr)
				if connectErr == nil {
					nodeID = firstNodeID
					dm.logger.Info("Successfully connected to assigned node",
						zap.String("node_id", firstNodeID),
						zap.String("daemon_addr", daemonAddr),
					)
				} else {
					dm.logger.Warn("Failed to connect to assigned node",
						zap.String("node_id", firstNodeID),
						zap.String("daemon_addr", daemonAddr),
						zap.Error(connectErr),
					)
				}
			} else {
				dm.logger.Warn("Failed to get node info for assigned node",
					zap.String("node_id", firstNodeID),
					zap.Error(err),
				)
			}
		}
	}

	// If no assigned nodes, try any connected node
	if nodeID == "" && dm.daemonPool != nil {
		connectedNodes := dm.daemonPool.ConnectedNodes()
		if len(connectedNodes) > 0 {
			nodeID = connectedNodes[0]
		}
	}

	if nodeID == "" {
		return fmt.Errorf("no connected nodes available to download image. Please ensure at least one Quantix-OS node is running and connected to the control plane")
	}

	dm.logger.Info("Starting download on node",
		zap.String("job_id", jobID),
		zap.String("catalog_id", catalogID),
		zap.String("pool_id", poolID),
		zap.String("node_id", nodeID),
		zap.String("target_dir", targetDir),
	)

	return dm.startDownloadOnNode(ctx, jobID, imageID, catalogID, nodeID, poolID, targetDir, entry)
}

// startDownloadOnNode initiates a download on a remote node.
func (dm *DownloadManager) startDownloadOnNode(ctx context.Context, jobID, imageID, catalogID, nodeID, poolID, targetDir string, entry *CatalogEntry) error {
	if dm.daemonPool == nil {
		return fmt.Errorf("daemon pool not configured")
	}

	// Get node HTTP address
	nodeAddr, err := dm.daemonPool.GetNodeAddr(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get node address: %w", err)
	}

	// Build download request
	downloadReq := map[string]interface{}{
		"catalogId": catalogID,
		"imageId":   imageID,
		"url":       entry.URL,
		"targetDir": targetDir,
		"poolId":    poolID,
		"checksum":  entry.Checksum,
	}

	reqBody, err := json.Marshal(downloadReq)
	if err != nil {
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	// Call node's download endpoint
	url := fmt.Sprintf("http://%s/api/v1/images/download", nodeAddr)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := dm.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("failed to call node daemon: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("node daemon error (%d): %s", resp.StatusCode, string(body))
	}

	// Parse response to get remote job ID
	var downloadResp struct {
		JobID      string `json:"jobId"`
		ImageID    string `json:"imageId"`
		TargetPath string `json:"targetPath"`
		Message    string `json:"message"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&downloadResp); err != nil {
		return fmt.Errorf("failed to parse node response: %w", err)
	}

	// Create local job to track the remote download
	job := &DownloadJob{
		ID:              jobID,
		ImageID:         imageID,
		CatalogID:       catalogID,
		URL:             entry.URL,
		TargetPath:      downloadResp.TargetPath,
		NodeID:          nodeID,
		PoolID:          poolID,
		Status:          "downloading",
		ProgressPercent: 0,
		StartedAt:       time.Now(),
		RemoteJobID:     downloadResp.JobID,
	}

	dm.mu.Lock()
	dm.jobs[jobID] = job
	dm.mu.Unlock()

	// Start background polling for status updates
	go dm.pollDownloadProgress(context.Background(), jobID, nodeID, downloadResp.JobID)

	dm.logger.Info("Started remote download job",
		zap.String("job_id", jobID),
		zap.String("remote_job_id", downloadResp.JobID),
		zap.String("node_id", nodeID),
		zap.String("target_path", downloadResp.TargetPath),
	)

	return nil
}

// pollDownloadProgress polls a node for download status updates.
func (dm *DownloadManager) pollDownloadProgress(ctx context.Context, localJobID, nodeID, remoteJobID string) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			job := dm.GetJob(localJobID)
			if job == nil || job.Status == "completed" || job.Status == "failed" {
				return
			}

			if updatedJob := dm.pollNodeJobStatus(job); updatedJob != nil {
				if updatedJob.Status == "completed" || updatedJob.Status == "failed" {
					return
				}
			}
		}
	}
}

// pollNodeJobStatus fetches the current status from the node daemon.
func (dm *DownloadManager) pollNodeJobStatus(job *DownloadJob) *DownloadJob {
	if dm.daemonPool == nil || job.NodeID == "" || job.RemoteJobID == "" {
		return nil
	}

	nodeAddr, err := dm.daemonPool.GetNodeAddr(job.NodeID)
	if err != nil {
		dm.logger.Warn("Failed to get node address for status poll",
			zap.String("node_id", job.NodeID),
			zap.Error(err),
		)
		return nil
	}

	url := fmt.Sprintf("http://%s/api/v1/images/download/%s", nodeAddr, job.RemoteJobID)
	req, err := http.NewRequestWithContext(context.Background(), "GET", url, nil)
	if err != nil {
		return nil
	}

	resp, err := dm.httpClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var remoteStatus struct {
		JobID           string `json:"jobId"`
		ImageID         string `json:"imageId"`
		CatalogID       string `json:"catalogId"`
		URL             string `json:"url"`
		TargetPath      string `json:"targetPath"`
		PoolID          string `json:"poolId"`
		Status          string `json:"status"`
		ProgressPercent uint32 `json:"progressPercent"`
		BytesDownloaded uint64 `json:"bytesDownloaded"`
		BytesTotal      uint64 `json:"bytesTotal"`
		ErrorMessage    string `json:"errorMessage,omitempty"`
		CompletedAt     string `json:"completedAt,omitempty"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&remoteStatus); err != nil {
		return nil
	}

	// Update local job status
	dm.mu.Lock()
	defer dm.mu.Unlock()

	if localJob, ok := dm.jobs[job.ID]; ok {
		localJob.Status = remoteStatus.Status
		localJob.ProgressPercent = remoteStatus.ProgressPercent
		localJob.BytesDownloaded = remoteStatus.BytesDownloaded
		localJob.BytesTotal = remoteStatus.BytesTotal
		localJob.TargetPath = remoteStatus.TargetPath

		if remoteStatus.ErrorMessage != "" {
			localJob.ErrorMessage = remoteStatus.ErrorMessage
		}

		if remoteStatus.Status == "completed" || remoteStatus.Status == "failed" {
			localJob.CompletedAt = time.Now()

			// Update image record
			if remoteStatus.Status == "completed" {
				go dm.updateImageOnCompletion(localJob)
			} else {
				go dm.updateImageOnFailure(localJob)
			}
		}

		jobCopy := *localJob
		return &jobCopy
	}

	return nil
}

// updateImageOnCompletion updates the image record when download completes.
func (dm *DownloadManager) updateImageOnCompletion(job *DownloadJob) {
	ctx := context.Background()
	image, err := dm.imageRepo.Get(ctx, job.ImageID)
	if err != nil {
		dm.logger.Warn("Failed to get image for completion update",
			zap.String("image_id", job.ImageID),
			zap.Error(err),
		)
		return
	}

	image.Status.Phase = domain.ImagePhaseReady
	image.Status.SizeBytes = job.BytesDownloaded
	image.Status.Path = job.TargetPath
	image.Status.ProgressPercent = 100
	image.Status.NodeID = job.NodeID
	image.Status.StoragePoolID = job.PoolID

	if _, err := dm.imageRepo.Update(ctx, image); err != nil {
		dm.logger.Error("Failed to update image status",
			zap.String("image_id", job.ImageID),
			zap.Error(err),
		)
	}

	dm.logger.Info("Download completed and image updated",
		zap.String("job_id", job.ID),
		zap.String("image_id", job.ImageID),
		zap.String("target_path", job.TargetPath),
	)
}

// updateImageOnFailure updates the image record when download fails.
func (dm *DownloadManager) updateImageOnFailure(job *DownloadJob) {
	ctx := context.Background()
	image, err := dm.imageRepo.Get(ctx, job.ImageID)
	if err != nil {
		return
	}

	image.Status.Phase = domain.ImagePhaseError
	image.Status.ErrorMessage = job.ErrorMessage

	dm.imageRepo.Update(ctx, image)
}

// startLocalDownload falls back to downloading locally on the control plane.
// This is only used when no node is available (dev mode).
func (dm *DownloadManager) startLocalDownload(ctx context.Context, jobID, imageID, catalogID, nodeID, targetDir string, entry *CatalogEntry) error {
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
	go dm.runLocalDownload(context.Background(), job)

	dm.logger.Info("Started local download job",
		zap.String("job_id", jobID),
		zap.String("catalog_id", catalogID),
		zap.String("url", entry.URL),
		zap.String("target", targetPath),
	)

	return nil
}

// runLocalDownload performs the actual download locally.
func (dm *DownloadManager) runLocalDownload(ctx context.Context, job *DownloadJob) {
	logger := dm.logger.With(
		zap.String("job_id", job.ID),
		zap.String("url", job.URL),
	)

	dm.updateJobStatus(job.ID, "downloading", 0, 0, 0, "")
	logger.Info("Starting local download")

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

	logger.Info("Local download completed",
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
