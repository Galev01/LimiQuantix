// Package network implements the LoadBalancerService.
package network

import (
	"context"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// LoadBalancerService implements the networkv1connect.LoadBalancerServiceHandler interface.
// It provides L4 load balancing via OVN's built-in load balancer support.
type LoadBalancerService struct {
	repo      LoadBalancerRepository
	ovnClient *ovn.NorthboundClient
	logger    *zap.Logger
}

// LoadBalancerRepository defines the interface for load balancer storage.
type LoadBalancerRepository interface {
	Create(ctx context.Context, lb *domain.LoadBalancer) (*domain.LoadBalancer, error)
	Get(ctx context.Context, id string) (*domain.LoadBalancer, error)
	List(ctx context.Context, projectID string, limit, offset int) ([]*domain.LoadBalancer, int, error)
	Update(ctx context.Context, lb *domain.LoadBalancer) (*domain.LoadBalancer, error)
	Delete(ctx context.Context, id string) error
}

// NewLoadBalancerService creates a new LoadBalancerService.
func NewLoadBalancerService(repo LoadBalancerRepository, logger *zap.Logger) *LoadBalancerService {
	return &LoadBalancerService{
		repo:   repo,
		logger: logger,
	}
}

// NewLoadBalancerServiceWithOVN creates a new LoadBalancerService with OVN backend.
func NewLoadBalancerServiceWithOVN(repo LoadBalancerRepository, ovnClient *ovn.NorthboundClient, logger *zap.Logger) *LoadBalancerService {
	return &LoadBalancerService{
		repo:      repo,
		ovnClient: ovnClient,
		logger:    logger,
	}
}

// CreateLoadBalancer creates a new load balancer.
func (s *LoadBalancerService) CreateLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.CreateLoadBalancerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	logger := s.logger.With(
		zap.String("method", "CreateLoadBalancer"),
		zap.String("lb_name", req.Msg.Name),
	)
	logger.Info("Creating load balancer")

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}
	if req.Msg.NetworkId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("network_id is required"))
	}

	lb := &domain.LoadBalancer{
		ID:          uuid.NewString(),
		Name:        req.Msg.Name,
		NetworkID:   req.Msg.NetworkId,
		ProjectID:   req.Msg.ProjectId,
		Description: req.Msg.Description,
		Labels:      req.Msg.Labels,
		Spec: domain.LoadBalancerSpec{
			VIP:       req.Msg.Vip,
			Algorithm: domain.LBAlgorithm(req.Msg.Algorithm),
			Protocol:  domain.LBProtocol(req.Msg.Protocol),
			Listeners: []domain.LBListener{},
			Members:   []domain.LBMember{},
		},
		Status: domain.LoadBalancerStatus{
			Phase:         domain.LBPhasePending,
			ProvisionedIP: "",
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Assign VIP if not provided
	if lb.Spec.VIP == "" {
		// TODO: Allocate VIP from network IPAM
		lb.Spec.VIP = "auto"
	}

	createdLB, err := s.repo.Create(ctx, lb)
	if err != nil {
		logger.Error("Failed to create load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create OVN load balancer if client is available
	if s.ovnClient != nil {
		if err := s.ovnClient.CreateLoadBalancer(ctx, createdLB); err != nil {
			logger.Warn("Failed to create OVN load balancer", zap.Error(err))
			createdLB.Status.Phase = domain.LBPhaseError
			createdLB.Status.ErrorMessage = err.Error()
		} else {
			createdLB.Status.Phase = domain.LBPhaseActive
		}
		// Update status
		if _, err := s.repo.Update(ctx, createdLB); err != nil {
			logger.Warn("Failed to update load balancer status", zap.Error(err))
		}
	}

	logger.Info("Load balancer created", zap.String("lb_id", createdLB.ID))
	return connect.NewResponse(s.toProto(createdLB)), nil
}

// GetLoadBalancer retrieves a load balancer by ID.
func (s *LoadBalancerService) GetLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.GetLoadBalancerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	lb, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(s.toProto(lb)), nil
}

// ListLoadBalancers returns all load balancers.
func (s *LoadBalancerService) ListLoadBalancers(
	ctx context.Context,
	req *connect.Request[networkv1.ListLoadBalancersRequest],
) (*connect.Response[networkv1.ListLoadBalancersResponse], error) {
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	lbs, total, err := s.repo.List(ctx, req.Msg.ProjectId, limit, 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var protoLBs []*networkv1.LoadBalancer
	for _, lb := range lbs {
		protoLBs = append(protoLBs, s.toProto(lb))
	}

	return connect.NewResponse(&networkv1.ListLoadBalancersResponse{
		LoadBalancers: protoLBs,
		TotalCount:    int32(total),
	}), nil
}

// UpdateLoadBalancer updates a load balancer.
func (s *LoadBalancerService) UpdateLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.UpdateLoadBalancerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateLoadBalancer"),
		zap.String("lb_id", req.Msg.Id),
	)
	logger.Info("Updating load balancer")

	lb, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if req.Msg.Description != "" {
		lb.Description = req.Msg.Description
	}
	if req.Msg.Labels != nil {
		lb.Labels = req.Msg.Labels
	}
	lb.UpdatedAt = time.Now()

	updatedLB, err := s.repo.Update(ctx, lb)
	if err != nil {
		logger.Error("Failed to update load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedLB)), nil
}

// DeleteLoadBalancer removes a load balancer.
func (s *LoadBalancerService) DeleteLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteLoadBalancerRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteLoadBalancer"),
		zap.String("lb_id", req.Msg.Id),
	)
	logger.Info("Deleting load balancer")

	// Delete OVN load balancer if client is available
	if s.ovnClient != nil {
		if err := s.ovnClient.DeleteLoadBalancer(ctx, req.Msg.Id); err != nil {
			logger.Warn("Failed to delete OVN load balancer", zap.Error(err))
		}
	}

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete load balancer", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Load balancer deleted")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AddListener adds a listener (frontend) to a load balancer.
func (s *LoadBalancerService) AddListener(
	ctx context.Context,
	req *connect.Request[networkv1.AddListenerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	logger := s.logger.With(
		zap.String("method", "AddListener"),
		zap.String("lb_id", req.Msg.LoadBalancerId),
	)
	logger.Info("Adding listener to load balancer")

	lb, err := s.repo.Get(ctx, req.Msg.LoadBalancerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	listener := domain.LBListener{
		ID:       uuid.NewString(),
		Port:     int(req.Msg.Port),
		Protocol: domain.LBProtocol(req.Msg.Protocol),
		Name:     req.Msg.Name,
	}

	lb.Spec.Listeners = append(lb.Spec.Listeners, listener)
	lb.UpdatedAt = time.Now()

	// Update OVN load balancer
	if s.ovnClient != nil {
		if err := s.ovnClient.UpdateLoadBalancer(ctx, lb); err != nil {
			logger.Warn("Failed to update OVN load balancer", zap.Error(err))
		}
	}

	updatedLB, err := s.repo.Update(ctx, lb)
	if err != nil {
		logger.Error("Failed to update load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedLB)), nil
}

// RemoveListener removes a listener from a load balancer.
func (s *LoadBalancerService) RemoveListener(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveListenerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	logger := s.logger.With(
		zap.String("method", "RemoveListener"),
		zap.String("lb_id", req.Msg.LoadBalancerId),
	)
	logger.Info("Removing listener from load balancer")

	lb, err := s.repo.Get(ctx, req.Msg.LoadBalancerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove listener
	var newListeners []domain.LBListener
	found := false
	for _, l := range lb.Spec.Listeners {
		if l.ID == req.Msg.ListenerId {
			found = true
			continue
		}
		newListeners = append(newListeners, l)
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("listener not found"))
	}

	lb.Spec.Listeners = newListeners
	lb.UpdatedAt = time.Now()

	// Update OVN load balancer
	if s.ovnClient != nil {
		if err := s.ovnClient.UpdateLoadBalancer(ctx, lb); err != nil {
			logger.Warn("Failed to update OVN load balancer", zap.Error(err))
		}
	}

	updatedLB, err := s.repo.Update(ctx, lb)
	if err != nil {
		logger.Error("Failed to update load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedLB)), nil
}

// AddMember adds a backend member to a load balancer.
func (s *LoadBalancerService) AddMember(
	ctx context.Context,
	req *connect.Request[networkv1.AddMemberRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	logger := s.logger.With(
		zap.String("method", "AddMember"),
		zap.String("lb_id", req.Msg.LoadBalancerId),
	)
	logger.Info("Adding member to load balancer")

	lb, err := s.repo.Get(ctx, req.Msg.LoadBalancerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	member := domain.LBMember{
		ID:         uuid.NewString(),
		Address:    req.Msg.Address,
		Port:       int(req.Msg.Port),
		Weight:     int(req.Msg.Weight),
		ListenerID: req.Msg.ListenerId,
	}
	if member.Weight == 0 {
		member.Weight = 1 // Default weight
	}

	lb.Spec.Members = append(lb.Spec.Members, member)
	lb.UpdatedAt = time.Now()

	// Update OVN load balancer
	if s.ovnClient != nil {
		if err := s.ovnClient.UpdateLoadBalancer(ctx, lb); err != nil {
			logger.Warn("Failed to update OVN load balancer", zap.Error(err))
		}
	}

	updatedLB, err := s.repo.Update(ctx, lb)
	if err != nil {
		logger.Error("Failed to update load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedLB)), nil
}

// RemoveMember removes a backend member from a load balancer.
func (s *LoadBalancerService) RemoveMember(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveMemberRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	logger := s.logger.With(
		zap.String("method", "RemoveMember"),
		zap.String("lb_id", req.Msg.LoadBalancerId),
	)
	logger.Info("Removing member from load balancer")

	lb, err := s.repo.Get(ctx, req.Msg.LoadBalancerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove member
	var newMembers []domain.LBMember
	found := false
	for _, m := range lb.Spec.Members {
		if m.ID == req.Msg.MemberId {
			found = true
			continue
		}
		newMembers = append(newMembers, m)
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("member not found"))
	}

	lb.Spec.Members = newMembers
	lb.UpdatedAt = time.Now()

	// Update OVN load balancer
	if s.ovnClient != nil {
		if err := s.ovnClient.UpdateLoadBalancer(ctx, lb); err != nil {
			logger.Warn("Failed to update OVN load balancer", zap.Error(err))
		}
	}

	updatedLB, err := s.repo.Update(ctx, lb)
	if err != nil {
		logger.Error("Failed to update load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedLB)), nil
}

// GetStats returns load balancer statistics.
func (s *LoadBalancerService) GetStats(
	ctx context.Context,
	req *connect.Request[networkv1.GetLoadBalancerStatsRequest],
) (*connect.Response[networkv1.LoadBalancerStats], error) {
	lb, err := s.repo.Get(ctx, req.Msg.LoadBalancerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Get stats from OVN if available
	var stats *networkv1.LoadBalancerStats
	if s.ovnClient != nil {
		ovnStats, err := s.ovnClient.GetLoadBalancerStats(ctx, lb.ID)
		if err == nil && ovnStats != nil {
			stats = &networkv1.LoadBalancerStats{
				LoadBalancerId:      lb.ID,
				TotalConnections:    ovnStats.TotalConnections,
				ActiveConnections:   ovnStats.ActiveConnections,
				BytesIn:             ovnStats.BytesIn,
				BytesOut:            ovnStats.BytesOut,
				RequestsPerSecond:   ovnStats.RequestsPerSecond,
			}
		}
	}

	if stats == nil {
		// Return empty stats
		stats = &networkv1.LoadBalancerStats{
			LoadBalancerId: lb.ID,
		}
	}

	return connect.NewResponse(stats), nil
}

// toProto converts domain LoadBalancer to proto.
func (s *LoadBalancerService) toProto(lb *domain.LoadBalancer) *networkv1.LoadBalancer {
	var listeners []*networkv1.LoadBalancerListener
	for _, l := range lb.Spec.Listeners {
		listeners = append(listeners, &networkv1.LoadBalancerListener{
			Id:       l.ID,
			Port:     int32(l.Port),
			Protocol: string(l.Protocol),
			Name:     l.Name,
		})
	}

	var members []*networkv1.LoadBalancerMember
	for _, m := range lb.Spec.Members {
		members = append(members, &networkv1.LoadBalancerMember{
			Id:         m.ID,
			Address:    m.Address,
			Port:       int32(m.Port),
			Weight:     int32(m.Weight),
			ListenerId: m.ListenerID,
		})
	}

	phase := networkv1.LoadBalancerStatus_UNKNOWN
	switch lb.Status.Phase {
	case domain.LBPhasePending:
		phase = networkv1.LoadBalancerStatus_PENDING
	case domain.LBPhaseActive:
		phase = networkv1.LoadBalancerStatus_ACTIVE
	case domain.LBPhaseError:
		phase = networkv1.LoadBalancerStatus_ERROR
	}

	return &networkv1.LoadBalancer{
		Id:          lb.ID,
		Name:        lb.Name,
		NetworkId:   lb.NetworkID,
		ProjectId:   lb.ProjectID,
		Description: lb.Description,
		Labels:      lb.Labels,
		Spec: &networkv1.LoadBalancerSpec{
			Vip:       lb.Spec.VIP,
			Algorithm: string(lb.Spec.Algorithm),
			Protocol:  string(lb.Spec.Protocol),
			Listeners: listeners,
			Members:   members,
		},
		Status: &networkv1.LoadBalancerStatus{
			Phase:         phase,
			ProvisionedIp: lb.Status.ProvisionedIP,
			ErrorMessage:  lb.Status.ErrorMessage,
		},
		CreatedAt: timestamppb.New(lb.CreatedAt),
		UpdatedAt: timestamppb.New(lb.UpdatedAt),
	}
}

// =============================================================================
// OVN Load Balancer Statistics
// =============================================================================

// OVNLoadBalancerStats holds OVN-specific stats.
type OVNLoadBalancerStats struct {
	TotalConnections  int64
	ActiveConnections int64
	BytesIn           int64
	BytesOut          int64
	RequestsPerSecond float64
}
