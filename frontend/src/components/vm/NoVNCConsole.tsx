import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
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

        {/* Console Window - No duplicate header, noVNC has its own toolbar */}
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
          {/* Close button overlay - top right corner */}
          <button
            onClick={onClose}
            className="absolute top-2 right-2 z-50 w-8 h-8 flex items-center justify-center rounded-lg bg-black/50 hover:bg-black/70 text-white/70 hover:text-white transition-colors backdrop-blur-sm"
            title="Close console (Escape)"
          >
            <X className="w-4 h-4" />
          </button>

          {/* noVNC iframe - contains its own toolbar */}
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
