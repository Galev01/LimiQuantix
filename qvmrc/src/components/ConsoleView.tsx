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
  ChevronDown,
  Power,
  PowerOff,
  RefreshCw,
  Disc,
  X,
  Loader2,
  FolderOpen,
} from 'lucide-react';

interface ConsoleViewProps {
  connectionId: string;
  vmId: string;
  vmName: string;
  controlPlaneUrl: string;
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

// Toast notification state
interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function ConsoleView({
  connectionId,
  vmId,
  vmName,
  controlPlaneUrl,
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
  
  // VM Menu state
  const [showVMMenu, setShowVMMenu] = useState(false);
  const [showISODialog, setShowISODialog] = useState(false);
  const [isoPath, setIsoPath] = useState('');
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const vmMenuRef = useRef<HTMLDivElement>(null);
  
  // Toast helpers
  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (vmMenuRef.current && !vmMenuRef.current.contains(e.target as Node)) {
        setShowVMMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Power action handler
  const handlePowerAction = useCallback(async (action: string) => {
    setExecutingAction(action);
    setShowVMMenu(false);
    
    try {
      await invoke('vm_power_action', {
        controlPlaneUrl,
        vmId,
        action,
      });
      showToast(`VM ${action} command sent successfully`, 'success');
    } catch (err) {
      console.error(`Power action ${action} failed:`, err);
      showToast(`Failed to ${action} VM: ${err}`, 'error');
    } finally {
      setExecutingAction(null);
    }
  }, [controlPlaneUrl, vmId, showToast]);
  
  // Browse for local ISO
  const handleBrowseISO = useCallback(async () => {
    try {
      const path = await invoke<string | null>('browse_file', {
        title: 'Select ISO Image',
        filters: [{ name: 'ISO Images', extensions: ['iso'] }],
      });
      if (path) {
        setIsoPath(path);
      }
    } catch (err) {
      console.error('Browse failed:', err);
      showToast('Failed to open file browser', 'error');
    }
  }, [showToast]);
  
  // Mount ISO
  const handleMountISO = useCallback(async () => {
    if (!isoPath.trim()) return;
    
    setExecutingAction('mount-iso');
    
    try {
      await invoke('vm_mount_iso', {
        controlPlaneUrl,
        vmId,
        isoPath: isoPath.trim(),
      });
      showToast('ISO mounted successfully', 'success');
      setShowISODialog(false);
      setIsoPath('');
    } catch (err) {
      console.error('Mount ISO failed:', err);
      showToast(`Failed to mount ISO: ${err}`, 'error');
    } finally {
      setExecutingAction(null);
    }
  }, [controlPlaneUrl, vmId, isoPath, showToast]);

  // Calculate display dimensions based on container size and resolution
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  
  const calculateScale = useCallback(() => {
    const viewport = viewportRef.current;
    
    // Need viewport
    if (!viewport) return;
    
    // If no resolution yet, just hide/show at natural size
    if (resolution.width === 0 || resolution.height === 0) {
      return;
    }

    const containerWidth = viewport.clientWidth;
    const containerHeight = viewport.clientHeight;
    
    // Ensure container has dimensions
    if (containerWidth === 0 || containerHeight === 0) {
      // Retry after a short delay
      setTimeout(calculateScale, 100);
      return;
    }

    let scale = 1;
    
    if (scaleMode === '100%') {
      scale = 1;
    } else if (scaleMode === 'fit') {
      // Scale to fit within container while maintaining aspect ratio
      const scaleX = containerWidth / resolution.width;
      const scaleY = containerHeight / resolution.height;
      scale = Math.min(scaleX, scaleY);
    } else if (scaleMode === 'fill') {
      // Scale to fill container while maintaining aspect ratio
      const scaleX = containerWidth / resolution.width;
      const scaleY = containerHeight / resolution.height;
      scale = Math.max(scaleX, scaleY);
    }
    
    const newWidth = Math.floor(resolution.width * scale);
    const newHeight = Math.floor(resolution.height * scale);
    
    console.log(`[VNC] Scale: ${scale.toFixed(2)}, Display: ${newWidth}x${newHeight}, Resolution: ${resolution.width}x${resolution.height}, Container: ${containerWidth}x${containerHeight}`);
    
    setCanvasScale(scale);
    setDisplaySize({
      width: newWidth,
      height: newHeight,
    });
  }, [resolution, scaleMode]);

  // Recalculate scale on resize
  useEffect(() => {
    calculateScale();
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, [calculateScale]);

  // Helper to initialize canvas with resolution
  const initializeCanvas = useCallback((width: number, height: number) => {
    console.log(`[VNC] Initializing canvas: ${width}x${height}`);
    
    const canvas = canvasRef.current;
    if (canvas && width > 0 && height > 0) {
      canvas.width = width;
      canvas.height = height;
      
      // Clear canvas to black
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
      }
    }
    
    setResolution({ width, height });
  }, []);

  // Fetch connection info on mount (in case vnc:connected already fired)
  useEffect(() => {
    const fetchConnectionInfo = async () => {
      try {
        const info = await invoke<{
          id: string;
          vm_id: string;
          status: string;
          width: number;
          height: number;
        } | null>('get_connection_info', { connectionId });
        
        if (info && info.width > 0 && info.height > 0) {
          console.log(`[VNC] Got connection info: ${info.width}x${info.height}`);
          initializeCanvas(info.width, info.height);
        }
      } catch (e) {
        console.error('[VNC] Failed to get connection info:', e);
      }
    };

    // Fetch immediately in case connection was already established
    fetchConnectionInfo();
    
    // Also poll a few times in case there's a delay
    const timer1 = setTimeout(fetchConnectionInfo, 100);
    const timer2 = setTimeout(fetchConnectionInfo, 500);
    const timer3 = setTimeout(fetchConnectionInfo, 1000);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [connectionId, initializeCanvas]);

  // Handle framebuffer updates
  useEffect(() => {
    const unlistenFb = listen<FramebufferUpdate>('vnc:framebuffer', (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const update = event.payload;
      
      // If canvas not sized yet, size it based on first update
      if (canvas.width === 0 || canvas.height === 0) {
        // Try to get resolution from connection
        invoke<{
          id: string;
          vm_id: string;
          status: string;
          width: number;
          height: number;
        } | null>('get_connection_info', { connectionId }).then((info) => {
          if (info && info.width > 0 && info.height > 0) {
            initializeCanvas(info.width, info.height);
          }
        });
      }
      
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
          
          console.log(`[VNC] Connected event: ${newWidth}x${newHeight}`);
          initializeCanvas(newWidth, newHeight);
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

  // Calculate mouse position accounting for CSS scaling
  const getVNCCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || resolution.width === 0) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    
    // Convert screen coordinates to VNC coordinates
    // rect gives us the CSS-scaled size, canvas.width is the native VNC resolution
    const x = Math.floor((e.clientX - rect.left) / rect.width * resolution.width);
    const y = Math.floor((e.clientY - rect.top) / rect.height * resolution.height);

    // Clamp to resolution bounds
    return {
      x: Math.max(0, Math.min(resolution.width - 1, x)),
      y: Math.max(0, Math.min(resolution.height - 1, y)),
    };
  }, [resolution]);

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
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-slide-in ${
              toast.type === 'success' ? 'bg-green-500/90 text-white' :
              toast.type === 'error' ? 'bg-red-500/90 text-white' :
              'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
      
      {/* ISO Mount Dialog */}
      {showISODialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-surface)] rounded-xl shadow-2xl w-[480px] border border-[var(--border)]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <Disc className="w-5 h-5 text-[var(--accent)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Mount ISO Image</h2>
              </div>
              <button
                onClick={() => { setShowISODialog(false); setIsoPath(''); }}
                className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
              >
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            </div>
            
            <div className="p-5 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Select an ISO image from your local machine to mount to the VM's CD/DVD drive.
              </p>
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={isoPath}
                  onChange={(e) => setIsoPath(e.target.value)}
                  placeholder="Path to ISO file..."
                  className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={handleBrowseISO}
                  className="px-3 py-2 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border)] transition-colors flex items-center gap-2"
                >
                  <FolderOpen className="w-4 h-4 text-[var(--text-muted)]" />
                  <span className="text-sm text-[var(--text-primary)]">Browse</span>
                </button>
              </div>
              
              <p className="text-xs text-[var(--text-muted)]">
                Note: The ISO file must be accessible from the hypervisor host.
              </p>
            </div>
            
            <div className="flex justify-end gap-3 px-5 py-4 border-t border-[var(--border)]">
              <button
                onClick={() => { setShowISODialog(false); setIsoPath(''); }}
                className="px-4 py-2 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMountISO}
                disabled={!isoPath.trim() || executingAction === 'mount-iso'}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {executingAction === 'mount-iso' && <Loader2 className="w-4 h-4 animate-spin" />}
                Mount ISO
              </button>
            </div>
          </div>
        </div>
      )}

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
          
          {/* Executing action indicator */}
          {executingAction && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--accent)] px-2 py-0.5 bg-[var(--accent)]/10 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              {executingAction === 'mount-iso' ? 'Mounting...' : `${executingAction}...`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* VM Menu Dropdown */}
          <div ref={vmMenuRef} className="relative">
            <button
              onClick={() => setShowVMMenu(!showVMMenu)}
              className="px-3 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors flex items-center gap-1.5 text-sm"
            >
              <span className="text-[var(--text-primary)]">VM</span>
              <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${showVMMenu ? 'rotate-180' : ''}`} />
            </button>
            
            {showVMMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 py-1 bg-[var(--bg-elevated)] rounded-lg shadow-xl border border-[var(--border)] z-50 animate-slide-down">
                <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Power
                </div>
                <button
                  onClick={() => handlePowerAction('start')}
                  disabled={!!executingAction}
                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-hover)] flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <Power className="w-4 h-4 text-green-400" />
                  <span className="text-[var(--text-primary)]">Power On</span>
                </button>
                <button
                  onClick={() => handlePowerAction('shutdown')}
                  disabled={!!executingAction}
                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-hover)] flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <PowerOff className="w-4 h-4 text-orange-400" />
                  <span className="text-[var(--text-primary)]">Shut Down Guest</span>
                </button>
                <button
                  onClick={() => handlePowerAction('reboot')}
                  disabled={!!executingAction}
                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-hover)] flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <RefreshCw className="w-4 h-4 text-blue-400" />
                  <span className="text-[var(--text-primary)]">Restart Guest</span>
                </button>
                <button
                  onClick={() => handlePowerAction('stop')}
                  disabled={!!executingAction}
                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-hover)] flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <PowerOff className="w-4 h-4 text-red-400" />
                  <span className="text-[var(--text-primary)]">Force Power Off</span>
                </button>
                
                <div className="my-1 border-t border-[var(--border)]" />
                
                <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Devices
                </div>
                <button
                  onClick={() => { setShowVMMenu(false); setShowISODialog(true); }}
                  disabled={!!executingAction}
                  className="w-full px-3 py-2 text-left hover:bg-[var(--bg-hover)] flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <Disc className="w-4 h-4 text-[var(--accent)]" />
                  <span className="text-[var(--text-primary)]">Mount ISO...</span>
                </button>
              </div>
            )}
          </div>
          
          <div className="w-px h-5 bg-[var(--border)] mx-1" />
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
        className="flex-1 flex items-center justify-center overflow-hidden bg-black"
      >
        <canvas
          ref={canvasRef}
          className="cursor-none block"
          style={{
            // Use CSS dimensions for scaling (canvas.width/height stays native for crisp rendering)
            // When displaySize is calculated, use it; otherwise fill the container
            width: displaySize.width > 0 ? `${displaySize.width}px` : '100%',
            height: displaySize.height > 0 ? `${displaySize.height}px` : '100%',
            // Crisp pixel rendering for retro/text displays
            imageRendering: 'pixelated',
            // Ensure aspect ratio is maintained even in fallback mode
            objectFit: 'contain',
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
