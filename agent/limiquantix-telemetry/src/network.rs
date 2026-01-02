//! Network interface information collection.

use serde::{Deserialize, Serialize};
use sysinfo::Networks;

/// Network interface information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkInfo {
    /// Interface name
    pub name: String,
    /// MAC address (if available)
    pub mac_address: String,
    /// Total bytes received
    pub rx_bytes: u64,
    /// Total bytes transmitted
    pub tx_bytes: u64,
    /// Total packets received
    pub rx_packets: u64,
    /// Total packets transmitted
    pub tx_packets: u64,
    /// Receive errors
    pub rx_errors: u64,
    /// Transmit errors
    pub tx_errors: u64,
}

/// Collect network interface information from the system.
pub fn collect_network_info(networks: &Networks) -> Vec<NetworkInfo> {
    networks.list().iter().map(|(name, data)| {
        NetworkInfo {
            name: name.clone(),
            mac_address: data.mac_address().to_string(),
            rx_bytes: data.total_received(),
            tx_bytes: data.total_transmitted(),
            rx_packets: data.total_packets_received(),
            tx_packets: data.total_packets_transmitted(),
            rx_errors: data.total_errors_on_received(),
            tx_errors: data.total_errors_on_transmitted(),
        }
    }).collect()
}

