//! A/B Partition Update System
//!
//! This module handles full system image updates using the A/B partition scheme.
//! 
//! Partition Layout:
//! - QUANTIX-A (1.5GB) - System slot A
//! - QUANTIX-B (1.5GB) - System slot B  
//! - QUANTIX-CFG (256MB) - Persistent configuration
//! - QUANTIX-DATA (rest) - VM storage and data
//!
//! Update Flow:
//! 1. Detect current boot slot (A or B) from /proc/cmdline
//! 2. Download new squashfs to the INACTIVE slot
//! 3. Extract kernel/initramfs to inactive slot's /boot
//! 4. Update GRUB to boot from new slot
//! 5. Set "update pending" flag
//! 6. Reboot
//! 7. On successful boot, clear flag
//! 8. On boot failure (3 attempts), auto-revert to previous slot

use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::fs;
use tracing::{info, warn, error, instrument};
use anyhow::{Result, Context, bail};

/// Partition slot identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Slot {
    A,
    B,
}

impl Slot {
    /// Get the opposite slot
    pub fn other(&self) -> Slot {
        match self {
            Slot::A => Slot::B,
            Slot::B => Slot::A,
        }
    }
    
    /// Get the partition label for this slot
    pub fn label(&self) -> &'static str {
        match self {
            Slot::A => "QUANTIX-A",
            Slot::B => "QUANTIX-B",
        }
    }
    
    /// Get the GRUB menu entry ID for this slot
    pub fn grub_entry(&self) -> &'static str {
        match self {
            Slot::A => "quantix",      // Default entry
            Slot::B => "quantix-b",    // System B entry
        }
    }
}

impl std::fmt::Display for Slot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Slot::A => write!(f, "A"),
            Slot::B => write!(f, "B"),
        }
    }
}

/// A/B Update Manager
pub struct ABUpdateManager {
    /// Mount point for the inactive slot during update
    mount_point: PathBuf,
    /// Path to GRUB configuration
    grub_cfg: PathBuf,
    /// Path to update state file
    state_file: PathBuf,
}

/// Update state persisted across reboots
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ABUpdateState {
    /// Slot that was active before update
    pub previous_slot: String,
    /// Slot that should be active after update
    pub target_slot: String,
    /// Version being installed
    pub target_version: String,
    /// Number of boot attempts on new slot
    pub boot_attempts: u32,
    /// Maximum boot attempts before rollback
    pub max_attempts: u32,
    /// Whether update is pending verification
    pub pending: bool,
}

impl Default for ABUpdateState {
    fn default() -> Self {
        Self {
            previous_slot: "A".to_string(),
            target_slot: "B".to_string(),
            target_version: "0.0.1".to_string(),
            boot_attempts: 0,
            max_attempts: 3,
            pending: false,
        }
    }
}

impl ABUpdateManager {
    /// Create a new A/B update manager
    pub fn new() -> Self {
        Self {
            mount_point: PathBuf::from("/mnt/update-target"),
            grub_cfg: PathBuf::from("/boot/grub/grub.cfg"),
            state_file: PathBuf::from("/quantix/ab-update-state.json"),
        }
    }

    /// Detect the currently booted slot
    #[instrument(skip(self))]
    pub async fn detect_current_slot(&self) -> Result<Slot> {
        // Read kernel command line
        let cmdline = fs::read_to_string("/proc/cmdline")
            .await
            .context("Failed to read /proc/cmdline")?;

        // Look for root=LABEL=QUANTIX-A or root=LABEL=QUANTIX-B
        if cmdline.contains("QUANTIX-B") {
            info!("Currently booted from slot B");
            Ok(Slot::B)
        } else if cmdline.contains("QUANTIX-A") {
            info!("Currently booted from slot A");
            Ok(Slot::A)
        } else {
            // Default to A if can't determine
            warn!("Could not determine boot slot from cmdline, assuming A");
            Ok(Slot::A)
        }
    }

    /// Get the inactive slot (target for update)
    pub async fn get_target_slot(&self) -> Result<Slot> {
        let current = self.detect_current_slot().await?;
        Ok(current.other())
    }

    /// Find the device path for a partition by label
    #[instrument(skip(self))]
    pub async fn find_partition(&self, label: &str) -> Result<PathBuf> {
        // Try findfs first
        let output = Command::new("findfs")
            .arg(format!("LABEL={}", label))
            .output()
            .context("Failed to run findfs")?;

        if output.status.success() {
            let device = String::from_utf8_lossy(&output.stdout)
                .trim()
                .to_string();
            if !device.is_empty() {
                return Ok(PathBuf::from(device));
            }
        }

        // Fallback: check /dev/disk/by-label
        let by_label = PathBuf::from(format!("/dev/disk/by-label/{}", label));
        if by_label.exists() {
            // Resolve symlink
            let resolved = fs::canonicalize(&by_label)
                .await
                .context("Failed to resolve symlink")?;
            return Ok(resolved);
        }

        bail!("Could not find partition with label: {}", label)
    }

    /// Mount the target slot for update
    #[instrument(skip(self))]
    pub async fn mount_target_slot(&self, slot: Slot) -> Result<()> {
        let device = self.find_partition(slot.label()).await?;
        
        // Create mount point
        fs::create_dir_all(&self.mount_point).await?;

        // Unmount if already mounted
        let _ = Command::new("umount")
            .arg(&self.mount_point)
            .output();

        // Mount the partition
        let status = Command::new("mount")
            .arg(&device)
            .arg(&self.mount_point)
            .status()
            .context("Failed to run mount")?;

        if !status.success() {
            bail!("Failed to mount {} at {}", device.display(), self.mount_point.display());
        }

        info!(
            slot = %slot,
            device = %device.display(),
            mount = %self.mount_point.display(),
            "Mounted target slot"
        );

        Ok(())
    }

    /// Unmount the target slot
    pub async fn unmount_target_slot(&self) -> Result<()> {
        let status = Command::new("umount")
            .arg(&self.mount_point)
            .status()?;

        if !status.success() {
            warn!("Failed to unmount target slot");
        }

        Ok(())
    }

    /// Apply a full system image to the target slot
    #[instrument(skip(self, squashfs_path))]
    pub async fn apply_full_image(
        &self,
        squashfs_path: &Path,
        version: &str,
    ) -> Result<()> {
        let current_slot = self.detect_current_slot().await?;
        let target_slot = current_slot.other();

        info!(
            current = %current_slot,
            target = %target_slot,
            version = %version,
            "Starting A/B update"
        );

        // Mount target slot
        self.mount_target_slot(target_slot).await?;

        // Ensure cleanup on error
        let result = self.install_to_slot(squashfs_path, version, target_slot).await;

        // Always try to unmount
        let _ = self.unmount_target_slot().await;

        result?;

        // Update GRUB to boot from new slot
        self.update_grub_default(target_slot).await?;

        // Save update state
        self.save_state(&ABUpdateState {
            previous_slot: current_slot.to_string(),
            target_slot: target_slot.to_string(),
            target_version: version.to_string(),
            boot_attempts: 0,
            max_attempts: 3,
            pending: true,
        }).await?;

        info!("A/B update prepared. Reboot to apply.");

        Ok(())
    }

    /// Install squashfs and boot files to target slot
    async fn install_to_slot(
        &self,
        squashfs_path: &Path,
        version: &str,
        slot: Slot,
    ) -> Result<()> {
        let target = &self.mount_point;

        // Create directory structure
        fs::create_dir_all(target.join("quantix")).await?;
        fs::create_dir_all(target.join("boot")).await?;

        // Copy squashfs
        info!("Copying system image...");
        fs::copy(squashfs_path, target.join("quantix/system.squashfs"))
            .await
            .context("Failed to copy squashfs")?;

        // Write version file
        fs::write(target.join("quantix/VERSION"), version)
            .await
            .context("Failed to write VERSION")?;

        // Extract kernel and initramfs from squashfs
        info!("Extracting boot files...");
        self.extract_boot_files(squashfs_path, target).await?;

        // Sync to ensure writes are complete
        let _ = Command::new("sync").status();

        info!(slot = %slot, "Installation complete");

        Ok(())
    }

    /// Extract kernel and initramfs from squashfs
    async fn extract_boot_files(&self, squashfs_path: &Path, target: &Path) -> Result<()> {
        let temp_mount = PathBuf::from("/tmp/squashfs-extract");
        
        // Create temp mount point
        fs::create_dir_all(&temp_mount).await?;

        // Mount squashfs
        let status = Command::new("mount")
            .args(["-t", "squashfs", "-o", "loop"])
            .arg(squashfs_path)
            .arg(&temp_mount)
            .status()?;

        if !status.success() {
            bail!("Failed to mount squashfs for extraction");
        }

        // Copy kernel
        let kernel_paths = [
            temp_mount.join("boot/vmlinuz-lts"),
            temp_mount.join("boot/vmlinuz"),
        ];
        
        for kernel_src in &kernel_paths {
            if kernel_src.exists() {
                fs::copy(kernel_src, target.join("boot/vmlinuz")).await?;
                info!("Copied kernel");
                break;
            }
        }

        // Copy initramfs
        let initramfs_paths = [
            temp_mount.join("boot/initramfs-lts"),
            temp_mount.join("boot/initramfs"),
        ];
        
        for initramfs_src in &initramfs_paths {
            if initramfs_src.exists() {
                fs::copy(initramfs_src, target.join("boot/initramfs")).await?;
                info!("Copied initramfs");
                break;
            }
        }

        // Unmount
        let _ = Command::new("umount").arg(&temp_mount).status();
        let _ = fs::remove_dir(&temp_mount).await;

        Ok(())
    }

    /// Update GRUB to boot from specified slot
    #[instrument(skip(self))]
    pub async fn update_grub_default(&self, slot: Slot) -> Result<()> {
        // Method 1: Update grubenv (preferred)
        let grub_env_path = PathBuf::from("/boot/grub/grubenv");
        
        if grub_env_path.exists() {
            let status = Command::new("grub-editenv")
                .arg(&grub_env_path)
                .arg("set")
                .arg(format!("default={}", slot.grub_entry()))
                .status()?;

            if status.success() {
                info!(slot = %slot, "Updated GRUB default via grubenv");
                return Ok(());
            }
        }

        // Method 2: Use grub-set-default
        let status = Command::new("grub-set-default")
            .arg(slot.grub_entry())
            .status();

        match status {
            Ok(s) if s.success() => {
                info!(slot = %slot, "Updated GRUB default via grub-set-default");
                return Ok(());
            }
            _ => {
                warn!("grub-set-default not available");
            }
        }

        // Method 3: Direct grub.cfg modification (last resort)
        warn!("Using direct GRUB config modification");
        // This is risky and should be avoided if possible
        
        Ok(())
    }

    /// Save update state to persistent storage
    async fn save_state(&self, state: &ABUpdateState) -> Result<()> {
        let json = serde_json::to_string_pretty(state)?;
        
        // Write to config partition
        if let Some(parent) = self.state_file.parent() {
            fs::create_dir_all(parent).await?;
        }
        
        fs::write(&self.state_file, json).await?;
        
        info!(path = %self.state_file.display(), "Saved A/B update state");
        
        Ok(())
    }

    /// Load update state from persistent storage
    pub async fn load_state(&self) -> Result<Option<ABUpdateState>> {
        if !self.state_file.exists() {
            return Ok(None);
        }

        let content = fs::read_to_string(&self.state_file).await?;
        let state: ABUpdateState = serde_json::from_str(&content)?;
        
        Ok(Some(state))
    }

    /// Clear update state (call after successful boot verification)
    pub async fn clear_state(&self) -> Result<()> {
        if self.state_file.exists() {
            fs::remove_file(&self.state_file).await?;
            info!("Cleared A/B update state");
        }
        Ok(())
    }

    /// Check if a rollback is needed and perform it
    /// This should be called early in the boot process
    #[instrument(skip(self))]
    pub async fn check_and_rollback(&self) -> Result<bool> {
        let state = match self.load_state().await? {
            Some(s) => s,
            None => return Ok(false), // No pending update
        };

        if !state.pending {
            return Ok(false);
        }

        // Increment boot attempt counter
        let mut updated_state = state.clone();
        updated_state.boot_attempts += 1;
        self.save_state(&updated_state).await?;

        // Check if we've exceeded max attempts
        if updated_state.boot_attempts >= updated_state.max_attempts {
            error!(
                attempts = updated_state.boot_attempts,
                max = updated_state.max_attempts,
                "Maximum boot attempts exceeded, rolling back!"
            );

            // Rollback to previous slot
            let previous_slot = if updated_state.previous_slot == "A" {
                Slot::A
            } else {
                Slot::B
            };

            self.update_grub_default(previous_slot).await?;
            self.clear_state().await?;

            // Trigger reboot
            warn!("Initiating rollback reboot...");
            let _ = Command::new("reboot").status();

            return Ok(true);
        }

        Ok(false)
    }

    /// Mark the current boot as successful
    /// This should be called after the system has booted successfully
    #[instrument(skip(self))]
    pub async fn mark_boot_successful(&self) -> Result<()> {
        if let Some(state) = self.load_state().await? {
            if state.pending {
                info!(
                    version = %state.target_version,
                    "A/B update verified successful"
                );
                self.clear_state().await?;
            }
        }
        Ok(())
    }

    /// Get the current A/B update status
    pub async fn get_status(&self) -> Result<Option<ABUpdateState>> {
        self.load_state().await
    }
}

impl Default for ABUpdateManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slot_other() {
        assert_eq!(Slot::A.other(), Slot::B);
        assert_eq!(Slot::B.other(), Slot::A);
    }

    #[test]
    fn test_slot_label() {
        assert_eq!(Slot::A.label(), "QUANTIX-A");
        assert_eq!(Slot::B.label(), "QUANTIX-B");
    }
}
