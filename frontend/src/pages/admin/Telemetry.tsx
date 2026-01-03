import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Users,
  MonitorCog,
  Calendar,
  Download,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

type TimeRange = '24h' | '7d' | '30d' | '90d' | '1y';

interface MetricData {
  current: number;
  previous: number;
  trend: number;
  unit: string;
}

interface PredictionData {
  metric: string;
  currentValue: number;
  predictedValue: number;
  timeframe: string;
  confidence: number;
  recommendation: string;
}

export function Telemetry() {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Mock telemetry data
  const metrics: Record<string, MetricData> = {
    vms: { current: 156, previous: 142, trend: 9.9, unit: 'VMs' },
    hosts: { current: 12, previous: 10, trend: 20, unit: 'Hosts' },
    storage: { current: 48.2, previous: 42.1, trend: 14.5, unit: 'TB' },
    network: { current: 2.4, previous: 1.8, trend: 33.3, unit: 'Gbps' },
    users: { current: 89, previous: 76, trend: 17.1, unit: 'Users' },
    apiCalls: { current: 1.2, previous: 0.9, trend: 33.3, unit: 'M/day' },
  };

  const predictions: PredictionData[] = [
    {
      metric: 'Storage Usage',
      currentValue: 48.2,
      predictedValue: 72.5,
      timeframe: '90 days',
      confidence: 87,
      recommendation: 'Consider provisioning additional storage capacity within 60 days',
    },
    {
      metric: 'VM Count',
      currentValue: 156,
      predictedValue: 210,
      timeframe: '90 days',
      confidence: 82,
      recommendation: 'Current host capacity can support projected growth',
    },
    {
      metric: 'Memory Utilization',
      currentValue: 62,
      predictedValue: 78,
      timeframe: '90 days',
      confidence: 79,
      recommendation: 'Memory pressure expected. Plan for 2 additional hosts.',
    },
    {
      metric: 'Network Bandwidth',
      currentValue: 2.4,
      predictedValue: 3.8,
      timeframe: '90 days',
      confidence: 74,
      recommendation: 'Current 10Gbps links adequate. Monitor for congestion.',
    },
  ];

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 1500);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Activity className="w-6 h-6 text-accent" />
            Platform Telemetry
          </h1>
          <p className="text-text-muted mt-1">
            Resource utilization, trends, and growth predictions
          </p>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          <Button variant="secondary" onClick={handleRefresh}>
            <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="secondary">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <TelemetryCard
          icon={<MonitorCog className="w-5 h-5" />}
          label="Virtual Machines"
          data={metrics.vms}
          delay={0.1}
        />
        <TelemetryCard
          icon={<Server className="w-5 h-5" />}
          label="Hosts"
          data={metrics.hosts}
          delay={0.15}
        />
        <TelemetryCard
          icon={<HardDrive className="w-5 h-5" />}
          label="Storage"
          data={metrics.storage}
          delay={0.2}
        />
        <TelemetryCard
          icon={<Network className="w-5 h-5" />}
          label="Network"
          data={metrics.network}
          delay={0.25}
        />
        <TelemetryCard
          icon={<Users className="w-5 h-5" />}
          label="Active Users"
          data={metrics.users}
          delay={0.3}
        />
        <TelemetryCard
          icon={<Activity className="w-5 h-5" />}
          label="API Calls"
          data={metrics.apiCalls}
          delay={0.35}
        />
      </div>

      {/* Resource Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="p-6 rounded-xl bg-bg-surface border border-border"
        >
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-accent" />
            CPU Utilization
          </h2>
          <ChartPlaceholder label="CPU usage over time" color="blue" />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <MiniStat label="Average" value="34%" />
            <MiniStat label="Peak" value="78%" />
            <MiniStat label="Min" value="12%" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="p-6 rounded-xl bg-bg-surface border border-border"
        >
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <MemoryStick className="w-5 h-5 text-warning" />
            Memory Utilization
          </h2>
          <ChartPlaceholder label="Memory usage over time" color="yellow" />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <MiniStat label="Average" value="62%" />
            <MiniStat label="Peak" value="89%" />
            <MiniStat label="Min" value="45%" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="p-6 rounded-xl bg-bg-surface border border-border"
        >
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-success" />
            Storage Growth
          </h2>
          <ChartPlaceholder label="Storage consumption trend" color="green" />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <MiniStat label="Used" value="48.2 TB" />
            <MiniStat label="Total" value="120 TB" />
            <MiniStat label="Growth/mo" value="+2.1 TB" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="p-6 rounded-xl bg-bg-surface border border-border"
        >
          <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Network className="w-5 h-5 text-purple-400" />
            Network Traffic
          </h2>
          <ChartPlaceholder label="Network bandwidth over time" color="purple" />
          <div className="mt-4 grid grid-cols-3 gap-4">
            <MiniStat label="Inbound" value="1.4 Gbps" />
            <MiniStat label="Outbound" value="1.0 Gbps" />
            <MiniStat label="Peak" value="8.2 Gbps" />
          </div>
        </motion.div>
      </div>

      {/* Growth Predictions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-accent" />
            Growth Predictions
          </h2>
          <span className="text-sm text-text-muted">
            Based on historical trends and ML analysis
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {predictions.map((prediction, index) => (
            <PredictionCard key={index} prediction={prediction} delay={0.65 + index * 0.05} />
          ))}
        </div>
      </motion.div>

      {/* VM Creation Trends */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.85 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <MonitorCog className="w-5 h-5 text-accent" />
          VM Creation Trends
        </h2>
        <div className="h-48 rounded-lg bg-bg-base border border-border flex items-center justify-center">
          <p className="text-text-muted text-sm">
            VM creation/deletion chart with daily breakdown
          </p>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-4">
          <MiniStat label="Created (30d)" value="24" />
          <MiniStat label="Deleted (30d)" value="10" />
          <MiniStat label="Net Growth" value="+14" />
          <MiniStat label="Avg/Week" value="3.5" />
        </div>
      </motion.div>
    </div>
  );
}

function TimeRangeSelector({ value, onChange }: { value: TimeRange; onChange: (v: TimeRange) => void }) {
  const options: { value: TimeRange; label: string }[] = [
    { value: '24h', label: '24h' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: '1y', label: '1y' },
  ];

  return (
    <div className="flex items-center gap-1 p-1 rounded-lg bg-bg-base border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
            value === option.value
              ? 'bg-accent text-white'
              : 'text-text-muted hover:text-text-primary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface TelemetryCardProps {
  icon: React.ReactNode;
  label: string;
  data: MetricData;
  delay: number;
}

function TelemetryCard({ icon, label, data, delay }: TelemetryCardProps) {
  const isPositive = data.trend >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="p-4 rounded-xl bg-bg-surface border border-border"
    >
      <div className="flex items-center gap-2 mb-3 text-text-muted">
        {icon}
        <span className="text-xs font-medium truncate">{label}</span>
      </div>
      <p className="text-xl font-bold text-text-primary">
        {data.current}
        <span className="text-sm font-normal text-text-muted ml-1">{data.unit}</span>
      </p>
      <div
        className={cn(
          'flex items-center gap-1 mt-2 text-xs font-medium',
          isPositive ? 'text-success' : 'text-error',
        )}
      >
        {isPositive ? (
          <ArrowUpRight className="w-3 h-3" />
        ) : (
          <ArrowDownRight className="w-3 h-3" />
        )}
        {Math.abs(data.trend)}% vs prev period
      </div>
    </motion.div>
  );
}

function ChartPlaceholder({ label, color }: { label: string; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'from-accent/20 to-transparent border-accent/20',
    yellow: 'from-warning/20 to-transparent border-warning/20',
    green: 'from-success/20 to-transparent border-success/20',
    purple: 'from-purple-400/20 to-transparent border-purple-400/20',
  };

  return (
    <div
      className={cn(
        'h-40 rounded-lg border bg-gradient-to-t flex items-center justify-center',
        colorClasses[color] || colorClasses.blue,
      )}
    >
      <p className="text-text-muted text-sm">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-bg-base">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm font-semibold text-text-primary">{value}</p>
    </div>
  );
}

interface PredictionCardProps {
  prediction: PredictionData;
  delay: number;
}

function PredictionCard({ prediction, delay }: PredictionCardProps) {
  const growthPercent = ((prediction.predictedValue - prediction.currentValue) / prediction.currentValue * 100).toFixed(0);
  const isGrowth = prediction.predictedValue > prediction.currentValue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="p-4 rounded-lg bg-bg-base border border-border"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-medium text-text-primary">{prediction.metric}</p>
          <p className="text-xs text-text-muted">
            {prediction.timeframe} projection
          </p>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent text-xs">
          {prediction.confidence}% confidence
        </div>
      </div>

      <div className="flex items-center gap-4 mb-3">
        <div>
          <p className="text-xs text-text-muted">Current</p>
          <p className="text-lg font-semibold text-text-primary">
            {prediction.currentValue}
            {prediction.metric.includes('%') ? '%' : prediction.metric.includes('Bandwidth') ? ' Gbps' : prediction.metric.includes('Storage') ? ' TB' : ''}
          </p>
        </div>
        <div className={cn('flex items-center gap-1', isGrowth ? 'text-success' : 'text-error')}>
          {isGrowth ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          <span className="text-sm font-medium">{isGrowth ? '+' : ''}{growthPercent}%</span>
        </div>
        <div>
          <p className="text-xs text-text-muted">Predicted</p>
          <p className="text-lg font-semibold text-text-primary">
            {prediction.predictedValue}
            {prediction.metric.includes('%') ? '%' : prediction.metric.includes('Bandwidth') ? ' Gbps' : prediction.metric.includes('Storage') ? ' TB' : ''}
          </p>
        </div>
      </div>

      <div className="p-2 rounded-md bg-info/10 border border-info/20 flex items-start gap-2">
        <Lightbulb className="w-4 h-4 text-info shrink-0 mt-0.5" />
        <p className="text-xs text-info">{prediction.recommendation}</p>
      </div>
    </motion.div>
  );
}

export default Telemetry;
