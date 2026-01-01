// Package ha implements High Availability management for VMs.
package ha

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/config"
	"github.com/limiquantix/limiquantix/internal/domain"
)

// NodeRepository defines the interface for node data access.
type NodeRepository interface {
	Get(ctx context.Context, id string) (*domain.Node, error)
	List(ctx context.Context, filter interface{}) ([]*domain.Node, error)
	ListSchedulable(ctx context.Context) ([]*domain.Node, error)
	UpdateStatus(ctx context.Context, id string, status domain.NodeStatus) error
}

// VMRepository defines the interface for VM data access.
type VMRepository interface {
	Get(ctx context.Context, id string) (*domain.VirtualMachine, error)
	ListByNodeID(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error)
	UpdateStatus(ctx context.Context, id string, status domain.VMStatus) error
}

// Scheduler provides VM placement decisions.
type Scheduler interface {
	FindBestNode(ctx context.Context, vm *domain.VirtualMachine, excludeNodes []string) (string, error)
}

// VMController controls VM lifecycle.
type VMController interface {
	StartVM(ctx context.Context, vmID string, targetNodeID string) error
}

// AlertService creates alerts for HA events.
type AlertService interface {
	VMAlert(ctx context.Context, severity domain.AlertSeverity, vmID, vmName, title, message string) (*domain.Alert, error)
	NodeAlert(ctx context.Context, severity domain.AlertSeverity, nodeID, nodeName, title, message string) (*domain.Alert, error)
}

// LeaderChecker checks if this instance is the leader.
type LeaderChecker interface {
	IsLeader() bool
}

// NodeState tracks the health state of a node.
type NodeState struct {
	NodeID        string
	Hostname      string
	LastHeartbeat time.Time
	FailedChecks  int
	Status        NodeHealthStatus
}

// NodeHealthStatus represents the health status of a node.
type NodeHealthStatus string

const (
	NodeHealthStatusHealthy     NodeHealthStatus = "HEALTHY"
	NodeHealthStatusUnknown     NodeHealthStatus = "UNKNOWN"
	NodeHealthStatusUnreachable NodeHealthStatus = "UNREACHABLE"
	NodeHealthStatusFailed      NodeHealthStatus = "FAILED"
)

// Manager is the HA manager that monitors nodes and restarts failed VMs.
type Manager struct {
	config        config.HAConfig
	nodeRepo      NodeRepository
	vmRepo        VMRepository
	scheduler     Scheduler
	vmController  VMController
	alertService  AlertService
	leaderChecker LeaderChecker
	logger        *zap.Logger

	mu         sync.RWMutex
	nodeStates map[string]*NodeState
	isRunning  bool
}

// NewManager creates a new HA manager.
func NewManager(
	cfg config.HAConfig,
	nodeRepo NodeRepository,
	vmRepo VMRepository,
	scheduler Scheduler,
	vmController VMController,
	alertService AlertService,
	leaderChecker LeaderChecker,
	logger *zap.Logger,
) *Manager {
	return &Manager{
		config:        cfg,
		nodeRepo:      nodeRepo,
		vmRepo:        vmRepo,
		scheduler:     scheduler,
		vmController:  vmController,
		alertService:  alertService,
		leaderChecker: leaderChecker,
		logger:        logger.With(zap.String("component", "ha")),
		nodeStates:    make(map[string]*NodeState),
	}
}

// Start begins the HA monitoring loop.
func (m *Manager) Start(ctx context.Context) {
	if !m.config.Enabled {
		m.logger.Info("HA manager disabled")
		return
	}

	m.mu.Lock()
	if m.isRunning {
		m.mu.Unlock()
		return
	}
	m.isRunning = true
	m.mu.Unlock()

	m.logger.Info("Starting HA manager",
		zap.Duration("check_interval", m.config.CheckInterval),
		zap.Int("failure_threshold", m.config.FailureThreshold),
	)

	ticker := time.NewTicker(m.config.CheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			m.logger.Info("HA manager stopped")
			m.mu.Lock()
			m.isRunning = false
			m.mu.Unlock()
			return
		case <-ticker.C:
			m.checkNodes(ctx)
		}
	}
}

// checkNodes monitors all nodes and triggers failover if needed.
func (m *Manager) checkNodes(ctx context.Context) {
	// Only run on leader
	if m.leaderChecker != nil && !m.leaderChecker.IsLeader() {
		return
	}

	nodes, err := m.nodeRepo.ListSchedulable(ctx)
	if err != nil {
		m.logger.Error("Failed to list nodes", zap.Error(err))
		return
	}

	for _, node := range nodes {
		m.checkNode(ctx, node)
	}
}

// checkNode checks a single node's health.
func (m *Manager) checkNode(ctx context.Context, node *domain.Node) {
	m.mu.Lock()
	state, exists := m.nodeStates[node.ID]
	if !exists {
		state = &NodeState{
			NodeID:   node.ID,
			Hostname: node.Hostname,
			Status:   NodeHealthStatusHealthy,
		}
		m.nodeStates[node.ID] = state
	}
	m.mu.Unlock()

	// Check heartbeat age
	var heartbeatAge time.Duration
	if node.LastHeartbeat != nil {
		heartbeatAge = time.Since(*node.LastHeartbeat)
	} else {
		heartbeatAge = time.Hour * 24 // No heartbeat ever received
	}
	isHealthy := heartbeatAge < m.config.HeartbeatTimeout

	if isHealthy {
		// Node is healthy
		if state.Status != NodeHealthStatusHealthy {
			m.logger.Info("Node recovered",
				zap.String("node_id", node.ID),
				zap.String("hostname", node.Hostname),
			)
		}
		if node.LastHeartbeat != nil {
			state.LastHeartbeat = *node.LastHeartbeat
		}
		state.FailedChecks = 0
		state.Status = NodeHealthStatusHealthy
		return
	}

	// Node might be failing
	state.FailedChecks++
	m.logger.Warn("Node heartbeat missing",
		zap.String("node_id", node.ID),
		zap.String("hostname", node.Hostname),
		zap.Duration("heartbeat_age", heartbeatAge),
		zap.Int("failed_checks", state.FailedChecks),
	)

	if state.FailedChecks < m.config.FailureThreshold {
		state.Status = NodeHealthStatusUnknown
		return
	}

	// Node has failed
	if state.Status != NodeHealthStatusFailed {
		state.Status = NodeHealthStatusFailed
		m.logger.Error("Node declared failed",
			zap.String("node_id", node.ID),
			zap.String("hostname", node.Hostname),
		)

		// Create alert
		if m.alertService != nil {
			m.alertService.NodeAlert(ctx, domain.AlertSeverityCritical,
				node.ID, node.Hostname,
				"Node Failed",
				fmt.Sprintf("Node %s has failed and is unreachable. HA failover initiated.", node.Hostname),
			)
		}

		// Trigger failover
		m.triggerFailover(ctx, node)
	}
}

// triggerFailover restarts VMs from a failed node on other nodes.
func (m *Manager) triggerFailover(ctx context.Context, failedNode *domain.Node) {
	m.logger.Info("Initiating HA failover",
		zap.String("failed_node_id", failedNode.ID),
		zap.String("failed_node_hostname", failedNode.Hostname),
	)

	// Get VMs on failed node
	vms, err := m.vmRepo.ListByNodeID(ctx, failedNode.ID)
	if err != nil {
		m.logger.Error("Failed to list VMs on failed node", zap.Error(err))
		return
	}

	if len(vms) == 0 {
		m.logger.Info("No VMs to failover on failed node")
		return
	}

	// Filter for HA-enabled VMs that were running
	var haVMs []*domain.VirtualMachine
	for _, vm := range vms {
		if vm.Status.State == domain.VMStateRunning && vm.Spec.HAPolicy != nil && vm.Spec.HAPolicy.AutoRestart {
			haVMs = append(haVMs, vm)
		}
	}

	m.logger.Info("Found HA-enabled VMs to failover",
		zap.Int("total_vms", len(vms)),
		zap.Int("ha_vms", len(haVMs)),
	)

	// Sort by priority (higher priority first)
	// VMs with RestartPriority 1 should start before 2, etc.

	// Restart VMs on other nodes
	for _, vm := range haVMs {
		m.failoverVM(ctx, vm, failedNode.ID)
	}

	// Update node status
	failedNode.Status.Phase = domain.NodePhaseNotReady
	if err := m.nodeRepo.UpdateStatus(ctx, failedNode.ID, failedNode.Status); err != nil {
		m.logger.Error("Failed to update node status", zap.Error(err))
	}
}

// failoverVM restarts a single VM on another node.
func (m *Manager) failoverVM(ctx context.Context, vm *domain.VirtualMachine, failedNodeID string) {
	m.logger.Info("Failing over VM",
		zap.String("vm_id", vm.ID),
		zap.String("vm_name", vm.Name),
	)

	// Find a new node
	targetNodeID, err := m.scheduler.FindBestNode(ctx, vm, []string{failedNodeID})
	if err != nil {
		m.logger.Error("Failed to find target node for VM",
			zap.String("vm_id", vm.ID),
			zap.Error(err),
		)

		// Create alert
		if m.alertService != nil {
			m.alertService.VMAlert(ctx, domain.AlertSeverityCritical,
				vm.ID, vm.Name,
				"VM Failover Failed",
				fmt.Sprintf("Failed to find available host for VM %s during HA failover.", vm.Name),
			)
		}
		return
	}

	// Start VM on new node
	if m.vmController != nil {
		if err := m.vmController.StartVM(ctx, vm.ID, targetNodeID); err != nil {
			m.logger.Error("Failed to start VM on new node",
				zap.String("vm_id", vm.ID),
				zap.String("target_node_id", targetNodeID),
				zap.Error(err),
			)
			return
		}
	}

	// Update VM status
	vm.Status.NodeID = targetNodeID
	vm.Status.State = domain.VMStateStarting
	vm.Status.Message = fmt.Sprintf("HA failover from node %s", failedNodeID)

	if err := m.vmRepo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		m.logger.Error("Failed to update VM status", zap.Error(err))
	}

	m.logger.Info("VM failover initiated",
		zap.String("vm_id", vm.ID),
		zap.String("vm_name", vm.Name),
		zap.String("target_node_id", targetNodeID),
	)

	// Create info alert
	if m.alertService != nil {
		m.alertService.VMAlert(ctx, domain.AlertSeverityInfo,
			vm.ID, vm.Name,
			"VM Failed Over",
			fmt.Sprintf("VM %s has been failed over to a new host.", vm.Name),
		)
	}
}

// GetNodeState returns the current health state of a node.
func (m *Manager) GetNodeState(nodeID string) (*NodeState, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	state, exists := m.nodeStates[nodeID]
	return state, exists
}

// GetAllNodeStates returns all node states.
func (m *Manager) GetAllNodeStates() map[string]*NodeState {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make(map[string]*NodeState, len(m.nodeStates))
	for k, v := range m.nodeStates {
		result[k] = v
	}
	return result
}

// IsRunning returns true if the HA manager is running.
func (m *Manager) IsRunning() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.isRunning
}

// ManualFailover manually triggers failover for a node.
func (m *Manager) ManualFailover(ctx context.Context, nodeID string) error {
	node, err := m.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		return fmt.Errorf("node not found: %w", err)
	}

	m.logger.Info("Manual failover initiated", zap.String("node_id", nodeID))

	// Mark node as failed in our state
	m.mu.Lock()
	state, exists := m.nodeStates[nodeID]
	if !exists {
		state = &NodeState{
			NodeID:   node.ID,
			Hostname: node.Hostname,
		}
		m.nodeStates[nodeID] = state
	}
	state.Status = NodeHealthStatusFailed
	state.FailedChecks = m.config.FailureThreshold
	m.mu.Unlock()

	// Trigger failover
	m.triggerFailover(ctx, node)

	return nil
}
