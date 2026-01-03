// Package network implements the LoadBalancerService.
//
// NOTE: This service provides the business logic for L4 load balancing.
// Proto types for LoadBalancer are defined in proto/limiquantix/network/v1/network_service.proto.
// gRPC handlers use Connect-RPC and require proto regeneration with `make proto`.
package network

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn"
)

// LoadBalancerService provides L4 load balancing via OVN's built-in load balancer support.
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

// =============================================================================
// Load Balancer CRUD Operations
// =============================================================================

// CreateRequest holds parameters for creating a load balancer.
type CreateRequest struct {
	Name        string
	NetworkID   string
	ProjectID   string
	Description string
	Labels      map[string]string
	VIP         string
	Algorithm   domain.LBAlgorithm
	Protocol    domain.LBProtocol
}

// Create creates a new load balancer.
func (s *LoadBalancerService) Create(ctx context.Context, req CreateRequest) (*domain.LoadBalancer, error) {
	logger := s.logger.With(
		zap.String("method", "CreateLoadBalancer"),
		zap.String("lb_name", req.Name),
	)
	logger.Info("Creating load balancer")

	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if req.NetworkID == "" {
		return nil, fmt.Errorf("network_id is required")
	}

	lb := &domain.LoadBalancer{
		ID:          uuid.NewString(),
		Name:        req.Name,
		NetworkID:   req.NetworkID,
		ProjectID:   req.ProjectID,
		Description: req.Description,
		Labels:      req.Labels,
		Spec: domain.LoadBalancerSpec{
			VIP:       req.VIP,
			Algorithm: req.Algorithm,
			Protocol:  req.Protocol,
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
		lb.Spec.VIP = "auto"
	}

	// Default algorithm
	if lb.Spec.Algorithm == "" {
		lb.Spec.Algorithm = domain.LBAlgorithmRoundRobin
	}

	// Default protocol
	if lb.Spec.Protocol == "" {
		lb.Spec.Protocol = domain.LBProtocolTCP
	}

	createdLB, err := s.repo.Create(ctx, lb)
	if err != nil {
		logger.Error("Failed to create load balancer", zap.Error(err))
		return nil, fmt.Errorf("failed to create load balancer: %w", err)
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
		if _, err := s.repo.Update(ctx, createdLB); err != nil {
			logger.Warn("Failed to update load balancer status", zap.Error(err))
		}
	}

	logger.Info("Load balancer created", zap.String("lb_id", createdLB.ID))
	return createdLB, nil
}

// Get retrieves a load balancer by ID.
func (s *LoadBalancerService) Get(ctx context.Context, id string) (*domain.LoadBalancer, error) {
	return s.repo.Get(ctx, id)
}

// List returns all load balancers.
func (s *LoadBalancerService) List(ctx context.Context, projectID string, limit, offset int) ([]*domain.LoadBalancer, int, error) {
	if limit == 0 {
		limit = 100
	}
	return s.repo.List(ctx, projectID, limit, offset)
}

// Delete removes a load balancer.
func (s *LoadBalancerService) Delete(ctx context.Context, id string) error {
	logger := s.logger.With(
		zap.String("method", "DeleteLoadBalancer"),
		zap.String("lb_id", id),
	)
	logger.Info("Deleting load balancer")

	// Delete OVN load balancer if client is available
	if s.ovnClient != nil {
		if err := s.ovnClient.DeleteLoadBalancer(ctx, id); err != nil {
			logger.Warn("Failed to delete OVN load balancer", zap.Error(err))
		}
	}

	if err := s.repo.Delete(ctx, id); err != nil {
		logger.Error("Failed to delete load balancer", zap.Error(err))
		return fmt.Errorf("failed to delete load balancer: %w", err)
	}

	logger.Info("Load balancer deleted")
	return nil
}

// =============================================================================
// Listener Operations
// =============================================================================

// AddListenerRequest holds parameters for adding a listener.
type AddListenerRequest struct {
	LoadBalancerID string
	Port           int
	Protocol       domain.LBProtocol
	Name           string
}

// AddListener adds a listener (frontend) to a load balancer.
func (s *LoadBalancerService) AddListener(ctx context.Context, req AddListenerRequest) (*domain.LoadBalancer, error) {
	logger := s.logger.With(
		zap.String("method", "AddListener"),
		zap.String("lb_id", req.LoadBalancerID),
	)
	logger.Info("Adding listener to load balancer")

	lb, err := s.repo.Get(ctx, req.LoadBalancerID)
	if err != nil {
		return nil, fmt.Errorf("load balancer not found: %w", err)
	}

	listener := domain.LBListener{
		ID:       uuid.NewString(),
		Port:     req.Port,
		Protocol: req.Protocol,
		Name:     req.Name,
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
		return nil, fmt.Errorf("failed to update load balancer: %w", err)
	}

	return updatedLB, nil
}

// RemoveListener removes a listener from a load balancer.
func (s *LoadBalancerService) RemoveListener(ctx context.Context, lbID, listenerID string) (*domain.LoadBalancer, error) {
	logger := s.logger.With(
		zap.String("method", "RemoveListener"),
		zap.String("lb_id", lbID),
	)
	logger.Info("Removing listener from load balancer")

	lb, err := s.repo.Get(ctx, lbID)
	if err != nil {
		return nil, fmt.Errorf("load balancer not found: %w", err)
	}

	// Find and remove listener
	var newListeners []domain.LBListener
	found := false
	for _, l := range lb.Spec.Listeners {
		if l.ID == listenerID {
			found = true
			continue
		}
		newListeners = append(newListeners, l)
	}

	if !found {
		return nil, fmt.Errorf("listener not found")
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
		return nil, fmt.Errorf("failed to update load balancer: %w", err)
	}

	return updatedLB, nil
}

// =============================================================================
// Member Operations
// =============================================================================

// AddMemberRequest holds parameters for adding a member.
type AddMemberRequest struct {
	LoadBalancerID string
	Address        string
	Port           int
	Weight         int
	ListenerID     string
}

// AddMember adds a backend member to a load balancer.
func (s *LoadBalancerService) AddMember(ctx context.Context, req AddMemberRequest) (*domain.LoadBalancer, error) {
	logger := s.logger.With(
		zap.String("method", "AddMember"),
		zap.String("lb_id", req.LoadBalancerID),
	)
	logger.Info("Adding member to load balancer")

	lb, err := s.repo.Get(ctx, req.LoadBalancerID)
	if err != nil {
		return nil, fmt.Errorf("load balancer not found: %w", err)
	}

	member := domain.LBMember{
		ID:         uuid.NewString(),
		Address:    req.Address,
		Port:       req.Port,
		Weight:     req.Weight,
		ListenerID: req.ListenerID,
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
		return nil, fmt.Errorf("failed to update load balancer: %w", err)
	}

	return updatedLB, nil
}

// RemoveMember removes a backend member from a load balancer.
func (s *LoadBalancerService) RemoveMember(ctx context.Context, lbID, memberID string) (*domain.LoadBalancer, error) {
	logger := s.logger.With(
		zap.String("method", "RemoveMember"),
		zap.String("lb_id", lbID),
	)
	logger.Info("Removing member from load balancer")

	lb, err := s.repo.Get(ctx, lbID)
	if err != nil {
		return nil, fmt.Errorf("load balancer not found: %w", err)
	}

	// Find and remove member
	var newMembers []domain.LBMember
	found := false
	for _, m := range lb.Spec.Members {
		if m.ID == memberID {
			found = true
			continue
		}
		newMembers = append(newMembers, m)
	}

	if !found {
		return nil, fmt.Errorf("member not found")
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
		return nil, fmt.Errorf("failed to update load balancer: %w", err)
	}

	return updatedLB, nil
}

// =============================================================================
// Statistics
// =============================================================================

// Stats holds load balancer statistics.
type Stats struct {
	TotalConnections  int64
	ActiveConnections int64
	BytesIn           int64
	BytesOut          int64
	RequestsPerSecond float64
}

// GetStats returns load balancer statistics.
func (s *LoadBalancerService) GetStats(ctx context.Context, lbID string) (*Stats, error) {
	lb, err := s.repo.Get(ctx, lbID)
	if err != nil {
		return nil, fmt.Errorf("load balancer not found: %w", err)
	}

	// Get stats from OVN if available
	if s.ovnClient != nil {
		ovnStats, err := s.ovnClient.GetLoadBalancerStats(ctx, lb.ID)
		if err == nil && ovnStats != nil {
			return &Stats{
				TotalConnections:  ovnStats.TotalConnections,
				ActiveConnections: ovnStats.ActiveConnections,
				BytesIn:           ovnStats.BytesIn,
				BytesOut:          ovnStats.BytesOut,
				RequestsPerSecond: ovnStats.RequestsPerSecond,
			}, nil
		}
	}

	// Return empty stats
	return &Stats{}, nil
}

// Ensure unused import is used
var _ = strings.Join
