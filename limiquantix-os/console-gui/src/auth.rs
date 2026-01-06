//! Authentication module for Quantix-OS Console
//!
//! Handles password hashing and verification using Argon2id.

use anyhow::{Context, Result};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use tracing::{error, info, warn};

use crate::config;

/// Hash a password using Argon2id
pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("Failed to hash password: {}", e))?;

    Ok(hash.to_string())
}

/// Verify a password against a stored hash
pub fn verify_password(username: &str, password: &str) -> Result<bool> {
    // Load admin config
    let admin_config = config::load_admin_config().context("Failed to load admin config")?;

    // Check username
    if username != admin_config.username {
        warn!("⚠️ Invalid username: {}", username);
        log_auth_attempt(username, false);
        return Ok(false);
    }

    // Check for account lockout
    if admin_config.failed_attempts >= 5 {
        if let Some(last_failed) = admin_config.last_failed_at {
            let lockout_duration = chrono::Duration::minutes(15);
            if chrono::Utc::now() < last_failed + lockout_duration {
                warn!("⚠️ Account locked out: {}", username);
                return Ok(false);
            }
        }
    }

    // Verify password
    let parsed_hash = PasswordHash::new(&admin_config.password_hash)
        .map_err(|e| anyhow::anyhow!("Invalid password hash: {}", e))?;

    let argon2 = Argon2::default();
    let result = argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok();

    if result {
        info!("✅ Password verified for user: {}", username);
        log_auth_attempt(username, true);

        // Reset failed attempts
        let mut updated_config = admin_config;
        updated_config.failed_attempts = 0;
        updated_config.last_login = Some(chrono::Utc::now());
        config::save_admin_config(&updated_config).ok();
    } else {
        warn!("⚠️ Invalid password for user: {}", username);
        log_auth_attempt(username, false);

        // Increment failed attempts
        let mut updated_config = admin_config;
        updated_config.failed_attempts += 1;
        updated_config.last_failed_at = Some(chrono::Utc::now());
        config::save_admin_config(&updated_config).ok();
    }

    Ok(result)
}

/// Log an authentication attempt
fn log_auth_attempt(username: &str, success: bool) {
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC");
    let status = if success {
        "AUTH_SUCCESS"
    } else {
        "AUTH_FAILURE"
    };

    let message = format!("[{}] {} user={}", timestamp, status, username);

    // Write to audit log
    if let Err(e) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/var/log/quantix-console.log")
        .and_then(|mut file| {
            use std::io::Write;
            writeln!(file, "{}", message)
        })
    {
        error!("❌ Failed to write audit log: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_password_hashing() {
        let password = "test_password_123";
        let hash = hash_password(password).unwrap();

        // Hash should be in PHC format
        assert!(hash.starts_with("$argon2id$"));

        // Verify the password
        let parsed_hash = PasswordHash::new(&hash).unwrap();
        let argon2 = Argon2::default();
        assert!(argon2
            .verify_password(password.as_bytes(), &parsed_hash)
            .is_ok());

        // Wrong password should fail
        assert!(argon2
            .verify_password(b"wrong_password", &parsed_hash)
            .is_err());
    }
}
