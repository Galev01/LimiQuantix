//! Admin Authentication Module
//!
//! Handles admin credentials storage, password hashing, and authentication.
//! Credentials are stored in /quantix/admin.yaml with mode 0600.

use std::fs::{self, OpenOptions};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use anyhow::{Context, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info, warn};

/// Path to admin credentials file
const ADMIN_CONFIG_PATH: &str = "/quantix/admin.yaml";

/// Path to audit log
const AUDIT_LOG_PATH: &str = "/var/log/quantix-console.log";

/// Authentication errors
#[derive(Error, Debug)]
pub enum AuthError {
    #[error("No admin account configured")]
    NoAdminConfigured,

    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Account locked (too many failed attempts)")]
    AccountLocked,

    #[error("Configuration error: {0}")]
    ConfigError(String),
}

/// Admin configuration stored on disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminConfig {
    /// Admin username
    pub username: String,

    /// Argon2 password hash
    pub password_hash: String,

    /// SSH enabled flag
    pub ssh_enabled: bool,

    /// When the account was created
    pub created_at: DateTime<Utc>,

    /// Last successful login
    pub last_login: Option<DateTime<Utc>>,

    /// Number of failed login attempts since last success
    #[serde(default)]
    pub failed_attempts: u32,

    /// When the last failed attempt occurred
    pub last_failed_at: Option<DateTime<Utc>>,
}

impl AdminConfig {
    /// Create a new admin configuration
    pub fn new(username: &str, password: &str) -> Result<Self> {
        let password_hash = hash_password(password)?;

        Ok(Self {
            username: username.to_string(),
            password_hash,
            ssh_enabled: false,
            created_at: Utc::now(),
            last_login: None,
            failed_attempts: 0,
            last_failed_at: None,
        })
    }

    /// Check if the account is locked (more than 5 failed attempts in last 15 minutes)
    pub fn is_locked(&self) -> bool {
        if self.failed_attempts >= 5 {
            if let Some(last_failed) = self.last_failed_at {
                let lockout_duration = chrono::Duration::minutes(15);
                if Utc::now() - last_failed < lockout_duration {
                    return true;
                }
            }
        }
        false
    }

    /// Record a successful login
    pub fn record_success(&mut self) {
        self.last_login = Some(Utc::now());
        self.failed_attempts = 0;
        self.last_failed_at = None;
    }

    /// Record a failed login attempt
    pub fn record_failure(&mut self) {
        self.failed_attempts += 1;
        self.last_failed_at = Some(Utc::now());
    }
}

/// Authentication manager
pub struct AuthManager {
    config: Option<AdminConfig>,
}

impl AuthManager {
    /// Create a new auth manager, loading existing config if present
    pub fn new() -> Self {
        let config = load_admin_config().ok();
        Self { config }
    }

    /// Check if initial setup is required (no admin configured)
    pub fn needs_setup(&self) -> bool {
        self.config.is_none()
    }

    /// Perform initial setup with admin credentials
    pub fn setup(&mut self, username: &str, password: &str) -> Result<()> {
        if !self.needs_setup() {
            return Err(anyhow::anyhow!("Admin already configured"));
        }

        let config = AdminConfig::new(username, password)?;
        save_admin_config(&config)?;
        self.config = Some(config);

        audit_log("SETUP", username, "Admin account created");
        info!(username = %username, "Admin account created successfully");

        Ok(())
    }

    /// Authenticate with username and password
    pub fn authenticate(&mut self, username: &str, password: &str) -> Result<(), AuthError> {
        let config = self.config.as_mut().ok_or(AuthError::NoAdminConfigured)?;

        // Check if account is locked
        if config.is_locked() {
            audit_log("AUTH_LOCKED", username, "Authentication blocked - account locked");
            warn!(username = %username, "Authentication blocked - account locked");
            return Err(AuthError::AccountLocked);
        }

        // Check username
        if config.username != username {
            config.record_failure();
            let _ = save_admin_config(config);
            audit_log("AUTH_FAIL", username, "Invalid username");
            warn!(username = %username, "Authentication failed - invalid username");
            return Err(AuthError::InvalidCredentials);
        }

        // Verify password
        if !verify_password(password, &config.password_hash) {
            config.record_failure();
            let _ = save_admin_config(config);
            audit_log("AUTH_FAIL", username, "Invalid password");
            warn!(
                username = %username,
                failed_attempts = config.failed_attempts,
                "Authentication failed - invalid password"
            );
            return Err(AuthError::InvalidCredentials);
        }

        // Success
        config.record_success();
        let _ = save_admin_config(config);
        audit_log("AUTH_SUCCESS", username, "Authentication successful");
        info!(username = %username, "Authentication successful");

        Ok(())
    }

    /// Get the admin username
    pub fn username(&self) -> Option<&str> {
        self.config.as_ref().map(|c| c.username.as_str())
    }

    /// Check if SSH is enabled
    pub fn is_ssh_enabled(&self) -> bool {
        self.config.as_ref().map(|c| c.ssh_enabled).unwrap_or(false)
    }

    /// Set SSH enabled state (requires prior authentication)
    pub fn set_ssh_enabled(&mut self, enabled: bool) -> Result<()> {
        let config = self
            .config
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No admin configured"))?;

        config.ssh_enabled = enabled;
        save_admin_config(config)?;

        let action = if enabled { "SSH_ENABLED" } else { "SSH_DISABLED" };
        audit_log(action, &config.username, &format!("SSH access {}", if enabled { "enabled" } else { "disabled" }));
        info!(enabled = enabled, "SSH access state changed");

        Ok(())
    }

    /// Change admin password (requires prior authentication)
    pub fn change_password(&mut self, new_password: &str) -> Result<()> {
        let config = self
            .config
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("No admin configured"))?;

        config.password_hash = hash_password(new_password)?;
        save_admin_config(config)?;

        audit_log("PASSWORD_CHANGED", &config.username, "Admin password changed");
        info!(username = %config.username, "Admin password changed");

        Ok(())
    }
}

impl Default for AuthManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Hash a password using Argon2id
fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?
        .to_string();

    Ok(password_hash)
}

/// Verify a password against a stored hash
fn verify_password(password: &str, hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(hash) {
        Ok(h) => h,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

/// Load admin configuration from disk
fn load_admin_config() -> Result<AdminConfig> {
    let path = Path::new(ADMIN_CONFIG_PATH);
    if !path.exists() {
        return Err(anyhow::anyhow!("Admin config not found"));
    }

    let content = fs::read_to_string(path).context("Failed to read admin config")?;
    let config: AdminConfig =
        serde_yaml::from_str(&content).context("Failed to parse admin config")?;

    Ok(config)
}

/// Save admin configuration to disk with restricted permissions
fn save_admin_config(config: &AdminConfig) -> Result<()> {
    let path = Path::new(ADMIN_CONFIG_PATH);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).context("Failed to create config directory")?;
    }

    // Serialize config
    let content = serde_yaml::to_string(config).context("Failed to serialize admin config")?;

    // Write with restricted permissions (0600)
    fs::write(path, &content).context("Failed to write admin config")?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .context("Failed to set config permissions")?;

    Ok(())
}

/// Write an entry to the audit log
fn audit_log(action: &str, username: &str, message: &str) {
    let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
    let entry = format!("[{}] {} user={} {}\n", timestamp, action, username, message);

    // Ensure log directory exists
    if let Some(parent) = Path::new(AUDIT_LOG_PATH).parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Append to log file
    if let Err(e) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(AUDIT_LOG_PATH)
        .and_then(|mut file| {
            use std::io::Write;
            file.write_all(entry.as_bytes())
        })
    {
        error!(error = %e, "Failed to write audit log");
    }
}

/// Log a shell session start
pub fn audit_shell_start(username: &str) {
    audit_log("SHELL_START", username, "Emergency shell session started");
}

/// Log a shell session end
pub fn audit_shell_end(username: &str) {
    audit_log("SHELL_END", username, "Emergency shell session ended");
}

/// Log a service restart
pub fn audit_service_restart(username: &str, service: &str) {
    audit_log("SERVICE_RESTART", username, &format!("Restarted service: {}", service));
}

/// Log a reboot/shutdown action
pub fn audit_power_action(username: &str, action: &str) {
    audit_log("POWER_ACTION", username, &format!("Power action: {}", action));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hash_and_verify() {
        let password = "test_password_123";
        let hash = hash_password(password).unwrap();

        assert!(verify_password(password, &hash));
        assert!(!verify_password("wrong_password", &hash));
    }

    #[test]
    fn test_account_lockout() {
        let mut config = AdminConfig::new("admin", "password").unwrap();

        // Should not be locked initially
        assert!(!config.is_locked());

        // Record failures
        for _ in 0..5 {
            config.record_failure();
        }

        // Should be locked now
        assert!(config.is_locked());
    }

    #[test]
    fn test_successful_login_resets_failures() {
        let mut config = AdminConfig::new("admin", "password").unwrap();

        // Record some failures
        for _ in 0..3 {
            config.record_failure();
        }
        assert_eq!(config.failed_attempts, 3);

        // Successful login should reset
        config.record_success();
        assert_eq!(config.failed_attempts, 0);
        assert!(config.last_login.is_some());
    }
}
