// Package node provides the node (hypervisor host) service for the control plane.
// This service implements the NodeServiceHandler interface generated from the proto definitions.
package node

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1/computev1connect"
)

// Ensure Service implements NodeServiceHandler
var _ computev1connect.NodeServiceHandler = (*Service)(nil)

// VMRepository is the interface for VM persistence (used for sync).
type VMRepository interface {
	Get(ctx context.Context, id string) (*domain.VirtualMachine, error)
	Create(ctx context.Context, vm *domain.VirtualMachine) (*domain.VirtualMachine, error)
}

// Service implements the NodeService Connect-RPC handler.
// It manages hypervisor node registration, health monitoring, and lifecycle.
type Service struct {
	computev1connect.UnimplementedNodeServiceHandler

	repo   Repository
	vmRepo VMRepository
	logger *zap.Logger
}

// NewService creates a new Node service.
func NewService(repo Repository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		logger: logger.Named("node-service"),
	}
}

// NewServiceWithVMRepo creates a new Node service with VM repository for sync.
func NewServiceWithVMRepo(repo Repository, vmRepo VMRepository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		vmRepo: vmRepo,
		logger: logger.Named("node-service"),
	}
}

// ============================================================================
// Registration and CRUD Operations
// ============================================================================

// RegisterNode registers a new node with the control plane.
// This is called by the agent when it first connects.
func (s *Service) RegisterNode(
	ctx context.Context,
	req *connect.Request[computev1.RegisterNodeRequest],
) (*connect.Response[computev1.Node], error) {
	logger := s.logger.With(
		zap.String("method", "RegisterNode"),
		zap.String("hostname", req.Msg.Hostname),
		zap.String("management_ip", req.Msg.ManagementIp),
	)

	logger.Info("Node registration request")

	// Validate request
	if req.Msg.Hostname == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("hostname is required"))
	}
	if req.Msg.ManagementIp == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("management_ip is required"))
	}

	// Extract just the IP address (strip port if present)
	// The node daemon sends "192.168.0.53:9090" but PostgreSQL INET type only accepts IP
	managementIP := req.Msg.ManagementIp
	if idx := strings.LastIndex(managementIP, ":"); idx != -1 {
		// Check if this looks like an IPv6 address (contains multiple colons)
		if strings.Count(managementIP, ":") == 1 {
			// IPv4 with port - strip the port
			managementIP = managementIP[:idx]
		}
		// For IPv6, we'd need more complex parsing, but for now assume IPv4
	}
	logger.Debug("Parsed management IP", zap.String("original", req.Msg.ManagementIp), zap.String("parsed", managementIP))

	now := time.Now()

	// Build node spec from request
	spec := domain.NodeSpec{
		Scheduling: domain.SchedulingConfig{
			Schedulable: true,
		},
	}
	if req.Msg.Role != nil {
		spec.Role = domain.NodeRole{
			Compute:      req.Msg.Role.Compute,
			Storage:      req.Msg.Role.Storage,
			ControlPlane: req.Msg.Role.ControlPlane,
		}
	}

	// Populate CPU info from request
	if req.Msg.CpuInfo != nil {
		spec.CPU = domain.NodeCPUInfo{
			Model:          req.Msg.CpuInfo.Model,
			Sockets:        int32(req.Msg.CpuInfo.Sockets),
			CoresPerSocket: int32(req.Msg.CpuInfo.CoresPerSocket),
			ThreadsPerCore: int32(req.Msg.CpuInfo.ThreadsPerCore),
			FrequencyMHz:   int32(req.Msg.CpuInfo.FrequencyMhz),
			Features:       req.Msg.CpuInfo.Features,
		}
		logger.Info("CPU info received",
			zap.String("model", spec.CPU.Model),
			zap.Int32("cores", spec.CPU.TotalCores()),
		)
	}

	// Populate memory info from request
	if req.Msg.MemoryInfo != nil {
		spec.Memory = domain.NodeMemoryInfo{
			TotalMiB:       int64(req.Msg.MemoryInfo.TotalBytes / 1024 / 1024),
			AllocatableMiB: int64(req.Msg.MemoryInfo.AllocatableBytes / 1024 / 1024),
		}
		logger.Info("Memory info received",
			zap.Int64("total_mib", spec.Memory.TotalMiB),
			zap.Int64("allocatable_mib", spec.Memory.AllocatableMiB),
		)
	}

	// Populate storage devices from request
	if len(req.Msg.StorageDevices) > 0 {
		spec.Storage = make([]domain.StorageDevice, 0, len(req.Msg.StorageDevices))
		for _, sd := range req.Msg.StorageDevices {
			deviceType := "HDD"
			switch sd.Type {
			case computev1.StorageDevice_SSD:
				deviceType = "SSD"
			case computev1.StorageDevice_NVME:
				deviceType = "NVMe"
			}
			spec.Storage = append(spec.Storage, domain.StorageDevice{
				Name:    sd.Model,
				Path:    sd.Path,
				Type:    deviceType,
				SizeGiB: int64(sd.SizeBytes / 1024 / 1024 / 1024),
			})
		}
		logger.Info("Storage devices received",
			zap.Int("count", len(spec.Storage)),
		)
	}

	// Populate network devices from request
	if len(req.Msg.NetworkDevices) > 0 {
		spec.Networks = make([]domain.NetworkAdapter, 0, len(req.Msg.NetworkDevices))
		for _, nd := range req.Msg.NetworkDevices {
			spec.Networks = append(spec.Networks, domain.NetworkAdapter{
				Name:         nd.Name,
				MACAddress:   nd.MacAddress,
				SpeedMbps:    int64(nd.SpeedMbps),
				MTU:          int32(nd.Mtu),
				SRIOVCapable: nd.SriovCapable,
			})
		}
		logger.Info("Network devices received",
			zap.Int("count", len(spec.Networks)),
		)
	}

	// Calculate allocatable resources for scheduling
	allocatable := domain.Resources{
		CPUCores:  spec.CPU.TotalCores(),
		MemoryMiB: spec.Memory.AllocatableMiB,
	}
	if allocatable.MemoryMiB == 0 {
		allocatable.MemoryMiB = spec.Memory.TotalMiB
	}

	// Check if node already exists (re-registration)
	// This is the normal case when a node daemon restarts - it should reconnect seamlessly
	existing, err := s.repo.GetByHostname(ctx, req.Msg.Hostname)
	if err != nil && !errors.Is(err, domain.ErrNotFound) {
		// Unexpected error reading from database
		logger.Error("Failed to check for existing node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check existing node: %w", err))
	}

	if existing != nil {
		// Node exists - update it with fresh info (re-registration after restart)
		existing.ManagementIP = managementIP
		if req.Msg.Labels != nil {
			existing.Labels = req.Msg.Labels
		}
		existing.Spec = spec
		existing.Status.Phase = domain.NodePhaseReady
		existing.Status.Allocatable = allocatable
		existing.LastHeartbeat = &now
		existing.UpdatedAt = now

		updated, err := s.repo.Update(ctx, existing)
		if err != nil {
			logger.Error("Failed to update existing node", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		logger.Info("Node re-registered (reconnected after restart)",
			zap.String("node_id", updated.ID),
			zap.String("hostname", updated.Hostname),
			zap.Int32("cpu_cores", spec.CPU.TotalCores()),
			zap.Int64("memory_mib", spec.Memory.TotalMiB),
		)

		return connect.NewResponse(ToProto(updated)), nil
	}

	// Create new node (first time registration)
	node := &domain.Node{
		Hostname:     req.Msg.Hostname,
		ManagementIP: managementIP,
		Labels:       req.Msg.Labels,
		Spec:         spec,
		Status: domain.NodeStatus{
			Phase:       domain.NodePhaseReady,
			Allocatable: allocatable,
			Allocated:   domain.Resources{}, // Initially nothing allocated
		},
		CreatedAt:     now,
		UpdatedAt:     now,
		LastHeartbeat: &now,
	}

	created, err := s.repo.Create(ctx, node)
	if err != nil {
		// Handle race condition: another instance might have created the node
		if errors.Is(err, domain.ErrAlreadyExists) {
			// Try to fetch and update instead
			logger.Info("Node created by another process, attempting re-registration")
			existing, getErr := s.repo.GetByHostname(ctx, req.Msg.Hostname)
			if getErr == nil && existing != nil {
				existing.ManagementIP = managementIP
				existing.Spec = spec
				existing.Status.Phase = domain.NodePhaseReady
				existing.Status.Allocatable = allocatable
				existing.LastHeartbeat = &now
				existing.UpdatedAt = now

				updated, updateErr := s.repo.Update(ctx, existing)
				if updateErr == nil {
					logger.Info("Node re-registered after race condition",
						zap.String("node_id", updated.ID),
					)
					return connect.NewResponse(ToProto(updated)), nil
				}
			}
			return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("node with hostname '%s' already exists", req.Msg.Hostname))
		}
		logger.Error("Failed to create node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Node registered successfully (first time)",
		zap.String("node_id", created.ID),
		zap.String("hostname", created.Hostname),
		zap.Int32("cpu_cores", spec.CPU.TotalCores()),
		zap.Int64("memory_mib", spec.Memory.TotalMiB),
	)

	return connect.NewResponse(ToProto(created)), nil
}

// GetNode retrieves a node by ID.
func (s *Service) GetNode(
	ctx context.Context,
	req *connect.Request[computev1.GetNodeRequest],
) (*connect.Response[computev1.Node], error) {
	logger := s.logger.With(
		zap.String("method", "GetNode"),
		zap.String("node_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			logger.Debug("Node not found")
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		logger.Error("Failed to get node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(ToProto(node)), nil
}

// ListNodes returns a list of all nodes.
func (s *Service) ListNodes(
	ctx context.Context,
	req *connect.Request[computev1.ListNodesRequest],
) (*connect.Response[computev1.ListNodesResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ListNodes"),
	)

	filter := NodeFilter{
		Labels: req.Msg.Labels,
	}

	// Convert phases
	for _, p := range req.Msg.Phases {
		filter.Phases = append(filter.Phases, convertPhaseFromProto(p))
	}

	nodes, err := s.repo.List(ctx, filter)
	if err != nil {
		logger.Error("Failed to list nodes", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &computev1.ListNodesResponse{
		TotalCount: int32(len(nodes)),
	}

	for _, node := range nodes {
		resp.Nodes = append(resp.Nodes, ToProto(node))
	}

	logger.Debug("Listed nodes", zap.Int("count", len(nodes)))

	return connect.NewResponse(resp), nil
}

// UpdateNode updates a node's labels or spec.
func (s *Service) UpdateNode(
	ctx context.Context,
	req *connect.Request[computev1.UpdateNodeRequest],
) (*connect.Response[computev1.Node], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateNode"),
		zap.String("node_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Apply updates
	if req.Msg.Role != nil {
		node.Spec.Role = domain.NodeRole{
			Compute:      req.Msg.Role.Compute,
			Storage:      req.Msg.Role.Storage,
			ControlPlane: req.Msg.Role.ControlPlane,
		}
	}
	if req.Msg.Scheduling != nil {
		node.Spec.Scheduling = domain.SchedulingConfig{
			Schedulable: req.Msg.Scheduling.Schedulable,
		}
	}
	node.UpdatedAt = time.Now()

	updated, err := s.repo.Update(ctx, node)
	if err != nil {
		logger.Error("Failed to update node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Node updated successfully")

	return connect.NewResponse(ToProto(updated)), nil
}

// DecommissionNode removes a node from the cluster.
func (s *Service) DecommissionNode(
	ctx context.Context,
	req *connect.Request[computev1.DecommissionNodeRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DecommissionNode"),
		zap.String("node_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	// Check if node exists
	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if node has running VMs (unless force is set)
	if len(node.Status.VMIDs) > 0 && !req.Msg.Force {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("node has %d running VMs; drain first or use force=true", len(node.Status.VMIDs)))
	}

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Node decommissioned successfully")

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ============================================================================
// Node State Management
// ============================================================================

// EnableNode marks a node as schedulable.
func (s *Service) EnableNode(
	ctx context.Context,
	req *connect.Request[computev1.EnableNodeRequest],
) (*connect.Response[computev1.Node], error) {
	logger := s.logger.With(
		zap.String("method", "EnableNode"),
		zap.String("node_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	node.Status.Phase = domain.NodePhaseReady
	node.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, node.ID, node.Status); err != nil {
		logger.Error("Failed to update node status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, _ := s.repo.Get(ctx, req.Msg.Id)
	logger.Info("Node enabled")

	return connect.NewResponse(ToProto(updated)), nil
}

// DisableNode marks a node as not schedulable (cordon).
func (s *Service) DisableNode(
	ctx context.Context,
	req *connect.Request[computev1.DisableNodeRequest],
) (*connect.Response[computev1.Node], error) {
	logger := s.logger.With(
		zap.String("method", "DisableNode"),
		zap.String("node_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	node.Status.Phase = domain.NodePhaseMaintenance
	node.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, node.ID, node.Status); err != nil {
		logger.Error("Failed to update node status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, _ := s.repo.Get(ctx, req.Msg.Id)
	logger.Info("Node disabled (maintenance mode)")

	return connect.NewResponse(ToProto(updated)), nil
}

// DrainNode migrates all VMs off the node.
func (s *Service) DrainNode(
	ctx context.Context,
	req *connect.Request[computev1.DrainNodeRequest],
) (*connect.Response[computev1.DrainNodeResponse], error) {
	logger := s.logger.With(
		zap.String("method", "DrainNode"),
		zap.String("node_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Set node to draining state
	node.Status.Phase = domain.NodePhaseDraining
	node.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, node.ID, node.Status); err != nil {
		logger.Error("Failed to update node status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// In real implementation, we would:
	// 1. Get all VMs on this node
	// 2. Trigger live migration for each to other nodes
	// 3. Wait for migrations to complete
	// For now, we just return the list of VMs that would need migration

	logger.Info("Node drain initiated",
		zap.Int("vm_count", len(node.Status.VMIDs)),
	)

	return connect.NewResponse(&computev1.DrainNodeResponse{
		Node:          ToProto(node),
		MigratedVmIds: node.Status.VMIDs,
	}), nil
}

// ============================================================================
// Heartbeat
// ============================================================================

// UpdateHeartbeat updates the node's last seen time and resource usage.
// Called periodically by the Node Daemon.
func (s *Service) UpdateHeartbeat(
	ctx context.Context,
	req *connect.Request[computev1.UpdateHeartbeatRequest],
) (*connect.Response[computev1.UpdateHeartbeatResponse], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateHeartbeat"),
		zap.String("node_id", req.Msg.NodeId),
	)

	if req.Msg.NodeId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node_id is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.NodeId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			// Try to find by hostname as fallback
			logger.Debug("Node not found by ID, heartbeat rejected")
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.NodeId))
		}
		logger.Error("Failed to get node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if node was disconnected and is now reconnecting
	wasDisconnected := node.Status.Phase == domain.NodePhaseDisconnected
	if wasDisconnected {
		logger.Info("Disconnected node is reconnecting",
			zap.String("hostname", node.Hostname),
			zap.String("cluster_id", node.ClusterID),
		)

		// Add reconnection condition
		node.Status.Conditions = append(node.Status.Conditions, domain.NodeCondition{
			Type:       "Reconnected",
			Status:     "True",
			Reason:     "HeartbeatRestored",
			Message:    "Node reconnected to control plane",
			LastUpdate: time.Now(),
		})

		// Log reconnection event
		s.logger.Info("SYSTEM_EVENT: Host reconnected to cluster",
			zap.String("event_type", "HOST_RECONNECTED"),
			zap.String("node_id", node.ID),
			zap.String("hostname", node.Hostname),
			zap.String("cluster_id", node.ClusterID),
		)
	}

	// Update node status with heartbeat data
	now := time.Now()
	node.LastHeartbeat = &now
	node.Status.Phase = domain.NodePhaseReady

	// Update resource allocation info from heartbeat
	node.Status.Allocated.MemoryMiB = int64(req.Msg.MemoryUsedMib)
	if req.Msg.RunningVmCount > 0 {
		// Update VM count (this is informational)
		logger.Debug("Heartbeat contains VM count",
			zap.Uint32("running_vms", req.Msg.RunningVmCount),
		)
	}

	// Persist heartbeat update
	if err := s.repo.UpdateHeartbeat(ctx, node.ID, domain.Resources{
		CPUCores:  node.Status.Allocated.CPUCores,
		MemoryMiB: int64(req.Msg.MemoryUsedMib),
	}); err != nil {
		logger.Warn("Failed to persist heartbeat", zap.Error(err))
		// Don't fail the request, just log it
	}

	logger.Debug("Heartbeat received",
		zap.Float64("cpu_usage", req.Msg.CpuUsagePercent),
		zap.Uint64("memory_used_mib", req.Msg.MemoryUsedMib),
	)

	return connect.NewResponse(&computev1.UpdateHeartbeatResponse{
		Acknowledged:          true,
		ServerTimeUnix:        now.Unix(),
		HeartbeatIntervalSecs: 30, // Standard interval
	}), nil
}

// ============================================================================
// Metrics and Monitoring
// ============================================================================

// GetNodeMetrics returns current metrics for a node.
func (s *Service) GetNodeMetrics(
	ctx context.Context,
	req *connect.Request[computev1.GetNodeMetricsRequest],
) (*connect.Response[computev1.NodeMetrics], error) {
	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node ID is required"))
	}

	node, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Calculate usage percentages
	cpuUsage := float64(0)
	if node.Status.Allocatable.CPUCores > 0 {
		cpuUsage = float64(node.Status.Allocated.CPUCores) / float64(node.Status.Allocatable.CPUCores) * 100
	}

	return connect.NewResponse(&computev1.NodeMetrics{
		NodeId:               node.ID,
		CpuUsagePercent:      cpuUsage,
		CpuCoresTotal:        uint32(node.Status.Allocatable.CPUCores),
		CpuCoresAllocated:    uint32(node.Status.Allocated.CPUCores),
		MemoryTotalBytes:     uint64(node.Status.Allocatable.MemoryMiB) * 1024 * 1024,
		MemoryAllocatedBytes: uint64(node.Status.Allocated.MemoryMiB) * 1024 * 1024,
	}), nil
}

// ============================================================================
// Heartbeat Monitoring
// ============================================================================

// HeartbeatTimeout is the duration after which a node is considered disconnected.
const HeartbeatTimeout = 90 * time.Second // 3 missed heartbeats (30s interval)

// StartHeartbeatMonitor starts a background goroutine that monitors node heartbeats
// and marks nodes as DISCONNECTED if they haven't sent a heartbeat recently.
// This should be called once when the server starts.
func (s *Service) StartHeartbeatMonitor(ctx context.Context) {
	s.logger.Info("Starting heartbeat monitor",
		zap.Duration("timeout", HeartbeatTimeout),
		zap.Duration("check_interval", 30*time.Second),
	)

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				s.logger.Info("Heartbeat monitor stopped")
				return
			case <-ticker.C:
				s.checkStaleNodes(ctx)
			}
		}
	}()
}

// checkStaleNodes checks for nodes that have missed heartbeats and marks them as disconnected.
func (s *Service) checkStaleNodes(ctx context.Context) {
	nodes, err := s.repo.List(ctx, NodeFilter{})
	if err != nil {
		s.logger.Error("Failed to list nodes for heartbeat check", zap.Error(err))
		return
	}

	now := time.Now()
	for _, node := range nodes {
		// Skip nodes that are already in a terminal/non-active state
		if node.Status.Phase == domain.NodePhaseMaintenance ||
			node.Status.Phase == domain.NodePhaseDraining ||
			node.Status.Phase == domain.NodePhaseDisconnected {
			continue
		}

		// Check if heartbeat is stale
		if node.LastHeartbeat == nil {
			// Node never sent a heartbeat - if it's been pending for too long, mark as disconnected
			if node.Status.Phase == domain.NodePhasePending && time.Since(node.CreatedAt) > HeartbeatTimeout {
				s.markNodeDisconnected(ctx, node, "Node never established connection")
			}
			continue
		}

		timeSinceHeartbeat := now.Sub(*node.LastHeartbeat)
		if timeSinceHeartbeat > HeartbeatTimeout {
			s.markNodeDisconnected(ctx, node, fmt.Sprintf("No heartbeat for %s", timeSinceHeartbeat.Round(time.Second)))
		}
	}
}

// markNodeDisconnected marks a node as disconnected and logs the event.
func (s *Service) markNodeDisconnected(ctx context.Context, node *domain.Node, reason string) {
	logger := s.logger.With(
		zap.String("node_id", node.ID),
		zap.String("hostname", node.Hostname),
		zap.String("cluster_id", node.ClusterID),
		zap.String("previous_phase", string(node.Status.Phase)),
	)

	logger.Warn("Node disconnected - marking as DISCONNECTED",
		zap.String("reason", reason),
	)

	// Update node status
	node.Status.Phase = domain.NodePhaseDisconnected
	node.Status.Conditions = append(node.Status.Conditions, domain.NodeCondition{
		Type:       "Disconnected",
		Status:     "True",
		Reason:     "HeartbeatTimeout",
		Message:    reason,
		LastUpdate: time.Now(),
	})
	node.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, node.ID, node.Status); err != nil {
		logger.Error("Failed to update node status to disconnected", zap.Error(err))
		return
	}

	// Log to system logs (this will be visible in the cluster events)
	logger.Error("SYSTEM_EVENT: Host disconnected from cluster",
		zap.String("event_type", "HOST_DISCONNECTED"),
		zap.String("node_id", node.ID),
		zap.String("hostname", node.Hostname),
		zap.String("management_ip", node.ManagementIP),
		zap.String("cluster_id", node.ClusterID),
		zap.String("reason", reason),
		zap.Int("running_vms", len(node.Status.VMIDs)),
		zap.Strings("affected_vm_ids", node.Status.VMIDs),
	)
}

// ReconnectNode is called when a previously disconnected node sends a heartbeat.
// It transitions the node back to READY state.
func (s *Service) ReconnectNode(ctx context.Context, nodeID string) error {
	node, err := s.repo.Get(ctx, nodeID)
	if err != nil {
		return err
	}

	if node.Status.Phase != domain.NodePhaseDisconnected {
		return nil // Not disconnected, nothing to do
	}

	s.logger.Info("Node reconnected after disconnect",
		zap.String("node_id", node.ID),
		zap.String("hostname", node.Hostname),
		zap.String("cluster_id", node.ClusterID),
	)

	// Update status back to ready
	node.Status.Phase = domain.NodePhaseReady
	node.Status.Conditions = append(node.Status.Conditions, domain.NodeCondition{
		Type:       "Reconnected",
		Status:     "True",
		Reason:     "HeartbeatRestored",
		Message:    "Node reconnected to control plane",
		LastUpdate: time.Now(),
	})

	now := time.Now()
	node.LastHeartbeat = &now
	node.UpdatedAt = now

	if err := s.repo.UpdateStatus(ctx, node.ID, node.Status); err != nil {
		return fmt.Errorf("failed to update node status: %w", err)
	}

	// Log reconnection event
	s.logger.Info("SYSTEM_EVENT: Host reconnected to cluster",
		zap.String("event_type", "HOST_RECONNECTED"),
		zap.String("node_id", node.ID),
		zap.String("hostname", node.Hostname),
		zap.String("cluster_id", node.ClusterID),
	)

	return nil
}

// ============================================================================
// VM Sync Operations
// ============================================================================

// SyncNodeVMs reconciles VMs reported by a node with the control plane.
// This is called by the node daemon after registration to import existing VMs.
func (s *Service) SyncNodeVMs(
	ctx context.Context,
	req *connect.Request[computev1.SyncNodeVMsRequest],
) (*connect.Response[computev1.SyncNodeVMsResponse], error) {
	logger := s.logger.With(
		zap.String("method", "SyncNodeVMs"),
		zap.String("node_id", req.Msg.NodeId),
		zap.Int("vm_count", len(req.Msg.Vms)),
	)

	logger.Info("Syncing VMs from node")

	if req.Msg.NodeId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node_id is required"))
	}

	// Verify node exists
	node, err := s.repo.Get(ctx, req.Msg.NodeId)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node '%s' not found", req.Msg.NodeId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if s.vmRepo == nil {
		logger.Warn("VM repository not configured, cannot sync VMs")
		return connect.NewResponse(&computev1.SyncNodeVMsResponse{
			ImportedCount: 0,
			ExistingCount: 0,
			Errors:        []string{"VM repository not configured"},
		}), nil
	}

	var importedCount int32
	var existingCount int32
	var syncErrors []string

	for _, vmInfo := range req.Msg.Vms {
		// Check if VM already exists in the control plane
		existingVM, err := s.vmRepo.Get(ctx, vmInfo.Id)
		if err == nil && existingVM != nil {
			// VM already exists - update its node assignment if needed
			logger.Debug("VM already exists in control plane",
				zap.String("vm_id", vmInfo.Id),
				zap.String("vm_name", vmInfo.Name),
			)
			existingCount++
			continue
		}

		// Import the VM
		logger.Info("Importing VM from node",
			zap.String("vm_id", vmInfo.Id),
			zap.String("vm_name", vmInfo.Name),
			zap.String("state", vmInfo.State),
		)

		// Convert state string to domain state (handle various case formats)
		vmState := domain.VMStateStopped
		stateLower := strings.ToLower(vmInfo.State)
		switch stateLower {
		case "running":
			vmState = domain.VMStateRunning
		case "paused":
			vmState = domain.VMStatePaused
		case "stopped", "shutoff":
			vmState = domain.VMStateStopped
		case "suspended":
			vmState = domain.VMStateSuspended
		case "crashed":
			vmState = domain.VMStateFailed
		}

		newVM := &domain.VirtualMachine{
			ID:        vmInfo.Id,
			Name:      vmInfo.Name,
			ProjectID: "default",
			Labels: map[string]string{
				"imported": "true",
				"source":   "node-sync",
			},
			Spec: domain.VMSpec{
				CPU: domain.CPUConfig{
					Cores: int32(vmInfo.CpuCores),
				},
				Memory: domain.MemoryConfig{
					SizeMiB: int64(vmInfo.MemoryMib),
				},
			},
			Status: domain.VMStatus{
				State:  vmState,
				NodeID: node.ID,
			},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
			CreatedBy: "node-sync",
		}

		_, err = s.vmRepo.Create(ctx, newVM)
		if err != nil {
			logger.Error("Failed to import VM",
				zap.String("vm_id", vmInfo.Id),
				zap.Error(err),
			)
			syncErrors = append(syncErrors, fmt.Sprintf("failed to import VM %s: %v", vmInfo.Id, err))
			continue
		}

		logger.Info("VM imported successfully",
			zap.String("vm_id", vmInfo.Id),
			zap.String("vm_name", vmInfo.Name),
		)
		importedCount++
	}

	logger.Info("VM sync completed",
		zap.Int32("imported", importedCount),
		zap.Int32("existing", existingCount),
		zap.Int("errors", len(syncErrors)),
	)

	return connect.NewResponse(&computev1.SyncNodeVMsResponse{
		ImportedCount: importedCount,
		ExistingCount: existingCount,
		Errors:        syncErrors,
	}), nil
}
