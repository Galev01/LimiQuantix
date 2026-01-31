//! XML generation utilities for libvirt domain definitions.
//!
//! This module generates libvirt-compatible domain XML for VM definitions.
//! It uses Guest OS Profiles to apply OS-specific hardware configurations,
//! similar to VMware's Guest OS selection feature.

// Alternative XML builder (current implementation uses direct string generation)
#![allow(dead_code)]

use crate::types::*;
use crate::guest_os::GuestOSProfile;

/// Builder for libvirt domain XML.
pub struct DomainXmlBuilder<'a> {
    config: &'a VmConfig,
    /// The Guest OS profile with hardware-specific settings.
    profile: GuestOSProfile,
}

impl<'a> DomainXmlBuilder<'a> {
    /// Create a new XML builder for the given VM config.
    /// Automatically loads the appropriate Guest OS profile based on config.guest_os.
    pub fn new(config: &'a VmConfig) -> Self {
        let profile = GuestOSProfile::for_family(config.guest_os);
        Self { config, profile }
    }
    
    /// Create a new XML builder with a custom Guest OS profile.
    pub fn with_profile(config: &'a VmConfig, profile: GuestOSProfile) -> Self {
        Self { config, profile }
    }
    
    /// Build the domain XML string.
    pub fn build(&self) -> String {
        let mut xml = String::new();
        
        // Domain header with machine type from profile
        xml.push_str(&format!(
            r#"<domain type='kvm'>
  <name>{}</name>
  <uuid>{}</uuid>
  <memory unit='MiB'>{}</memory>
  <vcpu placement='static'>{}</vcpu>
"#,
            self.config.name,
            self.config.id,
            self.config.memory.size_mib,
            self.config.cpu.total_vcpus()
        ));
        
        // OS section
        xml.push_str(&self.build_os_section());
        
        // Features (with Hyper-V enlightenments for Windows)
        xml.push_str(&self.build_features_section());
        
        // CPU
        xml.push_str(&self.build_cpu_section());
        
        // Clock (OS-specific timer configuration)
        xml.push_str(&self.build_clock_section());
        
        // Power management
        xml.push_str(r#"  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>destroy</on_crash>
"#);
        
        // Devices
        xml.push_str("  <devices>\n");
        xml.push_str(&self.build_emulator());
        xml.push_str(&self.build_pci_controllers());
        xml.push_str(&self.build_disks());
        xml.push_str(&self.build_cdroms());
        xml.push_str(&self.build_nics());
        xml.push_str(&self.build_console());
        xml.push_str(&self.build_graphics());
        xml.push_str(&self.build_channels());
        xml.push_str("  </devices>\n");
        
        xml.push_str("</domain>\n");
        
        xml
    }
    
    /// Build the features section with OS-specific settings.
    fn build_features_section(&self) -> String {
        let mut xml = String::from("  <features>\n    <acpi/>\n    <apic/>\n");
        
        // Add Hyper-V enlightenments for Windows guests
        if self.profile.cpu.hyperv_features.enabled {
            let hv = &self.profile.cpu.hyperv_features;
            xml.push_str("    <hyperv>\n");
            
            if hv.relaxed { xml.push_str("      <relaxed state='on'/>\n"); }
            if hv.vapic { xml.push_str("      <vapic state='on'/>\n"); }
            if hv.spinlocks {
                xml.push_str(&format!("      <spinlocks state='on' retries='{}'/>\n", hv.spinlock_retries));
            }
            if hv.vpindex { xml.push_str("      <vpindex state='on'/>\n"); }
            if hv.runtime { xml.push_str("      <runtime state='on'/>\n"); }
            if hv.synic { xml.push_str("      <synic state='on'/>\n"); }
            if hv.stimer { xml.push_str("      <stimer state='on'/>\n"); }
            if hv.reset { xml.push_str("      <reset state='on'/>\n"); }
            if hv.frequencies { xml.push_str("      <frequencies state='on'/>\n"); }
            if hv.reftime { xml.push_str("      <reftime state='on'/>\n"); }
            if hv.tlbflush { xml.push_str("      <tlbflush state='on'/>\n"); }
            if hv.ipi { xml.push_str("      <ipi state='on'/>\n"); }
            
            xml.push_str("    </hyperv>\n");
        }
        
        xml.push_str("  </features>\n");
        xml
    }
    
    /// Build the clock section with OS-specific timer configuration.
    /// This is CRITICAL for OS compatibility - wrong settings cause kernel panics.
    fn build_clock_section(&self) -> String {
        let timers = &self.profile.timers;
        let mut xml = String::from("  <clock offset='utc'>\n");
        
        // RTC timer
        xml.push_str(&format!(
            "    <timer name='rtc' tickpolicy='{}'/>\n",
            timers.rtc_tick_policy
        ));
        
        // PIT timer
        xml.push_str(&format!(
            "    <timer name='pit' tickpolicy='{}'/>\n",
            timers.pit_tick_policy
        ));
        
        // HPET timer - CRITICAL: RHEL 9/Rocky 9 kernels panic if this is enabled!
        xml.push_str(&format!(
            "    <timer name='hpet' present='{}'/>\n",
            if timers.hpet_enabled { "yes" } else { "no" }
        ));
        
        // KVM clock for Linux guests
        if timers.kvmclock_enabled {
            xml.push_str("    <timer name='kvmclock' present='yes'/>\n");
        }
        
        // Hyper-V reference time counter for Windows guests
        if timers.hyperv_time_enabled {
            xml.push_str("    <timer name='hypervclock' present='yes'/>\n");
        }
        
        xml.push_str("  </clock>\n");
        xml
    }
    
    fn build_os_section(&self) -> String {
        match self.config.boot.firmware {
            Firmware::Bios => {
                let boot_devs: String = self.config.boot.order.iter()
                    .map(|d| format!("    <boot dev='{}'/>\n", d.as_str()))
                    .collect();
                    
                format!(
                    r#"  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
{}  </os>
"#,
                    boot_devs
                )
            }
            Firmware::Uefi => {
                format!(
                    r#"  <os>
    <type arch='x86_64' machine='q35'>hvm</type>
    <loader readonly='yes' type='pflash'>/usr/share/OVMF/OVMF_CODE.fd</loader>
    <nvram>/var/lib/libvirt/qemu/nvram/{}_VARS.fd</nvram>
  </os>
"#,
                    self.config.name
                )
            }
        }
    }
    
    fn build_cpu_section(&self) -> String {
        // Default to host-model for cluster compatibility (live migration, memory snapshots)
        // Users can override to host-passthrough for maximum performance
        let mode = self.config.cpu.model.as_deref().unwrap_or("host-model");
        
        // For host-passthrough and host-model modes, we pass through the host CPU
        // which provides maximum compatibility with modern Linux distributions
        // (Rocky Linux 9, CentOS 9, etc. require certain CPU features)
        match mode {
            "host-passthrough" => {
                // Best performance, passes through all host CPU features
                // Note: VMs cannot be live-migrated to hosts with different CPUs
                format!(
                    r#"  <cpu mode='host-passthrough' check='none' migratable='off'>
    <topology sockets='{}' cores='{}' threads='{}'/>
  </cpu>
"#,
                    self.config.cpu.sockets,
                    self.config.cpu.cores,
                    self.config.cpu.threads_per_core
                )
            }
            "host-model" => {
                // Good compatibility, uses host CPU model but allows migration
                format!(
                    r#"  <cpu mode='host-model' check='partial'>
    <topology sockets='{}' cores='{}' threads='{}'/>
  </cpu>
"#,
                    self.config.cpu.sockets,
                    self.config.cpu.cores,
                    self.config.cpu.threads_per_core
                )
            }
            "max" => {
                // Maximum features exposed, good for migration between similar hosts
                format!(
                    r#"  <cpu mode='maximum' check='partial' migratable='on'>
    <topology sockets='{}' cores='{}' threads='{}'/>
  </cpu>
"#,
                    self.config.cpu.sockets,
                    self.config.cpu.cores,
                    self.config.cpu.threads_per_core
                )
            }
            _ => {
                // Custom model (e.g., "qemu64", "Skylake-Server", etc.)
                format!(
                    r#"  <cpu mode='custom' match='exact' check='partial'>
    <model fallback='allow'>{}</model>
    <topology sockets='{}' cores='{}' threads='{}'/>
  </cpu>
"#,
                    mode,
                    self.config.cpu.sockets,
                    self.config.cpu.cores,
                    self.config.cpu.threads_per_core
                )
            }
        }
    }
    
    fn build_emulator(&self) -> String {
        "    <emulator>/usr/bin/qemu-system-x86_64</emulator>\n".to_string()
    }
    
    /// Build PCI controllers for hot-plug support.
    /// Adds PCIe root ports to allow hot-plugging NICs and other devices.
    fn build_pci_controllers(&self) -> String {
        let mut xml = String::new();
        
        // Add 4 PCIe root ports for hot-plug support (indices 10-13)
        // These provide slots for hot-plugging NICs, disks, etc.
        // We start at index 10 to avoid conflicts with libvirt's auto-generated controllers
        for i in 0..4 {
            let index = 10 + i;
            xml.push_str(&format!(
                r#"    <controller type='pci' index='{}' model='pcie-root-port'>
      <model name='pcie-root-port'/>
      <target chassis='{}' port='0x{:x}'/>
    </controller>
"#,
                index,
                index,
                index + 0x10
            ));
        }
        
        xml
    }
    
    fn build_disks(&self) -> String {
        let mut xml = String::new();
        
        for (i, disk) in self.config.disks.iter().enumerate() {
            let dev = format!("{}{}", disk.bus.device_prefix(), (b'a' + i as u8) as char);
            
            xml.push_str(&format!(
                r#"    <disk type='file' device='disk'>
      <driver name='qemu' type='{}' cache='{}' io='{}'/>
      <source file='{}'/>
      <target dev='{}' bus='{}'/>
{}    </disk>
"#,
                disk.format.as_str(),
                disk.cache.as_str(),
                disk.io_mode.as_str(),
                disk.path,
                dev,
                disk.bus.as_str(),
                if disk.readonly { "      <readonly/>\n" } else { "" }
            ));
        }
        
        xml
    }
    
    fn build_cdroms(&self) -> String {
        let mut xml = String::new();
        
        for (i, cdrom) in self.config.cdroms.iter().enumerate() {
            let dev = format!("sd{}", (b'a' + self.config.disks.len() as u8 + i as u8) as char);
            
            let source = cdrom.iso_path.as_ref()
                .map(|p| format!("      <source file='{}'/>\n", p))
                .unwrap_or_default();
            
            xml.push_str(&format!(
                r#"    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
{}      <target dev='{}' bus='sata'/>
      <readonly/>
    </disk>
"#,
                source,
                dev
            ));
        }
        
        xml
    }
    
    fn build_nics(&self) -> String {
        let mut xml = String::new();
        
        for nic in &self.config.nics {
            // Check if this is an OVN-managed interface
            if let Some(ovn_port_name) = &nic.ovn_port_name {
                // OVS/OVN interface with virtualport
                let bridge = nic.ovs_bridge.as_deref().unwrap_or("br-int");
                let mac = nic.mac_address.as_ref()
                    .map(|m| format!("      <mac address='{}'/>\n", m))
                    .unwrap_or_default();
                
                xml.push_str(&format!(
                    r#"    <interface type='bridge'>
      <source bridge='{}'/>
      <virtualport type='openvswitch'>
        <parameters interfaceid='{}'/>
      </virtualport>
{}      <model type='{}'/>
    </interface>
"#,
                    bridge,
                    ovn_port_name,
                    mac,
                    nic.model.as_str()
                ));
            } else {
                // Standard bridge or network interface
                let mac = nic.mac_address.as_ref()
                    .map(|m| format!("      <mac address='{}'/>\n", m))
                    .unwrap_or_default();
                
                let source = if let Some(bridge) = &nic.bridge {
                    format!("      <source bridge='{}'/>\n", bridge)
                } else if let Some(network) = &nic.network {
                    format!("      <source network='{}'/>\n", network)
                } else {
                    "      <source bridge='virbr0'/>\n".to_string()
                };
                
                let interface_type = if nic.bridge.is_some() { "bridge" } else { "network" };
                
                xml.push_str(&format!(
                    r#"    <interface type='{}'>
{}{}      <model type='{}'/>
    </interface>
"#,
                    interface_type,
                    mac,
                    source,
                    nic.model.as_str()
                ));
            }
        }
        
        xml
    }
    
    fn build_console(&self) -> String {
        r#"    <serial type='pty'>
      <target port='0'/>
    </serial>
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
"#.to_string()
    }
    
    fn build_graphics(&self) -> String {
        let mut xml = String::new();
        
        if self.config.console.vnc_enabled {
            let port = self.config.console.vnc_port
                .map(|p| p.to_string())
                .unwrap_or_else(|| "-1".to_string()); // -1 = auto-assign
            
            let passwd = self.config.console.vnc_password.as_ref()
                .map(|p| format!(" passwd='{}'", p))
                .unwrap_or_default();
            
            xml.push_str(&format!(
                "    <graphics type='vnc' port='{}' autoport='yes' listen='{}'{}>\n      <listen type='address' address='{}'/>\n    </graphics>\n",
                port,
                self.config.console.vnc_listen,
                passwd,
                self.config.console.vnc_listen
            ));
        }
        
        if self.config.console.spice_enabled {
            let port = self.config.console.spice_port
                .map(|p| p.to_string())
                .unwrap_or_else(|| "-1".to_string());
            
            xml.push_str(&format!(
                "    <graphics type='spice' port='{}' autoport='yes'/>\n",
                port
            ));
        }
        
        // Video device - use OS-specific model from profile
        // - VGA: Maximum compatibility (RHEL install, Windows install)
        // - QXL: Best for SPICE (Windows after drivers installed)
        // - virtio: Modern, high performance (requires driver)
        let video = &self.profile.video;
        xml.push_str(&format!(
            "    <video>\n      <model type='{}' vram='{}' heads='{}' primary='yes'/>\n    </video>\n",
            video.model,
            video.vram_kb,
            video.heads
        ));
        
        xml
    }
    
    fn build_channels(&self) -> String {
        let mut xml = String::new();
        
        // LimiQuantix Guest Agent channel
        // Creates a virtio-serial port that the guest agent can connect to
        let socket_path = format!("/var/run/quantix-kvm/vms/{}.agent.sock", self.config.id);
        xml.push_str(&format!(
            r#"    <channel type='unix'>
      <source mode='bind' path='{}'/>
      <target type='virtio' name='org.quantix.agent.0'/>
    </channel>
"#,
            socket_path
        ));
        
        // QEMU Guest Agent channel (for compatibility with qemu-ga)
        xml.push_str(r#"    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>
"#);
        
        xml
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_basic_xml_generation() {
        let config = VmConfig::new("test-vm")
            .with_cpu(4)
            .with_memory(4096)
            .with_disk(DiskConfig {
                path: "/var/lib/vms/test.qcow2".to_string(),
                ..Default::default()
            });
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        assert!(xml.contains("<name>test-vm</name>"));
        assert!(xml.contains("<memory unit='MiB'>4096</memory>"));
        assert!(xml.contains("<vcpu placement='static'>4</vcpu>"));
        assert!(xml.contains("/var/lib/vms/test.qcow2"));
    }
    
    #[test]
    fn test_uefi_firmware() {
        let mut config = VmConfig::new("uefi-vm");
        config.boot.firmware = Firmware::Uefi;
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        assert!(xml.contains("OVMF_CODE.fd"));
        assert!(xml.contains("nvram"));
    }
    
    #[test]
    fn test_cpu_host_passthrough_mode() {
        let config = VmConfig::new("cpu-test-vm");
        let xml = DomainXmlBuilder::new(&config).build();
        
        // Default should be host-passthrough with migratable='off'
        assert!(xml.contains("mode='host-passthrough'"));
        assert!(xml.contains("check='none'"));
        assert!(xml.contains("migratable='off'"));
    }
    
    #[test]
    fn test_cpu_host_model_mode() {
        let mut config = VmConfig::new("cpu-test-vm");
        config.cpu.model = Some("host-model".to_string());
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        assert!(xml.contains("mode='host-model'"));
        assert!(xml.contains("check='partial'"));
    }
    
    #[test]
    fn test_cpu_max_mode() {
        let mut config = VmConfig::new("cpu-test-vm");
        config.cpu.model = Some("max".to_string());
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        assert!(xml.contains("mode='maximum'"));
        assert!(xml.contains("migratable='on'"));
    }
    
    #[test]
    fn test_cpu_custom_model() {
        let mut config = VmConfig::new("cpu-test-vm");
        config.cpu.model = Some("Skylake-Server".to_string());
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        assert!(xml.contains("mode='custom'"));
        assert!(xml.contains("<model fallback='allow'>Skylake-Server</model>"));
    }
    
    #[test]
    fn test_ovs_nic_generation() {
        let config = VmConfig::new("ovn-vm")
            .with_nic(NicConfig {
                id: "nic-1".to_string(),
                mac_address: Some("fa:16:3e:aa:bb:cc".to_string()),
                bridge: None,
                network: None,
                model: NicModel::Virtio,
                ovn_port_name: Some("lsp-port-123".to_string()),
                ovs_bridge: Some("br-int".to_string()),
            });
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        // Verify OVS virtualport XML is generated
        assert!(xml.contains("type='bridge'"));
        assert!(xml.contains("source bridge='br-int'"));
        assert!(xml.contains("virtualport type='openvswitch'"));
        assert!(xml.contains("interfaceid='lsp-port-123'"));
        assert!(xml.contains("address='fa:16:3e:aa:bb:cc'"));
        assert!(xml.contains("type='virtio'"));
    }
    
    #[test]
    fn test_standard_nic_generation() {
        let config = VmConfig::new("std-vm")
            .with_nic(NicConfig {
                id: "nic-1".to_string(),
                mac_address: Some("52:54:00:12:34:56".to_string()),
                bridge: Some("virbr0".to_string()),
                network: None,
                model: NicModel::Virtio,
                ovn_port_name: None,
                ovs_bridge: None,
            });
        
        let xml = DomainXmlBuilder::new(&config).build();
        
        // Verify standard bridge interface is generated (no virtualport)
        assert!(xml.contains("source bridge='virbr0'"));
        assert!(!xml.contains("virtualport"));
        assert!(xml.contains("address='52:54:00:12:34:56'"));
    }
}

