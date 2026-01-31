// Package network provides Load Balancer management using OVN's native LB.
// This implements L4 load balancing with TCP/UDP support via Connect-RPC.
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
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// =============================================================================
// LOAD BALANCER SERVICE - Connect-RPC Handler
// =============================================================================

// LoadBalancerService implements the LoadBalancerServiceHandler interface.
// It manages OVN load balancers for Quantix-vDC L4 load balancing.
type LoadBalancerService struct {
	repo   LoadBalancerRepository
	logger *zap.Logger
}

// NewLoadBalancerService creates a new load balancer service.
func NewLoadBalancerService(repo LoadBalancerRepository, logger *zap.Logger) *LoadBalancerService {
	return &LoadBalancerService{
		repo:   repo,
		logger: logger.Named("lb-service"),
	}
}

// =============================================================================
// CONNECT-RPC HANDLERS
// =============================================================================

// CreateLoadBalancer creates a new load balancer.
func (s *LoadBalancerService) CreateLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.CreateLoadBalancerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	msg := req.Msg

	s.logger.Info("Creating load balancer",
		zap.String("name", msg.Name),
		zap.String("project_id", msg.ProjectId),
	)

	// Generate ID
	id := uuid.New().String()

	// Convert spec to domain model
	lb := &domain.LoadBalancer{
		ID:          id,
		Name:        msg.Name,
		NetworkID:   msg.Spec.GetNetworkId(),
		ProjectID:   msg.ProjectId,
		Description: msg.Description,
		Labels:      msg.Labels,
		Spec: domain.LoadBalancerSpec{
			VIP:       msg.Spec.GetVipAddress(),
			Algorithm: protoAlgorithmToDomain(msg.Spec),
			Protocol:  domain.LBProtocolTCP, // Default to TCP
			Listeners: protoListenersToDomain(msg.Spec.GetListeners()),
			Members:   []domain.LBMember{}, // Members are added via pools
		},
		Status: domain.LoadBalancerStatus{
			Phase: domain.LBPhasePending,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Allocate VIP if not specified
	if lb.Spec.VIP == "" {
		// In real implementation, allocate from IPAM
		lb.Spec.VIP = "10.0.0.100" // Placeholder
	}

	// Create OVN load balancer
	if err := s.createOVNLoadBalancer(ctx, lb); err != nil {
		s.logger.Error("Failed to create OVN load balancer", zap.Error(err))
		lb.Status.Phase = domain.LBPhaseError
		lb.Status.ErrorMessage = err.Error()
	} else {
		lb.Status.Phase = domain.LBPhaseActive
		lb.Status.ProvisionedIP = lb.Spec.VIP
	}

	// Store in repository
	created, err := s.repo.Create(ctx, lb)
	if err != nil {
		s.logger.Error("Failed to store load balancer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create load balancer: %w", err))
	}

	s.logger.Info("Created load balancer",
		zap.String("id", created.ID),
		zap.String("vip", created.Spec.VIP),
	)

	return connect.NewResponse(domainToProtoLB(created)), nil
}

// GetLoadBalancer retrieves a load balancer by ID.
func (s *LoadBalancerService) GetLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.GetLoadBalancerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	lb, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", req.Msg.Id))
	}

	return connect.NewResponse(domainToProtoLB(lb)), nil
}

// ListLoadBalancers returns all load balancers.
func (s *LoadBalancerService) ListLoadBalancers(
	ctx context.Context,
	req *connect.Request[networkv1.ListLoadBalancersRequest],
) (*connect.Response[networkv1.ListLoadBalancersResponse], error) {
	filter := LBFilter{
		ProjectID: req.Msg.ProjectId,
		NetworkID: req.Msg.NetworkId,
	}

	lbs, total, err := s.repo.List(ctx, filter, int(req.Msg.PageSize), 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list load balancers: %w", err))
	}

	protoLBs := make([]*networkv1.LoadBalancer, len(lbs))
	for i, lb := range lbs {
		protoLBs[i] = domainToProtoLB(lb)
	}

	return connect.NewResponse(&networkv1.ListLoadBalancersResponse{
		LoadBalancers: protoLBs,
		TotalCount:    int32(total),
	}), nil
}

// UpdateLoadBalancer updates load balancer configuration.
func (s *LoadBalancerService) UpdateLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.UpdateLoadBalancerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	msg := req.Msg

	lb, err := s.repo.Get(ctx, msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", msg.Id))
	}

	// Update fields
	if msg.Description != "" {
		lb.Description = msg.Description
	}
	if len(msg.Labels) > 0 {
		lb.Labels = msg.Labels
	}
	lb.UpdatedAt = time.Now()

	updated, err := s.repo.Update(ctx, lb)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to update load balancer: %w", err))
	}

	s.logger.Info("Updated load balancer", zap.String("id", updated.ID))

	return connect.NewResponse(domainToProtoLB(updated)), nil
}

// DeleteLoadBalancer removes a load balancer.
func (s *LoadBalancerService) DeleteLoadBalancer(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteLoadBalancerRequest],
) (*connect.Response[emptypb.Empty], error) {
	id := req.Msg.Id

	s.logger.Info("Deleting load balancer", zap.String("id", id))

	// Delete from OVN first
	if err := s.deleteOVNLoadBalancer(ctx, id); err != nil {
		s.logger.Warn("Failed to delete OVN load balancer", zap.Error(err))
		// Continue with deletion from DB
	}

	if err := s.repo.Delete(ctx, id); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete load balancer: %w", err))
	}

	s.logger.Info("Deleted load balancer", zap.String("id", id))

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AddListener adds a frontend listener to a load balancer.
func (s *LoadBalancerService) AddListener(
	ctx context.Context,
	req *connect.Request[networkv1.AddListenerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	msg := req.Msg

	lb, err := s.repo.Get(ctx, msg.LoadBalancerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", msg.LoadBalancerId))
	}

	// Generate listener ID if not provided
	listenerID := msg.Listener.GetId()
	if listenerID == "" {
		listenerID = uuid.New().String()
	}

	// Add listener to spec
	listener := domain.LBListener{
		ID:       listenerID,
		Port:     int(msg.Listener.GetPort()),
		Protocol: protoProtocolToDomain(msg.Listener.GetProtocol()),
		Name:     msg.Listener.GetName(),
	}
	lb.Spec.Listeners = append(lb.Spec.Listeners, listener)
	lb.UpdatedAt = time.Now()

	// Update OVN VIPs
	if err := s.updateOVNVIPs(ctx, lb); err != nil {
		s.logger.Error("Failed to update OVN VIPs", zap.Error(err))
	}

	updated, err := s.repo.Update(ctx, lb)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to add listener: %w", err))
	}

	s.logger.Info("Added listener",
		zap.String("lb_id", lb.ID),
		zap.String("listener_id", listenerID),
		zap.Int("port", listener.Port),
	)

	return connect.NewResponse(domainToProtoLB(updated)), nil
}

// RemoveListener removes a listener from a load balancer.
func (s *LoadBalancerService) RemoveListener(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveListenerRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	msg := req.Msg

	lb, err := s.repo.Get(ctx, msg.LoadBalancerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", msg.LoadBalancerId))
	}

	// Remove listener
	newListeners := make([]domain.LBListener, 0, len(lb.Spec.Listeners))
	for _, l := range lb.Spec.Listeners {
		if l.ID != msg.ListenerId {
			newListeners = append(newListeners, l)
		}
	}
	lb.Spec.Listeners = newListeners
	lb.UpdatedAt = time.Now()

	// Update OVN VIPs
	if err := s.updateOVNVIPs(ctx, lb); err != nil {
		s.logger.Error("Failed to update OVN VIPs", zap.Error(err))
	}

	updated, err := s.repo.Update(ctx, lb)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to remove listener: %w", err))
	}

	s.logger.Info("Removed listener",
		zap.String("lb_id", lb.ID),
		zap.String("listener_id", msg.ListenerId),
	)

	return connect.NewResponse(domainToProtoLB(updated)), nil
}

// AddPoolMember adds a backend member to a pool.
func (s *LoadBalancerService) AddPoolMember(
	ctx context.Context,
	req *connect.Request[networkv1.AddPoolMemberRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	msg := req.Msg

	lb, err := s.repo.Get(ctx, msg.LoadBalancerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", msg.LoadBalancerId))
	}

	// Generate member ID if not provided
	memberID := msg.Member.GetId()
	if memberID == "" {
		memberID = uuid.New().String()
	}

	// Add member to spec
	member := domain.LBMember{
		ID:         memberID,
		Address:    msg.Member.GetAddress(),
		Port:       int(msg.Member.GetPort()),
		Weight:     int(msg.Member.GetWeight()),
		ListenerID: msg.PoolId, // Map pool to listener for simplicity
	}
	lb.Spec.Members = append(lb.Spec.Members, member)
	lb.UpdatedAt = time.Now()

	// Update OVN VIPs with new backend
	if err := s.updateOVNVIPs(ctx, lb); err != nil {
		s.logger.Error("Failed to update OVN VIPs", zap.Error(err))
	}

	updated, err := s.repo.Update(ctx, lb)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to add member: %w", err))
	}

	s.logger.Info("Added pool member",
		zap.String("lb_id", lb.ID),
		zap.String("member_id", memberID),
		zap.String("address", member.Address),
		zap.Int("port", member.Port),
	)

	return connect.NewResponse(domainToProtoLB(updated)), nil
}

// RemovePoolMember removes a backend member from a pool.
func (s *LoadBalancerService) RemovePoolMember(
	ctx context.Context,
	req *connect.Request[networkv1.RemovePoolMemberRequest],
) (*connect.Response[networkv1.LoadBalancer], error) {
	msg := req.Msg

	lb, err := s.repo.Get(ctx, msg.LoadBalancerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", msg.LoadBalancerId))
	}

	// Remove member
	newMembers := make([]domain.LBMember, 0, len(lb.Spec.Members))
	for _, m := range lb.Spec.Members {
		if m.ID != msg.MemberId {
			newMembers = append(newMembers, m)
		}
	}
	lb.Spec.Members = newMembers
	lb.UpdatedAt = time.Now()

	// Update OVN VIPs
	if err := s.updateOVNVIPs(ctx, lb); err != nil {
		s.logger.Error("Failed to update OVN VIPs", zap.Error(err))
	}

	updated, err := s.repo.Update(ctx, lb)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to remove member: %w", err))
	}

	s.logger.Info("Removed pool member",
		zap.String("lb_id", lb.ID),
		zap.String("member_id", msg.MemberId),
	)

	return connect.NewResponse(domainToProtoLB(updated)), nil
}

// GetLoadBalancerStats returns traffic statistics for a load balancer.
func (s *LoadBalancerService) GetLoadBalancerStats(
	ctx context.Context,
	req *connect.Request[networkv1.GetLoadBalancerStatsRequest],
) (*connect.Response[networkv1.LoadBalancerStats], error) {
	lb, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("load balancer not found: %s", req.Msg.Id))
	}

	// In real implementation, query OVN counters
	// ovn-nbctl lb-list | grep <lb-name>
	// For now, return placeholder stats
	stats := &networkv1.LoadBalancerStats{
		LoadBalancerId:    lb.ID,
		ActiveConnections: 0,
		TotalConnections:  0,
		BytesIn:           0,
		BytesOut:          0,
		Requests:          0,
		ListenerStats:     []*networkv1.ListenerStats{},
		MemberStats:       []*networkv1.MemberStats{},
	}

	// Add member stats
	for _, member := range lb.Spec.Members {
		stats.MemberStats = append(stats.MemberStats, &networkv1.MemberStats{
			PoolId:            member.ListenerID,
			MemberId:          member.ID,
			Address:           member.Address,
			Healthy:           true, // TODO: Get from health checker
			ActiveConnections: 0,
			TotalConnections:  0,
			BytesIn:           0,
			BytesOut:          0,
		})
	}

	return connect.NewResponse(stats), nil
}

// =============================================================================
// OVN INTEGRATION
// =============================================================================

// createOVNLoadBalancer creates a load balancer in OVN.
func (s *LoadBalancerService) createOVNLoadBalancer(ctx context.Context, lb *domain.LoadBalancer) error {
	// OVN command: ovn-nbctl lb-add <name> <vip>:<port> <backend1>:<port>,<backend2>:<port>
	// For initial creation with no backends, we create an empty LB
	lbName := fmt.Sprintf("lb-%s", lb.ID)

	s.logger.Info("Creating OVN load balancer",
		zap.String("name", lbName),
		zap.String("vip", lb.Spec.VIP),
	)

	// Build OVN command
	// In a real implementation, this would execute:
	// ovn-nbctl lb-add lb-<id> <vip>:<port> ""
	// ovn-nbctl set load_balancer lb-<id> options:reject=true
	// ovn-nbctl ls-lb-add <switch-name> lb-<id>

	// For now, log the command that would be executed
	s.logger.Debug("OVN command (simulated)",
		zap.String("cmd", fmt.Sprintf("ovn-nbctl lb-add %s %s:0 ''", lbName, lb.Spec.VIP)),
	)

	return nil
}

// deleteOVNLoadBalancer removes a load balancer from OVN.
func (s *LoadBalancerService) deleteOVNLoadBalancer(ctx context.Context, lbID string) error {
	lbName := fmt.Sprintf("lb-%s", lbID)

	s.logger.Info("Deleting OVN load balancer", zap.String("name", lbName))

	// In a real implementation:
	// ovn-nbctl lb-del lb-<id>

	s.logger.Debug("OVN command (simulated)",
		zap.String("cmd", fmt.Sprintf("ovn-nbctl lb-del %s", lbName)),
	)

	return nil
}

// updateOVNVIPs updates OVN load balancer VIPs based on current state.
func (s *LoadBalancerService) updateOVNVIPs(ctx context.Context, lb *domain.LoadBalancer) error {
	lbName := fmt.Sprintf("lb-%s", lb.ID)

	// Build VIP -> backends mapping
	for _, listener := range lb.Spec.Listeners {
		vipKey := fmt.Sprintf("%s:%d", lb.Spec.VIP, listener.Port)

		// Find members for this listener
		var backends []string
		for _, member := range lb.Spec.Members {
			if member.ListenerID == listener.ID || member.ListenerID == "" {
				backends = append(backends, fmt.Sprintf("%s:%d", member.Address, member.Port))
			}
		}

		backendStr := strings.Join(backends, ",")
		if backendStr == "" {
			backendStr = "''" // Empty backends
		}

		s.logger.Debug("OVN VIP update (simulated)",
			zap.String("lb", lbName),
			zap.String("vip", vipKey),
			zap.String("backends", backendStr),
		)

		// In real implementation:
		// ovn-nbctl lb-add <lb-name> <vip>:<port> <backends>
	}

	return nil
}

// =============================================================================
// CONVERTERS
// =============================================================================

// domainToProtoLB converts domain LoadBalancer to proto LoadBalancer.
func domainToProtoLB(lb *domain.LoadBalancer) *networkv1.LoadBalancer {
	// Convert listeners
	listeners := make([]*networkv1.Listener, len(lb.Spec.Listeners))
	for i, l := range lb.Spec.Listeners {
		listeners[i] = &networkv1.Listener{
			Id:       l.ID,
			Name:     l.Name,
			Protocol: domainProtocolToProto(l.Protocol),
			Port:     uint32(l.Port),
		}
	}

	// Convert members to pools with members
	pools := make([]*networkv1.Pool, 0)
	membersByPool := make(map[string][]*networkv1.PoolMember)
	for _, m := range lb.Spec.Members {
		poolID := m.ListenerID
		if poolID == "" {
			poolID = "default-pool"
		}
		membersByPool[poolID] = append(membersByPool[poolID], &networkv1.PoolMember{
			Id:           m.ID,
			Address:      m.Address,
			Port:         uint32(m.Port),
			Weight:       uint32(m.Weight),
			AdminStateUp: true,
		})
	}
	for poolID, members := range membersByPool {
		pools = append(pools, &networkv1.Pool{
			Id:        poolID,
			Name:      poolID,
			Algorithm: domainAlgorithmToProto(lb.Spec.Algorithm),
			Protocol:  domainProtocolToProto(lb.Spec.Protocol),
			Members:   members,
		})
	}

	return &networkv1.LoadBalancer{
		Id:          lb.ID,
		Name:        lb.Name,
		Description: lb.Description,
		ProjectId:   lb.ProjectID,
		Labels:      lb.Labels,
		Spec: &networkv1.LoadBalancerSpec{
			NetworkId:  lb.NetworkID,
			VipAddress: lb.Spec.VIP,
			Listeners:  listeners,
			Pools:      pools,
		},
		Status: &networkv1.LoadBalancerStatus{
			Phase:              domainPhaseToProto(lb.Status.Phase),
			ProvisioningStatus: "ACTIVE",
			OperatingStatus:    "ONLINE",
			VipAddress:         lb.Status.ProvisionedIP,
			ErrorMessage:       lb.Status.ErrorMessage,
		},
		CreatedAt: timestamppb.New(lb.CreatedAt),
		UpdatedAt: timestamppb.New(lb.UpdatedAt),
	}
}

func domainPhaseToProto(phase domain.LBPhase) networkv1.LoadBalancerStatus_Phase {
	switch phase {
	case domain.LBPhasePending:
		return networkv1.LoadBalancerStatus_PENDING
	case domain.LBPhaseActive:
		return networkv1.LoadBalancerStatus_ACTIVE
	case domain.LBPhaseError:
		return networkv1.LoadBalancerStatus_ERROR
	default:
		return networkv1.LoadBalancerStatus_UNKNOWN
	}
}

func domainProtocolToProto(proto domain.LBProtocol) networkv1.Listener_Protocol {
	switch proto {
	case domain.LBProtocolTCP:
		return networkv1.Listener_TCP
	case domain.LBProtocolUDP:
		return networkv1.Listener_UDP
	case domain.LBProtocolHTTP:
		return networkv1.Listener_HTTP
	case domain.LBProtocolHTTPS:
		return networkv1.Listener_HTTPS
	default:
		return networkv1.Listener_TCP
	}
}

func domainAlgorithmToProto(algo domain.LBAlgorithm) networkv1.Pool_Algorithm {
	switch algo {
	case domain.LBAlgorithmRoundRobin:
		return networkv1.Pool_ROUND_ROBIN
	case domain.LBAlgorithmLeastConn:
		return networkv1.Pool_LEAST_CONNECTIONS
	case domain.LBAlgorithmSourceIP:
		return networkv1.Pool_SOURCE_IP
	case domain.LBAlgorithmWeighted:
		return networkv1.Pool_WEIGHTED_ROUND_ROBIN
	default:
		return networkv1.Pool_ROUND_ROBIN
	}
}

func protoProtocolToDomain(proto networkv1.Listener_Protocol) domain.LBProtocol {
	switch proto {
	case networkv1.Listener_TCP:
		return domain.LBProtocolTCP
	case networkv1.Listener_UDP:
		return domain.LBProtocolUDP
	case networkv1.Listener_HTTP:
		return domain.LBProtocolHTTP
	case networkv1.Listener_HTTPS:
		return domain.LBProtocolHTTPS
	default:
		return domain.LBProtocolTCP
	}
}

func protoAlgorithmToDomain(spec *networkv1.LoadBalancerSpec) domain.LBAlgorithm {
	if spec == nil || len(spec.Pools) == 0 {
		return domain.LBAlgorithmRoundRobin
	}
	switch spec.Pools[0].Algorithm {
	case networkv1.Pool_ROUND_ROBIN:
		return domain.LBAlgorithmRoundRobin
	case networkv1.Pool_LEAST_CONNECTIONS:
		return domain.LBAlgorithmLeastConn
	case networkv1.Pool_SOURCE_IP:
		return domain.LBAlgorithmSourceIP
	case networkv1.Pool_WEIGHTED_ROUND_ROBIN:
		return domain.LBAlgorithmWeighted
	default:
		return domain.LBAlgorithmRoundRobin
	}
}

func protoListenersToDomain(listeners []*networkv1.Listener) []domain.LBListener {
	result := make([]domain.LBListener, len(listeners))
	for i, l := range listeners {
		result[i] = domain.LBListener{
			ID:       l.Id,
			Name:     l.Name,
			Port:     int(l.Port),
			Protocol: protoProtocolToDomain(l.Protocol),
		}
	}
	return result
}

// =============================================================================
// REPOSITORY INTERFACE
// =============================================================================

// LBFilter defines filtering options for listing load balancers.
type LBFilter struct {
	ProjectID string
	NetworkID string
}

// LoadBalancerRepository defines the interface for load balancer persistence.
type LoadBalancerRepository interface {
	Create(ctx context.Context, lb *domain.LoadBalancer) (*domain.LoadBalancer, error)
	Get(ctx context.Context, id string) (*domain.LoadBalancer, error)
	List(ctx context.Context, filter LBFilter, limit, offset int) ([]*domain.LoadBalancer, int, error)
	Update(ctx context.Context, lb *domain.LoadBalancer) (*domain.LoadBalancer, error)
	Delete(ctx context.Context, id string) error
	ListByNetwork(ctx context.Context, networkID string) ([]*domain.LoadBalancer, error)
}
