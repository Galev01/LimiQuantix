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
	"syscall"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
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
	Name                string `json:"name"`
	Version             string `json:"version"`
	Artifact            string `json:"artifact"`
	SHA256              string `json:"sha256"`
	SizeBytes           int64  `json:"size_bytes"`
	InstallPath         string `json:"install_path"`
	RestartService      string `json:"restart_service,omitempty"`
	RequiresDBMigration bool   `json:"requires_db_migration,omitempty"`
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

// HostUpdateProgress represents real-time update progress from a QHCI host
type HostUpdateProgress struct {
	NodeID           string `json:"node_id"`
	Status           string `json:"status"`
	Message          string `json:"message,omitempty"`
	CurrentComponent string `json:"current_component,omitempty"`
	DownloadedBytes  int64  `json:"downloaded_bytes,omitempty"`
	TotalBytes       int64  `json:"total_bytes,omitempty"`
	Percentage       int    `json:"percentage,omitempty"`
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

// configFilePath is the path to the persisted update configuration
const configFilePath = "/etc/quantix-vdc/update.json"

// Version file locations
const (
	vdcPersistentVersionFile = "/var/lib/quantix-vdc/version"
	vdcEtcVersionFile        = "/etc/quantix-vdc/version"
)

// LoadConfig loads the update configuration from disk, falling back to defaults
func LoadConfig() Config {
	config := DefaultConfig()

	data, err := os.ReadFile(configFilePath)
	if err != nil {
		// Config file doesn't exist, use defaults
		return config
	}

	// Parse the JSON config
	var fileConfig struct {
		ServerURL     string `json:"server_url"`
		Channel       string `json:"channel"`
		CheckInterval string `json:"check_interval"`
		AutoCheck     bool   `json:"auto_check"`
		AutoApply     bool   `json:"auto_apply"`
		DataDir       string `json:"data_dir"`
	}

	if err := json.Unmarshal(data, &fileConfig); err != nil {
		// Invalid JSON, use defaults
		return config
	}

	// Apply loaded values (only if non-empty)
	if fileConfig.ServerURL != "" {
		config.ServerURL = fileConfig.ServerURL
	}
	if fileConfig.Channel != "" {
		config.Channel = UpdateChannel(fileConfig.Channel)
	}
	if fileConfig.CheckInterval != "" {
		if d, err := time.ParseDuration(fileConfig.CheckInterval); err == nil {
			config.CheckInterval = d
		}
	}
	if fileConfig.DataDir != "" {
		config.DataDir = fileConfig.DataDir
	}
	// Booleans are always applied (can be false)
	config.AutoCheck = fileConfig.AutoCheck
	config.AutoApply = fileConfig.AutoApply

	return config
}

// SaveConfig persists the update configuration to disk
func SaveConfig(config Config) error {
	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(configFilePath), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %w", err)
	}

	// Create JSON representation
	fileConfig := struct {
		ServerURL     string `json:"server_url"`
		Channel       string `json:"channel"`
		CheckInterval string `json:"check_interval"`
		AutoCheck     bool   `json:"auto_check"`
		AutoApply     bool   `json:"auto_apply"`
		DataDir       string `json:"data_dir"`
	}{
		ServerURL:     config.ServerURL,
		Channel:       string(config.Channel),
		CheckInterval: config.CheckInterval.String(),
		AutoCheck:     config.AutoCheck,
		AutoApply:     config.AutoApply,
		DataDir:       config.DataDir,
	}

	data, err := json.MarshalIndent(fileConfig, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	if err := os.WriteFile(configFilePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %w", err)
	}

	return nil
}

// Service provides OTA update management
type Service struct {
	config Config
	logger *zap.Logger

	// Update log path
	updateLogPath string

	// Current vDC state
	vdcState   UpdateState
	vdcStateMu sync.RWMutex
	vdcVersion string

	// Host update states
	hostStates   map[string]*HostUpdateInfo
	hostStatesMu sync.RWMutex

	// Maintenance mode state
	maintenanceMode   bool
	maintenanceModeMu sync.RWMutex

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

	// Default update log path
	updateLogPath := "/var/log/quantix-vdc/update.log"

	// Create data directories
	os.MkdirAll(filepath.Join(config.DataDir, "staging"), 0755)
	os.MkdirAll(filepath.Join(config.DataDir, "backup"), 0755)

	// Create TLS-skipping transport for host communication (hosts use self-signed certs)
	hostTransport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: true, // Skip verification for self-signed certs
		},
	}

	svc := &Service{
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
		updateLogPath: updateLogPath,
	}

	// Verify if this startup is after an update
	svc.verifyUpdateOnStartup()

	return svc
}

// verifyUpdateOnStartup checks if this startup follows an update and verifies
// that the update was applied correctly
func (s *Service) verifyUpdateOnStartup() {
	stateFile := filepath.Join(s.config.DataDir, "update-state.json")
	data, err := os.ReadFile(stateFile)
	if err != nil {
		// No pending update verification - this is normal for regular startups
		return
	}

	s.logger.Info("Found update state file, verifying update", zap.String("file", stateFile))

	var state map[string]interface{}
	if err := json.Unmarshal(data, &state); err != nil {
		s.logger.Warn("Failed to parse update state file", zap.Error(err))
		os.Remove(stateFile)
		return
	}

	expectedVersion, ok := state["version"].(string)
	if !ok {
		s.logger.Warn("Invalid version in update state")
		os.Remove(stateFile)
		return
	}

	currentVersion := getVDCVersion()

	if currentVersion == expectedVersion {
		s.logger.Info("Update verified successfully - running expected version",
			zap.String("version", currentVersion),
			zap.String("component", state["component"].(string)),
		)
	} else {
		s.logger.Error("Update verification failed - version mismatch",
			zap.String("expected", expectedVersion),
			zap.String("actual", currentVersion),
			zap.String("component", state["component"].(string)),
		)
	}

	// Clean up state file
	if err := os.Remove(stateFile); err != nil {
		s.logger.Warn("Failed to remove update state file", zap.Error(err))
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

// UpdateConfig updates the configuration and persists it to disk
func (s *Service) UpdateConfig(config Config) {
	s.config = config
	s.logger.Info("Update configuration changed",
		zap.String("server_url", config.ServerURL),
		zap.String("channel", string(config.Channel)),
	)

	// Persist config to disk
	if err := SaveConfig(config); err != nil {
		s.logger.Warn("Failed to persist update config", zap.Error(err))
	}
}

// ========================================================================
// vDC Self-Update Methods
// ========================================================================

// IsMaintenanceMode returns true if the service is in maintenance mode
func (s *Service) IsMaintenanceMode() bool {
	s.maintenanceModeMu.RLock()
	defer s.maintenanceModeMu.RUnlock()
	return s.maintenanceMode
}

// SetMaintenanceMode sets the maintenance mode state
func (s *Service) SetMaintenanceMode(enabled bool) {
	s.maintenanceModeMu.Lock()
	s.maintenanceMode = enabled
	s.maintenanceModeMu.Unlock()
	if enabled {
		s.logger.Warn("Maintenance mode ENABLED")
	} else {
		s.logger.Info("Maintenance mode DISABLED")
	}
}

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

	// Enable maintenance mode before starting update
	s.SetMaintenanceMode(true)
	defer func() {
		// Only disable maintenance mode if update failed or if no restart was triggered
		// If restart is triggered, the service will restart and maintenance mode will reset on startup
		// However, since this runs in a goroutine that survives the request, we should provide a way to recover
		// For now, we'll keep it enabled until the service actually restarts or we manually disable on error
	}()

	// Setup dedicated update log
	ul, err := s.setupUpdateLog()
	if err != nil {
		s.logger.Warn("Failed to setup update log file", zap.Error(err))
		// Fallback to main logger if file fails
		ul = s.logger
	} else {
		s.logger.Info("Logging detailed update progress to file", zap.String("path", s.updateLogPath))
	}

	totalComponents := len(manifest.Components)
	s.setVDCStatus(StatusDownloading, "")
	s.setVDCProgress(0, "", fmt.Sprintf("Starting update to v%s...", manifest.Version))

	// Log manifest details
	ul.Info("================================================================================")
	ul.Info("STARTING UPDATE",
		zap.String("target_version", manifest.Version),
		zap.String("current_version", s.vdcVersion),
		zap.Time("timestamp", time.Now()),
	)
	ul.Info("Manifest Details",
		zap.String("release_notes", manifest.ReleaseNotes),
		zap.String("release_date", manifest.ReleaseDate.String()),
		zap.Int("component_count", totalComponents),
	)

	// Track if any component requires DB migration
	requiresMigration := false
	var migrationComponent string

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

		if component.RequiresDBMigration {
			requiresMigration = true
			migrationComponent = component.Name
		}

		if err := s.downloadAndApplyComponent(ctx, manifest, component, ul, func(phase string, phaseProgress float64) {
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
			s.SetMaintenanceMode(false) // Disable maintenance mode on failure
			s.setVDCProgress(baseProgress, component.Name, "")
			s.logger.Error("Component update failed",
				zap.String("component", component.Name),
				zap.Error(err),
			)
			s.setVDCStatus(StatusError, fmt.Sprintf("Failed to apply %s: %v", component.Name, err))
			return fmt.Errorf("failed to apply component %s: %w", component.Name, err)
		}
	}
	if requiresMigration {
		s.setVDCProgress(95, "migration", "Running database migrations...")
		s.logger.Info("Running database migrations", zap.String("component", migrationComponent))

		if err := s.runMigrations(ctx); err != nil {
			s.SetMaintenanceMode(false)
			s.setVDCStatus(StatusError, fmt.Sprintf("Migration failed: %v", err))
			return fmt.Errorf("failed to run migrations: %w", err)
		}
		s.logger.Info("Database migrations completed successfully")
	}

	// Update complete - update both the state and internal version tracker
	s.setVDCProgress(100, "", fmt.Sprintf("Update to v%s completed successfully", manifest.Version))
	s.vdcStateMu.Lock()
	s.vdcState.Status = StatusIdle
	s.vdcState.CurrentVersion = manifest.Version
	s.vdcState.AvailableVersion = ""
	s.vdcVersion = manifest.Version // Update internal version so subsequent checks work correctly
	s.vdcStateMu.Unlock()

	// Persist the version to disk so it survives restarts
	if err := writeVDCVersion(manifest.Version); err != nil {
		s.logger.Warn("Failed to persist version file", zap.Error(err))
	}

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
		// Try fallback to simple version endpoint
		s.logger.Debug("Full update check failed, trying simple version endpoint",
			zap.String("node_id", nodeID),
			zap.Error(err),
		)
		if version := s.getHostSimpleVersion(ctx, hostIP); version != "" {
			info.CurrentVersion = version
			info.Status = StatusIdle
			now := time.Now()
			info.LastCheck = &now
			s.logger.Info("Got host version from simple endpoint",
				zap.String("node_id", nodeID),
				zap.String("version", version),
			)
			return info, nil
		}

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
		// If the full check fails (e.g., update server unreachable), try simple version
		s.logger.Debug("Full update check returned error, trying simple version endpoint",
			zap.String("node_id", nodeID),
			zap.Int("status_code", resp.StatusCode),
		)
		if version := s.getHostSimpleVersion(ctx, hostIP); version != "" {
			info.CurrentVersion = version
			info.Status = StatusIdle
			now := time.Now()
			info.LastCheck = &now
			s.logger.Info("Got host version from simple endpoint after check failure",
				zap.String("node_id", nodeID),
				zap.String("version", version),
			)
			return info, nil
		}

		// Parse the error response to extract a user-friendly message
		userFriendlyError := s.parseHostErrorResponse(resp.StatusCode, body)

		info.Status = StatusError
		info.Error = userFriendlyError
		s.logger.Warn("Host returned error status",
			zap.String("node_id", nodeID),
			zap.Int("status_code", resp.StatusCode),
			zap.String("body", string(body)),
			zap.String("user_error", userFriendlyError),
		)
		return info, fmt.Errorf("host returned status %d", resp.StatusCode)
	}

	// QHCI's /api/v1/updates/check returns UpdateInfo struct with camelCase fields:
	// {
	//   "available": bool,
	//   "currentVersion": string,
	//   "latestVersion": string (optional),
	//   "channel": string,
	//   "components": [...],
	//   "fullImageAvailable": bool,
	//   "totalDownloadSize": int,
	//   "releaseNotes": string (optional)
	// }
	var hostCheckResponse struct {
		Available          bool   `json:"available"`
		CurrentVersion     string `json:"currentVersion"`
		LatestVersion      string `json:"latestVersion"`
		Channel            string `json:"channel"`
		FullImageAvailable bool   `json:"fullImageAvailable"`
		TotalDownloadSize  int64  `json:"totalDownloadSize"`
		ReleaseNotes       string `json:"releaseNotes"`
	}

	// Read body for debugging and parsing
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		info.Status = StatusError
		info.Error = fmt.Sprintf("Failed to read host response: %v", err)
		return info, err
	}

	// Log raw response for debugging (temporarily at Info level to diagnose parsing issues)
	s.logger.Info("Raw host update response",
		zap.String("node_id", nodeID),
		zap.String("body", string(bodyBytes)),
	)

	if err := json.Unmarshal(bodyBytes, &hostCheckResponse); err != nil {
		info.Status = StatusError
		info.Error = fmt.Sprintf("Failed to parse host response: %v", err)
		s.logger.Warn("Failed to parse host update check response",
			zap.String("node_id", nodeID),
			zap.String("raw_body", string(bodyBytes)),
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

// getHostSimpleVersion fetches just the version from a host without requiring the update server
// This is a fallback when the full update check fails
func (s *Service) getHostSimpleVersion(ctx context.Context, hostIP string) string {
	versionURL := fmt.Sprintf("https://%s:8443/api/v1/updates/version", hostIP)

	req, err := http.NewRequestWithContext(ctx, "GET", versionURL, nil)
	if err != nil {
		return ""
	}

	resp, err := s.hostClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return ""
	}

	var versionResponse struct {
		CurrentVersion string `json:"currentVersion"`
		Channel        string `json:"channel"`
		Hostname       string `json:"hostname"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&versionResponse); err != nil {
		return ""
	}

	return versionResponse.CurrentVersion
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

// GetHostUpdateProgress fetches real-time update progress from a specific host
// This proxies the QHCI's /api/v1/updates/status endpoint to the QvDC dashboard
func (s *Service) GetHostUpdateProgress(ctx context.Context, nodeID string) (*HostUpdateProgress, error) {
	if s.nodeGetter == nil {
		return nil, fmt.Errorf("node getter not configured")
	}

	node, err := s.nodeGetter.GetNodeByID(ctx, nodeID)
	if err != nil {
		return nil, fmt.Errorf("failed to get node: %w", err)
	}

	// Strip CIDR notation from management IP
	hostIP := strings.Split(node.ManagementIP, "/")[0]
	hostURL := fmt.Sprintf("https://%s:8443/api/v1/updates/status", hostIP)

	req, err := http.NewRequestWithContext(ctx, "GET", hostURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := s.hostClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to contact host: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("host returned status %d: %s", resp.StatusCode, string(body))
	}

	// Parse the QHCI response which uses camelCase
	var hostResponse struct {
		Status   string `json:"status"`
		Message  string `json:"message"`
		Progress *struct {
			CurrentComponent string `json:"currentComponent"`
			DownloadedBytes  int64  `json:"downloadedBytes"`
			TotalBytes       int64  `json:"totalBytes"`
			Percentage       int    `json:"percentage"`
		} `json:"progress"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&hostResponse); err != nil {
		return nil, fmt.Errorf("failed to parse host response: %w", err)
	}

	progress := &HostUpdateProgress{
		NodeID:  nodeID,
		Status:  hostResponse.Status,
		Message: hostResponse.Message,
	}

	if hostResponse.Progress != nil {
		progress.CurrentComponent = hostResponse.Progress.CurrentComponent
		progress.DownloadedBytes = hostResponse.Progress.DownloadedBytes
		progress.TotalBytes = hostResponse.Progress.TotalBytes
		progress.Percentage = hostResponse.Progress.Percentage
	}

	// Update local state based on host status
	s.updateHostStateFromProgress(nodeID, progress)

	return progress, nil
}

// updateHostStateFromProgress updates local host state based on progress info
func (s *Service) updateHostStateFromProgress(nodeID string, progress *HostUpdateProgress) {
	s.hostStatesMu.Lock()
	defer s.hostStatesMu.Unlock()

	info, exists := s.hostStates[nodeID]
	if !exists {
		return
	}

	switch progress.Status {
	case "idle", "up_to_date":
		info.Status = StatusIdle
		info.Error = ""
	case "checking":
		info.Status = StatusChecking
	case "available":
		info.Status = StatusAvailable
	case "downloading":
		info.Status = StatusDownloading
	case "applying":
		info.Status = StatusApplying
	case "complete":
		info.Status = StatusIdle
		info.AvailableVersion = ""
		info.Error = ""
	case "error":
		info.Status = StatusError
		info.Error = progress.Message
	case "reboot_required":
		info.Status = StatusRebootReq
	}
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

func (s *Service) downloadAndApplyComponent(ctx context.Context, manifest *Manifest, component Component, logger *zap.Logger, onProgress ProgressCallback) error {
	logger.Info("Processing component update",
		zap.String("component", component.Name),
		zap.String("version", component.Version),
		zap.String("install_path", component.InstallPath),
	)

	// Download artifact
	artifactURL := fmt.Sprintf("%s/api/v1/quantix-vdc/releases/%s/%s?channel=%s",
		s.config.ServerURL, manifest.Version, component.Artifact, manifest.Channel)

	stagingPath := filepath.Join(s.config.DataDir, "staging", component.Artifact)

	// Download with progress tracking
	if err := s.downloadFileWithProgress(ctx, artifactURL, stagingPath, component.SizeBytes, logger, func(progress float64) {
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
			logger.Error("Hash mismatch",
				zap.String("expected", component.SHA256),
				zap.String("actual", actualHash),
			)
			return fmt.Errorf("hash mismatch: expected %s, got %s", component.SHA256, actualHash)
		}
		logger.Info("SHA256 verified", zap.String("component", component.Name))
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
		isDirectoryInstall := component.Name == "dashboard" || component.Name == "migrations" || strings.HasSuffix(component.InstallPath, "/")

		if isDirectoryInstall {
			// Extract tar.gz to directory
			logger.Info("Extracting to directory",
				zap.String("component", component.Name),
				zap.String("dest", component.InstallPath),
			)

			// Remove old directory contents and recreate
			if err := os.RemoveAll(component.InstallPath); err != nil {
				logger.Warn("Failed to remove old directory", zap.Error(err))
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
			logger.Info("Extracting binary",
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
					logger.Warn("Failed to backup existing file", zap.Error(err))
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
		go func(serviceName string, componentName string, version string) {
			// Wait 2 seconds to allow HTTP response to be sent
			s.logger.Debug("Restart countdown started", zap.Int("seconds", 2))
			time.Sleep(2 * time.Second)

			s.logger.Info("Preparing for service restart", zap.String("service", serviceName))

			// Save update state to disk for verification after restart
			stateFile := filepath.Join(s.config.DataDir, "update-state.json")
			state := map[string]interface{}{
				"last_update":    time.Now().UTC().Format(time.RFC3339),
				"version":        version,
				"component":      componentName,
				"restart_reason": "update",
				"service":        serviceName,
			}
			if stateData, err := json.Marshal(state); err == nil {
				if err := os.MkdirAll(filepath.Dir(stateFile), 0755); err != nil {
					s.logger.Warn("Failed to create state directory", zap.Error(err))
				}
				if err := os.WriteFile(stateFile, stateData, 0644); err != nil {
					s.logger.Warn("Failed to save update state", zap.Error(err))
				} else {
					s.logger.Info("Update state saved", zap.String("file", stateFile))
				}
			}

			// Wait a bit more to ensure all pending writes are flushed
			time.Sleep(500 * time.Millisecond)

			s.logger.Info("Executing service restart", zap.String("service", serviceName))

			// Try OpenRC first (Alpine Linux), then systemd
			// Use setsid/nohup to detach logic
			var cmd *exec.Cmd

			// Try to detect init system
			if _, err := os.Stat("/run/openrc"); err == nil {
				s.logger.Debug("Detected OpenRC")
				// Non-blocking restart for OpenRC is tricky, usually handled by service manager
				// We'll try to spawn a shell that runs it in background
				cmd = exec.Command("sh", "-c", fmt.Sprintf("sleep 1 && rc-service %s restart", serviceName))
			} else {
				s.logger.Debug("Assuming systemd")
				// Non-blocking systemd restart: systemctl restart --no-block
				cmd = exec.Command("systemctl", "restart", "--no-block", serviceName)
			}

			// Detach process
			if cmd != nil {
				cmd.SysProcAttr = &syscall.SysProcAttr{
					Setsid: true, // Create new session
				}

				s.logger.Debug("Starting restart command", zap.String("cmd", cmd.String()))
				if err := cmd.Start(); err != nil {
					s.logger.Error("Failed to start restart command", zap.Error(err))
					// Fallback to simpler attempt
					exec.Command("reboot").Start()
				} else {
					// Release process - don't wait
					if err := cmd.Process.Release(); err != nil {
						s.logger.Warn("Failed to release process", zap.Error(err))
					}
					s.logger.Info("Restart command dispatched (pid released)")
				}
			}
		}(component.RestartService, component.Name, component.Version)

		logger.Info("Service restart scheduled (will execute in 2.5 seconds)", zap.String("service", component.RestartService))
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
func (s *Service) downloadFileWithProgress(ctx context.Context, url, destPath string, expectedSize int64, logger *zap.Logger, onProgress func(float64)) error {
	logger.Info("Starting file download with progress",
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
	// Try the persistent version file first (survives restarts)
	if data, err := os.ReadFile(vdcPersistentVersionFile); err == nil {
		version := strings.TrimSpace(string(data))
		if version != "" && version != "0.0.0" {
			return version
		}
	}

	// Fallback to /etc for older installations
	if data, err := os.ReadFile(vdcEtcVersionFile); err == nil {
		version := strings.TrimSpace(string(data))
		if version != "" && version != "0.0.0" {
			return version
		}
	}

	// Fallback: try to read from release file (older installations)
	releaseFile := "/etc/quantix-vdc-release"
	if data, err := os.ReadFile(releaseFile); err == nil {
		// Parse QUANTIX_VDC_VERSION="X.Y.Z" from the file
		for _, line := range strings.Split(string(data), "\n") {
			if strings.HasPrefix(line, "QUANTIX_VDC_VERSION=") {
				version := strings.TrimPrefix(line, "QUANTIX_VDC_VERSION=")
				version = strings.Trim(version, "\"' \t\r\n")
				if version != "" {
					return version
				}
			}
		}
	}

	// Final fallback to build version
	return "0.0.1"
}

func writeVDCVersion(version string) error {
	var errors []string
	versionData := []byte(version + "\n")

	// Write to persistent location first
	if err := os.MkdirAll(filepath.Dir(vdcPersistentVersionFile), 0755); err != nil {
		errors = append(errors, fmt.Sprintf("create persistent dir: %v", err))
	} else if err := os.WriteFile(vdcPersistentVersionFile, versionData, 0644); err != nil {
		errors = append(errors, fmt.Sprintf("write persistent version: %v", err))
	}

	// Also write to /etc for backward compatibility
	if err := os.MkdirAll(filepath.Dir(vdcEtcVersionFile), 0755); err != nil {
		errors = append(errors, fmt.Sprintf("create etc dir: %v", err))
	} else if err := os.WriteFile(vdcEtcVersionFile, versionData, 0644); err != nil {
		errors = append(errors, fmt.Sprintf("write etc version: %v", err))
	}

	if len(errors) > 0 {
		return fmt.Errorf("failed to persist version: %s", strings.Join(errors, "; "))
	}
	return nil
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

// copyFile copies a file from src to dst using atomic replacement logic.
// It writes to a temporary file first, then renames it to the destination.
// This ensures atomicity and avoids ETXTBSY errors when replacing running binaries on Linux.
func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	// Create temp file in the same directory as destination to ensure atomic rename works
	// (rename is only atomic within the same filesystem)
	dstDir := filepath.Dir(dst)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("failed to ensure destination directory: %w", err)
	}

	tempFile, err := os.CreateTemp(dstDir, ".update-tmp-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tempPath := tempFile.Name()

	// Ensure temp file is cleaned up if we fail
	defer func() {
		tempFile.Close() // Close first so we can remove
		if _, err := os.Stat(tempPath); err == nil {
			// If file still exists (wasn't renamed), remove it
			os.Remove(tempPath)
		}
	}()

	if _, err = io.Copy(tempFile, sourceFile); err != nil {
		return fmt.Errorf("failed to copy content: %w", err)
	}

	// Sync to ensure data is fully written to disk before renaming
	if err := tempFile.Sync(); err != nil {
		return fmt.Errorf("failed to sync temp file: %w", err)
	}

	// Copy permissions from source if possible, otherwise default to 0755
	info, err := sourceFile.Stat()
	if err == nil {
		tempFile.Chmod(info.Mode())
	} else {
		tempFile.Chmod(0755)
	}

	// Explicitly close before renaming (required on Windows, good practice elsewhere)
	tempFile.Close()

	// Atomic rename
	if err := os.Rename(tempPath, dst); err != nil {
		return fmt.Errorf("failed to rename %s to %s: %w", tempPath, dst, err)
	}

	return nil
}

// runMigrations executes the database migration tool
func (s *Service) runMigrations(ctx context.Context) error {
	// Look for the migrate binary in standard locations
	migrateBin := "/usr/share/quantix-vdc/migrations/quantix-migrate"
	if _, err := os.Stat(migrateBin); os.IsNotExist(err) {
		// Fallback for dev environment
		migrateBin = "quantix-migrate"
	}

	// Ensure we pass the config environment variables so the tool knows how to connect
	// We assume the service is running with environment variables loaded (systemd EnvironmentFile)
	// If not, we might need to explicitly read config and pass it.
	// For now, we assume standard deployment where env vars are inherited.

	cmd := exec.CommandContext(ctx, migrateBin, "up")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	s.logger.Info("Executing migration command", zap.String("cmd", migrateBin+" up"))

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("migration command failed: %w", err)
	}

	return nil
}

// setupUpdateLog creates a logger that writes to the dedicated update log file
func (s *Service) setupUpdateLog() (*zap.Logger, error) {
	// Ensure log directory exists
	if err := os.MkdirAll(filepath.Dir(s.updateLogPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create log directory: %w", err)
	}

	// Configure logging
	cfg := zap.NewProductionConfig()
	cfg.OutputPaths = []string{s.updateLogPath}
	cfg.ErrorOutputPaths = []string{s.updateLogPath}
	cfg.EncoderConfig.TimeKey = "time"
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

	logger, err := cfg.Build()
	if err != nil {
		return nil, fmt.Errorf("failed to build logger: %w", err)
	}

	return logger, nil
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
// Error Message Parsing
// ========================================================================

// parseHostErrorResponse extracts a user-friendly error message from QHCI error responses
func (s *Service) parseHostErrorResponse(statusCode int, body []byte) string {
	// Try to parse as JSON error response from QHCI
	var errorResp struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}

	if err := json.Unmarshal(body, &errorResp); err == nil && errorResp.Message != "" {
		// Check for known error patterns and provide user-friendly messages
		msg := errorResp.Message

		// Pattern: "Failed to check for updates: Update server returned error 404 Not Found: {...}"
		if strings.Contains(msg, "No releases found") {
			// Extract product name if available
			var innerError struct {
				Product string `json:"product"`
				Channel string `json:"channel"`
				Error   string `json:"error"`
			}
			// Try to extract the inner JSON from the message
			if idx := strings.Index(msg, "{"); idx != -1 {
				innerJSON := msg[idx:]
				if json.Unmarshal([]byte(innerJSON), &innerError) == nil {
					if innerError.Product != "" {
						return fmt.Sprintf("No releases available for %s on the '%s' channel. The update server has no published releases yet.",
							innerError.Product, innerError.Channel)
					}
				}
			}
			return "No releases available on the update server. Releases need to be published first."
		}

		// Pattern: Update server connection errors
		if strings.Contains(msg, "connection refused") || strings.Contains(msg, "no such host") {
			return "Cannot reach update server. Check that the update server is running and accessible."
		}

		// Pattern: Timeout errors
		if strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline exceeded") {
			return "Update server request timed out. The server may be overloaded or unreachable."
		}

		// Pattern: 404 from update server
		if strings.Contains(msg, "404 Not Found") {
			return "Update server returned 'not found'. The requested release or channel may not exist."
		}

		// Pattern: Authentication errors
		if strings.Contains(msg, "401") || strings.Contains(msg, "403") || strings.Contains(msg, "unauthorized") {
			return "Update server authentication failed. Check the update server credentials."
		}

		// For other errors, try to simplify the message
		// Remove nested JSON for cleaner display
		if idx := strings.Index(msg, "{"); idx != -1 {
			msg = strings.TrimSpace(msg[:idx])
			if msg != "" {
				return msg
			}
		}

		return errorResp.Message
	}

	// Fallback: return a generic message with status code
	switch statusCode {
	case 503:
		return "Host update service temporarily unavailable"
	case 500:
		return "Host encountered an internal error while checking for updates"
	case 404:
		return "Update check endpoint not found on host"
	case 401, 403:
		return "Authentication failed when contacting host"
	default:
		// If we can't parse, return a cleaner version of the raw response
		bodyStr := string(body)
		if len(bodyStr) > 100 {
			bodyStr = bodyStr[:100] + "..."
		}
		return fmt.Sprintf("Host returned error (status %d)", statusCode)
	}
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
