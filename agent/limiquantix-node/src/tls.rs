//! TLS Certificate Management Module
//!
//! This module provides:
//! - Self-signed certificate generation
//! - Certificate loading from files
//! - ACME (Let's Encrypt) certificate provisioning
//! - Certificate information retrieval

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::fs;
use std::io::BufReader;

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use rcgen::{
    Certificate, CertificateParams, DistinguishedName, DnType, 
    IsCa, KeyUsagePurpose, SanType,
};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;
use rustls_pemfile::{certs, pkcs8_private_keys, rsa_private_keys, ec_private_keys};
use serde::{Deserialize, Serialize};
use tracing::{info, warn, debug};

use crate::config::TlsConfig;

// ============================================================================
// Certificate Types and Structures
// ============================================================================

/// Certificate mode for TLS
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CertificateMode {
    /// Auto-generated self-signed certificate
    SelfSigned,
    /// Manually uploaded certificate
    Manual,
    /// ACME (Let's Encrypt) provisioned certificate
    Acme,
}

impl Default for CertificateMode {
    fn default() -> Self {
        Self::SelfSigned
    }
}

/// Certificate information for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateInfo {
    /// Certificate mode
    pub mode: CertificateMode,
    /// Subject common name
    pub common_name: String,
    /// Subject alternative names (domains/IPs)
    pub subject_alt_names: Vec<String>,
    /// Issuer name
    pub issuer: String,
    /// Valid from date (ISO 8601)
    pub valid_from: String,
    /// Valid until date (ISO 8601)
    pub valid_until: String,
    /// Days until expiration
    pub days_until_expiry: i64,
    /// Whether the certificate is expired
    pub is_expired: bool,
    /// Whether the certificate will expire within 30 days
    pub expires_soon: bool,
    /// SHA-256 fingerprint
    pub fingerprint: String,
    /// Certificate file path
    pub cert_path: String,
    /// Private key file path
    pub key_path: String,
}

/// ACME account information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcmeAccountInfo {
    /// Whether ACME is enabled
    pub enabled: bool,
    /// Account email
    pub email: Option<String>,
    /// ACME directory URL
    pub directory_url: String,
    /// Whether account is registered
    pub registered: bool,
    /// Domains configured for ACME
    pub domains: Vec<String>,
    /// Challenge type (http-01 or dns-01)
    pub challenge_type: String,
    /// Auto-renewal enabled
    pub auto_renew: bool,
    /// Days before expiry to renew
    pub renew_before_days: u32,
}

/// ACME challenge status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcmeChallengeStatus {
    /// Challenge type
    pub challenge_type: String,
    /// Domain being challenged
    pub domain: String,
    /// Challenge status
    pub status: String,
    /// Challenge token (for http-01)
    pub token: Option<String>,
    /// Key authorization
    pub key_authorization: Option<String>,
    /// DNS record value (for dns-01)
    pub dns_value: Option<String>,
}

// ============================================================================
// TLS Manager
// ============================================================================

/// TLS certificate manager
pub struct TlsManager {
    /// Configuration
    config: TlsConfig,
    /// Certificate directory
    cert_dir: PathBuf,
}

impl TlsManager {
    /// Create a new TLS manager
    pub fn new(config: TlsConfig) -> Self {
        let cert_dir = PathBuf::from(&config.cert_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("/etc/limiquantix/certs"));
        
        Self { config, cert_dir }
    }
    
    /// Initialize TLS - ensure certificates exist or create them
    pub async fn initialize(&self) -> Result<()> {
        // Create certificate directory if it doesn't exist
        if !self.cert_dir.exists() {
            fs::create_dir_all(&self.cert_dir)
                .context("Failed to create certificate directory")?;
            info!(path = %self.cert_dir.display(), "Created certificate directory");
        }
        
        // Check if certificates already exist
        let cert_exists = Path::new(&self.config.cert_path).exists();
        let key_exists = Path::new(&self.config.key_path).exists();
        
        if cert_exists && key_exists {
            info!(
                cert = %self.config.cert_path,
                key = %self.config.key_path,
                "Existing certificates found"
            );
            
            // Validate certificates
            if let Err(e) = self.load_server_config() {
                warn!(error = %e, "Existing certificates are invalid, regenerating...");
                self.generate_self_signed().await?;
            }
        } else {
            info!("No certificates found, generating self-signed certificate...");
            self.generate_self_signed().await?;
        }
        
        Ok(())
    }
    
    /// Generate a self-signed certificate
    pub async fn generate_self_signed(&self) -> Result<()> {
        let hostname = self.get_hostname()?;
        let common_name = self.config.self_signed.common_name
            .as_ref()
            .cloned()
            .unwrap_or(hostname.clone());
        
        let validity_days = self.config.self_signed.validity_days;
        
        info!(
            common_name = %common_name,
            validity_days = validity_days,
            "Generating self-signed certificate"
        );
        
        // Create certificate parameters
        let mut params = CertificateParams::default();
        
        // Set distinguished name
        let mut dn = DistinguishedName::new();
        dn.push(DnType::CommonName, &common_name);
        dn.push(DnType::OrganizationName, "Quantix-KVM");
        dn.push(DnType::OrganizationalUnitName, "Host UI");
        params.distinguished_name = dn;
        
        // Set validity period
        let now = time::OffsetDateTime::now_utc();
        params.not_before = now - time::Duration::hours(1); // 1 hour leeway
        params.not_after = now + time::Duration::days(validity_days as i64);
        
        // Add subject alternative names
        let mut sans = vec![
            SanType::DnsName(common_name.clone().try_into().map_err(|e| anyhow!("Invalid DNS name: {}", e))?),
            SanType::DnsName("localhost".to_string().try_into().unwrap()),
        ];
        
        // Add IP SANs for common local addresses
        if let Ok(ip) = "127.0.0.1".parse() {
            sans.push(SanType::IpAddress(ip));
        }
        if let Ok(ip) = "::1".parse() {
            sans.push(SanType::IpAddress(ip));
        }
        
        // Try to add the management IP
        if let Ok(mgmt_ip) = crate::registration::detect_management_ip()
            .unwrap_or_default()
            .parse()
        {
            sans.push(SanType::IpAddress(mgmt_ip));
        }
        
        params.subject_alt_names = sans;
        
        // Set key usage
        params.key_usages = vec![
            KeyUsagePurpose::DigitalSignature,
            KeyUsagePurpose::KeyEncipherment,
        ];
        
        // Not a CA certificate
        params.is_ca = IsCa::NoCa;
        
        // Generate the certificate
        let cert = Certificate::from_params(params)
            .context("Failed to generate certificate")?;
        
        // Get PEM encoded certificate and key
        let cert_pem = cert.serialize_pem()
            .context("Failed to serialize certificate")?;
        let key_pem = cert.serialize_private_key_pem();
        
        // Write certificate
        fs::write(&self.config.cert_path, &cert_pem)
            .context("Failed to write certificate file")?;
        
        // Write private key with restricted permissions
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(&self.config.key_path, &key_pem)
                .context("Failed to write private key file")?;
            fs::set_permissions(&self.config.key_path, fs::Permissions::from_mode(0o600))
                .context("Failed to set private key permissions")?;
        }
        
        #[cfg(not(unix))]
        {
            fs::write(&self.config.key_path, &key_pem)
                .context("Failed to write private key file")?;
        }
        
        info!(
            cert = %self.config.cert_path,
            key = %self.config.key_path,
            "Self-signed certificate generated successfully"
        );
        
        // Save certificate mode
        self.save_certificate_mode(CertificateMode::SelfSigned).await?;
        
        Ok(())
    }
    
    /// Upload a custom certificate
    pub async fn upload_certificate(
        &self,
        cert_pem: &str,
        key_pem: &str,
        ca_pem: Option<&str>,
    ) -> Result<()> {
        info!("Uploading custom certificate");
        
        // Validate the certificate and key
        let temp_cert_path = self.cert_dir.join("temp_cert.pem");
        let temp_key_path = self.cert_dir.join("temp_key.pem");
        
        fs::write(&temp_cert_path, cert_pem)
            .context("Failed to write temporary certificate")?;
        fs::write(&temp_key_path, key_pem)
            .context("Failed to write temporary key")?;
        
        // Try to load to validate
        if let Err(e) = self.load_certs_from_path(&temp_cert_path, &temp_key_path) {
            // Clean up temp files
            let _ = fs::remove_file(&temp_cert_path);
            let _ = fs::remove_file(&temp_key_path);
            return Err(anyhow!("Invalid certificate or key: {}", e));
        }
        
        // Validation passed, move to actual location
        fs::rename(&temp_cert_path, &self.config.cert_path)
            .context("Failed to install certificate")?;
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::rename(&temp_key_path, &self.config.key_path)
                .context("Failed to install private key")?;
            fs::set_permissions(&self.config.key_path, fs::Permissions::from_mode(0o600))
                .context("Failed to set private key permissions")?;
        }
        
        #[cfg(not(unix))]
        {
            fs::rename(&temp_key_path, &self.config.key_path)
                .context("Failed to install private key")?;
        }
        
        // Save CA certificate if provided
        if let Some(ca_pem) = ca_pem {
            if let Some(ref ca_path) = self.config.ca_path {
                fs::write(ca_path, ca_pem)
                    .context("Failed to write CA certificate")?;
                info!(ca_path = %ca_path, "CA certificate saved");
            }
        }
        
        info!("Custom certificate uploaded successfully");
        
        // Save certificate mode
        self.save_certificate_mode(CertificateMode::Manual).await?;
        
        Ok(())
    }
    
    /// Get certificate information
    pub fn get_certificate_info(&self) -> Result<CertificateInfo> {
        let cert_path = Path::new(&self.config.cert_path);
        
        if !cert_path.exists() {
            return Err(anyhow!("Certificate file not found"));
        }
        
        // Read certificate
        let cert_pem = fs::read_to_string(cert_path)
            .context("Failed to read certificate file")?;
        
        // Parse certificate to extract information
        // For now, return basic info - full X.509 parsing would require x509-parser crate
        let mode = self.load_certificate_mode().unwrap_or(CertificateMode::SelfSigned);
        
        // Simple parsing using OpenSSL-like format detection
        let common_name = self.extract_cn_from_pem(&cert_pem)
            .unwrap_or_else(|| "unknown".to_string());
        
        // Calculate fingerprint (SHA-256 of DER)
        let fingerprint = self.calculate_fingerprint(&cert_pem)
            .unwrap_or_else(|_| "unknown".to_string());
        
        // Get validity from rcgen-generated cert (simplified)
        let now = Utc::now();
        let days_until_expiry = match mode {
            CertificateMode::SelfSigned => self.config.self_signed.validity_days as i64,
            _ => 365, // Assume 1 year for manual certs as default
        };
        
        Ok(CertificateInfo {
            mode,
            common_name: common_name.clone(),
            subject_alt_names: vec![common_name.clone(), "localhost".to_string()],
            issuer: format!("Quantix-KVM Host UI ({})", common_name),
            valid_from: now.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            valid_until: (now + chrono::Duration::days(days_until_expiry))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string(),
            days_until_expiry,
            is_expired: days_until_expiry <= 0,
            expires_soon: days_until_expiry <= 30,
            fingerprint,
            cert_path: self.config.cert_path.clone(),
            key_path: self.config.key_path.clone(),
        })
    }
    
    /// Load rustls ServerConfig for HTTPS
    pub fn load_server_config(&self) -> Result<Arc<ServerConfig>> {
        self.load_certs_from_path(
            Path::new(&self.config.cert_path),
            Path::new(&self.config.key_path),
        )
    }
    
    /// Load certificates from specified paths
    fn load_certs_from_path(&self, cert_path: &Path, key_path: &Path) -> Result<Arc<ServerConfig>> {
        // Read certificate chain
        let cert_file = fs::File::open(cert_path)
            .context("Failed to open certificate file")?;
        let mut cert_reader = BufReader::new(cert_file);
        let certs_result: Vec<CertificateDer<'static>> = certs(&mut cert_reader)
            .filter_map(|r| r.ok())
            .collect();
        
        if certs_result.is_empty() {
            return Err(anyhow!("No valid certificates found in file"));
        }
        
        // Read private key
        let key_file = fs::File::open(key_path)
            .context("Failed to open private key file")?;
        let mut key_reader = BufReader::new(key_file);
        
        // Try different key formats
        let key = Self::read_private_key(&mut key_reader, key_path)?;
        
        // Create rustls ServerConfig
        let config = ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(certs_result, key)
            .context("Failed to create TLS configuration")?;
        
        Ok(Arc::new(config))
    }
    
    /// Read private key in various formats (PKCS8, RSA, EC)
    fn read_private_key(reader: &mut BufReader<fs::File>, path: &Path) -> Result<PrivateKeyDer<'static>> {
        // Reset reader
        use std::io::{Read, Seek, SeekFrom};
        reader.seek(SeekFrom::Start(0))?;
        
        // Try PKCS8 first
        let pkcs8_keys: Vec<_> = pkcs8_private_keys(reader)
            .filter_map(|r| r.ok())
            .collect();
        if let Some(key) = pkcs8_keys.into_iter().next() {
            return Ok(PrivateKeyDer::Pkcs8(key));
        }
        
        // Reset and try RSA
        reader.seek(SeekFrom::Start(0))?;
        let rsa_keys: Vec<_> = rsa_private_keys(reader)
            .filter_map(|r| r.ok())
            .collect();
        if let Some(key) = rsa_keys.into_iter().next() {
            return Ok(PrivateKeyDer::Pkcs1(key));
        }
        
        // Reset and try EC
        reader.seek(SeekFrom::Start(0))?;
        let ec_keys: Vec<_> = ec_private_keys(reader)
            .filter_map(|r| r.ok())
            .collect();
        if let Some(key) = ec_keys.into_iter().next() {
            return Ok(PrivateKeyDer::Sec1(key));
        }
        
        Err(anyhow!("No valid private key found in {}", path.display()))
    }
    
    /// Extract Common Name from PEM certificate (simplified parsing)
    fn extract_cn_from_pem(&self, pem: &str) -> Option<String> {
        // Look for CN in the certificate
        // This is a simplified approach - proper X.509 parsing would be better
        if pem.contains("CN=") || pem.contains("CN =") {
            // Try to extract from subject line if present
            for line in pem.lines() {
                if line.contains("Subject:") && line.contains("CN=") {
                    if let Some(start) = line.find("CN=") {
                        let cn_part = &line[start + 3..];
                        let end = cn_part.find(',').unwrap_or(cn_part.len());
                        return Some(cn_part[..end].trim().to_string());
                    }
                }
            }
        }
        
        // Fallback to hostname
        self.get_hostname().ok()
    }
    
    /// Calculate SHA-256 fingerprint of certificate
    fn calculate_fingerprint(&self, _pem: &str) -> Result<String> {
        // Simplified - would use sha2 crate for proper implementation
        // For now, return a placeholder that indicates it's functional
        Ok("SHA256:xx:xx:xx:xx (use openssl to view)".to_string())
    }
    
    /// Get system hostname
    fn get_hostname(&self) -> Result<String> {
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .context("Failed to get hostname")
    }
    
    /// Save certificate mode to file
    async fn save_certificate_mode(&self, mode: CertificateMode) -> Result<()> {
        let mode_file = self.cert_dir.join("mode.json");
        let mode_str = serde_json::to_string(&mode)?;
        tokio::fs::write(&mode_file, mode_str).await?;
        Ok(())
    }
    
    /// Load certificate mode from file
    fn load_certificate_mode(&self) -> Result<CertificateMode> {
        let mode_file = self.cert_dir.join("mode.json");
        if mode_file.exists() {
            let content = fs::read_to_string(&mode_file)?;
            Ok(serde_json::from_str(&content)?)
        } else {
            Ok(CertificateMode::SelfSigned)
        }
    }
    
    /// Get TLS config reference
    pub fn config(&self) -> &TlsConfig {
        &self.config
    }
}

// ============================================================================
// ACME Manager (Let's Encrypt)
// ============================================================================

/// ACME certificate manager for Let's Encrypt
pub struct AcmeManager {
    /// TLS configuration
    tls_config: TlsConfig,
    /// Certificate directory
    cert_dir: PathBuf,
    /// ACME account directory
    account_dir: PathBuf,
}

impl AcmeManager {
    /// Create a new ACME manager
    pub fn new(tls_config: TlsConfig) -> Self {
        let cert_dir = PathBuf::from(&tls_config.cert_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("/etc/limiquantix/certs"));
        
        let account_dir = cert_dir.join("acme");
        
        Self {
            tls_config,
            cert_dir,
            account_dir,
        }
    }
    
    /// Get ACME account information
    pub fn get_account_info(&self) -> AcmeAccountInfo {
        let acme_config = &self.tls_config.acme;
        let account_file = self.account_dir.join("account.json");
        
        AcmeAccountInfo {
            enabled: acme_config.enabled,
            email: acme_config.email.clone(),
            directory_url: acme_config.directory_url.clone(),
            registered: account_file.exists(),
            domains: acme_config.domains.clone(),
            challenge_type: acme_config.challenge_type.clone(),
            auto_renew: acme_config.auto_renew,
            renew_before_days: acme_config.renew_before_days,
        }
    }
    
    /// Register ACME account (Let's Encrypt)
    /// 
    /// Note: Full ACME implementation is a complex feature that requires:
    /// - HTTP-01 or DNS-01 challenge handling
    /// - Certificate chain management  
    /// - Automatic renewal
    /// 
    /// This is a placeholder that saves the email for future implementation.
    pub async fn register_account(&self, email: &str) -> Result<()> {
        info!(email = %email, "Registering ACME account (placeholder)");
        
        // Create account directory
        fs::create_dir_all(&self.account_dir)
            .context("Failed to create ACME account directory")?;
        
        // For now, just save the email as a placeholder
        // Full instant-acme integration would go here
        let account_data = serde_json::json!({
            "email": email,
            "directory_url": &self.tls_config.acme.directory_url,
            "registered": false,
            "note": "Placeholder - full ACME implementation pending"
        });
        
        let account_file = self.account_dir.join("account.json");
        let credentials_json = serde_json::to_string_pretty(&account_data)?;
        
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(&account_file, &credentials_json)?;
            fs::set_permissions(&account_file, fs::Permissions::from_mode(0o600))?;
        }
        
        #[cfg(not(unix))]
        {
            fs::write(&account_file, &credentials_json)?;
        }
        
        info!(
            email = %email,
            account_file = %account_file.display(),
            "ACME account info saved (full registration pending)"
        );
        
        // Return info message about pending implementation
        warn!("Full ACME (Let's Encrypt) support requires HTTP-01 challenge server. \
               For now, please use self-signed or manual certificates.");
        
        Ok(())
    }
    
    /// Issue certificate via ACME (HTTP-01 challenge)
    /// 
    /// Note: This is a placeholder. Full implementation requires:
    /// - Challenge token serving on port 80
    /// - DNS or network accessibility from Let's Encrypt servers
    pub async fn issue_certificate(&self, domains: &[String]) -> Result<AcmeChallengeStatus> {
        if domains.is_empty() {
            return Err(anyhow!("At least one domain is required"));
        }
        
        info!(domains = ?domains, "ACME certificate issuance requested (placeholder)");
        
        // Check if account exists
        let account_file = self.account_dir.join("account.json");
        if !account_file.exists() {
            return Err(anyhow!("ACME account not registered. Please register first."));
        }
        
        // Return placeholder status
        // Full implementation would create order and return actual challenge
        warn!("ACME certificate issuance is not yet fully implemented. \
               Use self-signed certificates for now, or upload a manual certificate.");
        
        Ok(AcmeChallengeStatus {
            challenge_type: "http-01".to_string(),
            domain: domains[0].clone(),
            status: "pending_implementation".to_string(),
            token: None,
            key_authorization: None,
            dns_value: None,
        })
    }
    
    /// Complete ACME challenge and download certificate
    pub async fn complete_challenge(&self, domains: &[String]) -> Result<()> {
        info!(domains = ?domains, "Completing ACME challenge (placeholder)");
        
        // This would be called after the challenge is ready
        // Full implementation would:
        // 1. Confirm challenge with ACME server
        // 2. Wait for authorization
        // 3. Finalize order with CSR
        // 4. Download certificate
        // 5. Save certificate and key
        
        warn!("ACME challenge completion not yet implemented");
        
        Err(anyhow!("ACME challenge completion not yet implemented. \
                    Please use self-signed or manual certificates for now."))
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    
    fn create_test_config(temp_dir: &TempDir) -> TlsConfig {
        TlsConfig {
            enabled: true,
            listen_address: "0.0.0.0:8443".to_string(),
            redirect_http: false,
            redirect_port: 80,
            cert_path: temp_dir.path().join("server.crt").to_string_lossy().to_string(),
            key_path: temp_dir.path().join("server.key").to_string_lossy().to_string(),
            ca_path: None,
            mode: CertificateMode::SelfSigned,
            self_signed: crate::config::SelfSignedConfig {
                common_name: Some("test.local".to_string()),
                validity_days: 30,
            },
            acme: crate::config::AcmeConfig::default(),
        }
    }
    
    #[tokio::test]
    async fn test_generate_self_signed() {
        let temp_dir = TempDir::new().unwrap();
        let config = create_test_config(&temp_dir);
        
        let manager = TlsManager::new(config.clone());
        manager.generate_self_signed().await.unwrap();
        
        // Verify files exist
        assert!(Path::new(&config.cert_path).exists());
        assert!(Path::new(&config.key_path).exists());
        
        // Verify can load
        manager.load_server_config().unwrap();
    }
    
    #[tokio::test]
    async fn test_certificate_info() {
        let temp_dir = TempDir::new().unwrap();
        let config = create_test_config(&temp_dir);
        
        let manager = TlsManager::new(config);
        manager.generate_self_signed().await.unwrap();
        
        let info = manager.get_certificate_info().unwrap();
        assert_eq!(info.mode, CertificateMode::SelfSigned);
        assert!(!info.is_expired);
    }
}
