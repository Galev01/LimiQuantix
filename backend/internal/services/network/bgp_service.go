// Package network implements the BGP service for Top-of-Rack switch integration.
package network

import (
	"context"
	"fmt"
	"net"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// BGPService implements BGP speaker management for advertising overlay routes
// to physical Top-of-Rack (ToR) switches in enterprise data centers.
type BGPService struct {
	repo   BGPRepository
	logger *zap.Logger
}

// BGPRepository defines the interface for BGP configuration storage.
type BGPRepository interface {
	CreateSpeaker(ctx context.Context, speaker *domain.BGPSpeaker) (*domain.BGPSpeaker, error)
	GetSpeaker(ctx context.Context, id string) (*domain.BGPSpeaker, error)
	ListSpeakers(ctx context.Context, projectID string, limit, offset int) ([]*domain.BGPSpeaker, int, error)
	UpdateSpeaker(ctx context.Context, speaker *domain.BGPSpeaker) (*domain.BGPSpeaker, error)
	DeleteSpeaker(ctx context.Context, id string) error
	
	CreatePeer(ctx context.Context, peer *domain.BGPPeer) (*domain.BGPPeer, error)
	GetPeer(ctx context.Context, id string) (*domain.BGPPeer, error)
	ListPeers(ctx context.Context, speakerID string) ([]*domain.BGPPeer, error)
	UpdatePeer(ctx context.Context, peer *domain.BGPPeer) (*domain.BGPPeer, error)
	DeletePeer(ctx context.Context, id string) error
	
	CreateAdvertisement(ctx context.Context, adv *domain.BGPAdvertisement) (*domain.BGPAdvertisement, error)
	ListAdvertisements(ctx context.Context, speakerID string) ([]*domain.BGPAdvertisement, error)
	DeleteAdvertisement(ctx context.Context, id string) error
}

// NewBGPService creates a new BGPService.
func NewBGPService(repo BGPRepository, logger *zap.Logger) *BGPService {
	return &BGPService{
		repo:   repo,
		logger: logger,
	}
}

// =============================================================================
// BGP Speaker Operations
// =============================================================================

// CreateBGPSpeaker creates a BGP speaker on a node.
func (s *BGPService) CreateBGPSpeaker(
	ctx context.Context,
	req *connect.Request[networkv1.CreateBGPSpeakerRequest],
) (*connect.Response[networkv1.BGPSpeaker], error) {
	logger := s.logger.With(
		zap.String("method", "CreateBGPSpeaker"),
		zap.String("node_id", req.Msg.NodeId),
		zap.Uint32("asn", req.Msg.LocalAsn),
	)
	logger.Info("Creating BGP speaker")

	if req.Msg.NodeId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("node_id is required"))
	}
	if req.Msg.LocalAsn == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("local_asn is required"))
	}
	if req.Msg.RouterId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("router_id is required"))
	}

	// Validate router ID is a valid IP
	if net.ParseIP(req.Msg.RouterId) == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("router_id must be a valid IP address"))
	}

	speaker := &domain.BGPSpeaker{
		ID:        uuid.NewString(),
		NodeID:    req.Msg.NodeId,
		LocalASN:  uint32(req.Msg.LocalAsn),
		RouterID:  req.Msg.RouterId,
		ProjectID: req.Msg.ProjectId,
		Labels:    req.Msg.Labels,
		Status: domain.BGPSpeakerStatus{
			Phase:           domain.BGPPhasePending,
			EstablishedPeers: 0,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	createdSpeaker, err := s.repo.CreateSpeaker(ctx, speaker)
	if err != nil {
		logger.Error("Failed to create BGP speaker", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// TODO: Deploy BGP daemon (FRR/BIRD) on the node
	// Mark as active for now
	createdSpeaker.Status.Phase = domain.BGPPhaseActive
	if _, err := s.repo.UpdateSpeaker(ctx, createdSpeaker); err != nil {
		logger.Warn("Failed to update speaker status", zap.Error(err))
	}

	logger.Info("BGP speaker created", zap.String("speaker_id", createdSpeaker.ID))
	return connect.NewResponse(s.speakerToProto(createdSpeaker)), nil
}

// GetBGPSpeaker retrieves a BGP speaker by ID.
func (s *BGPService) GetBGPSpeaker(
	ctx context.Context,
	req *connect.Request[networkv1.GetBGPSpeakerRequest],
) (*connect.Response[networkv1.BGPSpeaker], error) {
	speaker, err := s.repo.GetSpeaker(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(s.speakerToProto(speaker)), nil
}

// ListBGPSpeakers returns all BGP speakers.
func (s *BGPService) ListBGPSpeakers(
	ctx context.Context,
	req *connect.Request[networkv1.ListBGPSpeakersRequest],
) (*connect.Response[networkv1.ListBGPSpeakersResponse], error) {
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	speakers, total, err := s.repo.ListSpeakers(ctx, req.Msg.ProjectId, limit, 0)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var protoSpeakers []*networkv1.BGPSpeaker
	for _, speaker := range speakers {
		protoSpeakers = append(protoSpeakers, s.speakerToProto(speaker))
	}

	return connect.NewResponse(&networkv1.ListBGPSpeakersResponse{
		Speakers:   protoSpeakers,
		TotalCount: int32(total),
	}), nil
}

// DeleteBGPSpeaker removes a BGP speaker.
func (s *BGPService) DeleteBGPSpeaker(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteBGPSpeakerRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteBGPSpeaker"),
		zap.String("speaker_id", req.Msg.Id),
	)
	logger.Info("Deleting BGP speaker")

	// Delete all peers first
	peers, _ := s.repo.ListPeers(ctx, req.Msg.Id)
	for _, peer := range peers {
		_ = s.repo.DeletePeer(ctx, peer.ID)
	}

	// Delete all advertisements
	advs, _ := s.repo.ListAdvertisements(ctx, req.Msg.Id)
	for _, adv := range advs {
		_ = s.repo.DeleteAdvertisement(ctx, adv.ID)
	}

	// TODO: Stop BGP daemon on the node

	if err := s.repo.DeleteSpeaker(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete BGP speaker", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("BGP speaker deleted")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// =============================================================================
// BGP Peer Operations
// =============================================================================

// AddBGPPeer adds a BGP peer (ToR switch) to a speaker.
func (s *BGPService) AddBGPPeer(
	ctx context.Context,
	req *connect.Request[networkv1.AddBGPPeerRequest],
) (*connect.Response[networkv1.BGPPeer], error) {
	logger := s.logger.With(
		zap.String("method", "AddBGPPeer"),
		zap.String("speaker_id", req.Msg.SpeakerId),
		zap.String("peer_address", req.Msg.PeerAddress),
	)
	logger.Info("Adding BGP peer")

	// Verify speaker exists
	speaker, err := s.repo.GetSpeaker(ctx, req.Msg.SpeakerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("speaker not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if net.ParseIP(req.Msg.PeerAddress) == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("peer_address must be a valid IP"))
	}
	if req.Msg.PeerAsn == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("peer_asn is required"))
	}

	peer := &domain.BGPPeer{
		ID:          uuid.NewString(),
		SpeakerID:   req.Msg.SpeakerId,
		Name:        req.Msg.Name,
		PeerAddress: req.Msg.PeerAddress,
		PeerASN:     uint32(req.Msg.PeerAsn),
		Password:    req.Msg.Password, // MD5 auth password
		Status: domain.BGPPeerStatus{
			State:           domain.BGPStateIdle,
			PrefixesReceived: 0,
			PrefixesSent:     0,
		},
		CreatedAt: time.Now(),
	}

	createdPeer, err := s.repo.CreatePeer(ctx, peer)
	if err != nil {
		logger.Error("Failed to create BGP peer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Update speaker peer count
	speaker.Status.EstablishedPeers++
	_, _ = s.repo.UpdateSpeaker(ctx, speaker)

	// TODO: Configure peer in BGP daemon

	logger.Info("BGP peer added", zap.String("peer_id", createdPeer.ID))
	return connect.NewResponse(s.peerToProto(createdPeer)), nil
}

// RemoveBGPPeer removes a BGP peer from a speaker.
func (s *BGPService) RemoveBGPPeer(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveBGPPeerRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "RemoveBGPPeer"),
		zap.String("peer_id", req.Msg.PeerId),
	)
	logger.Info("Removing BGP peer")

	peer, err := s.repo.GetPeer(ctx, req.Msg.PeerId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Update speaker peer count
	speaker, _ := s.repo.GetSpeaker(ctx, peer.SpeakerID)
	if speaker != nil && speaker.Status.EstablishedPeers > 0 {
		speaker.Status.EstablishedPeers--
		_, _ = s.repo.UpdateSpeaker(ctx, speaker)
	}

	// TODO: Remove peer from BGP daemon

	if err := s.repo.DeletePeer(ctx, req.Msg.PeerId); err != nil {
		logger.Error("Failed to delete BGP peer", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("BGP peer removed")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ListBGPPeers returns all peers for a speaker.
func (s *BGPService) ListBGPPeers(
	ctx context.Context,
	req *connect.Request[networkv1.ListBGPPeersRequest],
) (*connect.Response[networkv1.ListBGPPeersResponse], error) {
	peers, err := s.repo.ListPeers(ctx, req.Msg.SpeakerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var protoPeers []*networkv1.BGPPeer
	for _, peer := range peers {
		protoPeers = append(protoPeers, s.peerToProto(peer))
	}

	return connect.NewResponse(&networkv1.ListBGPPeersResponse{
		Peers: protoPeers,
	}), nil
}

// =============================================================================
// BGP Route Advertisement Operations
// =============================================================================

// AdvertiseNetwork advertises a network prefix via BGP.
func (s *BGPService) AdvertiseNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.AdvertiseNetworkRequest],
) (*connect.Response[networkv1.BGPAdvertisement], error) {
	logger := s.logger.With(
		zap.String("method", "AdvertiseNetwork"),
		zap.String("speaker_id", req.Msg.SpeakerId),
		zap.String("prefix", req.Msg.Prefix),
	)
	logger.Info("Advertising network via BGP")

	// Verify speaker exists
	if _, err := s.repo.GetSpeaker(ctx, req.Msg.SpeakerId); err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("speaker not found"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Validate prefix is valid CIDR
	_, _, err := net.ParseCIDR(req.Msg.Prefix)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid CIDR prefix: %w", err))
	}

	adv := &domain.BGPAdvertisement{
		ID:        uuid.NewString(),
		SpeakerID: req.Msg.SpeakerId,
		Prefix:    req.Msg.Prefix,
		NextHop:   req.Msg.NextHop,
		Communities: req.Msg.Communities,
		LocalPref:   int(req.Msg.LocalPref),
		CreatedAt: time.Now(),
	}

	// Default local preference
	if adv.LocalPref == 0 {
		adv.LocalPref = 100
	}

	createdAdv, err := s.repo.CreateAdvertisement(ctx, adv)
	if err != nil {
		logger.Error("Failed to create BGP advertisement", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// TODO: Inject route into BGP daemon

	logger.Info("Network advertised", zap.String("adv_id", createdAdv.ID))
	return connect.NewResponse(s.advToProto(createdAdv)), nil
}

// WithdrawNetwork withdraws a network prefix from BGP.
func (s *BGPService) WithdrawNetwork(
	ctx context.Context,
	req *connect.Request[networkv1.WithdrawNetworkRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "WithdrawNetwork"),
		zap.String("adv_id", req.Msg.AdvertisementId),
	)
	logger.Info("Withdrawing network from BGP")

	// TODO: Remove route from BGP daemon

	if err := s.repo.DeleteAdvertisement(ctx, req.Msg.AdvertisementId); err != nil {
		logger.Error("Failed to delete BGP advertisement", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Network withdrawn")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ListAdvertisements returns all route advertisements for a speaker.
func (s *BGPService) ListAdvertisements(
	ctx context.Context,
	req *connect.Request[networkv1.ListBGPAdvertisementsRequest],
) (*connect.Response[networkv1.ListBGPAdvertisementsResponse], error) {
	advs, err := s.repo.ListAdvertisements(ctx, req.Msg.SpeakerId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var protoAdvs []*networkv1.BGPAdvertisement
	for _, adv := range advs {
		protoAdvs = append(protoAdvs, s.advToProto(adv))
	}

	return connect.NewResponse(&networkv1.ListBGPAdvertisementsResponse{
		Advertisements: protoAdvs,
	}), nil
}

// =============================================================================
// Proto Conversion Helpers
// =============================================================================

func (s *BGPService) speakerToProto(speaker *domain.BGPSpeaker) *networkv1.BGPSpeaker {
	phase := networkv1.BGPSpeakerStatus_UNKNOWN
	switch speaker.Status.Phase {
	case domain.BGPPhasePending:
		phase = networkv1.BGPSpeakerStatus_PENDING
	case domain.BGPPhaseActive:
		phase = networkv1.BGPSpeakerStatus_ACTIVE
	case domain.BGPPhaseError:
		phase = networkv1.BGPSpeakerStatus_ERROR
	}

	return &networkv1.BGPSpeaker{
		Id:        speaker.ID,
		NodeId:    speaker.NodeID,
		LocalAsn:  uint32(speaker.LocalASN),
		RouterId:  speaker.RouterID,
		ProjectId: speaker.ProjectID,
		Labels:    speaker.Labels,
		Status: &networkv1.BGPSpeakerStatus{
			Phase:            phase,
			EstablishedPeers: int32(speaker.Status.EstablishedPeers),
			ErrorMessage:     speaker.Status.ErrorMessage,
		},
		CreatedAt: timestamppb.New(speaker.CreatedAt),
		UpdatedAt: timestamppb.New(speaker.UpdatedAt),
	}
}

func (s *BGPService) peerToProto(peer *domain.BGPPeer) *networkv1.BGPPeer {
	state := networkv1.BGPPeerState_IDLE
	switch peer.Status.State {
	case domain.BGPStateConnect:
		state = networkv1.BGPPeerState_CONNECT
	case domain.BGPStateActive:
		state = networkv1.BGPPeerState_ACTIVE
	case domain.BGPStateOpenSent:
		state = networkv1.BGPPeerState_OPENSENT
	case domain.BGPStateOpenConfirm:
		state = networkv1.BGPPeerState_OPENCONFIRM
	case domain.BGPStateEstablished:
		state = networkv1.BGPPeerState_ESTABLISHED
	}

	return &networkv1.BGPPeer{
		Id:          peer.ID,
		SpeakerId:   peer.SpeakerID,
		Name:        peer.Name,
		PeerAddress: peer.PeerAddress,
		PeerAsn:     uint32(peer.PeerASN),
		Status: &networkv1.BGPPeerStatus{
			State:            state,
			PrefixesReceived: int32(peer.Status.PrefixesReceived),
			PrefixesSent:     int32(peer.Status.PrefixesSent),
			Uptime:           peer.Status.Uptime,
		},
		CreatedAt: timestamppb.New(peer.CreatedAt),
	}
}

func (s *BGPService) advToProto(adv *domain.BGPAdvertisement) *networkv1.BGPAdvertisement {
	return &networkv1.BGPAdvertisement{
		Id:          adv.ID,
		SpeakerId:   adv.SpeakerID,
		Prefix:      adv.Prefix,
		NextHop:     adv.NextHop,
		Communities: adv.Communities,
		LocalPref:   int32(adv.LocalPref),
		CreatedAt:   timestamppb.New(adv.CreatedAt),
	}
}
