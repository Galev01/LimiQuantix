//! OVS (Open vSwitch) port manager for QuantumNet.
//!
//! This module handles:
//! - Checking OVS availability and status
//! - Binding VM interfaces to the OVS integration bridge (br-int)
//! - Setting interface-id external_ids for OVN controller
//! - Generating libvirt interface XML for OVS virtualport

use std::process::Command;
use anyhow::{Context, Result, bail};
use tracing::{info, debug, warn, instrument};

use super::types::{
    NetworkPortConfig, NetworkPortInfo, NetworkPortPhase, OvsStatus,
};

/// OVS port manager for connecting VMs to OVN.
#[derive(Clone)]
pub struct OvsPortManager {
    /// Integration bridge name (default: "br-int")
    integration_bridge: String,
}

impl OvsPortManager {
    /// Create a new OVS port manager.
    pub fn new() -> Self {
        Self {
            integration_bridge: "br-int".to_string(),
        }
    }

    /// Create a new OVS port manager with custom integration bridge.
    pub fn with_bridge(integration_bridge: String) -> Self {
        Self { integration_bridge }
    }

    /// Check if OVS is available and get its status.
    #[instrument(skip(self))]
    pub fn get_status(&self) -> Result<OvsStatus> {
        let mut status = OvsStatus::default();
        status.integration_bridge = self.integration_bridge.clone();

        // Check if ovs-vsctl is available
        let version_output = Command::new("ovs-vsctl")
            .arg("--version")
            .output();

        match version_output {
            Ok(output) if output.status.success() => {
                status.available = true;
                let version_str = String::from_utf8_lossy(&output.stdout);
                // Parse version from first line: "ovs-vsctl (Open vSwitch) 2.17.0"
                if let Some(line) = version_str.lines().next() {
                    if let Some(ver) = line.split_whitespace().last() {
                        status.ovs_version = ver.to_string();
                    }
                }
            }
            _ => {
                warn!("OVS not available: ovs-vsctl not found or not executable");
                return Ok(status);
            }
        }

        // Get OVN external IDs from Open_vSwitch table
        let external_ids = self.get_ovs_external_ids()?;

        if let Some(encap_type) = external_ids.get("ovn-encap-type") {
            status.encap_type = encap_type.clone();
        }
        if let Some(encap_ip) = external_ids.get("ovn-encap-ip") {
            status.encap_ip = encap_ip.clone();
        }
        if let Some(system_id) = external_ids.get("system-id") {
            status.chassis_id = system_id.clone();
        }

        // Check if OVN controller is connected by verifying integration bridge exists
        let br_exists = Command::new("ovs-vsctl")
            .args(["br-exists", &self.integration_bridge])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if br_exists {
            // Check if ovn-controller is running
            let ovn_status = Command::new("systemctl")
                .args(["is-active", "ovn-controller"])
                .output();

            status.ovn_controller_connected = ovn_status
                .map(|o| o.status.success())
                .unwrap_or(false);
        }

        debug!(
            ovs_version = %status.ovs_version,
            ovn_connected = status.ovn_controller_connected,
            bridge = %status.integration_bridge,
            "OVS status retrieved"
        );

        Ok(status)
    }

    /// Get external_ids from Open_vSwitch table.
    fn get_ovs_external_ids(&self) -> Result<std::collections::HashMap<String, String>> {
        let output = Command::new("ovs-vsctl")
            .args(["get", "Open_vSwitch", ".", "external_ids"])
            .output()
            .context("Failed to get OVS external_ids")?;

        let mut ids = std::collections::HashMap::new();
        if output.status.success() {
            let ids_str = String::from_utf8_lossy(&output.stdout);
            // Parse format: {key1=val1, key2=val2}
            let trimmed = ids_str.trim().trim_start_matches('{').trim_end_matches('}');
            for pair in trimmed.split(", ") {
                if let Some((key, value)) = pair.split_once('=') {
                    let clean_value = value.trim_matches('"').to_string();
                    ids.insert(key.to_string(), clean_value);
                }
            }
        }
        Ok(ids)
    }

    /// Configure a network port for a VM.
    ///
    /// This binds the VM's TAP interface to OVN by setting the iface-id external_id.
    /// The actual port is created by libvirt when the VM starts.
    #[instrument(skip(self, config))]
    pub fn configure_port(&self, config: &NetworkPortConfig) -> Result<NetworkPortInfo> {
        info!(
            port_id = %config.port_id,
            vm_id = %config.vm_id,
            ovn_port = %config.ovn_port_name,
            mac = %config.mac_address,
            "Configuring network port for OVN"
        );

        // Generate libvirt interface XML
        let interface_xml = self.generate_interface_xml(config)?;

        let port_info = NetworkPortInfo {
            port_id: config.port_id.clone(),
            vm_id: config.vm_id.clone(),
            network_id: config.network_id.clone(),
            mac_address: config.mac_address.clone(),
            ip_addresses: config.ip_addresses.clone(),
            phase: NetworkPortPhase::Pending,
            error_message: None,
            ovs_port_name: None, // Set when VM starts
            ovn_port_name: config.ovn_port_name.clone(),
            interface_xml,
            rx_bytes: 0,
            tx_bytes: 0,
            rx_packets: 0,
            tx_packets: 0,
        };

        Ok(port_info)
    }

    /// Bind an existing OVS interface to an OVN port.
    ///
    /// This is called after the VM starts and the TAP interface exists.
    #[instrument(skip(self))]
    pub fn bind_interface(&self, iface_name: &str, ovn_port_name: &str, vm_id: &str) -> Result<()> {
        info!(
            iface = %iface_name,
            ovn_port = %ovn_port_name,
            vm_id = %vm_id,
            "Binding interface to OVN port"
        );

        // Set the iface-id external_id - OVN controller will pick this up
        // and apply the correct flows
        let output = Command::new("ovs-vsctl")
            .args([
                "set", "Interface", iface_name,
                &format!("external_ids:iface-id={}", ovn_port_name),
                &format!("external_ids:attached-mac="),
                &format!("external_ids:vm-id={}", vm_id),
            ])
            .output()
            .context("Failed to set OVS interface external_ids")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("Failed to bind interface to OVN: {}", stderr);
        }

        debug!(
            iface = %iface_name,
            ovn_port = %ovn_port_name,
            "Interface bound to OVN port"
        );

        Ok(())
    }

    /// Unbind an interface from OVN.
    #[instrument(skip(self))]
    pub fn unbind_interface(&self, iface_name: &str) -> Result<()> {
        debug!(iface = %iface_name, "Unbinding interface from OVN");

        let output = Command::new("ovs-vsctl")
            .args([
                "--if-exists", "remove", "Interface", iface_name,
                "external_ids", "iface-id",
            ])
            .output()
            .context("Failed to unbind interface")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(iface = %iface_name, error = %stderr, "Failed to unbind interface");
        }

        Ok(())
    }

    /// Delete a network port.
    #[instrument(skip(self))]
    pub fn delete_port(&self, port_id: &str, vm_id: &str) -> Result<()> {
        info!(port_id = %port_id, vm_id = %vm_id, "Deleting network port");
        // The port will be deleted by libvirt when the VM is destroyed
        // We don't need to do anything here
        Ok(())
    }

    /// Get port status by looking up the OVS interface.
    #[instrument(skip(self))]
    pub fn get_port_status(&self, port_id: &str, ovn_port_name: &str) -> Result<Option<NetworkPortInfo>> {
        // Find interface by iface-id
        let output = Command::new("ovs-vsctl")
            .args([
                "--columns=name,external_ids,statistics",
                "--format=json",
                "find", "Interface",
                &format!("external_ids:iface-id={}", ovn_port_name),
            ])
            .output()
            .context("Failed to find OVS interface")?;

        if !output.status.success() {
            return Ok(None);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("[]") {
            return Ok(None);
        }

        // Parse the interface info
        // For now, return a basic status
        let port_info = NetworkPortInfo {
            port_id: port_id.to_string(),
            vm_id: String::new(),
            network_id: String::new(),
            mac_address: String::new(),
            ip_addresses: vec![],
            phase: NetworkPortPhase::Active,
            error_message: None,
            ovs_port_name: Some(ovn_port_name.to_string()),
            ovn_port_name: ovn_port_name.to_string(),
            interface_xml: String::new(),
            rx_bytes: 0,
            tx_bytes: 0,
            rx_packets: 0,
            tx_packets: 0,
        };

        Ok(Some(port_info))
    }

    /// List all network ports on this node.
    #[instrument(skip(self))]
    pub fn list_ports(&self) -> Result<Vec<NetworkPortInfo>> {
        // Find all interfaces with limiquantix external_ids
        let output = Command::new("ovs-vsctl")
            .args([
                "--columns=name,external_ids",
                "--format=json",
                "list", "Interface",
            ])
            .output()
            .context("Failed to list OVS interfaces")?;

        if !output.status.success() {
            return Ok(vec![]);
        }

        // Parse and filter interfaces with iface-id
        // For now, return empty list - full implementation would parse JSON
        Ok(vec![])
    }

    /// Generate libvirt interface XML for OVS/OVN.
    ///
    /// This generates XML like:
    /// ```xml
    /// <interface type='bridge'>
    ///   <source bridge='br-int'/>
    ///   <virtualport type='openvswitch'>
    ///     <parameters interfaceid='lsp-xxx'/>
    ///   </virtualport>
    ///   <mac address='fa:16:3e:xx:xx:xx'/>
    ///   <model type='virtio'/>
    /// </interface>
    /// ```
    pub fn generate_interface_xml(&self, config: &NetworkPortConfig) -> Result<String> {
        let xml = format!(
            r#"<interface type='bridge'>
  <source bridge='{bridge}'/>
  <virtualport type='openvswitch'>
    <parameters interfaceid='{ovn_port}'/>
  </virtualport>
  <mac address='{mac}'/>
  <model type='virtio'/>
</interface>"#,
            bridge = self.integration_bridge,
            ovn_port = config.ovn_port_name,
            mac = config.mac_address,
        );

        Ok(xml)
    }

    /// Generate libvirt interface XML with device name.
    ///
    /// This is used when updating existing VMs.
    pub fn generate_interface_xml_with_target(
        &self,
        config: &NetworkPortConfig,
        target_dev: &str,
    ) -> Result<String> {
        let xml = format!(
            r#"<interface type='bridge'>
  <source bridge='{bridge}'/>
  <virtualport type='openvswitch'>
    <parameters interfaceid='{ovn_port}'/>
  </virtualport>
  <target dev='{target}'/>
  <mac address='{mac}'/>
  <model type='virtio'/>
</interface>"#,
            bridge = self.integration_bridge,
            ovn_port = config.ovn_port_name,
            target = target_dev,
            mac = config.mac_address,
        );

        Ok(xml)
    }

    /// Check if we should use OVS for networking.
    ///
    /// Returns true if OVS is available and br-int exists.
    pub fn should_use_ovs(&self) -> bool {
        if let Ok(status) = self.get_status() {
            status.available && status.ovn_controller_connected
        } else {
            false
        }
    }
}

impl Default for OvsPortManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_interface_xml() {
        let manager = OvsPortManager::new();
        let config = NetworkPortConfig {
            port_id: "port-123".to_string(),
            vm_id: "vm-456".to_string(),
            network_id: "net-789".to_string(),
            mac_address: "fa:16:3e:aa:bb:cc".to_string(),
            ip_addresses: vec!["10.0.1.5".to_string()],
            ovn_port_name: "lsp-port-123".to_string(),
            binding_type: super::super::types::NetworkPortBindingType::Normal,
            qos: None,
            port_security_enabled: true,
            security_group_ids: vec![],
        };

        let xml = manager.generate_interface_xml(&config).unwrap();
        assert!(xml.contains("bridge='br-int'"));
        assert!(xml.contains("interfaceid='lsp-port-123'"));
        assert!(xml.contains("address='fa:16:3e:aa:bb:cc'"));
        assert!(xml.contains("type='virtio'"));
    }
}
