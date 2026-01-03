# 000026 - Admin Panel Implementation

**Created:** January 4, 2026  
**Status:** Implemented  
**Scope:** Frontend Admin Panel for Quantix-vDC

---

## Overview

The Admin Panel is a comprehensive administrative interface for the Quantix-vDC platform, accessible via the `/admin` route. It provides platform-wide configuration, user management, security settings, and operational controls similar to VMware vCenter's admin functionality.

## Access Control

- **Route:** `/admin/*`
- **Permission Required:** `super_admin` role
- **Guard Component:** `AdminGuard.tsx`

The admin panel uses a separate layout with its own sidebar navigation, distinct from the main application layout.

## Architecture

```
/admin                 → AdminOverview (Dashboard)
/admin/telemetry       → Platform Telemetry
/admin/certifications  → Certificate Management
/admin/audit-logs      → Admin Audit Logs
/admin/emails          → Admin Email Management
/admin/subscriptions   → Subscription Plans
/admin/roles           → Role Hierarchy & Permissions
/admin/sso             → SSO Configuration
/admin/rules           → Global Rules (VM Policies)
/admin/organization    → Organization Settings
/admin/apis            → API Key Management
```

---

## Components

### 1. Admin Overview (`/admin`)

Dashboard landing page with:
- Quick stats (Users, Roles, Certificates, Audit Events)
- System health metrics (CPU, Memory, Storage, Network)
- Recent admin activity feed
- Quick action buttons

### 2. Platform Telemetry (`/admin/telemetry`)

Resource utilization monitoring with:
- **Key Metrics:** VMs, Hosts, Storage, Network, Users, API Calls
- **Time Range Selector:** 24h, 7d, 30d, 90d, 1y
- **Charts:** CPU, Memory, Storage, Network utilization
- **Growth Predictions:** ML-based forecasting with recommendations
- **VM Creation Trends:** Daily breakdown with net growth

### 3. Certifications (`/admin/certifications`)

SSL/TLS certificate lifecycle management:
- Certificate list with status badges (Valid, Expiring, Expired)
- Certificate types: SSL/TLS, CA, Client
- Upload modal with file upload for .pem/.crt and .key files
- Detail modal with fingerprint, issuer, validity dates
- Actions: View, Download, Renew, Delete

### 4. Admin Audit Logs (`/admin/audit-logs`)

Security and compliance logging:
- Searchable log table (user, action, resource)
- Severity filter (Info, Warning, Error)
- Date range filter (1h, 24h, 7d, 30d, 90d)
- Expandable row details (User Agent, additional context)
- Pagination support

**Log Entry Fields:**
- Timestamp
- User (name, email)
- Action (e.g., `user.role.create`, `sso.config.update`)
- Resource and Resource Type
- Status (Success, Warning, Failure)
- IP Address
- User Agent

### 5. Admin Emails (`/admin/emails`)

Notification recipient management:
- Admin email list with notification toggles
- Notification types:
  - Critical Alerts
  - Weekly Reports
  - Security Events
  - Billing Updates
- Email verification status
- Last notification timestamp
- Notification settings (thresholds, report schedule)

### 6. Subscription Plans (`/admin/subscriptions`)

Plan and billing information:
- Current plan overview with usage metrics
- Resource limits (VMs, Hosts, Storage, Users, API Calls)
- Usage progress bars
- Plan comparison (Starter, Professional, Enterprise)
- Billing information (renewal date, payment method)
- Invoice history

### 7. Role Hierarchy (`/admin/roles`)

RBAC (Role-Based Access Control) management:

**Tabs:**
1. **Roles:** List of roles with expandable permissions
2. **Permissions:** Permission catalog by category
3. **Users:** User list with role assignments

**Role Features:**
- System vs Custom role badges
- Permission count display
- Expandable permission list
- Create custom role modal
- Clone existing roles
- Role inheritance (parent role)

**Permission Categories:**
- Virtual Machines (create, delete, edit, power, console, snapshot, migrate)
- Hosts (view, manage, maintenance)
- Storage (view, manage)
- Networking (view, manage)
- Administration (users, roles, settings, audit, billing)

### 8. SSO Configuration (`/admin/sso`)

Single Sign-On integration:

**OIDC Configuration:**
- Provider Name
- Issuer URL
- Client ID / Client Secret
- Scopes
- Username Claim / Groups Claim

**SAML Configuration:**
- Provider Name
- Entity ID
- SSO URL
- IdP Certificate
- Signing options

**LDAP Configuration (Legacy):**
- Disabled by default with warning
- Server URL
- Base DN, Bind DN, Bind Password
- User/Group filters
- TLS toggle

**Features:**
- Test connection button
- Callback URL display for IdP configuration
- Show/Hide secrets toggle

### 9. Global Rules (`/admin/rules`)

VM creation policies (appears in VM wizard Step 2):

**Rule Structure:**
- Name, Description
- Category (Compute, Storage, Network, Security)
- Priority (lower = higher priority)
- Enabled/Disabled toggle

**Conditions:**
- Field (vm.cpu.cores, vm.memory.size_mib, disk.size_gib, etc.)
- Operator (equals, not_equals, greater_than, less_than, contains)
- Value

**Actions:**
- Allow (permit the operation)
- Deny (block with message)
- Warn (show warning but allow)

**Example Rules:**
- Maximum VM CPU Limit (32 vCPUs)
- Maximum VM Memory (128 GB)
- Maximum Disk Size (2 TB)
- Require Security Group
- Production Network Restriction

### 10. Organization Settings (`/admin/organization`)

**General Tab:**
- Organization name, domain
- Website, phone
- Address, city, country

**Branding Tab:**
- Logo upload (200x50px recommended)
- Favicon upload (32x32px)
- Brand colors (Primary, Accent)
- Custom CSS
- Email footer text

**Billing Tab:**
- Billing contact (name, email, phone, address)
- Tax information (Tax ID/VAT)
- Invoice delivery preferences

### 11. API Management (`/admin/apis`)

Programmatic access control:

**API Key Features:**
- Key list with prefix display (qx_prod_*, etc.)
- Status (Active, Expired, Revoked)
- Usage count
- Created by, Last used
- Expiration date

**Create API Key Modal:**
- Key name
- Expiration (Never, 30d, 90d, 1y)
- Permission selection by category

**Security:**
- Key revealed only once on creation
- Copy to clipboard
- Revoke action
- Delete action

---

## File Structure

```
frontend/src/
├── pages/
│   └── admin/
│       ├── index.tsx           # Main layout with Routes
│       ├── AdminOverview.tsx   # Dashboard
│       ├── Telemetry.tsx       # Telemetry charts
│       ├── Certifications.tsx  # Certificate management
│       ├── AuditLogs.tsx       # Audit log viewer
│       ├── AdminEmails.tsx     # Email management
│       ├── Subscriptions.tsx   # Plan information
│       ├── Roles.tsx           # RBAC management
│       ├── SSOConfig.tsx       # SSO settings
│       ├── GlobalRules.tsx     # VM policies
│       ├── Organization.tsx    # Org settings
│       └── APIManagement.tsx   # API keys
└── components/
    └── admin/
        ├── index.ts            # Exports
        ├── AdminSidebar.tsx    # Navigation
        └── AdminGuard.tsx      # Permission check
```

---

## Integration Points

### Backend APIs (To Be Implemented)

| Section | API Endpoints Needed |
|---------|---------------------|
| Telemetry | `GET /api/admin/telemetry`, `GET /api/admin/predictions` |
| Certifications | `GET/POST/DELETE /api/admin/certificates` |
| Audit Logs | `GET /api/admin/audit-logs` (with pagination/filters) |
| Admin Emails | `GET/POST/PUT/DELETE /api/admin/emails` |
| Subscriptions | `GET /api/admin/subscription`, `GET /api/billing/invoices` |
| Roles | `GET/POST/PUT/DELETE /api/admin/roles`, `/api/admin/permissions` |
| SSO | `GET/PUT /api/admin/sso/oidc`, `/api/admin/sso/saml`, `/api/admin/sso/ldap` |
| Global Rules | `GET/POST/PUT/DELETE /api/admin/rules` |
| Organization | `GET/PUT /api/admin/organization`, `/api/admin/branding` |
| API Keys | `GET/POST/DELETE /api/admin/api-keys`, `POST /api/admin/api-keys/:id/revoke` |

### Authentication

The `AdminGuard` component currently uses a mock permission check. Integration with the actual auth system requires:

1. Auth context/store with user role information
2. JWT token with role claims
3. API endpoint for permission verification

---

## UI/UX Patterns

### Color Scheme
- Follows existing theme (dark mode by default)
- Uses Tailwind CSS v4 semantic colors
- Status colors: success (green), warning (yellow), error (red), info (blue)

### Layout
- Full-height sidebar (260px width)
- Scrollable content area
- Max-width container (7xl = 1280px)
- Consistent padding (24px)

### Components
- Cards with rounded corners (12px)
- Floating shadows on hover
- Framer Motion animations
- Lucide icons throughout
- Form inputs with consistent styling

### Modals
- Backdrop with 50% black opacity
- Scale + opacity entrance animation
- Click-outside to close
- Header with title and close button
- Footer with action buttons

---

## Security Considerations

1. **Route Protection:** All admin routes are wrapped in `AdminGuard`
2. **Secret Handling:** API keys shown once, passwords masked by default
3. **LDAP Warning:** Legacy protocol disabled by default with security warning
4. **Audit Logging:** All admin actions should be logged
5. **Session Timeout:** Configurable inactivity timeout
6. **Certificate Validation:** TLS required for LDAP connections

---

## Future Enhancements

1. **Real-time Updates:** WebSocket for live telemetry
2. **Role Inheritance Visualization:** Tree diagram
3. **Bulk Operations:** Import/export users, roles
4. **Advanced Analytics:** Usage patterns, cost analysis
5. **Compliance Reports:** SOC2, ISO27001 exports
6. **Webhook Integration:** External notification services
