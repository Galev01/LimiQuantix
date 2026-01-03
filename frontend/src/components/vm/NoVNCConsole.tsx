import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build noVNC URL
  const novncUrl = `/novnc/limiquantix.html?vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

  // Listen for messages from the iframe (e.g., close button click)
  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === 'closeConsole') {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

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

        {/* Console Window - noVNC has its own toolbar with all controls */}
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
          {/* noVNC iframe - contains its own toolbar with close, fullscreen, etc. */}
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
