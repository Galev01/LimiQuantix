import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Boxes,
  ArrowLeft,
  Server,
  MonitorCog,
  Cpu,
  MemoryStick,
  HardDrive,
  Activity,
  Settings,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Shield,
  Zap,
  X,
  Loader2,
  Network,
  Edit,
  MoreVertical,
  Power,
  Wrench,
  ChevronRight,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  useCluster,
  useClusterHosts,
  useUpdateCluster,
  useDeleteCluster,
  useAddHostToCluster,
  useRemoveHostFromCluster,
  type Cluster,
  type DRSMode,
} from '@/hooks/useClusters';
import { useNodes, type ApiNode } from '@/hooks/useNodes';
import { toast } from 'sonner';

const statusConfig = {
  HEALTHY: { color: 'success', icon: CheckCircle, label: 'Healthy' },
  WARNING: { color: 'warning', icon: AlertTriangle, label: 'Warning' },
  CRITICAL: { color: 'error', icon: XCircle, label: 'Critical' },
  MAINTENANCE: { color: 'info', icon: Settings, label: 'Maintenance' },
} as const;

const nodePhaseConfig: Record<string, { color: string; label: string; icon?: typeof XCircle }> = {
  READY: { color: 'success', label: 'Ready' },
  NODE_PHASE_READY: { color: 'success', label: 'Ready' },
  NOT_READY: { color: 'error', label: 'Not Ready' },
  MAINTENANCE: { color: 'info', label: 'Maintenance' },
  DRAINING: { color: 'warning', label: 'Draining' },
  PENDING: { color: 'warning', label: 'Pending' },
  DISCONNECTED: { color: 'error', label: 'Disconnected', icon: XCircle },
  ERROR: { color: 'error', label: 'Error' },
};

type TabId = 'overview' | 'hosts' | 'vms' | 'settings';

export function ClusterDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isAddHostModalOpen, setIsAddHostModalOpen] = useState(false);
  const [isEditSettingsOpen, setIsEditSettingsOpen] = useState(false);
  const [hostMenuOpen, setHostMenuOpen] = useState<string | null>(null);

  // Fetch cluster data
  const { data: cluster, isLoading, refetch, isRefetching } = useCluster(id || '', !!id);
  const { data: hostsResponse, isLoading: hostsLoading } = useClusterHosts(id || '', !!id);
  const { data: nodesResponse } = useNodes({ pageSize: 100 });

  // Mutations
  const updateCluster = useUpdateCluster();
  const deleteCluster = useDeleteCluster();
  const addHostToCluster = useAddHostToCluster();
  const removeHostFromCluster = useRemoveHostFromCluster();

  const clusterHosts = hostsResponse?.hosts || [];
  const allNodes = nodesResponse?.nodes || [];
  
  // Available nodes (not in any cluster)
  const availableNodes = allNodes.filter(
    (node) => !node.clusterId || node.clusterId === ''
  );

  const handleDeleteCluster = async () => {
    if (!cluster) return;
    if (!confirm(`Are you sure you want to delete cluster "${cluster.name}"? This will remove all hosts from the cluster.`)) return;
    
    try {
      await deleteCluster.mutateAsync(cluster.id);
      toast.success('Cluster deleted');
      navigate('/clusters');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete cluster');
    }
  };

  const handleRemoveHost = async (hostId: string, hostname: string) => {
    if (!cluster) return;
    if (!confirm(`Remove host "${hostname}" from this cluster?`)) return;
    
    try {
      await removeHostFromCluster.mutateAsync({ clusterId: cluster.id, hostId });
      toast.success(`Host "${hostname}" removed from cluster`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove host');
    }
  };

  const handleAddHost = async (hostId: string) => {
    if (!cluster) return;
    
    try {
      await addHostToCluster.mutateAsync({ clusterId: cluster.id, hostId });
      toast.success('Host added to cluster');
      setIsAddHostModalOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add host');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <AlertCircle className="w-12 h-12 text-error mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Cluster Not Found</h2>
        <p className="text-text-muted mb-4">The cluster you're looking for doesn't exist.</p>
        <Link to="/clusters">
          <Button>
            <ArrowLeft className="w-4 h-4" />
            Back to Clusters
          </Button>
        </Link>
      </div>
    );
  }

  const status = statusConfig[cluster.status] || statusConfig.HEALTHY;
  const StatusIcon = status.icon;

  // Calculate resource percentages
  const cpuPercent = cluster.stats.cpu_total_ghz > 0 
    ? Math.round((cluster.stats.cpu_used_ghz / cluster.stats.cpu_total_ghz) * 100) 
    : 0;
  const memPercent = cluster.stats.memory_total_bytes > 0 
    ? Math.round((cluster.stats.memory_used_bytes / cluster.stats.memory_total_bytes) * 100) 
    : 0;
  const storagePercent = cluster.stats.storage_total_bytes > 0 
    ? Math.round((cluster.stats.storage_used_bytes / cluster.stats.storage_total_bytes) * 100) 
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <Link to="/clusters" className="p-2 rounded-lg hover:bg-bg-hover transition-colors mt-1">
            <ArrowLeft className="w-5 h-5 text-text-muted" />
          </Link>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
              <Boxes className="w-7 h-7 text-accent" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-text-primary">{cluster.name}</h1>
                <Badge variant={status.color as any}>
                  <StatusIcon className="w-3 h-3 mr-1" />
                  {status.label}
                </Badge>
              </div>
              <p className="text-text-muted mt-1">{cluster.description || 'No description'}</p>
              <div className="flex items-center gap-3 mt-2">
                {cluster.ha_enabled && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 text-success text-xs">
                    <Shield className="w-3 h-3" />
                    HA Enabled
                  </div>
                )}
                {cluster.drs_enabled && (
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs">
                    <Zap className="w-3 h-3" />
                    DRS ({cluster.drs_mode})
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('w-4 h-4', isRefetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => setIsEditSettingsOpen(true)}>
            <Settings className="w-4 h-4" />
            Settings
          </Button>
          <Button variant="danger" onClick={handleDeleteCluster}>
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-bg-base rounded-lg w-fit">
        {(['overview', 'hosts', 'vms', 'settings'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-all capitalize',
              activeTab === tab
                ? 'bg-bg-surface text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Resource Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="Hosts"
                value={`${cluster.stats.online_hosts}/${cluster.stats.total_hosts}`}
                subtitle={cluster.stats.maintenance_hosts > 0 ? `${cluster.stats.maintenance_hosts} in maintenance` : 'All online'}
                icon={<Server className="w-5 h-5" />}
                color="blue"
              />
              <SummaryCard
                title="Virtual Machines"
                value={cluster.stats.total_vms.toString()}
                subtitle={`${cluster.stats.running_vms} running`}
                icon={<MonitorCog className="w-5 h-5" />}
                color="green"
              />
              <SummaryCard
                title="CPU Usage"
                value={`${cpuPercent}%`}
                subtitle={`${cluster.stats.cpu_used_ghz.toFixed(1)} / ${cluster.stats.cpu_total_ghz.toFixed(1)} GHz`}
                icon={<Cpu className="w-5 h-5" />}
                color={cpuPercent > 80 ? 'red' : cpuPercent > 60 ? 'yellow' : 'purple'}
              />
              <SummaryCard
                title="Memory Usage"
                value={`${memPercent}%`}
                subtitle={`${formatBytes(cluster.stats.memory_used_bytes)} / ${formatBytes(cluster.stats.memory_total_bytes)}`}
                icon={<MemoryStick className="w-5 h-5" />}
                color={memPercent > 80 ? 'red' : memPercent > 60 ? 'yellow' : 'purple'}
              />
            </div>

            {/* Resource Bars */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <ResourceCard
                title="CPU"
                used={cluster.stats.cpu_used_ghz}
                total={cluster.stats.cpu_total_ghz}
                unit="GHz"
                icon={<Cpu className="w-5 h-5 text-accent" />}
              />
              <ResourceCard
                title="Memory"
                used={cluster.stats.memory_used_bytes}
                total={cluster.stats.memory_total_bytes}
                unit="bytes"
                icon={<MemoryStick className="w-5 h-5 text-purple-500" />}
              />
              <ResourceCard
                title="Storage"
                used={cluster.stats.storage_used_bytes}
                total={cluster.stats.storage_total_bytes}
                unit="bytes"
                icon={<HardDrive className="w-5 h-5 text-orange-500" />}
              />
            </div>

            {/* Quick Actions & Info */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* HA/DRS Status */}
              <div className="p-5 rounded-xl bg-bg-surface border border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Cluster Features</h3>
                <div className="space-y-4">
                  <FeatureRow
                    title="High Availability (HA)"
                    enabled={cluster.ha_enabled}
                    description={cluster.ha_enabled 
                      ? `Tolerates ${cluster.ha_failover_capacity} host failure(s)` 
                      : 'VMs will not auto-restart on host failure'}
                    icon={<Shield className="w-5 h-5" />}
                  />
                  <FeatureRow
                    title="Distributed Resource Scheduler (DRS)"
                    enabled={cluster.drs_enabled}
                    description={cluster.drs_enabled 
                      ? `Mode: ${cluster.drs_mode}, Threshold: ${cluster.drs_migration_threshold}` 
                      : 'Manual VM placement only'}
                    icon={<Zap className="w-5 h-5" />}
                  />
                  <FeatureRow
                    title="Shared Storage Required"
                    enabled={cluster.shared_storage_required}
                    description={cluster.shared_storage_required 
                      ? 'Hosts must have shared storage for HA' 
                      : 'Local storage allowed'}
                    icon={<HardDrive className="w-5 h-5" />}
                  />
                </div>
              </div>

              {/* Recent Activity */}
              <div className="p-5 rounded-xl bg-bg-surface border border-border">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Cluster Info</h3>
                <div className="space-y-3">
                  <InfoRow label="Cluster ID" value={cluster.id} mono />
                  <InfoRow label="Project" value={cluster.project_id || 'default'} />
                  <InfoRow label="Created" value={new Date(cluster.created_at).toLocaleString()} />
                  <InfoRow label="Last Updated" value={new Date(cluster.updated_at).toLocaleString()} />
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'hosts' && (
          <motion.div
            key="hosts"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Hosts Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">Cluster Hosts</h3>
                <p className="text-sm text-text-muted">
                  {clusterHosts.length} host{clusterHosts.length !== 1 ? 's' : ''} in this cluster
                </p>
              </div>
              <Button onClick={() => setIsAddHostModalOpen(true)}>
                <Plus className="w-4 h-4" />
                Add Host
              </Button>
            </div>

            {/* Hosts List */}
            {hostsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
              </div>
            ) : clusterHosts.length === 0 ? (
              <div className="text-center py-12 bg-bg-surface rounded-xl border border-border">
                <Server className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">No Hosts</h3>
                <p className="text-text-muted mb-4">This cluster doesn't have any hosts yet.</p>
                <Button onClick={() => setIsAddHostModalOpen(true)}>
                  <Plus className="w-4 h-4" />
                  Add First Host
                </Button>
              </div>
            ) : (
              <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-bg-base">
                      <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Host</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Status</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">CPU</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Memory</th>
                      <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">VMs</th>
                      <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clusterHosts.map((host: any, index: number) => {
                      const phase = host.status?.phase || 'PENDING';
                      const phaseConfig = nodePhaseConfig[phase] || { color: 'default', label: phase };
                      const cpuCores = host.spec?.cpu?.sockets * host.spec?.cpu?.coresPerSocket || 0;
                      const memoryGiB = Math.round((host.spec?.memory?.totalMib || 0) / 1024);
                      const vmCount = host.status?.vmIds?.length || 0;
                      const isDisconnected = phase === 'DISCONNECTED';
                      const lastHeartbeat = host.lastHeartbeat ? new Date(host.lastHeartbeat) : null;

                      return (
                        <tr
                          key={host.id}
                          className={cn(
                            "border-b border-border last:border-0 hover:bg-bg-hover transition-colors",
                            isDisconnected && "bg-error/5"
                          )}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "relative w-8 h-8 rounded-lg flex items-center justify-center",
                                isDisconnected ? "bg-error/10" : "bg-accent/10"
                              )}>
                                <Server className={cn(
                                  "w-4 h-4",
                                  isDisconnected ? "text-error" : "text-accent"
                                )} />
                                {isDisconnected && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-error rounded-full flex items-center justify-center">
                                    <X className="w-3 h-3 text-white" />
                                  </div>
                                )}
                              </div>
                              <div>
                                <Link
                                  to={`/hosts/${host.id}`}
                                  className={cn(
                                    "font-medium hover:text-accent transition-colors",
                                    isDisconnected ? "text-error" : "text-text-primary"
                                  )}
                                >
                                  {host.hostname || host.id}
                                </Link>
                                <p className="text-xs text-text-muted">{host.managementIp}</p>
                                {isDisconnected && lastHeartbeat && (
                                  <p className="text-xs text-error mt-0.5">
                                    Last seen: {lastHeartbeat.toLocaleString()}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Badge variant={phaseConfig.color as any}>{phaseConfig.label}</Badge>
                              {isDisconnected && vmCount > 0 && (
                                <span className="text-xs text-error font-medium">
                                  {vmCount} VM{vmCount !== 1 ? 's' : ''} affected
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-text-secondary">{cpuCores} cores</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-text-secondary">{memoryGiB} GB</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-sm text-text-secondary">{vmCount}</span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-1">
                              <Link to={`/hosts/${host.id}`}>
                                <button className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                              </Link>
                              <div className="relative">
                                <button
                                  onClick={() => setHostMenuOpen(hostMenuOpen === host.id ? null : host.id)}
                                  className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                                >
                                  <MoreVertical className="w-4 h-4" />
                                </button>
                                {hostMenuOpen === host.id && (
                                  <div className="absolute right-0 top-full mt-1 w-40 bg-bg-elevated border border-border rounded-lg shadow-lg z-10">
                                    <button
                                      onClick={() => {
                                        handleRemoveHost(host.id, host.hostname || host.id);
                                        setHostMenuOpen(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 rounded-lg"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                      Remove from Cluster
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'vms' && (
          <motion.div
            key="vms"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-center py-12 bg-bg-surface rounded-xl border border-border"
          >
            <MonitorCog className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">Virtual Machines</h3>
            <p className="text-text-muted mb-4">
              {cluster.stats.total_vms} VMs in this cluster ({cluster.stats.running_vms} running)
            </p>
            <Link to="/vms">
              <Button variant="secondary">
                View All VMs
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </motion.div>
        )}

        {activeTab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* General Settings */}
            <SettingsSection title="General" icon={<Settings className="w-5 h-5" />}>
              <SettingRow label="Cluster Name" value={cluster.name} />
              <SettingRow label="Description" value={cluster.description || 'None'} />
              <SettingRow label="Project ID" value={cluster.project_id || 'default'} />
            </SettingsSection>

            {/* HA Settings */}
            <SettingsSection title="High Availability (HA)" icon={<Shield className="w-5 h-5" />}>
              <SettingRow label="HA Enabled" value={cluster.ha_enabled ? 'Yes' : 'No'} highlight={cluster.ha_enabled} />
              {cluster.ha_enabled && (
                <>
                  <SettingRow label="Admission Control" value={cluster.ha_admission_control ? 'Enabled' : 'Disabled'} />
                  <SettingRow label="Host Monitoring" value={cluster.ha_host_monitoring ? 'Enabled' : 'Disabled'} />
                  <SettingRow label="VM Monitoring" value={cluster.ha_vm_monitoring ? 'Enabled' : 'Disabled'} />
                  <SettingRow label="Failover Capacity" value={`${cluster.ha_failover_capacity} host(s)`} />
                  <SettingRow label="Restart Priority" value={getPriorityLabel(cluster.ha_restart_priority)} />
                  <SettingRow label="Isolation Response" value={getIsolationLabel(cluster.ha_isolation_response)} />
                </>
              )}
            </SettingsSection>

            {/* DRS Settings */}
            <SettingsSection title="Distributed Resource Scheduler (DRS)" icon={<Zap className="w-5 h-5" />}>
              <SettingRow label="DRS Enabled" value={cluster.drs_enabled ? 'Yes' : 'No'} highlight={cluster.drs_enabled} />
              {cluster.drs_enabled && (
                <>
                  <SettingRow label="Automation Level" value={getDRSModeLabel(cluster.drs_mode)} />
                  <SettingRow label="Migration Threshold" value={`${cluster.drs_migration_threshold} (${getThresholdLabel(cluster.drs_migration_threshold)})`} />
                  <SettingRow label="Power Management" value={cluster.drs_power_management ? 'Enabled' : 'Disabled'} />
                  <SettingRow label="Predictive DRS" value={cluster.drs_predictive_enabled ? 'Enabled' : 'Disabled'} />
                  <SettingRow label="VM Distribution" value={cluster.drs_vm_distribution_policy || 'balanced'} />
                </>
              )}
            </SettingsSection>

            {/* Storage Settings */}
            <SettingsSection title="Storage" icon={<HardDrive className="w-5 h-5" />}>
              <SettingRow label="Shared Storage Required" value={cluster.shared_storage_required ? 'Yes' : 'No'} />
              <SettingRow label="Default Storage Pool" value={cluster.default_storage_pool_id || 'None'} />
            </SettingsSection>

            {/* Network Settings */}
            <SettingsSection title="Network" icon={<Network className="w-5 h-5" />}>
              <SettingRow label="Default Network" value={cluster.default_network_id || 'None'} />
            </SettingsSection>

            {/* Edit Button */}
            <div className="flex justify-end">
              <Button onClick={() => setIsEditSettingsOpen(true)}>
                <Edit className="w-4 h-4" />
                Edit Settings
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Host Modal */}
      <AddHostToClusterModal
        isOpen={isAddHostModalOpen}
        onClose={() => setIsAddHostModalOpen(false)}
        onAddHost={handleAddHost}
        availableNodes={availableNodes}
        isLoading={addHostToCluster.isPending}
      />

      {/* Edit Settings Modal */}
      <EditClusterSettingsModal
        isOpen={isEditSettingsOpen}
        onClose={() => setIsEditSettingsOpen(false)}
        cluster={cluster}
        onUpdate={async (data) => {
          try {
            await updateCluster.mutateAsync({ id: cluster.id, ...data });
            toast.success('Cluster settings updated');
            setIsEditSettingsOpen(false);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update settings');
          }
        }}
        isLoading={updateCluster.isPending}
      />
    </div>
  );
}

// Helper components
function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  color,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'yellow' | 'red';
}) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
    yellow: 'bg-warning/10 text-warning',
    red: 'bg-error/10 text-error',
  };

  return (
    <div className="p-4 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>{icon}</div>
        <div>
          <p className="text-sm text-text-muted">{title}</p>
          <p className="text-xl font-bold text-text-primary">{value}</p>
          <p className="text-xs text-text-muted">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function ResourceCard({
  title,
  used,
  total,
  unit,
  icon,
}: {
  title: string;
  used: number;
  total: number;
  unit: 'GHz' | 'bytes';
  icon: React.ReactNode;
}) {
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  const formatValue = (val: number) => {
    if (unit === 'bytes') return formatBytes(val);
    return `${val.toFixed(1)} ${unit}`;
  };

  const getColor = (p: number) => {
    if (p >= 90) return 'bg-error';
    if (p >= 75) return 'bg-warning';
    return 'bg-accent';
  };

  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center gap-3 mb-4">
        {icon}
        <h4 className="font-medium text-text-primary">{title}</h4>
        <span className="ml-auto text-lg font-bold text-text-primary">{percent}%</span>
      </div>
      <div className="h-3 bg-bg-base rounded-full overflow-hidden mb-2">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.5 }}
          className={cn('h-full rounded-full', getColor(percent))}
        />
      </div>
      <div className="flex justify-between text-sm text-text-muted">
        <span>Used: {formatValue(used)}</span>
        <span>Total: {formatValue(total)}</span>
      </div>
    </div>
  );
}

function FeatureRow({
  title,
  enabled,
  description,
  icon,
}: {
  title: string;
  enabled: boolean;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-bg-base">
      <div className={cn('p-2 rounded-lg', enabled ? 'bg-success/10 text-success' : 'bg-bg-elevated text-text-muted')}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">{title}</span>
          <Badge variant={enabled ? 'success' : 'default'} className="text-xs">
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
        <p className="text-sm text-text-muted mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm text-text-primary', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}

function SettingsSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="p-5 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-accent">{icon}</span>
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SettingRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-bg-base">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm font-medium', highlight ? 'text-success' : 'text-text-primary')}>{value}</span>
    </div>
  );
}

// Add Host Modal
function AddHostToClusterModal({
  isOpen,
  onClose,
  onAddHost,
  availableNodes,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAddHost: (hostId: string) => void;
  availableNodes: ApiNode[];
  isLoading: boolean;
}) {
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-lg bg-bg-surface rounded-xl border border-border shadow-elevated overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Add Host to Cluster</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {availableNodes.length === 0 ? (
            <div className="text-center py-8">
              <Server className="w-10 h-10 text-text-muted mx-auto mb-3" />
              <p className="text-text-primary font-medium">No Available Hosts</p>
              <p className="text-sm text-text-muted mt-1">
                All hosts are already assigned to clusters.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {availableNodes.map((node) => {
                const isSelected = selectedHost === node.id;
                const isReady = node.status?.phase === 'READY' || node.status?.phase === 'NODE_PHASE_READY';
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedHost(node.id)}
                    className={cn(
                      'w-full p-3 rounded-lg border-2 text-left transition-all flex items-center gap-3',
                      isSelected
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-accent/50'
                    )}
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center',
                      isSelected ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted'
                    )}>
                      <Server className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary">{node.hostname || node.id}</span>
                        <Badge variant={isReady ? 'success' : 'warning'} className="text-xs">
                          {isReady ? 'Ready' : node.status?.phase}
                        </Badge>
                      </div>
                      <p className="text-xs text-text-muted">{node.managementIp}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => selectedHost && onAddHost(selectedHost)}
            disabled={!selectedHost || isLoading}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Host
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// Edit Settings Modal
function EditClusterSettingsModal({
  isOpen,
  onClose,
  cluster,
  onUpdate,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  cluster: Cluster;
  onUpdate: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    name: cluster.name,
    description: cluster.description,
    ha_enabled: cluster.ha_enabled,
    ha_admission_control: cluster.ha_admission_control,
    ha_failover_capacity: cluster.ha_failover_capacity,
    drs_enabled: cluster.drs_enabled,
    drs_mode: cluster.drs_mode as DRSMode,
    drs_migration_threshold: cluster.drs_migration_threshold,
  });

  // Reset form when modal opens
  useState(() => {
    if (isOpen) {
      setFormData({
        name: cluster.name,
        description: cluster.description,
        ha_enabled: cluster.ha_enabled,
        ha_admission_control: cluster.ha_admission_control,
        ha_failover_capacity: cluster.ha_failover_capacity,
        drs_enabled: cluster.drs_enabled,
        drs_mode: cluster.drs_mode as DRSMode,
        drs_migration_threshold: cluster.drs_migration_threshold,
      });
    }
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-xl bg-bg-surface rounded-xl border border-border shadow-elevated overflow-hidden max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Edit Cluster Settings</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto">
          {/* General */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-secondary">General</h3>
            <div>
              <label className="block text-sm text-text-muted mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary resize-none"
                rows={2}
              />
            </div>
          </div>

          {/* HA Settings */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-secondary">High Availability</h3>
              <button
                onClick={() => setFormData({ ...formData, ha_enabled: !formData.ha_enabled })}
                className={cn(
                  'w-10 h-5 rounded-full transition-colors relative',
                  formData.ha_enabled ? 'bg-success' : 'bg-bg-elevated'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  formData.ha_enabled ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>
            </div>
            {formData.ha_enabled && (
              <div className="space-y-3 pl-4 border-l-2 border-success/30">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-muted">Admission Control</span>
                  <button
                    onClick={() => setFormData({ ...formData, ha_admission_control: !formData.ha_admission_control })}
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative',
                      formData.ha_admission_control ? 'bg-success' : 'bg-bg-elevated'
                    )}
                  >
                    <div className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                      formData.ha_admission_control ? 'translate-x-5' : 'translate-x-0.5'
                    )} />
                  </button>
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">Host Failures to Tolerate</label>
                  <select
                    value={formData.ha_failover_capacity}
                    onChange={(e) => setFormData({ ...formData, ha_failover_capacity: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary"
                  >
                    <option value={1}>1 host failure</option>
                    <option value={2}>2 host failures</option>
                    <option value={3}>3 host failures</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* DRS Settings */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-secondary">DRS</h3>
              <button
                onClick={() => setFormData({ ...formData, drs_enabled: !formData.drs_enabled })}
                className={cn(
                  'w-10 h-5 rounded-full transition-colors relative',
                  formData.drs_enabled ? 'bg-accent' : 'bg-bg-elevated'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  formData.drs_enabled ? 'translate-x-5' : 'translate-x-0.5'
                )} />
              </button>
            </div>
            {formData.drs_enabled && (
              <div className="space-y-3 pl-4 border-l-2 border-accent/30">
                <div>
                  <label className="block text-sm text-text-muted mb-1">Automation Level</label>
                  <select
                    value={formData.drs_mode}
                    onChange={(e) => setFormData({ ...formData, drs_mode: e.target.value as DRSMode })}
                    className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary"
                  >
                    <option value="manual">Manual</option>
                    <option value="partially_automated">Partially Automated</option>
                    <option value="fully_automated">Fully Automated</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-text-muted mb-1">
                    Migration Threshold: {formData.drs_migration_threshold}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={formData.drs_migration_threshold}
                    onChange={(e) => setFormData({ ...formData, drs_migration_threshold: parseInt(e.target.value) })}
                    className="w-full accent-accent"
                  />
                  <div className="flex justify-between text-xs text-text-muted">
                    <span>Aggressive</span>
                    <span>Conservative</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onUpdate(formData)} disabled={isLoading}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Save Changes
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// Helper functions
function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1: return 'Lowest';
    case 2: return 'Low';
    case 3: return 'Medium';
    case 4: return 'High';
    case 5: return 'Highest';
    default: return 'Medium';
  }
}

function getIsolationLabel(response: number): string {
  switch (response) {
    case 0: return 'Leave Powered On';
    case 1: return 'Shutdown';
    case 2: return 'Power Off';
    default: return 'Shutdown';
  }
}

function getDRSModeLabel(mode: string): string {
  switch (mode) {
    case 'manual': return 'Manual';
    case 'partially_automated': return 'Partially Automated';
    case 'fully_automated': return 'Fully Automated';
    default: return mode;
  }
}

function getThresholdLabel(threshold: number): string {
  switch (threshold) {
    case 1: return 'Very Aggressive';
    case 2: return 'Aggressive';
    case 3: return 'Balanced';
    case 4: return 'Conservative';
    case 5: return 'Very Conservative';
    default: return 'Balanced';
  }
}
