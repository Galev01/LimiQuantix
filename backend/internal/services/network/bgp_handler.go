// Package network provides the BGP service Connect-RPC handler.
// This handler wraps the BGPService business logic for gRPC exposure.
package network

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// =============================================================================
// BGP SERVICE HANDLER - Connect-RPC Implementation
// =============================================================================

// BGPServiceHandler implements the BGPServiceHandler interface for Connect-RPC.
type BGPServiceHandler struct {
	service *BGPService
	logger  *zap.Logger
}

// NewBGPServiceHandler creates a new BGP service handler.
func NewBGPServiceHandler(repo BGPRepository, logger *zap.Logger) *BGPServiceHandler {
	return &BGPServiceHandler{
		service: NewBGPService(repo, logger),
		logger:  logger.Named("bgp-handler"),
	}
}

// CreateSpeaker creates a new BGP speaker.
func (h *BGPServiceHandler) CreateSpeaker(
	ctx context.Context,
	req *connect.Request[networkv1.CreateBGPSpeakerRequest],
) (*connect.Response[networkv1.BGPSpeaker], error) {
	msg := req.Msg
	spec := msg.GetSpec()

	h.logger.Info("Creating BGP speaker",
		zap.String("name", msg.Name),
		zap.Uint32("asn", spec.GetLocalAsn()),
	)

	speaker, err := h.service.CreateSpeaker(ctx, CreateSpeakerRequest{
		NodeID:    spec.GetNodeId(),
		LocalASN:  spec.GetLocalAsn(),
		RouterID:  spec.GetRouterId(),
		ProjectID: msg.GetProjectId(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create speaker: %w", err))
	}

	return connect.NewResponse(domainToProtoBGPSpeaker(speaker, msg.Name, msg.Description)), nil
}

// GetSpeaker retrieves a BGP speaker by ID.
func (h *BGPServiceHandler) GetSpeaker(
	ctx context.Context,
	req *connect.Request[networkv1.GetBGPSpeakerRequest],
) (*connect.Response[networkv1.BGPSpeaker], error) {
	speaker, err := h.service.GetSpeaker(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("speaker not found: %s", req.Msg.Id))
	}

	return connect.NewResponse(domainToProtoBGPSpeaker(speaker, "", "")), nil
}

// ListSpeakers returns all BGP speakers.
func (h *BGPServiceHandler) ListSpeakers(
	ctx context.Context,
	req *connect.Request[networkv1.ListBGPSpeakersRequest],
) (*connect.Response[networkv1.ListBGPSpeakersResponse], error) {
	speakers, total, err := h.service.ListSpeakers(ctx, req.Msg.ProjectId, int(req.Msg.PageSize), 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list speakers: %w", err))
	}

	protoSpeakers := make([]*networkv1.BGPSpeaker, len(speakers))
	for i, speaker := range speakers {
		protoSpeakers[i] = domainToProtoBGPSpeaker(speaker, "", "")
	}

	return connect.NewResponse(&networkv1.ListBGPSpeakersResponse{
		Speakers:   protoSpeakers,
		TotalCount: int32(total),
	}), nil
}

// DeleteSpeaker deletes a BGP speaker.
func (h *BGPServiceHandler) DeleteSpeaker(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteBGPSpeakerRequest],
) (*connect.Response[emptypb.Empty], error) {
	if err := h.service.DeleteSpeaker(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to delete speaker: %w", err))
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AddPeer adds a peer to a BGP speaker.
func (h *BGPServiceHandler) AddPeer(
	ctx context.Context,
	req *connect.Request[networkv1.AddBGPPeerRequest],
) (*connect.Response[networkv1.BGPPeer], error) {
	msg := req.Msg

	peer, err := h.service.AddPeer(ctx, AddPeerRequest{
		SpeakerID:   msg.GetSpeakerId(),
		Name:        msg.GetName(),
		PeerAddress: msg.GetPeerIp(),
		PeerASN:     msg.GetRemoteAsn(),
		Password:    msg.GetMd5Password(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to add peer: %w", err))
	}

	return connect.NewResponse(domainToProtoBGPPeer(peer)), nil
}

// RemovePeer removes a peer from a BGP speaker.
func (h *BGPServiceHandler) RemovePeer(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveBGPPeerRequest],
) (*connect.Response[emptypb.Empty], error) {
	if err := h.service.RemovePeer(ctx, req.Msg.PeerId); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to remove peer: %w", err))
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ListPeers lists all peers for a speaker.
func (h *BGPServiceHandler) ListPeers(
	ctx context.Context,
	req *connect.Request[networkv1.ListBGPPeersRequest],
) (*connect.Response[networkv1.ListBGPPeersResponse], error) {
	peers, err := h.service.ListPeers(ctx, req.Msg.SpeakerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list peers: %w", err))
	}

	protoPeers := make([]*networkv1.BGPPeer, len(peers))
	for i, peer := range peers {
		protoPeers[i] = domainToProtoBGPPeer(peer)
	}

	return connect.NewResponse(&networkv1.ListBGPPeersResponse{
		Peers: protoPeers,
	}), nil
}

// AdvertiseNetwork advertises a network prefix via BGP.
func (h *BGPServiceHandler) AdvertiseNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.AdvertiseNetworkRequest],
) (*connect.Response[networkv1.BGPAdvertisement], error) {
	msg := req.Msg

	adv, err := h.service.AdvertiseNetwork(ctx, AdvertiseRequest{
		SpeakerID:   msg.GetSpeakerId(),
		Prefix:      msg.GetCidr(),
		NextHop:     msg.GetNextHop(),
		Communities: msg.GetCommunities(),
		LocalPref:   int(msg.GetLocalPreference()),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to advertise network: %w", err))
	}

	return connect.NewResponse(domainToProtoAdvertisement(adv)), nil
}

// WithdrawNetwork withdraws a network prefix from BGP.
func (h *BGPServiceHandler) WithdrawNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.WithdrawNetworkRequest],
) (*connect.Response[emptypb.Empty], error) {
	if err := h.service.WithdrawNetwork(ctx, req.Msg.AdvertisementId); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to withdraw network: %w", err))
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ListAdvertisements lists all advertisements for a speaker.
func (h *BGPServiceHandler) ListAdvertisements(
	ctx context.Context,
	req *connect.Request[networkv1.ListAdvertisementsRequest],
) (*connect.Response[networkv1.ListAdvertisementsResponse], error) {
	advs, err := h.service.ListAdvertisements(ctx, req.Msg.SpeakerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to list advertisements: %w", err))
	}

	protoAdvs := make([]*networkv1.BGPAdvertisement, len(advs))
	for i, adv := range advs {
		protoAdvs[i] = domainToProtoAdvertisement(adv)
	}

	return connect.NewResponse(&networkv1.ListAdvertisementsResponse{
		Advertisements: protoAdvs,
	}), nil
}

// GetSpeakerStatus returns the detailed status of a BGP speaker.
func (h *BGPServiceHandler) GetSpeakerStatus(
	ctx context.Context,
	req *connect.Request[networkv1.GetBGPSpeakerStatusRequest],
) (*connect.Response[networkv1.BGPSpeakerDetailedStatus], error) {
	speaker, err := h.service.GetSpeaker(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("speaker not found: %s", req.Msg.Id))
	}

	peers, _ := h.service.ListPeers(ctx, req.Msg.Id)
	advs, _ := h.service.ListAdvertisements(ctx, req.Msg.Id)

	// Build peer list
	protoPeers := make([]*networkv1.BGPPeer, len(peers))
	for i, peer := range peers {
		protoPeers[i] = domainToProtoBGPPeer(peer)
	}

	// Build advertisement list
	protoAdvs := make([]*networkv1.BGPAdvertisement, len(advs))
	for i, adv := range advs {
		protoAdvs[i] = domainToProtoAdvertisement(adv)
	}

	return connect.NewResponse(&networkv1.BGPSpeakerDetailedStatus{
		SpeakerId:      speaker.ID,
		Status:         domainToProtoBGPSpeakerStatus(speaker.Status),
		Peers:          protoPeers,
		Advertisements: protoAdvs,
	}), nil
}

// =============================================================================
// FRRouting CONFIG GENERATION
// =============================================================================

// FRRConfig holds FRRouting configuration for a node.
type FRRConfig struct {
	Config   string // Full frr.conf content
	Hostname string
	RouterID string
	LocalASN uint32
}

// GenerateFRRConfig generates FRRouting configuration for a BGP speaker.
func (h *BGPServiceHandler) GenerateFRRConfig(ctx context.Context, speakerID string) (*FRRConfig, error) {
	speaker, err := h.service.GetSpeaker(ctx, speakerID)
	if err != nil {
		return nil, err
	}

	peers, _ := h.service.ListPeers(ctx, speakerID)
	advs, _ := h.service.ListAdvertisements(ctx, speakerID)

	var config strings.Builder

	// Hostname
	hostname := fmt.Sprintf("quantix-bgp-%s", speaker.NodeID[:8])
	config.WriteString(fmt.Sprintf("hostname %s\n", hostname))
	config.WriteString("log syslog informational\n")
	config.WriteString("!\n")

	// Router BGP section
	config.WriteString(fmt.Sprintf("router bgp %d\n", speaker.LocalASN))
	config.WriteString(fmt.Sprintf(" bgp router-id %s\n", speaker.RouterID))
	config.WriteString(" bgp log-neighbor-changes\n")
	config.WriteString(" no bgp default ipv4-unicast\n")
	config.WriteString(" !\n")

	// Peer configurations
	for _, peer := range peers {
		config.WriteString(fmt.Sprintf(" neighbor %s remote-as %d\n", peer.PeerAddress, peer.PeerASN))
		if peer.Password != "" {
			config.WriteString(fmt.Sprintf(" neighbor %s password %s\n", peer.PeerAddress, peer.Password))
		}
		if peer.Name != "" {
			config.WriteString(fmt.Sprintf(" neighbor %s description %s\n", peer.PeerAddress, peer.Name))
		}
	}
	config.WriteString(" !\n")

	// Address family IPv4
	config.WriteString(" address-family ipv4 unicast\n")

	// Network advertisements
	for _, adv := range advs {
		config.WriteString(fmt.Sprintf("  network %s\n", adv.Prefix))
	}

	// Activate neighbors
	for _, peer := range peers {
		config.WriteString(fmt.Sprintf("  neighbor %s activate\n", peer.PeerAddress))
		config.WriteString(fmt.Sprintf("  neighbor %s soft-reconfiguration inbound\n", peer.PeerAddress))
	}

	config.WriteString(" exit-address-family\n")
	config.WriteString("exit\n")
	config.WriteString("!\n")
	config.WriteString("line vty\n")
	config.WriteString("!\n")
	config.WriteString("end\n")

	return &FRRConfig{
		Config:   config.String(),
		Hostname: hostname,
		RouterID: speaker.RouterID,
		LocalASN: speaker.LocalASN,
	}, nil
}

// =============================================================================
// CONVERTERS
// =============================================================================

func domainToProtoBGPSpeaker(speaker *domain.BGPSpeaker, name, description string) *networkv1.BGPSpeaker {
	// Use provided name/description if available, otherwise use from speaker
	if name == "" {
		name = speaker.NodeID // Default to node ID if no name
	}

	return &networkv1.BGPSpeaker{
		Id:          speaker.ID,
		Name:        name,
		ProjectId:   speaker.ProjectID,
		Description: description,
		Labels:      speaker.Labels,
		Spec: &networkv1.BGPSpeakerSpec{
			LocalAsn: speaker.LocalASN,
			RouterId: speaker.RouterID,
			NodeId:   speaker.NodeID,
		},
		Status:    domainToProtoBGPSpeakerStatus(speaker.Status),
		CreatedAt: timestamppb.New(speaker.CreatedAt),
		UpdatedAt: timestamppb.New(speaker.UpdatedAt),
	}
}

func domainToProtoBGPSpeakerStatus(status domain.BGPSpeakerStatus) *networkv1.BGPSpeakerStatus {
	var phase networkv1.BGPSpeakerStatus_Phase
	switch status.Phase {
	case domain.BGPPhaseActive:
		phase = networkv1.BGPSpeakerStatus_ACTIVE
	case domain.BGPPhasePending:
		phase = networkv1.BGPSpeakerStatus_PENDING
	case domain.BGPPhaseError:
		phase = networkv1.BGPSpeakerStatus_ERROR
	default:
		phase = networkv1.BGPSpeakerStatus_UNKNOWN
	}

	return &networkv1.BGPSpeakerStatus{
		Phase:       phase,
		ActivePeers: uint32(status.EstablishedPeers),
		// AdvertisedRoutes would be set based on actual route count
		ErrorMessage: status.ErrorMessage,
	}
}

func domainToProtoBGPPeer(peer *domain.BGPPeer) *networkv1.BGPPeer {
	// Build status
	var state networkv1.BGPPeerStatus_State
	switch peer.Status.State {
	case domain.BGPStateEstablished:
		state = networkv1.BGPPeerStatus_ESTABLISHED
	case domain.BGPStateActive:
		state = networkv1.BGPPeerStatus_ACTIVE
	case domain.BGPStateConnect:
		state = networkv1.BGPPeerStatus_CONNECT
	default:
		state = networkv1.BGPPeerStatus_IDLE
	}

	return &networkv1.BGPPeer{
		Id:        peer.ID,
		SpeakerId: peer.SpeakerID,
		Name:      peer.Name,
		PeerIp:    peer.PeerAddress,
		RemoteAsn: peer.PeerASN,
		Status: &networkv1.BGPPeerStatus{
			State:              state,
			PrefixesReceived:   uint32(peer.Status.PrefixesReceived),
			PrefixesAdvertised: uint32(peer.Status.PrefixesSent),
		},
		CreatedAt: timestamppb.New(peer.CreatedAt),
	}
}

func domainToProtoAdvertisement(adv *domain.BGPAdvertisement) *networkv1.BGPAdvertisement {
	return &networkv1.BGPAdvertisement{
		Id:              adv.ID,
		SpeakerId:       adv.SpeakerID,
		Cidr:            adv.Prefix,
		NextHop:         adv.NextHop,
		Communities:     adv.Communities,
		LocalPreference: uint32(adv.LocalPref),
		Active:          true,
		CreatedAt:       timestamppb.New(adv.CreatedAt),
	}
}
