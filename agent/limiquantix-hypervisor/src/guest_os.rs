//! Guest OS Profile system for OS-specific virtual hardware configuration.
//!
//! This module implements VMware-style Guest OS profiles that automatically
//! configure timers, video, CPU, and other hardware settings based on the
//! target operating system.
//!
//! ## Why This Matters
//!
//! Different operating systems have different expectations for virtual hardware:
//! - RHEL 9/Rocky Linux: Strict kernel that panics with certain timer configurations
//! - Windows 11: Requires TPM 2.0, Secure Boot, and Hyper-V enlightenments
//! - Legacy Windows: Needs IDE/SATA for driver compatibility during install
//!
//! ## Usage
//!
//! ```rust
//! use limiquantix_hypervisor::guest_os::{GuestOSFamily, GuestOSProfile};
//!
//! let profile = GuestOSProfile::for_family(GuestOSFamily::Rhel);
//! println!("HPET enabled: {}", profile.timers.hpet_enabled);
//! ```

use serde::{Deserialize, Serialize};

/// Guest OS Family - major categories with distinct hardware requirements.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum GuestOSFamily {
    /// Unspecified - use generic Linux defaults
    #[default]
    Unspecified,
    
    // Linux variants
    /// RHEL, Rocky, AlmaLinux, CentOS - strict kernel, sensitive to timers
    Rhel,
    /// Debian, Ubuntu, Mint - flexible, good virtio support
    Debian,
    /// SLES, openSUSE
    Suse,
    /// Arch, Manjaro - cutting edge
    Arch,
    /// Fedora - cutting edge, RHEL upstream
    Fedora,
    /// Other Linux distributions
    GenericLinux,
    
    // Windows variants
    /// Windows Server 2016/2019/2022
    WindowsServer,
    /// Windows 10/11
    WindowsDesktop,
    /// Windows 7/8/8.1 (legacy)
    WindowsLegacy,
    
    // BSD variants
    FreeBsd,
    OpenBsd,
    NetBsd,
    
    // Other
    MacOs,
    Solaris,
    Other,
}

impl GuestOSFamily {
    /// Parse from string (for API/config).
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "rhel" | "rocky" | "rockylinux" | "almalinux" | "centos" | "oracle" => Self::Rhel,
            "debian" | "ubuntu" | "mint" | "pop" | "elementary" => Self::Debian,
            "suse" | "sles" | "opensuse" => Self::Suse,
            "arch" | "manjaro" | "endeavouros" => Self::Arch,
            "fedora" => Self::Fedora,
            "linux" | "generic_linux" => Self::GenericLinux,
            "windows_server" | "windowsserver" | "winserver" => Self::WindowsServer,
            "windows" | "windows_desktop" | "win10" | "win11" => Self::WindowsDesktop,
            "windows_legacy" | "win7" | "win8" => Self::WindowsLegacy,
            "freebsd" => Self::FreeBsd,
            "openbsd" => Self::OpenBsd,
            "netbsd" => Self::NetBsd,
            "macos" | "darwin" => Self::MacOs,
            "solaris" | "illumos" => Self::Solaris,
            _ => Self::Unspecified,
        }
    }
    
    /// Convert from proto enum value.
    pub fn from_proto(value: i32) -> Self {
        match value {
            1 => Self::Rhel,
            2 => Self::Debian,
            3 => Self::Suse,
            4 => Self::Arch,
            5 => Self::Fedora,
            6 => Self::GenericLinux,
            10 => Self::WindowsServer,
            11 => Self::WindowsDesktop,
            12 => Self::WindowsLegacy,
            20 => Self::FreeBsd,
            21 => Self::OpenBsd,
            22 => Self::NetBsd,
            30 => Self::MacOs,
            31 => Self::Solaris,
            99 => Self::Other,
            _ => Self::Unspecified,
        }
    }
    
    /// Convert to proto enum value.
    pub fn to_proto(&self) -> i32 {
        match self {
            Self::Unspecified => 0,
            Self::Rhel => 1,
            Self::Debian => 2,
            Self::Suse => 3,
            Self::Arch => 4,
            Self::Fedora => 5,
            Self::GenericLinux => 6,
            Self::WindowsServer => 10,
            Self::WindowsDesktop => 11,
            Self::WindowsLegacy => 12,
            Self::FreeBsd => 20,
            Self::OpenBsd => 21,
            Self::NetBsd => 22,
            Self::MacOs => 30,
            Self::Solaris => 31,
            Self::Other => 99,
        }
    }
    
    /// Is this a Windows OS family?
    pub fn is_windows(&self) -> bool {
        matches!(self, Self::WindowsServer | Self::WindowsDesktop | Self::WindowsLegacy)
    }
    
    /// Is this a Linux OS family?
    pub fn is_linux(&self) -> bool {
        matches!(
            self,
            Self::Rhel | Self::Debian | Self::Suse | Self::Arch | Self::Fedora | Self::GenericLinux
        )
    }
    
    /// Is this a BSD OS family?
    pub fn is_bsd(&self) -> bool {
        matches!(self, Self::FreeBsd | Self::OpenBsd | Self::NetBsd)
    }
}

/// Timer configuration for the guest OS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerConfig {
    /// Enable High Precision Event Timer (HPET).
    /// - RHEL 9+: Should be DISABLED (causes kernel panics)
    /// - Windows: Should be ENABLED for accurate timing
    pub hpet_enabled: bool,
    
    /// Enable KVM paravirtualized clock.
    /// - Linux: Should be ENABLED for best timekeeping
    /// - Windows: Not needed (uses Hyper-V timers instead)
    pub kvmclock_enabled: bool,
    
    /// Enable Hyper-V reference time counter.
    /// - Windows: Should be ENABLED for best performance
    /// - Linux: Not needed
    pub hyperv_time_enabled: bool,
    
    /// RTC (Real-Time Clock) tick policy.
    /// - "catchup": Try to catch up missed ticks (good for guests)
    /// - "delay": Delay delivery (may cause time drift)
    pub rtc_tick_policy: String,
    
    /// PIT (Programmable Interval Timer) tick policy.
    pub pit_tick_policy: String,
}

impl Default for TimerConfig {
    fn default() -> Self {
        Self {
            hpet_enabled: false,  // Safe default for RHEL
            kvmclock_enabled: true,
            hyperv_time_enabled: false,
            rtc_tick_policy: "catchup".to_string(),
            pit_tick_policy: "delay".to_string(),
        }
    }
}

/// Video/display configuration for the guest OS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoConfig {
    /// Video model type.
    /// - "vga": Maximum compatibility (RHEL, Windows install)
    /// - "qxl": Best for SPICE (Linux desktop)
    /// - "virtio": Modern, high performance (requires driver)
    /// - "cirrus": Legacy compatibility
    pub model: String,
    
    /// Video RAM in KB.
    pub vram_kb: u32,
    
    /// Number of display heads.
    pub heads: u32,
    
    /// Enable 3D acceleration (requires virtio-gpu).
    pub accel_3d: bool,
}

impl Default for VideoConfig {
    fn default() -> Self {
        Self {
            model: "vga".to_string(),
            vram_kb: 16384,
            heads: 1,
            accel_3d: false,
        }
    }
}

/// CPU configuration based on guest OS.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuProfile {
    /// CPU mode for libvirt.
    /// - "host-passthrough": Best performance, all host features
    /// - "host-model": Good compatibility, allows migration
    /// - "custom": Specific CPU model (e.g., "Skylake-Server")
    pub mode: String,
    
    /// Whether to enable nested virtualization.
    pub nested_virt: bool,
    
    /// Hyper-V enlightenments for Windows guests.
    pub hyperv_features: HypervFeatures,
}

impl Default for CpuProfile {
    fn default() -> Self {
        Self {
            mode: "host-passthrough".to_string(),
            nested_virt: false,
            hyperv_features: HypervFeatures::default(),
        }
    }
}

/// Hyper-V enlightenments for Windows guests.
/// These make Windows run faster in KVM by using paravirtualized interfaces.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HypervFeatures {
    /// Enable Hyper-V features (master switch).
    pub enabled: bool,
    
    /// Relaxed timing (reduces timer interrupts).
    pub relaxed: bool,
    
    /// Virtual APIC (faster interrupt delivery).
    pub vapic: bool,
    
    /// Synthetic interrupt controller.
    pub spinlocks: bool,
    
    /// Number of spinlock retries.
    pub spinlock_retries: u32,
    
    /// VP index MSR.
    pub vpindex: bool,
    
    /// Runtime MSR.
    pub runtime: bool,
    
    /// Synthetic timers.
    pub synic: bool,
    
    /// Stimers (synthetic timers).
    pub stimer: bool,
    
    /// Reset via MSR.
    pub reset: bool,
    
    /// Frequencies MSR.
    pub frequencies: bool,
    
    /// Reference time counter.
    pub reftime: bool,
    
    /// TLB flush hypercalls.
    pub tlbflush: bool,
    
    /// IPI hypercalls.
    pub ipi: bool,
}

/// Disk controller configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskProfile {
    /// Default disk bus type.
    /// - "virtio": Best performance (requires driver)
    /// - "scsi": Good compatibility with virtio-scsi
    /// - "sata": Safe for Windows install (has inbox driver)
    /// - "ide": Legacy (slow, limited to 4 disks)
    pub default_bus: String,
    
    /// Default cache mode.
    /// - "none": Best for direct I/O (clustered filesystems)
    /// - "writeback": Best performance (data loss risk on crash)
    /// - "writethrough": Safe (slower)
    pub default_cache: String,
    
    /// Default I/O mode.
    /// - "native": Use native AIO
    /// - "threads": Use thread pool
    pub default_io: String,
}

impl Default for DiskProfile {
    fn default() -> Self {
        Self {
            default_bus: "virtio".to_string(),
            default_cache: "none".to_string(),
            default_io: "native".to_string(),
        }
    }
}

/// Network interface configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkProfile {
    /// Default NIC model.
    /// - "virtio": Best performance (requires driver)
    /// - "e1000e": Good Windows compatibility
    /// - "e1000": Legacy Intel emulation
    /// - "rtl8139": Very old, avoid if possible
    pub default_model: String,
}

impl Default for NetworkProfile {
    fn default() -> Self {
        Self {
            default_model: "virtio".to_string(),
        }
    }
}

/// Platform requirements (TPM, Secure Boot, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlatformRequirements {
    /// Require TPM 2.0 (Windows 11).
    pub tpm_required: bool,
    
    /// Require UEFI Secure Boot (Windows 11).
    pub secure_boot_required: bool,
    
    /// Minimum memory in MiB.
    pub min_memory_mib: u64,
    
    /// Minimum vCPUs.
    pub min_vcpus: u32,
}

/// Complete Guest OS Profile with all settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuestOSProfile {
    /// The OS family this profile is for.
    pub family: GuestOSFamily,
    
    /// Optional variant (e.g., "rocky-9", "ubuntu-22.04").
    pub variant: Option<String>,
    
    /// Timer configuration.
    pub timers: TimerConfig,
    
    /// Video configuration.
    pub video: VideoConfig,
    
    /// CPU configuration.
    pub cpu: CpuProfile,
    
    /// Disk configuration.
    pub disk: DiskProfile,
    
    /// Network configuration.
    pub network: NetworkProfile,
    
    /// Platform requirements.
    pub platform: PlatformRequirements,
    
    /// Machine type (q35 recommended for modern OSes).
    pub machine_type: String,
    
    /// Recommended firmware type.
    pub firmware: String,
}

impl GuestOSProfile {
    /// Get the default profile for an OS family.
    pub fn for_family(family: GuestOSFamily) -> Self {
        match family {
            GuestOSFamily::Rhel | GuestOSFamily::Fedora => Self::rhel_profile(family),
            GuestOSFamily::Debian => Self::debian_profile(),
            GuestOSFamily::Suse => Self::suse_profile(),
            GuestOSFamily::Arch => Self::arch_profile(),
            GuestOSFamily::WindowsServer => Self::windows_server_profile(),
            GuestOSFamily::WindowsDesktop => Self::windows_desktop_profile(),
            GuestOSFamily::WindowsLegacy => Self::windows_legacy_profile(),
            GuestOSFamily::FreeBsd => Self::freebsd_profile(),
            GuestOSFamily::OpenBsd | GuestOSFamily::NetBsd => Self::bsd_profile(family),
            _ => Self::generic_linux_profile(),
        }
    }
    
    /// RHEL/Rocky/AlmaLinux/CentOS/Fedora profile.
    /// These kernels are VERY strict about hardware - they will panic
    /// if certain conditions aren't met.
    fn rhel_profile(family: GuestOSFamily) -> Self {
        Self {
            family,
            variant: None,
            timers: TimerConfig {
                hpet_enabled: false,  // CRITICAL: RHEL 9 kernel panics with HPET
                kvmclock_enabled: true,
                hyperv_time_enabled: false,
                rtc_tick_policy: "catchup".to_string(),
                pit_tick_policy: "delay".to_string(),
            },
            video: VideoConfig {
                model: "vga".to_string(),  // Safe during install
                vram_kb: 16384,
                heads: 1,
                accel_3d: false,
            },
            cpu: CpuProfile {
                mode: "host-passthrough".to_string(),  // RHEL needs real CPU features
                nested_virt: false,
                hyperv_features: HypervFeatures::default(),
            },
            disk: DiskProfile {
                default_bus: "virtio".to_string(),  // RHEL has virtio drivers
                default_cache: "none".to_string(),
                default_io: "native".to_string(),
            },
            network: NetworkProfile {
                default_model: "virtio".to_string(),
            },
            platform: PlatformRequirements {
                tpm_required: false,
                secure_boot_required: false,
                min_memory_mib: 2048,
                min_vcpus: 2,
            },
            machine_type: "q35".to_string(),
            firmware: "bios".to_string(),  // UEFI optional
        }
    }
    
    /// Debian/Ubuntu profile.
    /// More flexible kernel, good virtio support.
    fn debian_profile() -> Self {
        Self {
            family: GuestOSFamily::Debian,
            variant: None,
            timers: TimerConfig {
                hpet_enabled: true,  // Debian handles HPET fine
                kvmclock_enabled: true,
                hyperv_time_enabled: false,
                rtc_tick_policy: "catchup".to_string(),
                pit_tick_policy: "delay".to_string(),
            },
            video: VideoConfig {
                model: "virtio".to_string(),  // Modern Ubuntu has virtio-gpu
                vram_kb: 32768,
                heads: 1,
                accel_3d: false,
            },
            cpu: CpuProfile {
                mode: "host-passthrough".to_string(),
                nested_virt: false,
                hyperv_features: HypervFeatures::default(),
            },
            disk: DiskProfile {
                default_bus: "virtio".to_string(),
                default_cache: "none".to_string(),
                default_io: "native".to_string(),
            },
            network: NetworkProfile {
                default_model: "virtio".to_string(),
            },
            platform: PlatformRequirements::default(),
            machine_type: "q35".to_string(),
            firmware: "bios".to_string(),
        }
    }
    
    /// SUSE/openSUSE profile.
    fn suse_profile() -> Self {
        let mut profile = Self::debian_profile();
        profile.family = GuestOSFamily::Suse;
        profile.timers.hpet_enabled = false;  // SUSE also prefers no HPET
        profile
    }
    
    /// Arch Linux profile.
    fn arch_profile() -> Self {
        let mut profile = Self::debian_profile();
        profile.family = GuestOSFamily::Arch;
        profile.video.model = "virtio".to_string();
        profile
    }
    
    /// Windows Server 2016/2019/2022 profile.
    fn windows_server_profile() -> Self {
        Self {
            family: GuestOSFamily::WindowsServer,
            variant: None,
            timers: TimerConfig {
                hpet_enabled: true,  // Windows likes HPET
                kvmclock_enabled: false,
                hyperv_time_enabled: true,  // Use Hyper-V timers
                rtc_tick_policy: "catchup".to_string(),
                pit_tick_policy: "delay".to_string(),
            },
            video: VideoConfig {
                model: "qxl".to_string(),  // Good Windows driver
                vram_kb: 65536,
                heads: 1,
                accel_3d: false,
            },
            cpu: CpuProfile {
                mode: "host-passthrough".to_string(),
                nested_virt: false,
                hyperv_features: HypervFeatures {
                    enabled: true,
                    relaxed: true,
                    vapic: true,
                    spinlocks: true,
                    spinlock_retries: 8191,
                    vpindex: true,
                    runtime: true,
                    synic: true,
                    stimer: true,
                    reset: true,
                    frequencies: true,
                    reftime: true,
                    tlbflush: true,
                    ipi: true,
                },
            },
            disk: DiskProfile {
                default_bus: "sata".to_string(),  // Safe for install, switch to virtio after
                default_cache: "writeback".to_string(),
                default_io: "threads".to_string(),
            },
            network: NetworkProfile {
                default_model: "e1000e".to_string(),  // Safe for install
            },
            platform: PlatformRequirements {
                tpm_required: false,
                secure_boot_required: false,
                min_memory_mib: 2048,
                min_vcpus: 2,
            },
            machine_type: "q35".to_string(),
            firmware: "uefi".to_string(),
        }
    }
    
    /// Windows 10/11 Desktop profile.
    fn windows_desktop_profile() -> Self {
        let mut profile = Self::windows_server_profile();
        profile.family = GuestOSFamily::WindowsDesktop;
        
        // Windows 11 requirements
        profile.platform = PlatformRequirements {
            tpm_required: true,     // Windows 11 requires TPM 2.0
            secure_boot_required: true,  // Windows 11 requires Secure Boot
            min_memory_mib: 4096,   // Windows 11 minimum
            min_vcpus: 2,
        };
        
        profile
    }
    
    /// Windows 7/8/8.1 legacy profile.
    fn windows_legacy_profile() -> Self {
        Self {
            family: GuestOSFamily::WindowsLegacy,
            variant: None,
            timers: TimerConfig {
                hpet_enabled: true,
                kvmclock_enabled: false,
                hyperv_time_enabled: false,  // Legacy Windows doesn't support this well
                rtc_tick_policy: "catchup".to_string(),
                pit_tick_policy: "delay".to_string(),
            },
            video: VideoConfig {
                model: "vga".to_string(),  // Maximum compatibility
                vram_kb: 16384,
                heads: 1,
                accel_3d: false,
            },
            cpu: CpuProfile {
                mode: "host-passthrough".to_string(),
                nested_virt: false,
                hyperv_features: HypervFeatures::default(),
            },
            disk: DiskProfile {
                default_bus: "ide".to_string(),  // Legacy needs IDE for install
                default_cache: "writeback".to_string(),
                default_io: "threads".to_string(),
            },
            network: NetworkProfile {
                default_model: "e1000".to_string(),  // Legacy Intel
            },
            platform: PlatformRequirements::default(),
            machine_type: "q35".to_string(),
            firmware: "bios".to_string(),  // Legacy Windows often doesn't support UEFI
        }
    }
    
    /// FreeBSD profile.
    fn freebsd_profile() -> Self {
        Self {
            family: GuestOSFamily::FreeBsd,
            variant: None,
            timers: TimerConfig {
                hpet_enabled: true,
                kvmclock_enabled: false,
                hyperv_time_enabled: false,
                rtc_tick_policy: "catchup".to_string(),
                pit_tick_policy: "delay".to_string(),
            },
            video: VideoConfig {
                model: "vga".to_string(),
                vram_kb: 16384,
                heads: 1,
                accel_3d: false,
            },
            cpu: CpuProfile {
                mode: "host-passthrough".to_string(),
                nested_virt: false,
                hyperv_features: HypervFeatures::default(),
            },
            disk: DiskProfile {
                default_bus: "virtio".to_string(),  // FreeBSD has virtio
                default_cache: "none".to_string(),
                default_io: "native".to_string(),
            },
            network: NetworkProfile {
                default_model: "virtio".to_string(),
            },
            platform: PlatformRequirements::default(),
            machine_type: "q35".to_string(),
            firmware: "bios".to_string(),
        }
    }
    
    /// OpenBSD/NetBSD profile.
    fn bsd_profile(family: GuestOSFamily) -> Self {
        let mut profile = Self::freebsd_profile();
        profile.family = family;
        // OpenBSD is more conservative
        profile.disk.default_bus = "scsi".to_string();
        profile
    }
    
    /// Generic Linux fallback profile.
    fn generic_linux_profile() -> Self {
        Self {
            family: GuestOSFamily::GenericLinux,
            variant: None,
            timers: TimerConfig {
                hpet_enabled: false,  // Safe default
                kvmclock_enabled: true,
                hyperv_time_enabled: false,
                rtc_tick_policy: "catchup".to_string(),
                pit_tick_policy: "delay".to_string(),
            },
            video: VideoConfig {
                model: "vga".to_string(),  // Safe default
                vram_kb: 16384,
                heads: 1,
                accel_3d: false,
            },
            cpu: CpuProfile {
                mode: "host-passthrough".to_string(),
                nested_virt: false,
                hyperv_features: HypervFeatures::default(),
            },
            disk: DiskProfile {
                default_bus: "virtio".to_string(),
                default_cache: "none".to_string(),
                default_io: "native".to_string(),
            },
            network: NetworkProfile {
                default_model: "virtio".to_string(),
            },
            platform: PlatformRequirements::default(),
            machine_type: "q35".to_string(),
            firmware: "bios".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_rhel_hpet_disabled() {
        let profile = GuestOSProfile::for_family(GuestOSFamily::Rhel);
        assert!(!profile.timers.hpet_enabled, "RHEL should have HPET disabled");
        assert_eq!(profile.cpu.mode, "host-passthrough");
    }
    
    #[test]
    fn test_windows_hyper_v_enabled() {
        let profile = GuestOSProfile::for_family(GuestOSFamily::WindowsServer);
        assert!(profile.cpu.hyperv_features.enabled);
        assert!(profile.timers.hyperv_time_enabled);
        assert!(profile.timers.hpet_enabled, "Windows should have HPET enabled");
    }
    
    #[test]
    fn test_windows_11_requirements() {
        let profile = GuestOSProfile::for_family(GuestOSFamily::WindowsDesktop);
        assert!(profile.platform.tpm_required);
        assert!(profile.platform.secure_boot_required);
        assert!(profile.platform.min_memory_mib >= 4096);
    }
    
    #[test]
    fn test_family_from_string() {
        assert_eq!(GuestOSFamily::from_str("rocky"), GuestOSFamily::Rhel);
        assert_eq!(GuestOSFamily::from_str("Ubuntu"), GuestOSFamily::Debian);
        assert_eq!(GuestOSFamily::from_str("windows"), GuestOSFamily::WindowsDesktop);
        assert_eq!(GuestOSFamily::from_str("win11"), GuestOSFamily::WindowsDesktop);
    }
    
    #[test]
    fn test_debian_hpet_enabled() {
        let profile = GuestOSProfile::for_family(GuestOSFamily::Debian);
        assert!(profile.timers.hpet_enabled, "Debian can handle HPET");
    }
}
