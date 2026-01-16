// Package main - Node Maintenance Mode for safe hypervisor updates
// Coordinates with the control plane to drain VMs before updates
package main

import (
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"go.uber.org/zap"
)

// MaintenanceState represents the state of a node in maintenance mode
type MaintenanceState string

const (
	MaintenanceStateNone       MaintenanceState = "none"
	MaintenanceStateRequested  MaintenanceState = "requested"
	MaintenanceStateDraining   MaintenanceState = "draining"
	MaintenanceStateReady      MaintenanceState = "ready"      // Node is empty, ready for update
	MaintenanceStateUpdating   MaintenanceState = "updating"   // Update in progress
	MaintenanceStateRebooting  MaintenanceState = "rebooting"  // Rebooting after A/B update
	MaintenanceStateVerifying  MaintenanceState = "verifying"  // Post-update health check
	MaintenanceStateCompleted  MaintenanceState = "completed"  // Update successful
	MaintenanceStateFailed     MaintenanceState = "failed"     // Update failed
	MaintenanceStateCancelled  MaintenanceState = "cancelled"  // Maintenance cancelled
)

// NodeMaintenanceInfo tracks maintenance status for a node
type NodeMaintenanceInfo struct {
	NodeID          string           `json:"node_id"`
	State           MaintenanceState `json:"state"`
	RequestedAt     *time.Time       `json:"requested_at,omitempty"`
	DrainingStarted *time.Time       `json:"draining_started,omitempty"`
	ReadyAt         *time.Time       `json:"ready_at,omitempty"`
	UpdateStarted   *time.Time       `json:"update_started,omitempty"`
	CompletedAt     *time.Time       `json:"completed_at,omitempty"`

	// VM migration progress
	TotalVMs      int      `json:"total_vms"`
	MigratedVMs   int      `json:"migrated_vms"`
	FailedVMs     []string `json:"failed_vms,omitempty"`
	RemainingVMs  []string `json:"remaining_vms,omitempty"`

	// Update info
	TargetVersion string `json:"target_version,omitempty"`
	UpdateType    string `json:"update_type,omitempty"` // "component" or "full"
	RequiresReboot bool  `json:"requires_reboot"`

	// Error info
	ErrorMessage string `json:"error_message,omitempty"`
}

// MaintenanceRequest is sent by a node to request maintenance mode
type MaintenanceRequest struct {
	NodeID        string `json:"node_id"`
	TargetVersion string `json:"target_version"`
	UpdateType    string `json:"update_type"`
	RequiresReboot bool  `json:"requires_reboot"`
	Force         bool   `json:"force"` // Skip VM migration, for emergencies
}

// MaintenanceResponse is sent back to the node
type MaintenanceResponse struct {
	Approved     bool             `json:"approved"`
	State        MaintenanceState `json:"state"`
	Message      string           `json:"message,omitempty"`
	WaitSeconds  int              `json:"wait_seconds,omitempty"` // Retry after this many seconds
	ProceedNow   bool             `json:"proceed_now"`            // Node can start update immediately
}

// DrainProgress is reported by the control plane during VM migration
type DrainProgress struct {
	NodeID       string   `json:"node_id"`
	TotalVMs     int      `json:"total_vms"`
	MigratedVMs  int      `json:"migrated_vms"`
	FailedVMs    []string `json:"failed_vms,omitempty"`
	RemainingVMs []string `json:"remaining_vms,omitempty"`
	Completed    bool     `json:"completed"`
	Error        string   `json:"error,omitempty"`
}

// maintenanceStore tracks maintenance state for all nodes
var maintenanceStore = struct {
	sync.RWMutex
	nodes map[string]*NodeMaintenanceInfo
}{
	nodes: make(map[string]*NodeMaintenanceInfo),
}

// RegisterMaintenanceRoutes registers maintenance-related API endpoints
func RegisterMaintenanceRoutes(api fiber.Router) {
	maint := api.Group("/maintenance")

	// Node requests maintenance mode
	maint.Post("/request", handleMaintenanceRequest)

	// Node checks maintenance status
	maint.Get("/status/:nodeId", handleMaintenanceStatus)

	// Control plane reports drain progress
	maint.Post("/drain-progress", handleDrainProgress)

	// Node reports update completion
	maint.Post("/complete", handleMaintenanceComplete)

	// Cancel maintenance mode
	maint.Post("/cancel/:nodeId", handleMaintenanceCancel)

	// List all nodes in maintenance
	maint.Get("/list", handleMaintenanceList)
}

// handleMaintenanceRequest handles a node's request to enter maintenance mode
func handleMaintenanceRequest(c *fiber.Ctx) error {
	var req MaintenanceRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if req.NodeID == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "node_id is required",
		})
	}

	maintenanceStore.Lock()
	defer maintenanceStore.Unlock()

	// Check if node is already in maintenance
	existing, exists := maintenanceStore.nodes[req.NodeID]
	if exists && existing.State != MaintenanceStateNone && existing.State != MaintenanceStateCompleted && existing.State != MaintenanceStateCancelled {
		return c.JSON(MaintenanceResponse{
			Approved: true,
			State:    existing.State,
			Message:  "Already in maintenance mode",
		})
	}

	now := time.Now()
	info := &NodeMaintenanceInfo{
		NodeID:         req.NodeID,
		State:          MaintenanceStateRequested,
		RequestedAt:    &now,
		TargetVersion:  req.TargetVersion,
		UpdateType:     req.UpdateType,
		RequiresReboot: req.RequiresReboot,
	}

	// If force mode or this is a component update without reboot, allow immediate proceed
	if req.Force || (req.UpdateType == "component" && !req.RequiresReboot) {
		info.State = MaintenanceStateReady
		readyTime := time.Now()
		info.ReadyAt = &readyTime
		maintenanceStore.nodes[req.NodeID] = info

		log.Info("Maintenance approved immediately (component update)",
			zap.String("node_id", req.NodeID),
			zap.String("target_version", req.TargetVersion),
		)

		return c.JSON(MaintenanceResponse{
			Approved:   true,
			State:      MaintenanceStateReady,
			Message:    "Approved for component update",
			ProceedNow: true,
		})
	}

	// For full updates that require reboot, need to drain VMs first
	info.State = MaintenanceStateDraining
	drainingTime := time.Now()
	info.DrainingStarted = &drainingTime
	maintenanceStore.nodes[req.NodeID] = info

	// TODO: Notify control plane to start draining VMs
	// This would be a webhook or gRPC call to the control plane
	go notifyControlPlaneDrain(req.NodeID)

	log.Info("Maintenance requested - starting VM drain",
		zap.String("node_id", req.NodeID),
		zap.String("target_version", req.TargetVersion),
		zap.Bool("requires_reboot", req.RequiresReboot),
	)

	return c.JSON(MaintenanceResponse{
		Approved:    true,
		State:       MaintenanceStateDraining,
		Message:     "Draining VMs from node",
		WaitSeconds: 30, // Poll again in 30 seconds
		ProceedNow:  false,
	})
}

// handleMaintenanceStatus returns the current maintenance status for a node
func handleMaintenanceStatus(c *fiber.Ctx) error {
	nodeID := c.Params("nodeId")

	maintenanceStore.RLock()
	info, exists := maintenanceStore.nodes[nodeID]
	maintenanceStore.RUnlock()

	if !exists {
		return c.JSON(MaintenanceResponse{
			Approved: false,
			State:    MaintenanceStateNone,
			Message:  "No maintenance requested",
		})
	}

	response := MaintenanceResponse{
		Approved: true,
		State:    info.State,
	}

	switch info.State {
	case MaintenanceStateDraining:
		response.Message = fmt.Sprintf("Draining VMs: %d/%d migrated", info.MigratedVMs, info.TotalVMs)
		response.WaitSeconds = 30
	case MaintenanceStateReady:
		response.Message = "Node is drained, ready for update"
		response.ProceedNow = true
	case MaintenanceStateUpdating:
		response.Message = "Update in progress"
		response.WaitSeconds = 10
	case MaintenanceStateFailed:
		response.Message = info.ErrorMessage
	case MaintenanceStateCompleted:
		response.Message = "Update completed successfully"
	}

	return c.JSON(response)
}

// handleDrainProgress handles drain progress updates from the control plane
func handleDrainProgress(c *fiber.Ctx) error {
	var progress DrainProgress
	if err := c.BodyParser(&progress); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	maintenanceStore.Lock()
	defer maintenanceStore.Unlock()

	info, exists := maintenanceStore.nodes[progress.NodeID]
	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Node not in maintenance",
		})
	}

	info.TotalVMs = progress.TotalVMs
	info.MigratedVMs = progress.MigratedVMs
	info.FailedVMs = progress.FailedVMs
	info.RemainingVMs = progress.RemainingVMs

	if progress.Error != "" {
		info.State = MaintenanceStateFailed
		info.ErrorMessage = progress.Error
	} else if progress.Completed {
		info.State = MaintenanceStateReady
		now := time.Now()
		info.ReadyAt = &now
		log.Info("Node drain completed, ready for update",
			zap.String("node_id", progress.NodeID),
			zap.Int("migrated_vms", progress.MigratedVMs),
		)
	}

	return c.JSON(fiber.Map{
		"status": "updated",
		"state":  info.State,
	})
}

// handleMaintenanceComplete handles update completion notification from a node
func handleMaintenanceComplete(c *fiber.Ctx) error {
	var req struct {
		NodeID  string `json:"node_id"`
		Success bool   `json:"success"`
		Error   string `json:"error,omitempty"`
		Version string `json:"version,omitempty"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	maintenanceStore.Lock()
	defer maintenanceStore.Unlock()

	info, exists := maintenanceStore.nodes[req.NodeID]
	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Node not in maintenance",
		})
	}

	now := time.Now()
	info.CompletedAt = &now

	if req.Success {
		info.State = MaintenanceStateCompleted
		log.Info("Node update completed successfully",
			zap.String("node_id", req.NodeID),
			zap.String("version", req.Version),
		)

		// TODO: Notify control plane to re-enable scheduling on this node
		go notifyControlPlaneReady(req.NodeID)
	} else {
		info.State = MaintenanceStateFailed
		info.ErrorMessage = req.Error
		log.Error("Node update failed",
			zap.String("node_id", req.NodeID),
			zap.String("error", req.Error),
		)
	}

	return c.JSON(fiber.Map{
		"status": "acknowledged",
		"state":  info.State,
	})
}

// handleMaintenanceCancel cancels maintenance mode for a node
func handleMaintenanceCancel(c *fiber.Ctx) error {
	nodeID := c.Params("nodeId")

	maintenanceStore.Lock()
	defer maintenanceStore.Unlock()

	info, exists := maintenanceStore.nodes[nodeID]
	if !exists {
		return c.Status(http.StatusNotFound).JSON(fiber.Map{
			"error": "Node not in maintenance",
		})
	}

	// Can only cancel if not actively updating
	if info.State == MaintenanceStateUpdating || info.State == MaintenanceStateRebooting {
		return c.Status(http.StatusConflict).JSON(fiber.Map{
			"error": "Cannot cancel - update in progress",
		})
	}

	info.State = MaintenanceStateCancelled
	log.Info("Maintenance cancelled",
		zap.String("node_id", nodeID),
	)

	// TODO: Notify control plane to re-enable scheduling
	go notifyControlPlaneReady(nodeID)

	return c.JSON(fiber.Map{
		"status": "cancelled",
	})
}

// handleMaintenanceList returns all nodes currently in maintenance
func handleMaintenanceList(c *fiber.Ctx) error {
	maintenanceStore.RLock()
	defer maintenanceStore.RUnlock()

	nodes := make([]*NodeMaintenanceInfo, 0, len(maintenanceStore.nodes))
	for _, info := range maintenanceStore.nodes {
		if info.State != MaintenanceStateNone {
			nodes = append(nodes, info)
		}
	}

	return c.JSON(fiber.Map{
		"nodes": nodes,
		"count": len(nodes),
	})
}

// notifyControlPlaneDrain notifies the control plane to drain a node
func notifyControlPlaneDrain(nodeID string) {
	controlPlaneURL := getEnv("CONTROL_PLANE_URL", "")
	if controlPlaneURL == "" {
		log.Warn("Control plane URL not configured, skipping drain notification")
		// For development, simulate immediate drain completion
		simulateDrainCompletion(nodeID)
		return
	}

	// TODO: Make actual HTTP/gRPC call to control plane
	log.Info("Notifying control plane to drain node",
		zap.String("node_id", nodeID),
		zap.String("control_plane_url", controlPlaneURL),
	)
}

// notifyControlPlaneReady notifies the control plane that a node is ready
func notifyControlPlaneReady(nodeID string) {
	controlPlaneURL := getEnv("CONTROL_PLANE_URL", "")
	if controlPlaneURL == "" {
		log.Warn("Control plane URL not configured, skipping ready notification")
		return
	}

	// TODO: Make actual HTTP/gRPC call to control plane
	log.Info("Notifying control plane that node is ready",
		zap.String("node_id", nodeID),
		zap.String("control_plane_url", controlPlaneURL),
	)
}

// simulateDrainCompletion simulates VM drain for development
func simulateDrainCompletion(nodeID string) {
	time.Sleep(5 * time.Second) // Simulate some delay

	maintenanceStore.Lock()
	defer maintenanceStore.Unlock()

	info, exists := maintenanceStore.nodes[nodeID]
	if !exists || info.State != MaintenanceStateDraining {
		return
	}

	info.State = MaintenanceStateReady
	now := time.Now()
	info.ReadyAt = &now
	info.TotalVMs = 0
	info.MigratedVMs = 0

	log.Info("Simulated drain completion",
		zap.String("node_id", nodeID),
	)
}
