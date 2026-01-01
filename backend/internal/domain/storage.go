// Package domain contains core business entities for the LimiQuantix platform.
// This file defines storage-related domain models: StoragePool, Volume, Snapshot, Image.
package domain

import "time"

// =============================================================================
// STORAGE POOL - Logical Storage Cluster
// =============================================================================

// StoragePoolPhase represents the current lifecycle phase of a storage pool.
type StoragePoolPhase string

const (
	StoragePoolPhasePending  StoragePoolPhase = "PENDING"
	StoragePoolPhaseReady    StoragePoolPhase = "READY"
	StoragePoolPhaseDegraded StoragePoolPhase = "DEGRADED"
	StoragePoolPhaseError    StoragePoolPhase = "ERROR"
	StoragePoolPhaseDeleting StoragePoolPhase = "DELETING"
)

// BackendType represents the type of storage backend.
type BackendType string

const (
	BackendTypeCephRBD   BackendType = "CEPH_RBD"
	BackendTypeCephFS    BackendType = "CEPH_CEPHFS"
	BackendTypeLocalLVM  BackendType = "LOCAL_LVM"
	BackendTypeLocalDir  BackendType = "LOCAL_DIR"
	BackendTypeNFS       BackendType = "NFS"
	BackendTypeISCSI     BackendType = "ISCSI"
)

// StoragePool represents a logical pool of storage resources.
// This abstracts Ceph pools, local LVM volume groups, or NFS shares.
type StoragePool struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	ProjectID   string            `json:"project_id"`
	Description string            `json:"description"`
	Labels      map[string]string `json:"labels"`

	Spec   StoragePoolSpec   `json:"spec"`
	Status StoragePoolStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// StoragePoolSpec defines the desired configuration of a storage pool.
type StoragePoolSpec struct {
	Backend     StorageBackend    `json:"backend"`
	Defaults    VolumeDefaults    `json:"defaults"`
	QoS         StorageQoS        `json:"qos"`
	Encryption  EncryptionConfig  `json:"encryption"`
	Replication ReplicationConfig `json:"replication"`
}

// StorageBackend defines the storage backend configuration.
type StorageBackend struct {
	Type      BackendType `json:"type"`
	CephRBD   *CephConfig `json:"ceph_rbd,omitempty"`
	LocalLVM  *LVMConfig  `json:"local_lvm,omitempty"`
	LocalDir  *DirConfig  `json:"local_dir,omitempty"`
	NFS       *NFSConfig  `json:"nfs,omitempty"`
}

// CephConfig holds Ceph-specific configuration.
type CephConfig struct {
	ClusterID   string   `json:"cluster_id"`
	PoolName    string   `json:"pool_name"`
	Monitors    []string `json:"monitors"`
	User        string   `json:"user"`
	KeyringPath string   `json:"keyring_path"`
	Namespace   string   `json:"namespace"`
}

// LVMConfig holds LVM-specific configuration.
type LVMConfig struct {
	VolumeGroup string `json:"volume_group"`
	ThinPool    string `json:"thin_pool"`
	NodeID      string `json:"node_id"`
}

// DirConfig holds local directory configuration.
type DirConfig struct {
	Path   string `json:"path"`
	NodeID string `json:"node_id"`
}

// NFSConfig holds NFS-specific configuration.
type NFSConfig struct {
	Server     string `json:"server"`
	ExportPath string `json:"export_path"`
	Version    string `json:"version"`
	Options    string `json:"options"`
}

// VolumeDefaults defines default settings for volumes created in this pool.
type VolumeDefaults struct {
	Provisioning string `json:"provisioning"` // "thin" or "thick"
	Filesystem   string `json:"filesystem"`   // "ext4", "xfs", "raw"
	BlockSize    uint32 `json:"block_size"`
}

// StorageQoS defines quality of service settings for a storage pool.
type StorageQoS struct {
	MaxIOPS               uint64 `json:"max_iops"`
	MaxThroughputBytes    uint64 `json:"max_throughput_bytes"`
	BurstIOPS             uint64 `json:"burst_iops"`
	BurstThroughputBytes  uint64 `json:"burst_throughput_bytes"`
	BurstDurationSec      uint32 `json:"burst_duration_sec"`
}

// EncryptionConfig defines encryption settings.
type EncryptionConfig struct {
	Enabled       bool   `json:"enabled"`
	Cipher        string `json:"cipher"`
	KeyManagement string `json:"key_management"` // "internal" or "external_kms"
	KMSEndpoint   string `json:"kms_endpoint"`
	KMSKeyID      string `json:"kms_key_id"`
}

// ReplicationConfig defines replication settings.
type ReplicationConfig struct {
	ReplicaCount  uint32 `json:"replica_count"`
	MinReplicas   uint32 `json:"min_replicas"`
	FailureDomain string `json:"failure_domain"`
}

// StoragePoolStatus represents the current runtime status of a storage pool.
type StoragePoolStatus struct {
	Phase        StoragePoolPhase `json:"phase"`
	Capacity     StorageCapacity  `json:"capacity"`
	Metrics      StorageMetrics   `json:"metrics"`
	Health       StorageHealth    `json:"health"`
	VolumeCount  uint32           `json:"volume_count"`
	ErrorMessage string           `json:"error_message"`
}

// StorageCapacity holds capacity information.
type StorageCapacity struct {
	TotalBytes       uint64 `json:"total_bytes"`
	UsedBytes        uint64 `json:"used_bytes"`
	AvailableBytes   uint64 `json:"available_bytes"`
	ProvisionedBytes uint64 `json:"provisioned_bytes"`
}

// StorageMetrics holds current performance metrics.
type StorageMetrics struct {
	ReadIOPS         uint64 `json:"read_iops"`
	WriteIOPS        uint64 `json:"write_iops"`
	ReadBytesPerSec  uint64 `json:"read_bytes_per_sec"`
	WriteBytesPerSec uint64 `json:"write_bytes_per_sec"`
	ReadLatencyUs    uint64 `json:"read_latency_us"`
	WriteLatencyUs   uint64 `json:"write_latency_us"`
}

// StorageHealth represents health status.
type StorageHealth struct {
	Status string        `json:"status"` // "healthy", "warning", "error"
	Checks []HealthCheck `json:"checks"`
}

// HealthCheck represents a single health check result.
type HealthCheck struct {
	Name    string `json:"name"`
	Passed  bool   `json:"passed"`
	Message string `json:"message"`
}

// IsReady returns true if the storage pool is ready to use.
func (p *StoragePool) IsReady() bool {
	return p.Status.Phase == StoragePoolPhaseReady
}

// =============================================================================
// VOLUME - Virtual Disk
// =============================================================================

// VolumePhase represents the current lifecycle phase of a volume.
type VolumePhase string

const (
	VolumePhasePending  VolumePhase = "PENDING"
	VolumePhaseCreating VolumePhase = "CREATING"
	VolumePhaseReady    VolumePhase = "READY"
	VolumePhaseInUse    VolumePhase = "IN_USE"
	VolumePhaseDeleting VolumePhase = "DELETING"
	VolumePhaseError    VolumePhase = "ERROR"
	VolumePhaseResizing VolumePhase = "RESIZING"
)

// ProvisioningType defines how volume space is allocated.
type ProvisioningType string

const (
	ProvisioningThin       ProvisioningType = "THIN"
	ProvisioningThickLazy  ProvisioningType = "THICK_LAZY"
	ProvisioningThickEager ProvisioningType = "THICK_EAGER"
)

// AccessMode defines how a volume can be accessed.
type AccessMode string

const (
	AccessModeReadWriteOnce AccessMode = "READ_WRITE_ONCE"
	AccessModeReadOnlyMany  AccessMode = "READ_ONLY_MANY"
	AccessModeReadWriteMany AccessMode = "READ_WRITE_MANY"
)

// Volume represents a virtual disk that can be attached to VMs.
type Volume struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	ProjectID string            `json:"project_id"`
	PoolID    string            `json:"pool_id"`
	Labels    map[string]string `json:"labels"`

	Spec   VolumeSpec   `json:"spec"`
	Status VolumeStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VolumeSpec defines the desired configuration of a volume.
type VolumeSpec struct {
	SizeBytes    uint64           `json:"size_bytes"`
	Provisioning ProvisioningType `json:"provisioning"`
	Source       VolumeSource     `json:"source"`
	QoS          VolumeQoS        `json:"qos"`
	Encryption   EncryptionConfig `json:"encryption"`
	AccessMode   AccessMode       `json:"access_mode"`
}

// VolumeSource defines the source for volume creation.
type VolumeSource struct {
	Type       string `json:"type"` // "empty", "clone", "snapshot", "image"
	VolumeID   string `json:"volume_id,omitempty"`
	SnapshotID string `json:"snapshot_id,omitempty"`
	ImageID    string `json:"image_id,omitempty"`
	Filesystem string `json:"filesystem,omitempty"`
}

// VolumeQoS defines quality of service settings for a volume.
type VolumeQoS struct {
	MaxIOPS              uint64 `json:"max_iops"`
	MinIOPS              uint64 `json:"min_iops"`
	MaxThroughput        uint64 `json:"max_throughput"`
	MinThroughput        uint64 `json:"min_throughput"`
	BurstIOPS            uint64 `json:"burst_iops"`
	BurstThroughput      uint64 `json:"burst_throughput"`
	BurstDurationSec     uint32 `json:"burst_duration_sec"`
}

// VolumeStatus represents the current runtime status of a volume.
type VolumeStatus struct {
	Phase           VolumePhase `json:"phase"`
	AttachedVMID    string      `json:"attached_vm_id"`
	DevicePath      string      `json:"device_path"`
	ActualSizeBytes uint64      `json:"actual_size_bytes"`
	Usage           VolumeUsage `json:"usage"`
	SnapshotCount   uint32      `json:"snapshot_count"`
	ErrorMessage    string      `json:"error_message"`
	BackendID       string      `json:"backend_id"`
}

// VolumeUsage holds usage statistics for a volume.
type VolumeUsage struct {
	UsedBytes        uint64 `json:"used_bytes"`
	ReadIOPS         uint64 `json:"read_iops"`
	WriteIOPS        uint64 `json:"write_iops"`
	ReadBytesPerSec  uint64 `json:"read_bytes_per_sec"`
	WriteBytesPerSec uint64 `json:"write_bytes_per_sec"`
	ReadLatencyUs    uint64 `json:"read_latency_us"`
	WriteLatencyUs   uint64 `json:"write_latency_us"`
}

// IsAttached returns true if the volume is attached to a VM.
func (v *Volume) IsAttached() bool {
	return v.Status.AttachedVMID != ""
}

// IsReady returns true if the volume is ready to use.
func (v *Volume) IsReady() bool {
	return v.Status.Phase == VolumePhaseReady
}

// =============================================================================
// VOLUME SNAPSHOT
// =============================================================================

// SnapshotPhase represents the lifecycle phase of a snapshot.
type SnapshotPhase string

const (
	SnapshotPhasePending  SnapshotPhase = "PENDING"
	SnapshotPhaseCreating SnapshotPhase = "CREATING"
	SnapshotPhaseReady    SnapshotPhase = "READY"
	SnapshotPhaseDeleting SnapshotPhase = "DELETING"
	SnapshotPhaseError    SnapshotPhase = "ERROR"
)

// VolumeSnapshot represents a point-in-time snapshot of a volume.
type VolumeSnapshot struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	VolumeID    string            `json:"volume_id"`
	Labels      map[string]string `json:"labels"`

	Spec   SnapshotSpec   `json:"spec"`
	Status SnapshotStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
}

// SnapshotSpec defines the snapshot specification.
type SnapshotSpec struct {
	RetainHours uint32     `json:"retain_hours"`
	ExpiresAt   *time.Time `json:"expires_at,omitempty"`
}

// SnapshotStatus represents the snapshot status.
type SnapshotStatus struct {
	Phase        SnapshotPhase `json:"phase"`
	SizeBytes    uint64        `json:"size_bytes"`
	ReadyToUse   bool          `json:"ready_to_use"`
	ErrorMessage string        `json:"error_message"`
}

// =============================================================================
// IMAGE - OS Templates
// =============================================================================

// ImagePhase represents the lifecycle phase of an image.
type ImagePhase string

const (
	ImagePhasePending     ImagePhase = "PENDING"
	ImagePhaseDownloading ImagePhase = "DOWNLOADING"
	ImagePhaseConverting  ImagePhase = "CONVERTING"
	ImagePhaseReady       ImagePhase = "READY"
	ImagePhaseError       ImagePhase = "ERROR"
	ImagePhaseDeleting    ImagePhase = "DELETING"
)

// ImageFormat represents the image file format.
type ImageFormat string

const (
	ImageFormatRaw   ImageFormat = "RAW"
	ImageFormatQCOW2 ImageFormat = "QCOW2"
	ImageFormatVMDK  ImageFormat = "VMDK"
	ImageFormatVHD   ImageFormat = "VHD"
	ImageFormatISO   ImageFormat = "ISO"
)

// ImageVisibility represents who can access the image.
type ImageVisibility string

const (
	ImageVisibilityPrivate ImageVisibility = "PRIVATE"
	ImageVisibilityProject ImageVisibility = "PROJECT"
	ImageVisibilityPublic  ImageVisibility = "PUBLIC"
)

// OSFamily represents the operating system family.
type OSFamily string

const (
	OSFamilyLinux   OSFamily = "LINUX"
	OSFamilyWindows OSFamily = "WINDOWS"
	OSFamilyBSD     OSFamily = "BSD"
	OSFamilyOther   OSFamily = "OTHER"
)

// Image represents a bootable OS image/template.
type Image struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ProjectID   string            `json:"project_id"`
	Labels      map[string]string `json:"labels"`

	Spec   ImageSpec   `json:"spec"`
	Status ImageStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ImageSpec defines the image specification.
type ImageSpec struct {
	Format       ImageFormat      `json:"format"`
	Visibility   ImageVisibility  `json:"visibility"`
	OS           OSInfo           `json:"os"`
	Requirements ImageRequirements `json:"requirements"`
}

// OSInfo holds operating system information.
type OSInfo struct {
	Family       OSFamily `json:"family"`
	Distribution string   `json:"distribution"`
	Version      string   `json:"version"`
	Architecture string   `json:"architecture"`
	DefaultUser  string   `json:"default_user"`
}

// ImageRequirements defines minimum requirements for running the image.
type ImageRequirements struct {
	MinCPU              uint32   `json:"min_cpu"`
	MinMemoryMiB        uint64   `json:"min_memory_mib"`
	MinDiskGiB          uint64   `json:"min_disk_gib"`
	SupportedFirmware   []string `json:"supported_firmware"`
	RequiresSecureBoot  bool     `json:"requires_secure_boot"`
	RequiresTPM         bool     `json:"requires_tpm"`
}

// ImageStatus represents the image status.
type ImageStatus struct {
	Phase            ImagePhase `json:"phase"`
	SizeBytes        uint64     `json:"size_bytes"`
	VirtualSizeBytes uint64     `json:"virtual_size_bytes"`
	ProgressPercent  uint32     `json:"progress_percent"`
	Checksum         string     `json:"checksum"`
	ErrorMessage     string     `json:"error_message"`
	StoragePoolID    string     `json:"storage_pool_id"`
}

// IsReady returns true if the image is ready to use.
func (i *Image) IsReady() bool {
	return i.Status.Phase == ImagePhaseReady
}
