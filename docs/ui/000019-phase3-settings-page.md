# 000019 - Settings Page Documentation

**Component**: Settings Page  
**Route**: `/settings`  
**Status**: ✅ Complete  

---

## Overview

The Settings page provides platform-wide configuration options for the LimiQuantix virtualization platform. It features a tabbed interface organized by settings category, allowing administrators to customize system behavior, appearance, security, and more.

---

## Features

### Header Section

- Page title "Settings" with description "Configure your LimiQuantix platform"
- "Save All Changes" primary action button

### Tab Navigation

Horizontal tab bar with the following categories:

| Tab | Description |
|-----|-------------|
| General | Basic platform configuration |
| Appearance | Theme and display settings |
| Notifications | Alert and notification preferences |
| Security | Authentication and access settings |
| Storage | Storage defaults and policies |
| Network | Network configuration options |
| Advanced | System tuning and expert settings |

---

## Settings Categories

### General Tab (Default)

**General Settings** section:

| Setting | Type | Description |
|---------|------|-------------|
| Cluster Name | Text input | Display name for this LimiQuantix deployment |
| Timezone | Dropdown | Default timezone for the platform |
| Language | Dropdown | Interface language |
| Session Timeout | Dropdown | Automatic logout after inactivity |

**Timezone Options**:
- America/New_York (EST)
- America/Los_Angeles (PST)
- Europe/London (GMT)
- Europe/Berlin (CET)
- Asia/Tokyo (JST)
- UTC

**Language Options**:
- English (US)
- English (UK)
- Deutsch
- Français
- 日本語

**Session Timeout Options**:
- 15 minutes
- 30 minutes
- 1 hour
- 2 hours
- Never

---

### Appearance Tab

**Theme Settings**:

| Setting | Type | Description |
|---------|------|-------------|
| Theme Mode | Radio buttons | Dark / Light / System |
| Accent Color | Color picker | Primary UI accent color |
| Compact Mode | Toggle | Reduce padding for dense layouts |
| Animations | Toggle | Enable/disable UI animations |

**Dashboard Settings**:

| Setting | Type | Description |
|---------|------|-------------|
| Default View | Dropdown | Dashboard layout preference |
| Auto-refresh | Dropdown | Dashboard refresh interval |
| Show Metrics | Toggle | Display resource utilization graphs |

---

### Notifications Tab

**Email Notifications**:

| Setting | Type | Description |
|---------|------|-------------|
| Enable Email | Toggle | Master email notification switch |
| SMTP Server | Text input | Mail server address |
| SMTP Port | Number input | Mail server port |
| Authentication | Toggle | Use SMTP authentication |
| Email Recipients | Textarea | Comma-separated email addresses |

**Alert Thresholds**:

| Setting | Type | Description |
|---------|------|-------------|
| CPU Warning | Slider | CPU usage warning threshold (%) |
| Memory Warning | Slider | Memory usage warning threshold (%) |
| Storage Warning | Slider | Storage usage warning threshold (%) |

---

### Security Tab

**Authentication**:

| Setting | Type | Description |
|---------|------|-------------|
| Auth Method | Dropdown | Local / LDAP / SAML / OIDC |
| Session Length | Dropdown | Maximum session duration |
| 2FA Required | Toggle | Require two-factor authentication |
| Password Policy | Multiple | Min length, complexity requirements |

**Access Control**:

| Setting | Type | Description |
|---------|------|-------------|
| API Access | Toggle | Enable REST/gRPC API access |
| API Rate Limit | Number | Requests per minute limit |
| Allowed IPs | Textarea | IP whitelist for API access |

---

### Storage Tab

**Default Storage Settings**:

| Setting | Type | Description |
|---------|------|-------------|
| Default Pool | Dropdown | Default storage pool for new VMs |
| Provisioning | Radio | Thin / Thick provisioning default |
| Snapshot Retention | Number | Days to keep automatic snapshots |

**Ceph Configuration**:

| Setting | Type | Description |
|---------|------|-------------|
| Ceph Monitors | Textarea | Ceph monitor addresses |
| Ceph User | Text input | Ceph authentication user |
| Pool Prefix | Text input | Prefix for Ceph pool names |

---

### Network Tab

**Default Network Settings**:

| Setting | Type | Description |
|---------|------|-------------|
| Default Network | Dropdown | Default network for new VMs |
| DNS Servers | Textarea | Default DNS server IPs |
| NTP Servers | Textarea | Time sync server IPs |
| MTU | Number | Default network MTU |

**OVN Configuration**:

| Setting | Type | Description |
|---------|------|-------------|
| OVN Northbound | Text input | OVN northbound database address |
| OVN Southbound | Text input | OVN southbound database address |
| Integration Bridge | Text input | OVS integration bridge name |

---

### Advanced Tab

**System Tuning**:

| Setting | Type | Description |
|---------|------|-------------|
| Max VMs per Host | Number | Hard limit on VMs per host |
| CPU Overcommit | Number | CPU overcommit ratio |
| Memory Overcommit | Number | Memory overcommit ratio |
| Live Migration | Toggle | Enable live VM migration |

**Maintenance**:

| Setting | Type | Description |
|---------|------|-------------|
| Debug Logging | Toggle | Enable verbose logging |
| Telemetry | Toggle | Send anonymous usage data |
| Auto Updates | Toggle | Enable automatic platform updates |

---

## Visual Design

### Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ Settings                                    [💾 Save All Changes]│
│ Configure your LimiQuantix platform                             │
├─────────────────────────────────────────────────────────────────┤
│ [General] [Appearance] [Notifications] [Security] [Storage]... │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ General Settings                                                │
│ Basic platform configuration                                    │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Cluster Name                                                │ │
│ │ Display name for this LimiQuantix deployment                │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ LimiQuantix Production                                  │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Timezone                                                    │ │
│ │ Default timezone for the platform                          │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ America/New_York (EST)                              ▼   │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Mock Data Structure

```typescript
interface PlatformSettings {
  general: {
    clusterName: string;
    timezone: string;
    language: string;
    sessionTimeout: number;
  };
  appearance: {
    theme: 'dark' | 'light' | 'system';
    accentColor: string;
    compactMode: boolean;
    animations: boolean;
    defaultView: string;
    autoRefresh: number;
    showMetrics: boolean;
  };
  notifications: {
    emailEnabled: boolean;
    smtpServer: string;
    smtpPort: number;
    smtpAuth: boolean;
    recipients: string[];
    thresholds: {
      cpu: number;
      memory: number;
      storage: number;
    };
  };
  security: {
    authMethod: 'local' | 'ldap' | 'saml' | 'oidc';
    sessionLength: number;
    require2FA: boolean;
    passwordPolicy: PasswordPolicy;
    apiEnabled: boolean;
    apiRateLimit: number;
    allowedIPs: string[];
  };
  storage: {
    defaultPool: string;
    provisioning: 'thin' | 'thick';
    snapshotRetention: number;
    ceph: CephConfig;
  };
  network: {
    defaultNetwork: string;
    dnsServers: string[];
    ntpServers: string[];
    mtu: number;
    ovn: OvnConfig;
  };
  advanced: {
    maxVMsPerHost: number;
    cpuOvercommit: number;
    memoryOvercommit: number;
    liveMigration: boolean;
    debugLogging: boolean;
    telemetry: boolean;
    autoUpdates: boolean;
  };
}
```

---

## File Location

- **Page Component**: `frontend/src/pages/Settings.tsx`

---

## Component Dependencies

- `lucide-react` icons (Settings, Save, various category icons)
- `react-router-dom` for navigation
- `framer-motion` for tab animations
- Form elements (inputs, selects, toggles, sliders)
- Shared UI components (`Button`, `Tabs`)

---

## Styling

- Tab navigation uses pill-style buttons
- Form sections are grouped with cards
- Labels include helper text for clarity
- Inputs use consistent styling with focus states
- Save button is prominent in header

---

## Interactions

1. **Tab Navigation**: Click tabs to switch categories
2. **Form Inputs**: Edit settings with real-time validation
3. **Save All Changes**: Persists all modified settings
4. **Reset**: Reverts to saved values (future)
5. **Import/Export**: Configuration backup (future)

---

## Future Enhancements

1. Per-section save buttons
2. Settings change audit log
3. Role-based settings visibility
4. Settings import/export (JSON/YAML)
5. Settings templates
6. Environment-specific overrides
7. Settings search/filter
8. Undo/redo for changes
9. Settings diff viewer
10. API for programmatic configuration

