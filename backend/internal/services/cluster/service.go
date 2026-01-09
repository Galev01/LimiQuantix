// Package cluster provides cluster management services.
package cluster

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/node"
	"github.com/limiquantix/limiquantix/internal/services/vm"
)

// Service provides cluster management operations.
type Service struct {
	clusterRepo domain.ClusterRepository
	nodeRepo    node.Repository
	vmRepo      vm.Repository
	logger      *zap.Logger
}

// NewService creates a new cluster service.
func NewService(
	clusterRepo domain.ClusterRepository,
	nodeRepo node.Repository,
	vmRepo vm.Repository,
	logger *zap.Logger,
) *Service {
	return &Service{
		clusterRepo: clusterRepo,
		nodeRepo:    nodeRepo,
		vmRepo:      vmRepo,
		logger:      logger.Named("cluster-service"),
	}
}

// CreateClusterRequest contains the parameters for creating a cluster.
type CreateClusterRequest struct {
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	ProjectID   string            `json:"project_id,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`

	// HA settings
	HAEnabled          bool `json:"ha_enabled"`
	HAAdmissionControl bool `json:"ha_admission_control"`
	HAFailoverCapacity int  `json:"ha_failover_capacity"`

	// DRS settings
	DRSEnabled            bool            `json:"drs_enabled"`
	DRSMode               domain.DRSMode  `json:"drs_mode,omitempty"`
	DRSMigrationThreshold int             `json:"drs_migration_threshold,omitempty"`

	// Storage/Network defaults
	SharedStorageRequired bool   `json:"shared_storage_required"`
	DefaultStoragePoolID  string `json:"default_storage_pool_id,omitempty"`
	DefaultNetworkID      string `json:"default_network_id,omitempty"`

	// Initial hosts to add to the cluster
	InitialHostIDs []string `json:"initial_host_ids,omitempty"`
}

// Create creates a new cluster.
func (s *Service) Create(ctx context.Context, req *CreateClusterRequest) (*domain.ClusterWithStats, error) {
	s.logger.Info("Creating cluster",
		zap.String("name", req.Name),
		zap.Bool("ha_enabled", req.HAEnabled),
		zap.Bool("drs_enabled", req.DRSEnabled),
	)

	// Validate name
	if req.Name == "" {
		return nil, fmt.Errorf("cluster name is required")
	}

	// Set defaults
	drsMode := req.DRSMode
	if drsMode == "" {
		drsMode = domain.DRSModeManual
	}

	migrationThreshold := req.DRSMigrationThreshold
	if migrationThreshold == 0 {
		migrationThreshold = 3 // Default to balanced
	}

	failoverCapacity := req.HAFailoverCapacity
	if failoverCapacity == 0 {
		failoverCapacity = 1 // Tolerate 1 host failure by default
	}

	cluster := &domain.Cluster{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Description: req.Description,
		ProjectID:   req.ProjectID,
		Labels:      req.Labels,

		HAEnabled:           req.HAEnabled,
		HAAdmissionControl:  req.HAAdmissionControl,
		HAHostMonitoring:    req.HAEnabled, // Enable by default if HA is on
		HAVMMonitoring:      false,         // Requires guest agent
		HAFailoverCapacity:  failoverCapacity,
		HARestartPriority:   3, // Medium priority
		HAIsolationResponse: 1, // Shutdown

		DRSEnabled:              req.DRSEnabled,
		DRSMode:                 drsMode,
		DRSMigrationThreshold:   migrationThreshold,
		DRSPowerManagement:      false,
		DRSPredictiveEnabled:    false,
		DRSVMDistributionPolicy: "balanced",

		SharedStorageRequired: req.SharedStorageRequired,
		DefaultStoragePoolID:  req.DefaultStoragePoolID,
		DefaultNetworkID:      req.DefaultNetworkID,

		Status:    domain.ClusterStatusHealthy,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := s.clusterRepo.Create(cluster); err != nil {
		s.logger.Error("Failed to create cluster",
			zap.String("name", req.Name),
			zap.Error(err),
		)
		return nil, fmt.Errorf("failed to create cluster: %w", err)
	}

	s.logger.Info("Cluster created successfully",
		zap.String("id", cluster.ID),
		zap.String("name", cluster.Name),
	)

	// Add initial hosts to the cluster
	if len(req.InitialHostIDs) > 0 {
		s.logger.Info("Adding initial hosts to cluster",
			zap.String("cluster_id", cluster.ID),
			zap.Int("host_count", len(req.InitialHostIDs)),
		)
		for _, hostID := range req.InitialHostIDs {
			if err := s.AddHost(ctx, cluster.ID, hostID); err != nil {
				s.logger.Warn("Failed to add initial host to cluster",
					zap.String("cluster_id", cluster.ID),
					zap.String("host_id", hostID),
					zap.Error(err),
				)
				// Continue with other hosts even if one fails
			}
		}
	}

	// Return with computed stats (now includes any added hosts)
	return s.Get(ctx, cluster.ID)
}

// Get retrieves a cluster by ID with computed statistics.
func (s *Service) Get(ctx context.Context, id string) (*domain.ClusterWithStats, error) {
	cluster, err := s.clusterRepo.Get(id)
	if err != nil {
		return nil, err
	}

	stats, err := s.computeStats(ctx, id)
	if err != nil {
		s.logger.Warn("Failed to compute cluster stats",
			zap.String("cluster_id", id),
			zap.Error(err),
		)
		// Return cluster with empty stats
		return &domain.ClusterWithStats{
			Cluster: *cluster,
			Stats:   domain.ClusterStats{},
		}, nil
	}

	// Update cluster status based on stats
	cluster.Status = s.computeStatus(stats)

	return &domain.ClusterWithStats{
		Cluster: *cluster,
		Stats:   *stats,
	}, nil
}

// List returns all clusters with statistics.
func (s *Service) List(ctx context.Context, projectID string) ([]*domain.ClusterWithStats, error) {
	clusters, err := s.clusterRepo.List(projectID)
	if err != nil {
		return nil, err
	}

	result := make([]*domain.ClusterWithStats, 0, len(clusters))
	for _, cluster := range clusters {
		stats, err := s.computeStats(ctx, cluster.ID)
		if err != nil {
			s.logger.Warn("Failed to compute cluster stats",
				zap.String("cluster_id", cluster.ID),
				zap.Error(err),
			)
			stats = &domain.ClusterStats{}
		}

		cluster.Status = s.computeStatus(stats)

		result = append(result, &domain.ClusterWithStats{
			Cluster: *cluster,
			Stats:   *stats,
		})
	}

	return result, nil
}

// UpdateClusterRequest contains the parameters for updating a cluster.
type UpdateClusterRequest struct {
	ID          string            `json:"id"`
	Name        string            `json:"name,omitempty"`
	Description string            `json:"description,omitempty"`
	Labels      map[string]string `json:"labels,omitempty"`

	// HA settings
	HAEnabled          *bool `json:"ha_enabled,omitempty"`
	HAAdmissionControl *bool `json:"ha_admission_control,omitempty"`
	HAFailoverCapacity *int  `json:"ha_failover_capacity,omitempty"`

	// DRS settings
	DRSEnabled            *bool           `json:"drs_enabled,omitempty"`
	DRSMode               *domain.DRSMode `json:"drs_mode,omitempty"`
	DRSMigrationThreshold *int            `json:"drs_migration_threshold,omitempty"`

	// Storage/Network defaults
	DefaultStoragePoolID *string `json:"default_storage_pool_id,omitempty"`
	DefaultNetworkID     *string `json:"default_network_id,omitempty"`
}

// Update updates an existing cluster.
func (s *Service) Update(ctx context.Context, req *UpdateClusterRequest) (*domain.ClusterWithStats, error) {
	s.logger.Info("Updating cluster", zap.String("id", req.ID))

	cluster, err := s.clusterRepo.Get(req.ID)
	if err != nil {
		return nil, err
	}

	// Apply updates
	if req.Name != "" {
		cluster.Name = req.Name
	}
	if req.Description != "" {
		cluster.Description = req.Description
	}
	if req.Labels != nil {
		cluster.Labels = req.Labels
	}

	// HA settings
	if req.HAEnabled != nil {
		cluster.HAEnabled = *req.HAEnabled
	}
	if req.HAAdmissionControl != nil {
		cluster.HAAdmissionControl = *req.HAAdmissionControl
	}
	if req.HAFailoverCapacity != nil {
		cluster.HAFailoverCapacity = *req.HAFailoverCapacity
	}

	// DRS settings
	if req.DRSEnabled != nil {
		cluster.DRSEnabled = *req.DRSEnabled
	}
	if req.DRSMode != nil {
		cluster.DRSMode = *req.DRSMode
	}
	if req.DRSMigrationThreshold != nil {
		cluster.DRSMigrationThreshold = *req.DRSMigrationThreshold
	}

	// Defaults
	if req.DefaultStoragePoolID != nil {
		cluster.DefaultStoragePoolID = *req.DefaultStoragePoolID
	}
	if req.DefaultNetworkID != nil {
		cluster.DefaultNetworkID = *req.DefaultNetworkID
	}

	cluster.UpdatedAt = time.Now()

	if err := s.clusterRepo.Update(cluster); err != nil {
		return nil, fmt.Errorf("failed to update cluster: %w", err)
	}

	s.logger.Info("Cluster updated successfully",
		zap.String("id", cluster.ID),
		zap.String("name", cluster.Name),
	)

	return s.Get(ctx, cluster.ID)
}

// Delete removes a cluster.
func (s *Service) Delete(ctx context.Context, id string) error {
	s.logger.Info("Deleting cluster", zap.String("id", id))

	// Check if cluster has hosts
	nodes, err := s.nodeRepo.ListByCluster(ctx, id)
	if err != nil {
		s.logger.Warn("Failed to check cluster hosts", zap.Error(err))
	} else if len(nodes) > 0 {
		return fmt.Errorf("cannot delete cluster with %d hosts, remove hosts first", len(nodes))
	}

	if err := s.clusterRepo.Delete(id); err != nil {
		return fmt.Errorf("failed to delete cluster: %w", err)
	}

	s.logger.Info("Cluster deleted successfully", zap.String("id", id))
	return nil
}

// AddHost adds a host to a cluster.
func (s *Service) AddHost(ctx context.Context, clusterID, hostID string) error {
	s.logger.Info("Adding host to cluster",
		zap.String("cluster_id", clusterID),
		zap.String("host_id", hostID),
	)

	// Verify cluster exists
	_, err := s.clusterRepo.Get(clusterID)
	if err != nil {
		return fmt.Errorf("cluster not found: %w", err)
	}

	// Get the host
	node, err := s.nodeRepo.Get(ctx, hostID)
	if err != nil {
		return fmt.Errorf("host not found: %w", err)
	}

	// Check if already in a cluster
	if node.ClusterID != "" && node.ClusterID != clusterID {
		return fmt.Errorf("host is already in cluster %s", node.ClusterID)
	}

	// Update host's cluster ID
	node.ClusterID = clusterID
	if _, err := s.nodeRepo.Update(ctx, node); err != nil {
		return fmt.Errorf("failed to update host: %w", err)
	}

	s.logger.Info("Host added to cluster",
		zap.String("cluster_id", clusterID),
		zap.String("host_id", hostID),
	)

	return nil
}

// RemoveHost removes a host from a cluster.
func (s *Service) RemoveHost(ctx context.Context, clusterID, hostID string) error {
	s.logger.Info("Removing host from cluster",
		zap.String("cluster_id", clusterID),
		zap.String("host_id", hostID),
	)

	// Get the host
	node, err := s.nodeRepo.Get(ctx, hostID)
	if err != nil {
		return fmt.Errorf("host not found: %w", err)
	}

	// Verify host is in this cluster
	if node.ClusterID != clusterID {
		return fmt.Errorf("host is not in cluster %s", clusterID)
	}

	// Clear cluster ID
	node.ClusterID = ""
	if _, err := s.nodeRepo.Update(ctx, node); err != nil {
		return fmt.Errorf("failed to update host: %w", err)
	}

	s.logger.Info("Host removed from cluster",
		zap.String("cluster_id", clusterID),
		zap.String("host_id", hostID),
	)

	return nil
}

// GetHosts returns all hosts in a cluster.
func (s *Service) GetHosts(ctx context.Context, clusterID string) ([]*domain.Node, error) {
	return s.nodeRepo.ListByCluster(ctx, clusterID)
}

// computeStats calculates aggregate statistics for a cluster.
func (s *Service) computeStats(ctx context.Context, clusterID string) (*domain.ClusterStats, error) {
	nodes, err := s.nodeRepo.ListByCluster(ctx, clusterID)
	if err != nil {
		return nil, err
	}

	stats := &domain.ClusterStats{}

	for _, node := range nodes {
		stats.TotalHosts++

		switch node.Status.Phase {
		case domain.NodePhaseReady:
			stats.OnlineHosts++
		case domain.NodePhaseMaintenance:
			stats.MaintenanceHosts++
		default:
			stats.OfflineHosts++
		}

		// Aggregate resources - use node.Spec.CPU which is a struct, not a pointer
		// Estimate GHz based on frequency and cores
		cpuCores := node.Spec.CPU.TotalCores()
		freqGHz := float64(node.Spec.CPU.FrequencyMHz) / 1000.0
		if freqGHz == 0 {
			freqGHz = 2.5 // Default assumption
		}
		stats.CPUTotalGHz += float64(cpuCores) * freqGHz
		stats.CPUUsedGHz += float64(node.Status.Allocated.CPUCores) * freqGHz

		// Memory is in MiB in the domain model
		stats.MemoryTotalBytes += node.Spec.Memory.TotalMiB * 1024 * 1024
		stats.MemoryUsedBytes += node.Status.Allocated.MemoryMiB * 1024 * 1024

		// Count VMs on this host
		if node.Status.VMIDs != nil {
			stats.TotalVMs += len(node.Status.VMIDs)
		}
	}

	// Get VM states for running count
	allVMs, _, err := s.vmRepo.List(ctx, vm.VMFilter{}, 10000, "")
	if err == nil {
		for _, vmItem := range allVMs {
			if vmItem.Status.NodeID != "" {
				// Check if this VM is on a host in this cluster
				for _, nodeItem := range nodes {
					if nodeItem.ID == vmItem.Status.NodeID {
						if vmItem.Status.State == domain.VMStateRunning {
							stats.RunningVMs++
						} else {
							stats.StoppedVMs++
						}
						break
					}
				}
			}
		}
	}

	return stats, nil
}

// computeStatus determines cluster health based on statistics.
func (s *Service) computeStatus(stats *domain.ClusterStats) domain.ClusterStatus {
	if stats.TotalHosts == 0 {
		return domain.ClusterStatusHealthy // Empty cluster is healthy
	}

	// If all hosts are in maintenance
	if stats.MaintenanceHosts == stats.TotalHosts {
		return domain.ClusterStatusMaintenance
	}

	// If any hosts are offline
	if stats.OfflineHosts > 0 {
		// Critical if more than half are offline
		if stats.OfflineHosts > stats.TotalHosts/2 {
			return domain.ClusterStatusCritical
		}
		return domain.ClusterStatusWarning
	}

	// Check resource usage
	if stats.CPUTotalGHz > 0 {
		cpuUsagePercent := (stats.CPUUsedGHz / stats.CPUTotalGHz) * 100
		if cpuUsagePercent > 90 {
			return domain.ClusterStatusWarning
		}
	}

	if stats.MemoryTotalBytes > 0 {
		memUsagePercent := (float64(stats.MemoryUsedBytes) / float64(stats.MemoryTotalBytes)) * 100
		if memUsagePercent > 90 {
			return domain.ClusterStatusWarning
		}
	}

	return domain.ClusterStatusHealthy
}
