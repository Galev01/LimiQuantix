//! USB Device Management Module
//!
//! Provides USB device enumeration and passthrough capabilities for QVMRC.
//! USB passthrough works by sending commands to the hypervisor to attach/detach
//! USB devices to the VM.
//!
//! Note: This module provides device enumeration and control plane communication.
//! The actual USB redirection is handled by the hypervisor (QEMU/libvirt).

use serde::{Deserialize, Serialize};
// Note: State is reserved for future use when tracking attached devices
use tracing::{debug, error, info, warn};

/// USB Device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbDevice {
    /// Vendor ID (e.g., 0x046d for Logitech)
    pub vendor_id: u16,
    /// Product ID
    pub product_id: u16,
    /// Device address on the bus
    pub address: u8,
    /// Bus number
    pub bus: u8,
    /// Device name/description
    pub name: String,
    /// Manufacturer name (if available)
    pub manufacturer: Option<String>,
    /// Serial number (if available)
    pub serial: Option<String>,
    /// Device class
    pub class: u8,
    /// Is the device currently attached to a VM?
    pub attached: bool,
    /// VM ID the device is attached to (if any)
    pub attached_to_vm: Option<String>,
}

/// USB Device passthrough request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbPassthroughRequest {
    /// VM ID to attach the device to
    pub vm_id: String,
    /// Vendor ID
    pub vendor_id: u16,
    /// Product ID
    pub product_id: u16,
    /// Bus number
    pub bus: u8,
    /// Device address
    pub address: u8,
}

/// Result of USB operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbOperationResult {
    pub success: bool,
    pub message: String,
}

/// List all USB devices connected to the host
#[tauri::command]
pub fn list_usb_devices() -> Result<Vec<UsbDevice>, String> {
    info!("Listing USB devices");
    
    let devices = match rusb::devices() {
        Ok(d) => d,
        Err(e) => {
            error!("Failed to enumerate USB devices: {}", e);
            return Err(format!("Failed to enumerate USB devices: {}", e));
        }
    };

    let mut result = Vec::new();

    for device in devices.iter() {
        let desc = match device.device_descriptor() {
            Ok(d) => d,
            Err(e) => {
                debug!("Failed to get device descriptor: {}", e);
                continue;
            }
        };

        // Skip hubs and other system devices
        if desc.class_code() == 0x09 {
            continue; // Hub
        }

        // Try to get device name
        let handle = device.open();
        let (name, manufacturer, serial) = if let Ok(ref h) = handle {
            let name = h.read_product_string_ascii(&desc).ok();
            let manufacturer = h.read_manufacturer_string_ascii(&desc).ok();
            let serial = h.read_serial_number_string_ascii(&desc).ok();
            (name, manufacturer, serial)
        } else {
            (None, None, None)
        };

        let device_name = name.unwrap_or_else(|| {
            format!(
                "USB Device {:04x}:{:04x}",
                desc.vendor_id(),
                desc.product_id()
            )
        });

        result.push(UsbDevice {
            vendor_id: desc.vendor_id(),
            product_id: desc.product_id(),
            address: device.address(),
            bus: device.bus_number(),
            name: device_name,
            manufacturer,
            serial,
            class: desc.class_code(),
            attached: false,
            attached_to_vm: None,
        });
    }

    info!("Found {} USB devices", result.len());
    Ok(result)
}

/// Attach a USB device to a VM
/// This sends a request to the control plane to attach the USB device
#[tauri::command]
pub async fn attach_usb_device(
    control_plane_url: String,
    request: UsbPassthroughRequest,
) -> Result<UsbOperationResult, String> {
    info!(
        "Attaching USB device {:04x}:{:04x} to VM {}",
        request.vendor_id, request.product_id, request.vm_id
    );

    let client = reqwest::Client::new();
    let url = format!("{}/api/vms/{}/usb/attach", control_plane_url, request.vm_id);

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "vendorId": request.vendor_id,
            "productId": request.product_id,
            "bus": request.bus,
            "address": request.address,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        info!("USB device attached successfully");
        Ok(UsbOperationResult {
            success: true,
            message: "USB device attached successfully".to_string(),
        })
    } else {
        let error_text = response.text().await.unwrap_or_default();
        error!("Failed to attach USB device: {}", error_text);
        Ok(UsbOperationResult {
            success: false,
            message: format!("Failed to attach USB device: {}", error_text),
        })
    }
}

/// Detach a USB device from a VM
#[tauri::command]
pub async fn detach_usb_device(
    control_plane_url: String,
    request: UsbPassthroughRequest,
) -> Result<UsbOperationResult, String> {
    info!(
        "Detaching USB device {:04x}:{:04x} from VM {}",
        request.vendor_id, request.product_id, request.vm_id
    );

    let client = reqwest::Client::new();
    let url = format!("{}/api/vms/{}/usb/detach", control_plane_url, request.vm_id);

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "vendorId": request.vendor_id,
            "productId": request.product_id,
            "bus": request.bus,
            "address": request.address,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        info!("USB device detached successfully");
        Ok(UsbOperationResult {
            success: true,
            message: "USB device detached successfully".to_string(),
        })
    } else {
        let error_text = response.text().await.unwrap_or_default();
        error!("Failed to detach USB device: {}", error_text);
        Ok(UsbOperationResult {
            success: false,
            message: format!("Failed to detach USB device: {}", error_text),
        })
    }
}

/// Get USB devices currently attached to a VM
#[tauri::command]
pub async fn get_vm_usb_devices(
    control_plane_url: String,
    vm_id: String,
) -> Result<Vec<UsbDevice>, String> {
    info!("Getting USB devices attached to VM {}", vm_id);

    let client = reqwest::Client::new();
    let url = format!("{}/api/vms/{}/usb", control_plane_url, vm_id);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to send request: {}", e))?;

    if response.status().is_success() {
        let devices: Vec<UsbDevice> = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;
        info!("VM {} has {} USB devices attached", vm_id, devices.len());
        Ok(devices)
    } else {
        let error_text = response.text().await.unwrap_or_default();
        warn!("Failed to get VM USB devices: {}", error_text);
        // Return empty list on error (VM might not support USB or have no devices)
        Ok(Vec::new())
    }
}

/// USB device class names for display
pub fn get_usb_class_name(class_code: u8) -> &'static str {
    match class_code {
        0x00 => "Device",
        0x01 => "Audio",
        0x02 => "Communications",
        0x03 => "HID (Keyboard/Mouse)",
        0x05 => "Physical",
        0x06 => "Image",
        0x07 => "Printer",
        0x08 => "Mass Storage",
        0x09 => "Hub",
        0x0a => "CDC-Data",
        0x0b => "Smart Card",
        0x0d => "Content Security",
        0x0e => "Video",
        0x0f => "Personal Healthcare",
        0x10 => "Audio/Video",
        0x11 => "Billboard",
        0xdc => "Diagnostic",
        0xe0 => "Wireless Controller",
        0xef => "Miscellaneous",
        0xfe => "Application Specific",
        0xff => "Vendor Specific",
        _ => "Unknown",
    }
}
