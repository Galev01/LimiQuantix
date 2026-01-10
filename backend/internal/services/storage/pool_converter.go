// Package storage provides converters between protobuf and domain types.
package storage

import (
	"time"

	"github.com/limiquantix/limiquantix/internal/domain"
	storagev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// =============================================================================
// STORAGE POOL CONVERTERS
// =============================================================================

// convertPoolToProto converts a domain.StoragePool to a storagev1.StoragePool.
func convertPoolToProto(pool *domain.StoragePool) *storagev1.StoragePool {
	if pool == nil {
		return nil
	}

	return &storagev1.StoragePool{
		Id:          pool.ID,
		Name:        pool.Name,
		ProjectId:   pool.ProjectID,
		Description: pool.Description,
		Labels:      pool.Labels,
		Spec:        convertPoolSpecToProto(&pool.Spec),
		Status:      convertPoolStatusToProto(&pool.Status),
		CreatedAt:   timestamppb.New(pool.CreatedAt),
		UpdatedAt:   timestamppb.New(pool.UpdatedAt),
	}
}

// convertPoolSpecToProto converts domain.StoragePoolSpec to storagev1.StoragePoolSpec.
func convertPoolSpecToProto(spec *domain.StoragePoolSpec) *storagev1.StoragePoolSpec {
	if spec == nil {
		return nil
	}

	protoSpec := &storagev1.StoragePoolSpec{
		Defaults: &storagev1.VolumeDefaults{
			Filesystem: spec.Defaults.Filesystem,
			BlockSize:  spec.Defaults.BlockSize,
		},
		Qos: &storagev1.StorageQos{
			MaxIops:              spec.QoS.MaxIOPS,
			MaxThroughputBytes:   spec.QoS.MaxThroughputBytes,
			BurstIops:            spec.QoS.BurstIOPS,
			BurstThroughputBytes: spec.QoS.BurstThroughputBytes,
			BurstDurationSec:     spec.QoS.BurstDurationSec,
		},
		Encryption: &storagev1.EncryptionConfig{
			Enabled:     spec.Encryption.Enabled,
			Cipher:      spec.Encryption.Cipher,
			KmsEndpoint: spec.Encryption.KMSEndpoint,
			KmsKeyId:    spec.Encryption.KMSKeyID,
		},
		Replication: &storagev1.ReplicationConfig{
			ReplicaCount:  spec.Replication.ReplicaCount,
			MinReplicas:   spec.Replication.MinReplicas,
			FailureDomain: spec.Replication.FailureDomain,
		},
	}

	// Convert backend
	if spec.Backend != nil {
		protoSpec.Backend = &storagev1.StorageBackend{
			Type: storagev1.StorageBackend_BackendType(storagev1.StorageBackend_BackendType_value[string(spec.Backend.Type)]),
		}
	}

	// Add assigned node IDs
	protoSpec.AssignedNodeIds = spec.AssignedNodeIDs

	return protoSpec
}

// convertPoolStatusToProto converts domain.StoragePoolStatus to storagev1.StoragePoolStatus.
func convertPoolStatusToProto(status *domain.StoragePoolStatus) *storagev1.StoragePoolStatus {
	if status == nil {
		return nil
	}

	return &storagev1.StoragePoolStatus{
		Phase: storagev1.StoragePoolStatus_Phase(storagev1.StoragePoolStatus_Phase_value[string(status.Phase)]),
		Capacity: &storagev1.StorageCapacity{
			TotalBytes:       status.Capacity.TotalBytes,
			UsedBytes:        status.Capacity.UsedBytes,
			AvailableBytes:   status.Capacity.AvailableBytes,
			ProvisionedBytes: status.Capacity.ProvisionedBytes,
		},
		Metrics: &storagev1.StorageMetrics{
			ReadIops:       status.Metrics.ReadIOPS,
			WriteIops:      status.Metrics.WriteIOPS,
			ReadBytesSec:   status.Metrics.ReadBytesPerSec,
			WriteBytesSec:  status.Metrics.WriteBytesPerSec,
			ReadLatencyUs:  status.Metrics.ReadLatencyUs,
			WriteLatencyUs: status.Metrics.WriteLatencyUs,
		},
		VolumeCount:  status.VolumeCount,
		ErrorMessage: status.ErrorMessage,
	}
}

// convertCreatePoolRequestToDomain converts a CreatePoolRequest to domain.StoragePool.
func convertCreatePoolRequestToDomain(req *storagev1.CreatePoolRequest) *domain.StoragePool {
	pool := &domain.StoragePool{
		Name:        req.Name,
		ProjectID:   req.ProjectId,
		Description: req.Description,
		Labels:      req.Labels,
		Status: domain.StoragePoolStatus{
			Phase: domain.StoragePoolPhasePending,
		},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if req.Spec != nil {
		pool.Spec = *convertPoolSpecFromProto(req.Spec)
	}

	return pool
}

// convertPoolSpecFromProto converts storagev1.StoragePoolSpec to domain.StoragePoolSpec.
func convertPoolSpecFromProto(spec *storagev1.StoragePoolSpec) *domain.StoragePoolSpec {
	if spec == nil {
		return nil
	}

	domainSpec := &domain.StoragePoolSpec{}

	if spec.Backend != nil {
		domainSpec.Backend = &domain.StorageBackend{
			Type: domain.BackendType(spec.Backend.Type.String()),
		}

		// Extract backend-specific config from oneof field
		if nfs := spec.Backend.GetNfs(); nfs != nil {
			domainSpec.Backend.NFSConfig = &domain.NFSConfig{
				Server:     nfs.Server,
				ExportPath: nfs.ExportPath,
				Version:    nfs.Version,
				Options:    nfs.Options,
				MountPoint: nfs.MountPoint,
			}
		}
		if ceph := spec.Backend.GetCeph(); ceph != nil {
			domainSpec.Backend.CephConfig = &domain.CephConfig{
				ClusterID:   ceph.ClusterId,
				PoolName:    ceph.PoolName,
				Monitors:    ceph.Monitors,
				User:        ceph.User,
				KeyringPath: ceph.KeyringPath,
				Namespace:   ceph.Namespace,
				SecretUUID:  ceph.SecretUuid,
			}
		}
		if localDir := spec.Backend.GetLocalDir(); localDir != nil {
			domainSpec.Backend.LocalDirConfig = &domain.DirConfig{
				Path: localDir.Path,
			}
		}
		if iscsi := spec.Backend.GetIscsi(); iscsi != nil {
			domainSpec.Backend.ISCSIConfig = &domain.ISCSIConfig{
				Portal:       iscsi.Portal,
				Target:       iscsi.Target,
				CHAPEnabled:  iscsi.ChapEnabled,
				CHAPUser:     iscsi.ChapUser,
				CHAPPassword: iscsi.ChapPassword,
				LUN:          iscsi.Lun,
				VolumeGroup:  iscsi.VolumeGroup,
			}
		}
		if localLvm := spec.Backend.GetLocalLvm(); localLvm != nil {
			domainSpec.Backend.LocalLVMConfig = &domain.LVMConfig{
				VolumeGroup: localLvm.VolumeGroup,
				ThinPool:    localLvm.ThinPool,
			}
		}
	}

	if spec.Defaults != nil {
		domainSpec.Defaults = domain.VolumeDefaults{
			Filesystem: spec.Defaults.Filesystem,
			BlockSize:  spec.Defaults.BlockSize,
		}
	}

	if spec.Qos != nil {
		domainSpec.QoS = domain.StorageQoS{
			MaxIOPS:              spec.Qos.MaxIops,
			MaxThroughputBytes:   spec.Qos.MaxThroughputBytes,
			BurstIOPS:            spec.Qos.BurstIops,
			BurstThroughputBytes: spec.Qos.BurstThroughputBytes,
			BurstDurationSec:     spec.Qos.BurstDurationSec,
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

	if spec.Replication != nil {
		domainSpec.Replication = domain.ReplicationConfig{
			ReplicaCount:  spec.Replication.ReplicaCount,
			MinReplicas:   spec.Replication.MinReplicas,
			FailureDomain: spec.Replication.FailureDomain,
		}
	}

	// Copy assigned node IDs
	domainSpec.AssignedNodeIDs = spec.AssignedNodeIds

	return domainSpec
}

// convertPoolFilterFromProto converts list request to PoolFilter.
func convertPoolFilterFromProto(req *storagev1.ListPoolsRequest) PoolFilter {
	filter := PoolFilter{
		ProjectID: req.ProjectId,
		Labels:    req.Labels,
	}
	if req.BackendType != storagev1.StorageBackend_CEPH_RBD {
		filter.BackendType = domain.BackendType(req.BackendType.String())
	}
	return filter
}

// convertPoolsToProtos converts a slice of domain pools to proto pools.
func convertPoolsToProtos(pools []*domain.StoragePool) []*storagev1.StoragePool {
	if pools == nil {
		return nil
	}
	result := make([]*storagev1.StoragePool, len(pools))
	for i, pool := range pools {
		result[i] = convertPoolToProto(pool)
	}
	return result
}
