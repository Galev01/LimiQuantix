// Package network implements the VpnService (WireGuard Bastion).
//
// NOTE: This service provides the business logic for VPN management.
// Proto types for VPN are defined in proto/limiquantix/network/v1/network_service.proto.
// Some RPCs may need to be added and regenerated with `make proto`.
package network

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// VpnServiceManager implements WireGuard-based VPN access to overlay networks ("Bastion" mode).
type VpnServiceManager struct {
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

// NewVpnServiceManager creates a new VpnServiceManager.
func NewVpnServiceManager(repo VpnRepository, logger *zap.Logger) *VpnServiceManager {
	return &VpnServiceManager{
		repo:   repo,
		logger: logger,
	}
}

// =============================================================================
// VPN Service Operations
// =============================================================================

// CreateVPNRequest holds parameters for creating a VPN service.
type CreateVPNRequest struct {
	Name         string
	NetworkID    string
	ProjectID    string
	Description  string
	Labels       map[string]string
	RouterID     string
	ExternalIP   string
	LocalSubnets []string
}

// Create creates a new VPN service (WireGuard gateway).
func (s *VpnServiceManager) Create(ctx context.Context, req CreateVPNRequest) (*domain.VpnService, error) {
	logger := s.logger.With(
		zap.String("method", "CreateVpnService"),
		zap.String("vpn_name", req.Name),
	)
	logger.Info("Creating VPN service")

	if req.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	if req.NetworkID == "" {
		return nil, fmt.Errorf("network_id is required")
	}

	// Generate WireGuard keypair
	privateKey, publicKey, err := generateWireGuardKeyPair()
	if err != nil {
		logger.Error("Failed to generate WireGuard keys", zap.Error(err))
		return nil, fmt.Errorf("failed to generate keys: %w", err)
	}

	vpn := &domain.VpnService{
		ID:          uuid.NewString(),
		Name:        req.Name,
		NetworkID:   req.NetworkID,
		ProjectID:   req.ProjectID,
		Description: req.Description,
		Labels:      req.Labels,
		Spec: domain.VpnServiceSpec{
			Type:         domain.VPNTypeWireGuard,
			RouterID:     req.RouterID,
			ExternalIP:   req.ExternalIP,
			LocalSubnets: req.LocalSubnets,
			Connections:  []domain.VpnConnection{},
		},
		Status: domain.VpnServiceStatus{
			Phase:     domain.VPNPhasePending,
			PublicKey: publicKey,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	// Store private key securely (in real impl, use secrets manager)
	_ = privateKey

	createdVPN, err := s.repo.Create(ctx, vpn)
	if err != nil {
		logger.Error("Failed to create VPN service", zap.Error(err))
		return nil, fmt.Errorf("failed to create VPN: %w", err)
	}

	// TODO: Deploy WireGuard container/pod on the network's gateway node
	// For now, mark as active
	createdVPN.Status.Phase = domain.VPNPhaseActive
	if _, err := s.repo.Update(ctx, createdVPN); err != nil {
		logger.Warn("Failed to update VPN status", zap.Error(err))
	}

	logger.Info("VPN service created", zap.String("vpn_id", createdVPN.ID))
	return createdVPN, nil
}

// Get retrieves a VPN service by ID.
func (s *VpnServiceManager) Get(ctx context.Context, id string) (*domain.VpnService, error) {
	return s.repo.Get(ctx, id)
}

// List returns all VPN services.
func (s *VpnServiceManager) List(ctx context.Context, projectID string, limit, offset int) ([]*domain.VpnService, int, error) {
	if limit == 0 {
		limit = 100
	}
	return s.repo.List(ctx, projectID, limit, offset)
}

// Delete removes a VPN service.
func (s *VpnServiceManager) Delete(ctx context.Context, id string) error {
	logger := s.logger.With(
		zap.String("method", "DeleteVpnService"),
		zap.String("vpn_id", id),
	)
	logger.Info("Deleting VPN service")

	// TODO: Remove WireGuard container/pod

	if err := s.repo.Delete(ctx, id); err != nil {
		logger.Error("Failed to delete VPN service", zap.Error(err))
		return fmt.Errorf("failed to delete VPN: %w", err)
	}

	logger.Info("VPN service deleted")
	return nil
}

// =============================================================================
// VPN Connection Operations
// =============================================================================

// AddConnectionRequest holds parameters for adding a VPN connection.
type AddConnectionRequest struct {
	VpnServiceID  string
	Name          string
	PeerAddress   string
	PeerCIDRs     []string
	PeerPublicKey string
}

// AddConnection adds a peer connection (client) to the VPN service.
func (s *VpnServiceManager) AddConnection(ctx context.Context, req AddConnectionRequest) (*domain.VpnService, error) {
	logger := s.logger.With(
		zap.String("method", "AddConnection"),
		zap.String("vpn_id", req.VpnServiceID),
	)
	logger.Info("Adding VPN connection")

	vpn, err := s.repo.Get(ctx, req.VpnServiceID)
	if err != nil {
		return nil, fmt.Errorf("VPN service not found: %w", err)
	}

	connection := domain.VpnConnection{
		ID:            uuid.NewString(),
		Name:          req.Name,
		PeerAddress:   req.PeerAddress,
		PeerCIDRs:     req.PeerCIDRs,
		PeerPublicKey: req.PeerPublicKey,
		Status:        "pending",
	}

	vpn.Spec.Connections = append(vpn.Spec.Connections, connection)
	vpn.UpdatedAt = time.Now()

	// TODO: Update WireGuard config to add peer

	updatedVPN, err := s.repo.Update(ctx, vpn)
	if err != nil {
		logger.Error("Failed to update VPN service", zap.Error(err))
		return nil, fmt.Errorf("failed to update VPN: %w", err)
	}

	// Mark connection as active
	for i := range updatedVPN.Spec.Connections {
		if updatedVPN.Spec.Connections[i].ID == connection.ID {
			updatedVPN.Spec.Connections[i].Status = "active"
		}
	}
	_, _ = s.repo.Update(ctx, updatedVPN)

	logger.Info("VPN connection added", zap.String("connection_id", connection.ID))
	return updatedVPN, nil
}

// RemoveConnection removes a peer connection from the VPN service.
func (s *VpnServiceManager) RemoveConnection(ctx context.Context, vpnServiceID, connectionID string) (*domain.VpnService, error) {
	logger := s.logger.With(
		zap.String("method", "RemoveConnection"),
		zap.String("vpn_id", vpnServiceID),
	)
	logger.Info("Removing VPN connection")

	vpn, err := s.repo.Get(ctx, vpnServiceID)
	if err != nil {
		return nil, fmt.Errorf("VPN service not found: %w", err)
	}

	// Find and remove connection
	var newConnections []domain.VpnConnection
	found := false
	for _, c := range vpn.Spec.Connections {
		if c.ID == connectionID {
			found = true
			continue
		}
		newConnections = append(newConnections, c)
	}

	if !found {
		return nil, fmt.Errorf("connection not found")
	}

	vpn.Spec.Connections = newConnections
	vpn.UpdatedAt = time.Now()

	// TODO: Update WireGuard config to remove peer

	updatedVPN, err := s.repo.Update(ctx, vpn)
	if err != nil {
		logger.Error("Failed to update VPN service", zap.Error(err))
		return nil, fmt.Errorf("failed to update VPN: %w", err)
	}

	return updatedVPN, nil
}

// =============================================================================
// Client Configuration
// =============================================================================

// ClientConfig holds WireGuard client configuration.
type ClientConfig struct {
	Config    string
	PublicKey string
	Endpoint  string
}

// GetClientConfig generates a WireGuard client configuration for a peer.
func (s *VpnServiceManager) GetClientConfig(ctx context.Context, vpnServiceID, connectionID string) (*ClientConfig, error) {
	logger := s.logger.With(
		zap.String("method", "GetClientConfig"),
		zap.String("vpn_id", vpnServiceID),
	)

	vpn, err := s.repo.Get(ctx, vpnServiceID)
	if err != nil {
		return nil, fmt.Errorf("VPN service not found: %w", err)
	}

	// Find the connection
	var connection *domain.VpnConnection
	for i := range vpn.Spec.Connections {
		if vpn.Spec.Connections[i].ID == connectionID {
			connection = &vpn.Spec.Connections[i]
			break
		}
	}

	if connection == nil {
		return nil, fmt.Errorf("connection not found")
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

	return &ClientConfig{
		Config:    config,
		PublicKey: vpn.Status.PublicKey,
		Endpoint:  fmt.Sprintf("%s:51820", vpn.Spec.ExternalIP),
	}, nil
}

// =============================================================================
// Helper Functions
// =============================================================================

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
