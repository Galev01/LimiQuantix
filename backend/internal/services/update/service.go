// Package update provides OTA update management for Quantix-vDC and connected hosts.
// Document ID: 000082
package update

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
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

	"go.uber.org/zap"
)

// UpdateType represents the type of update
type UpdateType string

const (
	UpdateTypeComponent UpdateType = "component"
	UpdateTypeFull      UpdateType = "full"
)

// UpdateChannel represents an update channel
type UpdateChannel string

const (
	ChannelDev    UpdateChannel = "dev"
	ChannelBeta   UpdateChannel = "beta"
	ChannelStable UpdateChannel = "stable"
)

// Component represents an individual updatable component
type Component struct {
	Name           string `json:"name"`
	Version        string `json:"version"`
	Artifact       string `json:"artifact"`
	SHA256         string `json:"sha256"`
	SizeBytes      int64  `json:"size_bytes"`
	InstallPath    string `json:"install_path"`
	RestartService string `json:"restart_service,omitempty"`
}

// FullImage represents a full system image for A/B updates
type FullImage struct {
	Artifact       string `json:"artifact"`
	SHA256         string `json:"sha256"`
	SizeBytes      int64  `json:"size_bytes"`
	RequiresReboot bool   `json:"requires_reboot"`
}

// Manifest represents an update manifest
type Manifest struct {
	Product      string      `json:"product"`
	Version      string      `json:"version"`
	Channel      string      `json:"channel"`
	ReleaseDate  time.Time   `json:"release_date"`
	UpdateType   UpdateType  `json:"update_type"`
	Components   []Component `json:"components"`
	FullImage    *FullImage  `json:"full_image,omitempty"`
	MinVersion   string      `json:"min_version"`
	ReleaseNotes string      `json:"release_notes"`
}

// UpdateStatus represents the current update status
type UpdateStatus string

const (
	StatusIdle        UpdateStatus = "idle"
	StatusChecking    UpdateStatus = "checking"
	StatusAvailable   UpdateStatus = "available"
	StatusDownloading UpdateStatus = "downloading"
	StatusApplying    UpdateStatus = "applying"
	StatusRebootReq   UpdateStatus = "reboot_required"
	StatusError       UpdateStatus = "error"
)

// UpdateState holds the current state of an update operation
type UpdateState struct {
	Status           UpdateStatus `json:"status"`
	CurrentVersion   string       `json:"current_version"`
	AvailableVersion string       `json:"available_version,omitempty"`
	DownloadProgress float64      `json:"download_progress,omitempty"` // 0-100
	CurrentComponent string       `json:"current_component,omitempty"` // Current component being processed
	Message          string       `json:"message,omitempty"`           // Human-readable status message
	Error            string       `json:"error,omitempty"`
	LastCheck        *time.Time   `json:"last_check,omitempty"`
	Manifest         *Manifest    `json:"manifest,omitempty"`
}

// HostUpdateInfo contains update information for a connected host
type HostUpdateInfo struct {
	NodeID           string       `json:"node_id"`
	Hostname         string       `json:"hostname"`
	ManagementIP     string       `json:"management_ip"`
	CurrentVersion   string       `json:"current_version"`
	AvailableVersion string       `json:"available_version,omitempty"`
	Status           UpdateStatus `json:"status"`
	LastCheck        *time.Time   `json:"last_check,omitempty"`
	Error            string       `json:"error,omitempty"`
}

// Config holds update service configuration
type Config struct {
	ServerURL     string        `json:"server_url"`
	Channel       UpdateChannel `json:"channel"`
	CheckInterval time.Duration `json:"check_interval"`
	AutoCheck     bool          `json:"auto_check"`
	AutoApply     bool          `json:"auto_apply"`
	DataDir       string        `json:"data_dir"`
}

// DefaultConfig returns the default update configuration
func DefaultConfig() Config {
	return Config{
		ServerURL:     "http://localhost:9000",
		Channel:       ChannelDev,
		CheckInterval: 1 * time.Hour,
		AutoCheck:     true,
		AutoApply:     false,
		DataDir:       "/var/lib/quantix-vdc/updates",
	}
}

// Service provides OTA update management
type Service struct {
	config Config
	logger *zap.Logger

	// Current vDC state
	vdcState   UpdateState
	vdcStateMu sync.RWMutex
	vdcVersion string

	// Host update states
	hostStates   map[string]*HostUpdateInfo
	hostStatesMu sync.RWMutex

	// HTTP client for update server API calls (short timeout)
	httpClient *http.Client

	// HTTP client for file downloads (longer timeout)
	downloadClient *http.Client

	// HTTP client for host communication (skips TLS verification for self-signed certs)
	hostClient *http.Client

	// Node service interface for communicating with hosts
	nodeGetter NodeGetter
}

// NodeGetter interface for getting node information
type NodeGetter interface {
	GetNodeByID(ctx context.Context, id string) (*NodeInfo, error)
	ListNodes(ctx context.Context) ([]*NodeInfo, error)
}

// NodeInfo contains basic node information
type NodeInfo struct {
	ID           string
	Hostname     string
	ManagementIP string
	Phase        string // Node phase: READY, NOT_READY, DISCONNECTED, OFFLINE, etc.
}

// NewService creates a new update service
func NewService(config Config, logger *zap.Logger) *Service {
	if config.DataDir == "" {
		config.DataDir = "/var/lib/quantix-vdc/updates"
	}

	// Create data directories
	os.MkdirAll(filepath.Join(config.DataDir, "staging"), 0755)
	os.MkdirAll(filepath.Join(config.DataDir, "backup"), 0755)

	// Create TLS-skipping transport for host communication (hosts use self-signed certs)
	hostTransport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, // Skip verification for self-signed certs
		},
	}

	return &Service{
		config: config,
		logger: logger.Named("update-service"),
		vdcState: UpdateState{
			Status:         StatusIdle,
			CurrentVersion: getVDCVersion(),
		},
		vdcVersion: getVDCVersion(),
		hostStates: make(map[string]*HostUpdateInfo),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		downloadClient: &http.Client{
			Timeout: 10 * time.Minute, // Longer timeout for file downloads
		},
		hostClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: hostTransport,
		},
	}
}

// SetNodeGetter sets the node getter for host communication
func (s *Service) SetNodeGetter(ng NodeGetter) {
	s.nodeGetter = ng
}

// GetConfig returns the current update configuration
func (s *Service) GetConfig() Config {
	return s.config
}

// UpdateConfig updates the configuration
func (s *Service) UpdateConfig(config Config) {
	s.config = config
	s.logger.Info("Update configuration changed",
		zap.String("server_url", config.ServerURL),
		zap.String("channel", string(config.Channel)),
	)
}

// ========================================================================
// vDC Self-Update Methods
// ========================================================================

// GetVDCState returns the current vDC update state
func (s *Service) GetVDCState() UpdateState {
	s.vdcStateMu.RLock()
	defer s.vdcStateMu.RUnlock()
	return s.vdcState
}

// CheckVDCUpdate checks for available vDC updates
func (s *Service) CheckVDCUpdate(ctx context.Context) (*Manifest, error) {
	s.setVDCStatus(StatusChecking, "")

	manifest, err := s.fetchManifest(ctx, "quantix-vdc")
	if err != nil {
		s.setVDCStatus(StatusError, fmt.Sprintf("Failed to check updates: %v", err))
		return nil, fmt.Errorf("failed to fetch manifest: %w", err)
	}

	now := time.Now()
	s.vdcStateMu.Lock()
	s.vdcState.LastCheck = &now
	s.vdcState.Manifest = manifest

	if compareVersions(manifest.Version, s.vdcVersion) > 0 {
		s.vdcState.Status = StatusAvailable
		s.vdcState.AvailableVersion = manifest.Version
		s.logger.Info("vDC update available",
			zap.String("current", s.vdcVersion),
			zap.String("available", manifest.Version),
		)
	} else {
		s.vdcState.Status = StatusIdle
		s.vdcState.AvailableVersion = ""
		s.logger.Info("vDC is up to date", zap.String("version", s.vdcVersion))
	}
	s.vdcStateMu.Unlock()

	return manifest, nil
}

// ApplyVDCUpdate downloads and applies the vDC update
func (s *Service) ApplyVDCUpdate(ctx context.Context) error {
	s.vdcStateMu.RLock()
	manifest := s.vdcState.Manifest
	s.vdcStateMu.RUnlock()

	if manifest == nil {
		return fmt.Errorf("no update manifest available, run CheckVDCUpdate first")
	}

	if compareVersions(manifest.Version, s.vdcVersion) <= 0 {
		return fmt.Errorf("no newer version available")
	}

	totalComponents := len(manifest.Components)
	s.setVDCStatus(StatusDownloading, "")
	s.setVDCProgress(0, "", fmt.Sprintf("Starting update to v%s...", manifest.Version))

	// Download and apply each component
	for i, component := range manifest.Components {
		componentNum := i + 1
		// Each component gets an equal share of the progress bar
		// Within each component: 0-70% download, 70-90% extract, 90-100% install
		baseProgress := float64(i) / float64(totalComponents) * 100
		componentWeight := 100.0 / float64(totalComponents)

		// Update progress for download phase
		downloadProgress := baseProgress
		s.setVDCProgress(downloadProgress, component.Name,
			fmt.Sprintf("Downloading %s (%d/%d)...", component.Name, componentNum, totalComponents))

		if err := s.downloadAndApplyComponent(ctx, manifest, component, func(phase string, phaseProgress float64) {
			// phaseProgress is 0-100 within the phase
			var actualProgress float64
			var message string

			switch phase {
			case "downloading":
				// 0-70% of component weight
				actualProgress = baseProgress + (phaseProgress/100.0)*(componentWeight*0.7)
				message = fmt.Sprintf("Downloading %s (%d/%d)... %.0f%%", component.Name, componentNum, totalComponents, phaseProgress)
			case "extracting":
				// 70-90% of component weight
				actualProgress = baseProgress + componentWeight*0.7 + (phaseProgress/100.0)*(componentWeight*0.2)
				message = fmt.Sprintf("Extracting %s (%d/%d)...", component.Name, componentNum, totalComponents)
			case "installing":
				// 90-100% of component weight
				actualProgress = baseProgress + componentWeight*0.9 + (phaseProgress/100.0)*(componentWeight*0.1)
				message = fmt.Sprintf("Installing %s (%d/%d)...", component.Name, componentNum, totalComponents)
			}

			s.setVDCProgress(actualProgress, component.Name, message)
		}); err != nil {
			s.setVDCProgress(baseProgress, component.Name, "")
			s.setVDCStatus(StatusError, fmt.Sprintf("Failed to apply %s: %v", component.Name, err))
			return fmt.Errorf("failed to apply component %s: %w", component.Name, err)
		}
	}

	// Update complete - update both the state and internal version tracker
	s.setVDCProgress(100, "", fmt.Sprintf("Update to v%s completed successfully", manifest.Version))
	s.vdcStateMu.Lock()
	s.vdcState.Status = StatusIdle
	s.vdcState.CurrentVersion = manifest.Version
	s.vdcState.AvailableVersion = ""
	s.vdcVersion = manifest.Version // Update internal version so subsequent checks work correctly
	s.vdcStateMu.Unlock()

	s.logger.Info("vDC update applied successfully", zap.String("version", manifest.Version))
	return nil
}

// ========================================================================
// Host Update Methods
// ========================================================================

// GetHostStates returns update states for all connected hosts
// It only returns hosts that are READY (connected), filtering out disconnected/offline hosts
func (s *Service) GetHostStates() map[string]*HostUpdateInfo {
	result := make(map[string]*HostUpdateInfo)

	// If we have a node getter, get the current list of connected nodes
	if s.nodeGetter == nil {
		s.logger.Warn("No node getter configured, returning empty host list")
		return result
	}

	nodes, err := s.nodeGetter.ListNodes(context.Background())
	if err != nil {
		s.logger.Warn("Failed to list nodes, returning empty host list", zap.Error(err))
		return result
	}

	// Build a map of connected nodes (only READY phase)
	connectedNodes := make(map[string]*NodeInfo)
	for _, node := range nodes {
		// Only include hosts that are READY (connected)
		if node.Phase == "READY" || node.Phase == "NODE_PHASE_READY" {
			connectedNodes[node.ID] = node
		}
	}

	s.logger.Debug("Filtering hosts by connection status",
		zap.Int("total_nodes", len(nodes)),
		zap.Int("connected_nodes", len(connectedNodes)),
	)

	// Clean up cache - remove entries for nodes that no longer exist OR are disconnected
	s.hostStatesMu.Lock()
	for nodeID := range s.hostStates {
		if _, exists := connectedNodes[nodeID]; !exists {
			delete(s.hostStates, nodeID)
			s.logger.Debug("Removed disconnected/deleted host from update cache", zap.String("node_id", nodeID))
		}
	}
	s.hostStatesMu.Unlock()

	// Return only connected hosts
	s.hostStatesMu.RLock()
	defer s.hostStatesMu.RUnlock()

	for k, v := range s.hostStates {
		if _, isConnected := connectedNodes[k]; isConnected {
			copied := *v
			result[k] = &copied
		}
	}

	s.logger.Debug("Returning connected host states", zap.Int("count", len(result)))
	return result
}

// ClearHostCache removes all cached host update states
// This is useful when refreshing the host list
func (s *Service) ClearHostCache() {
	s.hostStatesMu.Lock()
	defer s.hostStatesMu.Unlock()
	s.hostStates = make(map[string]*HostUpdateInfo)
	s.logger.Debug("Cleared host update cache")
}

// CheckHostUpdate checks for updates on a specific host
func (s *Service) CheckHostUpdate(ctx context.Context, nodeID string) (*HostUpdateInfo, error) {
	if s.nodeGetter == nil {
		return nil, fmt.Errorf("node getter not configured")
	}

	node, err := s.nodeGetter.GetNodeByID(ctx, nodeID)
	if err != nil {
		return nil, fmt.Errorf("failed to get node: %w", err)
	}

	info := s.getOrCreateHostInfo(nodeID, node)
	info.Status = StatusChecking

	// Call the host's update check API
	// Note: QHCI (qx-node) runs on port 8443 with self-signed TLS
	// Strip CIDR notation (e.g., /32) from management IP if present
	hostIP := strings.Split(node.ManagementIP, "/")[0]
	hostURL := fmt.Sprintf("https://%s:8443/api/v1/updates/check", hostIP)
	s.logger.Debug("Checking host for updates",
		zap.String("node_id", nodeID),
		zap.String("url", hostURL),
	)

	req, err := http.NewRequestWithContext(ctx, "GET", hostURL, nil)
	if err != nil {
		info.Status = StatusError
		info.Error = err.Error()
		return info, err
	}

	resp, err := s.hostClient.Do(req)
	if err != nil {
		info.Status = StatusError
		info.Error = fmt.Sprintf("Failed to contact host: %v", err)
		s.logger.Warn("Failed to contact host for update check",
			zap.String("node_id", nodeID),
			zap.String("url", hostURL),
			zap.Error(err),
		)
		return info, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		info.Status = StatusError
		info.Error = fmt.Sprintf("Host returned status %d: %s", resp.StatusCode, string(body))
		s.logger.Warn("Host returned error status",
			zap.String("node_id", nodeID),
			zap.Int("status_code", resp.StatusCode),
			zap.String("body", string(body)),
		)
		return info, fmt.Errorf("host returned status %d", resp.StatusCode)
	}

	// QHCI's /api/v1/updates/check returns UpdateInfo struct:
	// {
	//   "available": bool,
	//   "current_version": string,
	//   "latest_version": string (optional),
	//   "channel": string,
	//   "components": [...],
	//   "full_image_available": bool,
	//   "total_download_size": int,
	//   "release_notes": string (optional)
	// }
	var hostCheckResponse struct {
		Available          bool   `json:"available"`
		CurrentVersion     string `json:"current_version"`
		LatestVersion      string `json:"latest_version"`
		Channel            string `json:"channel"`
		FullImageAvailable bool   `json:"full_image_available"`
		TotalDownloadSize  int64  `json:"total_download_size"`
		ReleaseNotes       string `json:"release_notes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&hostCheckResponse); err != nil {
		info.Status = StatusError
		info.Error = fmt.Sprintf("Failed to parse host response: %v", err)
		s.logger.Warn("Failed to parse host update check response",
			zap.String("node_id", nodeID),
			zap.Error(err),
		)
		return info, err
	}

	now := time.Now()
	info.CurrentVersion = hostCheckResponse.CurrentVersion
	info.LastCheck = &now

	// Log the full response for debugging
	s.logger.Info("Parsed host update response",
		zap.String("node_id", nodeID),
		zap.Bool("available", hostCheckResponse.Available),
		zap.String("current_version", hostCheckResponse.CurrentVersion),
		zap.String("latest_version", hostCheckResponse.LatestVersion),
		zap.String("channel", hostCheckResponse.Channel),
	)

	if hostCheckResponse.Available && hostCheckResponse.LatestVersion != "" {
		info.AvailableVersion = hostCheckResponse.LatestVersion
		info.Status = StatusAvailable
		s.logger.Info("Host update available",
			zap.String("node_id", nodeID),
			zap.String("current", hostCheckResponse.CurrentVersion),
			zap.String("available", hostCheckResponse.LatestVersion),
		)
	} else {
		info.AvailableVersion = ""
		info.Status = StatusIdle
		s.logger.Info("Host is up to date",
			zap.String("node_id", nodeID),
			zap.String("version", hostCheckResponse.CurrentVersion),
		)
	}
	info.Error = ""

	return info, nil
}

// CheckAllHostUpdates checks for updates on all connected hosts
// Only checks hosts that are READY (connected), skips disconnected/offline hosts
func (s *Service) CheckAllHostUpdates(ctx context.Context) ([]*HostUpdateInfo, error) {
	if s.nodeGetter == nil {
		return nil, fmt.Errorf("node getter not configured")
	}

	nodes, err := s.nodeGetter.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}

	// Filter to only connected (READY) nodes
	var connectedNodes []*NodeInfo
	for _, node := range nodes {
		if node.Phase == "READY" || node.Phase == "NODE_PHASE_READY" {
			connectedNodes = append(connectedNodes, node)
		}
	}

	s.logger.Info("Checking updates for connected hosts",
		zap.Int("total_nodes", len(nodes)),
		zap.Int("connected_nodes", len(connectedNodes)),
	)

	// Build a set of connected node IDs
	connectedNodeIDs := make(map[string]bool)
	for _, node := range connectedNodes {
		connectedNodeIDs[node.ID] = true
	}

	// Clean up cache - remove entries for disconnected/deleted hosts
	s.hostStatesMu.Lock()
	for nodeID := range s.hostStates {
		if !connectedNodeIDs[nodeID] {
			delete(s.hostStates, nodeID)
			s.logger.Debug("Removed disconnected/deleted host from update cache", zap.String("node_id", nodeID))
		}
	}
	s.hostStatesMu.Unlock()

	// Check each connected node
	var results []*HostUpdateInfo
	for _, node := range connectedNodes {
		info, err := s.CheckHostUpdate(ctx, node.ID)
		if err != nil {
			s.logger.Warn("Failed to check host update",
				zap.String("node_id", node.ID),
				zap.Error(err),
			)
		}
		if info != nil {
			results = append(results, info)
		}
	}

	return results, nil
}

// ApplyHostUpdate triggers an update on a specific host
func (s *Service) ApplyHostUpdate(ctx context.Context, nodeID string) error {
	if s.nodeGetter == nil {
		return fmt.Errorf("node getter not configured")
	}

	node, err := s.nodeGetter.GetNodeByID(ctx, nodeID)
	if err != nil {
		return fmt.Errorf("failed to get node: %w", err)
	}

	info := s.getOrCreateHostInfo(nodeID, node)
	info.Status = StatusApplying

	// Call the host's update apply API
	// Strip CIDR notation (e.g., /32) from management IP if present
	hostIP := strings.Split(node.ManagementIP, "/")[0]
	hostURL := fmt.Sprintf("https://%s:8443/api/v1/updates/apply", hostIP)
	req, err := http.NewRequestWithContext(ctx, "POST", hostURL, nil)
	if err != nil {
		info.Status = StatusError
		info.Error = err.Error()
		return err
	}

	// Use a longer timeout for apply requests since they may take a while
	applyClient := &http.Client{
		Timeout: 5 * time.Minute,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, // Skip verification for self-signed certs
			},
		},
	}

	resp, err := applyClient.Do(req)
	if err != nil {
		info.Status = StatusError
		info.Error = fmt.Sprintf("Failed to apply update: %v", err)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		info.Status = StatusError
		info.Error = fmt.Sprintf("Host returned status %d: %s", resp.StatusCode, string(body))
		return fmt.Errorf("host returned status %d", resp.StatusCode)
	}

	info.Status = StatusIdle
	info.Error = ""
	s.logger.Info("Host update triggered", zap.String("node_id", nodeID))

	return nil
}

// ApplyAllHostUpdates triggers updates on all hosts with available updates
func (s *Service) ApplyAllHostUpdates(ctx context.Context) error {
	s.hostStatesMu.RLock()
	var hostsToUpdate []string
	for nodeID, info := range s.hostStates {
		if info.Status == StatusAvailable {
			hostsToUpdate = append(hostsToUpdate, nodeID)
		}
	}
	s.hostStatesMu.RUnlock()

	var lastErr error
	for _, nodeID := range hostsToUpdate {
		if err := s.ApplyHostUpdate(ctx, nodeID); err != nil {
			s.logger.Error("Failed to apply host update",
				zap.String("node_id", nodeID),
				zap.Error(err),
			)
			lastErr = err
		}
	}

	return lastErr
}

// ========================================================================
// Internal Methods
// ========================================================================

func (s *Service) setVDCStatus(status UpdateStatus, errMsg string) {
	s.vdcStateMu.Lock()
	defer s.vdcStateMu.Unlock()
	s.vdcState.Status = status
	s.vdcState.Error = errMsg
}

// setVDCProgress updates the progress state with component info and message
func (s *Service) setVDCProgress(progress float64, component, message string) {
	s.vdcStateMu.Lock()
	defer s.vdcStateMu.Unlock()
	s.vdcState.DownloadProgress = progress
	s.vdcState.CurrentComponent = component
	s.vdcState.Message = message
}

func (s *Service) fetchManifest(ctx context.Context, product string) (*Manifest, error) {
	url := fmt.Sprintf("%s/api/v1/%s/manifest?channel=%s",
		s.config.ServerURL, product, s.config.Channel)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("no releases found for %s on channel %s", product, s.config.Channel)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}

	var manifest Manifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return nil, fmt.Errorf("failed to decode manifest: %w", err)
	}

	return &manifest, nil
}

// ProgressCallback is called during update phases with phase name and progress (0-100)
type ProgressCallback func(phase string, progress float64)

func (s *Service) downloadAndApplyComponent(ctx context.Context, manifest *Manifest, component Component, onProgress ProgressCallback) error {
	s.logger.Info("Processing component update",
		zap.String("component", component.Name),
		zap.String("version", component.Version),
		zap.String("install_path", component.InstallPath),
	)

	// Download artifact
	artifactURL := fmt.Sprintf("%s/api/v1/quantix-vdc/releases/%s/%s?channel=%s",
		s.config.ServerURL, manifest.Version, component.Artifact, manifest.Channel)

	stagingPath := filepath.Join(s.config.DataDir, "staging", component.Artifact)

	// Download with progress tracking
	if err := s.downloadFileWithProgress(ctx, artifactURL, stagingPath, component.SizeBytes, func(progress float64) {
		if onProgress != nil {
			onProgress("downloading", progress)
		}
	}); err != nil {
		return fmt.Errorf("download failed: %w", err)
	}

	// Verify SHA256
	if component.SHA256 != "" {
		actualHash, err := calculateSHA256(stagingPath)
		if err != nil {
			return fmt.Errorf("hash calculation failed: %w", err)
		}
		if actualHash != component.SHA256 {
			os.Remove(stagingPath)
			return fmt.Errorf("hash mismatch: expected %s, got %s", component.SHA256, actualHash)
		}
		s.logger.Info("SHA256 verified", zap.String("component", component.Name))
	}

	// Extract phase
	if onProgress != nil {
		onProgress("extracting", 0)
	}
	s.setVDCStatus(StatusApplying, "")

	if component.InstallPath != "" {
		// Determine if install path is a directory (for dashboard) or a file (for binaries)
		// Dashboard has install_path ending without extension = directory
		// Binaries have install_path with no extension but are single files
		isDirectoryInstall := component.Name == "dashboard" || strings.HasSuffix(component.InstallPath, "/")

		if isDirectoryInstall {
			// Extract tar.gz to directory
			s.logger.Info("Extracting to directory",
				zap.String("component", component.Name),
				zap.String("dest", component.InstallPath),
			)

			// Remove old directory contents and recreate
			if err := os.RemoveAll(component.InstallPath); err != nil {
				s.logger.Warn("Failed to remove old directory", zap.Error(err))
			}
			if err := os.MkdirAll(component.InstallPath, 0755); err != nil {
				return fmt.Errorf("failed to create install directory: %w", err)
			}

			if onProgress != nil {
				onProgress("extracting", 50)
			}

			if err := extractTarGz(stagingPath, component.InstallPath); err != nil {
				return fmt.Errorf("failed to extract: %w", err)
			}
		} else {
			// Extract tar.gz and find the binary inside
			s.logger.Info("Extracting binary",
				zap.String("component", component.Name),
				zap.String("dest", component.InstallPath),
			)

			// Create temp directory for extraction
			tempDir := filepath.Join(s.config.DataDir, "staging", component.Name+"-extract")
			os.RemoveAll(tempDir)
			if err := os.MkdirAll(tempDir, 0755); err != nil {
				return fmt.Errorf("failed to create temp directory: %w", err)
			}
			defer os.RemoveAll(tempDir)

			if onProgress != nil {
				onProgress("extracting", 50)
			}

			if err := extractTarGz(stagingPath, tempDir); err != nil {
				return fmt.Errorf("failed to extract: %w", err)
			}

			// Find the binary - it should be the only executable or match the component name
			binaryPath, err := findBinaryInDir(tempDir, component.Name)
			if err != nil {
				return fmt.Errorf("failed to find binary: %w", err)
			}

			// Install phase
			if onProgress != nil {
				onProgress("installing", 0)
			}

			// Create parent directory for install path
			if err := os.MkdirAll(filepath.Dir(component.InstallPath), 0755); err != nil {
				return fmt.Errorf("failed to create install directory: %w", err)
			}

			// Backup existing file
			if _, err := os.Stat(component.InstallPath); err == nil {
				backupPath := filepath.Join(s.config.DataDir, "backup", filepath.Base(component.InstallPath))
				os.MkdirAll(filepath.Dir(backupPath), 0755)
				if err := copyFile(component.InstallPath, backupPath); err != nil {
					s.logger.Warn("Failed to backup existing file", zap.Error(err))
				}
			}

			if onProgress != nil {
				onProgress("installing", 50)
			}

			// Copy binary to install path
			if err := copyFile(binaryPath, component.InstallPath); err != nil {
				return fmt.Errorf("failed to install binary: %w", err)
			}

			// Set permissions
			os.Chmod(component.InstallPath, 0755)
		}
	}

	if onProgress != nil {
		onProgress("installing", 100)
	}

	// Restart service if specified
	// We use a background process with a delay to allow the HTTP response to be sent first
	if component.RestartService != "" {
		s.logger.Info("Scheduling service restart", zap.String("service", component.RestartService))

		// Fork a background process to restart the service after a short delay
		// This allows the current request to complete before the service restarts
		go func(serviceName string) {
			// Wait 2 seconds to allow HTTP response to be sent
			time.Sleep(2 * time.Second)

			s.logger.Info("Executing service restart", zap.String("service", serviceName))

			// Try OpenRC first (Alpine Linux), then systemd
			cmd := exec.Command("rc-service", serviceName, "restart")
			if err := cmd.Run(); err != nil {
				s.logger.Warn("OpenRC restart failed, trying systemd",
					zap.String("service", serviceName),
					zap.Error(err),
				)
				// Try systemd
				cmd = exec.Command("systemctl", "restart", serviceName)
				if err := cmd.Run(); err != nil {
					s.logger.Error("Failed to restart service",
						zap.String("service", serviceName),
						zap.Error(err),
					)
				}
			}
		}(component.RestartService)

		s.logger.Info("Service restart scheduled (will execute in 2 seconds)", zap.String("service", component.RestartService))
	}

	// Cleanup
	os.Remove(stagingPath)

	s.logger.Info("Component update applied successfully",
		zap.String("component", component.Name),
		zap.String("version", component.Version),
	)

	return nil
}

func (s *Service) downloadFile(ctx context.Context, url, destPath string) error {
	s.logger.Info("Starting file download",
		zap.String("url", url),
		zap.String("dest", destPath),
	)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	// Use downloadClient with longer timeout for file downloads
	resp, err := s.downloadClient.Do(req)
	if err != nil {
		s.logger.Error("Download request failed",
			zap.String("url", url),
			zap.Error(err),
		)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return err
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	written, err := io.Copy(out, resp.Body)
	if err != nil {
		s.logger.Error("Failed to write downloaded file",
			zap.String("dest", destPath),
			zap.Error(err),
		)
		return err
	}

	s.logger.Info("File download completed",
		zap.String("dest", destPath),
		zap.Int64("bytes", written),
	)

	return nil
}

// downloadFileWithProgress downloads a file with progress tracking
func (s *Service) downloadFileWithProgress(ctx context.Context, url, destPath string, expectedSize int64, onProgress func(float64)) error {
	s.logger.Info("Starting file download with progress",
		zap.String("url", url),
		zap.String("dest", destPath),
		zap.Int64("expected_size", expectedSize),
	)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return err
	}

	// Use downloadClient with longer timeout for file downloads
	resp, err := s.downloadClient.Do(req)
	if err != nil {
		s.logger.Error("Download request failed",
			zap.String("url", url),
			zap.Error(err),
		)
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned %d", resp.StatusCode)
	}

	// Get total size from Content-Length header if not provided
	totalSize := expectedSize
	if totalSize <= 0 && resp.ContentLength > 0 {
		totalSize = resp.ContentLength
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return err
	}

	out, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer out.Close()

	// Read with progress tracking
	var written int64
	buf := make([]byte, 32*1024) // 32KB buffer
	lastProgressUpdate := time.Now()

	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			nw, writeErr := out.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			written += int64(nw)

			// Update progress every 100ms to avoid too many updates
			if onProgress != nil && totalSize > 0 && time.Since(lastProgressUpdate) > 100*time.Millisecond {
				progress := float64(written) / float64(totalSize) * 100
				if progress > 100 {
					progress = 100
				}
				onProgress(progress)
				lastProgressUpdate = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}

	// Final progress update
	if onProgress != nil {
		onProgress(100)
	}

	s.logger.Info("File download completed",
		zap.String("dest", destPath),
		zap.Int64("bytes", written),
	)

	return nil
}

func (s *Service) getOrCreateHostInfo(nodeID string, node *NodeInfo) *HostUpdateInfo {
	s.hostStatesMu.Lock()
	defer s.hostStatesMu.Unlock()

	info, exists := s.hostStates[nodeID]
	if !exists {
		info = &HostUpdateInfo{
			NodeID:       nodeID,
			Hostname:     node.Hostname,
			ManagementIP: node.ManagementIP,
			Status:       StatusIdle,
		}
		s.hostStates[nodeID] = info
	} else {
		// Update node info in case it changed
		info.Hostname = node.Hostname
		info.ManagementIP = node.ManagementIP
	}
	return info
}

// ========================================================================
// Utility Functions
// ========================================================================

func getVDCVersion() string {
	// Try to read version from file
	versionFile := "/etc/quantix-vdc/version"
	if data, err := os.ReadFile(versionFile); err == nil {
		return strings.TrimSpace(string(data))
	}
	// Fallback to build version
	return "0.0.1"
}

func compareVersions(v1, v2 string) int {
	parts1 := strings.Split(v1, ".")
	parts2 := strings.Split(v2, ".")

	for i := 0; i < 3; i++ {
		var n1, n2 int
		if i < len(parts1) {
			fmt.Sscanf(parts1[i], "%d", &n1)
		}
		if i < len(parts2) {
			fmt.Sscanf(parts2[i], "%d", &n2)
		}

		if n1 > n2 {
			return 1
		} else if n1 < n2 {
			return -1
		}
	}

	return 0
}

func calculateSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	return err
}

// extractTarGz extracts a .tar.gz file to the specified destination directory
func extractTarGz(srcPath, destDir string) error {
	file, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("failed to open archive: %w", err)
	}
	defer file.Close()

	gzr, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		// Construct the full path
		target := filepath.Join(destDir, header.Name)

		// Check for path traversal attacks
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(destDir)) {
			return fmt.Errorf("invalid file path in archive: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)); err != nil {
				return fmt.Errorf("failed to create directory: %w", err)
			}
		case tar.TypeReg:
			// Ensure parent directory exists
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return fmt.Errorf("failed to create parent directory: %w", err)
			}

			outFile, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return fmt.Errorf("failed to create file: %w", err)
			}

			if _, err := io.Copy(outFile, tr); err != nil {
				outFile.Close()
				return fmt.Errorf("failed to write file: %w", err)
			}
			outFile.Close()
		case tar.TypeSymlink:
			if err := os.Symlink(header.Linkname, target); err != nil {
				// Ignore symlink errors on Windows
				if !strings.Contains(err.Error(), "not permitted") {
					return fmt.Errorf("failed to create symlink: %w", err)
				}
			}
		}
	}

	return nil
}

// findBinaryInDir searches for an executable binary in a directory
func findBinaryInDir(dir, componentName string) (string, error) {
	var candidates []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		// Check if it's executable (Unix) or matches expected names
		name := info.Name()

		// Prioritize exact match with component name
		if name == componentName || name == "quantix-controlplane" || name == "controlplane" {
			candidates = append([]string{path}, candidates...) // Prepend
		} else if info.Mode()&0111 != 0 {
			// It's executable
			candidates = append(candidates, path)
		}

		return nil
	})

	if err != nil {
		return "", err
	}

	if len(candidates) == 0 {
		return "", fmt.Errorf("no binary found in extracted archive")
	}

	return candidates[0], nil
}

// ========================================================================
// Node Getter Adapter
// ========================================================================

// DomainNode represents a node from the domain layer
type DomainNode struct {
	ID           string
	Hostname     string
	ManagementIP string
}

// NodeRepository is a minimal interface for getting nodes from the database
type NodeRepository interface {
	Get(ctx context.Context, id string) (*DomainNode, error)
	List(ctx context.Context) ([]*DomainNode, error)
}

// NodeGetterAdapter adapts a NodeRepository to implement NodeGetter
type NodeGetterAdapter struct {
	repo interface {
		Get(ctx context.Context, id string) (interface{}, error)
		List(ctx context.Context, filter interface{}) ([]interface{}, error)
	}
	// Direct getters for simple integration
	getByIDFn func(ctx context.Context, id string) (*NodeInfo, error)
	listFn    func(ctx context.Context) ([]*NodeInfo, error)
}

// NewNodeGetterFromFuncs creates a NodeGetter from function callbacks
// This allows flexible integration without requiring exact type matching
func NewNodeGetterFromFuncs(
	getByID func(ctx context.Context, id string) (*NodeInfo, error),
	list func(ctx context.Context) ([]*NodeInfo, error),
) NodeGetter {
	return &NodeGetterAdapter{
		getByIDFn: getByID,
		listFn:    list,
	}
}

// GetNodeByID implements NodeGetter
func (a *NodeGetterAdapter) GetNodeByID(ctx context.Context, id string) (*NodeInfo, error) {
	if a.getByIDFn != nil {
		return a.getByIDFn(ctx, id)
	}
	return nil, fmt.Errorf("node getter not configured")
}

// ListNodes implements NodeGetter
func (a *NodeGetterAdapter) ListNodes(ctx context.Context) ([]*NodeInfo, error) {
	if a.listFn != nil {
		return a.listFn(ctx)
	}
	return nil, fmt.Errorf("node getter not configured")
}
