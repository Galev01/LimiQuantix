//! Event Store for Node Daemon
//!
//! Provides an in-memory ring buffer for storing system events with:
//! - Thread-safe access via RwLock
//! - Configurable capacity (default 1000 events)
//! - Event filtering by level and category
//! - Optional persistence to disk for reboot survival
//!
//! Events are automatically emitted for:
//! - VM lifecycle operations (create, start, stop, delete)
//! - Storage operations (pool create/destroy, volume operations)
//! - System events (startup, shutdown, errors)
//! - Network changes

// Many helper methods are prepared for future features
#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::{Arc, RwLock};
// SystemTime reserved for future event timestamp features
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tracing::{info, warn, error, debug};

/// Maximum number of events to keep in memory
const DEFAULT_CAPACITY: usize = 1000;

/// Event severity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventLevel {
    Debug,
    Info,
    Warning,
    Error,
}

impl std::fmt::Display for EventLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventLevel::Debug => write!(f, "debug"),
            EventLevel::Info => write!(f, "info"),
            EventLevel::Warning => write!(f, "warning"),
            EventLevel::Error => write!(f, "error"),
        }
    }
}

impl From<&str> for EventLevel {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "debug" => EventLevel::Debug,
            "info" => EventLevel::Info,
            "warning" | "warn" => EventLevel::Warning,
            "error" => EventLevel::Error,
            _ => EventLevel::Info,
        }
    }
}

/// Event category for filtering
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventCategory {
    System,
    Vm,
    Storage,
    Network,
    Cluster,
    Security,
}

impl std::fmt::Display for EventCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EventCategory::System => write!(f, "system"),
            EventCategory::Vm => write!(f, "vm"),
            EventCategory::Storage => write!(f, "storage"),
            EventCategory::Network => write!(f, "network"),
            EventCategory::Cluster => write!(f, "cluster"),
            EventCategory::Security => write!(f, "security"),
        }
    }
}

impl From<&str> for EventCategory {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "vm" | "virtual_machine" => EventCategory::Vm,
            "storage" | "disk" => EventCategory::Storage,
            "network" | "net" => EventCategory::Network,
            "cluster" | "vdc" => EventCategory::Cluster,
            "security" | "auth" => EventCategory::Security,
            _ => EventCategory::System,
        }
    }
}

/// A single event in the event store
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Unique event ID (UUID)
    pub id: String,
    /// Event timestamp
    pub timestamp: DateTime<Utc>,
    /// Event severity level
    pub level: EventLevel,
    /// Event category
    pub category: EventCategory,
    /// Human-readable message
    pub message: String,
    /// Source component (e.g., "qx-node", "hypervisor", "storage")
    pub source: String,
    /// Optional structured details (JSON-serializable)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
    /// Associated resource ID (e.g., VM ID, pool ID)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,
}

impl Event {
    /// Create a new event
    pub fn new(
        level: EventLevel,
        category: EventCategory,
        message: impl Into<String>,
        source: impl Into<String>,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: Utc::now(),
            level,
            category,
            message: message.into(),
            source: source.into(),
            details: None,
            resource_id: None,
        }
    }
    
    /// Add details to the event
    pub fn with_details(mut self, details: serde_json::Value) -> Self {
        self.details = Some(details);
        self
    }
    
    /// Add a resource ID to the event
    pub fn with_resource(mut self, resource_id: impl Into<String>) -> Self {
        self.resource_id = Some(resource_id.into());
        self
    }
    
    // Convenience constructors
    
    /// Create an info-level system event
    pub fn system_info(message: impl Into<String>) -> Self {
        Self::new(EventLevel::Info, EventCategory::System, message, "qx-node")
    }
    
    /// Create a warning-level system event
    pub fn system_warning(message: impl Into<String>) -> Self {
        Self::new(EventLevel::Warning, EventCategory::System, message, "qx-node")
    }
    
    /// Create an error-level system event
    pub fn system_error(message: impl Into<String>) -> Self {
        Self::new(EventLevel::Error, EventCategory::System, message, "qx-node")
    }
    
    /// Create a VM lifecycle event
    pub fn vm_event(level: EventLevel, vm_id: &str, message: impl Into<String>) -> Self {
        Self::new(level, EventCategory::Vm, message, "hypervisor")
            .with_resource(vm_id)
    }
    
    /// Create a storage event
    pub fn storage_event(level: EventLevel, resource_id: &str, message: impl Into<String>) -> Self {
        Self::new(level, EventCategory::Storage, message, "storage")
            .with_resource(resource_id)
    }
    
    /// Create a network event
    pub fn network_event(level: EventLevel, message: impl Into<String>) -> Self {
        Self::new(level, EventCategory::Network, message, "network")
    }
    
    /// Create a cluster/vDC event
    pub fn cluster_event(level: EventLevel, message: impl Into<String>) -> Self {
        Self::new(level, EventCategory::Cluster, message, "cluster")
    }
}

/// Thread-safe event store with ring buffer
pub struct EventStore {
    events: RwLock<VecDeque<Event>>,
    capacity: usize,
    /// Path for optional persistence
    persistence_path: Option<std::path::PathBuf>,
}

impl EventStore {
    /// Create a new event store with default capacity
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_CAPACITY)
    }
    
    /// Create a new event store with specified capacity
    pub fn with_capacity(capacity: usize) -> Self {
        let store = Self {
            events: RwLock::new(VecDeque::with_capacity(capacity)),
            capacity,
            persistence_path: None,
        };
        
        // Add startup event
        store.push(Event::system_info("Node daemon event store initialized"));
        
        store
    }
    
    /// Create a new event store with persistence
    pub fn with_persistence(capacity: usize, path: impl Into<std::path::PathBuf>) -> Self {
        let path = path.into();
        let mut store = Self {
            events: RwLock::new(VecDeque::with_capacity(capacity)),
            capacity,
            persistence_path: Some(path.clone()),
        };
        
        // Try to load existing events from disk
        if let Err(e) = store.load_from_disk() {
            debug!(error = %e, "No existing events to load (this is normal on first run)");
        }
        
        // Add startup event
        store.push(Event::system_info("Node daemon started"));
        
        store
    }
    
    /// Push a new event into the store
    pub fn push(&self, event: Event) {
        if let Ok(mut events) = self.events.write() {
            // Remove oldest event if at capacity
            if events.len() >= self.capacity {
                events.pop_front();
            }
            
            // Log the event at appropriate level
            match event.level {
                EventLevel::Debug => debug!(
                    category = %event.category,
                    message = %event.message,
                    "Event"
                ),
                EventLevel::Info => info!(
                    category = %event.category,
                    message = %event.message,
                    "Event"
                ),
                EventLevel::Warning => warn!(
                    category = %event.category,
                    message = %event.message,
                    "Event"
                ),
                EventLevel::Error => error!(
                    category = %event.category,
                    message = %event.message,
                    "Event"
                ),
            }
            
            events.push_back(event);
        }
    }
    
    /// Get all events (newest first)
    pub fn get_all(&self) -> Vec<Event> {
        self.events.read()
            .map(|events| events.iter().rev().cloned().collect())
            .unwrap_or_default()
    }
    
    /// Get events filtered by level
    pub fn get_by_level(&self, level: EventLevel) -> Vec<Event> {
        self.events.read()
            .map(|events| {
                events.iter()
                    .filter(|e| e.level == level)
                    .rev()
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
    
    /// Get events filtered by category
    pub fn get_by_category(&self, category: EventCategory) -> Vec<Event> {
        self.events.read()
            .map(|events| {
                events.iter()
                    .filter(|e| e.category == category)
                    .rev()
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }
    
    /// Get events with optional filters and limit
    pub fn query(
        &self,
        level: Option<EventLevel>,
        category: Option<EventCategory>,
        limit: Option<usize>,
    ) -> Vec<Event> {
        self.events.read()
            .map(|events| {
                let mut result: Vec<Event> = events.iter()
                    .filter(|e| {
                        level.map_or(true, |l| e.level == l) &&
                        category.as_ref().map_or(true, |c| &e.category == c)
                    })
                    .rev()
                    .cloned()
                    .collect();
                
                if let Some(limit) = limit {
                    result.truncate(limit);
                }
                
                result
            })
            .unwrap_or_default()
    }
    
    /// Get the total number of events
    pub fn len(&self) -> usize {
        self.events.read().map(|e| e.len()).unwrap_or(0)
    }
    
    /// Check if the store is empty
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    
    /// Clear all events
    pub fn clear(&self) {
        if let Ok(mut events) = self.events.write() {
            events.clear();
        }
    }
    
    /// Save events to disk (if persistence is enabled)
    pub fn save_to_disk(&self) -> std::io::Result<()> {
        let path = match &self.persistence_path {
            Some(p) => p,
            None => return Ok(()),
        };
        
        let events = self.get_all();
        let json = serde_json::to_string_pretty(&events)?;
        
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        std::fs::write(path, json)?;
        debug!(path = %path.display(), count = events.len(), "Events saved to disk");
        
        Ok(())
    }
    
    /// Load events from disk (if persistence is enabled)
    fn load_from_disk(&mut self) -> std::io::Result<()> {
        let path = match &self.persistence_path {
            Some(p) => p,
            None => return Ok(()),
        };
        
        if !path.exists() {
            return Ok(());
        }
        
        let json = std::fs::read_to_string(path)?;
        let loaded_events: Vec<Event> = serde_json::from_str(&json)?;
        
        if let Ok(mut events) = self.events.write() {
            for event in loaded_events {
                if events.len() >= self.capacity {
                    events.pop_front();
                }
                events.push_back(event);
            }
        }
        
        info!(path = %path.display(), "Events loaded from disk");
        
        Ok(())
    }
}

impl Default for EventStore {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for EventStore {
    fn drop(&mut self) {
        // Try to save events on shutdown
        if self.persistence_path.is_some() {
            if let Err(e) = self.save_to_disk() {
                warn!(error = %e, "Failed to save events on shutdown");
            }
        }
    }
}

/// Global event store instance
static EVENT_STORE: std::sync::OnceLock<Arc<EventStore>> = std::sync::OnceLock::new();

/// Initialize the global event store
pub fn init_event_store(persistence_path: Option<std::path::PathBuf>) {
    let store = match persistence_path {
        Some(path) => EventStore::with_persistence(DEFAULT_CAPACITY, path),
        None => EventStore::new(),
    };
    
    let _ = EVENT_STORE.set(Arc::new(store));
}

/// Get the global event store
pub fn get_event_store() -> Arc<EventStore> {
    EVENT_STORE.get_or_init(|| Arc::new(EventStore::new())).clone()
}

/// Convenience function to emit an event
pub fn emit_event(event: Event) {
    get_event_store().push(event);
}

// Convenience macros for emitting events
#[macro_export]
macro_rules! emit_info {
    ($category:expr, $msg:expr) => {
        $crate::event_store::emit_event(
            $crate::event_store::Event::new(
                $crate::event_store::EventLevel::Info,
                $category,
                $msg,
                "qx-node"
            )
        )
    };
    ($category:expr, $msg:expr, $resource:expr) => {
        $crate::event_store::emit_event(
            $crate::event_store::Event::new(
                $crate::event_store::EventLevel::Info,
                $category,
                $msg,
                "qx-node"
            ).with_resource($resource)
        )
    };
}

#[macro_export]
macro_rules! emit_warning {
    ($category:expr, $msg:expr) => {
        $crate::event_store::emit_event(
            $crate::event_store::Event::new(
                $crate::event_store::EventLevel::Warning,
                $category,
                $msg,
                "qx-node"
            )
        )
    };
}

#[macro_export]
macro_rules! emit_error {
    ($category:expr, $msg:expr) => {
        $crate::event_store::emit_event(
            $crate::event_store::Event::new(
                $crate::event_store::EventLevel::Error,
                $category,
                $msg,
                "qx-node"
            )
        )
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_event_store_basic() {
        let store = EventStore::new();
        
        store.push(Event::system_info("Test event 1"));
        store.push(Event::system_warning("Test event 2"));
        store.push(Event::system_error("Test event 3"));
        
        // +1 for the initialization event
        assert_eq!(store.len(), 4);
        
        let events = store.get_all();
        assert_eq!(events.len(), 4);
        
        // Newest first
        assert_eq!(events[0].message, "Test event 3");
    }
    
    #[test]
    fn test_event_store_capacity() {
        let store = EventStore::with_capacity(3);
        
        store.push(Event::system_info("Event 1"));
        store.push(Event::system_info("Event 2"));
        store.push(Event::system_info("Event 3"));
        
        // Should have removed the initialization event
        assert_eq!(store.len(), 3);
        
        let events = store.get_all();
        assert_eq!(events[2].message, "Event 1");
    }
    
    #[test]
    fn test_event_filtering() {
        let store = EventStore::with_capacity(100);
        
        store.push(Event::vm_event(EventLevel::Info, "vm-1", "VM created"));
        store.push(Event::storage_event(EventLevel::Warning, "pool-1", "Pool low on space"));
        store.push(Event::vm_event(EventLevel::Error, "vm-2", "VM crashed"));
        
        let vm_events = store.get_by_category(EventCategory::Vm);
        assert_eq!(vm_events.len(), 2);
        
        let errors = store.get_by_level(EventLevel::Error);
        assert_eq!(errors.len(), 1);
    }
}
