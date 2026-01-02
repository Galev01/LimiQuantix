// Package node provides the node (hypervisor host) service for the control plane.
// This service implements the NodeServiceHandler interface generated from the proto definitions.
package node

import (
	"context"
	"errors"
	"fmt"
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

// Service implements the NodeService Connect-RPC handler.
// It manages hypervisor node registration, health monitoring, and lifecycle.
type Service struct {
	computev1connect.UnimplementedNodeServiceHandler

	repo   Repository
	logger *zap.Logger
}

// NewService creates a new Node service.
func NewService(repo Repository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
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

	now := time.Now()

	// Check if node already exists (re-registration)
	existing, err := s.repo.GetByHostname(ctx, req.Msg.Hostname)
	if err == nil && existing != nil {
		// Update existing node
		existing.ManagementIP = req.Msg.ManagementIp
		existing.Labels = req.Msg.Labels
		if req.Msg.Role != nil {
			existing.Spec.Role = domain.NodeRole{
				Compute:      req.Msg.Role.Compute,
				Storage:      req.Msg.Role.Storage,
				ControlPlane: req.Msg.Role.ControlPlane,
			}
		}
		existing.Status.Phase = domain.NodePhaseReady
		existing.LastHeartbeat = &now

		updated, err := s.repo.Update(ctx, existing)
		if err != nil {
			logger.Error("Failed to update existing node", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		logger.Info("Node re-registered",
			zap.String("node_id", updated.ID),
		)

		return connect.NewResponse(ToProto(updated)), nil
	}

	// Build node spec from request
	spec := domain.NodeSpec{}
	if req.Msg.Role != nil {
		spec.Role = domain.NodeRole{
			Compute:      req.Msg.Role.Compute,
			Storage:      req.Msg.Role.Storage,
			ControlPlane: req.Msg.Role.ControlPlane,
		}
	}

	// Create new node
	node := &domain.Node{
		Hostname:     req.Msg.Hostname,
		ManagementIP: req.Msg.ManagementIp,
		Labels:       req.Msg.Labels,
		Spec:         spec,
		Status: domain.NodeStatus{
			Phase: domain.NodePhaseReady,
		},
		CreatedAt:     now,
		UpdatedAt:     now,
		LastHeartbeat: &now,
	}

	created, err := s.repo.Create(ctx, node)
	if err != nil {
		if errors.Is(err, domain.ErrAlreadyExists) {
			return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("node with hostname '%s' already exists", req.Msg.Hostname))
		}
		logger.Error("Failed to create node", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Node registered successfully",
		zap.String("node_id", created.ID),
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
