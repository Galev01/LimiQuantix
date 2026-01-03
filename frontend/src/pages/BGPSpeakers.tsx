import { useState } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

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

  const filteredSpeakers = mockBGPSpeakers.filter((speaker) =>
    speaker.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    speaker.routerId.includes(searchQuery) ||
    speaker.localAsn.toString().includes(searchQuery)
  );

  const totals = {
    speakers: mockBGPSpeakers.length,
    peers: mockBGPSpeakers.reduce((sum, s) => sum + s.peers.length, 0),
    establishedPeers: mockBGPSpeakers.reduce(
      (sum, s) => sum + s.peers.filter((p) => p.state === 'ESTABLISHED').length,
      0
    ),
    advertisedPrefixes: mockBGPSpeakers.reduce((sum, s) => sum + s.advertisements.length, 0),
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
          <Button>
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
          speaker={mockBGPSpeakers.find((s) => s.id === selectedSpeaker)!}
          onClose={() => setSelectedSpeaker(null)}
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
  const status = statusConfig[speaker.status];
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
          const peerState = peerStateConfig[peer.state];
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
                const peerState = peerStateConfig[peer.state];
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

export default BGPSpeakers;
