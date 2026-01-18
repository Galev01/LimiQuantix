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

// StoragePoolRepository is the interface for storage pool persistence.
type StoragePoolRepository interface {
	Get(ctx context.Context, id string) (*domain.StoragePool, error)
	GetByName(ctx context.Context, projectID, name string) (*domain.StoragePool, error)
	Update(ctx context.Context, pool *domain.StoragePool) (*domain.StoragePool, error)
	UpdateStatus(ctx context.Context, id string, status domain.StoragePoolStatus) error
	ListAssignedToNode(ctx context.Context, nodeID string) ([]*domain.StoragePool, error)
}

// Service implements the NodeService Connect-RPC handler.
// It manages hypervisor node registration, health monitoring, and lifecycle.
type Service struct {
	computev1connect.UnimplementedNodeServiceHandler

	repo            Repository
	vmRepo          VMRepository
	storagePoolRepo StoragePoolRepository
	daemonPool      *DaemonPool
	logger          *zap.Logger
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

// NewServiceWithDaemonPool creates a new Node service with DaemonPool for gRPC connections.
func NewServiceWithDaemonPool(repo Repository, daemonPool *DaemonPool, logger *zap.Logger) *Service {
	return &Service{
		repo:       repo,
		daemonPool: daemonPool,
		logger:     logger.Named("node-service"),
	}
}

// NewServiceFull creates a Node service with all dependencies.
func NewServiceFull(
	repo Repository,
	vmRepo VMRepository,
	storagePoolRepo StoragePoolRepository,
	daemonPool *DaemonPool,
	logger *zap.Logger,
) *Service {
	return &Service{
		repo:            repo,
		vmRepo:          vmRepo,
		storagePoolRepo: storagePoolRepo,
		daemonPool:      daemonPool,
		logger:          logger.Named("node-service"),
	}
}

// SetDaemonPool sets the daemon pool for gRPC connections (used for late binding).
func (s *Service) SetDaemonPool(pool *DaemonPool) {
	s.daemonPool = pool
}

// SetStoragePoolRepo sets the storage pool repository (used for late binding).
func (s *Service) SetStoragePoolRepo(repo StoragePoolRepository) {
	s.storagePoolRepo = repo
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

	// Establish gRPC connection to the node daemon for storage/VM operations
	if s.daemonPool != nil {
		// ManagementIP should include port (e.g., "192.168.0.53:9090")
		daemonAddr := created.ManagementIP
		// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
		if idx := strings.Index(daemonAddr, "/"); idx != -1 {
			daemonAddr = daemonAddr[:idx]
		}
		if !strings.Contains(daemonAddr, ":") {
			daemonAddr = daemonAddr + ":9090"
		}

		_, connectErr := s.daemonPool.Connect(created.ID, daemonAddr)
		if connectErr != nil {
			// Log warning but don't fail registration - connection can be established later
			logger.Warn("Failed to establish gRPC connection to node daemon",
				zap.String("node_id", created.ID),
				zap.String("daemon_addr", daemonAddr),
				zap.Error(connectErr),
			)
		} else {
			logger.Info("Established gRPC connection to node daemon",
				zap.String("node_id", created.ID),
				zap.String("daemon_addr", daemonAddr),
			)
		}
	}

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

		// Establish gRPC connection on reconnection
		if s.daemonPool != nil {
			daemonAddr := node.ManagementIP
			// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
			if idx := strings.Index(daemonAddr, "/"); idx != -1 {
				daemonAddr = daemonAddr[:idx]
			}
			if !strings.Contains(daemonAddr, ":") {
				daemonAddr = daemonAddr + ":9090"
			}
			_, connectErr := s.daemonPool.Connect(node.ID, daemonAddr)
			if connectErr != nil {
				logger.Warn("Failed to establish gRPC connection on reconnection",
					zap.String("daemon_addr", daemonAddr),
					zap.Error(connectErr),
				)
			} else {
				logger.Info("Established gRPC connection to node daemon on reconnection",
					zap.String("daemon_addr", daemonAddr),
				)
			}
		}
	}

	// Ensure daemon pool connection exists for ready nodes (lazy connection)
	if s.daemonPool != nil && s.daemonPool.Get(node.ID) == nil {
		daemonAddr := node.ManagementIP
		// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
		if idx := strings.Index(daemonAddr, "/"); idx != -1 {
			daemonAddr = daemonAddr[:idx]
		}
		if !strings.Contains(daemonAddr, ":") {
			daemonAddr = daemonAddr + ":9090"
		}
		_, connectErr := s.daemonPool.Connect(node.ID, daemonAddr)
		if connectErr != nil {
			logger.Debug("Failed to establish lazy gRPC connection",
				zap.String("daemon_addr", daemonAddr),
				zap.Error(connectErr),
			)
		} else {
			logger.Info("Established lazy gRPC connection to node daemon",
				zap.String("daemon_addr", daemonAddr),
			)
		}
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

	// Process storage pool status reports (host is source of truth)
	var assignedPoolIDs []string
	if s.storagePoolRepo != nil && len(req.Msg.StoragePools) > 0 {
		logger.Debug("Processing storage pool status reports",
			zap.Int("pool_count", len(req.Msg.StoragePools)),
		)

		for _, poolReport := range req.Msg.StoragePools {
			if poolReport.PoolId == "" {
				continue
			}

			// Try to get pool by ID first (UUID), then by name (for auto-discovered pools)
			pool, err := s.storagePoolRepo.Get(ctx, poolReport.PoolId)
			if err != nil {
				// Node daemon may report pools using generated names (e.g., "local-srv-nfs-qVDS01")
				// instead of UUIDs. Try to look up by name as a fallback.
				pool, err = s.storagePoolRepo.GetByName(ctx, "", poolReport.PoolId)
				if err != nil {
					// This is expected for auto-discovered pools not yet registered in control plane
					logger.Debug("Storage pool not found in control plane (may be auto-discovered)",
						zap.String("pool_id", poolReport.PoolId),
					)
					continue
				}
			}

			// Convert proto health to domain health
			health := domain.PoolHostHealthUnknown
			switch poolReport.Health {
			case computev1.StoragePoolStatusReport_HEALTH_HEALTHY:
				health = domain.PoolHostHealthHealthy
			case computev1.StoragePoolStatusReport_HEALTH_DEGRADED:
				health = domain.PoolHostHealthDegraded
			case computev1.StoragePoolStatusReport_HEALTH_ERROR:
				health = domain.PoolHostHealthError
			case computev1.StoragePoolStatusReport_HEALTH_UNMOUNTED:
				health = domain.PoolHostHealthUnmounted
			}

			// Update host status (host is source of truth)
			hostStatus := domain.PoolHostStatus{
				NodeID:       node.ID,
				Health:       health,
				MountPath:    poolReport.MountPath,
				TotalBytes:   poolReport.TotalBytes,
				UsedBytes:    poolReport.UsedBytes,
				AvailBytes:   poolReport.AvailableBytes,
				VolumeCount:  poolReport.VolumeCount,
				ErrorMessage: poolReport.ErrorMessage,
			}
			pool.UpdateHostStatus(node.ID, hostStatus)

			// Recalculate aggregate status
			pool.Status.Capacity = pool.AggregateCapacity()
			pool.Status.Phase = pool.DetermineOverallPhase()

			// Persist the updated pool status
			if err := s.storagePoolRepo.UpdateStatus(ctx, pool.ID, pool.Status); err != nil {
				logger.Warn("Failed to persist pool status from heartbeat",
					zap.String("pool_id", pool.ID),
					zap.Error(err),
				)
			} else {
				logger.Debug("Updated pool status from host",
					zap.String("pool_id", pool.ID),
					zap.String("health", string(health)),
					zap.Uint64("total_bytes", poolReport.TotalBytes),
					zap.Uint64("used_bytes", poolReport.UsedBytes),
				)
			}
		}
	}

	// Get list of pools assigned to this node (for desired state response)
	if s.storagePoolRepo != nil {
		assignedPools, err := s.storagePoolRepo.ListAssignedToNode(ctx, node.ID)
		if err != nil {
			logger.Warn("Failed to get assigned pools for heartbeat response",
				zap.Error(err),
			)
		} else {
			for _, pool := range assignedPools {
				assignedPoolIDs = append(assignedPoolIDs, pool.ID)
			}
		}
	}

	// Check for state drift using state hash (anti-entropy)
	requestFullSync := false
	if req.Msg.StateHash != "" {
		// TODO: Calculate expected hash from DB and compare
		// For now, we trust the agent's state and don't request full sync
		// Full implementation would:
		// 1. List all VMs for this node from DB
		// 2. Calculate hash using same algorithm as agent
		// 3. Compare hashes
		logger.Debug("Received state hash from agent",
			zap.String("state_hash", req.Msg.StateHash),
		)
	}

	logger.Debug("Heartbeat received",
		zap.Float64("cpu_usage", req.Msg.CpuUsagePercent),
		zap.Uint64("memory_used_mib", req.Msg.MemoryUsedMib),
		zap.Int("storage_pool_reports", len(req.Msg.StoragePools)),
		zap.String("state_hash", req.Msg.StateHash),
	)

	return connect.NewResponse(&computev1.UpdateHeartbeatResponse{
		Acknowledged:          true,
		ServerTimeUnix:        now.Unix(),
		HeartbeatIntervalSecs: 30, // Standard interval
		AssignedPoolIds:       assignedPoolIDs,
		RequestFullSync:       requestFullSync,
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

// ============================================================================
// State Reconciliation Operations
// ============================================================================

// SyncFullState performs a complete state synchronization between the node and control plane.
// This is called by the Node Daemon on startup, reconnect, or when drift is detected.
// CRITICAL: This handler only updates STATUS fields, never overwrites Spec.
func (s *Service) SyncFullState(
	ctx context.Context,
	req *connect.Request[computev1.SyncFullStateRequest],
) (*connect.Response[computev1.SyncFullStateResponse], error) {
	logger := s.logger.With(
		zap.String("method", "SyncFullState"),
		zap.String("node_id", req.Msg.NodeId),
		zap.Int("vm_count", len(req.Msg.Vms)),
		zap.Int("pool_count", len(req.Msg.StoragePools)),
	)

	logger.Info("Full state sync request received")

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
		logger.Warn("VM repository not configured, cannot sync state")
		return connect.NewResponse(&computev1.SyncFullStateResponse{
			Acknowledged: true,
		}), nil
	}

	var vmsReconciled, vmsDiscovered, vmsLost int32
	var conflicts []*computev1.SyncConflict

	// Track which VMs were reported by the node
	reportedVMIDs := make(map[string]bool)

	// Process each VM status report
	for _, vmReport := range req.Msg.Vms {
		if vmReport.Id == "" {
			continue
		}
		reportedVMIDs[vmReport.Id] = true

		// Try to get existing VM from database
		existing, err := s.vmRepo.Get(ctx, vmReport.Id)
		existsInDB := err == nil && existing != nil

		if existsInDB {
			// VM exists in DB - update STATUS only (never Spec!)
			vmState := mapPowerStateFromProto(vmReport.State)
			
			// Only update if state changed
			if existing.Status.State != vmState || existing.Status.NodeID != node.ID {
				existing.Status.State = vmState
				existing.Status.NodeID = node.ID
				now := time.Now()
				existing.Status.LastSeen = &now
				existing.UpdatedAt = now
				
				// Use UpdateStatus to only touch status fields
				if _, err := s.vmRepo.Create(ctx, existing); err != nil {
					// If Create fails (duplicate), try to at least log it
					logger.Debug("VM status update (Create path failed, expected for existing)",
						zap.String("vm_id", vmReport.Id),
						zap.String("state", string(vmState)),
					)
				}
				vmsReconciled++
			}
		} else {
			// VM not in DB - this is a newly discovered VM
			logger.Info("Discovered new VM on node",
				zap.String("vm_id", vmReport.Id),
				zap.String("vm_name", vmReport.Name),
				zap.String("node_id", node.ID),
			)

			vmState := mapPowerStateFromProto(vmReport.State)
			now := time.Now()

			newVM := &domain.VirtualMachine{
				ID:        vmReport.Id,
				Name:      vmReport.Name,
				ProjectID: "discovered", // Special project for discovered VMs
				Labels: map[string]string{
					"discovered": "true",
					"source":     "node-sync",
				},
				Origin:    domain.VMOriginHostDiscovered,
				IsManaged: false, // User must "adopt" it
				Status: domain.VMStatus{
					State:    vmState,
					NodeID:   node.ID,
					LastSeen: &now,
				},
				CreatedAt: now,
				UpdatedAt: now,
				CreatedBy: "state-sync",
			}

			_, err = s.vmRepo.Create(ctx, newVM)
			if err != nil {
				logger.Error("Failed to create discovered VM",
					zap.String("vm_id", vmReport.Id),
					zap.Error(err),
				)
				conflicts = append(conflicts, &computev1.SyncConflict{
					ResourceType: "vm",
					ResourceId:   vmReport.Id,
					ConflictType: "create_failed",
					Message:      err.Error(),
				})
				continue
			}

			vmsDiscovered++
		}
	}

	// TODO: Detect VMs in DB assigned to this node but not reported (LOST detection)
	// This requires listing VMs by node_id which may need a repository method

	// Process storage pools (similar logic)
	var poolsReconciled int32
	if s.storagePoolRepo != nil {
		for _, poolReport := range req.Msg.StoragePools {
			if poolReport.PoolId == "" {
				continue
			}

			pool, err := s.storagePoolRepo.Get(ctx, poolReport.PoolId)
			if err != nil {
				// Pool not in DB - skip (auto-discovered pools are handled separately)
				continue
			}

			// Update pool status from host report
			health := domain.PoolHostHealthUnknown
			switch poolReport.Health {
			case computev1.StoragePoolStatusReport_HEALTH_HEALTHY:
				health = domain.PoolHostHealthHealthy
			case computev1.StoragePoolStatusReport_HEALTH_DEGRADED:
				health = domain.PoolHostHealthDegraded
			case computev1.StoragePoolStatusReport_HEALTH_ERROR:
				health = domain.PoolHostHealthError
			case computev1.StoragePoolStatusReport_HEALTH_UNMOUNTED:
				health = domain.PoolHostHealthUnmounted
			}

			hostStatus := domain.PoolHostStatus{
				NodeID:       node.ID,
				Health:       health,
				MountPath:    poolReport.MountPath,
				TotalBytes:   poolReport.TotalBytes,
				UsedBytes:    poolReport.UsedBytes,
				AvailBytes:   poolReport.AvailableBytes,
				VolumeCount:  poolReport.VolumeCount,
				ErrorMessage: poolReport.ErrorMessage,
			}
			pool.UpdateHostStatus(node.ID, hostStatus)
			pool.Status.Capacity = pool.AggregateCapacity()
			pool.Status.Phase = pool.DetermineOverallPhase()

			if err := s.storagePoolRepo.UpdateStatus(ctx, pool.ID, pool.Status); err != nil {
				logger.Warn("Failed to update pool status",
					zap.String("pool_id", pool.ID),
					zap.Error(err),
				)
			} else {
				poolsReconciled++
			}
		}
	}

	logger.Info("Full state sync completed",
		zap.Int32("vms_reconciled", vmsReconciled),
		zap.Int32("vms_discovered", vmsDiscovered),
		zap.Int32("vms_lost", vmsLost),
		zap.Int32("pools_reconciled", poolsReconciled),
	)

	return connect.NewResponse(&computev1.SyncFullStateResponse{
		Acknowledged:    true,
		VmsReconciled:   vmsReconciled,
		VmsDiscovered:   vmsDiscovered,
		VmsLost:         vmsLost,
		PoolsReconciled: poolsReconciled,
		Conflicts:       conflicts,
	}), nil
}

// NotifyVMChange handles real-time VM change notifications from nodes.
// CRITICAL: This handler protects against the "flicker" race condition by checking
// if the VM exists in the DB before deciding whether it's a "new discovery" or update.
func (s *Service) NotifyVMChange(
	ctx context.Context,
	req *connect.Request[computev1.VMChangeNotification],
) (*connect.Response[computev1.VMChangeAck], error) {
	logger := s.logger.With(
		zap.String("method", "NotifyVMChange"),
		zap.String("node_id", req.Msg.NodeId),
		zap.Int32("event_type", int32(req.Msg.EventType)),
	)

	if req.Msg.NodeId == "" || req.Msg.Vm == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node_id and vm are required"))
	}

	vmID := req.Msg.Vm.Id
	logger = logger.With(zap.String("vm_id", vmID))

	logger.Debug("VM change notification received")

	if s.vmRepo == nil {
		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "ignored",
			Error:        "VM repository not configured",
		}), nil
	}

	// Try to get existing VM from database
	existing, err := s.vmRepo.Get(ctx, vmID)
	existsInDB := err == nil && existing != nil

	switch req.Msg.EventType {
	case computev1.VMChangeEventType_VM_CHANGE_CREATED:
		if existsInDB {
			// VM already exists in DB - this is NOT a new discovery!
			// This happens when: CP creates VM -> Agent detects it -> sends notification
			// Only update STATUS fields, NEVER touch Origin, ProjectID, IsManaged, Name, Spec
			vmState := mapPowerStateFromProto(req.Msg.Vm.State)
			existing.Status.State = vmState
			existing.Status.NodeID = req.Msg.NodeId
			now := time.Now()
			existing.Status.LastSeen = &now
			existing.UpdatedAt = now
			
			// DO NOT TOUCH: Origin, ProjectID, IsManaged, Name, Spec
			
			logger.Debug("VM already exists, updating status only",
				zap.String("origin", string(existing.Origin)),
				zap.Bool("is_managed", existing.IsManaged),
			)
			
			return connect.NewResponse(&computev1.VMChangeAck{
				Acknowledged: true,
				Action:       "status_updated",
			}), nil
		}

		// Truly new VM discovered on host
		logger.Info("New VM discovered via change notification",
			zap.String("vm_name", req.Msg.Vm.Name),
		)

		vmState := mapPowerStateFromProto(req.Msg.Vm.State)
		now := time.Now()

		newVM := &domain.VirtualMachine{
			ID:        vmID,
			Name:      req.Msg.Vm.Name,
			ProjectID: "discovered",
			Labels: map[string]string{
				"discovered": "true",
				"source":     "vm-change-notification",
			},
			Origin:    domain.VMOriginHostDiscovered,
			IsManaged: false,
			Status: domain.VMStatus{
				State:    vmState,
				NodeID:   req.Msg.NodeId,
				LastSeen: &now,
			},
			CreatedAt: now,
			UpdatedAt: now,
			CreatedBy: "vm-change-notification",
		}

		_, err = s.vmRepo.Create(ctx, newVM)
		if err != nil {
			logger.Error("Failed to create discovered VM", zap.Error(err))
			return connect.NewResponse(&computev1.VMChangeAck{
				Acknowledged: true,
				Action:       "create_failed",
				Error:        err.Error(),
			}), nil
		}

		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "created",
		}), nil

	case computev1.VMChangeEventType_VM_CHANGE_UPDATED:
		if !existsInDB {
			// Unknown VM - treat as discovery (shouldn't happen normally)
			logger.Warn("Update notification for unknown VM, treating as discovery")
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VM '%s' not found", vmID))
		}

		// Update status only
		vmState := mapPowerStateFromProto(req.Msg.Vm.State)
		existing.Status.State = vmState
		existing.Status.NodeID = req.Msg.NodeId
		now := time.Now()
		existing.Status.LastSeen = &now
		existing.UpdatedAt = now

		logger.Debug("VM state updated",
			zap.String("state", string(vmState)),
		)

		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "updated",
		}), nil

	case computev1.VMChangeEventType_VM_CHANGE_DELETED:
		return s.handleVMDeleted(ctx, logger, req.Msg.NodeId, vmID, existing)

	default:
		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "ignored",
		}), nil
	}
}

// handleVMDeleted processes a VM deletion notification with proper handling based on Origin.
func (s *Service) handleVMDeleted(
	ctx context.Context,
	logger *zap.Logger,
	nodeID string,
	vmID string,
	existing *domain.VirtualMachine,
) (*connect.Response[computev1.VMChangeAck], error) {
	if existing == nil {
		// VM not in DB - nothing to do
		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "ignored",
		}), nil
	}

	now := time.Now()

	// Check if this VM was managed by control plane
	if existing.IsManaged && existing.Origin == domain.VMOriginControlPlane {
		// A managed VM was deleted outside of control plane!
		// This is an ERROR condition - user deleted via virsh/cockpit
		logger.Error("ALERT: Managed VM deleted outside control plane",
			zap.String("vm_id", vmID),
			zap.String("vm_name", existing.Name),
			zap.String("node_id", nodeID),
		)

		// Set state to LOST (not TERMINATED - we didn't do it)
		existing.Status.State = domain.VMStateLost
		existing.Status.NodeID = ""
		existing.Status.LostReason = "Deleted outside control plane"
		existing.Status.LostAt = &now
		existing.UpdatedAt = now

		// Keep the record for audit trail
		// In a real implementation, we'd call vmRepo.Update here

		// TODO: Emit alert/event for monitoring systems
		logger.Warn("SYSTEM_EVENT: VM unexpectedly deleted",
			zap.String("event_type", "VM_UNEXPECTEDLY_DELETED"),
			zap.String("vm_id", vmID),
			zap.String("vm_name", existing.Name),
		)

		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "marked_lost",
		}), nil

	} else if !existing.IsManaged {
		// Discovered/unmanaged VM was deleted - just clean up
		// Can hard delete since it was never "ours"
		logger.Info("Unmanaged VM deleted",
			zap.String("vm_id", vmID),
			zap.String("vm_name", existing.Name),
		)

		// In a real implementation, we'd call vmRepo.Delete here

		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "deleted",
		}), nil

	} else {
		// Imported VM - keep record but mark terminated
		existing.Status.State = domain.VMStateTerminated
		existing.Status.NodeID = ""
		existing.UpdatedAt = now

		logger.Info("Imported VM terminated",
			zap.String("vm_id", vmID),
			zap.String("vm_name", existing.Name),
		)

		return connect.NewResponse(&computev1.VMChangeAck{
			Acknowledged: true,
			Action:       "terminated",
		}), nil
	}
}

// NotifyStorageChange handles real-time storage change notifications from nodes.
func (s *Service) NotifyStorageChange(
	ctx context.Context,
	req *connect.Request[computev1.StorageChangeNotification],
) (*connect.Response[computev1.StorageChangeAck], error) {
	logger := s.logger.With(
		zap.String("method", "NotifyStorageChange"),
		zap.String("node_id", req.Msg.NodeId),
		zap.Int32("event_type", int32(req.Msg.EventType)),
	)

	if req.Msg.NodeId == "" || req.Msg.Pool == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node_id and pool are required"))
	}

	logger.Debug("Storage change notification received",
		zap.String("pool_id", req.Msg.Pool.PoolId),
	)

	// For now, just acknowledge - full implementation would update pool status
	return connect.NewResponse(&computev1.StorageChangeAck{
		Acknowledged: true,
		Action:       "acknowledged",
	}), nil
}

// mapPowerStateFromProto converts proto VMPowerState to domain VMState.
func mapPowerStateFromProto(state computev1.VMPowerState) domain.VMState {
	switch state {
	case computev1.VMPowerState_VM_POWER_STATE_RUNNING:
		return domain.VMStateRunning
	case computev1.VMPowerState_VM_POWER_STATE_STOPPED, computev1.VMPowerState_VM_POWER_STATE_SHUTOFF:
		return domain.VMStateStopped
	case computev1.VMPowerState_VM_POWER_STATE_PAUSED:
		return domain.VMStatePaused
	case computev1.VMPowerState_VM_POWER_STATE_SUSPENDED:
		return domain.VMStateSuspended
	case computev1.VMPowerState_VM_POWER_STATE_CRASHED:
		return domain.VMStateFailed
	case computev1.VMPowerState_VM_POWER_STATE_MIGRATING:
		return domain.VMStateMigrating
	default:
		return domain.VMStateStopped
	}
}
