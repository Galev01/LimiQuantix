// Package network implements real-time port status streaming.
// This allows the frontend to receive live updates when port states change.
package network

import (
	"context"
	"sync"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// =============================================================================
// PORT STATUS STREAMING
// =============================================================================

// PortStatusUpdate represents a port status change event.
type PortStatusUpdate struct {
	PortID      string
	NetworkID   string
	Phase       domain.PortPhase
	IPAddresses []string
	HostID      string
	VMID        string
	OVNSynced   bool
	Timestamp   time.Time
}

// PortStatusSubscriber is a function that receives port status updates.
type PortStatusSubscriber func(update PortStatusUpdate)

// PortStatusHub manages port status subscriptions and broadcasts.
type PortStatusHub struct {
	mu          sync.RWMutex
	subscribers map[string][]PortStatusSubscriber // networkID -> subscribers
	logger      *zap.Logger
}

// NewPortStatusHub creates a new port status hub.
func NewPortStatusHub(logger *zap.Logger) *PortStatusHub {
	return &PortStatusHub{
		subscribers: make(map[string][]PortStatusSubscriber),
		logger:      logger.Named("port-status-hub"),
	}
}

// Subscribe adds a subscriber for a network's port status updates.
// Returns an unsubscribe function.
func (h *PortStatusHub) Subscribe(networkID string, subscriber PortStatusSubscriber) func() {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.subscribers[networkID] = append(h.subscribers[networkID], subscriber)
	index := len(h.subscribers[networkID]) - 1

	h.logger.Debug("Subscriber added",
		zap.String("network_id", networkID),
		zap.Int("subscriber_count", len(h.subscribers[networkID])),
	)

	// Return unsubscribe function
	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		subs := h.subscribers[networkID]
		if index < len(subs) {
			// Remove subscriber by replacing with last and shrinking
			h.subscribers[networkID] = append(subs[:index], subs[index+1:]...)
		}

		h.logger.Debug("Subscriber removed",
			zap.String("network_id", networkID),
			zap.Int("subscriber_count", len(h.subscribers[networkID])),
		)
	}
}

// Broadcast sends a port status update to all subscribers for the network.
func (h *PortStatusHub) Broadcast(update PortStatusUpdate) {
	h.mu.RLock()
	subs := h.subscribers[update.NetworkID]
	h.mu.RUnlock()

	if len(subs) == 0 {
		return
	}

	h.logger.Debug("Broadcasting port status update",
		zap.String("port_id", update.PortID),
		zap.String("network_id", update.NetworkID),
		zap.String("phase", string(update.Phase)),
		zap.Int("subscriber_count", len(subs)),
	)

	for _, sub := range subs {
		sub(update)
	}
}

// BroadcastAll sends a port status update to all subscribers.
func (h *PortStatusHub) BroadcastAll(update PortStatusUpdate) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, subs := range h.subscribers {
		for _, sub := range subs {
			sub(update)
		}
	}
}

// SubscriberCount returns the number of subscribers for a network.
func (h *PortStatusHub) SubscriberCount(networkID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.subscribers[networkID])
}

// TotalSubscribers returns the total number of subscribers across all networks.
func (h *PortStatusHub) TotalSubscribers() int {
	h.mu.RLock()
	defer h.mu.RUnlock()

	count := 0
	for _, subs := range h.subscribers {
		count += len(subs)
	}
	return count
}

// =============================================================================
// STREAMING SERVICE
// =============================================================================

// PortStreamingService implements the WatchPorts streaming RPC.
type PortStreamingService struct {
	repo      PortRepository
	hub       *PortStatusHub
	portSvc   *PortService
	logger    *zap.Logger
}

// NewPortStreamingService creates a new port streaming service.
func NewPortStreamingService(
	repo PortRepository,
	hub *PortStatusHub,
	logger *zap.Logger,
) *PortStreamingService {
	return &PortStreamingService{
		repo:   repo,
		hub:    hub,
		logger: logger.Named("port-streaming"),
	}
}

// WatchPorts streams port status updates for a network.
func (s *PortStreamingService) WatchPorts(
	ctx context.Context,
	req *connect.Request[networkv1.WatchPortsRequest],
	stream *connect.ServerStream[networkv1.Port],
) error {
	networkID := req.Msg.NetworkId
	logger := s.logger.With(
		zap.String("network_id", networkID),
	)
	logger.Info("Client started watching ports")

	// Send initial snapshot of all ports
	if err := s.sendInitialSnapshot(ctx, networkID, stream); err != nil {
		logger.Error("Failed to send initial snapshot", zap.Error(err))
		return err
	}

	// Create update channel
	updates := make(chan PortStatusUpdate, 100)

	// Subscribe to updates
	unsubscribe := s.hub.Subscribe(networkID, func(update PortStatusUpdate) {
		select {
		case updates <- update:
		default:
			logger.Warn("Update channel full, dropping update",
				zap.String("port_id", update.PortID),
			)
		}
	})
	defer unsubscribe()

	// Stream updates until client disconnects
	for {
		select {
		case <-ctx.Done():
			logger.Info("Client disconnected from port watch")
			return nil

		case update := <-updates:
			port, err := s.repo.Get(ctx, update.PortID)
			if err != nil {
				logger.Warn("Failed to get port for update",
					zap.String("port_id", update.PortID),
					zap.Error(err),
				)
				continue
			}

			if err := stream.Send(convertPortToProto(port)); err != nil {
				logger.Error("Failed to send port update", zap.Error(err))
				return err
			}

			logger.Debug("Sent port update",
				zap.String("port_id", update.PortID),
				zap.String("phase", string(update.Phase)),
			)
		}
	}
}

// sendInitialSnapshot sends the current state of all ports in the network.
func (s *PortStreamingService) sendInitialSnapshot(
	ctx context.Context,
	networkID string,
	stream *connect.ServerStream[networkv1.Port],
) error {
	filter := PortFilter{NetworkID: networkID}
	ports, _, err := s.repo.List(ctx, filter, 1000, 0)
	if err != nil {
		return err
	}

	for _, port := range ports {
		if err := stream.Send(convertPortToProto(port)); err != nil {
			return err
		}
	}

	s.logger.Debug("Sent initial snapshot",
		zap.String("network_id", networkID),
		zap.Int("port_count", len(ports)),
	)

	return nil
}

// =============================================================================
// PORT STATUS NOTIFIER
// =============================================================================

// PortStatusNotifier notifies the hub when port status changes.
// This should be called by the PortService when port status changes.
type PortStatusNotifier struct {
	hub    *PortStatusHub
	logger *zap.Logger
}

// NewPortStatusNotifier creates a new port status notifier.
func NewPortStatusNotifier(hub *PortStatusHub, logger *zap.Logger) *PortStatusNotifier {
	return &PortStatusNotifier{
		hub:    hub,
		logger: logger.Named("port-notifier"),
	}
}

// NotifyPortCreated notifies subscribers that a port was created.
func (n *PortStatusNotifier) NotifyPortCreated(port *domain.Port) {
	n.hub.Broadcast(PortStatusUpdate{
		PortID:      port.ID,
		NetworkID:   port.NetworkID,
		Phase:       port.Status.Phase,
		IPAddresses: port.Status.IPAddresses,
		HostID:      port.Status.HostID,
		VMID:        port.Status.VMID,
		OVNSynced:   port.Status.OVNPort != "",
		Timestamp:   time.Now(),
	})
}

// NotifyPortUpdated notifies subscribers that a port was updated.
func (n *PortStatusNotifier) NotifyPortUpdated(port *domain.Port) {
	n.hub.Broadcast(PortStatusUpdate{
		PortID:      port.ID,
		NetworkID:   port.NetworkID,
		Phase:       port.Status.Phase,
		IPAddresses: port.Status.IPAddresses,
		HostID:      port.Status.HostID,
		VMID:        port.Status.VMID,
		OVNSynced:   port.Status.OVNPort != "",
		Timestamp:   time.Now(),
	})
}

// NotifyPortDeleted notifies subscribers that a port was deleted.
func (n *PortStatusNotifier) NotifyPortDeleted(portID, networkID string) {
	n.hub.Broadcast(PortStatusUpdate{
		PortID:    portID,
		NetworkID: networkID,
		Phase:     domain.PortPhase("DELETED"),
		Timestamp: time.Now(),
	})
}

// NotifyPortBound notifies subscribers that a port was bound to a VM.
func (n *PortStatusNotifier) NotifyPortBound(port *domain.Port) {
	n.hub.Broadcast(PortStatusUpdate{
		PortID:      port.ID,
		NetworkID:   port.NetworkID,
		Phase:       domain.PortPhaseActive,
		IPAddresses: port.Status.IPAddresses,
		HostID:      port.Status.HostID,
		VMID:        port.Status.VMID,
		OVNSynced:   true,
		Timestamp:   time.Now(),
	})
}

// NotifyPortUnbound notifies subscribers that a port was unbound from a VM.
func (n *PortStatusNotifier) NotifyPortUnbound(port *domain.Port) {
	n.hub.Broadcast(PortStatusUpdate{
		PortID:      port.ID,
		NetworkID:   port.NetworkID,
		Phase:       domain.PortPhaseDown,
		IPAddresses: port.Status.IPAddresses,
		HostID:      "",
		VMID:        "",
		OVNSynced:   false,
		Timestamp:   time.Now(),
	})
}

// =============================================================================
// NETWORK EVENTS
// =============================================================================

// NetworkEvent represents a network-level event.
type NetworkEvent struct {
	Type      string    `json:"type"` // "created", "updated", "deleted"
	NetworkID string    `json:"network_id"`
	Name      string    `json:"name"`
	Timestamp time.Time `json:"timestamp"`
}

// NetworkEventSubscriber is a function that receives network events.
type NetworkEventSubscriber func(event NetworkEvent)

// NetworkEventHub manages network event subscriptions.
type NetworkEventHub struct {
	mu          sync.RWMutex
	subscribers map[string][]NetworkEventSubscriber // projectID -> subscribers
	logger      *zap.Logger
}

// NewNetworkEventHub creates a new network event hub.
func NewNetworkEventHub(logger *zap.Logger) *NetworkEventHub {
	return &NetworkEventHub{
		subscribers: make(map[string][]NetworkEventSubscriber),
		logger:      logger.Named("network-event-hub"),
	}
}

// Subscribe adds a subscriber for a project's network events.
func (h *NetworkEventHub) Subscribe(projectID string, subscriber NetworkEventSubscriber) func() {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.subscribers[projectID] = append(h.subscribers[projectID], subscriber)
	index := len(h.subscribers[projectID]) - 1

	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		subs := h.subscribers[projectID]
		if index < len(subs) {
			h.subscribers[projectID] = append(subs[:index], subs[index+1:]...)
		}
	}
}

// Broadcast sends a network event to all subscribers for the project.
func (h *NetworkEventHub) Broadcast(projectID string, event NetworkEvent) {
	h.mu.RLock()
	subs := h.subscribers[projectID]
	h.mu.RUnlock()

	for _, sub := range subs {
		sub(event)
	}
}
