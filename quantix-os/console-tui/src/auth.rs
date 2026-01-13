//! Authentication module for Quantix-OS Console TUI

// Authentication will be used when admin login screen is activated
#![allow(dead_code)]

use anyhow::Result;
use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Argon2,
};

use crate::config;

/// Verify a password against the stored hash
pub fn verify_password(username: &str, password: &str) -> Result<bool> {
    let admin_config = config::load_admin_config()?;

    if username != admin_config.username {
        return Ok(false);
    }

    let parsed_hash = PasswordHash::new(&admin_config.password_hash)
        .map_err(|e| anyhow::anyhow!("Invalid password hash: {}", e))?;

    let argon2 = Argon2::default();
    Ok(argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}
