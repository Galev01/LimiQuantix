// Package domain contains core business entities for the limiquantix platform.
// This file defines network-related domain models: VirtualNetwork, Port, SecurityGroup, etc.
package domain

import "time"

// =============================================================================
// VIRTUAL NETWORK - SDN Network
// =============================================================================

// NetworkPhase represents the lifecycle phase of a virtual network.
type NetworkPhase string

const (
	NetworkPhasePending  NetworkPhase = "PENDING"
	NetworkPhaseReady    NetworkPhase = "READY"
	NetworkPhaseError    NetworkPhase = "ERROR"
	NetworkPhaseDeleting NetworkPhase = "DELETING"
)

// NetworkType represents the type of virtual network.
type NetworkType string

const (
	NetworkTypeOverlay  NetworkType = "OVERLAY"
	NetworkTypeVLAN     NetworkType = "VLAN"
	NetworkTypeExternal NetworkType = "EXTERNAL"
	NetworkTypeIsolated NetworkType = "ISOLATED"
)

// VirtualNetwork represents a software-defined network for VMs.
type VirtualNetwork struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	ProjectID   string            `json:"project_id"`
	Description string            `json:"description"`
	Labels      map[string]string `json:"labels"`

	Spec   VirtualNetworkSpec   `json:"spec"`
	Status VirtualNetworkStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VirtualNetworkSpec defines the desired configuration of a network.
type VirtualNetworkSpec struct {
	Type                   NetworkType     `json:"type"`
	IPConfig               IPAddressConfig `json:"ip_config"`
	VLAN                   *VLANConfig     `json:"vlan,omitempty"`
	Router                 *RouterConfig   `json:"router,omitempty"`
	MTU                    uint32          `json:"mtu"`
	DNS                    DNSConfig       `json:"dns"`
	DefaultSecurityGroupID string          `json:"default_security_group_id"`
	PortSecurityEnabled    bool            `json:"port_security_enabled"`
}

// IPAddressConfig defines IP addressing for a network.
type IPAddressConfig struct {
	IPv4Subnet      string     `json:"ipv4_subnet"`
	IPv4Gateway     string     `json:"ipv4_gateway"`
	IPv6Subnet      string     `json:"ipv6_subnet"`
	IPv6Gateway     string     `json:"ipv6_gateway"`
	DHCP            DHCPConfig `json:"dhcp"`
	AllocationPools []IPRange  `json:"allocation_pools"`
	ReservedIPs     []string   `json:"reserved_ips"`
}

// DHCPConfig defines DHCP settings.
type DHCPConfig struct {
	Enabled        bool          `json:"enabled"`
	LeaseTimeSec   uint32        `json:"lease_time_sec"`
	DNSServers     []string      `json:"dns_servers"`
	NTPServers     []string      `json:"ntp_servers"`
	DomainName     string        `json:"domain_name"`
	StaticBindings []DHCPBinding `json:"static_bindings"`
}

// DHCPBinding represents a static DHCP binding.
type DHCPBinding struct {
	MACAddress string `json:"mac_address"`
	IPAddress  string `json:"ip_address"`
	Hostname   string `json:"hostname"`
}

// IPRange represents a range of IP addresses.
type IPRange struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// VLANConfig defines VLAN settings.
type VLANConfig struct {
	VLANID          uint32 `json:"vlan_id"`
	PhysicalNetwork string `json:"physical_network"`
}

// RouterConfig defines router settings for a network.
type RouterConfig struct {
	Enabled                  bool          `json:"enabled"`
	ExternalGatewayNetworkID string        `json:"external_gateway_network_id"`
	EnableSNAT               bool          `json:"enable_snat"`
	Routes                   []StaticRoute `json:"routes"`
}

// StaticRoute represents a static route.
type StaticRoute struct {
	Destination string `json:"destination"`
	NextHop     string `json:"next_hop"`
}

// DNSConfig defines DNS settings.
type DNSConfig struct {
	Nameservers   []string `json:"nameservers"`
	SearchDomains []string `json:"search_domains"`
}

// VirtualNetworkStatus represents the runtime status of a network.
type VirtualNetworkStatus struct {
	Phase              NetworkPhase       `json:"phase"`
	OVNLogicalSwitch   string             `json:"ovn_logical_switch"`
	OVNLogicalRouter   string             `json:"ovn_logical_router"`
	PortCount          uint32             `json:"port_count"`
	IPAllocationStatus IPAllocationStatus `json:"ip_allocation_status"`
	ErrorMessage       string             `json:"error_message"`
}

// IPAllocationStatus shows IP address usage.
type IPAllocationStatus struct {
	IPv4Total     uint32 `json:"ipv4_total"`
	IPv4Allocated uint32 `json:"ipv4_allocated"`
	IPv4Available uint32 `json:"ipv4_available"`
	IPv6Allocated uint64 `json:"ipv6_allocated"`
}

// IsReady returns true if the network is ready to use.
func (n *VirtualNetwork) IsReady() bool {
	return n.Status.Phase == NetworkPhaseReady
}

// =============================================================================
// NETWORK PORT - Virtual NIC Connection Point
// =============================================================================

// PortPhase represents the lifecycle phase of a port.
type PortPhase string

const (
	PortPhasePending PortPhase = "PENDING"
	PortPhaseBuild   PortPhase = "BUILD"
	PortPhaseActive  PortPhase = "ACTIVE"
	PortPhaseDown    PortPhase = "DOWN"
	PortPhaseError   PortPhase = "ERROR"
)

// Port represents a connection point on a virtual network.
type Port struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	NetworkID string            `json:"network_id"`
	ProjectID string            `json:"project_id"`
	Labels    map[string]string `json:"labels"`

	Spec   PortSpec   `json:"spec"`
	Status PortStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PortSpec defines the desired port configuration.
type PortSpec struct {
	MACAddress          string         `json:"mac_address"`
	FixedIPs            []FixedIP      `json:"fixed_ips"`
	SecurityGroupIDs    []string       `json:"security_group_ids"`
	AllowedAddressPairs []AddressPair  `json:"allowed_address_pairs"`
	PortSecurityEnabled bool           `json:"port_security_enabled"`
	AdminStateUp        bool           `json:"admin_state_up"`
	QoS                 PortQoS        `json:"qos"`
	Binding             BindingProfile `json:"binding"`
}

// FixedIP represents a fixed IP assignment.
type FixedIP struct {
	SubnetID  string `json:"subnet_id"`
	IPAddress string `json:"ip_address"`
}

// AddressPair allows additional addresses on a port (for HA/failover).
type AddressPair struct {
	IPAddress  string `json:"ip_address"`
	MACAddress string `json:"mac_address"`
}

// PortQoS defines rate limiting for a port.
type PortQoS struct {
	IngressRateKbps uint64 `json:"ingress_rate_kbps"`
	EgressRateKbps  uint64 `json:"egress_rate_kbps"`
	IngressBurstKb  uint64 `json:"ingress_burst_kb"`
	EgressBurstKb   uint64 `json:"egress_burst_kb"`
}

// BindingType represents the port binding type.
type BindingType string

const (
	BindingTypeNormal    BindingType = "NORMAL"
	BindingTypeDirect    BindingType = "DIRECT" // SR-IOV
	BindingTypeMACVTAP   BindingType = "MACVTAP"
	BindingTypeVHostUser BindingType = "VHOST_USER" // DPDK
)

// BindingProfile defines hardware-specific binding options.
type BindingProfile struct {
	Type         BindingType `json:"type"`
	PCISlot      string      `json:"pci_slot"`
	VHostSocket  string      `json:"vhost_socket"`
	NUMAAffinity uint32      `json:"numa_affinity"`
}

// PortStatus represents the runtime status of a port.
type PortStatus struct {
	Phase        PortPhase `json:"phase"`
	MACAddress   string    `json:"mac_address"`
	IPAddresses  []string  `json:"ip_addresses"`
	OVNPort      string    `json:"ovn_port"`
	VMID         string    `json:"vm_id"`
	HostID       string    `json:"host_id"`
	ErrorMessage string    `json:"error_message"`
}

// IsActive returns true if the port is active.
func (p *Port) IsActive() bool {
	return p.Status.Phase == PortPhaseActive
}

// =============================================================================
// SECURITY GROUP - Firewall Rules
// =============================================================================

// SecurityGroup defines firewall rules for network ports.
type SecurityGroup struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ProjectID   string            `json:"project_id"`
	Labels      map[string]string `json:"labels"`

	Rules    []SecurityGroupRule `json:"rules"`
	Stateful bool                `json:"stateful"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// RuleDirection represents the direction of traffic.
type RuleDirection string

const (
	RuleDirectionIngress RuleDirection = "INGRESS"
	RuleDirectionEgress  RuleDirection = "EGRESS"
)

// RuleAction represents what to do with matched traffic.
type RuleAction string

const (
	RuleActionAllow  RuleAction = "ALLOW"
	RuleActionDrop   RuleAction = "DROP"
	RuleActionReject RuleAction = "REJECT"
)

// SecurityGroupRule represents a single firewall rule.
type SecurityGroupRule struct {
	ID                    string        `json:"id"`
	Direction             RuleDirection `json:"direction"`
	Protocol              string        `json:"protocol"` // "tcp", "udp", "icmp", "any"
	PortMin               uint32        `json:"port_min"`
	PortMax               uint32        `json:"port_max"`
	ICMPType              int32         `json:"icmp_type"`
	ICMPCode              int32         `json:"icmp_code"`
	RemoteIPPrefix        string        `json:"remote_ip_prefix"`
	RemoteSecurityGroupID string        `json:"remote_security_group_id"`
	Action                RuleAction    `json:"action"`
	Priority              uint32        `json:"priority"`
	Description           string        `json:"description"`
}

// =============================================================================
// FLOATING IP - Public IP Assignment
// =============================================================================

// FloatingIPPhase represents the lifecycle phase of a floating IP.
type FloatingIPPhase string

const (
	FloatingIPPhasePending FloatingIPPhase = "PENDING"
	FloatingIPPhaseActive  FloatingIPPhase = "ACTIVE"
	FloatingIPPhaseDown    FloatingIPPhase = "DOWN"
	FloatingIPPhaseError   FloatingIPPhase = "ERROR"
)

// FloatingIP represents a public IP that can be assigned to a VM.
type FloatingIP struct {
	ID                string            `json:"id"`
	IPAddress         string            `json:"ip_address"`
	ExternalNetworkID string            `json:"external_network_id"`
	ProjectID         string            `json:"project_id"`
	Description       string            `json:"description"`
	Labels            map[string]string `json:"labels"`

	Assignment FloatingIPAssignment `json:"assignment"`
	Status     FloatingIPStatus     `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// FloatingIPAssignment defines which port has this floating IP.
type FloatingIPAssignment struct {
	PortID  string `json:"port_id"`
	FixedIP string `json:"fixed_ip"`
}

// FloatingIPStatus represents the floating IP status.
type FloatingIPStatus struct {
	Phase        FloatingIPPhase `json:"phase"`
	VMID         string          `json:"vm_id"`
	RouterID     string          `json:"router_id"`
	ErrorMessage string          `json:"error_message"`
}

// IsAssigned returns true if the floating IP is assigned to a port.
func (f *FloatingIP) IsAssigned() bool {
	return f.Assignment.PortID != ""
}

// =============================================================================
// LOAD BALANCER - L4 Load Balancing
// =============================================================================

// LBPhase represents the lifecycle phase of a load balancer.
type LBPhase string

const (
	LBPhasePending LBPhase = "PENDING"
	LBPhaseActive  LBPhase = "ACTIVE"
	LBPhaseError   LBPhase = "ERROR"
)

// LBAlgorithm represents the load balancing algorithm.
type LBAlgorithm string

const (
	LBAlgorithmRoundRobin   LBAlgorithm = "ROUND_ROBIN"
	LBAlgorithmLeastConn    LBAlgorithm = "LEAST_CONNECTIONS"
	LBAlgorithmSourceIP     LBAlgorithm = "SOURCE_IP"
	LBAlgorithmWeighted     LBAlgorithm = "WEIGHTED"
)

// LBProtocol represents the protocol for load balancing.
type LBProtocol string

const (
	LBProtocolTCP  LBProtocol = "TCP"
	LBProtocolUDP  LBProtocol = "UDP"
	LBProtocolHTTP LBProtocol = "HTTP"
	LBProtocolHTTPS LBProtocol = "HTTPS"
)

// LoadBalancer represents an L4 load balancer.
type LoadBalancer struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	NetworkID   string            `json:"network_id"`
	ProjectID   string            `json:"project_id"`
	Description string            `json:"description"`
	Labels      map[string]string `json:"labels"`

	Spec   LoadBalancerSpec   `json:"spec"`
	Status LoadBalancerStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// LoadBalancerSpec defines the desired state of the load balancer.
type LoadBalancerSpec struct {
	VIP       string       `json:"vip"`        // Virtual IP address
	Algorithm LBAlgorithm  `json:"algorithm"`
	Protocol  LBProtocol   `json:"protocol"`
	Listeners []LBListener `json:"listeners"`
	Members   []LBMember   `json:"members"`
}

// LoadBalancerStatus represents the current state of the load balancer.
type LoadBalancerStatus struct {
	Phase         LBPhase `json:"phase"`
	ProvisionedIP string  `json:"provisioned_ip"`
	ErrorMessage  string  `json:"error_message"`
}

// LBListener represents a frontend listener (port mapping).
type LBListener struct {
	ID       string     `json:"id"`
	Port     int        `json:"port"`
	Protocol LBProtocol `json:"protocol"`
	Name     string     `json:"name"`
}

// LBMember represents a backend member (target server).
type LBMember struct {
	ID         string `json:"id"`
	Address    string `json:"address"` // IP address or hostname
	Port       int    `json:"port"`
	Weight     int    `json:"weight"`   // For weighted algorithms
	ListenerID string `json:"listener_id"` // Which listener this member belongs to
}

// =============================================================================
// VPN SERVICE - Site-to-Site VPN
// =============================================================================

// VPNPhase represents the lifecycle phase of a VPN service.
type VPNPhase string

const (
	VPNPhasePending VPNPhase = "PENDING"
	VPNPhaseActive  VPNPhase = "ACTIVE"
	VPNPhaseDown    VPNPhase = "DOWN"
	VPNPhaseError   VPNPhase = "ERROR"
)

// VPNType represents the type of VPN.
type VPNType string

const (
	VPNTypeIPSec     VPNType = "IPSEC"
	VPNTypeWireGuard VPNType = "WIREGUARD"
)

// VpnService represents a VPN service for site-to-site connectivity.
type VpnService struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	NetworkID   string            `json:"network_id"`
	ProjectID   string            `json:"project_id"`
	Description string            `json:"description"`
	Labels      map[string]string `json:"labels"`

	Spec   VpnServiceSpec   `json:"spec"`
	Status VpnServiceStatus `json:"status"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// VpnServiceSpec defines the VPN configuration.
type VpnServiceSpec struct {
	Type         VPNType         `json:"type"`
	RouterID     string          `json:"router_id"`
	ExternalIP   string          `json:"external_ip"`
	LocalSubnets []string        `json:"local_subnets"`
	Connections  []VpnConnection `json:"connections"`
}

// VpnServiceStatus represents the VPN status.
type VpnServiceStatus struct {
	Phase        VPNPhase `json:"phase"`
	PublicIP     string   `json:"public_ip"`
	PublicKey    string   `json:"public_key"` // For WireGuard
	ErrorMessage string   `json:"error_message"`
}

// VpnConnection represents a VPN peer connection.
type VpnConnection struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	PeerAddress   string   `json:"peer_address"`
	PeerCIDRs     []string `json:"peer_cidrs"`
	PSK           string   `json:"psk,omitempty"`       // Pre-shared key for IPSec
	PeerPublicKey string   `json:"peer_public_key,omitempty"` // For WireGuard
	Status        string   `json:"status"`
}
