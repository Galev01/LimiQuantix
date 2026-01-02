import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Boxes,
  Server,
  MonitorCog,
  Cpu,
  MemoryStick,
  HardDrive,
  Shield,
  Zap,
  Settings,
  ArrowLeft,
  MoreVertical,
  Play,
  Pause,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Activity,
  Clock,
  Users,
  Network,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { mockNodes, mockVMs } from '@/data/mock-data';

// Mock cluster detail
const mockClusterDetail = {
  id: 'cluster-prod',
  name: 'Production Cluster',
  description: 'Main production workloads - mission critical',
  status: 'HEALTHY' as const,
  haEnabled: true,
  drsEnabled: true,
  drsAutomationLevel: 'Fully Automated',
  haAdmissionControl: true,
  hostFailoverCapacity: 1,
  hosts: { total: 8, online: 8, maintenance: 0 },
  vms: { total: 45, running: 42, stopped: 3 },
  resources: {
    cpuTotalGHz: 512,
    cpuUsedGHz: 284,
    memoryTotalBytes: 2199023255552,
    memoryUsedBytes: 1319413953331,
    storageTotalBytes: 107374182400000,
    storageUsedBytes: 64424509440000,
  },
  createdAt: '2024-01-15',
  createdBy: 'admin@limiquantix.local',
  labels: {
    environment: 'production',
    tier: 'critical',
    region: 'us-east-1',
  },
};

const statusConfig = {
  HEALTHY: { color: 'success', icon: CheckCircle, label: 'Healthy' },
  WARNING: { color: 'warning', icon: AlertTriangle, label: 'Warning' },
  CRITICAL: { color: 'error', icon: AlertTriangle, label: 'Critical' },
  MAINTENANCE: { color: 'info', icon: Settings, label: 'Maintenance' },
} as const;

export function ClusterDetail() {
  const { id } = useParams<{ id: string }>();
  const cluster = mockClusterDetail; // In real app, fetch by id

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
    <div className="space-y-6">
      {/* Breadcrumb & Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/clusters"
          className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
              <Boxes className="w-6 h-6 text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-text-primary">{cluster.name}</h1>
                <Badge variant={status.color as any}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {status.label}
                </Badge>
              </div>
              <p className="text-text-muted">{cluster.description}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary">
            <Settings className="w-4 h-4" />
            Configure
          </Button>
          <Button variant="secondary">
            <MoreVertical className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Feature Badges */}
      <div className="flex items-center gap-3">
        {cluster.haEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-success/10 text-success text-sm">
            <Shield className="w-4 h-4" />
            High Availability Enabled
          </div>
        )}
        {cluster.drsEnabled && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-sm">
            <Zap className="w-4 h-4" />
            DRS: {cluster.drsAutomationLevel}
          </div>
        )}
        {cluster.haAdmissionControl && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-warning/10 text-warning text-sm">
            <AlertTriangle className="w-4 h-4" />
            Admission Control: {cluster.hostFailoverCapacity} host failover
          </div>
        )}
      </div>

      {/* Resource Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ResourceCard
          title="Hosts"
          value={`${cluster.hosts.online}/${cluster.hosts.total}`}
          subtitle={cluster.hosts.maintenance > 0 ? `${cluster.hosts.maintenance} in maintenance` : 'All online'}
          icon={<Server className="w-5 h-5" />}
          color="blue"
        />
        <ResourceCard
          title="Virtual Machines"
          value={cluster.vms.total.toString()}
          subtitle={`${cluster.vms.running} running, ${cluster.vms.stopped} stopped`}
          icon={<MonitorCog className="w-5 h-5" />}
          color="green"
        />
        <ResourceCard
          title="CPU Usage"
          value={`${cpuPercent}%`}
          subtitle={`${cluster.resources.cpuUsedGHz} / ${cluster.resources.cpuTotalGHz} GHz`}
          icon={<Cpu className="w-5 h-5" />}
          color="purple"
          percent={cpuPercent}
        />
        <ResourceCard
          title="Memory Usage"
          value={`${memPercent}%`}
          subtitle={`${formatBytes(cluster.resources.memoryUsedBytes)} / ${formatBytes(cluster.resources.memoryTotalBytes)}`}
          icon={<MemoryStick className="w-5 h-5" />}
          color="yellow"
          percent={memPercent}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="hosts">Hosts ({cluster.hosts.total})</TabsTrigger>
          <TabsTrigger value="vms">Virtual Machines ({cluster.vms.total})</TabsTrigger>
          <TabsTrigger value="resources">Resource Pools</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab cluster={cluster} cpuPercent={cpuPercent} memPercent={memPercent} storagePercent={storagePercent} />
        </TabsContent>

        <TabsContent value="hosts">
          <HostsTab />
        </TabsContent>

        <TabsContent value="vms">
          <VMsTab />
        </TabsContent>

        <TabsContent value="resources">
          <ResourcePoolsTab />
        </TabsContent>

        <TabsContent value="settings">
          <SettingsTab cluster={cluster} />
        </TabsContent>

        <TabsContent value="events">
          <EventsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResourceCard({
  title,
  value,
  subtitle,
  icon,
  color,
  percent,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'yellow';
  percent?: number;
}) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
    yellow: 'bg-warning/10 text-warning',
  };

  const barColor = {
    blue: 'bg-accent',
    green: 'bg-success',
    purple: 'bg-purple-400',
    yellow: 'bg-warning',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-bg-surface border border-border shadow-floating"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>{icon}</div>
        <span className="text-sm text-text-muted">{title}</span>
      </div>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-sm text-text-muted mt-1">{subtitle}</p>
      {percent !== undefined && (
        <div className="mt-3 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.5 }}
            className={cn('h-full rounded-full', barColor[color])}
          />
        </div>
      )}
    </motion.div>
  );
}

function SummaryTab({
  cluster,
  cpuPercent,
  memPercent,
  storagePercent,
}: {
  cluster: typeof mockClusterDetail;
  cpuPercent: number;
  memPercent: number;
  storagePercent: number;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column - Info */}
      <div className="space-y-6">
        <div className="p-5 rounded-xl bg-bg-surface border border-border">
          <h3 className="text-sm font-medium text-text-muted mb-4">General Information</h3>
          <div className="space-y-3">
            <InfoRow label="Cluster ID" value={cluster.id} />
            <InfoRow label="Created" value={new Date(cluster.createdAt).toLocaleDateString()} />
            <InfoRow label="Created By" value={cluster.createdBy} />
            <InfoRow label="Region" value={cluster.labels.region} />
            <InfoRow label="Environment" value={cluster.labels.environment} />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-bg-surface border border-border">
          <h3 className="text-sm font-medium text-text-muted mb-4">Labels</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(cluster.labels).map(([key, value]) => (
              <span
                key={key}
                className="px-2 py-1 rounded-md bg-bg-elevated text-sm text-text-secondary"
              >
                {key}: {value}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Middle Column - Resources */}
      <div className="p-5 rounded-xl bg-bg-surface border border-border">
        <h3 className="text-sm font-medium text-text-muted mb-4">Resource Allocation</h3>
        <div className="space-y-6">
          <ResourceGauge
            label="CPU"
            used={cluster.resources.cpuUsedGHz}
            total={cluster.resources.cpuTotalGHz}
            unit="GHz"
            percent={cpuPercent}
          />
          <ResourceGauge
            label="Memory"
            used={cluster.resources.memoryUsedBytes}
            total={cluster.resources.memoryTotalBytes}
            unit="bytes"
            percent={memPercent}
          />
          <ResourceGauge
            label="Storage"
            used={cluster.resources.storageUsedBytes}
            total={cluster.resources.storageTotalBytes}
            unit="bytes"
            percent={storagePercent}
          />
        </div>
      </div>

      {/* Right Column - Quick Stats */}
      <div className="space-y-6">
        <div className="p-5 rounded-xl bg-bg-surface border border-border">
          <h3 className="text-sm font-medium text-text-muted mb-4">Quick Stats</h3>
          <div className="space-y-4">
            <QuickStat icon={<Server className="w-4 h-4" />} label="Total Hosts" value={cluster.hosts.total} />
            <QuickStat icon={<MonitorCog className="w-4 h-4" />} label="Running VMs" value={cluster.vms.running} />
            <QuickStat icon={<Activity className="w-4 h-4" />} label="Avg CPU Load" value={`${cpuPercent}%`} />
            <QuickStat icon={<Clock className="w-4 h-4" />} label="Uptime" value="99.99%" />
          </div>
        </div>

        <div className="p-5 rounded-xl bg-bg-surface border border-border">
          <h3 className="text-sm font-medium text-text-muted mb-4">Recent Alerts</h3>
          <div className="space-y-3">
            <AlertItem severity="warning" message="High memory usage on hv-rack1-03" time="2 hours ago" />
            <AlertItem severity="info" message="DRS migrated vm-db-01 to balance load" time="5 hours ago" />
          </div>
        </div>
      </div>
    </div>
  );
}

function HostsTab() {
  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-text-primary">Cluster Hosts</h3>
        <Button variant="secondary" size="sm">
          <Plus className="w-4 h-4" />
          Add Host
        </Button>
      </div>
      <div className="space-y-3">
        {mockNodes.slice(0, 4).map((node) => (
          <Link
            key={node.id}
            to={`/hosts/${node.id}`}
            className="flex items-center gap-4 p-4 rounded-lg bg-bg-base hover:bg-bg-hover transition-colors"
          >
            <Server className="w-5 h-5 text-text-muted" />
            <div className="flex-1">
              <p className="font-medium text-text-primary">{node.hostname}</p>
              <p className="text-sm text-text-muted">{node.managementIp}</p>
            </div>
            <Badge variant={node.status.phase === 'READY' ? 'success' : 'warning'}>
              {node.status.phase}
            </Badge>
            <div className="text-right text-sm">
              <p className="text-text-secondary">{node.status.vmIds.length} VMs</p>
              <p className="text-text-muted">{node.status.resources.cpuUsagePercent}% CPU</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function VMsTab() {
  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-text-primary">Virtual Machines in Cluster</h3>
        <Button size="sm">
          <Plus className="w-4 h-4" />
          New VM
        </Button>
      </div>
      <div className="space-y-2">
        {mockVMs.map((vm) => (
          <Link
            key={vm.id}
            to={`/vms/${vm.id}`}
            className="flex items-center gap-4 p-3 rounded-lg bg-bg-base hover:bg-bg-hover transition-colors"
          >
            <MonitorCog className="w-4 h-4 text-text-muted" />
            <span className="flex-1 font-medium text-text-primary">{vm.name}</span>
            <Badge
              variant={
                vm.status.state === 'RUNNING'
                  ? 'success'
                  : vm.status.state === 'STOPPED'
                  ? 'default'
                  : 'warning'
              }
            >
              {vm.status.state}
            </Badge>
            <span className="text-sm text-text-muted">
              {vm.spec.cpu.cores} vCPU, {vm.spec.memory.sizeMib / 1024} GB
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ResourcePoolsTab() {
  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-text-primary">Resource Pools</h3>
        <Button variant="secondary" size="sm">
          <Plus className="w-4 h-4" />
          New Pool
        </Button>
      </div>
      <div className="space-y-3">
        <ResourcePoolItem name="Production" cpuShares={4000} memShares={4000} vms={25} />
        <ResourcePoolItem name="Development" cpuShares={2000} memShares={2000} vms={15} />
        <ResourcePoolItem name="Testing" cpuShares={1000} memShares={1000} vms={5} />
      </div>
    </div>
  );
}

function ResourcePoolItem({
  name,
  cpuShares,
  memShares,
  vms,
}: {
  name: string;
  cpuShares: number;
  memShares: number;
  vms: number;
}) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-lg bg-bg-base">
      <Users className="w-5 h-5 text-accent" />
      <div className="flex-1">
        <p className="font-medium text-text-primary">{name}</p>
        <p className="text-sm text-text-muted">
          CPU: {cpuShares} shares • Memory: {memShares} shares
        </p>
      </div>
      <span className="text-sm text-text-secondary">{vms} VMs</span>
    </div>
  );
}

function SettingsTab({ cluster }: { cluster: typeof mockClusterDetail }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="p-5 rounded-xl bg-bg-surface border border-border">
        <h3 className="font-medium text-text-primary mb-4">High Availability (HA)</h3>
        <div className="space-y-4">
          <SettingRow label="HA Enabled" value={cluster.haEnabled ? 'Yes' : 'No'} />
          <SettingRow label="Admission Control" value={cluster.haAdmissionControl ? 'Enabled' : 'Disabled'} />
          <SettingRow label="Host Failover Capacity" value={`${cluster.hostFailoverCapacity} host(s)`} />
          <SettingRow label="VM Restart Priority" value="Medium" />
          <SettingRow label="Host Isolation Response" value="Power Off VMs" />
        </div>
      </div>

      <div className="p-5 rounded-xl bg-bg-surface border border-border">
        <h3 className="font-medium text-text-primary mb-4">DRS (Distributed Resource Scheduler)</h3>
        <div className="space-y-4">
          <SettingRow label="DRS Enabled" value={cluster.drsEnabled ? 'Yes' : 'No'} />
          <SettingRow label="Automation Level" value={cluster.drsAutomationLevel} />
          <SettingRow label="Migration Threshold" value="Medium (3)" />
          <SettingRow label="Predictive DRS" value="Enabled" />
        </div>
      </div>
    </div>
  );
}

function EventsTab() {
  const events = [
    { type: 'info', message: 'DRS migrated vm-web-02 from hv-rack1-01 to hv-rack1-02', time: '10 minutes ago' },
    { type: 'success', message: 'Host hv-rack1-03 exited maintenance mode', time: '1 hour ago' },
    { type: 'warning', message: 'High memory pressure detected on cluster', time: '3 hours ago' },
    { type: 'info', message: 'New VM prod-db-replica created', time: '5 hours ago' },
    { type: 'success', message: 'Cluster backup completed successfully', time: '12 hours ago' },
  ];

  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border">
      <h3 className="font-medium text-text-primary mb-4">Recent Events</h3>
      <div className="space-y-3">
        {events.map((event, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-bg-base">
            <div
              className={cn(
                'w-2 h-2 rounded-full mt-1.5',
                event.type === 'success' && 'bg-success',
                event.type === 'warning' && 'bg-warning',
                event.type === 'info' && 'bg-accent'
              )}
            />
            <div className="flex-1">
              <p className="text-sm text-text-primary">{event.message}</p>
              <p className="text-xs text-text-muted mt-1">{event.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper components
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  );
}

function ResourceGauge({
  label,
  used,
  total,
  unit,
  percent,
}: {
  label: string;
  used: number;
  total: number;
  unit: string;
  percent: number;
}) {
  const getColor = () => {
    if (percent >= 90) return 'text-error';
    if (percent >= 75) return 'text-warning';
    return 'text-accent';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-text-secondary">{label}</span>
        <span className={cn('text-sm font-medium', getColor())}>{percent}%</span>
      </div>
      <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5 }}
          className={cn(
            'h-full rounded-full',
            percent >= 90 ? 'bg-error' : percent >= 75 ? 'bg-warning' : 'bg-accent'
          )}
        />
      </div>
      <p className="text-xs text-text-muted mt-1">
        {unit === 'bytes' ? formatBytes(used) : used} / {unit === 'bytes' ? formatBytes(total) : total} {unit !== 'bytes' && unit}
      </p>
    </div>
  );
}

function QuickStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-text-muted">{icon}</div>
      <span className="text-sm text-text-muted">{label}</span>
      <span className="ml-auto text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

function AlertItem({
  severity,
  message,
  time,
}: {
  severity: 'warning' | 'info' | 'error';
  message: string;
  time: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <AlertTriangle
        className={cn(
          'w-4 h-4 mt-0.5',
          severity === 'warning' && 'text-warning',
          severity === 'error' && 'text-error',
          severity === 'info' && 'text-info'
        )}
      />
      <div>
        <p className="text-sm text-text-secondary">{message}</p>
        <p className="text-xs text-text-muted">{time}</p>
      </div>
    </div>
  );
}

function Plus(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

