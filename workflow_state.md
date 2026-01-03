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

### Session 5 (Jan 4, 2026) ✅ - Quantix-OS Slint Console GUI
**Documentation**: `docs/Quantix-OS/000053-console-gui-slint.md`

**Decision**: Chose Slint over Wayland Kiosk (Chromium) for:
- 50x less RAM (10MB vs 500MB)
- Millisecond boot time
- Single binary, minimal attack surface
- Native Rust integration

**Files Created/Modified**:
| File | Description |
|------|-------------|
| `quantix-os/console-gui/Cargo.toml` | Feature flags: `desktop` (winit) and `linuxkms` (framebuffer) |
| `quantix-os/console-gui/build.rs` | Slint build script |
| `quantix-os/console-gui/ui/main.slint` | Full UI definition (~1700 lines) |
| `quantix-os/console-gui/src/main.rs` | Application logic and callbacks |
| `quantix-os/console-gui/src/auth.rs` | Argon2 password hashing, audit logging |
| `quantix-os/console-gui/src/ssh.rs` | SSH service management via OpenRC |
| `quantix-os/console-gui/src/network.rs` | Network interface discovery and config |
| `quantix-os/console-gui/assets/logo.png` | Quantix logo for wizard |
| `quantix-os/overlay/etc/init.d/quantix-console` | OpenRC service |

**Features Implemented**:
1. Installation Wizard (4 steps: hostname, admin account, network, SSH)
2. Admin authentication with Argon2id + lockout
3. SSH management (enable/disable, status)
4. Protected operations (network, services, shell, power)
5. Real-time system monitoring (CPU, RAM, VMs, uptime)
6. Keyboard navigation (F-keys, arrows)
7. Custom logo support

**Build Commands**:
```bash
# Desktop development (default)
cargo build --release

# Production (framebuffer)
cargo build --release --no-default-features --features linuxkms
```

### Session 4 (Jan 4, 2026) ✅
- **Bug Fix**: Config lookup defensive fallbacks (VirtualNetworks, VPNServices, BGPSpeakers, LoadBalancers, HostDetail)
- **Documentation**: Created `docs/ui/000024-networking-pages-configuration.md`

### Session 3 (Jan 3, 2026) ✅
- VM Detail Configuration Tab
- Host Detail Configuration Tab
- Networking Pages with Create/Edit Modals
- QuantumNet implementation complete

### Session 2 ✅
- Frontend pages for VirtualNetworks, LoadBalancers, VPNServices, BGPSpeakers
- Security Groups page
