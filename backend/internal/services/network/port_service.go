// Package network implements the PortService for managing network ports.
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

// =============================================================================
// PORT SERVICE
// =============================================================================

// PortService implements the networkv1connect.PortServiceHandler interface.
type PortService struct {
	repo        PortRepository
	networkRepo NetworkRepository
	ipam        *IPAMService
	ovnClient   *ovn.NorthboundClient
	logger      *zap.Logger
}

// PortRepository defines the interface for port persistence.
type PortRepository interface {
	Create(ctx context.Context, port *domain.Port) (*domain.Port, error)
	Get(ctx context.Context, id string) (*domain.Port, error)
	List(ctx context.Context, filter PortFilter, limit, offset int) ([]*domain.Port, int, error)
	Update(ctx context.Context, port *domain.Port) (*domain.Port, error)
	Delete(ctx context.Context, id string) error
	UpdateStatus(ctx context.Context, id string, status domain.PortStatus) error
}

// PortFilter defines filters for listing ports.
type PortFilter struct {
	NetworkID string
	ProjectID string
	VMID      string
	Phase     domain.PortPhase
}

// NewPortService creates a new PortService.
func NewPortService(
	repo PortRepository,
	networkRepo NetworkRepository,
	ipam *IPAMService,
	logger *zap.Logger,
) *PortService {
	return &PortService{
		repo:        repo,
		networkRepo: networkRepo,
		ipam:        ipam,
		logger:      logger.Named("port-service"),
	}
}

// NewPortServiceWithOVN creates a new PortService with OVN integration.
func NewPortServiceWithOVN(
	repo PortRepository,
	networkRepo NetworkRepository,
	ipam *IPAMService,
	ovnClient *ovn.NorthboundClient,
	logger *zap.Logger,
) *PortService {
	svc := NewPortService(repo, networkRepo, ipam, logger)
	svc.ovnClient = ovnClient
	return svc
}

// =============================================================================
// CRUD OPERATIONS
// =============================================================================

// CreatePort creates a new network port with automatic IP allocation.
func (s *PortService) CreatePort(
	ctx context.Context,
	req *connect.Request[networkv1.CreatePortRequest],
) (*connect.Response[networkv1.Port], error) {
	logger := s.logger.With(
		zap.String("method", "CreatePort"),
		zap.String("network_id", req.Msg.NetworkId),
		zap.String("name", req.Msg.Name),
	)
	logger.Info("Creating network port")

	// Validate request
	if req.Msg.NetworkId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("network_id is required"))
	}

	// Get network to verify it exists
	network, err := s.networkRepo.Get(ctx, req.Msg.NetworkId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("network not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Generate port ID
	portID := uuid.New().String()

	// Allocate IP address using IPAM
	var ipResult *AllocateIPResult
	var macAddress string

	if req.Msg.Spec != nil && req.Msg.Spec.MacAddress != "" {
		// Use provided MAC address
		macAddress = req.Msg.Spec.MacAddress
		ipResult, err = s.ipam.AllocateWithMAC(ctx, req.Msg.NetworkId, portID, macAddress)
	} else if req.Msg.Spec != nil && len(req.Msg.Spec.FixedIps) > 0 && req.Msg.Spec.FixedIps[0].IpAddress != "" {
		// Allocate specific IP
		specificIP := req.Msg.Spec.FixedIps[0].IpAddress
		ipResult, err = s.ipam.AllocateSpecificIP(ctx, req.Msg.NetworkId, portID, specificIP)
	} else {
		// Auto-allocate IP and MAC
		ipResult, err = s.ipam.AllocateIP(ctx, req.Msg.NetworkId, portID)
	}

	if err != nil {
		logger.Error("Failed to allocate IP", zap.Error(err))
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("failed to allocate IP: %w", err))
	}

	macAddress = ipResult.MACAddress

	// Build port domain object
	port := &domain.Port{
		ID:        portID,
		Name:      req.Msg.Name,
		NetworkID: req.Msg.NetworkId,
		ProjectID: network.ProjectID,
		Labels:    req.Msg.Labels,
		Spec: domain.PortSpec{
			MACAddress: macAddress,
			FixedIPs: []domain.FixedIP{
				{
					IPAddress: ipResult.IPAddress,
				},
			},
			PortSecurityEnabled: true,
			AdminStateUp:        true,
		},
		Status: domain.PortStatus{
			Phase:       domain.PortPhasePending,
			MACAddress:  macAddress,
			IPAddresses: []string{ipResult.IPAddress},
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Apply spec overrides
	if req.Msg.Spec != nil {
		if len(req.Msg.Spec.SecurityGroupIds) > 0 {
			port.Spec.SecurityGroupIDs = req.Msg.Spec.SecurityGroupIds
		}
		if req.Msg.Spec.AdminStateUp != nil {
			port.Spec.AdminStateUp = *req.Msg.Spec.AdminStateUp
		}
	}

	// Create port in repository
	createdPort, err := s.repo.Create(ctx, port)
	if err != nil {
		// Rollback IP allocation
		if rollbackErr := s.ipam.ReleaseIP(ctx, req.Msg.NetworkId, portID); rollbackErr != nil {
			logger.Warn("Failed to rollback IP allocation", zap.Error(rollbackErr))
		}
		logger.Error("Failed to create port", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create OVN logical switch port
	if s.ovnClient != nil {
		lsp, err := s.ovnClient.CreateLogicalSwitchPort(ctx, createdPort)
		if err != nil {
			logger.Error("Failed to create OVN port", zap.Error(err))
			createdPort.Status.Phase = domain.PortPhaseError
			createdPort.Status.ErrorMessage = fmt.Sprintf("OVN error: %v", err)
		} else {
			createdPort.Status.Phase = domain.PortPhaseBuild
			createdPort.Status.OVNPort = lsp.Name

			// Apply security groups to port
			for _, sgID := range createdPort.Spec.SecurityGroupIDs {
				if err := s.ovnClient.ApplySecurityGroupToPort(ctx, createdPort.ID, sgID); err != nil {
					logger.Warn("Failed to apply security group to port",
						zap.String("sg_id", sgID),
						zap.Error(err),
					)
				}
			}
		}
	} else {
		// Mock mode - mark as build
		createdPort.Status.Phase = domain.PortPhaseBuild
		createdPort.Status.OVNPort = fmt.Sprintf("lsp-%s", createdPort.ID[:8])
	}

	// Update port status
	if err := s.repo.UpdateStatus(ctx, createdPort.ID, createdPort.Status); err != nil {
		logger.Warn("Failed to update port status", zap.Error(err))
	}

	// Update network port count
	network.Status.PortCount++
	if err := s.networkRepo.UpdateStatus(ctx, network.ID, network.Status); err != nil {
		logger.Warn("Failed to update network port count", zap.Error(err))
	}

	logger.Info("Network port created",
		zap.String("port_id", createdPort.ID),
		zap.String("ip_address", ipResult.IPAddress),
		zap.String("mac_address", macAddress),
	)

	return connect.NewResponse(convertPortToProto(createdPort)), nil
}

// GetPort retrieves a port by ID.
func (s *PortService) GetPort(
	ctx context.Context,
	req *connect.Request[networkv1.GetPortRequest],
) (*connect.Response[networkv1.Port], error) {
	logger := s.logger.With(
		zap.String("method", "GetPort"),
		zap.String("port_id", req.Msg.Id),
	)
	logger.Debug("Getting network port")

	port, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(convertPortToProto(port)), nil
}

// ListPorts returns ports matching the filter.
func (s *PortService) ListPorts(
	ctx context.Context,
	req *connect.Request[networkv1.ListPortsRequest],
) (*connect.Response[networkv1.ListPortsResponse], error) {
	logger := s.logger.With(zap.String("method", "ListPorts"))
	logger.Debug("Listing network ports")

	filter := PortFilter{
		NetworkID: req.Msg.NetworkId,
		ProjectID: req.Msg.ProjectId,
	}

	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	ports, total, err := s.repo.List(ctx, filter, limit, 0)
	if err != nil {
		logger.Error("Failed to list ports", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&networkv1.ListPortsResponse{
		Ports:      convertPortsToProtos(ports),
		TotalCount: int32(total),
	}), nil
}

// UpdatePort updates port configuration.
func (s *PortService) UpdatePort(
	ctx context.Context,
	req *connect.Request[networkv1.UpdatePortRequest],
) (*connect.Response[networkv1.Port], error) {
	logger := s.logger.With(
		zap.String("method", "UpdatePort"),
		zap.String("port_id", req.Msg.Id),
	)
	logger.Info("Updating network port")

	port, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Apply updates
	if req.Msg.Name != "" {
		port.Name = req.Msg.Name
	}
	if req.Msg.Labels != nil {
		port.Labels = req.Msg.Labels
	}
	if req.Msg.Spec != nil {
		if len(req.Msg.Spec.SecurityGroupIds) > 0 {
			port.Spec.SecurityGroupIDs = req.Msg.Spec.SecurityGroupIds
		}
		if req.Msg.Spec.AdminStateUp != nil {
			port.Spec.AdminStateUp = *req.Msg.Spec.AdminStateUp
		}
	}
	port.UpdatedAt = time.Now()

	updatedPort, err := s.repo.Update(ctx, port)
	if err != nil {
		logger.Error("Failed to update port", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Network port updated", zap.String("port_id", updatedPort.ID))
	return connect.NewResponse(convertPortToProto(updatedPort)), nil
}

// DeletePort removes a port.
func (s *PortService) DeletePort(
	ctx context.Context,
	req *connect.Request[networkv1.DeletePortRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeletePort"),
		zap.String("port_id", req.Msg.Id),
	)
	logger.Info("Deleting network port")

	port, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if port is bound to a VM
	if port.Status.VMID != "" && !req.Msg.Force {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("port is bound to VM %s, use force=true to delete", port.Status.VMID))
	}

	// Delete from OVN
	if s.ovnClient != nil {
		if err := s.ovnClient.DeleteLogicalSwitchPort(ctx, req.Msg.Id); err != nil {
			logger.Warn("Failed to delete OVN port", zap.Error(err))
		}
	}

	// Release IP allocation
	if err := s.ipam.ReleaseIP(ctx, port.NetworkID, req.Msg.Id); err != nil {
		logger.Warn("Failed to release IP", zap.Error(err))
	}

	// Delete from repository
	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete port", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Update network port count
	network, err := s.networkRepo.Get(ctx, port.NetworkID)
	if err == nil && network.Status.PortCount > 0 {
		network.Status.PortCount--
		if err := s.networkRepo.UpdateStatus(ctx, network.ID, network.Status); err != nil {
			logger.Warn("Failed to update network port count", zap.Error(err))
		}
	}

	logger.Info("Network port deleted", zap.String("port_id", req.Msg.Id))
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// =============================================================================
// PORT BINDING OPERATIONS
// =============================================================================

// BindPort assigns a port to a VM.
func (s *PortService) BindPort(
	ctx context.Context,
	req *connect.Request[networkv1.BindPortRequest],
) (*connect.Response[networkv1.Port], error) {
	logger := s.logger.With(
		zap.String("method", "BindPort"),
		zap.String("port_id", req.Msg.PortId),
		zap.String("vm_id", req.Msg.VmId),
	)
	logger.Info("Binding port to VM")

	if req.Msg.PortId == "" || req.Msg.VmId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("port_id and vm_id are required"))
	}

	port, err := s.repo.Get(ctx, req.Msg.PortId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if already bound
	if port.Status.VMID != "" && port.Status.VMID != req.Msg.VmId {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("port is already bound to VM %s", port.Status.VMID))
	}

	// Update port status
	port.Status.VMID = req.Msg.VmId
	port.Status.HostID = req.Msg.HostId
	port.Status.Phase = domain.PortPhaseBuild
	port.UpdatedAt = time.Now()

	// Update OVN port binding
	if s.ovnClient != nil {
		if err := s.ovnClient.BindPort(ctx, req.Msg.PortId, req.Msg.VmId, req.Msg.HostId); err != nil {
			logger.Warn("Failed to update OVN port binding", zap.Error(err))
		}
	}

	if err := s.repo.UpdateStatus(ctx, port.ID, port.Status); err != nil {
		logger.Error("Failed to update port status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Port bound to VM",
		zap.String("port_id", port.ID),
		zap.String("vm_id", req.Msg.VmId),
		zap.String("host_id", req.Msg.HostId),
	)

	return connect.NewResponse(convertPortToProto(port)), nil
}

// UnbindPort removes port assignment.
func (s *PortService) UnbindPort(
	ctx context.Context,
	req *connect.Request[networkv1.UnbindPortRequest],
) (*connect.Response[networkv1.Port], error) {
	logger := s.logger.With(
		zap.String("method", "UnbindPort"),
		zap.String("port_id", req.Msg.PortId),
	)
	logger.Info("Unbinding port from VM")

	port, err := s.repo.Get(ctx, req.Msg.PortId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Update port status
	port.Status.VMID = ""
	port.Status.HostID = ""
	port.Status.Phase = domain.PortPhaseDown
	port.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, port.ID, port.Status); err != nil {
		logger.Error("Failed to update port status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Port unbound from VM", zap.String("port_id", port.ID))
	return connect.NewResponse(convertPortToProto(port)), nil
}

// =============================================================================
// CONVERTERS
// =============================================================================

// convertPortToProto converts a domain.Port to a proto Port.
func convertPortToProto(port *domain.Port) *networkv1.Port {
	if port == nil {
		return nil
	}

	// Convert fixed IPs
	var fixedIPs []*networkv1.FixedIp
	for _, fip := range port.Spec.FixedIPs {
		fixedIPs = append(fixedIPs, &networkv1.FixedIp{
			SubnetId:  fip.SubnetID,
			IpAddress: fip.IPAddress,
		})
	}

	// Convert QoS
	var qos *networkv1.PortQos
	if port.Spec.QoS.IngressRateKbps > 0 || port.Spec.QoS.EgressRateKbps > 0 {
		qos = &networkv1.PortQos{
			IngressRateKbps: port.Spec.QoS.IngressRateKbps,
			EgressRateKbps:  port.Spec.QoS.EgressRateKbps,
			IngressBurstKb:  port.Spec.QoS.IngressBurstKb,
			EgressBurstKb:   port.Spec.QoS.EgressBurstKb,
		}
	}

	return &networkv1.Port{
		Id:        port.ID,
		Name:      port.Name,
		NetworkId: port.NetworkID,
		ProjectId: port.ProjectID,
		Labels:    port.Labels,
		Spec: &networkv1.PortSpec{
			MacAddress:          port.Spec.MACAddress,
			FixedIps:            fixedIPs,
			SecurityGroupIds:    port.Spec.SecurityGroupIDs,
			PortSecurityEnabled: &port.Spec.PortSecurityEnabled,
			AdminStateUp:        &port.Spec.AdminStateUp,
			Qos:                 qos,
		},
		Status: &networkv1.PortStatus{
			Phase:       convertPortPhaseToProto(port.Status.Phase),
			MacAddress:  port.Status.MACAddress,
			IpAddresses: port.Status.IPAddresses,
			OvnPort:     port.Status.OVNPort,
			VmId:        port.Status.VMID,
			HostId:      port.Status.HostID,
		},
		CreatedAt: timestamppb.New(port.CreatedAt),
		UpdatedAt: timestamppb.New(port.UpdatedAt),
	}
}

// convertPortsToProtos converts a slice of domain.Port to proto Ports.
func convertPortsToProtos(ports []*domain.Port) []*networkv1.Port {
	result := make([]*networkv1.Port, len(ports))
	for i, port := range ports {
		result[i] = convertPortToProto(port)
	}
	return result
}

// convertPortPhaseToProto converts domain.PortPhase to proto.
func convertPortPhaseToProto(phase domain.PortPhase) networkv1.PortPhase {
	switch phase {
	case domain.PortPhasePending:
		return networkv1.PortPhase_PORT_PHASE_PENDING
	case domain.PortPhaseBuild:
		return networkv1.PortPhase_PORT_PHASE_BUILD
	case domain.PortPhaseActive:
		return networkv1.PortPhase_PORT_PHASE_ACTIVE
	case domain.PortPhaseDown:
		return networkv1.PortPhase_PORT_PHASE_DOWN
	case domain.PortPhaseError:
		return networkv1.PortPhase_PORT_PHASE_ERROR
	default:
		return networkv1.PortPhase_PORT_PHASE_UNSPECIFIED
	}
}
