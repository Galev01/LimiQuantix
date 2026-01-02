// Package scheduler implements VM placement logic.
package scheduler

import (
	"context"
	"fmt"
	"sort"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
)

// Scheduler determines which host should run a new VM.
type Scheduler struct {
	nodeRepo NodeRepository
	vmRepo   VMRepository
	config   Config
	logger   *zap.Logger
}

// New creates a new Scheduler instance.
func New(nodeRepo NodeRepository, vmRepo VMRepository, config Config, logger *zap.Logger) *Scheduler {
	return &Scheduler{
		nodeRepo: nodeRepo,
		vmRepo:   vmRepo,
		config:   config,
		logger:   logger.With(zap.String("component", "scheduler")),
	}
}

// ScheduleResult contains the scheduling decision.
type ScheduleResult struct {
	NodeID   string
	Hostname string
	Score    float64
	Reason   string
}

// Schedule finds the best node for a VM with the given specification.
func (s *Scheduler) Schedule(ctx context.Context, spec *computev1.VmSpec) (*ScheduleResult, error) {
	logger := s.logger.With(
		zap.Uint32("requested_cpu_cores", spec.Cpu.GetCores()),
		zap.Uint64("requested_memory_mib", spec.Memory.GetSizeMib()),
	)
	logger.Info("Starting scheduling for VM")

	// 1. Get all schedulable nodes
	nodes, err := s.nodeRepo.ListSchedulable(ctx)
	if err != nil {
		logger.Error("Failed to list schedulable nodes", zap.Error(err))
		return nil, fmt.Errorf("failed to list schedulable nodes: %w", err)
	}

	if len(nodes) == 0 {
		logger.Warn("No schedulable nodes available")
		return nil, fmt.Errorf("no schedulable nodes available")
	}

	logger.Debug("Found schedulable nodes", zap.Int("count", len(nodes)))

	// 2. Filter nodes by predicates (hard constraints)
	var feasible []*domain.Node
	for _, node := range nodes {
		if s.checkPredicates(ctx, node, spec) {
			feasible = append(feasible, node)
		}
	}

	if len(feasible) == 0 {
		logger.Warn("No nodes satisfy scheduling requirements",
			zap.Int("total_nodes", len(nodes)),
		)
		return nil, fmt.Errorf("no nodes satisfy scheduling requirements (checked %d nodes)", len(nodes))
	}

	logger.Debug("Feasible nodes after predicate filtering", zap.Int("count", len(feasible)))

	// 3. Score and rank nodes
	type scoredNode struct {
		node  *domain.Node
		score float64
	}

	scored := make([]scoredNode, len(feasible))
	for i, node := range feasible {
		score := s.scoreNode(ctx, node, spec)
		scored[i] = scoredNode{node: node, score: score}
	}

	// Sort by score (highest first)
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})

	best := scored[0]

	logger.Info("Scheduled VM successfully",
		zap.String("node_id", best.node.ID),
		zap.String("hostname", best.node.Hostname),
		zap.Float64("score", best.score),
		zap.Int("feasible_nodes", len(feasible)),
	)

	return &ScheduleResult{
		NodeID:   best.node.ID,
		Hostname: best.node.Hostname,
		Score:    best.score,
		Reason:   fmt.Sprintf("Best score using %s strategy", s.config.PlacementStrategy),
	}, nil
}

// checkPredicates applies hard constraints to filter out unsuitable nodes.
func (s *Scheduler) checkPredicates(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) bool {
	// Check if node is in a schedulable state
	if node.Status.Phase != domain.NodePhaseReady {
		s.logger.Debug("Node not ready", zap.String("node_id", node.ID), zap.String("phase", string(node.Status.Phase)))
		return false
	}

	// Check CPU capacity with overcommit
	allocatableCPU := s.getAllocatableCPU(node)
	usedCPU := s.getNodeCPUUsage(ctx, node.ID)
	requestedCPU := float64(spec.Cpu.GetCores())

	if requestedCPU > (allocatableCPU - usedCPU) {
		s.logger.Debug("Insufficient CPU",
			zap.String("node_id", node.ID),
			zap.Float64("allocatable", allocatableCPU),
			zap.Float64("used", usedCPU),
			zap.Float64("requested", requestedCPU),
		)
		return false
	}

	// Check memory capacity with overcommit
	allocatableMem := s.getAllocatableMemory(node)
	usedMem := s.getNodeMemoryUsage(ctx, node.ID)
	requestedMem := float64(spec.Memory.GetSizeMib())

	if requestedMem > (allocatableMem - usedMem) {
		s.logger.Debug("Insufficient memory",
			zap.String("node_id", node.ID),
			zap.Float64("allocatable_mib", allocatableMem),
			zap.Float64("used_mib", usedMem),
			zap.Float64("requested_mib", requestedMem),
		)
		return false
	}

	// Check affinity rules (if placement policy is specified)
	if !s.checkAffinity(ctx, node, spec) {
		return false
	}

	return true
}

// scoreNode calculates a score for the node based on the placement strategy.
func (s *Scheduler) scoreNode(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) float64 {
	var score float64

	switch s.config.PlacementStrategy {
	case "spread":
		// Prefer nodes with fewer VMs (spread load for HA)
		vmCount := s.getNodeVMCount(ctx, node.ID)
		// Higher score for fewer VMs (max 100)
		score = 100.0 - float64(vmCount)*5.0
		if score < 0 {
			score = 0
		}

	case "pack":
		// Prefer nodes with more VMs (consolidate for efficiency)
		vmCount := s.getNodeVMCount(ctx, node.ID)
		// Higher score for more VMs, but with diminishing returns
		score = float64(vmCount) * 10.0
		if score > 100 {
			score = 100
		}

	default:
		// Balance: consider remaining capacity
		cpuRemaining := s.getAllocatableCPU(node) - s.getNodeCPUUsage(ctx, node.ID)
		memRemaining := s.getAllocatableMemory(node) - s.getNodeMemoryUsage(ctx, node.ID)

		// Normalize to 0-100 scale
		allocatableCPU := s.getAllocatableCPU(node)
		allocatableMem := s.getAllocatableMemory(node)

		cpuScore := 0.0
		if allocatableCPU > 0 {
			cpuScore = (cpuRemaining / allocatableCPU) * 50
		}
		memScore := 0.0
		if allocatableMem > 0 {
			memScore = (memRemaining / allocatableMem) * 50
		}
		score = cpuScore + memScore
	}

	// Apply bonus for preferred nodes (from affinity)
	if s.isPreferredNode(node, spec) {
		score += 20.0
	}

	return score
}

// getAllocatableCPU returns the allocatable CPU cores for a node.
func (s *Scheduler) getAllocatableCPU(node *domain.Node) float64 {
	totalCPU := float64(node.Spec.CPU.TotalCores()) - float64(s.config.ReservedCPUCores)
	if totalCPU < 0 {
		totalCPU = 0
	}
	return totalCPU * s.config.OvercommitCPU
}

// getAllocatableMemory returns the allocatable memory in MiB for a node.
func (s *Scheduler) getAllocatableMemory(node *domain.Node) float64 {
	totalMem := float64(node.Spec.Memory.TotalMiB) - float64(s.config.ReservedMemoryMiB)
	if totalMem < 0 {
		totalMem = 0
	}
	return totalMem * s.config.OvercommitMemory
}

// getNodeCPUUsage returns the CPU cores currently used by VMs on the node.
func (s *Scheduler) getNodeCPUUsage(ctx context.Context, nodeID string) float64 {
	vms, err := s.vmRepo.ListByNodeID(ctx, nodeID)
	if err != nil {
		s.logger.Warn("Failed to get VMs for node", zap.String("node_id", nodeID), zap.Error(err))
		return 0
	}

	var total float64
	for _, vm := range vms {
		// Only count running or starting VMs
		if vm.Status.State == domain.VMStateRunning ||
			vm.Status.State == domain.VMStateStarting {
			total += float64(vm.Spec.CPU.Cores)
		}
	}
	return total
}

// getNodeMemoryUsage returns the memory in MiB currently used by VMs on the node.
func (s *Scheduler) getNodeMemoryUsage(ctx context.Context, nodeID string) float64 {
	vms, err := s.vmRepo.ListByNodeID(ctx, nodeID)
	if err != nil {
		s.logger.Warn("Failed to get VMs for node", zap.String("node_id", nodeID), zap.Error(err))
		return 0
	}

	var total float64
	for _, vm := range vms {
		if vm.Status.State == domain.VMStateRunning ||
			vm.Status.State == domain.VMStateStarting {
			total += float64(vm.Spec.Memory.SizeMiB)
		}
	}
	return total
}

// getNodeVMCount returns the number of VMs on a node.
func (s *Scheduler) getNodeVMCount(ctx context.Context, nodeID string) int {
	count, err := s.vmRepo.CountByNodeID(ctx, nodeID)
	if err != nil {
		s.logger.Warn("Failed to count VMs for node", zap.String("node_id", nodeID), zap.Error(err))
		return 0
	}
	return count
}

// checkAffinity verifies node affinity rules based on placement policy.
func (s *Scheduler) checkAffinity(ctx context.Context, node *domain.Node, spec *computev1.VmSpec) bool {
	if spec.Placement == nil {
		return true // No placement policy
	}

	// Check required nodes (hard affinity)
	if len(spec.Placement.RequiredNodes) > 0 {
		found := false
		for _, nodeID := range spec.Placement.RequiredNodes {
			if node.ID == nodeID || node.Hostname == nodeID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Check excluded nodes
	for _, excludedNodeID := range spec.Placement.ExcludedNodes {
		if node.ID == excludedNodeID || node.Hostname == excludedNodeID {
			return false
		}
	}

	// Check required labels
	if spec.Placement.RequiredLabels != nil {
		for key, value := range spec.Placement.RequiredLabels {
			if node.Labels[key] != value {
				s.logger.Debug("Node doesn't match required label",
					zap.String("node_id", node.ID),
					zap.String("label_key", key),
					zap.String("expected", value),
					zap.String("actual", node.Labels[key]),
				)
				return false
			}
		}
	}

	// Check anti-affinity VMs (VM shouldn't be on same node as these VMs)
	if len(spec.Placement.AntiAffinityVms) > 0 {
		vms, err := s.vmRepo.ListByNodeID(ctx, node.ID)
		if err != nil {
			s.logger.Warn("Failed to check anti-affinity", zap.Error(err))
			return true // Can't check, assume no violation
		}

		for _, vm := range vms {
			for _, antiAffinityVMID := range spec.Placement.AntiAffinityVms {
				if vm.ID == antiAffinityVMID {
					s.logger.Debug("Anti-affinity violation",
						zap.String("node_id", node.ID),
						zap.String("conflicting_vm", vm.ID),
					)
					return false
				}
			}
		}
	}

	return true
}

// isPreferredNode checks if the node is a preferred node based on soft affinity.
func (s *Scheduler) isPreferredNode(node *domain.Node, spec *computev1.VmSpec) bool {
	if spec.Placement == nil || len(spec.Placement.PreferredNodes) == 0 {
		return false
	}

	// Check if this node is in the preferred list
	for _, preferredNodeID := range spec.Placement.PreferredNodes {
		if node.ID == preferredNodeID || node.Hostname == preferredNodeID {
			return true
		}
	}

	return false
}
