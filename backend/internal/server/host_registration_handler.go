// Package server provides HTTP handlers for host registration.
package server

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// HostRegistrationHandler handles REST endpoints for adding hosts via vDC UI.
type HostRegistrationHandler struct {
	server *Server
	logger *zap.Logger
}

// NewHostRegistrationHandler creates a new handler.
func NewHostRegistrationHandler(s *Server) *HostRegistrationHandler {
	return &HostRegistrationHandler{
		server: s,
		logger: s.logger.Named("host-registration"),
	}
}

// RegisterRoutes registers routes for host registration.
func (h *HostRegistrationHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/nodes/register", h.handleRegisterHost)
	mux.HandleFunc("/api/nodes/discover", h.handleDiscoverHost)
}

// HostDiscoveryRequest contains information to discover a remote host.
type HostDiscoveryRequest struct {
	HostURL           string `json:"hostUrl"`
	RegistrationToken string `json:"registrationToken"`
}

// HostDiscoveryResponse contains discovered host information.
type HostDiscoveryResponse struct {
	Hostname     string        `json:"hostname"`
	ManagementIP string        `json:"managementIp"`
	CPU          CPUInfo       `json:"cpu"`
	Memory       MemoryInfo    `json:"memory"`
	Storage      StorageInfo   `json:"storage"`
	Network      []NetworkInfo `json:"network"`
	GPUs         []GPUInfo     `json:"gpus"`
}

// CPUInfo represents CPU information from the host.
type CPUInfo struct {
	Model        string   `json:"model"`
	Vendor       string   `json:"vendor,omitempty"`
	Cores        int      `json:"cores"`
	Threads      int      `json:"threads"`
	Sockets      int      `json:"sockets"`
	FrequencyMHz uint64   `json:"frequencyMhz,omitempty"`
	Features     []string `json:"features,omitempty"`
	Architecture string   `json:"architecture,omitempty"`
}

// MemoryInfo represents memory information.
type MemoryInfo struct {
	TotalBytes     uint64 `json:"totalBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
	UsedBytes      uint64 `json:"usedBytes,omitempty"`
	SwapTotalBytes uint64 `json:"swapTotalBytes,omitempty"`
	SwapUsedBytes  uint64 `json:"swapUsedBytes,omitempty"`
	EccEnabled     bool   `json:"eccEnabled,omitempty"`
	DimmCount      uint32 `json:"dimmCount,omitempty"`
}

// StorageInfo represents storage inventory.
type StorageInfo struct {
	Local []LocalDisk   `json:"local"`
	NFS   []NFSMount    `json:"nfs"`
	ISCSI []ISCSITarget `json:"iscsi"`
}

// LocalDisk represents a local disk.
type LocalDisk struct {
	Name        string          `json:"name"`
	Model       string          `json:"model"`
	Serial      string          `json:"serial,omitempty"`
	SizeBytes   uint64          `json:"sizeBytes"`
	DiskType    string          `json:"diskType"`
	Interface   string          `json:"interface"`
	IsRemovable bool            `json:"isRemovable,omitempty"`
	SmartStatus string          `json:"smartStatus,omitempty"`
	Partitions  []PartitionInfo `json:"partitions,omitempty"`
}

// PartitionInfo represents a disk partition.
type PartitionInfo struct {
	Name       string `json:"name"`
	MountPoint string `json:"mountPoint,omitempty"`
	Filesystem string `json:"filesystem,omitempty"`
	SizeBytes  uint64 `json:"sizeBytes"`
	UsedBytes  uint64 `json:"usedBytes,omitempty"`
}

// NFSMount represents an NFS mount.
type NFSMount struct {
	MountPoint     string `json:"mountPoint"`
	Server         string `json:"server"`
	ExportPath     string `json:"exportPath"`
	SizeBytes      uint64 `json:"sizeBytes"`
	UsedBytes      uint64 `json:"usedBytes"`
	AvailableBytes uint64 `json:"availableBytes"`
}

// ISCSITarget represents an iSCSI target.
type ISCSITarget struct {
	TargetIQN  string `json:"targetIqn"`
	Portal     string `json:"portal"`
	DevicePath string `json:"devicePath"`
	SizeBytes  uint64 `json:"sizeBytes"`
	LUN        int    `json:"lun"`
}

// NetworkInfo represents a network interface.
type NetworkInfo struct {
	Name         string  `json:"name"`
	MACAddress   string  `json:"macAddress"`
	Driver       string  `json:"driver,omitempty"`
	SpeedMbps    *uint64 `json:"speedMbps,omitempty"`
	LinkState    string  `json:"linkState,omitempty"`
	PciAddress   *string `json:"pciAddress,omitempty"`
	SriovCapable bool    `json:"sriovCapable,omitempty"`
	SriovVfs     uint32  `json:"sriovVfs,omitempty"`
}

// GPUInfo represents a GPU.
type GPUInfo struct {
	Name         string `json:"name"`
	Vendor       string `json:"vendor"`
	PciAddress   string `json:"pciAddress,omitempty"`
	MemoryBytes  uint64 `json:"memoryBytes,omitempty"`
	VgpuProfiles string `json:"vgpuProfiles,omitempty"`
}

// HostRegistrationRequest contains data for registering a new host.
type HostRegistrationRequest struct {
	Hostname          string       `json:"hostname"`
	ManagementIP      string       `json:"managementIp"`
	HostURL           string       `json:"hostUrl"`
	RegistrationToken string       `json:"registrationToken"`
	ClusterID         string       `json:"clusterId"`
	Resources         ResourceInfo `json:"resources"`
}

// ResourceInfo contains all resources from the host.
type ResourceInfo struct {
	CPU     CPUInfo       `json:"cpu"`
	Memory  MemoryInfo    `json:"memory"`
	Storage StorageInfo   `json:"storage"`
	Network []NetworkInfo `json:"network"`
	GPUs    []GPUInfo     `json:"gpus"`
}

// HostDiscoveryError represents a structured error for host discovery operations
type HostDiscoveryError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Details    string `json:"details,omitempty"`
	HostURL    string `json:"hostUrl,omitempty"`
	StatusCode int    `json:"statusCode,omitempty"`
	Phase      string `json:"phase"` // Which phase failed: "connection", "api_check", "token_validation", "discovery"
}

// Discovery phases for tracking progress
const (
	PhaseConnection      = "connection"
	PhaseAPICheck        = "api_check"
	PhaseTokenValidation = "token_validation"
	PhaseDiscovery       = "discovery"
)

// Error codes for frontend to handle
const (
	ErrCodeConnectionFailed   = "HOST_CONNECTION_FAILED"
	ErrCodeAPINotAvailable    = "HOST_API_NOT_AVAILABLE"
	ErrCodeFirmwareOutdated   = "HOST_FIRMWARE_OUTDATED"
	ErrCodeTokenInvalid       = "TOKEN_INVALID"
	ErrCodeTokenExpired       = "TOKEN_EXPIRED"
	ErrCodeTokenMissing       = "TOKEN_MISSING"
	ErrCodeDiscoveryFailed    = "DISCOVERY_FAILED"
	ErrCodeInvalidResponse    = "INVALID_RESPONSE"
	ErrCodeNetworkUnreachable = "NETWORK_UNREACHABLE"
	ErrCodeTLSError           = "TLS_ERROR"
	ErrCodeTimeout            = "CONNECTION_TIMEOUT"
)

// writeDiscoveryError writes a structured discovery error response
func (h *HostRegistrationHandler) writeDiscoveryError(w http.ResponseWriter, err HostDiscoveryError, httpStatus int) {
	h.logger.Error("Host discovery failed",
		zap.String("code", err.Code),
		zap.String("message", err.Message),
		zap.String("details", err.Details),
		zap.String("host_url", err.HostURL),
		zap.Int("remote_status", err.StatusCode),
		zap.String("phase", err.Phase),
	)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpStatus)
	json.NewEncoder(w).Encode(err)
}

// classifyConnectionError determines the specific error code based on the error type
func classifyConnectionError(err error) string {
	errStr := err.Error()
	switch {
	case strings.Contains(errStr, "timeout"):
		return ErrCodeTimeout
	case strings.Contains(errStr, "no such host"):
		return ErrCodeNetworkUnreachable
	case strings.Contains(errStr, "connection refused"):
		return ErrCodeConnectionFailed
	case strings.Contains(errStr, "certificate"):
		return ErrCodeTLSError
	case strings.Contains(errStr, "network is unreachable"):
		return ErrCodeNetworkUnreachable
	default:
		return ErrCodeConnectionFailed
	}
}

// handleDiscoverHost handles POST /api/nodes/discover
// This endpoint connects to a remote host and validates its token, returning discovered resources.
//
// Flow:
// 1. Ping the host's registration API to verify it's available
// 2. Validate the provided token with the host
// 3. Fetch full discovery data (hardware resources)
// 4. Return discovery data to frontend for confirmation
func (h *HostRegistrationHandler) handleDiscoverHost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HostDiscoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    "INVALID_REQUEST",
			Message: "Invalid request body",
			Details: err.Error(),
			Phase:   "request_parsing",
		}, http.StatusBadRequest)
		return
	}

	// Normalize host URL (remove trailing slash)
	req.HostURL = strings.TrimSuffix(req.HostURL, "/")

	if req.HostURL == "" {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    "MISSING_HOST_URL",
			Message: "Host URL is required",
			Phase:   "validation",
		}, http.StatusBadRequest)
		return
	}

	if req.RegistrationToken == "" {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    ErrCodeTokenMissing,
			Message: "Registration token is required",
			Details: "Enter the token displayed on the host's registration page",
			Phase:   "validation",
		}, http.StatusBadRequest)
		return
	}

	h.logger.Info("Starting host discovery",
		zap.String("host_url", req.HostURL),
		zap.String("token_prefix", req.RegistrationToken[:min(12, len(req.RegistrationToken))]+"..."),
	)

	// Create HTTP client with timeout
	// Skip TLS verification for self-signed certs (production would use proper CA)
	client := &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true, // Allow self-signed certificates
			},
		},
	}

	// =========================================================================
	// PHASE 1: API Availability Check (Ping)
	// =========================================================================
	h.logger.Debug("Phase 1: Checking API availability")

	pingURL := fmt.Sprintf("%s/api/v1/registration/ping", req.HostURL)
	pingResp, err := client.Get(pingURL)
	if err != nil {
		errCode := classifyConnectionError(err)
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    errCode,
			Message: "Cannot connect to host",
			Details: fmt.Sprintf("Failed to reach %s: %s", req.HostURL, err.Error()),
			HostURL: req.HostURL,
			Phase:   PhaseConnection,
		}, http.StatusBadGateway)
		return
	}
	defer pingResp.Body.Close()

	pingBody, _ := io.ReadAll(pingResp.Body)
	pingContentType := pingResp.Header.Get("Content-Type")

	h.logger.Info("API ping response",
		zap.String("url", pingURL),
		zap.Int("status", pingResp.StatusCode),
		zap.String("content_type", pingContentType),
		zap.Int("body_length", len(pingBody)),
	)

	// Check if we got HTML instead of JSON (indicates old firmware without registration API)
	isHTML := len(pingBody) > 0 && (pingBody[0] == '<' || strings.Contains(pingContentType, "text/html"))

	if isHTML {
		h.logger.Warn("Host returned HTML instead of JSON - firmware likely outdated",
			zap.String("host_url", req.HostURL),
			zap.String("content_type", pingContentType),
		)
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeFirmwareOutdated,
			Message:    "Host firmware does not support registration API",
			Details:    "The host at " + req.HostURL + " returned an HTML page instead of the registration API. This indicates the host is running an older version of Quantix-OS that doesn't support token-based registration. Please update the host to the latest Quantix-OS version.",
			HostURL:    req.HostURL,
			StatusCode: pingResp.StatusCode,
			Phase:      PhaseAPICheck,
		}, http.StatusBadGateway)
		return
	}

	if pingResp.StatusCode != http.StatusOK {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeAPINotAvailable,
			Message:    "Host registration API returned error",
			Details:    fmt.Sprintf("Status %d: %s", pingResp.StatusCode, string(pingBody)),
			HostURL:    req.HostURL,
			StatusCode: pingResp.StatusCode,
			Phase:      PhaseAPICheck,
		}, http.StatusBadGateway)
		return
	}

	// Parse ping response to get host version info
	var pingData struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(pingBody, &pingData); err != nil {
		h.logger.Warn("Could not parse ping response", zap.Error(err))
	} else {
		h.logger.Info("Host API confirmed",
			zap.String("status", pingData.Status),
			zap.String("version", pingData.Version),
		)
	}

	// =========================================================================
	// PHASE 2: Token Validation
	// =========================================================================
	h.logger.Debug("Phase 2: Validating registration token")

	tokenURL := fmt.Sprintf("%s/api/v1/registration/token", req.HostURL)
	tokenReq, err := http.NewRequest(http.MethodGet, tokenURL, nil)
	if err != nil {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    "INTERNAL_ERROR",
			Message: "Failed to create token validation request",
			Details: err.Error(),
			Phase:   PhaseTokenValidation,
		}, http.StatusInternalServerError)
		return
	}
	tokenReq.Header.Set("Authorization", "Bearer "+req.RegistrationToken)

	tokenResp, err := client.Do(tokenReq)
	if err != nil {
		errCode := classifyConnectionError(err)
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    errCode,
			Message: "Connection lost during token validation",
			Details: err.Error(),
			HostURL: req.HostURL,
			Phase:   PhaseTokenValidation,
		}, http.StatusBadGateway)
		return
	}
	defer tokenResp.Body.Close()

	tokenBody, _ := io.ReadAll(tokenResp.Body)
	tokenContentType := tokenResp.Header.Get("Content-Type")

	h.logger.Info("Token validation response",
		zap.String("url", tokenURL),
		zap.Int("status", tokenResp.StatusCode),
		zap.String("content_type", tokenContentType),
		zap.Int("body_length", len(tokenBody)),
	)

	// Check for HTML response (should not happen after ping succeeded, but be defensive)
	if len(tokenBody) > 0 && tokenBody[0] == '<' {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeInvalidResponse,
			Message:    "Unexpected HTML response during token validation",
			Details:    "The host returned HTML instead of JSON. This is unexpected after the ping succeeded. Try again or restart the host's node daemon.",
			HostURL:    req.HostURL,
			StatusCode: tokenResp.StatusCode,
			Phase:      PhaseTokenValidation,
		}, http.StatusBadGateway)
		return
	}

	// Handle different HTTP status codes
	switch tokenResp.StatusCode {
	case http.StatusOK:
		// Token valid, continue
	case http.StatusUnauthorized:
		// Parse error details
		var tokenErr struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if err := json.Unmarshal(tokenBody, &tokenErr); err == nil {
			if tokenErr.Error == "token_expired" || strings.Contains(tokenErr.Message, "expired") {
				h.writeDiscoveryError(w, HostDiscoveryError{
					Code:       ErrCodeTokenExpired,
					Message:    "Registration token has expired",
					Details:    "The token is only valid for 1 hour. Please generate a new token on the host.",
					HostURL:    req.HostURL,
					StatusCode: tokenResp.StatusCode,
					Phase:      PhaseTokenValidation,
				}, http.StatusUnauthorized)
				return
			}
		}
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeTokenInvalid,
			Message:    "Invalid registration token",
			Details:    "The token you entered does not match the token on the host. Please verify you copied it correctly.",
			HostURL:    req.HostURL,
			StatusCode: tokenResp.StatusCode,
			Phase:      PhaseTokenValidation,
		}, http.StatusUnauthorized)
		return
	case http.StatusNotFound:
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeTokenMissing,
			Message:    "No registration token exists on the host",
			Details:    "The host does not have an active registration token. Please generate one on the host first.",
			HostURL:    req.HostURL,
			StatusCode: tokenResp.StatusCode,
			Phase:      PhaseTokenValidation,
		}, http.StatusBadRequest)
		return
	default:
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeTokenInvalid,
			Message:    fmt.Sprintf("Token validation failed (HTTP %d)", tokenResp.StatusCode),
			Details:    string(tokenBody),
			HostURL:    req.HostURL,
			StatusCode: tokenResp.StatusCode,
			Phase:      PhaseTokenValidation,
		}, http.StatusUnauthorized)
		return
	}

	// Parse token response
	var tokenData struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expiresAt"`
		Hostname  string `json:"hostname"`
	}
	if err := json.Unmarshal(tokenBody, &tokenData); err != nil {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    ErrCodeInvalidResponse,
			Message: "Failed to parse token validation response",
			Details: err.Error(),
			HostURL: req.HostURL,
			Phase:   PhaseTokenValidation,
		}, http.StatusBadGateway)
		return
	}

	h.logger.Info("Token validated successfully",
		zap.String("host_token", tokenData.Token[:min(12, len(tokenData.Token))]+"..."),
		zap.String("hostname", tokenData.Hostname),
		zap.String("expires_at", tokenData.ExpiresAt),
	)

	// =========================================================================
	// PHASE 3: Fetch Discovery Data
	// =========================================================================
	h.logger.Debug("Phase 3: Fetching host discovery data")

	discoveryURL := fmt.Sprintf("%s/api/v1/registration/discovery", req.HostURL)
	discoveryReq, err := http.NewRequest(http.MethodGet, discoveryURL, nil)
	if err != nil {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    "INTERNAL_ERROR",
			Message: "Failed to create discovery request",
			Details: err.Error(),
			Phase:   PhaseDiscovery,
		}, http.StatusInternalServerError)
		return
	}
	discoveryReq.Header.Set("Authorization", "Bearer "+req.RegistrationToken)

	discoveryResp, err := client.Do(discoveryReq)
	if err != nil {
		errCode := classifyConnectionError(err)
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    errCode,
			Message: "Connection lost during discovery",
			Details: err.Error(),
			HostURL: req.HostURL,
			Phase:   PhaseDiscovery,
		}, http.StatusBadGateway)
		return
	}
	defer discoveryResp.Body.Close()

	discoveryBody, err := io.ReadAll(discoveryResp.Body)
	if err != nil {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    "READ_ERROR",
			Message: "Failed to read discovery response",
			Details: err.Error(),
			Phase:   PhaseDiscovery,
		}, http.StatusInternalServerError)
		return
	}

	discoveryContentType := discoveryResp.Header.Get("Content-Type")

	h.logger.Info("Discovery response received",
		zap.String("url", discoveryURL),
		zap.Int("status", discoveryResp.StatusCode),
		zap.String("content_type", discoveryContentType),
		zap.Int("body_length", len(discoveryBody)),
	)

	// Check if response looks like HTML (SPA fallback issue)
	if len(discoveryBody) > 0 && discoveryBody[0] == '<' {
		previewLen := min(200, len(discoveryBody))
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeInvalidResponse,
			Message:    "Host returned HTML instead of discovery data",
			Details:    "The discovery endpoint returned an HTML page. This indicates a routing issue on the host. Preview: " + string(discoveryBody[:previewLen]),
			HostURL:    req.HostURL,
			StatusCode: discoveryResp.StatusCode,
			Phase:      PhaseDiscovery,
		}, http.StatusBadGateway)
		return
	}

	if discoveryResp.StatusCode != http.StatusOK {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:       ErrCodeDiscoveryFailed,
			Message:    fmt.Sprintf("Discovery failed (HTTP %d)", discoveryResp.StatusCode),
			Details:    string(discoveryBody),
			HostURL:    req.HostURL,
			StatusCode: discoveryResp.StatusCode,
			Phase:      PhaseDiscovery,
		}, http.StatusBadGateway)
		return
	}

	// Parse discovery response
	var discovery HostDiscoveryResponse
	if err := json.Unmarshal(discoveryBody, &discovery); err != nil {
		h.writeDiscoveryError(w, HostDiscoveryError{
			Code:    ErrCodeInvalidResponse,
			Message: "Failed to parse host discovery data",
			Details: fmt.Sprintf("JSON parse error: %s. Body: %s", err.Error(), string(discoveryBody[:min(200, len(discoveryBody))])),
			HostURL: req.HostURL,
			Phase:   PhaseDiscovery,
		}, http.StatusBadGateway)
		return
	}

	// =========================================================================
	// SUCCESS: All phases completed
	// =========================================================================
	h.logger.Info("Host discovery completed successfully",
		zap.String("hostname", discovery.Hostname),
		zap.String("management_ip", discovery.ManagementIP),
		zap.String("host_url", req.HostURL),
		zap.Int("cpu_cores", discovery.CPU.Cores),
		zap.Uint64("memory_bytes", discovery.Memory.TotalBytes),
		zap.Int("local_disks", len(discovery.Storage.Local)),
		zap.Int("nfs_mounts", len(discovery.Storage.NFS)),
		zap.Int("iscsi_targets", len(discovery.Storage.ISCSI)),
		zap.Int("network_interfaces", len(discovery.Network)),
		zap.Int("gpus", len(discovery.GPUs)),
	)

	h.writeJSON(w, discovery, http.StatusOK)
}

// handleRegisterHost handles POST /api/nodes/register
// This endpoint registers a discovered host with the control plane.
func (h *HostRegistrationHandler) handleRegisterHost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HostRegistrationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.Hostname == "" {
		h.writeError(w, "Hostname is required", http.StatusBadRequest)
		return
	}
	if req.ManagementIP == "" {
		h.writeError(w, "Management IP is required", http.StatusBadRequest)
		return
	}
	if req.ClusterID == "" {
		h.writeError(w, "Cluster ID is required", http.StatusBadRequest)
		return
	}

	h.logger.Info("Host registration request",
		zap.String("hostname", req.Hostname),
		zap.String("ip", req.ManagementIP),
		zap.String("cluster_id", req.ClusterID),
	)

	// Create node in repository
	now := time.Now()

	// Convert bytes to MiB
	totalMemoryMiB := int64(req.Resources.Memory.TotalBytes / (1024 * 1024))
	availableMemoryMiB := int64(req.Resources.Memory.AvailableBytes / (1024 * 1024))

	// Calculate threads per core (default to 1 if not available)
	threadsPerCore := int32(1)
	if req.Resources.CPU.Threads > req.Resources.CPU.Cores && req.Resources.CPU.Cores > 0 {
		threadsPerCore = int32(req.Resources.CPU.Threads / req.Resources.CPU.Cores)
	}

	// Calculate total storage in GiB
	var totalStorageGiB int64
	for _, disk := range req.Resources.Storage.Local {
		totalStorageGiB += int64(disk.SizeBytes / (1024 * 1024 * 1024))
	}
	for _, mount := range req.Resources.Storage.NFS {
		totalStorageGiB += int64(mount.SizeBytes / (1024 * 1024 * 1024))
	}
	for _, target := range req.Resources.Storage.ISCSI {
		totalStorageGiB += int64(target.SizeBytes / (1024 * 1024 * 1024))
	}

	node := &domain.Node{
		ID:           uuid.New().String(),
		Hostname:     req.Hostname,
		ManagementIP: req.ManagementIP,
		ClusterID:    req.ClusterID,
		Labels:       map[string]string{},
		Spec: domain.NodeSpec{
			CPU: domain.NodeCPUInfo{
				Model:          req.Resources.CPU.Model,
				Sockets:        int32(req.Resources.CPU.Sockets),
				CoresPerSocket: int32(req.Resources.CPU.Cores / max(req.Resources.CPU.Sockets, 1)),
				ThreadsPerCore: threadsPerCore,
			},
			Memory: domain.NodeMemoryInfo{
				TotalMiB:       totalMemoryMiB,
				AllocatableMiB: availableMemoryMiB,
			},
			Scheduling: domain.SchedulingConfig{
				Schedulable: true,
			},
			Role: domain.NodeRole{
				Compute: true,
				Storage: len(req.Resources.Storage.Local) > 0 ||
					len(req.Resources.Storage.NFS) > 0 ||
					len(req.Resources.Storage.ISCSI) > 0,
			},
		},
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseReady,
			Conditions: []domain.NodeCondition{
				{
					Type:       "Ready",
					Status:     "True",
					LastUpdate: now,
				},
			},
			Allocatable: domain.Resources{
				CPUCores:   int32(req.Resources.CPU.Cores),
				MemoryMiB:  totalMemoryMiB,
				StorageGiB: totalStorageGiB,
				GPUCount:   int32(len(req.Resources.GPUs)),
			},
			Allocated: domain.Resources{}, // No VMs yet
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Store storage info in labels for now (we'd have proper storage pool creation later)
	if len(req.Resources.Storage.Local) > 0 {
		node.Labels["quantix.io/local-storage"] = "true"
	}
	if len(req.Resources.Storage.NFS) > 0 {
		node.Labels["quantix.io/nfs-storage"] = "true"
	}
	if len(req.Resources.Storage.ISCSI) > 0 {
		node.Labels["quantix.io/iscsi-storage"] = "true"
	}
	if len(req.Resources.GPUs) > 0 {
		node.Labels["quantix.io/gpu"] = "true"
	}

	// Save to repository
	ctx := r.Context()
	createdNode, err := h.server.nodeRepo.Create(ctx, node)
	if err != nil {
		h.logger.Error("Failed to create node", zap.Error(err))
		h.writeError(w, "Failed to register host: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.logger.Info("Host registered successfully",
		zap.String("node_id", createdNode.ID),
		zap.String("hostname", createdNode.Hostname),
		zap.String("cluster_id", createdNode.ClusterID),
	)

	// Establish gRPC connection to the node daemon for storage/VM operations
	if h.server.daemonPool != nil {
		// ManagementIP should include port (e.g., "192.168.0.191:9090")
		// If no port, default to 9090 (gRPC port)
		daemonAddr := createdNode.ManagementIP
		if !strings.Contains(daemonAddr, ":") {
			daemonAddr = daemonAddr + ":9090"
		}

		_, connectErr := h.server.daemonPool.Connect(createdNode.ID, daemonAddr)
		if connectErr != nil {
			// Log warning but don't fail registration - connection can be established later
			h.logger.Warn("Failed to establish gRPC connection to node daemon",
				zap.String("node_id", createdNode.ID),
				zap.String("daemon_addr", daemonAddr),
				zap.Error(connectErr),
			)
		} else {
			h.logger.Info("Established gRPC connection to node daemon",
				zap.String("node_id", createdNode.ID),
				zap.String("daemon_addr", daemonAddr),
			)
		}
	}

	h.writeJSON(w, createdNode, http.StatusCreated)
}

// writeJSON writes a JSON response.
func (h *HostRegistrationHandler) writeJSON(w http.ResponseWriter, data interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to encode response", zap.Error(err))
	}
}

// writeError writes an error response.
func (h *HostRegistrationHandler) writeError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
