import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scale,
  Plus,
  RefreshCw,
  Search,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Server,
  Activity,
  ArrowDownUp,
  Settings,
  Trash2,
  Edit,
  Loader2,
  Shield,
  X,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showSuccess, showError } from '@/lib/toast';
import { useApiConnection } from '@/hooks/useDashboard';
import {
  useLoadBalancers,
  useCreateLoadBalancer,
  useDeleteLoadBalancer,
  useLoadBalancerStats,
  useAddPoolMember,
  useRemovePoolMember,
  type ApiLoadBalancer,
} from '@/hooks/useLoadBalancers';

// Internal UI types (mapped from API types)
interface LoadBalancer {
  id: string;
  name: string;
  description: string;
  vip: string;
  networkId: string;
  networkName: string;
  algorithm: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS' | 'SOURCE_IP';
  protocol: 'TCP' | 'UDP' | 'HTTP' | 'HTTPS';
  status: 'ACTIVE' | 'PENDING' | 'DEGRADED' | 'ERROR';
  listeners: LBListener[];
  members: LBMember[];
  stats: LBStats;
  createdAt: string;
}

interface LBListener {
  id: string;
  port: number;
  protocol: string;
  defaultPoolId: string;
}

interface LBMember {
  id: string;
  name: string;
  address: string;
  port: number;
  weight: number;
  healthy: boolean;
}

interface LBStats {
  activeConnections: number;
  totalConnections: number;
  bytesIn: number;
  bytesOut: number;
  requestsPerSecond: number;
}

// Convert API types to UI types
function mapApiToUI(apiLb: ApiLoadBalancer): LoadBalancer {
  const listeners: LBListener[] = (apiLb.spec?.listeners || []).map((l) => ({
    id: l.id || '',
    port: l.port || 0,
    protocol: l.protocol || 'TCP',
    defaultPoolId: l.defaultPoolId || '',
  }));

  // Flatten members from all pools
  const members: LBMember[] = [];
  for (const pool of apiLb.spec?.pools || []) {
    for (const m of pool.members || []) {
      members.push({
        id: m.id || '',
        name: m.address,
        address: m.address,
        port: m.port,
        weight: m.weight || 1,
        healthy: m.adminStateUp !== false, // Default to healthy if not specified
      });
    }
  }

  // Get algorithm from first pool
  const algorithm = (apiLb.spec?.pools?.[0]?.algorithm || 'ROUND_ROBIN') as LoadBalancer['algorithm'];

  // Map status
  let status: LoadBalancer['status'] = 'PENDING';
  switch (apiLb.status?.phase) {
    case 'ACTIVE':
      status = 'ACTIVE';
      break;
    case 'ERROR':
      status = 'ERROR';
      break;
    case 'PENDING':
      status = 'PENDING';
      break;
    default:
      status = 'PENDING';
  }

  return {
    id: apiLb.id,
    name: apiLb.name,
    description: apiLb.description || '',
    vip: apiLb.status?.vipAddress || apiLb.spec?.vipAddress || '',
    networkId: apiLb.spec?.networkId || '',
    networkName: apiLb.spec?.networkId || 'Unknown',
    algorithm,
    protocol: (listeners[0]?.protocol || 'TCP') as LoadBalancer['protocol'],
    status,
    listeners,
    members,
    stats: {
      activeConnections: 0,
      totalConnections: 0,
      bytesIn: 0,
      bytesOut: 0,
      requestsPerSecond: 0,
    },
    createdAt: apiLb.createdAt || new Date().toISOString(),
  };
}

const algorithmConfig = {
  ROUND_ROBIN: { label: 'Round Robin', color: 'blue' },
  LEAST_CONNECTIONS: { label: 'Least Connections', color: 'purple' },
  SOURCE_IP: { label: 'Source IP', color: 'green' },
};

const statusConfig = {
  ACTIVE: { color: 'success', icon: CheckCircle },
  PENDING: { color: 'warning', icon: Loader2 },
  DEGRADED: { color: 'warning', icon: AlertTriangle },
  ERROR: { color: 'error', icon: XCircle },
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function LoadBalancers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLB, setSelectedLB] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  // API connection
  const { data: connectionData } = useApiConnection();
  const isConnected = connectionData?.isConnected ?? false;
  
  // Fetch load balancers from API
  const {
    data: lbResponse,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useLoadBalancers({
    enabled: isConnected,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
  
  // Mutations
  const createMutation = useCreateLoadBalancer();
  const deleteMutation = useDeleteLoadBalancer();
  
  // Map API response to UI format
  const loadBalancers: LoadBalancer[] = (lbResponse?.loadBalancers || []).map(mapApiToUI);

  const filteredLBs = loadBalancers.filter((lb) =>
    lb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lb.vip.includes(searchQuery)
  );

  const totals = {
    loadBalancers: loadBalancers.length,
    activeConnections: loadBalancers.reduce((sum, lb) => sum + lb.stats.activeConnections, 0),
    healthyMembers: loadBalancers.reduce(
      (sum, lb) => sum + lb.members.filter((m) => m.healthy).length,
      0
    ),
    totalMembers: loadBalancers.reduce((sum, lb) => sum + lb.members.length, 0),
  };
  
  // Handle create
  const handleCreate = (data: Partial<LoadBalancer>) => {
    createMutation.mutate(
      {
        name: data.name || '',
        description: data.description,
        projectId: 'default',
        spec: {
          networkId: data.networkId,
          vipAddress: data.vip,
          listeners: [
            {
              protocol: data.protocol || 'TCP',
              port: 80, // Default port, can be updated from form
            },
          ],
          pools: [
            {
              name: 'default-pool',
              algorithm: data.algorithm || 'ROUND_ROBIN',
            },
          ],
        },
      },
      {
        onSuccess: () => setIsCreateModalOpen(false),
      }
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Load Balancers</h1>
          <p className="text-text-muted mt-1">L4 load balancing via OVN</p>
        </div>
        <div className="flex items-center gap-3">
          {!isConnected && (
            <Badge variant="warning">
              <WifiOff className="w-3 h-3 mr-1" />
              Disconnected
            </Badge>
          )}
          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            onClick={() => setIsCreateModalOpen(true)}
            disabled={!isConnected}
          >
            <Plus className="w-4 h-4" />
            New Load Balancer
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="Load Balancers"
          value={totals.loadBalancers}
          icon={<Scale className="w-5 h-5" />}
          color="blue"
        />
        <SummaryCard
          title="Active Connections"
          value={totals.activeConnections}
          icon={<ArrowDownUp className="w-5 h-5" />}
          color="green"
        />
        <SummaryCard
          title="Healthy Members"
          value={`${totals.healthyMembers}/${totals.totalMembers}`}
          icon={<CheckCircle className="w-5 h-5" />}
          color="purple"
        />
        <SummaryCard
          title="Total RPS"
          value={loadBalancers.reduce((sum, lb) => sum + lb.stats.requestsPerSecond, 0)}
          icon={<Activity className="w-5 h-5" />}
          color="orange"
          suffix="/s"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search load balancers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="form-input pl-10"
        />
      </div>

      {/* Load Balancer Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <span className="ml-3 text-text-muted">Loading load balancers...</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12">
          <AlertTriangle className="w-12 h-12 text-warning mb-4" />
          <p className="text-text-primary font-medium">Failed to load load balancers</p>
          <p className="text-text-muted text-sm mt-1">{(error as Error).message}</p>
          <Button variant="secondary" className="mt-4" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      ) : filteredLBs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <Scale className="w-12 h-12 text-text-muted mb-4" />
          <p className="text-text-primary font-medium">No load balancers found</p>
          <p className="text-text-muted text-sm mt-1">
            {searchQuery ? 'Try a different search term' : 'Create your first load balancer to get started'}
          </p>
          {!searchQuery && (
            <Button className="mt-4" onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="w-4 h-4" />
              Create Load Balancer
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredLBs.map((lb, index) => (
            <LoadBalancerCard
              key={lb.id}
              lb={lb}
              index={index}
              isSelected={selectedLB === lb.id}
              onClick={() => setSelectedLB(lb.id === selectedLB ? null : lb.id)}
            />
          ))}
        </div>
      )}

      {/* Detail Panel */}
      {selectedLB && (
        <LBDetailPanel
          lb={loadBalancers.find((l) => l.id === selectedLB)!}
          onClose={() => setSelectedLB(null)}
          onDelete={() => {
            deleteMutation.mutate(selectedLB, {
              onSuccess: () => setSelectedLB(null),
            });
          }}
        />
      )}

      {/* Create Load Balancer Modal */}
      <CreateLoadBalancerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreate}
        isLoading={createMutation.isPending}
      />
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  color,
  suffix,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'orange';
  suffix?: string;
}) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
    orange: 'bg-orange-500/10 text-orange-400',
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
          <p className="text-xl font-bold text-text-primary">
            {value}{suffix}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function LoadBalancerCard({
  lb,
  index,
  isSelected,
  onClick,
}: {
  lb: LoadBalancer;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const status = statusConfig[lb.status] || { color: 'default', icon: AlertTriangle };
  const StatusIcon = status.icon;
  const algorithm = algorithmConfig[lb.algorithm] || { label: lb.algorithm || 'Unknown', color: 'blue' };
  const healthyCount = lb.members.filter((m) => m.healthy).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={onClick}
      className={cn(
        'p-5 rounded-xl bg-bg-surface border border-border cursor-pointer transition-all',
        isSelected ? 'ring-2 ring-accent shadow-elevated' : 'hover:shadow-floating-hover'
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Scale className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{lb.name}</h3>
            <p className="text-sm text-text-muted">{lb.description}</p>
          </div>
        </div>
        <Badge variant={status.color as any}>
          <StatusIcon className={cn('w-3 h-3 mr-1', lb.status === 'PENDING' && 'animate-spin')} />
          {lb.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-text-muted mb-1">VIP Address</p>
          <code className="text-sm text-accent font-mono">{lb.vip}</code>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Algorithm</p>
          <Badge variant="default">{algorithm.label}</Badge>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Listeners</p>
          <div className="flex gap-1">
            {lb.listeners.map((l) => (
              <Badge key={l.id} variant="default">
                {l.port}/{l.protocol}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Members</p>
          <span className="text-sm text-text-secondary">
            {healthyCount}/{lb.members.length} healthy
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <span className="text-text-muted">
            <Activity className="w-4 h-4 inline mr-1" />
            {lb.stats.activeConnections} active
          </span>
          <span className="text-text-muted">
            <ArrowDownUp className="w-4 h-4 inline mr-1" />
            {lb.stats.requestsPerSecond}/s
          </span>
        </div>
        <span className="text-text-muted">{lb.networkName}</span>
      </div>
    </motion.div>
  );
}

function LBDetailPanel({
  lb,
  onClose,
  onDelete,
}: {
  lb: LoadBalancer;
  onClose: () => void;
  onDelete?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-xl bg-bg-surface border border-border"
    >
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
            <Scale className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{lb.name}</h3>
            <p className="text-sm text-text-muted">VIP: {lb.vip}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">
            <Edit className="w-4 h-4" />
            Edit
          </Button>
          <Button variant="secondary" size="sm">
            <Settings className="w-4 h-4" />
            Configure
          </Button>
          {onDelete && (
            <Button variant="secondary" size="sm" onClick={onDelete}>
              <Trash2 className="w-4 h-4 text-error" />
              Delete
            </Button>
          )}
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <StatBox label="Active Connections" value={lb.stats.activeConnections.toString()} />
        <StatBox label="Total Connections" value={lb.stats.totalConnections.toLocaleString()} />
        <StatBox label="Traffic In" value={formatBytes(lb.stats.bytesIn)} />
        <StatBox label="Traffic Out" value={formatBytes(lb.stats.bytesOut)} />
        <StatBox label="Requests/sec" value={lb.stats.requestsPerSecond.toString()} />
      </div>

      {/* Members Table */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-text-secondary mb-3">Backend Members</h4>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-base">
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Name</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Address</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Port</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Weight</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Health</th>
              </tr>
            </thead>
            <tbody>
              {lb.members.map((member) => (
                <tr key={member.id} className="border-t border-border">
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <Server className="w-4 h-4 text-text-muted" />
                      <span className="text-sm text-text-primary">{member.name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-4">
                    <code className="text-sm text-text-secondary">{member.address}</code>
                  </td>
                  <td className="py-2 px-4 text-sm text-text-secondary">{member.port}</td>
                  <td className="py-2 px-4 text-sm text-text-secondary">{member.weight}</td>
                  <td className="py-2 px-4">
                    <Badge variant={member.healthy ? 'success' : 'error'}>
                      {member.healthy ? (
                        <>
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Healthy
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3 h-3 mr-1" />
                          Unhealthy
                        </>
                      )}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm">
          <Plus className="w-4 h-4" />
          Add Member
        </Button>
        <Button variant="secondary" size="sm">
          <Shield className="w-4 h-4" />
          Health Check Settings
        </Button>
      </div>
    </motion.div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-bg-base">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-lg font-bold text-text-primary">{value}</p>
    </div>
  );
}

// Create Load Balancer Modal
function CreateLoadBalancerModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<LoadBalancer>) => void;
  isLoading?: boolean;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    vip: '',
    networkId: 'net-prod',
    algorithm: 'ROUND_ROBIN' as 'ROUND_ROBIN' | 'LEAST_CONNECTIONS' | 'SOURCE_IP',
    protocol: 'TCP' as 'TCP' | 'UDP' | 'HTTP' | 'HTTPS',
    listenerPort: '80',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      description: formData.description,
      vip: formData.vip,
      networkId: formData.networkId,
      algorithm: formData.algorithm,
      protocol: formData.protocol,
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-bg-surface rounded-xl border border-border shadow-elevated"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">Create Load Balancer</h2>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="form-input w-full"
                placeholder="Web Frontend LB"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="form-input w-full"
                placeholder="Load balancer for web application"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">VIP Address</label>
                <input
                  type="text"
                  value={formData.vip}
                  onChange={(e) => setFormData({ ...formData, vip: e.target.value })}
                  className="form-input w-full"
                  placeholder="10.0.1.100"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Listener Port</label>
                <input
                  type="number"
                  value={formData.listenerPort}
                  onChange={(e) => setFormData({ ...formData, listenerPort: e.target.value })}
                  className="form-input w-full"
                  placeholder="80"
                  min="1"
                  max="65535"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Protocol</label>
                <select
                  value={formData.protocol}
                  onChange={(e) => setFormData({ ...formData, protocol: e.target.value as any })}
                  className="form-input w-full"
                >
                  <option value="TCP">TCP</option>
                  <option value="UDP">UDP</option>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Algorithm</label>
                <select
                  value={formData.algorithm}
                  onChange={(e) => setFormData({ ...formData, algorithm: e.target.value as any })}
                  className="form-input w-full"
                >
                  <option value="ROUND_ROBIN">Round Robin</option>
                  <option value="LEAST_CONNECTIONS">Least Connections</option>
                  <option value="SOURCE_IP">Source IP Hash</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Network</label>
              <select
                value={formData.networkId}
                onChange={(e) => setFormData({ ...formData, networkId: e.target.value })}
                className="form-input w-full"
              >
                <option value="net-prod">Production Network (10.100.0.0/16)</option>
                <option value="net-dev">Development Network (10.200.0.0/16)</option>
                <option value="net-storage">Storage Network (10.30.0.0/24)</option>
              </select>
            </div>

            <div className="p-4 rounded-lg bg-bg-base">
              <h4 className="text-sm font-medium text-text-secondary mb-2">Next Steps</h4>
              <p className="text-xs text-text-muted">
                After creating the load balancer, you'll be able to add backend members 
                and configure health checks from the detail panel.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Load Balancer'
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default LoadBalancers;
