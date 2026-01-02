import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Monitor,
  Maximize2,
  Minimize2,
  RefreshCw,
  Power,
  Keyboard,
  Copy,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface VNCConsoleProps {
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

export function VNCConsole({ vmId, vmName, isOpen, onClose }: VNCConsoleProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [consoleInfo, setConsoleInfo] = useState<ConsoleInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch console info from the backend
  useEffect(() => {
    if (!isOpen) return;

    const fetchConsoleInfo = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('http://localhost:8080/limiquantix.compute.v1.VMService/GetConsole', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ id: vmId }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Failed to get console info');
        }

        const data = await response.json();
        setConsoleInfo({
          type: data.consoleType || 'vnc',
          host: data.host || '127.0.0.1',
          port: data.port || 5900,
          password: data.password || undefined,
          websocketUrl: data.websocketPath || undefined,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to console');
      } finally {
        setIsLoading(false);
      }
    };

    fetchConsoleInfo();
  }, [isOpen, vmId]);

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

  // Copy VNC URL to clipboard
  const copyVncUrl = useCallback(() => {
    if (!consoleInfo) return;

    const vncUrl = `vnc://${consoleInfo.host}:${consoleInfo.port}`;
    navigator.clipboard.writeText(vncUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [consoleInfo]);

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
        <div className="absolute inset-0 bg-black/80" />

        {/* Console Window */}
        <motion.div
          ref={containerRef}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={cn(
            'relative flex flex-col bg-bg-base rounded-xl border border-border shadow-2xl overflow-hidden',
            isFullscreen ? 'w-screen h-screen rounded-none' : 'w-[900px] h-[700px] max-w-[95vw] max-h-[90vh]'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-bg-surface border-b border-border">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-accent" />
              <span className="font-medium text-text-primary">Console: {vmName}</span>
              {consoleInfo && (
                <span className="text-xs text-text-muted px-2 py-0.5 bg-bg-base rounded">
                  {consoleInfo.type.toUpperCase()} @ {consoleInfo.host}:{consoleInfo.port}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {consoleInfo && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyVncUrl}
                    className="relative"
                  >
                    {copied ? (
                      <CheckCircle className="w-4 h-4 text-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={toggleFullscreen}>
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" onClick={onClose}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Console Content */}
          <div className="flex-1 flex items-center justify-center bg-black relative">
            {isLoading ? (
              <div className="flex flex-col items-center gap-4 text-text-muted">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span>Connecting to console...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-4 text-center max-w-md px-6">
                <AlertTriangle className="w-12 h-12 text-warning" />
                <div>
                  <h3 className="text-lg font-medium text-text-primary mb-2">Connection Failed</h3>
                  <p className="text-text-muted text-sm">{error}</p>
                </div>
                <Button variant="secondary" onClick={() => window.location.reload()}>
                  <RefreshCw className="w-4 h-4" />
                  Retry
                </Button>
              </div>
            ) : consoleInfo ? (
              <div className="flex flex-col items-center gap-6 text-center max-w-lg px-8">
                <Monitor className="w-16 h-16 text-accent" />
                <div>
                  <h3 className="text-xl font-semibold text-text-primary mb-2">
                    VNC Console Available
                  </h3>
                  <p className="text-text-muted mb-4">
                    Connect to the VM console using a VNC client
                  </p>
                </div>

                {/* Connection Details */}
                <div className="w-full bg-bg-surface rounded-lg border border-border p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted text-sm">Host</span>
                    <code className="font-mono text-text-primary bg-bg-base px-2 py-1 rounded">
                      {consoleInfo.host}
                    </code>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted text-sm">Port</span>
                    <code className="font-mono text-text-primary bg-bg-base px-2 py-1 rounded">
                      {consoleInfo.port}
                    </code>
                  </div>
                  {consoleInfo.password && (
                    <div className="flex justify-between items-center">
                      <span className="text-text-muted text-sm">Password</span>
                      <code className="font-mono text-text-primary bg-bg-base px-2 py-1 rounded">
                        {consoleInfo.password}
                      </code>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted text-sm">VNC URL</span>
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-text-primary bg-bg-base px-2 py-1 rounded text-sm">
                        vnc://{consoleInfo.host}:{consoleInfo.port}
                      </code>
                      <Button variant="ghost" size="sm" onClick={copyVncUrl}>
                        {copied ? (
                          <CheckCircle className="w-4 h-4 text-success" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Instructions */}
                <div className="text-left w-full">
                  <h4 className="text-sm font-medium text-text-primary mb-2">Quick Connect</h4>
                  <div className="text-xs text-text-muted space-y-2">
                    <p className="flex items-start gap-2">
                      <span className="bg-accent/20 text-accent px-1.5 py-0.5 rounded font-medium">Linux</span>
                      <code className="font-mono">virt-viewer --connect qemu:///system {vmId}</code>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="bg-success/20 text-success px-1.5 py-0.5 rounded font-medium">VNC</span>
                      <code className="font-mono">vncviewer {consoleInfo.host}:{consoleInfo.port}</code>
                    </p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    variant="secondary"
                    onClick={copyVncUrl}
                  >
                    <Copy className="w-4 h-4" />
                    Copy VNC URL
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => {
                      // Open external VNC client (if supported by browser)
                      window.open(`vnc://${consoleInfo.host}:${consoleInfo.port}`, '_blank');
                    }}
                  >
                    <ExternalLink className="w-4 h-4" />
                    Open in VNC Client
                  </Button>
                </div>

                {/* Future noVNC */}
                <div className="text-xs text-text-muted mt-4 p-3 bg-warning/10 border border-warning/20 rounded-lg">
                  <Keyboard className="w-4 h-4 inline mr-2" />
                  <strong>Tip:</strong> Web-based noVNC console coming soon! For now, use a VNC client.
                </div>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 bg-bg-surface border-t border-border text-xs text-text-muted">
            <span>Press Escape to close</span>
            <span>VM ID: {vmId}</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
