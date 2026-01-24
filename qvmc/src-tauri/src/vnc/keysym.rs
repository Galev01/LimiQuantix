#![allow(dead_code)]
//! X11 Keysym mappings for VNC keyboard events

//!
//! This module provides conversion from JavaScript key codes to X11 keysyms.
//! Based on X11/keysymdef.h

/// Convert a JavaScript key string to X11 keysym
pub fn js_key_to_keysym(key: &str, code: &str, _shift: bool) -> Option<u32> {
    // First check for special keys by code
    if let Some(keysym) = code_to_keysym(code) {
        return Some(keysym);
    }

    // Then check for printable characters
    if key.len() == 1 {
        let c = key.chars().next()?;
        return char_to_keysym(c);
    }

    // Finally check by key name
    key_to_keysym(key)
}

/// Convert JavaScript keyCode to X11 keysym (for legacy support)
pub fn keycode_to_keysym(keycode: u32) -> u32 {
    match keycode {
        // Letters (uppercase when using keyCode directly)
        65..=90 => keycode + 32, // Convert to lowercase ASCII which maps to keysyms
        
        // Numbers
        48..=57 => keycode,
        
        // Function keys
        112 => XK_F1,
        113 => XK_F2,
        114 => XK_F3,
        115 => XK_F4,
        116 => XK_F5,
        117 => XK_F6,
        118 => XK_F7,
        119 => XK_F8,
        120 => XK_F9,
        121 => XK_F10,
        122 => XK_F11,
        123 => XK_F12,
        
        // Navigation
        33 => XK_PAGE_UP,
        34 => XK_PAGE_DOWN,
        35 => XK_END,
        36 => XK_HOME,
        37 => XK_LEFT,
        38 => XK_UP,
        39 => XK_RIGHT,
        40 => XK_DOWN,
        
        // Editing
        8 => XK_BACKSPACE,
        9 => XK_TAB,
        13 => XK_RETURN,
        27 => XK_ESCAPE,
        32 => XK_SPACE,
        45 => XK_INSERT,
        46 => XK_DELETE,
        
        // Modifiers
        16 => XK_SHIFT_L,
        17 => XK_CONTROL_L,
        18 => XK_ALT_L,
        20 => XK_CAPS_LOCK,
        91 => XK_SUPER_L, // Left Windows/Meta
        92 => XK_SUPER_R, // Right Windows/Meta
        93 => XK_MENU,    // Context menu
        
        // Numpad
        96 => XK_KP_0,
        97 => XK_KP_1,
        98 => XK_KP_2,
        99 => XK_KP_3,
        100 => XK_KP_4,
        101 => XK_KP_5,
        102 => XK_KP_6,
        103 => XK_KP_7,
        104 => XK_KP_8,
        105 => XK_KP_9,
        106 => XK_KP_MULTIPLY,
        107 => XK_KP_ADD,
        109 => XK_KP_SUBTRACT,
        110 => XK_KP_DECIMAL,
        111 => XK_KP_DIVIDE,
        144 => XK_NUM_LOCK,
        
        // Punctuation (varies by keyboard layout)
        186 => 0x3b, // ;
        187 => 0x3d, // =
        188 => 0x2c, // ,
        189 => 0x2d, // -
        190 => 0x2e, // .
        191 => 0x2f, // /
        192 => 0x60, // `
        219 => 0x5b, // [
        220 => 0x5c, // \
        221 => 0x5d, // ]
        222 => 0x27, // '
        
        // Default: return keycode as-is
        _ => keycode,
    }
}

/// Convert JavaScript key code string to keysym
fn code_to_keysym(code: &str) -> Option<u32> {
    Some(match code {
        // Letters
        "KeyA" => 0x61, "KeyB" => 0x62, "KeyC" => 0x63, "KeyD" => 0x64,
        "KeyE" => 0x65, "KeyF" => 0x66, "KeyG" => 0x67, "KeyH" => 0x68,
        "KeyI" => 0x69, "KeyJ" => 0x6a, "KeyK" => 0x6b, "KeyL" => 0x6c,
        "KeyM" => 0x6d, "KeyN" => 0x6e, "KeyO" => 0x6f, "KeyP" => 0x70,
        "KeyQ" => 0x71, "KeyR" => 0x72, "KeyS" => 0x73, "KeyT" => 0x74,
        "KeyU" => 0x75, "KeyV" => 0x76, "KeyW" => 0x77, "KeyX" => 0x78,
        "KeyY" => 0x79, "KeyZ" => 0x7a,
        
        // Digits
        "Digit0" => 0x30, "Digit1" => 0x31, "Digit2" => 0x32,
        "Digit3" => 0x33, "Digit4" => 0x34, "Digit5" => 0x35,
        "Digit6" => 0x36, "Digit7" => 0x37, "Digit8" => 0x38, "Digit9" => 0x39,
        
        // Function keys
        "F1" => XK_F1, "F2" => XK_F2, "F3" => XK_F3, "F4" => XK_F4,
        "F5" => XK_F5, "F6" => XK_F6, "F7" => XK_F7, "F8" => XK_F8,
        "F9" => XK_F9, "F10" => XK_F10, "F11" => XK_F11, "F12" => XK_F12,
        
        // Navigation
        "ArrowUp" => XK_UP, "ArrowDown" => XK_DOWN,
        "ArrowLeft" => XK_LEFT, "ArrowRight" => XK_RIGHT,
        "Home" => XK_HOME, "End" => XK_END,
        "PageUp" => XK_PAGE_UP, "PageDown" => XK_PAGE_DOWN,
        
        // Editing
        "Backspace" => XK_BACKSPACE,
        "Tab" => XK_TAB,
        "Enter" => XK_RETURN,
        "Escape" => XK_ESCAPE,
        "Space" => XK_SPACE,
        "Insert" => XK_INSERT,
        "Delete" => XK_DELETE,
        
        // Modifiers
        "ShiftLeft" => XK_SHIFT_L,
        "ShiftRight" => XK_SHIFT_R,
        "ControlLeft" => XK_CONTROL_L,
        "ControlRight" => XK_CONTROL_R,
        "AltLeft" => XK_ALT_L,
        "AltRight" => XK_ALT_R,
        "MetaLeft" => XK_SUPER_L,
        "MetaRight" => XK_SUPER_R,
        "CapsLock" => XK_CAPS_LOCK,
        "NumLock" => XK_NUM_LOCK,
        "ScrollLock" => XK_SCROLL_LOCK,
        
        // Numpad
        "Numpad0" => XK_KP_0, "Numpad1" => XK_KP_1, "Numpad2" => XK_KP_2,
        "Numpad3" => XK_KP_3, "Numpad4" => XK_KP_4, "Numpad5" => XK_KP_5,
        "Numpad6" => XK_KP_6, "Numpad7" => XK_KP_7, "Numpad8" => XK_KP_8,
        "Numpad9" => XK_KP_9,
        "NumpadMultiply" => XK_KP_MULTIPLY,
        "NumpadAdd" => XK_KP_ADD,
        "NumpadSubtract" => XK_KP_SUBTRACT,
        "NumpadDecimal" => XK_KP_DECIMAL,
        "NumpadDivide" => XK_KP_DIVIDE,
        "NumpadEnter" => XK_KP_ENTER,
        
        // Punctuation
        "Minus" => 0x2d,          // -
        "Equal" => 0x3d,          // =
        "BracketLeft" => 0x5b,    // [
        "BracketRight" => 0x5d,   // ]
        "Backslash" => 0x5c,      // \
        "Semicolon" => 0x3b,      // ;
        "Quote" => 0x27,          // '
        "Backquote" => 0x60,      // `
        "Comma" => 0x2c,          // ,
        "Period" => 0x2e,         // .
        "Slash" => 0x2f,          // /
        
        // Print screen, pause, etc.
        "PrintScreen" => XK_PRINT,
        "Pause" => XK_PAUSE,
        "ContextMenu" => XK_MENU,
        
        _ => return None,
    })
}

/// Convert JavaScript key name to keysym
fn key_to_keysym(key: &str) -> Option<u32> {
    Some(match key {
        "Backspace" => XK_BACKSPACE,
        "Tab" => XK_TAB,
        "Enter" => XK_RETURN,
        "Shift" => XK_SHIFT_L,
        "Control" => XK_CONTROL_L,
        "Alt" => XK_ALT_L,
        "Pause" => XK_PAUSE,
        "CapsLock" => XK_CAPS_LOCK,
        "Escape" => XK_ESCAPE,
        " " => XK_SPACE,
        "PageUp" => XK_PAGE_UP,
        "PageDown" => XK_PAGE_DOWN,
        "End" => XK_END,
        "Home" => XK_HOME,
        "ArrowLeft" => XK_LEFT,
        "ArrowUp" => XK_UP,
        "ArrowRight" => XK_RIGHT,
        "ArrowDown" => XK_DOWN,
        "PrintScreen" => XK_PRINT,
        "Insert" => XK_INSERT,
        "Delete" => XK_DELETE,
        "Meta" => XK_SUPER_L,
        "ContextMenu" => XK_MENU,
        "NumLock" => XK_NUM_LOCK,
        "ScrollLock" => XK_SCROLL_LOCK,
        
        "F1" => XK_F1, "F2" => XK_F2, "F3" => XK_F3, "F4" => XK_F4,
        "F5" => XK_F5, "F6" => XK_F6, "F7" => XK_F7, "F8" => XK_F8,
        "F9" => XK_F9, "F10" => XK_F10, "F11" => XK_F11, "F12" => XK_F12,
        
        _ => return None,
    })
}

/// Convert a character to X11 keysym
fn char_to_keysym(c: char) -> Option<u32> {
    // ASCII printable characters map directly to their keysyms
    if c.is_ascii() && c >= ' ' && c <= '~' {
        return Some(c as u32);
    }
    
    // Unicode characters map to keysyms with 0x01000000 offset
    if c as u32 >= 0x100 {
        return Some(0x01000000 | (c as u32));
    }
    
    Some(c as u32)
}

// X11 Keysym constants
pub const XK_BACKSPACE: u32 = 0xff08;
pub const XK_TAB: u32 = 0xff09;
pub const XK_RETURN: u32 = 0xff0d;
pub const XK_ESCAPE: u32 = 0xff1b;
pub const XK_SPACE: u32 = 0x0020;
pub const XK_DELETE: u32 = 0xffff;

// Modifiers
pub const XK_SHIFT_L: u32 = 0xffe1;
pub const XK_SHIFT_R: u32 = 0xffe2;
pub const XK_CONTROL_L: u32 = 0xffe3;
pub const XK_CONTROL_R: u32 = 0xffe4;
pub const XK_CAPS_LOCK: u32 = 0xffe5;
pub const XK_SHIFT_LOCK: u32 = 0xffe6;
pub const XK_META_L: u32 = 0xffe7;
pub const XK_META_R: u32 = 0xffe8;
pub const XK_ALT_L: u32 = 0xffe9;
pub const XK_ALT_R: u32 = 0xffea;
pub const XK_SUPER_L: u32 = 0xffeb;
pub const XK_SUPER_R: u32 = 0xffec;

// Navigation
pub const XK_HOME: u32 = 0xff50;
pub const XK_LEFT: u32 = 0xff51;
pub const XK_UP: u32 = 0xff52;
pub const XK_RIGHT: u32 = 0xff53;
pub const XK_DOWN: u32 = 0xff54;
pub const XK_PAGE_UP: u32 = 0xff55;
pub const XK_PAGE_DOWN: u32 = 0xff56;
pub const XK_END: u32 = 0xff57;

// Editing
pub const XK_INSERT: u32 = 0xff63;
pub const XK_MENU: u32 = 0xff67;
pub const XK_NUM_LOCK: u32 = 0xff7f;
pub const XK_SCROLL_LOCK: u32 = 0xff14;
pub const XK_PRINT: u32 = 0xff61;
pub const XK_PAUSE: u32 = 0xff13;

// Function keys
pub const XK_F1: u32 = 0xffbe;
pub const XK_F2: u32 = 0xffbf;
pub const XK_F3: u32 = 0xffc0;
pub const XK_F4: u32 = 0xffc1;
pub const XK_F5: u32 = 0xffc2;
pub const XK_F6: u32 = 0xffc3;
pub const XK_F7: u32 = 0xffc4;
pub const XK_F8: u32 = 0xffc5;
pub const XK_F9: u32 = 0xffc6;
pub const XK_F10: u32 = 0xffc7;
pub const XK_F11: u32 = 0xffc8;
pub const XK_F12: u32 = 0xffc9;

// Keypad
pub const XK_KP_0: u32 = 0xffb0;
pub const XK_KP_1: u32 = 0xffb1;
pub const XK_KP_2: u32 = 0xffb2;
pub const XK_KP_3: u32 = 0xffb3;
pub const XK_KP_4: u32 = 0xffb4;
pub const XK_KP_5: u32 = 0xffb5;
pub const XK_KP_6: u32 = 0xffb6;
pub const XK_KP_7: u32 = 0xffb7;
pub const XK_KP_8: u32 = 0xffb8;
pub const XK_KP_9: u32 = 0xffb9;
pub const XK_KP_MULTIPLY: u32 = 0xffaa;
pub const XK_KP_ADD: u32 = 0xffab;
pub const XK_KP_SEPARATOR: u32 = 0xffac;
pub const XK_KP_SUBTRACT: u32 = 0xffad;
pub const XK_KP_DECIMAL: u32 = 0xffae;
pub const XK_KP_DIVIDE: u32 = 0xffaf;
pub const XK_KP_ENTER: u32 = 0xff8d;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keycode_mapping() {
        assert_eq!(keycode_to_keysym(65), 97); // 'A' -> 'a'
        assert_eq!(keycode_to_keysym(13), XK_RETURN);
        assert_eq!(keycode_to_keysym(27), XK_ESCAPE);
        assert_eq!(keycode_to_keysym(112), XK_F1);
    }

    #[test]
    fn test_code_mapping() {
        assert_eq!(code_to_keysym("KeyA"), Some(0x61));
        assert_eq!(code_to_keysym("Enter"), Some(XK_RETURN));
        assert_eq!(code_to_keysym("F1"), Some(XK_F1));
        assert_eq!(code_to_keysym("ArrowUp"), Some(XK_UP));
    }

    #[test]
    fn test_char_mapping() {
        assert_eq!(char_to_keysym('a'), Some(0x61));
        assert_eq!(char_to_keysym('A'), Some(0x41));
        assert_eq!(char_to_keysym(' '), Some(0x20));
    }
}
