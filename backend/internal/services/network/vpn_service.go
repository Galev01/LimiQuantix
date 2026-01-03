// Package network implements the VpnService (WireGuard Bastion).
package network

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// VpnService implements the networkv1connect.VpnServiceHandler interface.
// It provides WireGuard-based VPN access to overlay networks ("Bastion" mode).
type VpnService struct {
	repo   VpnRepository
	logger *zap.Logger
}

// VpnRepository defines the interface for VPN service storage.
type VpnRepository interface {
	Create(ctx context.Context, vpn *domain.VpnService) (*domain.VpnService, error)
	Get(ctx context.Context, id string) (*domain.VpnService, error)
	List(ctx context.Context, projectID string, limit, offset int) ([]*domain.VpnService, int, error)
	Update(ctx context.Context, vpn *domain.VpnService) (*domain.VpnService, error)
	Delete(ctx context.Context, id string) error
}

// NewVpnService creates a new VpnService.
func NewVpnService(repo VpnRepository, logger *zap.Logger) *VpnService {
	return &VpnService{
		repo:   repo,
		logger: logger,
	}
}

// CreateVpnService creates a new VPN service (WireGuard gateway).
func (s *VpnService) CreateVpnService(
	ctx context.Context,
	req *connect.Request[networkv1.CreateVpnServiceRequest],
) (*connect.Response[networkv1.VpnService], error) {
	logger := s.logger.With(
		zap.String("method", "CreateVpnService"),
		zap.String("vpn_name", req.Msg.Name),
	)
	logger.Info("Creating VPN service")

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}
	if req.Msg.NetworkId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("network_id is required"))
	}

	// Generate WireGuard keypair
	privateKey, publicKey, err := generateWireGuardKeyPair()
	if err != nil {
		logger.Error("Failed to generate WireGuard keys", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to generate keys"))
	}

	vpn := &domain.VpnService{
		ID:          uuid.NewString(),
		Name:        req.Msg.Name,
		NetworkID:   req.Msg.NetworkId,
		ProjectID:   req.Msg.ProjectId,
		Description: req.Msg.Description,
		Labels:      req.Msg.Labels,
		Spec: domain.VpnServiceSpec{
			Type:         domain.VPNTypeWireGuard,
			RouterID:     req.Msg.RouterId,
			ExternalIP:   req.Msg.ExternalIp,
			LocalSubnets: req.Msg.LocalSubnets,
			Connections:  []domain.VpnConnection{},
		},
		Status: domain.VpnServiceStatus{
			Phase:      domain.VPNPhasePending,
			PublicKey:  publicKey,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store private key securely (in real impl, use secrets manager)
	_ = privateKey

	createdVPN, err := s.repo.Create(ctx, vpn)
	if err != nil {
		logger.Error("Failed to create VPN service", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// TODO: Deploy WireGuard container/pod on the network's gateway node
	// For now, mark as active
	createdVPN.Status.Phase = domain.VPNPhaseActive
	if _, err := s.repo.Update(ctx, createdVPN); err != nil {
		logger.Warn("Failed to update VPN status", zap.Error(err))
	}

	logger.Info("VPN service created", zap.String("vpn_id", createdVPN.ID))
	return connect.NewResponse(s.toProto(createdVPN)), nil
}

// GetVpnService retrieves a VPN service by ID.
func (s *VpnService) GetVpnService(
	ctx context.Context,
	req *connect.Request[networkv1.GetVpnServiceRequest],
) (*connect.Response[networkv1.VpnService], error) {
	vpn, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(s.toProto(vpn)), nil
}

// ListVpnServices returns all VPN services.
func (s *VpnService) ListVpnServices(
	ctx context.Context,
	req *connect.Request[networkv1.ListVpnServicesRequest],
) (*connect.Response[networkv1.ListVpnServicesResponse], error) {
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	vpns, total, err := s.repo.List(ctx, req.Msg.ProjectId, limit, 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var protoVPNs []*networkv1.VpnService
	for _, vpn := range vpns {
		protoVPNs = append(protoVPNs, s.toProto(vpn))
	}

	return connect.NewResponse(&networkv1.ListVpnServicesResponse{
		VpnServices: protoVPNs,
		TotalCount:  int32(total),
	}), nil
}

// UpdateVpnService updates a VPN service.
func (s *VpnService) UpdateVpnService(
	ctx context.Context,
	req *connect.Request[networkv1.UpdateVpnServiceRequest],
) (*connect.Response[networkv1.VpnService], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateVpnService"),
		zap.String("vpn_id", req.Msg.Id),
	)
	logger.Info("Updating VPN service")

	vpn, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if req.Msg.Description != "" {
		vpn.Description = req.Msg.Description
	}
	if req.Msg.Labels != nil {
		vpn.Labels = req.Msg.Labels
	}
	vpn.UpdatedAt = time.Now()

	updatedVPN, err := s.repo.Update(ctx, vpn)
	if err != nil {
		logger.Error("Failed to update VPN service", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedVPN)), nil
}

// DeleteVpnService removes a VPN service.
func (s *VpnService) DeleteVpnService(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteVpnServiceRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteVpnService"),
		zap.String("vpn_id", req.Msg.Id),
	)
	logger.Info("Deleting VPN service")

	// TODO: Remove WireGuard container/pod

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete VPN service", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("VPN service deleted")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AddConnection adds a peer connection (client) to the VPN service.
func (s *VpnService) AddConnection(
	ctx context.Context,
	req *connect.Request[networkv1.AddVpnConnectionRequest],
) (*connect.Response[networkv1.VpnService], error) {
	logger := s.logger.With(
		zap.String("method", "AddConnection"),
		zap.String("vpn_id", req.Msg.VpnServiceId),
	)
	logger.Info("Adding VPN connection")

	vpn, err := s.repo.Get(ctx, req.Msg.VpnServiceId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	connection := domain.VpnConnection{
		ID:            uuid.NewString(),
		Name:          req.Msg.Name,
		PeerAddress:   req.Msg.PeerAddress,
		PeerCIDRs:     req.Msg.PeerCidrs,
		PeerPublicKey: req.Msg.PeerPublicKey,
		Status:        "pending",
	}

	vpn.Spec.Connections = append(vpn.Spec.Connections, connection)
	vpn.UpdatedAt = time.Now()

	// TODO: Update WireGuard config to add peer

	updatedVPN, err := s.repo.Update(ctx, vpn)
	if err != nil {
		logger.Error("Failed to update VPN service", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Mark connection as active
	for i := range updatedVPN.Spec.Connections {
		if updatedVPN.Spec.Connections[i].ID == connection.ID {
			updatedVPN.Spec.Connections[i].Status = "active"
		}
	}
	_, _ = s.repo.Update(ctx, updatedVPN)

	logger.Info("VPN connection added", zap.String("connection_id", connection.ID))
	return connect.NewResponse(s.toProto(updatedVPN)), nil
}

// RemoveConnection removes a peer connection from the VPN service.
func (s *VpnService) RemoveConnection(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveVpnConnectionRequest],
) (*connect.Response[networkv1.VpnService], error) {
	logger := s.logger.With(
		zap.String("method", "RemoveConnection"),
		zap.String("vpn_id", req.Msg.VpnServiceId),
	)
	logger.Info("Removing VPN connection")

	vpn, err := s.repo.Get(ctx, req.Msg.VpnServiceId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove connection
	var newConnections []domain.VpnConnection
	found := false
	for _, c := range vpn.Spec.Connections {
		if c.ID == req.Msg.ConnectionId {
			found = true
			continue
		}
		newConnections = append(newConnections, c)
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("connection not found"))
	}

	vpn.Spec.Connections = newConnections
	vpn.UpdatedAt = time.Now()

	// TODO: Update WireGuard config to remove peer

	updatedVPN, err := s.repo.Update(ctx, vpn)
	if err != nil {
		logger.Error("Failed to update VPN service", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(s.toProto(updatedVPN)), nil
}

// GetStatus returns the VPN service status including connection info.
func (s *VpnService) GetStatus(
	ctx context.Context,
	req *connect.Request[networkv1.GetVpnStatusRequest],
) (*connect.Response[networkv1.VpnServiceStatus], error) {
	vpn, err := s.repo.Get(ctx, req.Msg.VpnServiceId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Get connection statuses
	var connections []*networkv1.VpnConnectionStatus
	for _, c := range vpn.Spec.Connections {
		connections = append(connections, &networkv1.VpnConnectionStatus{
			ConnectionId:  c.ID,
			Name:          c.Name,
			Status:        c.Status,
			LastHandshake: nil, // TODO: Get from WireGuard
			BytesIn:       0,
			BytesOut:      0,
		})
	}

	phase := networkv1.VpnServiceStatus_UNKNOWN
	switch vpn.Status.Phase {
	case domain.VPNPhasePending:
		phase = networkv1.VpnServiceStatus_PENDING
	case domain.VPNPhaseActive:
		phase = networkv1.VpnServiceStatus_ACTIVE
	case domain.VPNPhaseDown:
		phase = networkv1.VpnServiceStatus_DOWN
	case domain.VPNPhaseError:
		phase = networkv1.VpnServiceStatus_ERROR
	}

	return connect.NewResponse(&networkv1.VpnServiceStatus{
		Phase:        phase,
		PublicIp:     vpn.Spec.ExternalIP,
		PublicKey:    vpn.Status.PublicKey,
		ErrorMessage: vpn.Status.ErrorMessage,
		Connections:  connections,
	}), nil
}

// GetClientConfig generates a WireGuard client configuration for a peer.
func (s *VpnService) GetClientConfig(
	ctx context.Context,
	req *connect.Request[networkv1.GetVpnClientConfigRequest],
) (*connect.Response[networkv1.VpnClientConfig], error) {
	logger := s.logger.With(
		zap.String("method", "GetClientConfig"),
		zap.String("vpn_id", req.Msg.VpnServiceId),
	)

	vpn, err := s.repo.Get(ctx, req.Msg.VpnServiceId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find the connection
	var connection *domain.VpnConnection
	for i := range vpn.Spec.Connections {
		if vpn.Spec.Connections[i].ID == req.Msg.ConnectionId {
			connection = &vpn.Spec.Connections[i]
			break
		}
	}

	if connection == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("connection not found"))
	}

	// Generate WireGuard config
	config := fmt.Sprintf(`[Interface]
# Name: %s
PrivateKey = <YOUR_PRIVATE_KEY>
Address = %s

[Peer]
# LimiQuantix VPN Gateway
PublicKey = %s
Endpoint = %s:51820
AllowedIPs = %s
PersistentKeepalive = 25
`,
		connection.Name,
		connection.PeerAddress,
		vpn.Status.PublicKey,
		vpn.Spec.ExternalIP,
		formatAllowedIPs(vpn.Spec.LocalSubnets),
	)

	logger.Info("Generated client config", zap.String("connection_id", connection.ID))

	return connect.NewResponse(&networkv1.VpnClientConfig{
		Config:    config,
		PublicKey: vpn.Status.PublicKey,
		Endpoint:  fmt.Sprintf("%s:51820", vpn.Spec.ExternalIP),
	}), nil
}

// toProto converts domain VpnService to proto.
func (s *VpnService) toProto(vpn *domain.VpnService) *networkv1.VpnService {
	var connections []*networkv1.VpnConnection
	for _, c := range vpn.Spec.Connections {
		connections = append(connections, &networkv1.VpnConnection{
			Id:            c.ID,
			Name:          c.Name,
			PeerAddress:   c.PeerAddress,
			PeerCidrs:     c.PeerCIDRs,
			PeerPublicKey: c.PeerPublicKey,
			Status:        c.Status,
		})
	}

	vpnType := networkv1.VpnType_WIREGUARD
	if vpn.Spec.Type == domain.VPNTypeIPSec {
		vpnType = networkv1.VpnType_IPSEC
	}

	phase := networkv1.VpnServiceStatus_UNKNOWN
	switch vpn.Status.Phase {
	case domain.VPNPhasePending:
		phase = networkv1.VpnServiceStatus_PENDING
	case domain.VPNPhaseActive:
		phase = networkv1.VpnServiceStatus_ACTIVE
	case domain.VPNPhaseDown:
		phase = networkv1.VpnServiceStatus_DOWN
	case domain.VPNPhaseError:
		phase = networkv1.VpnServiceStatus_ERROR
	}

	return &networkv1.VpnService{
		Id:          vpn.ID,
		Name:        vpn.Name,
		NetworkId:   vpn.NetworkID,
		ProjectId:   vpn.ProjectID,
		Description: vpn.Description,
		Labels:      vpn.Labels,
		Spec: &networkv1.VpnServiceSpec{
			Type:         vpnType,
			RouterId:     vpn.Spec.RouterID,
			ExternalIp:   vpn.Spec.ExternalIP,
			LocalSubnets: vpn.Spec.LocalSubnets,
			Connections:  connections,
		},
		Status: &networkv1.VpnServiceStatus{
			Phase:        phase,
			PublicIp:     vpn.Spec.ExternalIP,
			PublicKey:    vpn.Status.PublicKey,
			ErrorMessage: vpn.Status.ErrorMessage,
		},
		CreatedAt: timestamppb.New(vpn.CreatedAt),
		UpdatedAt: timestamppb.New(vpn.UpdatedAt),
	}
}

// generateWireGuardKeyPair generates a WireGuard keypair.
func generateWireGuardKeyPair() (privateKey, publicKey string, err error) {
	// Generate 32 random bytes for private key
	privBytes := make([]byte, 32)
	if _, err := rand.Read(privBytes); err != nil {
		return "", "", fmt.Errorf("failed to generate random bytes: %w", err)
	}

	// Clamp the private key (WireGuard Curve25519 requirements)
	privBytes[0] &= 248
	privBytes[31] &= 127
	privBytes[31] |= 64

	privateKey = base64.StdEncoding.EncodeToString(privBytes)

	// TODO: Compute actual Curve25519 public key
	// For now, return a placeholder (in production, use golang.org/x/crypto/curve25519)
	pubBytes := make([]byte, 32)
	copy(pubBytes, privBytes) // Placeholder - not actual public key
	publicKey = base64.StdEncoding.EncodeToString(pubBytes)

	return privateKey, publicKey, nil
}

// formatAllowedIPs formats subnet list for WireGuard config.
func formatAllowedIPs(subnets []string) string {
	if len(subnets) == 0 {
		return "0.0.0.0/0"
	}
	result := ""
	for i, subnet := range subnets {
		if i > 0 {
			result += ", "
		}
		result += subnet
	}
	return result
}
