import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Clock,
  Zap,
  Thermometer,
  Server,
} from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

// Generate mock time-series data
function generateTimeSeriesData(hours: number, baseValue: number, variance: number) {
  const now = new Date();
  const data = [];
  for (let i = hours; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    const value = baseValue + (Math.random() - 0.5) * variance * 2;
    data.push({
      time: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      value: Math.max(0, Math.min(100, value)),
    });
  }
  return data;
}

// Generate cluster metrics
function generateClusterMetrics() {
  return {
    cpu: generateTimeSeriesData(24, 55, 15),
    memory: generateTimeSeriesData(24, 62, 10),
    storage: generateTimeSeriesData(24, 58, 5),
    network: generateTimeSeriesData(24, 35, 20),
  };
}

// Generate per-host metrics
function generateHostMetrics() {
  return [
    { name: 'node-prod-01', cpu: 72, memory: 68, vms: 12, status: 'healthy' },
    { name: 'node-prod-02', cpu: 58, memory: 71, vms: 14, status: 'healthy' },
    { name: 'node-prod-03', cpu: 85, memory: 82, vms: 16, status: 'warning' },
    { name: 'node-prod-04', cpu: 45, memory: 52, vms: 8, status: 'healthy' },
    { name: 'node-dev-01', cpu: 32, memory: 41, vms: 6, status: 'healthy' },
    { name: 'node-dev-02', cpu: 28, memory: 35, vms: 4, status: 'healthy' },
    { name: 'node-gpu-01', cpu: 92, memory: 88, vms: 3, status: 'critical' },
    { name: 'node-dr-01', cpu: 15, memory: 22, vms: 2, status: 'healthy' },
  ];
}

// Time range options
const timeRanges = [
  { label: '1H', value: '1h' },
  { label: '6H', value: '6h' },
  { label: '24H', value: '24h' },
  { label: '7D', value: '7d' },
  { label: '30D', value: '30d' },
];

// Custom tooltip for charts
function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-bg-elevated border border-border rounded-lg p-3 shadow-lg">
        <p className="text-text-primary text-sm font-medium">{label}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}: {entry.value.toFixed(1)}%
          </p>
        ))}
      </div>
    );
  }
  return null;
}

// Metric summary card
function MetricSummaryCard({
  title,
  value,
  unit,
  icon: Icon,
  trend,
  trendValue,
  color,
}: {
  title: string;
  value: number;
  unit: string;
  icon: any;
  trend: 'up' | 'down' | 'stable';
  trendValue: string;
  color: string;
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Activity;
  const trendColor =
    trend === 'up' ? 'text-error' : trend === 'down' ? 'text-success' : 'text-text-muted';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-bg-surface rounded-xl p-5 border border-border"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon className="w-5 h-5" />
        </div>
        <div className={cn('flex items-center gap-1 text-sm', trendColor)}>
          <TrendIcon className="w-4 h-4" />
          <span>{trendValue}</span>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-text-muted text-sm">{title}</p>
        <p className="text-2xl font-bold text-text-primary">
          {value.toFixed(1)}
          <span className="text-text-muted text-base font-normal ml-1">{unit}</span>
        </p>
      </div>
    </motion.div>
  );
}

// Host row in table
function HostMetricRow({ host, index }: { host: any; index: number }) {
  const statusColors = {
    healthy: 'bg-success',
    warning: 'bg-warning',
    critical: 'bg-error',
  };

  const getBarColor = (value: number) => {
    if (value >= 85) return 'bg-error';
    if (value >= 70) return 'bg-warning';
    return 'bg-accent';
  };

  return (
    <motion.tr
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="border-b border-border hover:bg-bg-hover/50 transition-colors"
    >
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div
            className={cn('w-2 h-2 rounded-full', statusColors[host.status as keyof typeof statusColors])}
          />
          <span className="text-text-primary font-medium">{host.name}</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-bg-base rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', getBarColor(host.cpu))}
              style={{ width: `${host.cpu}%` }}
            />
          </div>
          <span className="text-text-secondary text-sm w-12 text-right">{host.cpu}%</span>
        </div>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-bg-base rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', getBarColor(host.memory))}
              style={{ width: `${host.memory}%` }}
            />
          </div>
          <span className="text-text-secondary text-sm w-12 text-right">{host.memory}%</span>
        </div>
      </td>
      <td className="py-3 px-4 text-center">
        <span className="text-text-secondary">{host.vms}</span>
      </td>
      <td className="py-3 px-4 text-right">
        <span
          className={cn(
            'px-2 py-1 rounded-md text-xs font-medium',
            host.status === 'healthy' && 'bg-success/10 text-success',
            host.status === 'warning' && 'bg-warning/10 text-warning',
            host.status === 'critical' && 'bg-error/10 text-error',
          )}
        >
          {host.status}
        </span>
      </td>
    </motion.tr>
  );
}

export function Monitoring() {
  const [timeRange, setTimeRange] = useState('24h');
  const [metrics, setMetrics] = useState(generateClusterMetrics());
  const [hostMetrics] = useState(generateHostMetrics());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics(generateClusterMetrics());
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setMetrics(generateClusterMetrics());
      setIsRefreshing(false);
    }, 500);
  };

  // Calculate current values
  const currentCpu = metrics.cpu[metrics.cpu.length - 1]?.value ?? 0;
  const currentMemory = metrics.memory[metrics.memory.length - 1]?.value ?? 0;
  const currentStorage = metrics.storage[metrics.storage.length - 1]?.value ?? 0;
  const currentNetwork = metrics.network[metrics.network.length - 1]?.value ?? 0;

  // Combine data for multi-line chart
  const combinedData = metrics.cpu.map((item, index) => ({
    time: item.time,
    CPU: item.value,
    Memory: metrics.memory[index]?.value ?? 0,
    Storage: metrics.storage[index]?.value ?? 0,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Monitoring</h1>
          <p className="text-text-muted mt-1">Real-time infrastructure metrics and performance</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center bg-bg-surface rounded-lg border border-border p-1">
            {timeRanges.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                  timeRange === range.value
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:text-text-primary',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricSummaryCard
          title="CPU Usage"
          value={currentCpu}
          unit="%"
          icon={Cpu}
          trend="up"
          trendValue="+2.5%"
          color="bg-blue-500/20 text-blue-400"
        />
        <MetricSummaryCard
          title="Memory Usage"
          value={currentMemory}
          unit="%"
          icon={MemoryStick}
          trend="stable"
          trendValue="0.3%"
          color="bg-purple-500/20 text-purple-400"
        />
        <MetricSummaryCard
          title="Storage Usage"
          value={currentStorage}
          unit="%"
          icon={HardDrive}
          trend="up"
          trendValue="+1.2%"
          color="bg-green-500/20 text-green-400"
        />
        <MetricSummaryCard
          title="Network I/O"
          value={currentNetwork}
          unit="%"
          icon={Network}
          trend="down"
          trendValue="-4.1%"
          color="bg-orange-500/20 text-orange-400"
        />
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Combined Resource Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-bg-surface rounded-xl p-5 border border-border"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Resource Utilization</h3>
              <p className="text-text-muted text-sm">CPU, Memory, and Storage over time</p>
            </div>
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Clock className="w-4 h-4" />
              <span>Last 24 hours</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={combinedData}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorStorage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 12 }} />
                <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="CPU"
                  stroke="#3b82f6"
                  fill="url(#colorCpu)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Memory"
                  stroke="#a855f7"
                  fill="url(#colorMemory)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Storage"
                  stroke="#22c55e"
                  fill="url(#colorStorage)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Network I/O Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-bg-surface rounded-xl p-5 border border-border"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Network Throughput</h3>
              <p className="text-text-muted text-sm">Inbound and outbound traffic</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-cyan-400" />
                <span className="text-text-muted">Inbound</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-400" />
                <span className="text-text-muted">Outbound</span>
              </div>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={metrics.network.map((item) => ({
                  time: item.time,
                  inbound: item.value,
                  outbound: item.value * 0.7 + Math.random() * 10,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#6b7280" tick={{ fontSize: 12 }} />
                <YAxis stroke="#6b7280" tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="inbound"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  dot={false}
                  name="Inbound"
                />
                <Line
                  type="monotone"
                  dataKey="outbound"
                  stroke="#f97316"
                  strokeWidth={2}
                  dot={false}
                  name="Outbound"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Server className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-text-muted text-sm">Active Hosts</p>
              <p className="text-xl font-bold text-text-primary">8 / 8</p>
            </div>
          </div>
        </div>
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/20">
              <Zap className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-text-muted text-sm">Running VMs</p>
              <p className="text-xl font-bold text-text-primary">65 / 93</p>
            </div>
          </div>
        </div>
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-warning/20">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-text-muted text-sm">Active Alerts</p>
              <p className="text-xl font-bold text-text-primary">3</p>
            </div>
          </div>
        </div>
        <div className="bg-bg-surface rounded-xl p-4 border border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Thermometer className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-text-muted text-sm">Avg Temperature</p>
              <p className="text-xl font-bold text-text-primary">42°C</p>
            </div>
          </div>
        </div>
      </div>

      {/* Host Metrics Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-bg-surface rounded-xl border border-border overflow-hidden"
      >
        <div className="p-5 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary">Host Performance</h3>
          <p className="text-text-muted text-sm mt-1">Current resource usage per host</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-base text-text-muted text-sm">
                <th className="py-3 px-4 text-left font-medium">Host</th>
                <th className="py-3 px-4 text-left font-medium">CPU</th>
                <th className="py-3 px-4 text-left font-medium">Memory</th>
                <th className="py-3 px-4 text-center font-medium">VMs</th>
                <th className="py-3 px-4 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {hostMetrics.map((host, index) => (
                <HostMetricRow key={host.name} host={host} index={index} />
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

