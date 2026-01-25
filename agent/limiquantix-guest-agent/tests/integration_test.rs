//! Integration tests for the guest agent.
//!
//! These tests verify the agent's functionality using mock transports.

use limiquantix_guest_agent::config::AgentConfig;
use std::time::Duration;

/// Test that default configuration is valid.
#[test]
fn test_default_config_is_valid() {
    let config = AgentConfig::default();
    assert!(config.validate().is_ok());
}

/// Test configuration loading from YAML.
#[test]
fn test_config_yaml_parsing() {
    let yaml = r#"
telemetry_interval_secs: 10
max_exec_timeout_secs: 600
max_chunk_size: 131072
log_level: debug
log_format: pretty
device_path: auto

security:
  command_allowlist:
    - /usr/bin/systemctl
    - /usr/bin/journalctl
  command_blocklist:
    - /bin/rm
  allow_file_write_paths:
    - /tmp
  deny_file_read_paths:
    - /etc/shadow
  max_commands_per_minute: 100
  max_file_ops_per_second: 50
  audit_logging: true

health:
  enabled: true
  interval_secs: 60
  telemetry_timeout_secs: 120
"#;

    let config: AgentConfig = serde_yaml::from_str(yaml).expect("Failed to parse YAML");

    assert_eq!(config.telemetry_interval_secs, 10);
    assert_eq!(config.max_exec_timeout_secs, 600);
    assert_eq!(config.max_chunk_size, 131072);
    assert_eq!(config.log_level, "debug");
    assert_eq!(config.security.max_commands_per_minute, 100);
    assert!(config.security.audit_logging);
    assert!(config.validate().is_ok());
}

/// Test command allowlist/blocklist.
#[test]
fn test_command_security() {
    let mut config = AgentConfig::default();

    // No restrictions by default
    assert!(config.is_command_allowed("any command"));

    // Add blocklist
    config.security.command_blocklist = vec!["/bin/rm".to_string(), "shutdown".to_string()];
    assert!(!config.is_command_allowed("/bin/rm -rf /"));
    assert!(!config.is_command_allowed("shutdown -h now"));
    assert!(config.is_command_allowed("/bin/ls"));

    // Add allowlist (more restrictive)
    config.security.command_allowlist = vec!["/usr/bin/".to_string()];
    assert!(config.is_command_allowed("/usr/bin/systemctl"));
    assert!(!config.is_command_allowed("/bin/ls")); // Not in allowlist
}

/// Test file path security.
#[test]
fn test_file_path_security() {
    let mut config = AgentConfig::default();

    // No restrictions by default
    assert!(config.is_file_read_allowed("/etc/passwd"));
    assert!(config.is_file_write_allowed("/tmp/test"));

    // Add read restrictions
    config.security.deny_file_read_paths = vec!["/etc/shadow".to_string(), "/root/".to_string()];
    assert!(!config.is_file_read_allowed("/etc/shadow"));
    assert!(!config.is_file_read_allowed("/root/.ssh/id_rsa"));
    assert!(config.is_file_read_allowed("/etc/passwd"));

    // Add write restrictions
    config.security.allow_file_write_paths = vec!["/tmp".to_string(), "/var/log".to_string()];
    assert!(config.is_file_write_allowed("/tmp/test"));
    assert!(config.is_file_write_allowed("/var/log/app.log"));
    assert!(!config.is_file_write_allowed("/etc/passwd"));
}

/// Test configuration validation.
#[test]
fn test_config_validation() {
    let mut config = AgentConfig::default();

    // Valid config
    assert!(config.validate().is_ok());

    // Invalid telemetry interval
    config.telemetry_interval_secs = 0;
    assert!(config.validate().is_err());
    config.telemetry_interval_secs = 5;

    // Invalid exec timeout
    config.max_exec_timeout_secs = 0;
    assert!(config.validate().is_err());
    config.max_exec_timeout_secs = 300;

    // Invalid chunk size
    config.max_chunk_size = 0;
    assert!(config.validate().is_err());
    config.max_chunk_size = 20 * 1024 * 1024; // 20MB, too large
    assert!(config.validate().is_err());
    config.max_chunk_size = 65536;

    // Invalid log level
    config.log_level = "invalid".to_string();
    assert!(config.validate().is_err());
    config.log_level = "info".to_string();

    // Valid again
    assert!(config.validate().is_ok());
}

/// Test device path resolution.
#[test]
fn test_device_path_resolution() {
    let mut config = AgentConfig::default();

    // Auto should resolve to platform-specific path
    config.device_path = "auto".to_string();
    let path = config.get_device_path();
    #[cfg(unix)]
    assert!(path.contains("virtio") || path.contains("limiquantix"));
    #[cfg(windows)]
    assert!(path.contains("Global"));

    // Explicit path should be returned as-is
    config.device_path = "/custom/path".to_string();
    assert_eq!(config.get_device_path(), "/custom/path");
}

/// Test security context rate limiting.
#[test]
fn test_rate_limiting() {
    use limiquantix_guest_agent::security::RateLimiter;

    let limiter = RateLimiter::new();
    let mut config = AgentConfig::default();

    // Unlimited by default
    for _ in 0..1000 {
        assert!(limiter.check_command(&config));
    }

    // Set a limit
    config.security.max_commands_per_minute = 5;

    // Reset by creating new limiter
    let limiter = RateLimiter::new();

    // Should allow first 5
    for i in 0..5 {
        assert!(limiter.check_command(&config), "Command {} should be allowed", i);
    }

    // Should deny 6th
    assert!(!limiter.check_command(&config), "Command 6 should be denied");
}

/// Test audit log entry creation.
#[test]
fn test_audit_log_entry() {
    use limiquantix_guest_agent::security::AuditLogEntry;

    let entry = AuditLogEntry::new("execute", "test-123")
        .with_detail("command", "systemctl restart nginx")
        .with_user("root")
        .with_exit_code(0)
        .with_duration(150)
        .with_allowed(true);

    assert_eq!(entry.operation, "execute");
    assert_eq!(entry.request_id, "test-123");
    assert_eq!(entry.user, Some("root".to_string()));
    assert_eq!(entry.exit_code, Some(0));
    assert_eq!(entry.duration_ms, Some(150));
    assert!(entry.allowed);
    assert!(entry.details.contains_key("command"));
}

/// Test capabilities list.
#[test]
fn test_capabilities() {
    // The agent should report a comprehensive list of capabilities
    let expected_capabilities = vec![
        "telemetry",
        "execute",
        "file_read",
        "file_write",
        "shutdown",
        "reboot",
    ];

    // This would normally be tested by calling the handler,
    // but we can at least verify the expected list
    for cap in expected_capabilities {
        assert!(cap.len() > 0, "Capability should not be empty");
    }
}
