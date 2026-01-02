# 000020 - Monitoring Page Documentation

**Component**: Monitoring Dashboard  
**Route**: `/monitoring`  
**Status**: ✅ Complete  

---

## Overview

The Monitoring page provides real-time infrastructure metrics and performance monitoring for the limiquantix virtualization platform. It features interactive charts, host performance tables, and quick stats for at-a-glance health assessment.

---

## Features

### Header Section

- Page title "Monitoring" with description
- Time range selector (1H, 6H, 24H, 7D, 30D)
- Refresh button for manual data refresh

### Metric Summary Cards

| Card | Icon | Color | Trend Display |
|------|------|-------|---------------|
| CPU Usage | Cpu | Blue | ↑/↓ percentage |
| Memory Usage | MemoryStick | Purple | ↑/↓ percentage |
| Storage Usage | HardDrive | Green | ↑/↓ percentage |
| Network I/O | Network | Orange | ↑/↓ percentage |

Each card shows:
- Current value as percentage
- Trend indicator (up/down/stable)
- Trend percentage change

### Resource Utilization Chart

- **Type**: Area chart (Recharts)
- **Data**: CPU, Memory, Storage over 24 hours
- **Features**:
  - Gradient fills for visual depth
  - Custom tooltip with formatted values
  - Legend for series identification
  - Grid lines for readability

### Network Throughput Chart

- **Type**: Line chart (Recharts)
- **Data**: Inbound and outbound traffic
- **Features**:
  - Dual line series (cyan/orange)
  - Smooth curves with no dots
  - Time-based X-axis

### Quick Stats

| Stat | Description |
|------|-------------|
| Active Hosts | Count of online hosts (e.g., "8 / 8") |
| Running VMs | Running vs total VMs (e.g., "65 / 93") |
| Active Alerts | Count with warning color if > 0 |
| Avg Temperature | Average host temperature |

### Host Performance Table

| Column | Description |
|--------|-------------|
| Host | Hostname with status indicator (green/yellow/red dot) |
| CPU | Usage bar with percentage |
| Memory | Usage bar with percentage |
| VMs | Count of VMs on host |
| Status | Badge (healthy/warning/critical) |

---

## Technical Implementation

### Libraries Used

- **recharts**: React charting library for Area and Line charts
- **framer-motion**: Animations for cards and table rows
- **lucide-react**: Icons

### Data Generation

Mock time-series data is generated with:
```typescript
function generateTimeSeriesData(hours: number, baseValue: number, variance: number) {
  // Generates random data points around baseValue with variance
}
```

### Auto-Refresh

The page auto-refreshes metrics every 30 seconds:
```typescript
useEffect(() => {
  const interval = setInterval(() => {
    setMetrics(generateClusterMetrics());
  }, 30000);
  return () => clearInterval(interval);
}, []);
```

### Color Coding

- **< 70%**: Blue (normal)
- **70-85%**: Yellow/warning
- **> 85%**: Red/critical

---

## File Location

- **Page Component**: `frontend/src/pages/Monitoring.tsx`

---

## Component Dependencies

- `recharts`: LineChart, AreaChart, ResponsiveContainer, Tooltip, etc.
- `lucide-react` icons
- `framer-motion` for animations
- Shared UI components (`Button`)

---

## Future Enhancements

1. Real gRPC streaming for live updates
2. Custom dashboard layouts
3. Alert thresholds visualization
4. Historical data comparison
5. Export to PDF/CSV
6. VM-level drill-down
7. Custom metric selection
8. Prometheus/Grafana integration

