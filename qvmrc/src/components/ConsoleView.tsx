import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import {
  ArrowLeft,
  Maximize2,
  Minimize2,
  Keyboard,
  Clipboard,
  Usb,
  Settings,
  Power,
  RefreshCw,
} from 'lucide-react';

interface ConsoleViewProps {
  connectionId: string;
  vmId: string;
  vmName: string;
  onDisconnect: () => void;
}

interface FramebufferUpdate {
  x: number;
  y: number;
  width: number;
  height: number;
  data: number[];
}

export function ConsoleView({
  connectionId,
  vmId,
  vmName,
  onDisconnect,
}: ConsoleViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connected, setConnected] = useState(true);
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  const [mouseDown, setMouseDown] = useState(0);

  // Handle framebuffer updates
  useEffect(() => {
    const unlistenFb = listen<FramebufferUpdate>('vnc:framebuffer', (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const update = event.payload;
      const imageData = ctx.createImageData(update.width, update.height);
      
      // Copy RGBA data
      for (let i = 0; i < update.data.length; i++) {
        imageData.data[i] = update.data[i];
      }

      ctx.putImageData(imageData, update.x, update.y);
    });

    const unlistenDisconnect = listen<string>('vnc:disconnected', (event) => {
      if (event.payload === connectionId) {
        setConnected(false);
      }
    });

    const unlistenConnect = listen<{ connectionId: string; width: number; height: number }>(
      'vnc:connected',
      (event) => {
        if (event.payload.connectionId === connectionId) {
          setResolution({
            width: event.payload.width,
            height: event.payload.height,
          });

          // Resize canvas
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = event.payload.width;
            canvas.height = event.payload.height;
          }
        }
      }
    );

    return () => {
      unlistenFb.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
      unlistenConnect.then((fn) => fn());
    };
  }, [connectionId]);

  // Handle disconnect
  const handleDisconnect = useCallback(async () => {
    try {
      await invoke('disconnect_vnc', { connectionId });
    } catch (err) {
      console.error('Disconnect error:', err);
    }
    onDisconnect();
  }, [connectionId, onDisconnect]);

  // Send Ctrl+Alt+Del
  const sendCtrlAltDel = useCallback(async () => {
    try {
      await invoke('send_ctrl_alt_del', { connectionId });
    } catch (err) {
      console.error('Ctrl+Alt+Del error:', err);
    }
  }, [connectionId]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Mouse events
  const handleMouseMove = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);

      try {
        await invoke('send_pointer_event', {
          connectionId,
          x,
          y,
          buttons: mouseDown,
        });
      } catch (err) {
        console.error('Pointer event error:', err);
      }
    },
    [connectionId, mouseDown]
  );

  const handleMouseDown = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      const button = 1 << e.button;
      setMouseDown((prev) => prev | button);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);

      try {
        await invoke('send_pointer_event', {
          connectionId,
          x,
          y,
          buttons: mouseDown | button,
        });
      } catch (err) {
        console.error('Pointer event error:', err);
      }
    },
    [connectionId, mouseDown]
  );

  const handleMouseUp = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      const button = 1 << e.button;
      setMouseDown((prev) => prev & ~button);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);

      try {
        await invoke('send_pointer_event', {
          connectionId,
          x,
          y,
          buttons: mouseDown & ~button,
        });
      } catch (err) {
        console.error('Pointer event error:', err);
      }
    },
    [connectionId, mouseDown]
  );

  // Convert JavaScript key event to X11 keysym
  const keyEventToKeysym = useCallback((e: React.KeyboardEvent): number => {
    // Handle special keys by code
    const codeMap: Record<string, number> = {
      // Function keys
      'F1': 0xffbe, 'F2': 0xffbf, 'F3': 0xffc0, 'F4': 0xffc1,
      'F5': 0xffc2, 'F6': 0xffc3, 'F7': 0xffc4, 'F8': 0xffc5,
      'F9': 0xffc6, 'F10': 0xffc7, 'F11': 0xffc8, 'F12': 0xffc9,
      // Navigation
      'ArrowUp': 0xff52, 'ArrowDown': 0xff54, 'ArrowLeft': 0xff51, 'ArrowRight': 0xff53,
      'Home': 0xff50, 'End': 0xff57, 'PageUp': 0xff55, 'PageDown': 0xff56,
      // Editing
      'Backspace': 0xff08, 'Tab': 0xff09, 'Enter': 0xff0d, 'Escape': 0xff1b,
      'Insert': 0xff63, 'Delete': 0xffff,
      // Modifiers
      'ShiftLeft': 0xffe1, 'ShiftRight': 0xffe2,
      'ControlLeft': 0xffe3, 'ControlRight': 0xffe4,
      'AltLeft': 0xffe9, 'AltRight': 0xffea,
      'MetaLeft': 0xffeb, 'MetaRight': 0xffec,
      'CapsLock': 0xffe5, 'NumLock': 0xff7f, 'ScrollLock': 0xff14,
      // Numpad
      'Numpad0': 0xffb0, 'Numpad1': 0xffb1, 'Numpad2': 0xffb2,
      'Numpad3': 0xffb3, 'Numpad4': 0xffb4, 'Numpad5': 0xffb5,
      'Numpad6': 0xffb6, 'Numpad7': 0xffb7, 'Numpad8': 0xffb8, 'Numpad9': 0xffb9,
      'NumpadMultiply': 0xffaa, 'NumpadAdd': 0xffab, 'NumpadSubtract': 0xffad,
      'NumpadDecimal': 0xffae, 'NumpadDivide': 0xffaf, 'NumpadEnter': 0xff8d,
      // Misc
      'Space': 0x0020, 'PrintScreen': 0xff61, 'Pause': 0xff13, 'ContextMenu': 0xff67,
    };

    if (codeMap[e.code]) {
      return codeMap[e.code];
    }

    // For printable characters, use the character code
    if (e.key.length === 1) {
      return e.key.charCodeAt(0);
    }

    // Fallback to keyCode for legacy support
    return e.keyCode;
  }, []);

  // Keyboard events
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const keysym = keyEventToKeysym(e);

      try {
        await invoke('send_key_event', {
          connectionId,
          key: keysym,
          down: true,
        });
      } catch (err) {
        console.error('Key event error:', err);
      }
    },
    [connectionId, keyEventToKeysym]
  );

  const handleKeyUp = useCallback(
    async (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const keysym = keyEventToKeysym(e);

      try {
        await invoke('send_key_event', {
          connectionId,
          key: keysym,
          down: false,
        });
      } catch (err) {
        console.error('Key event error:', err);
      }
    },
    [connectionId, keyEventToKeysym]
  );

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-black">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={handleDisconnect}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            title="Disconnect"
          >
            <ArrowLeft className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
          <span className="font-medium text-[var(--text-primary)]">{vmName}</span>
          {connected ? (
            <span className="flex items-center gap-1 text-xs text-[var(--success)] px-2 py-0.5 bg-[var(--success)]/10 rounded-full">
              <span className="w-1.5 h-1.5 bg-[var(--success)] rounded-full animate-pulse" />
              Connected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[var(--error)] px-2 py-0.5 bg-[var(--error)]/10 rounded-full">
              Disconnected
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={sendCtrlAltDel}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            title="Send Ctrl+Alt+Del"
          >
            <Keyboard className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
          <button
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            title="Clipboard"
          >
            <Clipboard className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
          <button
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors opacity-50 cursor-not-allowed"
            title="USB Devices (coming soon)"
            disabled
          >
            <Usb className="w-5 h-5 text-[var(--text-muted)]" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
            title="Toggle fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5 text-[var(--text-muted)]" />
            ) : (
              <Maximize2 className="w-5 h-5 text-[var(--text-muted)]" />
            )}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain cursor-none"
          tabIndex={0}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 bg-[var(--bg-surface)] border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
        <span>VM: {vmId.slice(0, 8)}...</span>
        <span>
          {resolution.width}×{resolution.height}
        </span>
      </div>
    </div>
  );
}
