// Package server provides the HTTP/Connect-RPC server for the control plane.
package server

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
	"github.com/limiquantix/limiquantix/internal/repository/postgres"
	"github.com/limiquantix/limiquantix/internal/services/admin"
)

// AdminHandler handles admin REST API requests.
type AdminHandler struct {
	roleService    *admin.RoleService
	apiKeyService  *admin.APIKeyService
	auditService   *admin.AuditService
	orgService     *admin.OrganizationService
	emailService   *admin.AdminEmailService
	ruleService    *admin.GlobalRuleService
	logger         *zap.Logger
}

// NewAdminHandler creates a new admin handler.
func NewAdminHandler(
	roleService *admin.RoleService,
	apiKeyService *admin.APIKeyService,
	auditService *admin.AuditService,
	orgService *admin.OrganizationService,
	emailService *admin.AdminEmailService,
	ruleService *admin.GlobalRuleService,
	logger *zap.Logger,
) *AdminHandler {
	return &AdminHandler{
		roleService:   roleService,
		apiKeyService: apiKeyService,
		auditService:  auditService,
		orgService:    orgService,
		emailService:  emailService,
		ruleService:   ruleService,
		logger:        logger.With(zap.String("handler", "admin")),
	}
}

// RegisterRoutes registers all admin routes on the given mux.
func (h *AdminHandler) RegisterRoutes(mux *http.ServeMux) {
	// Roles
	mux.HandleFunc("/api/admin/roles", h.handleRoles)
	mux.HandleFunc("/api/admin/roles/", h.handleRoleByID)
	mux.HandleFunc("/api/admin/permissions", h.handlePermissions)

	// Users role assignment
	mux.HandleFunc("/api/admin/users/", h.handleUserRoles)

	// API Keys
	mux.HandleFunc("/api/admin/api-keys", h.handleAPIKeys)
	mux.HandleFunc("/api/admin/api-keys/", h.handleAPIKeyByID)

	// Audit Logs
	mux.HandleFunc("/api/admin/audit-logs", h.handleAuditLogs)
	mux.HandleFunc("/api/admin/audit-logs/export", h.handleAuditExport)
	mux.HandleFunc("/api/admin/audit-logs/stats", h.handleAuditStats)

	// Organization
	mux.HandleFunc("/api/admin/organization", h.handleOrganization)
	mux.HandleFunc("/api/admin/organization/settings", h.handleOrganizationSettings)
	mux.HandleFunc("/api/admin/organization/branding", h.handleOrganizationBranding)

	// Admin Emails
	mux.HandleFunc("/api/admin/emails", h.handleAdminEmails)
	mux.HandleFunc("/api/admin/emails/", h.handleAdminEmailByID)
	mux.HandleFunc("/api/admin/emails/test", h.handleTestEmail)

	// Global Rules
	mux.HandleFunc("/api/admin/rules", h.handleGlobalRules)
	mux.HandleFunc("/api/admin/rules/", h.handleGlobalRuleByID)
	mux.HandleFunc("/api/admin/rules/evaluate", h.handleRuleEvaluate)
}

// =============================================================================
// ROLES
// =============================================================================

func (h *AdminHandler) handleRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		// List roles
		filter := postgres.RoleFilter{
			NameContains: r.URL.Query().Get("name"),
		}
		if typeStr := r.URL.Query().Get("type"); typeStr != "" {
			filter.Type = domain.RoleType(typeStr)
		}

		roles, err := h.roleService.ListRoles(ctx, filter)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to list roles", err)
			return
		}
		h.writeJSON(w, http.StatusOK, roles)

	case http.MethodPost:
		// Create role
		var req struct {
			Name        string              `json:"name"`
			Description string              `json:"description"`
			Permissions []domain.Permission `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		role, err := h.roleService.CreateRole(ctx, req.Name, req.Description, req.Permissions)
		if err != nil {
			if err == domain.ErrAlreadyExists {
				h.writeError(w, http.StatusConflict, "Role already exists", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusCreated, role)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleRoleByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id := strings.TrimPrefix(r.URL.Path, "/api/admin/roles/")

	switch r.Method {
	case http.MethodGet:
		role, err := h.roleService.GetRole(ctx, id)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Role not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to get role", err)
			return
		}
		h.writeJSON(w, http.StatusOK, role)

	case http.MethodPut:
		var req struct {
			Name        string              `json:"name"`
			Description string              `json:"description"`
			Permissions []domain.Permission `json:"permissions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		role, err := h.roleService.UpdateRole(ctx, id, req.Name, req.Description, req.Permissions)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Role not found", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusOK, role)

	case http.MethodDelete:
		if err := h.roleService.DeleteRole(ctx, id); err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Role not found", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handlePermissions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		return
	}

	permissions := h.roleService.GetAllPermissions()
	h.writeJSON(w, http.StatusOK, permissions)
}

func (h *AdminHandler) handleUserRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	// Parse: /api/admin/users/{userID}/roles or /api/admin/users/{userID}/roles/{roleID}
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/users/")
	parts := strings.Split(path, "/")
	
	if len(parts) < 2 || parts[1] != "roles" {
		h.writeError(w, http.StatusBadRequest, "Invalid path", nil)
		return
	}
	
	userID := parts[0]

	switch r.Method {
	case http.MethodGet:
		// Get user's roles
		roles, err := h.roleService.GetUserRoles(ctx, userID)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to get user roles", err)
			return
		}
		h.writeJSON(w, http.StatusOK, roles)

	case http.MethodPost:
		// Assign role to user
		var req struct {
			RoleID     string `json:"role_id"`
			AssignedBy string `json:"assigned_by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		if err := h.roleService.AssignRoleToUser(ctx, userID, req.RoleID, req.AssignedBy); err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	case http.MethodDelete:
		// Remove role from user
		if len(parts) < 3 {
			h.writeError(w, http.StatusBadRequest, "Role ID required", nil)
			return
		}
		roleID := parts[2]

		if err := h.roleService.RemoveRoleFromUser(ctx, userID, roleID); err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

// =============================================================================
// API KEYS
// =============================================================================

func (h *AdminHandler) handleAPIKeys(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		filter := postgres.APIKeyFilter{
			CreatedBy:    r.URL.Query().Get("created_by"),
			NameContains: r.URL.Query().Get("name"),
		}
		if status := r.URL.Query().Get("status"); status != "" {
			filter.Status = domain.APIKeyStatus(status)
		}

		keys, err := h.apiKeyService.List(ctx, filter)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to list API keys", err)
			return
		}
		h.writeJSON(w, http.StatusOK, keys)

	case http.MethodPost:
		var req struct {
			Name        string              `json:"name"`
			Permissions []domain.Permission `json:"permissions"`
			ExpiresIn   *int64              `json:"expires_in_hours,omitempty"`
			CreatedBy   string              `json:"created_by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		genReq := &admin.GenerateKeyRequest{
			Name:        req.Name,
			Permissions: req.Permissions,
			CreatedBy:   req.CreatedBy,
		}
		if req.ExpiresIn != nil {
			duration := time.Duration(*req.ExpiresIn) * time.Hour
			genReq.ExpiresIn = &duration
		}

		resp, err := h.apiKeyService.Generate(ctx, genReq)
		if err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}

		// Return the key with the raw key (only shown once!)
		h.writeJSON(w, http.StatusCreated, map[string]interface{}{
			"key":     resp.Key,
			"raw_key": resp.RawKey,
			"warning": "Store this key securely. It will not be shown again.",
		})

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleAPIKeyByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/api-keys/")
	parts := strings.Split(path, "/")
	id := parts[0]

	// Handle /api/admin/api-keys/{id}/revoke
	if len(parts) > 1 && parts[1] == "revoke" && r.Method == http.MethodPost {
		if err := h.apiKeyService.Revoke(ctx, id); err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "API key not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to revoke API key", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch r.Method {
	case http.MethodGet:
		key, err := h.apiKeyService.Get(ctx, id)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "API key not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to get API key", err)
			return
		}
		h.writeJSON(w, http.StatusOK, key)

	case http.MethodDelete:
		if err := h.apiKeyService.Delete(ctx, id); err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "API key not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to delete API key", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

// =============================================================================
// AUDIT LOGS
// =============================================================================

func (h *AdminHandler) handleAuditLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		return
	}

	ctx := r.Context()
	q := r.URL.Query()

	filter := postgres.AuditFilter{
		UserID:       q.Get("user_id"),
		Username:     q.Get("username"),
		ResourceType: q.Get("resource_type"),
		ResourceID:   q.Get("resource_id"),
		IPAddress:    q.Get("ip_address"),
	}

	if action := q.Get("action"); action != "" {
		filter.Action = domain.AuditAction(action)
	}

	if start := q.Get("start_time"); start != "" {
		if t, err := time.Parse(time.RFC3339, start); err == nil {
			filter.StartTime = &t
		}
	}

	if end := q.Get("end_time"); end != "" {
		if t, err := time.Parse(time.RFC3339, end); err == nil {
			filter.EndTime = &t
		}
	}

	limit := 50
	if l := q.Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil {
			limit = parsed
		}
	}

	offset := 0
	if o := q.Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil {
			offset = parsed
		}
	}

	entries, total, err := h.auditService.Query(ctx, filter, limit, offset)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "Failed to query audit logs", err)
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]interface{}{
		"entries": entries,
		"total":   total,
		"limit":   limit,
		"offset":  offset,
	})
}

func (h *AdminHandler) handleAuditExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		return
	}

	ctx := r.Context()
	q := r.URL.Query()

	filter := postgres.AuditFilter{}
	if start := q.Get("start_time"); start != "" {
		if t, err := time.Parse(time.RFC3339, start); err == nil {
			filter.StartTime = &t
		}
	}
	if end := q.Get("end_time"); end != "" {
		if t, err := time.Parse(time.RFC3339, end); err == nil {
			filter.EndTime = &t
		}
	}

	format := q.Get("format")
	if format == "" {
		format = "csv"
	}

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=audit_logs.csv")
		if err := h.auditService.ExportToCSV(ctx, filter, w); err != nil {
			h.logger.Error("Failed to export audit logs", zap.Error(err))
		}

	case "json":
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", "attachment; filename=audit_logs.json")
		if err := h.auditService.ExportToJSON(ctx, filter, w); err != nil {
			h.logger.Error("Failed to export audit logs", zap.Error(err))
		}

	default:
		h.writeError(w, http.StatusBadRequest, "Invalid format. Use 'csv' or 'json'", nil)
	}
}

func (h *AdminHandler) handleAuditStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		return
	}

	ctx := r.Context()
	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if parsed, err := strconv.Atoi(d); err == nil && parsed > 0 {
			days = parsed
		}
	}

	stats, err := h.auditService.GetRecentStats(ctx, days)
	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "Failed to get audit stats", err)
		return
	}

	h.writeJSON(w, http.StatusOK, stats)
}

// =============================================================================
// ORGANIZATION
// =============================================================================

func (h *AdminHandler) handleOrganization(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		org, err := h.orgService.Get(ctx)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Organization not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to get organization", err)
			return
		}
		h.writeJSON(w, http.StatusOK, org)

	case http.MethodPut:
		var org domain.Organization
		if err := json.NewDecoder(r.Body).Decode(&org); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		updated, err := h.orgService.Update(ctx, &org)
		if err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusOK, updated)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleOrganizationSettings(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		settings, err := h.orgService.GetSettings(ctx)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to get settings", err)
			return
		}
		h.writeJSON(w, http.StatusOK, settings)

	case http.MethodPut:
		org, err := h.orgService.Get(ctx)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to get organization", err)
			return
		}

		var settings domain.OrganizationSettings
		if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		if err := h.orgService.UpdateSettings(ctx, org.ID, settings); err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusOK, settings)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleOrganizationBranding(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		branding, err := h.orgService.GetBranding(ctx)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to get branding", err)
			return
		}
		h.writeJSON(w, http.StatusOK, branding)

	case http.MethodPut:
		org, err := h.orgService.Get(ctx)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to get organization", err)
			return
		}

		var branding domain.OrganizationBranding
		if err := json.NewDecoder(r.Body).Decode(&branding); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		if err := h.orgService.UpdateBranding(ctx, org.ID, branding); err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusOK, branding)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

// =============================================================================
// ADMIN EMAILS
// =============================================================================

func (h *AdminHandler) handleAdminEmails(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		filter := postgres.AdminEmailFilter{}
		if role := r.URL.Query().Get("role"); role != "" {
			filter.Role = domain.AdminEmailRole(role)
		}
		if r.URL.Query().Get("verified_only") == "true" {
			filter.VerifiedOnly = true
		}

		emails, err := h.emailService.List(ctx, filter)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to list admin emails", err)
			return
		}
		h.writeJSON(w, http.StatusOK, emails)

	case http.MethodPost:
		var req struct {
			Email string               `json:"email"`
			Name  string               `json:"name"`
			Role  domain.AdminEmailRole `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		if req.Role == "" {
			req.Role = domain.AdminEmailSecondary
		}

		email, err := h.emailService.Add(ctx, req.Email, req.Name, req.Role)
		if err != nil {
			if err == domain.ErrAlreadyExists {
				h.writeError(w, http.StatusConflict, "Email already exists", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusCreated, email)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleAdminEmailByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/emails/")
	parts := strings.Split(path, "/")
	id := parts[0]

	// Handle /api/admin/emails/{id}/verify
	if len(parts) > 1 && parts[1] == "verify" && r.Method == http.MethodPost {
		if err := h.emailService.Verify(ctx, id); err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to verify email", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	switch r.Method {
	case http.MethodGet:
		email, err := h.emailService.Get(ctx, id)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Admin email not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to get admin email", err)
			return
		}
		h.writeJSON(w, http.StatusOK, email)

	case http.MethodPut:
		var req struct {
			Name          string                     `json:"name"`
			Role          domain.AdminEmailRole      `json:"role"`
			Notifications domain.NotificationSettings `json:"notifications"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		email, err := h.emailService.Update(ctx, id, req.Name, req.Role, req.Notifications)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Admin email not found", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusOK, email)

	case http.MethodDelete:
		if err := h.emailService.Remove(ctx, id); err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Admin email not found", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleTestEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		return
	}

	ctx := r.Context()
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	if err := h.emailService.SendTestEmail(ctx, req.ID); err != nil {
		h.writeError(w, http.StatusInternalServerError, err.Error(), err)
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"message": "Test email sent"})
}

// =============================================================================
// GLOBAL RULES
// =============================================================================

func (h *AdminHandler) handleGlobalRules(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	switch r.Method {
	case http.MethodGet:
		filter := postgres.GlobalRuleFilter{
			NameContains: r.URL.Query().Get("name"),
		}
		if category := r.URL.Query().Get("category"); category != "" {
			filter.Category = domain.GlobalRuleCategory(category)
		}
		if r.URL.Query().Get("enabled_only") == "true" {
			filter.EnabledOnly = true
		}

		rules, err := h.ruleService.List(ctx, filter)
		if err != nil {
			h.writeError(w, http.StatusInternalServerError, "Failed to list global rules", err)
			return
		}
		h.writeJSON(w, http.StatusOK, rules)

	case http.MethodPost:
		var rule domain.GlobalRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}

		created, err := h.ruleService.Create(ctx, &rule)
		if err != nil {
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusCreated, created)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleGlobalRuleByID(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	
	path := strings.TrimPrefix(r.URL.Path, "/api/admin/rules/")
	parts := strings.Split(path, "/")
	id := parts[0]

	// Handle /api/admin/rules/{id}/enable or /disable
	if len(parts) > 1 {
		switch parts[1] {
		case "enable":
			if r.Method == http.MethodPost {
				if err := h.ruleService.Enable(ctx, id); err != nil {
					h.writeError(w, http.StatusInternalServerError, "Failed to enable rule", err)
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
		case "disable":
			if r.Method == http.MethodPost {
				if err := h.ruleService.Disable(ctx, id); err != nil {
					h.writeError(w, http.StatusInternalServerError, "Failed to disable rule", err)
					return
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
	}

	switch r.Method {
	case http.MethodGet:
		rule, err := h.ruleService.Get(ctx, id)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Global rule not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to get global rule", err)
			return
		}
		h.writeJSON(w, http.StatusOK, rule)

	case http.MethodPut:
		var rule domain.GlobalRule
		if err := json.NewDecoder(r.Body).Decode(&rule); err != nil {
			h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
			return
		}
		rule.ID = id

		updated, err := h.ruleService.Update(ctx, &rule)
		if err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Global rule not found", err)
				return
			}
			h.writeError(w, http.StatusBadRequest, err.Error(), err)
			return
		}
		h.writeJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if err := h.ruleService.Delete(ctx, id); err != nil {
			if err == domain.ErrNotFound {
				h.writeError(w, http.StatusNotFound, "Global rule not found", err)
				return
			}
			h.writeError(w, http.StatusInternalServerError, "Failed to delete global rule", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
	}
}

func (h *AdminHandler) handleRuleEvaluate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.writeError(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		return
	}

	ctx := r.Context()
	var req struct {
		Category string                 `json:"category,omitempty"`
		Context  map[string]interface{} `json:"context"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.writeError(w, http.StatusBadRequest, "Invalid request body", err)
		return
	}

	var results []*admin.EvaluationResult
	var err error

	if req.Category != "" {
		results, err = h.ruleService.EvaluateCategory(ctx, domain.GlobalRuleCategory(req.Category), req.Context)
	} else {
		results, err = h.ruleService.Evaluate(ctx, req.Context)
	}

	if err != nil {
		h.writeError(w, http.StatusInternalServerError, "Failed to evaluate rules", err)
		return
	}

	h.writeJSON(w, http.StatusOK, results)
}

// =============================================================================
// HELPERS
// =============================================================================

func (h *AdminHandler) writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("Failed to encode JSON response", zap.Error(err))
	}
}

func (h *AdminHandler) writeError(w http.ResponseWriter, status int, message string, err error) {
	if err != nil {
		h.logger.Error(message, zap.Error(err))
	}
	h.writeJSON(w, status, map[string]string{"error": message})
}
