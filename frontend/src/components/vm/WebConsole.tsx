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
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
      >
        {/* Backdrop with blur */}
        <motion.div 
          initial={{ backdropFilter: 'blur(0px)' }}
          animate={{ backdropFilter: 'blur(12px)' }}
          className="absolute inset-0 bg-black/75" 
          onClick={onClose} 
        />

        {/* Console Window - Enhanced with depth */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className={cn(
            'relative flex flex-col overflow-hidden',
            'w-[640px] max-w-[95vw] rounded-2xl',
            // Layered background
            'bg-gradient-to-b from-bg-elevated to-bg-surface',
            // Enhanced shadow for depth
            'shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.3),0_12px_40px_rgba(0,0,0,0.4),0_24px_80px_rgba(0,0,0,0.3)]'
          )}
        >
          {/* Top glow line */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Header - Enhanced */}
          <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-bg-elevated to-bg-surface border-b border-border relative">
            <div className="flex items-center gap-4">
              {/* Icon container with gradient */}
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-purple-600 flex items-center justify-center shadow-[0_2px_8px_rgba(139,92,246,0.3),inset_0_1px_1px_rgba(255,255,255,0.2)]">
                <Monitor className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-text-primary text-lg">Console: {vmName}</h2>
                <p className="text-xs text-text-muted">VNC Remote Connection</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="hover:bg-bg-hover">
              <X className="w-5 h-5" />
            </Button>
            {/* Accent underline */}
            <div className="absolute bottom-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
          </div>

          {/* Content */}
          <div className="p-6 bg-bg-surface">
            {state === 'loading' && (
              <div className="flex flex-col items-center gap-5 py-12 text-text-muted">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-accent" />
                  </div>
                  <div className="absolute inset-0 rounded-2xl bg-accent/20 animate-ping" />
                </div>
                <span className="text-sm">Getting console information...</span>
              </div>
            )}

            {state === 'error' && (
              <div className="flex flex-col items-center gap-5 py-10 text-center">
                <div className="w-16 h-16 rounded-2xl bg-error/10 flex items-center justify-center">
                  <AlertTriangle className="w-8 h-8 text-error" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-text-primary mb-2">
                    Connection Failed
                  </h3>
                  <p className="text-text-muted text-sm max-w-xs">{error}</p>
                </div>
                <Button variant="secondary" onClick={fetchConsoleInfo} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Try Again
                </Button>
              </div>
            )}

            {state === 'ready' && consoleInfo && (
              <div className="space-y-5">
                {/* Connection Address - Main Focus with enhanced styling */}
                <div className="text-center p-5 rounded-xl bg-bg-base border border-border shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]">
                  <p className="text-sm text-text-muted mb-4">
                    Connect to this address with your VNC client:
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <code className="text-2xl font-mono font-bold text-accent bg-bg-surface px-6 py-3 rounded-xl border border-accent/30 shadow-[0_0_20px_rgba(139,92,246,0.15)]">
                      {connectionAddress}
                    </code>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(connectionAddress, 'address')}
                      className="shrink-0 h-12 w-12 !p-0"
                    >
                      {copied === 'address' ? (
                        <CheckCircle className="w-5 h-5 text-success" />
                      ) : (
                        <Copy className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Password if present - Enhanced card */}
                {consoleInfo.password && (
                  <div className="flex items-center justify-between bg-bg-base rounded-xl p-4 border border-border shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center">
                        <span className="text-warning text-lg">🔑</span>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted block">Password</span>
                        <code className="font-mono text-text-primary font-medium">
                          {consoleInfo.password}
                        </code>
                      </div>
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

                {/* Action Buttons - Enhanced */}
                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    className="flex-1 h-11 shadow-[0_2px_8px_rgba(139,92,246,0.3)]"
                    onClick={() => copyToClipboard(connectionAddress, 'address')}
                  >
                    <Copy className="w-4 h-4" />
                    {copied === 'address' ? 'Copied!' : 'Copy Address'}
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-11"
                    onClick={generateVncFile}
                    title="Download .vnc file for TightVNC/RealVNC"
                  >
                    <Download className="w-4 h-4" />
                    Download .vnc
                  </Button>
                </div>

                {/* Quick Connect Instructions - Enhanced card */}
                <div className="bg-bg-base rounded-xl p-5 border border-border shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
                  <h4 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Terminal className="w-4 h-4 text-accent" />
                    </div>
                    Quick Connect Commands
                  </h4>
                  <div className="space-y-3 text-xs font-mono">
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-hover transition-colors">
                      <span className="text-text-muted w-16 flex-shrink-0">Windows:</span>
                      <code className="text-text-secondary bg-bg-surface px-3 py-1.5 rounded-lg flex-1 border border-border">
                        TightVNC Viewer → {connectionAddress}
                      </code>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-hover transition-colors">
                      <span className="text-text-muted w-16 flex-shrink-0">Linux:</span>
                      <code className="text-text-secondary bg-bg-surface px-3 py-1.5 rounded-lg flex-1 border border-border">
                        vncviewer {connectionAddress}
                      </code>
                    </div>
                    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-hover transition-colors">
                      <span className="text-text-muted w-16 flex-shrink-0">macOS:</span>
                      <code className="text-text-secondary bg-bg-surface px-3 py-1.5 rounded-lg flex-1 border border-border">
                        open vnc://{connectionAddress}
                      </code>
                    </div>
                  </div>
                </div>

                {/* Info Box - Enhanced */}
                <div className="flex items-start gap-3 text-sm text-text-muted p-4 bg-accent/5 border border-accent/20 rounded-xl">
                  <span className="text-lg">💡</span>
                  <div>
                    <strong className="text-text-secondary">Tip:</strong> Download TightVNC Viewer free from{' '}
                    <a 
                      href="https://www.tightvnc.com/download.php" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-accent hover:underline font-medium"
                    >
                      tightvnc.com
                    </a>
                    . On macOS, Screen Sharing supports VNC.
                  </div>
                </div>

                {/* Future Enhancement Notice - Subtle */}
                <div className="text-xs text-text-muted text-center pt-3 border-t border-border/50">
                  <span className="opacity-70 flex items-center justify-center gap-2">
                    <span>🚀</span>
                    Browser-based console (noVNC) coming in a future update
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer - Enhanced with recessed effect */}
          <div className="flex items-center justify-between px-6 py-3 bg-bg-base border-t border-border text-xs text-text-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
            <span className="flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-surface border border-border text-[10px]">ESC</kbd>
              <span>to close</span>
            </span>
            <span className="font-mono bg-bg-surface px-2 py-0.5 rounded border border-border">
              {vmId.slice(0, 8)}...
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
