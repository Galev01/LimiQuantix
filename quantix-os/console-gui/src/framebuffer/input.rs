//! Keyboard Input Handler
//!
//! Reads keyboard events from evdev (`/dev/input/event*`) for framebuffer mode.
//! Falls back to raw stdin if evdev is unavailable.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read};
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use evdev::{Device, EventType, InputEventKind, Key};
use tracing::{debug, error, info, warn};

/// Key events that the UI responds to
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyEvent {
    /// F1-F12 function keys
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    /// Navigation
    Up,
    Down,
    Left,
    Right,
    Enter,
    Escape,
    Tab,
    /// Character input (for dialogs)
    Char(char),
    Backspace,
    /// Special
    Quit,
}

/// Input handler that reads from evdev or stdin
pub struct InputHandler {
    rx: Receiver<KeyEvent>,
    _thread: JoinHandle<()>,
}

impl InputHandler {
    /// Create a new input handler
    ///
    /// Tries to open evdev keyboard devices first, falls back to stdin
    pub fn new() -> Result<Self> {
        let (tx, rx) = mpsc::channel();

        // Try to find keyboard devices
        let keyboards = find_keyboard_devices();

        let thread = if !keyboards.is_empty() {
            info!(count = keyboards.len(), "Found keyboard devices via evdev");
            spawn_evdev_reader(keyboards, tx)
        } else {
            warn!("No evdev keyboards found, falling back to stdin");
            spawn_stdin_reader(tx)
        };

        Ok(Self { rx, _thread: thread })
    }

    /// Try to receive a key event (non-blocking)
    pub fn try_recv(&self) -> Option<KeyEvent> {
        match self.rx.try_recv() {
            Ok(event) => Some(event),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                error!("Input thread disconnected");
                Some(KeyEvent::Quit)
            }
        }
    }

    /// Wait for a key event with timeout
    pub fn recv_timeout(&self, timeout: Duration) -> Option<KeyEvent> {
        self.rx.recv_timeout(timeout).ok()
    }
}

/// Find keyboard devices in /dev/input/
fn find_keyboard_devices() -> Vec<Device> {
    let mut keyboards = Vec::new();

    let input_dir = Path::new("/dev/input");
    if !input_dir.exists() {
        return keyboards;
    }

    // Look for event devices
    if let Ok(entries) = fs::read_dir(input_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if !name.starts_with("event") {
                continue;
            }

            match Device::open(&path) {
                Ok(device) => {
                    // Check if this device has keyboard capabilities
                    if let Some(keys) = device.supported_keys() {
                        // Check for common keyboard keys
                        if keys.contains(Key::KEY_A)
                            && keys.contains(Key::KEY_ENTER)
                            && keys.contains(Key::KEY_ESC)
                        {
                            info!(
                                path = %path.display(),
                                name = device.name().unwrap_or("unknown"),
                                "Found keyboard device"
                            );
                            keyboards.push(device);
                        }
                    }
                }
                Err(e) => {
                    debug!(path = %path.display(), error = %e, "Failed to open input device");
                }
            }
        }
    }

    keyboards
}

/// Spawn a thread that reads from evdev devices
fn spawn_evdev_reader(devices: Vec<Device>, tx: Sender<KeyEvent>) -> JoinHandle<()> {
    thread::spawn(move || {
        // We only use the first keyboard for simplicity
        // A more robust implementation would use epoll to handle multiple devices
        if let Some(mut device) = devices.into_iter().next() {
            // Grab the device exclusively (optional, prevents other programs from reading)
            // Commenting out to avoid conflicts: let _ = device.grab();

            loop {
                match device.fetch_events() {
                    Ok(events) => {
                        for event in events {
                            if let InputEventKind::Key(key) = event.kind() {
                                // Only process key press events (value = 1)
                                if event.value() == 1 {
                                    if let Some(key_event) = evdev_key_to_event(key) {
                                        if tx.send(key_event).is_err() {
                                            return; // Channel closed
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!(error = %e, "Error reading evdev events");
                        thread::sleep(Duration::from_millis(100));
                    }
                }
            }
        }
    })
}

/// Convert evdev Key to our KeyEvent
fn evdev_key_to_event(key: Key) -> Option<KeyEvent> {
    match key {
        Key::KEY_F1 => Some(KeyEvent::F1),
        Key::KEY_F2 => Some(KeyEvent::F2),
        Key::KEY_F3 => Some(KeyEvent::F3),
        Key::KEY_F4 => Some(KeyEvent::F4),
        Key::KEY_F5 => Some(KeyEvent::F5),
        Key::KEY_F6 => Some(KeyEvent::F6),
        Key::KEY_F7 => Some(KeyEvent::F7),
        Key::KEY_F8 => Some(KeyEvent::F8),
        Key::KEY_F9 => Some(KeyEvent::F9),
        Key::KEY_F10 => Some(KeyEvent::F10),
        Key::KEY_F11 => Some(KeyEvent::F11),
        Key::KEY_F12 => Some(KeyEvent::F12),
        Key::KEY_UP => Some(KeyEvent::Up),
        Key::KEY_DOWN => Some(KeyEvent::Down),
        Key::KEY_LEFT => Some(KeyEvent::Left),
        Key::KEY_RIGHT => Some(KeyEvent::Right),
        Key::KEY_ENTER => Some(KeyEvent::Enter),
        Key::KEY_ESC => Some(KeyEvent::Escape),
        Key::KEY_TAB => Some(KeyEvent::Tab),
        Key::KEY_BACKSPACE => Some(KeyEvent::Backspace),
        // Letter keys (lowercase)
        Key::KEY_A => Some(KeyEvent::Char('a')),
        Key::KEY_B => Some(KeyEvent::Char('b')),
        Key::KEY_C => Some(KeyEvent::Char('c')),
        Key::KEY_D => Some(KeyEvent::Char('d')),
        Key::KEY_E => Some(KeyEvent::Char('e')),
        Key::KEY_F => Some(KeyEvent::Char('f')),
        Key::KEY_G => Some(KeyEvent::Char('g')),
        Key::KEY_H => Some(KeyEvent::Char('h')),
        Key::KEY_I => Some(KeyEvent::Char('i')),
        Key::KEY_J => Some(KeyEvent::Char('j')),
        Key::KEY_K => Some(KeyEvent::Char('k')),
        Key::KEY_L => Some(KeyEvent::Char('l')),
        Key::KEY_M => Some(KeyEvent::Char('m')),
        Key::KEY_N => Some(KeyEvent::Char('n')),
        Key::KEY_O => Some(KeyEvent::Char('o')),
        Key::KEY_P => Some(KeyEvent::Char('p')),
        Key::KEY_Q => Some(KeyEvent::Char('q')),
        Key::KEY_R => Some(KeyEvent::Char('r')),
        Key::KEY_S => Some(KeyEvent::Char('s')),
        Key::KEY_T => Some(KeyEvent::Char('t')),
        Key::KEY_U => Some(KeyEvent::Char('u')),
        Key::KEY_V => Some(KeyEvent::Char('v')),
        Key::KEY_W => Some(KeyEvent::Char('w')),
        Key::KEY_X => Some(KeyEvent::Char('x')),
        Key::KEY_Y => Some(KeyEvent::Char('y')),
        Key::KEY_Z => Some(KeyEvent::Char('z')),
        // Numbers
        Key::KEY_0 => Some(KeyEvent::Char('0')),
        Key::KEY_1 => Some(KeyEvent::Char('1')),
        Key::KEY_2 => Some(KeyEvent::Char('2')),
        Key::KEY_3 => Some(KeyEvent::Char('3')),
        Key::KEY_4 => Some(KeyEvent::Char('4')),
        Key::KEY_5 => Some(KeyEvent::Char('5')),
        Key::KEY_6 => Some(KeyEvent::Char('6')),
        Key::KEY_7 => Some(KeyEvent::Char('7')),
        Key::KEY_8 => Some(KeyEvent::Char('8')),
        Key::KEY_9 => Some(KeyEvent::Char('9')),
        // Common symbols
        Key::KEY_SPACE => Some(KeyEvent::Char(' ')),
        Key::KEY_MINUS => Some(KeyEvent::Char('-')),
        Key::KEY_EQUAL => Some(KeyEvent::Char('=')),
        Key::KEY_DOT => Some(KeyEvent::Char('.')),
        Key::KEY_COMMA => Some(KeyEvent::Char(',')),
        Key::KEY_SLASH => Some(KeyEvent::Char('/')),
        _ => None,
    }
}

/// Spawn a thread that reads from stdin (fallback)
fn spawn_stdin_reader(tx: Sender<KeyEvent>) -> JoinHandle<()> {
    thread::spawn(move || {
        // Set stdin to raw mode would require termios
        // For now, we just read bytes and parse escape sequences
        let stdin = io::stdin();
        let mut buffer = [0u8; 8];

        loop {
            match stdin.lock().read(&mut buffer) {
                Ok(0) => {
                    // EOF
                    let _ = tx.send(KeyEvent::Quit);
                    return;
                }
                Ok(n) => {
                    if let Some(event) = parse_stdin_input(&buffer[..n]) {
                        if tx.send(event).is_err() {
                            return;
                        }
                    }
                }
                Err(e) => {
                    error!(error = %e, "Error reading stdin");
                    thread::sleep(Duration::from_millis(100));
                }
            }
        }
    })
}

/// Parse stdin input bytes to KeyEvent
fn parse_stdin_input(bytes: &[u8]) -> Option<KeyEvent> {
    if bytes.is_empty() {
        return None;
    }

    // Check for escape sequences
    if bytes.len() >= 3 && bytes[0] == 0x1B && bytes[1] == b'[' {
        match bytes[2] {
            b'A' => return Some(KeyEvent::Up),
            b'B' => return Some(KeyEvent::Down),
            b'C' => return Some(KeyEvent::Right),
            b'D' => return Some(KeyEvent::Left),
            _ => {}
        }
    }

    // Check for function keys (F1-F12 have complex escape sequences)
    if bytes.len() >= 4 && bytes[0] == 0x1B && bytes[1] == b'O' {
        match bytes[2] {
            b'P' => return Some(KeyEvent::F1),
            b'Q' => return Some(KeyEvent::F2),
            b'R' => return Some(KeyEvent::F3),
            b'S' => return Some(KeyEvent::F4),
            _ => {}
        }
    }

    // Single byte characters
    match bytes[0] {
        0x0D => Some(KeyEvent::Enter),      // Carriage return
        0x0A => Some(KeyEvent::Enter),      // Line feed
        0x1B => Some(KeyEvent::Escape),     // Escape (alone)
        0x09 => Some(KeyEvent::Tab),        // Tab
        0x7F => Some(KeyEvent::Backspace),  // Backspace (DEL)
        0x08 => Some(KeyEvent::Backspace),  // Backspace (BS)
        0x03 => Some(KeyEvent::Quit),       // Ctrl+C
        b if b.is_ascii_graphic() || b == b' ' => Some(KeyEvent::Char(b as char)),
        _ => None,
    }
}
