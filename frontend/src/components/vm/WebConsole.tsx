import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Monitor,
  Maximize2,
  Minimize2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Copy,
  CheckCircle,
  ExternalLink,
  Terminal,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

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

type ConsoleState = 'loading' | 'ready' | 'error';

export function WebConsole({ vmId, vmName, isOpen, onClose }: WebConsoleProps) {
  const [state, setState] = useState<ConsoleState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [consoleInfo, setConsoleInfo] = useState<ConsoleInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState<'address' | 'password' | null>(null);

  // Fetch console info
  const fetchConsoleInfo = useCallback(async () => {
    setState('loading');
    setError(null);

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

      setConsoleInfo({
        type: consoleType,
        host: data.host || '127.0.0.1',
        port: data.port || 5900,
        password: data.password || undefined,
        websocketUrl: data.websocketUrl || undefined,
      });
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to console');
      setState('error');
    }
  }, [vmId]);

  // Fetch on open
  useEffect(() => {
    if (isOpen) {
      fetchConsoleInfo();
    }
  }, [isOpen, fetchConsoleInfo]);

  // Copy to clipboard
  const copyToClipboard = useCallback((text: string, type: 'address' | 'password') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Generate .vnc connection file content
  const generateVncFile = useCallback(() => {
    if (!consoleInfo) return;
    
    const vncFileContent = `[Connection]
Host=${consoleInfo.host}
Port=${consoleInfo.port}
${consoleInfo.password ? `Password=${consoleInfo.password}` : ''}

[Options]
UseLocalCursor=1
FullScreen=0
Preferred_Encoding=6
`;
    
    const blob = new Blob([vncFileContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${vmName.replace(/[^a-z0-9]/gi, '-')}.vnc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [consoleInfo, vmName]);

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

  const connectionAddress = consoleInfo ? `${consoleInfo.host}:${consoleInfo.port}` : '';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/80" onClick={onClose} />

        {/* Console Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={cn(
            'relative flex flex-col bg-bg-base border border-border shadow-2xl overflow-hidden',
            'w-[600px] max-w-[95vw] rounded-xl'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-bg-surface border-b border-border">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-accent" />
              <span className="font-medium text-text-primary">Console: {vmName}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="p-6">
            {state === 'loading' && (
              <div className="flex flex-col items-center gap-4 py-8 text-text-muted">
                <Loader2 className="w-10 h-10 animate-spin text-accent" />
                <span>Getting console information...</span>
              </div>
            )}

            {state === 'error' && (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <AlertTriangle className="w-12 h-12 text-error" />
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    Connection Failed
                  </h3>
                  <p className="text-text-muted text-sm">{error}</p>
                </div>
                <Button variant="secondary" onClick={fetchConsoleInfo}>
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </Button>
              </div>
            )}

            {state === 'ready' && consoleInfo && (
              <div className="space-y-6">
                {/* Connection Address - Main Focus */}
                <div className="text-center">
                  <p className="text-sm text-text-muted mb-3">
                    Connect to this address with your VNC client:
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <code className="text-2xl font-mono font-bold text-accent bg-bg-surface px-6 py-3 rounded-lg border border-border">
                      {connectionAddress}
                    </code>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(connectionAddress, 'address')}
                      className="shrink-0"
                    >
                      {copied === 'address' ? (
                        <CheckCircle className="w-5 h-5 text-success" />
                      ) : (
                        <Copy className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Password if present */}
                {consoleInfo.password && (
                  <div className="flex items-center justify-between bg-bg-surface rounded-lg p-4 border border-border">
                    <div>
                      <span className="text-sm text-text-muted">Password:</span>
                      <code className="ml-2 font-mono text-text-primary">
                        {consoleInfo.password}
                      </code>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(consoleInfo.password!, 'password')}
                    >
                      {copied === 'password' ? (
                        <CheckCircle className="w-4 h-4 text-success" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={() => copyToClipboard(connectionAddress, 'address')}
                  >
                    <Copy className="w-4 h-4" />
                    {copied === 'address' ? 'Copied!' : 'Copy Address'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={generateVncFile}
                    title="Download .vnc file for TightVNC/RealVNC"
                  >
                    <Download className="w-4 h-4" />
                    Download .vnc
                  </Button>
                </div>

                {/* Quick Connect Instructions */}
                <div className="bg-bg-surface rounded-lg p-4 border border-border">
                  <h4 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    Quick Connect Commands
                  </h4>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted w-16">Windows:</span>
                      <code className="text-text-secondary bg-bg-base px-2 py-1 rounded flex-1">
                        Open TightVNC Viewer → paste {connectionAddress}
                      </code>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted w-16">Linux:</span>
                      <code className="text-text-secondary bg-bg-base px-2 py-1 rounded flex-1">
                        vncviewer {connectionAddress}
                      </code>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-text-muted w-16">macOS:</span>
                      <code className="text-text-secondary bg-bg-base px-2 py-1 rounded flex-1">
                        open vnc://{connectionAddress}
                      </code>
                    </div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="text-xs text-text-muted p-3 bg-accent/5 border border-accent/20 rounded-lg">
                  <strong>💡 Tip:</strong> You can download TightVNC Viewer for free from{' '}
                  <a 
                    href="https://www.tightvnc.com/download.php" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    tightvnc.com
                  </a>
                  . On macOS, the built-in Screen Sharing app supports VNC.
                </div>

                {/* Future Enhancement Notice */}
                <div className="text-xs text-text-muted text-center pt-2 border-t border-border">
                  <span className="opacity-60">
                    🚀 Browser-based console (noVNC) coming in a future update
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 bg-bg-surface border-t border-border text-xs text-text-muted">
            <span>Press Escape to close</span>
            <span>VM: {vmId.slice(0, 8)}...</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
