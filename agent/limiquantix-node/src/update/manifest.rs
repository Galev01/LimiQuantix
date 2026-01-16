//! Update manifest parsing and validation
//!
//! This module defines the data structures for parsing update manifests
//! from the update server.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Type of update: component-level or full system image
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateType {
    /// Update individual components (binaries, web UI)
    Component,
    /// Full system image update (squashfs)
    Full,
}

impl Default for UpdateType {
    fn default() -> Self {
        Self::Component
    }
}

/// Update manifest describing available updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Product identifier (quantix-os or quantix-vdc)
    pub product: String,
    
    /// Version string (semantic versioning)
    pub version: String,
    
    /// Release channel (dev, beta, stable)
    pub channel: String,
    
    /// Release timestamp
    pub release_date: DateTime<Utc>,
    
    /// Type of update
    pub update_type: UpdateType,
    
    /// List of updatable components
    pub components: Vec<Component>,
    
    /// Full system image (optional, for A/B updates)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_image: Option<FullImage>,
    
    /// Minimum version required to apply this update
    #[serde(default)]
    pub min_version: String,
    
    /// Human-readable release notes
    #[serde(default)]
    pub release_notes: String,
}

impl Manifest {
    /// Calculate total download size for all components
    pub fn total_component_size(&self) -> u64 {
        self.components.iter().map(|c| c.size_bytes).sum()
    }
    
    /// Get total size including full image if present
    pub fn total_size(&self) -> u64 {
        let component_size = self.total_component_size();
        let image_size = self.full_image.as_ref().map(|i| i.size_bytes).unwrap_or(0);
        component_size + image_size
    }
    
    /// Find a component by name
    pub fn get_component(&self, name: &str) -> Option<&Component> {
        self.components.iter().find(|c| c.name == name)
    }
    
    /// Check if this update requires a reboot
    pub fn requires_reboot(&self) -> bool {
        self.full_image.as_ref().map(|i| i.requires_reboot).unwrap_or(false)
    }
}

/// Individual updatable component
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Component {
    /// Component identifier (e.g., qx-node, qx-console, host-ui)
    pub name: String,
    
    /// Component version
    pub version: String,
    
    /// Artifact filename (e.g., qx-node.tar.zst)
    pub artifact: String,
    
    /// SHA256 checksum of the artifact
    pub sha256: String,
    
    /// Size of the artifact in bytes
    pub size_bytes: u64,
    
    /// Target installation path on the system
    pub install_path: String,
    
    /// OpenRC service to restart after update (None if no restart needed)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restart_service: Option<String>,
    
    /// Whether to backup existing file before update
    #[serde(default = "default_true")]
    pub backup_before_update: bool,
    
    /// File permissions in octal format
    #[serde(default = "default_permissions")]
    pub permissions: String,
}

fn default_true() -> bool {
    true
}

fn default_permissions() -> String {
    "0755".to_string()
}

impl Component {
    /// Parse permissions string to mode
    pub fn permission_mode(&self) -> u32 {
        u32::from_str_radix(&self.permissions, 8).unwrap_or(0o755)
    }
    
    /// Check if this component requires a service restart
    pub fn needs_restart(&self) -> bool {
        self.restart_service.is_some()
    }
}

/// Full system image for A/B partition updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullImage {
    /// Image filename (e.g., system.squashfs)
    pub artifact: String,
    
    /// SHA256 checksum of the image
    pub sha256: String,
    
    /// Size of the image in bytes
    pub size_bytes: u64,
    
    /// Whether a reboot is required after applying
    pub requires_reboot: bool,
    
    /// Target partition slot for A/B update (auto, A, or B)
    #[serde(default = "default_target_slot")]
    pub target_slot: String,
}

fn default_target_slot() -> String {
    "auto".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_manifest() {
        let json = r#"{
            "product": "quantix-os",
            "version": "0.0.5",
            "channel": "dev",
            "release_date": "2026-01-16T12:00:00Z",
            "update_type": "component",
            "components": [
                {
                    "name": "qx-node",
                    "version": "0.0.5",
                    "artifact": "qx-node.tar.zst",
                    "sha256": "abc123",
                    "size_bytes": 5242880,
                    "install_path": "/data/bin/qx-node",
                    "restart_service": "quantix-node"
                }
            ],
            "min_version": "0.0.1",
            "release_notes": "Test release"
        }"#;
        
        let manifest: Manifest = serde_json::from_str(json).unwrap();
        assert_eq!(manifest.product, "quantix-os");
        assert_eq!(manifest.version, "0.0.5");
        assert_eq!(manifest.components.len(), 1);
        assert_eq!(manifest.components[0].name, "qx-node");
    }

    #[test]
    fn test_component_permissions() {
        let component = Component {
            name: "test".to_string(),
            version: "1.0.0".to_string(),
            artifact: "test.tar.zst".to_string(),
            sha256: "abc".to_string(),
            size_bytes: 100,
            install_path: "/test".to_string(),
            restart_service: None,
            backup_before_update: true,
            permissions: "0644".to_string(),
        };
        
        assert_eq!(component.permission_mode(), 0o644);
    }
}
