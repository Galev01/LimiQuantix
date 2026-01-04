# Workflow State: Clean

No active workflows.

---

## Completed: Console UX Improvements (January 3, 2026)

Successfully implemented all 10 tasks from the Console Access & Web UI Improvement Plan.

### Summary of Changes

#### Multi-Console Support
- **ConsoleDock page** (`frontend/src/pages/ConsoleDock.tsx`) - New page at `/consoles` for viewing multiple VM consoles in tabs or grid layout
- **ConsoleTabBar** (`frontend/src/components/console/ConsoleTabBar.tsx`) - Tab navigation with close buttons, view mode toggle
- **ConsoleGrid** (`frontend/src/components/console/ConsoleGrid.tsx`) - Grid layout manager with 1x1, 2x1, 2x2, 3x2 options
- **useConsoleStore** (`frontend/src/hooks/useConsoleStore.ts`) - Zustand store for console session state management

#### Quick Console Access
- Added one-click console button (Monitor icon) to VM list rows in `VMList.tsx`
- Uses user's default console preference (Web or QVMRC)

#### Performance Optimizations
- **Quality Settings dropdown** in noVNC toolbar with Auto/High/Medium/Low presets
- Settings persisted in localStorage (compression level, quality level, scale, cursor)
- Toggle for Scale to Fit and Show Local Cursor

#### Clipboard Sync
- **Web Console**: Bidirectional clipboard sync with polling every 500ms
- **QVMRC**: Added `send_clipboard`, `get_vm_clipboard` commands, `vnc:clipboard` event emission

#### Console Thumbnails
- Thumbnail capture every 5 seconds from noVNC canvas
- Sent to parent window via postMessage
- Displayed in console tabs with hover preview

#### Streamlined Console Modal
- Added `openDefaultConsole` helper function for quick access
- Star icon to set default console type (Web or QVMRC)
- Quick console button uses default preference

#### Global Keyboard Shortcuts
- **KeyboardShortcuts** component wraps the main layout
- Ctrl+1-9: Switch console tabs
- Ctrl+Tab / Ctrl+Shift+Tab: Next/Previous console
- Ctrl+Shift+C: Open console dock
- Ctrl+Shift+F: Toggle fullscreen

#### USB Passthrough (QVMRC)
- **usb module** (`qvmrc/src-tauri/src/usb/mod.rs`) with:
  - `list_usb_devices` - Enumerate connected USB devices
  - `attach_usb_device` - Attach device to VM via control plane
  - `detach_usb_device` - Detach device from VM
  - `get_vm_usb_devices` - List devices attached to a VM

### Files Created
- `frontend/src/pages/ConsoleDock.tsx`
- `frontend/src/components/console/ConsoleTabBar.tsx`
- `frontend/src/components/console/ConsoleGrid.tsx`
- `frontend/src/components/console/index.ts`
- `frontend/src/hooks/useConsoleStore.ts`
- `frontend/src/components/KeyboardShortcuts.tsx`
- `qvmrc/src-tauri/src/usb/mod.rs`

### Files Modified
- `frontend/src/App.tsx` - Added ConsoleDock route and KeyboardShortcuts wrapper
- `frontend/src/pages/VMList.tsx` - Added quick console button
- `frontend/src/components/vm/ConsoleAccessModal.tsx` - Streamlined with default actions
- `frontend/public/novnc/limiquantix.html` - Quality settings, clipboard sync, thumbnails
- `qvmrc/src-tauri/src/vnc/mod.rs` - Clipboard commands and events
- `qvmrc/src-tauri/src/vnc/rfb.rs` - Clipboard storage field
- `qvmrc/src-tauri/src/main.rs` - USB and clipboard command registration
- `qvmrc/src-tauri/Cargo.toml` - Added rusb dependency
