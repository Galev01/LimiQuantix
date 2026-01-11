import { useState, useEffect } from 'react';
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
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { toast } from '@/lib/toast';
import { useDefaultConsoleType, useConsoleStore } from '@/stores/useConsoleStore';
import { useAppStore } from '@/stores/useAppStore';

interface ConsoleAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWebConsole: () => void;
  vmId: string;
  vmName: string;
}

/**
 * Helper to open console with default preference
 * Call this directly instead of showing modal for streamlined access
 */
export function openDefaultConsole(
  vmId: string,
  vmName: string,
  hostUrl: string,
  onOpenWebConsole: () => void,
): void {
  const defaultType = localStorage.getItem('quantix-host-console-store')
    ? JSON.parse(localStorage.getItem('quantix-host-console-store') || '{}').state?.defaultConsoleType
    : 'web';

  if (defaultType === 'qvmc') {
    const qvmcUrl = `qvmc://connect?url=${encodeURIComponent(hostUrl)}&vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}`;
    window.location.href = qvmcUrl;
    toast.info('Opening QvMC...');
  } else {
    onOpenWebConsole();
  }
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
  windows: `${GITHUB_RELEASES_URL}/download/qvmc_0.1.0_x64-setup.exe`,
  macos: `${GITHUB_RELEASES_URL}/download/qvmc_0.1.0_x64.dmg`,
  linux: `${GITHUB_RELEASES_URL}/download/qvmc_0.1.0_amd64.AppImage`,
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
}: ConsoleAccessModalProps) {
  const { hostUrl } = useAppStore();
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [copied, setCopied] = useState(false);
  const [isLaunchingqvmc, setIsLaunchingqvmc] = useState(false);
  const defaultConsoleType = useDefaultConsoleType();
  const setDefaultConsoleType = useConsoleStore((state) => state.setDefaultConsoleType);

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  // Set default console type
  const handleSetDefault = (type: 'web' | 'qvmc') => {
    setDefaultConsoleType(type);
    toast.success(`Default console set to ${type === 'web' ? 'Web Console' : 'QvMC'}`);
  };

  // Generate QvMC connection URL (custom protocol)
  const qvmcConnectionUrl = `qvmc://connect?url=${encodeURIComponent(hostUrl)}&vmId=${encodeURIComponent(vmId)}&vmName=${encodeURIComponent(vmName)}`;

  // Handle launching QvMC with automatic connection
  const handleLaunchQvMC = () => {
    setIsLaunchingqvmc(true);
    
    // Try to open the custom protocol URL
    window.location.href = qvmcConnectionUrl;
    
    // Reset state after a delay (in case it fails silently)
    setTimeout(() => {
      setIsLaunchingqvmc(false);
    }, 2000);
  };

  // Copy connection URL to clipboard
  const handleCopyConnectionUrl = async () => {
    try {
      await navigator.clipboard.writeText(qvmcConnectionUrl);
      setCopied(true);
      toast.success('Connection URL copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  // Handle download
  const handleDownload = () => {
    window.open(DOWNLOAD_URLS[platform], '_blank');
  };

  if (!isOpen) return null;

  const platformInfo = PLATFORM_INFO[platform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      {/* Backdrop with blur */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className={cn(
          'relative w-full max-w-lg mx-4 rounded-2xl overflow-hidden',
          'bg-bg-surface',
          'shadow-2xl border border-border'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div className="flex items-center gap-4">
            {/* Icon container */}
            <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center">
              <MonitorPlay className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Console Access</h2>
              <p className="text-xs text-text-muted">Choose how to connect</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* VM Info Card */}
          <div className="bg-bg-base rounded-xl p-4 border border-border">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Monitor className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text-muted">Connecting to:</p>
                <p className="text-base font-semibold text-text-primary truncate">{vmName}</p>
                <p className="text-xs text-text-muted font-mono mt-0.5 truncate">{vmId}</p>
              </div>
            </div>
          </div>

          {/* Console Options */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
              <span className="w-8 h-px bg-border" />
              Choose Console Type
              <span className="flex-1 h-px bg-border" />
            </h3>

            {/* Web Console Option */}
            <div className={cn(
              'relative w-full rounded-xl border-2 transition-all duration-200',
              'bg-bg-base border-border',
              defaultConsoleType === 'web' && 'border-accent/50 ring-1 ring-accent/20'
            )}>
              <button
                onClick={() => {
                  onOpenWebConsole();
                  onClose();
                }}
                className={cn(
                  'w-full flex items-center gap-4 p-5',
                  'hover:bg-bg-hover',
                  'text-left group',
                  'transition-all duration-200'
                )}
              >
                <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center group-hover:bg-accent/30 transition-colors border border-accent/20">
                  <MonitorPlay className="w-6 h-6 text-accent" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-text-primary group-hover:text-accent transition-colors">Web Console</h4>
                    {defaultConsoleType === 'web' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-accent/20 text-accent rounded font-medium">Default</span>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mt-0.5">
                    Opens in browser using noVNC. No installation required.
                  </p>
                </div>
                <div className="w-8 h-8 rounded-lg bg-bg-surface flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all">
                  <ExternalLink className="w-4 h-4" />
                </div>
              </button>
              {/* Set as default button */}
              {defaultConsoleType !== 'web' && (
                <button
                  onClick={() => handleSetDefault('web')}
                  className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-accent transition-colors"
                  title="Set as default"
                >
                  <Star className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* QvMC Native Option */}
            <div
              className={cn(
                'relative w-full p-5 rounded-xl border-2 transition-all',
                'bg-bg-base border-border',
                defaultConsoleType === 'qvmc' && 'border-purple-500/50 ring-1 ring-purple-500/20'
              )}
            >
              {/* Set as default button */}
              {defaultConsoleType !== 'qvmc' && (
                <button
                  onClick={() => handleSetDefault('qvmc')}
                  className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-purple-400 transition-colors"
                  title="Set as default"
                >
                  <Star className="w-4 h-4" />
                </button>
              )}
              
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center border border-purple-500/20">
                  <Laptop className="w-6 h-6 text-purple-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-text-primary">QvMC Native Client</h4>
                    {defaultConsoleType === 'qvmc' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded font-medium">Default</span>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mt-0.5">
                    Better performance, USB passthrough, lower latency.
                  </p>
                </div>
              </div>

              {/* QvMC Actions */}
              <div className="mt-5 pt-5 border-t border-border space-y-4">
                {/* Launch Button */}
                <Button
                  className="w-full h-11"
                  onClick={handleLaunchQvMC}
                  disabled={isLaunchingqvmc}
                >
                  {isLaunchingqvmc ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Launching QvMC...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4" />
                      Open in QvMC
                    </>
                  )}
                </Button>

                {/* Download Section */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-text-muted px-2">or download</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1 h-10"
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
                    className="h-10 w-10 !p-0"
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
                  className="block text-center text-xs text-text-muted hover:text-accent transition-colors py-1"
                >
                  View all platforms on GitHub →
                </a>
              </div>
            </div>
          </div>

          {/* Help text */}
          <div className="flex items-start gap-3 text-sm p-4 bg-accent/5 border border-accent/15 rounded-xl">
            <span className="text-lg">💡</span>
            <p className="text-text-muted text-xs leading-relaxed">
              <strong className="text-text-secondary">Tip:</strong> Click the <Star className="inline w-3 h-3" /> icon to set your default console.
              The quick console button on VM rows will use your default choice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
