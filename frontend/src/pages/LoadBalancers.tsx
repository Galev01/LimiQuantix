import { useState } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

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

const mockLoadBalancers: LoadBalancer[] = [
  {
    id: 'lb-web-01',
    name: 'Web Frontend LB',
    description: 'HTTP load balancer for web application frontend',
    vip: '10.0.1.100',
    networkId: 'net-prod',
    networkName: 'Production Network',
    algorithm: 'ROUND_ROBIN',
    protocol: 'HTTP',
    status: 'ACTIVE',
    listeners: [
      { id: 'lst-1', port: 80, protocol: 'HTTP', defaultPoolId: 'pool-web' },
      { id: 'lst-2', port: 443, protocol: 'HTTPS', defaultPoolId: 'pool-web' },
    ],
    members: [
      { id: 'm1', name: 'web-vm-01', address: '10.0.1.10', port: 8080, weight: 100, healthy: true },
      { id: 'm2', name: 'web-vm-02', address: '10.0.1.11', port: 8080, weight: 100, healthy: true },
      { id: 'm3', name: 'web-vm-03', address: '10.0.1.12', port: 8080, weight: 100, healthy: true },
    ],
    stats: {
      activeConnections: 156,
      totalConnections: 1234567,
      bytesIn: 1024 * 1024 * 1024 * 5,
      bytesOut: 1024 * 1024 * 1024 * 50,
      requestsPerSecond: 450,
    },
    createdAt: '2024-01-15',
  },
  {
    id: 'lb-api-01',
    name: 'API Gateway LB',
    description: 'TCP load balancer for API services',
    vip: '10.0.1.101',
    networkId: 'net-prod',
    networkName: 'Production Network',
    algorithm: 'LEAST_CONNECTIONS',
    protocol: 'TCP',
    status: 'ACTIVE',
    listeners: [
      { id: 'lst-3', port: 8443, protocol: 'TCP', defaultPoolId: 'pool-api' },
    ],
    members: [
      { id: 'm4', name: 'api-vm-01', address: '10.0.1.20', port: 8443, weight: 100, healthy: true },
      { id: 'm5', name: 'api-vm-02', address: '10.0.1.21', port: 8443, weight: 100, healthy: true },
    ],
    stats: {
      activeConnections: 89,
      totalConnections: 567890,
      bytesIn: 1024 * 1024 * 1024 * 2,
      bytesOut: 1024 * 1024 * 1024 * 10,
      requestsPerSecond: 200,
    },
    createdAt: '2024-02-01',
  },
  {
    id: 'lb-db-01',
    name: 'Database LB',
    description: 'TCP load balancer for PostgreSQL replicas',
    vip: '10.0.1.102',
    networkId: 'net-storage',
    networkName: 'Storage Network',
    algorithm: 'LEAST_CONNECTIONS',
    protocol: 'TCP',
    status: 'DEGRADED',
    listeners: [
      { id: 'lst-4', port: 5432, protocol: 'TCP', defaultPoolId: 'pool-db' },
    ],
    members: [
      { id: 'm6', name: 'db-vm-01', address: '10.0.2.10', port: 5432, weight: 100, healthy: true },
      { id: 'm7', name: 'db-vm-02', address: '10.0.2.11', port: 5432, weight: 100, healthy: false },
      { id: 'm8', name: 'db-vm-03', address: '10.0.2.12', port: 5432, weight: 100, healthy: true },
    ],
    stats: {
      activeConnections: 45,
      totalConnections: 234567,
      bytesIn: 1024 * 1024 * 512,
      bytesOut: 1024 * 1024 * 1024 * 20,
      requestsPerSecond: 50,
    },
    createdAt: '2024-01-20',
  },
];

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

  const filteredLBs = mockLoadBalancers.filter((lb) =>
    lb.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lb.vip.includes(searchQuery)
  );

  const totals = {
    loadBalancers: mockLoadBalancers.length,
    activeConnections: mockLoadBalancers.reduce((sum, lb) => sum + lb.stats.activeConnections, 0),
    healthyMembers: mockLoadBalancers.reduce(
      (sum, lb) => sum + lb.members.filter((m) => m.healthy).length,
      0
    ),
    totalMembers: mockLoadBalancers.reduce((sum, lb) => sum + lb.members.length, 0),
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
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button>
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
          value={mockLoadBalancers.reduce((sum, lb) => sum + lb.stats.requestsPerSecond, 0)}
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

      {/* Detail Panel */}
      {selectedLB && (
        <LBDetailPanel
          lb={mockLoadBalancers.find((l) => l.id === selectedLB)!}
          onClose={() => setSelectedLB(null)}
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
  const status = statusConfig[lb.status];
  const StatusIcon = status.icon;
  const algorithm = algorithmConfig[lb.algorithm];
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

function LBDetailPanel({ lb, onClose }: { lb: LoadBalancer; onClose: () => void }) {
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

export default LoadBalancers;
