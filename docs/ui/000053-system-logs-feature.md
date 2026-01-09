# System Logs Feature

**Document ID:** 000053  
**Date:** January 9, 2026  
**Scope:** Quantix-OS Host UI, Quantix-vDC Frontend, Node Daemon (Rust), Control Plane (Go)

## Overview

The System Logs feature provides a comprehensive log viewing interface for both Quantix-OS (single host management) and Quantix-vDC (cluster management). It enables operators to view, filter, search, and stream real-time structured logs from the system.

## Features

### Log Viewing
- **Real-time streaming**: WebSocket-based live log updates
- **Historical logs**: Paginated fetch of past log entries
- **Auto-scroll**: Automatically scrolls to new logs, with manual override

### Filtering
- **By Level**: trace, debug, info, warn, error
- **By Source**: Filter by service/component name
- **By Search**: Full-text search across messages and structured fields

### Log Details
- **Expandable rows**: Click to expand and see full structured data
- **Structured fields**: View key-value pairs from structured logging
- **Stack traces**: Error logs display stack traces when available
- **Raw JSON**: View the complete log entry as JSON

### Export
- **Download**: Export filtered logs as JSON file
- **Copy**: Copy individual log entries to clipboard

## Architecture

### Quantix-OS (Single Host)

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  Host UI        │◄──────────────────►│  Node Daemon     │
│  (React)        │                    │  (Rust/Axum)     │
│                 │     REST API       │                  │
│  /logs page     │◄──────────────────►│  /api/v1/logs    │
└─────────────────┘                    └──────────────────┘
                                              │
                                              ▼
                                       ┌──────────────────┐
                                       │  journald        │
                                       │  (Linux)         │
                                       └──────────────────┘
```

### Quantix-vDC (Cluster)

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│  vDC Frontend   │◄──────────────────►│  Control Plane   │
│  (React)        │                    │  (Go)            │
│                 │     REST API       │                  │
│  /logs page     │◄──────────────────►│  /api/logs       │
└─────────────────┘                    └──────────────────┘
                                              │
                                              ▼
                                       ┌──────────────────┐
                                       │  journald        │
                                       │  (Linux)         │
                                       └──────────────────┘
```

## API Endpoints

### Quantix-OS Node Daemon (Rust)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/logs` | Fetch logs with filtering |
| GET | `/api/v1/logs/sources` | Get available log sources |
| WS | `/api/v1/logs/stream` | WebSocket log streaming |

#### Query Parameters for GET /api/v1/logs

| Parameter | Type | Description |
|-----------|------|-------------|
| `level` | string | Filter by log level (trace/debug/info/warn/error) |
| `source` | string | Filter by source/component |
| `search` | string | Full-text search |
| `limit` | number | Max entries to return (default: 100, max: 1000) |
| `offset` | number | Pagination offset |
| `since` | string | ISO8601 timestamp for start range |
| `until` | string | ISO8601 timestamp for end range |

### Quantix-vDC Control Plane (Go)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/logs` | Fetch logs with filtering |
| GET | `/api/logs/sources` | Get available log sources |
| WS | `/api/logs/stream` | WebSocket log streaming |

Query parameters are identical to the Node Daemon.

## Log Entry Format

```json
{
  "timestamp": "2026-01-09T12:34:56.789Z",
  "level": "info",
  "message": "VM 'test-vm' created successfully",
  "source": "vm-service",
  "fields": {
    "vm_id": "vm-12345",
    "request_id": "req-abc123",
    "duration_ms": 150
  },
  "stackTrace": null,
  "requestId": "req-abc123",
  "vmId": "vm-12345",
  "nodeId": "node-1",
  "durationMs": 150
}
```

## UI Components

### Logs Page (`/logs`)

The main logs viewing page with:
- Header with streaming controls and actions
- Filter bar with level buttons, source dropdown, and search
- Log list with expandable rows
- Details panel for selected log

### Navigation

**Quantix-OS Host UI:**
- Dashboard → Events → **System Logs** → Configuration

**Quantix-vDC Frontend:**
- Operations → Monitoring → Alerts → DRS → **System Logs**

## Implementation Details

### Rust (Node Daemon)

The logs endpoint reads from:
1. **journald** (Linux): Uses `journalctl -o json` for structured log output
2. **Sample logs** (fallback): Generated sample logs for development/testing

Key features:
- Async WebSocket handling with Axum
- JSON parsing of journald output
- Priority-to-level mapping (0-3: error, 4: warn, 5-6: info, 7: debug)

### Go (Control Plane)

The logs handler includes:
- In-memory ring buffer for recent logs (1000 entries)
- WebSocket broadcast to all connected clients
- Background goroutine for log collection
- journald integration with JSON output parsing

### React (Frontend)

Components:
- `useLogs` hook: TanStack Query for fetching logs
- `useLogStream` hook: WebSocket connection with auto-reconnect
- `LogRow` component: Individual log entry with expand/collapse
- `LogDetailsPanel` component: Full log details view

## Configuration

### Log Sources

Default sources reported by the API:

**Node Daemon:**
- limiquantix-node
- kernel
- systemd
- libvirtd
- qemu
- network
- storage

**Control Plane:**
- controlplane
- vm-service
- node-service
- storage-service
- network-service
- scheduler
- api
- grpc

## Usage Examples

### Viewing Error Logs
1. Navigate to System Logs page
2. Click "ERROR" in the level filter
3. Logs are filtered to show only errors

### Searching for VM Operations
1. Enter "VM" in the search box
2. Results show all logs containing "VM" in message or fields

### Real-time Monitoring
1. Ensure streaming is enabled (Play button)
2. Logs appear automatically as they're generated
3. Auto-scroll keeps view at the bottom

### Exporting Logs
1. Apply desired filters
2. Click Download button
3. JSON file is downloaded with filtered logs

## Future Enhancements

1. **Log aggregation**: Collect logs from all nodes in cluster
2. **Log retention**: Configure log storage duration
3. **Log forwarding**: Send logs to external systems (Loki, Elasticsearch)
4. **Alert integration**: Create alerts based on log patterns
5. **Log correlation**: Link related logs by request ID
