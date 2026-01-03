// Package network implements the FloatingIpService.
package network

import (
	"context"
	"fmt"
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

// FloatingIpService implements the networkv1connect.FloatingIpServiceHandler interface.
type FloatingIpService struct {
	repo       FloatingIpRepository
	portRepo   PortRepository
	networkRepo NetworkRepository
	ovnClient  *ovn.NorthboundClient
	logger     *zap.Logger
}

// FloatingIpRepository defines the interface for floating IP storage.
type FloatingIpRepository interface {
	Create(ctx context.Context, fip *domain.FloatingIP) (*domain.FloatingIP, error)
	Get(ctx context.Context, id string) (*domain.FloatingIP, error)
	List(ctx context.Context, projectID string, limit, offset int) ([]*domain.FloatingIP, int, error)
	Update(ctx context.Context, fip *domain.FloatingIP) (*domain.FloatingIP, error)
	Delete(ctx context.Context, id string) error
	FindByIP(ctx context.Context, ipAddress string) (*domain.FloatingIP, error)
}

// PortRepository defines the interface for port storage.
type PortRepository interface {
	Get(ctx context.Context, id string) (*domain.Port, error)
	Update(ctx context.Context, port *domain.Port) (*domain.Port, error)
}

// NewFloatingIpService creates a new FloatingIpService.
func NewFloatingIpService(
	repo FloatingIpRepository,
	portRepo PortRepository,
	networkRepo NetworkRepository,
	logger *zap.Logger,
) *FloatingIpService {
	return &FloatingIpService{
		repo:        repo,
		portRepo:    portRepo,
		networkRepo: networkRepo,
		logger:      logger,
	}
}

// NewFloatingIpServiceWithOVN creates a new FloatingIpService with OVN backend.
func NewFloatingIpServiceWithOVN(
	repo FloatingIpRepository,
	portRepo PortRepository,
	networkRepo NetworkRepository,
	ovnClient *ovn.NorthboundClient,
	logger *zap.Logger,
) *FloatingIpService {
	return &FloatingIpService{
		repo:        repo,
		portRepo:    portRepo,
		networkRepo: networkRepo,
		ovnClient:   ovnClient,
		logger:      logger,
	}
}

// AllocateFloatingIp reserves a public IP from the external network.
func (s *FloatingIpService) AllocateFloatingIp(
	ctx context.Context,
	req *connect.Request[networkv1.AllocateFloatingIpRequest],
) (*connect.Response[networkv1.FloatingIp], error) {
	logger := s.logger.With(
		zap.String("method", "AllocateFloatingIp"),
		zap.String("external_network_id", req.Msg.ExternalNetworkId),
	)
	logger.Info("Allocating floating IP")

	if req.Msg.ExternalNetworkId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("external_network_id is required"))
	}

	// Get external network to allocate from
	externalNet, err := s.networkRepo.Get(ctx, req.Msg.ExternalNetworkId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("external network not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if externalNet.Spec.Type != domain.NetworkTypeExternal {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("network is not an external network"))
	}

	// Allocate IP - either specific or from pool
	var ipAddress string
	if req.Msg.IpAddress != "" {
		// Check if specific IP is available
		_, err := s.repo.FindByIP(ctx, req.Msg.IpAddress)
		if err == nil {
			return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("IP address already allocated"))
		}
		ipAddress = req.Msg.IpAddress
	} else {
		// Allocate from pool
		// TODO: Implement IP pool allocation
		// For now, return error
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("automatic IP allocation not yet implemented"))
	}

	fip := &domain.FloatingIP{
		ID:                uuid.NewString(),
		IPAddress:         ipAddress,
		ExternalNetworkID: req.Msg.ExternalNetworkId,
		ProjectID:         req.Msg.ProjectId,
		Description:       req.Msg.Description,
		Labels:            req.Msg.Labels,
		Assignment:        domain.FloatingIPAssignment{},
		Status: domain.FloatingIPStatus{
			Phase: domain.FloatingIPPhasePending,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	createdFip, err := s.repo.Create(ctx, fip)
	if err != nil {
		logger.Error("Failed to allocate floating IP", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Mark as active (unassigned but available)
	createdFip.Status.Phase = domain.FloatingIPPhaseDown
	if err := s.updateStatus(ctx, createdFip); err != nil {
		logger.Warn("Failed to update floating IP status", zap.Error(err))
	}

	logger.Info("Floating IP allocated", zap.String("fip_id", createdFip.ID), zap.String("ip", createdFip.IPAddress))
	return connect.NewResponse(s.toProto(createdFip)), nil
}

// GetFloatingIp retrieves a floating IP by ID.
func (s *FloatingIpService) GetFloatingIp(
	ctx context.Context,
	req *connect.Request[networkv1.GetFloatingIpRequest],
) (*connect.Response[networkv1.FloatingIp], error) {
	fip, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(s.toProto(fip)), nil
}

// ListFloatingIps returns all floating IPs.
func (s *FloatingIpService) ListFloatingIps(
	ctx context.Context,
	req *connect.Request[networkv1.ListFloatingIpsRequest],
) (*connect.Response[networkv1.ListFloatingIpsResponse], error) {
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	fips, total, err := s.repo.List(ctx, req.Msg.ProjectId, limit, 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var protoFips []*networkv1.FloatingIp
	for _, fip := range fips {
		if req.Msg.UnassignedOnly && fip.IsAssigned() {
			continue
		}
		protoFips = append(protoFips, s.toProto(fip))
	}

	return connect.NewResponse(&networkv1.ListFloatingIpsResponse{
		FloatingIps: protoFips,
		TotalCount:  int32(total),
	}), nil
}

// ReleaseFloatingIp releases a public IP.
func (s *FloatingIpService) ReleaseFloatingIp(
	ctx context.Context,
	req *connect.Request[networkv1.ReleaseFloatingIpRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "ReleaseFloatingIp"),
		zap.String("fip_id", req.Msg.Id),
	)
	logger.Info("Releasing floating IP")

	fip, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Disassociate if assigned
	if fip.IsAssigned() {
		if err := s.disassociate(ctx, fip); err != nil {
			logger.Warn("Failed to disassociate floating IP", zap.Error(err))
		}
	}

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to release floating IP", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Floating IP released", zap.String("ip", fip.IPAddress))
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AssociateFloatingIp assigns a floating IP to a port.
func (s *FloatingIpService) AssociateFloatingIp(
	ctx context.Context,
	req *connect.Request[networkv1.AssociateFloatingIpRequest],
) (*connect.Response[networkv1.FloatingIp], error) {
	logger := s.logger.With(
		zap.String("method", "AssociateFloatingIp"),
		zap.String("fip_id", req.Msg.FloatingIpId),
		zap.String("port_id", req.Msg.PortId),
	)
	logger.Info("Associating floating IP")

	// Get floating IP
	fip, err := s.repo.Get(ctx, req.Msg.FloatingIpId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("floating IP not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Get port
	port, err := s.portRepo.Get(ctx, req.Msg.PortId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("port not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Determine internal IP
	internalIP := req.Msg.FixedIp
	if internalIP == "" && len(port.Spec.FixedIPs) > 0 {
		internalIP = port.Spec.FixedIPs[0].IPAddress
	}
	if internalIP == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("port has no fixed IP"))
	}

	// Disassociate if already assigned
	if fip.IsAssigned() {
		if err := s.disassociate(ctx, fip); err != nil {
			logger.Warn("Failed to disassociate existing floating IP", zap.Error(err))
		}
	}

	// Create NAT rule in OVN
	if s.ovnClient != nil {
		// Get the router ID - typically the project router
		routerID := fmt.Sprintf("project-%s", fip.ProjectID)
		
		if err := s.ovnClient.CreateFloatingIPNAT(ctx, routerID, fip.IPAddress, internalIP); err != nil {
			logger.Error("Failed to create OVN NAT rule", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create NAT rule: %w", err))
		}
	}

	// Update floating IP
	fip.Assignment = domain.FloatingIPAssignment{
		PortID:  req.Msg.PortId,
		FixedIP: internalIP,
	}
	fip.Status.Phase = domain.FloatingIPPhaseActive
	fip.Status.VMID = port.Status.VMID
	fip.UpdatedAt = time.Now()

	updatedFip, err := s.repo.Update(ctx, fip)
	if err != nil {
		logger.Error("Failed to update floating IP", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Floating IP associated",
		zap.String("ip", fip.IPAddress),
		zap.String("internal_ip", internalIP),
		zap.String("port_id", req.Msg.PortId),
	)

	return connect.NewResponse(s.toProto(updatedFip)), nil
}

// DisassociateFloatingIp removes a floating IP assignment.
func (s *FloatingIpService) DisassociateFloatingIp(
	ctx context.Context,
	req *connect.Request[networkv1.DisassociateFloatingIpRequest],
) (*connect.Response[networkv1.FloatingIp], error) {
	logger := s.logger.With(
		zap.String("method", "DisassociateFloatingIp"),
		zap.String("fip_id", req.Msg.FloatingIpId),
	)
	logger.Info("Disassociating floating IP")

	fip, err := s.repo.Get(ctx, req.Msg.FloatingIpId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if err := s.disassociate(ctx, fip); err != nil {
		logger.Error("Failed to disassociate floating IP", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Refresh from repo
	updatedFip, err := s.repo.Get(ctx, req.Msg.FloatingIpId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Floating IP disassociated", zap.String("ip", fip.IPAddress))
	return connect.NewResponse(s.toProto(updatedFip)), nil
}

// disassociate removes the NAT rule and clears the assignment.
func (s *FloatingIpService) disassociate(ctx context.Context, fip *domain.FloatingIP) error {
	if !fip.IsAssigned() {
		return nil
	}

	// Remove NAT rule from OVN
	if s.ovnClient != nil {
		if err := s.ovnClient.DeleteFloatingIPNAT(ctx, fip.IPAddress); err != nil {
			s.logger.Warn("Failed to delete OVN NAT rule", zap.Error(err))
			// Continue anyway
		}
	}

	// Clear assignment
	fip.Assignment = domain.FloatingIPAssignment{}
	fip.Status.Phase = domain.FloatingIPPhaseDown
	fip.Status.VMID = ""
	fip.UpdatedAt = time.Now()

	_, err := s.repo.Update(ctx, fip)
	return err
}

// updateStatus updates the floating IP status.
func (s *FloatingIpService) updateStatus(ctx context.Context, fip *domain.FloatingIP) error {
	_, err := s.repo.Update(ctx, fip)
	return err
}

// toProto converts domain FloatingIP to proto.
func (s *FloatingIpService) toProto(fip *domain.FloatingIP) *networkv1.FloatingIp {
	phase := networkv1.FloatingIpStatus_UNKNOWN
	switch fip.Status.Phase {
	case domain.FloatingIPPhasePending:
		phase = networkv1.FloatingIpStatus_PENDING
	case domain.FloatingIPPhaseActive:
		phase = networkv1.FloatingIpStatus_ACTIVE
	case domain.FloatingIPPhaseDown:
		phase = networkv1.FloatingIpStatus_DOWN
	case domain.FloatingIPPhaseError:
		phase = networkv1.FloatingIpStatus_ERROR
	}

	return &networkv1.FloatingIp{
		Id:                fip.ID,
		IpAddress:         fip.IPAddress,
		ExternalNetworkId: fip.ExternalNetworkID,
		ProjectId:         fip.ProjectID,
		Description:       fip.Description,
		Labels:            fip.Labels,
		Assignment: &networkv1.FloatingIpAssignment{
			PortId:  fip.Assignment.PortID,
			FixedIp: fip.Assignment.FixedIP,
		},
		Status: &networkv1.FloatingIpStatus{
			Phase:        phase,
			VmId:         fip.Status.VMID,
			RouterId:     fip.Status.RouterID,
			ErrorMessage: fip.Status.ErrorMessage,
		},
		CreatedAt: timestamppb.New(fip.CreatedAt),
		UpdatedAt: timestamppb.New(fip.UpdatedAt),
	}
}
