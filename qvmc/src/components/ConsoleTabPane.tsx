import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { getConsoleInfo } from '../lib/tauri-api';
import {
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
  Square,
  Monitor,
} from 'lucide-react';
import { DebugPanel } from './DebugPanel';
import { vncLog } from '../lib/debug-logger';
import RenderWorker from '../workers/render.worker?worker';

interface ConsoleTabPaneProps {
  connectionId: string;
  vmId: string;
  vmName: string;
  controlPlaneUrl: string;
  isActive: boolean;
  onStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

interface FramebufferUpdate {
  x: number;
  y: number;
  width: number;
  height: number;
  data: number[];
}

type ScaleMode = 'fit' | 'fill' | '100%';

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export function ConsoleTabPane({
  connectionId,
  vmId,
  vmName,
  controlPlaneUrl,
  isActive,
  onStatusChange,
}: ConsoleTabPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionState, setConnectionStateRaw] = useState<ConnectionState>('connecting');
  const connectionStateRef = useRef<ConnectionState>('connecting');
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  const workerRef = useRef<Worker | null>(null);

  // Initialize worker
  useEffect(() => {
    const worker = new RenderWorker();
    workerRef.current = worker;

    return () => {
      // Don't terminate immediately on unmount/remount in strict mode dev?
      // Actually strictly we should.
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const setConnectionState = useCallback(
    (newState: ConnectionState) => {
      connectionStateRef.current = newState;
      setConnectionStateRaw(newState);
      if (newState !== 'reconnecting') {
        onStatusChange(newState);
      }
    },
    [onStatusChange]
  );

  const [mouseDown, setMouseDown] = useState(0);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit');
  const [canvasScale, setCanvasScale] = useState(1);
  const hasReceivedInitialFrame = useRef(false);

  // VM Menu state
  const [showVMMenu, setShowVMMenu] = useState(false);
  const [showResolutionMenu, setShowResolutionMenu] = useState(false);
  const [showISODialog, setShowISODialog] = useState(false);
  const [isoPath, setIsoPath] = useState('');
  const [isoMode, setIsoMode] = useState<'local' | 'remote'>('local');
  const [isoServerUrl, setIsoServerUrl] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const vmMenuRef = useRef<HTMLDivElement>(null);
  const resolutionMenuRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (vmMenuRef.current && !vmMenuRef.current.contains(e.target as Node)) {
        setShowVMMenu(false);
      }
      if (resolutionMenuRef.current && !resolutionMenuRef.current.contains(e.target as Node)) {
        setShowResolutionMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePowerAction = useCallback(
    async (action: string) => {
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
    },
    [controlPlaneUrl, vmId, showToast]
  );

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

  const handleMountLocalISO = useCallback(async () => {
    if (!isoPath.trim()) return;

    setExecutingAction('mount-iso');

    try {
      const serverInfo = await invoke<{ url: string; localPath: string; isServing: boolean }>(
        'start_iso_server',
        {
          isoPath: isoPath.trim(),
        }
      );

      setIsoServerUrl(serverInfo.url);
      showToast(`ISO server started at ${serverInfo.url}`, 'info');

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
      try {
        await invoke('stop_iso_server');
        setIsoServerUrl(null);
      } catch (_) { }
    } finally {
      setExecutingAction(null);
    }
  }, [controlPlaneUrl, vmId, isoPath, showToast]);

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

  const handleMountISO = useCallback(async () => {
    if (isoMode === 'local') {
      await handleMountLocalISO();
    } else {
      await handleMountRemoteISO();
    }
  }, [isoMode, handleMountLocalISO, handleMountRemoteISO]);

  // Cleanup ISO server on unmount
  useEffect(() => {
    return () => {
      if (isoServerUrl) {
        invoke('stop_iso_server').catch(() => { });
      }
    };
  }, [isoServerUrl]);

  // Calculate display dimensions based on container size and resolution
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [targetResolution, setTargetResolution] = useState<{ width: number; height: number } | null>(null);

  const calculateScale = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (resolution.width === 0 || resolution.height === 0) return;

    const containerWidth = viewport.clientWidth;
    const containerHeight = viewport.clientHeight;

    if (containerWidth === 0 || containerHeight === 0) {
      setTimeout(calculateScale, 100);
      return;
    }

    let scale = 1;
    let newWidth = resolution.width;
    let newHeight = resolution.height;

    // Use target resolution if set to fake a display size
    if (targetResolution) {
      if (scaleMode === 'fit') {
        const scaleX = containerWidth / targetResolution.width;
        const scaleY = containerHeight / targetResolution.height;
        scale = Math.min(scaleX, scaleY);
        newWidth = targetResolution.width * scale;
        newHeight = targetResolution.height * scale;
      } else if (scaleMode === '100%') {
        newWidth = targetResolution.width;
        newHeight = targetResolution.height;
        scale = 1;
      } else if (scaleMode === 'fill') {
        const scaleX = containerWidth / targetResolution.width;
        const scaleY = containerHeight / targetResolution.height;
        scale = Math.max(scaleX, scaleY);
        newWidth = targetResolution.width * scale;
        newHeight = targetResolution.height * scale;
      }
    } else {
      if (scaleMode === '100%') {
        scale = 1;
      } else if (scaleMode === 'fit') {
        const scaleX = containerWidth / resolution.width;
        const scaleY = containerHeight / resolution.height;
        scale = Math.min(scaleX, scaleY);
      } else if (scaleMode === 'fill') {
        const scaleX = containerWidth / resolution.width;
        const scaleY = containerHeight / resolution.height;
        scale = Math.max(scaleX, scaleY);
      }

      if (!targetResolution) {
        newWidth = Math.floor(resolution.width * scale);
        newHeight = Math.floor(resolution.height * scale);
      }
    }

    setCanvasScale(scale);
    setDisplaySize({ width: newWidth, height: newHeight });
  }, [resolution, scaleMode, targetResolution]);

  useEffect(() => {
    calculateScale();

    // Use ResizeObserver to detect container size changes (e.g. sidebar toggle)
    const viewport = viewportRef.current;
    if (!viewport) return;

    const observer = new ResizeObserver(() => {
      calculateScale();
    });

    observer.observe(viewport);

    // Also listen to window resize as backup
    window.addEventListener('resize', calculateScale);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', calculateScale);
    };
  }, [calculateScale]);



  // Real initialization logic with Transferable
  const canvasTransferred = useRef(false);

  const initWorkerCanvas = useCallback((width: number, height: number) => {
    if (!canvasRef.current || !workerRef.current) return;

    // If not yet transferred, do it now
    if (!canvasTransferred.current) {
      try {
        const offscreen = canvasRef.current.transferControlToOffscreen();
        // Set initial size on the offscreen canvas is not directly possible via main thread *after* transfer
        // We set it on the element *before* transfer or rely on worker
        // Actually, for OffscreenCanvas, width/height are properties of the object
        // But we can't touch the DOM node's width/height for layout the same way? 
        // The DOM <canvas> acts as a placeholder.

        // Set logical size on the placeholder (which scales the layout)
        // Wait, transferControlToOffscreen detaches the context. We can still style the element.

        offscreen.width = width;
        offscreen.height = height;

        workerRef.current.postMessage({
          type: 'init',
          payload: { canvas: offscreen }
        }, [offscreen]);

        canvasTransferred.current = true;
      } catch (e) {
        console.error("Failed to transfer control to offscreen", e);
      }
    } else {
      // Just resize
      workerRef.current.postMessage({
        type: 'resize',
        payload: { width, height }
      });
    }

    setResolution({ width, height });
  }, []);

  // Auto-focus canvas when tab becomes active
  useEffect(() => {
    if (isActive && connectionState === 'connected') {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        canvasRef.current?.focus();
        vncLog.debug('Canvas focused');
      }, 100);
    }
  }, [isActive, connectionState]);

  // Fetch connection info on mount
  useEffect(() => {
    vncLog.info(`ConsoleTabPane mounted for VM ${vmId}`, { connectionId, vmName, controlPlaneUrl });

    const fetchConnectionInfo = async () => {
      if (hasReceivedInitialFrame.current) return;

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
            setConnectionState('connected');
          }
          if (!hasReceivedInitialFrame.current && info.width > 0 && info.height > 0) {
            initWorkerCanvas(info.width, info.height);
          }
        }
      } catch (e) {
        vncLog.error('Failed to get connection info', e);
      }
    };

    const timer = setTimeout(fetchConnectionInfo, 200);
    return () => clearTimeout(timer);
  }, [connectionId, initWorkerCanvas, setConnectionState, vmId, vmName, controlPlaneUrl]);

  // Handle framebuffer updates
  useEffect(() => {
    const unlistenFb = listen<FramebufferUpdate>('vnc:framebuffer', (event) => {
      const update = event.payload;

      if (connectionStateRef.current !== 'connected') {
        setConnectionState('connected');
      }

      const requiredWidth = update.x + update.width;
      const requiredHeight = update.y + update.height;

      // We need to know current resolution to decide on resize
      // But resolution state might be stale in closure? 
      // Use functional state or refs if strict.
      // Simply forward to worker, let worker decide/handle?
      // But we need to update Main Thread 'resolution' state for UI status bar.

      // Simplification: Always update resolution state if we "think" it grew
      // But exact logic is tricky without source of truth from worker.
      // Worker can postMessage back? 'resize-performed'

      if (workerRef.current) {
        // If this is the FIRST frame (implicit init), we might need to init worker?
        // BUT sending 'framebuffer' message is safe, worker handles it.
        // Problem: If canvas isn't transferred yet, worker ignores it.

        // Heuristic: If we haven't transferred, do it now with inferred size
        if (!canvasTransferred.current) {
          const newWidth = update.x === 0 ? update.width : requiredWidth;
          const newHeight = update.y === 0 ? update.height : requiredHeight;
          initWorkerCanvas(newWidth, newHeight);
        }

        workerRef.current.postMessage({
          type: 'framebuffer',
          payload: update
        });
      }

      hasReceivedInitialFrame.current = true;
    });

    const unlistenDisconnect = listen<string>('vnc:disconnected', (event) => {
      if (event.payload === connectionId) {
        setConnectionState('disconnected');
        // Do we reset worker? No, reuse it.
      }
    });

    const unlistenConnect = listen<{ connectionId: string; width: number; height: number }>(
      'vnc:connected',
      (event) => {
        const newWidth = event.payload.width;
        const newHeight = event.payload.height;

        if (connectionStateRef.current === 'reconnecting') {
          showToast('Reconnected to VM console', 'success');
        }

        setConnectionState('connected');
        initWorkerCanvas(newWidth, newHeight);
      }
    );

    const unlistenResize = listen<{ width: number; height: number }>('vnc:desktop-resize', (event) => {
      initWorkerCanvas(event.payload.width, event.payload.height);
      // calculateScale will trigger via resolution dependency
    });

    return () => {
      unlistenFb.then((fn) => fn());
      unlistenDisconnect.then((fn) => fn());
      unlistenConnect.then((fn) => fn());
      unlistenResize.then((fn) => fn());
    };
  }, [connectionId, showToast, initWorkerCanvas, setConnectionState]); // Removed initializeCanvas dependency


  const handleReconnect = useCallback(async () => {
    setConnectionState('reconnecting');

    try {
      try {
        await invoke('disconnect_vnc', { connectionId });
      } catch (_) { }

      await new Promise((resolve) => setTimeout(resolve, 500));

      const consoleInfo = await getConsoleInfo(controlPlaneUrl, vmId);

      await invoke<string>('connect_vnc', {
        controlPlaneUrl,
        vmId,
        password: consoleInfo.password || null,
      });
    } catch (err) {
      vncLog.error('Reconnect error', err);
      showToast(`Reconnection failed: ${err}`, 'error');
      setConnectionState('disconnected');
    }
  }, [connectionId, controlPlaneUrl, vmId, showToast, setConnectionState]);

  const sendCtrlAltDel = useCallback(async () => {
    try {
      await invoke('send_ctrl_alt_del', { connectionId });
    } catch (err) {
      console.error('Ctrl+Alt+Del error:', err);
    }
  }, [connectionId]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const getVNCCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || resolution.width === 0) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * resolution.width);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * resolution.height);

      return {
        x: Math.max(0, Math.min(resolution.width - 1, x)),
        y: Math.max(0, Math.min(resolution.height - 1, y)),
      };
    },
    [resolution]
  );

  const lastMouseMoveTime = useRef(0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const now = Date.now();
      // Throttle to ~30ms (approx 33fps) to prevent flooding the backend
      if (now - lastMouseMoveTime.current < 30) return;

      lastMouseMoveTime.current = now;
      const { x, y } = getVNCCoordinates(e);

      // Fire and forget - don't await to avoid blocking interaction
      invoke('send_pointer_event', { connectionId, x, y, buttons: mouseDown })
        .catch(() => { });
    },
    [connectionId, mouseDown, getVNCCoordinates]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      canvasRef.current?.focus();
      const button = 1 << e.button;
      setMouseDown((prev) => prev | button);
      const { x, y } = getVNCCoordinates(e);
      // vncLog.debug(`Mouse down at (${x}, ${y}), button: ${button}, connectionId: ${connectionId}`);
      invoke('send_pointer_event', { connectionId, x, y, buttons: mouseDown | button })
        .catch((err) => vncLog.error('Pointer event error:', err));
    },
    [connectionId, mouseDown, getVNCCoordinates]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const button = 1 << e.button;
      setMouseDown((prev) => prev & ~button);
      const { x, y } = getVNCCoordinates(e);
      invoke('send_pointer_event', { connectionId, x, y, buttons: mouseDown & ~button })
        .catch((err) => vncLog.error('Pointer event error:', err));
    },
    [connectionId, mouseDown, getVNCCoordinates]
  );

  const keyEventToKeysym = useCallback((e: React.KeyboardEvent): number => {
    const codeMap: Record<string, number> = {
      F1: 0xffbe, F2: 0xffbf, F3: 0xffc0, F4: 0xffc1,
      F5: 0xffc2, F6: 0xffc3, F7: 0xffc4, F8: 0xffc5,
      F9: 0xffc6, F10: 0xffc7, F11: 0xffc8, F12: 0xffc9,
      ArrowUp: 0xff52, ArrowDown: 0xff54, ArrowLeft: 0xff51, ArrowRight: 0xff53,
      Home: 0xff50, End: 0xff57, PageUp: 0xff55, PageDown: 0xff56,
      Backspace: 0xff08, Tab: 0xff09, Enter: 0xff0d, Escape: 0xff1b,
      Insert: 0xff63, Delete: 0xffff,
      ShiftLeft: 0xffe1, ShiftRight: 0xffe2,
      ControlLeft: 0xffe3, ControlRight: 0xffe4,
      AltLeft: 0xffe9, AltRight: 0xffea,
      MetaLeft: 0xffeb, MetaRight: 0xffec,
      CapsLock: 0xffe5, NumLock: 0xff7f, ScrollLock: 0xff14,
      Numpad0: 0xffb0, Numpad1: 0xffb1, Numpad2: 0xffb2,
      Numpad3: 0xffb3, Numpad4: 0xffb4, Numpad5: 0xffb5,
      Numpad6: 0xffb6, Numpad7: 0xffb7, Numpad8: 0xffb8, Numpad9: 0xffb9,
      NumpadMultiply: 0xffaa, NumpadAdd: 0xffab, NumpadSubtract: 0xffad,
      NumpadDecimal: 0xffae, NumpadDivide: 0xffaf, NumpadEnter: 0xff8d,
      Space: 0x0020, PrintScreen: 0xff61, Pause: 0xff13, ContextMenu: 0xff67,
    };

    if (codeMap[e.code]) return codeMap[e.code];
    if (e.key.length === 1) return e.key.charCodeAt(0);
    return e.keyCode;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const keysym = keyEventToKeysym(e);
      // vncLog.debug(`Key down: ${e.key} (keysym: ${keysym.toString(16)}), connectionId: ${connectionId}`);
      invoke('send_key_event', { connectionId, key: keysym, down: true })
        .catch((err) => vncLog.error('Key event error:', err));
    },
    [connectionId, keyEventToKeysym]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const keysym = keyEventToKeysym(e);
      invoke('send_key_event', { connectionId, key: keysym, down: false })
        .catch((err) => vncLog.error('Key event error:', err));
    },
    [connectionId, keyEventToKeysym]
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const [renderingMode, setRenderingMode] = useState<'pixelated' | 'auto'>('auto');

  const cycleScaleMode = useCallback(() => {
    setScaleMode((prev) => {
      if (prev === 'fit') return '100%';
      if (prev === '100%') return 'fill';
      return 'fit';
    });
  }, []);

  const toggleRenderingMode = useCallback(() => {
    setRenderingMode(prev => prev === 'pixelated' ? 'auto' : 'pixelated');
    showToast(`Rendering mode: ${renderingMode === 'pixelated' ? 'Smooth' : 'Pixelated'}`);
  }, [renderingMode, showToast]);

  const toggleResolution = (w: number, h: number) => {
    if (targetResolution && targetResolution.width === w && targetResolution.height === h) {
      setTargetResolution(null); // Reset to native
    } else {
      setTargetResolution({ width: w, height: h });
    }
    setShowVMMenu(false); // Reuse this logic or add new menu
  };

  // Only render when active
  if (!isActive) {
    return null;
  }

  return (
    <div ref={containerRef} className="console-tab-pane">
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.type === 'success' ? 'toast-success' : toast.type === 'error' ? 'toast-error' : 'toast-info'
              }`}
          >
            {toast.type === 'success' && <span className="text-lg">✓</span>}
            {toast.type === 'error' && <span className="text-lg">✕</span>}
            {toast.type === 'info' && <span className="text-lg">ℹ</span>}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* ISO Mount Dialog */}
      {showISODialog && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowISODialog(false);
            setIsoPath('');
          }}
        >
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
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
                onClick={() => {
                  setShowISODialog(false);
                  setIsoPath('');
                }}
                className="icon-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-5">
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
                    Select an ISO from your computer. QvMC will serve it over HTTP so the hypervisor can
                    access it.
                  </p>

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

                  {isoServerUrl && (
                    <div className="modal-server-status">
                      <div className="status-dot" />
                      <span className="text-sm text-[var(--success)] font-medium">
                        Serving at: <span className="font-mono text-xs">{isoServerUrl}</span>
                      </span>
                    </div>
                  )}

                  <div className="modal-info-box">
                    <p>
                      <strong>How it works:</strong> QvMC starts a temporary HTTP server on your machine.
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

            <div className="modal-footer">
              <button
                onClick={() => {
                  setShowISODialog(false);
                  setIsoPath('');
                }}
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

      {/* Compact Toolbar */}
      <div className="console-pane-toolbar">
        <div className="console-toolbar-section">
          <span className="console-pane-vm-name">{vmName}</span>
          {connectionState === 'connected' && (
            <span className="console-toolbar-status console-toolbar-status-connected">
              <span className="status-dot" />
              Connected
            </span>
          )}
          {(connectionState === 'connecting' || connectionState === 'reconnecting') && (
            <span className="console-toolbar-status console-toolbar-status-action">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {connectionState === 'reconnecting' ? 'Reconnecting...' : 'Connecting...'}
            </span>
          )}
          {connectionState === 'disconnected' && (
            <span className="console-toolbar-status console-toolbar-status-disconnected">Disconnected</span>
          )}
          {executingAction && (
            <span className="console-toolbar-status console-toolbar-status-action">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {executingAction === 'mount-iso' ? 'Mounting...' : `${executingAction}...`}
            </span>
          )}
        </div>

        <div className="console-toolbar-section">
          {/* Resolution Dropdown */}
          <div ref={resolutionMenuRef} className="relative">
            <button
              onClick={() => setShowResolutionMenu(!showResolutionMenu)}
              className={`console-toolbar-dropdown-btn ${showResolutionMenu ? 'active' : ''}`}
            >
              <Maximize2 className="w-4 h-4" />
              <span>{targetResolution ? `${targetResolution.width}x${targetResolution.height}` : 'Native'}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 opacity-50 transition-transform duration-200 ${showResolutionMenu ? 'rotate-180' : ''}`}
              />
            </button>
            {showResolutionMenu && (
              <div className="dropdown-menu">
                <div className="dropdown-section-title">Display Size</div>
                <button
                  onClick={() => toggleResolution(0, 0)}
                  className={`dropdown-item ${!targetResolution ? 'bg-[var(--bg-hover)]' : ''}`}
                >
                  <span>Native ({resolution.width}x{resolution.height})</span>
                </button>
                <div className="dropdown-divider" />
                <button onClick={() => toggleResolution(1280, 720)} className="dropdown-item">
                  1280x720 (HD)
                </button>
                <button onClick={() => toggleResolution(1680, 1050)} className="dropdown-item">
                  1680x1050
                </button>
                <button onClick={() => toggleResolution(1920, 1080)} className="dropdown-item">
                  1920x1080 (FHD)
                </button>
                <div className="dropdown-divider" />
                <button onClick={() => toggleResolution(854, 480)} className="dropdown-item">
                  854x480 (SD)
                </button>
              </div>
            )}
          </div>

          <div className="console-toolbar-divider" />

          {/* Rendering Mode Toggle */}
          <button
            onClick={toggleRenderingMode}
            className="console-toolbar-btn"
            title={`Rendering: ${renderingMode === 'pixelated' ? 'Pixelated' : 'Smooth'}`}
          >
            {renderingMode === 'pixelated' ? <Square className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
          </button>

          <div className="console-toolbar-divider" />

          {/* VM Menu Dropdown */}
          <div ref={vmMenuRef} className="relative">
            <button
              onClick={() => setShowVMMenu(!showVMMenu)}
              className={`console-toolbar-dropdown-btn ${showVMMenu ? 'active' : ''}`}
            >
              <span>VM</span>
              <ChevronDown
                className={`w-4 h-4 transition-transform duration-200 ${showVMMenu ? 'rotate-180' : ''}`}
              />
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
                  onClick={() => {
                    setShowVMMenu(false);
                    setShowISODialog(true);
                  }}
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

          <button onClick={cycleScaleMode} className="console-toolbar-btn console-toolbar-btn-scale" title={`Scale mode: ${scaleMode}`}>
            {scaleMode === 'fit' && <ZoomOut className="w-4 h-4" />}
            {scaleMode === '100%' && <span className="font-mono text-xs font-bold">1:1</span>}
            {scaleMode === 'fill' && <ZoomIn className="w-4 h-4" />}
            <span className="capitalize text-xs">{scaleMode}</span>
          </button>

          <div className="console-toolbar-divider" />

          <div className="console-toolbar-btn-group">
            <button onClick={sendCtrlAltDel} className="console-toolbar-btn" title="Send Ctrl+Alt+Del">
              <Keyboard className="w-4.5 h-4.5" />
            </button>
            <button className="console-toolbar-btn" title="Clipboard">
              <Clipboard className="w-4.5 h-4.5" />
            </button>
            <button className="console-toolbar-btn console-toolbar-btn-disabled" title="USB Devices (coming soon)" disabled>
              <Usb className="w-4.5 h-4.5" />
            </button>
          </div>

          <div className="console-toolbar-divider" />

          <button onClick={() => setShowDebugPanel(true)} className="console-toolbar-btn" title="Debug Logs">
            <Bug className="w-4.5 h-4.5" />
          </button>

          <button onClick={toggleFullscreen} className="console-toolbar-btn console-toolbar-btn-fullscreen" title="Toggle fullscreen">
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Canvas viewport */}
      <div ref={viewportRef} className="console-pane-viewport">
        <canvas
          ref={canvasRef}
          className="cursor-none block"
          style={{
            width: displaySize.width > 0 ? `${displaySize.width}px` : '100%',
            height: displaySize.height > 0 ? `${displaySize.height}px` : '100%',
            imageRendering: renderingMode === 'pixelated' ? 'pixelated' : 'auto',
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

        {/* Connection overlay */}
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
                <button onClick={handleReconnect} className="btn btn-primary mt-4">
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry Connection</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="console-status-bar">
        <div className="console-status-bar-item">
          <span>VM: {vmId.slice(0, 8)}...</span>
        </div>
        <div className="console-status-bar-item">
          <span className="console-status-bar-resolution">
            {resolution.width}×{resolution.height}
          </span>
          {targetResolution && (
            <span className="ml-2 text-[var(--text-muted)] text-xs">
              → {targetResolution.width}×{targetResolution.height}
            </span>
          )}
          {canvasScale !== 1 && (
            <span className="console-status-bar-scale ml-2">{Math.round(canvasScale * 100)}%</span>
          )}
        </div>
      </div>

      {/* Debug Panel */}
      <DebugPanel isOpen={showDebugPanel} onClose={() => setShowDebugPanel(false)} />
    </div>
  );
}
