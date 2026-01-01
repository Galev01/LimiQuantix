# 000022 - DRS Recommendations Page Documentation

**Component**: DRS (Distributed Resource Scheduler) Recommendations  
**Route**: `/drs`  
**Status**: ✅ Complete  

---

## Overview

The DRS Recommendations page displays VM migration suggestions from the Distributed Resource Scheduler. It helps optimize cluster resource utilization by recommending VM placements based on CPU, memory, and affinity rules.

---

## Features

### Header Section

- Page title "DRS Recommendations" with description
- "DRS Settings" button for configuration
- "Refresh" button for manual refresh
- "Apply All (N)" button to apply pending recommendations

### DRS Status Card

Displays overall DRS state:
- DRS enabled/disabled toggle
- Automation level (Manual/Partial/Full)
- Pending recommendations count
- Applied today count

### Filter Tabs

| Tab | Description |
|-----|-------------|
| All | All recommendations |
| Pending | Awaiting approval |
| Approved | Approved but not yet applied |
| Applied | Successfully executed |
| Rejected | Declined recommendations |

### Recommendation Cards

Expandable cards showing:

**Collapsed View:**
```
┌─────────────────────────────────────────────────────────────┐
│ [>] [⚡] Migrate db-master-01    [Critical]                  │
│         Source host CPU at critical levels (92%)...         │
│                                                              │
│                        +15% CPU  +8% Memory    ⏰ Pending   │
└─────────────────────────────────────────────────────────────┘
```

**Expanded View:**
```
┌─────────────────────────────────────────────────────────────┐
│ [v] [⚡] Migrate db-master-01    [Critical]    ⏰ Pending   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐      ───→      ┌─────────────────┐     │
│  │ Source Host     │   2-3 min      │ Target Host     │     │
│  │ node-gpu-01     │                │ node-prod-04    │     │
│  │ CPU: 92% ▓▓▓▓▓▓ │                │ CPU: 45% ▓▓▓░░░ │     │
│  │ Mem: 88% ▓▓▓▓▓░ │                │ Mem: 52% ▓▓▓░░░ │     │
│  └─────────────────┘                └─────────────────┘     │
│                                                              │
│  VM: db-master-01 | CPU: 45% | Memory: 32%                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ ✓ Expected Improvement                                 │ │
│  │   CPU: +15%    Memory: +8%                              │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│                    [✕ Reject] [✓ Approve] [▶ Apply Now]    │
└─────────────────────────────────────────────────────────────┘
```

---

## Recommendation Priority

| Priority | Color | Description |
|----------|-------|-------------|
| Critical | Red | Immediate action needed, host overloaded |
| High | Yellow | Should be addressed soon |
| Medium | Blue | Optimization opportunity |
| Low | Green | Minor improvement available |

---

## Recommendation Types

| Type | Description |
|------|-------------|
| migrate | Move VM to different host |
| power_on | Start a VM on optimal host |
| power_off | Shut down idle host for power savings |

---

## Data Structure

```typescript
interface DRSRecommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'approved' | 'applied' | 'rejected';
  type: 'migrate' | 'power_on' | 'power_off';
  reason: string;
  impact: {
    cpuImprovement: number;
    memoryImprovement: number;
  };
  vm: {
    id: string;
    name: string;
    currentCpu: number;
    currentMemory: number;
  };
  sourceHost: {
    id: string;
    name: string;
    cpuUsage: number;
    memoryUsage: number;
  };
  targetHost?: {
    id: string;
    name: string;
    cpuUsage: number;
    memoryUsage: number;
  };
  createdAt: Date;
  estimatedDuration: string;
}
```

---

## Actions

### Approve

Marks recommendation as approved for later application:
```typescript
const handleApprove = (id: string) => {
  setRecommendations((prev) =>
    prev.map((r) => 
      r.id === id ? { ...r, status: 'approved' } : r
    ),
  );
};
```

### Reject

Declines the recommendation:
```typescript
const handleReject = (id: string) => {
  setRecommendations((prev) =>
    prev.map((r) => 
      r.id === id ? { ...r, status: 'rejected' } : r
    ),
  );
};
```

### Apply

Executes the recommendation immediately:
```typescript
const handleApply = (id: string) => {
  setRecommendations((prev) =>
    prev.map((r) => 
      r.id === id ? { ...r, status: 'applied' } : r
    ),
  );
};
```

### Apply All

Applies all pending and approved recommendations at once.

---

## Host Card Component

Visual representation of source/target hosts:
- Host name
- CPU usage bar with percentage
- Memory usage bar with percentage
- Color-coded bars (green/yellow/red based on usage)

---

## File Location

- **Page Component**: `frontend/src/pages/DRSRecommendations.tsx`

---

## Component Dependencies

- `lucide-react` icons (Zap, ArrowRight, Server, Cpu, etc.)
- `framer-motion` for expand/collapse animations
- Shared UI components (`Button`, `Badge`)

---

## Styling

- Priority badges with severity-appropriate colors
- Status indicators (pending/approved/applied/rejected)
- Expandable cards with smooth animations
- Host comparison visualization
- Progress bars for resource usage

---

## DRS Automation Levels

| Level | Description |
|-------|-------------|
| Manual | Recommendations only, no automatic action |
| Partial | Automatic approval, manual application |
| Full | Fully automated migration |

---

## Future Enhancements

1. Live migration progress tracking
2. DRS rules configuration
3. Affinity/anti-affinity rule editor
4. Historical DRS performance metrics
5. Predictive recommendations
6. Migration scheduling
7. Cost analysis (power, performance)
8. vMotion compatibility checker

