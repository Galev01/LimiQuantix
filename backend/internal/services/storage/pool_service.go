// Package storage implements the StoragePoolService and VolumeService.
package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/services/node"
	nodev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/node/v1"
	storagev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1"
)

// PoolService implements the storagev1connect.StoragePoolServiceHandler interface.
type PoolService struct {
	repo       PoolRepository
	daemonPool *node.DaemonPool
	nodeRepo   node.Repository
	logger     *zap.Logger
}

// NewPoolService creates a new PoolService.
func NewPoolService(repo PoolRepository, daemonPool *node.DaemonPool, nodeRepo node.Repository, logger *zap.Logger) *PoolService {
	return &PoolService{
		repo:       repo,
		daemonPool: daemonPool,
		nodeRepo:   nodeRepo,
		logger:     logger,
	}
}

// CreatePool creates a new storage pool.
func (s *PoolService) CreatePool(
	ctx context.Context,
	req *connect.Request[storagev1.CreatePoolRequest],
) (*connect.Response[storagev1.StoragePool], error) {
	logger := s.logger.With(
		zap.String("method", "CreatePool"),
		zap.String("pool_name", req.Msg.Name),
	)
	logger.Info("Creating storage pool")

	// Debug: Log what we received from frontend
	if req.Msg.Spec != nil && req.Msg.Spec.Backend != nil {
		logger.Info("Received backend config from frontend",
			zap.String("backend_type", req.Msg.Spec.Backend.Type.String()),
			zap.Bool("has_nfs", req.Msg.Spec.Backend.GetNfs() != nil),
			zap.Bool("has_ceph", req.Msg.Spec.Backend.GetCeph() != nil),
			zap.Bool("has_local_dir", req.Msg.Spec.Backend.GetLocalDir() != nil),
			zap.Bool("has_iscsi", req.Msg.Spec.Backend.GetIscsi() != nil),
		)
		if nfs := req.Msg.Spec.Backend.GetNfs(); nfs != nil {
			logger.Info("NFS config received",
				zap.String("server", nfs.Server),
				zap.String("export_path", nfs.ExportPath),
				zap.String("version", nfs.Version),
			)
		}
	} else {
		logger.Warn("No backend config received from frontend",
			zap.Bool("has_spec", req.Msg.Spec != nil),
			zap.Bool("has_backend", req.Msg.Spec != nil && req.Msg.Spec.Backend != nil),
		)
	}

	// Validate request
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}

	// Convert to domain model
	pool := convertCreatePoolRequestToDomain(req.Msg)
	pool.Status.Phase = domain.StoragePoolPhasePending

	// Debug: Log the converted domain model
	if pool.Spec.Backend != nil {
		logger.Info("Domain model backend after conversion",
			zap.String("backend_type", string(pool.Spec.Backend.Type)),
			zap.Bool("has_nfs_config", pool.Spec.Backend.NFSConfig != nil),
			zap.Bool("has_ceph_config", pool.Spec.Backend.CephConfig != nil),
			zap.Bool("has_local_dir_config", pool.Spec.Backend.LocalDirConfig != nil),
		)
		if pool.Spec.Backend.NFSConfig != nil {
			logger.Info("Domain NFS config",
				zap.String("server", pool.Spec.Backend.NFSConfig.Server),
				zap.String("export_path", pool.Spec.Backend.NFSConfig.ExportPath),
			)
		}
	}

	// Create in repository
	createdPool, err := s.repo.Create(ctx, pool)
	if err != nil {
		logger.Error("Failed to create storage pool", zap.Error(err))
		if err == domain.ErrAlreadyExists {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Initialize pool on all applicable nodes
	if s.daemonPool != nil {
		poolInfo, initErr := s.initPoolOnNodes(ctx, createdPool, logger)
		if initErr != nil {
			logger.Error("Failed to initialize pool on nodes", zap.Error(initErr))
			createdPool.Status.Phase = domain.StoragePoolPhaseError
			createdPool.Status.ErrorMessage = initErr.Error()
		} else if poolInfo != nil {
			createdPool.Status.Phase = domain.StoragePoolPhaseReady
			createdPool.Status.Capacity = domain.StorageCapacity{
				TotalBytes:     poolInfo.TotalBytes,
				AvailableBytes: poolInfo.AvailableBytes,
				UsedBytes:      poolInfo.UsedBytes,
			}
			logger.Info("Pool initialized successfully",
				zap.Uint64("total_bytes", poolInfo.TotalBytes),
				zap.Uint64("available_bytes", poolInfo.AvailableBytes),
			)
		} else {
			// poolInfo is nil and no error - means no nodes were available to initialize
			connectedCount := len(s.daemonPool.ConnectedNodes())
			if connectedCount == 0 {
				createdPool.Status.Phase = domain.StoragePoolPhaseError
				createdPool.Status.ErrorMessage = "No connected nodes available to initialize pool. Ensure at least one Quantix-OS node is registered and connected."
				logger.Warn("No connected nodes to initialize pool",
					zap.String("pool_id", createdPool.ID),
				)
			} else {
				// Nodes were connected but all failed to initialize
				createdPool.Status.Phase = domain.StoragePoolPhaseError
				createdPool.Status.ErrorMessage = fmt.Sprintf("Pool initialization failed on all %d connected nodes. Check node logs for details.", connectedCount)
				logger.Error("Pool initialization failed on all nodes",
					zap.String("pool_id", createdPool.ID),
					zap.Int("connected_nodes", connectedCount),
				)
			}
		}
	} else {
		// Fallback for dev mode without node daemons
		logger.Warn("No daemon pool available - using mock storage capacity (dev mode)")
		createdPool.Status.Phase = domain.StoragePoolPhaseReady
		createdPool.Status.Capacity = domain.StorageCapacity{
			TotalBytes:     100 * 1024 * 1024 * 1024, // 100 GiB
			AvailableBytes: 100 * 1024 * 1024 * 1024,
		}
	}

	if err := s.repo.UpdateStatus(ctx, createdPool.ID, createdPool.Status); err != nil {
		logger.Warn("Failed to update pool status", zap.Error(err))
	}

	logger.Info("Storage pool created",
		zap.String("pool_id", createdPool.ID),
		zap.String("phase", string(createdPool.Status.Phase)),
		zap.String("error_message", createdPool.Status.ErrorMessage),
	)
	return connect.NewResponse(convertPoolToProto(createdPool)), nil
}

// initPoolOnNodes initializes the storage pool on applicable nodes.
// Returns (poolInfo, nil) on success, (nil, error) on failure, or (nil, nil) if no nodes available.
func (s *PoolService) initPoolOnNodes(ctx context.Context, pool *domain.StoragePool, logger *zap.Logger) (*nodev1.StoragePoolInfoResponse, error) {
	// Get all connected nodes
	connectedNodes := s.daemonPool.ConnectedNodes()
	
	// If no connected nodes, try to connect to nodes from database
	if len(connectedNodes) == 0 {
		logger.Info("No connected nodes, attempting to connect to registered nodes from database")
		
		// List all ready nodes from repository
		allNodes, err := s.nodeRepo.List(ctx, node.NodeFilter{
			Phases: []domain.NodePhase{domain.NodePhaseReady},
		})
		if err != nil {
			logger.Warn("Failed to list nodes from repository", zap.Error(err))
		} else {
			for _, n := range allNodes {
			// Try to connect - ManagementIP should include port
			daemonAddr := n.ManagementIP
			// Strip CIDR notation if present (e.g., "192.168.0.53/32" -> "192.168.0.53")
			if idx := strings.Index(daemonAddr, "/"); idx != -1 {
				daemonAddr = daemonAddr[:idx]
			}
			if !strings.Contains(daemonAddr, ":") {
				daemonAddr = daemonAddr + ":9090"
			}
			
			logger.Info("Attempting to connect to node daemon",
				zap.String("node_id", n.ID),
				zap.String("daemon_addr", daemonAddr),
			)
			
			_, connectErr := s.daemonPool.Connect(n.ID, daemonAddr)
			if connectErr != nil {
				logger.Warn("Failed to connect to node daemon",
					zap.String("node_id", n.ID),
					zap.String("daemon_addr", daemonAddr),
					zap.Error(connectErr),
				)
			} else {
				logger.Info("Successfully connected to node daemon",
					zap.String("node_id", n.ID),
					zap.String("daemon_addr", daemonAddr),
				)
			}
		}
			// Refresh connected nodes list
			connectedNodes = s.daemonPool.ConnectedNodes()
		}
	}
	
	if len(connectedNodes) == 0 {
		logger.Warn("No connected nodes to initialize pool on")
		return nil, nil
	}

	logger.Info("Initializing pool on connected nodes",
		zap.String("pool_id", pool.ID),
		zap.Int("connected_nodes", len(connectedNodes)),
		zap.Strings("node_ids", connectedNodes),
	)

	// Convert pool config to node daemon request
	req := s.convertPoolToNodeRequest(pool)

	// Log the request details for debugging
	logger.Debug("Pool init request details",
		zap.String("pool_id", req.PoolId),
		zap.Int32("pool_type", int32(req.Type)),
		zap.Bool("has_config", req.Config != nil),
	)
	if req.Config != nil && req.Config.Nfs != nil {
		logger.Debug("NFS config",
			zap.String("server", req.Config.Nfs.Server),
			zap.String("export_path", req.Config.Nfs.ExportPath),
			zap.String("version", req.Config.Nfs.Version),
		)
	}

	// Initialize on first connected node (for shared storage like NFS/Ceph,
	// all nodes can access the same pool)
	var lastInfo *nodev1.StoragePoolInfoResponse
	var lastError error
	var errors []string

	for _, nodeID := range connectedNodes {
		client, err := s.daemonPool.GetOrError(nodeID)
		if err != nil {
			errMsg := fmt.Sprintf("node %s: client error: %v", nodeID, err)
			errors = append(errors, errMsg)
			logger.Warn("Could not get client for node", zap.String("node_id", nodeID), zap.Error(err))
			continue
		}

		info, err := client.InitStoragePool(ctx, req)
		if err != nil {
			errMsg := fmt.Sprintf("node %s: %v", nodeID, err)
			errors = append(errors, errMsg)
			lastError = err
			logger.Error("Failed to initialize pool on node",
				zap.String("node_id", nodeID),
				zap.String("pool_id", pool.ID),
				zap.Error(err),
			)
			continue
		}

		lastInfo = info
		logger.Info("Pool initialized successfully on node",
			zap.String("node_id", nodeID),
			zap.String("pool_id", pool.ID),
			zap.Uint64("total_bytes", info.TotalBytes),
			zap.Uint64("available_bytes", info.AvailableBytes),
		)
		// Success on one node is enough for shared storage
		break
	}

	// If we got info from at least one node, consider it success
	if lastInfo != nil {
		return lastInfo, nil
	}

	// All nodes failed - return the collected errors
	if len(errors) > 0 {
		combinedError := fmt.Errorf("pool initialization failed: %s", errors[len(errors)-1])
		return nil, combinedError
	}

	// No errors but also no success (shouldn't happen)
	return nil, lastError
}

// convertPoolToNodeRequest converts a domain pool to a node daemon init request.
func (s *PoolService) convertPoolToNodeRequest(pool *domain.StoragePool) *nodev1.InitStoragePoolRequest {
	req := &nodev1.InitStoragePoolRequest{
		PoolId: pool.ID,
		Config: &nodev1.StoragePoolConfig{},
	}

	// Check backend - if nil or type empty, return with default config
	if pool.Spec.Backend == nil || pool.Spec.Backend.Type == "" {
		return req
	}

	switch pool.Spec.Backend.Type {
	case domain.BackendTypeCephRBD:
		req.Type = nodev1.StoragePoolType_STORAGE_POOL_TYPE_CEPH_RBD
		if pool.Spec.Backend.CephConfig != nil {
			req.Config.Ceph = &nodev1.CephPoolConfig{
				ClusterId:   pool.Spec.Backend.CephConfig.ClusterID,
				PoolName:    pool.Spec.Backend.CephConfig.PoolName,
				Monitors:    pool.Spec.Backend.CephConfig.Monitors,
				User:        pool.Spec.Backend.CephConfig.User,
				KeyringPath: pool.Spec.Backend.CephConfig.KeyringPath,
				Namespace:   pool.Spec.Backend.CephConfig.Namespace,
				SecretUuid:  pool.Spec.Backend.CephConfig.SecretUUID,
			}
		}
	case domain.BackendTypeNFS:
		req.Type = nodev1.StoragePoolType_STORAGE_POOL_TYPE_NFS
		if pool.Spec.Backend.NFSConfig != nil {
			req.Config.Nfs = &nodev1.NfsPoolConfig{
				Server:     pool.Spec.Backend.NFSConfig.Server,
				ExportPath: pool.Spec.Backend.NFSConfig.ExportPath,
				Version:    pool.Spec.Backend.NFSConfig.Version,
				Options:    pool.Spec.Backend.NFSConfig.Options,
				MountPoint: pool.Spec.Backend.NFSConfig.MountPoint,
			}
		}
	case domain.BackendTypeLocalDir:
		req.Type = nodev1.StoragePoolType_STORAGE_POOL_TYPE_LOCAL_DIR
		if pool.Spec.Backend.LocalDirConfig != nil {
			req.Config.Local = &nodev1.LocalDirPoolConfig{
				Path: pool.Spec.Backend.LocalDirConfig.Path,
			}
		}
	case domain.BackendTypeISCSI:
		req.Type = nodev1.StoragePoolType_STORAGE_POOL_TYPE_ISCSI
		if pool.Spec.Backend.ISCSIConfig != nil {
			req.Config.Iscsi = &nodev1.IscsiPoolConfig{
				Portal:       pool.Spec.Backend.ISCSIConfig.Portal,
				Target:       pool.Spec.Backend.ISCSIConfig.Target,
				ChapEnabled:  pool.Spec.Backend.ISCSIConfig.CHAPEnabled,
				ChapUser:     pool.Spec.Backend.ISCSIConfig.CHAPUser,
				ChapPassword: pool.Spec.Backend.ISCSIConfig.CHAPPassword,
				Lun:          pool.Spec.Backend.ISCSIConfig.LUN,
				VolumeGroup:  pool.Spec.Backend.ISCSIConfig.VolumeGroup,
			}
		}
	}

	return req
}

// GetPool retrieves a storage pool by ID.
func (s *PoolService) GetPool(
	ctx context.Context,
	req *connect.Request[storagev1.GetPoolRequest],
) (*connect.Response[storagev1.StoragePool], error) {
	logger := s.logger.With(
		zap.String("method", "GetPool"),
		zap.String("pool_id", req.Msg.Id),
	)
	logger.Debug("Getting storage pool")

	pool, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		logger.Error("Failed to get storage pool", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(convertPoolToProto(pool)), nil
}

// ListPools returns all storage pools matching the filter.
func (s *PoolService) ListPools(
	ctx context.Context,
	req *connect.Request[storagev1.ListPoolsRequest],
) (*connect.Response[storagev1.ListPoolsResponse], error) {
	logger := s.logger.With(zap.String("method", "ListPools"))
	logger.Debug("Listing storage pools")

	filter := convertPoolFilterFromProto(req.Msg)
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}
	offset := 0 // Simple pagination

	pools, total, err := s.repo.List(ctx, filter, limit, offset)
	if err != nil {
		logger.Error("Failed to list storage pools", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&storagev1.ListPoolsResponse{
		Pools:      convertPoolsToProtos(pools),
		TotalCount: int32(total),
	}), nil
}

// UpdatePool updates a storage pool configuration.
func (s *PoolService) UpdatePool(
	ctx context.Context,
	req *connect.Request[storagev1.UpdatePoolRequest],
) (*connect.Response[storagev1.StoragePool], error) {
	logger := s.logger.With(
		zap.String("method", "UpdatePool"),
		zap.String("pool_id", req.Msg.Id),
	)
	logger.Info("Updating storage pool")

	// Get existing pool
	pool, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		logger.Error("Pool not found for update", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Apply updates
	if req.Msg.Description != "" {
		pool.Description = req.Msg.Description
	}
	if req.Msg.Labels != nil {
		pool.Labels = req.Msg.Labels
	}
	if req.Msg.Spec != nil {
		pool.Spec = *convertPoolSpecFromProto(req.Msg.Spec)
	}
	pool.UpdatedAt = time.Now()

	// Save updates
	updatedPool, err := s.repo.Update(ctx, pool)
	if err != nil {
		logger.Error("Failed to update storage pool", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Storage pool updated successfully", zap.String("pool_id", updatedPool.ID))
	return connect.NewResponse(convertPoolToProto(updatedPool)), nil
}

// DeletePool removes a storage pool.
func (s *PoolService) DeletePool(
	ctx context.Context,
	req *connect.Request[storagev1.DeletePoolRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeletePool"),
		zap.String("pool_id", req.Msg.Id),
	)
	logger.Info("Deleting storage pool")

	// Check if pool has volumes (would need VolumeRepository for this)
	// For now, just delete

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete storage pool", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Storage pool deleted successfully", zap.String("pool_id", req.Msg.Id))
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// GetPoolMetrics returns current pool metrics.
func (s *PoolService) GetPoolMetrics(
	ctx context.Context,
	req *connect.Request[storagev1.GetPoolMetricsRequest],
) (*connect.Response[storagev1.PoolMetrics], error) {
	logger := s.logger.With(
		zap.String("method", "GetPoolMetrics"),
		zap.String("pool_id", req.Msg.Id),
	)
	logger.Debug("Getting pool metrics")

	pool, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		logger.Error("Failed to get pool for metrics", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	metrics := &storagev1.PoolMetrics{
		PoolId:               pool.ID,
		TotalBytes:           pool.Status.Capacity.TotalBytes,
		UsedBytes:            pool.Status.Capacity.UsedBytes,
		AvailableBytes:       pool.Status.Capacity.AvailableBytes,
		ProvisionedBytes:     pool.Status.Capacity.ProvisionedBytes,
		ReadIops:             pool.Status.Metrics.ReadIOPS,
		WriteIops:            pool.Status.Metrics.WriteIOPS,
		ReadThroughputBytes:  pool.Status.Metrics.ReadBytesPerSec,
		WriteThroughputBytes: pool.Status.Metrics.WriteBytesPerSec,
		ReadLatencyUs:        pool.Status.Metrics.ReadLatencyUs,
		WriteLatencyUs:       pool.Status.Metrics.WriteLatencyUs,
		VolumeCount:          pool.Status.VolumeCount,
	}

	return connect.NewResponse(metrics), nil
}

// ReconnectPool retries initialization of a pool on connected nodes.
// Used when pool is in ERROR state due to no connected nodes.
func (s *PoolService) ReconnectPool(
	ctx context.Context,
	req *connect.Request[storagev1.ReconnectPoolRequest],
) (*connect.Response[storagev1.StoragePool], error) {
	logger := s.logger.With(
		zap.String("method", "ReconnectPool"),
		zap.String("pool_id", req.Msg.Id),
	)
	logger.Info("Reconnecting storage pool")

	// Get existing pool
	pool, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		logger.Error("Failed to get storage pool", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if there are connected nodes
	if s.daemonPool == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("no daemon pool available"))
	}

	connectedNodes := s.daemonPool.ConnectedNodes()
	if len(connectedNodes) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("no connected nodes available to initialize pool"))
	}

	// Retry initialization
	poolInfo, initErr := s.initPoolOnNodes(ctx, pool, logger)
	if initErr != nil {
		logger.Error("Failed to reinitialize pool on nodes", zap.Error(initErr))
		pool.Status.Phase = domain.StoragePoolPhaseError
		pool.Status.ErrorMessage = initErr.Error()
	} else if poolInfo != nil {
		pool.Status.Phase = domain.StoragePoolPhaseReady
		pool.Status.ErrorMessage = ""
		pool.Status.Capacity = domain.StorageCapacity{
			TotalBytes:     poolInfo.TotalBytes,
			AvailableBytes: poolInfo.AvailableBytes,
			UsedBytes:      poolInfo.UsedBytes,
		}
		logger.Info("Pool reconnected successfully",
			zap.Uint64("total_bytes", poolInfo.TotalBytes),
			zap.Uint64("available_bytes", poolInfo.AvailableBytes),
		)
	} else {
		pool.Status.Phase = domain.StoragePoolPhaseError
		pool.Status.ErrorMessage = fmt.Sprintf("Pool reconnection failed on all %d connected nodes", len(connectedNodes))
	}

	// Update pool status in repository
	if err := s.repo.UpdateStatus(ctx, pool.ID, pool.Status); err != nil {
		logger.Warn("Failed to update pool status", zap.Error(err))
	}

	logger.Info("Pool reconnection completed",
		zap.String("pool_id", pool.ID),
		zap.String("phase", string(pool.Status.Phase)),
	)
	return connect.NewResponse(convertPoolToProto(pool)), nil
}

// AssignPoolToNode assigns a storage pool to a specific node.
func (s *PoolService) AssignPoolToNode(
	ctx context.Context,
	req *connect.Request[storagev1.AssignPoolToNodeRequest],
) (*connect.Response[storagev1.StoragePool], error) {
	logger := s.logger.With(
		zap.String("method", "AssignPoolToNode"),
		zap.String("pool_id", req.Msg.PoolId),
		zap.String("node_id", req.Msg.NodeId),
	)
	logger.Info("Assigning storage pool to node")

	// Validate inputs
	if req.Msg.PoolId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("pool_id is required"))
	}
	if req.Msg.NodeId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("node_id is required"))
	}

	// Get existing pool
	pool, err := s.repo.Get(ctx, req.Msg.PoolId)
	if err != nil {
		logger.Error("Failed to get storage pool", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("pool not found: %s", req.Msg.PoolId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Verify node exists
	if s.nodeRepo != nil {
		_, err := s.nodeRepo.Get(ctx, req.Msg.NodeId)
		if err != nil {
			logger.Error("Node not found", zap.Error(err))
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("node not found: %s", req.Msg.NodeId))
		}
	}

	// Assign node to pool
	if pool.AssignToNode(req.Msg.NodeId) {
		pool.UpdatedAt = time.Now()
		if _, err := s.repo.Update(ctx, pool); err != nil {
			logger.Error("Failed to update pool", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		logger.Info("Pool assigned to node successfully")
	} else {
		logger.Info("Pool already assigned to node")
	}

	return connect.NewResponse(convertPoolToProto(pool)), nil
}

// UnassignPoolFromNode removes a storage pool assignment from a node.
func (s *PoolService) UnassignPoolFromNode(
	ctx context.Context,
	req *connect.Request[storagev1.UnassignPoolFromNodeRequest],
) (*connect.Response[storagev1.StoragePool], error) {
	logger := s.logger.With(
		zap.String("method", "UnassignPoolFromNode"),
		zap.String("pool_id", req.Msg.PoolId),
		zap.String("node_id", req.Msg.NodeId),
	)
	logger.Info("Unassigning storage pool from node")

	// Validate inputs
	if req.Msg.PoolId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("pool_id is required"))
	}
	if req.Msg.NodeId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("node_id is required"))
	}

	// Get existing pool
	pool, err := s.repo.Get(ctx, req.Msg.PoolId)
	if err != nil {
		logger.Error("Failed to get storage pool", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("pool not found: %s", req.Msg.PoolId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Unassign node from pool
	if pool.UnassignFromNode(req.Msg.NodeId) {
		pool.UpdatedAt = time.Now()
		if _, err := s.repo.Update(ctx, pool); err != nil {
			logger.Error("Failed to update pool", zap.Error(err))
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		logger.Info("Pool unassigned from node successfully")
	} else {
		logger.Info("Pool was not assigned to node")
	}

	return connect.NewResponse(convertPoolToProto(pool)), nil
}

// ListPoolFiles lists files inside a storage pool's mount path.
func (s *PoolService) ListPoolFiles(
	ctx context.Context,
	req *connect.Request[storagev1.ListPoolFilesRequest],
) (*connect.Response[storagev1.ListPoolFilesResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ListPoolFiles"),
		zap.String("pool_id", req.Msg.PoolId),
		zap.String("path", req.Msg.Path),
	)
	logger.Info("Listing storage pool files")

	// #region agent log
	logger.Info("DEBUG H3: ListPoolFiles called with pool_id",
		zap.String("pool_id", req.Msg.PoolId),
		zap.Int("pool_id_len", len(req.Msg.PoolId)),
	)
	// #endregion

	// Get pool
	pool, err := s.repo.Get(ctx, req.Msg.PoolId)
	if err != nil {
		// #region agent log
		logger.Error("DEBUG H3: Failed to get storage pool from repository",
			zap.String("pool_id", req.Msg.PoolId),
			zap.Error(err),
		)
		// #endregion
		logger.Error("Failed to get storage pool", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("pool not found: %s", req.Msg.PoolId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Check if pool has any assigned nodes
	assignedNodes := pool.GetAssignedNodeIDs()
	if len(assignedNodes) == 0 {
		// If no assigned nodes, try to use any connected node
		if s.daemonPool != nil {
			assignedNodes = s.daemonPool.ConnectedNodes()
		}
	}

	if len(assignedNodes) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("no nodes available to list files for this pool"))
	}

	// Try to list files from the first available node
	var entries []*storagev1.PoolFileEntry
	var lastErr error

	for _, nodeID := range assignedNodes {
		client := s.daemonPool.Get(nodeID)
		if client == nil {
			continue
		}

		// Call node daemon to list files
		resp, err := client.ListStoragePoolFiles(ctx, req.Msg.PoolId, req.Msg.Path)
		if err != nil {
			lastErr = err
			logger.Warn("Failed to list files from node", zap.String("node_id", nodeID), zap.Error(err))
			continue
		}

		// Convert response
		for _, entry := range resp.Entries {
			entries = append(entries, &storagev1.PoolFileEntry{
				Name:        entry.Name,
				Path:        entry.Path,
				IsDirectory: entry.IsDirectory,
				SizeBytes:   entry.SizeBytes,
				ModifiedAt:  entry.ModifiedAt,
				FileType:    entry.FileType,
				Permissions: entry.Permissions,
			})
		}

		return connect.NewResponse(&storagev1.ListPoolFilesResponse{
			Entries:     entries,
			CurrentPath: req.Msg.Path,
		}), nil
	}

	if lastErr != nil {
		return nil, connect.NewError(connect.CodeInternal, lastErr)
	}

	return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("could not list files from any node"))
}
