//! Framebuffer Device Wrapper
//!
//! Provides access to the Linux framebuffer with double-buffering support.
//! Uses libc to directly mmap `/dev/fb0` into memory for direct pixel access.
//! Supports 16, 24, and 32-bit color depths with automatic format detection.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::unix::io::AsRawFd;

use anyhow::{Context, Result};
use embedded_graphics::{
    draw_target::DrawTarget,
    geometry::{OriginDimensions, Size},
    pixelcolor::{Rgb888, RgbColor},
    Pixel,
};
use tracing::{debug, info};

/// IOCTL constants for framebuffer
const FBIOGET_VSCREENINFO: libc::c_ulong = 0x4600;
const FBIOGET_FSCREENINFO: libc::c_ulong = 0x4602;

/// Variable screen info structure (simplified)
#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
struct FbVarScreenInfo {
    xres: u32,
    yres: u32,
    xres_virtual: u32,
    yres_virtual: u32,
    xoffset: u32,
    yoffset: u32,
    bits_per_pixel: u32,
    grayscale: u32,
    red: FbBitField,
    green: FbBitField,
    blue: FbBitField,
    transp: FbBitField,
    nonstd: u32,
    activate: u32,
    height: u32,
    width: u32,
    accel_flags: u32,
    // Timing info (not used but needed for struct size)
    pixclock: u32,
    left_margin: u32,
    right_margin: u32,
    upper_margin: u32,
    lower_margin: u32,
    hsync_len: u32,
    vsync_len: u32,
    sync: u32,
    vmode: u32,
    rotate: u32,
    colorspace: u32,
    reserved: [u32; 4],
}

#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
struct FbBitField {
    offset: u32,
    length: u32,
    msb_right: u32,
}

/// Fixed screen info structure (simplified)
#[repr(C)]
#[derive(Debug, Default, Clone, Copy)]
struct FbFixScreenInfo {
    id: [u8; 16],
    smem_start: libc::c_ulong,
    smem_len: u32,
    fb_type: u32,
    type_aux: u32,
    visual: u32,
    xpanstep: u16,
    ypanstep: u16,
    ywrapstep: u16,
    line_length: u32,
    mmio_start: libc::c_ulong,
    mmio_len: u32,
    accel: u32,
    capabilities: u16,
    reserved: [u16; 2],
}

/// Framebuffer wrapper with double-buffering
pub struct Framebuffer {
    file: File,
    mmap: *mut u8,
    mmap_len: usize,
    width: u32,
    height: u32,
    stride: u32,
    bits_per_pixel: u32,
    /// Back buffer for double-buffering
    back_buffer: Vec<u8>,
    /// Pixel format info
    red_offset: u32,
    green_offset: u32,
    blue_offset: u32,
}

// SAFETY: The mmap pointer is only accessed through Framebuffer methods
unsafe impl Send for Framebuffer {}

impl Framebuffer {
    /// Open the framebuffer device
    pub fn new(path: &str) -> Result<Self> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .with_context(|| format!("Failed to open framebuffer device: {}", path))?;

        let fd = file.as_raw_fd();

        // Get variable screen info
        let mut var_info: FbVarScreenInfo = Default::default();
        let ret = unsafe { libc::ioctl(fd, FBIOGET_VSCREENINFO, &mut var_info) };
        if ret < 0 {
            return Err(anyhow::anyhow!(
                "Failed to get variable screen info: {}",
                io::Error::last_os_error()
            ));
        }

        // Get fixed screen info
        let mut fix_info: FbFixScreenInfo = Default::default();
        let ret = unsafe { libc::ioctl(fd, FBIOGET_FSCREENINFO, &mut fix_info) };
        if ret < 0 {
            return Err(anyhow::anyhow!(
                "Failed to get fixed screen info: {}",
                io::Error::last_os_error()
            ));
        }

        let width = var_info.xres;
        let height = var_info.yres;
        let stride = fix_info.line_length;
        let bits_per_pixel = var_info.bits_per_pixel;
        let mmap_len = fix_info.smem_len as usize;

        info!(
            width = width,
            height = height,
            bpp = bits_per_pixel,
            stride = stride,
            "Framebuffer opened"
        );

        // Memory map the framebuffer
        let mmap = unsafe {
            libc::mmap(
                std::ptr::null_mut(),
                mmap_len,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_SHARED,
                fd,
                0,
            )
        };

        if mmap == libc::MAP_FAILED {
            return Err(anyhow::anyhow!(
                "Failed to mmap framebuffer: {}",
                io::Error::last_os_error()
            ));
        }

        // Create back buffer for double-buffering
        let back_buffer = vec![0u8; mmap_len];

        Ok(Self {
            file,
            mmap: mmap as *mut u8,
            mmap_len,
            width,
            height,
            stride,
            bits_per_pixel,
            back_buffer,
            red_offset: var_info.red.offset,
            green_offset: var_info.green.offset,
            blue_offset: var_info.blue.offset,
        })
    }

    /// Get the framebuffer dimensions
    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Clear the back buffer with a color
    pub fn clear(&mut self, color: Rgb888) {
        let bytes_per_pixel = (self.bits_per_pixel / 8) as usize;

        for y in 0..self.height {
            for x in 0..self.width {
                let offset = (y * self.stride + x * bytes_per_pixel as u32) as usize;
                self.write_pixel_to_buffer(offset, color);
            }
        }
    }

    /// Write a pixel to the back buffer
    fn write_pixel_to_buffer(&mut self, offset: usize, color: Rgb888) {
        if offset + 3 > self.back_buffer.len() {
            return;
        }

        match self.bits_per_pixel {
            32 => {
                // BGRA or RGBA format
                if self.blue_offset == 0 {
                    // BGRA
                    self.back_buffer[offset] = color.b();
                    self.back_buffer[offset + 1] = color.g();
                    self.back_buffer[offset + 2] = color.r();
                    self.back_buffer[offset + 3] = 0xFF;
                } else {
                    // RGBA
                    self.back_buffer[offset] = color.r();
                    self.back_buffer[offset + 1] = color.g();
                    self.back_buffer[offset + 2] = color.b();
                    self.back_buffer[offset + 3] = 0xFF;
                }
            }
            24 => {
                // BGR or RGB format
                if self.blue_offset == 0 {
                    self.back_buffer[offset] = color.b();
                    self.back_buffer[offset + 1] = color.g();
                    self.back_buffer[offset + 2] = color.r();
                } else {
                    self.back_buffer[offset] = color.r();
                    self.back_buffer[offset + 1] = color.g();
                    self.back_buffer[offset + 2] = color.b();
                }
            }
            16 => {
                // RGB565 format
                let r = (color.r() >> 3) as u16;
                let g = (color.g() >> 2) as u16;
                let b = (color.b() >> 3) as u16;
                let pixel = (r << 11) | (g << 5) | b;
                self.back_buffer[offset] = (pixel & 0xFF) as u8;
                self.back_buffer[offset + 1] = (pixel >> 8) as u8;
            }
            _ => {
                debug!(bpp = self.bits_per_pixel, "Unsupported bits per pixel");
            }
        }
    }

    /// Set a pixel in the back buffer
    pub fn set_pixel(&mut self, x: u32, y: u32, color: Rgb888) {
        if x >= self.width || y >= self.height {
            return;
        }

        let bytes_per_pixel = (self.bits_per_pixel / 8) as usize;
        let offset = (y * self.stride + x * bytes_per_pixel as u32) as usize;
        self.write_pixel_to_buffer(offset, color);
    }

    /// Flush the back buffer to the framebuffer (present)
    pub fn present(&mut self) {
        unsafe {
            std::ptr::copy_nonoverlapping(
                self.back_buffer.as_ptr(),
                self.mmap,
                self.back_buffer.len().min(self.mmap_len),
            );
        }
    }
}

impl Drop for Framebuffer {
    fn drop(&mut self) {
        unsafe {
            libc::munmap(self.mmap as *mut libc::c_void, self.mmap_len);
        }
    }
}

impl OriginDimensions for Framebuffer {
    fn size(&self) -> Size {
        Size::new(self.width, self.height)
    }
}

impl DrawTarget for Framebuffer {
    type Color = Rgb888;
    type Error = core::convert::Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(coord, color) in pixels {
            if coord.x >= 0
                && coord.y >= 0
                && (coord.x as u32) < self.width
                && (coord.y as u32) < self.height
            {
                self.set_pixel(coord.x as u32, coord.y as u32, color);
            }
        }
        Ok(())
    }
}
