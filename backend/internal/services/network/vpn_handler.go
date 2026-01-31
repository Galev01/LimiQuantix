// Package network provides VPN service Connect-RPC handler.
// This handler wraps the VpnServiceManager business logic for gRPC exposure.
package network

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image/png"

	"connectrpc.com/connect"
	"github.com/skip2/go-qrcode"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// =============================================================================
// VPN SERVICE HANDLER - Connect-RPC Implementation
// =============================================================================

// VpnServiceHandler implements the VpnServiceManagerHandler interface for Connect-RPC.
type VpnServiceHandler struct {
	manager *VpnServiceManager
	repo    VpnRepository
	logger  *zap.Logger
}

// NewVpnServiceHandler creates a new VPN service handler.
func NewVpnServiceHandler(repo VpnRepository, logger *zap.Logger) *VpnServiceHandler {
	manager := NewVpnServiceManager(repo, logger)
	return &VpnServiceHandler{
		manager: manager,
		repo:    repo,
		logger:  logger.Named("vpn-handler"),
	}
}

// CreateVpn creates a new VPN service.
func (h *VpnServiceHandler) CreateVpn(
	ctx context.Context,
	req *connect.Request[networkv1.CreateVpnRequest],
) (*connect.Response[networkv1.VpnService], error) {
	msg := req.Msg

	h.logger.Info("Creating VPN service",
		zap.String("name", msg.Name),
		zap.String("project_id", msg.ProjectId),
	)

	vpn, err := h.manager.Create(ctx, CreateVPNRequest{
		Name:        msg.Name,
		NetworkID:   msg.RouterId, // Use router ID as network reference
		ProjectID:   msg.ProjectId,
		Description: msg.Description,
		RouterID:    msg.RouterId,
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create VPN: %w", err))
	}

	return connect.NewResponse(domainToProtoVpn(vpn)), nil
}

// GetVpn retrieves a VPN service by ID.
func (h *VpnServiceHandler) GetVpn(
	ctx context.Context,
	req *connect.Request[networkv1.GetVpnRequest],
) (*connect.Response[networkv1.VpnService], error) {
	vpn, err := h.manager.Get(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VPN service not found: %s", req.Msg.Id))
	}

	return connect.NewResponse(domainToProtoVpn(vpn)), nil
}

// ListVpns returns all VPN services.
func (h *VpnServiceHandler) ListVpns(
	ctx context.Context,
	req *connect.Request[networkv1.ListVpnsRequest],
) (*connect.Response[networkv1.ListVpnsResponse], error) {
	vpns, total, err := h.manager.List(ctx, req.Msg.ProjectId, int(req.Msg.PageSize), 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list VPNs: %w", err))
	}

	protoVpns := make([]*networkv1.VpnService, len(vpns))
	for i, vpn := range vpns {
		protoVpns[i] = domainToProtoVpn(vpn)
	}

	return connect.NewResponse(&networkv1.ListVpnsResponse{
		VpnServices: protoVpns,
		TotalCount:  int32(total),
	}), nil
}

// DeleteVpn removes a VPN service.
func (h *VpnServiceHandler) DeleteVpn(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteVpnRequest],
) (*connect.Response[emptypb.Empty], error) {
	if err := h.manager.Delete(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete VPN: %w", err))
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AddConnection adds a VPN connection (peer).
func (h *VpnServiceHandler) AddConnection(
	ctx context.Context,
	req *connect.Request[networkv1.AddConnectionRequest],
) (*connect.Response[networkv1.VpnService], error) {
	msg := req.Msg
	conn := msg.Connection

	vpn, err := h.manager.AddConnection(ctx, AddConnectionRequest{
		VpnServiceID: msg.VpnId,
		Name:         conn.GetName(),
		PeerAddress:  conn.GetPeerAddress(),
		PeerCIDRs:    conn.GetPeerCidrs(),
		// Note: For WireGuard, we store peer public key in PSK field for simplicity
		// IPSec connections use PSK for pre-shared key
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to add connection: %w", err))
	}

	return connect.NewResponse(domainToProtoVpn(vpn)), nil
}

// RemoveConnection removes a VPN connection.
func (h *VpnServiceHandler) RemoveConnection(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveConnectionRequest],
) (*connect.Response[networkv1.VpnService], error) {
	vpn, err := h.manager.RemoveConnection(ctx, req.Msg.VpnId, req.Msg.ConnectionId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to remove connection: %w", err))
	}

	return connect.NewResponse(domainToProtoVpn(vpn)), nil
}

// GetVpnStatus returns VPN tunnel status.
func (h *VpnServiceHandler) GetVpnStatus(
	ctx context.Context,
	req *connect.Request[networkv1.GetVpnStatusRequest],
) (*connect.Response[networkv1.VpnTunnelStatus], error) {
	vpn, err := h.manager.Get(ctx, req.Msg.VpnId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("VPN service not found: %s", req.Msg.VpnId))
	}

	// Build tunnel status for each connection
	tunnels := make([]*networkv1.TunnelStatus, len(vpn.Spec.Connections))
	for i, conn := range vpn.Spec.Connections {
		status := networkv1.TunnelStatus_UP
		if conn.Status != "active" {
			status = networkv1.TunnelStatus_DOWN
		}

		tunnels[i] = &networkv1.TunnelStatus{
			ConnectionId: conn.ID,
			PeerAddress:  conn.PeerAddress,
			Status:       status,
			// Stats would come from actual WireGuard interface in production
			BytesIn:    0,
			BytesOut:   0,
			PacketsIn:  0,
			PacketsOut: 0,
		}
	}

	return connect.NewResponse(&networkv1.VpnTunnelStatus{
		VpnId:   vpn.ID,
		Tunnels: tunnels,
	}), nil
}

// =============================================================================
// CLIENT CONFIG WITH QR CODE
// =============================================================================

// ClientConfigWithQR holds WireGuard config with QR code.
type ClientConfigWithQR struct {
	Config    string
	PublicKey string
	Endpoint  string
	QRCodePNG string // Base64 encoded PNG
}

// GetClientConfigQR generates a WireGuard client configuration with QR code.
// This is a custom method not in the proto, exposed via REST endpoint if needed.
func (h *VpnServiceHandler) GetClientConfigQR(ctx context.Context, vpnID, connectionID string) (*ClientConfigWithQR, error) {
	config, err := h.manager.GetClientConfig(ctx, vpnID, connectionID)
	if err != nil {
		return nil, err
	}

	// Generate QR code PNG
	qr, err := qrcode.New(config.Config, qrcode.Medium)
	if err != nil {
		h.logger.Warn("Failed to generate QR code", zap.Error(err))
		return &ClientConfigWithQR{
			Config:    config.Config,
			PublicKey: config.PublicKey,
			Endpoint:  config.Endpoint,
		}, nil
	}

	// Encode to PNG
	img := qr.Image(256)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		h.logger.Warn("Failed to encode QR code to PNG", zap.Error(err))
	}

	return &ClientConfigWithQR{
		Config:    config.Config,
		PublicKey: config.PublicKey,
		Endpoint:  config.Endpoint,
		QRCodePNG: base64.StdEncoding.EncodeToString(buf.Bytes()),
	}, nil
}

// =============================================================================
// CONVERTERS
// =============================================================================

func domainToProtoVpn(vpn *domain.VpnService) *networkv1.VpnService {
	// Convert connections
	connections := make([]*networkv1.VpnConnection, len(vpn.Spec.Connections))
	for i, conn := range vpn.Spec.Connections {
		connections[i] = &networkv1.VpnConnection{
			Id:          conn.ID,
			Name:        conn.Name,
			PeerAddress: conn.PeerAddress,
			PeerCidrs:   conn.PeerCIDRs,
			Psk:         conn.PSK,
		}
	}

	// Convert status phase
	var phase networkv1.VpnStatus_Phase
	switch vpn.Status.Phase {
	case domain.VPNPhaseActive:
		phase = networkv1.VpnStatus_ACTIVE
	case domain.VPNPhasePending:
		phase = networkv1.VpnStatus_PENDING
	case domain.VPNPhaseDown:
		phase = networkv1.VpnStatus_DOWN
	case domain.VPNPhaseError:
		phase = networkv1.VpnStatus_ERROR
	default:
		phase = networkv1.VpnStatus_UNKNOWN
	}

	// VpnService proto has flat structure, not nested Spec/Status
	return &networkv1.VpnService{
		Id:          vpn.ID,
		Name:        vpn.Name,
		Description: vpn.Description,
		ProjectId:   vpn.ProjectID,
		RouterId:    vpn.Spec.RouterID,
		ExternalIp:  vpn.Spec.ExternalIP,
		Connections: connections,
		Status: &networkv1.VpnStatus{
			Phase:        phase,
			ErrorMessage: vpn.Status.ErrorMessage,
		},
		CreatedAt: timestamppb.New(vpn.CreatedAt),
	}
}
