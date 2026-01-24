// Package node provides services for managing hypervisor nodes.
// This file contains the Node Watcher which monitors node events.
package node

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	nodev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/node/v1"
)

// Watcher monitors node health and events via a persistent gRPC stream.
type Watcher struct {
	nodeRepo   Repository
	vmRepo     VMRepository
	daemonPool *DaemonPool
	logger     *zap.Logger
}

// NewWatcher creates a new Node Watcher.
func NewWatcher(
	nodeRepo Repository,
	vmRepo VMRepository,
	daemonPool *DaemonPool,
	logger *zap.Logger,
) *Watcher {
	return &Watcher{
		nodeRepo:   nodeRepo,
		vmRepo:     vmRepo,
		daemonPool: daemonPool,
		logger:     logger.Named("node-watcher"),
	}
}

// WatchNode starts a background goroutine to watch a node.
// It maintains a StreamEvents connection and handles disconnections.
func (w *Watcher) WatchNode(ctx context.Context, nodeID string) {
	// Run in a goroutine
	go func() {
		// Create a child context for the watcher loop
		// We don't want this to cancel unless the app shuts down
		watchCtx := context.Background()
		// In a real app we might want a way to stop this specific watcher,
		// but typically it runs until the node disconnects.

		w.logger.Info("Starting watcher for node", zap.String("node_id", nodeID))

		// Get the client
		// We use a retry loop to establish the initial watch if needed,
		// but typically this is called after successful connection.
		client := w.daemonPool.Get(nodeID)
		if client == nil {
			w.logger.Error("Cannot watch node: no connection", zap.String("node_id", nodeID))
			return
		}

		// Start streaming events
		stream, err := client.StreamEvents(watchCtx)
		if err != nil {
			w.logger.Error("Failed to start event stream",
				zap.String("node_id", nodeID),
				zap.Error(err),
			)
			// Immediate disconnection handling
			w.handleDisconnection(watchCtx, nodeID)
			return
		}

		w.logger.Info("Event stream established", zap.String("node_id", nodeID))

		// Processing loop
		for {
			event, ok := <-stream

			// Handle stream closure (Disconnection)
			if !ok {
				w.logger.Warn("Event stream closed", zap.String("node_id", nodeID))
				w.handleDisconnection(watchCtx, nodeID)
				return
			}

			// Process the event
			w.handleEvent(watchCtx, nodeID, event)
		}
	}()
}

// handleDisconnection marks the node as disconnected immediately.
func (w *Watcher) handleDisconnection(ctx context.Context, nodeID string) {
	w.logger.Warn("Node disconnected (stream break)", zap.String("node_id", nodeID))

	// 1. Update Node Status in DB
	node, err := w.nodeRepo.Get(ctx, nodeID)
	if err != nil {
		w.logger.Error("Failed to get node for disconnection update",
			zap.String("node_id", nodeID),
			zap.Error(err),
		)
		return
	}

	// Only update if not already in a terminal state or maintenance
	if node.Status.Phase != domain.NodePhaseMaintenance &&
		node.Status.Phase != domain.NodePhaseDraining {

		node.Status.Phase = domain.NodePhaseDisconnected
		// Add a condition
		disconnectedCondition := domain.NodeCondition{
			Type:       "Ready",
			Status:     "False",
			Reason:     "StreamDisconnected",
			Message:    "Real-time event stream disconnected",
			LastUpdate: time.Now(),
		}
		// Replace or append Ready condition
		found := false
		for i, c := range node.Status.Conditions {
			if c.Type == "Ready" {
				node.Status.Conditions[i] = disconnectedCondition
				found = true
				break
			}
		}
		if !found {
			node.Status.Conditions = append(node.Status.Conditions, disconnectedCondition)
		}

		if err := w.nodeRepo.UpdateStatus(ctx, nodeID, node.Status); err != nil {
			w.logger.Error("Failed to update node status to DISCONNECTED",
				zap.Error(err),
			)
		} else {
			w.logger.Info("Node marked as DISCONNECTED in database", zap.String("node_id", nodeID))
		}
	}

	// 2. Clean up DaemonPool connection
	// This prevents using a broken connection for subsequent calls
	if err := w.daemonPool.Disconnect(nodeID); err != nil {
		w.logger.Warn("Failed to disconnect from daemon pool", zap.Error(err))
	}
}

// handleEvent processes a single event from the node.
func (w *Watcher) handleEvent(ctx context.Context, nodeID string, event *nodev1.NodeEvent) {
	w.logger.Debug("Received node event",
		zap.String("node_id", nodeID),
		zap.String("type", event.Type.String()),
		zap.String("vm_id", event.VmId),
	)

	switch event.Type {
	case nodev1.EventType_EVENT_TYPE_VM_CRASHED:
		w.handleVMCrash(ctx, event)
	case nodev1.EventType_EVENT_TYPE_VM_STOPPED:
		w.handleVMStop(ctx, event)
	case nodev1.EventType_EVENT_TYPE_VM_STARTED:
		w.handleVMStart(ctx, event)
	}
}

func (w *Watcher) handleVMCrash(ctx context.Context, event *nodev1.NodeEvent) {
	w.logger.Warn("VM Crashed", zap.String("vm_id", event.VmId))

	vm, err := w.vmRepo.Get(ctx, event.VmId)
	if err != nil {
		w.logger.Error("Failed to get VM for crash update", zap.Error(err))
		return
	}

	// Update status
	vm.Status.State = domain.VMStateError
	vm.Status.Message = fmt.Sprintf("VM Crashed: %s", event.Message)

	if err := w.vmRepo.UpdateStatus(ctx, vm.ID, vm.Status); err != nil {
		w.logger.Error("Failed to update VM crash status", zap.Error(err))
	}

	// Create Event Record in DB
	// TODO: Add EventRepository to Watcher to store this persistently
}

func (w *Watcher) handleVMStop(ctx context.Context, event *nodev1.NodeEvent) {
	// If backend thinks it's running, set to stopped
	vm, err := w.vmRepo.Get(ctx, event.VmId)
	if err != nil {
		return
	}

	if vm.Status.State != domain.VMStateStopped {
		w.logger.Info("Reconciling VM state: RUNNING -> STOPPED", zap.String("vm_id", vm.ID))
		vm.Status.State = domain.VMStateStopped
		vm.Status.Message = "Stopped (detected by host)"
		w.vmRepo.UpdateStatus(ctx, vm.ID, vm.Status)
	}
}

func (w *Watcher) handleVMStart(ctx context.Context, event *nodev1.NodeEvent) {
	// If backend thinks it's stopped, set to running
	vm, err := w.vmRepo.Get(ctx, event.VmId)
	if err != nil {
		return
	}

	if vm.Status.State != domain.VMStateRunning {
		w.logger.Info("Reconciling VM state: STOPPED -> RUNNING", zap.String("vm_id", vm.ID))
		vm.Status.State = domain.VMStateRunning
		vm.Status.Message = "Running (detected by host)"
		w.vmRepo.UpdateStatus(ctx, vm.ID, vm.Status)
	}
}
