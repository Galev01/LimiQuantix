import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Plus,
  RefreshCw,
  Search,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Key,
  Link,
  Globe,
  Lock,
  Loader2,
  Copy,
  Download,
  Server,
  Activity,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showInfo } from '@/lib/toast';
import { useApiConnection } from '@/hooks/useDashboard';

interface VPNService {
  id: string;
  name: string;
  description: string;
  type: 'WIREGUARD' | 'IPSEC';
  status: 'ACTIVE' | 'PENDING' | 'DOWN' | 'ERROR';
  endpoint: string;
  publicKey: string;
  networkId: string;
  networkName: string;
  allowedNetworks: string[];
  connections: VPNConnection[];
  stats: VPNStats;
  createdAt: string;
}

interface VPNConnection {
  id: string;
  name: string;
  clientPublicKey: string;
  allowedIPs: string[];
  lastHandshake: string | null;
  status: 'CONNECTED' | 'DISCONNECTED' | 'HANDSHAKING';
  transferRx: number;
  transferTx: number;
}

interface VPNStats {
  totalConnections: number;
  activeConnections: number;
  bytesIn: number;
  bytesOut: number;
}

const typeConfig = {
  WIREGUARD: { label: 'WireGuard', color: 'purple', icon: Shield },
  IPSEC: { label: 'IPsec', color: 'blue', icon: Lock },
};

const statusConfig = {
  ACTIVE: { color: 'success', icon: CheckCircle },
  PENDING: { color: 'warning', icon: Loader2 },
  DOWN: { color: 'error', icon: XCircle },
  ERROR: { color: 'error', icon: AlertTriangle },
};

const connectionStatusConfig = {
  CONNECTED: { color: 'success', icon: CheckCircle },
  DISCONNECTED: { color: 'default', icon: XCircle },
  HANDSHAKING: { color: 'warning', icon: Loader2 },
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

export function VPNServices() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVPN, setSelectedVPN] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  // API connection
  const { data: isConnected = false } = useApiConnection();
  
  // TODO: Replace with real API hook when VPN service is implemented
  // For now, show empty state (no mock data)
  const vpnServices: VPNService[] = [];

  const filteredVPNs = vpnServices.filter((vpn) =>
    vpn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    vpn.endpoint.includes(searchQuery)
  );

  const totals = {
    vpnServices: vpnServices.length,
    activeConnections: vpnServices.reduce((sum, vpn) => sum + vpn.stats.activeConnections, 0),
    totalConnections: vpnServices.reduce((sum, vpn) => sum + vpn.stats.totalConnections, 0),
    totalTraffic: vpnServices.reduce(
      (sum, vpn) => sum + vpn.stats.bytesIn + vpn.stats.bytesOut,
      0
    ),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">VPN Services</h1>
          <p className="text-text-muted mt-1">WireGuard bastion and site-to-site VPN management</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            New VPN Service
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="VPN Services"
          value={totals.vpnServices}
          icon={<Shield className="w-5 h-5" />}
          color="purple"
        />
        <SummaryCard
          title="Active Connections"
          value={totals.activeConnections}
          icon={<Link className="w-5 h-5" />}
          color="green"
        />
        <SummaryCard
          title="Total Clients"
          value={totals.totalConnections}
          icon={<Key className="w-5 h-5" />}
          color="blue"
        />
        <SummaryCard
          title="Total Traffic"
          value={formatBytes(totals.totalTraffic)}
          icon={<Activity className="w-5 h-5" />}
          color="orange"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search VPN services..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="form-input pl-10"
        />
      </div>

      {/* VPN Service Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredVPNs.map((vpn, index) => (
          <VPNServiceCard
            key={vpn.id}
            vpn={vpn}
            index={index}
            isSelected={selectedVPN === vpn.id}
            onClick={() => setSelectedVPN(vpn.id === selectedVPN ? null : vpn.id)}
          />
        ))}
      </div>

      {/* Detail Panel */}
      {selectedVPN && (
        <VPNDetailPanel
          vpn={vpnServices.find((v) => v.id === selectedVPN)!}
          onClose={() => setSelectedVPN(null)}
        />
      )}

      {/* Create VPN Service Modal */}
      <CreateVPNModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={(data) => {
          showInfo(`Demo mode: VPN service "${data.name}" created (simulated)`);
          setIsCreateModalOpen(false);
        }}
      />
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
  value: number | string;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple' | 'orange';
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
          <p className="text-xl font-bold text-text-primary">{value}</p>
        </div>
      </div>
    </motion.div>
  );
}

function VPNServiceCard({
  vpn,
  index,
  isSelected,
  onClick,
}: {
  vpn: VPNService;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const status = statusConfig[vpn.status] || { color: 'default', icon: AlertTriangle };
  const StatusIcon = status.icon;
  const type = typeConfig[vpn.type] || { label: vpn.type || 'Unknown', color: 'blue', icon: Shield };
  const TypeIcon = type.icon;

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
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <TypeIcon className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{vpn.name}</h3>
            <p className="text-sm text-text-muted">{vpn.description}</p>
          </div>
        </div>
        <Badge variant={status.color as any}>
          <StatusIcon className={cn('w-3 h-3 mr-1', vpn.status === 'PENDING' && 'animate-spin')} />
          {vpn.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-text-muted mb-1">Endpoint</p>
          <code className="text-sm text-accent font-mono">{vpn.endpoint}</code>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Type</p>
          <Badge variant="default">{type.label}</Badge>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Allowed Networks</p>
          <div className="flex gap-1 flex-wrap">
            {vpn.allowedNetworks.slice(0, 2).map((net, i) => (
              <code key={i} className="text-xs text-text-secondary">
                {net}
              </code>
            ))}
            {vpn.allowedNetworks.length > 2 && (
              <span className="text-xs text-text-muted">+{vpn.allowedNetworks.length - 2}</span>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Connections</p>
          <span className="text-sm text-text-secondary">
            {vpn.stats.activeConnections}/{vpn.stats.totalConnections} active
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-text-muted">
          <Activity className="w-4 h-4 inline mr-1" />
          {formatBytes(vpn.stats.bytesIn + vpn.stats.bytesOut)} transferred
        </span>
        <span className="text-text-muted">{vpn.networkName}</span>
      </div>
    </motion.div>
  );
}

function VPNDetailPanel({ vpn, onClose }: { vpn: VPNService; onClose: () => void }) {
  const type = typeConfig[vpn.type] || { label: vpn.type || 'Unknown', color: 'blue', icon: Shield };
  const TypeIcon = type.icon;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-xl bg-bg-surface border border-border"
    >
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <TypeIcon className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{vpn.name}</h3>
            <p className="text-sm text-text-muted">{vpn.endpoint}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm">
            <Download className="w-4 h-4" />
            Export Config
          </Button>
          <button
            onClick={onClose}
            className="p-2 text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Server Public Key */}
      {vpn.type === 'WIREGUARD' && (
        <div className="mb-6 p-4 rounded-lg bg-bg-base">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted mb-1">Server Public Key</p>
              <code className="text-sm text-accent font-mono">{vpn.publicKey}</code>
            </div>
            <button
              onClick={() => copyToClipboard(vpn.publicKey)}
              className="p-2 text-text-muted hover:text-text-primary transition-colors"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatBox label="Active" value={vpn.stats.activeConnections.toString()} />
        <StatBox label="Total Clients" value={vpn.stats.totalConnections.toString()} />
        <StatBox label="RX" value={formatBytes(vpn.stats.bytesIn)} />
        <StatBox label="TX" value={formatBytes(vpn.stats.bytesOut)} />
      </div>

      {/* Connections Table */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-text-secondary mb-3">Client Connections</h4>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-base">
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Name</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Allowed IPs</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Last Handshake</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Transfer</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Status</th>
              </tr>
            </thead>
            <tbody>
              {vpn.connections.map((conn) => {
                const status = connectionStatusConfig[conn.status] || { color: 'default', icon: XCircle };
                const StatusIcon = status.icon;
                return (
                  <tr key={conn.id} className="border-t border-border">
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-text-muted" />
                        <span className="text-sm text-text-primary">{conn.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <code className="text-sm text-text-secondary">{conn.allowedIPs.join(', ')}</code>
                    </td>
                    <td className="py-2 px-4 text-sm text-text-secondary">
                      {conn.lastHandshake || 'Never'}
                    </td>
                    <td className="py-2 px-4 text-sm text-text-secondary">
                      ↓ {formatBytes(conn.transferRx)} / ↑ {formatBytes(conn.transferTx)}
                    </td>
                    <td className="py-2 px-4">
                      <Badge variant={status.color as any}>
                        <StatusIcon className={cn('w-3 h-3 mr-1', conn.status === 'HANDSHAKING' && 'animate-spin')} />
                        {conn.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm">
          <Plus className="w-4 h-4" />
          Add Client
        </Button>
        <Button variant="secondary" size="sm">
          <Key className="w-4 h-4" />
          Generate Config
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

// Create VPN Service Modal
function CreateVPNModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<VPNService>) => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'WIREGUARD' as 'WIREGUARD' | 'IPSEC',
    listenPort: '51820',
    networkId: 'net-overlay',
    allowedNetworks: '10.0.0.0/8, 172.16.0.0/12',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      description: formData.description,
      type: formData.type,
      networkId: formData.networkId,
      allowedNetworks: formData.allowedNetworks.split(',').map(s => s.trim()),
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
            <h2 className="text-lg font-semibold text-text-primary">Create VPN Service</h2>
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
                placeholder="Bastion VPN Gateway"
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
                placeholder="WireGuard bastion for secure overlay access"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">VPN Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                  className="form-input w-full"
                >
                  <option value="WIREGUARD">WireGuard</option>
                  <option value="IPSEC">IPsec (Site-to-Site)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Listen Port</label>
                <input
                  type="number"
                  value={formData.listenPort}
                  onChange={(e) => setFormData({ ...formData, listenPort: e.target.value })}
                  className="form-input w-full"
                  placeholder="51820"
                  min="1"
                  max="65535"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Network</label>
              <select
                value={formData.networkId}
                onChange={(e) => setFormData({ ...formData, networkId: e.target.value })}
                className="form-input w-full"
              >
                <option value="net-overlay">Tenant Overlay (172.16.0.0/12)</option>
                <option value="net-prod">Production Network (10.100.0.0/16)</option>
                <option value="net-dev">Development Network (10.200.0.0/16)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Allowed Networks (comma-separated)</label>
              <input
                type="text"
                value={formData.allowedNetworks}
                onChange={(e) => setFormData({ ...formData, allowedNetworks: e.target.value })}
                className="form-input w-full"
                placeholder="10.0.0.0/8, 172.16.0.0/12"
              />
              <p className="text-xs text-text-muted mt-1">Networks accessible through this VPN</p>
            </div>

            <div className="p-4 rounded-lg bg-bg-base">
              <h4 className="text-sm font-medium text-text-secondary mb-2">
                {formData.type === 'WIREGUARD' ? 'WireGuard Keys' : 'IPsec Configuration'}
              </h4>
              <p className="text-xs text-text-muted">
                {formData.type === 'WIREGUARD' 
                  ? 'Public/private key pairs will be generated automatically. You can download client configurations after creation.'
                  : 'Pre-shared keys and IKE configuration will be available after creation.'
                }
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Create VPN Service
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default VPNServices;
