# LimiQuantix Workflow State

## Current Status: Admin Panel Implementation 🔄

**Last Updated:** January 4, 2026

---

## 🔄 Current Task: Admin Panel for Quantix-vDC

### Overview
Building a comprehensive admin panel accessible via `/admin` route, restricted to super admin users. This panel will serve as the central management hub for platform-wide configuration, similar to VMware vCenter's admin functionality.

### Admin Panel Sections

| # | Section | Description | Status |
|---|---------|-------------|--------|
| 1 | Platform Telemetry | Usage metrics, growth predictions, trends | 🔄 In Progress |
| 2 | Certifications | SSL/TLS certificate management | ⏳ Pending |
| 3 | Admin Audit Logs | Security and admin action logging | ⏳ Pending |
| 4 | Admin Emails | Alert and report recipient management | ⏳ Pending |
| 5 | Subscription Plans | Organization plan information | ⏳ Pending |
| 6 | Role Hierarchy | RBAC with custom roles and permissions | ⏳ Pending |
| 7 | SSO Configuration | OIDC, SAML, optional LDAP | ⏳ Pending |
| 8 | Global Rules | VM creation policies | ⏳ Pending |
| 9 | Organization Settings | Name, branding, billing | ⏳ Pending |
| 10 | API Management | API key creation and management | ⏳ Pending |

---

## Implementation Plan

### Phase 1: Core Structure (Current)
1. Create admin layout with sidebar navigation
2. Create AdminLayout component with permission guard (placeholder)
3. Set up routing for `/admin/*` paths
4. Create base admin page components

### Phase 2: Individual Sections
5. Platform Telemetry - charts, metrics, growth predictions
6. Certifications - certificate list, upload, renewal
7. Audit Logs - searchable log table with filters
8. Admin Emails - email list management
9. Subscription Plans - plan display and features
10. Role Hierarchy - role tree, permissions matrix
11. SSO Configuration - OIDC/SAML forms, LDAP toggle
12. Global Rules - VM policy configuration
13. Organization Settings - branding, contact info
14. API Management - API key CRUD

### Phase 3: Backend Integration (Future)
- Wire up API calls for each section
- Implement actual permission checks
- Add real-time data updates

---

## Technical Decisions

### File Structure
```
frontend/src/
├── pages/
│   └── admin/
│       ├── index.tsx          # Main admin layout with sub-routing
│       ├── AdminOverview.tsx  # Dashboard/landing page
│       ├── Telemetry.tsx      # Platform telemetry
│       ├── Certifications.tsx # Certificate management
│       ├── AuditLogs.tsx      # Admin audit logs
│       ├── AdminEmails.tsx    # Alert email management
│       ├── Subscriptions.tsx  # Subscription plans
│       ├── Roles.tsx          # Role hierarchy & permissions
│       ├── SSOConfig.tsx      # SSO configuration
│       ├── GlobalRules.tsx    # VM creation rules
│       ├── Organization.tsx   # Org settings & branding
│       └── APIManagement.tsx  # API key management
└── components/
    └── admin/
        ├── AdminSidebar.tsx   # Admin-specific navigation
        ├── AdminGuard.tsx     # Permission check wrapper
        └── ...                # Shared admin components
```

### Styling Approach
- Follow existing theme (dark mode, --bg-surface, --bg-elevated)
- Use Tailwind CSS v4 classes
- Framer Motion for animations
- Lucide icons throughout

---

## Build Commands

```bash
# Frontend
cd frontend && npm run dev     # Development
cd frontend && npm run build   # Production build
```

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                     Admin Panel (/admin)                     │
├─────────────┬───────────────────────────────────────────────┤
│   Sidebar   │              Content Area                      │
│ ─────────── │ ─────────────────────────────────────────────  │
│ Overview    │  Telemetry | Certs | Logs | Emails | Plans    │
│ Telemetry   │  Roles | SSO | Rules | Org | APIs             │
│ Certs       │                                                │
│ Logs        │  [Dynamic content based on selected section]   │
│ Emails      │                                                │
│ Plans       │                                                │
│ Roles       │                                                │
│ SSO         │                                                │
│ Rules       │                                                │
│ Org         │                                                │
│ APIs        │                                                │
└─────────────┴───────────────────────────────────────────────┘
```

---

## Previous Completed Work

### Session 3 (Jan 3, 2026) ✅
- VM Detail Configuration Tab
- Host Detail Configuration Tab
- Networking Pages with Create/Edit Modals
- QuantumNet implementation complete

### Session 2 ✅
- Frontend pages for VirtualNetworks, LoadBalancers, VPNServices, BGPSpeakers
- Security Groups page
