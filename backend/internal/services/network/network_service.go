// Package network implements the VirtualNetworkService.
package network

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// NetworkService implements the networkv1connect.VirtualNetworkServiceHandler interface.
type NetworkService struct {
	repo      NetworkRepository
	ovnClient *ovn.NorthboundClient
	logger    *zap.Logger
}

// NewNetworkService creates a new NetworkService.
func NewNetworkService(repo NetworkRepository, logger *zap.Logger) *NetworkService {
	return &NetworkService{
		repo:   repo,
		logger: logger,
	}
}

// NewNetworkServiceWithOVN creates a new NetworkService with OVN backend.
func NewNetworkServiceWithOVN(repo NetworkRepository, ovnClient *ovn.NorthboundClient, logger *zap.Logger) *NetworkService {
	return &NetworkService{
		repo:      repo,
		ovnClient: ovnClient,
		logger:    logger,
	}
}

// CreateNetwork creates a new virtual network.
func (s *NetworkService) CreateNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.CreateNetworkRequest],
) (*connect.Response[networkv1.VirtualNetwork], error) {
	logger := s.logger.With(
		zap.String("method", "CreateNetwork"),
		zap.String("network_name", req.Msg.Name),
	)
	logger.Info("Creating virtual network")

	// Validate request
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}
	if req.Msg.Spec == nil || req.Msg.Spec.IpConfig == nil || req.Msg.Spec.IpConfig.Ipv4Subnet == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("ipv4_subnet is required"))
	}

	// Convert to domain model
	network := convertCreateNetworkRequestToDomain(req.Msg)
	if network.Spec.MTU == 0 {
		network.Spec.MTU = 1500 // Default MTU
	}

	// Create in repository
	createdNetwork, err := s.repo.Create(ctx, network)
	if err != nil {
		logger.Error("Failed to create network", zap.Error(err))
		if err == domain.ErrAlreadyExists {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create network in OVN if client is available
	if s.ovnClient != nil {
		ls, err := s.ovnClient.CreateLogicalSwitch(ctx, createdNetwork)
		if err != nil {
			logger.Error("Failed to create OVN logical switch", zap.Error(err))
			createdNetwork.Status.Phase = domain.NetworkPhaseError
			createdNetwork.Status.ErrorMessage = fmt.Sprintf("OVN error: %v", err)
		} else {
			createdNetwork.Status.Phase = domain.NetworkPhaseReady
			createdNetwork.Status.OVNLogicalSwitch = ls.Name

			// Create VLAN localnet port if this is a VLAN network
			if createdNetwork.Spec.Type == domain.NetworkTypeVLAN && createdNetwork.Spec.VLAN != nil {
				_, err := s.ovnClient.CreateLocalnetPort(ctx, createdNetwork.ID,
					createdNetwork.Spec.VLAN.VLANID, createdNetwork.Spec.VLAN.PhysicalNetwork)
				if err != nil {
					logger.Warn("Failed to create localnet port", zap.Error(err))
				}
			}

			// Create router attachment if router is enabled
			if createdNetwork.Spec.Router != nil && createdNetwork.Spec.Router.Enabled {
				gateway := fmt.Sprintf("%s/%s",
					createdNetwork.Spec.IPConfig.IPv4Gateway,
					extractCIDRMask(createdNetwork.Spec.IPConfig.IPv4Subnet))

				routerID := fmt.Sprintf("project-%s", createdNetwork.ProjectID)
				lrp, err := s.ovnClient.AddRouterInterface(ctx, routerID, createdNetwork.ID, gateway)
				if err != nil {
					logger.Warn("Failed to add router interface", zap.Error(err))
				} else {
					createdNetwork.Status.OVNLogicalRouter = lrp.Name
				}
			}
		}
	} else {
		// Mock mode - simulate network becoming ready
		createdNetwork.Status.Phase = domain.NetworkPhaseReady
		createdNetwork.Status.OVNLogicalSwitch = fmt.Sprintf("ls-%s", createdNetwork.ID[:8])
	}

	// Calculate IP allocation status
	createdNetwork.Status.IPAllocationStatus = domain.IPAllocationStatus{
		IPv4Total:     calculateIPCount(createdNetwork.Spec.IPConfig.IPv4Subnet),
		IPv4Available: calculateIPCount(createdNetwork.Spec.IPConfig.IPv4Subnet),
	}

	if err := s.repo.UpdateStatus(ctx, createdNetwork.ID, createdNetwork.Status); err != nil {
		logger.Warn("Failed to update network status", zap.Error(err))
	}

	logger.Info("Virtual network created successfully", zap.String("network_id", createdNetwork.ID))
	return connect.NewResponse(convertNetworkToProto(createdNetwork)), nil
}

// GetNetwork retrieves a virtual network by ID.
func (s *NetworkService) GetNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.GetNetworkRequest],
) (*connect.Response[networkv1.VirtualNetwork], error) {
	logger := s.logger.With(
		zap.String("method", "GetNetwork"),
		zap.String("network_id", req.Msg.Id),
	)
	logger.Debug("Getting virtual network")

	network, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(convertNetworkToProto(network)), nil
}

// ListNetworks returns all virtual networks matching the filter.
func (s *NetworkService) ListNetworks(
	ctx context.Context,
	req *connect.Request[networkv1.ListNetworksRequest],
) (*connect.Response[networkv1.ListNetworksResponse], error) {
	logger := s.logger.With(zap.String("method", "ListNetworks"))
	logger.Debug("Listing virtual networks")

	filter := convertNetworkFilterFromProto(req.Msg)
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	networks, total, err := s.repo.List(ctx, filter, limit, 0)
	if err != nil {
		logger.Error("Failed to list networks", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&networkv1.ListNetworksResponse{
		Networks:   convertNetworksToProtos(networks),
		TotalCount: int32(total),
	}), nil
}

// UpdateNetwork updates a virtual network configuration.
func (s *NetworkService) UpdateNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.UpdateNetworkRequest],
) (*connect.Response[networkv1.VirtualNetwork], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateNetwork"),
		zap.String("network_id", req.Msg.Id),
	)
	logger.Info("Updating virtual network")

	network, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Apply updates
	if req.Msg.Description != "" {
		network.Description = req.Msg.Description
	}
	if req.Msg.Labels != nil {
		network.Labels = req.Msg.Labels
	}
	if req.Msg.Spec != nil {
		network.Spec = *convertNetworkSpecFromProto(req.Msg.Spec)
	}
	network.UpdatedAt = time.Now()

	updatedNetwork, err := s.repo.Update(ctx, network)
	if err != nil {
		logger.Error("Failed to update network", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Virtual network updated successfully", zap.String("network_id", updatedNetwork.ID))
	return connect.NewResponse(convertNetworkToProto(updatedNetwork)), nil
}

// DeleteNetwork removes a virtual network.
func (s *NetworkService) DeleteNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteNetworkRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteNetwork"),
		zap.String("network_id", req.Msg.Id),
	)
	logger.Info("Deleting virtual network")

	// Check if network has ports
	network, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if network.Status.PortCount > 0 && !req.Msg.Force {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("network has %d ports, use force=true to delete", network.Status.PortCount))
	}

	// Delete from OVN if client is available
	if s.ovnClient != nil {
		if err := s.ovnClient.DeleteLogicalSwitch(ctx, req.Msg.Id); err != nil {
			logger.Warn("Failed to delete OVN logical switch", zap.Error(err))
			// Continue with repo deletion even if OVN fails
		}
	}

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete network", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Virtual network deleted successfully", zap.String("network_id", req.Msg.Id))
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// GetNetworkTopology returns the network topology graph.
func (s *NetworkService) GetNetworkTopology(
	ctx context.Context,
	req *connect.Request[networkv1.GetNetworkTopologyRequest],
) (*connect.Response[networkv1.NetworkTopology], error) {
	logger := s.logger.With(
		zap.String("method", "GetNetworkTopology"),
		zap.String("project_id", req.Msg.ProjectId),
	)
	logger.Debug("Getting network topology")

	// Get all networks for the project
	filter := NetworkFilter{ProjectID: req.Msg.ProjectId}
	networks, _, err := s.repo.List(ctx, filter, 1000, 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Build topology graph
	var nodes []*networkv1.NetworkNode
	var edges []*networkv1.NetworkEdge

	for _, net := range networks {
		nodes = append(nodes, &networkv1.NetworkNode{
			Id:   net.ID,
			Type: "network",
			Name: net.Name,
			Properties: map[string]string{
				"subnet": net.Spec.IPConfig.IPv4Subnet,
				"type":   string(net.Spec.Type),
			},
		})

		// If network has router, add router node and edge
		if net.Spec.Router != nil && net.Spec.Router.Enabled {
			routerID := fmt.Sprintf("router-%s", net.ID[:8])
			nodes = append(nodes, &networkv1.NetworkNode{
				Id:   routerID,
				Type: "router",
				Name: fmt.Sprintf("Router for %s", net.Name),
			})
			edges = append(edges, &networkv1.NetworkEdge{
				SourceId: net.ID,
				TargetId: routerID,
				Type:     "route",
			})
		}
	}

	return connect.NewResponse(&networkv1.NetworkTopology{
		Nodes: nodes,
		Edges: edges,
	}), nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// calculateIPCount calculates the number of usable IPs in a CIDR subnet.
func calculateIPCount(cidr string) uint32 {
	if cidr == "" {
		return 0
	}

	// Parse CIDR to get mask bits
	_, ipNet, err := net.ParseCIDR(cidr)
	if err != nil {
		return 254 // Default to /24
	}

	ones, bits := ipNet.Mask.Size()
	if bits == 0 {
		return 254
	}

	// Calculate total IPs and subtract network/broadcast
	total := uint32(1 << uint(bits-ones))
	if total < 4 {
		return 1
	}
	return total - 2 // Subtract network and broadcast addresses
}

// extractCIDRMask extracts the mask portion from a CIDR (e.g., "24" from "10.0.0.0/24").
func extractCIDRMask(cidr string) string {
	parts := strings.Split(cidr, "/")
	if len(parts) == 2 {
		return parts[1]
	}
	return "24" // Default
}
