# 000094 - BGP Top-of-Rack (ToR) Integration

**Purpose:** Document the BGP integration for advertising Quantix-managed IP ranges to physical network infrastructure.

**Status:** ✅ Implemented

---

## Executive Summary

For enterprise deployments, Quantix-KVM can advertise overlay network prefixes to physical Top-of-Rack (ToR) switches via BGP. This enables:

- **Direct VM Access**: Physical servers can reach VMs without tunneling
- **Provider Integration**: Floating IPs routed through physical network
- **Multi-site Connectivity**: BGP enables WAN routing between sites
- **Traffic Engineering**: Control traffic flow with BGP attributes

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Physical Network                                   │
│                                                                           │
│    ┌───────────────┐                      ┌───────────────┐              │
│    │  ToR Switch A │◄───── eBGP ─────────▶│  ToR Switch B │              │
│    │  ASN 65001    │                      │  ASN 65001    │              │
│    └───────┬───────┘                      └───────┬───────┘              │
│            │                                      │                       │
└────────────┼──────────────────────────────────────┼───────────────────────┘
             │                                      │
             │ eBGP                                 │ eBGP
             │                                      │
┌────────────▼──────────────────────────────────────▼───────────────────────┐
│                        Quantix-KVM Cluster                                │
│                                                                           │
│    ┌───────────────────┐              ┌───────────────────┐              │
│    │   QHCI Node 1     │              │   QHCI Node 2     │              │
│    │                   │              │                   │              │
│    │  ┌─────────────┐  │              │  ┌─────────────┐  │              │
│    │  │ FRRouting   │  │              │  │ FRRouting   │  │              │
│    │  │ ASN 65000   │  │              │  │ ASN 65000   │  │              │
│    │  │             │  │              │  │             │  │              │
│    │  │ Advertises: │  │              │  │ Advertises: │  │              │
│    │  │ 10.100.0.0/24│  │              │  │ 10.100.0.0/24│  │              │
│    │  │ 10.200.0.0/24│  │              │  │ 10.200.0.0/24│  │              │
│    │  └─────────────┘  │              │  └─────────────┘  │              │
│    │         │         │              │         │         │              │
│    │         ▼         │              │         ▼         │              │
│    │  ┌─────────────┐  │              │  ┌─────────────┐  │              │
│    │  │ OVN Overlay │  │              │  │ OVN Overlay │  │              │
│    │  │   VMs       │  │              │  │   VMs       │  │              │
│    │  └─────────────┘  │              │  └─────────────┘  │              │
│    └───────────────────┘              └───────────────────┘              │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Control Plane (Go)

**BGPServiceHandler** (`backend/internal/services/network/bgp_handler.go`):
- Connect-RPC handler for BGP management
- FRRouting configuration generation
- Speaker and peer status retrieval

**BGPService** (`backend/internal/services/network/bgp_service.go`):
- BGP speaker lifecycle management
- Peer configuration
- Route advertisement management

### 2. Node Daemon (Rust)

**FrrManager** (`agent/limiquantix-node/src/frr.rs`):
- FRRouting configuration file generation
- Daemon start/stop/reload
- Status monitoring via vtysh

### 3. Frontend

**useBGP Hook** (`frontend/src/hooks/useBGP.ts`):
- React Query hooks for BGP operations
- Speaker, peer, and advertisement management

---

## Data Model

### BGPSpeaker

```go
type BGPSpeaker struct {
    ID          string
    Name        string
    ProjectID   string
    Description string
    Labels      map[string]string
    NodeID      string            // Node where FRR runs
    LocalASN    uint32            // Our ASN
    RouterID    string            // BGP router ID (IPv4)
    Status      BGPSpeakerStatus
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type BGPSpeakerStatus struct {
    Phase            BGPPhase  // "pending", "active", "error"
    EstablishedPeers int
    ErrorMessage     string
}
```

### BGPPeer

```go
type BGPPeer struct {
    ID          string
    SpeakerID   string
    Name        string
    PeerAddress string        // ToR switch IP
    PeerASN     uint32        // ToR ASN
    Password    string        // MD5 auth (optional)
    Status      BGPPeerStatus
    CreatedAt   time.Time
}

type BGPPeerStatus struct {
    State            BGPState  // "Idle", "Connect", "Active", "Established"
    PrefixesReceived int
    PrefixesSent     int
    UptimeSeconds    uint64
}
```

### BGPAdvertisement

```go
type BGPAdvertisement struct {
    ID          string
    SpeakerID   string
    Prefix      string        // CIDR notation
    NextHop     string        // Next-hop for this prefix
    Communities []string      // BGP communities
    LocalPref   int          // Local preference
    CreatedAt   time.Time
}
```

---

## API Reference

### Proto Definition

```protobuf
service BGPService {
  rpc CreateSpeaker(CreateBGPSpeakerRequest) returns (BGPSpeaker);
  rpc GetSpeaker(GetBGPSpeakerRequest) returns (BGPSpeaker);
  rpc ListSpeakers(ListBGPSpeakersRequest) returns (ListBGPSpeakersResponse);
  rpc DeleteSpeaker(DeleteBGPSpeakerRequest) returns (google.protobuf.Empty);
  
  rpc AddPeer(AddBGPPeerRequest) returns (BGPPeer);
  rpc RemovePeer(RemoveBGPPeerRequest) returns (google.protobuf.Empty);
  rpc ListPeers(ListBGPPeersRequest) returns (ListBGPPeersResponse);
  
  rpc AdvertiseNetwork(AdvertiseNetworkRequest) returns (BGPAdvertisement);
  rpc WithdrawNetwork(WithdrawNetworkRequest) returns (google.protobuf.Empty);
  rpc ListAdvertisements(ListAdvertisementsRequest) returns (ListAdvertisementsResponse);
  
  rpc GetSpeakerStatus(GetBGPSpeakerStatusRequest) returns (BGPSpeakerDetailedStatus);
}
```

---

## FRRouting Configuration

### Generated frr.conf

```bash
!
! Quantix-KVM FRRouting Configuration
! Auto-generated - do not edit manually
!
hostname quantix-bgp-node1
log syslog informational
!
router bgp 65000
 bgp router-id 10.0.0.1
 bgp log-neighbor-changes
 no bgp default ipv4-unicast
 !
 neighbor 10.0.0.254 remote-as 65001
 neighbor 10.0.0.254 description ToR-Switch-A
 neighbor 10.0.0.254 password secretpass
 neighbor 10.0.0.254 timers 30 90
 !
 address-family ipv4 unicast
  network 10.100.0.0/24
  network 10.200.0.0/24
  neighbor 10.0.0.254 activate
  neighbor 10.0.0.254 soft-reconfiguration inbound
 exit-address-family
exit
!
line vty
!
end
```

### FRR Manager (Rust)

```rust
// agent/limiquantix-node/src/frr.rs

pub struct FrrManager {
    config_dir: PathBuf,
    vtysh_path: PathBuf,
}

impl FrrManager {
    pub async fn apply_config(&self, config: &FrrConfig) -> Result<(), FrrError> {
        // Generate frr.conf
        let frr_conf = self.generate_frr_conf(config);
        
        // Write config file
        fs::write(&self.config_dir.join("frr.conf"), &frr_conf).await?;
        
        // Reload FRR daemon
        self.reload_frr().await?;
        
        Ok(())
    }
    
    pub async fn get_status(&self) -> Result<FrrStatus, FrrError> {
        // Query BGP summary via vtysh
        let output = self.run_vtysh_command("show bgp summary json").await?;
        let status = self.parse_bgp_summary(&output);
        Ok(status)
    }
}
```

---

## Usage Examples

### Create a BGP Speaker

```bash
curl -X POST http://localhost:8080/api/v1/bgp-speakers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "node1-speaker",
    "project_id": "proj-123",
    "spec": {
      "local_asn": 65000,
      "router_id": "10.0.0.1",
      "node_id": "node-456"
    }
  }'
```

### Add a ToR Peer

```bash
curl -X POST http://localhost:8080/api/v1/bgp-speakers/spk-789/peers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "tor-switch-a",
    "peer_ip": "10.0.0.254",
    "remote_asn": 65001,
    "md5_password": "secretpass",
    "hold_time": 90,
    "keepalive_interval": 30
  }'
```

### Advertise a Network

```bash
curl -X POST http://localhost:8080/api/v1/bgp-speakers/spk-789/advertisements \
  -H "Content-Type: application/json" \
  -d '{
    "cidr": "10.100.0.0/24",
    "next_hop": "10.0.0.1",
    "local_preference": 100,
    "communities": ["65000:100"]
  }'
```

### Check Speaker Status

```bash
curl http://localhost:8080/api/v1/bgp-speakers/spk-789/status

# Response:
{
  "speaker_id": "spk-789",
  "status": {
    "phase": "ACTIVE",
    "active_peers": 2,
    "advertised_routes": 4
  },
  "peers": [
    {
      "id": "peer-1",
      "peer_ip": "10.0.0.254",
      "remote_asn": 65001,
      "state": "ESTABLISHED",
      "prefixes_received": 5,
      "prefixes_advertised": 4,
      "uptime_seconds": 86400
    }
  ],
  "advertisements": [
    {
      "id": "adv-1",
      "cidr": "10.100.0.0/24",
      "next_hop": "10.0.0.1",
      "active": true
    }
  ]
}
```

---

## ToR Switch Configuration

### Cisco IOS-XR Example

```
router bgp 65001
 neighbor 10.0.0.1 remote-as 65000
 neighbor 10.0.0.1 password encrypted <hash>
 neighbor 10.0.0.1 timers 30 90
 !
 address-family ipv4 unicast
  neighbor 10.0.0.1 activate
  neighbor 10.0.0.1 soft-reconfiguration inbound
```

### Arista EOS Example

```
router bgp 65001
   neighbor 10.0.0.1 remote-as 65000
   neighbor 10.0.0.1 password 7 <hash>
   neighbor 10.0.0.1 timers 30 90
   !
   address-family ipv4
      neighbor 10.0.0.1 activate
```

### Cumulus Linux Example

```
router bgp 65001
 neighbor 10.0.0.1 remote-as 65000
 neighbor 10.0.0.1 password secretpass
 !
 address-family ipv4 unicast
  neighbor 10.0.0.1 activate
```

---

## Troubleshooting

### Check FRR Status

```bash
# On the Quantix node
vtysh -c "show bgp summary"
vtysh -c "show bgp neighbors"
vtysh -c "show bgp ipv4 unicast"
```

### Peer Not Establishing

1. Check connectivity:
```bash
ping 10.0.0.254
```

2. Verify ASN configuration:
```bash
vtysh -c "show running-config"
```

3. Check for TCP port 179:
```bash
ss -tlnp | grep 179
```

4. Verify password matches (if MD5 auth):
```bash
# Both sides must have identical password
```

### Routes Not Advertised

1. Verify network statement:
```bash
vtysh -c "show bgp ipv4 unicast neighbors 10.0.0.254 advertised-routes"
```

2. Check route exists locally:
```bash
ip route | grep 10.100.0.0
```

3. Verify address-family activation:
```bash
vtysh -c "show running-config" | grep "neighbor.*activate"
```

### Routes Not Received

1. Check received routes:
```bash
vtysh -c "show bgp ipv4 unicast neighbors 10.0.0.254 received-routes"
```

2. Verify soft-reconfiguration:
```bash
vtysh -c "clear bgp 65001 soft in"
```

---

## Best Practices

### ASN Selection

| Use Case | ASN Range | Notes |
|----------|-----------|-------|
| Private (single site) | 64512-65534 | Safe for internal use |
| Private (multi-site) | Unique per site | Avoid conflicts |
| Public (internet) | Obtain from RIR | Required for public routing |

### Security

1. **Always use MD5 authentication** for BGP sessions
2. **Filter routes** on ToR switches to accept only expected prefixes
3. **Set maximum-prefix limits** to prevent route leaks
4. **Use BFD** for fast failure detection (optional)

### Redundancy

1. **Deploy speakers on multiple nodes** for HA
2. **Peer with multiple ToR switches** for path redundancy
3. **Use ECMP** on ToR for load balancing

---

## Files

| File | Description |
|------|-------------|
| `backend/internal/services/network/bgp_handler.go` | Connect-RPC handler |
| `backend/internal/services/network/bgp_service.go` | Business logic |
| `backend/internal/repository/memory/network_repository.go` | BGP repository |
| `agent/limiquantix-node/src/frr.rs` | FRRouting manager |
| `frontend/src/hooks/useBGP.ts` | React Query hooks |
| `frontend/src/pages/BGPSpeakers.tsx` | UI page |

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - OVN architecture
- [000052-advanced-networking-features.md](000052-advanced-networking-features.md) - Advanced features
