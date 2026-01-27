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
  /** Latest available agent version (from backend) */
  latestAgentVersion?: string;
}

// Fallback latest agent version if backend doesn't provide one
const FALLBACK_LATEST_AGENT_VERSION = '0.1.0';

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
  /** Node ID where the VM is running (for direct agent installation) */
  nodeId?: string;
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
  nodeId,
}: QuantixAgentStatusProps) {
  const [agentInfo, setAgentInfo] = useState<QuantixAgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showVersionInfo, setShowVersionInfo] = useState(false);
  const [qemuAgentAvailable, setQemuAgentAvailable] = useState<boolean | null>(null);
  const [showAgentLogs, setShowAgentLogs] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  // Check if update is available - use dynamic version from backend if available
  const latestVersion = agentInfo?.latestAgentVersion || FALLBACK_LATEST_AGENT_VERSION;
  const isUpdateAvailable = agentInfo?.connected && 
    agentInfo.version && 
    compareVersions(agentInfo.version, latestVersion) < 0;

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
          latestAgentVersion: data.latestAgentVersion,
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
          latestAgentVersion: data.latestAgentVersion,
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
        latestAgentVersion: undefined,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAgentInfo();
    checkQemuAgent();
    
    // Poll every 10 seconds if VM is running
    if (vmState === 'RUNNING') {
      const interval = setInterval(fetchAgentInfo, 10000);
      return () => clearInterval(interval);
    }
  }, [vmId, vmState]);

  // Check if QEMU Guest Agent is available (for auto-install)
  const checkQemuAgent = async () => {
    if (vmState !== 'RUNNING') {
      setQemuAgentAvailable(null);
      return;
    }

    try {
      const response = await fetch(`/api/vms/${vmId}/qemu-agent/ping`);
      if (response.ok) {
        const data = await response.json();
        setQemuAgentAvailable(data.available === true);
      } else {
        setQemuAgentAvailable(false);
      }
    } catch {
      setQemuAgentAvailable(false);
    }
  };

  // Auto-install Quantix Agent via QEMU Guest Agent
  const handleAutoInstall = async () => {
    if (!qemuAgentAvailable) {
      toast.error('QEMU Guest Agent is not available. Please install manually.');
      return;
    }

    setIsInstalling(true);
    
    try {
      toast.info('Starting Quantix Agent installation...', { duration: 3000 });
      
      // Call the backend to trigger agent installation via QEMU Guest Agent
      const response = await fetch(`/api/vms/${vmId}/agent/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: nodeId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `Installation failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success) {
        toast.success('Quantix Agent installation started! This may take a minute...', {
          duration: 5000,
        });
        
        // Poll for agent connection
        let attempts = 0;
        const pollInterval = setInterval(async () => {
          attempts++;
          await fetchAgentInfo();
          
          if (agentInfo?.connected || attempts >= 12) {
            clearInterval(pollInterval);
            if (agentInfo?.connected) {
              toast.success('Quantix Agent connected successfully!');
            }
          }
        }, 5000);
      } else {
        throw new Error(result.error || 'Installation failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Installation failed';
      toast.error(`Failed to install agent: ${message}`);
    } finally {
      setIsInstalling(false);
    }
  };

  // Handle agent update
  const handleUpdateAgent = async () => {
    if (!agentInfo?.connected) return;
    
    setIsUpdating(true);
    
    try {
      // Use the dynamic latest version from backend
      const targetVersion = agentInfo.latestAgentVersion || latestVersion;
      
      const platform = agentInfo.osName.toLowerCase().includes('windows') 
        ? 'windows' 
        : 'linux';
      const arch = agentInfo.architecture || 'x86_64';
      
      toast.info('Initiating agent update...', { duration: 2000 });
      
      // Call the update endpoint
      const downloadResponse = await fetch(`/api/vms/${vmId}/agent/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetVersion: targetVersion,
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

  // Fetch agent logs
  const fetchAgentLogs = async () => {
    if (!agentInfo?.connected) return;

    setIsLoadingLogs(true);
    try {
      const response = await fetch(`/api/vms/${vmId}/agent/logs?lines=100`);
      if (!response.ok) {
        throw new Error('Failed to fetch logs');
      }
      const data = await response.json();
      if (data.success && data.lines) {
        setAgentLogs(data.lines);
      } else {
        setAgentLogs([data.error || 'No logs available']);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch logs';
      setAgentLogs([`Error: ${message}`]);
      toast.error(`Failed to fetch agent logs: ${message}`);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Fetch logs when expanded
  useEffect(() => {
    if (showAgentLogs && agentInfo?.connected) {
      fetchAgentLogs();
    }
  }, [showAgentLogs, agentInfo?.connected]);

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
                          v{latestVersion} available
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
            qemuAgentAvailable={qemuAgentAvailable}
            onAutoInstall={handleAutoInstall}
            isInstalling={isInstalling}
            nodeId={nodeId}
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

            {/* Agent Logs Section */}
            <div className="border-t border-border pt-4">
              <button
                onClick={() => setShowAgentLogs(!showAgentLogs)}
                className="flex items-center gap-2 text-sm font-medium text-text-muted hover:text-text-primary transition-colors w-full"
              >
                <Terminal className="w-4 h-4" />
                <span>Agent Logs</span>
                <motion.span
                  animate={{ rotate: showAgentLogs ? 180 : 0 }}
                  className="ml-auto"
                >
                  ▼
                </motion.span>
              </button>

              <AnimatePresence>
                {showAgentLogs && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-text-muted">Last 100 lines</span>
                        <button
                          onClick={fetchAgentLogs}
                          disabled={isLoadingLogs}
                          className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 disabled:opacity-50"
                        >
                          {isLoadingLogs ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Refresh
                        </button>
                      </div>
                      <div className="bg-bg-base rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-xs">
                        {isLoadingLogs ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
                          </div>
                        ) : agentLogs.length > 0 ? (
                          agentLogs.map((line, idx) => (
                            <div
                              key={idx}
                              className="text-text-secondary whitespace-pre-wrap break-all hover:bg-bg-elevated px-1 rounded"
                            >
                              {line}
                            </div>
                          ))
                        ) : (
                          <div className="text-text-muted text-center py-4">
                            No logs available. Click Refresh to load.
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
 * Panel shown when the Quantix Agent is not connected to the VM.
 * 
 * Provides installation instructions with three methods:
 * 1. **ISO Mount (Recommended)** - Air-gapped, works everywhere, like VMware Tools
 * 2. **Cloud-Init (Automatic)** - For VMs created from cloud images
 * 3. **One-Click via QEMU GA** - Transfers binary via virtio-serial (requires QEMU GA)
 * 
 * The install script auto-detects the OS and architecture and installs both:
 * - QEMU Guest Agent (for hypervisor integration)
 * - Quantix KVM Agent (for advanced features)
 */
function AgentNotConnectedPanel({
  error,
  isWindows,
  guestOsFamily,
  onMountAgentISO,
  isMountingISO,
  qemuAgentAvailable,
  onAutoInstall,
  isInstalling,
  nodeId,
}: {
  error: string | null;
  isWindows: boolean;
  guestOsFamily?: string;
  onMountAgentISO?: () => void;
  isMountingISO?: boolean;
  qemuAgentAvailable?: boolean | null;
  onAutoInstall?: () => void;
  isInstalling?: boolean;
  nodeId?: string;
}) {
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [expandedMethod, setExpandedMethod] = useState<'iso' | 'cloud' | 'oneclick' | null>('iso');

  const isoInstallCommand = 'sudo /mnt/cdrom/linux/install.sh';
  
  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCommand(true);
    toast.success('Command copied to clipboard');
    setTimeout(() => setCopiedCommand(false), 2000);
  };

  const handleMountISO = async () => {
    if (onMountAgentISO) {
      onMountAgentISO();
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex flex-col items-center justify-center py-4 text-center">
        <XCircle className="w-10 h-10 text-error/50 mb-3" />
        <p className="text-text-primary font-medium mb-1">Quantix Agent Not Installed</p>
        <p className="text-xs text-text-muted max-w-md">
          {error || 'Choose an installation method below to enable enhanced VM integration.'}
        </p>
      </div>

      {/* Installation Methods */}
      <div className="space-y-3">
        
        {/* Method 1: ISO Mount (Recommended) */}
        <div className="border border-accent/30 rounded-xl overflow-hidden bg-accent/5">
          <button
            onClick={() => setExpandedMethod(expandedMethod === 'iso' ? null : 'iso')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent/10 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent/20 rounded-lg">
                <Disc className="w-5 h-5 text-accent" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">ISO Installation</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-accent/20 text-accent rounded-full font-medium">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-text-muted">
                  Works on any Linux • No network required
                </p>
              </div>
            </div>
            <motion.span
              animate={{ rotate: expandedMethod === 'iso' ? 180 : 0 }}
              className="text-text-muted"
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {expandedMethod === 'iso' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 border-t border-accent/20 space-y-4 bg-bg-surface">
                  {/* Step 1: Mount ISO */}
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                      1
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary mb-2">
                        Mount the Agent Tools ISO
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleMountISO}
                          disabled={isMountingISO}
                        >
                          {isMountingISO ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Mounting...
                            </>
                          ) : (
                            <>
                              <Disc className="w-4 h-4" />
                              Mount Agent ISO
                            </>
                          )}
                        </Button>
                        <a
                          href="/api/agent/iso"
                          download="quantix-kvm-agent-tools.iso"
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          Download ISO
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Step 2: Run Installer */}
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold flex-shrink-0">
                      2
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary mb-2">
                        Run the installer in the VM
                      </p>
                      <div className="relative">
                        <div className="bg-bg-base rounded-lg p-3 pr-12 font-mono text-xs text-text-secondary border border-border">
                          <code>{isoInstallCommand}</code>
                        </div>
                        <button
                          onClick={() => handleCopyCommand(isoInstallCommand)}
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
                      <p className="text-xs text-text-muted mt-2">
                        The installer auto-detects your OS and installs both QEMU Guest Agent
                        and Quantix KVM Agent.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Method 2: Cloud-Init (Automatic) */}
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => setExpandedMethod(expandedMethod === 'cloud' ? null : 'cloud')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-bg-elevated rounded-lg">
                <Server className="w-5 h-5 text-text-muted" />
              </div>
              <div className="text-left">
                <span className="text-sm font-medium text-text-primary">Cloud Image</span>
                <p className="text-xs text-text-muted">
                  Automatic install during first boot
                </p>
              </div>
            </div>
            <motion.span
              animate={{ rotate: expandedMethod === 'cloud' ? 180 : 0 }}
              className="text-text-muted"
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {expandedMethod === 'cloud' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 border-t border-border space-y-3 bg-bg-base">
                  <p className="text-xs text-text-muted">
                    When creating VMs from cloud images (Ubuntu, Debian, Rocky, etc.),
                    enable <strong>"Install Quantix Agent"</strong> in the VM creation wizard.
                  </p>
                  <div className="p-3 bg-bg-elevated rounded-lg">
                    <p className="text-xs text-text-secondary">
                      The agent installs automatically during first boot via cloud-init.
                      This is the best option for automated deployments and templates.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <Info className="w-3 h-3" />
                    <span>Works with Ubuntu, Debian, Rocky, CentOS, Fedora, and other cloud-init enabled images.</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Method 3: One-Click via QEMU GA */}
        <div className="border border-border rounded-xl overflow-hidden">
          <button
            onClick={() => setExpandedMethod(expandedMethod === 'oneclick' ? null : 'oneclick')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-hover transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-bg-elevated rounded-lg">
                <Download className="w-5 h-5 text-text-muted" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">One-Click Install</span>
                  {qemuAgentAvailable && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-success/20 text-success rounded-full font-medium">
                      Available
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted">
                  Via QEMU Guest Agent • Requires GA with file ops
                </p>
              </div>
            </div>
            <motion.span
              animate={{ rotate: expandedMethod === 'oneclick' ? 180 : 0 }}
              className="text-text-muted"
            >
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {expandedMethod === 'oneclick' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 border-t border-border space-y-3 bg-bg-base">
                  {qemuAgentAvailable ? (
                    <>
                      <p className="text-xs text-text-muted">
                        QEMU Guest Agent detected. Click below to automatically install the Quantix Agent
                        via virtio-serial file transfer.
                      </p>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={onAutoInstall}
                        disabled={isInstalling}
                      >
                        {isInstalling ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Installing...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4" />
                            Install Quantix Agent
                          </>
                        )}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                        <div className="flex items-start gap-2">
                          <Info className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                          <div className="space-y-2">
                            <p className="text-xs text-warning font-medium">QEMU Guest Agent Required</p>
                            <p className="text-xs text-text-muted">
                              Install and start the QEMU Guest Agent in the VM first:
                            </p>
                            <div className="font-mono text-xs text-text-secondary space-y-1 bg-bg-elevated p-2 rounded">
                              <div># Debian/Ubuntu:</div>
                              <div className="text-accent">apt install -y qemu-guest-agent</div>
                              <div className="mt-1"># RHEL/Rocky:</div>
                              <div className="text-accent">dnf install -y qemu-guest-agent</div>
                            </div>
                            <p className="text-[10px] text-text-muted">
                              <strong>Note:</strong> Some distros block file operations by default. Use ISO installation
                              if One-Click fails.
                            </p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Features List */}
      <div className="pt-4 border-t border-border">
        <p className="text-xs text-text-muted mb-3">After installation, you'll get:</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
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
          <div className="flex items-center gap-2 text-text-muted">
            <CheckCircle2 className="w-3 h-3 text-success" />
            <span>File browsing</span>
          </div>
          <div className="flex items-center gap-2 text-text-muted">
            <CheckCircle2 className="w-3 h-3 text-success" />
            <span>Snapshot quiescing</span>
          </div>
        </div>
      </div>

      {/* Detected OS hint */}
      {guestOsFamily && (
        <div className="flex items-center gap-2 text-xs text-text-muted pt-2 border-t border-border">
          <Terminal className="w-3 h-3" />
          <span>Detected OS: {guestOsFamily}</span>
        </div>
      )}
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
