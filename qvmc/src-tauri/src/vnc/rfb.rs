//! RFB Protocol Implementation (RFC 6143)
//!
//! This module implements the Remote Framebuffer protocol used by VNC.
//! Supports both direct TCP connections and WebSocket proxy connections.

use super::encodings::{self, TightZlibState};
use des::cipher::{BlockEncrypt, KeyInit};
use des::Des;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tracing::{debug, info, trace, warn};

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
    /// RGBA pixel data as array of numbers (for JS compatibility)
    /// Note: Serde serializes Vec<u8> as an array of numbers, not bytes
    pub data: Vec<u8>,
}

/// Check if serde properly handles the Vec<u8> as array
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_framebuffer_serialization() {
        let update = FramebufferUpdate {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            data: vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
        };
        let json = serde_json::to_string(&update).unwrap();
        println!("Serialized: {}", json);
        assert!(json.contains("[255,0,0,255"));
    }
}

/// Transport type for VNC connections
enum Transport {
    /// Direct TCP connection to VNC server
    Tcp(TcpStream),
    /// WebSocket connection via proxy (binary frames contain raw VNC data)
    WebSocket {
        ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
        /// Buffer for excess data from WebSocket messages
        buffer: Vec<u8>,
    },
}

impl Transport {
    /// Read exactly `len` bytes from the transport
    async fn read_exact(&mut self, buf: &mut [u8]) -> Result<(), RFBError> {
        match self {
            Transport::Tcp(stream) => {
                stream.read_exact(buf).await?;
                Ok(())
            }
            Transport::WebSocket { ws, buffer } => {
                let mut offset = 0;
                
                // First, drain any data from the buffer
                if !buffer.is_empty() {
                    let copy_len = std::cmp::min(buffer.len(), buf.len());
                    buf[..copy_len].copy_from_slice(&buffer[..copy_len]);
                    buffer.drain(..copy_len);
                    offset = copy_len;
                }
                
                // Read more from WebSocket if needed
                while offset < buf.len() {
                    match ws.next().await {
                        Some(Ok(Message::Binary(data))) => {
                            let needed = buf.len() - offset;
                            if data.len() <= needed {
                                // Use all the data
                                buf[offset..offset + data.len()].copy_from_slice(&data);
                                offset += data.len();
                            } else {
                                // Copy what we need, buffer the rest
                                buf[offset..].copy_from_slice(&data[..needed]);
                                buffer.extend_from_slice(&data[needed..]);
                                offset = buf.len();
                            }
                        }
                        Some(Ok(Message::Close(_))) => {
                            return Err(RFBError::ConnectionClosed);
                        }
                        Some(Ok(_)) => {
                            // Ignore other message types (text, ping, pong)
                            continue;
                        }
                        Some(Err(e)) => {
                            return Err(RFBError::Protocol(format!("WebSocket error: {}", e)));
                        }
                        None => {
                            return Err(RFBError::ConnectionClosed);
                        }
                    }
                }
                Ok(())
            }
        }
    }

    /// Write all bytes to the transport
    async fn write_all(&mut self, buf: &[u8]) -> Result<(), RFBError> {
        match self {
            Transport::Tcp(stream) => {
                stream.write_all(buf).await?;
                Ok(())
            }
            Transport::WebSocket { ws, .. } => {
                ws.send(Message::Binary(buf.to_vec())).await
                    .map_err(|e| RFBError::Protocol(format!("WebSocket send error: {}", e)))?;
                Ok(())
            }
        }
    }
}

/// RFB Client - supports both TCP and WebSocket transports
pub struct RFBClient {
    transport: Transport,
    pub width: u16,
    pub height: u16,
    pub pixel_format: PixelFormat,
    pub name: String,
    /// Last clipboard text received from server (ServerCutText)
    pub last_server_clipboard: Option<String>,
    /// Persistent zlib decompressor state for Tight encoding (4 streams per spec)
    tight_zlib_state: TightZlibState,
}

impl fmt::Debug for RFBClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RFBClient")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("pixel_format", &self.pixel_format)
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

impl RFBClient {
    /// Connect to a VNC server via direct TCP
    pub async fn connect(host: &str, port: u16) -> Result<Self, RFBError> {
        info!("Connecting to VNC server at {}:{}", host, port);
        
        let stream = TcpStream::connect((host, port)).await?;
        stream.set_nodelay(true)?;

        Ok(Self {
            transport: Transport::Tcp(stream),
            width: 0,
            height: 0,
            pixel_format: PixelFormat::default(),
            name: String::new(),
            last_server_clipboard: None,
            tight_zlib_state: TightZlibState::new(),
        })
    }

    /// Connect to VNC via WebSocket proxy
    /// The proxy handles the TCP connection to the VNC server and forwards raw RFB data
    pub async fn connect_websocket(ws_url: &str) -> Result<Self, RFBError> {
        info!("Connecting to VNC via WebSocket proxy: {}", ws_url);
        
        let (ws_stream, _response) = connect_async(ws_url)
            .await
            .map_err(|e| RFBError::Protocol(format!("WebSocket connection failed: {}", e)))?;
        
        info!("WebSocket connection established");

        Ok(Self {
            transport: Transport::WebSocket {
                ws: ws_stream,
                buffer: Vec::new(),
            },
            width: 0,
            height: 0,
            pixel_format: PixelFormat::default(),
            name: String::new(),
            last_server_clipboard: None,
            tight_zlib_state: TightZlibState::new(),
        })
    }

    /// Perform VNC handshake
    pub async fn handshake(&mut self, password: Option<&str>) -> Result<(), RFBError> {
        // Step 1: Protocol version
        let mut version = [0u8; 12];
        self.transport.read_exact(&mut version).await?;
        
        let version_str = String::from_utf8_lossy(&version);
        info!("Server version: {}", version_str.trim());

        // Send our version (3.8)
        self.transport.write_all(b"RFB 003.008\n").await?;

        // Step 2: Security types
        let num_types = self.read_u8().await?;
        
        if num_types == 0 {
            // Read error message
            let len = self.read_u32().await?;
            let mut msg = vec![0u8; len as usize];
            self.transport.read_exact(&mut msg).await?;
            return Err(RFBError::AuthFailed(String::from_utf8_lossy(&msg).to_string()));
        }

        let mut security_types = vec![0u8; num_types as usize];
        self.transport.read_exact(&mut security_types).await?;

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

        self.transport.write_all(&[chosen_type]).await?;

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
                self.transport.read_exact(&mut challenge).await?;

                let password = password.ok_or_else(|| {
                    RFBError::AuthFailed("Password required but not provided".to_string())
                })?;

                let response = Self::encrypt_challenge(&challenge, password);
                self.transport.write_all(&response).await?;
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
                self.transport.read_exact(&mut msg).await.ok();
                return Err(RFBError::AuthFailed(String::from_utf8_lossy(&msg).to_string()));
            }
            return Err(RFBError::AuthFailed("Authentication failed".to_string()));
        }

        info!("Authentication successful");

        // Step 4: Client init
        // Share flag = 1 (allow other clients)
        self.transport.write_all(&[1]).await?;

        // Step 5: Server init
        self.width = self.read_u16().await?;
        self.height = self.read_u16().await?;

        let mut pf_bytes = [0u8; 16];
        self.transport.read_exact(&mut pf_bytes).await?;
        self.pixel_format = PixelFormat::from_bytes(&pf_bytes);

        let name_len = self.read_u32().await?;
        let mut name_bytes = vec![0u8; name_len as usize];
        self.transport.read_exact(&mut name_bytes).await?;
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
        self.transport.write_all(&msg).await?;
        self.pixel_format = pf.clone();
        Ok(())
    }

    /// Set supported encodings
    /// Order matters - preferred encodings should come first
    async fn set_encodings(&mut self) -> Result<(), RFBError> {
        // Start with simpler encodings for better compatibility
        // Tight and ZRLE are complex - fall back to simpler encodings first
        let encodings: &[i32] = &[
            5,   // Hextile - good balance of speed and compression
            2,   // RRE - rise-and-run-length encoding
            1,   // CopyRect - copy from another screen region
            0,   // Raw - uncompressed fallback (most compatible)
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

        self.transport.write_all(&msg).await?;
        
        debug!(
            "Set encodings: Hextile, RRE, CopyRect, Raw + pseudo-encodings"
        );
        
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
        self.transport.write_all(&msg).await?;

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

                for rect_idx in 0..num_rects {
                    let x = self.read_u16().await?;
                    let y = self.read_u16().await?;
                    let width = self.read_u16().await?;
                    let height = self.read_u16().await?;
                    let encoding = self.read_i32().await?;

                    info!(
                        "Rect {}/{}: {}x{} at ({},{}) encoding={}",
                        rect_idx + 1,
                        num_rects,
                        width,
                        height,
                        x,
                        y,
                        encodings::encoding_name(encoding)
                    );

                    match encoding {
                        0 => {
                            // Raw encoding
                            let bytes_per_pixel = (self.pixel_format.bits_per_pixel / 8) as usize;
                            let data_len = width as usize * height as usize * bytes_per_pixel;
                            let mut data = vec![0u8; data_len];
                            self.transport.read_exact(&mut data).await?;

                            info!(
                                "Raw encoding: {}x{} = {} bytes, bpp={}, first 8 raw bytes: {:?}",
                                width, height, data_len, bytes_per_pixel,
                                if data.len() >= 8 { &data[0..8] } else { &data[..] }
                            );

                            // Convert to RGBA
                            let rgba = self.convert_to_rgba(&data, width, height);
                            
                            info!(
                                "After RGBA conversion: {} bytes, first 8 RGBA bytes: {:?}",
                                rgba.len(),
                                if rgba.len() >= 8 { &rgba[0..8] } else { &rgba[..] }
                            );

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
                        2 => {
                            // RRE encoding
                            let bytes_per_pixel = (self.pixel_format.bits_per_pixel / 8) as usize;
                            
                            // Read number of subrectangles + background + subrects
                            // First read header: 4 bytes (num_subrects) + bpp (background)
                            let num_subrects = self.read_u32().await? as usize;
                            let mut bg_pixel = vec![0u8; bytes_per_pixel];
                            self.transport.read_exact(&mut bg_pixel).await?;
                            
                            // Read all subrectangles
                            let subrect_size = bytes_per_pixel + 8;
                            let mut subrect_data = vec![0u8; num_subrects * subrect_size];
                            if num_subrects > 0 {
                                self.transport.read_exact(&mut subrect_data).await?;
                            }
                            
                            // Decode RRE
                            let mut full_data = Vec::with_capacity(4 + bytes_per_pixel + subrect_data.len());
                            full_data.extend_from_slice(&(num_subrects as u32).to_be_bytes());
                            full_data.extend_from_slice(&bg_pixel);
                            full_data.extend_from_slice(&subrect_data);
                            
                            match encodings::decode_rre(&full_data, width, height, &self.pixel_format) {
                                Ok(decoded) => {
                                    let rgba = self.convert_to_rgba(&decoded, width, height);
                                    updates.push(FramebufferUpdate {
                                        x,
                                        y,
                                        width,
                                        height,
                                        data: rgba,
                                    });
                                }
                                Err(e) => {
                                    warn!("RRE decode failed: {}", e);
                                }
                            }
                        }
                        5 => {
                            // Hextile encoding
                            // Hextile is tile-based, we need to read data incrementally
                            let decoded = self.read_hextile(width, height).await?;
                            let rgba = self.convert_to_rgba(&decoded, width, height);
                            updates.push(FramebufferUpdate {
                                x,
                                y,
                                width,
                                height,
                                data: rgba,
                            });
                        }
                        6 => {
                            // Zlib encoding
                            let compressed_len = self.read_u32().await? as usize;
                            let mut compressed = vec![0u8; compressed_len];
                            self.transport.read_exact(&mut compressed).await?;
                            
                            let mut full_data = Vec::with_capacity(4 + compressed_len);
                            full_data.extend_from_slice(&(compressed_len as u32).to_be_bytes());
                            full_data.extend_from_slice(&compressed);
                            
                            match encodings::decode_zlib(&full_data, width, height, &self.pixel_format) {
                                Ok(decoded) => {
                                    let rgba = self.convert_to_rgba(&decoded, width, height);
                                    updates.push(FramebufferUpdate {
                                        x,
                                        y,
                                        width,
                                        height,
                                        data: rgba,
                                    });
                                }
                                Err(e) => {
                                    warn!("Zlib decode failed: {}", e);
                                }
                            }
                        }
                        7 => {
                            // Tight encoding
                            let decoded = self.read_tight(width, height).await?;
                            let rgba = self.convert_to_rgba(&decoded, width, height);
                            updates.push(FramebufferUpdate {
                                x,
                                y,
                                width,
                                height,
                                data: rgba,
                            });
                        }
                        16 => {
                            // ZRLE encoding
                            let compressed_len = self.read_u32().await? as usize;
                            let mut compressed = vec![0u8; compressed_len];
                            self.transport.read_exact(&mut compressed).await?;
                            
                            let mut full_data = Vec::with_capacity(4 + compressed_len);
                            full_data.extend_from_slice(&(compressed_len as u32).to_be_bytes());
                            full_data.extend_from_slice(&compressed);
                            
                            match encodings::decode_zrle(&full_data, width, height, &self.pixel_format) {
                                Ok(decoded) => {
                                    let rgba = self.convert_to_rgba(&decoded, width, height);
                                    updates.push(FramebufferUpdate {
                                        x,
                                        y,
                                        width,
                                        height,
                                        data: rgba,
                                    });
                                }
                                Err(e) => {
                                    warn!("ZRLE decode failed: {}", e);
                                }
                            }
                        }
                        -239 => {
                            // Cursor pseudo-encoding
                            let bytes_per_pixel = (self.pixel_format.bits_per_pixel / 8) as usize;
                            let cursor_len = width as usize * height as usize * bytes_per_pixel;
                            let mask_len = ((width as usize + 7) / 8) * height as usize;
                            
                            let mut cursor_data = vec![0u8; cursor_len];
                            let mut mask_data = vec![0u8; mask_len];
                            
                            self.transport.read_exact(&mut cursor_data).await?;
                            self.transport.read_exact(&mut mask_data).await?;
                            
                            debug!("Cursor update: {}x{}", width, height);
                        }
                        -223 => {
                            // DesktopSize pseudo-encoding
                            self.width = width;
                            self.height = height;
                            info!("Desktop resize: {}x{}", width, height);
                        }
                        _ => {
                            warn!("Unsupported encoding: {} ({})", encoding, encodings::encoding_name(encoding));
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
                self.transport.read_exact(&mut data).await?;
                
                debug!("Color map: {} colors starting at {}", num_colors, first_color);
            }
            2 => {
                // Bell
                info!("Server bell");
            }
            3 => {
                // ServerCutText (clipboard)
                let mut padding = [0u8; 3];
                self.transport.read_exact(&mut padding).await?;
                let text_len = self.read_u32().await?;
                
                let mut text = vec![0u8; text_len as usize];
                self.transport.read_exact(&mut text).await?;
                
                debug!("Server clipboard: {} bytes", text_len);
                
                // Store clipboard text for retrieval
                if let Ok(text_str) = String::from_utf8(text) {
                    self.last_server_clipboard = Some(text_str);
                }
            }
            _ => {
                warn!("Unknown message type: {}", msg_type);
            }
        }

        Ok(updates)
    }

    /// Read and decode Hextile encoding
    async fn read_hextile(&mut self, width: u16, height: u16) -> Result<Vec<u8>, RFBError> {
        let bpp = (self.pixel_format.bits_per_pixel / 8) as usize;
        let pixel_count = width as usize * height as usize;
        let mut output = vec![0u8; pixel_count * bpp];

        const RAW: u8 = 1;
        const BACKGROUND_SPECIFIED: u8 = 2;
        const FOREGROUND_SPECIFIED: u8 = 4;
        const ANY_SUBRECTS: u8 = 8;
        const SUBRECTS_COLORED: u8 = 16;

        let mut bg_pixel = vec![0u8; bpp];
        let mut fg_pixel = vec![0u8; bpp];

        let tiles_x = (width as usize + 15) / 16;
        let tiles_y = (height as usize + 15) / 16;

        for ty in 0..tiles_y {
            for tx in 0..tiles_x {
                let tile_x = tx * 16;
                let tile_y = ty * 16;
                let tile_w = std::cmp::min(16, width as usize - tile_x);
                let tile_h = std::cmp::min(16, height as usize - tile_y);

                let subencoding = self.read_u8().await?;

                if subencoding & RAW != 0 {
                    // Raw tile
                    let raw_len = tile_w * tile_h * bpp;
                    let mut raw_data = vec![0u8; raw_len];
                    self.transport.read_exact(&mut raw_data).await?;

                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let src_idx = (row * tile_w + col) * bpp;
                            let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                            output[dst_idx..dst_idx + bpp]
                                .copy_from_slice(&raw_data[src_idx..src_idx + bpp]);
                        }
                    }
                    continue;
                }

                if subencoding & BACKGROUND_SPECIFIED != 0 {
                    self.transport.read_exact(&mut bg_pixel).await?;
                }

                // Fill tile with background
                for row in 0..tile_h {
                    for col in 0..tile_w {
                        let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                        output[dst_idx..dst_idx + bpp].copy_from_slice(&bg_pixel);
                    }
                }

                if subencoding & FOREGROUND_SPECIFIED != 0 {
                    self.transport.read_exact(&mut fg_pixel).await?;
                }

                if subencoding & ANY_SUBRECTS != 0 {
                    let num_subrects = self.read_u8().await? as usize;

                    for _ in 0..num_subrects {
                        let pixel = if subencoding & SUBRECTS_COLORED != 0 {
                            let mut p = vec![0u8; bpp];
                            self.transport.read_exact(&mut p).await?;
                            p
                        } else {
                            fg_pixel.clone()
                        };

                        let xy = self.read_u8().await?;
                        let wh = self.read_u8().await?;

                        let sx = (xy >> 4) as usize;
                        let sy = (xy & 0x0F) as usize;
                        let sw = ((wh >> 4) + 1) as usize;
                        let sh = ((wh & 0x0F) + 1) as usize;

                        for row in 0..sh {
                            for col in 0..sw {
                                let x = tile_x + sx + col;
                                let y = tile_y + sy + row;
                                if x < width as usize && y < height as usize {
                                    let dst_idx = (y * width as usize + x) * bpp;
                                    output[dst_idx..dst_idx + bpp].copy_from_slice(&pixel);
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(output)
    }

    /// Read and decode Tight encoding
    async fn read_tight(&mut self, width: u16, height: u16) -> Result<Vec<u8>, RFBError> {
        let bpp = (self.pixel_format.bits_per_pixel / 8) as usize;
        
        // Tight encoding is variable-length, we need to read it incrementally
        // First, read a reasonable buffer and try to decode
        // The maximum size for tight is roughly the uncompressed size
        let max_size = width as usize * height as usize * bpp + 1024;
        let mut buffer = Vec::with_capacity(max_size);
        
        // Read control byte
        let control = self.read_u8().await?;
        buffer.push(control);
        
        // Determine how much more data we need based on control byte
        let comp_type = control >> 4;
        
        // TPIXEL size
        let tpixel_size = if self.pixel_format.true_color
            && self.pixel_format.bits_per_pixel == 32
            && self.pixel_format.depth == 24
        {
            3
        } else {
            bpp
        };
        
        if control & 0xF0 == 0x80 {
            // Fill - just need one TPIXEL
            let mut pixel = vec![0u8; tpixel_size];
            self.transport.read_exact(&mut pixel).await?;
            buffer.extend_from_slice(&pixel);
        } else if control & 0xF0 == 0x90 {
            // JPEG - read compact length then JPEG data
            let len_data = self.read_compact_length().await?;
            buffer.extend_from_slice(&len_data.0);
            
            let mut jpeg_data = vec![0u8; len_data.1];
            self.transport.read_exact(&mut jpeg_data).await?;
            buffer.extend_from_slice(&jpeg_data);
        } else if comp_type <= 7 {
            // BasicCompression
            let has_filter = control & 0x40 != 0;
            
            if has_filter {
                let filter_id = self.read_u8().await?;
                buffer.push(filter_id);
                
                if filter_id == 0x01 {
                    // Palette filter
                    let palette_size = self.read_u8().await?;
                    buffer.push(palette_size);
                    
                    let palette_len = (palette_size as usize + 1) * tpixel_size;
                    let mut palette_data = vec![0u8; palette_len];
                    self.transport.read_exact(&mut palette_data).await?;
                    buffer.extend_from_slice(&palette_data);
                    
                    // Calculate data length for palette mode
                    let bits_per_pixel = if palette_size < 2 { 1 } else { 8 };
                    let row_bytes = if bits_per_pixel == 1 {
                        (width as usize + 7) / 8
                    } else {
                        width as usize
                    };
                    let data_len = row_bytes * height as usize;
                    
                    // Read compressed or uncompressed data
                    if data_len < 12 {
                        let mut raw = vec![0u8; data_len];
                        self.transport.read_exact(&mut raw).await?;
                        buffer.extend_from_slice(&raw);
                    } else {
                        let len_data = self.read_compact_length().await?;
                        buffer.extend_from_slice(&len_data.0);
                        
                        let mut compressed = vec![0u8; len_data.1];
                        self.transport.read_exact(&mut compressed).await?;
                        buffer.extend_from_slice(&compressed);
                    }
                } else {
                    // Gradient or Copy filter
                    let data_len = width as usize * height as usize * tpixel_size;
                    
                    if data_len < 12 {
                        let mut raw = vec![0u8; data_len];
                        self.transport.read_exact(&mut raw).await?;
                        buffer.extend_from_slice(&raw);
                    } else {
                        let len_data = self.read_compact_length().await?;
                        buffer.extend_from_slice(&len_data.0);
                        
                        let mut compressed = vec![0u8; len_data.1];
                        self.transport.read_exact(&mut compressed).await?;
                        buffer.extend_from_slice(&compressed);
                    }
                }
            } else {
                // No explicit filter (Copy filter implied)
                let data_len = width as usize * height as usize * tpixel_size;
                
                if data_len < 12 {
                    let mut raw = vec![0u8; data_len];
                    self.transport.read_exact(&mut raw).await?;
                    buffer.extend_from_slice(&raw);
                } else {
                    let len_data = self.read_compact_length().await?;
                    buffer.extend_from_slice(&len_data.0);
                    
                    let mut compressed = vec![0u8; len_data.1];
                    self.transport.read_exact(&mut compressed).await?;
                    buffer.extend_from_slice(&compressed);
                }
            }
        }
        
        // Now decode the buffered data
        match encodings::decode_tight(&buffer, width, height, &self.pixel_format, &mut self.tight_zlib_state) {
            Ok((decoded, _consumed)) => Ok(decoded),
            Err(e) => {
                warn!("Tight decode failed: {}", e);
                // Return black pixels as fallback
                Ok(vec![0u8; width as usize * height as usize * bpp])
            }
        }
    }
    
    /// Read a Tight compact length (1-3 bytes)
    async fn read_compact_length(&mut self) -> Result<(Vec<u8>, usize), RFBError> {
        let b0 = self.read_u8().await?;
        
        if b0 & 0x80 == 0 {
            return Ok((vec![b0], b0 as usize));
        }
        
        let b1 = self.read_u8().await?;
        if b1 & 0x80 == 0 {
            let len = ((b0 & 0x7F) as usize) | ((b1 as usize) << 7);
            return Ok((vec![b0, b1], len));
        }
        
        let b2 = self.read_u8().await?;
        let len = ((b0 & 0x7F) as usize) | (((b1 & 0x7F) as usize) << 7) | ((b2 as usize) << 14);
        Ok((vec![b0, b1, b2], len))
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
        self.transport.write_all(&msg).await?;
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
        self.transport.write_all(&msg).await?;
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

    /// Send clipboard text to the server (ClientCutText)
    pub async fn send_clipboard(&mut self, text: &str) -> Result<(), RFBError> {
        let text_bytes = text.as_bytes();
        let mut msg = vec![0u8; 8 + text_bytes.len()];
        msg[0] = 6; // ClientCutText
        // 3 bytes padding
        msg[4..8].copy_from_slice(&(text_bytes.len() as u32).to_be_bytes());
        msg[8..].copy_from_slice(text_bytes);
        self.transport.write_all(&msg).await?;
        Ok(())
    }
    
    /// Take the last clipboard text received from server (clears it after reading)
    pub fn take_server_clipboard(&mut self) -> Option<String> {
        self.last_server_clipboard.take()
    }
    
    /// Get the last clipboard text received from server (does not clear)
    pub fn get_server_clipboard(&self) -> Option<&str> {
        self.last_server_clipboard.as_deref()
    }

    // Helper methods for reading values
    async fn read_u8(&mut self) -> Result<u8, RFBError> {
        let mut buf = [0u8; 1];
        self.transport.read_exact(&mut buf).await?;
        Ok(buf[0])
    }

    async fn read_u16(&mut self) -> Result<u16, RFBError> {
        let mut buf = [0u8; 2];
        self.transport.read_exact(&mut buf).await?;
        Ok(u16::from_be_bytes(buf))
    }

    async fn read_u32(&mut self) -> Result<u32, RFBError> {
        let mut buf = [0u8; 4];
        self.transport.read_exact(&mut buf).await?;
        Ok(u32::from_be_bytes(buf))
    }

    async fn read_i32(&mut self) -> Result<i32, RFBError> {
        let mut buf = [0u8; 4];
        self.transport.read_exact(&mut buf).await?;
        Ok(i32::from_be_bytes(buf))
    }
}
