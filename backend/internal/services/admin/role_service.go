// Package admin provides administrative services for the limiquantix platform.
package admin

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
)

// RoleRepository defines the interface for role data access.
type RoleRepository interface {
	Create(ctx context.Context, role *domain.CustomRole) (*domain.CustomRole, error)
	Get(ctx context.Context, id string) (*domain.CustomRole, error)
	GetByName(ctx context.Context, name string) (*domain.CustomRole, error)
	List(ctx context.Context, filter postgres.RoleFilter) ([]*domain.CustomRole, error)
	Update(ctx context.Context, role *domain.CustomRole) (*domain.CustomRole, error)
	Delete(ctx context.Context, id string) error
	AssignToUser(ctx context.Context, userID, roleID, assignedBy string) error
	RemoveFromUser(ctx context.Context, userID, roleID string) error
	GetUserRoles(ctx context.Context, userID string) ([]*domain.CustomRole, error)
}

// RoleService provides role management functionality.
type RoleService struct {
	roleRepo RoleRepository
	logger   *zap.Logger
}

// NewRoleService creates a new role service.
func NewRoleService(roleRepo RoleRepository, logger *zap.Logger) *RoleService {
	return &RoleService{
		roleRepo: roleRepo,
		logger:   logger.With(zap.String("service", "role")),
	}
}

// CreateRole creates a new custom role.
func (s *RoleService) CreateRole(ctx context.Context, name, description string, permissions []domain.Permission) (*domain.CustomRole, error) {
	s.logger.Info("Creating custom role", zap.String("name", name))

	// Validate name
	if name == "" {
		return nil, fmt.Errorf("role name is required")
	}

	// Check for reserved names
	if name == "admin" || name == "operator" || name == "viewer" {
		return nil, fmt.Errorf("cannot create role with reserved name: %s", name)
	}

	// Validate permissions
	if err := s.validatePermissions(permissions); err != nil {
		return nil, err
	}

	role := &domain.CustomRole{
		Name:        name,
		Description: description,
		Type:        domain.RoleTypeCustom,
		Permissions: permissions,
	}

	created, err := s.roleRepo.Create(ctx, role)
	if err != nil {
		s.logger.Error("Failed to create role", zap.Error(err), zap.String("name", name))
		return nil, fmt.Errorf("failed to create role: %w", err)
	}

	s.logger.Info("Created custom role", zap.String("id", created.ID), zap.String("name", created.Name))
	return created, nil
}

// GetRole retrieves a role by ID.
func (s *RoleService) GetRole(ctx context.Context, id string) (*domain.CustomRole, error) {
	return s.roleRepo.Get(ctx, id)
}

// GetRoleByName retrieves a role by name.
func (s *RoleService) GetRoleByName(ctx context.Context, name string) (*domain.CustomRole, error) {
	return s.roleRepo.GetByName(ctx, name)
}

// ListRoles returns all roles.
func (s *RoleService) ListRoles(ctx context.Context, filter postgres.RoleFilter) ([]*domain.CustomRole, error) {
	return s.roleRepo.List(ctx, filter)
}

// UpdateRole updates an existing custom role.
func (s *RoleService) UpdateRole(ctx context.Context, id string, name, description string, permissions []domain.Permission) (*domain.CustomRole, error) {
	s.logger.Info("Updating role", zap.String("id", id))

	existing, err := s.roleRepo.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	// Cannot update system roles
	if existing.Type == domain.RoleTypeSystem {
		return nil, fmt.Errorf("cannot update system role")
	}

	// Validate permissions
	if err := s.validatePermissions(permissions); err != nil {
		return nil, err
	}

	existing.Name = name
	existing.Description = description
	existing.Permissions = permissions

	updated, err := s.roleRepo.Update(ctx, existing)
	if err != nil {
		s.logger.Error("Failed to update role", zap.Error(err), zap.String("id", id))
		return nil, fmt.Errorf("failed to update role: %w", err)
	}

	s.logger.Info("Updated role", zap.String("id", id))
	return updated, nil
}

// DeleteRole removes a custom role.
func (s *RoleService) DeleteRole(ctx context.Context, id string) error {
	s.logger.Info("Deleting role", zap.String("id", id))

	existing, err := s.roleRepo.Get(ctx, id)
	if err != nil {
		return err
	}

	// Cannot delete system roles
	if existing.Type == domain.RoleTypeSystem {
		return fmt.Errorf("cannot delete system role")
	}

	// Check if role is in use
	if existing.UserCount > 0 {
		return fmt.Errorf("cannot delete role: %d users still assigned", existing.UserCount)
	}

	if err := s.roleRepo.Delete(ctx, id); err != nil {
		s.logger.Error("Failed to delete role", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to delete role: %w", err)
	}

	s.logger.Info("Deleted role", zap.String("id", id))
	return nil
}

// AssignRoleToUser assigns a role to a user.
func (s *RoleService) AssignRoleToUser(ctx context.Context, userID, roleID, assignedBy string) error {
	s.logger.Info("Assigning role to user",
		zap.String("user_id", userID),
		zap.String("role_id", roleID),
	)

	// Verify role exists
	if _, err := s.roleRepo.Get(ctx, roleID); err != nil {
		return fmt.Errorf("role not found: %w", err)
	}

	if err := s.roleRepo.AssignToUser(ctx, userID, roleID, assignedBy); err != nil {
		return fmt.Errorf("failed to assign role: %w", err)
	}

	return nil
}

// RemoveRoleFromUser removes a role from a user.
func (s *RoleService) RemoveRoleFromUser(ctx context.Context, userID, roleID string) error {
	s.logger.Info("Removing role from user",
		zap.String("user_id", userID),
		zap.String("role_id", roleID),
	)

	if err := s.roleRepo.RemoveFromUser(ctx, userID, roleID); err != nil {
		return fmt.Errorf("failed to remove role: %w", err)
	}

	return nil
}

// GetUserRoles returns all roles assigned to a user.
func (s *RoleService) GetUserRoles(ctx context.Context, userID string) ([]*domain.CustomRole, error) {
	return s.roleRepo.GetUserRoles(ctx, userID)
}

// GetUserPermissions returns all permissions for a user (from all assigned roles).
func (s *RoleService) GetUserPermissions(ctx context.Context, userID string) ([]domain.Permission, error) {
	roles, err := s.roleRepo.GetUserRoles(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Collect unique permissions
	permSet := make(map[domain.Permission]bool)
	for _, role := range roles {
		for _, perm := range role.Permissions {
			permSet[perm] = true
		}
	}

	perms := make([]domain.Permission, 0, len(permSet))
	for perm := range permSet {
		perms = append(perms, perm)
	}

	return perms, nil
}

// HasPermission checks if a user has a specific permission.
func (s *RoleService) HasPermission(ctx context.Context, userID string, permission domain.Permission) (bool, error) {
	perms, err := s.GetUserPermissions(ctx, userID)
	if err != nil {
		return false, err
	}

	for _, p := range perms {
		if p == permission {
			return true, nil
		}
	}

	return false, nil
}

// GetAllPermissions returns all available permissions in the system.
func (s *RoleService) GetAllPermissions() []domain.Permission {
	return []domain.Permission{
		// VM permissions
		domain.PermissionVMCreate,
		domain.PermissionVMRead,
		domain.PermissionVMUpdate,
		domain.PermissionVMDelete,
		domain.PermissionVMStart,
		domain.PermissionVMStop,
		domain.PermissionVMMigrate,
		// Node permissions
		domain.PermissionNodeCreate,
		domain.PermissionNodeRead,
		domain.PermissionNodeUpdate,
		domain.PermissionNodeDelete,
		domain.PermissionNodeDrain,
		// Network permissions
		domain.PermissionNetworkCreate,
		domain.PermissionNetworkRead,
		domain.PermissionNetworkUpdate,
		domain.PermissionNetworkDelete,
		// Storage permissions
		domain.PermissionStorageCreate,
		domain.PermissionStorageRead,
		domain.PermissionStorageUpdate,
		domain.PermissionStorageDelete,
		// User permissions
		domain.PermissionUserCreate,
		domain.PermissionUserRead,
		domain.PermissionUserUpdate,
		domain.PermissionUserDelete,
		// System permissions
		domain.PermissionSystemConfig,
		domain.PermissionSystemAudit,
	}
}

// validatePermissions checks that all permissions are valid.
func (s *RoleService) validatePermissions(permissions []domain.Permission) error {
	allPerms := make(map[domain.Permission]bool)
	for _, p := range s.GetAllPermissions() {
		allPerms[p] = true
	}

	for _, perm := range permissions {
		if !allPerms[perm] {
			return fmt.Errorf("invalid permission: %s", perm)
		}
	}

	return nil
}
