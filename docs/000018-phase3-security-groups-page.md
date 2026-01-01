# 000018 - Security Groups Page Documentation

**Component**: Security Groups List Page  
**Route**: `/security`  
**Status**: ✅ Complete  

---

## Overview

The Security Groups page provides firewall rule management for virtual machines. It displays all security groups with their inbound and outbound rules, allowing administrators to manage network access control at the VM level.

---

## Features

### Header Section

- Page title "Security Groups" with description
- Refresh button for manual data refresh
- "New Security Group" primary action button

### Summary Cards

| Card | Icon | Description |
|------|------|-------------|
| Security Groups | Shield | Total count of security groups |
| Total Rules | Lock | Sum of all inbound + outbound rules |
| Protected VMs | Monitor | Total VMs with assigned security groups |

### Search Bar

- Placeholder: "Search security groups..."
- Filters security groups by name in real-time

### Security Group Cards

Expandable cards showing security group details:

```
┌─────────────────────────────────────────────────────────────────┐
│ [>] [🛡️] default          [Default]                             │
│          Default security group - allows all outbound...        │
│                                                                 │
│     Inbound: 1 rules    Outbound: 1 rules    VMs: 12    [✏️][📋][🗑️] │
└─────────────────────────────────────────────────────────────────┘

[Expanded State]
┌─────────────────────────────────────────────────────────────────┐
│ [v] [🛡️] web-servers                                            │
│          Security group for public-facing web servers           │
│                                                                 │
│     Inbound: 3 rules    Outbound: 1 rules    VMs: 8     [✏️][📋][🗑️] │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ↙ Inbound Rules                              [+ Add Rule]   │ │
│ ├───────────┬──────────┬───────────┬────────┬─────────────────┤ │
│ │ Protocol  │ Port     │ Source    │ Action │ Description     │ │
│ ├───────────┼──────────┼───────────┼────────┼─────────────────┤ │
│ │ TCP       │ 80       │ Anywhere  │ ALLOW  │ HTTP traffic    │ │
│ │ TCP       │ 443      │ Anywhere  │ ALLOW  │ HTTPS traffic   │ │
│ │ TCP       │ 22       │ 10.0.0/8  │ ALLOW  │ SSH internal    │ │
│ └───────────┴──────────┴───────────┴────────┴─────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ↗ Outbound Rules                             [+ Add Rule]   │ │
│ ├───────────┬──────────┬───────────┬────────┬─────────────────┤ │
│ │ Protocol  │ Port     │ Dest      │ Action │ Description     │ │
│ ├───────────┼──────────┼───────────┼────────┼─────────────────┤ │
│ │ ANY       │ All      │ Anywhere  │ ALLOW  │ Allow all out   │ │
│ └───────────┴──────────┴───────────┴────────┴─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security Group Card Components

### Header Row

- Expand/collapse chevron icon
- Shield icon
- Security group name
- Default badge (if applicable)
- Description text

### Stats Row

- Inbound rules count
- Outbound rules count
- Applied VMs count
- Action buttons (Edit, Clone, Delete)

### Expanded Content

#### Inbound Rules Table

| Column | Description |
|--------|-------------|
| Protocol | TCP, UDP, ICMP, ANY |
| Port Range | Single port, range, or "All" |
| Source/Dest | IP/CIDR or "Anywhere" |
| Action | ALLOW (green) or DENY (red) |
| Description | Rule purpose/comment |
| Actions | Delete button |

#### Outbound Rules Table

Same structure as inbound rules table.

---

## Rule Action Colors

| Action | Color | Styling |
|--------|-------|---------|
| ALLOW | Green | `text-success bg-success/10` |
| DENY | Red | `text-error bg-error/10` |

---

## Mock Data Structure

```typescript
interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  inboundRules: SecurityRule[];
  outboundRules: SecurityRule[];
  appliedVMs: number;
  createdAt: string;
  updatedAt: string;
}

interface SecurityRule {
  id: string;
  protocol: 'TCP' | 'UDP' | 'ICMP' | 'ANY';
  portRange: string;  // "80", "80-443", "All"
  source: string;     // CIDR or "Anywhere"
  action: 'ALLOW' | 'DENY';
  description: string;
  priority?: number;
}
```

---

## Sample Mock Security Groups

```typescript
const mockSecurityGroups = [
  {
    id: 'sg-default',
    name: 'default',
    description: 'Default security group - allows all outbound, denies all inbound',
    isDefault: true,
    inboundRules: [
      {
        id: 'rule-1',
        protocol: 'ANY',
        portRange: 'All',
        source: 'sg-default',
        action: 'ALLOW',
        description: 'Allow traffic from same security group',
      },
    ],
    outboundRules: [
      {
        id: 'rule-2',
        protocol: 'ANY',
        portRange: 'All',
        source: 'Anywhere',
        action: 'ALLOW',
        description: 'Allow all outbound traffic',
      },
    ],
    appliedVMs: 12,
  },
  {
    id: 'sg-web',
    name: 'web-servers',
    description: 'Security group for public-facing web servers',
    isDefault: false,
    inboundRules: [
      { protocol: 'TCP', portRange: '80', source: 'Anywhere', action: 'ALLOW', description: 'HTTP from anywhere' },
      { protocol: 'TCP', portRange: '443', source: 'Anywhere', action: 'ALLOW', description: 'HTTPS from anywhere' },
      { protocol: 'TCP', portRange: '22', source: '10.0.0.0/8', action: 'ALLOW', description: 'SSH from internal' },
    ],
    outboundRules: [
      { protocol: 'ANY', portRange: 'All', source: 'Anywhere', action: 'ALLOW', description: 'Allow all outbound' },
    ],
    appliedVMs: 8,
  },
  // ... more security groups
];
```

---

## File Location

- **Page Component**: `frontend/src/pages/SecurityGroups.tsx`

---

## Component Dependencies

- `lucide-react` icons (Shield, Lock, Monitor, ChevronRight, ChevronDown, Edit2, Copy, Trash2, Plus)
- `react-router-dom` for navigation
- `framer-motion` for expand/collapse animations
- Shared UI components (`Button`, `Badge`)

---

## Styling

- Cards use `bg-bg-surface` with hover effects
- Expandable sections use smooth height animations
- Rules tables have subtle borders and alternating hover states
- Action badges use semantic colors (green for ALLOW, red for DENY)
- Default badge uses distinct styling

---

## Interactions

1. **Expand/Collapse**: Click header row to expand/collapse rules
2. **Search**: Filters security groups by name
3. **Edit**: Opens security group editor (future)
4. **Clone**: Duplicates security group with new name (future)
5. **Delete**: Confirms and removes security group (future)
6. **Add Rule**: Opens rule creation inline form (future)
7. **Delete Rule**: Removes individual rule with confirmation (future)

---

## Future Enhancements

1. Inline rule editing
2. Rule priority drag-and-drop
3. Security group templates
4. VM assignment management
5. Rule validation and conflict detection
6. Audit log for rule changes
7. Import/export security group configurations
8. Integration with network policy API

