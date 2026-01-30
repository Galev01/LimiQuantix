/**
 * Tauri API utilities for QvMC
 */

import { invoke } from '@tauri-apps/api/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// Types
export interface SavedConnection {
  id: string;
  name: string;
  control_plane_url: string;
  vm_id: string;
  last_connected?: string;
  thumbnail?: string;
}

export interface DisplaySettings {
  scale_viewport: boolean;
  show_remote_cursor: boolean;
  preferred_encoding: string;
  quality: number;
  compression: number;
}

export interface Config {
  connections: SavedConnection[];
  display: DisplaySettings;
  last_control_plane_url?: string;
  window_width?: number;
  window_height?: number;
  window_maximized: boolean;
}

export interface FramebufferUpdate {
  x: number;
  y: number;
  width: number;
  height: number;
  data: number[];
}

export interface VNCConnectedEvent {
  connectionId: string;
  width: number;
  height: number;
}

// API Functions

/**
 * Get saved connections
 */
export async function getSavedConnections(): Promise<SavedConnection[]> {
  const result = await invoke<{ connections: SavedConnection[] }>('get_saved_connections');
  return result.connections || [];
}

/**
 * Save a connection
 */
export async function saveConnection(connection: SavedConnection): Promise<void> {
  await invoke('save_connection', { connection });
}

/**
 * Delete a connection
 */
export async function deleteConnection(id: string): Promise<void> {
  await invoke('delete_connection', { id });
}

/**
 * Get configuration
 */
export async function getConfig(): Promise<Config> {
  return await invoke<Config>('get_config');
}

/**
 * Save configuration
 */
export async function saveConfig(config: Config): Promise<void> {
  await invoke('save_config', { config });
}

/**
 * Console info from Control Plane
 */
export interface ConsoleInfo {
  consoleType: string | null;
  host: string;
  port: number;
  password: string | null;
  websocketUrl: string | null;
}

/**
 * Get console info from the Control Plane
 * This fetches VNC connection details including the password
 */
export async function getConsoleInfo(
  controlPlaneUrl: string,
  vmId: string
): Promise<ConsoleInfo> {
  return await invoke<ConsoleInfo>('get_console_info_cmd', {
    controlPlaneUrl,
    vmId,
  });
}

/**
 * Connect to a VM's VNC console
 */
export async function connectVNC(
  controlPlaneUrl: string,
  vmId: string,
  password?: string
): Promise<string> {
  return await invoke<string>('connect_vnc', {
    controlPlaneUrl,
    vmId,
    password,
  });
}

/**
 * Disconnect from VNC
 */
export async function disconnectVNC(connectionId: string): Promise<void> {
  await invoke('disconnect_vnc', { connectionId });
}

/**
 * Send a key event
 */
export async function sendKeyEvent(
  connectionId: string,
  key: number,
  down: boolean
): Promise<void> {
  await invoke('send_key_event', { connectionId, key, down });
}

/**
 * Send a pointer (mouse) event
 */
export async function sendPointerEvent(
  connectionId: string,
  x: number,
  y: number,
  buttons: number
): Promise<void> {
  await invoke('send_pointer_event', { connectionId, x, y, buttons });
}

/**
 * Send Ctrl+Alt+Del
 */
export async function sendCtrlAltDel(connectionId: string): Promise<void> {
  await invoke('send_ctrl_alt_del', { connectionId });
}

/**
 * Get connection status
 */
export async function getConnectionStatus(
  connectionId: string
): Promise<'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error'> {
  return await invoke('get_connection_status', { connectionId });
}

// Event Listeners

/**
 * Listen for VNC connected events
 */
export function onVNCConnected(
  callback: (event: VNCConnectedEvent) => void
): Promise<UnlistenFn> {
  return listen<VNCConnectedEvent>('vnc:connected', (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for VNC disconnected events
 */
export function onVNCDisconnected(
  callback: (connectionId: string) => void
): Promise<UnlistenFn> {
  return listen<string>('vnc:disconnected', (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for framebuffer updates
 */
export function onFramebufferUpdate(
  callback: (update: FramebufferUpdate) => void
): Promise<UnlistenFn> {
  return listen<FramebufferUpdate>('vnc:framebuffer', (event) => {
    callback(event.payload);
  });
}

/**
 * Listen for VNC errors
 */
export function onVNCError(callback: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>('vnc:error', (event) => {
    callback(event.payload);
  });
}

// Keysym conversion (simplified)
// For a complete implementation, see:
// https://github.com/nicholasRutworworthy/x11-keysymdef

const KEYSYM_MAP: Record<string, number> = {
  Backspace: 0xff08,
  Tab: 0xff09,
  Enter: 0xff0d,
  Escape: 0xff1b,
  Insert: 0xff63,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
  ShiftLeft: 0xffe1,
  ShiftRight: 0xffe2,
  ControlLeft: 0xffe3,
  ControlRight: 0xffe4,
  AltLeft: 0xffe9,
  AltRight: 0xffea,
  MetaLeft: 0xffeb,
  MetaRight: 0xffec,
  CapsLock: 0xffe5,
  NumLock: 0xff7f,
  ScrollLock: 0xff14,
  ' ': 0x0020,
};

/**
 * Convert a keyboard event to X11 keysym
 */
export function keyEventToKeysym(event: KeyboardEvent): number {
  // Check for special keys
  if (KEYSYM_MAP[event.code]) {
    return KEYSYM_MAP[event.code];
  }

  // For printable characters, use the character code
  if (event.key.length === 1) {
    return event.key.charCodeAt(0);
  }

  // Fallback to keyCode (deprecated but still works)
  return event.keyCode;
}
