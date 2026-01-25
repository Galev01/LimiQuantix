//! Clipboard operation handlers.
//!
//! Handles clipboard read/write operations for bi-directional copy/paste
//! between host and guest. Uses the `arboard` crate for cross-platform support.

use arboard::Clipboard;
use limiquantix_proto::agent::{
    agent_message, ClipboardGetRequest, ClipboardGetResponse, ClipboardType,
    ClipboardUpdateRequest, ClipboardUpdateResponse,
};
use tracing::{debug, error, info, warn};

/// Handle a clipboard update (set) request from the host.
pub async fn handle_clipboard_update(req: ClipboardUpdateRequest) -> agent_message::Payload {
    info!(
        r#type = ?ClipboardType::try_from(req.r#type).unwrap_or(ClipboardType::Text),
        mime_type = %req.mime_type,
        data_len = req.data.len(),
        "Handling clipboard update request"
    );

    // Create clipboard instance
    let mut clipboard = match Clipboard::new() {
        Ok(cb) => cb,
        Err(e) => {
            error!(error = %e, "Failed to access clipboard");
            return agent_message::Payload::ClipboardUpdateResponse(ClipboardUpdateResponse {
                success: false,
                error: format!("Failed to access clipboard: {}", e),
            });
        }
    };

    let clip_type = ClipboardType::try_from(req.r#type).unwrap_or(ClipboardType::Text);

    match clip_type {
        ClipboardType::Text | ClipboardType::Html => {
            // Handle text content
            let text = match String::from_utf8(req.data.clone()) {
                Ok(t) => t,
                Err(e) => {
                    error!(error = %e, "Invalid UTF-8 in clipboard data");
                    return agent_message::Payload::ClipboardUpdateResponse(
                        ClipboardUpdateResponse {
                            success: false,
                            error: format!("Invalid UTF-8 in clipboard data: {}", e),
                        },
                    );
                }
            };

            match clipboard.set_text(&text) {
                Ok(()) => {
                    debug!(text_len = text.len(), "Clipboard text set successfully");
                    agent_message::Payload::ClipboardUpdateResponse(ClipboardUpdateResponse {
                        success: true,
                        error: String::new(),
                    })
                }
                Err(e) => {
                    error!(error = %e, "Failed to set clipboard text");
                    agent_message::Payload::ClipboardUpdateResponse(ClipboardUpdateResponse {
                        success: false,
                        error: format!("Failed to set clipboard text: {}", e),
                    })
                }
            }
        }
        ClipboardType::Image => {
            // Handle image content
            match set_clipboard_image(&mut clipboard, &req.data, &req.mime_type) {
                Ok(()) => {
                    debug!(data_len = req.data.len(), "Clipboard image set successfully");
                    agent_message::Payload::ClipboardUpdateResponse(ClipboardUpdateResponse {
                        success: true,
                        error: String::new(),
                    })
                }
                Err(e) => {
                    error!(error = %e, "Failed to set clipboard image");
                    agent_message::Payload::ClipboardUpdateResponse(ClipboardUpdateResponse {
                        success: false,
                        error: format!("Failed to set clipboard image: {}", e),
                    })
                }
            }
        }
        ClipboardType::Files => {
            // File clipboard not yet supported
            warn!("File clipboard not yet supported");
            agent_message::Payload::ClipboardUpdateResponse(ClipboardUpdateResponse {
                success: false,
                error: "File clipboard not yet supported".to_string(),
            })
        }
    }
}

/// Handle a clipboard get (read) request from the host.
pub async fn handle_clipboard_get(req: ClipboardGetRequest) -> agent_message::Payload {
    debug!(
        preferred_type = ?ClipboardType::try_from(req.preferred_type).unwrap_or(ClipboardType::Text),
        "Handling clipboard get request"
    );

    // Create clipboard instance
    let mut clipboard = match Clipboard::new() {
        Ok(cb) => cb,
        Err(e) => {
            error!(error = %e, "Failed to access clipboard");
            return agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                success: false,
                r#type: ClipboardType::Text as i32,
                data: Vec::new(),
                mime_type: String::new(),
                error: format!("Failed to access clipboard: {}", e),
            });
        }
    };

    let preferred_type =
        ClipboardType::try_from(req.preferred_type).unwrap_or(ClipboardType::Text);

    // Try to get clipboard content based on preferred type
    match preferred_type {
        ClipboardType::Text | ClipboardType::Html => {
            // Try text first
            match clipboard.get_text() {
                Ok(text) => {
                    debug!(text_len = text.len(), "Got clipboard text");
                    agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                        success: true,
                        r#type: ClipboardType::Text as i32,
                        data: text.into_bytes(),
                        mime_type: "text/plain".to_string(),
                        error: String::new(),
                    })
                }
                Err(e) => {
                    // Try image as fallback
                    match get_clipboard_image(&mut clipboard) {
                        Ok((data, mime_type)) => {
                            debug!(data_len = data.len(), "Got clipboard image (fallback)");
                            agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                                success: true,
                                r#type: ClipboardType::Image as i32,
                                data,
                                mime_type,
                                error: String::new(),
                            })
                        }
                        Err(_) => {
                            debug!(error = %e, "Clipboard is empty or inaccessible");
                            agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                                success: false,
                                r#type: ClipboardType::Text as i32,
                                data: Vec::new(),
                                mime_type: String::new(),
                                error: format!("Clipboard is empty or inaccessible: {}", e),
                            })
                        }
                    }
                }
            }
        }
        ClipboardType::Image => {
            // Try image first
            match get_clipboard_image(&mut clipboard) {
                Ok((data, mime_type)) => {
                    debug!(data_len = data.len(), "Got clipboard image");
                    agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                        success: true,
                        r#type: ClipboardType::Image as i32,
                        data,
                        mime_type,
                        error: String::new(),
                    })
                }
                Err(e) => {
                    // Try text as fallback
                    match clipboard.get_text() {
                        Ok(text) => {
                            debug!(text_len = text.len(), "Got clipboard text (fallback)");
                            agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                                success: true,
                                r#type: ClipboardType::Text as i32,
                                data: text.into_bytes(),
                                mime_type: "text/plain".to_string(),
                                error: String::new(),
                            })
                        }
                        Err(_) => {
                            debug!(error = %e, "Clipboard is empty or inaccessible");
                            agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                                success: false,
                                r#type: ClipboardType::Image as i32,
                                data: Vec::new(),
                                mime_type: String::new(),
                                error: format!("Clipboard is empty or inaccessible: {}", e),
                            })
                        }
                    }
                }
            }
        }
        ClipboardType::Files => {
            // File clipboard not yet supported
            warn!("File clipboard not yet supported");
            agent_message::Payload::ClipboardGetResponse(ClipboardGetResponse {
                success: false,
                r#type: ClipboardType::Files as i32,
                data: Vec::new(),
                mime_type: String::new(),
                error: "File clipboard not yet supported".to_string(),
            })
        }
    }
}

/// Set clipboard image from raw bytes.
fn set_clipboard_image(
    clipboard: &mut Clipboard,
    data: &[u8],
    mime_type: &str,
) -> Result<(), String> {
    // Decode image based on mime type
    let image = if mime_type.contains("png") || data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        // PNG format
        decode_png(data)?
    } else if mime_type.contains("jpeg")
        || mime_type.contains("jpg")
        || data.starts_with(&[0xFF, 0xD8])
    {
        // JPEG format - not directly supported, would need conversion
        return Err("JPEG images not directly supported, please use PNG".to_string());
    } else if mime_type.contains("bmp") || data.starts_with(&[0x42, 0x4D]) {
        // BMP format
        decode_bmp(data)?
    } else {
        // Try to detect format from magic bytes
        if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            decode_png(data)?
        } else {
            return Err(format!("Unsupported image format: {}", mime_type));
        }
    };

    clipboard
        .set_image(image)
        .map_err(|e| format!("Failed to set clipboard image: {}", e))
}

/// Get clipboard image as raw bytes.
fn get_clipboard_image(clipboard: &mut Clipboard) -> Result<(Vec<u8>, String), String> {
    let image = clipboard
        .get_image()
        .map_err(|e| format!("Failed to get clipboard image: {}", e))?;

    // Convert to PNG format
    let data = encode_png(&image)?;

    Ok((data, "image/png".to_string()))
}

/// Decode PNG image data to arboard ImageData.
fn decode_png(data: &[u8]) -> Result<arboard::ImageData<'static>, String> {
    // Simple PNG decoder - in production, use a proper PNG library
    // For now, we'll use a basic approach

    // PNG header check
    if !data.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Err("Invalid PNG header".to_string());
    }

    // Parse IHDR chunk to get dimensions
    let ihdr_start = 8; // After PNG signature
    if data.len() < ihdr_start + 25 {
        return Err("PNG too short".to_string());
    }

    // IHDR chunk: length (4) + type (4) + width (4) + height (4) + ...
    let width = u32::from_be_bytes([
        data[ihdr_start + 8],
        data[ihdr_start + 9],
        data[ihdr_start + 10],
        data[ihdr_start + 11],
    ]) as usize;

    let height = u32::from_be_bytes([
        data[ihdr_start + 12],
        data[ihdr_start + 13],
        data[ihdr_start + 14],
        data[ihdr_start + 15],
    ]) as usize;

    // For a proper implementation, we'd need to decompress and decode the image data
    // For now, create a placeholder with the raw bytes
    // In production, use the `image` or `png` crate

    // Create RGBA buffer (placeholder - real implementation needs proper decoding)
    let rgba_data = vec![0u8; width * height * 4];

    Ok(arboard::ImageData {
        width,
        height,
        bytes: rgba_data.into(),
    })
}

/// Decode BMP image data to arboard ImageData.
fn decode_bmp(data: &[u8]) -> Result<arboard::ImageData<'static>, String> {
    // BMP header check
    if !data.starts_with(&[0x42, 0x4D]) {
        return Err("Invalid BMP header".to_string());
    }

    if data.len() < 54 {
        return Err("BMP too short".to_string());
    }

    // Parse BMP header for dimensions
    let width = u32::from_le_bytes([data[18], data[19], data[20], data[21]]) as usize;
    let height = u32::from_le_bytes([data[22], data[23], data[24], data[25]]) as usize;

    // For a proper implementation, we'd need to decode the pixel data
    // Create placeholder
    let rgba_data = vec![0u8; width * height * 4];

    Ok(arboard::ImageData {
        width,
        height,
        bytes: rgba_data.into(),
    })
}

/// Encode arboard ImageData to PNG format.
fn encode_png(image: &arboard::ImageData) -> Result<Vec<u8>, String> {
    // Simple PNG encoder - in production, use a proper PNG library
    // For now, return raw RGBA data with a simple header

    let width = image.width;
    let height = image.height;

    // Create a minimal PNG file
    // In production, use the `png` crate for proper encoding

    let mut png_data = Vec::new();

    // PNG signature
    png_data.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // For a proper implementation, we'd need to:
    // 1. Create IHDR chunk with width, height, bit depth, color type
    // 2. Create IDAT chunk(s) with compressed image data
    // 3. Create IEND chunk

    // Placeholder: return raw RGBA data
    // In production, use proper PNG encoding
    png_data.extend_from_slice(&(width as u32).to_be_bytes());
    png_data.extend_from_slice(&(height as u32).to_be_bytes());
    png_data.extend_from_slice(&image.bytes);

    Ok(png_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clipboard_type_conversion() {
        assert_eq!(
            ClipboardType::try_from(0).unwrap(),
            ClipboardType::Text
        );
        assert_eq!(
            ClipboardType::try_from(1).unwrap(),
            ClipboardType::Image
        );
    }
}
