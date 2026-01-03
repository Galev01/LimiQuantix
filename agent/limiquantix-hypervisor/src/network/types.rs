//! Network types for OVS/OVN integration.

use serde::{Deserialize, Serialize};

/// Network port binding types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum NetworkPortBindingType {
    /// Standard OVS port (virtio-net)
    #[default]
    Normal,
    /// SR-IOV VF passthrough
    Direct,
    /// MACVTAP device
    Macvtap,
    /// DPDK vhost-user
    VhostUser,
}

/// Network port QoS settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetworkPortQoS {
    /// Ingress rate limit in Kbps
    pub ingress_rate_kbps: u64,
    /// Egress rate limit in Kbps
    pub egress_rate_kbps: u64,
    /// Ingress burst in KB
    pub ingress_burst_kb: u64,
    /// Egress burst in KB
    pub egress_burst_kb: u64,
}

/// Network port configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPortConfig {
    /// Limiquantix port ID
    pub port_id: String,
    /// VM ID this port belongs to
    pub vm_id: String,
    /// Network ID
    pub network_id: String,
    /// MAC address
    pub mac_address: String,
    /// Allocated IP addresses
    pub ip_addresses: Vec<String>,
    /// OVN logical switch port name (e.g., "lsp-xxx")
    pub ovn_port_name: String,
    /// Port binding type
    pub binding_type: NetworkPortBindingType,
    /// QoS settings
    pub qos: Option<NetworkPortQoS>,
    /// Port security enabled
    pub port_security_enabled: bool,
    /// Security group IDs
    pub security_group_ids: Vec<String>,
}

/// Network port phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum NetworkPortPhase {
    #[default]
    Unknown,
    Pending,
    Building,
    Active,
    Down,
    Error,
}

/// Network port info/status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkPortInfo {
    /// Limiquantix port ID
    pub port_id: String,
    /// VM ID
    pub vm_id: String,
    /// Network ID
    pub network_id: String,
    /// MAC address
    pub mac_address: String,
    /// IP addresses
    pub ip_addresses: Vec<String>,
    /// Current phase
    pub phase: NetworkPortPhase,
    /// Error message if phase is Error
    pub error_message: Option<String>,
    /// OVS port name (e.g., "vnet0")
    pub ovs_port_name: Option<String>,
    /// OVN logical port name
    pub ovn_port_name: String,
    /// Libvirt interface XML snippet
    pub interface_xml: String,
    /// RX bytes
    pub rx_bytes: u64,
    /// TX bytes
    pub tx_bytes: u64,
    /// RX packets
    pub rx_packets: u64,
    /// TX packets
    pub tx_packets: u64,
}

/// OVS status information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OvsStatus {
    /// Is OVS available?
    pub available: bool,
    /// OVS version string
    pub ovs_version: String,
    /// Is OVN controller connected?
    pub ovn_controller_connected: bool,
    /// Integration bridge name
    pub integration_bridge: String,
    /// Encapsulation type (e.g., "geneve")
    pub encap_type: String,
    /// Encapsulation IP
    pub encap_ip: String,
    /// OVN chassis ID
    pub chassis_id: String,
}

impl Default for OvsStatus {
    fn default() -> Self {
        Self {
            available: false,
            ovs_version: String::new(),
            ovn_controller_connected: false,
            integration_bridge: "br-int".to_string(),
            encap_type: String::new(),
            encap_ip: String::new(),
            chassis_id: String::new(),
        }
    }
}
