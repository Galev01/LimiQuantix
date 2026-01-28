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
pub use config::{UpdateConfig, StorageLocation};
pub use status::{UpdateStatus, UpdateProgress, ComponentStatus};
pub use ab_update::{ABUpdateManager, ABUpdateState, Slot};

use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, error, instrument};
use anyhow::{Result, Context};

/// Current versions of installed components
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledVersions {
    pub os_version: String,
    pub qx_node: Option<String>,
    pub qx_console: Option<String>,
    pub host_ui: Option<String>,
    pub guest_agent: Option<String>,
}

impl Default for InstalledVersions {
    fn default() -> Self {
        Self {
            os_version: "0.0.1".to_string(),
            qx_node: None,
            qx_console: None,
            host_ui: None,
            guest_agent: None,
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
    config: RwLock<UpdateConfig>,
    downloader: RwLock<UpdateDownloader>,
    applier: RwLock<UpdateApplier>,
    status: Arc<RwLock<UpdateStatus>>,
    installed_versions: Arc<RwLock<InstalledVersions>>,
}

impl UpdateManager {
    /// Create a new UpdateManager with the given configuration
    pub fn new(config: UpdateConfig) -> Self {
        let effective_staging = config.effective_staging_dir();
        let downloader = UpdateDownloader::new(
            config.server_url.clone(),
            effective_staging,
        );
        let applier = UpdateApplier::new(config.clone());
        
        Self {
            config: RwLock::new(config),
            downloader: RwLock::new(downloader),
            applier: RwLock::new(applier),
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
            guest_agent: self.detect_component_version("guest-agent").await,
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
            guest_agent = ?versions.guest_agent,
            "Detected installed versions"
        );
        
        Ok(())
    }

    /// Detect the installed OS version
    async fn detect_os_version(&self) -> String {
        // Check multiple possible version file locations
        let version_paths = [
            "/data/versions/qx-node.version",  // Component version (most accurate after updates)
            "/etc/quantix-version",            // Written by build-all-components.sh
            "/quantix/VERSION",                // ISO mount point
            "/mnt/cdrom/quantix/VERSION",      // Alternative ISO mount
            "/data/VERSION",                   // Data partition
        ];
        
        for path in version_paths {
            if let Ok(content) = tokio::fs::read_to_string(path).await {
                let version = content.trim().to_string();
                if !version.is_empty() && version != "0.0.0" {
                    tracing::debug!(path = %path, version = %version, "Found OS version");
                    return version;
                }
            }
        }
        
        // Fallback: try to read from release file
        if let Ok(content) = tokio::fs::read_to_string("/etc/quantix-release").await {
            for line in content.lines() {
                if line.starts_with("QUANTIX_VERSION=") || line.starts_with("VERSION=") {
                    let version = line.split('=').nth(1)
                        .map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string())
                        .unwrap_or_default();
                    if !version.is_empty() {
                        tracing::debug!(version = %version, "Found OS version from release file");
                        return version;
                    }
                }
            }
        }
        
        warn!("Could not detect OS version, using fallback");
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
        let config = self.config.read().await;
        info!(
            server = %config.server_url,
            channel = %config.channel,
            "Checking for updates"
        );

        // Update status
        {
            let mut status = self.status.write().await;
            *status = UpdateStatus::Checking;
        }

        // Fetch latest manifest from server
        let channel = config.channel.clone();
        drop(config); // Release lock before async operations
        
        let downloader = self.downloader.read().await;
        let manifest = match downloader.fetch_manifest(&channel).await {
            Ok(m) => m,
            Err(e) => {
                let mut status = self.status.write().await;
                *status = UpdateStatus::Error(format!("Failed to fetch manifest: {}", e));
                return Err(e);
            }
        };
        drop(downloader);

        let installed = self.installed_versions.read().await;
        
        // Compare versions and build update info
        let mut components = Vec::new();
        let mut total_size = 0u64;
        
        for component in &manifest.components {
            let current = match component.name.as_str() {
                "qx-node" => installed.qx_node.clone(),
                "qx-console" => installed.qx_console.clone(),
                "host-ui" => installed.host_ui.clone(),
                "guest-agent" => installed.guest_agent.clone(),
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
        info!("=== STARTING UPDATE APPLICATION ===");

        // Get channel and fetch manifest
        let channel = {
            let config = self.config.read().await;
            info!(channel = %config.channel, server = %config.server_url, "Update configuration");
            config.channel.clone()
        };
        
        let downloader = self.downloader.read().await;
        
        // Clean staging directory before starting to ensure no stale files
        // from previous failed attempts or different versions
        info!("Cleaning staging directory...");
        if let Err(e) = downloader.cleanup().await {
            warn!(error = %e, "Failed to clean staging directory, continuing anyway");
        }
        
        info!("Fetching manifest from update server...");
        let manifest = match downloader.fetch_manifest(&channel).await {
            Ok(m) => {
                info!(
                    version = %m.version,
                    components = m.components.len(),
                    total_size = m.total_component_size(),
                    "Manifest fetched successfully"
                );
                for c in &m.components {
                    info!(
                        component = %c.name,
                        version = %c.version,
                        artifact = %c.artifact,
                        size = c.size_bytes,
                        install_path = %c.install_path,
                        "Component in manifest"
                    );
                }
                m
            }
            Err(e) => {
                error!(error = %e, "Failed to fetch manifest");
                // Update status to error
                let mut status = self.status.write().await;
                *status = UpdateStatus::Error(format!("Failed to fetch manifest: {}", e));
                return Err(e.context("Failed to fetch manifest"));
            }
        };

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
        info!("=== STARTING ARTIFACT DOWNLOADS ===");
        let artifacts = match downloader.download_all(&manifest, |progress| {
            // This would ideally update the status, but we need async closure support
            // For now, logging is sufficient
            info!(
                component = %progress.current_component,
                downloaded = progress.downloaded_bytes,
                total = progress.total_bytes,
                percentage = progress.percentage,
                "Download progress"
            );
        }).await {
            Ok(a) => {
                info!(
                    count = a.len(),
                    "All artifacts downloaded successfully"
                );
                for (c, path) in &a {
                    info!(
                        component = %c.name,
                        path = %path.display(),
                        "Artifact downloaded"
                    );
                }
                a
            }
            Err(e) => {
                error!(error = %e, "Failed to download artifacts: {:#}", e);
                // Update status to error
                let mut status = self.status.write().await;
                *status = UpdateStatus::Error(format!("Download failed: {}", e));
                return Err(e.context("Failed to download artifacts"));
            }
        };
        drop(downloader);

        // Update status
        {
            let mut status = self.status.write().await;
            *status = UpdateStatus::Applying("Verifying and applying updates".to_string());
        }

        // Apply all downloaded artifacts
        // IMPORTANT: Apply qx-node LAST because it restarts the service and kills the process
        // Sort components so qx-node is applied after everything else
        let mut sorted_artifacts: Vec<_> = artifacts.into_iter().collect();
        sorted_artifacts.sort_by(|(a, _), (b, _)| {
            // qx-node should be last (highest priority number)
            let priority = |name: &str| -> u8 {
                match name {
                    "qx-node" => 99,  // Apply last - restarts service
                    "qx-console" => 50,
                    "host-ui" => 10,   // Apply first - no restart needed
                    _ => 25,
                }
            };
            priority(&a.name).cmp(&priority(&b.name))
        });

        info!("=== APPLYING UPDATES ===");
        let applier = self.applier.read().await;
        for (idx, (component, artifact_path)) in sorted_artifacts.iter().enumerate() {
            info!(
                component = %component.name,
                version = %component.version,
                artifact = %artifact_path.display(),
                install_path = %component.install_path,
                progress = format!("{}/{}", idx + 1, sorted_artifacts.len()),
                "Applying component update"
            );
            
            // Update status with current component
            {
                let mut status = self.status.write().await;
                *status = UpdateStatus::Applying(format!("Applying {} ({}/{})", 
                    component.name, idx + 1, sorted_artifacts.len()));
            }
            
            match applier.apply_component(component, artifact_path).await {
                Ok(()) => {
                    info!(
                        component = %component.name,
                        "Component applied successfully"
                    );
                }
                Err(e) => {
                    error!(
                        component = %component.name,
                        error = %e,
                        "Failed to apply component"
                    );
                    // Update status to error
                    let mut status = self.status.write().await;
                    *status = UpdateStatus::Error(format!("Failed to apply {}: {}", component.name, e));
                    return Err(e.context(format!("Failed to apply component: {}", component.name)));
                }
            }

            // Update installed version
            {
                let mut versions = self.installed_versions.write().await;
                match component.name.as_str() {
                    "qx-node" => versions.qx_node = Some(component.version.clone()),
                    "qx-console" => versions.qx_console = Some(component.version.clone()),
                    "host-ui" => versions.host_ui = Some(component.version.clone()),
                    "guest-agent" => versions.guest_agent = Some(component.version.clone()),
                    _ => {}
                }
                info!(component = %component.name, version = %component.version, "Version record updated");
            }
        }
        drop(applier);

        // Clean up staging directory after successful update
        let downloader = self.downloader.read().await;
        if let Err(e) = downloader.cleanup().await {
            warn!(error = %e, "Failed to clean staging directory after update");
        }
        drop(downloader);

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
    
    /// Reset update status to Idle
    /// 
    /// Use this to clear a stuck status (e.g., if a previous update crashed)
    pub async fn reset_status(&self) {
        let mut status = self.status.write().await;
        info!(previous_status = ?format!("{:?}", *status), "Resetting update status to Idle");
        *status = UpdateStatus::Idle;
    }

    /// Get currently installed versions
    pub async fn get_installed_versions(&self) -> InstalledVersions {
        self.installed_versions.read().await.clone()
    }

    /// Get update configuration (returns a clone)
    pub async fn get_config(&self) -> UpdateConfig {
        self.config.read().await.clone()
    }
    
    /// Update the configuration at runtime
    /// 
    /// This updates the server URL, channel, and/or storage location.
    /// Changes are applied immediately and the downloader is recreated.
    #[instrument(skip(self))]
    pub async fn update_config(
        &self,
        server_url: Option<String>,
        channel: Option<String>,
        storage_location: Option<StorageLocation>,
        volume_path: Option<String>,
    ) -> Result<UpdateConfig> {
        let mut config = self.config.write().await;
        
        // Update fields if provided
        if let Some(url) = server_url {
            if url.is_empty() {
                anyhow::bail!("Server URL cannot be empty");
            }
            info!(old = %config.server_url, new = %url, "Updating server URL");
            config.server_url = url;
        }
        
        if let Some(ch) = channel {
            if !["dev", "beta", "stable"].contains(&ch.as_str()) {
                anyhow::bail!("Invalid channel '{}'. Must be dev, beta, or stable", ch);
            }
            info!(old = %config.channel, new = %ch, "Updating channel");
            config.channel = ch;
        }
        
        if let Some(loc) = storage_location {
            info!(old = %config.storage_location, new = %loc, "Updating storage location");
            config.storage_location = loc;
        }
        
        if let Some(path) = volume_path {
            info!(old = ?config.volume_path, new = %path, "Updating volume path");
            config.volume_path = if path.is_empty() { None } else { Some(path) };
        }
        
        // Validate the updated config
        config.validate().map_err(|e| anyhow::anyhow!(e))?;
        
        // Recreate the downloader with new settings
        let effective_staging = config.effective_staging_dir();
        let new_downloader = UpdateDownloader::new(
            config.server_url.clone(),
            effective_staging.clone(),
        );
        
        // Recreate the applier with new settings
        let new_applier = UpdateApplier::new(config.clone());
        
        // Release config lock and update downloader/applier
        let config_clone = config.clone();
        drop(config);
        
        {
            let mut downloader = self.downloader.write().await;
            *downloader = new_downloader;
        }
        
        {
            let mut applier = self.applier.write().await;
            *applier = new_applier;
        }
        
        info!(
            server_url = %config_clone.server_url,
            channel = %config_clone.channel,
            storage_location = %config_clone.storage_location,
            staging_dir = %effective_staging.display(),
            "Update configuration updated"
        );
        
        Ok(config_clone)
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
