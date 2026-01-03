# 000048 - Network Backend: OVN/OVS Integration

**Purpose:** Design and implement Open Virtual Network (OVN) with Open vSwitch (OVS) as the distributed SDN backend.

**Status:** 🚧 In Progress

---

## Executive Summary

OVN (Open Virtual Network) provides a software-defined networking layer built on top of OVS (Open vSwitch). This integration enables:

1. **Distributed Virtual Networks** - Overlay networks spanning multiple hypervisors
2. **L2/L3 Networking** - Virtual switches and routers
3. **Security Groups** - Distributed firewall via ACLs
4. **DHCP/DNS** - Built-in DHCP and DNS services
5. **Load Balancing** - Native L4 load balancing
6. **NAT/Floating IPs** - Internet access for VMs

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Control Plane (Go)                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │ NetworkService  │────▶│ OVN Northbound  │────▶│   OVN NB Database       ││
│  │  - Create VNet  │     │    Client       │     │   - Logical Switches    ││
│  │  - Create Port  │     │                 │     │   - Logical Routers     ││
│  │  - Security     │     │                 │     │   - ACLs                ││
│  └─────────────────┘     └─────────────────┘     └─────────────────────────┘│
└───────────────────────────────────────────────────────────────────────────── │
                                    │                                           
                                    ▼                                           
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OVN Central                                        │
│  ┌───────────────────────────────────────────────────────────────────────── ┐│
│  │  OVN Northbound DB (ovsdb-server)  ◄──── OVN Northbound Daemon (ovn-nb) ││
│  │    - Logical network topology                                           ││
│  │    - High-level intent                                                  ││
│  └───────────────────────────────────────────────────────────────────────── ┘│
│                                    │ Translation                             │
│  ┌───────────────────────────────────────────────────────────────────────── ┐│
│  │  OVN Southbound DB (ovsdb-server) ◄──── OVN Southbound Daemon (ovn-sb) ││
│  │    - Physical bindings                                                   ││
│  │    - Chassis registrations                                               ││
│  │    - OpenFlow rules                                                      ││
│  └───────────────────────────────────────────────────────────────────────── ┘│
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
│  │  │   VM1 ──────────────────────────── VM2              │  │             
│  │  │   VM3              │  │  │  │   VM4                 │  │             
│  │  └──────────────────┘  │  │  │  └──────────────────────┘  │             
│  │  ┌──────────────────┐  │  │  │  ┌──────────────────────┐  │             
│  │  │  br-ex (external)│  │  │  │  │  br-ex (external)    │  │             
│  │  │  ↕ (VXLAN/Geneve)│  │  │  │  │  ↕ (VXLAN/Geneve)    │  │             
│  │  └──────────────────┘  │  │  │  └──────────────────────┘  │             
│  └────────────────────────┘  │  │  └────────────────────────┘  │             
└──────────────────────────────┘  └──────────────────────────────┘             
```

---

## OVN Setup

### Install OVN Central (Control Node)

```bash
# Ubuntu/Debian
apt install ovn-central ovn-host openvswitch-switch

# Rocky/AlmaLinux
dnf install ovn-central ovn-host openvswitch

# Start OVN central services
systemctl enable --now ovn-ovsdb-server-nb
systemctl enable --now ovn-ovsdb-server-sb
systemctl enable --now ovn-northd
```

### Configure OVN Central

```bash
# Set listener addresses
ovn-nbctl set-connection ptcp:6641:0.0.0.0
ovn-sbctl set-connection ptcp:6642:0.0.0.0

# Verify connections
ovn-nbctl show
ovn-sbctl show
```

### Install OVN on Hypervisor Nodes

```bash
# Install packages
apt install ovn-host openvswitch-switch

# Configure OVS to connect to OVN
ovs-vsctl set Open_vSwitch . \
    external_ids:ovn-remote="tcp:10.0.0.1:6642" \
    external_ids:ovn-encap-type=geneve \
    external_ids:ovn-encap-ip=$(hostname -I | awk '{print $1}') \
    external_ids:system-id=$(hostname)

# Start OVN controller
systemctl enable --now ovn-controller
```

---

## Proto Definitions

### VirtualNetwork

```protobuf
// proto/limiquantix/network/v1/network.proto

message VirtualNetworkSpec {
  // Network type
  NetworkType type = 1;
  
  // IP configuration
  repeated IpSubnet subnets = 2;
  
  // DHCP configuration
  DhcpConfig dhcp = 3;
  
  // Connected router (for L3)
  string router_id = 4;
  
  // OVN-specific configuration
  OvnNetworkConfig ovn_config = 10;
}

message OvnNetworkConfig {
  // Logical switch name in OVN
  string logical_switch_name = 1;
  
  // Network segment ID (VNI for Geneve/VXLAN)
  int64 segment_id = 2;
  
  // Enable distributed routing
  bool distributed_routing = 3;
  
  // MTU for the network
  uint32 mtu = 4;
  
  // Multicast configuration
  bool enable_multicast = 5;
}

message Port {
  string id = 1;
  string name = 2;
  string network_id = 3;
  
  // MAC address (auto-generated if empty)
  string mac_address = 4;
  
  // Fixed IPs
  repeated FixedIp fixed_ips = 5;
  
  // Security groups
  repeated string security_group_ids = 6;
  
  // OVN-specific
  OvnPortConfig ovn_config = 10;
}

message OvnPortConfig {
  // Logical switch port name
  string logical_port_name = 1;
  
  // Port type (normal, router, localnet, etc.)
  string port_type = 2;
  
  // Addresses (MAC + IPs for OVN)
  repeated string addresses = 3;
  
  // Port security (MAC/IP filtering)
  bool port_security_enabled = 4;
}
```

### Security Groups

```protobuf
message SecurityGroup {
  string id = 1;
  string name = 2;
  string project_id = 3;
  
  // Rules
  repeated SecurityGroupRule rules = 4;
}

message SecurityGroupRule {
  string id = 1;
  
  // Direction
  Direction direction = 2;  // INGRESS, EGRESS
  
  // Protocol
  string protocol = 3;  // tcp, udp, icmp, any
  
  // Port range
  uint32 port_min = 4;
  uint32 port_max = 5;
  
  // Remote IP prefix (CIDR)
  string remote_ip_prefix = 6;
  
  // Or reference another security group
  string remote_group_id = 7;
}
```

---

## Backend Implementation

### Go: OVN Client

```go
// backend/internal/network/ovn/client.go
package ovn

import (
    "context"
    "fmt"
    
    "github.com/ovn-org/libovsdb/client"
    "github.com/ovn-org/libovsdb/model"
    "github.com/ovn-org/libovsdb/ovsdb"
    "go.uber.org/zap"
    
    "github.com/limiquantix/limiquantix/internal/domain"
)

// NorthboundClient manages OVN Northbound database.
type NorthboundClient struct {
    client client.Client
    logger *zap.Logger
}

// NewNorthboundClient creates a new OVN Northbound client.
func NewNorthboundClient(address string, logger *zap.Logger) (*NorthboundClient, error) {
    // Create libovsdb client
    dbModel, err := model.NewClientDBModel("OVN_Northbound", map[string]model.Model{
        "Logical_Switch":      &LogicalSwitch{},
        "Logical_Switch_Port": &LogicalSwitchPort{},
        "Logical_Router":      &LogicalRouter{},
        "Logical_Router_Port": &LogicalRouterPort{},
        "ACL":                 &ACL{},
        "Address_Set":         &AddressSet{},
        "DHCP_Options":        &DHCPOptions{},
        "NAT":                 &NAT{},
        "Load_Balancer":       &LoadBalancer{},
    })
    if err != nil {
        return nil, fmt.Errorf("failed to create DB model: %w", err)
    }
    
    ovnClient, err := client.NewOVSDBClient(dbModel, client.WithEndpoint(address))
    if err != nil {
        return nil, fmt.Errorf("failed to create OVN client: %w", err)
    }
    
    if err := ovnClient.Connect(context.Background()); err != nil {
        return nil, fmt.Errorf("failed to connect to OVN: %w", err)
    }
    
    return &NorthboundClient{
        client: ovnClient,
        logger: logger.Named("ovn-nb"),
    }, nil
}

// CreateLogicalSwitch creates a new logical switch (virtual network).
func (c *NorthboundClient) CreateLogicalSwitch(ctx context.Context, network *domain.VirtualNetwork) error {
    name := c.networkToSwitchName(network.ID)
    
    c.logger.Info("Creating logical switch",
        zap.String("name", name),
        zap.String("network_id", network.ID),
    )
    
    ls := &LogicalSwitch{
        Name: name,
        ExternalIDs: map[string]string{
            "limiquantix-network-id": network.ID,
            "limiquantix-project-id": network.ProjectID,
        },
    }
    
    // Set segment ID if specified
    if network.Spec.OVN.SegmentID > 0 {
        ls.OtherConfig = map[string]string{
            "vlan": fmt.Sprintf("%d", network.Spec.OVN.SegmentID),
        }
    }
    
    ops, err := c.client.Create(ls)
    if err != nil {
        return fmt.Errorf("failed to create switch ops: %w", err)
    }
    
    if _, err := c.client.Transact(ctx, ops...); err != nil {
        return fmt.Errorf("failed to create switch: %w", err)
    }
    
    // Create DHCP options if DHCP is enabled
    if network.Spec.DHCP.Enabled {
        if err := c.createDHCPOptions(ctx, name, network); err != nil {
            c.logger.Warn("Failed to create DHCP options", zap.Error(err))
        }
    }
    
    return nil
}

// CreateLogicalSwitchPort creates a port on a logical switch.
func (c *NorthboundClient) CreateLogicalSwitchPort(ctx context.Context, port *domain.Port) error {
    switchName := c.networkToSwitchName(port.NetworkID)
    portName := c.portToPortName(port.ID)
    
    c.logger.Info("Creating logical switch port",
        zap.String("switch", switchName),
        zap.String("port", portName),
    )
    
    // Format addresses for OVN
    addresses := []string{port.MACAddress}
    for _, fixedIP := range port.FixedIPs {
        addresses = append(addresses, fixedIP.IPAddress)
    }
    
    lsp := &LogicalSwitchPort{
        Name:      portName,
        Addresses: []string{strings.Join(addresses, " ")},
        ExternalIDs: map[string]string{
            "limiquantix-port-id": port.ID,
            "limiquantix-vm-id":   port.VMID,
        },
    }
    
    // Enable port security if security groups are assigned
    if len(port.SecurityGroupIDs) > 0 {
        lsp.PortSecurity = []string{strings.Join(addresses, " ")}
    }
    
    ops, err := c.client.Create(lsp)
    if err != nil {
        return fmt.Errorf("failed to create port ops: %w", err)
    }
    
    // Add port to switch
    lsOps, err := c.client.Where(&LogicalSwitch{Name: switchName}).
        Mutate(&LogicalSwitch{}, ovsdb.MutationInsert, &ovsdb.OvsSet{
            GoSet: []interface{}{ovsdb.UUID{GoUUID: lsp.UUID}},
        }, "ports")
    if err != nil {
        return fmt.Errorf("failed to create add-to-switch ops: %w", err)
    }
    
    allOps := append(ops, lsOps...)
    if _, err := c.client.Transact(ctx, allOps...); err != nil {
        return fmt.Errorf("failed to create port: %w", err)
    }
    
    // Apply security group rules as ACLs
    for _, sgID := range port.SecurityGroupIDs {
        if err := c.applySecurityGroup(ctx, portName, sgID); err != nil {
            c.logger.Warn("Failed to apply security group",
                zap.String("sg_id", sgID),
                zap.Error(err),
            )
        }
    }
    
    return nil
}

// CreateRouter creates a logical router.
func (c *NorthboundClient) CreateRouter(ctx context.Context, router *domain.LogicalRouter) error {
    name := c.routerToRouterName(router.ID)
    
    lr := &LogicalRouter{
        Name: name,
        ExternalIDs: map[string]string{
            "limiquantix-router-id":  router.ID,
            "limiquantix-project-id": router.ProjectID,
        },
    }
    
    // Enable distributed routing
    if router.Spec.DistributedRouting {
        lr.Options = map[string]string{
            "chassis": "",  // Empty means distributed
        }
    }
    
    ops, err := c.client.Create(lr)
    if err != nil {
        return fmt.Errorf("failed to create router ops: %w", err)
    }
    
    if _, err := c.client.Transact(ctx, ops...); err != nil {
        return fmt.Errorf("failed to create router: %w", err)
    }
    
    return nil
}

// AddRouterInterface connects a network to a router.
func (c *NorthboundClient) AddRouterInterface(ctx context.Context, routerID, networkID, subnet string) error {
    routerName := c.routerToRouterName(routerID)
    switchName := c.networkToSwitchName(networkID)
    
    // Create router port
    lrpName := fmt.Sprintf("%s-to-%s", routerName, switchName)
    mac := generateMAC()
    
    lrp := &LogicalRouterPort{
        Name:     lrpName,
        MAC:      mac,
        Networks: []string{subnet},  // e.g., "192.168.1.1/24"
    }
    
    // ... create router port and connect to switch
    
    return nil
}

// CreateSecurityGroupACLs creates OVN ACLs for a security group.
func (c *NorthboundClient) CreateSecurityGroupACLs(ctx context.Context, sg *domain.SecurityGroup) error {
    // Create address set for this security group
    asName := fmt.Sprintf("sg-%s", sg.ID)
    as := &AddressSet{
        Name: asName,
        ExternalIDs: map[string]string{
            "limiquantix-sg-id": sg.ID,
        },
    }
    
    ops, err := c.client.Create(as)
    if err != nil {
        return err
    }
    
    // Create ACLs for each rule
    for _, rule := range sg.Rules {
        acl := c.ruleToACL(rule, asName)
        aclOps, err := c.client.Create(acl)
        if err != nil {
            continue
        }
        ops = append(ops, aclOps...)
    }
    
    if _, err := c.client.Transact(ctx, ops...); err != nil {
        return fmt.Errorf("failed to create security group: %w", err)
    }
    
    return nil
}

// ruleToACL converts a security group rule to an OVN ACL.
func (c *NorthboundClient) ruleToACL(rule *domain.SecurityGroupRule, addressSet string) *ACL {
    direction := "from-lport"
    if rule.Direction == domain.DirectionIngress {
        direction = "to-lport"
    }
    
    // Build match expression
    var match string
    if rule.Direction == domain.DirectionIngress {
        match = fmt.Sprintf("inport == @%s", addressSet)
    } else {
        match = fmt.Sprintf("outport == @%s", addressSet)
    }
    
    if rule.Protocol != "any" {
        match += fmt.Sprintf(" && %s", rule.Protocol)
        if rule.PortMin > 0 {
            if rule.PortMin == rule.PortMax {
                match += fmt.Sprintf(".dst == %d", rule.PortMin)
            } else {
                match += fmt.Sprintf(".dst >= %d && %s.dst <= %d", 
                    rule.PortMin, rule.Protocol, rule.PortMax)
            }
        }
    }
    
    if rule.RemoteIPPrefix != "" {
        if rule.Direction == domain.DirectionIngress {
            match += fmt.Sprintf(" && ip4.src == %s", rule.RemoteIPPrefix)
        } else {
            match += fmt.Sprintf(" && ip4.dst == %s", rule.RemoteIPPrefix)
        }
    }
    
    return &ACL{
        Direction: direction,
        Priority:  1000,
        Match:     match,
        Action:    "allow-related",
        ExternalIDs: map[string]string{
            "limiquantix-rule-id": rule.ID,
        },
    }
}

// Helper functions
func (c *NorthboundClient) networkToSwitchName(networkID string) string {
    return fmt.Sprintf("ls-%s", networkID)
}

func (c *NorthboundClient) portToPortName(portID string) string {
    return fmt.Sprintf("lsp-%s", portID)
}

func (c *NorthboundClient) routerToRouterName(routerID string) string {
    return fmt.Sprintf("lr-%s", routerID)
}
```

### Rust: Node Daemon OVS Integration

```rust
// agent/limiquantix-hypervisor/src/network/ovs.rs

use std::process::Command;
use anyhow::{Context, Result};
use tracing::{info, debug};

/// OVS port manager for connecting VMs to OVN.
pub struct OvsPortManager {
    integration_bridge: String,
}

impl OvsPortManager {
    pub fn new(integration_bridge: String) -> Self {
        Self { integration_bridge }
    }
    
    /// Create an OVS port for a VM interface.
    pub fn create_port(&self, port_name: &str, vm_id: &str, iface_id: &str) -> Result<()> {
        info!(port = %port_name, vm_id = %vm_id, "Creating OVS port");
        
        // Add port to integration bridge
        let output = Command::new("ovs-vsctl")
            .args([
                "--may-exist", "add-port", &self.integration_bridge, port_name,
                "--", "set", "Interface", port_name,
                &format!("type=internal"),
                &format!("external_ids:iface-id={}", iface_id),
                &format!("external_ids:attached-mac=auto"),
                &format!("external_ids:vm-id={}", vm_id),
            ])
            .output()
            .context("Failed to execute ovs-vsctl")?;
        
        if !output.status.success() {
            anyhow::bail!(
                "ovs-vsctl failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        
        Ok(())
    }
    
    /// Delete an OVS port.
    pub fn delete_port(&self, port_name: &str) -> Result<()> {
        info!(port = %port_name, "Deleting OVS port");
        
        let output = Command::new("ovs-vsctl")
            .args(["--if-exists", "del-port", &self.integration_bridge, port_name])
            .output()
            .context("Failed to execute ovs-vsctl")?;
        
        if !output.status.success() {
            anyhow::bail!(
                "ovs-vsctl del-port failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        
        Ok(())
    }
    
    /// Bind a VM interface (veth/tap) to an OVN port.
    pub fn bind_interface(&self, iface_name: &str, ovn_port_id: &str) -> Result<()> {
        debug!(
            iface = %iface_name,
            ovn_port = %ovn_port_id,
            "Binding interface to OVN port"
        );
        
        // Set the iface-id external ID - OVN controller will pick this up
        let output = Command::new("ovs-vsctl")
            .args([
                "set", "Interface", iface_name,
                &format!("external_ids:iface-id={}", ovn_port_id),
            ])
            .output()
            .context("Failed to set iface-id")?;
        
        if !output.status.success() {
            anyhow::bail!(
                "Failed to bind interface: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        
        Ok(())
    }
}
```

---

## libvirt Integration

### VM Network Interface XML

When creating a VM with OVN networking:

```xml
<interface type='bridge'>
  <source bridge='br-int'/>
  <virtualport type='openvswitch'>
    <parameters interfaceid='lsp-abc123-def456'/>
  </virtualport>
  <target dev='vnet0'/>
  <model type='virtio'/>
</interface>
```

### Node Daemon: Connecting VM to OVN

```rust
// When starting a VM, connect its interfaces to OVS
pub async fn connect_vm_to_network(&self, vm_id: &str, interfaces: &[NetworkInterface]) -> Result<()> {
    for iface in interfaces {
        // The vnet device is created by libvirt
        let vnet_name = format!("vnet{}", iface.index);
        
        // Bind to OVN logical switch port
        self.ovs.bind_interface(&vnet_name, &iface.ovn_port_id)?;
    }
    Ok(())
}
```

---

## DHCP & Metadata

OVN provides built-in DHCP. Configure via DHCP_Options table:

```bash
# Create DHCP options
ovn-nbctl dhcp-options-create 192.168.1.0/24 \
    -- set dhcp_options . options:server_id=192.168.1.1 \
    -- set dhcp_options . options:server_mac=fa:16:3e:00:00:01 \
    -- set dhcp_options . options:lease_time=86400 \
    -- set dhcp_options . options:router=192.168.1.1 \
    -- set dhcp_options . options:dns_server=8.8.8.8
```

In Go:

```go
func (c *NorthboundClient) createDHCPOptions(ctx context.Context, switchName string, network *domain.VirtualNetwork) error {
    for _, subnet := range network.Spec.Subnets {
        opts := &DHCPOptions{
            CIDR: subnet.CIDR,
            Options: map[string]string{
                "server_id":     subnet.Gateway,
                "server_mac":    "fa:16:3e:00:00:01",
                "lease_time":    "86400",
                "router":        subnet.Gateway,
                "dns_server":    strings.Join(subnet.DNSServers, " "),
            },
        }
        // Create and associate with switch...
    }
    return nil
}
```

---

## Floating IPs / NAT

### SNAT for Outbound Traffic

```bash
ovn-nbctl lr-nat-add router1 snat 10.0.0.100 192.168.1.0/24
```

### DNAT for Floating IPs

```bash
ovn-nbctl lr-nat-add router1 dnat_and_snat 203.0.113.10 192.168.1.50
```

### Go Implementation

```go
func (c *NorthboundClient) AssociateFloatingIP(ctx context.Context, routerID, floatingIP, internalIP string) error {
    routerName := c.routerToRouterName(routerID)
    
    nat := &NAT{
        Type:        "dnat_and_snat",
        ExternalIP:  floatingIP,
        LogicalIP:   internalIP,
        ExternalIDs: map[string]string{
            "limiquantix-fip": floatingIP,
        },
    }
    
    // Add NAT to router...
    return nil
}
```

---

## Load Balancing

OVN supports L4 (TCP/UDP) load balancing:

```bash
# Create load balancer
ovn-nbctl lb-add web-lb 10.0.0.100:80 192.168.1.10:8080,192.168.1.11:8080

# Attach to router
ovn-nbctl lr-lb-add router1 web-lb
```

### Go Implementation

```go
func (c *NorthboundClient) CreateLoadBalancer(ctx context.Context, lb *domain.LoadBalancer) error {
    ovnLB := &LoadBalancer{
        Name: fmt.Sprintf("lb-%s", lb.ID),
        Vips: make(map[string]string),
        ExternalIDs: map[string]string{
            "limiquantix-lb-id": lb.ID,
        },
    }
    
    for _, listener := range lb.Listeners {
        vip := fmt.Sprintf("%s:%d", lb.VIP, listener.Port)
        var backends []string
        for _, member := range listener.Members {
            backends = append(backends, fmt.Sprintf("%s:%d", member.IP, member.Port))
        }
        ovnLB.Vips[vip] = strings.Join(backends, ",")
    }
    
    // Create and attach to router...
    return nil
}
```

---

## Monitoring & Debugging

### OVN Commands

```bash
# Show logical switches
ovn-nbctl show

# Show logical switch ports
ovn-nbctl lsp-list <switch-name>

# Show ACLs
ovn-nbctl acl-list <switch-name>

# Show logical routers
ovn-nbctl lr-list

# Show NAT rules
ovn-nbctl lr-nat-list <router-name>

# Show load balancers
ovn-nbctl lb-list
```

### OVS Commands

```bash
# Show OVS ports
ovs-vsctl show

# Show OpenFlow rules
ovs-ofctl dump-flows br-int

# Show port statistics
ovs-vsctl list interface
```

### Trace Packet Flow

```bash
# Trace packet through OVN
ovn-trace --ovs <datapath> 'inport == "lsp-xxx" && eth.src == aa:bb:cc:dd:ee:ff'
```

---

## Dependencies

### Go (Control Plane)

```go
// go.mod
require (
    github.com/ovn-org/libovsdb v0.6.1
)
```

### System Packages

```bash
# Ubuntu/Debian
apt install ovn-host openvswitch-switch

# Rocky/AlmaLinux
dnf install ovn-host openvswitch
```

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `Connection refused to NB` | OVN NB daemon not running | Start ovn-ovsdb-server-nb |
| `Chassis not found` | Node not registered | Check ovn-controller status |
| `Port not bound` | OVS port missing iface-id | Verify ovs-vsctl external_ids |
| `DHCP not working` | DHCP options not set | Check dhcp_options table |

---

## Testing

```bash
# Create a test network
ovn-nbctl ls-add test-switch

# Create a test port
ovn-nbctl lsp-add test-switch test-port
ovn-nbctl lsp-set-addresses test-port "fa:16:3e:00:00:01 192.168.1.10"

# Verify
ovn-nbctl show

# Cleanup
ovn-nbctl ls-del test-switch
```
