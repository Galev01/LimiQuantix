// Package server provides HTTP handlers for host registration.
package server

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// handleDiscoverHost handles POST /api/nodes/discover
// This endpoint connects to a remote host and validates its token, returning discovered resources.
func (h *HostRegistrationHandler) handleDiscoverHost(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HostDiscoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.HostURL == "" || req.RegistrationToken == "" {
		h.writeError(w, "Host URL and registration token are required", http.StatusBadRequest)
		return
	}

	h.logger.Info("Host discovery request",
		zap.String("host_url", req.HostURL),
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

	// Validate token with the host
	tokenURL := fmt.Sprintf("%s/api/v1/registration/token", req.HostURL)
	tokenReq, err := http.NewRequest(http.MethodGet, tokenURL, nil)
	if err != nil {
		h.writeError(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	tokenReq.Header.Set("Authorization", "Bearer "+req.RegistrationToken)

	tokenResp, err := client.Do(tokenReq)
	if err != nil {
		h.logger.Error("Failed to connect to host", zap.Error(err))
		h.writeError(w, "Failed to connect to host: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer tokenResp.Body.Close()

	if tokenResp.StatusCode != http.StatusOK {
		h.writeError(w, "Invalid or expired registration token", http.StatusUnauthorized)
		return
	}

	// Token valid, now get discovery data
	discoveryURL := fmt.Sprintf("%s/api/v1/registration/discovery", req.HostURL)
	discoveryReq, err := http.NewRequest(http.MethodGet, discoveryURL, nil)
	if err != nil {
		h.writeError(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	discoveryReq.Header.Set("Authorization", "Bearer "+req.RegistrationToken)

	discoveryResp, err := client.Do(discoveryReq)
	if err != nil {
		h.logger.Error("Failed to fetch host resources", zap.Error(err))
		h.writeError(w, "Failed to fetch host resources: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer discoveryResp.Body.Close()

	if discoveryResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(discoveryResp.Body)
		h.writeError(w, "Failed to get host resources: "+string(body), http.StatusBadGateway)
		return
	}

	// Parse discovery response and return
	var discovery HostDiscoveryResponse
	bodyBytes, err := io.ReadAll(discoveryResp.Body)
	if err != nil {
		h.logger.Error("Failed to read discovery response body", zap.Error(err))
		h.writeError(w, "Failed to read host resources", http.StatusInternalServerError)
		return
	}

	h.logger.Debug("Discovery response received",
		zap.String("body", string(bodyBytes)),
	)

	if err := json.Unmarshal(bodyBytes, &discovery); err != nil {
		h.logger.Error("Failed to parse discovery response",
			zap.Error(err),
			zap.String("body", string(bodyBytes)),
		)
		h.writeError(w, "Failed to parse host resources: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.logger.Info("Host discovery successful",
		zap.String("hostname", discovery.Hostname),
		zap.String("ip", discovery.ManagementIP),
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
