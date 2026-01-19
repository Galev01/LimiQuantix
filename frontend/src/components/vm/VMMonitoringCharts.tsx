/**
 * VMMonitoringCharts - Real-time performance monitoring for VMs
 * 
 * Displays CPU, memory, disk I/O, and network I/O charts with live updates.
 */

import { useState, useEffect } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Cpu, MemoryStick, HardDrive, Network, RefreshCw, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { type ApiVM } from '@/hooks/useVMs';

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

  // Get current values from VM status
  const currentCpu = vm.status?.resourceUsage?.cpuPercent ?? 0;
  const currentMemory = vm.status?.resourceUsage?.memoryPercent ?? 
    ((vm.status?.resourceUsage?.memoryBytes ?? 0) / ((vm.spec?.memory?.sizeMib ?? 1024) * 1024 * 1024) * 100);
  const currentDiskRead = (vm.status?.resourceUsage?.diskReadBytesPerSec ?? 0) / (1024 * 1024);
  const currentDiskWrite = (vm.status?.resourceUsage?.diskWriteBytesPerSec ?? 0) / (1024 * 1024);
  const currentNetIn = (vm.status?.resourceUsage?.networkRxBytesPerSec ?? 0) / (1024 * 1024);
  const currentNetOut = (vm.status?.resourceUsage?.networkTxBytesPerSec ?? 0) / (1024 * 1024);

  // Generate/update metrics data
  useEffect(() => {
    if (isPaused) return;

    const updateMetrics = () => {
      // For now, generate demo data based on current values
      // In production, this would fetch from the StreamMetrics API
      setMetrics({
        cpu: generateMetricData(timeRange, currentCpu || 30, 20),
        memory: generateMetricData(timeRange, currentMemory || 45, 10),
        diskRead: generateMetricData(timeRange, currentDiskRead || 5, 10),
        diskWrite: generateMetricData(timeRange, currentDiskWrite || 3, 8),
        networkIn: generateMetricData(timeRange, currentNetIn || 2, 5),
        networkOut: generateMetricData(timeRange, currentNetOut || 1.5, 4),
      });
      setLastUpdate(new Date());
    };

    updateMetrics();
    const interval = setInterval(updateMetrics, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [timeRange, isPaused, currentCpu, currentMemory, currentDiskRead, currentDiskWrite, currentNetIn, currentNetOut]);

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
