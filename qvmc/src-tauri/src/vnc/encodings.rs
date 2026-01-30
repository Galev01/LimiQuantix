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
use flate2::Decompress;
use std::io::Read;
use tracing::{trace, warn};

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

/// Persistent zlib decompressor state for Tight encoding
/// The Tight spec requires maintaining 4 zlib streams that persist across frames
pub struct TightZlibState {
    streams: [Option<Decompress>; 4],
}

impl TightZlibState {
    pub fn new() -> Self {
        Self {
            streams: [None, None, None, None],
        }
    }

    /// Get or create a decompressor for the given stream index (0-3)
    fn get_or_create(&mut self, stream_id: usize) -> &mut Decompress {
        if stream_id >= 4 {
            panic!("Tight stream ID must be 0-3, got {}", stream_id);
        }
        if self.streams[stream_id].is_none() {
            self.streams[stream_id] = Some(Decompress::new(true));
        }
        self.streams[stream_id].as_mut().unwrap()
    }

    /// Reset a specific stream (called when server sends reset control)
    pub fn reset_stream(&mut self, stream_id: usize) {
        if stream_id < 4 {
            self.streams[stream_id] = None;
        }
    }

    /// Reset all streams
    pub fn reset_all(&mut self) {
        self.streams = [None, None, None, None];
    }
}

impl Default for TightZlibState {
    fn default() -> Self {
        Self::new()
    }
}

/// Decode ZRLE (Zlib Run-Length Encoding)
/// ZRLE processes the rectangle in 64x64 tiles with various sub-encodings
pub fn decode_zrle(
    data: &[u8],
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
) -> Result<Vec<u8>, String> {
    let bpp = (pixel_format.bits_per_pixel / 8) as usize;
    let pixel_count = width as usize * height as usize;
    let mut output = vec![0u8; pixel_count * bpp];

    if data.len() < 4 {
        return Err("ZRLE: insufficient data for length".to_string());
    }

    // Read compressed length (4 bytes big-endian)
    let compressed_len = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;

    if data.len() < 4 + compressed_len {
        return Err(format!(
            "ZRLE: insufficient compressed data (need {}, have {})",
            4 + compressed_len,
            data.len()
        ));
    }

    // Decompress the entire data block
    let compressed = &data[4..4 + compressed_len];
    let mut decoder = ZlibDecoder::new(compressed);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| format!("ZRLE: zlib decompression failed: {}", e))?;

    // CPIXEL (Compressed Pixel) size: 3 bytes if true color with 8 bits per channel, else bpp
    let cpixel_size = if pixel_format.true_color
        && pixel_format.bits_per_pixel == 32
        && pixel_format.depth == 24
    {
        3 // True color 32bpp uses 3-byte CPIXEL
    } else {
        bpp
    };

    let mut offset = 0;

    // Process 64x64 tiles
    let tile_size = 64;
    let tiles_y = (height as usize + tile_size - 1) / tile_size;
    let tiles_x = (width as usize + tile_size - 1) / tile_size;

    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let tile_x = tx * tile_size;
            let tile_y = ty * tile_size;
            let tile_w = std::cmp::min(tile_size, width as usize - tile_x);
            let tile_h = std::cmp::min(tile_size, height as usize - tile_y);

            if offset >= decompressed.len() {
                return Err("ZRLE: unexpected end of decompressed data".to_string());
            }

            let subencoding = decompressed[offset];
            offset += 1;

            match subencoding {
                0 => {
                    // Raw pixels
                    let raw_len = tile_w * tile_h * cpixel_size;
                    if offset + raw_len > decompressed.len() {
                        return Err("ZRLE: insufficient data for raw tile".to_string());
                    }

                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let src_idx = offset + (row * tile_w + col) * cpixel_size;
                            let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                            copy_cpixel_to_pixel(
                                &decompressed[src_idx..],
                                &mut output[dst_idx..],
                                cpixel_size,
                                bpp,
                                pixel_format,
                            );
                        }
                    }
                    offset += raw_len;
                }
                1 => {
                    // Solid color
                    if offset + cpixel_size > decompressed.len() {
                        return Err("ZRLE: insufficient data for solid tile".to_string());
                    }

                    let mut pixel = vec![0u8; bpp];
                    copy_cpixel_to_pixel(
                        &decompressed[offset..],
                        &mut pixel,
                        cpixel_size,
                        bpp,
                        pixel_format,
                    );
                    offset += cpixel_size;

                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                            output[dst_idx..dst_idx + bpp].copy_from_slice(&pixel);
                        }
                    }
                }
                2..=16 => {
                    // Packed palette (palette size = subencoding)
                    let palette_size = subencoding as usize;
                    if offset + palette_size * cpixel_size > decompressed.len() {
                        return Err("ZRLE: insufficient data for palette".to_string());
                    }

                    // Read palette
                    let mut palette = Vec::with_capacity(palette_size);
                    for _ in 0..palette_size {
                        let mut pixel = vec![0u8; bpp];
                        copy_cpixel_to_pixel(
                            &decompressed[offset..],
                            &mut pixel,
                            cpixel_size,
                            bpp,
                            pixel_format,
                        );
                        palette.push(pixel);
                        offset += cpixel_size;
                    }

                    // Determine bits per palette index
                    let bits_per_index = if palette_size <= 2 {
                        1
                    } else if palette_size <= 4 {
                        2
                    } else {
                        4
                    };
                    let indices_per_byte = 8 / bits_per_index;
                    let mask = (1u8 << bits_per_index) - 1;

                    // Read packed pixel data
                    for row in 0..tile_h {
                        let row_bytes = (tile_w + indices_per_byte - 1) / indices_per_byte;
                        if offset + row_bytes > decompressed.len() {
                            return Err("ZRLE: insufficient data for packed pixels".to_string());
                        }

                        for col in 0..tile_w {
                            let byte_idx = col / indices_per_byte;
                            let bit_idx = (indices_per_byte - 1 - (col % indices_per_byte)) * bits_per_index;
                            let palette_idx =
                                ((decompressed[offset + byte_idx] >> bit_idx) & mask) as usize;

                            if palette_idx < palette.len() {
                                let dst_idx =
                                    ((tile_y + row) * width as usize + tile_x + col) * bpp;
                                output[dst_idx..dst_idx + bpp].copy_from_slice(&palette[palette_idx]);
                            }
                        }
                        offset += row_bytes;
                    }
                }
                128 => {
                    // Plain RLE
                    let tile_pixels = tile_w * tile_h;
                    let mut pixels_done = 0;

                    while pixels_done < tile_pixels {
                        if offset + cpixel_size > decompressed.len() {
                            return Err("ZRLE: insufficient data for RLE pixel".to_string());
                        }

                        let mut pixel = vec![0u8; bpp];
                        copy_cpixel_to_pixel(
                            &decompressed[offset..],
                            &mut pixel,
                            cpixel_size,
                            bpp,
                            pixel_format,
                        );
                        offset += cpixel_size;

                        // Read run length
                        let mut run_len = 1usize;
                        loop {
                            if offset >= decompressed.len() {
                                return Err("ZRLE: insufficient data for RLE length".to_string());
                            }
                            let byte = decompressed[offset] as usize;
                            offset += 1;
                            run_len += byte;
                            if byte != 255 {
                                break;
                            }
                        }

                        for _ in 0..run_len {
                            if pixels_done >= tile_pixels {
                                break;
                            }
                            let row = pixels_done / tile_w;
                            let col = pixels_done % tile_w;
                            let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                            output[dst_idx..dst_idx + bpp].copy_from_slice(&pixel);
                            pixels_done += 1;
                        }
                    }
                }
                129..=255 => {
                    // Palette RLE
                    let palette_size = (subencoding - 128) as usize;
                    if offset + palette_size * cpixel_size > decompressed.len() {
                        return Err("ZRLE: insufficient data for RLE palette".to_string());
                    }

                    // Read palette
                    let mut palette = Vec::with_capacity(palette_size);
                    for _ in 0..palette_size {
                        let mut pixel = vec![0u8; bpp];
                        copy_cpixel_to_pixel(
                            &decompressed[offset..],
                            &mut pixel,
                            cpixel_size,
                            bpp,
                            pixel_format,
                        );
                        palette.push(pixel);
                        offset += cpixel_size;
                    }

                    let tile_pixels = tile_w * tile_h;
                    let mut pixels_done = 0;

                    while pixels_done < tile_pixels {
                        if offset >= decompressed.len() {
                            return Err("ZRLE: insufficient data for palette RLE".to_string());
                        }

                        let index_byte = decompressed[offset];
                        offset += 1;

                        let palette_idx = (index_byte & 0x7F) as usize;
                        let pixel = if palette_idx < palette.len() {
                            &palette[palette_idx]
                        } else {
                            // Fallback to black
                            &vec![0u8; bpp]
                        };

                        if index_byte & 0x80 != 0 {
                            // RLE run
                            let mut run_len = 1usize;
                            loop {
                                if offset >= decompressed.len() {
                                    return Err(
                                        "ZRLE: insufficient data for palette RLE length".to_string()
                                    );
                                }
                                let byte = decompressed[offset] as usize;
                                offset += 1;
                                run_len += byte;
                                if byte != 255 {
                                    break;
                                }
                            }

                            for _ in 0..run_len {
                                if pixels_done >= tile_pixels {
                                    break;
                                }
                                let row = pixels_done / tile_w;
                                let col = pixels_done % tile_w;
                                let dst_idx =
                                    ((tile_y + row) * width as usize + tile_x + col) * bpp;
                                output[dst_idx..dst_idx + bpp].copy_from_slice(pixel);
                                pixels_done += 1;
                            }
                        } else {
                            // Single pixel
                            let row = pixels_done / tile_w;
                            let col = pixels_done % tile_w;
                            let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                            output[dst_idx..dst_idx + bpp].copy_from_slice(pixel);
                            pixels_done += 1;
                        }
                    }
                }
                _ => {
                    warn!("ZRLE: unsupported subencoding {}", subencoding);
                    // Fill with black
                    for row in 0..tile_h {
                        for col in 0..tile_w {
                            let dst_idx = ((tile_y + row) * width as usize + tile_x + col) * bpp;
                            for i in 0..bpp {
                                output[dst_idx + i] = 0;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Copy CPIXEL (compressed pixel, 3 bytes) to full pixel format
fn copy_cpixel_to_pixel(
    src: &[u8],
    dst: &mut [u8],
    cpixel_size: usize,
    bpp: usize,
    pixel_format: &PixelFormat,
) {
    if cpixel_size == bpp {
        dst[..bpp].copy_from_slice(&src[..bpp]);
    } else if cpixel_size == 3 && bpp == 4 {
        // Convert 3-byte CPIXEL to 4-byte pixel
        // CPIXEL is always in native byte order (least significant bytes)
        if pixel_format.big_endian {
            dst[0] = 0; // Padding
            dst[1] = src[0]; // R/G/B depending on shift
            dst[2] = src[1];
            dst[3] = src[2];
        } else {
            dst[0] = src[0];
            dst[1] = src[1];
            dst[2] = src[2];
            dst[3] = 0; // Padding
        }
    } else {
        // Fallback: zero-fill
        for i in 0..bpp {
            dst[i] = if i < cpixel_size { src[i] } else { 0 };
        }
    }
}

/// Tight encoding control byte flags
const TIGHT_EXPLICIT_FILTER: u8 = 0x40;
const TIGHT_FILL: u8 = 0x80;
const TIGHT_JPEG: u8 = 0x90;
const TIGHT_MAX_SUBENCODING: u8 = 0x90;

const TIGHT_FILTER_COPY: u8 = 0x00;
const TIGHT_FILTER_PALETTE: u8 = 0x01;
const TIGHT_FILTER_GRADIENT: u8 = 0x02;

/// Decode Tight encoding
/// Tight uses a combination of zlib compression, palettes, and JPEG for maximum compression
pub fn decode_tight(
    data: &[u8],
    width: u16,
    height: u16,
    pixel_format: &PixelFormat,
    zlib_state: &mut TightZlibState,
) -> Result<(Vec<u8>, usize), String> {
    let bpp = (pixel_format.bits_per_pixel / 8) as usize;
    let pixel_count = width as usize * height as usize;

    if data.is_empty() {
        return Err("Tight: empty data".to_string());
    }

    let mut offset = 0;
    let control = data[offset];
    offset += 1;

    // Check for stream resets (bits 0-3)
    for i in 0..4 {
        if control & (1 << i) != 0 {
            trace!("Tight: resetting zlib stream {}", i);
            zlib_state.reset_stream(i);
        }
    }

    // Determine compression type from bits 4-7
    let comp_type = control >> 4;

    match comp_type {
        // FillCompression
        _ if control & 0xF0 == TIGHT_FILL => {
            // TPIXEL (tight pixel) is 3 bytes for true color 32bpp
            let tpixel_size = if pixel_format.true_color
                && pixel_format.bits_per_pixel == 32
                && pixel_format.depth == 24
            {
                3
            } else {
                bpp
            };

            if offset + tpixel_size > data.len() {
                return Err("Tight Fill: insufficient data for pixel".to_string());
            }

            let mut fill_pixel = vec![0u8; bpp];
            copy_cpixel_to_pixel(&data[offset..], &mut fill_pixel, tpixel_size, bpp, pixel_format);
            offset += tpixel_size;

            // Fill entire rectangle with this color
            let mut output = vec![0u8; pixel_count * bpp];
            for i in 0..pixel_count {
                output[i * bpp..(i + 1) * bpp].copy_from_slice(&fill_pixel);
            }

            Ok((output, offset))
        }

        // JpegCompression
        _ if control & 0xF0 == TIGHT_JPEG => {
            // Read compact length
            let (jpeg_len, len_bytes) = read_compact_len(&data[offset..])?;
            offset += len_bytes;

            if offset + jpeg_len > data.len() {
                return Err(format!(
                    "Tight JPEG: insufficient data (need {}, have {})",
                    jpeg_len,
                    data.len() - offset
                ));
            }

            let jpeg_data = &data[offset..offset + jpeg_len];
            offset += jpeg_len;

            // Decode JPEG
            let decoded = decode_jpeg_to_pixels(jpeg_data, width, height, bpp)?;

            Ok((decoded, offset))
        }

        // BasicCompression (0-7)
        0..=7 => {
            let stream_id = ((control >> 4) & 0x03) as usize;

            // Determine filter type
            let filter_id = if control & TIGHT_EXPLICIT_FILTER != 0 {
                if offset >= data.len() {
                    return Err("Tight: insufficient data for filter ID".to_string());
                }
                let f = data[offset];
                offset += 1;
                f
            } else {
                TIGHT_FILTER_COPY
            };

            // TPIXEL size
            let tpixel_size = if pixel_format.true_color
                && pixel_format.bits_per_pixel == 32
                && pixel_format.depth == 24
            {
                3
            } else {
                bpp
            };

            match filter_id {
                TIGHT_FILTER_PALETTE => {
                    // Palette filter
                    if offset >= data.len() {
                        return Err("Tight: insufficient data for palette size".to_string());
                    }
                    let palette_size = data[offset] as usize + 1;
                    offset += 1;

                    if offset + palette_size * tpixel_size > data.len() {
                        return Err("Tight: insufficient data for palette".to_string());
                    }

                    // Read palette
                    let mut palette = Vec::with_capacity(palette_size);
                    for _ in 0..palette_size {
                        let mut pixel = vec![0u8; bpp];
                        copy_cpixel_to_pixel(
                            &data[offset..],
                            &mut pixel,
                            tpixel_size,
                            bpp,
                            pixel_format,
                        );
                        palette.push(pixel);
                        offset += tpixel_size;
                    }

                    // Read indexed pixel data
                    let bits_per_pixel = if palette_size <= 2 { 1 } else { 8 };
                    let row_bytes = if bits_per_pixel == 1 {
                        (width as usize + 7) / 8
                    } else {
                        width as usize
                    };

                    let data_len = row_bytes * height as usize;
                    let (pixel_data, consumed) = decompress_tight_data(
                        &data[offset..],
                        data_len,
                        stream_id,
                        zlib_state,
                    )?;
                    offset += consumed;

                    // Convert indexed to pixels
                    let mut output = vec![0u8; pixel_count * bpp];
                    for row in 0..height as usize {
                        for col in 0..width as usize {
                            let idx = if bits_per_pixel == 1 {
                                let byte_idx = row * row_bytes + col / 8;
                                let bit_idx = 7 - (col % 8);
                                if byte_idx < pixel_data.len() {
                                    ((pixel_data[byte_idx] >> bit_idx) & 1) as usize
                                } else {
                                    0
                                }
                            } else {
                                let byte_idx = row * row_bytes + col;
                                if byte_idx < pixel_data.len() {
                                    pixel_data[byte_idx] as usize
                                } else {
                                    0
                                }
                            };

                            let out_idx = (row * width as usize + col) * bpp;
                            if idx < palette.len() {
                                output[out_idx..out_idx + bpp].copy_from_slice(&palette[idx]);
                            }
                        }
                    }

                    Ok((output, offset))
                }
                TIGHT_FILTER_GRADIENT => {
                    // Gradient filter - similar to PNG "paeth" predictor
                    let data_len = width as usize * height as usize * tpixel_size;
                    let (raw_data, consumed) = decompress_tight_data(
                        &data[offset..],
                        data_len,
                        stream_id,
                        zlib_state,
                    )?;
                    offset += consumed;

                    // Apply gradient filter (undo the prediction)
                    let mut output = vec![0u8; pixel_count * bpp];
                    let mut prev_row = vec![0u8; width as usize * tpixel_size];

                    for row in 0..height as usize {
                        let mut left = [0u8; 4]; // Previous pixel in row
                        for col in 0..width as usize {
                            let src_idx = (row * width as usize + col) * tpixel_size;
                            let dst_idx = (row * width as usize + col) * bpp;

                            for c in 0..tpixel_size {
                                let above = if row > 0 {
                                    prev_row[col * tpixel_size + c]
                                } else {
                                    0
                                };
                                let left_val = left[c];
                                let above_left = if row > 0 && col > 0 {
                                    prev_row[(col - 1) * tpixel_size + c]
                                } else {
                                    0
                                };

                                // Prediction: left + above - above_left
                                let pred = left_val as i32 + above as i32 - above_left as i32;
                                let pred = pred.clamp(0, 255) as u8;

                                let raw_val = if src_idx + c < raw_data.len() {
                                    raw_data[src_idx + c]
                                } else {
                                    0
                                };
                                let actual = raw_val.wrapping_add(pred);

                                if c < bpp {
                                    // Handle TPIXEL to full pixel conversion
                                    if tpixel_size == 3 && bpp == 4 {
                                        if c < 3 {
                                            output[dst_idx + c] = actual;
                                        }
                                    } else {
                                        output[dst_idx + c] = actual;
                                    }
                                }
                                left[c] = actual;
                            }
                            if tpixel_size == 3 && bpp == 4 {
                                output[dst_idx + 3] = 0; // Alpha padding
                            }

                            // Update prev_row
                            for c in 0..tpixel_size {
                                prev_row[col * tpixel_size + c] = left[c];
                            }
                        }
                    }

                    Ok((output, offset))
                }
                TIGHT_FILTER_COPY | _ => {
                    // Copy filter (no filtering, just raw/compressed pixels)
                    let data_len = width as usize * height as usize * tpixel_size;
                    let (raw_data, consumed) = decompress_tight_data(
                        &data[offset..],
                        data_len,
                        stream_id,
                        zlib_state,
                    )?;
                    offset += consumed;

                    // Convert TPIXEL to full pixels
                    let mut output = vec![0u8; pixel_count * bpp];
                    for i in 0..pixel_count {
                        copy_cpixel_to_pixel(
                            &raw_data[i * tpixel_size..],
                            &mut output[i * bpp..],
                            tpixel_size,
                            bpp,
                            pixel_format,
                        );
                    }

                    Ok((output, offset))
                }
            }
        }

        _ => Err(format!("Tight: unsupported compression type {}", comp_type)),
    }
}

/// Read a compact length value (1-3 bytes)
fn read_compact_len(data: &[u8]) -> Result<(usize, usize), String> {
    if data.is_empty() {
        return Err("Tight: insufficient data for compact length".to_string());
    }

    let b0 = data[0] as usize;
    if b0 & 0x80 == 0 {
        // 1 byte: 0-127
        return Ok((b0, 1));
    }

    if data.len() < 2 {
        return Err("Tight: insufficient data for compact length (2 bytes)".to_string());
    }
    let b1 = data[1] as usize;
    if b1 & 0x80 == 0 {
        // 2 bytes: 128-16383
        return Ok(((b0 & 0x7F) | (b1 << 7), 2));
    }

    if data.len() < 3 {
        return Err("Tight: insufficient data for compact length (3 bytes)".to_string());
    }
    let b2 = data[2] as usize;
    // 3 bytes: 16384-4194303
    Ok(((b0 & 0x7F) | ((b1 & 0x7F) << 7) | (b2 << 14), 3))
}

/// Decompress Tight data using the persistent zlib stream
fn decompress_tight_data(
    data: &[u8],
    expected_len: usize,
    stream_id: usize,
    zlib_state: &mut TightZlibState,
) -> Result<(Vec<u8>, usize), String> {
    // Data < 12 bytes is sent uncompressed
    if expected_len < 12 {
        if data.len() < expected_len {
            return Err("Tight: insufficient uncompressed data".to_string());
        }
        return Ok((data[..expected_len].to_vec(), expected_len));
    }

    // Read compact length
    let (compressed_len, len_bytes) = read_compact_len(data)?;

    if data.len() < len_bytes + compressed_len {
        return Err(format!(
            "Tight: insufficient compressed data (need {}, have {})",
            len_bytes + compressed_len,
            data.len()
        ));
    }

    let compressed = &data[len_bytes..len_bytes + compressed_len];

    // Use the persistent zlib stream
    let decompressor = zlib_state.get_or_create(stream_id);

    let mut output = vec![0u8; expected_len];

    // Track bytes written by comparing total_out before and after
    let total_out_before = decompressor.total_out();

    let _status = decompressor
        .decompress(compressed, &mut output, flate2::FlushDecompress::Sync)
        .map_err(|e| format!("Tight: zlib decompression failed: {}", e))?;

    let bytes_written = (decompressor.total_out() - total_out_before) as usize;

    // If we didn't get enough data, the stream state might be corrupted
    if bytes_written < expected_len {
        warn!(
            "Tight: got {} bytes, expected {}",
            bytes_written, expected_len
        );
        output.truncate(bytes_written);
    }

    Ok((output, len_bytes + compressed_len))
}

/// Decode JPEG data to pixel buffer
fn decode_jpeg_to_pixels(
    jpeg_data: &[u8],
    width: u16,
    height: u16,
    bpp: usize,
) -> Result<Vec<u8>, String> {
    use image::io::Reader as ImageReader;
    use std::io::Cursor;

    let cursor = Cursor::new(jpeg_data);
    let reader = ImageReader::with_format(cursor, image::ImageFormat::Jpeg);

    let img = reader
        .decode()
        .map_err(|e| format!("Tight: JPEG decode failed: {}", e))?;

    let rgb = img.to_rgb8();

    // Convert to the expected pixel format
    let pixel_count = width as usize * height as usize;
    let mut output = vec![0u8; pixel_count * bpp];

    for (i, pixel) in rgb.pixels().enumerate() {
        if i >= pixel_count {
            break;
        }
        let out_idx = i * bpp;
        if bpp >= 3 {
            output[out_idx] = pixel[0]; // R
            output[out_idx + 1] = pixel[1]; // G
            output[out_idx + 2] = pixel[2]; // B
            if bpp == 4 {
                output[out_idx + 3] = 255; // A
            }
        }
    }

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
