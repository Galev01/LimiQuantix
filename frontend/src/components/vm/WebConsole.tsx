import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Monitor,
  Maximize2,
  Minimize2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Keyboard,
  Copy,
  CheckCircle,
  Settings,
  Power,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

// Dynamic import for noVNC RFB
// @ts-expect-error - noVNC doesn't have proper TypeScript types
import RFB from '@novnc/novnc/lib/rfb';

interface WebConsoleProps {
  vmId: string;
  vmName: string;
  isOpen: boolean;
  onClose: () => void;
}

interface ConsoleInfo {
  type: 'vnc' | 'spice';
  host: string;
  port: number;
  password?: string;
  websocketUrl?: string;
}

type ConsoleState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function WebConsole({ vmId, vmName, isOpen, onClose }: WebConsoleProps) {
  const [state, setState] = useState<ConsoleState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [consoleInfo, setConsoleInfo] = useState<ConsoleInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [scaleViewport, setScaleViewport] = useState(true);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<typeof RFB | null>(null);

  // Fetch console info
  const fetchConsoleInfo = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8080/limiquantix.compute.v1.VMService/GetConsole', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vmId }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to get console info');
      }

      const data = await response.json();
      let consoleType: 'vnc' | 'spice' = 'vnc';
      if (data.consoleType === 'CONSOLE_TYPE_SPICE' || data.consoleType === 2) {
        consoleType = 'spice';
      }

      return {
        type: consoleType,
        host: data.host || '127.0.0.1',
        port: data.port || 5900,
        password: data.password || undefined,
        websocketUrl: data.websocketUrl || undefined,
      } as ConsoleInfo;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to connect to console');
    }
  }, [vmId]);

  // Connect to VNC
  const connect = useCallback(async () => {
    if (!canvasContainerRef.current) return;

    setState('connecting');
    setError(null);

    try {
      const info = await fetchConsoleInfo();
      setConsoleInfo(info);

      // Determine WebSocket URL
      // If the backend provides a websocketUrl, use it
      // Otherwise, construct the URL for our WebSocket proxy
      let wsUrl = info.websocketUrl;
      if (!wsUrl) {
        // Use the control plane's WebSocket proxy endpoint
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//localhost:8080/api/console/${vmId}/ws`;
      }

      // Clean the container
      if (canvasContainerRef.current) {
        canvasContainerRef.current.innerHTML = '';
      }

      // Create RFB connection
      const rfb = new RFB(canvasContainerRef.current, wsUrl, {
        credentials: info.password ? { password: info.password } : undefined,
      });

      rfb.scaleViewport = scaleViewport;
      rfb.resizeSession = true;
      rfb.clipViewport = false;
      rfb.showDotCursor = true;

      // Event handlers
      rfb.addEventListener('connect', () => {
        console.log('VNC Connected');
        setState('connected');
      });

      rfb.addEventListener('disconnect', (e: { detail: { clean: boolean } }) => {
        console.log('VNC Disconnected', e.detail);
        if (!e.detail.clean) {
          setError('Connection closed unexpectedly');
          setState('error');
        } else {
          setState('disconnected');
        }
      });

      rfb.addEventListener('credentialsrequired', () => {
        console.log('VNC Credentials required');
        // If we have a password, send it
        if (info.password) {
          rfb.sendCredentials({ password: info.password });
        } else {
          setError('Password required but not provided');
          setState('error');
        }
      });

      rfb.addEventListener('securityfailure', (e: { detail: { status: number; reason: string } }) => {
        console.error('VNC Security failure', e.detail);
        setError(`Security failure: ${e.detail.reason || 'Unknown error'}`);
        setState('error');
      });

      rfbRef.current = rfb;
    } catch (err) {
      console.error('VNC Connection error', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setState('error');
    }
  }, [vmId, fetchConsoleInfo, scaleViewport]);

  // Disconnect
  const disconnect = useCallback(() => {
    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
    }
  }, []);

  // Connect when opened
  useEffect(() => {
    if (isOpen) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [isOpen, connect, disconnect]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  // Copy connection address
  const copyConnectionAddress = useCallback(() => {
    if (!consoleInfo) return;
    navigator.clipboard.writeText(`${consoleInfo.host}:${consoleInfo.port}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [consoleInfo]);

  // Send Ctrl+Alt+Del
  const sendCtrlAltDel = useCallback(() => {
    if (rfbRef.current) {
      rfbRef.current.sendCtrlAltDel();
    }
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/90" onClick={onClose} />

        {/* Console Window */}
        <motion.div
          ref={containerRef}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={cn(
            'relative flex flex-col bg-bg-base border border-border shadow-2xl overflow-hidden',
            isFullscreen
              ? 'w-screen h-screen rounded-none'
              : 'w-[1024px] h-[768px] max-w-[95vw] max-h-[90vh] rounded-xl'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-bg-surface border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-accent" />
              <span className="font-medium text-text-primary">Console: {vmName}</span>
              {state === 'connected' && (
                <span className="flex items-center gap-1.5 text-xs text-success px-2 py-0.5 bg-success/10 rounded-full">
                  <span className="w-1.5 h-1.5 bg-success rounded-full animate-pulse" />
                  Connected
                </span>
              )}
              {state === 'connecting' && (
                <span className="flex items-center gap-1.5 text-xs text-warning px-2 py-0.5 bg-warning/10 rounded-full">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Connecting...
                </span>
              )}
              {consoleInfo && (
                <span className="text-xs text-text-muted px-2 py-0.5 bg-bg-base rounded">
                  {consoleInfo.host}:{consoleInfo.port}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {state === 'connected' && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={sendCtrlAltDel}
                    title="Send Ctrl+Alt+Del"
                  >
                    <Keyboard className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyConnectionAddress}
                    title="Copy address"
                  >
                    {copied ? (
                      <CheckCircle className="w-4 h-4 text-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={toggleFullscreen} title="Toggle fullscreen">
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
              {(state === 'error' || state === 'disconnected') && (
                <Button variant="ghost" size="sm" onClick={connect} title="Reconnect">
                  <RefreshCw className="w-4 h-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose} title="Close">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Console Content */}
          <div className="flex-1 relative bg-black overflow-hidden">
            {/* noVNC Canvas Container */}
            <div
              ref={canvasContainerRef}
              className="absolute inset-0"
              style={{ touchAction: 'none' }}
            />

            {/* Overlay for non-connected states */}
            {state !== 'connected' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                {state === 'connecting' && (
                  <div className="flex flex-col items-center gap-4 text-text-muted">
                    <Loader2 className="w-12 h-12 animate-spin text-accent" />
                    <span className="text-lg">Connecting to VM console...</span>
                    <span className="text-sm text-text-muted">
                      Establishing WebSocket connection
                    </span>
                  </div>
                )}

                {state === 'error' && (
                  <div className="flex flex-col items-center gap-4 text-center max-w-md px-8">
                    <AlertTriangle className="w-16 h-16 text-error" />
                    <div>
                      <h3 className="text-xl font-semibold text-text-primary mb-2">
                        Connection Failed
                      </h3>
                      <p className="text-text-muted">{error}</p>
                    </div>

                    {/* Fallback options */}
                    {consoleInfo && (
                      <div className="w-full mt-4 p-4 bg-bg-surface rounded-lg border border-border">
                        <p className="text-sm text-text-muted mb-3">
                          Web console requires a WebSocket proxy. For now, use a VNC client:
                        </p>
                        <code className="block text-lg text-accent font-mono font-bold bg-bg-base px-4 py-2 rounded text-center">
                          {consoleInfo.host}:{consoleInfo.port}
                        </code>
                        <Button
                          variant="secondary"
                          className="w-full mt-3"
                          onClick={copyConnectionAddress}
                        >
                          {copied ? (
                            <>
                              <CheckCircle className="w-4 h-4 text-success" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              Copy Address
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    <Button variant="primary" onClick={connect} className="mt-2">
                      <RefreshCw className="w-4 h-4" />
                      Try Again
                    </Button>
                  </div>
                )}

                {state === 'disconnected' && (
                  <div className="flex flex-col items-center gap-4 text-center">
                    <Power className="w-16 h-16 text-text-muted" />
                    <div>
                      <h3 className="text-xl font-semibold text-text-primary mb-2">
                        Disconnected
                      </h3>
                      <p className="text-text-muted">The console session has ended</p>
                    </div>
                    <Button variant="primary" onClick={connect}>
                      <RefreshCw className="w-4 h-4" />
                      Reconnect
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-1.5 bg-bg-surface border-t border-border text-xs text-text-muted shrink-0">
            <div className="flex items-center gap-4">
              <span>Press Escape to close</span>
              {state === 'connected' && (
                <span className="flex items-center gap-1">
                  <Keyboard className="w-3 h-3" />
                  Ctrl+Alt+Del available
                </span>
              )}
            </div>
            <span>VM: {vmId.slice(0, 8)}...</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
