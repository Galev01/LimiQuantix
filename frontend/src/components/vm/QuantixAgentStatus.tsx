import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ArrowUpCircle,
  Download,
  Server,
  Info,
  Terminal,
  Disc,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { cn, formatBytes, formatUptime } from '@/lib/utils';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';

interface QuantixAgentInfo {
  connected: boolean;
  version: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  architecture: string;
  hostname: string;
  ipAddresses: string[];
  resourceUsage?: {
    cpuUsagePercent: number;
    memoryTotalBytes: number;
    memoryUsedBytes: number;
    memoryAvailableBytes: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    disks: Array<{
      mountPoint: string;
      device: string;
      filesystem: string;
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
      usagePercent: number;
    }>;
    processCount: number;
    uptimeSeconds: number;
  };
  capabilities: string[];
}

// Latest agent version (would come from backend in production)
const LATEST_AGENT_VERSION = '0.1.0';

interface QuantixAgentStatusProps {
  vmId: string;
  vmState: string;
  className?: string;
  /** Guest OS family from VM spec (e.g., 'rhel', 'debian', 'windows_server') */
  guestOsFamily?: string;
  /** Guest OS name from guest info (e.g., 'Linux', 'Windows') */
  guestOsName?: string;
  /** Callback to mount the Quantix Agent ISO */
  onMountAgentISO?: () => void;
  /** Whether ISO mount is in progress */
  isMountingISO?: boolean;
}

// Detect if OS is Windows based on family or name
function isWindowsOS(guestOsFamily?: string, guestOsName?: string): boolean {
  if (guestOsFamily) {
    return guestOsFamily.toLowerCase().includes('windows');
  }
  if (guestOsName) {
    return guestOsName.toLowerCase().includes('windows');
  }
  return false;
}

export function QuantixAgentStatus({
  vmId,
  vmState,
  className,
  guestOsFamily,
  guestOsName,
  onMountAgentISO,
  isMountingISO,
}: QuantixAgentStatusProps) {
  const [agentInfo, setAgentInfo] = useState<QuantixAgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVersionInfo, setShowVersionInfo] = useState(false);

  // Check if update is available
  const isUpdateAvailable = agentInfo?.connected && 
    agentInfo.version && 
    compareVersions(agentInfo.version, LATEST_AGENT_VERSION) < 0;

  const fetchAgentInfo = async () => {
    if (vmState !== 'RUNNING') {
      setAgentInfo(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Ping the agent
      const response = await fetch(`/api/vms/${vmId}/agent/ping`);
      
      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // API endpoint doesn't exist or returned HTML
        throw new Error('Agent API not available. Ensure the Quantix Agent is installed in the VM.');
      }
      
      if (!response.ok) {
        // Handle HTTP errors
        if (response.status === 404) {
          throw new Error('Agent API endpoint not found. Backend may not support agent operations.');
        }
        if (response.status === 503) {
          throw new Error('Agent not reachable. VM may not have the Quantix Agent installed.');
        }
        throw new Error(`Server error: ${response.status}`);
      }

      const data = await response.json();

      if (data.connected) {
        setAgentInfo({
          connected: true,
          version: data.version || 'Unknown',
          osName: data.osName || 'Unknown',
          osVersion: data.osVersion || '',
          kernelVersion: data.kernelVersion || '',
          architecture: data.architecture || '',
          hostname: data.hostname || '',
          ipAddresses: data.ipAddresses || [],
          resourceUsage: data.resourceUsage,
          capabilities: data.capabilities || [],
        });
      } else {
        setAgentInfo({
          connected: false,
          version: '',
          osName: '',
          osVersion: '',
          kernelVersion: '',
          architecture: '',
          hostname: '',
          ipAddresses: [],
          capabilities: [],
        });
        setError(data.error || 'Agent not connected');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch agent status';
      // Don't show JSON parsing errors directly - they're confusing
      if (message.includes('Unexpected token') || message.includes('JSON')) {
        setError('Agent API not available. Install the Quantix Agent in this VM.');
      } else {
        setError(message);
      }
      setAgentInfo({
        connected: false,
        version: '',
        osName: '',
        osVersion: '',
        kernelVersion: '',
        architecture: '',
        hostname: '',
        ipAddresses: [],
        capabilities: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAgentInfo();
    
    // Poll every 10 seconds if VM is running
    if (vmState === 'RUNNING') {
      const interval = setInterval(fetchAgentInfo, 10000);
      return () => clearInterval(interval);
    }
  }, [vmId, vmState]);

  // Handle agent update
  const handleUpdateAgent = async () => {
    if (!agentInfo?.connected) return;
    
    setIsUpdating(true);
    
    try {
      // The update process:
      // 1. Download new binary to temp location
      // 2. Execute upgrade script that replaces binary and restarts service
      
      const platform = agentInfo.osName.toLowerCase().includes('windows') 
        ? 'windows' 
        : 'linux';
      const arch = agentInfo.architecture || 'x86_64';
      
      toast.info('Downloading agent update...', { duration: 2000 });
      
      // Step 1: Download new binary
      const downloadResponse = await fetch(`/api/vms/${vmId}/agent/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetVersion: LATEST_AGENT_VERSION,
          platform,
          architecture: arch,
        }),
      });
      
      if (!downloadResponse.ok) {
        const error = await downloadResponse.json();
        throw new Error(error.message || 'Failed to initiate update');
      }
      
      const result = await downloadResponse.json();
      
      if (result.success) {
        toast.success('Agent update initiated! The agent will restart shortly.', {
          duration: 5000,
        });
        
        // Wait a bit then refresh agent info
        setTimeout(() => {
          fetchAgentInfo();
        }, 10000);
      } else {
        throw new Error(result.error || 'Update failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed';
      toast.error(`Failed to update agent: ${message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  if (vmState !== 'RUNNING') {
    return (
      <div className={cn('p-4 bg-bg-surface rounded-xl border border-border', className)}>
        <div className="flex items-center gap-2 text-text-muted">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">Quantix Agent unavailable (VM not running)</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('bg-bg-surface rounded-xl border border-border shadow-floating', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              isLoading
                ? 'bg-yellow-500 animate-pulse'
                : agentInfo?.connected
                ? 'bg-success'
                : 'bg-error',
            )}
          />
          <h3 className="text-lg font-semibold text-text-primary">Quantix Agent</h3>
          {agentInfo?.connected && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowVersionInfo(!showVersionInfo)}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full flex items-center gap-1 transition-colors',
                  isUpdateAvailable
                    ? 'bg-warning/20 text-warning hover:bg-warning/30'
                    : 'bg-bg-elevated text-text-muted hover:bg-bg-hover',
                )}
              >
                v{agentInfo.version}
                {isUpdateAvailable && <ArrowUpCircle className="w-3 h-3" />}
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isUpdateAvailable && (
            <button
              onClick={handleUpdateAgent}
              disabled={isUpdating}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition-colors disabled:opacity-50"
            >
              {isUpdating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              Update Agent
            </button>
          )}
          <button
            onClick={fetchAgentInfo}
            disabled={isLoading}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={cn('w-4 h-4 text-text-muted', isLoading && 'animate-spin')}
            />
          </button>
        </div>
      </div>

      {/* Version Info Panel */}
      <AnimatePresence>
        {showVersionInfo && agentInfo?.connected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-6 py-4 bg-bg-base border-b border-border">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-bg-elevated rounded-lg">
                  <Server className="w-5 h-5 text-accent" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-text-primary">
                        Quantix Agent
                      </p>
                      <p className="text-xs text-text-muted">
                        {agentInfo.osName} {agentInfo.architecture}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono text-text-primary">
                        v{agentInfo.version}
                      </p>
                      {isUpdateAvailable && (
                        <p className="text-xs text-warning">
                          v{LATEST_AGENT_VERSION} available
                        </p>
                      )}
                    </div>
                  </div>
                  
                  {isUpdateAvailable && (
                    <div className="p-3 bg-warning/10 rounded-lg border border-warning/20">
                      <div className="flex items-start gap-2">
                        <Info className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs text-warning font-medium">
                            Update Available
                          </p>
                          <p className="text-xs text-text-muted mt-1">
                            A new version of the Guest Agent is available. Click
                            "Update Agent" to download and install the latest
                            version. The agent will restart automatically.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="p-6">
        {isLoading && !agentInfo ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          </div>
        ) : !agentInfo?.connected ? (
          <AgentNotConnectedPanel
            error={error}
            isWindows={isWindowsOS(guestOsFamily, guestOsName)}
            guestOsFamily={guestOsFamily}
            onMountAgentISO={onMountAgentISO}
            isMountingISO={isMountingISO}
          />
        ) : (
          <div className="space-y-6">
            {/* System Info */}
            <div className="grid grid-cols-2 gap-4">
              <InfoItem label="Hostname" value={agentInfo.hostname} />
              <InfoItem label="OS" value={`${agentInfo.osName} ${agentInfo.osVersion}`} />
              <InfoItem label="Kernel" value={agentInfo.kernelVersion} />
              <InfoItem
                label="IP Addresses"
                value={agentInfo.ipAddresses.join(', ') || 'None'}
                mono
              />
            </div>

            {/* Resource Usage */}
            {agentInfo.resourceUsage && (
              <div className="space-y-4">
                <h4 className="text-sm font-medium text-text-muted">Resource Usage</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* CPU */}
                  <ResourceCard
                    icon={<Cpu className="w-4 h-4" />}
                    label="CPU"
                    value={`${agentInfo.resourceUsage.cpuUsagePercent.toFixed(1)}%`}
                    usage={agentInfo.resourceUsage.cpuUsagePercent}
                  />

                  {/* Memory */}
                  <ResourceCard
                    icon={<MemoryStick className="w-4 h-4" />}
                    label="Memory"
                    value={`${formatBytes(agentInfo.resourceUsage.memoryUsedBytes)} / ${formatBytes(agentInfo.resourceUsage.memoryTotalBytes)}`}
                    usage={
                      (agentInfo.resourceUsage.memoryUsedBytes /
                        agentInfo.resourceUsage.memoryTotalBytes) *
                      100
                    }
                  />
                </div>

                {/* Disk Usage */}
                {agentInfo.resourceUsage.disks.length > 0 && (
                  <div className="space-y-2">
                    <h5 className="text-xs font-medium text-text-muted flex items-center gap-2">
                      <HardDrive className="w-3 h-3" />
                      Disk Usage
                    </h5>
                    <div className="space-y-2">
                      {agentInfo.resourceUsage.disks.slice(0, 3).map((disk) => (
                        <div
                          key={disk.mountPoint}
                          className="flex items-center gap-3 text-sm"
                        >
                          <span className="font-mono text-text-muted w-24 truncate">
                            {disk.mountPoint}
                          </span>
                          <div className="flex-1 h-2 bg-bg-base rounded-full overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${disk.usagePercent}%` }}
                              className={cn(
                                'h-full',
                                disk.usagePercent >= 90
                                  ? 'bg-error'
                                  : disk.usagePercent >= 75
                                  ? 'bg-warning'
                                  : 'bg-accent',
                              )}
                            />
                          </div>
                          <span className="text-text-secondary w-16 text-right">
                            {disk.usagePercent.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Load & Uptime */}
                <div className="flex items-center justify-between text-sm text-text-muted">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>
                      Uptime: {formatUptime(agentInfo.resourceUsage.uptimeSeconds)}
                    </span>
                  </div>
                  <div>
                    Load: {agentInfo.resourceUsage.loadAvg1.toFixed(2)} /{' '}
                    {agentInfo.resourceUsage.loadAvg5.toFixed(2)} /{' '}
                    {agentInfo.resourceUsage.loadAvg15.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Capabilities */}
            {agentInfo.capabilities.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {agentInfo.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="text-xs px-2 py-1 bg-bg-elevated rounded-full text-text-muted"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-text-muted">{label}</span>
      <span
        className={cn('text-sm text-text-primary truncate', mono && 'font-mono')}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function ResourceCard({
  icon,
  label,
  value,
  usage,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  usage: number;
}) {
  return (
    <div className="p-4 bg-bg-base rounded-lg border border-border">
      <div className="flex items-center gap-2 text-text-muted mb-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-sm font-medium text-text-primary mb-2">{value}</div>
      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(usage, 100)}%` }}
          className={cn(
            'h-full',
            usage >= 90
              ? 'bg-error'
              : usage >= 75
              ? 'bg-warning'
              : 'bg-accent',
          )}
        />
      </div>
    </div>
  );
}

/**
 * Panel shown when agent is not connected - provides installation instructions
 */
function AgentNotConnectedPanel({
  error,
  isWindows,
  guestOsFamily,
  onMountAgentISO,
  isMountingISO,
}: {
  error: string | null;
  isWindows: boolean;
  guestOsFamily?: string;
  onMountAgentISO?: () => void;
  isMountingISO?: boolean;
}) {
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);

  const linuxInstallCommand = 'curl -fsSL https://update.quantix.io/agent/install.sh | sudo bash';
  
  const handleCopyCommand = () => {
    navigator.clipboard.writeText(linuxInstallCommand);
    setCopiedCommand(true);
    toast.success('Command copied to clipboard');
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="flex flex-col items-center justify-center py-4 text-center">
        <XCircle className="w-12 h-12 text-error/50 mb-4" />
        <p className="text-text-primary font-medium mb-1">Quantix Agent not connected</p>
        <p className="text-xs text-text-muted max-w-md">
          {error || 'Install the Quantix Agent inside the VM for enhanced integration features.'}
        </p>
      </div>

      {/* Installation Instructions */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          onClick={() => setShowInstructions(!showInstructions)}
          className="w-full flex items-center justify-between px-4 py-3 bg-bg-elevated hover:bg-bg-hover transition-colors"
        >
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-accent" />
            <span className="text-sm font-medium text-text-primary">Installation Instructions</span>
          </div>
          <span className="text-xs text-text-muted">
            {showInstructions ? 'Hide' : 'Show'}
          </span>
        </button>

        <AnimatePresence>
          {showInstructions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 space-y-4 bg-bg-base">
                {isWindows ? (
                  /* Windows Installation */
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                        1
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary mb-2">
                          Mount the Quantix Agent ISO
                        </p>
                        {onMountAgentISO ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={onMountAgentISO}
                            disabled={isMountingISO}
                          >
                            {isMountingISO ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Disc className="w-4 h-4" />
                            )}
                            Mount Agent ISO
                          </Button>
                        ) : (
                          <p className="text-xs text-text-muted">
                            Use the CD-ROM management in the Configuration tab to mount the agent ISO.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                        2
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary mb-2">
                          Run the installer from the mounted drive
                        </p>
                        <div className="bg-bg-elevated rounded-lg p-3 font-mono text-xs text-text-secondary">
                          D:\quantix-agent-setup.exe
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-bg-elevated text-text-muted flex items-center justify-center text-xs font-bold flex-shrink-0">
                        or
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary mb-2">
                          Download directly from the web
                        </p>
                        <a
                          href="https://update.quantix.io/agent/quantix-agent-setup.exe"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                        >
                          <ExternalLink className="w-3 h-3" />
                          https://update.quantix.io/agent/quantix-agent-setup.exe
                        </a>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Linux Installation */
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                        1
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary mb-2">
                          Run this command in the VM terminal
                        </p>
                        <div className="relative">
                          <div className="bg-bg-elevated rounded-lg p-3 pr-12 font-mono text-xs text-text-secondary overflow-x-auto">
                            <code>{linuxInstallCommand}</code>
                          </div>
                          <button
                            onClick={handleCopyCommand}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-bg-hover transition-colors"
                            title="Copy command"
                          >
                            {copiedCommand ? (
                              <CheckCircle2 className="w-4 h-4 text-success" />
                            ) : (
                              <Copy className="w-4 h-4 text-text-muted" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                        2
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary mb-1">
                          The agent will start automatically
                        </p>
                        <p className="text-xs text-text-muted">
                          The installer will download, install, and start the Quantix Agent service.
                          This page will update automatically once connected.
                        </p>
                      </div>
                    </div>

                    {guestOsFamily && (
                      <div className="flex items-center gap-2 text-xs text-text-muted pt-2 border-t border-border">
                        <Terminal className="w-3 h-3" />
                        <span>Detected OS: {guestOsFamily}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Features List */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2 text-text-muted">
          <CheckCircle2 className="w-3 h-3 text-success" />
          <span>Real resource metrics</span>
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          <CheckCircle2 className="w-3 h-3 text-success" />
          <span>IP address reporting</span>
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          <CheckCircle2 className="w-3 h-3 text-success" />
          <span>Remote script execution</span>
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          <CheckCircle2 className="w-3 h-3 text-success" />
          <span>Graceful shutdown</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Compare two semantic version strings.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareVersions(a: string, b: string): number {
  const aParts = a.replace(/^v/, '').split('.').map(Number);
  const bParts = b.replace(/^v/, '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }
  
  return 0;
}
