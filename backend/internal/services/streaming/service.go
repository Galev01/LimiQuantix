// Package streaming provides real-time event streaming for VMs and Nodes.
package streaming

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
)

// Event represents a real-time event.
type Event struct {
	Type       EventType
	ResourceID string
	Resource   interface{}
	Timestamp  time.Time
}

// EventType represents the type of event.
type EventType string

const (
	EventTypeCreated EventType = "CREATED"
	EventTypeUpdated EventType = "UPDATED"
	EventTypeDeleted EventType = "DELETED"
	EventTypeStarted EventType = "STARTED"
	EventTypeStopped EventType = "STOPPED"
)

// Subscription represents a client subscription to events.
type Subscription struct {
	ID        string
	Filter    SubscriptionFilter
	Events    chan Event
	CreatedAt time.Time
	cancelFn  context.CancelFunc
}

// SubscriptionFilter filters which events a subscription receives.
type SubscriptionFilter struct {
	ResourceType string // "vm", "node", "alert", etc.
	ResourceID   string // Optional: specific resource
	EventTypes   []EventType
	ProjectID    string // For multi-tenant filtering
}

// Service manages real-time event streaming.
type Service struct {
	logger *zap.Logger

	mu            sync.RWMutex
	subscriptions map[string]*Subscription
	nextID        int64
}

// NewService creates a new streaming service.
func NewService(logger *zap.Logger) *Service {
	return &Service{
		logger:        logger.With(zap.String("service", "streaming")),
		subscriptions: make(map[string]*Subscription),
	}
}

// Subscribe creates a new subscription for events.
func (s *Service) Subscribe(ctx context.Context, filter SubscriptionFilter) (*Subscription, error) {
	s.mu.Lock()
	s.nextID++
	id := string(rune(s.nextID))
	subCtx, cancel := context.WithCancel(ctx)

	sub := &Subscription{
		ID:        id,
		Filter:    filter,
		Events:    make(chan Event, 100),
		CreatedAt: time.Now(),
		cancelFn:  cancel,
	}

	s.subscriptions[id] = sub
	s.mu.Unlock()

	s.logger.Info("Client subscribed",
		zap.String("subscription_id", id),
		zap.String("resource_type", filter.ResourceType),
		zap.String("resource_id", filter.ResourceID),
	)

	// Start cleanup goroutine
	go func() {
		<-subCtx.Done()
		s.Unsubscribe(id)
	}()

	return sub, nil
}

// Unsubscribe removes a subscription.
func (s *Service) Unsubscribe(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if sub, exists := s.subscriptions[id]; exists {
		close(sub.Events)
		sub.cancelFn()
		delete(s.subscriptions, id)
		s.logger.Info("Client unsubscribed", zap.String("subscription_id", id))
	}
}

// Publish sends an event to all matching subscriptions.
func (s *Service) Publish(event Event) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	event.Timestamp = time.Now()

	for _, sub := range s.subscriptions {
		if s.matchesFilter(event, sub.Filter) {
			select {
			case sub.Events <- event:
			default:
				// Channel full, skip (don't block publishers)
				s.logger.Warn("Subscription channel full, dropping event",
					zap.String("subscription_id", sub.ID),
				)
			}
		}
	}
}

// matchesFilter checks if an event matches a subscription filter.
func (s *Service) matchesFilter(event Event, filter SubscriptionFilter) bool {
	// Check resource type
	if filter.ResourceType != "" {
		resourceType := s.getResourceType(event.Resource)
		if resourceType != filter.ResourceType {
			return false
		}
	}

	// Check specific resource ID
	if filter.ResourceID != "" && event.ResourceID != filter.ResourceID {
		return false
	}

	// Check event types
	if len(filter.EventTypes) > 0 {
		found := false
		for _, et := range filter.EventTypes {
			if et == event.Type {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Check project ID for VMs
	if filter.ProjectID != "" {
		if vm, ok := event.Resource.(*domain.VirtualMachine); ok {
			if vm.ProjectID != filter.ProjectID {
				return false
			}
		}
	}

	return true
}

// getResourceType returns the type of a resource.
func (s *Service) getResourceType(resource interface{}) string {
	switch resource.(type) {
	case *domain.VirtualMachine:
		return "vm"
	case *domain.Node:
		return "node"
	case *domain.Alert:
		return "alert"
	case *domain.DRSRecommendation:
		return "drs"
	default:
		return "unknown"
	}
}

// PublishVMEvent publishes a VM-related event.
func (s *Service) PublishVMEvent(eventType EventType, vm *domain.VirtualMachine) {
	s.Publish(Event{
		Type:       eventType,
		ResourceID: vm.ID,
		Resource:   vm,
	})
}

// PublishNodeEvent publishes a node-related event.
func (s *Service) PublishNodeEvent(eventType EventType, node *domain.Node) {
	s.Publish(Event{
		Type:       eventType,
		ResourceID: node.ID,
		Resource:   node,
	})
}

// PublishAlertEvent publishes an alert-related event.
func (s *Service) PublishAlertEvent(eventType EventType, alert *domain.Alert) {
	s.Publish(Event{
		Type:       eventType,
		ResourceID: alert.ID,
		Resource:   alert,
	})
}

// GetSubscriptionCount returns the number of active subscriptions.
func (s *Service) GetSubscriptionCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.subscriptions)
}

// =============================================================================
// VM Watcher - Implements streaming for WatchVM RPC
// =============================================================================

// VMWatcher provides streaming updates for VMs.
type VMWatcher struct {
	streaming *Service
	vmRepo    VMRepository
	logger    *zap.Logger
}

// VMRepository defines the interface for VM data access.
type VMRepository interface {
	Get(ctx context.Context, id string) (*domain.VirtualMachine, error)
}

// NewVMWatcher creates a new VM watcher.
func NewVMWatcher(streaming *Service, vmRepo VMRepository, logger *zap.Logger) *VMWatcher {
	return &VMWatcher{
		streaming: streaming,
		vmRepo:    vmRepo,
		logger:    logger,
	}
}

// WatchVM streams updates for a specific VM.
func (w *VMWatcher) WatchVM(ctx context.Context, vmID string) (<-chan *domain.VirtualMachine, error) {
	// Get initial state
	vm, err := w.vmRepo.Get(ctx, vmID)
	if err != nil {
		return nil, err
	}

	// Subscribe to events
	sub, err := w.streaming.Subscribe(ctx, SubscriptionFilter{
		ResourceType: "vm",
		ResourceID:   vmID,
	})
	if err != nil {
		return nil, err
	}

	// Create output channel
	vmChan := make(chan *domain.VirtualMachine, 10)

	// Send initial state
	vmChan <- vm

	// Forward events
	go func() {
		defer close(vmChan)

		for event := range sub.Events {
			if vm, ok := event.Resource.(*domain.VirtualMachine); ok {
				select {
				case vmChan <- vm:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return vmChan, nil
}

// WatchVMs streams updates for all VMs matching a filter.
func (w *VMWatcher) WatchVMs(ctx context.Context, projectID string) (<-chan *domain.VirtualMachine, error) {
	// Subscribe to events
	sub, err := w.streaming.Subscribe(ctx, SubscriptionFilter{
		ResourceType: "vm",
		ProjectID:    projectID,
	})
	if err != nil {
		return nil, err
	}

	// Create output channel
	vmChan := make(chan *domain.VirtualMachine, 100)

	// Forward events
	go func() {
		defer close(vmChan)

		for event := range sub.Events {
			if vm, ok := event.Resource.(*domain.VirtualMachine); ok {
				select {
				case vmChan <- vm:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return vmChan, nil
}

// =============================================================================
// Node Watcher - Implements streaming for WatchNode RPC
// =============================================================================

// NodeWatcher provides streaming updates for nodes.
type NodeWatcher struct {
	streaming *Service
	nodeRepo  NodeRepository
	logger    *zap.Logger
}

// NodeRepository defines the interface for node data access.
type NodeRepository interface {
	Get(ctx context.Context, id string) (*domain.Node, error)
}

// NewNodeWatcher creates a new node watcher.
func NewNodeWatcher(streaming *Service, nodeRepo NodeRepository, logger *zap.Logger) *NodeWatcher {
	return &NodeWatcher{
		streaming: streaming,
		nodeRepo:  nodeRepo,
		logger:    logger,
	}
}

// WatchNode streams updates for a specific node.
func (w *NodeWatcher) WatchNode(ctx context.Context, nodeID string) (<-chan *domain.Node, error) {
	// Get initial state
	node, err := w.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		return nil, err
	}

	// Subscribe to events
	sub, err := w.streaming.Subscribe(ctx, SubscriptionFilter{
		ResourceType: "node",
		ResourceID:   nodeID,
	})
	if err != nil {
		return nil, err
	}

	// Create output channel
	nodeChan := make(chan *domain.Node, 10)

	// Send initial state
	nodeChan <- node

	// Forward events
	go func() {
		defer close(nodeChan)

		for event := range sub.Events {
			if node, ok := event.Resource.(*domain.Node); ok {
				select {
				case nodeChan <- node:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return nodeChan, nil
}

// WatchNodes streams updates for all nodes.
func (w *NodeWatcher) WatchNodes(ctx context.Context) (<-chan *domain.Node, error) {
	// Subscribe to events
	sub, err := w.streaming.Subscribe(ctx, SubscriptionFilter{
		ResourceType: "node",
	})
	if err != nil {
		return nil, err
	}

	// Create output channel
	nodeChan := make(chan *domain.Node, 100)

	// Forward events
	go func() {
		defer close(nodeChan)

		for event := range sub.Events {
			if node, ok := event.Resource.(*domain.Node); ok {
				select {
				case nodeChan <- node:
				case <-ctx.Done():
					return
				}
			}
		}
	}()

	return nodeChan, nil
}
