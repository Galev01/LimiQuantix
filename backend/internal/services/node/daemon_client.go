// Package node provides services for managing hypervisor nodes.
// This file contains the Node Daemon gRPC client.
package node

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	nodev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/node/v1"
)

// DaemonClient provides methods to communicate with a Node Daemon.
type DaemonClient struct {
	conn   *grpc.ClientConn
	client nodev1.NodeDaemonServiceClient
	addr   string
	logger *zap.Logger
}

// NewDaemonClient creates a new gRPC client for the Node Daemon.
//
// Example:
//
//	client, err := node.NewDaemonClient("192.168.1.10:9090", logger)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	defer client.Close()
//
//	info, err := client.GetNodeInfo(ctx)
func NewDaemonClient(addr string, logger *zap.Logger) (*DaemonClient, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := grpc.DialContext(ctx, addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to node daemon at %s: %w", addr, err)
	}

	logger.Info("Connected to node daemon", zap.String("addr", addr))

	return &DaemonClient{
		conn:   conn,
		client: nodev1.NewNodeDaemonServiceClient(conn),
		addr:   addr,
		logger: logger,
	}, nil
}

// Addr returns the address of the node daemon.
func (c *DaemonClient) Addr() string {
	return c.addr
}

// Close closes the gRPC connection.
func (c *DaemonClient) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// HealthCheck performs a health check on the node daemon.
func (c *DaemonClient) HealthCheck(ctx context.Context) (*nodev1.HealthCheckResponse, error) {
	resp, err := c.client.HealthCheck(ctx, &nodev1.HealthCheckRequest{})
	if err != nil {
		c.logger.Error("Health check failed", zap.String("addr", c.addr), zap.Error(err))
		return nil, err
	}
	return resp, nil
}

// GetNodeInfo retrieves node information and capabilities.
func (c *DaemonClient) GetNodeInfo(ctx context.Context) (*nodev1.NodeInfoResponse, error) {
	resp, err := c.client.GetNodeInfo(ctx, nil)
	if err != nil {
		c.logger.Error("Get node info failed", zap.String("addr", c.addr), zap.Error(err))
		return nil, err
	}
	return resp, nil
}

// CreateVM creates a new VM on the node.
func (c *DaemonClient) CreateVM(ctx context.Context, req *nodev1.CreateVMOnNodeRequest) (*nodev1.CreateVMOnNodeResponse, error) {
	c.logger.Info("Creating VM on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", req.VmId),
		zap.String("name", req.Name),
	)

	resp, err := c.client.CreateVM(ctx, req)
	if err != nil {
		c.logger.Error("Create VM failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", req.VmId),
			zap.Error(err),
		)
		return nil, err
	}

	c.logger.Info("VM created on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", resp.VmId),
	)

	return resp, nil
}

// StartVM starts a VM on the node.
func (c *DaemonClient) StartVM(ctx context.Context, vmID string) error {
	c.logger.Info("Starting VM on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	_, err := c.client.StartVM(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		c.logger.Error("Start VM failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("VM started on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	return nil
}

// StopVM stops a VM gracefully with a timeout.
func (c *DaemonClient) StopVM(ctx context.Context, vmID string, timeoutSeconds uint32) error {
	c.logger.Info("Stopping VM on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
		zap.Uint32("timeout_seconds", timeoutSeconds),
	)

	_, err := c.client.StopVM(ctx, &nodev1.StopVMRequest{
		VmId:           vmID,
		TimeoutSeconds: timeoutSeconds,
	})
	if err != nil {
		c.logger.Error("Stop VM failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("VM stopped on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	return nil
}

// ForceStopVM forces a VM to stop immediately (power off).
func (c *DaemonClient) ForceStopVM(ctx context.Context, vmID string) error {
	c.logger.Info("Force stopping VM on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	_, err := c.client.ForceStopVM(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		c.logger.Error("Force stop VM failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("VM force stopped on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	return nil
}

// RebootVM reboots a VM.
func (c *DaemonClient) RebootVM(ctx context.Context, vmID string) error {
	c.logger.Info("Rebooting VM on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	_, err := c.client.RebootVM(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		c.logger.Error("Reboot VM failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("VM rebooted on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	return nil
}

// PauseVM pauses a VM (freezes execution).
func (c *DaemonClient) PauseVM(ctx context.Context, vmID string) error {
	_, err := c.client.PauseVM(ctx, &nodev1.VMIdRequest{VmId: vmID})
	return err
}

// ResumeVM resumes a paused VM.
func (c *DaemonClient) ResumeVM(ctx context.Context, vmID string) error {
	_, err := c.client.ResumeVM(ctx, &nodev1.VMIdRequest{VmId: vmID})
	return err
}

// DeleteVM deletes a VM from the node.
func (c *DaemonClient) DeleteVM(ctx context.Context, vmID string) error {
	c.logger.Info("Deleting VM from node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	_, err := c.client.DeleteVM(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		c.logger.Error("Delete VM failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("VM deleted from node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
	)

	return nil
}

// GetVMStatus gets the status of a VM.
func (c *DaemonClient) GetVMStatus(ctx context.Context, vmID string) (*nodev1.VMStatusResponse, error) {
	resp, err := c.client.GetVMStatus(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ListVMs lists all VMs on the node.
func (c *DaemonClient) ListVMs(ctx context.Context) (*nodev1.ListVMsOnNodeResponse, error) {
	resp, err := c.client.ListVMs(ctx, nil)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// GetConsole gets console connection information for a VM.
func (c *DaemonClient) GetConsole(ctx context.Context, vmID string) (*nodev1.ConsoleInfoResponse, error) {
	resp, err := c.client.GetConsole(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// CreateSnapshot creates a snapshot of a VM.
func (c *DaemonClient) CreateSnapshot(ctx context.Context, vmID, name, description string, quiesce bool) (*nodev1.SnapshotResponse, error) {
	c.logger.Info("Creating snapshot on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
		zap.String("name", name),
	)

	resp, err := c.client.CreateSnapshot(ctx, &nodev1.CreateSnapshotRequest{
		VmId:        vmID,
		Name:        name,
		Description: description,
		Quiesce:     quiesce,
	})
	if err != nil {
		c.logger.Error("Create snapshot failed",
			zap.String("addr", c.addr),
			zap.String("vm_id", vmID),
			zap.Error(err),
		)
		return nil, err
	}

	c.logger.Info("Snapshot created on node",
		zap.String("addr", c.addr),
		zap.String("vm_id", vmID),
		zap.String("snapshot_id", resp.SnapshotId),
	)

	return resp, nil
}

// RevertSnapshot reverts a VM to a snapshot.
func (c *DaemonClient) RevertSnapshot(ctx context.Context, vmID, snapshotID string) error {
	_, err := c.client.RevertSnapshot(ctx, &nodev1.RevertSnapshotRequest{
		VmId:       vmID,
		SnapshotId: snapshotID,
	})
	return err
}

// DeleteSnapshot deletes a snapshot.
func (c *DaemonClient) DeleteSnapshot(ctx context.Context, vmID, snapshotID string) error {
	_, err := c.client.DeleteSnapshot(ctx, &nodev1.DeleteSnapshotRequest{
		VmId:       vmID,
		SnapshotId: snapshotID,
	})
	return err
}

// ListSnapshots lists all snapshots for a VM.
func (c *DaemonClient) ListSnapshots(ctx context.Context, vmID string) (*nodev1.ListSnapshotsResponse, error) {
	resp, err := c.client.ListSnapshots(ctx, &nodev1.VMIdRequest{VmId: vmID})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// AttachDisk attaches a disk to a running VM.
func (c *DaemonClient) AttachDisk(ctx context.Context, vmID string, disk *nodev1.DiskSpec) error {
	_, err := c.client.AttachDisk(ctx, &nodev1.AttachDiskRequest{
		VmId: vmID,
		Disk: disk,
	})
	return err
}

// DetachDisk detaches a disk from a running VM.
func (c *DaemonClient) DetachDisk(ctx context.Context, vmID, diskID string) error {
	_, err := c.client.DetachDisk(ctx, &nodev1.DetachDiskRequest{
		VmId:   vmID,
		DiskId: diskID,
	})
	return err
}

// AttachNIC attaches a network interface to a running VM.
func (c *DaemonClient) AttachNIC(ctx context.Context, vmID string, nic *nodev1.NicSpec) error {
	_, err := c.client.AttachNIC(ctx, &nodev1.AttachNICRequest{
		VmId: vmID,
		Nic:  nic,
	})
	return err
}

// DetachNIC detaches a network interface from a running VM.
func (c *DaemonClient) DetachNIC(ctx context.Context, vmID, nicID string) error {
	_, err := c.client.DetachNIC(ctx, &nodev1.DetachNICRequest{
		VmId:  vmID,
		NicId: nicID,
	})
	return err
}

// GuestAgentInfo contains information from the guest agent.
type GuestAgentInfo struct {
	Version       string
	UptimeSeconds uint64
	Connected     bool
}

// PingGuestAgent pings the guest agent in a VM.
// TODO: Implement via virtio-serial channel when node daemon supports it.
func (c *DaemonClient) PingGuestAgent(ctx context.Context, vmID string) (*GuestAgentInfo, error) {
	c.logger.Debug("PingGuestAgent called",
		zap.String("vm_id", vmID),
	)

	// TODO: The node daemon needs to implement guest agent communication
	// via virtio-serial. For now, return an error indicating not supported.
	return nil, fmt.Errorf("guest agent communication not yet implemented in node daemon")
}

// MigrateVM migrates a VM to another node.
func (c *DaemonClient) MigrateVM(ctx context.Context, vmID, targetNodeURI string, live, storage bool) (<-chan *nodev1.MigrationProgress, error) {
	stream, err := c.client.MigrateVM(ctx, &nodev1.MigrateVMRequest{
		VmId:          vmID,
		TargetNodeUri: targetNodeURI,
		Live:          live,
		Storage:       storage,
	})
	if err != nil {
		return nil, err
	}

	progressChan := make(chan *nodev1.MigrationProgress, 10)

	go func() {
		defer close(progressChan)
		for {
			progress, err := stream.Recv()
			if err != nil {
				c.logger.Error("Migration stream error",
					zap.String("vm_id", vmID),
					zap.Error(err),
				)
				return
			}
			progressChan <- progress
		}
	}()

	return progressChan, nil
}

// StreamMetrics streams node and VM metrics.
func (c *DaemonClient) StreamMetrics(ctx context.Context, intervalSeconds uint32) (<-chan *nodev1.NodeMetrics, error) {
	stream, err := c.client.StreamMetrics(ctx, &nodev1.StreamMetricsRequest{
		IntervalSeconds: intervalSeconds,
	})
	if err != nil {
		return nil, err
	}

	metricsChan := make(chan *nodev1.NodeMetrics, 10)

	go func() {
		defer close(metricsChan)
		for {
			metrics, err := stream.Recv()
			if err != nil {
				return
			}
			select {
			case metricsChan <- metrics:
			case <-ctx.Done():
				return
			}
		}
	}()

	return metricsChan, nil
}

// StreamEvents streams node events.
func (c *DaemonClient) StreamEvents(ctx context.Context) (<-chan *nodev1.NodeEvent, error) {
	stream, err := c.client.StreamEvents(ctx, nil)
	if err != nil {
		return nil, err
	}

	eventsChan := make(chan *nodev1.NodeEvent, 100)

	go func() {
		defer close(eventsChan)
		for {
			event, err := stream.Recv()
			if err != nil {
				return
			}
			select {
			case eventsChan <- event:
			case <-ctx.Done():
				return
			}
		}
	}()

	return eventsChan, nil
}

// =============================================================================
// Storage Pool Operations
// =============================================================================

// InitStoragePool initializes a storage pool on the node.
func (c *DaemonClient) InitStoragePool(ctx context.Context, req *nodev1.InitStoragePoolRequest) (*nodev1.StoragePoolInfoResponse, error) {
	c.logger.Info("Initializing storage pool on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", req.PoolId),
		zap.String("type", req.Type.String()),
	)

	resp, err := c.client.InitStoragePool(ctx, req)
	if err != nil {
		c.logger.Error("Init storage pool failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", req.PoolId),
			zap.Error(err),
		)
		return nil, err
	}

	c.logger.Info("Storage pool initialized on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", resp.PoolId),
		zap.Uint64("total_bytes", resp.TotalBytes),
	)

	return resp, nil
}

// DestroyStoragePool destroys a storage pool on the node.
func (c *DaemonClient) DestroyStoragePool(ctx context.Context, poolID string) error {
	c.logger.Info("Destroying storage pool on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
	)

	_, err := c.client.DestroyStoragePool(ctx, &nodev1.StoragePoolIdRequest{PoolId: poolID})
	if err != nil {
		c.logger.Error("Destroy storage pool failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", poolID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("Storage pool destroyed on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
	)

	return nil
}

// GetStoragePoolInfo gets storage pool information from the node.
func (c *DaemonClient) GetStoragePoolInfo(ctx context.Context, poolID string) (*nodev1.StoragePoolInfoResponse, error) {
	resp, err := c.client.GetStoragePoolInfo(ctx, &nodev1.StoragePoolIdRequest{PoolId: poolID})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ListStoragePools lists all storage pools on the node.
func (c *DaemonClient) ListStoragePools(ctx context.Context) (*nodev1.ListStoragePoolsResponse, error) {
	resp, err := c.client.ListStoragePools(ctx, nil)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ListStoragePoolFiles lists files in a storage pool on the node.
func (c *DaemonClient) ListStoragePoolFiles(ctx context.Context, poolID, path string) (*nodev1.ListStoragePoolFilesResponse, error) {
	c.logger.Info("Listing storage pool files on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("path", path),
	)

	resp, err := c.client.ListStoragePoolFiles(ctx, &nodev1.ListStoragePoolFilesRequest{
		PoolId: poolID,
		Path:   path,
	})
	if err != nil {
		c.logger.Error("List storage pool files failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", poolID),
			zap.Error(err),
		)
		return nil, err
	}
	return resp, nil
}

// =============================================================================
// Storage Volume Operations
// =============================================================================

// CreateVolume creates a volume in a storage pool on the node.
func (c *DaemonClient) CreateVolume(ctx context.Context, req *nodev1.CreateVolumeRequest) error {
	c.logger.Info("Creating volume on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", req.PoolId),
		zap.String("volume_id", req.VolumeId),
		zap.Uint64("size_bytes", req.SizeBytes),
	)

	_, err := c.client.CreateVolume(ctx, req)
	if err != nil {
		c.logger.Error("Create volume failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", req.PoolId),
			zap.String("volume_id", req.VolumeId),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("Volume created on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", req.PoolId),
		zap.String("volume_id", req.VolumeId),
	)

	return nil
}

// DeleteVolume deletes a volume from a storage pool on the node.
func (c *DaemonClient) DeleteVolume(ctx context.Context, poolID, volumeID string) error {
	c.logger.Info("Deleting volume on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("volume_id", volumeID),
	)

	_, err := c.client.DeleteVolume(ctx, &nodev1.VolumeIdRequest{
		PoolId:   poolID,
		VolumeId: volumeID,
	})
	if err != nil {
		c.logger.Error("Delete volume failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", poolID),
			zap.String("volume_id", volumeID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("Volume deleted on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("volume_id", volumeID),
	)

	return nil
}

// ResizeVolume resizes a volume on the node.
func (c *DaemonClient) ResizeVolume(ctx context.Context, poolID, volumeID string, newSizeBytes uint64) error {
	c.logger.Info("Resizing volume on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("volume_id", volumeID),
		zap.Uint64("new_size_bytes", newSizeBytes),
	)

	_, err := c.client.ResizeVolume(ctx, &nodev1.ResizeVolumeRequest{
		PoolId:       poolID,
		VolumeId:     volumeID,
		NewSizeBytes: newSizeBytes,
	})
	if err != nil {
		c.logger.Error("Resize volume failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", poolID),
			zap.String("volume_id", volumeID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("Volume resized on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("volume_id", volumeID),
	)

	return nil
}

// CloneVolume clones a volume on the node.
func (c *DaemonClient) CloneVolume(ctx context.Context, poolID, sourceVolumeID, destVolumeID string) error {
	c.logger.Info("Cloning volume on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("source_volume_id", sourceVolumeID),
		zap.String("dest_volume_id", destVolumeID),
	)

	_, err := c.client.CloneVolume(ctx, &nodev1.CloneVolumeRequest{
		PoolId:         poolID,
		SourceVolumeId: sourceVolumeID,
		DestVolumeId:   destVolumeID,
	})
	if err != nil {
		c.logger.Error("Clone volume failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", poolID),
			zap.String("source_volume_id", sourceVolumeID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("Volume cloned on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("dest_volume_id", destVolumeID),
	)

	return nil
}

// GetVolumeAttachInfo gets volume attach information (libvirt disk XML).
func (c *DaemonClient) GetVolumeAttachInfo(ctx context.Context, poolID, volumeID string) (*nodev1.VolumeAttachInfoResponse, error) {
	resp, err := c.client.GetVolumeAttachInfo(ctx, &nodev1.VolumeIdRequest{
		PoolId:   poolID,
		VolumeId: volumeID,
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// CreateVolumeSnapshot creates a snapshot of a volume on the node.
func (c *DaemonClient) CreateVolumeSnapshot(ctx context.Context, poolID, volumeID, snapshotID string) error {
	c.logger.Info("Creating volume snapshot on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("volume_id", volumeID),
		zap.String("snapshot_id", snapshotID),
	)

	_, err := c.client.CreateVolumeSnapshot(ctx, &nodev1.CreateVolumeSnapshotRequest{
		PoolId:     poolID,
		VolumeId:   volumeID,
		SnapshotId: snapshotID,
	})
	if err != nil {
		c.logger.Error("Create volume snapshot failed",
			zap.String("addr", c.addr),
			zap.String("pool_id", poolID),
			zap.String("volume_id", volumeID),
			zap.Error(err),
		)
		return err
	}

	c.logger.Info("Volume snapshot created on node",
		zap.String("addr", c.addr),
		zap.String("pool_id", poolID),
		zap.String("volume_id", volumeID),
		zap.String("snapshot_id", snapshotID),
	)

	return nil
}

// ============================================================================
// File Transfer Operations (stub implementations - requires guest agent support)
// ============================================================================

// FileEntry represents a file or directory in the guest filesystem
type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	Mode    int    `json:"mode"`
	ModTime string `json:"modTime"`
}

// FileStat represents file metadata
type FileStat struct {
	Path    string `json:"path"`
	Exists  bool   `json:"exists"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	Mode    int    `json:"mode"`
	ModTime string `json:"modTime"`
}

// WriteFile writes content to a file in the guest VM via the guest agent.
// TODO: Implement when guest agent file transfer is available
func (c *DaemonClient) WriteFile(ctx context.Context, vmID, path string, content []byte, mode int) error {
	c.logger.Warn("WriteFile not implemented - guest agent file transfer not available",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)
	return fmt.Errorf("file transfer not implemented: guest agent support required")
}

// ReadFile reads content from a file in the guest VM via the guest agent.
// Returns: content, totalSize, error
// TODO: Implement when guest agent file transfer is available
func (c *DaemonClient) ReadFile(ctx context.Context, vmID, path string, offset, length int64) ([]byte, int64, error) {
	c.logger.Warn("ReadFile not implemented - guest agent file transfer not available",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)
	return nil, 0, fmt.Errorf("file transfer not implemented: guest agent support required")
}

// ListDirectory lists files and directories in the guest VM.
// TODO: Implement when guest agent file transfer is available
func (c *DaemonClient) ListDirectory(ctx context.Context, vmID, path string) ([]FileEntry, error) {
	c.logger.Warn("ListDirectory not implemented - guest agent file transfer not available",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)
	return nil, fmt.Errorf("file transfer not implemented: guest agent support required")
}

// StatFile returns metadata about a file in the guest VM.
// TODO: Implement when guest agent file transfer is available
func (c *DaemonClient) StatFile(ctx context.Context, vmID, path string) (*FileStat, error) {
	c.logger.Warn("StatFile not implemented - guest agent file transfer not available",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)
	return nil, fmt.Errorf("file transfer not implemented: guest agent support required")
}

// DeleteFile deletes a file in the guest VM.
// TODO: Implement when guest agent file transfer is available
func (c *DaemonClient) DeleteFile(ctx context.Context, vmID, path string) error {
	c.logger.Warn("DeleteFile not implemented - guest agent file transfer not available",
		zap.String("vm_id", vmID),
		zap.String("path", path),
	)
	return fmt.Errorf("file transfer not implemented: guest agent support required")
}
