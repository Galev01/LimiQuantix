// Package network implements the SecurityGroupService.
package network

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/network/ovn"
	networkv1 "github.com/limiquantix/limiquantix/pkg/api/limiquantix/network/v1"
)

// SecurityGroupService implements the networkv1connect.SecurityGroupServiceHandler interface.
type SecurityGroupService struct {
	repo      SecurityGroupRepository
	ovnClient *ovn.NorthboundClient
	logger    *zap.Logger
}

// NewSecurityGroupService creates a new SecurityGroupService.
func NewSecurityGroupService(repo SecurityGroupRepository, logger *zap.Logger) *SecurityGroupService {
	return &SecurityGroupService{
		repo:   repo,
		logger: logger,
	}
}

// NewSecurityGroupServiceWithOVN creates a new SecurityGroupService with OVN backend.
func NewSecurityGroupServiceWithOVN(repo SecurityGroupRepository, ovnClient *ovn.NorthboundClient, logger *zap.Logger) *SecurityGroupService {
	return &SecurityGroupService{
		repo:      repo,
		ovnClient: ovnClient,
		logger:    logger,
	}
}

// CreateSecurityGroup creates a new security group.
func (s *SecurityGroupService) CreateSecurityGroup(
	ctx context.Context,
	req *connect.Request[networkv1.CreateSecurityGroupRequest],
) (*connect.Response[networkv1.SecurityGroup], error) {
	logger := s.logger.With(
		zap.String("method", "CreateSecurityGroup"),
		zap.String("sg_name", req.Msg.Name),
	)
	logger.Info("Creating security group")

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name is required"))
	}

	sg := convertCreateSecurityGroupRequestToDomain(req.Msg)

	// Assign IDs to rules
	for i := range sg.Rules {
		if sg.Rules[i].ID == "" {
			sg.Rules[i].ID = uuid.NewString()
		}
	}

	createdSG, err := s.repo.Create(ctx, sg)
	if err != nil {
		logger.Error("Failed to create security group", zap.Error(err))
		if err == domain.ErrAlreadyExists {
			return nil, connect.NewError(connect.CodeAlreadyExists, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Create OVN ACLs if client is available
	if s.ovnClient != nil {
		if err := s.ovnClient.CreateSecurityGroupACLs(ctx, createdSG); err != nil {
			logger.Warn("Failed to create OVN ACLs", zap.Error(err))
			// Don't fail the request, ACLs can be synced later
		}
	}

	logger.Info("Security group created successfully", zap.String("sg_id", createdSG.ID))
	return connect.NewResponse(convertSecurityGroupToProto(createdSG)), nil
}

// GetSecurityGroup retrieves a security group by ID.
func (s *SecurityGroupService) GetSecurityGroup(
	ctx context.Context,
	req *connect.Request[networkv1.GetSecurityGroupRequest],
) (*connect.Response[networkv1.SecurityGroup], error) {
	logger := s.logger.With(
		zap.String("method", "GetSecurityGroup"),
		zap.String("sg_id", req.Msg.Id),
	)
	logger.Debug("Getting security group")

	sg, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(convertSecurityGroupToProto(sg)), nil
}

// ListSecurityGroups returns all security groups.
func (s *SecurityGroupService) ListSecurityGroups(
	ctx context.Context,
	req *connect.Request[networkv1.ListSecurityGroupsRequest],
) (*connect.Response[networkv1.ListSecurityGroupsResponse], error) {
	logger := s.logger.With(zap.String("method", "ListSecurityGroups"))
	logger.Debug("Listing security groups")

	limit := int(req.Msg.PageSize)
	if limit == 0 {
		limit = 100
	}

	sgs, total, err := s.repo.List(ctx, req.Msg.ProjectId, limit, 0)
	if err != nil {
		logger.Error("Failed to list security groups", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&networkv1.ListSecurityGroupsResponse{
		SecurityGroups: convertSecurityGroupsToProtos(sgs),
		TotalCount:     int32(total),
	}), nil
}

// UpdateSecurityGroup updates a security group.
func (s *SecurityGroupService) UpdateSecurityGroup(
	ctx context.Context,
	req *connect.Request[networkv1.UpdateSecurityGroupRequest],
) (*connect.Response[networkv1.SecurityGroup], error) {
	logger := s.logger.With(
		zap.String("method", "UpdateSecurityGroup"),
		zap.String("sg_id", req.Msg.Id),
	)
	logger.Info("Updating security group")

	sg, err := s.repo.Get(ctx, req.Msg.Id)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if req.Msg.Description != "" {
		sg.Description = req.Msg.Description
	}
	if req.Msg.Labels != nil {
		sg.Labels = req.Msg.Labels
	}
	sg.UpdatedAt = time.Now()

	updatedSG, err := s.repo.Update(ctx, sg)
	if err != nil {
		logger.Error("Failed to update security group", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Security group updated successfully", zap.String("sg_id", updatedSG.ID))
	return connect.NewResponse(convertSecurityGroupToProto(updatedSG)), nil
}

// DeleteSecurityGroup removes a security group.
func (s *SecurityGroupService) DeleteSecurityGroup(
	ctx context.Context,
	req *connect.Request[networkv1.DeleteSecurityGroupRequest],
) (*connect.Response[emptypb.Empty], error) {
	logger := s.logger.With(
		zap.String("method", "DeleteSecurityGroup"),
		zap.String("sg_id", req.Msg.Id),
	)
	logger.Info("Deleting security group")

	// TODO: Check if security group is in use by any ports

	// Delete OVN ACLs if client is available
	if s.ovnClient != nil {
		if err := s.ovnClient.DeleteSecurityGroupACLs(ctx, req.Msg.Id); err != nil {
			logger.Warn("Failed to delete OVN ACLs", zap.Error(err))
			// Continue with repo deletion
		}
	}

	if err := s.repo.Delete(ctx, req.Msg.Id); err != nil {
		logger.Error("Failed to delete security group", zap.Error(err))
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Security group deleted successfully", zap.String("sg_id", req.Msg.Id))
	return connect.NewResponse(&emptypb.Empty{}), nil
}

// AddRule adds a firewall rule to a security group.
func (s *SecurityGroupService) AddRule(
	ctx context.Context,
	req *connect.Request[networkv1.AddRuleRequest],
) (*connect.Response[networkv1.SecurityGroup], error) {
	logger := s.logger.With(
		zap.String("method", "AddRule"),
		zap.String("sg_id", req.Msg.SecurityGroupId),
	)
	logger.Info("Adding rule to security group")

	sg, err := s.repo.Get(ctx, req.Msg.SecurityGroupId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Convert and add rule
	rule := convertRuleFromProto(req.Msg.Rule)
	if rule.ID == "" {
		rule.ID = uuid.NewString()
	}
	sg.Rules = append(sg.Rules, *rule)
	sg.UpdatedAt = time.Now()

	updatedSG, err := s.repo.Update(ctx, sg)
	if err != nil {
		logger.Error("Failed to add rule", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Rule added successfully", zap.String("rule_id", rule.ID))
	return connect.NewResponse(convertSecurityGroupToProto(updatedSG)), nil
}

// RemoveRule removes a firewall rule from a security group.
func (s *SecurityGroupService) RemoveRule(
	ctx context.Context,
	req *connect.Request[networkv1.RemoveRuleRequest],
) (*connect.Response[networkv1.SecurityGroup], error) {
	logger := s.logger.With(
		zap.String("method", "RemoveRule"),
		zap.String("sg_id", req.Msg.SecurityGroupId),
		zap.String("rule_id", req.Msg.RuleId),
	)
	logger.Info("Removing rule from security group")

	sg, err := s.repo.Get(ctx, req.Msg.SecurityGroupId)
	if err != nil {
		if err == domain.ErrNotFound {
			return nil, connect.NewError(connect.CodeNotFound, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Find and remove rule
	var newRules []domain.SecurityGroupRule
	found := false
	for _, rule := range sg.Rules {
		if rule.ID == req.Msg.RuleId {
			found = true
			continue
		}
		newRules = append(newRules, rule)
	}

	if !found {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("rule %s not found", req.Msg.RuleId))
	}

	sg.Rules = newRules
	sg.UpdatedAt = time.Now()

	updatedSG, err := s.repo.Update(ctx, sg)
	if err != nil {
		logger.Error("Failed to remove rule", zap.Error(err))
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	logger.Info("Rule removed successfully", zap.String("rule_id", req.Msg.RuleId))
	return connect.NewResponse(convertSecurityGroupToProto(updatedSG)), nil
}
