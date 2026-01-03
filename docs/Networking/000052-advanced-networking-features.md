# 000052 - Advanced Networking Features

**Purpose:** Documentation for advanced QuantumNet features: L4 Load Balancing, WireGuard Bastion VPN, and BGP ToR Integration.

**Status:** ✅ Complete

---

## Overview

QuantumNet provides enterprise-grade networking features beyond basic connectivity:

1. **L4 Load Balancing** - Distribute traffic across VM pools via OVN LB
2. **WireGuard Bastion** - Secure VPN access to overlay networks
3. **BGP ToR Integration** - Advertise overlay routes to physical switches

---

## Part 1: L4 Load Balancing

OVN provides native L4 load balancing without requiring external load balancer VMs.

### 1.1 Architecture

```
                     ┌─────────────────────┐
                     │    OVN Load         │
                     │    Balancer         │
                     │  VIP: 10.0.0.100:80 │
                     └──────────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
       ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
       │   Web VM 1  │   │   Web VM 2  │   │   Web VM 3  │
       │ 10.0.1.10   │   │ 10.0.1.11   │   │ 10.0.1.12   │
       └─────────────┘   └─────────────┘   └─────────────┘
```

### 1.2 Create a Load Balancer

```bash
# Via LimiQuantix API
curl -X POST http://localhost:8080/limiquantix.network.v1.LoadBalancerService/CreateLoadBalancer \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web-lb",
    "network_id": "net-123",
    "project_id": "default",
    "vip": "10.0.0.100",
    "algorithm": "ROUND_ROBIN",
    "protocol": "TCP"
  }'
```

### 1.3 Add Listeners and Members

```bash
# Add listener (frontend port)
curl -X POST http://localhost:8080/limiquantix.network.v1.LoadBalancerService/AddListener \
  -H "Content-Type: application/json" \
  -d '{
    "load_balancer_id": "lb-123",
    "port": 80,
    "protocol": "TCP",
    "name": "http"
  }'

# Add members (backend servers)
curl -X POST http://localhost:8080/limiquantix.network.v1.LoadBalancerService/AddMember \
  -H "Content-Type: application/json" \
  -d '{
    "load_balancer_id": "lb-123",
    "address": "10.0.1.10",
    "port": 80,
    "weight": 1
  }'

curl -X POST http://localhost:8080/limiquantix.network.v1.LoadBalancerService/AddMember \
  -H "Content-Type: application/json" \
  -d '{
    "load_balancer_id": "lb-123",
    "address": "10.0.1.11",
    "port": 80,
    "weight": 1
  }'
```

### 1.4 Load Balancing Algorithms

| Algorithm | Description |
|-----------|-------------|
| `ROUND_ROBIN` | Distribute requests evenly in rotation |
| `LEAST_CONNECTIONS` | Route to server with fewest active connections |
| `SOURCE_IP` | Hash source IP for session persistence |
| `WEIGHTED` | Use member weights for distribution |

### 1.5 OVN Implementation

LimiQuantix creates OVN load balancers using:

```bash
# OVN creates load balancer
ovn-nbctl lb-add web-lb 10.0.0.100:80 10.0.1.10:80,10.0.1.11:80

# Attach to logical switch or router
ovn-nbctl ls-lb-add production-switch web-lb
# or
ovn-nbctl lr-lb-add project-router web-lb
```

### 1.6 Health Checks

Configure health checks for automatic member removal:

```json
{
  "load_balancer_id": "lb-123",
  "health_check": {
    "protocol": "TCP",
    "port": 80,
    "interval_sec": 5,
    "timeout_sec": 3,
    "unhealthy_threshold": 3,
    "healthy_threshold": 2
  }
}
```

---

## Part 2: WireGuard Bastion VPN

WireGuard provides secure, direct access to overlay networks from external clients (laptops, remote offices).

### 2.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              External Network                                │
│                                                                              │
│    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐        │
│    │   Laptop     │        │   Developer  │        │  Remote      │        │
│    │ WireGuard    │───────▶│   Machine    │───────▶│  Office      │        │
│    │  Client      │        │              │        │              │        │
│    └──────────────┘        └──────────────┘        └──────────────┘        │
│                                    │                                         │
└────────────────────────────────────│─────────────────────────────────────────┘
                                     │ UDP 51820
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LimiQuantix Cluster                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  WireGuard Gateway (Bastion)                                          │  │
│  │  Public IP: 203.0.113.10                                              │  │
│  │  Private IP: 10.0.0.1 (overlay)                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                          Overlay Network                                     │
│                                    │                                         │
│    ┌──────────────┐        ┌──────────────┐        ┌──────────────┐        │
│    │   VM 1       │        │   VM 2       │        │   VM 3       │        │
│    │ 10.0.1.10    │        │ 10.0.1.11    │        │ 10.0.1.12    │        │
│    └──────────────┘        └──────────────┘        └──────────────┘        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Create VPN Service

```bash
# Create WireGuard VPN gateway
curl -X POST http://localhost:8080/limiquantix.network.v1.VpnService/CreateVpnService \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dev-vpn",
    "network_id": "net-123",
    "project_id": "default",
    "router_id": "router-456",
    "external_ip": "203.0.113.10",
    "local_subnets": ["10.0.1.0/24", "10.0.2.0/24"]
  }'
```

### 2.3 Add Client Connection

```bash
# Add a VPN client
curl -X POST http://localhost:8080/limiquantix.network.v1.VpnService/AddConnection \
  -H "Content-Type: application/json" \
  -d '{
    "vpn_service_id": "vpn-123",
    "name": "johns-laptop",
    "peer_address": "10.99.0.10/32",
    "peer_public_key": "abc123...base64..."
  }'
```

### 2.4 Get Client Configuration

```bash
# Get WireGuard config for client
curl -X POST http://localhost:8080/limiquantix.network.v1.VpnService/GetClientConfig \
  -H "Content-Type: application/json" \
  -d '{
    "vpn_service_id": "vpn-123",
    "connection_id": "conn-456"
  }'
```

Response:

```ini
[Interface]
# Name: johns-laptop
PrivateKey = <YOUR_PRIVATE_KEY>
Address = 10.99.0.10/32

[Peer]
# LimiQuantix VPN Gateway
PublicKey = xyz789...base64...
Endpoint = 203.0.113.10:51820
AllowedIPs = 10.0.1.0/24, 10.0.2.0/24
PersistentKeepalive = 25
```

### 2.5 Client Setup

**macOS/Linux:**
```bash
# Install WireGuard
brew install wireguard-tools  # macOS
apt install wireguard         # Ubuntu

# Save config and connect
sudo wg-quick up /path/to/limiquantix.conf
```

**Windows:**
1. Download WireGuard from https://wireguard.com/install/
2. Import the configuration file
3. Click "Activate"

### 2.6 Security Features

| Feature | Description |
|---------|-------------|
| **Automatic Key Rotation** | Keys can be rotated without reconnecting |
| **Per-User Access** | Each user gets a unique keypair |
| **Network Isolation** | VPN clients only access allowed subnets |
| **Audit Logging** | All connections are logged |

---

## Part 3: BGP ToR Integration

BGP integration allows LimiQuantix to advertise overlay routes to physical Top-of-Rack (ToR) switches.

### 3.1 Use Cases

- **Bare-metal servers** can access overlay networks directly
- **External load balancers** can route to VIP addresses
- **Multi-site connectivity** via BGP peering between sites
- **Hybrid cloud** integration with on-premises networks

### 3.2 Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Data Center Network                                │
│                                                                              │
│    ┌──────────────┐              ┌──────────────┐              ┌──────────┐ │
│    │  Core Switch │──────────────│  Core Switch │──────────────│ External │ │
│    │   (AS 65000) │     eBGP     │   (AS 65000) │              │ Network  │ │
│    └──────┬───────┘              └──────┬───────┘              └──────────┘ │
│           │                             │                                    │
│    ┌──────┴───────┐              ┌──────┴───────┐                           │
│    │   ToR Switch │              │   ToR Switch │                           │
│    │   (AS 65001) │              │   (AS 65002) │                           │
│    └──────┬───────┘              └──────┬───────┘                           │
│           │ iBGP                        │ iBGP                              │
│    ┌──────┴───────┐              ┌──────┴───────┐                           │
│    │  BGP Speaker │              │  BGP Speaker │                           │
│    │   (Node 1)   │              │   (Node 2)   │                           │
│    │   AS 65001   │              │   AS 65002   │                           │
│    │              │              │              │                           │
│    │ Advertises:  │              │ Advertises:  │                           │
│    │ 10.0.1.0/24  │              │ 10.0.2.0/24  │                           │
│    │ 10.0.100.10  │              │ 10.0.100.11  │                           │
│    └──────────────┘              └──────────────┘                           │
│                                                                              │
│    ┌──────────────────────────────────────────────────────────────────────┐ │
│    │                      LimiQuantix Overlay Networks                     │ │
│    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │ │
│    │  │  VM 1    │  │  VM 2    │  │  VM 3    │  │  VM 4    │             │ │
│    │  │10.0.1.10 │  │10.0.1.11 │  │10.0.2.10 │  │10.0.2.11 │             │ │
│    │  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │ │
│    └──────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Create BGP Speaker

```bash
# Create BGP speaker on a node
curl -X POST http://localhost:8080/limiquantix.network.v1.BGPService/CreateBGPSpeaker \
  -H "Content-Type: application/json" \
  -d '{
    "node_id": "node-1",
    "local_asn": 65001,
    "router_id": "192.168.1.10",
    "project_id": "default"
  }'
```

### 3.4 Add ToR Switch Peer

```bash
# Add ToR switch as BGP peer
curl -X POST http://localhost:8080/limiquantix.network.v1.BGPService/AddBGPPeer \
  -H "Content-Type: application/json" \
  -d '{
    "speaker_id": "speaker-123",
    "name": "tor-switch-1",
    "peer_address": "192.168.1.1",
    "peer_asn": 65000,
    "password": "bgp-md5-secret"
  }'
```

### 3.5 Advertise Network Prefixes

```bash
# Advertise overlay network to ToR
curl -X POST http://localhost:8080/limiquantix.network.v1.BGPService/AdvertiseNetwork \
  -H "Content-Type: application/json" \
  -d '{
    "speaker_id": "speaker-123",
    "prefix": "10.0.1.0/24",
    "next_hop": "192.168.1.10",
    "communities": ["65001:100"],
    "local_pref": 100
  }'

# Advertise VIP for load balancer
curl -X POST http://localhost:8080/limiquantix.network.v1.BGPService/AdvertiseNetwork \
  -H "Content-Type: application/json" \
  -d '{
    "speaker_id": "speaker-123",
    "prefix": "10.0.100.10/32",
    "next_hop": "192.168.1.10"
  }'
```

### 3.6 BGP Daemon Integration

LimiQuantix deploys FRRouting (FRR) on nodes to handle BGP:

```
frr.conf:
router bgp 65001
  bgp router-id 192.168.1.10
  
  neighbor 192.168.1.1 remote-as 65000
  neighbor 192.168.1.1 password bgp-md5-secret
  
  address-family ipv4 unicast
    network 10.0.1.0/24
    neighbor 192.168.1.1 activate
    neighbor 192.168.1.1 route-map EXPORT-TO-TOR out
  exit-address-family

route-map EXPORT-TO-TOR permit 10
  set community 65001:100
```

### 3.7 Monitoring BGP Status

```bash
# List BGP peers
curl -X POST http://localhost:8080/limiquantix.network.v1.BGPService/ListBGPPeers \
  -H "Content-Type: application/json" \
  -d '{"speaker_id": "speaker-123"}'

# Response includes peer state
{
  "peers": [
    {
      "id": "peer-456",
      "name": "tor-switch-1",
      "peer_address": "192.168.1.1",
      "peer_asn": 65000,
      "status": {
        "state": "ESTABLISHED",
        "prefixes_received": 5,
        "prefixes_sent": 3,
        "uptime": "2h35m"
      }
    }
  ]
}
```

### 3.8 BGP Best Practices

| Practice | Description |
|----------|-------------|
| **Use MD5 Authentication** | Prevent BGP hijacking |
| **Set Route Filters** | Only accept/advertise expected prefixes |
| **Use BFD** | Fast failure detection (sub-second) |
| **Document ASN Allocation** | Keep track of private ASN usage |
| **Monitor Sessions** | Alert on BGP state changes |

---

## Quick Reference

### Load Balancer Commands

| Command | Purpose |
|---------|---------|
| `ovn-nbctl lb-add` | Create load balancer |
| `ovn-nbctl lb-del` | Delete load balancer |
| `ovn-nbctl lb-list` | List load balancers |
| `ovn-nbctl ls-lb-add` | Attach LB to switch |
| `ovn-nbctl lr-lb-add` | Attach LB to router |

### WireGuard Commands

| Command | Purpose |
|---------|---------|
| `wg-quick up <conf>` | Start VPN connection |
| `wg-quick down <conf>` | Stop VPN connection |
| `wg show` | Show connection status |
| `wg genkey` | Generate private key |
| `wg pubkey` | Derive public key |

### BGP Commands (FRR)

| Command | Purpose |
|---------|---------|
| `vtysh -c "show bgp summary"` | Show BGP peer summary |
| `vtysh -c "show bgp neighbors"` | Show peer details |
| `vtysh -c "show ip route bgp"` | Show BGP routes |
| `vtysh -c "clear bgp *"` | Reset all BGP sessions |

---

## References

- [OVN Load Balancer](https://docs.ovn.org/en/latest/ref/ovn-nb.5.html#load-balancer-table)
- [WireGuard Documentation](https://www.wireguard.com/quickstart/)
- [FRRouting BGP Guide](https://docs.frrouting.org/en/latest/bgp.html)
