import { useState, useEffect } from 'react';
import { RefreshCw, Cpu, MemoryStick, HardDrive, Network, Activity, Server } from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useHostMetrics, useHostInfo } from '@/hooks/useHost';
import { formatBytes, formatPercent, cn } from '@/lib/utils';

interface MetricHistory {
  timestamp: number;
  cpu: number;
  memory: number;
  diskRead: number;
  diskWrite: number;
  netRx: number;
  netTx: number;
}

const MAX_HISTORY_POINTS = 60; // 5 minutes of data at 5-second intervals

export function Performance() {
  const { data: metrics, isLoading, refetch, isFetching } = useHostMetrics();
  const { data: hostInfo } = useHostInfo();
  const [history, setHistory] = useState<MetricHistory[]>([]);

  // Collect metrics history
  useEffect(() => {
    if (metrics) {
      setHistory(prev => {
        const newPoint: MetricHistory = {
          timestamp: Date.now(),
          cpu: metrics.cpu_usage_percent,
          memory: metrics.memory_usage_percent,
          diskRead: metrics.disk_read_bytes_per_sec,
          diskWrite: metrics.disk_write_bytes_per_sec,
          netRx: metrics.network_rx_bytes_per_sec,
          netTx: metrics.network_tx_bytes_per_sec,
        };
        const updated = [...prev, newPoint];
        // Keep only the last MAX_HISTORY_POINTS
        return updated.slice(-MAX_HISTORY_POINTS);
      });
    }
  }, [metrics]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Performance Monitor"
        subtitle={hostInfo ? `${hostInfo.hostname} - ${hostInfo.cpu_model}` : 'Loading...'}
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="text-center text-text-muted py-12">Loading metrics...</div>
        ) : !metrics ? (
          <div className="text-center text-text-muted py-12">Failed to load metrics</div>
        ) : (
          <div className="space-y-6">
            {/* Overview Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                icon={<Cpu className="w-5 h-5" />}
                title="CPU Usage"
                value={formatPercent(metrics.cpu_usage_percent)}
                subtitle={`Load: ${metrics.load_average_1min.toFixed(2)} / ${metrics.load_average_5min.toFixed(2)} / ${metrics.load_average_15min.toFixed(2)}`}
                color="accent"
                percent={metrics.cpu_usage_percent}
              />
              <MetricCard
                icon={<MemoryStick className="w-5 h-5" />}
                title="Memory"
                value={formatBytes(metrics.memory_used_bytes)}
                subtitle={`of ${formatBytes(metrics.memory_total_bytes)} (${formatPercent(metrics.memory_usage_percent)})`}
                color="info"
                percent={metrics.memory_usage_percent}
              />
              <MetricCard
                icon={<Server className="w-5 h-5" />}
                title="Virtual Machines"
                value={`${metrics.vm_running_count} / ${metrics.vm_count}`}
                subtitle="Running / Total"
                color="success"
                percent={metrics.vm_count > 0 ? (metrics.vm_running_count / metrics.vm_count) * 100 : 0}
              />
              <MetricCard
                icon={<Activity className="w-5 h-5" />}
                title="System Status"
                value="Healthy"
                subtitle={`Updated: ${new Date(metrics.timestamp).toLocaleTimeString()}`}
                color="success"
                percent={100}
              />
            </div>

            {/* Detailed Metrics */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* CPU Chart */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-accent" />
                    CPU Usage
                  </h3>
                  <Badge variant="default">{formatPercent(metrics.cpu_usage_percent)}</Badge>
                </div>
                <MiniChart
                  data={history.map(h => h.cpu)}
                  color="var(--accent)"
                  height={120}
                />
                <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-text-muted">1 min avg</div>
                    <div className="text-text-primary font-medium">{metrics.load_average_1min.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-text-muted">5 min avg</div>
                    <div className="text-text-primary font-medium">{metrics.load_average_5min.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-text-muted">15 min avg</div>
                    <div className="text-text-primary font-medium">{metrics.load_average_15min.toFixed(2)}</div>
                  </div>
                </div>
              </Card>

              {/* Memory Chart */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                    <MemoryStick className="w-5 h-5 text-info" />
                    Memory Usage
                  </h3>
                  <Badge variant="info">{formatPercent(metrics.memory_usage_percent)}</Badge>
                </div>
                <MiniChart
                  data={history.map(h => h.memory)}
                  color="var(--info)"
                  height={120}
                />
                <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-text-muted">Used</div>
                    <div className="text-text-primary font-medium">{formatBytes(metrics.memory_used_bytes)}</div>
                  </div>
                  <div>
                    <div className="text-text-muted">Available</div>
                    <div className="text-text-primary font-medium">{formatBytes(metrics.memory_total_bytes - metrics.memory_used_bytes)}</div>
                  </div>
                  <div>
                    <div className="text-text-muted">Total</div>
                    <div className="text-text-primary font-medium">{formatBytes(metrics.memory_total_bytes)}</div>
                  </div>
                </div>
              </Card>

              {/* Disk I/O */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                    <HardDrive className="w-5 h-5 text-warning" />
                    Disk I/O
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-bg-base rounded-lg">
                    <div className="text-text-muted text-sm mb-1">Read</div>
                    <div className="text-2xl font-bold text-text-primary">
                      {formatBytes(metrics.disk_read_bytes_per_sec)}/s
                    </div>
                  </div>
                  <div className="p-4 bg-bg-base rounded-lg">
                    <div className="text-text-muted text-sm mb-1">Write</div>
                    <div className="text-2xl font-bold text-text-primary">
                      {formatBytes(metrics.disk_write_bytes_per_sec)}/s
                    </div>
                  </div>
                </div>
              </Card>

              {/* Network I/O */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                    <Network className="w-5 h-5 text-success" />
                    Network I/O
                  </h3>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-bg-base rounded-lg">
                    <div className="text-text-muted text-sm mb-1">Receive</div>
                    <div className="text-2xl font-bold text-text-primary">
                      {formatBytes(metrics.network_rx_bytes_per_sec)}/s
                    </div>
                  </div>
                  <div className="p-4 bg-bg-base rounded-lg">
                    <div className="text-text-muted text-sm mb-1">Transmit</div>
                    <div className="text-2xl font-bold text-text-primary">
                      {formatBytes(metrics.network_tx_bytes_per_sec)}/s
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle: string;
  color: 'accent' | 'info' | 'success' | 'warning' | 'error';
  percent: number;
}

function MetricCard({ icon, title, value, subtitle, color, percent }: MetricCardProps) {
  const colorClasses = {
    accent: 'text-accent bg-accent/10',
    info: 'text-info bg-info/10',
    success: 'text-success bg-success/10',
    warning: 'text-warning bg-warning/10',
    error: 'text-error bg-error/10',
  };

  const barColors = {
    accent: 'bg-accent',
    info: 'bg-info',
    success: 'bg-success',
    warning: 'bg-warning',
    error: 'bg-error',
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-text-primary mb-1">{value}</div>
      <div className="text-sm text-text-muted mb-3">{subtitle}</div>
      <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColors[color])}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="text-xs text-text-muted mt-1">{title}</div>
    </Card>
  );
}

interface MiniChartProps {
  data: number[];
  color: string;
  height: number;
}

function MiniChart({ data, color, height }: MiniChartProps) {
  if (data.length < 2) {
    return (
      <div
        className="flex items-center justify-center bg-bg-base rounded-lg text-text-muted text-sm"
        style={{ height }}
      >
        Collecting data...
      </div>
    );
  }

  const max = Math.max(...data, 100);
  const min = 0;
  const range = max - min || 1;
  
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 100;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `0,100 ${points} 100,100`;

  return (
    <div className="relative bg-bg-base rounded-lg overflow-hidden" style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
      >
        {/* Area fill */}
        <polygon
          points={areaPoints}
          fill={color}
          fillOpacity="0.1"
        />
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* Grid lines */}
      <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="border-t border-border/20" />
        ))}
      </div>
    </div>
  );
}
