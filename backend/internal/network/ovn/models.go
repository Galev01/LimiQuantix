// Package ovn provides a client for OVN (Open Virtual Network) Northbound database.
// This package wraps libovsdb to provide a high-level API for managing OVN logical networks.
package ovn

// LogicalSwitch represents an OVN logical switch (virtual L2 network).
// Maps to the Logical_Switch table in OVN Northbound DB.
type LogicalSwitch struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Ports       []string          `ovsdb:"ports"`
	ACLs        []string          `ovsdb:"acls"`
	DNSRecords  []string          `ovsdb:"dns_records"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	OtherConfig map[string]string `ovsdb:"other_config"`
}

// Table returns the OVN table name.
func (ls *LogicalSwitch) Table() string {
	return "Logical_Switch"
}

// LogicalSwitchPort represents a port on a logical switch.
// Maps to the Logical_Switch_Port table in OVN Northbound DB.
type LogicalSwitchPort struct {
	UUID            string            `ovsdb:"_uuid"`
	Name            string            `ovsdb:"name"`
	Addresses       []string          `ovsdb:"addresses"`
	DHCPv4Options   *string           `ovsdb:"dhcpv4_options"`
	DHCPv6Options   *string           `ovsdb:"dhcpv6_options"`
	DynamicAddrs    []string          `ovsdb:"dynamic_addresses"`
	Enabled         *bool             `ovsdb:"enabled"`
	ExternalIDs     map[string]string `ovsdb:"external_ids"`
	HAChassisGroup  *string           `ovsdb:"ha_chassis_group"`
	Options         map[string]string `ovsdb:"options"`
	ParentName      *string           `ovsdb:"parent_name"`
	PortSecurity    []string          `ovsdb:"port_security"`
	Tag             *int              `ovsdb:"tag"`
	TagRequest      *int              `ovsdb:"tag_request"`
	Type            string            `ovsdb:"type"`
	Up              *bool             `ovsdb:"up"`
}

// Table returns the OVN table name.
func (lsp *LogicalSwitchPort) Table() string {
	return "Logical_Switch_Port"
}

// LogicalRouter represents an OVN logical router.
// Maps to the Logical_Router table in OVN Northbound DB.
type LogicalRouter struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Enabled     *bool             `ovsdb:"enabled"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	LoadBalancer []string         `ovsdb:"load_balancer"`
	NAT         []string          `ovsdb:"nat"`
	Options     map[string]string `ovsdb:"options"`
	Policies    []string          `ovsdb:"policies"`
	Ports       []string          `ovsdb:"ports"`
	StaticRoutes []string         `ovsdb:"static_routes"`
}

// Table returns the OVN table name.
func (lr *LogicalRouter) Table() string {
	return "Logical_Router"
}

// LogicalRouterPort represents a port on a logical router.
// Maps to the Logical_Router_Port table in OVN Northbound DB.
type LogicalRouterPort struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Enabled     *bool             `ovsdb:"enabled"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	GatewayChass string           `ovsdb:"gateway_chassis"`
	HAChasGroup  *string           `ovsdb:"ha_chassis_group"`
	IPv6Prefix  []string          `ovsdb:"ipv6_prefix"`
	IPv6RaConf  map[string]string `ovsdb:"ipv6_ra_configs"`
	MAC         string            `ovsdb:"mac"`
	Networks    []string          `ovsdb:"networks"`
	Options     map[string]string `ovsdb:"options"`
	Peer        *string           `ovsdb:"peer"`
}

// Table returns the OVN table name.
func (lrp *LogicalRouterPort) Table() string {
	return "Logical_Router_Port"
}

// ACL represents an OVN access control list entry.
// Maps to the ACL table in OVN Northbound DB.
type ACL struct {
	UUID        string            `ovsdb:"_uuid"`
	Action      string            `ovsdb:"action"` // "allow", "allow-related", "allow-stateless", "drop", "reject"
	Direction   string            `ovsdb:"direction"` // "from-lport", "to-lport"
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	Label       *int              `ovsdb:"label"`
	Log         bool              `ovsdb:"log"`
	Match       string            `ovsdb:"match"`
	Meter       *string           `ovsdb:"meter"`
	Name        *string           `ovsdb:"name"`
	Options     map[string]string `ovsdb:"options"`
	Priority    int               `ovsdb:"priority"` // 0-32767
	Severity    *string           `ovsdb:"severity"` // "alert", "warning", "notice", "info", "debug"
	Tier        *int              `ovsdb:"tier"`
}

// Table returns the OVN table name.
func (acl *ACL) Table() string {
	return "ACL"
}

// AddressSet represents an OVN address set (for security groups).
// Maps to the Address_Set table in OVN Northbound DB.
type AddressSet struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Addresses   []string          `ovsdb:"addresses"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the OVN table name.
func (as *AddressSet) Table() string {
	return "Address_Set"
}

// DHCPOptions represents OVN DHCP configuration.
// Maps to the DHCP_Options table in OVN Northbound DB.
type DHCPOptions struct {
	UUID        string            `ovsdb:"_uuid"`
	CIDR        string            `ovsdb:"cidr"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	Options     map[string]string `ovsdb:"options"`
}

// Table returns the OVN table name.
func (d *DHCPOptions) Table() string {
	return "DHCP_Options"
}

// NAT represents an OVN NAT rule.
// Maps to the NAT table in OVN Northbound DB.
type NAT struct {
	UUID            string            `ovsdb:"_uuid"`
	ExternalIDs     map[string]string `ovsdb:"external_ids"`
	ExternalIP      string            `ovsdb:"external_ip"`
	ExternalMAC     *string           `ovsdb:"external_mac"`
	ExternalPortRng string            `ovsdb:"external_port_range"`
	LogicalIP       string            `ovsdb:"logical_ip"`
	LogicalPort     *string           `ovsdb:"logical_port"`
	Options         map[string]string `ovsdb:"options"`
	Type            string            `ovsdb:"type"` // "snat", "dnat", "dnat_and_snat"
}

// Table returns the OVN table name.
func (n *NAT) Table() string {
	return "NAT"
}

// LoadBalancer represents an OVN load balancer.
// Maps to the Load_Balancer table in OVN Northbound DB.
type LoadBalancer struct {
	UUID            string            `ovsdb:"_uuid"`
	Name            string            `ovsdb:"name"`
	ExternalIDs     map[string]string `ovsdb:"external_ids"`
	HealthCheck     []string          `ovsdb:"health_check"`
	IPPortMappings  map[string]string `ovsdb:"ip_port_mappings"`
	Options         map[string]string `ovsdb:"options"`
	Protocol        *string           `ovsdb:"protocol"` // "tcp", "udp", "sctp"
	SelectionFields []string          `ovsdb:"selection_fields"`
	Vips            map[string]string `ovsdb:"vips"` // VIP -> backend list
}

// Table returns the OVN table name.
func (lb *LoadBalancer) Table() string {
	return "Load_Balancer"
}

// LogicalRouterStaticRoute represents a static route on a logical router.
// Maps to the Logical_Router_Static_Route table in OVN Northbound DB.
type LogicalRouterStaticRoute struct {
	UUID        string            `ovsdb:"_uuid"`
	BFD         *string           `ovsdb:"bfd"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	IPPrefix    string            `ovsdb:"ip_prefix"`
	Nexthop     string            `ovsdb:"nexthop"`
	Options     map[string]string `ovsdb:"options"`
	OutputPort  *string           `ovsdb:"output_port"`
	Policy      *string           `ovsdb:"policy"` // "src-ip", "dst-ip"
	RouteTable  string            `ovsdb:"route_table"`
}

// Table returns the OVN table name.
func (r *LogicalRouterStaticRoute) Table() string {
	return "Logical_Router_Static_Route"
}

// PortGroup represents an OVN port group.
// Maps to the Port_Group table in OVN Northbound DB.
// Used for efficient ACL application to multiple ports.
type PortGroup struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	ACLs        []string          `ovsdb:"acls"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	Ports       []string          `ovsdb:"ports"`
}

// Table returns the OVN table name.
func (pg *PortGroup) Table() string {
	return "Port_Group"
}
