// Package network implements the BGP service for Top-of-Rack switch integration.
//
// NOTE: This service provides the business logic for BGP management.
// Proto types for BGP need to be added to proto/limiquantix/network/v1/network_service.proto
// and regenerated with `make proto` to enable gRPC handlers.
package network

import (
	"context"
	"fmt"
	"net"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
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

// CreateSpeakerRequest holds parameters for creating a BGP speaker.
type CreateSpeakerRequest struct {
	NodeID    string
	LocalASN  uint32
	RouterID  string
	ProjectID string
	Labels    map[string]string
}

// CreateSpeaker creates a BGP speaker on a node.
func (s *BGPService) CreateSpeaker(ctx context.Context, req CreateSpeakerRequest) (*domain.BGPSpeaker, error) {
	logger := s.logger.With(
		zap.String("method", "CreateSpeaker"),
		zap.String("node_id", req.NodeID),
		zap.Uint32("asn", req.LocalASN),
	)
	logger.Info("Creating BGP speaker")

	if req.NodeID == "" {
		return nil, fmt.Errorf("node_id is required")
	}
	if req.LocalASN == 0 {
		return nil, fmt.Errorf("local_asn is required")
	}
	if req.RouterID == "" {
		return nil, fmt.Errorf("router_id is required")
	}

	// Validate router ID is a valid IP
	if net.ParseIP(req.RouterID) == nil {
		return nil, fmt.Errorf("router_id must be a valid IP address")
	}

	speaker := &domain.BGPSpeaker{
		ID:        uuid.NewString(),
		NodeID:    req.NodeID,
		LocalASN:  req.LocalASN,
		RouterID:  req.RouterID,
		ProjectID: req.ProjectID,
		Labels:    req.Labels,
		Status: domain.BGPSpeakerStatus{
			Phase:            domain.BGPPhasePending,
			EstablishedPeers: 0,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	createdSpeaker, err := s.repo.CreateSpeaker(ctx, speaker)
	if err != nil {
		logger.Error("Failed to create BGP speaker", zap.Error(err))
		return nil, fmt.Errorf("failed to create speaker: %w", err)
	}

	// TODO: Deploy BGP daemon (FRR/BIRD) on the node
	// Mark as active for now
	createdSpeaker.Status.Phase = domain.BGPPhaseActive
	if _, err := s.repo.UpdateSpeaker(ctx, createdSpeaker); err != nil {
		logger.Warn("Failed to update speaker status", zap.Error(err))
	}

	logger.Info("BGP speaker created", zap.String("speaker_id", createdSpeaker.ID))
	return createdSpeaker, nil
}

// GetSpeaker retrieves a BGP speaker by ID.
func (s *BGPService) GetSpeaker(ctx context.Context, id string) (*domain.BGPSpeaker, error) {
	return s.repo.GetSpeaker(ctx, id)
}

// ListSpeakers returns all BGP speakers.
func (s *BGPService) ListSpeakers(ctx context.Context, projectID string, limit, offset int) ([]*domain.BGPSpeaker, int, error) {
	if limit == 0 {
		limit = 100
	}
	return s.repo.ListSpeakers(ctx, projectID, limit, offset)
}

// DeleteSpeaker removes a BGP speaker and all its peers/advertisements.
func (s *BGPService) DeleteSpeaker(ctx context.Context, id string) error {
	logger := s.logger.With(
		zap.String("method", "DeleteSpeaker"),
		zap.String("speaker_id", id),
	)
	logger.Info("Deleting BGP speaker")

	// Delete all peers first
	peers, _ := s.repo.ListPeers(ctx, id)
	for _, peer := range peers {
		_ = s.repo.DeletePeer(ctx, peer.ID)
	}

	// Delete all advertisements
	advs, _ := s.repo.ListAdvertisements(ctx, id)
	for _, adv := range advs {
		_ = s.repo.DeleteAdvertisement(ctx, adv.ID)
	}

	// TODO: Stop BGP daemon on the node

	if err := s.repo.DeleteSpeaker(ctx, id); err != nil {
		logger.Error("Failed to delete BGP speaker", zap.Error(err))
		return fmt.Errorf("failed to delete speaker: %w", err)
	}

	logger.Info("BGP speaker deleted")
	return nil
}

// =============================================================================
// BGP Peer Operations
// =============================================================================

// AddPeerRequest holds parameters for adding a BGP peer.
type AddPeerRequest struct {
	SpeakerID   string
	Name        string
	PeerAddress string
	PeerASN     uint32
	Password    string // MD5 auth password
}

// AddPeer adds a BGP peer (ToR switch) to a speaker.
func (s *BGPService) AddPeer(ctx context.Context, req AddPeerRequest) (*domain.BGPPeer, error) {
	logger := s.logger.With(
		zap.String("method", "AddPeer"),
		zap.String("speaker_id", req.SpeakerID),
		zap.String("peer_address", req.PeerAddress),
	)
	logger.Info("Adding BGP peer")

	// Verify speaker exists
	speaker, err := s.repo.GetSpeaker(ctx, req.SpeakerID)
	if err != nil {
		return nil, fmt.Errorf("speaker not found: %w", err)
	}

	if net.ParseIP(req.PeerAddress) == nil {
		return nil, fmt.Errorf("peer_address must be a valid IP")
	}
	if req.PeerASN == 0 {
		return nil, fmt.Errorf("peer_asn is required")
	}

	peer := &domain.BGPPeer{
		ID:          uuid.NewString(),
		SpeakerID:   req.SpeakerID,
		Name:        req.Name,
		PeerAddress: req.PeerAddress,
		PeerASN:     req.PeerASN,
		Password:    req.Password,
		Status: domain.BGPPeerStatus{
			State:            domain.BGPStateIdle,
			PrefixesReceived: 0,
			PrefixesSent:     0,
		},
		CreatedAt: time.Now(),
	}

	createdPeer, err := s.repo.CreatePeer(ctx, peer)
	if err != nil {
		logger.Error("Failed to create BGP peer", zap.Error(err))
		return nil, fmt.Errorf("failed to create peer: %w", err)
	}

	// Update speaker peer count
	speaker.Status.EstablishedPeers++
	_, _ = s.repo.UpdateSpeaker(ctx, speaker)

	// TODO: Configure peer in BGP daemon

	logger.Info("BGP peer added", zap.String("peer_id", createdPeer.ID))
	return createdPeer, nil
}

// RemovePeer removes a BGP peer from a speaker.
func (s *BGPService) RemovePeer(ctx context.Context, peerID string) error {
	logger := s.logger.With(
		zap.String("method", "RemovePeer"),
		zap.String("peer_id", peerID),
	)
	logger.Info("Removing BGP peer")

	peer, err := s.repo.GetPeer(ctx, peerID)
	if err != nil {
		return fmt.Errorf("peer not found: %w", err)
	}

	// Update speaker peer count
	speaker, _ := s.repo.GetSpeaker(ctx, peer.SpeakerID)
	if speaker != nil && speaker.Status.EstablishedPeers > 0 {
		speaker.Status.EstablishedPeers--
		_, _ = s.repo.UpdateSpeaker(ctx, speaker)
	}

	// TODO: Remove peer from BGP daemon

	if err := s.repo.DeletePeer(ctx, peerID); err != nil {
		logger.Error("Failed to delete BGP peer", zap.Error(err))
		return fmt.Errorf("failed to delete peer: %w", err)
	}

	logger.Info("BGP peer removed")
	return nil
}

// ListPeers returns all peers for a speaker.
func (s *BGPService) ListPeers(ctx context.Context, speakerID string) ([]*domain.BGPPeer, error) {
	return s.repo.ListPeers(ctx, speakerID)
}

// =============================================================================
// BGP Route Advertisement Operations
// =============================================================================

// AdvertiseRequest holds parameters for advertising a network prefix.
type AdvertiseRequest struct {
	SpeakerID   string
	Prefix      string
	NextHop     string
	Communities []string
	LocalPref   int
}

// AdvertiseNetwork advertises a network prefix via BGP.
func (s *BGPService) AdvertiseNetwork(ctx context.Context, req AdvertiseRequest) (*domain.BGPAdvertisement, error) {
	logger := s.logger.With(
		zap.String("method", "AdvertiseNetwork"),
		zap.String("speaker_id", req.SpeakerID),
		zap.String("prefix", req.Prefix),
	)
	logger.Info("Advertising network via BGP")

	// Verify speaker exists
	if _, err := s.repo.GetSpeaker(ctx, req.SpeakerID); err != nil {
		return nil, fmt.Errorf("speaker not found: %w", err)
	}

	// Validate prefix is valid CIDR
	_, _, err := net.ParseCIDR(req.Prefix)
	if err != nil {
		return nil, fmt.Errorf("invalid CIDR prefix: %w", err)
	}

	adv := &domain.BGPAdvertisement{
		ID:          uuid.NewString(),
		SpeakerID:   req.SpeakerID,
		Prefix:      req.Prefix,
		NextHop:     req.NextHop,
		Communities: req.Communities,
		LocalPref:   req.LocalPref,
		CreatedAt:   time.Now(),
	}

	// Default local preference
	if adv.LocalPref == 0 {
		adv.LocalPref = 100
	}

	createdAdv, err := s.repo.CreateAdvertisement(ctx, adv)
	if err != nil {
		logger.Error("Failed to create BGP advertisement", zap.Error(err))
		return nil, fmt.Errorf("failed to create advertisement: %w", err)
	}

	// TODO: Inject route into BGP daemon

	logger.Info("Network advertised", zap.String("adv_id", createdAdv.ID))
	return createdAdv, nil
}

// WithdrawNetwork withdraws a network prefix from BGP.
func (s *BGPService) WithdrawNetwork(ctx context.Context, advertisementID string) error {
	logger := s.logger.With(
		zap.String("method", "WithdrawNetwork"),
		zap.String("adv_id", advertisementID),
	)
	logger.Info("Withdrawing network from BGP")

	// TODO: Remove route from BGP daemon

	if err := s.repo.DeleteAdvertisement(ctx, advertisementID); err != nil {
		logger.Error("Failed to delete BGP advertisement", zap.Error(err))
		return fmt.Errorf("failed to delete advertisement: %w", err)
	}

	logger.Info("Network withdrawn")
	return nil
}

// ListAdvertisements returns all route advertisements for a speaker.
func (s *BGPService) ListAdvertisements(ctx context.Context, speakerID string) ([]*domain.BGPAdvertisement, error) {
	return s.repo.ListAdvertisements(ctx, speakerID)
}
