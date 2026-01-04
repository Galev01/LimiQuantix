//! Raw Framebuffer Backend for Quantix-OS Console
//!
//! This module provides a fallback display backend that renders directly to `/dev/fb0`
//! when Slint's LinuxKMS backend is unavailable (e.g., VGA-only VMs, broken DRM).
//!
//! Architecture:
//! - `fb.rs` - Framebuffer device wrapper with double-buffering
//! - `ui.rs` - UI components (header, status panel, menu, dialogs)
//! - `input.rs` - Keyboard input via evdev or raw stdin
//! - `app.rs` - Application state and event loop

mod app;
mod fb;
mod input;
mod ui;

pub use app::run;
