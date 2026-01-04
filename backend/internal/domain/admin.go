// Package domain contains core business entities for the limiquantix platform.
// This file defines admin panel domain models for roles, API keys, organizations,
// SSO configuration, admin emails, and global rules.
package domain

import (
	"time"
)

// =============================================================================
// CUSTOM ROLES - User-defined roles with granular permissions
// =============================================================================

// RoleType defines whether a role is system-defined or user-created.
type RoleType string

const (
	RoleTypeSystem RoleType = "system" // Built-in roles (admin, operator, viewer)
	RoleTypeCustom RoleType = "custom" // User-created roles
)

// CustomRole represents a user-defined role with granular permissions.
type CustomRole struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description,omitempty"`
	Type        RoleType     `json:"type"`
	ParentID    *string      `json:"parent_id,omitempty"` // Inherits from parent role
	Permissions []Permission `json:"permissions"`
	UserCount   int          `json:"user_count"` // Computed: number of users with this role
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// IsSystemRole returns true if this is a built-in system role.
func (r *CustomRole) IsSystemRole() bool {
	return r.Type == RoleTypeSystem
}

// HasPermission checks if this role has a specific permission.
func (r *CustomRole) HasPermission(perm Permission) bool {
	for _, p := range r.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// =============================================================================
// API KEYS - Programmatic access tokens
// =============================================================================

// APIKeyStatus represents the status of an API key.
type APIKeyStatus string

const (
	APIKeyStatusActive  APIKeyStatus = "active"
	APIKeyStatusExpired APIKeyStatus = "expired"
	APIKeyStatusRevoked APIKeyStatus = "revoked"
)

// APIKey represents a programmatic access token for API authentication.
type APIKey struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Prefix      string       `json:"prefix"`  // e.g., "qx_prod_" - visible identifier
	KeyHash     string       `json:"-"`       // bcrypt hash of the actual key (never exposed)
	Permissions []Permission `json:"permissions"`
	CreatedBy   string       `json:"created_by"` // User ID who created this key
	CreatedAt   time.Time    `json:"created_at"`
	LastUsed    *time.Time   `json:"last_used,omitempty"`
	ExpiresAt   *time.Time   `json:"expires_at,omitempty"`
	Status      APIKeyStatus `json:"status"`
	UsageCount  int64        `json:"usage_count"`
}

// IsValid returns true if the API key is active and not expired.
func (k *APIKey) IsValid() bool {
	if k.Status != APIKeyStatusActive {
		return false
	}
	if k.ExpiresAt != nil && time.Now().After(*k.ExpiresAt) {
		return false
	}
	return true
}

// HasPermission checks if this API key has a specific permission.
func (k *APIKey) HasPermission(perm Permission) bool {
	for _, p := range k.Permissions {
		if p == perm {
			return true
		}
	}
	return false
}

// =============================================================================
// ORGANIZATION - Org settings and branding
// =============================================================================

// Organization represents the platform organization settings.
type Organization struct {
	ID             string                 `json:"id"`
	Name           string                 `json:"name"`
	Domain         string                 `json:"domain,omitempty"`
	Settings       OrganizationSettings   `json:"settings"`
	Branding       OrganizationBranding   `json:"branding"`
	BillingContact BillingContact         `json:"billing_contact,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// OrganizationSettings contains platform-wide settings.
type OrganizationSettings struct {
	SessionTimeout     int  `json:"session_timeout_minutes"`  // Session expiry in minutes
	MaxAPIKeysPerUser  int  `json:"max_api_keys_per_user"`    // Max API keys per user
	RequireMFA         bool `json:"require_mfa"`              // Enforce MFA for all users
	AllowSelfSignup    bool `json:"allow_self_signup"`        // Allow user self-registration
	PasswordMinLength  int  `json:"password_min_length"`      // Minimum password length
	PasswordRequireMix bool `json:"password_require_mix"`     // Require mixed case, numbers, symbols
	AuditRetentionDays int  `json:"audit_retention_days"`     // Days to retain audit logs
}

// DefaultOrganizationSettings returns sensible defaults.
func DefaultOrganizationSettings() OrganizationSettings {
	return OrganizationSettings{
		SessionTimeout:     60,    // 1 hour
		MaxAPIKeysPerUser:  10,    // 10 keys per user
		RequireMFA:         false, // Optional by default
		AllowSelfSignup:    false, // Disabled by default
		PasswordMinLength:  8,
		PasswordRequireMix: true,
		AuditRetentionDays: 90, // 90 days
	}
}

// OrganizationBranding contains UI customization settings.
type OrganizationBranding struct {
	LogoURL        string `json:"logo_url,omitempty"`
	FaviconURL     string `json:"favicon_url,omitempty"`
	PrimaryColor   string `json:"primary_color,omitempty"`   // Hex color
	SecondaryColor string `json:"secondary_color,omitempty"` // Hex color
	CompanyName    string `json:"company_name,omitempty"`
	SupportEmail   string `json:"support_email,omitempty"`
	SupportURL     string `json:"support_url,omitempty"`
}

// BillingContact contains billing contact information.
type BillingContact struct {
	Name    string `json:"name,omitempty"`
	Email   string `json:"email,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Address string `json:"address,omitempty"`
}

// =============================================================================
// SSO CONFIGURATION - OIDC/SAML/LDAP settings
// =============================================================================

// SSOProviderType defines the type of SSO provider.
type SSOProviderType string

const (
	SSOProviderOIDC SSOProviderType = "oidc"
	SSOProviderSAML SSOProviderType = "saml"
	SSOProviderLDAP SSOProviderType = "ldap"
)

// SSOConfig represents SSO provider configuration.
type SSOConfig struct {
	ID           string          `json:"id"`
	ProviderType SSOProviderType `json:"provider_type"`
	Enabled      bool            `json:"enabled"`
	Name         string          `json:"name"` // Display name (e.g., "Okta", "Azure AD")

	// OIDC-specific config
	OIDCConfig *OIDCConfig `json:"oidc_config,omitempty"`

	// SAML-specific config
	SAMLConfig *SAMLConfig `json:"saml_config,omitempty"`

	// LDAP-specific config
	LDAPConfig *LDAPConfig `json:"ldap_config,omitempty"`

	// Common settings
	AutoProvision   bool              `json:"auto_provision"`    // Auto-create users on first login
	DefaultRole     Role              `json:"default_role"`      // Role for auto-provisioned users
	GroupMapping    map[string]string `json:"group_mapping"`     // SSO group -> local role mapping
	AllowedDomains  []string          `json:"allowed_domains"`   // Restrict to specific email domains
	AllowedGroups   []string          `json:"allowed_groups"`    // Restrict to specific SSO groups
	JITProvisioning bool              `json:"jit_provisioning"`  // Just-in-time user provisioning
	UpdateOnLogin   bool              `json:"update_on_login"`   // Update user attributes on each login

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// OIDCConfig contains OpenID Connect configuration.
type OIDCConfig struct {
	IssuerURL       string   `json:"issuer_url"`
	ClientID        string   `json:"client_id"`
	ClientSecret    string   `json:"-"` // Never expose in API responses
	RedirectURL     string   `json:"redirect_url"`
	Scopes          []string `json:"scopes"`
	DiscoveryURL    string   `json:"discovery_url,omitempty"`
	AuthEndpoint    string   `json:"auth_endpoint,omitempty"`
	TokenEndpoint   string   `json:"token_endpoint,omitempty"`
	UserinfoURL     string   `json:"userinfo_url,omitempty"`
	JWKsURL         string   `json:"jwks_url,omitempty"`
	UsernameClaim   string   `json:"username_claim"`   // Claim to use as username
	EmailClaim      string   `json:"email_claim"`      // Claim to use as email
	GroupsClaim     string   `json:"groups_claim"`     // Claim containing group membership
	PKCEEnabled     bool     `json:"pkce_enabled"`     // Use PKCE for additional security
	SkipTLSVerify   bool     `json:"skip_tls_verify"`  // Skip TLS cert verification (dev only)
}

// SAMLConfig contains SAML 2.0 configuration.
type SAMLConfig struct {
	EntityID           string `json:"entity_id"`
	MetadataURL        string `json:"metadata_url,omitempty"`
	MetadataXML        string `json:"-"` // Raw IdP metadata XML
	SSOURL             string `json:"sso_url"`
	SLOURL             string `json:"slo_url,omitempty"`     // Single Logout URL
	Certificate        string `json:"-"`                     // IdP signing certificate
	AssertionConsumer  string `json:"assertion_consumer"`    // ACS URL
	NameIDFormat       string `json:"name_id_format"`        // e.g., email, persistent
	SignAuthnRequests  bool   `json:"sign_authn_requests"`
	WantAssertionsSigned bool `json:"want_assertions_signed"`
	UsernameAttribute  string `json:"username_attribute"`
	EmailAttribute     string `json:"email_attribute"`
	GroupsAttribute    string `json:"groups_attribute"`
}

// LDAPConfig contains LDAP/Active Directory configuration.
type LDAPConfig struct {
	Host             string `json:"host"`
	Port             int    `json:"port"`
	UseSSL           bool   `json:"use_ssl"`
	UseTLS           bool   `json:"use_tls"`
	SkipTLSVerify    bool   `json:"skip_tls_verify"`
	BindDN           string `json:"bind_dn"`
	BindPassword     string `json:"-"` // Never expose in API responses
	BaseDN           string `json:"base_dn"`
	UserFilter       string `json:"user_filter"`       // e.g., "(uid=%s)"
	GroupFilter      string `json:"group_filter"`      // e.g., "(member=%s)"
	UserSearchBase   string `json:"user_search_base"`
	GroupSearchBase  string `json:"group_search_base"`
	UsernameAttribute string `json:"username_attribute"` // e.g., "uid", "sAMAccountName"
	EmailAttribute   string `json:"email_attribute"`    // e.g., "mail"
	GroupMemberAttribute string `json:"group_member_attribute"` // e.g., "memberOf"
}

// =============================================================================
// ADMIN EMAILS - Notification recipients
// =============================================================================

// AdminEmailRole defines the role of an admin email recipient.
type AdminEmailRole string

const (
	AdminEmailPrimary   AdminEmailRole = "primary"   // Main admin contact
	AdminEmailSecondary AdminEmailRole = "secondary" // Additional contacts
	AdminEmailBilling   AdminEmailRole = "billing"   // Billing-related notifications
	AdminEmailSecurity  AdminEmailRole = "security"  // Security alerts
)

// AdminEmail represents an admin notification recipient.
type AdminEmail struct {
	ID            string               `json:"id"`
	Email         string               `json:"email"`
	Name          string               `json:"name,omitempty"`
	Role          AdminEmailRole       `json:"role"`
	Notifications NotificationSettings `json:"notifications"`
	Verified      bool                 `json:"verified"`
	VerifiedAt    *time.Time           `json:"verified_at,omitempty"`
	CreatedAt     time.Time            `json:"created_at"`
}

// NotificationSettings controls which notifications an admin receives.
type NotificationSettings struct {
	CriticalAlerts  bool `json:"critical_alerts"`
	WarningAlerts   bool `json:"warning_alerts"`
	SecurityEvents  bool `json:"security_events"`
	SystemUpdates   bool `json:"system_updates"`
	BillingAlerts   bool `json:"billing_alerts"`
	WeeklyReports   bool `json:"weekly_reports"`
	MaintenanceMode bool `json:"maintenance_mode"`
}

// DefaultNotificationSettings returns sensible defaults.
func DefaultNotificationSettings() NotificationSettings {
	return NotificationSettings{
		CriticalAlerts:  true,
		WarningAlerts:   true,
		SecurityEvents:  true,
		SystemUpdates:   false,
		BillingAlerts:   true,
		WeeklyReports:   false,
		MaintenanceMode: true,
	}
}

// =============================================================================
// GLOBAL RULES - VM creation policies and constraints
// =============================================================================

// GlobalRuleCategory categorizes rules by their scope.
type GlobalRuleCategory string

const (
	GlobalRuleCategoryCompute  GlobalRuleCategory = "compute"  // VM CPU/memory limits
	GlobalRuleCategoryStorage  GlobalRuleCategory = "storage"  // Disk quotas, pool restrictions
	GlobalRuleCategoryNetwork  GlobalRuleCategory = "network"  // Network policies
	GlobalRuleCategorySecurity GlobalRuleCategory = "security" // Security policies
)

// GlobalRule represents a platform-wide policy or constraint.
type GlobalRule struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Category    GlobalRuleCategory `json:"category"`
	Priority    int                `json:"priority"` // Lower = higher priority
	Enabled     bool               `json:"enabled"`
	Conditions  []RuleCondition    `json:"conditions"`
	Actions     []RuleAction       `json:"actions"`
	CreatedAt   time.Time          `json:"created_at"`
	UpdatedAt   time.Time          `json:"updated_at"`
	CreatedBy   string             `json:"created_by,omitempty"`
}

// RuleCondition defines when a rule should apply.
type RuleCondition struct {
	Field    string      `json:"field"`    // e.g., "vm.cpu.cores", "user.role"
	Operator string      `json:"operator"` // e.g., "gt", "lt", "eq", "in"
	Value    interface{} `json:"value"`    // Comparison value
}

// RuleAction defines what happens when a rule matches.
type RuleAction struct {
	Type    string      `json:"type"`    // e.g., "deny", "warn", "modify"
	Field   string      `json:"field,omitempty"`
	Value   interface{} `json:"value,omitempty"`
	Message string      `json:"message,omitempty"` // User-facing message
}

// RuleOperators defines supported comparison operators.
var RuleOperators = []string{
	"eq",       // equals
	"neq",      // not equals
	"gt",       // greater than
	"gte",      // greater than or equal
	"lt",       // less than
	"lte",      // less than or equal
	"in",       // value in list
	"nin",      // value not in list
	"contains", // string contains
	"regex",    // regex match
}

// RuleActionTypes defines supported action types.
var RuleActionTypes = []string{
	"deny",    // Block the operation
	"warn",    // Allow but show warning
	"modify",  // Auto-modify the value
	"require", // Require additional approval
	"log",     // Log for auditing
}

// Evaluate checks if this rule applies to a given context.
func (r *GlobalRule) Evaluate(context map[string]interface{}) (matches bool, action *RuleAction) {
	if !r.Enabled {
		return false, nil
	}

	// All conditions must match
	for _, cond := range r.Conditions {
		if !evaluateCondition(cond, context) {
			return false, nil
		}
	}

	// Return first action if all conditions match
	if len(r.Actions) > 0 {
		return true, &r.Actions[0]
	}
	return true, nil
}

// evaluateCondition checks a single condition against context.
func evaluateCondition(cond RuleCondition, context map[string]interface{}) bool {
	val, ok := context[cond.Field]
	if !ok {
		return false
	}

	switch cond.Operator {
	case "eq":
		return val == cond.Value
	case "neq":
		return val != cond.Value
	case "gt":
		return compareNumeric(val, cond.Value) > 0
	case "gte":
		return compareNumeric(val, cond.Value) >= 0
	case "lt":
		return compareNumeric(val, cond.Value) < 0
	case "lte":
		return compareNumeric(val, cond.Value) <= 0
	default:
		return false
	}
}

// compareNumeric compares two numeric values.
func compareNumeric(a, b interface{}) int {
	aFloat := toFloat64(a)
	bFloat := toFloat64(b)
	if aFloat > bFloat {
		return 1
	} else if aFloat < bFloat {
		return -1
	}
	return 0
}

// toFloat64 converts various numeric types to float64.
func toFloat64(v interface{}) float64 {
	switch n := v.(type) {
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case float32:
		return float64(n)
	case float64:
		return n
	default:
		return 0
	}
}

// =============================================================================
// CERTIFICATE - TLS certificate metadata
// =============================================================================

// CertificateStatus represents the status of a TLS certificate.
type CertificateStatus string

const (
	CertificateStatusActive   CertificateStatus = "active"
	CertificateStatusExpiring CertificateStatus = "expiring" // < 30 days until expiry
	CertificateStatusExpired  CertificateStatus = "expired"
	CertificateStatusRevoked  CertificateStatus = "revoked"
)

// Certificate represents TLS certificate metadata.
type Certificate struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Domain       string            `json:"domain"`
	Domains      []string          `json:"domains,omitempty"` // SANs
	Issuer       string            `json:"issuer"`
	SerialNumber string            `json:"serial_number"`
	Fingerprint  string            `json:"fingerprint"` // SHA256 fingerprint
	Status       CertificateStatus `json:"status"`
	IssuedAt     time.Time         `json:"issued_at"`
	ExpiresAt    time.Time         `json:"expires_at"`
	AutoRenew    bool              `json:"auto_renew"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

// DaysUntilExpiry returns the number of days until the certificate expires.
func (c *Certificate) DaysUntilExpiry() int {
	return int(time.Until(c.ExpiresAt).Hours() / 24)
}

// IsExpiring returns true if the certificate expires within 30 days.
func (c *Certificate) IsExpiring() bool {
	return c.DaysUntilExpiry() <= 30
}
