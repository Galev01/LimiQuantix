# 000095 - Packet Trace Debugging (ovn-trace)

**Purpose:** Document the packet trace feature for debugging network flows and identifying ACL drops in OVN.

**Status:** ✅ Implemented

---

## Executive Summary

OVN's complexity can make troubleshooting difficult when packets are unexpectedly dropped. The Packet Trace feature wraps `ovn-trace` to provide:

- **Visual Packet Path**: See exactly which tables a packet traverses
- **Drop Point Identification**: Find which ACL or policy dropped traffic
- **Security Group Debugging**: Understand why firewall rules block traffic
- **User-Friendly Interface**: No need to learn ovn-trace syntax

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        QvDC Dashboard                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  NetworkTopology.tsx / VMDetail.tsx                           │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │                  "Trace Packet" Button                   │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                            │                                  │  │
│  │                            ▼                                  │  │
│  │  ┌─────────────────────────────────────────────────────────┐  │  │
│  │  │  PacketTraceModal                                        │  │  │
│  │  │  - Source Port/VM                                        │  │  │
│  │  │  - Destination IP                                        │  │  │
│  │  │  - Protocol (TCP/UDP/ICMP)                               │  │  │
│  │  │  - Ports (for TCP/UDP)                                   │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────┘
                                     │ REST API
┌────────────────────────────────────▼────────────────────────────────┐
│                        Go Control Plane                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  PacketTraceService (packet_trace.go)                         │  │
│  │  - Build ovn-trace command                                    │  │
│  │  - Execute and capture output                                 │  │
│  │  - Parse trace results                                        │  │
│  │  - Extract hops, verdict, drop reason                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                            │                                         │
│                            ▼ Shell execution                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ovn-trace --ovs <datapath> '<flow-specification>'            │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## How ovn-trace Works

### Flow Specification

ovn-trace simulates a packet through the OVN logical pipeline:

```bash
ovn-trace network-switch \
  'inport=="vm1-port" && eth.src==fa:16:3e:aa:bb:cc && eth.dst==fa:16:3e:dd:ee:ff && eth.type==0x800 && ip4.src==10.0.0.10 && ip4.dst==10.0.0.20 && ip.proto==6 && tcp.dst==80'
```

### Output Explanation

```
ingress(ls=network-1)
-----------------------
 0. ls_in_port_sec_l2: 0 (ct.est), actions=next
 1. ls_in_port_sec_ip: 0 (ct.est), actions=next
 2. ls_in_pre_acl: 0 (ct.est), actions=next
 3. ls_in_acl: priority=2001, match=(ct.est && !ct.rel && !ct.new), actions=next
 4. ls_in_l2_lkup: priority=50, match=(eth.dst==fa:16:3e:dd:ee:ff), actions=output
     >> output to "vm2-port"

egress(ls=network-1)
-----------------------
 5. ls_out_pre_acl: 0 (ct.est), actions=next
 6. ls_out_acl: priority=2001, match=(ct.est), actions=next
 7. ls_out_port_sec_l2: check_port_sec_allow
     >> output to "vm2-port"
```

---

## Implementation

### Backend Service

```go
// backend/internal/services/network/packet_trace.go

type PacketTraceService struct {
    logger *zap.Logger
}

type TraceRequest struct {
    InPort   string  // Source logical switch port
    EthSrc   string  // Source MAC
    EthDst   string  // Destination MAC
    IPSrc    string  // Source IP
    IPDst    string  // Destination IP
    Protocol string  // "tcp", "udp", "icmp"
    SrcPort  int     // For TCP/UDP
    DstPort  int     // For TCP/UDP
    Datapath string  // Logical switch/router name
}

type TraceResult struct {
    Output     string      // Full trace output
    Hops       []TraceHop  // Parsed hops
    Verdict    string      // "allow", "drop", "output"
    DropReason string      // ACL name if dropped
    Dropped    bool        // Whether packet was dropped
    Duration   time.Duration
}

type TraceHop struct {
    Datapath  string  // Logical switch/router
    Pipeline  string  // "ingress" or "egress"
    Table     int     // Table number
    TableName string  // e.g., "ls_in_acl"
    Priority  int     // Match priority
    Match     string  // Match condition
    Actions   string  // Actions taken
    IsDrop    bool    // Whether this hop dropped the packet
}
```

### Building the Trace Command

```go
func (s *PacketTraceService) buildFlowSpec(req TraceRequest) string {
    parts := []string{}
    
    if req.InPort != "" {
        parts = append(parts, fmt.Sprintf("inport==%q", req.InPort))
    }
    
    if req.EthSrc != "" {
        parts = append(parts, fmt.Sprintf("eth.src==%s", req.EthSrc))
    }
    
    if req.IPSrc != "" || req.IPDst != "" {
        parts = append(parts, "eth.type==0x800") // IPv4
        if req.IPSrc != "" {
            parts = append(parts, fmt.Sprintf("ip4.src==%s", req.IPSrc))
        }
        if req.IPDst != "" {
            parts = append(parts, fmt.Sprintf("ip4.dst==%s", req.IPDst))
        }
    }
    
    switch strings.ToLower(req.Protocol) {
    case "tcp":
        parts = append(parts, "ip.proto==6")
        if req.DstPort > 0 {
            parts = append(parts, fmt.Sprintf("tcp.dst==%d", req.DstPort))
        }
    case "udp":
        parts = append(parts, "ip.proto==17")
        if req.DstPort > 0 {
            parts = append(parts, fmt.Sprintf("udp.dst==%d", req.DstPort))
        }
    case "icmp":
        parts = append(parts, "ip.proto==1")
    }
    
    return strings.Join(parts, " && ")
}
```

### Parsing Results

```go
func (s *PacketTraceService) parseTraceOutput(output string) *TraceResult {
    result := &TraceResult{Output: output, Hops: []TraceHop{}}
    
    hopPattern := regexp.MustCompile(`^\s*(\d+)\. (\w+): ([^,]+)(?:, priority (\d+))?`)
    dropPattern := regexp.MustCompile(`(?i)(drop|reject)`)
    
    for _, line := range strings.Split(output, "\n") {
        if matches := hopPattern.FindStringSubmatch(line); matches != nil {
            hop := TraceHop{
                Pipeline:  matches[2],
                TableName: matches[3],
            }
            
            if dropPattern.MatchString(line) {
                hop.IsDrop = true
                result.Dropped = true
                result.DropReason = line
            }
            
            result.Hops = append(result.Hops, hop)
        }
    }
    
    if result.Dropped {
        result.Verdict = "drop"
    } else {
        result.Verdict = "allow"
    }
    
    return result
}
```

---

## Frontend Integration

### QHCI Packet Trace Modal

```typescript
// quantix-host-ui/src/components/network/PacketTraceModal.tsx

interface PacketTraceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PacketTraceModal({ isOpen, onClose }: PacketTraceModalProps) {
  const [inPort, setInPort] = useState('');
  const [srcIP, setSrcIP] = useState('');
  const [dstIP, setDstIP] = useState('');
  const [protocol, setProtocol] = useState('tcp');
  const [dstPort, setDstPort] = useState('80');
  const [isTracing, setIsTracing] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);

  const handleTrace = async () => {
    setIsTracing(true);
    const response = await fetch('/api/v1/network/trace', {
      method: 'POST',
      body: JSON.stringify({ inPort, srcIP, dstIP, protocol, dstPort }),
    });
    const data = await response.json();
    setResult(data);
    setIsTracing(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2>Packet Trace</h2>
      
      {/* Form fields */}
      <Input label="Ingress Port" value={inPort} onChange={setInPort} />
      <Input label="Source IP" value={srcIP} onChange={setSrcIP} />
      <Input label="Destination IP" value={dstIP} onChange={setDstIP} />
      <Select label="Protocol" value={protocol} onChange={setProtocol}>
        <option value="tcp">TCP</option>
        <option value="udp">UDP</option>
        <option value="icmp">ICMP</option>
      </Select>
      
      <Button onClick={handleTrace} loading={isTracing}>
        Run Trace
      </Button>
      
      {/* Results */}
      {result && (
        <TraceResults result={result} />
      )}
    </Modal>
  );
}
```

### Result Visualization

```typescript
function TraceResults({ result }: { result: TraceResult }) {
  return (
    <div>
      {/* Verdict Banner */}
      <div className={result.dropped ? 'bg-red-500/10' : 'bg-green-500/10'}>
        {result.dropped ? (
          <>
            <AlertTriangle className="text-red-400" />
            <span>DROPPED: {result.dropReason}</span>
          </>
        ) : (
          <>
            <CheckCircle className="text-green-400" />
            <span>ALLOWED ({result.duration}ms)</span>
          </>
        )}
      </div>
      
      {/* Hop-by-hop visualization */}
      <div className="space-y-1">
        {result.hops.map((hop, i) => (
          <div key={i} className={hop.isDrop ? 'bg-red-500/10' : 'bg-bg-surface'}>
            <ChevronRight />
            <span className="text-xs">{hop.pipeline}</span>
            <span className="font-mono">{hop.tableName}</span>
            <span className="text-xs">priority {hop.priority}</span>
            <span className={hop.isDrop ? 'text-red-400' : 'text-neonBlue'}>
              {hop.actions}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## REST API

### Endpoint

```
POST /api/v1/network/trace
```

### Request

```json
{
  "in_port": "vm1-port",
  "ip_src": "10.0.0.10",
  "ip_dst": "10.0.0.20",
  "protocol": "tcp",
  "dst_port": 80
}
```

### Response

```json
{
  "output": "ingress(ls=network-1)\n-----------------------\n...",
  "hops": [
    {
      "pipeline": "ingress",
      "table_name": "ls_in_port_sec_l2",
      "priority": 0,
      "actions": "next",
      "is_drop": false
    },
    {
      "pipeline": "ingress",
      "table_name": "ls_in_acl",
      "priority": 2001,
      "actions": "drop",
      "is_drop": true
    }
  ],
  "verdict": "drop",
  "drop_reason": "ACL deny-all-ingress (priority 2001)",
  "dropped": true,
  "duration_ms": 45,
  "timestamp": "2026-01-31T10:30:00Z"
}
```

---

## Common Scenarios

### Scenario 1: Security Group Blocking Traffic

**Symptom**: VM cannot reach another VM on same network.

**Trace Result**:
```
ingress(ls=network-1)
 0. ls_in_port_sec_l2: 0, actions=next
 1. ls_in_pre_acl: 0, actions=next
 2. ls_in_acl: priority=1000, match=(outport=="vm2-port" && tcp.dst==22), actions=drop
     >> DROPPED by security group "default"
```

**Resolution**: Add security group rule to allow SSH.

### Scenario 2: Routing Missing

**Symptom**: VM cannot reach external network.

**Trace Result**:
```
ingress(ls=network-1)
 0-6. ... (all pass)
 7. ls_in_l2_lkup: priority=0, match=(eth.dst==router-mac), actions=output

ingress(lr=router-1)
 8. lr_in_ip_routing: priority=0, actions=drop
     >> No route to destination
```

**Resolution**: Add route to external network on router.

### Scenario 3: MAC Address Spoofing Blocked

**Symptom**: VM with manually set MAC cannot send traffic.

**Trace Result**:
```
ingress(ls=network-1)
 0. ls_in_port_sec_l2: priority=50, actions=drop
     >> Port security: MAC mismatch
```

**Resolution**: Update port's allowed MAC addresses.

---

## Troubleshooting

### ovn-trace Command Not Found

```bash
# Verify OVN tools installed
which ovn-trace

# On Quantix-OS, should be at:
/usr/bin/ovn-trace
```

### Permission Denied

```bash
# ovn-trace requires access to OVN NB database
# Verify connection string
ovn-nbctl show

# If using TCP:
export OVN_NB_DB=tcp:127.0.0.1:6641
```

### Trace Hangs

```bash
# Check if OVN NB database is responsive
ovn-nbctl --timeout=5 show

# Check ovn-northd status
systemctl status ovn-northd
```

---

## OVN Table Reference

### Logical Switch Ingress Tables

| Table | Name | Description |
|-------|------|-------------|
| 0 | ls_in_port_sec_l2 | Port security (L2) |
| 1 | ls_in_port_sec_ip | Port security (IP) |
| 2 | ls_in_port_sec_nd | Port security (ND) |
| 3 | ls_in_pre_acl | Pre-ACL processing |
| 4 | ls_in_pre_lb | Pre-LB processing |
| 5 | ls_in_acl | ACL (Security Groups) |
| 6 | ls_in_lb | Load balancing |
| 7 | ls_in_l2_lkup | L2 lookup (forwarding) |

### Logical Switch Egress Tables

| Table | Name | Description |
|-------|------|-------------|
| 0 | ls_out_pre_acl | Pre-ACL processing |
| 1 | ls_out_acl | ACL (Security Groups) |
| 2 | ls_out_port_sec_l2 | Port security (L2) |

### Logical Router Tables

| Table | Name | Description |
|-------|------|-------------|
| 0 | lr_in_admission | Admission control |
| 1 | lr_in_ip_input | IP input processing |
| 2 | lr_in_defrag | Defragmentation |
| 3 | lr_in_dnat | Destination NAT |
| 4 | lr_in_ip_routing | IP routing lookup |
| 5 | lr_in_arp_resolve | ARP resolution |
| 6 | lr_in_gw_redirect | Gateway redirect |
| 7 | lr_in_arp_request | ARP request |

---

## Files

| File | Description |
|------|-------------|
| `backend/internal/services/network/packet_trace.go` | Trace service |
| `quantix-host-ui/src/components/network/PacketTraceModal.tsx` | QHCI UI |
| `quantix-host-ui/src/pages/Network.tsx` | Network page with trace button |

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - OVN architecture
- [OVN Trace Manual](https://man7.org/linux/man-pages/man8/ovn-trace.8.html) - Official documentation
