// Package storage implements storage-related services.
package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	storagev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/storage/v1"
)

// ImageService implements the storagev1connect.ImageServiceHandler interface.
type ImageService struct {
	repo            ImageRepository
	catalog         []CatalogEntry
	downloadManager *DownloadManager
	imagesDir       string // Default directory for downloaded images
	logger          *zap.Logger
}

// CatalogEntry represents a known cloud image that can be downloaded.
type CatalogEntry struct {
	ID           string
	Name         string
	Description  string
	URL          string
	Checksum     string
	ChecksumType string
	OS           domain.OSInfo
	SizeBytes    uint64
	Requirements domain.ImageRequirements
	Verified     bool
}

// NewImageService creates a new ImageService with a built-in catalog.
func NewImageService(repo ImageRepository, logger *zap.Logger) *ImageService {
	svc := &ImageService{
		repo:      repo,
		imagesDir: "/var/lib/limiquantix/cloud-images",
		logger:    logger.Named("image-service"),
	}
	svc.initCatalog()
	svc.downloadManager = NewDownloadManager(repo, svc.catalog, logger)
	return svc
}

// initCatalog initializes the built-in cloud image catalog.
// These are official cloud images with known default usernames.
func (s *ImageService) initCatalog() {
	s.catalog = []CatalogEntry{
		// Ubuntu
		{
			ID:           "ubuntu-22.04",
			Name:         "Ubuntu 22.04 LTS (Jammy)",
			Description:  "Official Ubuntu cloud image with cloud-init. Default user: ubuntu",
			URL:          "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img",
			Checksum:     "", // Dynamic, fetched from SHA256SUMS
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "ubuntu",
				Version:            "22.04",
				Architecture:       "x86_64",
				DefaultUser:        "ubuntu",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 700 * 1024 * 1024, // ~700 MB
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      512,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		{
			ID:           "ubuntu-24.04",
			Name:         "Ubuntu 24.04 LTS (Noble)",
			Description:  "Latest Ubuntu LTS with cloud-init. Default user: ubuntu",
			URL:          "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "ubuntu",
				Version:            "24.04",
				Architecture:       "x86_64",
				DefaultUser:        "ubuntu",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 750 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      512,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		// Debian
		{
			ID:           "debian-12",
			Name:         "Debian 12 (Bookworm)",
			Description:  "Official Debian cloud image. Default user: debian",
			URL:          "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "debian",
				Version:            "12",
				Architecture:       "x86_64",
				DefaultUser:        "debian",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 350 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      256,
				MinDiskGiB:        5,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		// Rocky Linux
		{
			ID:           "rocky-9",
			Name:         "Rocky Linux 9",
			Description:  "Enterprise Linux compatible. Default user: rocky",
			URL:          "https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "rocky",
				Version:            "9",
				Architecture:       "x86_64",
				DefaultUser:        "rocky",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 1100 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      1024,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		// AlmaLinux
		{
			ID:           "almalinux-9",
			Name:         "AlmaLinux 9",
			Description:  "RHEL-compatible. Default user: almalinux",
			URL:          "https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "almalinux",
				Version:            "9",
				Architecture:       "x86_64",
				DefaultUser:        "almalinux",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 1000 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      1024,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		// Fedora Cloud
		{
			ID:           "fedora-40",
			Name:         "Fedora 40 Cloud",
			Description:  "Latest Fedora cloud image. Default user: fedora",
			URL:          "https://download.fedoraproject.org/pub/fedora/linux/releases/40/Cloud/x86_64/images/Fedora-Cloud-Base-Generic.x86_64-40-1.14.qcow2",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "fedora",
				Version:            "40",
				Architecture:       "x86_64",
				DefaultUser:        "fedora",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 400 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      512,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		// CentOS Stream
		{
			ID:           "centos-stream-9",
			Name:         "CentOS Stream 9",
			Description:  "CentOS Stream 9 cloud image. Default user: cloud-user",
			URL:          "https://cloud.centos.org/centos/9-stream/x86_64/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "centos",
				Version:            "9-stream",
				Architecture:       "x86_64",
				DefaultUser:        "cloud-user",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 1100 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      1024,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
		// openSUSE
		{
			ID:           "opensuse-leap-15.5",
			Name:         "openSUSE Leap 15.5",
			Description:  "openSUSE Leap cloud image. Default user: root (set password via cloud-init)",
			URL:          "https://download.opensuse.org/distribution/leap/15.5/appliances/openSUSE-Leap-15.5-Minimal-VM.x86_64-Cloud.qcow2",
			Checksum:     "",
			ChecksumType: "sha256",
			OS: domain.OSInfo{
				Family:             domain.OSFamilyLinux,
				Distribution:       "opensuse",
				Version:            "15.5",
				Architecture:       "x86_64",
				DefaultUser:        "root",
				CloudInitEnabled:   true,
				ProvisioningMethod: domain.ProvisioningMethodCloudInit,
			},
			SizeBytes: 300 * 1024 * 1024,
			Requirements: domain.ImageRequirements{
				MinCPU:            1,
				MinMemoryMiB:      512,
				MinDiskGiB:        10,
				SupportedFirmware: []string{"bios", "uefi"},
			},
			Verified: true,
		},
	}
}

// GetCatalog returns the list of available cloud images for download.
func (s *ImageService) GetCatalog() []CatalogEntry {
	return s.catalog
}

// GetDownloadJobs returns all active download jobs.
func (s *ImageService) GetDownloadJobs() []*DownloadJob {
	return s.downloadManager.ListJobs()
}

// GetDownloadManager returns the download manager for external access.
func (s *ImageService) GetDownloadManager() *DownloadManager {
	return s.downloadManager
}

// GetRepository returns the image repository for external access.
func (s *ImageService) GetRepository() ImageRepository {
	return s.repo
}

// GetImageCatalog returns the list of available cloud images for download.
func (s *ImageService) GetImageCatalog(
	ctx context.Context,
	req *connect.Request[storagev1.GetImageCatalogRequest],
) (*connect.Response[storagev1.GetImageCatalogResponse], error) {
	var entries []*storagev1.ImageCatalogEntry

	for _, e := range s.catalog {
		// Apply OS family filter if specified
		if req.Msg.OsFamily != storagev1.OsInfo_UNKNOWN {
			if convertOSFamilyToProto(e.OS.Family) != req.Msg.OsFamily {
				continue
			}
		}

		entries = append(entries, &storagev1.ImageCatalogEntry{
			Id:           e.ID,
			Name:         e.Name,
			Description:  e.Description,
			Url:          e.URL,
			Checksum:     e.Checksum,
			ChecksumType: e.ChecksumType,
			Os: &storagev1.OsInfo{
				Family:             convertOSFamilyToProto(e.OS.Family),
				Distribution:       e.OS.Distribution,
				Version:            e.OS.Version,
				Architecture:       e.OS.Architecture,
				DefaultUser:        e.OS.DefaultUser,
				CloudInitEnabled:   e.OS.CloudInitEnabled,
				ProvisioningMethod: convertProvisioningMethodToProto(e.OS.ProvisioningMethod),
			},
			SizeBytes: e.SizeBytes,
			Requirements: &storagev1.ImageRequirements{
				MinCpu:            e.Requirements.MinCPU,
				MinMemoryMib:      e.Requirements.MinMemoryMiB,
				MinDiskGib:        e.Requirements.MinDiskGiB,
				SupportedFirmware: e.Requirements.SupportedFirmware,
			},
			Verified: e.Verified,
		})
	}

	return connect.NewResponse(&storagev1.GetImageCatalogResponse{
		Images: entries,
	}), nil
}

// CreateImage creates a new image.
func (s *ImageService) CreateImage(
	ctx context.Context,
	req *connect.Request[storagev1.CreateImageRequest],
) (*connect.Response[storagev1.Image], error) {
	logger := s.logger.With(
		zap.String("method", "CreateImage"),
		zap.String("name", req.Msg.Name),
	)
	logger.Info("Creating image")

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}

	now := time.Now()
	image := &domain.Image{
		ID:          uuid.New().String(),
		Name:        req.Msg.Name,
		Description: req.Msg.Description,
		ProjectID:   req.Msg.ProjectId,
		Labels:      req.Msg.Labels,
		Spec:        convertImageSpecFromProto(req.Msg.Spec),
		Status: domain.ImageStatus{
			Phase: domain.ImagePhasePending,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	created, err := s.repo.Create(ctx, image)
	if err != nil {
		logger.Error("Failed to create image", zap.Error(err))
		if err == domain.ErrAlreadyExists {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Image created", zap.String("image_id", created.ID))
	return connect.NewResponse(convertImageToProto(created)), nil
}

// GetImage retrieves an image by ID.
func (s *ImageService) GetImage(
	ctx context.Context,
	req *connect.Request[storagev1.GetImageRequest],
) (*connect.Response[storagev1.Image], error) {
	image, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("image not found: %s", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(convertImageToProto(image)), nil
}

// ListImages returns available images.
func (s *ImageService) ListImages(
	ctx context.Context,
	req *connect.Request[storagev1.ListImagesRequest],
) (*connect.Response[storagev1.ListImagesResponse], error) {
	logger := s.logger.With(zap.String("method", "ListImages"))
	logger.Debug("Listing images")

	filter := ImageFilter{
		ProjectID: req.Msg.ProjectId,
	}

	if req.Msg.OsFamily != storagev1.OsInfo_UNKNOWN {
		filter.OSFamily = convertOSFamilyFromProto(req.Msg.OsFamily)
	}
	if req.Msg.Visibility != storagev1.ImageSpec_PRIVATE {
		filter.Visibility = convertVisibilityFromProto(req.Msg.Visibility)
	}

	images, err := s.repo.List(ctx, filter)
	if err != nil {
		logger.Error("Failed to list images", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	protoImages := make([]*storagev1.Image, len(images))
	for i, img := range images {
		protoImages[i] = convertImageToProto(img)
	}

	logger.Debug("Listed images", zap.Int("count", len(protoImages)))
	return connect.NewResponse(&storagev1.ListImagesResponse{
		Images:     protoImages,
		TotalCount: int32(len(protoImages)),
	}), nil
}

// UpdateImage updates image metadata.
func (s *ImageService) UpdateImage(
	ctx context.Context,
	req *connect.Request[storagev1.UpdateImageRequest],
) (*connect.Response[storagev1.Image], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateImage"),
		zap.String("image_id", req.Msg.Id),
	)

	image, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("image not found: %s", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Update fields
	if req.Msg.Description != "" {
		image.Description = req.Msg.Description
	}
	if req.Msg.Labels != nil {
		image.Labels = req.Msg.Labels
	}
	if req.Msg.Visibility != storagev1.ImageSpec_PRIVATE {
		image.Spec.Visibility = convertVisibilityFromProto(req.Msg.Visibility)
	}
	image.UpdatedAt = time.Now()

	updated, err := s.repo.Update(ctx, image)
	if err != nil {
		logger.Error("Failed to update image", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Image updated", zap.String("image_id", updated.ID))
	return connect.NewResponse(convertImageToProto(updated)), nil
}

// DeleteImage removes an image.
func (s *ImageService) DeleteImage(
	ctx context.Context,
	req *connect.Request[storagev1.DeleteImageRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteImage"),
		zap.String("image_id", req.Msg.Id),
	)
	logger.Info("Deleting image")

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("image not found: %s", req.Msg.Id))
		}
		logger.Error("Failed to delete image", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Image deleted")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// ImportImage imports from URL (async).
func (s *ImageService) ImportImage(
	ctx context.Context,
	req *connect.Request[storagev1.ImportImageRequest],
) (*connect.Response[storagev1.ImportImageResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ImportImage"),
		zap.String("name", req.Msg.Name),
		zap.String("url", req.Msg.Url),
	)
	logger.Info("Starting image import")

	now := time.Now()
	jobID := uuid.New().String()
	image := &domain.Image{
		ID:          uuid.New().String(),
		Name:        req.Msg.Name,
		Description: req.Msg.Description,
		ProjectID:   req.Msg.ProjectId,
		Spec: domain.ImageSpec{
			Format:     domain.ImageFormatQCOW2,
			Visibility: domain.ImageVisibilityProject,
			OS:         convertOSInfoFromProto(req.Msg.OsInfo),
		},
		Status: domain.ImageStatus{
			Phase:         domain.ImagePhaseDownloading,
			StoragePoolID: req.Msg.StoragePoolId,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	created, err := s.repo.Create(ctx, image)
	if err != nil {
		logger.Error("Failed to create image record", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// TODO: Start async download job
	// For now, we just return the pending image

	logger.Info("Image import started",
		zap.String("job_id", jobID),
		zap.String("image_id", created.ID),
	)

	return connect.NewResponse(&storagev1.ImportImageResponse{
		JobId: jobID,
		Image: convertImageToProto(created),
	}), nil
}

// GetImportStatus checks import progress.
func (s *ImageService) GetImportStatus(
	ctx context.Context,
	req *connect.Request[storagev1.GetImportStatusRequest],
) (*connect.Response[storagev1.ImportStatus], error) {
	status := s.downloadManager.GetJobStatus(req.Msg.JobId)
	return connect.NewResponse(status), nil
}

// ScanLocalImages registers images scanned by the Node Daemon.
func (s *ImageService) ScanLocalImages(
	ctx context.Context,
	req *connect.Request[storagev1.ScanLocalImagesRequest],
) (*connect.Response[storagev1.ScanLocalImagesResponse], error) {
	logger := s.logger.With(
		zap.String("method", "ScanLocalImages"),
		zap.String("node_id", req.Msg.NodeId),
		zap.Int("image_count", len(req.Msg.Images)),
	)
	logger.Info("Scanning local images from node")

	var registered, existing uint32
	var errors []string

	now := time.Now()
	for _, imgInfo := range req.Msg.Images {
		// Check if image already exists by path
		existingImg, err := s.repo.GetByPath(ctx, req.Msg.NodeId, imgInfo.Path)
		if err == nil && existingImg != nil {
			existing++
			continue
		}

		// Detect OS info from filename if not provided
		osInfo := convertOSInfoFromProto(imgInfo.DetectedOs)
		if osInfo.Distribution == "" {
			osInfo = detectOSFromFilename(imgInfo.Filename)
		}

		// Create new image record
		image := &domain.Image{
			ID:          uuid.New().String(),
			Name:        imgInfo.Filename,
			Description: fmt.Sprintf("Local image from %s", req.Msg.NodeId),
			Spec: domain.ImageSpec{
				Format:     detectFormat(imgInfo.Format),
				Visibility: domain.ImageVisibilityPublic,
				OS:         osInfo,
			},
			Status: domain.ImageStatus{
				Phase:            domain.ImagePhaseReady,
				SizeBytes:        imgInfo.SizeBytes,
				VirtualSizeBytes: imgInfo.VirtualSizeBytes,
				Checksum:         imgInfo.Checksum,
				Path:             imgInfo.Path,
				NodeID:           req.Msg.NodeId,
			},
			CreatedAt: now,
			UpdatedAt: now,
		}

		if _, err := s.repo.Create(ctx, image); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", imgInfo.Path, err))
			continue
		}
		registered++

		logger.Debug("Registered local image",
			zap.String("image_id", image.ID),
			zap.String("path", imgInfo.Path),
			zap.String("os", osInfo.Distribution),
		)
	}

	logger.Info("Local image scan complete",
		zap.Uint32("registered", registered),
		zap.Uint32("existing", existing),
		zap.Int("errors", len(errors)),
	)

	return connect.NewResponse(&storagev1.ScanLocalImagesResponse{
		RegisteredCount: registered,
		ExistingCount:   existing,
		Errors:          errors,
	}), nil
}

// DownloadImage downloads a cloud image from an official source.
func (s *ImageService) DownloadImage(
	ctx context.Context,
	req *connect.Request[storagev1.DownloadImageRequest],
) (*connect.Response[storagev1.DownloadImageResponse], error) {
	logger := s.logger.With(
		zap.String("method", "DownloadImage"),
		zap.String("catalog_id", req.Msg.CatalogId),
	)
	logger.Info("Downloading image from catalog")

	// Find catalog entry
	var entry *CatalogEntry
	for _, e := range s.catalog {
		if e.ID == req.Msg.CatalogId {
			entry = &e
			break
		}
	}

	if entry == nil {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("catalog entry not found: %s", req.Msg.CatalogId))
	}

	// Create image record
	now := time.Now()
	name := req.Msg.Name
	if name == "" {
		name = entry.Name
	}

	image := &domain.Image{
		ID:          uuid.New().String(),
		Name:        name,
		Description: entry.Description,
		Spec: domain.ImageSpec{
			Format:       domain.ImageFormatQCOW2,
			Visibility:   domain.ImageVisibilityPublic,
			OS:           entry.OS,
			Requirements: entry.Requirements,
		},
		Status: domain.ImageStatus{
			Phase:         domain.ImagePhaseDownloading,
			StoragePoolID: req.Msg.StoragePoolId,
			NodeID:        req.Msg.NodeId,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	created, err := s.repo.Create(ctx, image)
	if err != nil {
		logger.Error("Failed to create image record", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	jobID := uuid.New().String()

	// Start download job
	if err := s.downloadManager.StartDownload(ctx, jobID, created.ID, req.Msg.CatalogId, req.Msg.NodeId, s.imagesDir); err != nil {
		logger.Error("Failed to start download job", zap.Error(err))
		// Update image status to error
		created.Status.Phase = domain.ImagePhaseError
		created.Status.ErrorMessage = err.Error()
		s.repo.Update(ctx, created)
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Image download started",
		zap.String("job_id", jobID),
		zap.String("image_id", created.ID),
		zap.String("url", entry.URL),
	)

	return connect.NewResponse(&storagev1.DownloadImageResponse{
		JobId: jobID,
		Image: convertImageToProto(created),
	}), nil
}

// --- Helper functions ---

func detectOSFromFilename(filename string) domain.OSInfo {
	filename = strings.ToLower(filename)
	info := domain.OSInfo{
		Family:             domain.OSFamilyLinux,
		Architecture:       "x86_64",
		CloudInitEnabled:   true,
		ProvisioningMethod: domain.ProvisioningMethodCloudInit,
	}

	switch {
	case strings.Contains(filename, "ubuntu"):
		info.Distribution = "ubuntu"
		info.DefaultUser = "ubuntu"
	case strings.Contains(filename, "debian"):
		info.Distribution = "debian"
		info.DefaultUser = "debian"
	case strings.Contains(filename, "rocky"):
		info.Distribution = "rocky"
		info.DefaultUser = "rocky"
	case strings.Contains(filename, "almalinux") || strings.Contains(filename, "alma"):
		info.Distribution = "almalinux"
		info.DefaultUser = "almalinux"
	case strings.Contains(filename, "centos"):
		info.Distribution = "centos"
		info.DefaultUser = "cloud-user"
	case strings.Contains(filename, "fedora"):
		info.Distribution = "fedora"
		info.DefaultUser = "fedora"
	case strings.Contains(filename, "opensuse") || strings.Contains(filename, "suse"):
		info.Distribution = "opensuse"
		info.DefaultUser = "root"
	case strings.Contains(filename, "windows"):
		info.Family = domain.OSFamilyWindows
		info.Distribution = "windows"
		info.DefaultUser = "Administrator"
		info.CloudInitEnabled = false
		info.ProvisioningMethod = domain.ProvisioningMethodSysprep
	default:
		info.Distribution = "unknown"
		info.DefaultUser = "root"
	}

	// Try to detect version from filename
	if strings.Contains(filename, "22.04") || strings.Contains(filename, "jammy") {
		info.Version = "22.04"
	} else if strings.Contains(filename, "24.04") || strings.Contains(filename, "noble") {
		info.Version = "24.04"
	} else if strings.Contains(filename, "20.04") || strings.Contains(filename, "focal") {
		info.Version = "20.04"
	}

	return info
}

func detectFormat(format string) domain.ImageFormat {
	switch strings.ToLower(format) {
	case "qcow2":
		return domain.ImageFormatQCOW2
	case "raw":
		return domain.ImageFormatRaw
	case "vmdk":
		return domain.ImageFormatVMDK
	case "vhd", "vhdx":
		return domain.ImageFormatVHD
	case "iso":
		return domain.ImageFormatISO
	default:
		return domain.ImageFormatQCOW2
	}
}

func convertImageSpecFromProto(spec *storagev1.ImageSpec) domain.ImageSpec {
	if spec == nil {
		return domain.ImageSpec{}
	}
	return domain.ImageSpec{
		Format:     domain.ImageFormat(spec.Format.String()),
		Visibility: convertVisibilityFromProto(spec.Visibility),
		OS:         convertOSInfoFromProto(spec.Os),
		Requirements: domain.ImageRequirements{
			MinCPU:             spec.Requirements.GetMinCpu(),
			MinMemoryMiB:       spec.Requirements.GetMinMemoryMib(),
			MinDiskGiB:         spec.Requirements.GetMinDiskGib(),
			SupportedFirmware:  spec.Requirements.GetSupportedFirmware(),
			RequiresSecureBoot: spec.Requirements.GetRequiresSecureBoot(),
			RequiresTPM:        spec.Requirements.GetRequiresTpm(),
		},
	}
}

func convertOSInfoFromProto(os *storagev1.OsInfo) domain.OSInfo {
	if os == nil {
		return domain.OSInfo{}
	}
	return domain.OSInfo{
		Family:             convertOSFamilyFromProto(os.Family),
		Distribution:       os.Distribution,
		Version:            os.Version,
		Architecture:       os.Architecture,
		DefaultUser:        os.DefaultUser,
		CloudInitEnabled:   os.CloudInitEnabled,
		ProvisioningMethod: convertProvisioningMethodFromProto(os.ProvisioningMethod),
	}
}

func convertOSFamilyFromProto(family storagev1.OsInfo_OsFamily) domain.OSFamily {
	switch family {
	case storagev1.OsInfo_LINUX:
		return domain.OSFamilyLinux
	case storagev1.OsInfo_WINDOWS:
		return domain.OSFamilyWindows
	case storagev1.OsInfo_BSD:
		return domain.OSFamilyBSD
	case storagev1.OsInfo_OTHER:
		return domain.OSFamilyOther
	default:
		return domain.OSFamilyUnknown
	}
}

func convertVisibilityFromProto(vis storagev1.ImageSpec_Visibility) domain.ImageVisibility {
	switch vis {
	case storagev1.ImageSpec_PRIVATE:
		return domain.ImageVisibilityPrivate
	case storagev1.ImageSpec_PROJECT:
		return domain.ImageVisibilityProject
	case storagev1.ImageSpec_PUBLIC:
		return domain.ImageVisibilityPublic
	default:
		return domain.ImageVisibilityPrivate
	}
}

func convertProvisioningMethodFromProto(method storagev1.OsInfo_ProvisioningMethod) domain.ProvisioningMethod {
	switch method {
	case storagev1.OsInfo_CLOUD_INIT:
		return domain.ProvisioningMethodCloudInit
	case storagev1.OsInfo_IGNITION:
		return domain.ProvisioningMethodIgnition
	case storagev1.OsInfo_SYSPREP:
		return domain.ProvisioningMethodSysprep
	case storagev1.OsInfo_KICKSTART:
		return domain.ProvisioningMethodKickstart
	case storagev1.OsInfo_PRESEED:
		return domain.ProvisioningMethodPreseed
	case storagev1.OsInfo_NONE:
		return domain.ProvisioningMethodNone
	default:
		return domain.ProvisioningMethodUnknown
	}
}

func convertImageToProto(img *domain.Image) *storagev1.Image {
	return &storagev1.Image{
		Id:          img.ID,
		Name:        img.Name,
		Description: img.Description,
		ProjectId:   img.ProjectID,
		Labels:      img.Labels,
		Spec: &storagev1.ImageSpec{
			Format:     convertFormatToProto(img.Spec.Format),
			Visibility: convertVisibilityToProto(img.Spec.Visibility),
			Os: &storagev1.OsInfo{
				Family:             convertOSFamilyToProto(img.Spec.OS.Family),
				Distribution:       img.Spec.OS.Distribution,
				Version:            img.Spec.OS.Version,
				Architecture:       img.Spec.OS.Architecture,
				DefaultUser:        img.Spec.OS.DefaultUser,
				CloudInitEnabled:   img.Spec.OS.CloudInitEnabled,
				ProvisioningMethod: convertProvisioningMethodToProto(img.Spec.OS.ProvisioningMethod),
			},
			Requirements: &storagev1.ImageRequirements{
				MinCpu:            img.Spec.Requirements.MinCPU,
				MinMemoryMib:      img.Spec.Requirements.MinMemoryMiB,
				MinDiskGib:        img.Spec.Requirements.MinDiskGiB,
				SupportedFirmware: img.Spec.Requirements.SupportedFirmware,
				RequiresSecureBoot: img.Spec.Requirements.RequiresSecureBoot,
				RequiresTpm:       img.Spec.Requirements.RequiresTPM,
			},
		},
		Status: &storagev1.ImageStatus{
			Phase:            convertImagePhaseToProto(img.Status.Phase),
			SizeBytes:        img.Status.SizeBytes,
			VirtualSizeBytes: img.Status.VirtualSizeBytes,
			ProgressPercent:  img.Status.ProgressPercent,
			Checksum:         img.Status.Checksum,
			ErrorMessage:     img.Status.ErrorMessage,
			StoragePoolId:    img.Status.StoragePoolID,
		},
		CreatedAt: timestamppb.New(img.CreatedAt),
		UpdatedAt: timestamppb.New(img.UpdatedAt),
	}
}

func convertFormatToProto(format domain.ImageFormat) storagev1.ImageSpec_Format {
	switch format {
	case domain.ImageFormatRaw:
		return storagev1.ImageSpec_RAW
	case domain.ImageFormatQCOW2:
		return storagev1.ImageSpec_QCOW2
	case domain.ImageFormatVMDK:
		return storagev1.ImageSpec_VMDK
	case domain.ImageFormatVHD:
		return storagev1.ImageSpec_VHD
	case domain.ImageFormatISO:
		return storagev1.ImageSpec_ISO
	default:
		return storagev1.ImageSpec_RAW
	}
}

func convertVisibilityToProto(vis domain.ImageVisibility) storagev1.ImageSpec_Visibility {
	switch vis {
	case domain.ImageVisibilityPrivate:
		return storagev1.ImageSpec_PRIVATE
	case domain.ImageVisibilityProject:
		return storagev1.ImageSpec_PROJECT
	case domain.ImageVisibilityPublic:
		return storagev1.ImageSpec_PUBLIC
	default:
		return storagev1.ImageSpec_PRIVATE
	}
}

func convertOSFamilyToProto(family domain.OSFamily) storagev1.OsInfo_OsFamily {
	switch family {
	case domain.OSFamilyLinux:
		return storagev1.OsInfo_LINUX
	case domain.OSFamilyWindows:
		return storagev1.OsInfo_WINDOWS
	case domain.OSFamilyBSD:
		return storagev1.OsInfo_BSD
	case domain.OSFamilyOther:
		return storagev1.OsInfo_OTHER
	default:
		return storagev1.OsInfo_UNKNOWN
	}
}

func convertProvisioningMethodToProto(method domain.ProvisioningMethod) storagev1.OsInfo_ProvisioningMethod {
	switch method {
	case domain.ProvisioningMethodCloudInit:
		return storagev1.OsInfo_CLOUD_INIT
	case domain.ProvisioningMethodIgnition:
		return storagev1.OsInfo_IGNITION
	case domain.ProvisioningMethodSysprep:
		return storagev1.OsInfo_SYSPREP
	case domain.ProvisioningMethodKickstart:
		return storagev1.OsInfo_KICKSTART
	case domain.ProvisioningMethodPreseed:
		return storagev1.OsInfo_PRESEED
	case domain.ProvisioningMethodNone:
		return storagev1.OsInfo_NONE
	default:
		return storagev1.OsInfo_PROVISIONING_UNKNOWN
	}
}

func convertImagePhaseToProto(phase domain.ImagePhase) storagev1.ImageStatus_Phase {
	switch phase {
	case domain.ImagePhasePending:
		return storagev1.ImageStatus_PENDING
	case domain.ImagePhaseDownloading:
		return storagev1.ImageStatus_DOWNLOADING
	case domain.ImagePhaseConverting:
		return storagev1.ImageStatus_CONVERTING
	case domain.ImagePhaseReady:
		return storagev1.ImageStatus_READY
	case domain.ImagePhaseError:
		return storagev1.ImageStatus_ERROR
	case domain.ImagePhaseDeleting:
		return storagev1.ImageStatus_DELETING
	default:
		return storagev1.ImageStatus_UNKNOWN
	}
}
