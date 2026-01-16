//! # OTA Update Module
//!
//! This module provides Over-The-Air (OTA) update functionality for Quantix-OS.
//!
//! ## Features
//! - Periodic update checks against the update server
//! - Download artifacts with resume support and SHA256 verification
//! - Atomic file replacement with backup/rollback capability
//! - Service restart orchestration via OpenRC
//! - A/B partition updates for full system images
//!
//! ## Architecture
//!
//! ```text
//! ┌─────────────────┐     ┌─────────────────┐
//! │  Update Server  │     │   qx-node       │
//! │  (Go + Docker)  │◄────┤   Update Client │
//! └─────────────────┘     └─────────────────┘
//!         │                       │
//!         │ manifest.json         │ check/download
//!         │ *.tar.zst             │ verify/apply
//!         ▼                       ▼
//! ┌─────────────────┐     ┌─────────────────┐
//! │  /data/updates/ │     │  /data/bin/     │
//! │  staging area   │────►│  live binaries  │
//! └─────────────────┘     └─────────────────┘
//! ```

mod manifest;
mod downloader;
mod applier;
mod config;
mod status;
mod ab_update;

pub use manifest::{Manifest, Component, FullImage, UpdateType};
pub use downloader::UpdateDownloader;
pub use applier::UpdateApplier;
pub use config::UpdateConfig;
pub use status::{UpdateStatus, UpdateProgress, ComponentStatus};
pub use ab_update::{ABUpdateManager, ABUpdateState, Slot};

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, instrument};
use anyhow::{Result, Context};

/// Current versions of installed components
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledVersions {
    pub os_version: String,
    pub qx_node: Option<String>,
    pub qx_console: Option<String>,
    pub host_ui: Option<String>,
}

impl Default for InstalledVersions {
    fn default() -> Self {
        Self {
            os_version: "0.0.1".to_string(),
            qx_node: None,
            qx_console: None,
            host_ui: None,
        }
    }
}

/// Update availability information
#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub channel: String,
    pub components: Vec<ComponentUpdateInfo>,
    pub full_image_available: bool,
    pub total_download_size: u64,
    pub release_notes: Option<String>,
}

/// Information about a component update
#[derive(Debug, Clone, serde::Serialize)]
pub struct ComponentUpdateInfo {
    pub name: String,
    pub current_version: Option<String>,
    pub new_version: String,
    pub size_bytes: u64,
}

/// Main update manager that coordinates all update operations
pub struct UpdateManager {
    config: UpdateConfig,
    downloader: UpdateDownloader,
    applier: UpdateApplier,
    status: Arc<RwLock<UpdateStatus>>,
    installed_versions: Arc<RwLock<InstalledVersions>>,
}

impl UpdateManager {
    /// Create a new UpdateManager with the given configuration
    pub fn new(config: UpdateConfig) -> Self {
        let downloader = UpdateDownloader::new(
            config.server_url.clone(),
            config.staging_dir.clone(),
        );
        let applier = UpdateApplier::new(config.clone());
        
        Self {
            config,
            downloader,
            applier,
            status: Arc::new(RwLock::new(UpdateStatus::Idle)),
            installed_versions: Arc::new(RwLock::new(InstalledVersions::default())),
        }
    }

    /// Initialize the update manager by detecting installed versions
    #[instrument(skip(self))]
    pub async fn init(&self) -> Result<()> {
        info!("Initializing update manager");
        
        // Read OS version from standard locations
        let os_version = self.detect_os_version().await;
        
        // Detect component versions
        let mut versions = InstalledVersions {
            os_version,
            qx_node: self.detect_component_version("qx-node").await,
            qx_console: self.detect_component_version("qx-console").await,
            host_ui: self.detect_component_version("host-ui").await,
        };
        
        // If no component versions detected, use OS version as fallback
        if versions.qx_node.is_none() {
            versions.qx_node = Some(versions.os_version.clone());
        }
        
        let mut installed = self.installed_versions.write().await;
        *installed = versions.clone();
        
        info!(
            os_version = %versions.os_version,
            qx_node = ?versions.qx_node,
            "Detected installed versions"
        );
        
        Ok(())
    }

    /// Detect the installed OS version
    async fn detect_os_version(&self) -> String {
        let version_paths = [
            "/quantix/VERSION",
            "/mnt/cdrom/quantix/VERSION",
            "/etc/quantix-version",
            "/data/VERSION",
        ];
        
        for path in version_paths {
            if let Ok(content) = tokio::fs::read_to_string(path).await {
                return content.trim().to_string();
            }
        }
        
        "0.0.1".to_string()
    }

    /// Detect installed version of a component
    async fn detect_component_version(&self, component: &str) -> Option<String> {
        let version_file = format!("/data/versions/{}.version", component);
        match tokio::fs::read_to_string(&version_file).await {
            Ok(content) => Some(content.trim().to_string()),
            Err(_) => None,
        }
    }

    /// Check for available updates
    #[instrument(skip(self))]
    pub async fn check_for_updates(&self) -> Result<UpdateInfo> {
        info!(
            server = %self.config.server_url,
            channel = %self.config.channel,
            "Checking for updates"
        );

        // Update status
        {
            let mut status = self.status.write().await;
            *status = UpdateStatus::Checking;
        }

        // Fetch latest manifest from server
        let manifest = match self.downloader.fetch_manifest(&self.config.channel).await {
            Ok(m) => m,
            Err(e) => {
                let mut status = self.status.write().await;
                *status = UpdateStatus::Error(format!("Failed to fetch manifest: {}", e));
                return Err(e);
            }
        };

        let installed = self.installed_versions.read().await;
        
        // Compare versions and build update info
        let mut components = Vec::new();
        let mut total_size = 0u64;
        
        for component in &manifest.components {
            let current = match component.name.as_str() {
                "qx-node" => installed.qx_node.clone(),
                "qx-console" => installed.qx_console.clone(),
                "host-ui" => installed.host_ui.clone(),
                _ => None,
            };
            
            let needs_update = match &current {
                Some(current_ver) => version_gt(&component.version, current_ver),
                None => true, // Not installed, needs update
            };
            
            if needs_update {
                components.push(ComponentUpdateInfo {
                    name: component.name.clone(),
                    current_version: current,
                    new_version: component.version.clone(),
                    size_bytes: component.size_bytes,
                });
                total_size += component.size_bytes;
            }
        }

        let available = !components.is_empty() || manifest.full_image.is_some();
        
        // Update status
        {
            let mut status = self.status.write().await;
            *status = if available {
                UpdateStatus::Available(manifest.version.clone())
            } else {
                UpdateStatus::UpToDate
            };
        }

        Ok(UpdateInfo {
            available,
            current_version: installed.os_version.clone(),
            latest_version: Some(manifest.version.clone()),
            channel: manifest.channel.clone(),
            components,
            full_image_available: manifest.full_image.is_some(),
            total_download_size: total_size,
            release_notes: Some(manifest.release_notes.clone()),
        })
    }

    /// Apply available updates
    #[instrument(skip(self))]
    pub async fn apply_updates(&self) -> Result<()> {
        info!("Starting update application");

        // Fetch manifest
        let manifest = self.downloader.fetch_manifest(&self.config.channel).await
            .context("Failed to fetch manifest")?;

        // Update status
        {
            let mut status = self.status.write().await;
            *status = UpdateStatus::Downloading(UpdateProgress {
                current_component: "".to_string(),
                downloaded_bytes: 0,
                total_bytes: 0,
                percentage: 0,
            });
        }

        // Download all components
        let artifacts = self.downloader.download_all(&manifest, |progress| {
            // This would ideally update the status, but we need async closure support
            // For now, logging is sufficient
            info!(
                component = %progress.current_component,
                progress = progress.percentage,
                "Download progress"
            );
        }).await.context("Failed to download artifacts")?;

        // Update status
        {
            let mut status = self.status.write().await;
            *status = UpdateStatus::Applying("Verifying and applying updates".to_string());
        }

        // Apply all downloaded artifacts
        for (component, artifact_path) in artifacts {
            info!(component = %component.name, "Applying component update");
            
            self.applier.apply_component(&component, &artifact_path).await
                .with_context(|| format!("Failed to apply component: {}", component.name))?;

            // Update installed version
            {
                let mut versions = self.installed_versions.write().await;
                match component.name.as_str() {
                    "qx-node" => versions.qx_node = Some(component.version.clone()),
                    "qx-console" => versions.qx_console = Some(component.version.clone()),
                    "host-ui" => versions.host_ui = Some(component.version.clone()),
                    _ => {}
                }
            }
        }

        // Update status
        {
            let mut status = self.status.write().await;
            *status = UpdateStatus::Complete(manifest.version.clone());
        }

        info!(version = %manifest.version, "Update applied successfully");
        Ok(())
    }

    /// Get current update status
    pub async fn get_status(&self) -> UpdateStatus {
        self.status.read().await.clone()
    }

    /// Get currently installed versions
    pub async fn get_installed_versions(&self) -> InstalledVersions {
        self.installed_versions.read().await.clone()
    }

    /// Get update configuration
    pub fn get_config(&self) -> &UpdateConfig {
        &self.config
    }
}

/// Compare two semantic version strings
/// Returns true if v1 > v2
fn version_gt(v1: &str, v2: &str) -> bool {
    let parse = |v: &str| -> (u32, u32, u32) {
        let parts: Vec<&str> = v.split('.').collect();
        (
            parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
        )
    };
    
    let (major1, minor1, patch1) = parse(v1);
    let (major2, minor2, patch2) = parse(v2);
    
    (major1, minor1, patch1) > (major2, minor2, patch2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(version_gt("1.0.0", "0.9.9"));
        assert!(version_gt("0.1.0", "0.0.99"));
        assert!(version_gt("0.0.2", "0.0.1"));
        assert!(!version_gt("0.0.1", "0.0.1"));
        assert!(!version_gt("0.0.1", "0.0.2"));
    }
}
