import { useState } from 'react';
import { motion } from 'framer-motion';
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
  Wifi,
  Cable,
  Settings,
  Trash2,
  Edit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

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
  OVERLAY: { color: 'purple', icon: Wifi, label: 'Overlay' },
  VLAN: { color: 'blue', icon: Cable, label: 'VLAN' },
  EXTERNAL: { color: 'green', icon: Globe, label: 'External' },
} as const;

const statusConfig = {
  ACTIVE: { color: 'success', icon: CheckCircle },
  PENDING: { color: 'warning', icon: AlertTriangle },
  ERROR: { color: 'error', icon: AlertTriangle },
} as const;

export function VirtualNetworks() {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'OVERLAY' | 'VLAN' | 'EXTERNAL'>('all');
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);

  const filteredNetworks = mockNetworks.filter((net) => {
    const matchesSearch =
      net.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      net.cidr.includes(searchQuery);
    const matchesType = typeFilter === 'all' || net.type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Calculate totals
  const totals = {
    networks: mockNetworks.length,
    vms: mockNetworks.reduce((sum, n) => sum + n.connectedVMs, 0),
    ports: mockNetworks.reduce((sum, n) => sum + n.connectedPorts, 0),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Virtual Networks</h1>
          <p className="text-text-muted mt-1">Manage QuantrixSwitch networks and connectivity</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button>
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
                      <button className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
                        <Edit className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors">
                        <Settings className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors">
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

