//! VNC Encoding Implementations
//!
//! This module contains decoders for various VNC encodings:
//! - Raw (0): Uncompressed pixel data
//! - CopyRect (1): Copy from another rectangle
//! - RRE (2): Rise-and-Run-length Encoding
//! - Hextile (5): 16x16 tile-based encoding
//! - Zlib (6): Zlib-compressed raw data
//! - Tight (7): JPEG + zlib compression
//! - ZRLE (16): Zlib Run-Length Encoding

use super::rfb::PixelFormat;
use flate2::read::ZlibDecoder;
use std::io::Read;
use tracing::{debug, warn};

/// Decode RRE (Rise-and-Run-length Encoding)
pub fn decode_rre(
    data: &[u8],
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
) -> Result<Vec<u8>, String> {
    let bpp = (pixel_format.bits_per_pixel / 8) as usize;
    let mut offset = 0;

    // Number of subrectangles
    if data.len() < 4 {
        return Err("RRE: insufficient data for header".to_string());
    }
    let num_subrects = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
    offset += 4;

    // Background pixel
    if data.len() < offset + bpp {
        return Err("RRE: insufficient data for background".to_string());
    }
    let bg_pixel = &data[offset..offset + bpp];
    offset += bpp;

    // Initialize with background
    let pixel_count = width as usize * height as usize;
    let mut output = vec![0u8; pixel_count * bpp];
    for i in 0..pixel_count {
        output[i * bpp..(i + 1) * bpp].copy_from_slice(bg_pixel);
    }

    // Process subrectangles
    for _ in 0..num_subrects {
        if data.len() < offset + bpp + 8 {
            return Err("RRE: insufficient data for subrectangle".to_string());
        }

        let pixel = &data[offset..offset + bpp];
        offset += bpp;

        let x = u16::from_be_bytes([data[offset], data[offset + 1]]) as usize;
        let y = u16::from_be_bytes([data[offset + 2], data[offset + 3]]) as usize;
        let w = u16::from_be_bytes([data[offset + 4], data[offset + 5]]) as usize;
        let h = u16::from_be_bytes([data[offset + 6], data[offset + 7]]) as usize;
        offset += 8;

        // Fill subrectangle
        for row in y..y + h {
            for col in x..x + w {
                if row < height as usize && col < width as usize {
                    let idx = (row * width as usize + col) * bpp;
                    output[idx..idx + bpp].copy_from_slice(pixel);
                }
            }
        }
    }

    Ok(output)
}

/// Decode Hextile encoding
pub fn decode_hextile(
    data: &[u8],
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
) -> Result<Vec<u8>, String> {
    let bpp = (pixel_format.bits_per_pixel / 8) as usize;
    let pixel_count = width as usize * height as usize;
    let mut output = vec![0u8; pixel_count * bpp];
    let mut offset = 0;

    // Hextile subencoding flags
    const RAW: u8 = 1;
    const BACKGROUND_SPECIFIED: u8 = 2;
    const FOREGROUND_SPECIFIED: u8 = 4;
    const ANY_SUBRECTS: u8 = 8;
    const SUBRECTS_COLORED: u8 = 16;

    let mut bg_pixel = vec![0u8; bpp];
    let mut fg_pixel = vec![0u8; bpp];

    // Process 16x16 tiles
    let tiles_x = (width as usize + 15) / 16;
    let tiles_y = (height as usize + 15) / 16;

    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let tile_x = tx * 16;
            let tile_y = ty * 16;
            let tile_w = std::cmp::min(16, width as usize - tile_x);
            let tile_h = std::cmp::min(16, height as usize - tile_y);

            if offset >= data.len() {
                return Err("Hextile: unexpected end of data".to_string());
            }

            let subencoding = data[offset];
            offset += 1;

            if subencoding & RAW != 0 {
                // Raw tile
                let raw_len = tile_w * tile_h * bpp;
                if offset + raw_len > data.len() {
                    return Err("Hextile: insufficient data for raw tile".to_string());
                }

                for row in 0..tile_h {
                    for col in 0..tile_w {
                        let src_idx = (row * tile_w + col) * bpp;
                        let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                        output[dst_idx..dst_idx + bpp]
                            .copy_from_slice(&data[offset + src_idx..offset + src_idx + bpp]);
                    }
                }
                offset += raw_len;
                continue;
            }

            if subencoding & BACKGROUND_SPECIFIED != 0 {
                if offset + bpp > data.len() {
                    return Err("Hextile: insufficient data for background".to_string());
                }
                bg_pixel.copy_from_slice(&data[offset..offset + bpp]);
                offset += bpp;
            }

            // Fill tile with background
            for row in 0..tile_h {
                for col in 0..tile_w {
                    let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                    output[dst_idx..dst_idx + bpp].copy_from_slice(&bg_pixel);
                }
            }

            if subencoding & FOREGROUND_SPECIFIED != 0 {
                if offset + bpp > data.len() {
                    return Err("Hextile: insufficient data for foreground".to_string());
                }
                fg_pixel.copy_from_slice(&data[offset..offset + bpp]);
                offset += bpp;
            }

            if subencoding & ANY_SUBRECTS != 0 {
                if offset >= data.len() {
                    return Err("Hextile: insufficient data for subrect count".to_string());
                }
                let num_subrects = data[offset] as usize;
                offset += 1;

                for _ in 0..num_subrects {
                    let pixel = if subencoding & SUBRECTS_COLORED != 0 {
                        if offset + bpp > data.len() {
                            return Err("Hextile: insufficient data for subrect color".to_string());
                        }
                        let p = &data[offset..offset + bpp];
                        offset += bpp;
                        p
                    } else {
                        &fg_pixel
                    };

                    if offset + 2 > data.len() {
                        return Err("Hextile: insufficient data for subrect coords".to_string());
                    }

                    let xy = data[offset];
                    let wh = data[offset + 1];
                    offset += 2;

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
                                output[dst_idx..dst_idx + bpp].copy_from_slice(pixel);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Decode Zlib encoding
pub fn decode_zlib(
    data: &[u8],
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
) -> Result<Vec<u8>, String> {
    let bpp = (pixel_format.bits_per_pixel / 8) as usize;
    let expected_len = width as usize * height as usize * bpp;

    if data.len() < 4 {
        return Err("Zlib: insufficient data for length".to_string());
    }

    let compressed_len = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if data.len() < 4 + compressed_len {
        return Err("Zlib: insufficient compressed data".to_string());
    }

    let compressed = &data[4..4 + compressed_len];
    let mut decoder = ZlibDecoder::new(compressed);
    let mut output = vec![0u8; expected_len];

    decoder
        .read_exact(&mut output)
        .map_err(|e| format!("Zlib: decompression failed: {}", e))?;

    Ok(output)
}

/// Convert encoding ID to name
pub fn encoding_name(encoding: i32) -> &'static str {
    match encoding {
        0 => "Raw",
        1 => "CopyRect",
        2 => "RRE",
        4 => "CoRRE",
        5 => "Hextile",
        6 => "Zlib",
        7 => "Tight",
        8 => "ZlibHex",
        16 => "ZRLE",
        -239 => "Cursor",
        -223 => "DesktopSize",
        -224 => "LastRect",
        -307 => "PointerPos",
        _ => "Unknown",
    }
}
