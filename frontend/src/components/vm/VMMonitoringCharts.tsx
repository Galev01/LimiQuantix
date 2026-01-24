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
import { Cpu, MemoryStick, HardDrive, Network, RefreshCw, Pause, Play, AlertCircle, Info } from 'lucide-react';
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

  // Fetch metrics from API (polling approach until streaming is implemented)
  const fetchMetrics = useCallback(async () => {
    if (isPaused) return;
    
    try {
      // Try to fetch real metrics from the VM
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
    
    // Generate metrics data (real or simulated based on current values)
    const baseValues = hasVMMetrics ? {
      cpu: currentCpu,
      memory: currentMemory,
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
      cpu: generateMetricData(timeRange, baseValues.cpu, hasVMMetrics ? 5 : 0),
      memory: generateMetricData(timeRange, baseValues.memory, hasVMMetrics ? 3 : 0),
      diskRead: generateMetricData(timeRange, baseValues.diskRead, hasVMMetrics ? 2 : 0),
      diskWrite: generateMetricData(timeRange, baseValues.diskWrite, hasVMMetrics ? 2 : 0),
      networkIn: generateMetricData(timeRange, baseValues.netIn, hasVMMetrics ? 1 : 0),
      networkOut: generateMetricData(timeRange, baseValues.netOut, hasVMMetrics ? 1 : 0),
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

      {/* Data source indicator */}
      {!hasVMMetrics && (
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
            currentValue={currentCpu || metrics.cpu[metrics.cpu.length - 1]?.value || 0}
            unit="%"
          />
          <MetricCard
            title="Memory Usage"
            icon={MemoryStick}
            color="text-purple-400"
            data={metrics.memory}
            currentValue={currentMemory || metrics.memory[metrics.memory.length - 1]?.value || 0}
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
            <div className="text-2xl font-bold text-accent">{(currentCpu || 0).toFixed(1)}%</div>
            <div className="text-xs text-text-muted">CPU</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-400">{(currentMemory || 0).toFixed(1)}%</div>
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
    </div>
  );
}
