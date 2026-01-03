import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  MonitorPlay,
  Download,
  ExternalLink,
  Monitor,
  Terminal,
  Laptop,
  Check,
  Copy,
  Loader2,
  Command,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/lib/api-client';

interface ConsoleAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWebConsole: () => void;
  vmId: string;
  vmName: string;
  controlPlaneUrl?: string;
}

type Platform = 'windows' | 'macos' | 'linux' | 'unknown';

// Detect user's operating system
function detectPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }
  if (platform.includes('mac') || userAgent.includes('macintosh')) {
    return 'macos';
  }
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}

// GitHub releases URL - update this to your actual releases URL
const GITHUB_RELEASES_URL = 'https://github.com/Galev01/LimiQuantix/releases/latest';

// Download URLs for each platform
const DOWNLOAD_URLS: Record<Platform, string> = {
  windows: `${GITHUB_RELEASES_URL}/download/QVMRC_0.1.0_x64-setup.exe`,
  macos: `${GITHUB_RELEASES_URL}/download/QVMRC_0.1.0_x64.dmg`,
  linux: `${GITHUB_RELEASES_URL}/download/QVMRC_0.1.0_amd64.AppImage`,
  unknown: GITHUB_RELEASES_URL,
};

// Platform display info
const PLATFORM_INFO: Record<Platform, { name: string; icon: React.ReactNode; extension: string }> = {
  windows: { name: 'Windows', icon: <Monitor className="w-5 h-5" />, extension: '.exe' },
  macos: { name: 'macOS', icon: <Command className="w-5 h-5" />, extension: '.dmg' },
  linux: { name: 'Linux', icon: <Terminal className="w-5 h-5" />, extension: '.AppImage' },
  unknown: { name: 'Your Platform', icon: <Laptop className="w-5 h-5" />, extension: '' },
};

export function ConsoleAccessModal({
  isOpen,
  onClose,
  onOpenWebConsole,
  vmId,
  vmName,
  controlPlaneUrl = API_CONFIG.baseUrl,
}: ConsoleAccessModalProps) {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [copied, setCopied] = useState(false);
  const [isLaunchingQVMRC, setIsLaunchingQVMRC] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  // Generate QVMRC connection URL (custom protocol)
  const qvmrcConnectionUrl = `qvmrc://connect?url=${encodeURIComponent(controlPlaneUrl)}&vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}`;

  // Handle launching QVMRC with automatic connection
  const handleLaunchQVMRC = () => {
    setIsLaunchingQVMRC(true);
    
    // Try to open the custom protocol URL
    window.location.href = qvmrcConnectionUrl;
    
    // Reset state after a delay (in case it fails silently)
    setTimeout(() => {
      setIsLaunchingQVMRC(false);
    }, 2000);
  };

  // Copy connection URL to clipboard
  const handleCopyConnectionUrl = async () => {
    try {
      await navigator.clipboard.writeText(qvmrcConnectionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy to clipboard');
    }
  };

  // Handle download
  const handleDownload = () => {
    window.open(DOWNLOAD_URLS[platform], '_blank');
  };

  if (!isOpen) return null;

  const platformInfo = PLATFORM_INFO[platform];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                <MonitorPlay className="w-5 h-5 text-accent" />
                <h2 className="text-lg font-semibold text-text-primary">Console Access</h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
              >
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* VM Info */}
              <div className="bg-bg-base rounded-lg p-4 border border-border">
                <p className="text-sm text-text-muted">Connecting to:</p>
                <p className="text-lg font-medium text-text-primary">{vmName}</p>
                <p className="text-xs text-text-muted font-mono mt-1">{vmId}</p>
              </div>

              {/* Console Options */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-text-muted uppercase tracking-wider">
                  Choose Console Type
                </h3>

                {/* Web Console Option */}
                <button
                  onClick={() => {
                    onOpenWebConsole();
                    onClose();
                  }}
                  className={cn(
                    'w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-all',
                    'bg-bg-base hover:bg-bg-hover border-border hover:border-accent/50',
                    'text-left group'
                  )}
                >
                  <div className="p-3 rounded-lg bg-accent/10 text-accent group-hover:bg-accent/20 transition-colors">
                    <MonitorPlay className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium text-text-primary">Web Console</h4>
                    <p className="text-sm text-text-muted">
                      Opens in browser using noVNC. No installation required.
                    </p>
                  </div>
                  <ExternalLink className="w-5 h-5 text-text-muted group-hover:text-accent transition-colors" />
                </button>

                {/* QVMRC Native Option */}
                <div
                  className={cn(
                    'w-full p-4 rounded-xl border-2 transition-all',
                    'bg-bg-base border-border',
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400">
                      <Laptop className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-text-primary">QVMRC Native Client</h4>
                      <p className="text-sm text-text-muted">
                        Better performance, USB passthrough, lower latency.
                      </p>
                    </div>
                  </div>

                  {/* QVMRC Actions */}
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    {/* Launch Button (if QVMRC is installed) */}
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      onClick={handleLaunchQVMRC}
                      disabled={isLaunchingQVMRC}
                    >
                      {isLaunchingQVMRC ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Launching QVMRC...
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-4 h-4" />
                          Open in QVMRC
                        </>
                      )}
                    </Button>

                    {/* Download Section */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-text-muted">or download</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={handleDownload}
                      >
                        {platformInfo.icon}
                        <span>Download for {platformInfo.name}</span>
                        <Download className="w-4 h-4" />
                      </Button>

                      {/* Copy connection URL */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyConnectionUrl}
                        title="Copy connection URL"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-success" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                    </div>

                    {/* Other platforms link */}
                    <a
                      href={GITHUB_RELEASES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-center text-xs text-text-muted hover:text-accent transition-colors"
                    >
                      View all platforms on GitHub →
                    </a>
                  </div>
                </div>
              </div>

              {/* Help text */}
              <p className="text-xs text-text-muted text-center">
                QVMRC will automatically connect to this VM when launched.
                <br />
                First-time users: Download and install QVMRC, then click "Open in QVMRC".
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
