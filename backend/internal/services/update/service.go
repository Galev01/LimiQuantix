// Package update provides OTA update management for Quantix-vDC and connected hosts.
// Document ID: 000082
package update

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
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

	s.setVDCStatus(StatusDownloading, "")

	// Download and apply each component
	for i, component := range manifest.Components {
		progress := float64(i) / float64(len(manifest.Components)) * 100
		s.vdcStateMu.Lock()
		s.vdcState.DownloadProgress = progress
		s.vdcStateMu.Unlock()

		if err := s.downloadAndApplyComponent(ctx, manifest, component); err != nil {
			s.setVDCStatus(StatusError, fmt.Sprintf("Failed to apply %s: %v", component.Name, err))
			return fmt.Errorf("failed to apply component %s: %w", component.Name, err)
		}
	}

	s.setVDCStatus(StatusIdle, "")
	s.vdcStateMu.Lock()
	s.vdcState.CurrentVersion = manifest.Version
	s.vdcState.AvailableVersion = ""
	s.vdcState.DownloadProgress = 100
	s.vdcStateMu.Unlock()

	s.logger.Info("vDC update applied successfully", zap.String("version", manifest.Version))
	return nil
}

// ========================================================================
// Host Update Methods
// ========================================================================

// GetHostStates returns update states for all connected hosts
func (s *Service) GetHostStates() map[string]*HostUpdateInfo {
	s.hostStatesMu.RLock()
	defer s.hostStatesMu.RUnlock()

	result := make(map[string]*HostUpdateInfo)
	for k, v := range s.hostStates {
		copied := *v
		result[k] = &copied
	}
	return result
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
	hostURL := fmt.Sprintf("https://%s:8443/api/v1/updates/check", node.ManagementIP)
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
		return info, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		info.Status = StatusError
		info.Error = fmt.Sprintf("Host returned status %d", resp.StatusCode)
		return info, fmt.Errorf("host returned status %d", resp.StatusCode)
	}

	var hostState struct {
		Status           string `json:"status"`
		CurrentVersion   string `json:"current_version"`
		AvailableVersion string `json:"available_version"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&hostState); err != nil {
		info.Status = StatusError
		info.Error = err.Error()
		return info, err
	}

	now := time.Now()
	info.CurrentVersion = hostState.CurrentVersion
	info.AvailableVersion = hostState.AvailableVersion
	info.LastCheck = &now

	if hostState.AvailableVersion != "" {
		info.Status = StatusAvailable
	} else {
		info.Status = StatusIdle
	}
	info.Error = ""

	return info, nil
}

// CheckAllHostUpdates checks for updates on all connected hosts
func (s *Service) CheckAllHostUpdates(ctx context.Context) ([]*HostUpdateInfo, error) {
	if s.nodeGetter == nil {
		return nil, fmt.Errorf("node getter not configured")
	}

	nodes, err := s.nodeGetter.ListNodes(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list nodes: %w", err)
	}

	var results []*HostUpdateInfo
	for _, node := range nodes {
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
	hostURL := fmt.Sprintf("https://%s:8443/api/v1/updates/apply", node.ManagementIP)
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

func (s *Service) downloadAndApplyComponent(ctx context.Context, manifest *Manifest, component Component) error {
	// Download artifact
	artifactURL := fmt.Sprintf("%s/api/v1/quantix-vdc/releases/%s/%s?channel=%s",
		s.config.ServerURL, manifest.Version, component.Artifact, manifest.Channel)

	stagingPath := filepath.Join(s.config.DataDir, "staging", component.Artifact)

	if err := s.downloadFile(ctx, artifactURL, stagingPath); err != nil {
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
	}

	// Backup existing file
	if component.InstallPath != "" {
		backupPath := filepath.Join(s.config.DataDir, "backup", filepath.Base(component.InstallPath))
		if _, err := os.Stat(component.InstallPath); err == nil {
			if err := copyFile(component.InstallPath, backupPath); err != nil {
				s.logger.Warn("Failed to backup existing file", zap.Error(err))
			}
		}
	}

	// Extract and install
	s.setVDCStatus(StatusApplying, "")

	// For tar.zst files, extract to install path
	// For now, we'll just copy the file (assuming it's extracted elsewhere or is a binary)
	if component.InstallPath != "" {
		if err := os.MkdirAll(filepath.Dir(component.InstallPath), 0755); err != nil {
			return fmt.Errorf("failed to create install directory: %w", err)
		}

		if err := copyFile(stagingPath, component.InstallPath); err != nil {
			return fmt.Errorf("failed to install: %w", err)
		}

		// Set permissions
		os.Chmod(component.InstallPath, 0755)
	}

	// Restart service if specified
	if component.RestartService != "" {
		s.logger.Info("Would restart service", zap.String("service", component.RestartService))
		// TODO: Implement service restart via systemd/OpenRC
	}

	// Cleanup
	os.Remove(stagingPath)

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
