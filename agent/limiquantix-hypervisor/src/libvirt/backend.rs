//! Libvirt backend implementation.

use async_trait::async_trait;
use std::time::Duration;
use tracing::{info, debug, warn, instrument};
use virt::connect::Connect;
use virt::domain::Domain;
use virt::sys;

use crate::error::{HypervisorError, Result};
use crate::traits::{Hypervisor, HypervisorCapabilities};
use crate::types::*;
use crate::xml::DomainXmlBuilder;

/// Libvirt/QEMU hypervisor backend.
///
/// This is the primary hypervisor backend for limiquantix, providing
/// full VM lifecycle management through libvirt.
pub struct LibvirtBackend {
    #[allow(dead_code)] // Stored for debugging/introspection
    uri: String,
    connection: Connect,
}

impl LibvirtBackend {
    /// Create a new libvirt backend connected to the specified URI.
    ///
    /// Common URIs:
    /// - `qemu:///system` - System-wide QEMU/KVM
    /// - `qemu:///session` - User session QEMU
    /// - `qemu+ssh://user@host/system` - Remote via SSH
    pub async fn new(uri: &str) -> Result<Self> {
        info!(uri = %uri, "Connecting to libvirt");
        
        let connection = Connect::open(Some(uri))
            .map_err(|e| HypervisorError::ConnectionFailed(e.to_string()))?;
        
        info!("Connected to libvirt");
        
        Ok(Self {
            uri: uri.to_string(),
            connection,
        })
    }
    
    /// Get a domain by UUID.
    fn get_domain(&self, vm_id: &str) -> Result<Domain> {
        Domain::lookup_by_uuid_string(&self.connection, vm_id)
            .map_err(|e| HypervisorError::VmNotFound(
                format!("{}: {}", vm_id, e)
            ))
    }
    
    /// Convert libvirt domain state to VmState.
    fn state_from_libvirt(state: sys::virDomainState) -> VmState {
        match state {
            sys::VIR_DOMAIN_RUNNING => VmState::Running,
            sys::VIR_DOMAIN_PAUSED => VmState::Paused,
            sys::VIR_DOMAIN_SHUTOFF => VmState::Stopped,
            sys::VIR_DOMAIN_CRASHED => VmState::Crashed,
            sys::VIR_DOMAIN_PMSUSPENDED => VmState::Suspended,
            _ => VmState::Unknown,
        }
    }
    
    /// Parse VNC port from libvirt domain XML.
    /// Looks for: <graphics type='vnc' port='5901' ...>
    fn parse_vnc_port_from_xml(&self, xml: &str) -> Option<u16> {
        // Find the graphics element with type='vnc'
        // Format: <graphics type='vnc' port='5901' autoport='yes' listen='127.0.0.1'>
        
        // First, find "<graphics type='vnc'"
        let graphics_start = xml.find("<graphics type='vnc'")?;
        let graphics_section = &xml[graphics_start..];
        
        // Find the end of this element (either /> or >)
        let graphics_end = graphics_section.find('>')?;
        let graphics_tag = &graphics_section[..graphics_end];
        
        // Now find port=' within this graphics tag
        let port_start = graphics_tag.find("port='")?;
        let port_value_start = port_start + 6; // Skip "port='"
        let port_str = &graphics_tag[port_value_start..];
        
        // Find the closing quote
        let port_end = port_str.find('\'')?;
        let port_value = &port_str[..port_end];
        
        // Parse the port number
        // Note: libvirt may return -1 for autoport before the VM starts
        if port_value == "-1" {
            debug!("VNC port is -1 (autoport), VM may not be running yet");
            return None;
        }
        
        port_value.parse::<u16>().ok()
    }
    
    /// Parse CPU mode from libvirt domain XML.
    /// Looks for: <cpu mode='host-passthrough'> or <cpu mode='host-model'>
    /// Returns "host-model" as default if not found.
    fn parse_cpu_mode_from_xml(&self, xml: &str) -> String {
        // Find the cpu element with mode attribute
        // Format: <cpu mode='host-passthrough' check='none' migratable='off'>
        // Or: <cpu mode='host-model' check='partial'>
        
        // First, find "<cpu "
        if let Some(cpu_start) = xml.find("<cpu ") {
            let cpu_section = &xml[cpu_start..];
            
            // Find the end of this element (either /> or >)
            if let Some(cpu_end) = cpu_section.find('>') {
                let cpu_tag = &cpu_section[..cpu_end];
                
                // Now find mode=' within this cpu tag
                if let Some(mode_start) = cpu_tag.find("mode='") {
                    let mode_value_start = mode_start + 6; // Skip "mode='"
                    let mode_str = &cpu_tag[mode_value_start..];
                    
                    // Find the closing quote
                    if let Some(mode_end) = mode_str.find('\'') {
                        return mode_str[..mode_end].to_string();
                    }
                }
            }
        }
        
        // Default to host-model if not found (for cluster compatibility)
        "host-model".to_string()
    }
    
    /// Get list of disk device names for a VM (e.g., ["vda", "vdb"])
    fn get_vm_disk_devices(&self, vm_id: &str) -> Result<Vec<String>> {
        // Use virsh domblklist to get disk devices
        let output = std::process::Command::new("virsh")
            .args(["domblklist", vm_id, "--details"])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("Failed to list disks: {}", e)))?;
        
        if !output.status.success() {
            // Return default if we can't list disks
            return Ok(vec!["vda".to_string()]);
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut devices = Vec::new();
        
        // Parse output: Type Device Target Source
        // Skip header lines
        for line in stdout.lines().skip(2) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                let device_type = parts[0];
                let target = parts[2];
                
                // Only include disk devices (not cdrom)
                if device_type == "file" || device_type == "block" {
                    // Target is like "vda", "vdb", etc.
                    if target.starts_with("vd") || target.starts_with("sd") || target.starts_with("hd") {
                        devices.push(target.to_string());
                    }
                }
            }
        }
        
        if devices.is_empty() {
            // Fallback to vda if parsing failed
            devices.push("vda".to_string());
        }
        
        debug!(vm_id = %vm_id, devices = ?devices, "Found disk devices");
        Ok(devices)
    }
    
    /// Find the next available PCIe root port index by parsing the domain XML.
    /// This is a helper method for attach_nic to add PCIe root ports on Q35 machines.
    fn find_next_root_port_index(&self, domain: &Domain) -> Result<u32> {
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        // Find all existing controller indices
        // Look for patterns like: <controller type='pci' index='X'
        let mut max_index: u32 = 0;
        for line in xml.lines() {
            if line.contains("<controller type='pci'") && line.contains("index='") {
                if let Some(start) = line.find("index='") {
                    let rest = &line[start + 7..];
                    if let Some(end) = rest.find('\'') {
                        if let Ok(idx) = rest[..end].parse::<u32>() {
                            max_index = max_index.max(idx);
                        }
                    }
                }
            }
        }
        
        // Return next available index (at least 10 to avoid conflicts with built-in controllers)
        Ok(max_index.max(9) + 1)
    }
}

#[async_trait]
impl Hypervisor for LibvirtBackend {
    #[instrument(skip(self))]
    async fn capabilities(&self) -> Result<HypervisorCapabilities> {
        let version = self.connection.get_lib_version()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        let major = (version / 1000000) as u32;
        let minor = ((version / 1000) % 1000) as u32;
        let micro = (version % 1000) as u32;
        
        Ok(HypervisorCapabilities {
            name: "libvirt/QEMU".to_string(),
            version: format!("{}.{}.{}", major, minor, micro),
            supports_live_migration: true,
            supports_snapshots: true,
            supports_hotplug: true,
            supports_gpu_passthrough: true,
            supports_nested_virtualization: true,
            max_vcpus: 512,
            max_memory_bytes: 16 * 1024 * 1024 * 1024 * 1024, // 16 TB
        })
    }
    
    #[instrument(skip(self))]
    async fn health_check(&self) -> Result<bool> {
        match self.connection.is_alive() {
            Ok(alive) => Ok(alive),
            Err(_) => Ok(false),
        }
    }
    
    #[instrument(skip(self, config), fields(vm_name = %config.name))]
    async fn create_vm(&self, config: VmConfig) -> Result<String> {
        info!(vm_id = %config.id, "Creating VM");
        
        // Build libvirt domain XML
        let xml = DomainXmlBuilder::new(&config).build();
        
        debug!(xml = %xml, "Generated domain XML");
        
        // Define the domain (persistent)
        let domain = Domain::define_xml(&self.connection, &xml)
            .map_err(|e| HypervisorError::CreateFailed(e.to_string()))?;
        
        let uuid = domain.get_uuid_string()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        info!(vm_id = %uuid, "VM created");
        
        Ok(uuid)
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn start_vm(&self, vm_id: &str) -> Result<()> {
        info!("Starting VM");
        
        let domain = self.get_domain(vm_id)?;
        
        // Check if already running
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        if state == sys::VIR_DOMAIN_RUNNING {
            info!("VM is already running");
            return Ok(());
        }
        
        domain.create()
            .map_err(|e| HypervisorError::StartFailed(e.to_string()))?;
        
        info!("VM started");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn stop_vm(&self, vm_id: &str, timeout: Duration) -> Result<()> {
        info!(timeout_secs = timeout.as_secs(), "Stopping VM gracefully");
        
        let domain = self.get_domain(vm_id)?;
        
        // Send ACPI shutdown
        domain.shutdown()
            .map_err(|e| HypervisorError::StopFailed(e.to_string()))?;
        
        // Wait for shutdown with timeout
        let start = std::time::Instant::now();
        while start.elapsed() < timeout {
            tokio::time::sleep(Duration::from_millis(500)).await;
            
            let (state, _) = domain.get_state()
                .map_err(|e| HypervisorError::Internal(e.to_string()))?;
            
            if state == sys::VIR_DOMAIN_SHUTOFF {
                info!("VM stopped gracefully");
                return Ok(());
            }
        }
        
        warn!("Graceful shutdown timed out");
        Err(HypervisorError::StopFailed(
            "Timeout waiting for graceful shutdown".to_string()
        ))
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn force_stop_vm(&self, vm_id: &str) -> Result<()> {
        info!("Force stopping VM");
        
        let domain = self.get_domain(vm_id)?;
        
        domain.destroy()
            .map_err(|e| HypervisorError::StopFailed(e.to_string()))?;
        
        info!("VM force stopped");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn reboot_vm(&self, vm_id: &str) -> Result<()> {
        info!("Rebooting VM");
        
        let domain = self.get_domain(vm_id)?;
        
        domain.reboot(sys::VIR_DOMAIN_REBOOT_DEFAULT)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        info!("VM rebooted");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn pause_vm(&self, vm_id: &str) -> Result<()> {
        info!("Pausing VM");
        
        let domain = self.get_domain(vm_id)?;
        
        domain.suspend()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        info!("VM paused");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn resume_vm(&self, vm_id: &str) -> Result<()> {
        info!("Resuming VM");
        
        let domain = self.get_domain(vm_id)?;
        
        domain.resume()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        info!("VM resumed");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn delete_vm(&self, vm_id: &str) -> Result<()> {
        info!("Deleting VM");
        
        let domain = self.get_domain(vm_id)?;
        
        // Check if running
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        if state == sys::VIR_DOMAIN_RUNNING || state == sys::VIR_DOMAIN_PAUSED {
            return Err(HypervisorError::DeleteFailed(
                "VM must be stopped before deletion".to_string()
            ));
        }
        
        // Get disk paths from XML BEFORE undefining the domain
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        let disks = parse_disks_from_xml(&xml);
        
        // Collect unique parent directories (VM folders) to clean up
        let mut vm_folders: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();
        
        // Delete disk files and collect their parent folders
        for disk in &disks {
            let disk_path = std::path::Path::new(&disk.path);
            
            if disk_path.exists() {
                info!(
                    vm_id = %vm_id,
                    disk_path = %disk.path,
                    "Deleting VM disk file"
                );
                
                if let Err(e) = std::fs::remove_file(disk_path) {
                    warn!(
                        vm_id = %vm_id,
                        disk_path = %disk.path,
                        error = %e,
                        "Failed to delete disk file"
                    );
                }
            }
            
            // Collect the parent directory (VM folder)
            if let Some(parent) = disk_path.parent() {
                // Only consider folders that look like VM folders (under a "vms" directory)
                // Pattern: .../vms/{VM_NAME}_{UUID_SHORT}/
                if let Some(grandparent) = parent.parent() {
                    if grandparent.file_name().map(|n| n == "vms").unwrap_or(false) {
                        vm_folders.insert(parent.to_path_buf());
                    }
                }
            }
        }
        
        // Undefine the domain
        domain.undefine()
            .map_err(|e| HypervisorError::DeleteFailed(
                e.to_string()
            ))?;
        
        // Clean up empty VM folders
        for folder in vm_folders {
            if folder.exists() {
                // Check if folder is empty or only contains files we expect (like cloud-init ISOs)
                let is_empty_or_cleanable = match std::fs::read_dir(&folder) {
                    Ok(entries) => {
                        let remaining: Vec<_> = entries
                            .filter_map(|e| e.ok())
                            .collect();
                        
                        if remaining.is_empty() {
                            true
                        } else {
                            // Check if only cloud-init or other auto-generated files remain
                            remaining.iter().all(|entry| {
                                let name = entry.file_name().to_string_lossy().to_string();
                                name.ends_with("-cloudinit.iso") || 
                                name.ends_with(".nvram") ||
                                name.ends_with(".log")
                            })
                        }
                    }
                    Err(_) => false,
                };
                
                if is_empty_or_cleanable {
                    info!(
                        vm_id = %vm_id,
                        folder = %folder.display(),
                        "Deleting VM folder"
                    );
                    
                    if let Err(e) = std::fs::remove_dir_all(&folder) {
                        warn!(
                            vm_id = %vm_id,
                            folder = %folder.display(),
                            error = %e,
                            "Failed to delete VM folder"
                        );
                    }
                } else {
                    debug!(
                        vm_id = %vm_id,
                        folder = %folder.display(),
                        "VM folder not empty, skipping deletion"
                    );
                }
            }
        }
        
        info!("VM deleted");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_vm_status(&self, vm_id: &str) -> Result<VmStatus> {
        let domain = self.get_domain(vm_id)?;
        
        let name = domain.get_name()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        let info = domain.get_info()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        Ok(VmStatus {
            id: vm_id.to_string(),
            name,
            state: Self::state_from_libvirt(state),
            cpu_time_ns: info.cpu_time,
            memory_rss_bytes: info.memory * 1024, // KiB to bytes
            memory_max_bytes: info.max_mem * 1024,
            disks: self.get_domain(vm_id)
                .and_then(|d| d.get_xml_desc(0).map_err(|e| HypervisorError::Internal(e.to_string())))
                .map(|xml| parse_disks_from_xml(&xml))
                .unwrap_or_default(),
        })
    }
    
    #[instrument(skip(self))]
    async fn list_vms(&self) -> Result<Vec<VmInfo>> {
        let flags = sys::VIR_CONNECT_LIST_DOMAINS_ACTIVE | 
                    sys::VIR_CONNECT_LIST_DOMAINS_INACTIVE;
        
        let domains = self.connection.list_all_domains(flags)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        let mut vms = Vec::with_capacity(domains.len());
        
        for domain in domains {
            let id = domain.get_uuid_string()
                .map_err(|e| HypervisorError::Internal(e.to_string()))?;
            
            let name = domain.get_name()
                .map_err(|e| HypervisorError::Internal(e.to_string()))?;
            
            let (state, _) = domain.get_state()
                .map_err(|e| HypervisorError::Internal(e.to_string()))?;
            
            vms.push(VmInfo {
                id,
                name,
                state: Self::state_from_libvirt(state),
            });
        }
        
        debug!(count = vms.len(), "Listed VMs");
        Ok(vms)
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn vm_exists(&self, vm_id: &str) -> Result<bool> {
        match Domain::lookup_by_uuid_string(&self.connection, vm_id) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_console(&self, vm_id: &str) -> Result<ConsoleInfo> {
        let domain = self.get_domain(vm_id)?;
        
        // Get domain XML to parse console info
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        // Parse VNC port from the <graphics type='vnc'> element
        // We need to find the graphics element with type='vnc' and extract its port
        let vnc_port = self.parse_vnc_port_from_xml(&xml).unwrap_or(5900);
        
        debug!(vm_id = %vm_id, vnc_port = vnc_port, "Parsed VNC port from domain XML");
        
        Ok(ConsoleInfo {
            console_type: ConsoleType::Vnc,
            host: "127.0.0.1".to_string(),
            port: vnc_port,
            password: None,
            websocket_path: None,
        })
    }
    
    #[instrument(skip(self, options), fields(vm_id = %vm_id, snapshot_name = %options.name))]
    async fn create_snapshot(&self, vm_id: &str, options: &CreateSnapshotOptions) -> Result<SnapshotInfo> {
        info!(
            vm_id = %vm_id,
            name = %options.name,
            include_memory = %options.include_memory,
            live = %options.live,
            quiesce = %options.quiesce,
            "Creating snapshot"
        );
        
        // Verify the domain exists
        let domain = self.get_domain(vm_id)?;
        
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        let is_running = matches!(state, sys::VIR_DOMAIN_RUNNING);
        
        // Detect CPU mode from VM XML to determine snapshot capabilities
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        let cpu_mode = self.parse_cpu_mode_from_xml(&xml);
        
        info!(
            cpu_mode = %cpu_mode,
            include_memory = %options.include_memory,
            is_running = %is_running,
            "Evaluating snapshot capability based on CPU mode"
        );
        
        // Memory snapshots are supported ONLY with host-model or other migratable CPU modes
        // host-passthrough uses invtsc which disables migration/memory snapshots
        let is_host_passthrough = cpu_mode == "host-passthrough";
        
        // If user requested memory snapshot with host-passthrough, return an error
        if options.include_memory && is_running && is_host_passthrough {
            return Err(HypervisorError::SnapshotFailed(
                "Memory snapshots are not supported with 'Quantix Performance' (host-passthrough) CPU mode. \
                This VM uses CPU features that prevent memory state capture. \
                \n\nOptions:\n\
                1. Create a disk-only snapshot (uncheck 'Include memory state')\n\
                2. Stop the VM first, then take a snapshot\n\
                3. Recreate the VM with 'Quantix Flexible' (host-model) CPU mode to enable memory snapshots".to_string()
            ));
        }
        
        // Use external snapshots with memory for host-model (supports migration)
        // Use disk-only for host-passthrough (doesn't support migration)
        let use_external = options.include_memory && is_running && !is_host_passthrough;
        
        // Create snapshot directory for external snapshots
        let snapshot_dir = format!("/var/lib/libvirt/snapshots/{}", vm_id);
        if use_external {
            std::fs::create_dir_all(&snapshot_dir)
                .map_err(|e| HypervisorError::SnapshotFailed(format!("Failed to create snapshot directory: {}", e)))?;
        }
        
        // Build memory file path for external snapshots
        let memory_file = if use_external {
            Some(format!("{}/{}.mem", snapshot_dir, options.name))
        } else {
            None
        };
        
        // Build virsh command
        // Note: The virt crate v0.4 doesn't expose snapshot_create_xml directly.
        // Using virsh fallback for full snapshot functionality.
        let mut args: Vec<String> = vec![
            "snapshot-create-as".to_string(),
            vm_id.to_string(),
            "--name".to_string(),
            options.name.clone(),
        ];
        
        // Add description if not empty
        if !options.description.is_empty() {
            args.push("--description".to_string());
            args.push(options.description.clone());
        }
        
        if use_external {
            // External snapshot with memory state (VMware vCenter-like)
            // This works with host-passthrough CPU because we use --live flag
            // which captures memory without requiring migration capability
            
            info!(
                memory_file = %memory_file.as_ref().unwrap(),
                "Using external snapshot with memory capture (--live mode)"
            );
            
            // Get disk devices to create diskspec entries
            let disk_devices = self.get_vm_disk_devices(vm_id)?;
            
            for disk in &disk_devices {
                // Create overlay file path
                let overlay_path = format!("{}/{}-{}.qcow2", snapshot_dir, options.name, disk);
                args.push("--diskspec".to_string());
                args.push(format!("{},snapshot=external,file={}", disk, overlay_path));
            }
            
            // Add memory spec for external memory capture
            args.push("--memspec".to_string());
            args.push(format!("file={},snapshot=external", memory_file.as_ref().unwrap()));
            
            // Use --live flag to keep VM running during snapshot
            // This is the key to VMware-like live snapshots
            if options.live {
                args.push("--live".to_string());
            }
        } else {
            // Not using external snapshot - use disk-only mode
            // This is REQUIRED for VMs with host-passthrough CPU (invtsc flag)
            // because internal snapshots with memory state require migration capability
            args.push("--disk-only".to_string());
            info!(
                include_memory = %options.include_memory,
                is_running = %is_running,
                use_external = %use_external,
                "Using disk-only snapshot mode (internal) - disk_only flag added"
            );
        }
        
        // Add quiesce flag if requested (requires guest agent)
        if options.quiesce && is_running {
            args.push("--quiesce".to_string());
            info!("Filesystem quiesce requested");
        }
        
        // Log the full command for debugging
        info!(
            command = %format!("virsh {}", args.join(" ")),
            "Executing snapshot command"
        );
        debug!(args = ?args, "Running virsh snapshot-create-as");
        
        let output = std::process::Command::new("virsh")
            .args(&args)
            .output()
            .map_err(|e| HypervisorError::SnapshotFailed(format!("virsh command failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            
            // Provide helpful error messages for common failures
            let error_msg = if stderr.contains("invtsc") || stderr.contains("non-migratable") {
                // This shouldn't happen with external snapshots, but just in case
                format!(
                    "Memory snapshot failed due to CPU configuration. \
                    The VM uses host-passthrough CPU which normally prevents memory snapshots. \
                    Try using external snapshot mode (include_memory=true with live=true). \
                    Original error: {}", 
                    stderr
                )
            } else if stderr.contains("quiesce") && stderr.contains("agent") {
                format!(
                    "Filesystem quiesce failed - guest agent may not be running. \
                    Try again without quiesce option. Original error: {}", 
                    stderr
                )
            } else {
                format!("virsh snapshot-create-as failed: {}", stderr)
            };
            
            return Err(HypervisorError::SnapshotFailed(error_msg));
        }
        
        // Get memory file size if created
        let memory_size_bytes = memory_file.as_ref().and_then(|path| {
            std::fs::metadata(path).ok().map(|m| m.len())
        });
        
        info!(
            snapshot = %options.name,
            snapshot_type = if use_external { "external" } else { "internal" },
            memory_included = %options.include_memory,
            memory_size_bytes = ?memory_size_bytes,
            "Snapshot created successfully"
        );
        
        Ok(SnapshotInfo {
            id: options.name.clone(),
            name: options.name.clone(),
            description: options.description.clone(),
            created_at: chrono::Utc::now(),
            vm_state: Self::state_from_libvirt(state),
            parent_id: None,
            snapshot_type: if use_external { SnapshotType::External } else { SnapshotType::Internal },
            memory_included: options.include_memory && (is_running || use_external),
            memory_file,
            memory_size_bytes,
        })
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, snapshot_id = %snapshot_id))]
    async fn revert_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
        info!("Reverting to snapshot");
        
        // Verify domain exists
        let _ = self.get_domain(vm_id)?;
        
        // Use virsh command as fallback since virt crate v0.4 doesn't expose snapshot methods
        let output = std::process::Command::new("virsh")
            .args(["snapshot-revert", vm_id, snapshot_id])
            .output()
            .map_err(|e| HypervisorError::SnapshotFailed(format!("virsh command failed: {}", e)))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::SnapshotFailed(format!("virsh snapshot-revert failed: {}", stderr)));
        }
        
        info!("Reverted to snapshot via virsh");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, snapshot_id = %snapshot_id))]
    async fn delete_snapshot(&self, vm_id: &str, snapshot_id: &str) -> Result<()> {
        info!("Deleting snapshot");
        
        // Verify domain exists
        let _ = self.get_domain(vm_id)?;
        
        // Check if this is an external snapshot by looking for external files
        let snapshot_dir = format!("/var/lib/libvirt/snapshots/{}", vm_id);
        let memory_file = format!("{}/{}.mem", snapshot_dir, snapshot_id);
        let is_external = std::path::Path::new(&memory_file).exists();
        
        if is_external {
            info!(snapshot_dir = %snapshot_dir, "Detected external snapshot, cleaning up files");
            
            // For external snapshots, we need to:
            // 1. Merge overlay disks back (blockcommit) - if VM is running
            // 2. Delete the memory file
            // 3. Delete the snapshot metadata
            
            // Get disk devices to find overlay files
            let disk_devices = self.get_vm_disk_devices(vm_id)?;
            
            // Try to merge each disk overlay (blockcommit)
            for disk in &disk_devices {
                let overlay_path = format!("{}/{}-{}.qcow2", snapshot_dir, snapshot_id, disk);
                if std::path::Path::new(&overlay_path).exists() {
                    info!(disk = %disk, overlay = %overlay_path, "Merging disk overlay");
                    
                    // blockcommit merges the overlay into the base image
                    let commit_output = std::process::Command::new("virsh")
                        .args(["blockcommit", vm_id, disk, "--active", "--pivot", "--wait"])
                        .output();
                    
                    match commit_output {
                        Ok(output) if output.status.success() => {
                            info!(disk = %disk, "Disk overlay merged successfully");
                            // Delete the overlay file after successful merge
                            if let Err(e) = std::fs::remove_file(&overlay_path) {
                                warn!(error = %e, path = %overlay_path, "Failed to delete overlay file");
                            }
                        }
                        Ok(output) => {
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            warn!(disk = %disk, error = %stderr, "blockcommit failed, trying direct delete");
                            // Try to delete the overlay file anyway
                            let _ = std::fs::remove_file(&overlay_path);
                        }
                        Err(e) => {
                            warn!(disk = %disk, error = %e, "blockcommit command failed");
                        }
                    }
                }
            }
            
            // Delete memory file
            if std::path::Path::new(&memory_file).exists() {
                match std::fs::remove_file(&memory_file) {
                    Ok(_) => info!(path = %memory_file, "Memory file deleted"),
                    Err(e) => warn!(error = %e, path = %memory_file, "Failed to delete memory file"),
                }
            }
            
            // Delete snapshot metadata (--metadata only for external snapshots)
            let output = std::process::Command::new("virsh")
                .args(["snapshot-delete", vm_id, snapshot_id, "--metadata"])
                .output()
                .map_err(|e| HypervisorError::SnapshotFailed(format!("virsh command failed: {}", e)))?;
            
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                // Don't fail if metadata already gone
                if !stderr.contains("not found") {
                    warn!(error = %stderr, "Failed to delete snapshot metadata");
                }
            }
            
            // Try to clean up empty snapshot directory
            if let Ok(entries) = std::fs::read_dir(&snapshot_dir) {
                if entries.count() == 0 {
                    let _ = std::fs::remove_dir(&snapshot_dir);
                }
            }
        } else {
            // Internal snapshot - simple delete
            let output = std::process::Command::new("virsh")
                .args(["snapshot-delete", vm_id, snapshot_id])
                .output()
                .map_err(|e| HypervisorError::SnapshotFailed(format!("virsh command failed: {}", e)))?;
            
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(HypervisorError::SnapshotFailed(format!("virsh snapshot-delete failed: {}", stderr)));
            }
        }
        
        info!("Snapshot deleted successfully");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn list_snapshots(&self, vm_id: &str) -> Result<Vec<SnapshotInfo>> {
        // Verify domain exists
        let domain = self.get_domain(vm_id)?;
        
        let (state, _) = domain.get_state()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        // Use virsh command to list snapshots
        let output = std::process::Command::new("virsh")
            .args(["snapshot-list", vm_id, "--name"])
            .output()
            .map_err(|e| HypervisorError::Internal(format!("virsh command failed: {}", e)))?;
        
        if !output.status.success() {
            // No snapshots or error - return empty list
            return Ok(Vec::new());
        }
        
        let snapshot_dir = format!("/var/lib/libvirt/snapshots/{}", vm_id);
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        let result: Vec<SnapshotInfo> = stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|snapshot_name| {
                let snapshot_name = snapshot_name.trim();
                
                // Check if this is an external snapshot by looking for memory file
                let memory_file_path = format!("{}/{}.mem", snapshot_dir, snapshot_name);
                let memory_file_exists = std::path::Path::new(&memory_file_path).exists();
                let memory_size = if memory_file_exists {
                    std::fs::metadata(&memory_file_path).ok().map(|m| m.len())
                } else {
                    None
                };
                
                SnapshotInfo {
                    id: snapshot_name.to_string(),
                    name: snapshot_name.to_string(),
                    description: String::new(),
                    created_at: chrono::Utc::now(),
                    vm_state: Self::state_from_libvirt(state),
                    parent_id: None,
                    snapshot_type: if memory_file_exists { SnapshotType::External } else { SnapshotType::Internal },
                    memory_included: memory_file_exists,
                    memory_file: if memory_file_exists { Some(memory_file_path) } else { None },
                    memory_size_bytes: memory_size,
                }
            })
            .collect();
        
        Ok(result)
    }
    
    #[instrument(skip(self, disk), fields(vm_id = %vm_id, disk_id = %disk.id))]
    async fn attach_disk(&self, vm_id: &str, disk: DiskConfig) -> Result<()> {
        info!("Attaching disk");
        
        let domain = self.get_domain(vm_id)?;
        
        // Build disk XML
        let disk_xml = format!(
            r#"<disk type='file' device='disk'>
                <driver name='qemu' type='{}' cache='{}'/>
                <source file='{}'/>
                <target dev='{}a' bus='{}'/>
            </disk>"#,
            disk.format.as_str(),
            disk.cache.as_str(),
            disk.path,
            disk.bus.device_prefix(),
            disk.bus.as_str()
        );
        
        domain.attach_device(&disk_xml)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        info!("Disk attached");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, disk_id = %disk_id))]
    async fn detach_disk(&self, vm_id: &str, disk_id: &str) -> Result<()> {
        info!("Detaching disk");
        
        let domain = self.get_domain(vm_id)?;
        
        // Get current domain XML to find the disk
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        // Find and extract the disk element (simplified)
        // In production, use proper XML parsing
        let _ = (xml, disk_id); // Suppress unused warning
        
        warn!("Disk detach not fully implemented - would need XML parsing");
        
        Ok(())
    }
    
    #[instrument(skip(self, nic), fields(vm_id = %vm_id, nic_id = %nic.id))]
    async fn attach_nic(&self, vm_id: &str, nic: NicConfig) -> Result<()> {
        info!("Attaching NIC");
        
        let domain = self.get_domain(vm_id)?;
        
        let mac = nic.mac_address.unwrap_or_else(|| generate_mac_address());
        let source = if let Some(ref bridge) = nic.bridge {
            format!("<source bridge='{}'/>", bridge)
        } else if let Some(ref network) = nic.network {
            format!("<source network='{}'/>", network)
        } else {
            return Err(HypervisorError::InvalidConfig(
                "NIC must have either bridge or network".to_string()
            ));
        };
        
        // First, try to add a PCIe root port to provide a slot for the NIC
        // This is needed because Q35 machines have limited built-in PCI slots
        // We'll try to add a root port, and if it fails (already exists or not supported), continue anyway
        let root_port_index = self.find_next_root_port_index(&domain)?;
        let root_port_xml = format!(
            r#"<controller type='pci' index='{}' model='pcie-root-port'>
                <model name='pcie-root-port'/>
                <target chassis='{}' port='0x{:x}'/>
            </controller>"#,
            root_port_index,
            root_port_index,
            root_port_index + 0x10
        );
        
        // Try to add the root port (ignore errors - it may already exist or not be needed)
        match domain.attach_device(&root_port_xml) {
            Ok(_) => info!(index = root_port_index, "Added PCIe root port for NIC"),
            Err(e) => debug!(error = %e, "Could not add PCIe root port (may already exist)"),
        }
        
        let nic_xml = format!(
            r#"<interface type='{}'>
                {}
                <mac address='{}'/>
                <model type='{}'/>
            </interface>"#,
            if nic.bridge.is_some() { "bridge" } else { "network" },
            source,
            mac,
            nic.model.as_str()
        );
        
        domain.attach_device(&nic_xml)
            .map_err(|e| HypervisorError::Internal(format!("Failed to attach NIC: {}", e)))?;
        
        info!("NIC attached");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, nic_id = %nic_id))]
    async fn detach_nic(&self, vm_id: &str, nic_id: &str) -> Result<()> {
        info!("Detaching NIC");
        
        let domain = self.get_domain(vm_id)?;
        
        // Get current domain XML to find the NIC
        let xml = domain.get_xml_desc(0)
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        let _ = (xml, nic_id); // Suppress unused warning
        
        warn!("NIC detach not fully implemented - would need XML parsing");
        
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, device = %device))]
    async fn change_media(&self, vm_id: &str, device: &str, iso_path: Option<&str>) -> Result<()> {
        let domain = self.get_domain(vm_id)?;
        
        // Build the CD-ROM XML for the media change
        // The device is typically "hda", "hdb", "sda", etc. or the target dev name
        let cdrom_xml = if let Some(path) = iso_path {
            info!(iso_path = %path, "Mounting ISO to CD-ROM");
            format!(
                r#"<disk type='file' device='cdrom'>
                    <driver name='qemu' type='raw'/>
                    <source file='{}'/>
                    <target dev='{}' bus='sata'/>
                    <readonly/>
                </disk>"#,
                path,
                device
            )
        } else {
            info!("Ejecting CD-ROM media");
            format!(
                r#"<disk type='file' device='cdrom'>
                    <driver name='qemu' type='raw'/>
                    <target dev='{}' bus='sata'/>
                    <readonly/>
                </disk>"#,
                device
            )
        };
        
        // Use update_device to change the media
        // VIR_DOMAIN_DEVICE_MODIFY_LIVE = 1, VIR_DOMAIN_DEVICE_MODIFY_CONFIG = 2
        // We want both: live change + persist to config
        let flags = sys::VIR_DOMAIN_DEVICE_MODIFY_LIVE | sys::VIR_DOMAIN_DEVICE_MODIFY_CONFIG;
        
        domain.update_device_flags(&cdrom_xml, flags)
            .map_err(|e| HypervisorError::Internal(format!("Failed to change media: {}", e)))?;
        
        if iso_path.is_some() {
            info!("ISO mounted successfully");
        } else {
            info!("CD-ROM ejected successfully");
        }
        
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id, target = %target_uri))]
    async fn migrate_vm(&self, vm_id: &str, target_uri: &str, live: bool) -> Result<()> {
        info!(live = live, "Migrating VM");
        
        let domain = self.get_domain(vm_id)?;
        
        let flags = if live {
            sys::VIR_MIGRATE_LIVE | sys::VIR_MIGRATE_PERSIST_DEST
        } else {
            sys::VIR_MIGRATE_PERSIST_DEST
        };
        
        // Connect to target
        let target_conn = Connect::open(Some(target_uri))
            .map_err(|e| HypervisorError::MigrationFailed(
                format!("Failed to connect to target: {}", e)
            ))?;
        
        domain.migrate(&target_conn, flags, None, None, 0)
            .map_err(|e| HypervisorError::MigrationFailed(e.to_string()))?;
        
        info!("VM migrated successfully");
        Ok(())
    }
    
    #[instrument(skip(self), fields(vm_id = %vm_id))]
    async fn get_vm_metrics(&self, vm_id: &str) -> Result<VmMetrics> {
        let domain = self.get_domain(vm_id)?;
        
        let info = domain.get_info()
            .map_err(|e| HypervisorError::Internal(e.to_string()))?;
        
        // Get block stats (if available) - use get_block_stats in virt crate
        // The virt crate returns i64 values directly, not Option<i64>
        let (disk_read, disk_write) = domain.get_block_stats("vda")
            .map(|stats| {
                let rd = if stats.rd_bytes >= 0 { stats.rd_bytes as u64 } else { 0 };
                let wr = if stats.wr_bytes >= 0 { stats.wr_bytes as u64 } else { 0 };
                (rd, wr)
            })
            .unwrap_or((0, 0));
        
        // Get interface stats (if available)
        let (net_rx, net_tx) = domain.interface_stats("eth0")
            .map(|stats| (stats.rx_bytes as u64, stats.tx_bytes as u64))
            .unwrap_or((0, 0));
        
        Ok(VmMetrics {
            vm_id: vm_id.to_string(),
            cpu_usage_percent: 0.0, // Would need to calculate from cpu_time delta
            memory_used_bytes: info.memory * 1024,
            memory_total_bytes: info.max_mem * 1024,
            disk_read_bytes: disk_read,
            disk_write_bytes: disk_write,
            network_rx_bytes: net_rx,
            network_tx_bytes: net_tx,
        })
    }
}

/// Generate a random MAC address with the locally administered bit set.
fn generate_mac_address() -> String {
    let bytes: [u8; 6] = rand::random();
    format!(
        "52:54:00:{:02x}:{:02x}:{:02x}",
        bytes[0] & 0x3f, // Clear multicast bit, set local bit
        bytes[1],
        bytes[2]
    )
}

fn parse_disks_from_xml(xml: &str) -> Vec<DiskConfig> {
    let mut disks = Vec::new();
    
    // Very basic XML parsing - strictly purely for the specific format we generate
    // In production this should use a proper XML parser
    let parts: Vec<&str> = xml.split("<disk ").collect();
    
    for part in parts.iter().skip(1) {
        // Only care about actual disks, not cdroms
        if !part.starts_with("type='file' device='disk'") {
            continue;
        }
        
        // Extract path
        let path = if let Some(start) = part.find("source file='") {
            let rest = &part[start + 13..];
            if let Some(end) = rest.find('\'') {
                rest[..end].to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        
        // Extract dev
        let dev = if let Some(start) = part.find("target dev='") {
            let rest = &part[start + 12..];
            if let Some(end) = rest.find('\'') {
                rest[..end].to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        
        // Extract bus
        let bus = if let Some(start) = part.find("bus='") {
            let rest = &part[start + 5..];
            if let Some(end) = rest.find('\'') {
                match &rest[..end] {
                    "scsi" => DiskBus::Scsi,
                    "sata" => DiskBus::Sata,
                    "ide" => DiskBus::Ide,
                    _ => DiskBus::Virtio,
                }
            } else {
                DiskBus::Virtio
            }
        } else {
            DiskBus::Virtio
        };
        
        // Extract format
        let format = if let Some(start) = part.find("driver name='qemu' type='") {
            let rest = &part[start + 25..];
            if let Some(end) = rest.find('\'') {
                match &rest[..end] {
                    "raw" => DiskFormat::Raw,
                    "vmdk" => DiskFormat::Vmdk,
                    _ => DiskFormat::Qcow2,
                }
            } else {
                DiskFormat::Qcow2
            }
        } else {
            DiskFormat::Qcow2
        };
        
        if !path.is_empty() {
            disks.push(DiskConfig {
                id: dev.clone(), // Use device name as ID (e.g., vda)
                path,
                size_gib: 0, // We can't easily get size from XML, would need block stats or file check
                bus,
                format,
                readonly: part.contains("<readonly/>"),
                bootable: false, // Hard to tell from just disk block
                cache: DiskCache::None, // Default
                io_mode: DiskIoMode::Native, // Default
                backing_file: None, // Would need to parse backing store from XML
            });
        }
    }
    
    disks
}

