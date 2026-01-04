// Package admin provides administrative services for the limiquantix platform.
package admin

import (
	"context"
	"fmt"
	"sort"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
)

// GlobalRuleRepository defines the interface for global rule data access.
type GlobalRuleRepository interface {
	Create(ctx context.Context, rule *domain.GlobalRule) (*domain.GlobalRule, error)
	Get(ctx context.Context, id string) (*domain.GlobalRule, error)
	List(ctx context.Context, filter postgres.GlobalRuleFilter) ([]*domain.GlobalRule, error)
	ListEnabled(ctx context.Context) ([]*domain.GlobalRule, error)
	ListByCategory(ctx context.Context, category domain.GlobalRuleCategory) ([]*domain.GlobalRule, error)
	Update(ctx context.Context, rule *domain.GlobalRule) (*domain.GlobalRule, error)
	Delete(ctx context.Context, id string) error
	SetEnabled(ctx context.Context, id string, enabled bool) error
}

// GlobalRuleService provides global rule management functionality.
type GlobalRuleService struct {
	ruleRepo GlobalRuleRepository
	logger   *zap.Logger
}

// NewGlobalRuleService creates a new global rule service.
func NewGlobalRuleService(ruleRepo GlobalRuleRepository, logger *zap.Logger) *GlobalRuleService {
	return &GlobalRuleService{
		ruleRepo: ruleRepo,
		logger:   logger.With(zap.String("service", "global_rule")),
	}
}

// Create creates a new global rule.
func (s *GlobalRuleService) Create(ctx context.Context, rule *domain.GlobalRule) (*domain.GlobalRule, error) {
	s.logger.Info("Creating global rule", zap.String("name", rule.Name), zap.String("category", string(rule.Category)))

	// Validate rule
	if err := s.validateRule(rule); err != nil {
		return nil, err
	}

	// Set defaults
	if rule.Priority == 0 {
		rule.Priority = 100
	}
	rule.Enabled = true

	created, err := s.ruleRepo.Create(ctx, rule)
	if err != nil {
		s.logger.Error("Failed to create global rule", zap.Error(err), zap.String("name", rule.Name))
		return nil, fmt.Errorf("failed to create global rule: %w", err)
	}

	s.logger.Info("Created global rule", zap.String("id", created.ID), zap.String("name", created.Name))
	return created, nil
}

// Get retrieves a global rule by ID.
func (s *GlobalRuleService) Get(ctx context.Context, id string) (*domain.GlobalRule, error) {
	return s.ruleRepo.Get(ctx, id)
}

// List returns all global rules with optional filtering.
func (s *GlobalRuleService) List(ctx context.Context, filter postgres.GlobalRuleFilter) ([]*domain.GlobalRule, error) {
	return s.ruleRepo.List(ctx, filter)
}

// ListAll returns all global rules.
func (s *GlobalRuleService) ListAll(ctx context.Context) ([]*domain.GlobalRule, error) {
	return s.ruleRepo.List(ctx, postgres.GlobalRuleFilter{})
}

// ListByCategory returns all rules in a specific category.
func (s *GlobalRuleService) ListByCategory(ctx context.Context, category domain.GlobalRuleCategory) ([]*domain.GlobalRule, error) {
	return s.ruleRepo.ListByCategory(ctx, category)
}

// Update updates a global rule.
func (s *GlobalRuleService) Update(ctx context.Context, rule *domain.GlobalRule) (*domain.GlobalRule, error) {
	s.logger.Info("Updating global rule", zap.String("id", rule.ID))

	// Validate rule
	if err := s.validateRule(rule); err != nil {
		return nil, err
	}

	updated, err := s.ruleRepo.Update(ctx, rule)
	if err != nil {
		s.logger.Error("Failed to update global rule", zap.Error(err), zap.String("id", rule.ID))
		return nil, fmt.Errorf("failed to update global rule: %w", err)
	}

	s.logger.Info("Updated global rule", zap.String("id", rule.ID))
	return updated, nil
}

// Delete removes a global rule.
func (s *GlobalRuleService) Delete(ctx context.Context, id string) error {
	s.logger.Info("Deleting global rule", zap.String("id", id))

	if err := s.ruleRepo.Delete(ctx, id); err != nil {
		s.logger.Error("Failed to delete global rule", zap.Error(err), zap.String("id", id))
		return fmt.Errorf("failed to delete global rule: %w", err)
	}

	s.logger.Info("Deleted global rule", zap.String("id", id))
	return nil
}

// Enable enables a global rule.
func (s *GlobalRuleService) Enable(ctx context.Context, id string) error {
	s.logger.Info("Enabling global rule", zap.String("id", id))
	return s.ruleRepo.SetEnabled(ctx, id, true)
}

// Disable disables a global rule.
func (s *GlobalRuleService) Disable(ctx context.Context, id string) error {
	s.logger.Info("Disabling global rule", zap.String("id", id))
	return s.ruleRepo.SetEnabled(ctx, id, false)
}

// EvaluationResult contains the result of rule evaluation.
type EvaluationResult struct {
	RuleID      string                    `json:"rule_id"`
	RuleName    string                    `json:"rule_name"`
	Category    string                    `json:"category"`
	Matched     bool                      `json:"matched"`
	Action      *domain.GlobalRuleAction  `json:"action,omitempty"`
	Blocked     bool                      `json:"blocked"`
	Message     string                    `json:"message,omitempty"`
}

// Evaluate evaluates all enabled rules against a context.
func (s *GlobalRuleService) Evaluate(ctx context.Context, ruleContext map[string]interface{}) ([]*EvaluationResult, error) {
	rules, err := s.ruleRepo.ListEnabled(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get enabled rules: %w", err)
	}

	// Sort by priority
	sort.Slice(rules, func(i, j int) bool {
		return rules[i].Priority < rules[j].Priority
	})

	var results []*EvaluationResult
	for _, rule := range rules {
		matched, action := rule.Evaluate(ruleContext)
		
		result := &EvaluationResult{
			RuleID:   rule.ID,
			RuleName: rule.Name,
			Category: string(rule.Category),
			Matched:  matched,
		}

		if matched && action != nil {
			result.Action = action
			result.Message = action.Message
			result.Blocked = action.Type == "deny"
		}

		if matched {
			results = append(results, result)
		}
	}

	return results, nil
}

// EvaluateCategory evaluates only rules in a specific category.
func (s *GlobalRuleService) EvaluateCategory(ctx context.Context, category domain.GlobalRuleCategory, ruleContext map[string]interface{}) ([]*EvaluationResult, error) {
	rules, err := s.ruleRepo.ListByCategory(ctx, category)
	if err != nil {
		return nil, fmt.Errorf("failed to get category rules: %w", err)
	}

	// Sort by priority
	sort.Slice(rules, func(i, j int) bool {
		return rules[i].Priority < rules[j].Priority
	})

	var results []*EvaluationResult
	for _, rule := range rules {
		matched, action := rule.Evaluate(ruleContext)
		
		result := &EvaluationResult{
			RuleID:   rule.ID,
			RuleName: rule.Name,
			Category: string(rule.Category),
			Matched:  matched,
		}

		if matched && action != nil {
			result.Action = action
			result.Message = action.Message
			result.Blocked = action.Type == "deny"
		}

		if matched {
			results = append(results, result)
		}
	}

	return results, nil
}

// CheckBlocked checks if any rule would block an operation.
func (s *GlobalRuleService) CheckBlocked(ctx context.Context, category domain.GlobalRuleCategory, ruleContext map[string]interface{}) (blocked bool, message string, err error) {
	results, err := s.EvaluateCategory(ctx, category, ruleContext)
	if err != nil {
		return false, "", err
	}

	for _, result := range results {
		if result.Blocked {
			return true, result.Message, nil
		}
	}

	return false, "", nil
}

// ValidateVMCreation validates a VM creation request against compute rules.
func (s *GlobalRuleService) ValidateVMCreation(ctx context.Context, cpuCores int, memoryMiB int64) (bool, string, error) {
	ruleContext := map[string]interface{}{
		"vm.cpu.cores":      cpuCores,
		"vm.memory.size_mib": memoryMiB,
	}

	return s.CheckBlocked(ctx, domain.GlobalRuleCategoryCompute, ruleContext)
}

// ValidateVolumeCreation validates a volume creation request against storage rules.
func (s *GlobalRuleService) ValidateVolumeCreation(ctx context.Context, sizeBytes int64) (bool, string, error) {
	ruleContext := map[string]interface{}{
		"volume.size_bytes": sizeBytes,
	}

	return s.CheckBlocked(ctx, domain.GlobalRuleCategoryStorage, ruleContext)
}

// validateRule validates a global rule.
func (s *GlobalRuleService) validateRule(rule *domain.GlobalRule) error {
	if rule.Name == "" {
		return fmt.Errorf("rule name is required")
	}

	if rule.Category == "" {
		return fmt.Errorf("rule category is required")
	}

	// Validate category
	validCategories := map[domain.GlobalRuleCategory]bool{
		domain.GlobalRuleCategoryCompute:  true,
		domain.GlobalRuleCategoryStorage:  true,
		domain.GlobalRuleCategoryNetwork:  true,
		domain.GlobalRuleCategorySecurity: true,
	}
	if !validCategories[rule.Category] {
		return fmt.Errorf("invalid rule category: %s", rule.Category)
	}

	// Validate conditions
	if len(rule.Conditions) == 0 {
		return fmt.Errorf("at least one condition is required")
	}

	for i, cond := range rule.Conditions {
		if cond.Field == "" {
			return fmt.Errorf("condition %d: field is required", i+1)
		}
		if cond.Operator == "" {
			return fmt.Errorf("condition %d: operator is required", i+1)
		}
		if !s.isValidOperator(cond.Operator) {
			return fmt.Errorf("condition %d: invalid operator: %s", i+1, cond.Operator)
		}
	}

	// Validate actions
	if len(rule.Actions) == 0 {
		return fmt.Errorf("at least one action is required")
	}

	for i, action := range rule.Actions {
		if action.Type == "" {
			return fmt.Errorf("action %d: type is required", i+1)
		}
		if !s.isValidActionType(action.Type) {
			return fmt.Errorf("action %d: invalid action type: %s", i+1, action.Type)
		}
	}

	// Validate priority
	if rule.Priority < 1 || rule.Priority > 1000 {
		return fmt.Errorf("priority must be between 1 and 1000")
	}

	return nil
}

// isValidOperator checks if an operator is valid.
func (s *GlobalRuleService) isValidOperator(op string) bool {
	for _, valid := range domain.RuleOperators {
		if op == valid {
			return true
		}
	}
	return false
}

// isValidActionType checks if an action type is valid.
func (s *GlobalRuleService) isValidActionType(actionType string) bool {
	for _, valid := range domain.RuleActionTypes {
		if actionType == valid {
			return true
		}
	}
	return false
}
