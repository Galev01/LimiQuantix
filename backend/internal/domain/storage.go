// Package domain contains core business entities for the limiquantix platform.
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
	BackendTypeCephRBD  BackendType = "CEPH_RBD"
	BackendTypeCephFS   BackendType = "CEPH_CEPHFS"
	BackendTypeLocalLVM BackendType = "LOCAL_LVM"
	BackendTypeLocalDir BackendType = "LOCAL_DIR"
	BackendTypeNFS      BackendType = "NFS"
	BackendTypeISCSI    BackendType = "ISCSI"
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
	Backend     *StorageBackend   `json:"backend,omitempty"`
	Defaults    VolumeDefaults    `json:"defaults"`
	QoS         StorageQoS        `json:"qos"`
	Encryption  EncryptionConfig  `json:"encryption"`
	Replication ReplicationConfig `json:"replication"`

	// AssignedNodeIDs lists the nodes that have access to this storage pool.
	// For shared storage (NFS, Ceph), multiple nodes can be assigned.
	// For local storage (LocalDir, LVM), typically only one node is assigned.
	AssignedNodeIDs []string `json:"assigned_node_ids,omitempty"`
}

// StorageBackend defines the storage backend configuration.
type StorageBackend struct {
	Type           BackendType  `json:"type"`
	CephConfig     *CephConfig  `json:"ceph_config,omitempty"`
	LocalLVMConfig *LVMConfig   `json:"local_lvm_config,omitempty"`
	LocalDirConfig *DirConfig   `json:"local_dir_config,omitempty"`
	NFSConfig      *NFSConfig   `json:"nfs_config,omitempty"`
	ISCSIConfig    *ISCSIConfig `json:"iscsi_config,omitempty"`
}

// StorageBackendType constants for type checking.
const (
	StorageBackendTypeCephRBD  = BackendTypeCephRBD
	StorageBackendTypeNFS      = BackendTypeNFS
	StorageBackendTypeLocalDir = BackendTypeLocalDir
	StorageBackendTypeISCSI    = BackendTypeISCSI
	StorageBackendTypeLocalLVM = BackendTypeLocalLVM
)

// CephConfig holds Ceph-specific configuration.
type CephConfig struct {
	ClusterID   string   `json:"cluster_id"`
	PoolName    string   `json:"pool_name"`
	Monitors    []string `json:"monitors"`
	User        string   `json:"user"`
	KeyringPath string   `json:"keyring_path"`
	Namespace   string   `json:"namespace"`
	SecretUUID  string   `json:"secret_uuid"` // Libvirt secret UUID
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
	MountPoint string `json:"mount_point"` // Custom mount point (optional)
}

// ISCSIConfig holds iSCSI-specific configuration.
type ISCSIConfig struct {
	Portal       string `json:"portal"`
	Target       string `json:"target"`
	CHAPEnabled  bool   `json:"chap_enabled"`
	CHAPUser     string `json:"chap_user"`
	CHAPPassword string `json:"chap_password"`
	LUN          uint32 `json:"lun"`
	VolumeGroup  string `json:"volume_group"`
}

// VolumeDefaults defines default settings for volumes created in this pool.
type VolumeDefaults struct {
	Provisioning string `json:"provisioning"` // "thin" or "thick"
	Filesystem   string `json:"filesystem"`   // "ext4", "xfs", "raw"
	BlockSize    uint32 `json:"block_size"`
}

// StorageQoS defines quality of service settings for a storage pool.
type StorageQoS struct {
	MaxIOPS              uint64 `json:"max_iops"`
	MaxThroughputBytes   uint64 `json:"max_throughput_bytes"`
	BurstIOPS            uint64 `json:"burst_iops"`
	BurstThroughputBytes uint64 `json:"burst_throughput_bytes"`
	BurstDurationSec     uint32 `json:"burst_duration_sec"`
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

// IsAssignedToNode returns true if the storage pool is assigned to the given node.
func (p *StoragePool) IsAssignedToNode(nodeID string) bool {
	for _, id := range p.Spec.AssignedNodeIDs {
		if id == nodeID {
			return true
		}
	}
	return false
}

// AssignToNode adds a node to the assigned nodes list if not already present.
func (p *StoragePool) AssignToNode(nodeID string) bool {
	if p.IsAssignedToNode(nodeID) {
		return false // Already assigned
	}
	p.Spec.AssignedNodeIDs = append(p.Spec.AssignedNodeIDs, nodeID)
	return true
}

// UnassignFromNode removes a node from the assigned nodes list.
func (p *StoragePool) UnassignFromNode(nodeID string) bool {
	for i, id := range p.Spec.AssignedNodeIDs {
		if id == nodeID {
			p.Spec.AssignedNodeIDs = append(p.Spec.AssignedNodeIDs[:i], p.Spec.AssignedNodeIDs[i+1:]...)
			return true
		}
	}
	return false // Not assigned
}

// GetAssignedNodeIDs returns the list of assigned node IDs.
func (p *StoragePool) GetAssignedNodeIDs() []string {
	if p.Spec.AssignedNodeIDs == nil {
		return []string{}
	}
	return p.Spec.AssignedNodeIDs
}

// IsSharedStorage returns true if the storage backend is shared (NFS, Ceph).
func (p *StoragePool) IsSharedStorage() bool {
	if p.Spec.Backend == nil {
		return false
	}
	switch p.Spec.Backend.Type {
	case BackendTypeNFS, BackendTypeCephRBD, BackendTypeCephFS:
		return true
	default:
		return false
	}
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
	MaxIOPS          uint64 `json:"max_iops"`
	MinIOPS          uint64 `json:"min_iops"`
	MaxThroughput    uint64 `json:"max_throughput"`
	MinThroughput    uint64 `json:"min_throughput"`
	BurstIOPS        uint64 `json:"burst_iops"`
	BurstThroughput  uint64 `json:"burst_throughput"`
	BurstDurationSec uint32 `json:"burst_duration_sec"`
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
	ImagePhaseExtracting  ImagePhase = "EXTRACTING" // OVA extraction in progress
	ImagePhaseParsing     ImagePhase = "PARSING"    // OVF parsing in progress
)

// ImageFormat represents the image file format.
type ImageFormat string

const (
	ImageFormatRaw   ImageFormat = "RAW"
	ImageFormatQCOW2 ImageFormat = "QCOW2"
	ImageFormatVMDK  ImageFormat = "VMDK"
	ImageFormatVHD   ImageFormat = "VHD"
	ImageFormatISO   ImageFormat = "ISO"
	ImageFormatOVA   ImageFormat = "OVA" // Open Virtual Appliance (contains OVF + VMDK)
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
	OSFamilyUnknown OSFamily = "UNKNOWN"
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
	Format       ImageFormat       `json:"format"`
	Visibility   ImageVisibility   `json:"visibility"`
	OS           OSInfo            `json:"os"`
	Requirements ImageRequirements `json:"requirements"`
	OvaMetadata  *OvaMetadata      `json:"ova_metadata,omitempty"` // Only set when Format = OVA
}

// OSInfo holds operating system information.
type OSInfo struct {
	Family             OSFamily           `json:"family"`
	Distribution       string             `json:"distribution"`
	Version            string             `json:"version"`
	Architecture       string             `json:"architecture"`
	DefaultUser        string             `json:"default_user"`
	CloudInitEnabled   bool               `json:"cloud_init_enabled"`
	ProvisioningMethod ProvisioningMethod `json:"provisioning_method"`
}

// ProvisioningMethod defines how the image supports automated provisioning.
type ProvisioningMethod string

const (
	ProvisioningMethodUnknown   ProvisioningMethod = "UNKNOWN"
	ProvisioningMethodCloudInit ProvisioningMethod = "CLOUD_INIT"
	ProvisioningMethodIgnition  ProvisioningMethod = "IGNITION"
	ProvisioningMethodSysprep   ProvisioningMethod = "SYSPREP"
	ProvisioningMethodKickstart ProvisioningMethod = "KICKSTART"
	ProvisioningMethodPreseed   ProvisioningMethod = "PRESEED"
	ProvisioningMethodNone      ProvisioningMethod = "NONE"
)

// ImageRequirements defines minimum requirements for running the image.
type ImageRequirements struct {
	MinCPU             uint32   `json:"min_cpu"`
	MinMemoryMiB       uint64   `json:"min_memory_mib"`
	MinDiskGiB         uint64   `json:"min_disk_gib"`
	SupportedFirmware  []string `json:"supported_firmware"`
	RequiresSecureBoot bool     `json:"requires_secure_boot"`
	RequiresTPM        bool     `json:"requires_tpm"`
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
	// Path is the local file path on the node (for local images)
	Path string `json:"path,omitempty"`
	// NodeID is the node that hosts this image (for local images)
	NodeID string `json:"node_id,omitempty"`
}

// IsReady returns true if the image is ready to use.
func (i *Image) IsReady() bool {
	return i.Status.Phase == ImagePhaseReady
}

// IsOVATemplate returns true if the image is an OVA template.
func (i *Image) IsOVATemplate() bool {
	return i.Spec.Format == ImageFormatOVA
}

// =============================================================================
// OVA METADATA - Extracted from OVF descriptor
// =============================================================================

// OvaMetadata contains hardware and configuration information extracted from
// the OVF descriptor within an OVA file.
type OvaMetadata struct {
	VMName      string            `json:"vm_name"`
	Description string            `json:"description"`
	OsInfo      OvaOsInfo         `json:"os_info"`
	Hardware    OvaHardwareConfig `json:"hardware"`
	Disks       []OvaDiskInfo     `json:"disks"`
	Networks    []OvaNetworkInfo  `json:"networks"`
	Product     OvaProductInfo    `json:"product"`
	OvfContent  string            `json:"ovf_content,omitempty"`
}

// OvaOsInfo contains OS information extracted from OperatingSystemSection.
type OvaOsInfo struct {
	OsID          uint32   `json:"os_id"`
	OsDescription string   `json:"os_description"`
	OsFamily      OSFamily `json:"os_family"`
}

// OvaHardwareConfig contains the recommended hardware configuration.
type OvaHardwareConfig struct {
	CPUCount  uint32 `json:"cpu_count"`
	MemoryMiB uint64 `json:"memory_mib"`
	Firmware  string `json:"firmware"`
}

// OvaDiskInfo contains information about a virtual disk in the OVA.
type OvaDiskInfo struct {
	DiskID             string `json:"disk_id"`
	FileRef            string `json:"file_ref"`
	CapacityBytes      uint64 `json:"capacity_bytes"`
	PopulatedSizeBytes uint64 `json:"populated_size_bytes"`
	Format             string `json:"format"`
	ControllerType     string `json:"controller_type"`
	AddressOnParent    uint32 `json:"address_on_parent"`
	ConvertedPath      string `json:"converted_path,omitempty"`
}

// OvaNetworkInfo contains information about a network adapter in the OVA.
type OvaNetworkInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	AdapterType string `json:"adapter_type"`
	InstanceID  uint32 `json:"instance_id"`
}

// OvaProductInfo contains product/vendor information from OVF ProductSection.
type OvaProductInfo struct {
	Product     string `json:"product"`
	Vendor      string `json:"vendor"`
	Version     string `json:"version"`
	FullVersion string `json:"full_version"`
	ProductURL  string `json:"product_url"`
	VendorURL   string `json:"vendor_url"`
}

// =============================================================================
// OVA UPLOAD JOB
// =============================================================================

// OvaUploadStatus represents the status of an OVA upload/processing job.
type OvaUploadStatus string

const (
	OvaUploadStatusUnknown    OvaUploadStatus = "UNKNOWN"
	OvaUploadStatusUploading  OvaUploadStatus = "UPLOADING"
	OvaUploadStatusExtracting OvaUploadStatus = "EXTRACTING"
	OvaUploadStatusParsing    OvaUploadStatus = "PARSING"
	OvaUploadStatusConverting OvaUploadStatus = "CONVERTING"
	OvaUploadStatusCompleted  OvaUploadStatus = "COMPLETED"
	OvaUploadStatusFailed     OvaUploadStatus = "FAILED"
)

// OvaUploadJob represents an OVA upload and processing job.
type OvaUploadJob struct {
	JobID           string          `json:"job_id"`
	ImageID         string          `json:"image_id,omitempty"`
	Status          OvaUploadStatus `json:"status"`
	ProgressPercent uint32          `json:"progress_percent"`
	CurrentStep     string          `json:"current_step"`
	BytesUploaded   uint64          `json:"bytes_uploaded"`
	BytesTotal      uint64          `json:"bytes_total"`
	ErrorMessage    string          `json:"error_message,omitempty"`
	Metadata        *OvaMetadata    `json:"metadata,omitempty"`
	TempFilePath    string          `json:"temp_file_path,omitempty"`
	CreatedAt       time.Time       `json:"created_at"`
	UpdatedAt       time.Time       `json:"updated_at"`
}
