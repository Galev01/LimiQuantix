// Package storage implements the StoragePoolService and VolumeService.
package storage

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	storagev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1"
)

// PoolService implements the storagev1connect.StoragePoolServiceHandler interface.
type PoolService struct {
	repo   PoolRepository
	logger *zap.Logger
}

// NewPoolService creates a new PoolService.
func NewPoolService(repo PoolRepository, logger *zap.Logger) *PoolService {
	return &PoolService{
		repo:   repo,
		logger: logger,
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

	// Validate request
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}

	// Convert to domain model
	pool := convertCreatePoolRequestToDomain(req.Msg)
	pool.Status.Phase = domain.StoragePoolPhasePending

	// Create in repository
	createdPool, err := s.repo.Create(ctx, pool)
	if err != nil {
		logger.Error("Failed to create storage pool", zap.Error(err))
		if err == domain.ErrAlreadyExists {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Simulate pool becoming ready (in real implementation, would be async)
	createdPool.Status.Phase = domain.StoragePoolPhaseReady
	createdPool.Status.Capacity = domain.StorageCapacity{
		TotalBytes:     100 * 1024 * 1024 * 1024, // 100 GiB
		AvailableBytes: 100 * 1024 * 1024 * 1024,
	}
	if err := s.repo.UpdateStatus(ctx, createdPool.ID, createdPool.Status); err != nil {
		logger.Warn("Failed to update pool status", zap.Error(err))
	}

	logger.Info("Storage pool created successfully", zap.String("pool_id", createdPool.ID))
	return connect.NewResponse(convertPoolToProto(createdPool)), nil
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
