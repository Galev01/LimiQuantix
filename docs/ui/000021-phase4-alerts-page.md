# 000021 - Alerts Page Documentation

**Component**: Alerts Management  
**Route**: `/alerts`  
**Status**: ✅ Complete  

---

## Overview

The Alerts page provides comprehensive alert management for the Quantixkvm platform. It displays system alerts with different severity levels, allows acknowledgment and resolution, and supports filtering and searching.

---

## Features

### Header Section

- Page title "Alerts" with description
- "Alert Rules" button for configuration
- "Refresh" button for manual refresh

### Summary Cards

Clickable cards that filter by severity:

| Card | Color | Description |
|------|-------|-------------|
| Critical | Red | Critical alerts requiring immediate attention |
| Warning | Yellow | Warning alerts to monitor |
| Info | Blue | Informational notifications |
| Resolved | Green | Previously resolved alerts |

### Search & Filters

- Search input for filtering alerts by title, message, or source
- Filter by clicking summary cards
- Show/hide resolved alerts toggle

### Alert Cards

Each alert displays:

```
┌─────────────────────────────────────────────────────────────┐
│ [🔴] High CPU Usage on node-gpu-01                     [✕]  │
│     CPU usage has exceeded 90% for more than 15 minutes...  │
│                                                              │
│     🖥 node-gpu-01    ⏰ 5m ago    [Acknowledged]            │
│                                                              │
│     [👁 Acknowledge] [✓ Resolve]                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Alert Severity Levels

| Severity | Icon | Color | Use Case |
|----------|------|-------|----------|
| Critical | AlertCircle | Red | Immediate action required |
| Warning | AlertTriangle | Yellow | Should be monitored |
| Info | Info | Blue | Informational only |
| Resolved | CheckCircle | Green | No longer active |

---

## Alert Source Types

| Type | Icon | Examples |
|------|------|----------|
| Host | Server | node-gpu-01, node-prod-03 |
| VM | Cpu | web-server-01, db-master-01 |
| Storage | HardDrive | ceph-prod-01 |
| Network | Network | Production VLAN 100 |
| Cluster | MemoryStick | Production Cluster |

---

## Actions

### Acknowledge

Marks an alert as seen without resolving it:
```typescript
const handleAcknowledge = (id: string) => {
  setAlerts((prev) =>
    prev.map((alert) => 
      alert.id === id ? { ...alert, acknowledged: true } : alert
    ),
  );
};
```

### Resolve

Marks an alert as resolved:
```typescript
const handleResolve = (id: string) => {
  setAlerts((prev) =>
    prev.map((alert) =>
      alert.id === id 
        ? { ...alert, resolved: true, severity: 'resolved' } 
        : alert
    ),
  );
};
```

### Dismiss

Removes an alert from the list entirely.

---

## Data Structure

```typescript
interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info' | 'resolved';
  title: string;
  message: string;
  source: string;
  sourceType: 'host' | 'vm' | 'storage' | 'network' | 'cluster';
  timestamp: Date;
  acknowledged: boolean;
  resolved: boolean;
}
```

---

## Time Display

Alerts show relative time:
- "Just now" for < 1 minute
- "Xm ago" for < 60 minutes
- "Xh ago" for < 24 hours
- "Xd ago" for >= 24 hours

---

## File Location

- **Page Component**: `frontend/src/pages/Alerts.tsx`

---

## Component Dependencies

- `lucide-react` icons
- `framer-motion` for animations (AnimatePresence for list transitions)
- Shared UI components (`Button`)

---

## Styling

- Cards use severity-specific border colors
- Acknowledged alerts have reduced opacity
- Resolved alerts are hidden by default
- Smooth animations for card appearance/removal

---

## Future Enhancements

1. Alert rules configuration UI
2. Email/Slack notification settings
3. Alert escalation policies
4. Alert grouping by source
5. Alert history and analytics
6. Custom alert thresholds
7. Integration with external monitoring (Prometheus, Zabbix)
8. Alert silencing/snoozing

