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
  Bug,
} from 'lucide-react';
import { DebugPanel } from './DebugPanel';
import { vncLog } from '../lib/debug-logger';

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

// Connection state for overlay display
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

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
  const [connectionState, setConnectionStateRaw] = useState<ConnectionState>('connecting');
  const connectionStateRef = useRef<ConnectionState>('connecting');
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  
  // Helper to update both state and ref
  const setConnectionState = useCallback((newState: ConnectionState) => {
    connectionStateRef.current = newState;
    setConnectionStateRaw(newState);
  }, []);
  const [mouseDown, setMouseDown] = useState(0);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [canvasScale, setCanvasScale] = useState(1);
  const hasReceivedInitialFrame = useRef(false);
  
  // VM Menu state
  const [showVMMenu, setShowVMMenu] = useState(false);
  const [showISODialog, setShowISODialog] = useState(false);
  const [isoPath, setIsoPath] = useState('');
  const [isoMode, setIsoMode] = useState<'local' | 'remote'>('local');
  const [isoServerUrl, setIsoServerUrl] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
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
  
  // Start local ISO server and mount
  const handleMountLocalISO = useCallback(async () => {
    if (!isoPath.trim()) return;
    
    setExecutingAction('mount-iso');
    
    try {
      // Start the local HTTP server to serve the ISO
      const serverInfo = await invoke<{ url: string; localPath: string; isServing: boolean }>('start_iso_server', {
        isoPath: isoPath.trim(),
      });
      
      setIsoServerUrl(serverInfo.url);
      showToast(`ISO server started at ${serverInfo.url}`, 'info');
      
      // Now mount using the HTTP URL
      await invoke('vm_mount_iso', {
        controlPlaneUrl,
        vmId,
        isoPath: serverInfo.url,
      });
      
      showToast('Local ISO mounted successfully', 'success');
      setShowISODialog(false);
      setIsoPath('');
    } catch (err) {
      console.error('Mount local ISO failed:', err);
      showToast(`Failed to mount ISO: ${err}`, 'error');
      // Stop the server if mounting failed
      try {
        await invoke('stop_iso_server');
        setIsoServerUrl(null);
      } catch (_) {}
    } finally {
      setExecutingAction(null);
    }
  }, [controlPlaneUrl, vmId, isoPath, showToast]);
  
  // Mount remote ISO (hypervisor path)
  const handleMountRemoteISO = useCallback(async () => {
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
  
  // Mount ISO based on mode
  const handleMountISO = useCallback(async () => {
    if (isoMode === 'local') {
      await handleMountLocalISO();
    } else {
      await handleMountRemoteISO();
    }
  }, [isoMode, handleMountLocalISO, handleMountRemoteISO]);
  
  // Stop ISO server when disconnecting
  const stopIsoServer = useCallback(async () => {
    if (isoServerUrl) {
      try {
        await invoke('stop_iso_server');
        setIsoServerUrl(null);
      } catch (err) {
        console.error('Failed to stop ISO server:', err);
      }
    }
  }, [isoServerUrl]);
  
  // Cleanup ISO server on unmount
  useEffect(() => {
    return () => {
      if (isoServerUrl) {
        invoke('stop_iso_server').catch(() => {});
      }
    };
  }, [isoServerUrl]);

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
    
    vncLog.debug(`Scale: ${scale.toFixed(2)}, Display: ${newWidth}x${newHeight}, Resolution: ${resolution.width}x${resolution.height}, Container: ${containerWidth}x${containerHeight}`);
    
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
  // Only initializes if dimensions changed to avoid clearing existing framebuffer
  const initializeCanvas = useCallback((width: number, height: number) => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    
    // Skip if already initialized with same dimensions
    if (canvas.width === width && canvas.height === height) {
      vncLog.debug(`Canvas already initialized: ${width}x${height}, skipping`);
      return;
    }
    
    vncLog.info(`Initializing canvas: ${width}x${height}`);
    canvas.width = width;
    canvas.height = height;
    
    // Only clear if we haven't received any frames yet
    // (hasReceivedInitialFrame guards against clearing after first paint)
    if (!hasReceivedInitialFrame.current) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
      }
    }
    
    setResolution({ width, height });
  }, []);

  // Fetch connection info on mount (in case vnc:connected already fired before listener was set up)
  useEffect(() => {
    vncLog.info(`ConsoleView mounted for VM ${vmId}`, { connectionId, vmName, controlPlaneUrl });
    
    const fetchConnectionInfo = async () => {
      // Skip if we already have frames - canvas is already initialized correctly
      if (hasReceivedInitialFrame.current) {
        return;
      }
      
      try {
        const info = await invoke<{
          id: string;
          vm_id: string;
          status: string;
          width: number;
          height: number;
        } | null>('get_connection_info', { connectionId });
        
        if (info) {
          if (info.status === 'connected' && connectionStateRef.current !== 'connected') {
            vncLog.info('Connection already established, hiding overlay');
            setConnectionState('connected');
          }
          
          // Only initialize if we haven't received frames yet
          if (!hasReceivedInitialFrame.current && info.width > 0 && info.height > 0) {
            initializeCanvas(info.width, info.height);
          }
        }
      } catch (e) {
        vncLog.error('Failed to get connection info', e);
      }
    };

    // Fetch once after a short delay
    const timer = setTimeout(fetchConnectionInfo, 200);
    
    return () => {
      clearTimeout(timer);
    };
  }, [connectionId, initializeCanvas, setConnectionState]);

  // Handle framebuffer updates
  useEffect(() => {
    const unlistenFb = listen<FramebufferUpdate>('vnc:framebuffer', (event) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const update = event.payload;
      
      // Debug logging (only log occasionally to reduce noise)
      if (update.width > 100 || !hasReceivedInitialFrame.current) {
        vncLog.debug(`FB update: ${update.width}x${update.height} at (${update.x},${update.y}), length: ${update.data?.length || 'undefined'}`);
      }
      
      // If we're receiving framebuffer updates, we're definitely connected
      if (connectionStateRef.current !== 'connected') {
        vncLog.info('Got framebuffer update, marking as connected');
        setConnectionState('connected');
      }
      
      // Check if data is valid
      if (!update.data || !Array.isArray(update.data)) {
        vncLog.error(`Invalid framebuffer data: ${typeof update.data}`);
        return;
      }
      
      // If canvas not sized yet, initialize it from the update dimensions
      // This handles the case where we receive a full screen update before vnc:connected
      if (canvas.width === 0 || canvas.height === 0) {
        // Use the update position + dimensions to infer full resolution
        // A full screen update at (0,0) gives us the resolution directly
        if (update.x === 0 && update.y === 0 && update.width > 0 && update.height > 0) {
          vncLog.info(`Initializing canvas from first FB update: ${update.width}x${update.height}`);
          canvas.width = update.width;
          canvas.height = update.height;
          setResolution({ width: update.width, height: update.height });
        } else {
          // Partial update but canvas not ready - skip for now
          vncLog.warn(`Canvas not initialized, skipping partial update at (${update.x},${update.y})`);
          return;
        }
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
        setConnectionState('disconnected');
      }
    });

    const unlistenConnect = listen<{ connectionId: string; width: number; height: number }>(
      'vnc:connected',
      (event) => {
        // Accept connection events for this VM (original or reconnection)
        // Note: On reconnect, we get a new connectionId
        const newWidth = event.payload.width;
        const newHeight = event.payload.height;
        
        vncLog.info(`Connected event: ${newWidth}x${newHeight}, id: ${event.payload.connectionId}`);
        
        // Show toast only on reconnection (use ref to get current value in closure)
        if (connectionStateRef.current === 'reconnecting') {
          showToast('Reconnected to VM console', 'success');
        }
        
        setConnectionState('connected');
        initializeCanvas(newWidth, newHeight);
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
  // Note: setConnectionState uses a ref internally so it's stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, calculateScale, showToast, initializeCanvas]);

  // Handle disconnect
  const handleDisconnect = useCallback(async () => {
    try {
      await invoke('disconnect_vnc', { connectionId });
    } catch (err) {
      console.error('Disconnect error:', err);
    }
    // Stop ISO server if running
    await stopIsoServer();
    onDisconnect();
  }, [connectionId, onDisconnect, stopIsoServer]);

  // Handle reconnect - reconnects to the same VM
  const handleReconnect = useCallback(async () => {
    setConnectionState('reconnecting');
    
    try {
      // Disconnect first if still connected
      try {
        await invoke('disconnect_vnc', { connectionId });
      } catch (_) {
        // Ignore disconnect errors
      }
      
      // Small delay before reconnecting
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Connect again to the same VM using the control plane
      // Note: This will create a new connectionId, but the vnc:connected event
      // listener will pick it up and update the state
      const newConnectionId = await invoke<string>('connect_vnc', {
        controlPlaneUrl,
        vmId,
        password: null,
      });
      
      vncLog.info('Reconnected with new connection ID', newConnectionId);
      // The vnc:connected event handler will show the success toast
    } catch (err) {
      vncLog.error('Reconnect error', err);
      showToast(`Reconnection failed: ${err}`, 'error');
      setConnectionState('disconnected');
    }
  }, [connectionId, controlPlaneUrl, vmId, showToast, setConnectionState]);

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
      {/* Toast notifications - Enhanced */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`toast ${
              toast.type === 'success' ? 'toast-success' :
              toast.type === 'error' ? 'toast-error' :
              'toast-info'
            }`}
          >
            {toast.type === 'success' && <span className="text-lg">✓</span>}
            {toast.type === 'error' && <span className="text-lg">✕</span>}
            {toast.type === 'info' && <span className="text-lg">ℹ</span>}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
      
      {/* ISO Mount Dialog - Enhanced with depth */}
      {showISODialog && (
        <div className="modal-overlay" onClick={() => { setShowISODialog(false); setIsoPath(''); }}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            {/* Header with icon */}
            <div className="modal-header">
              <div className="flex items-center gap-4">
                <div className="modal-header-icon">
                  <Disc />
                </div>
                <div>
                  <h2 className="modal-title">Mount ISO Image</h2>
                  <p className="modal-subtitle">Attach a virtual disc to {vmName}</p>
                </div>
              </div>
              <button
                onClick={() => { setShowISODialog(false); setIsoPath(''); }}
                className="icon-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Body */}
            <div className="modal-body space-y-5">
              {/* Mode Toggle - Segmented Control */}
              <div className="segmented-control">
                <button
                  onClick={() => setIsoMode('local')}
                  className={`segmented-control-item ${isoMode === 'local' ? 'active' : ''}`}
                >
                  <span className="icon">📁</span>
                  <span>Local File</span>
                </button>
                <button
                  onClick={() => setIsoMode('remote')}
                  className={`segmented-control-item ${isoMode === 'remote' ? 'active' : ''}`}
                >
                  <span className="icon">🖥️</span>
                  <span>Hypervisor Path</span>
                </button>
              </div>
              
              {isoMode === 'local' ? (
                <>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    Select an ISO from your computer. qvmc will serve it over HTTP so the hypervisor can access it.
                  </p>
                  
                  {/* File browser input */}
                  <div className="file-input-group">
                    <input
                      type="text"
                      value={isoPath}
                      onChange={(e) => setIsoPath(e.target.value)}
                      placeholder="Select an ISO file..."
                      readOnly
                      className="input cursor-default"
                    />
                    <button onClick={handleBrowseISO} className="browse-btn">
                      <FolderOpen />
                      <span>Browse</span>
                    </button>
                  </div>
                  
                  {/* Server status indicator */}
                  {isoServerUrl && (
                    <div className="modal-server-status">
                      <div className="status-dot" />
                      <span className="text-sm text-[var(--success)] font-medium">
                        Serving at: <span className="font-mono text-xs">{isoServerUrl}</span>
                      </span>
                    </div>
                  )}
                  
                  {/* Info box */}
                  <div className="modal-info-box">
                    <p>
                      <strong>How it works:</strong> qvmc starts a temporary HTTP server on your machine. 
                      The hypervisor downloads the ISO from your computer over the network.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    Enter the path to an ISO file on the hypervisor's local storage.
                  </p>
                  
                  <div className="form-group">
                    <label className="label">ISO Path</label>
                    <input
                      type="text"
                      value={isoPath}
                      onChange={(e) => setIsoPath(e.target.value)}
                      placeholder="/var/lib/libvirt/images/ubuntu.iso"
                      className="input font-mono text-sm"
                      autoFocus
                    />
                  </div>
                  
                  <p className="text-xs text-[var(--text-muted)]">
                    The path must be accessible from the hypervisor host where the VM is running.
                  </p>
                </>
              )}
            </div>
            
            {/* Footer */}
            <div className="modal-footer">
              <button
                onClick={() => { setShowISODialog(false); setIsoPath(''); }}
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={handleMountISO}
                disabled={!isoPath.trim() || executingAction === 'mount-iso'}
                className="btn btn-primary flex-1"
              >
                {executingAction === 'mount-iso' && <Loader2 className="w-4 h-4 spinner" />}
                <Disc className="w-4 h-4" />
                {isoMode === 'local' ? 'Upload & Mount' : 'Mount ISO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar - Enhanced with depth and visual hierarchy */}
      <div className="console-toolbar">
        {/* Left section - Navigation & VM Info */}
        <div className="console-toolbar-section">
          <button
            onClick={handleDisconnect}
            className="console-toolbar-btn console-toolbar-btn-back"
            title="Disconnect"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          <div className="console-toolbar-divider" />
          
          <div className="console-toolbar-vm-info">
            <span className="console-toolbar-vm-name">{vmName}</span>
            {connectionState === 'connected' && (
              <span className="console-toolbar-status console-toolbar-status-connected">
                <span className="status-dot" />
                Connected
              </span>
            )}
            {connectionState === 'connecting' && (
              <span className="console-toolbar-status console-toolbar-status-action">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Connecting...
              </span>
            )}
            {connectionState === 'reconnecting' && (
              <span className="console-toolbar-status console-toolbar-status-action">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Reconnecting...
              </span>
            )}
            {connectionState === 'disconnected' && (
              <span className="console-toolbar-status console-toolbar-status-disconnected">
                Disconnected
              </span>
            )}
          </div>
          
          {/* Executing action indicator */}
          {executingAction && (
            <span className="console-toolbar-status console-toolbar-status-action">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {executingAction === 'mount-iso' ? 'Mounting...' : `${executingAction}...`}
            </span>
          )}
        </div>

        {/* Right section - Controls */}
        <div className="console-toolbar-section">
          {/* VM Menu Dropdown */}
          <div ref={vmMenuRef} className="relative">
            <button
              onClick={() => setShowVMMenu(!showVMMenu)}
              className={`console-toolbar-dropdown-btn ${showVMMenu ? 'active' : ''}`}
            >
              <span>VM</span>
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${showVMMenu ? 'rotate-180' : ''}`} />
            </button>
            
            {showVMMenu && (
              <div className="dropdown-menu">
                <div className="dropdown-section-title">Power</div>
                <button
                  onClick={() => handlePowerAction('start')}
                  disabled={!!executingAction}
                  className={`dropdown-item ${executingAction ? 'dropdown-item-disabled' : ''}`}
                >
                  <Power className="text-green-400" />
                  <span>Power On</span>
                </button>
                <button
                  onClick={() => handlePowerAction('stop')}
                  disabled={!!executingAction}
                  className={`dropdown-item ${executingAction ? 'dropdown-item-disabled' : ''}`}
                >
                  <PowerOff className="text-orange-400" />
                  <span>Shut Down Guest</span>
                </button>
                <button
                  onClick={() => handlePowerAction('reboot')}
                  disabled={!!executingAction}
                  className={`dropdown-item ${executingAction ? 'dropdown-item-disabled' : ''}`}
                >
                  <RefreshCw className="text-blue-400" />
                  <span>Restart Guest</span>
                </button>
                <button
                  onClick={() => handlePowerAction('force_stop')}
                  disabled={!!executingAction}
                  className={`dropdown-item ${executingAction ? 'dropdown-item-disabled' : ''}`}
                >
                  <PowerOff className="text-red-400" />
                  <span>Force Power Off</span>
                </button>
                
                <div className="dropdown-divider" />
                
                <div className="dropdown-section-title">Devices</div>
                <button
                  onClick={() => { setShowVMMenu(false); setShowISODialog(true); }}
                  disabled={!!executingAction}
                  className={`dropdown-item ${executingAction ? 'dropdown-item-disabled' : ''}`}
                >
                  <Disc className="text-[var(--accent)]" />
                  <span>Mount ISO...</span>
                </button>
              </div>
            )}
          </div>
          
          <div className="console-toolbar-divider" />
          
          {/* Scale mode toggle */}
          <button
            onClick={cycleScaleMode}
            className="console-toolbar-btn console-toolbar-btn-scale"
            title={`Scale mode: ${scaleMode}`}
          >
            {scaleMode === 'fit' && <ZoomOut className="w-4 h-4" />}
            {scaleMode === '100%' && <span className="font-mono text-xs font-bold">1:1</span>}
            {scaleMode === 'fill' && <ZoomIn className="w-4 h-4" />}
            <span className="capitalize text-xs">{scaleMode}</span>
          </button>
          
          <div className="console-toolbar-divider" />
          
          {/* Action buttons group */}
          <div className="console-toolbar-btn-group">
            <button
              onClick={sendCtrlAltDel}
              className="console-toolbar-btn"
              title="Send Ctrl+Alt+Del"
            >
              <Keyboard className="w-4.5 h-4.5" />
            </button>
            <button
              className="console-toolbar-btn"
              title="Clipboard"
            >
              <Clipboard className="w-4.5 h-4.5" />
            </button>
            <button
              className="console-toolbar-btn console-toolbar-btn-disabled"
              title="USB Devices (coming soon)"
              disabled
            >
              <Usb className="w-4.5 h-4.5" />
            </button>
          </div>
          
          <div className="console-toolbar-divider" />
          
          {/* Debug button */}
          <button
            onClick={() => setShowDebugPanel(true)}
            className="console-toolbar-btn"
            title="Debug Logs"
          >
            <Bug className="w-4.5 h-4.5" />
          </button>
          
          <button
            onClick={toggleFullscreen}
            className="console-toolbar-btn console-toolbar-btn-fullscreen"
            title="Toggle fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="w-5 h-5" />
            ) : (
              <Maximize2 className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Canvas viewport */}
      <div 
        ref={viewportRef}
        className="flex-1 flex items-center justify-center overflow-hidden bg-black relative"
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
        
        {/* Connection overlay - shows during connecting/reconnecting/disconnected */}
        {connectionState !== 'connected' && (
          <div className="console-connection-overlay">
            {(connectionState === 'connecting' || connectionState === 'reconnecting') && (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-[var(--accent)]" />
                <div className="console-overlay-title">
                  {connectionState === 'reconnecting' ? 'Reconnecting to VM Console' : 'Connecting to VM Console'}
                </div>
                <div className="console-overlay-subtitle">
                  {connectionState === 'reconnecting' ? 'Re-establishing connection...' : 'Establishing secure connection...'}
                </div>
              </>
            )}
            {connectionState === 'disconnected' && (
              <>
                <div className="console-overlay-error-icon">
                  <X className="w-8 h-8" />
                </div>
                <div className="console-overlay-title">Disconnected</div>
                <div className="console-overlay-subtitle">The console session has ended.</div>
                <button 
                  onClick={handleReconnect}
                  className="btn btn-primary mt-4"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry Connection</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status bar - Enhanced */}
      <div className="console-status-bar">
        <div className="console-status-bar-item">
          <span>VM: {vmId.slice(0, 8)}...</span>
        </div>
        <div className="console-status-bar-item">
          <span className="console-status-bar-resolution">
            {resolution.width}×{resolution.height}
          </span>
          {canvasScale !== 1 && (
            <span className="console-status-bar-scale">
              {Math.round(canvasScale * 100)}%
            </span>
          )}
        </div>
      </div>
      
      {/* Debug Panel */}
      <DebugPanel
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
      />
    </div>
  );
}
