//! Update artifact downloader with resume support and verification
//!
//! This module handles downloading update artifacts from the update server,
//! with support for:
//! - HTTP range requests for resume capability
//! - SHA256 verification of downloaded files
//! - Progress callbacks for UI integration
//! - Concurrent downloads for multiple components

use std::path::{Path, PathBuf};
use std::collections::HashMap;
use sha2::{Sha256, Digest};
use tokio::fs::{self, File};
use tokio::io::{AsyncWriteExt, AsyncReadExt};
use tracing::{info, warn, error, instrument};
use anyhow::{Result, Context, bail};

use super::manifest::{Manifest, Component};
use super::status::UpdateProgress;

/// Downloads update artifacts from the update server
pub struct UpdateDownloader {
    /// Base URL of the update server
    server_url: String,
    /// Local staging directory for downloads
    staging_dir: PathBuf,
    /// HTTP client
    client: reqwest::Client,
}

impl UpdateDownloader {
    /// Create a new downloader
    pub fn new(server_url: String, staging_dir: PathBuf) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout for large files
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            server_url,
            staging_dir,
            client,
        }
    }

    /// Fetch the latest manifest from the update server
    #[instrument(skip(self))]
    pub async fn fetch_manifest(&self, channel: &str) -> Result<Manifest> {
        let url = format!(
            "{}/api/v1/quantix-os/manifest?channel={}",
            self.server_url, channel
        );

        info!(url = %url, "Fetching update manifest");

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to connect to update server")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            bail!("Update server returned error {}: {}", status, body);
        }

        let manifest: Manifest = response
            .json()
            .await
            .context("Failed to parse manifest JSON")?;

        info!(
            version = %manifest.version,
            components = manifest.components.len(),
            "Manifest fetched successfully"
        );

        Ok(manifest)
    }

    /// Download all components from a manifest
    #[instrument(skip(self, progress_callback))]
    pub async fn download_all<F>(
        &self,
        manifest: &Manifest,
        mut progress_callback: F,
    ) -> Result<HashMap<Component, PathBuf>>
    where
        F: FnMut(UpdateProgress),
    {
        // Ensure staging directory exists
        fs::create_dir_all(&self.staging_dir)
            .await
            .context("Failed to create staging directory")?;

        let mut results = HashMap::new();
        let total_size: u64 = manifest.components.iter().map(|c| c.size_bytes).sum();
        let mut downloaded_total: u64 = 0;

        for component in &manifest.components {
            info!(
                component = %component.name,
                size = component.size_bytes,
                "Downloading component"
            );

            // Report progress
            progress_callback(UpdateProgress {
                current_component: component.name.clone(),
                downloaded_bytes: downloaded_total,
                total_bytes: total_size,
                percentage: ((downloaded_total as f64 / total_size as f64) * 100.0) as u8,
            });

            let artifact_path = self.download_artifact(
                &manifest.version,
                &manifest.channel,
                component,
            ).await.with_context(|| {
                format!("Failed to download component: {}", component.name)
            })?;

            // Verify checksum
            self.verify_checksum(&artifact_path, &component.sha256).await
                .with_context(|| format!("Checksum verification failed for: {}", component.name))?;

            downloaded_total += component.size_bytes;
            results.insert(component.clone(), artifact_path);

            info!(component = %component.name, "Download complete and verified");
        }

        // Final progress update
        progress_callback(UpdateProgress {
            current_component: "Complete".to_string(),
            downloaded_bytes: total_size,
            total_bytes: total_size,
            percentage: 100,
        });

        Ok(results)
    }

    /// Download a single artifact
    #[instrument(skip(self))]
    async fn download_artifact(
        &self,
        version: &str,
        channel: &str,
        component: &Component,
    ) -> Result<PathBuf> {
        let url = format!(
            "{}/api/v1/quantix-os/releases/{}/{}?channel={}",
            self.server_url, version, component.artifact, channel
        );

        let dest_path = self.staging_dir.join(&component.artifact);
        
        // Check if partial download exists
        let existing_size = if dest_path.exists() {
            fs::metadata(&dest_path).await?.len()
        } else {
            0
        };

        // Build request with range header for resume
        let mut request = self.client.get(&url);
        if existing_size > 0 && existing_size < component.size_bytes {
            info!(
                existing = existing_size,
                total = component.size_bytes,
                "Resuming download"
            );
            request = request.header("Range", format!("bytes={}-", existing_size));
        } else if existing_size >= component.size_bytes {
            info!("Artifact already fully downloaded");
            return Ok(dest_path);
        }

        let response = request
            .send()
            .await
            .context("Failed to start download")?;

        let status = response.status();
        if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
            let body = response.text().await.unwrap_or_default();
            bail!("Download failed with status {}: {}", status, body);
        }

        // Open file for writing (append if resuming)
        let mut file = if existing_size > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT {
            fs::OpenOptions::new()
                .append(true)
                .open(&dest_path)
                .await?
        } else {
            File::create(&dest_path).await?
        };

        // Stream the response body to file
        let mut stream = response.bytes_stream();
        use futures::StreamExt;
        
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("Error reading response chunk")?;
            file.write_all(&chunk).await?;
        }

        file.flush().await?;
        
        Ok(dest_path)
    }

    /// Verify SHA256 checksum of a downloaded file
    #[instrument(skip(self))]
    async fn verify_checksum(&self, path: &Path, expected: &str) -> Result<()> {
        let mut file = File::open(path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 64 * 1024]; // 64KB buffer

        loop {
            let n = file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }

        let actual = hex::encode(hasher.finalize());

        if actual != expected {
            error!(
                expected = %expected,
                actual = %actual,
                path = %path.display(),
                "Checksum mismatch"
            );
            bail!("Checksum mismatch: expected {}, got {}", expected, actual);
        }

        info!(path = %path.display(), "Checksum verified");
        Ok(())
    }

    /// Download a full system image
    #[instrument(skip(self, progress_callback))]
    pub async fn download_full_image<F>(
        &self,
        manifest: &Manifest,
        mut progress_callback: F,
    ) -> Result<Option<PathBuf>>
    where
        F: FnMut(UpdateProgress),
    {
        let full_image = match &manifest.full_image {
            Some(img) => img,
            None => return Ok(None),
        };

        info!(
            artifact = %full_image.artifact,
            size = full_image.size_bytes,
            "Downloading full system image"
        );

        let url = format!(
            "{}/api/v1/quantix-os/releases/{}/{}?channel={}",
            self.server_url, manifest.version, full_image.artifact, manifest.channel
        );

        let dest_path = self.staging_dir.join(&full_image.artifact);
        
        // Create staging directory
        fs::create_dir_all(&self.staging_dir).await?;

        let response = self.client
            .get(&url)
            .send()
            .await
            .context("Failed to start full image download")?;

        if !response.status().is_success() {
            bail!("Failed to download full image: {}", response.status());
        }

        let mut file = File::create(&dest_path).await?;
        let mut stream = response.bytes_stream();
        use futures::StreamExt;
        
        let mut downloaded: u64 = 0;
        
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;
            
            progress_callback(UpdateProgress {
                current_component: "system.squashfs".to_string(),
                downloaded_bytes: downloaded,
                total_bytes: full_image.size_bytes,
                percentage: ((downloaded as f64 / full_image.size_bytes as f64) * 100.0) as u8,
            });
        }

        file.flush().await?;

        // Verify checksum
        self.verify_checksum(&dest_path, &full_image.sha256).await?;

        info!("Full image download complete and verified");
        Ok(Some(dest_path))
    }

    /// Clean up staging directory
    pub async fn cleanup(&self) -> Result<()> {
        if self.staging_dir.exists() {
            fs::remove_dir_all(&self.staging_dir).await?;
        }
        Ok(())
    }
}
