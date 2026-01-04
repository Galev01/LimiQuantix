// Package postgres provides PostgreSQL repository implementations.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// GlobalRuleRepository implements global rule storage using PostgreSQL.
type GlobalRuleRepository struct {
	db     *DB
	logger *zap.Logger
}

// NewGlobalRuleRepository creates a new PostgreSQL global rule repository.
func NewGlobalRuleRepository(db *DB, logger *zap.Logger) *GlobalRuleRepository {
	return &GlobalRuleRepository{
		db:     db,
		logger: logger.With(zap.String("repository", "global_rule")),
	}
}

// Create stores a new global rule.
func (r *GlobalRuleRepository) Create(ctx context.Context, rule *domain.GlobalRule) (*domain.GlobalRule, error) {
	if rule.ID == "" {
		rule.ID = uuid.New().String()
	}

	conditionsJSON, err := json.Marshal(rule.Conditions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal conditions: %w", err)
	}

	actionsJSON, err := json.Marshal(rule.Actions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal actions: %w", err)
	}

	query := `
		INSERT INTO global_rules (id, name, description, category, priority, enabled, conditions, actions, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING created_at, updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		rule.ID,
		rule.Name,
		rule.Description,
		string(rule.Category),
		rule.Priority,
		rule.Enabled,
		conditionsJSON,
		actionsJSON,
		nullString(rule.CreatedBy),
	).Scan(&rule.CreatedAt, &rule.UpdatedAt)

	if err != nil {
		r.logger.Error("Failed to create global rule", zap.Error(err), zap.String("name", rule.Name))
		return nil, fmt.Errorf("failed to insert global rule: %w", err)
	}

	r.logger.Info("Created global rule", zap.String("id", rule.ID), zap.String("name", rule.Name))
	return rule, nil
}

// Get retrieves a global rule by ID.
func (r *GlobalRuleRepository) Get(ctx context.Context, id string) (*domain.GlobalRule, error) {
	query := `
		SELECT id, name, description, category, priority, enabled, conditions, actions, created_by, created_at, updated_at
		FROM global_rules
		WHERE id = $1
	`

	rule := &domain.GlobalRule{}
	var category string
	var conditionsJSON, actionsJSON []byte
	var createdBy *string

	err := r.db.pool.QueryRow(ctx, query, id).Scan(
		&rule.ID,
		&rule.Name,
		&rule.Description,
		&category,
		&rule.Priority,
		&rule.Enabled,
		&conditionsJSON,
		&actionsJSON,
		&createdBy,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get global rule: %w", err)
	}

	rule.Category = domain.GlobalRuleCategory(category)
	if createdBy != nil {
		rule.CreatedBy = *createdBy
	}
	if len(conditionsJSON) > 0 {
		if err := json.Unmarshal(conditionsJSON, &rule.Conditions); err != nil {
			r.logger.Warn("Failed to unmarshal conditions", zap.Error(err))
		}
	}
	if len(actionsJSON) > 0 {
		if err := json.Unmarshal(actionsJSON, &rule.Actions); err != nil {
			r.logger.Warn("Failed to unmarshal actions", zap.Error(err))
		}
	}

	return rule, nil
}

// List returns all global rules with optional filtering.
func (r *GlobalRuleRepository) List(ctx context.Context, filter GlobalRuleFilter) ([]*domain.GlobalRule, error) {
	query := `
		SELECT id, name, description, category, priority, enabled, conditions, actions, created_by, created_at, updated_at
		FROM global_rules
		WHERE 1=1
	`
	args := []interface{}{}
	argNum := 1

	if filter.Category != "" {
		query += fmt.Sprintf(" AND category = $%d", argNum)
		args = append(args, string(filter.Category))
		argNum++
	}

	if filter.EnabledOnly {
		query += " AND enabled = TRUE"
	}

	if filter.NameContains != "" {
		query += fmt.Sprintf(" AND name ILIKE $%d", argNum)
		args = append(args, "%"+filter.NameContains+"%")
		argNum++
	}

	query += " ORDER BY priority ASC, category ASC, name ASC"

	rows, err := r.db.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list global rules: %w", err)
	}
	defer rows.Close()

	var rules []*domain.GlobalRule
	for rows.Next() {
		rule := &domain.GlobalRule{}
		var category string
		var conditionsJSON, actionsJSON []byte
		var createdBy *string

		err := rows.Scan(
			&rule.ID,
			&rule.Name,
			&rule.Description,
			&category,
			&rule.Priority,
			&rule.Enabled,
			&conditionsJSON,
			&actionsJSON,
			&createdBy,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan global rule: %w", err)
		}

		rule.Category = domain.GlobalRuleCategory(category)
		if createdBy != nil {
			rule.CreatedBy = *createdBy
		}
		if len(conditionsJSON) > 0 {
			json.Unmarshal(conditionsJSON, &rule.Conditions)
		}
		if len(actionsJSON) > 0 {
			json.Unmarshal(actionsJSON, &rule.Actions)
		}

		rules = append(rules, rule)
	}

	return rules, nil
}

// ListEnabled returns all enabled rules sorted by priority (for evaluation).
func (r *GlobalRuleRepository) ListEnabled(ctx context.Context) ([]*domain.GlobalRule, error) {
	return r.List(ctx, GlobalRuleFilter{EnabledOnly: true})
}

// ListByCategory returns all rules in a specific category.
func (r *GlobalRuleRepository) ListByCategory(ctx context.Context, category domain.GlobalRuleCategory) ([]*domain.GlobalRule, error) {
	return r.List(ctx, GlobalRuleFilter{Category: category, EnabledOnly: true})
}

// Update updates a global rule.
func (r *GlobalRuleRepository) Update(ctx context.Context, rule *domain.GlobalRule) (*domain.GlobalRule, error) {
	conditionsJSON, err := json.Marshal(rule.Conditions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal conditions: %w", err)
	}

	actionsJSON, err := json.Marshal(rule.Actions)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal actions: %w", err)
	}

	query := `
		UPDATE global_rules
		SET name = $2, description = $3, category = $4, priority = $5, enabled = $6, conditions = $7, actions = $8
		WHERE id = $1
		RETURNING updated_at
	`

	err = r.db.pool.QueryRow(ctx, query,
		rule.ID,
		rule.Name,
		rule.Description,
		string(rule.Category),
		rule.Priority,
		rule.Enabled,
		conditionsJSON,
		actionsJSON,
	).Scan(&rule.UpdatedAt)

	if err == pgx.ErrNoRows {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update global rule: %w", err)
	}

	r.logger.Info("Updated global rule", zap.String("id", rule.ID))
	return rule, nil
}

// Delete removes a global rule.
func (r *GlobalRuleRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM global_rules WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete global rule: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Deleted global rule", zap.String("id", id))
	return nil
}

// SetEnabled enables or disables a global rule.
func (r *GlobalRuleRepository) SetEnabled(ctx context.Context, id string, enabled bool) error {
	query := `UPDATE global_rules SET enabled = $2 WHERE id = $1`

	result, err := r.db.pool.Exec(ctx, query, id, enabled)
	if err != nil {
		return fmt.Errorf("failed to set global rule enabled: %w", err)
	}

	if result.RowsAffected() == 0 {
		return domain.ErrNotFound
	}

	r.logger.Info("Set global rule enabled", zap.String("id", id), zap.Bool("enabled", enabled))
	return nil
}

// GlobalRuleFilter defines filter criteria for listing global rules.
type GlobalRuleFilter struct {
	Category     domain.GlobalRuleCategory
	EnabledOnly  bool
	NameContains string
}
