// Package drs implements the Distributed Resource Scheduler for VM load balancing.
package drs

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/config"
	"github.com/limiquantix/limiquantix/internal/domain"
)

// NodeRepository defines the interface for node data access.
type NodeRepository interface {
	ListSchedulable(ctx context.Context) ([]*domain.Node, error)
	Get(ctx context.Context, id string) (*domain.Node, error)
}

// VMRepository defines the interface for VM data access.
type VMRepository interface {
	ListByNodeID(ctx context.Context, nodeID string) ([]*domain.VirtualMachine, error)
}

// RecommendationRepository defines the interface for DRS recommendation storage.
type RecommendationRepository interface {
	Create(ctx context.Context, rec *domain.DRSRecommendation) (*domain.DRSRecommendation, error)
	Get(ctx context.Context, id string) (*domain.DRSRecommendation, error)
	List(ctx context.Context, status domain.DRSStatus, limit int) ([]*domain.DRSRecommendation, error)
	Update(ctx context.Context, rec *domain.DRSRecommendation) (*domain.DRSRecommendation, error)
	Delete(ctx context.Context, id string) error
	DeleteOld(ctx context.Context, olderThan time.Time) error
}

// AlertService creates alerts for DRS events.
type AlertService interface {
	ClusterAlert(ctx context.Context, severity domain.AlertSeverity, clusterID, clusterName, title, message string) (*domain.Alert, error)
}

// LeaderChecker checks if this instance is the leader.
type LeaderChecker interface {
	IsLeader() bool
}

// NodeMetrics contains resource usage metrics for a node.
type NodeMetrics struct {
	NodeID       string
	Hostname     string
	TotalCPU     int32
	UsedCPU      float64
	CPUPercent   float64
	TotalMemory  int64
	UsedMemory   float64
	MemoryPercent float64
	VMCount      int
}

// Engine is the DRS engine that analyzes cluster balance and generates recommendations.
type Engine struct {
	config        config.DRSConfig
	nodeRepo      NodeRepository
	vmRepo        VMRepository
	recommRepo    RecommendationRepository
	alertService  AlertService
	leaderChecker LeaderChecker
	logger        *zap.Logger

	mu          sync.RWMutex
	isRunning   bool
	lastAnalysis time.Time
}

// NewEngine creates a new DRS engine.
func NewEngine(
	cfg config.DRSConfig,
	nodeRepo NodeRepository,
	vmRepo VMRepository,
	recommRepo RecommendationRepository,
	alertService AlertService,
	leaderChecker LeaderChecker,
	logger *zap.Logger,
) *Engine {
	return &Engine{
		config:        cfg,
		nodeRepo:      nodeRepo,
		vmRepo:        vmRepo,
		recommRepo:    recommRepo,
		alertService:  alertService,
		leaderChecker: leaderChecker,
		logger:        logger.With(zap.String("component", "drs")),
	}
}

// Start begins the DRS analysis loop.
func (e *Engine) Start(ctx context.Context) {
	if !e.config.Enabled {
		e.logger.Info("DRS engine disabled")
		return
	}

	e.mu.Lock()
	if e.isRunning {
		e.mu.Unlock()
		return
	}
	e.isRunning = true
	e.mu.Unlock()

	e.logger.Info("Starting DRS engine",
		zap.Duration("interval", e.config.Interval),
		zap.String("automation_level", e.config.AutomationLevel),
		zap.Int("cpu_threshold", e.config.ThresholdCPU),
		zap.Int("memory_threshold", e.config.ThresholdMemory),
	)

	ticker := time.NewTicker(e.config.Interval)
	defer ticker.Stop()

	// Run initial analysis
	e.runAnalysis(ctx)

	for {
		select {
		case <-ctx.Done():
			e.logger.Info("DRS engine stopped")
			e.mu.Lock()
			e.isRunning = false
			e.mu.Unlock()
			return
		case <-ticker.C:
			e.runAnalysis(ctx)
		}
	}
}

// runAnalysis performs a single DRS analysis cycle.
func (e *Engine) runAnalysis(ctx context.Context) {
	// Only run on leader
	if e.leaderChecker != nil && !e.leaderChecker.IsLeader() {
		e.logger.Debug("Not leader, skipping DRS analysis")
		return
	}

	e.logger.Debug("Running DRS analysis")
	start := time.Now()

	// Get all schedulable nodes
	nodes, err := e.nodeRepo.ListSchedulable(ctx)
	if err != nil {
		e.logger.Error("Failed to list nodes", zap.Error(err))
		return
	}

	if len(nodes) < 2 {
		e.logger.Debug("Not enough nodes for DRS", zap.Int("node_count", len(nodes)))
		return
	}

	// Calculate metrics for each node
	var allMetrics []NodeMetrics
	for _, node := range nodes {
		metrics := e.calculateNodeMetrics(ctx, node)
		allMetrics = append(allMetrics, metrics)
	}

	// Find imbalanced nodes
	recommendations := e.analyzeBalance(ctx, allMetrics)

	// Store recommendations
	for _, rec := range recommendations {
		if _, err := e.recommRepo.Create(ctx, rec); err != nil {
			e.logger.Error("Failed to create recommendation", zap.Error(err))
			continue
		}

		e.logger.Info("DRS recommendation created",
			zap.String("id", rec.ID),
			zap.String("priority", string(rec.Priority)),
			zap.String("vm_id", rec.VMID),
			zap.String("source_node", rec.SourceNodeName),
			zap.String("target_node", rec.TargetNodeName),
			zap.String("reason", rec.Reason),
		)

		// Auto-apply if automation level is "full"
		if e.config.AutomationLevel == "full" && rec.Priority == domain.DRSPriorityCritical {
			// TODO: Implement auto-migration
			e.logger.Info("Auto-applying DRS recommendation", zap.String("id", rec.ID))
		}
	}

	// Cleanup old recommendations
	if err := e.recommRepo.DeleteOld(ctx, time.Now().Add(-24*time.Hour)); err != nil {
		e.logger.Warn("Failed to cleanup old recommendations", zap.Error(err))
	}

	e.mu.Lock()
	e.lastAnalysis = time.Now()
	e.mu.Unlock()

	e.logger.Debug("DRS analysis complete",
		zap.Duration("duration", time.Since(start)),
		zap.Int("recommendations", len(recommendations)),
	)
}

// calculateNodeMetrics computes resource usage for a node.
func (e *Engine) calculateNodeMetrics(ctx context.Context, node *domain.Node) NodeMetrics {
	vms, err := e.vmRepo.ListByNodeID(ctx, node.ID)
	if err != nil {
		e.logger.Warn("Failed to list VMs for node", zap.String("node_id", node.ID), zap.Error(err))
		return NodeMetrics{NodeID: node.ID, Hostname: node.Hostname}
	}

	var usedCPU float64
	var usedMemory float64
	runningVMs := 0

	for _, vm := range vms {
		if vm.Status.State == domain.VMStateRunning || vm.Status.State == domain.VMStateStarting {
			usedCPU += float64(vm.Spec.CPU.Cores)
			usedMemory += float64(vm.Spec.Memory.SizeMiB)
			runningVMs++
		}
	}

	totalCPU := node.Spec.CPU.TotalCores()
	totalMemory := node.Spec.Memory.TotalMiB

	cpuPercent := 0.0
	if totalCPU > 0 {
		cpuPercent = (usedCPU / float64(totalCPU)) * 100
	}

	memPercent := 0.0
	if totalMemory > 0 {
		memPercent = (usedMemory / float64(totalMemory)) * 100
	}

	return NodeMetrics{
		NodeID:        node.ID,
		Hostname:      node.Hostname,
		TotalCPU:      totalCPU,
		UsedCPU:       usedCPU,
		CPUPercent:    cpuPercent,
		TotalMemory:   totalMemory,
		UsedMemory:    usedMemory,
		MemoryPercent: memPercent,
		VMCount:       runningVMs,
	}
}

// analyzeBalance identifies imbalanced nodes and generates recommendations.
func (e *Engine) analyzeBalance(ctx context.Context, metrics []NodeMetrics) []*domain.DRSRecommendation {
	var recommendations []*domain.DRSRecommendation

	// Sort by CPU usage (highest first)
	sort.Slice(metrics, func(i, j int) bool {
		return metrics[i].CPUPercent > metrics[j].CPUPercent
	})

	// Find overloaded and underloaded nodes
	var overloaded, underloaded []NodeMetrics
	for _, m := range metrics {
		if m.CPUPercent > float64(e.config.ThresholdCPU) || m.MemoryPercent > float64(e.config.ThresholdMemory) {
			overloaded = append(overloaded, m)
		} else if m.CPUPercent < float64(e.config.ThresholdCPU-20) && m.MemoryPercent < float64(e.config.ThresholdMemory-20) {
			underloaded = append(underloaded, m)
		}
	}

	// Generate migration recommendations
	for _, source := range overloaded {
		if len(underloaded) == 0 {
			break
		}

		// Find VMs on overloaded node
		vms, err := e.vmRepo.ListByNodeID(ctx, source.NodeID)
		if err != nil || len(vms) == 0 {
			continue
		}

		// Find best target
		target := underloaded[0] // Least loaded

		// Find a VM to migrate (prefer smaller VMs)
		var vmToMigrate *domain.VirtualMachine
		for _, vm := range vms {
			if vm.Status.State == domain.VMStateRunning {
				if vmToMigrate == nil || vm.Spec.CPU.Cores < vmToMigrate.Spec.CPU.Cores {
					vmToMigrate = vm
				}
			}
		}

		if vmToMigrate == nil {
			continue
		}

		// Calculate priority
		priority := e.calculatePriority(source.CPUPercent, source.MemoryPercent)

		// Calculate impact
		cpuImpact := int32((source.CPUPercent - target.CPUPercent) / 2)
		memImpact := int32((source.MemoryPercent - target.MemoryPercent) / 2)

		rec := &domain.DRSRecommendation{
			ID:                 uuid.NewString(),
			Priority:           priority,
			RecommendationType: domain.DRSTypeMigrate,
			Reason:             e.generateReason(source),
			VMID:               vmToMigrate.ID,
			VMName:             vmToMigrate.Name,
			SourceNodeID:       source.NodeID,
			SourceNodeName:     source.Hostname,
			TargetNodeID:       target.NodeID,
			TargetNodeName:     target.Hostname,
			ImpactCPU:          cpuImpact,
			ImpactMemory:       memImpact,
			EstimatedDuration:  "2m",
			Status:             domain.DRSStatusPending,
			CreatedAt:          time.Now(),
		}

		recommendations = append(recommendations, rec)
	}

	return recommendations
}

// calculatePriority determines recommendation priority based on usage.
func (e *Engine) calculatePriority(cpuPercent, memPercent float64) domain.DRSPriority {
	maxPercent := cpuPercent
	if memPercent > maxPercent {
		maxPercent = memPercent
	}

	switch {
	case maxPercent >= 95:
		return domain.DRSPriorityCritical
	case maxPercent >= 90:
		return domain.DRSPriorityHigh
	case maxPercent >= 85:
		return domain.DRSPriorityMedium
	default:
		return domain.DRSPriorityLow
	}
}

// generateReason creates a human-readable reason for the recommendation.
func (e *Engine) generateReason(source NodeMetrics) string {
	if source.CPUPercent > float64(e.config.ThresholdCPU) && source.MemoryPercent > float64(e.config.ThresholdMemory) {
		return fmt.Sprintf("Node %s is overloaded (CPU: %.1f%%, Memory: %.1f%%)", source.Hostname, source.CPUPercent, source.MemoryPercent)
	} else if source.CPUPercent > float64(e.config.ThresholdCPU) {
		return fmt.Sprintf("Node %s has high CPU usage (%.1f%%)", source.Hostname, source.CPUPercent)
	} else {
		return fmt.Sprintf("Node %s has high memory usage (%.1f%%)", source.Hostname, source.MemoryPercent)
	}
}

// GetPendingRecommendations returns all pending recommendations.
func (e *Engine) GetPendingRecommendations(ctx context.Context, limit int) ([]*domain.DRSRecommendation, error) {
	return e.recommRepo.List(ctx, domain.DRSStatusPending, limit)
}

// ApproveRecommendation marks a recommendation as approved.
func (e *Engine) ApproveRecommendation(ctx context.Context, id, approvedBy string) (*domain.DRSRecommendation, error) {
	rec, err := e.recommRepo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	rec.Status = domain.DRSStatusApproved
	return e.recommRepo.Update(ctx, rec)
}

// ApplyRecommendation executes a recommendation (triggers migration).
func (e *Engine) ApplyRecommendation(ctx context.Context, id, appliedBy string) (*domain.DRSRecommendation, error) {
	rec, err := e.recommRepo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	// TODO: Trigger actual VM migration via scheduler

	now := time.Now()
	rec.Status = domain.DRSStatusApplied
	rec.AppliedAt = &now
	rec.AppliedBy = appliedBy

	return e.recommRepo.Update(ctx, rec)
}

// RejectRecommendation marks a recommendation as rejected.
func (e *Engine) RejectRecommendation(ctx context.Context, id string) (*domain.DRSRecommendation, error) {
	rec, err := e.recommRepo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	rec.Status = domain.DRSStatusRejected
	return e.recommRepo.Update(ctx, rec)
}

// GetLastAnalysisTime returns when the last analysis was performed.
func (e *Engine) GetLastAnalysisTime() time.Time {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.lastAnalysis
}

// IsRunning returns true if the DRS engine is running.
func (e *Engine) IsRunning() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isRunning
}
