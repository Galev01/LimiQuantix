# 000099 - QHCI Host UI Network Features

**Purpose:** Document the network features available in the QHCI (Quantix Host Client Interface) single-node management UI.

**Status:** ✅ Implemented

---

## Executive Summary

QHCI provides local network management for individual Quantix-OS hypervisor hosts. Unlike QvDC (which manages clusters), QHCI focuses on:

- **OVS Status**: Real-time view of local Open vSwitch configuration
- **Bridge/Port Management**: View and manage OVS bridges and ports
- **Packet Trace**: Debug network flows from the host perspective
- **Traffic Statistics**: Monitor per-port traffic

---

## Available Features

### 1. OVS Status Card

Shows the current state of Open vSwitch on the host:

```
┌─────────────────────────────────────────────────────────────────────┐
│  OVS Status                                              Running ● │
├─────────────────────────────────────────────────────────────────────┤
│  Version: 3.1.0        OVN Connected: Yes                          │
│                                                                     │
│  Bridges: 2            Ports: 12                                   │
├─────────────────────────────────────────────────────────────────────┤
│  ▼ br-int (Integration Bridge)                                     │
│    ├── vm-abc123-port          Active    In: 1.2 MB    Out: 450 KB│
│    ├── vm-def456-port          Active    In: 3.4 MB    Out: 1.1 MB│
│    ├── patch-to-br-ex          Active    In: 5.6 MB    Out: 4.3 MB│
│    └── ovn0                    Active    -             -          │
│                                                                     │
│  ▼ br-ex (External Bridge)                                         │
│    ├── eth0                    Active    In: 100 MB    Out: 45 MB │
│    └── patch-from-br-int       Active    In: 4.3 MB    Out: 5.6 MB│
└─────────────────────────────────────────────────────────────────────┘
```

#### Component

```typescript
// quantix-host-ui/src/components/network/OVSStatusCard.tsx

interface OVSBridge {
  name: string;
  type: 'integration' | 'external' | 'provider';
  ports: OVSPort[];
}

interface OVSPort {
  name: string;
  type: 'vm' | 'patch' | 'physical' | 'internal';
  vmId?: string;
  vmName?: string;
  status: 'active' | 'down' | 'error';
  statistics: {
    rxBytes: number;
    txBytes: number;
    rxPackets: number;
    txPackets: number;
  };
}
```

### 2. Packet Trace Modal

Debug network flows from the local host:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Packet Trace                                                   ✕  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Ingress Port:  [vm-abc123-port        ▼]                          │
│                                                                     │
│  Source IP:     [10.0.0.10            ]                            │
│  Destination IP:[10.0.0.20            ]                            │
│                                                                     │
│  Protocol:      (•) TCP  ( ) UDP  ( ) ICMP                         │
│                                                                     │
│  Destination Port: [80                ]                             │
│                                                                     │
│  [          Run Trace          ]                                   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Result: ✓ ALLOWED                                    45ms         │
├─────────────────────────────────────────────────────────────────────┤
│  → ingress    ls_in_port_sec_l2     next                          │
│  → ingress    ls_in_pre_acl         next                          │
│  → ingress    ls_in_acl             priority=2001, next           │
│  → ingress    ls_in_l2_lkup         output to "vm-def456-port"    │
│  → egress     ls_out_pre_acl        next                          │
│  → egress     ls_out_acl            next                          │
│  → egress     ls_out_port_sec_l2    output                        │
├─────────────────────────────────────────────────────────────────────┤
│  [View Raw Output]                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

#### Component

```typescript
// quantix-host-ui/src/components/network/PacketTraceModal.tsx

interface PacketTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TraceResult {
  verdict: 'allowed' | 'dropped';
  duration: number;
  hops: TraceHop[];
  dropReason?: string;
  rawOutput: string;
}
```

---

## Page Integration

The Network page (`quantix-host-ui/src/pages/Network.tsx`) integrates these components:

```typescript
export default function NetworkPage() {
  const [showPacketTraceModal, setShowPacketTraceModal] = useState(false);
  
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Network</h1>
        <Button onClick={() => setShowPacketTraceModal(true)}>
          <Search className="w-4 h-4 mr-2" />
          Packet Trace
        </Button>
      </div>
      
      {/* OVS Status Card - prominent position */}
      <OVSStatusCard />
      
      {/* Other network components */}
      <div className="grid grid-cols-2 gap-6">
        <NetworkStatistics />
        <BridgeConfiguration />
      </div>
      
      {/* Packet Trace Modal */}
      <PacketTraceModal
        isOpen={showPacketTraceModal}
        onClose={() => setShowPacketTraceModal(false)}
      />
    </div>
  );
}
```

---

## Data Sources

### OVS Status Data

Fetched from the local node daemon API:

```typescript
// API endpoint on QHCI
GET /api/v1/ovs/status

// Response:
{
  "ovs_version": "3.1.0",
  "running": true,
  "ovn_controller_connected": true,
  "bridges": [
    {
      "name": "br-int",
      "type": "integration",
      "ports": [...]
    }
  ]
}
```

### Port Statistics

Real-time statistics via OVS:

```bash
# Command executed by node daemon
ovs-vsctl --format=json list Interface

# Returns port statistics including:
# - statistics:rx_bytes
# - statistics:tx_bytes
# - statistics:rx_packets
# - statistics:tx_packets
```

### Packet Trace

Executes `ovn-trace` locally:

```typescript
// API endpoint
POST /api/v1/network/trace
{
  "in_port": "vm-abc123-port",
  "src_ip": "10.0.0.10",
  "dst_ip": "10.0.0.20",
  "protocol": "tcp",
  "dst_port": 80
}
```

---

## UI Design

### Color Scheme

Following the QHCI dark theme:

| Element | Color |
|---------|-------|
| Card Background | `--bg-surface` |
| Port Active | `text-green-400` |
| Port Down | `text-red-400` |
| Traffic Stats | `text-neonBlue` |
| Trace Allowed | `bg-green-500/10` |
| Trace Dropped | `bg-red-500/10` |

### Responsive Layout

```css
/* OVS Status Card */
.ovs-status-card {
  /* Full width on mobile */
  @apply w-full;
  
  /* Bridge list scrollable */
  .bridge-list {
    max-height: 400px;
    overflow-y: auto;
  }
}
```

---

## Comparison: QHCI vs QvDC

| Feature | QHCI | QvDC |
|---------|------|------|
| **Scope** | Single host | Cluster-wide |
| **OVS Status** | ✅ Detailed local view | ❌ Not applicable |
| **Packet Trace** | ✅ Local execution | ✅ Remote execution |
| **Network Topology** | ❌ | ✅ React Flow graph |
| **Load Balancers** | View only | Full CRUD |
| **VPN Services** | View only | Full CRUD |
| **Security Groups** | View only | Full CRUD |

---

## Files

| File | Description |
|------|-------------|
| `quantix-host-ui/src/components/network/OVSStatusCard.tsx` | OVS status display |
| `quantix-host-ui/src/components/network/PacketTraceModal.tsx` | Trace modal |
| `quantix-host-ui/src/pages/Network.tsx` | Network page |
| `agent/limiquantix-node/src/http_server.rs` | API endpoints |

---

## Future Enhancements

1. **Real-time Traffic Graphs**: Per-port bandwidth charts
2. **Port Mirroring**: Configure SPAN ports for debugging
3. **QoS Configuration**: Per-port rate limiting
4. **VLAN Management**: Tag/untag configuration

---

## See Also

- [000098-networking-index.md](000098-networking-index.md) - Networking documentation index
- [000095-packet-trace-debugging.md](000095-packet-trace-debugging.md) - Packet trace details
