//! Cloud-init NoCloud datasource generation.
//!
//! This module creates cloud-init configuration ISOs using the NoCloud datasource.
//! These ISOs are attached to VMs to provide initial configuration on first boot.
//!
//! ## NoCloud Datasource
//!
//! The NoCloud datasource expects a disk (ISO or FAT filesystem) with:
//! - `meta-data` - Instance metadata (JSON or YAML)
//! - `user-data` - Cloud-config or shell script
//! - `network-config` (optional) - Netplan v2 network configuration
//! - `vendor-data` (optional) - Provider-specific configuration
//!
//! ## Example Usage
//!
//! ```rust,ignore
//! let config = CloudInitConfig {
//!     instance_id: "vm-123".to_string(),
//!     hostname: "my-server".to_string(),
//!     user_data: "#cloud-config\npackages:\n  - nginx".to_string(),
//!     ..Default::default()
//! };
//!
//! let iso_path = CloudInitGenerator::new()
//!     .generate_iso(&config, "/var/lib/limiquantix/images/vm-123")
//!     .await?;
//! ```

use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{info, debug, warn, instrument};

use crate::error::{HypervisorError, Result};

/// Cloud-init configuration for VM provisioning.
#[derive(Debug, Clone, Default)]
pub struct CloudInitConfig {
    /// Unique instance ID (typically VM UUID)
    pub instance_id: String,
    
    /// Hostname for the VM
    pub hostname: String,
    
    /// User-data (typically #cloud-config YAML)
    pub user_data: String,
    
    /// Additional meta-data (JSON or YAML)
    pub meta_data: Option<String>,
    
    /// Network configuration (Netplan v2 format)
    pub network_config: Option<String>,
    
    /// Vendor-specific data
    pub vendor_data: Option<String>,
    
    /// SSH authorized keys to inject
    pub ssh_keys: Vec<String>,
    
    /// Default user to create
    pub default_user: Option<String>,
    
    /// Password for default user (optional, prefer SSH keys)
    pub default_password: Option<String>,
}

impl CloudInitConfig {
    /// Create a new cloud-init configuration with minimal settings.
    pub fn new(instance_id: impl Into<String>, hostname: impl Into<String>) -> Self {
        Self {
            instance_id: instance_id.into(),
            hostname: hostname.into(),
            ..Default::default()
        }
    }
    
    /// Set the user-data (typically #cloud-config YAML).
    pub fn with_user_data(mut self, user_data: impl Into<String>) -> Self {
        self.user_data = user_data.into();
        self
    }
    
    /// Add an SSH public key.
    pub fn with_ssh_key(mut self, key: impl Into<String>) -> Self {
        self.ssh_keys.push(key.into());
        self
    }
    
    /// Set the default user to create.
    pub fn with_user(mut self, username: impl Into<String>) -> Self {
        self.default_user = Some(username.into());
        self
    }
    
    /// Set network configuration (Netplan v2 format).
    pub fn with_network_config(mut self, config: impl Into<String>) -> Self {
        self.network_config = Some(config.into());
        self
    }
    
    /// Generate default user-data if none provided.
    pub fn generate_default_user_data(&self) -> String {
        let mut lines = vec!["#cloud-config".to_string()];
        
        // Set hostname
        if !self.hostname.is_empty() {
            lines.push(format!("hostname: {}", self.hostname));
            lines.push(format!("fqdn: {}.local", self.hostname));
            lines.push("manage_etc_hosts: true".to_string());
        }
        
        // Create user with SSH keys
        if self.default_user.is_some() || !self.ssh_keys.is_empty() {
            let username = self.default_user.as_deref().unwrap_or("admin");
            
            lines.push("users:".to_string());
            lines.push(format!("  - name: {}", username));
            lines.push("    groups: sudo".to_string());
            lines.push("    sudo: ALL=(ALL) NOPASSWD:ALL".to_string());
            lines.push("    shell: /bin/bash".to_string());
            
            if !self.ssh_keys.is_empty() {
                lines.push("    ssh_authorized_keys:".to_string());
                for key in &self.ssh_keys {
                    lines.push(format!("      - {}", key));
                }
            }
            
            if let Some(ref password) = self.default_password {
                lines.push("    lock_passwd: false".to_string());
                lines.push(format!("    passwd: {}", password));
            }
        }
        
        // Enable password auth for SSH if password is set
        if self.default_password.is_some() {
            lines.push("ssh_pwauth: true".to_string());
        }
        
        // Common packages
        lines.push("package_update: true".to_string());
        lines.push("packages:".to_string());
        lines.push("  - qemu-guest-agent".to_string());
        
        // Start qemu-guest-agent
        lines.push("runcmd:".to_string());
        lines.push("  - systemctl enable qemu-guest-agent".to_string());
        lines.push("  - systemctl start qemu-guest-agent".to_string());
        
        lines.join("\n")
    }
    
    /// Generate meta-data content.
    pub fn generate_meta_data(&self) -> String {
        let meta = self.meta_data.clone().unwrap_or_else(|| {
            format!(
                "instance-id: {}\nlocal-hostname: {}",
                self.instance_id,
                self.hostname
            )
        });
        meta
    }
}

/// Generator for cloud-init NoCloud ISO images.
pub struct CloudInitGenerator {
    /// Path to genisoimage/mkisofs binary
    iso_tool: String,
}

impl Default for CloudInitGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl CloudInitGenerator {
    /// Create a new cloud-init generator.
    pub fn new() -> Self {
        Self {
            iso_tool: Self::find_iso_tool(),
        }
    }
    
    /// Find the ISO generation tool (genisoimage or mkisofs).
    fn find_iso_tool() -> String {
        // Try genisoimage first (common on Debian/Ubuntu)
        if Command::new("genisoimage").arg("--version").output().is_ok() {
            return "genisoimage".to_string();
        }
        
        // Try mkisofs (common on RHEL/CentOS)
        if Command::new("mkisofs").arg("--version").output().is_ok() {
            return "mkisofs".to_string();
        }
        
        // Try xorriso (modern alternative)
        if Command::new("xorrisofs").arg("--version").output().is_ok() {
            return "xorrisofs".to_string();
        }
        
        // Default to genisoimage (will fail with a helpful error if not found)
        "genisoimage".to_string()
    }
    
    /// Check if the ISO tool is available.
    pub fn check_tool(&self) -> Result<String> {
        let output = Command::new(&self.iso_tool)
            .arg("--version")
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("{} not found. Install with: sudo apt install genisoimage", e)
            ))?;
        
        let version = String::from_utf8_lossy(&output.stdout);
        let first_line = version.lines().next().unwrap_or("unknown");
        
        Ok(first_line.to_string())
    }
    
    /// Generate a NoCloud ISO from the configuration.
    #[instrument(skip(self, config), fields(instance_id = %config.instance_id))]
    pub fn generate_iso(&self, config: &CloudInitConfig, output_dir: &Path) -> Result<PathBuf> {
        info!("Generating cloud-init ISO");
        
        // Create temp directory for cloud-init files
        let temp_dir = tempfile::tempdir()
            .map_err(|e| HypervisorError::Internal(format!("Failed to create temp dir: {}", e)))?;
        
        let temp_path = temp_dir.path();
        
        // Write meta-data
        let meta_data = config.generate_meta_data();
        std::fs::write(temp_path.join("meta-data"), &meta_data)
            .map_err(|e| HypervisorError::Internal(format!("Failed to write meta-data: {}", e)))?;
        debug!(content = %meta_data, "Wrote meta-data");
        
        // Write user-data
        let user_data = if config.user_data.is_empty() {
            config.generate_default_user_data()
        } else {
            config.user_data.clone()
        };
        std::fs::write(temp_path.join("user-data"), &user_data)
            .map_err(|e| HypervisorError::Internal(format!("Failed to write user-data: {}", e)))?;
        debug!(content = %user_data, "Wrote user-data");
        
        // Write network-config if provided
        if let Some(ref network_config) = config.network_config {
            std::fs::write(temp_path.join("network-config"), network_config)
                .map_err(|e| HypervisorError::Internal(format!("Failed to write network-config: {}", e)))?;
            debug!(content = %network_config, "Wrote network-config");
        }
        
        // Write vendor-data if provided
        if let Some(ref vendor_data) = config.vendor_data {
            std::fs::write(temp_path.join("vendor-data"), vendor_data)
                .map_err(|e| HypervisorError::Internal(format!("Failed to write vendor-data: {}", e)))?;
        }
        
        // Ensure output directory exists
        std::fs::create_dir_all(output_dir)
            .map_err(|e| HypervisorError::Internal(format!("Failed to create output dir: {}", e)))?;
        
        // Generate ISO path
        let iso_path = output_dir.join("cloud-init.iso");
        
        // Generate ISO using genisoimage/mkisofs
        let output = Command::new(&self.iso_tool)
            .args([
                "-output", iso_path.to_str().unwrap_or_default(),
                "-volid", "cidata",
                "-joliet",
                "-rock",
                temp_path.to_str().unwrap_or_default(),
            ])
            .output()
            .map_err(|e| HypervisorError::Internal(
                format!("Failed to run {}: {}", self.iso_tool, e)
            ))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(HypervisorError::Internal(
                format!("ISO generation failed: {}", stderr)
            ));
        }
        
        info!(path = %iso_path.display(), "Cloud-init ISO generated");
        
        Ok(iso_path)
    }
    
    /// Generate a simple user-data for quick provisioning.
    ///
    /// This creates a user with SSH key access and basic tools.
    pub fn simple_user_data(
        hostname: &str,
        username: &str,
        ssh_keys: &[String],
        packages: &[String],
    ) -> String {
        let mut lines = vec![
            "#cloud-config".to_string(),
            format!("hostname: {}", hostname),
            format!("fqdn: {}.local", hostname),
            "manage_etc_hosts: true".to_string(),
            "".to_string(),
            "users:".to_string(),
            format!("  - name: {}", username),
            "    groups: sudo".to_string(),
            "    sudo: ALL=(ALL) NOPASSWD:ALL".to_string(),
            "    shell: /bin/bash".to_string(),
        ];
        
        if !ssh_keys.is_empty() {
            lines.push("    ssh_authorized_keys:".to_string());
            for key in ssh_keys {
                lines.push(format!("      - {}", key));
            }
        }
        
        lines.push("".to_string());
        lines.push("package_update: true".to_string());
        lines.push("packages:".to_string());
        lines.push("  - qemu-guest-agent".to_string());
        
        for pkg in packages {
            lines.push(format!("  - {}", pkg));
        }
        
        lines.push("".to_string());
        lines.push("runcmd:".to_string());
        lines.push("  - systemctl enable qemu-guest-agent".to_string());
        lines.push("  - systemctl start qemu-guest-agent".to_string());
        
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_simple_config() {
        let config = CloudInitConfig::new("vm-123", "my-server")
            .with_user("admin")
            .with_ssh_key("ssh-rsa AAAAB...");
        
        assert_eq!(config.instance_id, "vm-123");
        assert_eq!(config.hostname, "my-server");
        assert_eq!(config.default_user, Some("admin".to_string()));
        assert_eq!(config.ssh_keys.len(), 1);
    }
    
    #[test]
    fn test_generate_default_user_data() {
        let config = CloudInitConfig::new("vm-123", "test-vm")
            .with_user("admin")
            .with_ssh_key("ssh-rsa TEST_KEY");
        
        let user_data = config.generate_default_user_data();
        
        assert!(user_data.contains("#cloud-config"));
        assert!(user_data.contains("hostname: test-vm"));
        assert!(user_data.contains("name: admin"));
        assert!(user_data.contains("ssh-rsa TEST_KEY"));
        assert!(user_data.contains("qemu-guest-agent"));
    }
    
    #[test]
    fn test_generate_meta_data() {
        let config = CloudInitConfig::new("vm-123", "test-vm");
        let meta_data = config.generate_meta_data();
        
        assert!(meta_data.contains("instance-id: vm-123"));
        assert!(meta_data.contains("local-hostname: test-vm"));
    }
    
    #[test]
    fn test_simple_user_data() {
        let user_data = CloudInitGenerator::simple_user_data(
            "webserver",
            "deploy",
            &["ssh-rsa KEY1".to_string()],
            &["nginx".to_string(), "vim".to_string()],
        );
        
        assert!(user_data.contains("hostname: webserver"));
        assert!(user_data.contains("name: deploy"));
        assert!(user_data.contains("ssh-rsa KEY1"));
        assert!(user_data.contains("- nginx"));
        assert!(user_data.contains("- vim"));
    }
}
