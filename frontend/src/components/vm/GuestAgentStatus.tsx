import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { cn, formatBytes, formatUptime } from '@/lib/utils';

interface GuestAgentInfo {
  connected: boolean;
  version: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
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

interface GuestAgentStatusProps {
  vmId: string;
  vmState: string;
  className?: string;
}

export function GuestAgentStatus({
  vmId,
  vmState,
  className,
}: GuestAgentStatusProps) {
  const [agentInfo, setAgentInfo] = useState<GuestAgentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAgentInfo = async () => {
    if (vmState !== 'RUNNING') {
      setAgentInfo(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Ping the agent first
      const response = await fetch(`/api/vms/${vmId}/agent/ping`);
      const data = await response.json();

      if (data.connected) {
        setAgentInfo({
          connected: true,
          version: data.version || 'Unknown',
          osName: data.osName || 'Unknown',
          osVersion: data.osVersion || '',
          kernelVersion: data.kernelVersion || '',
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
          hostname: '',
          ipAddresses: [],
          capabilities: [],
        });
        setError(data.error || 'Agent not connected');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agent status');
      setAgentInfo(null);
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

  if (vmState !== 'RUNNING') {
    return (
      <div className={cn('p-4 bg-bg-surface rounded-xl border border-border', className)}>
        <div className="flex items-center gap-2 text-text-muted">
          <XCircle className="w-4 h-4" />
          <span className="text-sm">Guest Agent unavailable (VM not running)</span>
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
          <h3 className="text-lg font-semibold text-text-primary">Guest Agent</h3>
          {agentInfo?.connected && (
            <span className="text-xs text-text-muted px-2 py-0.5 bg-bg-elevated rounded-full">
              v{agentInfo.version}
            </span>
          )}
        </div>
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

      {/* Content */}
      <div className="p-6">
        {isLoading && !agentInfo ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          </div>
        ) : !agentInfo?.connected ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <XCircle className="w-12 h-12 text-error/50 mb-4" />
            <p className="text-text-muted mb-2">Guest Agent not connected</p>
            <p className="text-xs text-text-muted">
              {error || 'Install the LimiQuantix Guest Agent inside the VM'}
            </p>
          </div>
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
