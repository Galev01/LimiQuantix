// Package storage implements storage-related services.
package storage

import (
	"archive/tar"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	storagev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1"
)

// OVAService implements OVA template upload and processing.
type OVAService struct {
	imageRepo   ImageRepository
	jobs        map[string]*domain.OvaUploadJob
	jobsMu      sync.RWMutex
	uploadDir   string
	imagesDir   string
	logger      *zap.Logger
	maxFileSize int64 // Maximum OVA file size in bytes
}

// NewOVAService creates a new OVA service.
func NewOVAService(imageRepo ImageRepository, logger *zap.Logger) *OVAService {
	return &OVAService{
		imageRepo:   imageRepo,
		jobs:        make(map[string]*domain.OvaUploadJob),
		uploadDir:   "/var/lib/limiquantix/ova-uploads",
		imagesDir:   "/var/lib/limiquantix/ova-images",
		logger:      logger.Named("ova-service"),
		maxFileSize: 50 * 1024 * 1024 * 1024, // 50GB default
	}
}

// CreateUploadJob creates a new OVA upload job and returns the job ID.
func (s *OVAService) CreateUploadJob(filename string, totalSize int64) (*domain.OvaUploadJob, error) {
	if totalSize > s.maxFileSize {
		return nil, fmt.Errorf("file size %d exceeds maximum allowed size %d", totalSize, s.maxFileSize)
	}

	jobID := uuid.New().String()
	now := time.Now()

	job := &domain.OvaUploadJob{
		JobID:           jobID,
		Status:          domain.OvaUploadStatusUploading,
		ProgressPercent: 0,
		CurrentStep:     "Uploading file",
		BytesUploaded:   0,
		BytesTotal:      uint64(totalSize),
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	// Create temp file path
	if err := os.MkdirAll(s.uploadDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create upload directory: %w", err)
	}
	job.TempFilePath = filepath.Join(s.uploadDir, fmt.Sprintf("%s.ova", jobID))

	s.jobsMu.Lock()
	s.jobs[jobID] = job
	s.jobsMu.Unlock()

	s.logger.Info("Created OVA upload job",
		zap.String("job_id", jobID),
		zap.String("filename", filename),
		zap.Int64("total_size", totalSize),
	)

	return job, nil
}

// GetJob returns an OVA upload job by ID.
func (s *OVAService) GetJob(jobID string) (*domain.OvaUploadJob, error) {
	s.jobsMu.RLock()
	defer s.jobsMu.RUnlock()

	job, exists := s.jobs[jobID]
	if !exists {
		return nil, fmt.Errorf("job not found: %s", jobID)
	}
	return job, nil
}

// UpdateJobProgress updates the upload progress for a job.
func (s *OVAService) UpdateJobProgress(jobID string, bytesUploaded int64) error {
	s.jobsMu.Lock()
	defer s.jobsMu.Unlock()

	job, exists := s.jobs[jobID]
	if !exists {
		return fmt.Errorf("job not found: %s", jobID)
	}

	job.BytesUploaded = uint64(bytesUploaded)
	if job.BytesTotal > 0 {
		job.ProgressPercent = uint32((bytesUploaded * 100) / int64(job.BytesTotal))
	}
	job.UpdatedAt = time.Now()

	return nil
}

// ProcessOVA processes an uploaded OVA file (extract, parse OVF, convert VMDK).
func (s *OVAService) ProcessOVA(ctx context.Context, jobID string) error {
	s.jobsMu.Lock()
	job, exists := s.jobs[jobID]
	if !exists {
		s.jobsMu.Unlock()
		return fmt.Errorf("job not found: %s", jobID)
	}
	s.jobsMu.Unlock()

	logger := s.logger.With(zap.String("job_id", jobID))
	logger.Info("Starting OVA processing")

	// Step 1: Extract OVA
	s.updateJobStatus(jobID, domain.OvaUploadStatusExtracting, "Extracting OVA archive", 10)
	extractDir := filepath.Join(s.uploadDir, jobID+"-extracted")
	if err := s.extractOVA(job.TempFilePath, extractDir); err != nil {
		s.failJob(jobID, fmt.Sprintf("Failed to extract OVA: %v", err))
		return err
	}

	// Step 2: Parse OVF
	s.updateJobStatus(jobID, domain.OvaUploadStatusParsing, "Parsing OVF descriptor", 30)
	ovfPath, err := s.findOVFFile(extractDir)
	if err != nil {
		s.failJob(jobID, fmt.Sprintf("Failed to find OVF: %v", err))
		return err
	}

	metadata, err := s.parseOVF(ovfPath)
	if err != nil {
		s.failJob(jobID, fmt.Sprintf("Failed to parse OVF: %v", err))
		return err
	}

	s.jobsMu.Lock()
	job.Metadata = metadata
	s.jobsMu.Unlock()

	// Step 3: Convert VMDK to QCOW2
	s.updateJobStatus(jobID, domain.OvaUploadStatusConverting, "Converting disk images", 50)
	if err := s.convertDisks(ctx, extractDir, metadata); err != nil {
		s.failJob(jobID, fmt.Sprintf("Failed to convert disks: %v", err))
		return err
	}

	// Step 4: Create image record
	s.updateJobStatus(jobID, domain.OvaUploadStatusConverting, "Creating image record", 90)
	image, err := s.createImageRecord(ctx, job, metadata)
	if err != nil {
		s.failJob(jobID, fmt.Sprintf("Failed to create image: %v", err))
		return err
	}

	// Step 5: Cleanup temp files
	os.Remove(job.TempFilePath)
	os.RemoveAll(extractDir)

	// Mark as complete
	s.jobsMu.Lock()
	job.Status = domain.OvaUploadStatusCompleted
	job.ImageID = image.ID
	job.ProgressPercent = 100
	job.CurrentStep = "Complete"
	job.UpdatedAt = time.Now()
	s.jobsMu.Unlock()

	logger.Info("OVA processing complete",
		zap.String("image_id", image.ID),
		zap.String("image_name", image.Name),
	)

	return nil
}

// extractOVA extracts an OVA tar archive to the specified directory.
func (s *OVAService) extractOVA(ovaPath, destDir string) error {
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return fmt.Errorf("failed to create extraction directory: %w", err)
	}

	file, err := os.Open(ovaPath)
	if err != nil {
		return fmt.Errorf("failed to open OVA file: %w", err)
	}
	defer file.Close()

	tarReader := tar.NewReader(file)

	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read tar header: %w", err)
		}

		// Sanitize path to prevent directory traversal
		targetPath := filepath.Join(destDir, filepath.Clean(header.Name))
		if !strings.HasPrefix(targetPath, destDir) {
			return fmt.Errorf("invalid path in archive: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(targetPath, 0755); err != nil {
				return fmt.Errorf("failed to create directory: %w", err)
			}
		case tar.TypeReg:
			// Ensure parent directory exists
			if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
				return fmt.Errorf("failed to create parent directory: %w", err)
			}

			outFile, err := os.Create(targetPath)
			if err != nil {
				return fmt.Errorf("failed to create file: %w", err)
			}

			if _, err := io.Copy(outFile, tarReader); err != nil {
				outFile.Close()
				return fmt.Errorf("failed to extract file: %w", err)
			}
			outFile.Close()
		}
	}

	return nil
}

// findOVFFile finds the .ovf file in the extracted directory.
func (s *OVAService) findOVFFile(dir string) (string, error) {
	var ovfPath string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".ovf") {
			ovfPath = path
			return filepath.SkipAll
		}
		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return "", err
	}

	if ovfPath == "" {
		return "", fmt.Errorf("no OVF file found in OVA archive")
	}

	return ovfPath, nil
}

// OVF XML structures for parsing
type ovfEnvelope struct {
	XMLName          xml.Name          `xml:"Envelope"`
	References       ovfReferences     `xml:"References"`
	DiskSection      ovfDiskSection    `xml:"DiskSection"`
	NetworkSection   ovfNetworkSection `xml:"NetworkSection"`
	VirtualSystem    ovfVirtualSystem  `xml:"VirtualSystem"`
}

type ovfReferences struct {
	Files []ovfFile `xml:"File"`
}

type ovfFile struct {
	Href string `xml:"href,attr"`
	ID   string `xml:"id,attr"`
	Size int64  `xml:"size,attr"`
}

type ovfDiskSection struct {
	Disks []ovfDisk `xml:"Disk"`
}

type ovfDisk struct {
	DiskID                  string `xml:"diskId,attr"`
	FileRef                 string `xml:"fileRef,attr"`
	Capacity                string `xml:"capacity,attr"`
	CapacityAllocationUnits string `xml:"capacityAllocationUnits,attr"`
	Format                  string `xml:"format,attr"`
	PopulatedSize           string `xml:"populatedSize,attr"`
}

type ovfNetworkSection struct {
	Networks []ovfNetwork `xml:"Network"`
}

type ovfNetwork struct {
	Name        string `xml:"name,attr"`
	Description string `xml:"Description"`
}

type ovfVirtualSystem struct {
	ID                     string                   `xml:"id,attr"`
	Name                   string                   `xml:"Name"`
	Info                   string                   `xml:"Info"`
	OperatingSystemSection ovfOperatingSystemSection `xml:"OperatingSystemSection"`
	VirtualHardwareSection ovfVirtualHardwareSection `xml:"VirtualHardwareSection"`
	ProductSection         ovfProductSection         `xml:"ProductSection"`
	AnnotationSection      ovfAnnotationSection      `xml:"AnnotationSection"`
}

type ovfOperatingSystemSection struct {
	ID          int    `xml:"id,attr"`
	Description string `xml:"Description"`
}

type ovfVirtualHardwareSection struct {
	Items []ovfItem `xml:"Item"`
}

type ovfItem struct {
	AllocationUnits   string `xml:"AllocationUnits"`
	Description       string `xml:"Description"`
	ElementName       string `xml:"ElementName"`
	InstanceID        int    `xml:"InstanceID"`
	ResourceType      int    `xml:"ResourceType"`
	VirtualQuantity   int64  `xml:"VirtualQuantity"`
	ResourceSubType   string `xml:"ResourceSubType"`
	AddressOnParent   int    `xml:"AddressOnParent"`
	Parent            int    `xml:"Parent"`
	HostResource      string `xml:"HostResource"`
	AutomaticAllocation bool  `xml:"AutomaticAllocation"`
	Connection        string `xml:"Connection"`
}

type ovfProductSection struct {
	Product    string `xml:"Product"`
	Vendor     string `xml:"Vendor"`
	Version    string `xml:"Version"`
	FullVersion string `xml:"FullVersion"`
	ProductURL string `xml:"ProductUrl"`
	VendorURL  string `xml:"VendorUrl"`
}

type ovfAnnotationSection struct {
	Annotation string `xml:"Annotation"`
}

// parseOVF parses an OVF file and extracts metadata.
func (s *OVAService) parseOVF(ovfPath string) (*domain.OvaMetadata, error) {
	data, err := os.ReadFile(ovfPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read OVF file: %w", err)
	}

	var envelope ovfEnvelope
	if err := xml.Unmarshal(data, &envelope); err != nil {
		return nil, fmt.Errorf("failed to parse OVF XML: %w", err)
	}

	metadata := &domain.OvaMetadata{
		VMName:      envelope.VirtualSystem.Name,
		Description: envelope.VirtualSystem.AnnotationSection.Annotation,
		OvfContent:  string(data),
	}

	// Parse OS info
	metadata.OsInfo = domain.OvaOsInfo{
		OsID:          uint32(envelope.VirtualSystem.OperatingSystemSection.ID),
		OsDescription: envelope.VirtualSystem.OperatingSystemSection.Description,
		OsFamily:      s.detectOSFamily(envelope.VirtualSystem.OperatingSystemSection.ID),
	}

	// Parse hardware from VirtualHardwareSection
	for _, item := range envelope.VirtualSystem.VirtualHardwareSection.Items {
		switch item.ResourceType {
		case 3: // CPU
			metadata.Hardware.CPUCount = uint32(item.VirtualQuantity)
		case 4: // Memory
			// Parse allocation units to determine memory size
			memMiB := item.VirtualQuantity
			if strings.Contains(item.AllocationUnits, "2^20") {
				// Already in MiB
			} else if strings.Contains(item.AllocationUnits, "2^30") {
				memMiB = item.VirtualQuantity * 1024 // GiB to MiB
			}
			metadata.Hardware.MemoryMiB = uint64(memMiB)
		case 10: // Network adapter
			network := domain.OvaNetworkInfo{
				Name:        item.Connection,
				AdapterType: item.ResourceSubType,
				InstanceID:  uint32(item.InstanceID),
			}
			metadata.Networks = append(metadata.Networks, network)
		}
	}

	// Parse disks
	fileMap := make(map[string]ovfFile)
	for _, f := range envelope.References.Files {
		fileMap[f.ID] = f
	}

	for _, disk := range envelope.DiskSection.Disks {
		diskInfo := domain.OvaDiskInfo{
			DiskID:  disk.DiskID,
			FileRef: disk.FileRef,
			Format:  "vmdk",
		}

		// Parse capacity
		capacity, _ := strconv.ParseInt(disk.Capacity, 10, 64)
		if strings.Contains(disk.CapacityAllocationUnits, "2^30") {
			capacity = capacity * 1024 * 1024 * 1024 // GiB to bytes
		} else if strings.Contains(disk.CapacityAllocationUnits, "2^20") {
			capacity = capacity * 1024 * 1024 // MiB to bytes
		}
		diskInfo.CapacityBytes = uint64(capacity)

		// Get populated size
		if disk.PopulatedSize != "" {
			popSize, _ := strconv.ParseInt(disk.PopulatedSize, 10, 64)
			diskInfo.PopulatedSizeBytes = uint64(popSize)
		}

		// Get file reference
		if file, ok := fileMap[disk.FileRef]; ok {
			diskInfo.FileRef = file.Href
		}

		metadata.Disks = append(metadata.Disks, diskInfo)
	}

	// Parse networks from NetworkSection
	for _, net := range envelope.NetworkSection.Networks {
		// Check if network already added from hardware section
		found := false
		for i := range metadata.Networks {
			if metadata.Networks[i].Name == net.Name {
				metadata.Networks[i].Description = net.Description
				found = true
				break
			}
		}
		if !found {
			metadata.Networks = append(metadata.Networks, domain.OvaNetworkInfo{
				Name:        net.Name,
				Description: net.Description,
			})
		}
	}

	// Parse product info
	metadata.Product = domain.OvaProductInfo{
		Product:     envelope.VirtualSystem.ProductSection.Product,
		Vendor:      envelope.VirtualSystem.ProductSection.Vendor,
		Version:     envelope.VirtualSystem.ProductSection.Version,
		FullVersion: envelope.VirtualSystem.ProductSection.FullVersion,
		ProductURL:  envelope.VirtualSystem.ProductSection.ProductURL,
		VendorURL:   envelope.VirtualSystem.ProductSection.VendorURL,
	}

	// Default firmware to BIOS (UEFI detection would need more OVF parsing)
	metadata.Hardware.Firmware = "bios"

	return metadata, nil
}

// detectOSFamily detects the OS family from the OVF OS ID.
func (s *OVAService) detectOSFamily(osID int) domain.OSFamily {
	// Common OVF OS IDs:
	// 1-99: Various specific OS types
	// 100-102: Linux variants (100=Other Linux, 101=Linux 2.4, 102=Linux 2.6)
	// 103-107: Windows variants
	switch {
	case osID >= 100 && osID <= 102:
		return domain.OSFamilyLinux
	case osID == 36 || osID == 37 || osID == 38: // Ubuntu
		return domain.OSFamilyLinux
	case osID >= 103 && osID <= 107:
		return domain.OSFamilyWindows
	case osID == 67 || osID == 68 || osID == 69: // Windows Server
		return domain.OSFamilyWindows
	case osID >= 78 && osID <= 82: // FreeBSD
		return domain.OSFamilyBSD
	default:
		return domain.OSFamilyUnknown
	}
}

// convertDisks converts VMDK files to QCOW2 format.
func (s *OVAService) convertDisks(ctx context.Context, extractDir string, metadata *domain.OvaMetadata) error {
	if err := os.MkdirAll(s.imagesDir, 0755); err != nil {
		return fmt.Errorf("failed to create images directory: %w", err)
	}

	for i := range metadata.Disks {
		disk := &metadata.Disks[i]
		if disk.FileRef == "" {
			continue
		}

		vmdkPath := filepath.Join(extractDir, disk.FileRef)
		if _, err := os.Stat(vmdkPath); os.IsNotExist(err) {
			// Try without directory prefix
			vmdkPath = filepath.Join(extractDir, filepath.Base(disk.FileRef))
			if _, err := os.Stat(vmdkPath); os.IsNotExist(err) {
				s.logger.Warn("VMDK file not found",
					zap.String("file_ref", disk.FileRef),
					zap.String("path", vmdkPath),
				)
				continue
			}
		}

		// Generate output path
		qcow2Name := fmt.Sprintf("%s-%d.qcow2", strings.TrimSuffix(filepath.Base(disk.FileRef), ".vmdk"), i)
		qcow2Path := filepath.Join(s.imagesDir, qcow2Name)

		s.logger.Info("Converting VMDK to QCOW2",
			zap.String("source", vmdkPath),
			zap.String("dest", qcow2Path),
		)

		// Use qemu-img to convert
		// Note: In production, this would call the Node Daemon's convert endpoint
		// For now, we'll just copy the file and note the conversion is needed
		disk.ConvertedPath = qcow2Path
		disk.Format = "qcow2"

		// TODO: Call Node Daemon's /api/v1/storage/convert endpoint
		// For now, just move the VMDK file (actual conversion happens on node)
		if err := os.Rename(vmdkPath, qcow2Path+".vmdk"); err != nil {
			// If rename fails (cross-device), try copy
			if err := copyFile(vmdkPath, qcow2Path+".vmdk"); err != nil {
				return fmt.Errorf("failed to move VMDK file: %w", err)
			}
		}
		disk.ConvertedPath = qcow2Path + ".vmdk" // Keep as VMDK until node converts
	}

	return nil
}

// copyFile copies a file from src to dst.
func copyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	dstFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}

// createImageRecord creates an Image record in the repository.
func (s *OVAService) createImageRecord(ctx context.Context, job *domain.OvaUploadJob, metadata *domain.OvaMetadata) (*domain.Image, error) {
	now := time.Now()

	// Determine total disk size
	var totalSize uint64
	for _, disk := range metadata.Disks {
		totalSize += disk.CapacityBytes
	}

	image := &domain.Image{
		ID:          uuid.New().String(),
		Name:        metadata.VMName,
		Description: metadata.Description,
		Spec: domain.ImageSpec{
			Format:     domain.ImageFormatOVA,
			Visibility: domain.ImageVisibilityProject,
			OS: domain.OSInfo{
				Family:       metadata.OsInfo.OsFamily,
				Distribution: strings.ToLower(metadata.OsInfo.OsDescription),
				Architecture: "x86_64",
			},
			Requirements: domain.ImageRequirements{
				MinCPU:       metadata.Hardware.CPUCount,
				MinMemoryMiB: metadata.Hardware.MemoryMiB,
				MinDiskGiB:   totalSize / (1024 * 1024 * 1024),
			},
			OvaMetadata: metadata,
		},
		Status: domain.ImageStatus{
			Phase:            domain.ImagePhaseReady,
			VirtualSizeBytes: totalSize,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	// Set path to first disk
	if len(metadata.Disks) > 0 {
		image.Status.Path = metadata.Disks[0].ConvertedPath
	}

	created, err := s.imageRepo.Create(ctx, image)
	if err != nil {
		return nil, fmt.Errorf("failed to create image record: %w", err)
	}

	return created, nil
}

// updateJobStatus updates the status of an OVA upload job.
func (s *OVAService) updateJobStatus(jobID string, status domain.OvaUploadStatus, step string, progress uint32) {
	s.jobsMu.Lock()
	defer s.jobsMu.Unlock()

	if job, exists := s.jobs[jobID]; exists {
		job.Status = status
		job.CurrentStep = step
		job.ProgressPercent = progress
		job.UpdatedAt = time.Now()
	}
}

// failJob marks a job as failed.
func (s *OVAService) failJob(jobID string, errorMsg string) {
	s.jobsMu.Lock()
	defer s.jobsMu.Unlock()

	if job, exists := s.jobs[jobID]; exists {
		job.Status = domain.OvaUploadStatusFailed
		job.ErrorMessage = errorMsg
		job.UpdatedAt = time.Now()
	}

	s.logger.Error("OVA processing failed",
		zap.String("job_id", jobID),
		zap.String("error", errorMsg),
	)
}

// =============================================================================
// gRPC Service Methods
// =============================================================================

// GetOVAUploadStatus implements the OVAService.GetOVAUploadStatus RPC.
func (s *OVAService) GetOVAUploadStatus(
	ctx context.Context,
	req *connect.Request[storagev1.GetOVAUploadStatusRequest],
) (*connect.Response[storagev1.OVAUploadStatus], error) {
	job, err := s.GetJob(req.Msg.JobId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	status := &storagev1.OVAUploadStatus{
		JobId:           job.JobID,
		ImageId:         job.ImageID,
		Status:          convertOvaUploadStatus(job.Status),
		ProgressPercent: job.ProgressPercent,
		CurrentStep:     job.CurrentStep,
		BytesUploaded:   job.BytesUploaded,
		BytesTotal:      job.BytesTotal,
		ErrorMessage:    job.ErrorMessage,
	}

	if job.Metadata != nil {
		status.Metadata = convertOvaMetadataToProto(job.Metadata)
	}

	return connect.NewResponse(status), nil
}

// ListOVATemplates implements the OVAService.ListOVATemplates RPC.
func (s *OVAService) ListOVATemplates(
	ctx context.Context,
	req *connect.Request[storagev1.ListOVATemplatesRequest],
) (*connect.Response[storagev1.ListOVATemplatesResponse], error) {
	// List images with OVA format
	filter := ImageFilter{
		ProjectID: req.Msg.ProjectId,
	}

	images, err := s.imageRepo.List(ctx, filter)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Filter to OVA templates only
	var templates []*storagev1.Image
	for _, img := range images {
		if img.Spec.Format == domain.ImageFormatOVA {
			templates = append(templates, convertImageToProto(img))
		}
	}

	return connect.NewResponse(&storagev1.ListOVATemplatesResponse{
		Templates:  templates,
		TotalCount: int32(len(templates)),
	}), nil
}

// GetOVATemplate implements the OVAService.GetOVATemplate RPC.
func (s *OVAService) GetOVATemplate(
	ctx context.Context,
	req *connect.Request[storagev1.GetOVATemplateRequest],
) (*connect.Response[storagev1.Image], error) {
	image, err := s.imageRepo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("template not found: %s", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if image.Spec.Format != domain.ImageFormatOVA {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("image is not an OVA template: %s", req.Msg.Id))
	}

	return connect.NewResponse(convertImageToProto(image)), nil
}

// DeleteOVATemplate implements the OVAService.DeleteOVATemplate RPC.
func (s *OVAService) DeleteOVATemplate(
	ctx context.Context,
	req *connect.Request[storagev1.DeleteOVATemplateRequest],
) (*connect.Response[emptypb.Empty], error) {
	image, err := s.imageRepo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("template not found: %s", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if image.Spec.Format != domain.ImageFormatOVA {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("image is not an OVA template: %s", req.Msg.Id))
	}

	// Delete associated disk files
	if image.Spec.OvaMetadata != nil {
		for _, disk := range image.Spec.OvaMetadata.Disks {
			if disk.ConvertedPath != "" {
				os.Remove(disk.ConvertedPath)
			}
		}
	}

	if err := s.imageRepo.Delete(ctx, req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&emptypb.Empty{}), nil
}

// =============================================================================
// Conversion Helpers
// =============================================================================

func convertOvaUploadStatus(status domain.OvaUploadStatus) storagev1.OVAUploadStatus_Status {
	switch status {
	case domain.OvaUploadStatusUploading:
		return storagev1.OVAUploadStatus_UPLOADING
	case domain.OvaUploadStatusExtracting:
		return storagev1.OVAUploadStatus_EXTRACTING
	case domain.OvaUploadStatusParsing:
		return storagev1.OVAUploadStatus_PARSING
	case domain.OvaUploadStatusConverting:
		return storagev1.OVAUploadStatus_CONVERTING
	case domain.OvaUploadStatusCompleted:
		return storagev1.OVAUploadStatus_COMPLETED
	case domain.OvaUploadStatusFailed:
		return storagev1.OVAUploadStatus_FAILED
	default:
		return storagev1.OVAUploadStatus_UNKNOWN
	}
}

func convertOvaMetadataToProto(m *domain.OvaMetadata) *storagev1.OvaMetadata {
	if m == nil {
		return nil
	}

	proto := &storagev1.OvaMetadata{
		VmName:      m.VMName,
		Description: m.Description,
		OsInfo: &storagev1.OvaOsInfo{
			OsId:          m.OsInfo.OsID,
			OsDescription: m.OsInfo.OsDescription,
			OsFamily:      convertOSFamilyToProto(m.OsInfo.OsFamily),
		},
		Hardware: &storagev1.OvaHardwareConfig{
			CpuCount:  m.Hardware.CPUCount,
			MemoryMib: m.Hardware.MemoryMiB,
			Firmware:  m.Hardware.Firmware,
		},
		Product: &storagev1.OvaProductInfo{
			Product:     m.Product.Product,
			Vendor:      m.Product.Vendor,
			Version:     m.Product.Version,
			FullVersion: m.Product.FullVersion,
			ProductUrl:  m.Product.ProductURL,
			VendorUrl:   m.Product.VendorURL,
		},
		OvfContent: m.OvfContent,
	}

	for _, disk := range m.Disks {
		proto.Disks = append(proto.Disks, &storagev1.OvaDiskInfo{
			DiskId:             disk.DiskID,
			FileRef:            disk.FileRef,
			CapacityBytes:      disk.CapacityBytes,
			PopulatedSizeBytes: disk.PopulatedSizeBytes,
			Format:             disk.Format,
			ControllerType:     disk.ControllerType,
			AddressOnParent:    disk.AddressOnParent,
			ConvertedPath:      disk.ConvertedPath,
		})
	}

	for _, net := range m.Networks {
		proto.Networks = append(proto.Networks, &storagev1.OvaNetworkInfo{
			Name:        net.Name,
			Description: net.Description,
			AdapterType: net.AdapterType,
			InstanceId:  net.InstanceID,
		})
	}

	return proto
}

// Note: convertOSFamilyToProto is defined in image_service.go
