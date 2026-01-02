//! RFB Protocol Implementation (RFC 6143)
//!
//! This module implements the Remote Framebuffer protocol used by VNC.

use des::cipher::{BlockEncrypt, KeyInit};
use des::Des;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, info, warn};

/// RFB protocol errors
#[derive(Error, Debug)]
pub enum RFBError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("Unsupported version: {0}")]
    UnsupportedVersion(String),

    #[error("Connection closed")]
    ConnectionClosed,
}

/// Pixel format
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixelFormat {
    pub bits_per_pixel: u8,
    pub depth: u8,
    pub big_endian: bool,
    pub true_color: bool,
    pub red_max: u16,
    pub green_max: u16,
    pub blue_max: u16,
    pub red_shift: u8,
    pub green_shift: u8,
    pub blue_shift: u8,
}

impl Default for PixelFormat {
    fn default() -> Self {
        Self {
            bits_per_pixel: 32,
            depth: 24,
            big_endian: false,
            true_color: true,
            red_max: 255,
            green_max: 255,
            blue_max: 255,
            red_shift: 16,
            green_shift: 8,
            blue_shift: 0,
        }
    }
}

impl PixelFormat {
    /// Parse pixel format from 16-byte buffer
    fn from_bytes(bytes: &[u8; 16]) -> Self {
        Self {
            bits_per_pixel: bytes[0],
            depth: bytes[1],
            big_endian: bytes[2] != 0,
            true_color: bytes[3] != 0,
            red_max: u16::from_be_bytes([bytes[4], bytes[5]]),
            green_max: u16::from_be_bytes([bytes[6], bytes[7]]),
            blue_max: u16::from_be_bytes([bytes[8], bytes[9]]),
            red_shift: bytes[10],
            green_shift: bytes[11],
            blue_shift: bytes[12],
            // bytes[13..16] are padding
        }
    }

    /// Convert to 16-byte buffer
    fn to_bytes(&self) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        bytes[0] = self.bits_per_pixel;
        bytes[1] = self.depth;
        bytes[2] = if self.big_endian { 1 } else { 0 };
        bytes[3] = if self.true_color { 1 } else { 0 };
        bytes[4..6].copy_from_slice(&self.red_max.to_be_bytes());
        bytes[6..8].copy_from_slice(&self.green_max.to_be_bytes());
        bytes[8..10].copy_from_slice(&self.blue_max.to_be_bytes());
        bytes[10] = self.red_shift;
        bytes[11] = self.green_shift;
        bytes[12] = self.blue_shift;
        bytes
    }
}

/// Framebuffer rectangle update
#[derive(Debug, Clone, Serialize)]
pub struct FramebufferUpdate {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
    /// RGBA pixel data
    pub data: Vec<u8>,
}

/// RFB Client
pub struct RFBClient {
    stream: TcpStream,
    pub width: u16,
    pub height: u16,
    pub pixel_format: PixelFormat,
    pub name: String,
}

impl RFBClient {
    /// Connect to a VNC server
    pub async fn connect(host: &str, port: u16) -> Result<Self, RFBError> {
        info!("Connecting to VNC server at {}:{}", host, port);
        
        let stream = TcpStream::connect((host, port)).await?;
        stream.set_nodelay(true)?;

        Ok(Self {
            stream,
            width: 0,
            height: 0,
            pixel_format: PixelFormat::default(),
            name: String::new(),
        })
    }

    /// Perform VNC handshake
    pub async fn handshake(&mut self, password: Option<&str>) -> Result<(), RFBError> {
        // Step 1: Protocol version
        let mut version = [0u8; 12];
        self.stream.read_exact(&mut version).await?;
        
        let version_str = String::from_utf8_lossy(&version);
        info!("Server version: {}", version_str.trim());

        // Send our version (3.8)
        self.stream.write_all(b"RFB 003.008\n").await?;

        // Step 2: Security types
        let num_types = self.read_u8().await?;
        
        if num_types == 0 {
            // Read error message
            let len = self.read_u32().await?;
            let mut msg = vec![0u8; len as usize];
            self.stream.read_exact(&mut msg).await?;
            return Err(RFBError::AuthFailed(String::from_utf8_lossy(&msg).to_string()));
        }

        let mut security_types = vec![0u8; num_types as usize];
        self.stream.read_exact(&mut security_types).await?;

        debug!("Available security types: {:?}", security_types);

        // Choose security type
        // 1 = None, 2 = VNC Authentication
        let chosen_type = if security_types.contains(&1) && password.is_none() {
            1 // No auth
        } else if security_types.contains(&2) {
            2 // VNC Auth
        } else if security_types.contains(&1) {
            1 // Fallback to no auth
        } else {
            return Err(RFBError::AuthFailed("No supported security type".to_string()));
        };

        self.stream.write_all(&[chosen_type]).await?;

        // Handle authentication
        match chosen_type {
            1 => {
                // No authentication needed
                info!("Using no authentication");
            }
            2 => {
                // VNC Authentication (DES challenge-response)
                info!("Using VNC authentication");
                
                let mut challenge = [0u8; 16];
                self.stream.read_exact(&mut challenge).await?;

                let password = password.ok_or_else(|| {
                    RFBError::AuthFailed("Password required but not provided".to_string())
                })?;

                let response = Self::encrypt_challenge(&challenge, password);
                self.stream.write_all(&response).await?;
            }
            _ => {
                return Err(RFBError::AuthFailed(format!(
                    "Unsupported security type: {}",
                    chosen_type
                )));
            }
        }

        // Step 3: Security result
        let result = self.read_u32().await?;
        
        if result != 0 {
            // Try to read error message
            if let Ok(len) = self.read_u32().await {
                let mut msg = vec![0u8; len as usize];
                self.stream.read_exact(&mut msg).await.ok();
                return Err(RFBError::AuthFailed(String::from_utf8_lossy(&msg).to_string()));
            }
            return Err(RFBError::AuthFailed("Authentication failed".to_string()));
        }

        info!("Authentication successful");

        // Step 4: Client init
        // Share flag = 1 (allow other clients)
        self.stream.write_all(&[1]).await?;

        // Step 5: Server init
        self.width = self.read_u16().await?;
        self.height = self.read_u16().await?;

        let mut pf_bytes = [0u8; 16];
        self.stream.read_exact(&mut pf_bytes).await?;
        self.pixel_format = PixelFormat::from_bytes(&pf_bytes);

        let name_len = self.read_u32().await?;
        let mut name_bytes = vec![0u8; name_len as usize];
        self.stream.read_exact(&mut name_bytes).await?;
        self.name = String::from_utf8_lossy(&name_bytes).to_string();

        info!(
            "Server: {} ({}x{})",
            self.name, self.width, self.height
        );

        // Set our preferred pixel format
        self.set_pixel_format(&PixelFormat::default()).await?;

        // Set encodings
        self.set_encodings().await?;

        Ok(())
    }

    /// Encrypt challenge with password (VNC Auth)
    /// VNC uses DES encryption with bit-reversed key bytes
    fn encrypt_challenge(challenge: &[u8; 16], password: &str) -> [u8; 16] {
        // VNC uses a modified DES where each byte of the key is bit-reversed
        let mut key = [0u8; 8];
        let password_bytes = password.as_bytes();
        
        // Copy password (up to 8 bytes) and reverse bits in each byte
        for (i, &b) in password_bytes.iter().take(8).enumerate() {
            key[i] = b.reverse_bits();
        }
        // Remaining bytes stay as 0 (already initialized)

        // Create DES cipher with the bit-reversed key
        let cipher = Des::new_from_slice(&key).expect("Invalid key length");

        // Encrypt the 16-byte challenge in two 8-byte blocks
        let mut response = *challenge;
        
        // Encrypt first block
        let block1: &mut [u8; 8] = (&mut response[0..8]).try_into().unwrap();
        cipher.encrypt_block(block1.into());
        
        // Encrypt second block
        let block2: &mut [u8; 8] = (&mut response[8..16]).try_into().unwrap();
        cipher.encrypt_block(block2.into());

        response
    }

    /// Set pixel format
    async fn set_pixel_format(&mut self, pf: &PixelFormat) -> Result<(), RFBError> {
        let mut msg = vec![0u8; 20];
        msg[0] = 0; // SetPixelFormat
        // 3 bytes padding
        msg[4..20].copy_from_slice(&pf.to_bytes());
        self.stream.write_all(&msg).await?;
        self.pixel_format = pf.clone();
        Ok(())
    }

    /// Set supported encodings
    async fn set_encodings(&mut self) -> Result<(), RFBError> {
        let encodings: &[i32] = &[
            0,   // Raw
            1,   // CopyRect
            2,   // RRE
            5,   // Hextile
            6,   // Zlib
            7,   // Tight
            16,  // ZRLE
            -239, // Cursor pseudo-encoding
            -223, // DesktopSize pseudo-encoding
        ];

        let mut msg = vec![0u8; 4 + encodings.len() * 4];
        msg[0] = 2; // SetEncodings
        // 1 byte padding
        msg[2..4].copy_from_slice(&(encodings.len() as u16).to_be_bytes());
        
        for (i, &enc) in encodings.iter().enumerate() {
            msg[4 + i * 4..8 + i * 4].copy_from_slice(&enc.to_be_bytes());
        }

        self.stream.write_all(&msg).await?;
        Ok(())
    }

    /// Request framebuffer update
    pub async fn request_framebuffer_update(
        &mut self,
        incremental: bool,
    ) -> Result<Vec<FramebufferUpdate>, RFBError> {
        // Send FramebufferUpdateRequest
        let msg = [
            3, // FramebufferUpdateRequest
            if incremental { 1 } else { 0 },
            0, 0, // x
            0, 0, // y
            (self.width >> 8) as u8,
            self.width as u8,
            (self.height >> 8) as u8,
            self.height as u8,
        ];
        self.stream.write_all(&msg).await?;

        // Wait for and process server messages
        self.process_server_messages().await
    }

    /// Process server messages
    async fn process_server_messages(&mut self) -> Result<Vec<FramebufferUpdate>, RFBError> {
        let mut updates = Vec::new();

        // Read message type
        let msg_type = self.read_u8().await?;

        match msg_type {
            0 => {
                // FramebufferUpdate
                let _padding = self.read_u8().await?;
                let num_rects = self.read_u16().await?;

                for _ in 0..num_rects {
                    let x = self.read_u16().await?;
                    let y = self.read_u16().await?;
                    let width = self.read_u16().await?;
                    let height = self.read_u16().await?;
                    let encoding = self.read_i32().await?;

                    match encoding {
                        0 => {
                            // Raw encoding
                            let bytes_per_pixel = (self.pixel_format.bits_per_pixel / 8) as usize;
                            let data_len = width as usize * height as usize * bytes_per_pixel;
                            let mut data = vec![0u8; data_len];
                            self.stream.read_exact(&mut data).await?;

                            // Convert to RGBA
                            let rgba = self.convert_to_rgba(&data, width, height);

                            updates.push(FramebufferUpdate {
                                x,
                                y,
                                width,
                                height,
                                data: rgba,
                            });
                        }
                        1 => {
                            // CopyRect
                            let src_x = self.read_u16().await?;
                            let src_y = self.read_u16().await?;
                            // Handle copy rect (would need framebuffer state)
                            debug!("CopyRect from ({}, {})", src_x, src_y);
                        }
                        -239 => {
                            // Cursor pseudo-encoding
                            let bytes_per_pixel = (self.pixel_format.bits_per_pixel / 8) as usize;
                            let cursor_len = width as usize * height as usize * bytes_per_pixel;
                            let mask_len = ((width as usize + 7) / 8) * height as usize;
                            
                            let mut cursor_data = vec![0u8; cursor_len];
                            let mut mask_data = vec![0u8; mask_len];
                            
                            self.stream.read_exact(&mut cursor_data).await?;
                            self.stream.read_exact(&mut mask_data).await?;
                            
                            debug!("Cursor update: {}x{}", width, height);
                        }
                        -223 => {
                            // DesktopSize pseudo-encoding
                            self.width = width;
                            self.height = height;
                            info!("Desktop resize: {}x{}", width, height);
                        }
                        _ => {
                            warn!("Unsupported encoding: {}", encoding);
                        }
                    }
                }
            }
            1 => {
                // SetColourMapEntries
                let _padding = self.read_u8().await?;
                let first_color = self.read_u16().await?;
                let num_colors = self.read_u16().await?;
                
                // Skip color data
                let data_len = num_colors as usize * 6;
                let mut data = vec![0u8; data_len];
                self.stream.read_exact(&mut data).await?;
                
                debug!("Color map: {} colors starting at {}", num_colors, first_color);
            }
            2 => {
                // Bell
                info!("Server bell");
            }
            3 => {
                // ServerCutText (clipboard)
                let _padding = [0u8; 3];
                self.stream.read_exact(&mut [0u8; 3]).await?;
                let text_len = self.read_u32().await?;
                
                let mut text = vec![0u8; text_len as usize];
                self.stream.read_exact(&mut text).await?;
                
                debug!("Server clipboard: {} bytes", text_len);
            }
            _ => {
                warn!("Unknown message type: {}", msg_type);
            }
        }

        Ok(updates)
    }

    /// Convert pixel data to RGBA
    fn convert_to_rgba(&self, data: &[u8], width: u16, height: u16) -> Vec<u8> {
        let pf = &self.pixel_format;
        let bpp = (pf.bits_per_pixel / 8) as usize;
        let pixel_count = width as usize * height as usize;
        let mut rgba = vec![0u8; pixel_count * 4];

        for i in 0..pixel_count {
            let pixel_offset = i * bpp;
            let rgba_offset = i * 4;

            if pixel_offset + bpp > data.len() {
                break;
            }

            // Read pixel value
            let pixel = match bpp {
                1 => data[pixel_offset] as u32,
                2 => {
                    if pf.big_endian {
                        u16::from_be_bytes([data[pixel_offset], data[pixel_offset + 1]]) as u32
                    } else {
                        u16::from_le_bytes([data[pixel_offset], data[pixel_offset + 1]]) as u32
                    }
                }
                3 | 4 => {
                    if pf.big_endian {
                        u32::from_be_bytes([
                            if bpp == 4 { data[pixel_offset] } else { 0 },
                            data[pixel_offset + bpp - 3],
                            data[pixel_offset + bpp - 2],
                            data[pixel_offset + bpp - 1],
                        ])
                    } else {
                        u32::from_le_bytes([
                            data[pixel_offset],
                            data[pixel_offset + 1],
                            data[pixel_offset + 2],
                            if bpp == 4 { data[pixel_offset + 3] } else { 0 },
                        ])
                    }
                }
                _ => 0,
            };

            // Extract RGB components
            let r = ((pixel >> pf.red_shift) & pf.red_max as u32) as u8;
            let g = ((pixel >> pf.green_shift) & pf.green_max as u32) as u8;
            let b = ((pixel >> pf.blue_shift) & pf.blue_max as u32) as u8;

            // Scale to 0-255 if needed
            let r = if pf.red_max != 255 {
                (r as u32 * 255 / pf.red_max as u32) as u8
            } else {
                r
            };
            let g = if pf.green_max != 255 {
                (g as u32 * 255 / pf.green_max as u32) as u8
            } else {
                g
            };
            let b = if pf.blue_max != 255 {
                (b as u32 * 255 / pf.blue_max as u32) as u8
            } else {
                b
            };

            rgba[rgba_offset] = r;
            rgba[rgba_offset + 1] = g;
            rgba[rgba_offset + 2] = b;
            rgba[rgba_offset + 3] = 255; // Alpha
        }

        rgba
    }

    /// Send key event
    pub async fn send_key_event(&mut self, key: u32, down: bool) -> Result<(), RFBError> {
        let msg = [
            4, // KeyEvent
            if down { 1 } else { 0 },
            0, 0, // padding
            (key >> 24) as u8,
            (key >> 16) as u8,
            (key >> 8) as u8,
            key as u8,
        ];
        self.stream.write_all(&msg).await?;
        Ok(())
    }

    /// Send pointer event
    pub async fn send_pointer_event(&mut self, x: u16, y: u16, buttons: u8) -> Result<(), RFBError> {
        let msg = [
            5, // PointerEvent
            buttons,
            (x >> 8) as u8,
            x as u8,
            (y >> 8) as u8,
            y as u8,
        ];
        self.stream.write_all(&msg).await?;
        Ok(())
    }

    /// Send Ctrl+Alt+Del
    pub async fn send_ctrl_alt_del(&mut self) -> Result<(), RFBError> {
        // X11 keysyms
        const CTRL_L: u32 = 0xffe3;
        const ALT_L: u32 = 0xffe9;
        const DELETE: u32 = 0xffff;

        // Press keys
        self.send_key_event(CTRL_L, true).await?;
        self.send_key_event(ALT_L, true).await?;
        self.send_key_event(DELETE, true).await?;

        // Release keys
        self.send_key_event(DELETE, false).await?;
        self.send_key_event(ALT_L, false).await?;
        self.send_key_event(CTRL_L, false).await?;

        Ok(())
    }

    /// Send clipboard text
    pub async fn send_clipboard(&mut self, text: &str) -> Result<(), RFBError> {
        let text_bytes = text.as_bytes();
        let mut msg = vec![0u8; 8 + text_bytes.len()];
        msg[0] = 6; // ClientCutText
        // 3 bytes padding
        msg[4..8].copy_from_slice(&(text_bytes.len() as u32).to_be_bytes());
        msg[8..].copy_from_slice(text_bytes);
        self.stream.write_all(&msg).await?;
        Ok(())
    }

    // Helper methods for reading values
    async fn read_u8(&mut self) -> Result<u8, RFBError> {
        let mut buf = [0u8; 1];
        self.stream.read_exact(&mut buf).await?;
        Ok(buf[0])
    }

    async fn read_u16(&mut self) -> Result<u16, RFBError> {
        let mut buf = [0u8; 2];
        self.stream.read_exact(&mut buf).await?;
        Ok(u16::from_be_bytes(buf))
    }

    async fn read_u32(&mut self) -> Result<u32, RFBError> {
        let mut buf = [0u8; 4];
        self.stream.read_exact(&mut buf).await?;
        Ok(u32::from_be_bytes(buf))
    }

    async fn read_i32(&mut self) -> Result<i32, RFBError> {
        let mut buf = [0u8; 4];
        self.stream.read_exact(&mut buf).await?;
        Ok(i32::from_be_bytes(buf))
    }
}
