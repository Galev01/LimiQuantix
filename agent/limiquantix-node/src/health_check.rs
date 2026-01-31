//! Health Check Module for Load Balancer Backend Health Monitoring.
//!
//! This module implements TCP and HTTP health probes for load balancer members.
//! It reports unhealthy members to the control plane for automatic removal from
//! the OVN load balancer VIP mappings.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tokio::time::timeout;
use tracing::{debug, error, info, warn};

// =============================================================================
// HEALTH CHECK TYPES
// =============================================================================

/// Configuration for a health check.
#[derive(Debug, Clone)]
pub struct HealthCheckConfig {
    /// Type of health check
    pub check_type: HealthCheckType,
    /// Interval between checks
    pub interval: Duration,
    /// Timeout for each check
    pub timeout: Duration,
    /// Number of failures before marking unhealthy
    pub unhealthy_threshold: u32,
    /// Number of successes before marking healthy
    pub healthy_threshold: u32,
    /// HTTP-specific configuration
    pub http_config: Option<HttpCheckConfig>,
}

impl Default for HealthCheckConfig {
    fn default() -> Self {
        Self {
            check_type: HealthCheckType::Tcp,
            interval: Duration::from_secs(10),
            timeout: Duration::from_secs(5),
            unhealthy_threshold: 3,
            healthy_threshold: 2,
            http_config: None,
        }
    }
}

/// Type of health check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthCheckType {
    /// TCP connect check - success if connection established
    Tcp,
    /// HTTP GET check - success if response matches expected codes
    Http,
    /// HTTPS GET check - success if response matches expected codes (TLS)
    Https,
}

/// HTTP-specific health check configuration.
#[derive(Debug, Clone)]
pub struct HttpCheckConfig {
    /// HTTP method (GET, HEAD)
    pub method: String,
    /// URL path to check
    pub path: String,
    /// Expected HTTP status codes (e.g., "200", "200-299")
    pub expected_codes: String,
    /// Optional Host header
    pub host_header: Option<String>,
}

impl Default for HttpCheckConfig {
    fn default() -> Self {
        Self {
            method: "GET".to_string(),
            path: "/".to_string(),
            expected_codes: "200".to_string(),
            host_header: None,
        }
    }
}

/// Health status of a member.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthStatus {
    /// Member is healthy and receiving traffic
    Healthy,
    /// Member is unhealthy and removed from rotation
    Unhealthy,
    /// Health status is being determined
    Unknown,
}

/// Internal state for tracking a member's health.
#[derive(Debug, Clone)]
struct MemberHealthState {
    /// Current health status
    status: HealthStatus,
    /// Consecutive successful checks
    consecutive_successes: u32,
    /// Consecutive failed checks
    consecutive_failures: u32,
    /// Last check time
    last_check: Instant,
    /// Last check result (true = success)
    last_check_success: bool,
    /// Last check error message (if failed)
    last_error: Option<String>,
}

impl Default for MemberHealthState {
    fn default() -> Self {
        Self {
            status: HealthStatus::Unknown,
            consecutive_successes: 0,
            consecutive_failures: 0,
            last_check: Instant::now(),
            last_check_success: false,
            last_error: None,
        }
    }
}

/// A load balancer member to health check.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct HealthCheckTarget {
    /// Load balancer ID
    pub load_balancer_id: String,
    /// Pool ID
    pub pool_id: String,
    /// Member ID
    pub member_id: String,
    /// Member address (IP or hostname)
    pub address: String,
    /// Member port
    pub port: u16,
}

/// Health check result.
#[derive(Debug, Clone)]
pub struct HealthCheckResult {
    /// Target that was checked
    pub target: HealthCheckTarget,
    /// Whether the check succeeded
    pub success: bool,
    /// Current health status after this check
    pub status: HealthStatus,
    /// Error message if check failed
    pub error: Option<String>,
    /// Response time in milliseconds
    pub response_time_ms: u64,
}

// =============================================================================
// HEALTH CHECK MANAGER
// =============================================================================

/// Manages health checks for load balancer members.
pub struct HealthCheckManager {
    /// Health check configurations per load balancer
    configs: Arc<RwLock<HashMap<String, HealthCheckConfig>>>,
    /// Health state per member (key: "lb_id:pool_id:member_id")
    member_states: Arc<RwLock<HashMap<String, MemberHealthState>>>,
    /// Active targets to check
    targets: Arc<RwLock<Vec<HealthCheckTarget>>>,
    /// Channel to report health changes to control plane
    status_sender: Option<tokio::sync::mpsc::Sender<HealthCheckResult>>,
}

impl HealthCheckManager {
    /// Create a new health check manager.
    pub fn new() -> Self {
        Self {
            configs: Arc::new(RwLock::new(HashMap::new())),
            member_states: Arc::new(RwLock::new(HashMap::new())),
            targets: Arc::new(RwLock::new(Vec::new())),
            status_sender: None,
        }
    }

    /// Set the status sender for reporting health changes.
    pub fn set_status_sender(&mut self, sender: tokio::sync::mpsc::Sender<HealthCheckResult>) {
        self.status_sender = Some(sender);
    }

    /// Register a health check configuration for a load balancer.
    pub async fn register_config(&self, load_balancer_id: &str, config: HealthCheckConfig) {
        let mut configs = self.configs.write().await;
        configs.insert(load_balancer_id.to_string(), config);
        info!(
            lb_id = %load_balancer_id,
            "Registered health check config"
        );
    }

    /// Unregister health check configuration for a load balancer.
    pub async fn unregister_config(&self, load_balancer_id: &str) {
        let mut configs = self.configs.write().await;
        configs.remove(load_balancer_id);
        info!(
            lb_id = %load_balancer_id,
            "Unregistered health check config"
        );
    }

    /// Add a target to health check.
    pub async fn add_target(&self, target: HealthCheckTarget) {
        let mut targets = self.targets.write().await;
        if !targets.contains(&target) {
            info!(
                lb_id = %target.load_balancer_id,
                member_id = %target.member_id,
                address = %target.address,
                port = %target.port,
                "Adding health check target"
            );
            targets.push(target);
        }
    }

    /// Remove a target from health checking.
    pub async fn remove_target(&self, target: &HealthCheckTarget) {
        let mut targets = self.targets.write().await;
        targets.retain(|t| t != target);
        
        // Also remove state
        let key = format!("{}:{}:{}", target.load_balancer_id, target.pool_id, target.member_id);
        let mut states = self.member_states.write().await;
        states.remove(&key);
        
        info!(
            lb_id = %target.load_balancer_id,
            member_id = %target.member_id,
            "Removed health check target"
        );
    }

    /// Get the current health status of a member.
    pub async fn get_member_status(&self, target: &HealthCheckTarget) -> HealthStatus {
        let key = format!("{}:{}:{}", target.load_balancer_id, target.pool_id, target.member_id);
        let states = self.member_states.read().await;
        states
            .get(&key)
            .map(|s| s.status)
            .unwrap_or(HealthStatus::Unknown)
    }

    /// Run a single health check cycle for all targets.
    pub async fn run_check_cycle(&self) -> Vec<HealthCheckResult> {
        let targets = self.targets.read().await.clone();
        let configs = self.configs.read().await.clone();
        
        let mut results = Vec::new();
        
        for target in targets {
            let config = configs
                .get(&target.load_balancer_id)
                .cloned()
                .unwrap_or_default();
            
            let result = self.check_target(&target, &config).await;
            
            // Update state and determine if status changed
            let state_changed = self.update_member_state(&target, &config, &result).await;
            
            if state_changed {
                // Report status change to control plane
                if let Some(sender) = &self.status_sender {
                    if let Err(e) = sender.send(result.clone()).await {
                        warn!(
                            error = %e,
                            "Failed to send health check result"
                        );
                    }
                }
            }
            
            results.push(result);
        }
        
        results
    }

    /// Check a single target.
    async fn check_target(&self, target: &HealthCheckTarget, config: &HealthCheckConfig) -> HealthCheckResult {
        let start = Instant::now();
        
        let (success, error) = match config.check_type {
            HealthCheckType::Tcp => self.tcp_check(target, config.timeout).await,
            HealthCheckType::Http | HealthCheckType::Https => {
                let http_config = config.http_config.clone().unwrap_or_default();
                let use_tls = config.check_type == HealthCheckType::Https;
                self.http_check(target, &http_config, config.timeout, use_tls).await
            }
        };
        
        let response_time_ms = start.elapsed().as_millis() as u64;
        
        // Get current status (will be updated after this)
        let status = self.get_member_status(target).await;
        
        debug!(
            lb_id = %target.load_balancer_id,
            member_id = %target.member_id,
            address = %target.address,
            success = %success,
            response_time_ms = %response_time_ms,
            "Health check completed"
        );
        
        HealthCheckResult {
            target: target.clone(),
            success,
            status,
            error,
            response_time_ms,
        }
    }

    /// Perform a TCP connect health check.
    async fn tcp_check(&self, target: &HealthCheckTarget, timeout_duration: Duration) -> (bool, Option<String>) {
        let addr = format!("{}:{}", target.address, target.port);
        
        match addr.parse::<SocketAddr>() {
            Ok(socket_addr) => {
                match timeout(timeout_duration, TcpStream::connect(socket_addr)).await {
                    Ok(Ok(_stream)) => {
                        // Connection successful
                        (true, None)
                    }
                    Ok(Err(e)) => {
                        (false, Some(format!("Connection failed: {}", e)))
                    }
                    Err(_) => {
                        (false, Some("Connection timeout".to_string()))
                    }
                }
            }
            Err(e) => {
                // Try DNS resolution for hostname
                match tokio::net::lookup_host(&addr).await {
                    Ok(mut addrs) => {
                        if let Some(socket_addr) = addrs.next() {
                            match timeout(timeout_duration, TcpStream::connect(socket_addr)).await {
                                Ok(Ok(_stream)) => (true, None),
                                Ok(Err(e)) => (false, Some(format!("Connection failed: {}", e))),
                                Err(_) => (false, Some("Connection timeout".to_string())),
                            }
                        } else {
                            (false, Some("No addresses found".to_string()))
                        }
                    }
                    Err(_) => {
                        (false, Some(format!("Failed to parse address: {}", e)))
                    }
                }
            }
        }
    }

    /// Perform an HTTP/HTTPS health check.
    async fn http_check(
        &self,
        target: &HealthCheckTarget,
        http_config: &HttpCheckConfig,
        timeout_duration: Duration,
        _use_tls: bool,
    ) -> (bool, Option<String>) {
        let addr = format!("{}:{}", target.address, target.port);
        
        // First establish TCP connection
        let stream = match timeout(timeout_duration, TcpStream::connect(&addr)).await {
            Ok(Ok(stream)) => stream,
            Ok(Err(e)) => return (false, Some(format!("Connection failed: {}", e))),
            Err(_) => return (false, Some("Connection timeout".to_string())),
        };
        
        // For now, do a simple HTTP request without TLS
        // In production, use hyper or reqwest with TLS support
        let host = http_config.host_header.as_deref().unwrap_or(&target.address);
        let request = format!(
            "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n",
            http_config.method, http_config.path, host
        );
        
        let (mut reader, mut writer) = stream.into_split();
        
        // Send request
        if let Err(e) = writer.write_all(request.as_bytes()).await {
            return (false, Some(format!("Failed to send request: {}", e)));
        }
        
        // Read response (just the status line)
        let mut response = vec![0u8; 1024];
        match timeout(timeout_duration, reader.read(&mut response)).await {
            Ok(Ok(n)) if n > 0 => {
                let response_str = String::from_utf8_lossy(&response[..n]);
                
                // Parse status code from first line: "HTTP/1.1 200 OK"
                if let Some(status_line) = response_str.lines().next() {
                    let parts: Vec<&str> = status_line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(status_code) = parts[1].parse::<u16>() {
                            let success = check_expected_codes(status_code, &http_config.expected_codes);
                            if success {
                                return (true, None);
                            } else {
                                return (false, Some(format!("Unexpected status code: {}", status_code)));
                            }
                        }
                    }
                }
                (false, Some("Invalid HTTP response".to_string()))
            }
            Ok(Ok(_)) => (false, Some("Empty response".to_string())),
            Ok(Err(e)) => (false, Some(format!("Failed to read response: {}", e))),
            Err(_) => (false, Some("Response timeout".to_string())),
        }
    }

    /// Update member state based on check result and return true if status changed.
    async fn update_member_state(
        &self,
        target: &HealthCheckTarget,
        config: &HealthCheckConfig,
        result: &HealthCheckResult,
    ) -> bool {
        let key = format!("{}:{}:{}", target.load_balancer_id, target.pool_id, target.member_id);
        let mut states = self.member_states.write().await;
        
        let state = states.entry(key).or_insert_with(MemberHealthState::default);
        let old_status = state.status;
        
        state.last_check = Instant::now();
        state.last_check_success = result.success;
        state.last_error = result.error.clone();
        
        if result.success {
            state.consecutive_successes += 1;
            state.consecutive_failures = 0;
            
            // Check if we should transition to healthy
            if state.consecutive_successes >= config.healthy_threshold {
                state.status = HealthStatus::Healthy;
            }
        } else {
            state.consecutive_failures += 1;
            state.consecutive_successes = 0;
            
            // Check if we should transition to unhealthy
            if state.consecutive_failures >= config.unhealthy_threshold {
                state.status = HealthStatus::Unhealthy;
            }
        }
        
        let status_changed = old_status != state.status;
        
        if status_changed {
            info!(
                lb_id = %target.load_balancer_id,
                member_id = %target.member_id,
                old_status = ?old_status,
                new_status = ?state.status,
                "Member health status changed"
            );
        }
        
        status_changed
    }

    /// Start the health check loop.
    pub async fn start_loop(self: Arc<Self>, mut shutdown: tokio::sync::broadcast::Receiver<()>) {
        info!("Starting health check loop");
        
        loop {
            // Get minimum interval from configs
            let interval = {
                let configs = self.configs.read().await;
                configs
                    .values()
                    .map(|c| c.interval)
                    .min()
                    .unwrap_or(Duration::from_secs(10))
            };
            
            tokio::select! {
                _ = tokio::time::sleep(interval) => {
                    let results = self.run_check_cycle().await;
                    debug!(
                        num_checks = %results.len(),
                        "Completed health check cycle"
                    );
                }
                _ = shutdown.recv() => {
                    info!("Health check loop shutting down");
                    break;
                }
            }
        }
    }
}

impl Default for HealthCheckManager {
    fn default() -> Self {
        Self::new()
    }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Check if a status code matches the expected codes pattern.
fn check_expected_codes(status_code: u16, expected: &str) -> bool {
    // Handle patterns like "200", "200-299", "200,201,202"
    for part in expected.split(',') {
        let part = part.trim();
        if part.contains('-') {
            // Range pattern: "200-299"
            let range: Vec<&str> = part.split('-').collect();
            if range.len() == 2 {
                if let (Ok(start), Ok(end)) = (range[0].parse::<u16>(), range[1].parse::<u16>()) {
                    if status_code >= start && status_code <= end {
                        return true;
                    }
                }
            }
        } else {
            // Single code: "200"
            if let Ok(code) = part.parse::<u16>() {
                if status_code == code {
                    return true;
                }
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_expected_codes_single() {
        assert!(check_expected_codes(200, "200"));
        assert!(!check_expected_codes(201, "200"));
    }

    #[test]
    fn test_check_expected_codes_range() {
        assert!(check_expected_codes(200, "200-299"));
        assert!(check_expected_codes(250, "200-299"));
        assert!(check_expected_codes(299, "200-299"));
        assert!(!check_expected_codes(300, "200-299"));
    }

    #[test]
    fn test_check_expected_codes_multi() {
        assert!(check_expected_codes(200, "200,201,202"));
        assert!(check_expected_codes(202, "200,201,202"));
        assert!(!check_expected_codes(203, "200,201,202"));
    }

    #[test]
    fn test_check_expected_codes_mixed() {
        assert!(check_expected_codes(200, "200,300-399"));
        assert!(check_expected_codes(302, "200,300-399"));
        assert!(!check_expected_codes(500, "200,300-399"));
    }
}
