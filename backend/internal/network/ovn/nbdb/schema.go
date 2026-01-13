// Package nbdb provides Go types for the OVN Northbound Database schema.
// These types are compatible with libovsdb and can be used for CRUD operations.
//
// This is based on the OVN Northbound schema (ovn-nb.ovsschema).
// See: https://www.ovn.org/support/dist-docs/ovn-nb.5.html
package nbdb

import (
	"encoding/json"
)

// =============================================================================
// LOGICAL SWITCH - Virtual L2 network
// =============================================================================

// LogicalSwitch represents an OVN logical switch.
// A logical switch is a logical version of a layer-2 Ethernet switch.
type LogicalSwitch struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Ports       []string          `ovsdb:"ports"`        // UUIDs of LogicalSwitchPort
	ACLs        []string          `ovsdb:"acls"`         // UUIDs of ACL
	QOSRules    []string          `ovsdb:"qos_rules"`    // UUIDs of QoS
	LoadBalancer []string         `ovsdb:"load_balancer"` // UUIDs of Load_Balancer
	DNSRecords  []string          `ovsdb:"dns_records"`  // UUIDs of DNS
	OtherConfig map[string]string `ovsdb:"other_config"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (ls *LogicalSwitch) Table() string {
	return "Logical_Switch"
}

// =============================================================================
// LOGICAL SWITCH PORT - Connection point on a logical switch
// =============================================================================

// LogicalSwitchPort represents a port on an OVN logical switch.
type LogicalSwitchPort struct {
	UUID                string            `ovsdb:"_uuid"`
	Name                string            `ovsdb:"name"`
	Type                string            `ovsdb:"type"`
	Addresses           []string          `ovsdb:"addresses"`
	PortSecurity        []string          `ovsdb:"port_security"`
	ParentName          *string           `ovsdb:"parent_name"`
	Tag                 *int              `ovsdb:"tag"`
	TagRequest          *int              `ovsdb:"tag_request"`
	Up                  *bool             `ovsdb:"up"`
	Enabled             *bool             `ovsdb:"enabled"`
	DHCPv4Options       *string           `ovsdb:"dhcpv4_options"` // UUID of DHCP_Options
	DHCPv6Options       *string           `ovsdb:"dhcpv6_options"` // UUID of DHCP_Options
	HAChassisGroup      *string           `ovsdb:"ha_chassis_group"`
	Options             map[string]string `ovsdb:"options"`
	ExternalIDs         map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (lsp *LogicalSwitchPort) Table() string {
	return "Logical_Switch_Port"
}

// PortType constants for LogicalSwitchPort.Type
const (
	PortTypeNormal     = ""           // Normal VM port
	PortTypeRouter     = "router"     // Connected to a logical router
	PortTypeLocalnet   = "localnet"   // Connected to physical network
	PortTypeL2Gateway  = "l2gateway"  // L2 gateway port
	PortTypeVtep       = "vtep"       // VTEP gateway port
	PortTypeExternal   = "external"   // External logical port
	PortTypeVirtual    = "virtual"    // Virtual port for BFD
	PortTypeRemote     = "remote"     // Remote port
)

// =============================================================================
// LOGICAL ROUTER - Virtual L3 router
// =============================================================================

// LogicalRouter represents an OVN logical router.
type LogicalRouter struct {
	UUID         string            `ovsdb:"_uuid"`
	Name         string            `ovsdb:"name"`
	Ports        []string          `ovsdb:"ports"`       // UUIDs of Logical_Router_Port
	StaticRoutes []string          `ovsdb:"static_routes"` // UUIDs of Logical_Router_Static_Route
	Policies     []string          `ovsdb:"policies"`    // UUIDs of Logical_Router_Policy
	NAT          []string          `ovsdb:"nat"`         // UUIDs of NAT
	LoadBalancer []string          `ovsdb:"load_balancer"`
	Options      map[string]string `ovsdb:"options"`
	ExternalIDs  map[string]string `ovsdb:"external_ids"`
	Enabled      *bool             `ovsdb:"enabled"`
}

// Table returns the table name for libovsdb.
func (lr *LogicalRouter) Table() string {
	return "Logical_Router"
}

// =============================================================================
// LOGICAL ROUTER PORT - Port on a logical router
// =============================================================================

// LogicalRouterPort represents a port on an OVN logical router.
type LogicalRouterPort struct {
	UUID          string            `ovsdb:"_uuid"`
	Name          string            `ovsdb:"name"`
	MAC           string            `ovsdb:"mac"`
	Networks      []string          `ovsdb:"networks"`
	Peer          *string           `ovsdb:"peer"`
	GatewayChass  []string          `ovsdb:"gateway_chassis"`
	HAChasGroup   *string           `ovsdb:"ha_chassis_group"`
	Options       map[string]string `ovsdb:"options"`
	ExternalIDs   map[string]string `ovsdb:"external_ids"`
	Enabled       *bool             `ovsdb:"enabled"`
	IPv6RAConfigs map[string]string `ovsdb:"ipv6_ra_configs"`
}

// Table returns the table name for libovsdb.
func (lrp *LogicalRouterPort) Table() string {
	return "Logical_Router_Port"
}

// =============================================================================
// LOGICAL ROUTER STATIC ROUTE
// =============================================================================

// LogicalRouterStaticRoute represents a static route in OVN.
type LogicalRouterStaticRoute struct {
	UUID        string            `ovsdb:"_uuid"`
	IPPrefix    string            `ovsdb:"ip_prefix"`
	Nexthop     string            `ovsdb:"nexthop"`
	OutputPort  *string           `ovsdb:"output_port"`
	Policy      *string           `ovsdb:"policy"` // "src-ip" or "dst-ip"
	Options     map[string]string `ovsdb:"options"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (r *LogicalRouterStaticRoute) Table() string {
	return "Logical_Router_Static_Route"
}

// =============================================================================
// ACL - Access Control List
// =============================================================================

// ACL represents an OVN ACL (firewall rule).
type ACL struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        *string           `ovsdb:"name"`
	Priority    int               `ovsdb:"priority"`
	Direction   string            `ovsdb:"direction"` // "from-lport" or "to-lport"
	Match       string            `ovsdb:"match"`
	Action      string            `ovsdb:"action"` // "allow", "allow-related", "allow-stateless", "drop", "reject"
	Log         bool              `ovsdb:"log"`
	Severity    *string           `ovsdb:"severity"` // "alert", "warning", "notice", "info", "debug"
	Meter       *string           `ovsdb:"meter"`
	Label       int               `ovsdb:"label"`
	Options     map[string]string `ovsdb:"options"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (a *ACL) Table() string {
	return "ACL"
}

// ACL Direction constants
const (
	ACLDirectionFromLport = "from-lport" // Egress from VM perspective
	ACLDirectionToLport   = "to-lport"   // Ingress to VM perspective
)

// ACL Action constants
const (
	ACLActionAllow          = "allow"
	ACLActionAllowRelated   = "allow-related"   // Stateful - allows related traffic
	ACLActionAllowStateless = "allow-stateless" // Stateless allow
	ACLActionDrop           = "drop"
	ACLActionReject         = "reject" // Send ICMP unreachable
)

// =============================================================================
// NAT - Network Address Translation
// =============================================================================

// NAT represents an OVN NAT rule.
type NAT struct {
	UUID            string            `ovsdb:"_uuid"`
	Type            string            `ovsdb:"type"` // "snat", "dnat", "dnat_and_snat"
	ExternalIP      string            `ovsdb:"external_ip"`
	ExternalMAC     *string           `ovsdb:"external_mac"`
	ExternalPortRange string          `ovsdb:"external_port_range"`
	LogicalIP       string            `ovsdb:"logical_ip"`
	LogicalPort     *string           `ovsdb:"logical_port"`
	Options         map[string]string `ovsdb:"options"`
	ExternalIDs     map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (n *NAT) Table() string {
	return "NAT"
}

// NAT Type constants
const (
	NATTypeSNAT        = "snat"          // Source NAT (outbound)
	NATTypeDNAT        = "dnat"          // Destination NAT (inbound)
	NATTypeDNATAndSNAT = "dnat_and_snat" // Both (floating IP)
)

// =============================================================================
// DHCP OPTIONS
// =============================================================================

// DHCPOptions represents OVN DHCP configuration.
type DHCPOptions struct {
	UUID        string            `ovsdb:"_uuid"`
	CIDR        string            `ovsdb:"cidr"`
	Options     map[string]string `ovsdb:"options"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (d *DHCPOptions) Table() string {
	return "DHCP_Options"
}

// DHCP Option keys
const (
	DHCPOptionServerID   = "server_id"
	DHCPOptionServerMAC  = "server_mac"
	DHCPOptionRouter     = "router"
	DHCPOptionDNSServer  = "dns_server"
	DHCPOptionLeaseTime  = "lease_time"
	DHCPOptionMTU        = "mtu"
	DHCPOptionDomainName = "domain_name"
	DHCPOptionHostname   = "hostname"
)

// =============================================================================
// LOAD BALANCER
// =============================================================================

// LoadBalancer represents an OVN load balancer.
type LoadBalancer struct {
	UUID            string              `ovsdb:"_uuid"`
	Name            string              `ovsdb:"name"`
	VIPs            map[string]string   `ovsdb:"vips"` // "vip:port" -> "backend:port,backend2:port"
	Protocol        *string             `ovsdb:"protocol"` // "tcp", "udp", "sctp"
	HealthCheck     []string            `ovsdb:"health_check"` // UUIDs of Load_Balancer_Health_Check
	IPPortMappings  map[string]string   `ovsdb:"ip_port_mappings"`
	SelectionFields []string            `ovsdb:"selection_fields"`
	Options         map[string]string   `ovsdb:"options"`
	ExternalIDs     map[string]string   `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (lb *LoadBalancer) Table() string {
	return "Load_Balancer"
}

// =============================================================================
// LOAD BALANCER HEALTH CHECK
// =============================================================================

// LoadBalancerHealthCheck represents a health check for load balancer backends.
type LoadBalancerHealthCheck struct {
	UUID        string            `ovsdb:"_uuid"`
	VIP         string            `ovsdb:"vip"`
	Options     map[string]string `ovsdb:"options"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (hc *LoadBalancerHealthCheck) Table() string {
	return "Load_Balancer_Health_Check"
}

// =============================================================================
// PORT GROUP
// =============================================================================

// PortGroup represents an OVN port group for applying ACLs to multiple ports.
type PortGroup struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Ports       []string          `ovsdb:"ports"` // UUIDs of Logical_Switch_Port
	ACLs        []string          `ovsdb:"acls"`  // UUIDs of ACL
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (pg *PortGroup) Table() string {
	return "Port_Group"
}

// =============================================================================
// ADDRESS SET
// =============================================================================

// AddressSet represents an OVN address set for IP-based ACL matching.
type AddressSet struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Addresses   []string          `ovsdb:"addresses"` // IP addresses or CIDRs
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (as *AddressSet) Table() string {
	return "Address_Set"
}

// =============================================================================
// DNS
// =============================================================================

// DNS represents an OVN DNS record.
type DNS struct {
	UUID        string            `ovsdb:"_uuid"`
	Records     map[string]string `ovsdb:"records"` // hostname -> IP
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (d *DNS) Table() string {
	return "DNS"
}

// =============================================================================
// QOS
// =============================================================================

// QoS represents an OVN QoS rule for bandwidth limiting.
type QoS struct {
	UUID        string            `ovsdb:"_uuid"`
	Priority    int               `ovsdb:"priority"`
	Direction   string            `ovsdb:"direction"` // "from-lport" or "to-lport"
	Match       string            `ovsdb:"match"`
	Action      map[string]int    `ovsdb:"action"` // "dscp" -> value
	Bandwidth   map[string]int    `ovsdb:"bandwidth"` // "rate", "burst"
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (q *QoS) Table() string {
	return "QoS"
}

// =============================================================================
// GATEWAY CHASSIS
// =============================================================================

// GatewayChassis represents a gateway chassis for distributed routing.
type GatewayChassis struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	ChassisName string            `ovsdb:"chassis_name"`
	Priority    int               `ovsdb:"priority"`
	Options     map[string]string `ovsdb:"options"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (gc *GatewayChassis) Table() string {
	return "Gateway_Chassis"
}

// =============================================================================
// HA CHASSIS GROUP
// =============================================================================

// HAChassisGroup represents an HA chassis group for gateway failover.
type HAChassisGroup struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	HAChassis   []string          `ovsdb:"ha_chassis"` // UUIDs of HA_Chassis
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (hcg *HAChassisGroup) Table() string {
	return "HA_Chassis_Group"
}

// HAChassis represents an HA chassis member.
type HAChassis struct {
	UUID        string            `ovsdb:"_uuid"`
	ChassisName string            `ovsdb:"chassis_name"`
	Priority    int               `ovsdb:"priority"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (hc *HAChassis) Table() string {
	return "HA_Chassis"
}

// =============================================================================
// METER & METER BAND
// =============================================================================

// Meter represents an OVN meter for rate limiting.
type Meter struct {
	UUID        string            `ovsdb:"_uuid"`
	Name        string            `ovsdb:"name"`
	Unit        string            `ovsdb:"unit"` // "kbps" or "pktps"
	Bands       []string          `ovsdb:"bands"` // UUIDs of Meter_Band
	Fair        *bool             `ovsdb:"fair"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (m *Meter) Table() string {
	return "Meter"
}

// MeterBand represents a meter band.
type MeterBand struct {
	UUID       string `ovsdb:"_uuid"`
	Action     string `ovsdb:"action"` // "drop"
	Rate       int    `ovsdb:"rate"`
	BurstSize  int    `ovsdb:"burst_size"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
}

// Table returns the table name for libovsdb.
func (mb *MeterBand) Table() string {
	return "Meter_Band"
}

// =============================================================================
// NB GLOBAL
// =============================================================================

// NBGlobal represents the OVN Northbound global configuration.
type NBGlobal struct {
	UUID        string            `ovsdb:"_uuid"`
	NBCfg       int               `ovsdb:"nb_cfg"`
	SBCfg       int               `ovsdb:"sb_cfg"`
	HVCfg       int               `ovsdb:"hv_cfg"`
	Options     map[string]string `ovsdb:"options"`
	ExternalIDs map[string]string `ovsdb:"external_ids"`
	Connections []string          `ovsdb:"connections"` // UUIDs of Connection
	SSL         *string           `ovsdb:"ssl"`         // UUID of SSL
	IPSec       bool              `ovsdb:"ipsec"`
	Name        string            `ovsdb:"name"`
}

// Table returns the table name for libovsdb.
func (nb *NBGlobal) Table() string {
	return "NB_Global"
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Schema returns the OVN Northbound database schema name.
func Schema() string {
	return "OVN_Northbound"
}

// AllTables returns all table types for model registration.
func AllTables() []interface{} {
	return []interface{}{
		&LogicalSwitch{},
		&LogicalSwitchPort{},
		&LogicalRouter{},
		&LogicalRouterPort{},
		&LogicalRouterStaticRoute{},
		&ACL{},
		&NAT{},
		&DHCPOptions{},
		&LoadBalancer{},
		&LoadBalancerHealthCheck{},
		&PortGroup{},
		&AddressSet{},
		&DNS{},
		&QoS{},
		&GatewayChassis{},
		&HAChassisGroup{},
		&HAChassis{},
		&Meter{},
		&MeterBand{},
		&NBGlobal{},
	}
}

// MarshalJSON implements custom JSON marshaling for OVSDB types.
func (ls *LogicalSwitch) MarshalJSON() ([]byte, error) {
	type Alias LogicalSwitch
	return json.Marshal(&struct {
		*Alias
	}{
		Alias: (*Alias)(ls),
	})
}
