//! System inventory handlers.
//!
//! Collects hardware and software inventory information.
//! Uses sysinfo crate and platform-specific commands.

use limiquantix_proto::agent::{
    agent_message, BiosInfo, CpuInfo, DiskInfo, GetHardwareInfoRequest, GetHardwareInfoResponse,
    GpuInfo, HardwareInfo, InstalledSoftware, ListInstalledSoftwareRequest,
    ListInstalledSoftwareResponse, MemoryInfo, NetworkAdapterInfo, OsInfo, PartitionInfo,
};
use prost_types::Timestamp;
use std::process::Stdio;
use sysinfo::{Disks, Networks, System};
use tokio::process::Command;
use tracing::{debug, info};

/// Handle a get hardware info request.
pub async fn handle_get_hardware_info(req: GetHardwareInfoRequest) -> agent_message::Payload {
    debug!(
        include_cpu_details = req.include_cpu_details,
        include_disk_details = req.include_disk_details,
        include_network_details = req.include_network_details,
        "Handling get hardware info request"
    );

    let mut sys = System::new_all();
    sys.refresh_all();

    // Collect CPU info
    let cpu = collect_cpu_info(&sys, req.include_cpu_details).await;

    // Collect memory info
    let memory = collect_memory_info(&sys).await;

    // Collect disk info
    let disks = collect_disk_info(req.include_disk_details).await;

    // Collect network adapter info
    let network_adapters = collect_network_info(req.include_network_details).await;

    // Collect BIOS info
    let bios = collect_bios_info().await;

    // Collect OS info
    let os = collect_os_info(&sys).await;

    // Collect GPU info
    let gpus = collect_gpu_info().await;

    let hardware = HardwareInfo {
        cpu: Some(cpu),
        memory: Some(memory),
        disks,
        network_adapters,
        bios: Some(bios),
        os: Some(os),
        gpus,
    };

    info!("Collected hardware info");

    agent_message::Payload::HardwareInfoResponse(GetHardwareInfoResponse {
        success: true,
        hardware: Some(hardware),
        error: String::new(),
    })
}

/// Handle a list installed software request.
pub async fn handle_list_installed_software(
    req: ListInstalledSoftwareRequest,
) -> agent_message::Payload {
    debug!(
        filter = %req.filter,
        max_entries = req.max_entries,
        "Handling list installed software request"
    );

    #[cfg(unix)]
    let software = list_installed_software_linux(&req).await;

    #[cfg(windows)]
    let software = list_installed_software_windows(&req).await;

    let total_count = software.len() as u32;

    info!(count = total_count, "Listed installed software");

    agent_message::Payload::ListInstalledSoftwareResponse(ListInstalledSoftwareResponse {
        success: true,
        software,
        error: String::new(),
        total_count,
    })
}

/// Collect CPU information.
async fn collect_cpu_info(sys: &System, include_details: bool) -> CpuInfo {
    let cpus = sys.cpus();
    let first_cpu = cpus.first();

    let model = first_cpu
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let vendor = first_cpu
        .map(|c| c.vendor_id().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let frequency_mhz = first_cpu.map(|c| c.frequency() as f64).unwrap_or(0.0);

    // Get physical core count
    let cores = sys.physical_core_count().unwrap_or(cpus.len()) as u32;
    let threads = cpus.len() as u32;

    // Get CPU flags if detailed info requested
    let flags = if include_details {
        get_cpu_flags().await
    } else {
        Vec::new()
    };

    // Get architecture
    let architecture = std::env::consts::ARCH.to_string();

    CpuInfo {
        model,
        cores,
        threads,
        frequency_mhz,
        architecture,
        flags,
        vendor,
        sockets: 1, // Hard to detect accurately
        l1_cache_bytes: 0,
        l2_cache_bytes: 0,
        l3_cache_bytes: 0,
    }
}

/// Get CPU flags/features.
async fn get_cpu_flags() -> Vec<String> {
    #[cfg(unix)]
    {
        let output = Command::new("cat")
            .arg("/proc/cpuinfo")
            .stdout(Stdio::piped())
            .output()
            .await;

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.starts_with("flags") || line.starts_with("Features") {
                    if let Some(flags_str) = line.split(':').nth(1) {
                        return flags_str
                            .split_whitespace()
                            .map(|s| s.to_string())
                            .collect();
                    }
                }
            }
        }
    }

    Vec::new()
}

/// Collect memory information.
async fn collect_memory_info(sys: &System) -> MemoryInfo {
    MemoryInfo {
        total_bytes: sys.total_memory(),
        available_bytes: sys.available_memory(),
        memory_type: String::new(), // Hard to detect
        speed_mhz: 0,
        dimm_count: 0,
    }
}

/// Collect disk information.
async fn collect_disk_info(_include_details: bool) -> Vec<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut disk_infos = Vec::new();

    for disk in disks.list() {
        let device = disk.name().to_string_lossy().to_string();
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let filesystem = disk.file_system().to_string_lossy().to_string();
        let total_bytes = disk.total_space();
        let used_bytes = total_bytes - disk.available_space();

        // Determine disk type
        let disk_type = match disk.kind() {
            sysinfo::DiskKind::SSD => "SSD".to_string(),
            sysinfo::DiskKind::HDD => "HDD".to_string(),
            _ => "Unknown".to_string(),
        };

        let is_virtual = device.contains("loop")
            || device.contains("ram")
            || device.contains("vd")
            || device.contains("xvd");

        let partition = PartitionInfo {
            device: device.clone(),
            mount_point: mount_point.clone(),
            filesystem: filesystem.clone(),
            size_bytes: total_bytes,
            used_bytes,
            label: String::new(),
        };

        disk_infos.push(DiskInfo {
            device,
            model: String::new(),
            serial: String::new(),
            size_bytes: total_bytes,
            disk_type,
            interface: String::new(),
            is_virtual,
            partitions: vec![partition],
        });
    }

    disk_infos
}

/// Collect network adapter information.
async fn collect_network_info(_include_details: bool) -> Vec<NetworkAdapterInfo> {
    let networks = Networks::new_with_refreshed_list();
    let mut adapters = Vec::new();

    for (name, _data) in networks.list() {
        let is_virtual = name.starts_with("veth")
            || name.starts_with("docker")
            || name.starts_with("br-")
            || name.starts_with("virbr")
            || name == "lo";

        let adapter_type = if name.starts_with("wl") || name.starts_with("wifi") {
            "wifi"
        } else if name.starts_with("eth") || name.starts_with("en") {
            "ethernet"
        } else if is_virtual {
            "virtual"
        } else {
            "unknown"
        };

        // Get MAC address
        let mac_address = get_mac_address(name).await.unwrap_or_default();

        adapters.push(NetworkAdapterInfo {
            name: name.clone(),
            mac_address,
            adapter_type: adapter_type.to_string(),
            speed_mbps: 0, // Hard to detect accurately
            is_virtual,
            driver: String::new(),
            pci_address: String::new(),
        });
    }

    adapters
}

/// Get MAC address for a network interface.
async fn get_mac_address(interface: &str) -> Option<String> {
    #[cfg(unix)]
    {
        let path = format!("/sys/class/net/{}/address", interface);
        tokio::fs::read_to_string(&path)
            .await
            .ok()
            .map(|s| s.trim().to_string())
    }

    #[cfg(windows)]
    {
        None // Would need Win32 API
    }
}

/// Collect BIOS information.
async fn collect_bios_info() -> BiosInfo {
    #[cfg(unix)]
    {
        let vendor = read_dmi_file("/sys/class/dmi/id/bios_vendor").await;
        let version = read_dmi_file("/sys/class/dmi/id/bios_version").await;
        let release_date = read_dmi_file("/sys/class/dmi/id/bios_date").await;
        let system_manufacturer = read_dmi_file("/sys/class/dmi/id/sys_vendor").await;
        let system_product = read_dmi_file("/sys/class/dmi/id/product_name").await;
        let system_serial = read_dmi_file("/sys/class/dmi/id/product_serial").await;
        let system_uuid = read_dmi_file("/sys/class/dmi/id/product_uuid").await;

        BiosInfo {
            vendor,
            version,
            release_date,
            system_manufacturer,
            system_product,
            system_serial,
            system_uuid,
        }
    }

    #[cfg(windows)]
    {
        // Would need WMI queries
        BiosInfo::default()
    }
}

/// Read a DMI file.
#[cfg(unix)]
async fn read_dmi_file(path: &str) -> String {
    tokio::fs::read_to_string(path)
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// Collect OS information.
async fn collect_os_info(_sys: &System) -> OsInfo {
    let name = System::name().unwrap_or_else(|| "Unknown".to_string());
    let version = System::os_version().unwrap_or_else(|| "Unknown".to_string());
    let kernel = System::kernel_version().unwrap_or_else(|| "Unknown".to_string());
    let architecture = std::env::consts::ARCH.to_string();
    let hostname = System::host_name().unwrap_or_else(|| "Unknown".to_string());

    let last_boot = {
        let boot_time = System::boot_time();
        if boot_time > 0 {
            Some(Timestamp {
                seconds: boot_time as i64,
                nanos: 0,
            })
        } else {
            None
        }
    };

    OsInfo {
        name,
        version,
        build: String::new(),
        kernel,
        architecture,
        install_date: None,
        last_boot,
        hostname,
        domain: String::new(),
    }
}

/// Collect GPU information.
async fn collect_gpu_info() -> Vec<GpuInfo> {
    let mut gpus = Vec::new();

    #[cfg(unix)]
    {
        // Try lspci for GPU info
        let output = Command::new("lspci")
            .args(["-v", "-nn"])
            .stdout(Stdio::piped())
            .output()
            .await;

        if let Ok(output) = output {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut current_gpu: Option<GpuInfo> = None;

            for line in stdout.lines() {
                if line.contains("VGA compatible controller")
                    || line.contains("3D controller")
                    || line.contains("Display controller")
                {
                    // Save previous GPU
                    if let Some(gpu) = current_gpu.take() {
                        gpus.push(gpu);
                    }

                    // Parse GPU name
                    let parts: Vec<&str> = line.splitn(2, ':').collect();
                    let pci_address = parts.first().unwrap_or(&"").trim().to_string();
                    let name = parts
                        .get(1)
                        .map(|s| s.trim().to_string())
                        .unwrap_or_default();

                    let vendor = if name.to_lowercase().contains("nvidia") {
                        "NVIDIA"
                    } else if name.to_lowercase().contains("amd")
                        || name.to_lowercase().contains("radeon")
                    {
                        "AMD"
                    } else if name.to_lowercase().contains("intel") {
                        "Intel"
                    } else {
                        "Unknown"
                    };

                    current_gpu = Some(GpuInfo {
                        name,
                        vendor: vendor.to_string(),
                        driver_version: String::new(),
                        vram_bytes: 0,
                        pci_address,
                    });
                }
            }

            // Don't forget the last GPU
            if let Some(gpu) = current_gpu {
                gpus.push(gpu);
            }
        }
    }

    gpus
}

/// List installed software on Linux.
#[cfg(unix)]
async fn list_installed_software_linux(req: &ListInstalledSoftwareRequest) -> Vec<InstalledSoftware> {
    let mut software = Vec::new();
    let max_entries = if req.max_entries > 0 {
        req.max_entries as usize
    } else {
        usize::MAX
    };

    // Try dpkg first (Debian/Ubuntu)
    if let Ok(output) = Command::new("dpkg-query")
        .args(["-W", "-f", "${Package}\t${Version}\t${Installed-Size}\n"])
        .stdout(Stdio::piped())
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if software.len() >= max_entries {
                    break;
                }

                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 2 {
                    let name = parts[0].to_string();
                    let version = parts[1].to_string();
                    let size_kb: u64 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

                    // Apply filter
                    if !req.filter.is_empty()
                        && !name.to_lowercase().contains(&req.filter.to_lowercase())
                    {
                        continue;
                    }

                    software.push(InstalledSoftware {
                        name,
                        version,
                        publisher: String::new(),
                        install_date: None,
                        size_bytes: size_kb * 1024,
                        package_type: "deb".to_string(),
                        architecture: String::new(),
                    });
                }
            }

            if !software.is_empty() {
                return software;
            }
        }
    }

    // Try rpm (RHEL/CentOS/Fedora)
    if let Ok(output) = Command::new("rpm")
        .args(["-qa", "--queryformat", "%{NAME}\t%{VERSION}\t%{SIZE}\n"])
        .stdout(Stdio::piped())
        .output()
        .await
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if software.len() >= max_entries {
                    break;
                }

                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 2 {
                    let name = parts[0].to_string();
                    let version = parts[1].to_string();
                    let size_bytes: u64 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

                    // Apply filter
                    if !req.filter.is_empty()
                        && !name.to_lowercase().contains(&req.filter.to_lowercase())
                    {
                        continue;
                    }

                    software.push(InstalledSoftware {
                        name,
                        version,
                        publisher: String::new(),
                        install_date: None,
                        size_bytes,
                        package_type: "rpm".to_string(),
                        architecture: String::new(),
                    });
                }
            }
        }
    }

    software
}

/// List installed software on Windows.
#[cfg(windows)]
async fn list_installed_software_windows(
    req: &ListInstalledSoftwareRequest,
) -> Vec<InstalledSoftware> {
    let mut software = Vec::new();
    let max_entries = if req.max_entries > 0 {
        req.max_entries as usize
    } else {
        usize::MAX
    };

    // Use PowerShell to query installed software
    let script = r#"
        Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* |
        Select-Object DisplayName, DisplayVersion, Publisher, InstallDate, EstimatedSize |
        Where-Object { $_.DisplayName -ne $null } |
        ConvertTo-Json -Compress
    "#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .stdout(Stdio::piped())
        .output()
        .await;

    if let Ok(output) = output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&stdout) {
                let items = if json.is_array() {
                    json.as_array().unwrap().clone()
                } else {
                    vec![json]
                };

                for item in items {
                    if software.len() >= max_entries {
                        break;
                    }

                    let name = item["DisplayName"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let version = item["DisplayVersion"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let publisher = item["Publisher"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string();
                    let size_kb = item["EstimatedSize"].as_u64().unwrap_or(0);

                    // Apply filter
                    if !req.filter.is_empty()
                        && !name.to_lowercase().contains(&req.filter.to_lowercase())
                    {
                        continue;
                    }

                    software.push(InstalledSoftware {
                        name,
                        version,
                        publisher,
                        install_date: None,
                        size_bytes: size_kb * 1024,
                        package_type: "msi".to_string(),
                        architecture: String::new(),
                    });
                }
            }
        }
    }

    software
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_collect_cpu_info() {
        let mut sys = System::new_all();
        sys.refresh_all();

        let cpu = collect_cpu_info(&sys, false).await;
        assert!(!cpu.model.is_empty());
        assert!(cpu.cores > 0);
        assert!(cpu.threads > 0);
    }

    #[tokio::test]
    async fn test_collect_os_info() {
        let mut sys = System::new_all();
        sys.refresh_all();

        let os = collect_os_info(&sys).await;
        assert!(!os.name.is_empty());
        assert!(!os.hostname.is_empty());
    }
}
