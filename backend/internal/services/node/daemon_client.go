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
