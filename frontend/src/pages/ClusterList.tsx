import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  X,
  Loader2,
  Trash2,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useApiConnection } from '@/hooks/useDashboard';
import {
  useClusters,
  useCreateCluster,
  useDeleteCluster,
  toDisplayCluster,
  type CreateClusterRequest,
  type DRSMode,
} from '@/hooks/useClusters';
import { toast } from 'sonner';

const statusConfig = {
  HEALTHY: { color: 'success', icon: CheckCircle, label: 'Healthy' },
  WARNING: { color: 'warning', icon: AlertTriangle, label: 'Warning' },
  CRITICAL: { color: 'error', icon: XCircle, label: 'Critical' },
  MAINTENANCE: { color: 'info', icon: Settings, label: 'Maintenance' },
} as const;

export function ClusterList() {
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  
  const { data: isConnected = false } = useApiConnection();
  const { data: clustersResponse, isLoading, refetch, isRefetching } = useClusters();
  const deleteCluster = useDeleteCluster();
  
  const clusters = (clustersResponse?.clusters || []).map(toDisplayCluster);

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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete cluster "${name}"?`)) return;
    try {
      await deleteCluster.mutateAsync(id);
      toast.success('Cluster deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete cluster');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Clusters</h1>
          <p className="text-text-muted mt-1">Manage compute clusters and resource pools</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('w-4 h-4', isRefetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            New Cluster
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard title="Total Clusters" value={totals.clusters} icon={<Boxes className="w-5 h-5" />} color="blue" />
        <SummaryCard title="Total Hosts" value={totals.hosts} icon={<Server className="w-5 h-5" />} color="green" />
        <SummaryCard title="Total VMs" value={totals.vms} icon={<MonitorCog className="w-5 h-5" />} color="purple" />
        <SummaryCard title="Total Memory" value={formatBytes(totals.memoryBytes)} icon={<MemoryStick className="w-5 h-5" />} color="yellow" />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      )}

      {!isLoading && clusters.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {clusters.map((cluster, index) => (
            <ClusterCard
              key={cluster.id}
              cluster={cluster}
              index={index}
              isSelected={selectedCluster === cluster.id}
              onSelect={() => setSelectedCluster(cluster.id)}
              menuOpen={menuOpen === cluster.id}
              onMenuToggle={() => setMenuOpen(menuOpen === cluster.id ? null : cluster.id)}
              onDelete={() => handleDelete(cluster.id, cluster.name)}
            />
          ))}
        </div>
      )}

      {!isLoading && clusters.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12 bg-bg-surface rounded-xl border border-border"
        >
          <Boxes className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Clusters Found</h3>
          <p className="text-text-muted mb-4 max-w-md mx-auto">
            {!isConnected ? 'Connect to the backend to view clusters.' : 'Create your first cluster to organize hosts and enable HA/DRS features.'}
          </p>
          <Button size="sm" onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            Create Cluster
          </Button>
        </motion.div>
      )}

      <CreateClusterModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </div>
  );
}

function SummaryCard({ title, value, icon, color }: { title: string; value: string | number; icon: React.ReactNode; color: 'blue' | 'green' | 'purple' | 'yellow' }) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
    yellow: 'bg-warning/10 text-warning',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl bg-bg-surface border border-border shadow-floating">
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

interface DisplayCluster {
  id: string;
  name: string;
  description: string;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'MAINTENANCE';
  haEnabled: boolean;
  drsEnabled: boolean;
  hosts: { total: number; online: number; maintenance: number };
  vms: { total: number; running: number; stopped: number };
  resources: { cpuTotalGHz: number; cpuUsedGHz: number; memoryTotalBytes: number; memoryUsedBytes: number; storageTotalBytes: number; storageUsedBytes: number };
  createdAt: string;
}

function ClusterCard({ cluster, index, isSelected, onSelect, menuOpen, onMenuToggle, onDelete }: {
  cluster: DisplayCluster;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onDelete: () => void;
}) {
  const status = statusConfig[cluster.status];
  const StatusIcon = status.icon;
  const cpuPercent = cluster.resources.cpuTotalGHz > 0 ? Math.round((cluster.resources.cpuUsedGHz / cluster.resources.cpuTotalGHz) * 100) : 0;
  const memPercent = cluster.resources.memoryTotalBytes > 0 ? Math.round((cluster.resources.memoryUsedBytes / cluster.resources.memoryTotalBytes) * 100) : 0;
  const storagePercent = cluster.resources.storageTotalBytes > 0 ? Math.round((cluster.resources.storageUsedBytes / cluster.resources.storageTotalBytes) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      onClick={onSelect}
      className={cn('p-5 rounded-xl bg-bg-surface border border-border shadow-floating hover:shadow-elevated hover:border-border-hover transition-all cursor-pointer', isSelected && 'border-accent ring-1 ring-accent/30')}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Boxes className="w-5 h-5 text-accent" />
          </div>
          <div>
            <Link to={`/clusters/${cluster.id}`} className="text-lg font-semibold text-text-primary hover:text-accent transition-colors">{cluster.name}</Link>
            <p className="text-sm text-text-muted">{cluster.description || 'No description'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.color as 'success' | 'warning' | 'error' | 'info'}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {status.label}
          </Badge>
          <div className="relative">
            <button onClick={(e) => { e.stopPropagation(); onMenuToggle(); }} className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
              <MoreVertical className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-36 bg-bg-elevated border border-border rounded-lg shadow-lg z-10">
                <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 rounded-lg">
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-4">
        {cluster.haEnabled && <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-success/10 text-success text-xs"><Shield className="w-3 h-3" />HA Enabled</div>}
        {cluster.drsEnabled && <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-xs"><Zap className="w-3 h-3" />DRS Enabled</div>}
        {!cluster.haEnabled && !cluster.drsEnabled && <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-bg-base text-text-muted text-xs">Basic Cluster</div>}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4 p-3 rounded-lg bg-bg-base">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-text-muted mb-1"><Server className="w-3 h-3" /><span className="text-xs">Hosts</span></div>
          <p className="text-lg font-semibold text-text-primary">{cluster.hosts.online}/{cluster.hosts.total}</p>
          {cluster.hosts.maintenance > 0 && <p className="text-xs text-warning">{cluster.hosts.maintenance} in maintenance</p>}
        </div>
        <div className="text-center border-x border-border">
          <div className="flex items-center justify-center gap-1 text-text-muted mb-1"><MonitorCog className="w-3 h-3" /><span className="text-xs">VMs</span></div>
          <p className="text-lg font-semibold text-text-primary">{cluster.vms.total}</p>
          <p className="text-xs text-success">{cluster.vms.running} running</p>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 text-text-muted mb-1"><Activity className="w-3 h-3" /><span className="text-xs">Health</span></div>
          <p className={cn('text-lg font-semibold', `text-${status.color}`)}>{cpuPercent}%</p>
          <p className="text-xs text-text-muted">CPU load</p>
        </div>
      </div>

      <div className="space-y-3">
        <ResourceBar label="CPU" used={cpuPercent} icon={<Cpu className="w-3 h-3" />} />
        <ResourceBar label="Memory" used={memPercent} icon={<MemoryStick className="w-3 h-3" />} />
        <ResourceBar label="Storage" used={storagePercent} icon={<HardDrive className="w-3 h-3" />} />
      </div>
    </motion.div>
  );
}

function ResourceBar({ label, used, icon }: { label: string; used: number; icon: React.ReactNode }) {
  const getColor = (percent: number) => {
    if (percent >= 90) return 'bg-error';
    if (percent >= 75) return 'bg-warning';
    return 'bg-accent';
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1 w-20 text-text-muted text-xs">{icon}{label}</div>
      <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
        <motion.div initial={{ width: 0 }} animate={{ width: `${used}%` }} transition={{ duration: 0.5, delay: 0.2 }} className={cn('h-full rounded-full', getColor(used))} />
      </div>
      <span className="w-10 text-right text-xs text-text-secondary">{used}%</span>
    </div>
  );
}

function CreateClusterModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<CreateClusterRequest>({
    name: '',
    description: '',
    ha_enabled: false,
    ha_admission_control: true,
    ha_failover_capacity: 1,
    drs_enabled: false,
    drs_mode: 'manual',
    drs_migration_threshold: 3,
    shared_storage_required: false,
  });

  const createCluster = useCreateCluster();

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('Cluster name is required');
      return;
    }
    try {
      await createCluster.mutateAsync(formData);
      toast.success('Cluster created successfully');
      onClose();
      setStep(1);
      setFormData({ name: '', description: '', ha_enabled: false, ha_admission_control: true, ha_failover_capacity: 1, drs_enabled: false, drs_mode: 'manual', drs_migration_threshold: 3, shared_storage_required: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create cluster');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative z-10 w-full max-w-lg bg-bg-surface rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center"><Boxes className="w-5 h-5 text-accent" /></div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Create Cluster</h2>
              <p className="text-sm text-text-muted">{step === 1 && 'Basic information'}{step === 2 && 'High Availability settings'}{step === 3 && 'DRS settings'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex items-center gap-2 px-6 py-3 bg-bg-base">
          {[1, 2, 3].map((s) => (<div key={s} className={cn('flex-1 h-1 rounded-full transition-colors', s <= step ? 'bg-accent' : 'bg-bg-elevated')} />))}
        </div>

        <div className="p-6 min-h-[300px]">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Cluster Name <span className="text-error">*</span></label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Production Cluster" className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
                  <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Main production workloads..." rows={3} className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none resize-none" />
                </div>
                <div className="flex items-center gap-3 p-4 rounded-lg bg-info/10 border border-info/20">
                  <Shield className="w-5 h-5 text-info flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">About Clusters</p>
                    <p className="text-xs text-text-muted mt-1">Clusters group hosts together for HA (automatic VM restart on failure) and DRS (automatic load balancing).</p>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-bg-base border border-border">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-success" />
                    <div><p className="font-medium text-text-primary">Enable High Availability</p><p className="text-xs text-text-muted">Auto-restart VMs when a host fails</p></div>
                  </div>
                  <button onClick={() => setFormData({ ...formData, ha_enabled: !formData.ha_enabled })} className={cn('w-12 h-6 rounded-full transition-colors relative', formData.ha_enabled ? 'bg-success' : 'bg-bg-elevated')}>
                    <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white transition-transform', formData.ha_enabled ? 'translate-x-7' : 'translate-x-1')} />
                  </button>
                </div>
                {formData.ha_enabled && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pl-4 border-l-2 border-success/30">
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm font-medium text-text-secondary">Admission Control</p><p className="text-xs text-text-muted">Reserve resources for failover</p></div>
                      <button onClick={() => setFormData({ ...formData, ha_admission_control: !formData.ha_admission_control })} className={cn('w-10 h-5 rounded-full transition-colors relative', formData.ha_admission_control ? 'bg-success' : 'bg-bg-elevated')}>
                        <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform', formData.ha_admission_control ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Host Failures to Tolerate</label>
                      <select value={formData.ha_failover_capacity} onChange={(e) => setFormData({ ...formData, ha_failover_capacity: parseInt(e.target.value) })} className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none">
                        <option value={1}>1 host failure</option>
                        <option value={2}>2 host failures</option>
                        <option value={3}>3 host failures</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <div><p className="text-sm font-medium text-text-secondary">Shared Storage Required</p><p className="text-xs text-text-muted">Require shared storage for HA</p></div>
                      <button onClick={() => setFormData({ ...formData, shared_storage_required: !formData.shared_storage_required })} className={cn('w-10 h-5 rounded-full transition-colors relative', formData.shared_storage_required ? 'bg-success' : 'bg-bg-elevated')}>
                        <div className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform', formData.shared_storage_required ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-lg bg-bg-base border border-border">
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-accent" />
                    <div><p className="font-medium text-text-primary">Enable DRS</p><p className="text-xs text-text-muted">Distributed Resource Scheduler</p></div>
                  </div>
                  <button onClick={() => setFormData({ ...formData, drs_enabled: !formData.drs_enabled })} className={cn('w-12 h-6 rounded-full transition-colors relative', formData.drs_enabled ? 'bg-accent' : 'bg-bg-elevated')}>
                    <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white transition-transform', formData.drs_enabled ? 'translate-x-7' : 'translate-x-1')} />
                  </button>
                </div>
                {formData.drs_enabled && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pl-4 border-l-2 border-accent/30">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">Automation Level</label>
                      <select value={formData.drs_mode} onChange={(e) => setFormData({ ...formData, drs_mode: e.target.value as DRSMode })} className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none">
                        <option value="manual">Manual - Recommendations only</option>
                        <option value="partially_automated">Partially Automated - Apply low-impact</option>
                        <option value="fully_automated">Fully Automated - Apply all</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">Migration Threshold: {formData.drs_migration_threshold}</label>
                      <input type="range" min={1} max={5} value={formData.drs_migration_threshold} onChange={(e) => setFormData({ ...formData, drs_migration_threshold: parseInt(e.target.value) })} className="w-full accent-accent" />
                      <div className="flex justify-between text-xs text-text-muted mt-1"><span>Aggressive</span><span>Conservative</span></div>
                    </div>
                  </motion.div>
                )}
                <div className="p-4 rounded-lg bg-bg-base border border-border mt-4">
                  <p className="text-sm font-medium text-text-secondary mb-2">Summary</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-text-muted">Name:</span><span className="text-text-primary">{formData.name || '(not set)'}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">HA:</span><span className={formData.ha_enabled ? 'text-success' : 'text-text-muted'}>{formData.ha_enabled ? 'Enabled' : 'Disabled'}</span></div>
                    <div className="flex justify-between"><span className="text-text-muted">DRS:</span><span className={formData.drs_enabled ? 'text-accent' : 'text-text-muted'}>{formData.drs_enabled ? `Enabled (${formData.drs_mode})` : 'Disabled'}</span></div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elevated/50">
          <Button variant="ghost" onClick={() => { if (step === 1) onClose(); else setStep(step - 1); }}>{step === 1 ? 'Cancel' : 'Back'}</Button>
          <Button onClick={() => { if (step < 3) setStep(step + 1); else handleSubmit(); }} disabled={step === 1 && !formData.name.trim()}>
            {createCluster.isPending ? (<><Loader2 className="w-4 h-4 animate-spin mr-2" />Creating...</>) : step < 3 ? 'Next' : 'Create Cluster'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
