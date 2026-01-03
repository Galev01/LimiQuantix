import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network,
  Plus,
  RefreshCw,
  Search,
  MoreVertical,
  CheckCircle,
  AlertTriangle,
  Server,
  MonitorCog,
  Globe,
  Shield,
  Router,
  Wifi as WifiIcon,
  WifiOff,
  Cable,
  Settings,
  Trash2,
  Edit,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useNetworks, useDeleteNetwork, type ApiVirtualNetwork } from '@/hooks/useNetworks';
import { useApiConnection } from '@/hooks/useDashboard';

interface VirtualNetwork {
  id: string;
  name: string;
  description: string;
  type: 'OVERLAY' | 'VLAN' | 'EXTERNAL';
  status: 'ACTIVE' | 'PENDING' | 'ERROR';
  vlanId?: number;
  cidr: string;
  gateway: string;
  dhcpEnabled: boolean;
  connectedVMs: number;
  connectedPorts: number;
  quantrixSwitch: string;
  mtu: number;
  createdAt: string;
}

const mockNetworks: VirtualNetwork[] = [
  {
    id: 'net-prod',
    name: 'Production VLAN 100',
    description: 'Main production network for web servers and applications',
    type: 'VLAN',
    status: 'ACTIVE',
    vlanId: 100,
    cidr: '10.100.0.0/16',
    gateway: '10.100.0.1',
    dhcpEnabled: true,
    connectedVMs: 28,
    connectedPorts: 35,
    quantrixSwitch: 'qs-prod-01',
    mtu: 1500,
    createdAt: '2024-01-15',
  },
  {
    id: 'net-dev',
    name: 'Development VLAN 200',
    description: 'Development and testing environment network',
    type: 'VLAN',
    status: 'ACTIVE',
    vlanId: 200,
    cidr: '10.200.0.0/16',
    gateway: '10.200.0.1',
    dhcpEnabled: true,
    connectedVMs: 15,
    connectedPorts: 18,
    quantrixSwitch: 'qs-dev-01',
    mtu: 1500,
    createdAt: '2024-02-01',
  },
  {
    id: 'net-storage',
    name: 'Storage Network',
    description: 'Dedicated network for storage traffic (iSCSI/NFS)',
    type: 'VLAN',
    status: 'ACTIVE',
    vlanId: 300,
    cidr: '10.30.0.0/24',
    gateway: '10.30.0.1',
    dhcpEnabled: false,
    connectedVMs: 12,
    connectedPorts: 12,
    quantrixSwitch: 'qs-storage-01',
    mtu: 9000,
    createdAt: '2024-01-20',
  },
  {
    id: 'net-mgmt',
    name: 'Management Network',
    description: 'Out-of-band management for hypervisors and infrastructure',
    type: 'VLAN',
    status: 'ACTIVE',
    vlanId: 10,
    cidr: '192.168.1.0/24',
    gateway: '192.168.1.1',
    dhcpEnabled: false,
    connectedVMs: 0,
    connectedPorts: 8,
    quantrixSwitch: 'qs-mgmt-01',
    mtu: 1500,
    createdAt: '2024-01-10',
  },
  {
    id: 'net-overlay',
    name: 'Tenant Overlay',
    description: 'OVN overlay network for multi-tenant isolation',
    type: 'OVERLAY',
    status: 'ACTIVE',
    cidr: '172.16.0.0/12',
    gateway: '172.16.0.1',
    dhcpEnabled: true,
    connectedVMs: 8,
    connectedPorts: 10,
    quantrixSwitch: 'qs-overlay-01',
    mtu: 1400,
    createdAt: '2024-03-01',
  },
  {
    id: 'net-external',
    name: 'External / Internet',
    description: 'External network for public-facing services',
    type: 'EXTERNAL',
    status: 'ACTIVE',
    cidr: '203.0.113.0/24',
    gateway: '203.0.113.1',
    dhcpEnabled: false,
    connectedVMs: 5,
    connectedPorts: 5,
    quantrixSwitch: 'qs-border-01',
    mtu: 1500,
    createdAt: '2024-01-12',
  },
];

const typeConfig = {
  OVERLAY: { color: 'purple', icon: WifiIcon, label: 'Overlay' },
  VLAN: { color: 'blue', icon: Cable, label: 'VLAN' },
  EXTERNAL: { color: 'green', icon: Globe, label: 'External' },
} as const;

// Convert API network to display format
function apiToDisplayNetwork(net: ApiVirtualNetwork): VirtualNetwork {
  return {
    id: net.id,
    name: net.name,
    description: net.description || '',
    type: (net.spec?.type as 'OVERLAY' | 'VLAN' | 'EXTERNAL') || 'VLAN',
    status: (net.status?.phase as 'ACTIVE' | 'PENDING' | 'ERROR') || 'ACTIVE',
    vlanId: net.spec?.vlanId,
    cidr: net.spec?.cidr || '',
    gateway: net.spec?.gateway || '',
    dhcpEnabled: net.spec?.dhcpEnabled || false,
    connectedVMs: net.status?.usedIps || 0,
    connectedPorts: net.status?.portCount || 0,
    quantrixSwitch: 'qs-auto',
    mtu: 1500,
    createdAt: net.createdAt || new Date().toISOString(),
  };
}

const statusConfig = {
  ACTIVE: { color: 'success', icon: CheckCircle },
  PENDING: { color: 'warning', icon: AlertTriangle },
  ERROR: { color: 'error', icon: AlertTriangle },
} as const;

export function VirtualNetworks() {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'OVERLAY' | 'VLAN' | 'EXTERNAL'>('all');
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingNetwork, setEditingNetwork] = useState<VirtualNetwork | null>(null);

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiResponse, isLoading, refetch, isRefetching } = useNetworks({ enabled: !!isConnected });
  const deleteNetwork = useDeleteNetwork();

  // Determine data source
  const apiNetworks = apiResponse?.networks || [];
  const useMockData = !isConnected || apiNetworks.length === 0;
  const allNetworks: VirtualNetwork[] = useMockData ? mockNetworks : apiNetworks.map(apiToDisplayNetwork);

  const filteredNetworks = allNetworks.filter((net) => {
    const matchesSearch =
      net.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      net.cidr.includes(searchQuery);
    const matchesType = typeFilter === 'all' || net.type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Calculate totals
  const totals = {
    networks: allNetworks.length,
    vms: allNetworks.reduce((sum, n) => sum + n.connectedVMs, 0),
    ports: allNetworks.reduce((sum, n) => sum + n.connectedPorts, 0),
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this network?')) return;
    if (useMockData) {
      console.log('Mock: Delete network', id);
      return;
    }
    try {
      await deleteNetwork.mutateAsync(id);
    } catch (err) {
      console.error('Failed to delete network:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Virtual Networks</h1>
            <p className="text-text-muted mt-1">Manage QuantrixSwitch networks and connectivity</p>
          </div>
          {/* Connection Status */}
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
              isConnected
                ? 'bg-success/20 text-success border border-success/30'
                : 'bg-warning/20 text-warning border border-warning/30',
            )}
          >
            {isConnected ? <WifiIcon className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? 'Connected' : 'Mock Data'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isRefetching || isLoading}
          >
            <RefreshCw className={cn('w-4 h-4', (isRefetching || isLoading) && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            New Network
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          title="Total Networks"
          value={totals.networks}
          icon={<Network className="w-5 h-5" />}
          color="blue"
        />
        <SummaryCard
          title="Connected VMs"
          value={totals.vms}
          icon={<MonitorCog className="w-5 h-5" />}
          color="green"
        />
        <SummaryCard
          title="Active Ports"
          value={totals.ports}
          icon={<Cable className="w-5 h-5" />}
          color="purple"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search networks by name or CIDR..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'VLAN', 'OVERLAY', 'EXTERNAL'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                typeFilter === type
                  ? 'bg-accent text-white'
                  : 'bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              )}
            >
              {type === 'all' ? 'All Types' : type}
            </button>
          ))}
        </div>
      </div>

      {/* Network Table */}
      <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-bg-base">
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Network</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Type</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">CIDR</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Gateway</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">DHCP</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">VMs</th>
              <th className="text-left py-3 px-4 text-sm font-medium text-text-muted">Status</th>
              <th className="text-right py-3 px-4 text-sm font-medium text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredNetworks.map((network, index) => {
              const type = typeConfig[network.type];
              const TypeIcon = type.icon;
              const status = statusConfig[network.status];
              const StatusIcon = status.icon;

              return (
                <motion.tr
                  key={network.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => setSelectedNetwork(network.id)}
                  className={cn(
                    'border-b border-border last:border-0 cursor-pointer transition-colors',
                    selectedNetwork === network.id
                      ? 'bg-accent/5'
                      : 'hover:bg-bg-hover'
                  )}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                        <Network className="w-4 h-4 text-accent" />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">{network.name}</p>
                        <p className="text-xs text-text-muted truncate max-w-[200px]">
                          {network.description}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <TypeIcon className={cn('w-4 h-4', `text-${type.color}-400`)} />
                      <span className="text-sm text-text-secondary">{type.label}</span>
                      {network.vlanId && (
                        <span className="text-xs text-text-muted">({network.vlanId})</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <code className="text-sm text-accent font-mono">{network.cidr}</code>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-text-secondary font-mono">{network.gateway}</span>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={network.dhcpEnabled ? 'success' : 'default'}>
                      {network.dhcpEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-text-secondary">{network.connectedVMs}</span>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant={status.color as any}>
                      <StatusIcon className="w-3 h-3 mr-1" />
                      {network.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <button 
                        onClick={(e) => { e.stopPropagation(); setEditingNetwork(network); setIsEditModalOpen(true); }}
                        className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
                        <Settings className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDelete(network.id); }}
                        className="p-1.5 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Network Details Panel (when selected) */}
      {selectedNetwork && (
        <NetworkDetailPanel
          network={mockNetworks.find((n) => n.id === selectedNetwork)!}
          onClose={() => setSelectedNetwork(null)}
        />
      )}

      {/* Create Network Modal */}
      <CreateNetworkModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={(data) => {
          console.log('Create network:', data);
          setIsCreateModalOpen(false);
        }}
      />

      {/* Edit Network Modal */}
      {editingNetwork && (
        <EditNetworkModal
          isOpen={isEditModalOpen}
          onClose={() => { setIsEditModalOpen(false); setEditingNetwork(null); }}
          network={editingNetwork}
          onSubmit={(data) => {
            console.log('Update network:', data);
            setIsEditModalOpen(false);
            setEditingNetwork(null);
          }}
        />
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
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
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

function NetworkDetailPanel({
  network,
  onClose,
}: {
  network: VirtualNetwork;
  onClose: () => void;
}) {
  const type = typeConfig[network.type];
  const TypeIcon = type.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-xl bg-bg-surface border border-border"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Network className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{network.name}</h3>
            <p className="text-sm text-text-muted">{network.description}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DetailItem label="Type" value={type.label} icon={<TypeIcon className="w-4 h-4" />} />
        <DetailItem label="CIDR" value={network.cidr} />
        <DetailItem label="Gateway" value={network.gateway} />
        <DetailItem label="VLAN ID" value={network.vlanId?.toString() || 'N/A'} />
        <DetailItem label="MTU" value={`${network.mtu}`} />
        <DetailItem label="QuantrixSwitch" value={network.quantrixSwitch} />
        <DetailItem label="Connected VMs" value={network.connectedVMs.toString()} />
        <DetailItem label="Active Ports" value={network.connectedPorts.toString()} />
      </div>
    </motion.div>
  );
}

function DetailItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-bg-base">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <div className="flex items-center gap-2">
        {icon && <span className="text-accent">{icon}</span>}
        <span className="text-sm font-medium text-text-primary">{value}</span>
      </div>
    </div>
  );
}

// Create Network Modal
function CreateNetworkModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<VirtualNetwork>) => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'VLAN' as 'VLAN' | 'OVERLAY' | 'EXTERNAL',
    vlanId: '',
    cidr: '',
    gateway: '',
    dhcpEnabled: true,
    mtu: '1500',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      description: formData.description,
      type: formData.type,
      vlanId: formData.vlanId ? parseInt(formData.vlanId) : undefined,
      cidr: formData.cidr,
      gateway: formData.gateway,
      dhcpEnabled: formData.dhcpEnabled,
      mtu: parseInt(formData.mtu),
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
            <h2 className="text-lg font-semibold text-text-primary">Create Virtual Network</h2>
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
                placeholder="Production Network"
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
                placeholder="Network for production workloads"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  className="form-input w-full"
                >
                  <option value="VLAN">VLAN</option>
                  <option value="OVERLAY">Overlay (Geneve)</option>
                  <option value="EXTERNAL">External</option>
                </select>
              </div>

              {formData.type === 'VLAN' && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">VLAN ID</label>
                  <input
                    type="number"
                    value={formData.vlanId}
                    onChange={(e) => setFormData({ ...formData, vlanId: e.target.value })}
                    className="form-input w-full"
                    placeholder="100"
                    min="1"
                    max="4094"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">CIDR</label>
                <input
                  type="text"
                  value={formData.cidr}
                  onChange={(e) => setFormData({ ...formData, cidr: e.target.value })}
                  className="form-input w-full"
                  placeholder="10.0.0.0/24"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Gateway</label>
                <input
                  type="text"
                  value={formData.gateway}
                  onChange={(e) => setFormData({ ...formData, gateway: e.target.value })}
                  className="form-input w-full"
                  placeholder="10.0.0.1"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">MTU</label>
                <input
                  type="number"
                  value={formData.mtu}
                  onChange={(e) => setFormData({ ...formData, mtu: e.target.value })}
                  className="form-input w-full"
                  min="576"
                  max="9000"
                />
              </div>

              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.dhcpEnabled}
                    onChange={(e) => setFormData({ ...formData, dhcpEnabled: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-sm text-text-secondary">Enable DHCP</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Create Network
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// Edit Network Modal
function EditNetworkModal({
  isOpen,
  onClose,
  network,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  network: VirtualNetwork;
  onSubmit: (data: Partial<VirtualNetwork>) => void;
}) {
  const [formData, setFormData] = useState({
    name: network.name,
    description: network.description,
    dhcpEnabled: network.dhcpEnabled,
    mtu: network.mtu.toString(),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      id: network.id,
      name: formData.name,
      description: formData.description,
      dhcpEnabled: formData.dhcpEnabled,
      mtu: parseInt(formData.mtu),
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
            <h2 className="text-lg font-semibold text-text-primary">Edit Network: {network.name}</h2>
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
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Type</label>
                <input
                  type="text"
                  value={network.type}
                  className="form-input w-full bg-bg-base cursor-not-allowed"
                  disabled
                />
                <p className="text-xs text-text-muted mt-1">Type cannot be changed</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">CIDR</label>
                <input
                  type="text"
                  value={network.cidr}
                  className="form-input w-full bg-bg-base cursor-not-allowed"
                  disabled
                />
                <p className="text-xs text-text-muted mt-1">CIDR cannot be changed</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">MTU</label>
                <input
                  type="number"
                  value={formData.mtu}
                  onChange={(e) => setFormData({ ...formData, mtu: e.target.value })}
                  className="form-input w-full"
                  min="576"
                  max="9000"
                />
              </div>

              <div className="flex items-center pt-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.dhcpEnabled}
                    onChange={(e) => setFormData({ ...formData, dhcpEnabled: e.target.checked })}
                    className="form-checkbox"
                  />
                  <span className="text-sm text-text-secondary">Enable DHCP</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Save Changes
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

