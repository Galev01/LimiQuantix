//! Control Plane Registration and Heartbeat.
//!
//! This module handles:
//! - Initial node registration with the control plane
//! - Periodic heartbeat to report node status
//! - Re-registration on connection loss

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing::{debug, info, warn};

use limiquantix_telemetry::TelemetryCollector;

use crate::config::Config;

/// Registration client for the control plane.
pub struct RegistrationClient {
    control_plane_address: String,
    hostname: String,
    management_ip: String,
    labels: std::collections::HashMap<String, String>,
    heartbeat_interval: Duration,
    telemetry: Arc<TelemetryCollector>,
    http_client: reqwest::Client,
    /// The server-assigned node ID (set after registration)
    registered_node_id: RwLock<Option<String>>,
}

impl RegistrationClient {
    /// Create a new registration client.
    pub fn new(
        config: &Config,
        telemetry: Arc<TelemetryCollector>,
    ) -> Self {
        let hostname = config.node.get_hostname();
        
        // Detect management IP
        let management_ip = detect_management_ip()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        
        Self {
            control_plane_address: config.control_plane.address.clone(),
            hostname,
            management_ip,
            labels: config.node.labels.clone(),
            heartbeat_interval: Duration::from_secs(config.control_plane.heartbeat_interval_secs),
            telemetry,
            http_client: reqwest::Client::new(),
            registered_node_id: RwLock::new(None),
        }
    }
    
    /// Register with the control plane.
    pub async fn register(&self) -> anyhow::Result<String> {
        info!(
            control_plane = %self.control_plane_address,
            hostname = %self.hostname,
            "Registering with control plane"
        );
        
        let telemetry = self.telemetry.collect();
        
        // Build registration request matching the proto format
        let request = serde_json::json!({
            "hostname": self.hostname,
            "managementIp": format!("{}:9090", self.management_ip),
            "labels": self.labels,
            "role": {
                "compute": true,
                "storage": false,
                "controlPlane": false
            },
            "cpuInfo": {
                "model": telemetry.cpu.model,
                "sockets": 1,
                "coresPerSocket": telemetry.cpu.physical_cores,
                "threadsPerCore": if telemetry.cpu.physical_cores > 0 { 
                    telemetry.cpu.logical_cores / telemetry.cpu.physical_cores 
                } else { 
                    1 
                },
                "features": []
            },
            "memoryInfo": {
                "totalMib": telemetry.memory.total_bytes / 1024 / 1024,
                "allocatableMib": telemetry.memory.available_bytes / 1024 / 1024
            }
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/RegisterNode",
            self.control_plane_address
        );
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await;
        
        match response {
            Ok(resp) => {
                if resp.status().is_success() {
                    let body = resp.text().await.unwrap_or_default();
                    
                    // Parse the response to get the server-assigned node ID
                    let node_id = match serde_json::from_str::<serde_json::Value>(&body) {
                        Ok(json) => {
                            json.get("id")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        }
                        Err(_) => None
                    };
                    
                    if let Some(id) = &node_id {
                        // Store the server-assigned node ID
                        *self.registered_node_id.write().await = Some(id.clone());
                        
                        info!(
                            node_id = %id,
                            hostname = %self.hostname,
                            "Successfully registered with control plane"
                        );
                        
                        Ok(id.clone())
                    } else {
                        warn!(
                            body = %body,
                            "Registration response missing node ID"
                        );
                        Err(anyhow::anyhow!("Registration response missing node ID"))
                    }
                } else {
                    let status = resp.status();
                    let body = resp.text().await.unwrap_or_default();
                    warn!(
                        status = %status,
                        body = %body,
                        "Registration request failed"
                    );
                    Err(anyhow::anyhow!("Registration failed: {} - {}", status, body))
                }
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "Failed to connect to control plane"
                );
                Err(anyhow::anyhow!("Connection failed: {}", e))
            }
        }
    }
    
    /// Send a heartbeat to the control plane.
    pub async fn heartbeat(&self) -> anyhow::Result<()> {
        // Get the registered node ID
        let node_id = self.registered_node_id.read().await.clone();
        let node_id = match node_id {
            Some(id) => id,
            None => {
                warn!("Cannot send heartbeat: not registered yet");
                return Err(anyhow::anyhow!("Not registered"));
            }
        };
        
        debug!(node_id = %node_id, "Sending heartbeat");
        
        let telemetry = self.telemetry.collect();
        
        // Build heartbeat request
        let request = serde_json::json!({
            "nodeId": node_id,
            "cpuUsagePercent": telemetry.cpu.usage_percent,
            "memoryUsedMib": telemetry.memory.used_bytes / 1024 / 1024,
            "memoryTotalMib": telemetry.memory.total_bytes / 1024 / 1024
        });
        
        let url = format!(
            "{}/limiquantix.compute.v1.NodeService/UpdateHeartbeat",
            self.control_plane_address
        );
        
        let response = self.http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await;
        
        match response {
            Ok(resp) if resp.status().is_success() => {
                debug!(node_id = %node_id, "Heartbeat acknowledged");
                Ok(())
            }
            Ok(resp) => {
                let status = resp.status();
                warn!(
                    node_id = %node_id,
                    status = %status,
                    "Heartbeat failed"
                );
                Err(anyhow::anyhow!("Heartbeat failed: {}", status))
            }
            Err(e) => {
                warn!(
                    node_id = %node_id,
                    error = %e,
                    "Failed to send heartbeat"
                );
                Err(anyhow::anyhow!("Heartbeat connection failed: {}", e))
            }
        }
    }
    
    /// Start the registration and heartbeat loop.
    /// 
    /// This will:
    /// 1. Attempt to register with the control plane
    /// 2. Retry registration on failure
    /// 3. Send periodic heartbeats after successful registration
    pub async fn run(&self) {
        // Initial registration with retry
        let mut retry_delay = Duration::from_secs(1);
        let max_retry_delay = Duration::from_secs(60);
        
        loop {
            match self.register().await {
                Ok(node_id) => {
                    info!(node_id = %node_id, "Registration complete, starting heartbeat loop");
                    break;
                }
                Err(e) => {
                    warn!(
                        error = %e,
                        retry_in_secs = retry_delay.as_secs(),
                        "Registration failed, will retry"
                    );
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = std::cmp::min(retry_delay * 2, max_retry_delay);
                }
            }
        }
        
        // Heartbeat loop
        let mut heartbeat_timer = interval(self.heartbeat_interval);
        let mut consecutive_failures = 0;
        
        loop {
            heartbeat_timer.tick().await;
            
            match self.heartbeat().await {
                Ok(_) => {
                    consecutive_failures = 0;
                }
                Err(_) => {
                    consecutive_failures += 1;
                    
                    // After 3 consecutive failures, attempt re-registration
                    if consecutive_failures >= 3 {
                        warn!(
                            consecutive_failures = consecutive_failures,
                            "Multiple heartbeat failures, attempting re-registration"
                        );
                        
                        if self.register().await.is_ok() {
                            consecutive_failures = 0;
                        }
                    }
                }
            }
        }
    }
}

/// Detect the management IP address.
fn detect_management_ip() -> Option<String> {
    // Try to get the default network interface IP
    // This is a simple implementation - a production version would be smarter
    if let Ok(interfaces) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in interfaces {
            // Skip loopback and link-local
            if ip.is_loopback() {
                continue;
            }
            if let std::net::IpAddr::V4(ipv4) = ip {
                if ipv4.is_link_local() {
                    continue;
                }
                return Some(ipv4.to_string());
            }
        }
    }
    
    // Fallback: try local_ip_address crate
    local_ip_address::local_ip()
        .ok()
        .map(|ip| ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_detect_management_ip() {
        // Should return some IP (not necessarily the "right" one in tests)
        let ip = detect_management_ip();
        // Just ensure it doesn't panic
        println!("Detected IP: {:?}", ip);
    }
}
