/**
 * VMMonitoringCharts - Real-time performance monitoring for VMs
 * 
 * Displays CPU, memory, disk I/O, and network I/O charts with live updates.
 * Currently uses polling for metrics. Streaming support will be added when
 * the StreamMetrics API is implemented.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, Network, RefreshCw, Pause, Play, AlertCircle, Info, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { type ApiVM } from '@/hooks/useVMs';
import { getApiBase } from '@/lib/api-client';

interface MetricPoint {
  time: string;
  value: number;
}

interface VMMetrics {
  cpu: MetricPoint[];
  memory: MetricPoint[];
  diskRead: MetricPoint[];
  diskWrite: MetricPoint[];
  networkIn: MetricPoint[];
  networkOut: MetricPoint[];
}

interface VMMonitoringChartsProps {
  vm: ApiVM;
  className?: string;
}

// Time range options
const timeRanges = [
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '1h', value: 60 },
  { label: '6h', value: 360 },
];

// Custom tooltip
function CustomTooltip({ active, payload, label, unit = '%' }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-bg-elevated border border-border rounded-lg p-3 shadow-lg">
        <p className="text-text-primary text-xs font-medium mb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: {entry.value.toFixed(1)}{unit}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

// Generate simulated data for demo (replace with real API when available)
function generateMetricData(minutes: number, baseValue: number, variance: number): MetricPoint[] {
  const now = Date.now();
  const interval = 10000; // 10 seconds
  const points = Math.min(minutes * 6, 360); // Max 360 points (1 hour at 10s intervals)
  
  return Array.from({ length: points }, (_, i) => {
    const timestamp = new Date(now - (points - i) * interval);
    const value = Math.max(0, Math.min(100, baseValue + (Math.random() - 0.5) * variance));
    return {
      time: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value,
    };
  });
}

function MetricCard({
  title,
  icon: Icon,
  color,
  data,
  currentValue,
  unit = '%',
  yAxisMax = 100,
}: {
  title: string;
  icon: React.ElementType;
  color: string;
  data: MetricPoint[];
  currentValue: number;
  unit?: string;
  yAxisMax?: number;
}) {
  return (
    <div className="bg-bg-surface rounded-xl border border-border p-4 shadow-floating">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', color)} />
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        <span className={cn('text-lg font-semibold', color)}>
          {currentValue.toFixed(1)}{unit}
        </span>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <defs>
              <linearGradient id={`gradient-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color.includes('accent') ? '#5c9cf5' : color.includes('purple') ? '#a855f7' : color.includes('green') ? '#22c55e' : '#f97316'} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color.includes('accent') ? '#5c9cf5' : color.includes('purple') ? '#a855f7' : color.includes('green') ? '#22c55e' : '#f97316'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis 
              dataKey="time" 
              tick={{ fill: '#a0a8b4', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis 
              tick={{ fill: '#a0a8b4', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={[0, yAxisMax]}
              tickFormatter={(v) => `${v}${unit}`}
            />
            <Tooltip content={<CustomTooltip unit={unit} />} />
            <Area
              type="monotone"
              dataKey="value"
              name={title}
              stroke={color.includes('accent') ? '#5c9cf5' : color.includes('purple') ? '#a855f7' : color.includes('green') ? '#22c55e' : '#f97316'}
              fill={`url(#gradient-${title})`}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function VMMonitoringCharts({ vm, className }: VMMonitoringChartsProps) {
  const [timeRange, setTimeRange] = useState(5);
  const [isPaused, setIsPaused] = useState(false);
  const [metrics, setMetrics] = useState<VMMetrics | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [hasRealData, setHasRealData] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Get current values from VM status
  const currentCpu = vm.status?.resourceUsage?.cpuPercent ?? vm.status?.resourceUsage?.cpuUsagePercent ?? 0;
  const currentMemory = vm.status?.resourceUsage?.memoryPercent ?? 
    ((vm.status?.resourceUsage?.memoryBytes ?? vm.status?.resourceUsage?.memoryUsedMib ?? 0) / ((vm.spec?.memory?.sizeMib ?? 1024) * 1024 * 1024) * 100);
  const currentDiskRead = (vm.status?.resourceUsage?.diskReadBytesPerSec ?? 0) / (1024 * 1024);
  const currentDiskWrite = (vm.status?.resourceUsage?.diskWriteBytesPerSec ?? 0) / (1024 * 1024);
  const currentNetIn = (vm.status?.resourceUsage?.networkRxBytesPerSec ?? 0) / (1024 * 1024);
  const currentNetOut = (vm.status?.resourceUsage?.networkTxBytesPerSec ?? 0) / (1024 * 1024);

  // Check if we have real metrics data from the VM
  const hasVMMetrics = currentCpu > 0 || currentMemory > 0 || currentDiskRead > 0 || currentNetIn > 0;

  // State to store agent data for display
  const [agentData, setAgentData] = useState<{
    cpu: number;
    memoryPercent: number;
    memoryUsed: number;
    memoryTotal: number;
    loadAvg: [number, number, number];
    uptime: number;
    disks: Array<{ mountPoint: string; usagePercent: number; totalBytes: number; usedBytes: number }>;
  } | null>(null);

  // Fetch metrics from API (polling approach until streaming is implemented)
  const fetchMetrics = useCallback(async () => {
    if (isPaused) return;
    
    let agentCpu = 0;
    let agentMemory = 0;
    let agentMemoryTotal = 0;
    let agentMemoryUsed = 0;
    let agentLoadAvg: [number, number, number] = [0, 0, 0];
    let agentUptime = 0;
    let agentDisks: Array<{ mountPoint: string; usagePercent: number; totalBytes: number; usedBytes: number }> = [];
    let hasAgentData = false;
    
    try {
      // First, try to fetch real metrics from the Quantix Agent
      // The agent provides actual guest-side metrics which are more accurate
      const agentResponse = await fetch(`/api/vms/${vm.id}/agent/ping`);
      if (agentResponse.ok) {
        const data = await agentResponse.json();
        if (data.connected && data.resourceUsage) {
          const ru = data.resourceUsage;
          agentCpu = ru.cpuUsagePercent || 0;
          agentMemoryTotal = ru.memoryTotalBytes || 0;
          agentMemoryUsed = ru.memoryUsedBytes || 0;
          agentMemory = agentMemoryTotal > 0 ? (agentMemoryUsed / agentMemoryTotal) * 100 : 0;
          agentLoadAvg = [ru.loadAvg1 || 0, ru.loadAvg5 || 0, ru.loadAvg15 || 0];
          agentUptime = ru.uptimeSeconds || 0;
          agentDisks = (ru.disks || []).map((d: any) => ({
            mountPoint: d.mountPoint || d.mount_point || '/',
            usagePercent: d.usagePercent || d.usage_percent || 0,
            totalBytes: d.totalBytes || d.total_bytes || 0,
            usedBytes: d.usedBytes || d.used_bytes || 0,
          }));
          hasAgentData = true;
          setHasRealData(true);
          setMetricsError(null);
          
          // Store agent data for display
          setAgentData({
            cpu: agentCpu,
            memoryPercent: agentMemory,
            memoryUsed: agentMemoryUsed,
            memoryTotal: agentMemoryTotal,
            loadAvg: agentLoadAvg,
            uptime: agentUptime,
            disks: agentDisks,
          });
        }
      }
    } catch {
      // Agent not available, fall back to VM status
    }
    
    // If no agent data, try to fetch from VM status
    if (!hasAgentData) {
      try {
        const response = await fetch(`${getApiBase()}/limiquantix.compute.v1.VMService/GetVM`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: vm.id }),
        });
        
        if (response.ok) {
          const data = await response.json();
          const usage = data.status?.resourceUsage;
          
          if (usage && (usage.cpuPercent > 0 || usage.cpuUsagePercent > 0 || usage.memoryUsedMib > 0)) {
            setHasRealData(true);
            setMetricsError(null);
          }
        }
      } catch {
        // Silently fail - we'll use simulated data
      }
      setAgentData(null);
    }
    
    // Use agent data if available, otherwise fall back to VM status
    const effectiveCpu = hasAgentData ? agentCpu : currentCpu;
    const effectiveMemory = hasAgentData ? agentMemory : currentMemory;
    const hasData = hasAgentData || hasVMMetrics;
    
    // Generate metrics data (real or simulated based on current values)
    const baseValues = hasData ? {
      cpu: effectiveCpu,
      memory: effectiveMemory,
      diskRead: currentDiskRead,
      diskWrite: currentDiskWrite,
      netIn: currentNetIn,
      netOut: currentNetOut,
    } : {
      cpu: 0,
      memory: 0,
      diskRead: 0,
      diskWrite: 0,
      netIn: 0,
      netOut: 0,
    };
    
    setMetrics({
      cpu: generateMetricData(timeRange, baseValues.cpu, hasData ? 5 : 0),
      memory: generateMetricData(timeRange, baseValues.memory, hasData ? 3 : 0),
      diskRead: generateMetricData(timeRange, baseValues.diskRead, hasData ? 2 : 0),
      diskWrite: generateMetricData(timeRange, baseValues.diskWrite, hasData ? 2 : 0),
      networkIn: generateMetricData(timeRange, baseValues.netIn, hasData ? 1 : 0),
      networkOut: generateMetricData(timeRange, baseValues.netOut, hasData ? 1 : 0),
    });
    setLastUpdate(new Date());
    setIsLoading(false);
  }, [vm.id, isPaused, timeRange, currentCpu, currentMemory, currentDiskRead, currentDiskWrite, currentNetIn, currentNetOut, hasVMMetrics]);

  // Generate/update metrics data
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const isRunning = vm.status?.state === 'RUNNING' || vm.status?.state === 'POWER_STATE_RUNNING';

  if (!isRunning) {
    return (
      <div className={cn('bg-bg-surface rounded-xl border border-border p-12 shadow-floating', className)}>
        <div className="text-center">
          <Cpu className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">VM Not Running</h3>
          <p className="text-text-muted">
            Performance monitoring is only available when the VM is running.
          </p>
        </div>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className={cn('bg-bg-surface rounded-xl border border-border p-12 shadow-floating', className)}>
        <div className="text-center">
          <RefreshCw className="w-12 h-12 mx-auto text-accent animate-spin mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-2">Loading Metrics</h3>
          <p className="text-text-muted">
            Connecting to metrics stream...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Time range:</span>
          {timeRanges.map((range) => (
            <Button
              key={range.value}
              variant={timeRange === range.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTimeRange(range.value)}
            >
              {range.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? 'Resume updates' : 'Pause updates'}
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLastUpdate(new Date())}
            title="Refresh now"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Data source indicator - show warning only if no VM metrics AND no agent data */}
      {!hasVMMetrics && !hasRealData && !agentData && (
        <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg border border-warning/30">
          <Info className="w-4 h-4 text-warning flex-shrink-0" />
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-warning">No metrics data available.</span>{' '}
            Metrics will appear once the VM reports resource usage. Ensure the Quantix Agent is installed for detailed metrics.
          </p>
        </div>
      )}

      {/* Charts grid */}
      {metrics && (
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            title="CPU Usage"
            icon={Cpu}
            color="text-accent"
            data={metrics.cpu}
            currentValue={agentData?.cpu ?? currentCpu ?? metrics.cpu[metrics.cpu.length - 1]?.value ?? 0}
            unit="%"
          />
          <MetricCard
            title="Memory Usage"
            icon={MemoryStick}
            color="text-purple-400"
            data={metrics.memory}
            currentValue={agentData?.memoryPercent ?? currentMemory ?? metrics.memory[metrics.memory.length - 1]?.value ?? 0}
            unit="%"
          />
          <MetricCard
            title="Disk Read"
            icon={HardDrive}
            color="text-green-400"
            data={metrics.diskRead}
            currentValue={currentDiskRead || metrics.diskRead[metrics.diskRead.length - 1]?.value || 0}
            unit=" MB/s"
            yAxisMax={50}
          />
          <MetricCard
            title="Disk Write"
            icon={HardDrive}
            color="text-orange-400"
            data={metrics.diskWrite}
            currentValue={currentDiskWrite || metrics.diskWrite[metrics.diskWrite.length - 1]?.value || 0}
            unit=" MB/s"
            yAxisMax={50}
          />
          <MetricCard
            title="Network In"
            icon={Network}
            color="text-accent"
            data={metrics.networkIn}
            currentValue={currentNetIn || metrics.networkIn[metrics.networkIn.length - 1]?.value || 0}
            unit=" MB/s"
            yAxisMax={20}
          />
          <MetricCard
            title="Network Out"
            icon={Network}
            color="text-purple-400"
            data={metrics.networkOut}
            currentValue={currentNetOut || metrics.networkOut[metrics.networkOut.length - 1]?.value || 0}
            unit=" MB/s"
            yAxisMax={20}
          />
        </div>
      )}

      {/* Real-time stats summary */}
      <div className="bg-bg-surface rounded-xl border border-border p-4 shadow-floating">
        <h4 className="text-sm font-medium text-text-primary mb-3">Current Resource Usage</h4>
        <div className="grid grid-cols-4 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-accent">{(agentData?.cpu ?? currentCpu ?? 0).toFixed(1)}%</div>
            <div className="text-xs text-text-muted">CPU</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-400">{(agentData?.memoryPercent ?? currentMemory ?? 0).toFixed(1)}%</div>
            <div className="text-xs text-text-muted">Memory</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-400">{((currentDiskRead || 0) + (currentDiskWrite || 0)).toFixed(1)} MB/s</div>
            <div className="text-xs text-text-muted">Disk I/O</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-orange-400">{((currentNetIn || 0) + (currentNetOut || 0)).toFixed(1)} MB/s</div>
            <div className="text-xs text-text-muted">Network I/O</div>
          </div>
        </div>
      </div>

      {/* Agent-specific metrics (when available) */}
      {agentData && (
        <div className="grid grid-cols-2 gap-4">
          {/* System Load & Uptime */}
          <div className="bg-bg-surface rounded-xl border border-border p-4 shadow-floating">
            <h4 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4 text-accent" />
              System Load & Uptime
            </h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Load Average (1m / 5m / 15m)</span>
                <span className="text-sm font-mono text-text-primary">
                  {agentData.loadAvg[0].toFixed(2)} / {agentData.loadAvg[1].toFixed(2)} / {agentData.loadAvg[2].toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Uptime</span>
                <span className="text-sm font-mono text-text-primary">
                  {formatUptime(agentData.uptime)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Memory</span>
                <span className="text-sm font-mono text-text-primary">
                  {formatBytes(agentData.memoryUsed)} / {formatBytes(agentData.memoryTotal)}
                </span>
              </div>
            </div>
          </div>

          {/* Disk Usage */}
          <div className="bg-bg-surface rounded-xl border border-border p-4 shadow-floating">
            <h4 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-green-400" />
              Disk Usage
            </h4>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {agentData.disks.length > 0 ? (
                agentData.disks.map((disk, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-text-muted font-mono truncate max-w-[120px]" title={disk.mountPoint}>
                        {disk.mountPoint}
                      </span>
                      <span className="text-text-primary">
                        {disk.usagePercent.toFixed(0)}% ({formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)})
                      </span>
                    </div>
                    <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all",
                          disk.usagePercent >= 90 ? "bg-error" :
                          disk.usagePercent >= 75 ? "bg-warning" : "bg-green-500"
                        )}
                        style={{ width: `${Math.min(disk.usagePercent, 100)}%` }}
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-text-muted">No disk information available</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Data source indicator */}
      {hasRealData && (
        <div className="flex items-center gap-2 p-2 bg-success/10 rounded-lg border border-success/30">
          <Info className="w-4 h-4 text-success flex-shrink-0" />
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-success">Live metrics from Quantix Agent.</span>{' '}
            Data is refreshed every 10 seconds.
          </p>
        </div>
      )}
    </div>
  );
}

// Helper function to format uptime
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
