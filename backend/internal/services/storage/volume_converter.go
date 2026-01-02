// Package storage provides converters between protobuf and domain types.
package storage

import (
	"time"

	"github.com/Quantixkvm/Quantixkvm/internal/domain"
	storagev1 "github.com/Quantixkvm/Quantixkvm/pkg/api/Quantixkvm/storage/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// =============================================================================
// VOLUME CONVERTERS
// =============================================================================

// convertVolumeToProto converts a domain.Volume to a storagev1.Volume.
func convertVolumeToProto(vol *domain.Volume) *storagev1.Volume {
	if vol == nil {
		return nil
	}

	return &storagev1.Volume{
		Id:        vol.ID,
		Name:      vol.Name,
		ProjectId: vol.ProjectID,
		PoolId:    vol.PoolID,
		Labels:    vol.Labels,
		Spec:      convertVolumeSpecToProto(&vol.Spec),
		Status:    convertVolumeStatusToProto(&vol.Status),
		CreatedAt: timestamppb.New(vol.CreatedAt),
		UpdatedAt: timestamppb.New(vol.UpdatedAt),
	}
}

// convertVolumeSpecToProto converts domain.VolumeSpec to storagev1.VolumeSpec.
func convertVolumeSpecToProto(spec *domain.VolumeSpec) *storagev1.VolumeSpec {
	if spec == nil {
		return nil
	}

	protoSpec := &storagev1.VolumeSpec{
		SizeBytes:    spec.SizeBytes,
		Provisioning: storagev1.VolumeSpec_ProvisioningType(storagev1.VolumeSpec_ProvisioningType_value[string(spec.Provisioning)]),
		AccessMode:   storagev1.VolumeSpec_AccessMode(storagev1.VolumeSpec_AccessMode_value[string(spec.AccessMode)]),
		Qos: &storagev1.VolumeQos{
			MaxIops:          spec.QoS.MaxIOPS,
			MinIops:          spec.QoS.MinIOPS,
			MaxThroughput:    spec.QoS.MaxThroughput,
			MinThroughput:    spec.QoS.MinThroughput,
			BurstIops:        spec.QoS.BurstIOPS,
			BurstThroughput:  spec.QoS.BurstThroughput,
			BurstDurationSec: spec.QoS.BurstDurationSec,
		},
		Encryption: &storagev1.EncryptionConfig{
			Enabled:     spec.Encryption.Enabled,
			Cipher:      spec.Encryption.Cipher,
			KmsEndpoint: spec.Encryption.KMSEndpoint,
			KmsKeyId:    spec.Encryption.KMSKeyID,
		},
	}

	return protoSpec
}

// convertVolumeStatusToProto converts domain.VolumeStatus to storagev1.VolumeStatus.
func convertVolumeStatusToProto(status *domain.VolumeStatus) *storagev1.VolumeStatus {
	if status == nil {
		return nil
	}

	return &storagev1.VolumeStatus{
		Phase:           storagev1.VolumeStatus_Phase(storagev1.VolumeStatus_Phase_value[string(status.Phase)]),
		AttachedVmId:    status.AttachedVMID,
		DevicePath:      status.DevicePath,
		ActualSizeBytes: status.ActualSizeBytes,
		Usage: &storagev1.VolumeUsage{
			UsedBytes:      status.Usage.UsedBytes,
			ReadIops:       status.Usage.ReadIOPS,
			WriteIops:      status.Usage.WriteIOPS,
			ReadBytesSec:   status.Usage.ReadBytesPerSec,
			WriteBytesSec:  status.Usage.WriteBytesPerSec,
			ReadLatencyUs:  status.Usage.ReadLatencyUs,
			WriteLatencyUs: status.Usage.WriteLatencyUs,
		},
		SnapshotCount: status.SnapshotCount,
		ErrorMessage:  status.ErrorMessage,
		BackendId:     status.BackendID,
	}
}

// convertCreateVolumeRequestToDomain converts a CreateVolumeRequest to domain.Volume.
func convertCreateVolumeRequestToDomain(req *storagev1.CreateVolumeRequest) *domain.Volume {
	vol := &domain.Volume{
		Name:      req.Name,
		ProjectID: req.ProjectId,
		PoolID:    req.PoolId,
		Labels:    req.Labels,
		Status: domain.VolumeStatus{
			Phase: domain.VolumePhasePending,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if req.Spec != nil {
		vol.Spec = *convertVolumeSpecFromProto(req.Spec)
	}

	return vol
}

// convertVolumeSpecFromProto converts storagev1.VolumeSpec to domain.VolumeSpec.
func convertVolumeSpecFromProto(spec *storagev1.VolumeSpec) *domain.VolumeSpec {
	if spec == nil {
		return nil
	}

	domainSpec := &domain.VolumeSpec{
		SizeBytes:    spec.SizeBytes,
		Provisioning: domain.ProvisioningType(spec.Provisioning.String()),
		AccessMode:   domain.AccessMode(spec.AccessMode.String()),
	}

	if spec.Qos != nil {
		domainSpec.QoS = domain.VolumeQoS{
			MaxIOPS:          spec.Qos.MaxIops,
			MinIOPS:          spec.Qos.MinIops,
			MaxThroughput:    spec.Qos.MaxThroughput,
			MinThroughput:    spec.Qos.MinThroughput,
			BurstIOPS:        spec.Qos.BurstIops,
			BurstThroughput:  spec.Qos.BurstThroughput,
			BurstDurationSec: spec.Qos.BurstDurationSec,
		}
	}

	if spec.Encryption != nil {
		domainSpec.Encryption = domain.EncryptionConfig{
			Enabled:     spec.Encryption.Enabled,
			Cipher:      spec.Encryption.Cipher,
			KMSEndpoint: spec.Encryption.KmsEndpoint,
			KMSKeyID:    spec.Encryption.KmsKeyId,
		}
	}

	// Handle source
	if spec.Source != nil {
		switch s := spec.Source.Source.(type) {
		case *storagev1.VolumeSource_Empty:
			domainSpec.Source = domain.VolumeSource{
				Type:       "empty",
				Filesystem: s.Empty.Filesystem,
			}
		case *storagev1.VolumeSource_Clone:
			domainSpec.Source = domain.VolumeSource{
				Type:     "clone",
				VolumeID: s.Clone.VolumeId,
			}
		case *storagev1.VolumeSource_Snapshot:
			domainSpec.Source = domain.VolumeSource{
				Type:       "snapshot",
				SnapshotID: s.Snapshot.SnapshotId,
			}
		case *storagev1.VolumeSource_Image:
			domainSpec.Source = domain.VolumeSource{
				Type:    "image",
				ImageID: s.Image.ImageId,
			}
		}
	}

	return domainSpec
}

// convertVolumeFilterFromProto converts list request to VolumeFilter.
func convertVolumeFilterFromProto(req *storagev1.ListVolumesRequest) VolumeFilter {
	filter := VolumeFilter{
		ProjectID:    req.ProjectId,
		PoolID:       req.PoolId,
		AttachedVMID: req.AttachedVmId,
		Labels:       req.Labels,
	}
	if req.Phase != storagev1.VolumeStatus_UNKNOWN {
		filter.Phase = domain.VolumePhase(req.Phase.String())
	}
	return filter
}

// convertVolumesToProtos converts a slice of domain volumes to proto volumes.
func convertVolumesToProtos(volumes []*domain.Volume) []*storagev1.Volume {
	if volumes == nil {
		return nil
	}
	result := make([]*storagev1.Volume, len(volumes))
	for i, vol := range volumes {
		result[i] = convertVolumeToProto(vol)
	}
	return result
}
