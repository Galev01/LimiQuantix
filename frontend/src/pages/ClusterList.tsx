import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Boxes,
  Server,
  MonitorCog,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Settings,
  Plus,
  MoreVertical,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Shield,
  Zap,
  RefreshCw,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { type Cluster } from '@/types/models';
import { useApiConnection } from '@/hooks/useDashboard';

const statusConfig = {
  HEALTHY: { color: 'success', icon: CheckCircle, label: 'Healthy' },
  WARNING: { color: 'warning', icon: AlertTriangle, label: 'Warning' },
  CRITICAL: { color: 'error', icon: XCircle, label: 'Critical' },
  MAINTENANCE: { color: 'info', icon: Settings, label: 'Maintenance' },
} as const;

export function ClusterList() {
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  
  // API connection
  const { data: isConnected = false } = useApiConnection();
  
  // TODO: Replace with real API hook when cluster service is implemented
  // For now, show empty state when connected (no mock data)
  const clusters: Cluster[] = [];

  // Calculate totals
  const totals = clusters.reduce(
    (acc, c) => ({
      clusters: acc.clusters + 1,
      hosts: acc.hosts + c.hosts.total,
      vms: acc.vms + c.vms.total,
      cpuGHz: acc.cpuGHz + c.resources.cpuTotalGHz,
      memoryBytes: acc.memoryBytes + c.resources.memoryTotalBytes,
    }),
    { clusters: 0, hosts: 0, vms: 0, cpuGHz: 0, memoryBytes: 0 }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Clusters</h1>
          <p className="text-text-muted mt-1">Manage compute clusters and resource pools</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button>
            <Plus className="w-4 h-4" />
            New Cluster
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Total Clusters"
          value={totals.clusters}
          icon={<Boxes className="w-5 h-5" />}
          color="blue"
        />
        <SummaryCard
          title="Total Hosts"
          value={totals.hosts}
          icon={<Server className="w-5 h-5" />}
          color="green"
        />
        <SummaryCard
          title="Total VMs"
          value={totals.vms}
          icon={<MonitorCog className="w-5 h-5" />}
          color="purple"
        />
        <SummaryCard
          title="Total Memory"
          value={formatBytes(totals.memoryBytes)}
          icon={<MemoryStick className="w-5 h-5" />}
          color="yellow"
        />
      </div>

      {/* Cluster Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {clusters.map((cluster, index) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            index={index}
            isSelected={selectedCluster === cluster.id}
            onSelect={() => setSelectedCluster(cluster.id)}
          />
        ))}
      </div>

      {/* Empty State */}
      {clusters.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12 bg-bg-surface rounded-xl border border-border"
        >
          <Boxes className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Clusters Found</h3>
          <p className="text-text-muted mb-4 max-w-md mx-auto">
            {!isConnected 
              ? 'Connect to the backend to view clusters.'
              : 'Create your first cluster to organize hosts and enable HA/DRS features.'}
          </p>
          <Button size="sm">
            <Plus className="w-4 h-4" />
            Create Cluster
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'yellow';
}) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
    yellow: 'bg-warning/10 text-warning',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-bg-surface border border-border shadow-floating"
    >
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>{icon}</div>
        <div>
          <p className="text-sm text-text-muted">{title}</p>
          <p className="text-xl font-bold text-text-primary">{value}</p>
        </div>
      </div>
    </motion.div>
  );
}

function ClusterCard({
  cluster,
  index,
  isSelected,
  onSelect,
}: {
  cluster: Cluster;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const status = statusConfig[cluster.status];
  const StatusIcon = status.icon;

  const cpuPercent = Math.round((cluster.resources.cpuUsedGHz / cluster.resources.cpuTotalGHz) * 100);
  const memPercent = Math.round(
    (cluster.resources.memoryUsedBytes / cluster.resources.memoryTotalBytes) * 100
  );
  const storagePercent = Math.round(
    (cluster.resources.storageUsedBytes / cluster.resources.storageTotalBytes) * 100
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      onClick={onSelect}
      className={cn(
        'p-5 rounded-xl bg-bg-surface border border-border shadow-floating',
        'hover:shadow-elevated hover:border-border-hover transition-all cursor-pointer',
        isSelected && 'border-accent ring-1 ring-accent/30'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Boxes className="w-5 h-5 text-accent" />
          </div>
          <div>
            <Link
              to={`/clusters/${cluster.id}`}
              className="text-lg font-semibold text-text-primary hover:text-accent transition-colors"
            >
              {cluster.name}
            </Link>
            <p className="text-sm text-text-muted">{cluster.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.color as any}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {status.label}
          </Badge>
          <button className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Features */}
      <div className="flex items-center gap-3 mb-4">
        {cluster.haEnabled && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-success/10 text-success text-xs">
            <Shield className="w-3 h-3" />
            HA Enabled
          </div>
        )}
        {cluster.drsEnabled && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-xs">
            <Zap className="w-3 h-3" />
            DRS Enabled
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-4 p-3 rounded-lg bg-bg-base">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-text-muted mb-1">
            <Server className="w-3 h-3" />
            <span className="text-xs">Hosts</span>
          </div>
          <p className="text-lg font-semibold text-text-primary">
            {cluster.hosts.online}/{cluster.hosts.total}
          </p>
          {cluster.hosts.maintenance > 0 && (
            <p className="text-xs text-warning">{cluster.hosts.maintenance} in maintenance</p>
          )}
        </div>
        <div className="text-center border-x border-border">
          <div className="flex items-center justify-center gap-1 text-text-muted mb-1">
            <MonitorCog className="w-3 h-3" />
            <span className="text-xs">VMs</span>
          </div>
          <p className="text-lg font-semibold text-text-primary">{cluster.vms.total}</p>
          <p className="text-xs text-success">{cluster.vms.running} running</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-text-muted mb-1">
            <Activity className="w-3 h-3" />
            <span className="text-xs">Health</span>
          </div>
          <p className={cn('text-lg font-semibold', `text-${status.color}`)}>{cpuPercent}%</p>
          <p className="text-xs text-text-muted">CPU load</p>
        </div>
      </div>

      {/* Resource Bars */}
      <div className="space-y-3">
        <ResourceBar label="CPU" used={cpuPercent} icon={<Cpu className="w-3 h-3" />} />
        <ResourceBar label="Memory" used={memPercent} icon={<MemoryStick className="w-3 h-3" />} />
        <ResourceBar label="Storage" used={storagePercent} icon={<HardDrive className="w-3 h-3" />} />
      </div>
    </motion.div>
  );
}

function ResourceBar({
  label,
  used,
  icon,
}: {
  label: string;
  used: number;
  icon: React.ReactNode;
}) {
  const getColor = (percent: number) => {
    if (percent >= 90) return 'bg-error';
    if (percent >= 75) return 'bg-warning';
    return 'bg-accent';
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1 w-20 text-text-muted text-xs">
        {icon}
        {label}
      </div>
      <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${used}%` }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className={cn('h-full rounded-full', getColor(used))}
        />
      </div>
      <span className="w-10 text-right text-xs text-text-secondary">{used}%</span>
    </div>
  );
}

