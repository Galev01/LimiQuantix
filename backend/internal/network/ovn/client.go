package ovn

import (
	"context"
	"crypto/rand"
	"fmt"
	"net"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/limiquantix/limiquantix/internal/domain"
)

// NorthboundClient provides high-level access to the OVN Northbound database.
// It manages logical switches, ports, routers, ACLs, and other OVN resources.
type NorthboundClient struct {
	address string
	logger  *zap.Logger

	// In a real implementation, this would use libovsdb:
	// client client.Client

	// For now, we use a mock implementation that simulates OVN behavior
	// TODO: Replace with real libovsdb client when OVN is deployed
	mock *mockOVNState
}

// mockOVNState simulates OVN state for development without actual OVN.
type mockOVNState struct {
	switches      map[string]*LogicalSwitch
	ports         map[string]*LogicalSwitchPort
	routers       map[string]*LogicalRouter
	routerPorts   map[string]*LogicalRouterPort
	acls          map[string]*ACL
	addressSets   map[string]*AddressSet
	dhcpOptions   map[string]*DHCPOptions
	nats          map[string]*NAT
	natRules      map[string]NATRule // For floating IPs
	portGroups    map[string]*PortGroup
	loadBalancers map[string]*OVNLoadBalancer
}

// NATRule represents a NAT rule for floating IPs.
type NATRule struct {
	Router     string
	Type       string // "dnat_and_snat" or "snat"
	ExternalIP string
	InternalIP string
}

// Config holds OVN client configuration.
type Config struct {
	// NorthboundAddress is the OVN Northbound DB address (e.g., "tcp://10.0.0.1:6641")
	NorthboundAddress string

	// TLSConfig for secure connections (optional)
	CACert     string
	ClientCert string
	ClientKey  string

	// Connection timeout
	Timeout time.Duration
}

// NewNorthboundClient creates a new OVN Northbound client.
func NewNorthboundClient(cfg Config, logger *zap.Logger) (*NorthboundClient, error) {
	if cfg.Timeout == 0 {
		cfg.Timeout = 10 * time.Second
	}

	c := &NorthboundClient{
		address: cfg.NorthboundAddress,
		logger:  logger.Named("ovn-nb"),
		mock: &mockOVNState{
			switches:    make(map[string]*LogicalSwitch),
			ports:       make(map[string]*LogicalSwitchPort),
			routers:     make(map[string]*LogicalRouter),
			routerPorts: make(map[string]*LogicalRouterPort),
			acls:        make(map[string]*ACL),
			addressSets: make(map[string]*AddressSet),
			dhcpOptions: make(map[string]*DHCPOptions),
			nats:        make(map[string]*NAT),
			portGroups:  make(map[string]*PortGroup),
		},
	}

	c.logger.Info("OVN Northbound client initialized",
		zap.String("address", cfg.NorthboundAddress),
	)

	// TODO: Connect to real OVN Northbound DB using libovsdb
	// dbModel, err := model.NewClientDBModel("OVN_Northbound", ...)
	// c.client, err = client.NewOVSDBClient(dbModel, client.WithEndpoint(cfg.NorthboundAddress))
	// c.client.Connect(context.Background())

	return c, nil
}

// Close closes the connection to OVN.
func (c *NorthboundClient) Close() error {
	c.logger.Info("Closing OVN Northbound client")
	// TODO: c.client.Disconnect()
	return nil
}

// =============================================================================
// LOGICAL SWITCH OPERATIONS
// =============================================================================

// CreateLogicalSwitch creates a new logical switch (virtual L2 network).
func (c *NorthboundClient) CreateLogicalSwitch(ctx context.Context, network *domain.VirtualNetwork) (*LogicalSwitch, error) {
	name := c.networkToSwitchName(network.ID)

	c.logger.Info("Creating logical switch",
		zap.String("name", name),
		zap.String("network_id", network.ID),
		zap.String("network_type", string(network.Spec.Type)),
	)

	ls := &LogicalSwitch{
		UUID: generateUUID(),
		Name: name,
		ExternalIDs: map[string]string{
			"limiquantix-network-id": network.ID,
			"limiquantix-project-id": network.ProjectID,
			"limiquantix-name":       network.Name,
		},
		OtherConfig: make(map[string]string),
	}

	// Configure based on network type
	switch network.Spec.Type {
	case domain.NetworkTypeVLAN:
		if network.Spec.VLAN != nil {
			ls.OtherConfig["vlan"] = fmt.Sprintf("%d", network.Spec.VLAN.VLANID)
		}
	case domain.NetworkTypeOverlay:
		// Geneve encapsulation is automatic in OVN
		ls.OtherConfig["subnet"] = network.Spec.IPConfig.IPv4Subnet
	}

	// Set MTU if specified
	if network.Spec.MTU > 0 {
		ls.OtherConfig["mtu"] = fmt.Sprintf("%d", network.Spec.MTU)
	}

	// Store in mock state
	c.mock.switches[name] = ls

	// Create DHCP options if DHCP is enabled
	if network.Spec.IPConfig.DHCP.Enabled {
		if _, err := c.createDHCPOptions(ctx, name, network); err != nil {
			c.logger.Warn("Failed to create DHCP options", zap.Error(err))
		}
	}

	// TODO: Real OVN transaction
	// ops, err := c.client.Create(ls)
	// if _, err := c.client.Transact(ctx, ops...); err != nil { ... }

	c.logger.Info("Logical switch created",
		zap.String("name", name),
		zap.String("uuid", ls.UUID),
	)

	return ls, nil
}

// DeleteLogicalSwitch deletes a logical switch.
func (c *NorthboundClient) DeleteLogicalSwitch(ctx context.Context, networkID string) error {
	name := c.networkToSwitchName(networkID)

	c.logger.Info("Deleting logical switch",
		zap.String("name", name),
		zap.String("network_id", networkID),
	)

	// Delete from mock state
	delete(c.mock.switches, name)

	// Delete associated DHCP options
	for dhcpName, dhcp := range c.mock.dhcpOptions {
		if dhcp.ExternalIDs["limiquantix-switch"] == name {
			delete(c.mock.dhcpOptions, dhcpName)
		}
	}

	// TODO: Real OVN transaction
	// ops, err := c.client.Where(&LogicalSwitch{Name: name}).Delete()
	// c.client.Transact(ctx, ops...)

	return nil
}

// GetLogicalSwitch retrieves a logical switch by network ID.
func (c *NorthboundClient) GetLogicalSwitch(ctx context.Context, networkID string) (*LogicalSwitch, error) {
	name := c.networkToSwitchName(networkID)
	ls, ok := c.mock.switches[name]
	if !ok {
		return nil, fmt.Errorf("logical switch not found: %s", name)
	}
	return ls, nil
}

// =============================================================================
// LOGICAL SWITCH PORT OPERATIONS
// =============================================================================

// CreateLogicalSwitchPort creates a port on a logical switch.
func (c *NorthboundClient) CreateLogicalSwitchPort(ctx context.Context, port *domain.Port) (*LogicalSwitchPort, error) {
	switchName := c.networkToSwitchName(port.NetworkID)
	portName := c.portToOVNPortName(port.ID)

	c.logger.Info("Creating logical switch port",
		zap.String("switch", switchName),
		zap.String("port", portName),
		zap.String("port_id", port.ID),
	)

	// Format addresses for OVN: "MAC IP1 IP2 ..."
	addresses := []string{port.Spec.MACAddress}
	for _, fixedIP := range port.Spec.FixedIPs {
		addresses = append(addresses, fixedIP.IPAddress)
	}

	enabled := true
	lsp := &LogicalSwitchPort{
		UUID:      generateUUID(),
		Name:      portName,
		Addresses: []string{strings.Join(addresses, " ")},
		Enabled:   &enabled,
		ExternalIDs: map[string]string{
			"limiquantix-port-id": port.ID,
			"limiquantix-vm-id":   port.Status.VMID,
		},
		Options: make(map[string]string),
	}

	// Enable port security if security groups are assigned
	if len(port.Spec.SecurityGroupIDs) > 0 && port.Spec.PortSecurityEnabled {
		lsp.PortSecurity = []string{strings.Join(addresses, " ")}
	}

	// Handle port type
	switch port.Spec.Binding.Type {
	case domain.BindingTypeDirect:
		lsp.Type = "direct"
		lsp.Options["requested-chassis"] = port.Status.HostID
	case domain.BindingTypeVHostUser:
		lsp.Type = "dpdkvhostuser"
		if port.Spec.Binding.VHostSocket != "" {
			lsp.Options["vhost-sock"] = port.Spec.Binding.VHostSocket
		}
	default:
		lsp.Type = "" // Normal OVS port
	}

	// Store in mock state
	c.mock.ports[portName] = lsp

	// Add port to switch
	if ls, ok := c.mock.switches[switchName]; ok {
		ls.Ports = append(ls.Ports, lsp.UUID)
	}

	// TODO: Real OVN transaction
	// ops, err := c.client.Create(lsp)
	// lsOps, err := c.client.Where(&LogicalSwitch{Name: switchName}).
	//     Mutate(&LogicalSwitch{}, ovsdb.MutationInsert, ...)
	// c.client.Transact(ctx, append(ops, lsOps...)...)

	c.logger.Info("Logical switch port created",
		zap.String("port", portName),
		zap.String("uuid", lsp.UUID),
		zap.Strings("addresses", lsp.Addresses),
	)

	return lsp, nil
}

// DeleteLogicalSwitchPort deletes a port from a logical switch.
func (c *NorthboundClient) DeleteLogicalSwitchPort(ctx context.Context, portID string) error {
	portName := c.portToOVNPortName(portID)

	c.logger.Info("Deleting logical switch port",
		zap.String("port", portName),
		zap.String("port_id", portID),
	)

	delete(c.mock.ports, portName)

	// TODO: Real OVN transaction
	// ops, err := c.client.Where(&LogicalSwitchPort{Name: portName}).Delete()
	// c.client.Transact(ctx, ops...)

	return nil
}

// GetLogicalSwitchPort retrieves a port by ID.
func (c *NorthboundClient) GetLogicalSwitchPort(ctx context.Context, portID string) (*LogicalSwitchPort, error) {
	portName := c.portToOVNPortName(portID)
	lsp, ok := c.mock.ports[portName]
	if !ok {
		return nil, fmt.Errorf("logical switch port not found: %s", portName)
	}
	return lsp, nil
}

// BindPort binds a port to a VM and host.
func (c *NorthboundClient) BindPort(ctx context.Context, portID, vmID, hostID string) error {
	portName := c.portToOVNPortName(portID)

	c.logger.Info("Binding port",
		zap.String("port", portName),
		zap.String("vm_id", vmID),
		zap.String("host_id", hostID),
	)

	lsp, ok := c.mock.ports[portName]
	if !ok {
		return fmt.Errorf("port not found: %s", portName)
	}

	lsp.ExternalIDs["limiquantix-vm-id"] = vmID
	lsp.Options["requested-chassis"] = hostID

	// TODO: Real OVN update

	return nil
}

// =============================================================================
// DHCP OPERATIONS
// =============================================================================

// createDHCPOptions creates DHCP configuration for a logical switch.
func (c *NorthboundClient) createDHCPOptions(ctx context.Context, switchName string, network *domain.VirtualNetwork) (*DHCPOptions, error) {
	cidr := network.Spec.IPConfig.IPv4Subnet
	if cidr == "" {
		return nil, fmt.Errorf("IPv4 subnet is required for DHCP")
	}

	dhcp := network.Spec.IPConfig.DHCP

	c.logger.Info("Creating DHCP options",
		zap.String("switch", switchName),
		zap.String("cidr", cidr),
	)

	// Generate server MAC for DHCP
	serverMAC := generateMAC()

	opts := &DHCPOptions{
		UUID: generateUUID(),
		CIDR: cidr,
		Options: map[string]string{
			"server_id":  network.Spec.IPConfig.IPv4Gateway,
			"server_mac": serverMAC,
			"router":     network.Spec.IPConfig.IPv4Gateway,
		},
		ExternalIDs: map[string]string{
			"limiquantix-network-id": network.ID,
			"limiquantix-switch":     switchName,
		},
	}

	// Add lease time
	if dhcp.LeaseTimeSec > 0 {
		opts.Options["lease_time"] = fmt.Sprintf("%d", dhcp.LeaseTimeSec)
	} else {
		opts.Options["lease_time"] = "86400" // Default 24 hours
	}

	// Add DNS servers
	if len(dhcp.DNSServers) > 0 {
		opts.Options["dns_server"] = strings.Join(dhcp.DNSServers, ",")
	}

	// Add domain name
	if dhcp.DomainName != "" {
		opts.Options["domain_name"] = fmt.Sprintf("\"%s\"", dhcp.DomainName)
	}

	// Add NTP servers
	if len(dhcp.NTPServers) > 0 {
		opts.Options["ntp_server"] = strings.Join(dhcp.NTPServers, ",")
	}

	// Store in mock state
	c.mock.dhcpOptions[opts.UUID] = opts

	// TODO: Real OVN transaction
	// ops, err := c.client.Create(opts)
	// c.client.Transact(ctx, ops...)

	return opts, nil
}

// =============================================================================
// LOGICAL ROUTER OPERATIONS
// =============================================================================

// CreateLogicalRouter creates a logical router.
func (c *NorthboundClient) CreateLogicalRouter(ctx context.Context, name, projectID string, distributed bool) (*LogicalRouter, error) {
	routerName := c.routerToOVNRouterName(name)

	c.logger.Info("Creating logical router",
		zap.String("name", routerName),
		zap.Bool("distributed", distributed),
	)

	enabled := true
	lr := &LogicalRouter{
		UUID:    generateUUID(),
		Name:    routerName,
		Enabled: &enabled,
		ExternalIDs: map[string]string{
			"limiquantix-router-id":  name,
			"limiquantix-project-id": projectID,
		},
		Options: make(map[string]string),
	}

	// Enable distributed routing
	if distributed {
		lr.Options["chassis"] = "" // Empty means distributed across all chassis
	}

	// Store in mock state
	c.mock.routers[routerName] = lr

	// TODO: Real OVN transaction

	return lr, nil
}

// DeleteLogicalRouter deletes a logical router.
func (c *NorthboundClient) DeleteLogicalRouter(ctx context.Context, routerID string) error {
	routerName := c.routerToOVNRouterName(routerID)

	c.logger.Info("Deleting logical router", zap.String("name", routerName))

	delete(c.mock.routers, routerName)

	// TODO: Real OVN transaction

	return nil
}

// AddRouterInterface connects a network to a router.
func (c *NorthboundClient) AddRouterInterface(ctx context.Context, routerID, networkID, gateway string) (*LogicalRouterPort, error) {
	routerName := c.routerToOVNRouterName(routerID)
	switchName := c.networkToSwitchName(networkID)
	lrpName := fmt.Sprintf("%s-to-%s", routerName, switchName)

	c.logger.Info("Adding router interface",
		zap.String("router", routerName),
		zap.String("switch", switchName),
		zap.String("gateway", gateway),
	)

	enabled := true
	lrp := &LogicalRouterPort{
		UUID:     generateUUID(),
		Name:     lrpName,
		MAC:      generateMAC(),
		Networks: []string{gateway}, // e.g., "192.168.1.1/24"
		Enabled:  &enabled,
		ExternalIDs: map[string]string{
			"limiquantix-network-id": networkID,
		},
	}

	// Store in mock state
	c.mock.routerPorts[lrpName] = lrp

	if lr, ok := c.mock.routers[routerName]; ok {
		lr.Ports = append(lr.Ports, lrp.UUID)
	}

	// Create a peer port on the switch
	peerPortName := fmt.Sprintf("%s-to-%s", switchName, routerName)
	peerPort := &LogicalSwitchPort{
		UUID:      generateUUID(),
		Name:      peerPortName,
		Type:      "router",
		Addresses: []string{"router"},
		Options: map[string]string{
			"router-port": lrpName,
		},
	}
	c.mock.ports[peerPortName] = peerPort

	// TODO: Real OVN transaction

	return lrp, nil
}

// =============================================================================
// ACL / SECURITY GROUP OPERATIONS
// =============================================================================

// CreateSecurityGroupACLs creates OVN ACLs for a security group.
func (c *NorthboundClient) CreateSecurityGroupACLs(ctx context.Context, sg *domain.SecurityGroup) error {
	c.logger.Info("Creating security group ACLs",
		zap.String("sg_id", sg.ID),
		zap.String("sg_name", sg.Name),
		zap.Int("rule_count", len(sg.Rules)),
	)

	// Create address set for this security group
	asName := c.securityGroupToAddressSetName(sg.ID)
	as := &AddressSet{
		UUID:      generateUUID(),
		Name:      asName,
		Addresses: []string{},
		ExternalIDs: map[string]string{
			"limiquantix-sg-id": sg.ID,
		},
	}
	c.mock.addressSets[asName] = as

	// Create port group for efficient ACL application
	pgName := c.securityGroupToPortGroupName(sg.ID)
	pg := &PortGroup{
		UUID:  generateUUID(),
		Name:  pgName,
		Ports: []string{},
		ExternalIDs: map[string]string{
			"limiquantix-sg-id": sg.ID,
		},
	}
	c.mock.portGroups[pgName] = pg

	// Create ACLs for each rule
	for _, rule := range sg.Rules {
		acl := c.ruleToACL(&rule, pgName)
		c.mock.acls[acl.UUID] = acl
		pg.ACLs = append(pg.ACLs, acl.UUID)
	}

	// TODO: Real OVN transaction

	return nil
}

// DeleteSecurityGroupACLs deletes all ACLs for a security group.
func (c *NorthboundClient) DeleteSecurityGroupACLs(ctx context.Context, sgID string) error {
	asName := c.securityGroupToAddressSetName(sgID)
	pgName := c.securityGroupToPortGroupName(sgID)

	c.logger.Info("Deleting security group ACLs", zap.String("sg_id", sgID))

	// Delete port group and associated ACLs
	if pg, ok := c.mock.portGroups[pgName]; ok {
		for _, aclUUID := range pg.ACLs {
			delete(c.mock.acls, aclUUID)
		}
		delete(c.mock.portGroups, pgName)
	}

	// Delete address set
	delete(c.mock.addressSets, asName)

	// TODO: Real OVN transaction

	return nil
}

// ApplySecurityGroupToPort applies a security group to a port.
func (c *NorthboundClient) ApplySecurityGroupToPort(ctx context.Context, portID, sgID string) error {
	portName := c.portToOVNPortName(portID)
	pgName := c.securityGroupToPortGroupName(sgID)

	c.logger.Debug("Applying security group to port",
		zap.String("port", portName),
		zap.String("sg_id", sgID),
	)

	// Add port to port group
	if pg, ok := c.mock.portGroups[pgName]; ok {
		if lsp, ok := c.mock.ports[portName]; ok {
			pg.Ports = append(pg.Ports, lsp.UUID)
		}
	}

	// TODO: Real OVN transaction

	return nil
}

// ruleToACL converts a security group rule to an OVN ACL.
func (c *NorthboundClient) ruleToACL(rule *domain.SecurityGroupRule, portGroupName string) *ACL {
	// Determine direction
	direction := "from-lport"
	if rule.Direction == domain.RuleDirectionIngress {
		direction = "to-lport"
	}

	// Build match expression
	var matchParts []string

	// Port group match
	if rule.Direction == domain.RuleDirectionIngress {
		matchParts = append(matchParts, fmt.Sprintf("outport == @%s", portGroupName))
	} else {
		matchParts = append(matchParts, fmt.Sprintf("inport == @%s", portGroupName))
	}

	// Protocol match
	if rule.Protocol != "" && rule.Protocol != "any" {
		matchParts = append(matchParts, rule.Protocol)

		// Port range for TCP/UDP
		if (rule.Protocol == "tcp" || rule.Protocol == "udp") && rule.PortMin > 0 {
			if rule.PortMin == rule.PortMax {
				matchParts = append(matchParts, fmt.Sprintf("%s.dst == %d", rule.Protocol, rule.PortMin))
			} else {
				matchParts = append(matchParts, fmt.Sprintf("%s.dst >= %d && %s.dst <= %d",
					rule.Protocol, rule.PortMin, rule.Protocol, rule.PortMax))
			}
		}

		// ICMP type/code
		if rule.Protocol == "icmp" {
			if rule.ICMPType >= 0 {
				matchParts = append(matchParts, fmt.Sprintf("icmp4.type == %d", rule.ICMPType))
			}
			if rule.ICMPCode >= 0 {
				matchParts = append(matchParts, fmt.Sprintf("icmp4.code == %d", rule.ICMPCode))
			}
		}
	}

	// Remote IP prefix
	if rule.RemoteIPPrefix != "" && rule.RemoteIPPrefix != "0.0.0.0/0" {
		if rule.Direction == domain.RuleDirectionIngress {
			matchParts = append(matchParts, fmt.Sprintf("ip4.src == %s", rule.RemoteIPPrefix))
		} else {
			matchParts = append(matchParts, fmt.Sprintf("ip4.dst == %s", rule.RemoteIPPrefix))
		}
	}

	// Remote security group
	if rule.RemoteSecurityGroupID != "" {
		remotePG := c.securityGroupToPortGroupName(rule.RemoteSecurityGroupID)
		if rule.Direction == domain.RuleDirectionIngress {
			matchParts = append(matchParts, fmt.Sprintf("inport == @%s", remotePG))
		} else {
			matchParts = append(matchParts, fmt.Sprintf("outport == @%s", remotePG))
		}
	}

	match := strings.Join(matchParts, " && ")

	// Determine action
	action := "allow-related" // Default for stateful
	switch rule.Action {
	case domain.RuleActionDrop:
		action = "drop"
	case domain.RuleActionReject:
		action = "reject"
	}

	// Priority (OVN uses 0-32767, we default to 1000 for normal rules)
	priority := 1000
	if rule.Priority > 0 {
		priority = int(rule.Priority)
	}

	name := rule.Description
	return &ACL{
		UUID:      generateUUID(),
		Direction: direction,
		Priority:  priority,
		Match:     match,
		Action:    action,
		Name:      &name,
		ExternalIDs: map[string]string{
			"limiquantix-rule-id": rule.ID,
			"limiquantix-sg-id":   "", // Set by caller
		},
	}
}

// =============================================================================
// NAT / FLOATING IP OPERATIONS
// =============================================================================

// CreateFloatingIPNAT creates a DNAT+SNAT rule for a floating IP.
func (c *NorthboundClient) CreateFloatingIPNAT(ctx context.Context, routerID, floatingIP, internalIP string) error {
	routerName := c.routerToOVNRouterName(routerID)

	c.logger.Info("Creating floating IP NAT",
		zap.String("router", routerName),
		zap.String("floating_ip", floatingIP),
		zap.String("internal_ip", internalIP),
	)

	nat := &NAT{
		UUID:       generateUUID(),
		Type:       "dnat_and_snat",
		ExternalIP: floatingIP,
		LogicalIP:  internalIP,
		ExternalIDs: map[string]string{
			"limiquantix-floating-ip": floatingIP,
		},
	}

	c.mock.nats[nat.UUID] = nat

	// Add to router
	if lr, ok := c.mock.routers[routerName]; ok {
		lr.NAT = append(lr.NAT, nat.UUID)
	}

	// TODO: Real OVN transaction

	return nil
}

// DeleteFloatingIPNAT removes a floating IP NAT rule.
func (c *NorthboundClient) DeleteFloatingIPNAT(ctx context.Context, floatingIP string) error {
	c.logger.Info("Deleting floating IP NAT", zap.String("floating_ip", floatingIP))

	for uuid, nat := range c.mock.nats {
		if nat.ExternalIP == floatingIP {
			delete(c.mock.nats, uuid)
			break
		}
	}

	// TODO: Real OVN transaction

	return nil
}

// CreateSNAT creates a source NAT rule for outbound traffic.
func (c *NorthboundClient) CreateSNAT(ctx context.Context, routerID, externalIP, logicalSubnet string) error {
	routerName := c.routerToOVNRouterName(routerID)

	c.logger.Info("Creating SNAT rule",
		zap.String("router", routerName),
		zap.String("external_ip", externalIP),
		zap.String("logical_subnet", logicalSubnet),
	)

	nat := &NAT{
		UUID:       generateUUID(),
		Type:       "snat",
		ExternalIP: externalIP,
		LogicalIP:  logicalSubnet, // e.g., "10.0.1.0/24"
		ExternalIDs: map[string]string{
			"limiquantix-snat": "true",
		},
	}

	c.mock.nats[nat.UUID] = nat

	if lr, ok := c.mock.routers[routerName]; ok {
		lr.NAT = append(lr.NAT, nat.UUID)
	}

	// TODO: Real OVN transaction

	return nil
}

// =============================================================================
// VLAN / LOCALNET OPERATIONS
// =============================================================================

// CreateLocalnetPort creates a localnet port for VLAN networks.
// This connects the logical switch to a physical network.
func (c *NorthboundClient) CreateLocalnetPort(ctx context.Context, networkID string, vlanID uint32, physicalNetwork string) (*LogicalSwitchPort, error) {
	switchName := c.networkToSwitchName(networkID)
	portName := fmt.Sprintf("%s-localnet", switchName)

	c.logger.Info("Creating localnet port",
		zap.String("switch", switchName),
		zap.Uint32("vlan_id", vlanID),
		zap.String("physical_network", physicalNetwork),
	)

	enabled := true
	lsp := &LogicalSwitchPort{
		UUID:      generateUUID(),
		Name:      portName,
		Type:      "localnet",
		Addresses: []string{"unknown"},
		Enabled:   &enabled,
		Options: map[string]string{
			"network_name": physicalNetwork,
		},
		ExternalIDs: map[string]string{
			"limiquantix-network-id": networkID,
		},
	}

	// Set VLAN tag if specified
	if vlanID > 0 {
		vlan := int(vlanID)
		lsp.Tag = &vlan
	}

	c.mock.ports[portName] = lsp

	if ls, ok := c.mock.switches[switchName]; ok {
		ls.Ports = append(ls.Ports, lsp.UUID)
	}

	// TODO: Real OVN transaction

	return lsp, nil
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

func (c *NorthboundClient) networkToSwitchName(networkID string) string {
	return fmt.Sprintf("ls-%s", networkID)
}

func (c *NorthboundClient) portToOVNPortName(portID string) string {
	return fmt.Sprintf("lsp-%s", portID)
}

func (c *NorthboundClient) routerToOVNRouterName(routerID string) string {
	return fmt.Sprintf("lr-%s", routerID)
}

func (c *NorthboundClient) securityGroupToAddressSetName(sgID string) string {
	return fmt.Sprintf("as-sg-%s", sgID)
}

func (c *NorthboundClient) securityGroupToPortGroupName(sgID string) string {
	return fmt.Sprintf("pg-sg-%s", sgID)
}

// generateUUID generates a random UUID.
func generateUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// generateMAC generates a random locally-administered MAC address.
func generateMAC() string {
	mac := make([]byte, 6)
	_, _ = rand.Read(mac)
	// Set locally administered bit and unicast bit
	mac[0] = (mac[0] | 0x02) & 0xfe
	return net.HardwareAddr(mac).String()
}

// GetOVNPortName returns the OVN port name for a given limiquantix port ID.
// This is used by the Node Daemon to bind VM interfaces to OVN.
func (c *NorthboundClient) GetOVNPortName(portID string) string {
	return c.portToOVNPortName(portID)
}

// =============================================================================
// ADDITIONAL DHCP OPERATIONS
// =============================================================================

// DHCPOptionsConfig holds DHCP configuration.
type DHCPOptionsConfig struct {
	CIDR       string
	ServerID   string
	ServerMAC  string
	Router     string
	LeaseTime  int
	DNSServers []string
	MTU        int
	DomainName string
}

// CreateDHCPOptionsFromConfig creates DHCP options from a config struct.
func (c *NorthboundClient) CreateDHCPOptionsFromConfig(ctx context.Context, opts DHCPOptionsConfig) (string, error) {
	c.logger.Info("Creating DHCP options",
		zap.String("cidr", opts.CIDR),
		zap.String("router", opts.Router),
	)

	uuid := generateUUID()

	dhcpOpts := &DHCPOptions{
		UUID: uuid,
		CIDR: opts.CIDR,
		Options: map[string]string{
			"server_id":  opts.ServerID,
			"server_mac": opts.ServerMAC,
			"router":     opts.Router,
			"lease_time": fmt.Sprintf("%d", opts.LeaseTime),
		},
	}

	if len(opts.DNSServers) > 0 {
		dhcpOpts.Options["dns_server"] = fmt.Sprintf("{%s}", stringJoin(opts.DNSServers, ", "))
	}

	if opts.MTU > 0 {
		dhcpOpts.Options["mtu"] = fmt.Sprintf("%d", opts.MTU)
	}

	if opts.DomainName != "" {
		dhcpOpts.Options["domain_name"] = fmt.Sprintf("\"%s\"", opts.DomainName)
	}

	// Store in mock
	c.mock.dhcpOptions[uuid] = dhcpOpts

	return uuid, nil
}

// stringJoin joins strings with a separator.
func stringJoin(strs []string, sep string) string {
	result := ""
	for i, s := range strs {
		if i > 0 {
			result += sep
		}
		result += s
	}
	return result
}

// =============================================================================
// LOAD BALANCER OPERATIONS
// =============================================================================

// OVNLoadBalancer represents an OVN load balancer.
type OVNLoadBalancer struct {
	UUID        string
	Name        string
	VIPs        map[string]string // vip:port -> member_ips:port
	Protocol    string            // tcp, udp, or sctp
	ExternalIDs map[string]string
}

// LoadBalancerStats holds OVN load balancer statistics.
type LoadBalancerStats struct {
	TotalConnections  int64
	ActiveConnections int64
	BytesIn           int64
	BytesOut          int64
	RequestsPerSecond float64
}

// CreateLoadBalancer creates an OVN load balancer.
func (c *NorthboundClient) CreateLoadBalancer(ctx context.Context, lb *domain.LoadBalancer) error {
	c.logger.Info("Creating OVN load balancer",
		zap.String("lb_id", lb.ID),
		zap.String("lb_name", lb.Name),
		zap.String("vip", lb.Spec.VIP),
	)

	// OVN load balancer format: ovn-nbctl lb-add <name> <vip:port> <ip:port,...>
	// Example: ovn-nbctl lb-add web-lb 10.0.0.100:80 10.0.1.10:80,10.0.1.11:80

	lbName := fmt.Sprintf("lb-%s", lb.ID)
	protocol := strings.ToLower(string(lb.Spec.Protocol))
	if protocol == "" {
		protocol = "tcp"
	}

	// Build VIPs map
	vips := make(map[string]string)
	for _, listener := range lb.Spec.Listeners {
		vipKey := fmt.Sprintf("%s:%d", lb.Spec.VIP, listener.Port)
		
		// Find members for this listener
		var memberAddrs []string
		for _, member := range lb.Spec.Members {
			if member.ListenerID == "" || member.ListenerID == listener.ID {
				memberAddrs = append(memberAddrs, fmt.Sprintf("%s:%d", member.Address, member.Port))
			}
		}
		
		if len(memberAddrs) > 0 {
			vips[vipKey] = strings.Join(memberAddrs, ",")
		}
	}

	ovnLB := &OVNLoadBalancer{
		UUID:     generateUUID(),
		Name:     lbName,
		VIPs:     vips,
		Protocol: protocol,
		ExternalIDs: map[string]string{
			"limiquantix-lb-id":      lb.ID,
			"limiquantix-project-id": lb.ProjectID,
		},
	}

	// Store in mock
	if c.mock.loadBalancers == nil {
		c.mock.loadBalancers = make(map[string]*OVNLoadBalancer)
	}
	c.mock.loadBalancers[lb.ID] = ovnLB

	// TODO: Real OVN transaction
	// ops := []ovsdb.Operation{...}

	return nil
}

// UpdateLoadBalancer updates an OVN load balancer.
func (c *NorthboundClient) UpdateLoadBalancer(ctx context.Context, lb *domain.LoadBalancer) error {
	c.logger.Info("Updating OVN load balancer",
		zap.String("lb_id", lb.ID),
	)

	// Delete and recreate for simplicity
	if err := c.DeleteLoadBalancer(ctx, lb.ID); err != nil {
		c.logger.Warn("Failed to delete old load balancer", zap.Error(err))
	}

	return c.CreateLoadBalancer(ctx, lb)
}

// DeleteLoadBalancer removes an OVN load balancer.
func (c *NorthboundClient) DeleteLoadBalancer(ctx context.Context, lbID string) error {
	c.logger.Info("Deleting OVN load balancer",
		zap.String("lb_id", lbID),
	)

	if c.mock.loadBalancers != nil {
		delete(c.mock.loadBalancers, lbID)
	}

	// TODO: Real OVN transaction
	// ovn-nbctl lb-del <name>

	return nil
}

// GetLoadBalancerStats retrieves load balancer statistics.
func (c *NorthboundClient) GetLoadBalancerStats(ctx context.Context, lbID string) (*LoadBalancerStats, error) {
	// In a real implementation, this would query OVN counters
	// For now, return mock stats
	return &LoadBalancerStats{
		TotalConnections:  0,
		ActiveConnections: 0,
		BytesIn:           0,
		BytesOut:          0,
		RequestsPerSecond: 0,
	}, nil
}

// AssignLoadBalancerToSwitch assigns a load balancer to a logical switch.
func (c *NorthboundClient) AssignLoadBalancerToSwitch(ctx context.Context, lbID, switchName string) error {
	c.logger.Info("Assigning load balancer to switch",
		zap.String("lb_id", lbID),
		zap.String("switch", switchName),
	)

	// OVN command: ovn-nbctl ls-lb-add <switch> <lb>

	return nil
}

// AssignLoadBalancerToRouter assigns a load balancer to a logical router.
func (c *NorthboundClient) AssignLoadBalancerToRouter(ctx context.Context, lbID, routerName string) error {
	c.logger.Info("Assigning load balancer to router",
		zap.String("lb_id", lbID),
		zap.String("router", routerName),
	)

	// OVN command: ovn-nbctl lr-lb-add <router> <lb>

	return nil
}
