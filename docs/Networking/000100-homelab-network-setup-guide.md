# 000100 - Home Lab Network Setup Guide

**Purpose:** Step-by-step guide to configure networking in the QvDC Dashboard for a home lab environment.

**Status:** 📖 Guide

---

## Your Home Lab Environment

Based on your infrastructure:

| Component | IP Address | Role |
|-----------|------------|------|
| QvDC | 192.168.0.100 | Control Plane + Dashboard |
| QHCI01 | 192.168.0.101 | Hypervisor Node 1 (32GB RAM) |
| QHCI02 | 192.168.0.102 | Hypervisor Node 2 (64GB RAM) |
| Physical Network | 192.168.0.0/24 | Home LAN |

---

## Network Architecture We'll Create

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Your Home Network (192.168.0.0/24)                 │
│                                                                           │
│    Router ──────┬───────────────┬───────────────┬──────────────────────  │
│    192.168.0.1  │               │               │                        │
│                 │               │               │                        │
│           ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐                  │
│           │   QvDC    │   │  QHCI01   │   │  QHCI02   │                  │
│           │ .100      │   │ .101      │   │ .102      │                  │
│           └───────────┘   └─────┬─────┘   └─────┬─────┘                  │
│                                 │               │                        │
└─────────────────────────────────┼───────────────┼────────────────────────┘
                                  │               │
                    ┌─────────────┴───────────────┴─────────────┐
                    │         OVN Overlay Network               │
                    │                                           │
                    │   ┌─────────────────────────────────────┐ │
                    │   │    VM Network: 10.100.0.0/24        │ │
                    │   │    Gateway: 10.100.0.1              │ │
                    │   │    DHCP: 10.100.0.10 - 10.100.0.200 │ │
                    │   │                                     │ │
                    │   │   ┌─────┐  ┌─────┐  ┌─────┐        │ │
                    │   │   │VM-1 │  │VM-2 │  │VM-3 │        │ │
                    │   │   │ .10 │  │ .11 │  │ .12 │        │ │
                    │   │   └─────┘  └─────┘  └─────┘        │ │
                    │   └─────────────────────────────────────┘ │
                    └───────────────────────────────────────────┘
```

---

## Step 1: Access QvDC Dashboard

1. Open your browser
2. Navigate to: **https://192.168.0.100**
3. Login with your credentials

---

## Step 2: Create Your First Virtual Network

### Navigate to Networks

1. In the left sidebar, click **Networking** → **Virtual Networks**
2. Or go directly to: `https://192.168.0.100/networks`

### Create Network

1. Click the **"+ New Network"** button (top right)

2. The Create Network Wizard will open. Fill in:

   **Step 1 - Basic Info:**
   | Field | Value | Notes |
   |-------|-------|-------|
   | Name | `vm-network` | Your primary VM network |
   | Description | `Main network for virtual machines` | |

   **Step 2 - Network Type:**
   | Field | Value | Notes |
   |-------|-------|-------|
   | Type | **Overlay (Geneve)** | Recommended for VM-to-VM traffic |
   
   > 💡 **Why Overlay?** Creates an isolated virtual network that works across both hypervisor nodes without requiring VLAN support on your home switch.

   **Step 3 - IP Configuration:**
   | Field | Value | Notes |
   |-------|-------|-------|
   | CIDR | `10.100.0.0/24` | Private range for VMs |
   | Gateway | `10.100.0.1` | Virtual router gateway |
   | DHCP | ✅ **Enabled** | Auto-assigns IPs to VMs |

3. Click **"Create Network"**

4. Wait for status to change to **ACTIVE** (usually 5-10 seconds)

---

## Step 3: Create External Network (Internet Access)

For VMs to reach the internet, create an external network:

1. Click **"+ New Network"** again

2. Fill in:

   | Field | Value | Notes |
   |-------|-------|-------|
   | Name | `external` | For NAT/internet access |
   | Description | `External network for internet access` | |
   | Type | **External** | Maps to physical network |
   | CIDR | `192.168.0.0/24` | Your home LAN |
   | Gateway | `192.168.0.1` | Your home router |
   | DHCP | ❌ **Disabled** | Your home router handles DHCP |

3. Click **"Create Network"**

---

## Step 4: Set Up Security Groups

### Navigate to Security Groups

1. In sidebar, click **Networking** → **Security Groups**
2. Or: `https://192.168.0.100/security`

### Create Default Security Group

1. Click **"+ New Security Group"**

2. Fill in:
   | Field | Value |
   |-------|-------|
   | Name | `default` |
   | Description | `Default rules - allow all outbound, SSH/ICMP inbound` |

3. Add Ingress Rules:

   **Rule 1 - Allow SSH:**
   | Field | Value |
   |-------|-------|
   | Direction | Ingress |
   | Protocol | TCP |
   | Port | 22 |
   | Source | 0.0.0.0/0 |

   **Rule 2 - Allow ICMP (ping):**
   | Field | Value |
   |-------|-------|
   | Direction | Ingress |
   | Protocol | ICMP |
   | Source | 0.0.0.0/0 |

   **Rule 3 - Allow All from VM Network:**
   | Field | Value |
   |-------|-------|
   | Direction | Ingress |
   | Protocol | Any |
   | Source | 10.100.0.0/24 |

4. Add Egress Rule (usually default):

   **Rule 4 - Allow All Outbound:**
   | Field | Value |
   |-------|-------|
   | Direction | Egress |
   | Protocol | Any |
   | Destination | 0.0.0.0/0 |

5. Click **"Create"**

---

## Step 5: Create a Test VM

### Navigate to VMs

1. Click **Virtual Machines** in sidebar
2. Or: `https://192.168.0.100/vms`

### Create VM

1. Click **"+ New VM"**

2. Configure basic settings:
   | Field | Value |
   |-------|-------|
   | Name | `test-vm-1` |
   | CPU | 2 |
   | Memory | 2 GB |
   | Disk | 20 GB |
   | ISO | Select an OS ISO (e.g., Ubuntu Server) |

3. In the **Hardware** step, configure network:
   | Field | Value |
   |-------|-------|
   | Network | `vm-network` (select from dropdown) |
   | Security Group | `default` (select from dropdown) |

   > **Note:** Each NIC can have its own security group. The security group
   > controls firewall rules (ingress/egress) for that network interface.

4. Click **"Create"**

5. The VM will be created on QHCI01 or QHCI02 based on available resources

---

## Step 6: Verify Network Connectivity

### Check VM Got IP via DHCP

1. Click on your VM in the list
2. Go to **Console** tab
3. After OS boots, check IP:
   ```bash
   ip addr show
   # Should show 10.100.0.x
   ```

### Test Internal DNS (Magic DNS)

From inside the VM:
```bash
# Ping by hostname (if you have another VM)
ping test-vm-2

# Or use nslookup
nslookup test-vm-2.internal
```

### Test Internet Access

```bash
ping 8.8.8.8
ping google.com
```

---

## Step 7: (Optional) Set Up Load Balancer

If you want to load balance traffic to multiple VMs:

### Navigate to Load Balancers

1. Click **Networking** → **Load Balancers**
2. Or: `https://192.168.0.100/networks/load-balancers`

### Create Load Balancer

1. Click **"+ New Load Balancer"**

2. Configure:
   | Field | Value |
   |-------|-------|
   | Name | `web-lb` |
   | Network | `vm-network` |
   | VIP Address | `10.100.0.100` |
   | Protocol | TCP |
   | Port | 80 |

3. Add Backend Members:
   | Member | Address | Port |
   |--------|---------|------|
   | web-1 | 10.100.0.10 | 8080 |
   | web-2 | 10.100.0.11 | 8080 |

4. Configure Health Check:
   | Field | Value |
   |-------|-------|
   | Type | HTTP |
   | Path | `/health` |
   | Interval | 5s |

5. Click **"Create"**

---

## Step 8: (Optional) Set Up VPN Access

For remote access to your VMs:

### Navigate to VPN Services

1. Click **Networking** → **VPN Services**
2. Or: `https://192.168.0.100/networks/vpn`

### Create VPN Service

1. Click **"+ New VPN"**

2. Configure:
   | Field | Value |
   |-------|-------|
   | Name | `homelab-vpn` |
   | Network | `vm-network` |
   | Description | `Remote access to home lab VMs` |

3. Click **"Create"**

### Add Your Device as a Connection

1. Click on the VPN service
2. Click **"+ Add Connection"**
3. Configure:
   | Field | Value |
   |-------|-------|
   | Name | `my-laptop` |
   | Allowed IPs | `10.200.200.2/32` |

4. Click **"Create"**

5. **Download Config or Scan QR Code:**
   - Click the QR code icon to display
   - Open WireGuard app on your phone/laptop
   - Scan the QR code

---

## Quick Reference: Network URLs

| Page | URL |
|------|-----|
| Virtual Networks | https://192.168.0.100/networks |
| Security Groups | https://192.168.0.100/security |
| Load Balancers | https://192.168.0.100/networks/load-balancers |
| VPN Services | https://192.168.0.100/networks/vpn |
| BGP Speakers | https://192.168.0.100/networks/bgp |
| Distributed Switch | https://192.168.0.100/networks/distributed-switch |

---

## Recommended Network Layout for Home Lab

### Option A: Simple (Single Network)

```
vm-network (10.100.0.0/24) - Overlay
  ├── All VMs
  └── DHCP enabled
```

**Best for:** Getting started, testing

### Option B: Segmented (Multiple Networks)

```
mgmt-network (10.100.0.0/24) - Overlay
  ├── Management VMs
  └── DHCP enabled

app-network (10.100.1.0/24) - Overlay
  ├── Application VMs
  └── DHCP enabled

db-network (10.100.2.0/24) - Overlay
  ├── Database VMs
  └── DHCP enabled, stricter security groups
```

**Best for:** Production-like setup, learning network segmentation

### Option C: With VLAN (Requires VLAN-capable switch)

```
mgmt-vlan (VLAN 100, 10.100.0.0/24)
app-vlan (VLAN 200, 10.200.0.0/24)
```

**Best for:** Integration with existing physical network

---

## Troubleshooting

### VM Not Getting IP Address

1. Check DHCP is enabled on network:
   - Go to Virtual Networks
   - Click on network
   - Verify DHCP = Enabled

2. Check VM is connected to correct network:
   - Go to VM detail page
   - Check Network Interface shows correct network

3. Inside VM, try:
   ```bash
   sudo dhclient -v eth0
   ```

### VMs Can't Ping Each Other

1. Check Security Groups allow ICMP:
   - Go to Security Groups
   - Verify ingress rule for ICMP exists

2. Verify both VMs on same network:
   - Check network assignment in VM details

3. Use Packet Trace to debug:
   - Go to QHCI Host UI (192.168.0.101:8443)
   - Click "Packet Trace" button
   - Enter source/destination IPs

### No Internet Access

1. Verify external network exists:
   - Go to Virtual Networks
   - Should see "external" network

2. Check NAT is configured:
   - VMs need NAT through the external network

3. Check DNS:
   ```bash
   # Inside VM
   cat /etc/resolv.conf
   # Should show OVN DNS or external DNS
   
   nslookup google.com
   ```

---

## What's Next?

After basic setup, you can:

1. **Create more VMs** - Test live migration between QHCI01 and QHCI02
2. **Set up Load Balancing** - Distribute traffic across web servers
3. **Configure VPN** - Access your lab remotely
4. **Explore BGP** - If you have managed switches, integrate with physical network

---

## See Also

- [000048-network-backend-ovn-ovs.md](000048-network-backend-ovn-ovs.md) - Technical deep-dive
- [000092-load-balancer-service.md](000092-load-balancer-service.md) - Load balancer details
- [000093-wireguard-vpn-bastion.md](000093-wireguard-vpn-bastion.md) - VPN setup
- [000095-packet-trace-debugging.md](000095-packet-trace-debugging.md) - Debugging network issues
