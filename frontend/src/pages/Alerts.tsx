import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  WifiOff,
  AlertCircle,
  Info,
  CheckCircle,
  BellOff,
  Search,
  RefreshCw,
  Clock,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  X,
  Eye,
  Check,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

// Alert severity types
type AlertSeverity = 'critical' | 'warning' | 'info' | 'resolved';

interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  sourceType: 'host' | 'vm' | 'storage' | 'network' | 'cluster';
  timestamp: Date;
  acknowledged: boolean;
  resolved: boolean;
}

// Mock alerts data
const mockAlerts: Alert[] = [
  {
    id: 'alert-1',
    severity: 'critical',
    title: 'High CPU Usage on node-gpu-01',
    message: 'CPU usage has exceeded 90% for more than 15 minutes. Consider migrating VMs or scaling resources.',
    source: 'node-gpu-01',
    sourceType: 'host',
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    acknowledged: false,
    resolved: false,
  },
  {
    id: 'alert-2',
    severity: 'warning',
    title: 'Memory Usage High on node-prod-03',
    message: 'Memory usage is at 82%. DRS recommendation available to rebalance workloads.',
    source: 'node-prod-03',
    sourceType: 'host',
    timestamp: new Date(Date.now() - 23 * 60 * 1000),
    acknowledged: true,
    resolved: false,
  },
  {
    id: 'alert-3',
    severity: 'warning',
    title: 'Storage Pool ceph-prod-01 Near Capacity',
    message: 'Storage pool is at 85% capacity. Consider expanding or migrating volumes.',
    source: 'ceph-prod-01',
    sourceType: 'storage',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
    acknowledged: false,
    resolved: false,
  },
  {
    id: 'alert-4',
    severity: 'info',
    title: 'VM web-server-01 Snapshot Created',
    message: 'Automatic snapshot created as part of scheduled backup policy.',
    source: 'web-server-01',
    sourceType: 'vm',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
    acknowledged: true,
    resolved: false,
  },
  {
    id: 'alert-5',
    severity: 'resolved',
    title: 'Network Latency Resolved',
    message: 'High latency on VLAN 100 has returned to normal levels.',
    source: 'Production VLAN 100',
    sourceType: 'network',
    timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
    acknowledged: true,
    resolved: true,
  },
  {
    id: 'alert-6',
    severity: 'critical',
    title: 'VM db-master-01 Not Responding',
    message: 'Guest agent has not reported in 5 minutes. VM may be unresponsive.',
    source: 'db-master-01',
    sourceType: 'vm',
    timestamp: new Date(Date.now() - 10 * 60 * 1000),
    acknowledged: false,
    resolved: false,
  },
  {
    id: 'alert-7',
    severity: 'info',
    title: 'Cluster DRS Rebalance Completed',
    message: 'Production Cluster has been rebalanced. 3 VMs migrated.',
    source: 'Production Cluster',
    sourceType: 'cluster',
    timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000),
    acknowledged: true,
    resolved: true,
  },
  {
    id: 'alert-8',
    severity: 'warning',
    title: 'Certificate Expiring Soon',
    message: 'SSL certificate for api.Quantixkvm.local expires in 14 days.',
    source: 'Control Plane',
    sourceType: 'cluster',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
    acknowledged: false,
    resolved: false,
  },
];

// Severity config
const severityConfig = {
  critical: {
    icon: AlertCircle,
    color: 'text-error',
    bg: 'bg-error/10',
    border: 'border-error/30',
    label: 'Critical',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-warning',
    bg: 'bg-warning/10',
    border: 'border-warning/30',
    label: 'Warning',
  },
  info: {
    icon: Info,
    color: 'text-accent',
    bg: 'bg-accent/10',
    border: 'border-accent/30',
    label: 'Info',
  },
  resolved: {
    icon: CheckCircle,
    color: 'text-success',
    bg: 'bg-success/10',
    border: 'border-success/30',
    label: 'Resolved',
  },
};

// Source type icons
const sourceTypeIcons = {
  host: Server,
  vm: Cpu,
  storage: HardDrive,
  network: Network,
  cluster: MemoryStick,
};

// Time formatting
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

// Alert card component
function AlertCard({
  alert,
  onAcknowledge,
  onResolve,
  onDismiss,
}: {
  alert: Alert;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const config = severityConfig[alert.severity];
  const Icon = config.icon;
  const SourceIcon = sourceTypeIcons[alert.sourceType];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className={cn(
        'bg-bg-surface rounded-xl p-4 border transition-all',
        config.border,
        alert.acknowledged && !alert.resolved && 'opacity-75',
      )}
    >
      <div className="flex items-start gap-4">
        {/* Severity Icon */}
        <div className={cn('p-2 rounded-lg shrink-0', config.bg)}>
          <Icon className={cn('w-5 h-5', config.color)} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h4 className="text-text-primary font-medium">{alert.title}</h4>
              <p className="text-text-muted text-sm mt-1">{alert.message}</p>
            </div>
            {!alert.resolved && (
              <button
                onClick={() => onDismiss(alert.id)}
                className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Meta */}
          <div className="flex items-center gap-4 mt-3 text-sm">
            <div className="flex items-center gap-1.5 text-text-muted">
              <SourceIcon className="w-4 h-4" />
              <span>{alert.source}</span>
            </div>
            <div className="flex items-center gap-1.5 text-text-muted">
              <Clock className="w-4 h-4" />
              <span>{formatTimeAgo(alert.timestamp)}</span>
            </div>
            {alert.acknowledged && !alert.resolved && (
              <span className="px-2 py-0.5 rounded-md bg-bg-hover text-text-muted text-xs">
                Acknowledged
              </span>
            )}
          </div>

          {/* Actions */}
          {!alert.resolved && (
            <div className="flex items-center gap-2 mt-3">
              {!alert.acknowledged && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-hover hover:bg-bg-base text-text-secondary hover:text-text-primary text-sm transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  Acknowledge
                </button>
              )}
              <button
                onClick={() => onResolve(alert.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 hover:bg-success/20 text-success text-sm transition-colors"
              >
                <Check className="w-4 h-4" />
                Resolve
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Summary card
function SummaryCard({
  title,
  count,
  icon: Icon,
  color,
  active,
  onClick,
}: {
  title: string;
  count: number;
  icon: any;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'bg-bg-surface rounded-xl p-4 border transition-all text-left w-full',
        active ? 'border-accent ring-1 ring-accent/30' : 'border-border hover:border-border-hover',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', color)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold text-text-primary">{count}</p>
          <p className="text-text-muted text-sm">{title}</p>
        </div>
      </div>
    </button>
  );
}

export function Alerts() {
  const [alerts, setAlerts] = useState(mockAlerts);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [showResolved, setShowResolved] = useState(false);

  // Filter alerts
  const filteredAlerts = alerts.filter((alert) => {
    if (!showResolved && alert.resolved) return false;
    if (severityFilter !== 'all' && alert.severity !== severityFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        alert.title.toLowerCase().includes(query) ||
        alert.message.toLowerCase().includes(query) ||
        alert.source.toLowerCase().includes(query)
      );
    }
    return true;
  });

  // Counts
  const criticalCount = alerts.filter((a) => a.severity === 'critical' && !a.resolved).length;
  const warningCount = alerts.filter((a) => a.severity === 'warning' && !a.resolved).length;
  const infoCount = alerts.filter((a) => a.severity === 'info' && !a.resolved).length;
  const resolvedCount = alerts.filter((a) => a.resolved).length;

  // Actions
  const handleAcknowledge = (id: string) => {
    setAlerts((prev) =>
      prev.map((alert) => (alert.id === id ? { ...alert, acknowledged: true } : alert)),
    );
  };

  const handleResolve = (id: string) => {
    setAlerts((prev) =>
      prev.map((alert) =>
        alert.id === id ? { ...alert, resolved: true, severity: 'resolved' as AlertSeverity } : alert,
      ),
    );
  };

  const handleDismiss = (id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Alerts</h1>
            <p className="text-text-muted mt-1">Monitor and manage system alerts</p>
          </div>
          {/* Alert service not yet exposed via HTTP - using mock data */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-warning/20 text-warning border border-warning/30">
            <WifiOff className="w-3 h-3" />
            Mock Data
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <Settings className="w-4 h-4" />
            Alert Rules
          </Button>
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Critical"
          count={criticalCount}
          icon={AlertCircle}
          color="bg-error/10 text-error"
          active={severityFilter === 'critical'}
          onClick={() => setSeverityFilter(severityFilter === 'critical' ? 'all' : 'critical')}
        />
        <SummaryCard
          title="Warning"
          count={warningCount}
          icon={AlertTriangle}
          color="bg-warning/10 text-warning"
          active={severityFilter === 'warning'}
          onClick={() => setSeverityFilter(severityFilter === 'warning' ? 'all' : 'warning')}
        />
        <SummaryCard
          title="Info"
          count={infoCount}
          icon={Info}
          color="bg-accent/10 text-accent"
          active={severityFilter === 'info'}
          onClick={() => setSeverityFilter(severityFilter === 'info' ? 'all' : 'info')}
        />
        <SummaryCard
          title="Resolved"
          count={resolvedCount}
          icon={CheckCircle}
          color="bg-success/10 text-success"
          active={showResolved}
          onClick={() => setShowResolved(!showResolved)}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-bg-surface border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <span>{filteredAlerts.length} alerts</span>
        </div>
      </div>

      {/* Alert List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredAlerts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <BellOff className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text-primary">No alerts</h3>
              <p className="text-text-muted mt-1">
                {searchQuery ? 'No alerts match your search' : 'All systems are running smoothly'}
              </p>
            </motion.div>
          ) : (
            filteredAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onAcknowledge={handleAcknowledge}
                onResolve={handleResolve}
                onDismiss={handleDismiss}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

