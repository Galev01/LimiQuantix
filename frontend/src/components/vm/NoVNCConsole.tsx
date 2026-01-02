import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Monitor,
  Maximize2,
  Minimize2,
  Keyboard,
  RefreshCw,
  ExternalLink,
  Copy,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface NoVNCConsoleProps {
  vmId: string;
  vmName: string;
  isOpen: boolean;
  onClose: () => void;
  token?: string;
}

export function NoVNCConsole({ vmId, vmName, isOpen, onClose, token }: NoVNCConsoleProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build noVNC URL
  const novncUrl = `/novnc/limiquantix.html?vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  // Open in new tab
  const openInNewTab = useCallback(() => {
    window.open(novncUrl, '_blank', 'width=1024,height=768,menubar=no,toolbar=no');
  }, [novncUrl]);

  // Copy console URL
  const copyConsoleUrl = useCallback(() => {
    const fullUrl = `${window.location.origin}${novncUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [novncUrl]);

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

  // Send Ctrl+Alt+Del to iframe
  const sendCtrlAltDel = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'ctrlAltDel' }, '*');
    }
  }, []);

  // Reconnect
  const reconnect = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'reconnect' }, '*');
    }
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle escape key (only when not in fullscreen)
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
        <div 
          className="absolute inset-0 bg-black/90" 
          onClick={onClose} 
        />

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
              : 'w-[1280px] h-[800px] max-w-[95vw] max-h-[90vh] rounded-xl'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-bg-surface border-b border-border shrink-0">
            <div className="flex items-center gap-3">
              <Monitor className="w-5 h-5 text-accent" />
              <span className="font-medium text-text-primary">Console: {vmName}</span>
            </div>

            <div className="flex items-center gap-1">
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
                onClick={reconnect} 
                title="Reconnect"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={copyConsoleUrl} 
                title="Copy console URL"
              >
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={openInNewTab} 
                title="Open in new tab"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={toggleFullscreen} 
                title="Toggle fullscreen"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onClose} 
                title="Close"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* noVNC iframe */}
          <iframe
            ref={iframeRef}
            src={novncUrl}
            className="flex-1 w-full border-0 bg-black"
            allow="clipboard-read; clipboard-write; fullscreen"
            title={`Console: ${vmName}`}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
