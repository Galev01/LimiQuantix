# 000093 - WireGuard VPN Bastion Service

**Purpose:** Document the WireGuard-based VPN service for secure remote access to Quantix-KVM virtual networks.

**Status:** ✅ Implemented

---

## Executive Summary

The WireGuard VPN Bastion provides secure overlay access to virtual networks without exposing individual VMs to the internet. Key differentiators:

- **Modern Protocol**: WireGuard (fast, secure, lightweight)
- **QR Code Config**: Mobile-friendly client setup
- **High Availability**: Floating IP with automatic failover
- **OVN Integration**: Routes through overlay network

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          External Network                                │
│                                                                          │
│    ┌──────────────┐                    ┌─────────────────────────────┐  │
│    │ Remote User  │──── WireGuard ────▶│  Floating IP (VPN Endpoint) │  │
│    │ (Laptop/Phone)                    │  192.168.0.200:51820        │  │
│    └──────────────┘                    └────────────┬────────────────┘  │
│                                                     │                    │
└─────────────────────────────────────────────────────┼────────────────────┘
                                                      │
┌─────────────────────────────────────────────────────▼────────────────────┐
│                       Quantix-KVM Cluster                                 │
│                                                                           │
│    ┌────────────────────────────────────────────────────────────────┐    │
│    │              WireGuard Bastion Node                            │    │
│    │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐ │    │
│    │  │   wg0        │───▶│  OVN Router  │───▶│  Virtual Network │ │    │
│    │  │ 10.200.200.1 │    │              │    │  10.0.0.0/24     │ │    │
│    │  └──────────────┘    └──────────────┘    └──────────────────┘ │    │
│    └────────────────────────────────────────────────────────────────┘    │
│                                                                           │
│    ┌──────────────────────────────────────────────────────────────────┐  │
│    │                     VMs on Virtual Network                        │  │
│    │    ┌──────────┐    ┌──────────┐    ┌──────────┐                  │  │
│    │    │ VM-1     │    │ VM-2     │    │ VM-3     │                  │  │
│    │    │ 10.0.0.10│    │ 10.0.0.11│    │ 10.0.0.12│                  │  │
│    │    └──────────┘    └──────────┘    └──────────┘                  │  │
│    └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Control Plane (Go)

**VpnServiceHandler** (`backend/internal/services/network/vpn_handler.go`):
- Connect-RPC handler for VPN management
- Wraps VpnServiceManager business logic
- QR code generation for client config

**VpnServiceManager** (`backend/internal/services/network/vpn_service.go`):
- VPN lifecycle management (Create, Get, List, Delete)
- Connection/peer management
- WireGuard keypair generation

**VpnHAManager** (`backend/internal/services/network/vpn_service.go`):
- Health monitoring of bastion nodes
- Automatic failover to standby node
- Floating IP reassociation

### 2. Node Daemon (Rust)

**WireGuardManager** (`agent/limiquantix-node/src/wireguard.rs`):
- wg0 interface creation/configuration
- Peer management (add/remove)
- Config file generation
- Interface status monitoring

### 3. Frontend

**useVPN Hook** (`frontend/src/hooks/useVPN.ts`):
- React Query hooks for VPN operations
- CRUD mutations with cache invalidation

**VPNServices Page** (`frontend/src/pages/VPNServices.tsx`):
- VPN service listing and management
- Connection management
- QR code display

---

## Data Model

### VpnService

```go
type VpnService struct {
    ID          string
    Name        string
    Description string
    ProjectID   string
    Labels      map[string]string
    Spec        VpnServiceSpec
    Status      VpnServiceStatus
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type VpnServiceSpec struct {
    RouterID     string
    NetworkID    string
    ExternalIP   string           // Floating IP endpoint
    LocalSubnets []string         // Networks accessible via VPN
    Connections  []VpnConnection  // Client peers
}

type VpnConnection struct {
    ID            string
    Name          string
    PublicKey     string    // Client's WireGuard public key
    PeerAddress   string    // Client endpoint (optional)
    PeerCIDRs     []string  // Client's allowed IPs
    PSK           string    // Pre-shared key
    PeerPublicKey string    // For site-to-site
    Status        string    // "active", "pending", "inactive"
}

type VpnServiceStatus struct {
    Phase        VpnPhase    // "pending", "active", "error"
    PublicIP     string      // Assigned floating IP
    NodeID       string      // Node hosting the bastion
    ErrorMessage string
}
```

---

## API Reference

### Proto Definition

```protobuf
service VpnServiceManager {
  rpc CreateVpn(CreateVpnRequest) returns (VpnService);
  rpc GetVpn(GetVpnRequest) returns (VpnService);
  rpc ListVpns(ListVpnsRequest) returns (ListVpnsResponse);
  rpc DeleteVpn(DeleteVpnRequest) returns (google.protobuf.Empty);
  
  rpc AddConnection(AddConnectionRequest) returns (VpnService);
  rpc RemoveConnection(RemoveConnectionRequest) returns (VpnService);
  
  rpc GetVpnStatus(GetVpnStatusRequest) returns (VpnTunnelStatus);
}
```

### Client Config Generation

The `GetClientConfigQR` method generates a WireGuard configuration:

```ini
[Interface]
PrivateKey = <client_private_key>
Address = 10.200.200.2/24
DNS = 10.0.0.1

[Peer]
PublicKey = <server_public_key>
Endpoint = 192.168.0.200:51820
AllowedIPs = 10.0.0.0/24, 10.200.200.0/24
PersistentKeepalive = 25
```

---

## High Availability

### Failover Process

```go
// VpnHAManager monitors bastion health and performs failover

func (m *VpnHAManager) performFailover(ctx context.Context, vpnID string) {
    // 1. Get VPN configuration
    vpn := m.vpnManager.Get(ctx, vpnID)
    
    // 2. Deploy WireGuard to standby node
    m.deployWireGuard(ctx, config.StandbyNodeID, vpn)
    
    // 3. Reassociate floating IP to new node
    m.reassociateFloatingIP(ctx, config.FloatingIPID, config.StandbyNodeID)
    
    // 4. Swap primary and standby
    config.PrimaryNodeID, config.StandbyNodeID = config.StandbyNodeID, config.PrimaryNodeID
}
```

### Health Check Loop

```go
func (m *VpnHAManager) StartMonitoring(ctx context.Context) {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            m.CheckAndFailover(ctx)
        }
    }
}
```

### Failover Timeline

| Phase | Time | Action |
|-------|------|--------|
| Detection | 0-30s | Health check failures exceed threshold |
| Deployment | 30-35s | WireGuard config deployed to standby |
| IP Switch | 35-40s | Floating IP reassociated |
| Reconnect | 40-50s | Clients auto-reconnect via keepalive |

---

## WireGuard Manager (Rust)

### Interface Management

```rust
// agent/limiquantix-node/src/wireguard.rs

pub struct WireGuardManager {
    configs: Arc<RwLock<HashMap<String, WireGuardConfig>>>,
    peers: Arc<RwLock<HashMap<String, HashMap<String, WireGuardPeer>>>>,
    config_dir: PathBuf,
}

impl WireGuardManager {
    pub async fn apply_config(&self, config: WireGuardConfig) -> Result<(), WireGuardError> {
        // Generate config file
        let content = self.generate_config_file(&config).await?;
        
        // Write to /etc/wireguard/wg0.conf
        fs::write(&config_path, &content).await?;
        
        // Bring up interface
        self.bring_up_interface(&config.interface).await?;
        
        Ok(())
    }
    
    pub async fn add_peer(&self, interface: &str, peer: WireGuardPeer) -> Result<(), WireGuardError> {
        // Use wg set to add peer dynamically
        Command::new("wg")
            .args(["set", interface, "peer", &peer.public_key,
                   "allowed-ips", &peer.allowed_ips.join(",")])
            .output()
            .await?;
        
        Ok(())
    }
}
```

### Config File Generation

```rust
fn generate_config_file(&self, config: &WireGuardConfig) -> String {
    let mut conf = String::new();
    
    // [Interface] section
    conf.push_str("[Interface]\n");
    conf.push_str(&format!("PrivateKey = {}\n", config.private_key));
    conf.push_str(&format!("Address = {}\n", config.address));
    conf.push_str(&format!("ListenPort = {}\n", config.listen_port));
    
    // [Peer] sections
    for peer in &config.peers {
        conf.push_str("\n[Peer]\n");
        conf.push_str(&format!("PublicKey = {}\n", peer.public_key));
        conf.push_str(&format!("AllowedIPs = {}\n", peer.allowed_ips.join(", ")));
        if let Some(endpoint) = &peer.endpoint {
            conf.push_str(&format!("Endpoint = {}\n", endpoint));
        }
    }
    
    conf
}
```

---

## Usage Examples

### Create a VPN Service

```bash
curl -X POST http://localhost:8080/api/v1/vpn-services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "remote-access-vpn",
    "project_id": "proj-123",
    "router_id": "router-456",
    "description": "Remote access for developers"
  }'
```

### Add a Client Connection

```bash
curl -X POST http://localhost:8080/api/v1/vpn-services/vpn-789/connections \
  -H "Content-Type: application/json" \
  -d '{
    "name": "john-laptop",
    "peer_cidrs": ["10.200.200.2/32"]
  }'
```

### Get Client Configuration (with QR Code)

```bash
# Get config as text
curl http://localhost:8080/api/v1/vpn-services/vpn-789/connections/conn-123/config

# Get QR code as PNG (base64)
curl http://localhost:8080/api/v1/vpn-services/vpn-789/connections/conn-123/config-qr
```

---

## Client Setup

### Desktop (Linux/macOS/Windows)

1. Install WireGuard client
2. Download config file from dashboard
3. Import config: `wg-quick up <config-file>`

### Mobile (iOS/Android)

1. Install WireGuard app
2. Open VPN detail in dashboard
3. Scan QR code with app

### Verify Connection

```bash
# Check interface status
wg show wg0

# Test connectivity to VM
ping 10.0.0.10
```

---

## Troubleshooting

### WireGuard Interface Not Coming Up

```bash
# Check if wireguard module is loaded
lsmod | grep wireguard

# Check wg-quick output
wg-quick up wg0

# Check interface status
ip link show wg0
```

### Cannot Reach VMs Through VPN

1. Verify WireGuard handshake:
```bash
wg show wg0
# Should show "latest handshake: X seconds ago"
```

2. Check routing:
```bash
ip route | grep wg0
# Should show route to VM subnet via wg0
```

3. Verify OVN routing:
```bash
# On bastion node
ovn-nbctl lr-route-list <router>
```

### High Latency

1. Check MTU settings:
```bash
# WireGuard recommends MTU 1420
ip link set wg0 mtu 1420
```

2. Enable persistent keepalive:
```ini
[Peer]
PersistentKeepalive = 25
```

---

## Security Considerations

### Key Management

- Server private keys stored encrypted in database
- Client private keys never stored (generated once, downloaded)
- Pre-shared keys optional for post-quantum security

### Network Isolation

- VPN traffic routed through OVN overlay
- Firewall rules apply to VPN traffic
- Security groups enforced on VM ports

### Access Control

- VPN services scoped to projects
- Connections scoped to VPN service
- RBAC integration for management operations

---

## Files

| File | Description |
|------|-------------|
| `backend/internal/services/network/vpn_handler.go` | Connect-RPC handler |
| `backend/internal/services/network/vpn_service.go` | Business logic + HA |
| `backend/internal/repository/memory/network_repository.go` | VPN repository |
| `agent/limiquantix-node/src/wireguard.rs` | WireGuard manager |
| `frontend/src/hooks/useVPN.ts` | React Query hooks |
| `frontend/src/pages/VPNServices.tsx` | UI page |

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - OVN architecture
- [000092-load-balancer-service.md](000092-load-balancer-service.md) - Load balancing
