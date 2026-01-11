// Package folder provides the folder service for organizing VMs in a hierarchy.
// This is similar to VMware vSphere's folder structure for organizing virtual machines.
package folder

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/limiquantix/limiquantix/internal/domain"
	computev1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1"
	"github.com/limiquantix/limiquantix/pkg/api/limiquantix/compute/v1/computev1connect"
)

// Repository defines the interface for folder persistence.
type Repository interface {
	Create(ctx context.Context, folder *domain.Folder) (*domain.Folder, error)
	Get(ctx context.Context, id string) (*domain.Folder, error)
	List(ctx context.Context, filter domain.FolderFilter) ([]*domain.Folder, error)
	ListChildren(ctx context.Context, parentID string) ([]*domain.Folder, error)
	Update(ctx context.Context, folder *domain.Folder) (*domain.Folder, error)
	Delete(ctx context.Context, id string) error
	GetPath(ctx context.Context, id string) (string, error)
	CountVMs(ctx context.Context, folderID string) (int, error)
	MoveVMsToFolder(ctx context.Context, fromFolderID, toFolderID string) error
}

// Ensure Service implements FolderServiceHandler
var _ computev1connect.FolderServiceHandler = (*Service)(nil)

// Service implements the FolderService Connect-RPC handler.
type Service struct {
	computev1connect.UnimplementedFolderServiceHandler

	repo   Repository
	logger *zap.Logger
}

// NewService creates a new folder service.
func NewService(repo Repository, logger *zap.Logger) *Service {
	return &Service{
		repo:   repo,
		logger: logger.Named("folder-service"),
	}
}

// CreateFolder creates a new folder.
func (s *Service) CreateFolder(
	ctx context.Context,
	req *connect.Request[computev1.CreateFolderRequest],
) (*connect.Response[computev1.Folder], error) {
	logger := s.logger.With(
		zap.String("method", "CreateFolder"),
		zap.String("name", req.Msg.Name),
	)

	logger.Info("Creating folder")

	// Validate request
	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("folder name is required"))
	}

	// Normalize project ID
	projectID := req.Msg.ProjectId
	if projectID == "" || projectID == "default" {
		projectID = "00000000-0000-0000-0000-000000000001"
	}

	// Default folder type to VM
	folderType := domain.FolderTypeVM
	if req.Msg.Type != "" {
		folderType = domain.FolderType(req.Msg.Type)
	}

	folder := &domain.Folder{
		Name:        req.Msg.Name,
		ParentID:    req.Msg.ParentId,
		ProjectID:   projectID,
		Type:        folderType,
		Description: req.Msg.Description,
		Labels:      req.Msg.Labels,
	}

	created, err := s.repo.Create(ctx, folder)
	if err != nil {
		if errors.Is(err, domain.ErrAlreadyExists) {
			return nil, connect.NewError(connect.CodeAlreadyExists, fmt.Errorf("folder '%s' already exists at this level", req.Msg.Name))
		}
		logger.Error("Failed to create folder", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create folder: %w", err))
	}

	// Get the path
	if path, err := s.repo.GetPath(ctx, created.ID); err == nil {
		created.Path = path
	}

	logger.Info("Folder created successfully", zap.String("folder_id", created.ID))
	return connect.NewResponse(toProto(created)), nil
}

// GetFolder retrieves a folder by ID.
func (s *Service) GetFolder(
	ctx context.Context,
	req *connect.Request[computev1.GetFolderRequest],
) (*connect.Response[computev1.Folder], error) {
	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("folder ID is required"))
	}

	folder, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("folder '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Get the path and child count
	if path, err := s.repo.GetPath(ctx, folder.ID); err == nil {
		folder.Path = path
	}
	if count, err := s.repo.CountVMs(ctx, folder.ID); err == nil {
		folder.ChildCount = count
	}

	return connect.NewResponse(toProto(folder)), nil
}

// ListFolders returns folders matching the filter.
func (s *Service) ListFolders(
	ctx context.Context,
	req *connect.Request[computev1.ListFoldersRequest],
) (*connect.Response[computev1.ListFoldersResponse], error) {
	filter := domain.FolderFilter{
		ProjectID: req.Msg.ProjectId,
		ParentID:  req.Msg.ParentId,
		Type:      domain.FolderType(req.Msg.Type),
	}

	folders, err := s.repo.List(ctx, filter)
	if err != nil {
		s.logger.Error("Failed to list folders", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &computev1.ListFoldersResponse{}
	for _, folder := range folders {
		// Get child count for each folder
		if count, err := s.repo.CountVMs(ctx, folder.ID); err == nil {
			folder.ChildCount = count
		}
		resp.Folders = append(resp.Folders, toProto(folder))
	}

	return connect.NewResponse(resp), nil
}

// UpdateFolder updates an existing folder.
func (s *Service) UpdateFolder(
	ctx context.Context,
	req *connect.Request[computev1.UpdateFolderRequest],
) (*connect.Response[computev1.Folder], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateFolder"),
		zap.String("folder_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("folder ID is required"))
	}

	// Get existing folder
	folder, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("folder '%s' not found", req.Msg.Id))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Apply updates
	if req.Msg.Name != "" {
		folder.Name = req.Msg.Name
	}
	if req.Msg.Description != "" {
		folder.Description = req.Msg.Description
	}
	if req.Msg.ParentId != "" {
		// Prevent circular references
		if req.Msg.ParentId == folder.ID {
			return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("folder cannot be its own parent"))
		}
		folder.ParentID = req.Msg.ParentId
	}
	if len(req.Msg.Labels) > 0 {
		folder.Labels = req.Msg.Labels
	}

	updated, err := s.repo.Update(ctx, folder)
	if err != nil {
		logger.Error("Failed to update folder", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Folder updated successfully")
	return connect.NewResponse(toProto(updated)), nil
}

// DeleteFolder removes a folder by ID.
func (s *Service) DeleteFolder(
	ctx context.Context,
	req *connect.Request[computev1.DeleteFolderRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteFolder"),
		zap.String("folder_id", req.Msg.Id),
	)

	if req.Msg.Id == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("folder ID is required"))
	}

	// Check if folder has VMs
	vmCount, err := s.repo.CountVMs(ctx, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if vmCount > 0 && !req.Msg.Force {
		return nil, connect.NewError(connect.CodeFailedPrecondition, 
			fmt.Errorf("folder contains %d VMs; use force=true or move VMs first", vmCount))
	}

	// If force and there are VMs, move them to parent folder or orphan them
	if vmCount > 0 && req.Msg.Force {
		folder, _ := s.repo.Get(ctx, req.Msg.Id)
		if folder != nil && folder.ParentID != "" {
			_ = s.repo.MoveVMsToFolder(ctx, req.Msg.Id, folder.ParentID)
		}
	}

	// Delete the folder
	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("folder '%s' not found", req.Msg.Id))
		}
		logger.Error("Failed to delete folder", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Folder deleted successfully")
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// GetFolderTree returns the folder tree starting from a root folder.
func (s *Service) GetFolderTree(
	ctx context.Context,
	req *connect.Request[computev1.GetFolderTreeRequest],
) (*connect.Response[computev1.FolderTree], error) {
	// If no root ID specified, get all root folders
	rootID := req.Msg.RootId
	if rootID == "" {
		// Return all root folders for the project
		filter := domain.FolderFilter{
			ProjectID: req.Msg.ProjectId,
			Type:      domain.FolderType(req.Msg.Type),
		}
		folders, err := s.repo.List(ctx, filter)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		tree := &computev1.FolderTree{
			Children: make([]*computev1.FolderTree, 0, len(folders)),
		}
		for _, folder := range folders {
			childTree := s.buildTree(ctx, folder, int(req.Msg.Depth))
			tree.Children = append(tree.Children, childTree)
		}

		return connect.NewResponse(tree), nil
	}

	// Get specific root folder
	root, err := s.repo.Get(ctx, rootID)
	if err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("folder '%s' not found", rootID))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	tree := s.buildTree(ctx, root, int(req.Msg.Depth))
	return connect.NewResponse(tree), nil
}

// buildTree recursively builds a folder tree.
func (s *Service) buildTree(ctx context.Context, folder *domain.Folder, depth int) *computev1.FolderTree {
	tree := &computev1.FolderTree{
		Folder: toProto(folder),
	}

	if depth <= 0 {
		return tree
	}

	children, err := s.repo.ListChildren(ctx, folder.ID)
	if err != nil {
		s.logger.Warn("Failed to get folder children", zap.String("folder_id", folder.ID), zap.Error(err))
		return tree
	}

	tree.Children = make([]*computev1.FolderTree, 0, len(children))
	for _, child := range children {
		childTree := s.buildTree(ctx, child, depth-1)
		tree.Children = append(tree.Children, childTree)
	}

	return tree
}

// toProto converts a domain folder to proto.
func toProto(f *domain.Folder) *computev1.Folder {
	if f == nil {
		return nil
	}
	return &computev1.Folder{
		Id:          f.ID,
		Name:        f.Name,
		ParentId:    f.ParentID,
		ProjectId:   f.ProjectID,
		Type:        string(f.Type),
		Description: f.Description,
		Path:        f.Path,
		ChildCount:  int32(f.ChildCount),
		Labels:      f.Labels,
		CreatedAt:   timestamppb.New(f.CreatedAt),
		UpdatedAt:   timestamppb.New(f.UpdatedAt),
		CreatedBy:   f.CreatedBy,
	}
}
