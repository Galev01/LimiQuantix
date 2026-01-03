# 000050 - OVN Central Setup Guide

**Purpose:** Complete guide for deploying OVN (Open Virtual Network) central services and configuring hypervisor nodes for QuantumNet.

**Status:** ✅ Complete

---

## Overview

QuantumNet uses OVN (Open Virtual Network) as the SDN controller, providing:
- **Distributed Virtual Networks** - Overlay networks spanning multiple hypervisors
- **Security Groups** - Distributed firewall via OVN ACLs
- **DHCP/DNS** - Built-in DHCP and DNS services
- **NAT/Floating IPs** - Internet access for VMs
- **Load Balancing** - Native L4 load balancing

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OVN Central (Control Node)                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  OVN Northbound DB (ovsdb-server) ◄──── LimiQuantix Control Plane     │  │
│  │    Port: 6641                                                          │  │
│  │    - Logical network topology (switches, routers, ports)               │  │
│  │    - High-level intent                                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                    │ ovn-northd                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  OVN Southbound DB (ovsdb-server) ◄──── ovn-northd daemon              │  │
│  │    Port: 6642                                                          │  │
│  │    - Physical bindings                                                 │  │
│  │    - Chassis registrations                                             │  │
│  │    - OpenFlow rules                                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │                                           
                    ┌───────────────┴───────────────┐                          
                    ▼                               ▼                          
┌──────────────────────────────┐  ┌──────────────────────────────┐             
│      Hypervisor Node 1       │  │      Hypervisor Node 2       │             
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │             
│  │  OVN Controller        │  │  │  │  OVN Controller        │  │             
│  │  - Sync with SB DB     │  │  │  │  - Sync with SB DB     │  │             
│  │  - Program OVS flows   │  │  │  │  - Program OVS flows   │  │             
│  └────────────────────────┘  │  │  └────────────────────────┘  │             
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │             
│  │  Open vSwitch (OVS)    │  │  │  │  Open vSwitch (OVS)    │  │             
│  │  ┌──────────────────┐  │  │  │  ┌──────────────────────┐  │             
│  │  │  br-int (integ)  │  │  │  │  │  br-int (integ)      │  │             
│  │  │   VM1 ──(Geneve)────────────── VM2                  │  │             
│  │  └──────────────────┘  │  │  │  └──────────────────────┘  │             
│  └────────────────────────┘  │  │  └────────────────────────┘  │             
└──────────────────────────────┘  └──────────────────────────────┘             
```

---

## Part 1: OVN Central Setup (Control Node)

### 1.1 Install OVN Central Packages

```bash
# Ubuntu/Debian 22.04+
sudo apt update
sudo apt install -y ovn-central ovn-host openvswitch-switch

# Rocky Linux / AlmaLinux 8+
sudo dnf install -y ovn-central ovn-host openvswitch

# Verify installation
ovn-nbctl --version
ovn-sbctl --version
ovs-vsctl --version
```

### 1.2 Start OVN Central Services

```bash
# Enable and start the services
sudo systemctl enable --now ovn-ovsdb-server-nb
sudo systemctl enable --now ovn-ovsdb-server-sb  
sudo systemctl enable --now ovn-northd

# Verify services are running
sudo systemctl status ovn-ovsdb-server-nb ovn-ovsdb-server-sb ovn-northd
```

### 1.3 Configure Listeners

By default, OVN databases only listen on localhost. For distributed deployment:

```bash
# Allow remote connections to Northbound DB (Control Plane uses this)
sudo ovn-nbctl set-connection ptcp:6641:0.0.0.0

# Allow remote connections to Southbound DB (Hypervisors use this)
sudo ovn-sbctl set-connection ptcp:6642:0.0.0.0

# Verify listeners
sudo ss -tlnp | grep -E '664[12]'
```

### 1.4 Configure SSL (Production)

For production deployments, use SSL:

```bash
# Generate CA and certificates
cd /etc/ovn
ovs-pki init
ovs-pki req+sign ovn controller

# Configure SSL for Northbound DB
sudo ovn-nbctl set-ssl /etc/ovn/ovn-privkey.pem /etc/ovn/ovn-cert.pem /etc/ovn/pki/switchca/cacert.pem
sudo ovn-nbctl set-connection pssl:6641

# Configure SSL for Southbound DB
sudo ovn-sbctl set-ssl /etc/ovn/ovn-privkey.pem /etc/ovn/ovn-cert.pem /etc/ovn/pki/switchca/cacert.pem
sudo ovn-sbctl set-connection pssl:6642
```

### 1.5 Firewall Configuration

```bash
# Allow OVN ports
sudo ufw allow 6641/tcp   # OVN Northbound DB
sudo ufw allow 6642/tcp   # OVN Southbound DB

# Or with firewalld
sudo firewall-cmd --permanent --add-port=6641/tcp
sudo firewall-cmd --permanent --add-port=6642/tcp
sudo firewall-cmd --reload
```

### 1.6 Verify Central Setup

```bash
# Check databases are accessible
ovn-nbctl show
ovn-sbctl show

# Should show empty output (no logical switches yet)
```

---

## Part 2: Hypervisor Node Setup

### 2.1 Install OVN Host Packages

```bash
# Ubuntu/Debian
sudo apt install -y ovn-host openvswitch-switch

# Rocky/AlmaLinux
sudo dnf install -y ovn-host openvswitch
```

### 2.2 Configure OVS to Connect to OVN

Replace `OVN_CENTRAL_IP` with the IP of your OVN central node:

```bash
# Set the OVN Southbound DB address
OVN_CENTRAL_IP="10.0.0.1"
NODE_IP=$(hostname -I | awk '{print $1}')
CHASSIS_ID=$(hostname)

# Configure OVS external IDs
sudo ovs-vsctl set Open_vSwitch . \
    external_ids:ovn-remote="tcp:${OVN_CENTRAL_IP}:6642" \
    external_ids:ovn-encap-type=geneve \
    external_ids:ovn-encap-ip="${NODE_IP}" \
    external_ids:system-id="${CHASSIS_ID}"

# Verify configuration
sudo ovs-vsctl get Open_vSwitch . external_ids
```

### 2.3 Start OVN Controller

```bash
# Enable and start ovn-controller
sudo systemctl enable --now ovn-controller

# Verify it's running
sudo systemctl status ovn-controller

# Check it registered with OVN Central
sudo ovn-sbctl show
# Should show your chassis listed
```

### 2.4 Verify Integration Bridge

OVN controller automatically creates `br-int`:

```bash
# Should show br-int bridge
sudo ovs-vsctl show

# Example output:
# Bridge br-int
#     fail_mode: secure
#     Port br-int
#         Interface br-int
#             type: internal
```

### 2.5 Verify Geneve Tunnel Endpoint

```bash
# Check the tunnel port was created
sudo ovs-vsctl list interface | grep -A5 geneve

# Verify tunnel to other nodes (if any)
sudo ovs-vsctl show | grep -A2 "Port ovn"
```

---

## Part 3: LimiQuantix Integration

### 3.1 Control Plane Configuration

Add OVN configuration to the control plane config:

```yaml
# backend/config.yaml
network:
  ovn:
    enabled: true
    northbound_address: "tcp://10.0.0.1:6641"
    # For SSL:
    # northbound_address: "ssl://10.0.0.1:6641"
    # ca_cert: "/etc/ovn/pki/switchca/cacert.pem"
    # client_cert: "/etc/ovn/ovn-cert.pem"
    # client_key: "/etc/ovn/ovn-privkey.pem"
    
    # Default settings
    integration_bridge: "br-int"
    encap_type: "geneve"
```

### 3.2 Node Daemon Configuration

Node daemons auto-detect OVS configuration:

```yaml
# /etc/limiquantix/node.yaml
network:
  integration_bridge: "br-int"
  # Auto-detected from OVS external_ids:
  # ovn_remote, encap_type, encap_ip, system_id
```

### 3.3 Verify Node Daemon OVS Detection

```bash
# Run node daemon and check logs
./limiquantix-node --log-level debug

# Look for OVS detection:
# INFO  limiquantix_node: OVS detected: version=2.17.0, ovn_controller=connected
```

---

## Part 4: Creating Networks

### 4.1 Create an Overlay Network

Using the LimiQuantix API:

```bash
# Create a network
curl -X POST http://localhost:8080/limiquantix.network.v1.VirtualNetworkService/CreateNetwork \
  -H "Content-Type: application/json" \
  -d '{
    "name": "production-backend",
    "project_id": "default",
    "spec": {
      "type": "OVERLAY",
      "ip_config": {
        "ipv4_subnet": "10.0.1.0/24",
        "ipv4_gateway": "10.0.1.1",
        "dhcp": {
          "enabled": true,
          "lease_time_sec": 86400,
          "dns_servers": ["8.8.8.8", "8.8.4.4"]
        }
      }
    }
  }'
```

### 4.2 Verify Network in OVN

```bash
# List logical switches
ovn-nbctl ls-list

# Show logical switch details
ovn-nbctl show

# Example output:
# switch ls-abc123-def456 (production-backend)
#     port lsp-port-1
#         addresses: ["fa:16:3e:aa:bb:cc 10.0.1.10"]
```

### 4.3 Create a VLAN Network

```bash
curl -X POST http://localhost:8080/limiquantix.network.v1.VirtualNetworkService/CreateNetwork \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dmz-network",
    "project_id": "default",
    "spec": {
      "type": "VLAN",
      "vlan": {
        "vlan_id": 100,
        "physical_network": "physnet1"
      },
      "ip_config": {
        "ipv4_subnet": "192.168.100.0/24",
        "ipv4_gateway": "192.168.100.1"
      }
    }
  }'
```

---

## Part 5: DHCP Configuration

OVN provides built-in DHCP. It's configured automatically when creating networks with DHCP enabled.

### 5.1 Verify DHCP Options

```bash
# List DHCP options
ovn-nbctl dhcp-options-list

# Show DHCP options details
ovn-nbctl dhcp-options-get-options <uuid>

# Example output:
# lease_time="86400"
# router="10.0.1.1"
# server_id="10.0.1.1"
# server_mac="fa:16:3e:00:00:01"
# dns_server="8.8.8.8"
```

### 5.2 Add Custom DHCP Options

```bash
# Add NTP server
ovn-nbctl dhcp-options-set-options <uuid> \
  lease_time=86400 \
  router=10.0.1.1 \
  server_id=10.0.1.1 \
  server_mac=fa:16:3e:00:00:01 \
  dns_server=8.8.8.8 \
  ntp_server=pool.ntp.org
```

---

## Part 6: Security Groups (ACLs)

### 6.1 Create a Security Group

```bash
curl -X POST http://localhost:8080/limiquantix.network.v1.SecurityGroupService/CreateSecurityGroup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "web-servers",
    "project_id": "default",
    "rules": [
      {
        "direction": "INGRESS",
        "protocol": "tcp",
        "port_min": 80,
        "port_max": 80,
        "remote_ip_prefix": "0.0.0.0/0",
        "action": "ALLOW"
      },
      {
        "direction": "INGRESS",
        "protocol": "tcp",
        "port_min": 443,
        "port_max": 443,
        "remote_ip_prefix": "0.0.0.0/0",
        "action": "ALLOW"
      },
      {
        "direction": "INGRESS",
        "protocol": "tcp",
        "port_min": 22,
        "port_max": 22,
        "remote_ip_prefix": "10.0.0.0/8",
        "action": "ALLOW"
      }
    ],
    "stateful": true
  }'
```

### 6.2 Verify ACLs in OVN

```bash
# List ACLs for a logical switch
ovn-nbctl acl-list <switch-name>

# Example output:
# to-lport  1000 (outport == @pg-sg-xxx && tcp.dst == 80) allow-related
# to-lport  1000 (outport == @pg-sg-xxx && tcp.dst == 443) allow-related
```

---

## Part 7: Floating IPs (NAT)

### 7.1 Allocate a Floating IP

```bash
curl -X POST http://localhost:8080/limiquantix.network.v1.FloatingIpService/AllocateFloatingIp \
  -H "Content-Type: application/json" \
  -d '{
    "external_network_id": "external-net-1",
    "project_id": "default"
  }'
```

### 7.2 Associate Floating IP to a Port

```bash
curl -X POST http://localhost:8080/limiquantix.network.v1.FloatingIpService/AssociateFloatingIp \
  -H "Content-Type: application/json" \
  -d '{
    "floating_ip_id": "fip-123",
    "port_id": "port-456"
  }'
```

### 7.3 Verify NAT in OVN

```bash
# List NAT rules on a router
ovn-nbctl lr-nat-list <router-name>

# Example output:
# TYPE             EXTERNAL_IP        LOGICAL_IP
# dnat_and_snat    203.0.113.10       10.0.1.50
# snat             203.0.113.1        10.0.1.0/24
```

---

## Part 8: Troubleshooting

### 8.1 Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| `Connection refused to NB` | OVN NB daemon not running | `systemctl start ovn-ovsdb-server-nb` |
| `Chassis not found` | Node not registered | Check `ovn-controller` status |
| `Port not bound` | OVS port missing iface-id | Verify `ovs-vsctl` external_ids |
| `No DHCP response` | DHCP options not configured | Check `ovn-nbctl dhcp-options-list` |
| `Geneve tunnel down` | Firewall blocking UDP 6081 | Open port 6081 |

### 8.2 Debugging Commands

```bash
# Check OVN controller logs
journalctl -u ovn-controller -f

# Trace packet through OVN
ovn-trace <datapath> 'inport == "lsp-xxx" && eth.src == aa:bb:cc:dd:ee:ff'

# Show OpenFlow rules
sudo ovs-ofctl dump-flows br-int

# Check port bindings
ovn-sbctl list Port_Binding

# Verify encapsulation
sudo ovs-vsctl get interface ovn-xxx options
```

### 8.3 Verify Connectivity

```bash
# Ping between VMs on same network
# From inside VM:
ping 10.0.1.10

# Check tunnel is working
sudo ovs-appctl ofproto/trace br-int in_port=1,dl_src=aa:bb:cc:dd:ee:ff,dl_dst=ff:ff:ff:ff:ff:ff
```

---

## Part 9: High Availability

For production, run OVN central in HA mode with 3 nodes:

### 9.1 OVN HA Cluster Setup

```bash
# On node 1 (leader)
sudo ovn-ctl --db-nb-cluster-local-addr=10.0.0.1 start_nb_ovsdb
sudo ovn-ctl --db-sb-cluster-local-addr=10.0.0.1 start_sb_ovsdb

# On node 2
sudo ovn-ctl --db-nb-cluster-local-addr=10.0.0.2 \
             --db-nb-cluster-remote-addr=10.0.0.1 start_nb_ovsdb
sudo ovn-ctl --db-sb-cluster-local-addr=10.0.0.2 \
             --db-sb-cluster-remote-addr=10.0.0.1 start_sb_ovsdb

# On node 3
sudo ovn-ctl --db-nb-cluster-local-addr=10.0.0.3 \
             --db-nb-cluster-remote-addr=10.0.0.1 start_nb_ovsdb
sudo ovn-ctl --db-sb-cluster-local-addr=10.0.0.3 \
             --db-sb-cluster-remote-addr=10.0.0.1 start_sb_ovsdb
```

### 9.2 Verify Cluster Status

```bash
# Check cluster status
ovn-appctl -t /var/run/ovn/ovnnb_db.ctl cluster/status OVN_Northbound
ovn-appctl -t /var/run/ovn/ovnsb_db.ctl cluster/status OVN_Southbound
```

---

## Part 10: Performance Tuning

### 10.1 Enable Hardware Offload (DPDK)

```bash
# Enable DPDK on OVS
sudo ovs-vsctl set Open_vSwitch . other_config:dpdk-init=true
sudo systemctl restart openvswitch-switch

# Configure hugepages
echo 2048 | sudo tee /proc/sys/vm/nr_hugepages
```

### 10.2 SR-IOV Support

```bash
# Enable SR-IOV on NIC
echo 8 | sudo tee /sys/class/net/enp5s0f0/device/sriov_numvfs

# Configure VF in OVS
sudo ovs-vsctl add-port br-int enp5s0f0v0 \
    -- set interface enp5s0f0v0 type=dpdk \
    options:dpdk-devargs=0000:05:00.0
```

---

## Quick Reference

### OVN Commands

| Command | Purpose |
|---------|---------|
| `ovn-nbctl show` | Show logical topology |
| `ovn-sbctl show` | Show physical topology |
| `ovn-nbctl ls-list` | List logical switches |
| `ovn-nbctl lsp-list <sw>` | List ports on switch |
| `ovn-nbctl acl-list <sw>` | List ACLs on switch |
| `ovn-nbctl lr-list` | List logical routers |
| `ovn-nbctl lr-nat-list <lr>` | List NAT rules |
| `ovn-nbctl lb-list` | List load balancers |
| `ovn-trace` | Trace packet flow |

### OVS Commands

| Command | Purpose |
|---------|---------|
| `ovs-vsctl show` | Show OVS configuration |
| `ovs-ofctl dump-flows br-int` | Show OpenFlow rules |
| `ovs-dpctl show` | Show datapaths |
| `ovs-appctl dpif/show` | Show detailed datapath |

---

## References

- [OVN Architecture](https://docs.ovn.org/en/latest/ref/ovn-architecture.7.html)
- [OVN Deployment](https://docs.ovn.org/en/latest/howto/index.html)
- [OVS Performance](https://docs.openvswitch.org/en/latest/topics/dpdk/)
- [libovsdb](https://github.com/ovn-org/libovsdb)
