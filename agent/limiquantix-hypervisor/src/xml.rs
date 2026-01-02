//! XML generation utilities for libvirt domain definitions.

use crate::types::*;

/// Builder for libvirt domain XML.
pub struct DomainXmlBuilder<'a> {
    config: &'a VmConfig,
}

impl<'a> DomainXmlBuilder<'a> {
    /// Create a new XML builder for the given VM config.
    pub fn new(config: &'a VmConfig) -> Self {
        Self { config }
    }
    
    /// Build the domain XML string.
    pub fn build(&self) -> String {
        let mut xml = String::new();
        
        // Domain header
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
        
        // Features
        xml.push_str(r#"  <features>
    <acpi/>
    <apic/>
  </features>
"#);
        
        // CPU
        xml.push_str(&self.build_cpu_section());
        
        // Clock
        xml.push_str(r#"  <clock offset='utc'>
    <timer name='rtc' tickpolicy='catchup'/>
    <timer name='pit' tickpolicy='delay'/>
    <timer name='hpet' present='no'/>
  </clock>
"#);
        
        // Power management
        xml.push_str(r#"  <on_poweroff>destroy</on_poweroff>
  <on_reboot>restart</on_reboot>
  <on_crash>destroy</on_crash>
"#);
        
        // Devices
        xml.push_str("  <devices>\n");
        xml.push_str(&self.build_emulator());
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
        let model = self.config.cpu.model.as_deref().unwrap_or("host-passthrough");
        
        format!(
            r#"  <cpu mode='{}'>
    <topology sockets='{}' cores='{}' threads='{}'/>
  </cpu>
"#,
            model,
            self.config.cpu.sockets,
            self.config.cpu.cores,
            self.config.cpu.threads_per_core
        )
    }
    
    fn build_emulator(&self) -> String {
        "    <emulator>/usr/bin/qemu-system-x86_64</emulator>\n".to_string()
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
        
        // Video device
        xml.push_str(r#"    <video>
      <model type='virtio' heads='1' primary='yes'/>
    </video>
"#);
        
        xml
    }
    
    fn build_channels(&self) -> String {
        // Guest agent channel
        r#"    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
    </channel>
"#.to_string()
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
}

