//! Update applier - handles extracting and installing update artifacts
//!
//! This module is responsible for:
//! - Extracting tar.zst archives
//! - Backing up existing files
//! - Atomically replacing binaries
//! - Restarting affected services
//! - Rolling back on failure

use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::fs;
use tracing::{info, warn, instrument};
use anyhow::{Result, Context, bail};

use super::manifest::Component;
use super::config::UpdateConfig;

/// Applies downloaded updates to the system
pub struct UpdateApplier {
    config: UpdateConfig,
    backup_dir: PathBuf,
}

impl UpdateApplier {
    /// Create a new applier
    pub fn new(config: UpdateConfig) -> Self {
        let backup_dir = PathBuf::from("/data/updates/backup");
        Self { config, backup_dir }
    }

    /// Apply a component update
    #[instrument(skip(self))]
    pub async fn apply_component(
        &self,
        component: &Component,
        artifact_path: &Path,
    ) -> Result<()> {
        info!(
            component = %component.name,
            install_path = %component.install_path,
            "Applying component update"
        );

        // Create backup if requested
        if component.backup_before_update {
            self.backup_existing(&component.install_path, &component.name).await?;
        }

        // Extract and install based on artifact type
        let is_tar_zst = artifact_path.extension().map(|e| e == "zst").unwrap_or(false) ||
                         component.artifact.ends_with(".tar.zst");
        let is_tar_gz = artifact_path.extension().map(|e| e == "gz").unwrap_or(false) ||
                        component.artifact.ends_with(".tar.gz");
        
        if is_tar_zst {
            self.extract_and_install_tar_zst(artifact_path, component).await?;
        } else if is_tar_gz {
            self.extract_and_install_tar_gz(artifact_path, component).await?;
        } else {
            // Direct file copy for non-archive artifacts
            self.install_single_file(artifact_path, &component.install_path, component.permission_mode()).await?;
        }

        // Write version file
        self.write_version_file(&component.name, &component.version).await?;

        // Restart service if needed
        if let Some(service) = &component.restart_service {
            self.restart_service(service).await?;
        }

        info!(component = %component.name, "Component update applied successfully");
        Ok(())
    }

    /// Backup existing file before update
    #[instrument(skip(self))]
    async fn backup_existing(&self, path: &str, component_name: &str) -> Result<()> {
        let src = Path::new(path);
        if !src.exists() {
            info!(path = %path, "No existing file to backup");
            return Ok(());
        }

        // Create backup directory
        fs::create_dir_all(&self.backup_dir).await?;

        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let backup_name = format!("{}_{}", component_name, timestamp);
        let backup_path = self.backup_dir.join(backup_name);

        if src.is_dir() {
            // For directories, copy recursively
            copy_dir_recursive(src, &backup_path).await?;
        } else {
            fs::copy(src, &backup_path).await?;
        }

        info!(
            src = %path,
            backup = %backup_path.display(),
            "Backed up existing file"
        );

        // Clean old backups (keep last 3)
        self.cleanup_old_backups(component_name).await?;

        Ok(())
    }

    /// Extract tar.zst archive and install contents
    #[instrument(skip(self))]
    async fn extract_and_install_tar_zst(
        &self,
        archive_path: &Path,
        component: &Component,
    ) -> Result<()> {
        let install_path = Path::new(&component.install_path);
        
        // Create parent directory if needed
        if let Some(parent) = install_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // For single binary components, extract directly to install path
        // For directory components (like host-ui), extract to the directory
        
        if component.name == "host-ui" || install_path.to_string_lossy().ends_with('/') {
            // Directory extraction
            fs::create_dir_all(install_path).await?;
            
            // Use tar with zstd decompression
            let output = Command::new("tar")
                .args([
                    "-x",
                    "--zstd",
                    "-f",
                    archive_path.to_str().unwrap(),
                    "-C",
                    install_path.to_str().unwrap(),
                ])
                .output()
                .context("Failed to run tar command")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                bail!("Failed to extract archive: {}", stderr);
            }
        } else {
            // Single binary extraction to temp, then move
            let temp_dir = PathBuf::from("/tmp/quantix-update-extract");
            fs::create_dir_all(&temp_dir).await?;

            let output = Command::new("tar")
                .args([
                    "-x",
                    "--zstd",
                    "-f",
                    archive_path.to_str().unwrap(),
                    "-C",
                    temp_dir.to_str().unwrap(),
                ])
                .output()
                .context("Failed to run tar command")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                bail!("Failed to extract archive: {}", stderr);
            }

            // Find the extracted binary (should be same name as component or in root)
            let extracted = temp_dir.join(&component.name);
            let extracted = if extracted.exists() {
                extracted
            } else {
                // Try to find any file in temp dir
                let mut entries = fs::read_dir(&temp_dir).await?;
                let mut found = None;
                while let Some(entry) = entries.next_entry().await? {
                    if entry.file_type().await?.is_file() {
                        found = Some(entry.path());
                        break;
                    }
                }
                found.ok_or_else(|| anyhow::anyhow!("No file found in extracted archive"))?
            };

            // Atomic move to install path
            self.atomic_move(&extracted, install_path, component.permission_mode()).await?;

            // Cleanup temp dir
            let _ = fs::remove_dir_all(&temp_dir).await;
        }

        Ok(())
    }

    /// Extract tar.gz archive and install contents
    #[instrument(skip(self))]
    async fn extract_and_install_tar_gz(
        &self,
        archive_path: &Path,
        component: &Component,
    ) -> Result<()> {
        let install_path = Path::new(&component.install_path);
        
        // Create parent directory if needed
        if let Some(parent) = install_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        // For single binary components, extract directly to install path
        // For directory components (like host-ui), extract to the directory
        
        if component.name == "host-ui" || install_path.to_string_lossy().ends_with('/') {
            // Directory extraction
            fs::create_dir_all(install_path).await?;
            
            // Use tar with gzip decompression
            let output = Command::new("tar")
                .args([
                    "-xzf",
                    archive_path.to_str().unwrap(),
                    "-C",
                    install_path.to_str().unwrap(),
                ])
                .output()
                .context("Failed to run tar command")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                bail!("Failed to extract gzip archive: {}", stderr);
            }
        } else {
            // Single binary extraction to temp, then move
            let temp_dir = PathBuf::from("/tmp/quantix-update-extract");
            fs::create_dir_all(&temp_dir).await?;

            let output = Command::new("tar")
                .args([
                    "-xzf",
                    archive_path.to_str().unwrap(),
                    "-C",
                    temp_dir.to_str().unwrap(),
                ])
                .output()
                .context("Failed to run tar command")?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                bail!("Failed to extract gzip archive: {}", stderr);
            }

            // Find the extracted binary (should be same name as component or in root)
            let extracted = temp_dir.join(&component.name);
            let extracted = if extracted.exists() {
                extracted
            } else {
                // Try common binary names
                let alt_name = if component.name == "qx-node" {
                    temp_dir.join("limiquantix-node")
                } else if component.name == "qx-console" {
                    temp_dir.join("qx-console")
                } else {
                    temp_dir.join(&component.name)
                };
                
                if alt_name.exists() {
                    alt_name
                } else {
                    // Try to find any file in temp dir
                    let mut entries = fs::read_dir(&temp_dir).await?;
                    let mut found = None;
                    while let Some(entry) = entries.next_entry().await? {
                        if entry.file_type().await?.is_file() {
                            found = Some(entry.path());
                            break;
                        }
                    }
                    found.ok_or_else(|| anyhow::anyhow!("No file found in extracted archive"))?
                }
            };

            info!(
                extracted = %extracted.display(),
                install_path = %install_path.display(),
                "Moving extracted binary to install path"
            );

            // Atomic move to install path
            self.atomic_move(&extracted, install_path, component.permission_mode()).await?;

            // Cleanup temp dir
            let _ = fs::remove_dir_all(&temp_dir).await;
        }

        Ok(())
    }

    /// Install a single file with atomic move
    #[instrument(skip(self))]
    async fn install_single_file(
        &self,
        src: &Path,
        dest: &str,
        mode: u32,
    ) -> Result<()> {
        let dest_path = Path::new(dest);
        self.atomic_move(src, dest_path, mode).await
    }

    /// Atomically move a file to its destination
    async fn atomic_move(&self, src: &Path, dest: &Path, mode: u32) -> Result<()> {
        // Create parent directory
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).await?;
        }

        // Use a temp file in the same directory for atomic rename
        let temp_dest = dest.with_extension("tmp");
        
        // Copy to temp location
        fs::copy(src, &temp_dest).await?;
        
        // Set permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(mode);
            fs::set_permissions(&temp_dest, perms).await?;
        }

        // Atomic rename
        fs::rename(&temp_dest, dest).await?;

        info!(dest = %dest.display(), "File installed");
        Ok(())
    }

    /// Write version file for a component
    async fn write_version_file(&self, component: &str, version: &str) -> Result<()> {
        let version_dir = PathBuf::from("/data/versions");
        fs::create_dir_all(&version_dir).await?;
        
        let version_file = version_dir.join(format!("{}.version", component));
        fs::write(&version_file, version).await?;
        
        info!(
            component = %component,
            version = %version,
            "Version file written"
        );
        Ok(())
    }

    /// Restart an OpenRC service
    #[instrument(skip(self))]
    async fn restart_service(&self, service: &str) -> Result<()> {
        info!(service = %service, "Restarting service");

        let output = Command::new("rc-service")
            .args([service, "restart"])
            .output()
            .context("Failed to run rc-service command")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(
                service = %service,
                error = %stderr,
                "Service restart failed, may need manual intervention"
            );
            // Don't fail the update, just warn
        } else {
            info!(service = %service, "Service restarted successfully");
        }

        Ok(())
    }

    /// Clean up old backups, keeping only the last N
    async fn cleanup_old_backups(&self, component: &str) -> Result<()> {
        let mut backups: Vec<_> = Vec::new();
        
        if !self.backup_dir.exists() {
            return Ok(());
        }

        let mut entries = fs::read_dir(&self.backup_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(component) {
                backups.push(entry.path());
            }
        }

        // Sort by modification time (newest first)
        backups.sort_by_key(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });
        backups.reverse();

        // Keep only the last 3
        for backup in backups.into_iter().skip(3) {
            info!(path = %backup.display(), "Removing old backup");
            if backup.is_dir() {
                let _ = fs::remove_dir_all(&backup).await;
            } else {
                let _ = fs::remove_file(&backup).await;
            }
        }

        Ok(())
    }

    /// Rollback a component to its backup
    #[instrument(skip(self))]
    pub async fn rollback_component(&self, component: &str, install_path: &str) -> Result<()> {
        info!(component = %component, "Rolling back component");

        // Find most recent backup
        let mut backups: Vec<_> = Vec::new();
        
        if !self.backup_dir.exists() {
            bail!("No backup directory found");
        }

        let mut entries = fs::read_dir(&self.backup_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(component) {
                backups.push(entry.path());
            }
        }

        if backups.is_empty() {
            bail!("No backups found for component: {}", component);
        }

        // Get most recent backup
        backups.sort_by_key(|p| {
            std::fs::metadata(p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
        });
        let backup_path = backups.last().unwrap();

        // Restore from backup
        let dest = Path::new(install_path);
        if dest.is_dir() {
            if dest.exists() {
                fs::remove_dir_all(dest).await?;
            }
            copy_dir_recursive(backup_path, dest).await?;
        } else {
            fs::copy(backup_path, dest).await?;
        }

        info!(
            component = %component,
            backup = %backup_path.display(),
            "Rollback complete"
        );

        Ok(())
    }
}

/// Recursively copy a directory
async fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<()> {
    fs::create_dir_all(dest).await?;
    
    let mut entries = fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let entry_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        
        if entry.file_type().await?.is_dir() {
            Box::pin(copy_dir_recursive(&entry_path, &dest_path)).await?;
        } else {
            fs::copy(&entry_path, &dest_path).await?;
        }
    }
    
    Ok(())
}
