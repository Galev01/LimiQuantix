import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio,
  Plus,
  RefreshCw,
  Search,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Server,
  Network,
  ArrowUpRight,
  Loader2,
  Settings,
  Trash2,
  Link2,
  Globe,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { showInfo } from '@/lib/toast';
import { useApiConnection } from '@/hooks/useDashboard';

interface BGPSpeaker {
  id: string;
  name: string;
  description: string;
  localAsn: number;
  routerId: string;
  nodeId: string;
  nodeName: string;
  status: 'ACTIVE' | 'PENDING' | 'DEGRADED' | 'ERROR';
  peers: BGPPeer[];
  advertisements: BGPAdvertisement[];
  advertiseTenantNetworks: boolean;
  advertiseFloatingIps: boolean;
  createdAt: string;
}

interface BGPPeer {
  id: string;
  name: string;
  peerIp: string;
  remoteAsn: number;
  state: 'ESTABLISHED' | 'ACTIVE' | 'CONNECT' | 'IDLE' | 'OPEN_SENT' | 'OPEN_CONFIRM';
  uptimeSeconds: number;
  prefixesReceived: number;
  prefixesAdvertised: number;
  bfdEnabled: boolean;
}

interface BGPAdvertisement {
  id: string;
  cidr: string;
  nextHop: string;
  communities: string[];
  localPreference: number;
  active: boolean;
}

const mockBGPSpeakers: BGPSpeaker[] = [
  {
    id: 'bgp-speaker-01',
    name: 'Primary ToR Peering',
    description: 'BGP speaker for advertising overlay routes to ToR switches',
    localAsn: 65001,
    routerId: '10.0.0.1',
    nodeId: 'node-ctrl-01',
    nodeName: 'Control Node 01',
    status: 'ACTIVE',
    advertiseTenantNetworks: true,
    advertiseFloatingIps: true,
    peers: [
      {
        id: 'peer-1',
        name: 'ToR Switch A',
        peerIp: '10.0.0.254',
        remoteAsn: 65000,
        state: 'ESTABLISHED',
        uptimeSeconds: 86400 * 7,
        prefixesReceived: 5,
        prefixesAdvertised: 12,
        bfdEnabled: true,
      },
      {
        id: 'peer-2',
        name: 'ToR Switch B',
        peerIp: '10.0.0.253',
        remoteAsn: 65000,
        state: 'ESTABLISHED',
        uptimeSeconds: 86400 * 7,
        prefixesReceived: 5,
        prefixesAdvertised: 12,
        bfdEnabled: true,
      },
    ],
    advertisements: [
      { id: 'adv-1', cidr: '10.100.0.0/16', nextHop: '10.0.0.1', communities: ['65001:100'], localPreference: 100, active: true },
      { id: 'adv-2', cidr: '10.200.0.0/16', nextHop: '10.0.0.1', communities: ['65001:200'], localPreference: 100, active: true },
      { id: 'adv-3', cidr: '172.16.0.0/12', nextHop: '10.0.0.1', communities: ['65001:overlay'], localPreference: 100, active: true },
      { id: 'adv-4', cidr: '203.0.113.0/24', nextHop: '10.0.0.1', communities: ['65001:floating'], localPreference: 100, active: true },
    ],
    createdAt: '2024-01-10',
  },
  {
    id: 'bgp-speaker-02',
    name: 'Backup ToR Peering',
    description: 'Backup BGP speaker for failover',
    localAsn: 65001,
    routerId: '10.0.0.2',
    nodeId: 'node-ctrl-02',
    nodeName: 'Control Node 02',
    status: 'ACTIVE',
    advertiseTenantNetworks: true,
    advertiseFloatingIps: true,
    peers: [
      {
        id: 'peer-3',
        name: 'ToR Switch A',
        peerIp: '10.0.0.254',
        remoteAsn: 65000,
        state: 'ESTABLISHED',
        uptimeSeconds: 86400 * 5,
        prefixesReceived: 5,
        prefixesAdvertised: 12,
        bfdEnabled: true,
      },
    ],
    advertisements: [
      { id: 'adv-5', cidr: '10.100.0.0/16', nextHop: '10.0.0.2', communities: ['65001:100'], localPreference: 90, active: true },
      { id: 'adv-6', cidr: '10.200.0.0/16', nextHop: '10.0.0.2', communities: ['65001:200'], localPreference: 90, active: true },
    ],
    createdAt: '2024-01-15',
  },
];

const peerStateConfig = {
  ESTABLISHED: { color: 'success', label: 'Established' },
  ACTIVE: { color: 'warning', label: 'Active' },
  CONNECT: { color: 'warning', label: 'Connect' },
  IDLE: { color: 'default', label: 'Idle' },
  OPEN_SENT: { color: 'warning', label: 'OpenSent' },
  OPEN_CONFIRM: { color: 'warning', label: 'OpenConfirm' },
};

const statusConfig = {
  ACTIVE: { color: 'success', icon: CheckCircle },
  PENDING: { color: 'warning', icon: Loader2 },
  DEGRADED: { color: 'warning', icon: AlertTriangle },
  ERROR: { color: 'error', icon: XCircle },
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function BGPSpeakers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  
  // API connection
  const { data: isConnected = false } = useApiConnection();
  
  // TODO: Replace with real API hook when BGP service is implemented
  // For now, show empty state (no mock data)
  const bgpSpeakers: BGPSpeaker[] = [];

  const filteredSpeakers = bgpSpeakers.filter((speaker) =>
    speaker.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    speaker.routerId.includes(searchQuery) ||
    speaker.localAsn.toString().includes(searchQuery)
  );

  const totals = {
    speakers: bgpSpeakers.length,
    peers: bgpSpeakers.reduce((sum, s) => sum + s.peers.length, 0),
    establishedPeers: bgpSpeakers.reduce(
      (sum, s) => sum + s.peers.filter((p) => p.state === 'ESTABLISHED').length,
      0
    ),
    advertisedPrefixes: bgpSpeakers.reduce((sum, s) => sum + s.advertisements.length, 0),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">BGP Speakers</h1>
          <p className="text-text-muted mt-1">BGP peering for ToR switch integration</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="w-4 h-4" />
            New Speaker
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <SummaryCard
          title="BGP Speakers"
          value={totals.speakers}
          icon={<Radio className="w-5 h-5" />}
          color="blue"
        />
        <SummaryCard
          title="Established Peers"
          value={`${totals.establishedPeers}/${totals.peers}`}
          icon={<Link2 className="w-5 h-5" />}
          color="green"
        />
        <SummaryCard
          title="Advertised Prefixes"
          value={totals.advertisedPrefixes}
          icon={<ArrowUpRight className="w-5 h-5" />}
          color="purple"
        />
        <SummaryCard
          title="Total Peers"
          value={totals.peers}
          icon={<Globe className="w-5 h-5" />}
          color="orange"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search BGP speakers by name, router ID, or ASN..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="form-input pl-10"
        />
      </div>

      {/* BGP Speaker Cards */}
      <div className="space-y-4">
        {filteredSpeakers.map((speaker, index) => (
          <BGPSpeakerCard
            key={speaker.id}
            speaker={speaker}
            index={index}
            isSelected={selectedSpeaker === speaker.id}
            onClick={() => setSelectedSpeaker(speaker.id === selectedSpeaker ? null : speaker.id)}
          />
        ))}
      </div>

      {/* Detail Panel */}
      {selectedSpeaker && (
        <BGPDetailPanel
          speaker={bgpSpeakers.find((s) => s.id === selectedSpeaker)!}
          onClose={() => setSelectedSpeaker(null)}
        />
      )}

      {/* Create BGP Speaker Modal */}
      <CreateBGPSpeakerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={(data) => {
          showInfo(`Demo mode: BGP speaker "${data.name}" created (simulated)`);
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

function BGPSpeakerCard({
  speaker,
  index,
  isSelected,
  onClick,
}: {
  speaker: BGPSpeaker;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const status = statusConfig[speaker.status] || { color: 'default', icon: AlertTriangle };
  const StatusIcon = status.icon;
  const establishedPeers = speaker.peers.filter((p) => p.state === 'ESTABLISHED').length;

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
            <Radio className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary">{speaker.name}</h3>
            <p className="text-sm text-text-muted">{speaker.description}</p>
          </div>
        </div>
        <Badge variant={status.color as any}>
          <StatusIcon className={cn('w-3 h-3 mr-1', speaker.status === 'PENDING' && 'animate-spin')} />
          {speaker.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <div>
          <p className="text-xs text-text-muted mb-1">Local ASN</p>
          <code className="text-sm text-accent font-mono">{speaker.localAsn}</code>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Router ID</p>
          <code className="text-sm text-text-secondary font-mono">{speaker.routerId}</code>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Node</p>
          <span className="text-sm text-text-secondary">{speaker.nodeName}</span>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Peers</p>
          <span className="text-sm text-text-secondary">
            {establishedPeers}/{speaker.peers.length} established
          </span>
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">Advertised</p>
          <span className="text-sm text-text-secondary">
            {speaker.advertisements.length} prefixes
          </span>
        </div>
      </div>

      {/* Peer Status Indicators */}
      <div className="flex items-center gap-2 flex-wrap">
        {speaker.peers.map((peer) => {
          const peerState = peerStateConfig[peer.state] || { color: 'default', label: peer.state || 'Unknown' };
          return (
            <div
              key={peer.id}
              className={cn(
                'px-2 py-1 rounded text-xs flex items-center gap-1',
                peer.state === 'ESTABLISHED'
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', peer.state === 'ESTABLISHED' ? 'bg-success' : 'bg-warning')} />
              {peer.name} ({peer.peerIp})
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

function BGPDetailPanel({ speaker, onClose }: { speaker: BGPSpeaker; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-xl bg-bg-surface border border-border"
    >
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center">
            <Radio className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{speaker.name}</h3>
            <p className="text-sm text-text-muted">
              AS{speaker.localAsn} • Router ID: {speaker.routerId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Auto-Advertisement Settings */}
      <div className="mb-6 p-4 rounded-lg bg-bg-base">
        <h4 className="text-sm font-medium text-text-secondary mb-3">Auto-Advertisement</h4>
        <div className="flex gap-4">
          <Badge variant={speaker.advertiseTenantNetworks ? 'success' : 'default'}>
            Tenant Networks: {speaker.advertiseTenantNetworks ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge variant={speaker.advertiseFloatingIps ? 'success' : 'default'}>
            Floating IPs: {speaker.advertiseFloatingIps ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </div>

      {/* Peers Table */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-text-secondary mb-3">BGP Peers</h4>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-base">
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Peer</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">IP Address</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Remote ASN</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">State</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Uptime</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Prefixes</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">BFD</th>
              </tr>
            </thead>
            <tbody>
              {speaker.peers.map((peer) => {
                const peerState = peerStateConfig[peer.state] || { color: 'default', label: peer.state || 'Unknown' };
                return (
                  <tr key={peer.id} className="border-t border-border">
                    <td className="py-2 px-4">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-text-muted" />
                        <span className="text-sm text-text-primary">{peer.name}</span>
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <code className="text-sm text-text-secondary">{peer.peerIp}</code>
                    </td>
                    <td className="py-2 px-4 text-sm text-text-secondary">
                      AS{peer.remoteAsn}
                    </td>
                    <td className="py-2 px-4">
                      <Badge variant={peerState.color as any}>
                        {peerState.label}
                      </Badge>
                    </td>
                    <td className="py-2 px-4 text-sm text-text-secondary">
                      {peer.state === 'ESTABLISHED' ? formatUptime(peer.uptimeSeconds) : '-'}
                    </td>
                    <td className="py-2 px-4 text-sm text-text-secondary">
                      ↓{peer.prefixesReceived} / ↑{peer.prefixesAdvertised}
                    </td>
                    <td className="py-2 px-4">
                      <Badge variant={peer.bfdEnabled ? 'success' : 'default'}>
                        {peer.bfdEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Advertisements Table */}
      <div className="mb-4">
        <h4 className="text-sm font-medium text-text-secondary mb-3">Advertised Prefixes</h4>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-base">
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">CIDR</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Next-Hop</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Communities</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Local Pref</th>
                <th className="text-left py-2 px-4 text-xs font-medium text-text-muted">Status</th>
              </tr>
            </thead>
            <tbody>
              {speaker.advertisements.map((adv) => (
                <tr key={adv.id} className="border-t border-border">
                  <td className="py-2 px-4">
                    <code className="text-sm text-accent font-mono">{adv.cidr}</code>
                  </td>
                  <td className="py-2 px-4">
                    <code className="text-sm text-text-secondary">{adv.nextHop}</code>
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex gap-1">
                      {adv.communities.map((c, i) => (
                        <Badge key={i} variant="default">{c}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-4 text-sm text-text-secondary">{adv.localPreference}</td>
                  <td className="py-2 px-4">
                    <Badge variant={adv.active ? 'success' : 'default'}>
                      {adv.active ? 'Active' : 'Inactive'}
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
          Add Peer
        </Button>
        <Button variant="secondary" size="sm">
          <Network className="w-4 h-4" />
          Advertise Network
        </Button>
      </div>
    </motion.div>
  );
}

// Create BGP Speaker Modal
function CreateBGPSpeakerModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<BGPSpeaker>) => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    localAsn: '65001',
    routerId: '',
    nodeId: 'node-ctrl-01',
    advertiseTenantNetworks: true,
    advertiseFloatingIps: true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name: formData.name,
      description: formData.description,
      localAsn: parseInt(formData.localAsn),
      routerId: formData.routerId,
      nodeId: formData.nodeId,
      advertiseTenantNetworks: formData.advertiseTenantNetworks,
      advertiseFloatingIps: formData.advertiseFloatingIps,
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
            <h2 className="text-lg font-semibold text-text-primary">Create BGP Speaker</h2>
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
                placeholder="Primary ToR Peering"
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
                placeholder="BGP speaker for advertising routes to ToR switches"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Local ASN</label>
                <input
                  type="number"
                  value={formData.localAsn}
                  onChange={(e) => setFormData({ ...formData, localAsn: e.target.value })}
                  className="form-input w-full"
                  placeholder="65001"
                  min="1"
                  max="4294967295"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Router ID</label>
                <input
                  type="text"
                  value={formData.routerId}
                  onChange={(e) => setFormData({ ...formData, routerId: e.target.value })}
                  className="form-input w-full"
                  placeholder="10.0.0.1"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Node</label>
              <select
                value={formData.nodeId}
                onChange={(e) => setFormData({ ...formData, nodeId: e.target.value })}
                className="form-input w-full"
              >
                <option value="node-ctrl-01">Control Node 01</option>
                <option value="node-ctrl-02">Control Node 02</option>
                <option value="node-ctrl-03">Control Node 03</option>
              </select>
              <p className="text-xs text-text-muted mt-1">Node where FRRouting will run</p>
            </div>

            <div className="p-4 rounded-lg bg-bg-base space-y-3">
              <h4 className="text-sm font-medium text-text-secondary">Auto-Advertisement</h4>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.advertiseTenantNetworks}
                  onChange={(e) => setFormData({ ...formData, advertiseTenantNetworks: e.target.checked })}
                  className="form-checkbox"
                />
                <span className="text-sm text-text-secondary">Advertise tenant networks</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.advertiseFloatingIps}
                  onChange={(e) => setFormData({ ...formData, advertiseFloatingIps: e.target.checked })}
                  className="form-checkbox"
                />
                <span className="text-sm text-text-secondary">Advertise floating IPs</span>
              </label>
            </div>

            <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
              <h4 className="text-sm font-medium text-accent mb-2">Next Steps</h4>
              <p className="text-xs text-text-muted">
                After creating the BGP speaker, you'll need to add peers (ToR switches) 
                and optionally configure additional network advertisements.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">
                Create BGP Speaker
              </Button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default BGPSpeakers;
