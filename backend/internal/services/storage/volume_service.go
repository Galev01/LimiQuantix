// Package storage implements the VolumeService.
package storage

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	storagev1 "github.com/Quantixkvm/Quantixkvm/pkg/api/Quantixkvm/storage/v1"
)

// VolumeService implements the storagev1connect.VolumeServiceHandler interface.
type VolumeService struct {
	repo     VolumeRepository
	poolRepo PoolRepository
	logger   *zap.Logger
}

// NewVolumeService creates a new VolumeService.
func NewVolumeService(repo VolumeRepository, poolRepo PoolRepository, logger *zap.Logger) *VolumeService {
	return &VolumeService{
		repo:     repo,
		poolRepo: poolRepo,
		logger:   logger,
	}
}

// CreateVolume creates a new volume.
func (s *VolumeService) CreateVolume(
	ctx context.Context,
	req *connect.Request[storagev1.CreateVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "CreateVolume"),
		zap.String("volume_name", req.Msg.Name),
		zap.String("pool_id", req.Msg.PoolId),
	)
	logger.Info("Creating volume")

	// Validate request
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}
	if req.Msg.PoolId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("pool_id is required"))
	}
	if req.Msg.Spec == nil || req.Msg.Spec.SizeBytes < 1024*1024 { // Minimum 1 MiB
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("size must be at least 1 MiB"))
	}

	// Verify pool exists
	_, err := s.poolRepo.Get(ctx, req.Msg.PoolId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("pool not found: %s", req.Msg.PoolId))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert to domain model
	vol := convertCreateVolumeRequestToDomain(req.Msg)
	vol.Status.Phase = domain.VolumePhasePending
	vol.Status.ActualSizeBytes = vol.Spec.SizeBytes

	// Create in repository
	createdVol, err := s.repo.Create(ctx, vol)
	if err != nil {
		logger.Error("Failed to create volume", zap.Error(err))
		if err == domain.ErrAlreadyExists {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Simulate volume becoming ready
	createdVol.Status.Phase = domain.VolumePhaseReady
	if err := s.repo.UpdateStatus(ctx, createdVol.ID, createdVol.Status); err != nil {
		logger.Warn("Failed to update volume status", zap.Error(err))
	}

	logger.Info("Volume created successfully", zap.String("volume_id", createdVol.ID))
	return connect.NewResponse(convertVolumeToProto(createdVol)), nil
}

// GetVolume retrieves a volume by ID.
func (s *VolumeService) GetVolume(
	ctx context.Context,
	req *connect.Request[storagev1.GetVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "GetVolume"),
		zap.String("volume_id", req.Msg.Id),
	)
	logger.Debug("Getting volume")

	vol, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		logger.Error("Failed to get volume", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(convertVolumeToProto(vol)), nil
}

// ListVolumes returns volumes matching the filter.
func (s *VolumeService) ListVolumes(
	ctx context.Context,
	req *connect.Request[storagev1.ListVolumesRequest],
) (*connect.Response[storagev1.ListVolumesResponse], error) {
	logger := s.logger.With(zap.String("method", "ListVolumes"))
	logger.Debug("Listing volumes")

	filter := convertVolumeFilterFromProto(req.Msg)
	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	volumes, total, err := s.repo.List(ctx, filter, limit, 0)
	if err != nil {
		logger.Error("Failed to list volumes", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&storagev1.ListVolumesResponse{
		Volumes:    convertVolumesToProtos(volumes),
		TotalCount: int32(total),
	}), nil
}

// UpdateVolume updates a volume configuration.
func (s *VolumeService) UpdateVolume(
	ctx context.Context,
	req *connect.Request[storagev1.UpdateVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateVolume"),
		zap.String("volume_id", req.Msg.Id),
	)
	logger.Info("Updating volume")

	vol, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Apply updates (only labels and QoS can be updated on live volume)
	if req.Msg.Labels != nil {
		vol.Labels = req.Msg.Labels
	}
	if req.Msg.Spec != nil && req.Msg.Spec.Qos != nil {
		vol.Spec.QoS = domain.VolumeQoS{
			MaxIOPS:          req.Msg.Spec.Qos.MaxIops,
			MinIOPS:          req.Msg.Spec.Qos.MinIops,
			MaxThroughput:    req.Msg.Spec.Qos.MaxThroughput,
			MinThroughput:    req.Msg.Spec.Qos.MinThroughput,
			BurstIOPS:        req.Msg.Spec.Qos.BurstIops,
			BurstThroughput:  req.Msg.Spec.Qos.BurstThroughput,
			BurstDurationSec: req.Msg.Spec.Qos.BurstDurationSec,
		}
	}
	vol.UpdatedAt = time.Now()

	updatedVol, err := s.repo.Update(ctx, vol)
	if err != nil {
		logger.Error("Failed to update volume", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Volume updated successfully", zap.String("volume_id", updatedVol.ID))
	return connect.NewResponse(convertVolumeToProto(updatedVol)), nil
}

// DeleteVolume removes a volume.
func (s *VolumeService) DeleteVolume(
	ctx context.Context,
	req *connect.Request[storagev1.DeleteVolumeRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteVolume"),
		zap.String("volume_id", req.Msg.Id),
	)
	logger.Info("Deleting volume")

	// Check if attached
	vol, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if vol.IsAttached() && !req.Msg.Force {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("volume is attached to VM %s, use force=true to delete", vol.Status.AttachedVMID))
	}

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete volume", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Volume deleted successfully", zap.String("volume_id", req.Msg.Id))
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ResizeVolume expands a volume.
func (s *VolumeService) ResizeVolume(
	ctx context.Context,
	req *connect.Request[storagev1.ResizeVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "ResizeVolume"),
		zap.String("volume_id", req.Msg.Id),
		zap.Uint64("new_size", req.Msg.NewSizeBytes),
	)
	logger.Info("Resizing volume")

	vol, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Validate resize (can only expand, not shrink)
	if req.Msg.NewSizeBytes <= vol.Spec.SizeBytes {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			fmt.Errorf("new size must be larger than current size (%d bytes)", vol.Spec.SizeBytes))
	}

	// Update size
	vol.Spec.SizeBytes = req.Msg.NewSizeBytes
	vol.Status.ActualSizeBytes = req.Msg.NewSizeBytes
	vol.UpdatedAt = time.Now()

	updatedVol, err := s.repo.Update(ctx, vol)
	if err != nil {
		logger.Error("Failed to resize volume", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Volume resized successfully", zap.String("volume_id", updatedVol.ID))
	return connect.NewResponse(convertVolumeToProto(updatedVol)), nil
}

// AttachVolume attaches a volume to a VM.
func (s *VolumeService) AttachVolume(
	ctx context.Context,
	req *connect.Request[storagev1.AttachVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "AttachVolume"),
		zap.String("volume_id", req.Msg.VolumeId),
		zap.String("vm_id", req.Msg.VmId),
	)
	logger.Info("Attaching volume to VM")

	vol, err := s.repo.Get(ctx, req.Msg.VolumeId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if vol.IsAttached() {
		return nil, connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("volume already attached to VM %s", vol.Status.AttachedVMID))
	}

	// Update status
	vol.Status.AttachedVMID = req.Msg.VmId
	vol.Status.DevicePath = req.Msg.DevicePath
	if vol.Status.DevicePath == "" {
		vol.Status.DevicePath = "/dev/vdb" // Default device path
	}
	vol.Status.Phase = domain.VolumePhaseInUse
	vol.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vol.ID, vol.Status); err != nil {
		logger.Error("Failed to update volume status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Volume attached successfully",
		zap.String("volume_id", vol.ID),
		zap.String("vm_id", req.Msg.VmId))
	return connect.NewResponse(convertVolumeToProto(vol)), nil
}

// DetachVolume detaches a volume from a VM.
func (s *VolumeService) DetachVolume(
	ctx context.Context,
	req *connect.Request[storagev1.DetachVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "DetachVolume"),
		zap.String("volume_id", req.Msg.VolumeId),
	)
	logger.Info("Detaching volume from VM")

	vol, err := s.repo.Get(ctx, req.Msg.VolumeId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if !vol.IsAttached() {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("volume is not attached"))
	}

	// Update status
	vol.Status.AttachedVMID = ""
	vol.Status.DevicePath = ""
	vol.Status.Phase = domain.VolumePhaseReady
	vol.UpdatedAt = time.Now()

	if err := s.repo.UpdateStatus(ctx, vol.ID, vol.Status); err != nil {
		logger.Error("Failed to update volume status", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Volume detached successfully", zap.String("volume_id", vol.ID))
	return connect.NewResponse(convertVolumeToProto(vol)), nil
}

// CloneVolume creates a copy of a volume.
func (s *VolumeService) CloneVolume(
	ctx context.Context,
	req *connect.Request[storagev1.CloneVolumeRequest],
) (*connect.Response[storagev1.Volume], error) {
	logger := s.logger.With(
		zap.String("method", "CloneVolume"),
		zap.String("source_volume_id", req.Msg.SourceVolumeId),
		zap.String("new_name", req.Msg.Name),
	)
	logger.Info("Cloning volume")

	// Get source volume
	sourceVol, err := s.repo.Get(ctx, req.Msg.SourceVolumeId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create clone
	clone := &domain.Volume{
		Name:      req.Msg.Name,
		ProjectID: req.Msg.ProjectId,
		PoolID:    sourceVol.PoolID,
		Labels:    sourceVol.Labels,
		Spec:      sourceVol.Spec,
		Status: domain.VolumeStatus{
			Phase:           domain.VolumePhaseReady,
			ActualSizeBytes: sourceVol.Status.ActualSizeBytes,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	clone.Spec.Source = domain.VolumeSource{
		Type:     "clone",
		VolumeID: req.Msg.SourceVolumeId,
	}

	if clone.ProjectID == "" {
		clone.ProjectID = sourceVol.ProjectID
	}

	createdClone, err := s.repo.Create(ctx, clone)
	if err != nil {
		logger.Error("Failed to create clone", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Volume cloned successfully",
		zap.String("source_volume_id", req.Msg.SourceVolumeId),
		zap.String("clone_volume_id", createdClone.ID))
	return connect.NewResponse(convertVolumeToProto(createdClone)), nil
}

// GetVolumeMetrics returns current volume metrics.
func (s *VolumeService) GetVolumeMetrics(
	ctx context.Context,
	req *connect.Request[storagev1.GetVolumeMetricsRequest],
) (*connect.Response[storagev1.VolumeMetrics], error) {
	logger := s.logger.With(
		zap.String("method", "GetVolumeMetrics"),
		zap.String("volume_id", req.Msg.Id),
	)
	logger.Debug("Getting volume metrics")

	vol, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	metrics := &storagev1.VolumeMetrics{
		VolumeId:             vol.ID,
		ProvisionedBytes:     vol.Spec.SizeBytes,
		UsedBytes:            vol.Status.Usage.UsedBytes,
		ReadIops:             vol.Status.Usage.ReadIOPS,
		WriteIops:            vol.Status.Usage.WriteIOPS,
		ReadThroughputBytes:  vol.Status.Usage.ReadBytesPerSec,
		WriteThroughputBytes: vol.Status.Usage.WriteBytesPerSec,
		ReadLatencyUs:        vol.Status.Usage.ReadLatencyUs,
		WriteLatencyUs:       vol.Status.Usage.WriteLatencyUs,
	}

	return connect.NewResponse(metrics), nil
}
