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
  ZoomIn,
  ZoomOut,
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

type ScaleMode = 'fit' | 'fill' | '100%';

export function ConsoleView({
  connectionId,
  vmId,
  vmName,
  onDisconnect,
}: ConsoleViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connected, setConnected] = useState(true);
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  const [mouseDown, setMouseDown] = useState(0);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [canvasScale, setCanvasScale] = useState(1);
  const hasReceivedInitialFrame = useRef(false);

  // Calculate scale based on container size and resolution
  const calculateScale = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas || resolution.width === 0) return;

    const containerWidth = viewport.clientWidth;
    const containerHeight = viewport.clientHeight;

    if (scaleMode === '100%') {
      setCanvasScale(1);
    } else if (scaleMode === 'fit') {
      // Scale to fit within container while maintaining aspect ratio
      const scaleX = containerWidth / resolution.width;
      const scaleY = containerHeight / resolution.height;
      setCanvasScale(Math.min(scaleX, scaleY, 1)); // Don't scale up, only down
    } else if (scaleMode === 'fill') {
      // Scale to fill container while maintaining aspect ratio
      const scaleX = containerWidth / resolution.width;
      const scaleY = containerHeight / resolution.height;
      setCanvasScale(Math.max(scaleX, scaleY));
    }
  }, [resolution, scaleMode]);

  // Recalculate scale on resize
  useEffect(() => {
    calculateScale();
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, [calculateScale]);

  // Handle framebuffer updates
  useEffect(() => {
    const unlistenFb = listen<FramebufferUpdate>('vnc:framebuffer', (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const update = event.payload;
      
      // Create ImageData with correct dimensions
      const imageData = ctx.createImageData(update.width, update.height);
      
      // Copy RGBA data (ensure we don't overflow)
      const dataLength = Math.min(update.data.length, imageData.data.length);
      for (let i = 0; i < dataLength; i++) {
        imageData.data[i] = update.data[i];
      }

      ctx.putImageData(imageData, update.x, update.y);
      hasReceivedInitialFrame.current = true;
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
          const newWidth = event.payload.width;
          const newHeight = event.payload.height;
          
          setResolution({
            width: newWidth,
            height: newHeight,
          });

          // Resize canvas to match VNC resolution
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.width = newWidth;
            canvas.height = newHeight;
            
            // Clear canvas to black
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, newWidth, newHeight);
            }
          }
          
          // Trigger scale calculation after resolution is set
          setTimeout(calculateScale, 50);
        }
      }
    );

    // Listen for desktop resize
    const unlistenResize = listen<{ width: number; height: number }>(
      'vnc:desktop-resize',
      (event) => {
        setResolution({
          width: event.payload.width,
          height: event.payload.height,
        });
        
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = event.payload.width;
          canvas.height = event.payload.height;
        }
        
        calculateScale();
      }
    );

    return () => {
      unlistenFb.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
      unlistenConnect.then((fn) => fn());
      unlistenResize.then((fn) => fn());
    };
  }, [connectionId, calculateScale]);

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

  // Calculate mouse position accounting for CSS scale transform
  const getVNCCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    // The canvas is CSS-scaled, so getBoundingClientRect gives the scaled size
    // We need to convert screen coordinates back to VNC coordinates
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));

    // Clamp to canvas bounds
    return {
      x: Math.max(0, Math.min(canvas.width - 1, x)),
      y: Math.max(0, Math.min(canvas.height - 1, y)),
    };
  }, []);

  // Mouse events
  const handleMouseMove = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = getVNCCoordinates(e);

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
    [connectionId, mouseDown, getVNCCoordinates]
  );

  const handleMouseDown = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Focus canvas for keyboard events
      canvasRef.current?.focus();
      
      const button = 1 << e.button;
      setMouseDown((prev) => prev | button);

      const { x, y } = getVNCCoordinates(e);

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
    [connectionId, mouseDown, getVNCCoordinates]
  );

  const handleMouseUp = useCallback(
    async (e: React.MouseEvent<HTMLCanvasElement>) => {
      const button = 1 << e.button;
      setMouseDown((prev) => prev & ~button);

      const { x, y } = getVNCCoordinates(e);

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
    [connectionId, mouseDown, getVNCCoordinates]
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

  // Cycle through scale modes
  const cycleScaleMode = useCallback(() => {
    setScaleMode(prev => {
      if (prev === 'fit') return '100%';
      if (prev === '100%') return 'fill';
      return 'fit';
    });
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
          {/* Scale mode toggle */}
          <button
            onClick={cycleScaleMode}
            className="px-2 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5 text-xs"
            title={`Scale mode: ${scaleMode}`}
          >
            {scaleMode === 'fit' && <ZoomOut className="w-4 h-4 text-[var(--text-muted)]" />}
            {scaleMode === '100%' && <span className="text-[var(--text-muted)] font-mono">1:1</span>}
            {scaleMode === 'fill' && <ZoomIn className="w-4 h-4 text-[var(--text-muted)]" />}
            <span className="text-[var(--text-muted)] capitalize">{scaleMode}</span>
          </button>
          
          <div className="w-px h-5 bg-[var(--border)] mx-1" />
          
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

      {/* Canvas viewport */}
      <div 
        ref={viewportRef}
        className="flex-1 flex items-center justify-center overflow-auto bg-black"
      >
        <canvas
          ref={canvasRef}
          className="cursor-none"
          style={{
            transform: `scale(${canvasScale})`,
            transformOrigin: 'center center',
            imageRendering: scaleMode === '100%' ? 'auto' : 'auto',
          }}
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
        <div className="flex items-center gap-3">
          <span>
            {resolution.width}×{resolution.height}
          </span>
          {canvasScale !== 1 && (
            <span className="text-[var(--accent)]">
              ({Math.round(canvasScale * 100)}%)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
