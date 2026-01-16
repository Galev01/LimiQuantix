import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network,
  Server,
  Cable,
  Settings,
  Plus,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Trash2,
  Edit,
  AlertCircle,
  CheckCircle,
  Loader2,
  HelpCircle,
  Layers,
  ArrowUpDown,
  ArrowRight,
  Globe,
  Wifi,
  X,
  Link,
  Unlink,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import { useNodes, type ApiNode } from '@/hooks/useNodes';
import { useNetworks, type ApiVirtualNetwork } from '@/hooks/useNetworks';

// Types for distributed switch configuration
interface Uplink {
  id: string;
  name: string;
  physicalNic: string;
  speed: string;
  status: 'active' | 'standby' | 'down';
  mtu: number;
}

interface PortGroup {
  id: string;
  name: string;
  vlanId?: number;
  networkId?: string;
  type: 'vm' | 'management' | 'vmotion' | 'storage';
  activeUplinks: string[];
  standbyUplinks: string[];
  connectedVMs: number;
}

interface DistributedSwitch {
  id: string;
  name: string;
  description: string;
  mtu: number;
  version: string;
  uplinks: Uplink[];
  portGroups: PortGroup[];
  connectedHosts: string[];
  status: 'healthy' | 'warning' | 'error';
}

// Distributed switches will be populated from backend when the feature is fully implemented
// TODO: Replace with real API calls when DVS management is added to the backend
const MOCK_SWITCHES: DistributedSwitch[] = [];

const PORT_GROUP_TYPES = {
  vm: { label: 'Virtual Machine', icon: Server, color: 'blue' },
  management: { label: 'Management', icon: Settings, color: 'purple' },
  vmotion: { label: 'vMotion', icon: ArrowUpDown, color: 'green' },
  storage: { label: 'Storage', icon: Cable, color: 'orange' },
};

const UPLINK_STATUS = {
  active: { label: 'Active', color: 'success' },
  standby: { label: 'Standby', color: 'warning' },
  down: { label: 'Down', color: 'error' },
};

export function DistributedSwitch() {
  const [selectedSwitch, setSelectedSwitch] = useState<string | null>(MOCK_SWITCHES[0]?.id || null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    uplinks: true,
    portGroups: true,
    hosts: true,
  });
  const [isCreatePortGroupOpen, setIsCreatePortGroupOpen] = useState(false);

  // Get real data from API
  const { data: nodesResponse, isLoading: nodesLoading } = useNodes({ pageSize: 100 });
  const { data: networksResponse, isLoading: networksLoading } = useNetworks({});

  const nodes = nodesResponse?.nodes || [];
  const networks = networksResponse?.networks || [];

  const currentSwitch = MOCK_SWITCHES.find(s => s.id === selectedSwitch);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Distributed Switching</h1>
          <p className="text-text-muted mt-1">
            Configure QuantrixSwitch distributed virtual switches, uplinks, and port groups
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button>
            <Plus className="w-4 h-4" />
            New Switch
          </Button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 rounded-xl bg-accent/5 border border-accent/20">
        <div className="flex items-start gap-3">
          <HelpCircle className="w-5 h-5 text-accent mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-sm font-medium text-text-primary mb-1">About Distributed Switching</h3>
            <p className="text-sm text-text-muted">
              QuantrixSwitch provides centralized management of virtual networking across all hosts in your cluster.
              Configure uplinks to connect to your physical network, and create port groups to organize VM traffic
              with VLAN tagging, teaming policies, and traffic shaping.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Switch List Sidebar */}
        <div className="col-span-3">
          <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
            <div className="p-4 border-b border-border bg-bg-base">
              <h3 className="font-medium text-text-primary">Distributed Switches</h3>
            </div>
            <div className="p-2">
              {MOCK_SWITCHES.map(sw => (
                <button
                  key={sw.id}
                  onClick={() => setSelectedSwitch(sw.id)}
                  className={cn(
                    'w-full p-3 rounded-lg text-left transition-all',
                    selectedSwitch === sw.id
                      ? 'bg-accent/10 border border-accent/30'
                      : 'hover:bg-bg-hover border border-transparent'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'p-2 rounded-lg',
                      sw.status === 'healthy' ? 'bg-success/10 text-success' :
                      sw.status === 'warning' ? 'bg-warning/10 text-warning' :
                      'bg-error/10 text-error'
                    )}>
                      <Network className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary truncate">{sw.name}</p>
                      <p className="text-xs text-text-muted">
                        {sw.uplinks.length} uplinks · {sw.portGroups.length} port groups
                      </p>
                    </div>
                  </div>
                </button>
              ))}

              {MOCK_SWITCHES.length === 0 && (
                <div className="p-4 text-center">
                  <Network className="w-8 h-8 text-text-muted mx-auto mb-2" />
                  <p className="text-sm text-text-muted">No switches configured</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Switch Details */}
        <div className="col-span-9 space-y-6">
          {currentSwitch ? (
            <>
              {/* Switch Overview */}
              <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
                <div className="p-4 border-b border-border bg-bg-base flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'p-2 rounded-lg',
                      currentSwitch.status === 'healthy' ? 'bg-success/10 text-success' :
                      currentSwitch.status === 'warning' ? 'bg-warning/10 text-warning' :
                      'bg-error/10 text-error'
                    )}>
                      <Network className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-text-primary">{currentSwitch.name}</h2>
                      <p className="text-sm text-text-muted">{currentSwitch.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm">
                      <Edit className="w-4 h-4" />
                      Edit
                    </Button>
                    <Button variant="secondary" size="sm">
                      <Settings className="w-4 h-4" />
                      Settings
                    </Button>
                  </div>
                </div>

                <div className="p-4 grid grid-cols-4 gap-4">
                  <StatCard label="MTU" value={`${currentSwitch.mtu}`} />
                  <StatCard label="Version" value={currentSwitch.version} />
                  <StatCard label="Connected Hosts" value={`${currentSwitch.connectedHosts.length}`} />
                  <StatCard 
                    label="Status" 
                    value={currentSwitch.status.charAt(0).toUpperCase() + currentSwitch.status.slice(1)}
                    status={currentSwitch.status}
                  />
                </div>
              </div>

              {/* Uplinks Section */}
              <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
                <button
                  onClick={() => toggleSection('uplinks')}
                  className="w-full p-4 border-b border-border bg-bg-base flex items-center justify-between hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Cable className="w-5 h-5 text-accent" />
                    <h3 className="font-medium text-text-primary">Uplinks</h3>
                    <Badge variant="default">{currentSwitch.uplinks.length}</Badge>
                  </div>
                  {expandedSections.uplinks ? (
                    <ChevronDown className="w-5 h-5 text-text-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-text-muted" />
                  )}
                </button>

                <AnimatePresence>
                  {expandedSections.uplinks && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4">
                        <p className="text-sm text-text-muted mb-4">
                          Uplinks connect the distributed switch to physical network adapters on each host.
                          Configure teaming and failover policies to ensure high availability.
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                          {currentSwitch.uplinks.map(uplink => (
                            <UplinkCard key={uplink.id} uplink={uplink} />
                          ))}
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button variant="secondary" size="sm">
                            <Plus className="w-4 h-4" />
                            Add Uplink
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Port Groups Section */}
              <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
                <button
                  onClick={() => toggleSection('portGroups')}
                  className="w-full p-4 border-b border-border bg-bg-base flex items-center justify-between hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Layers className="w-5 h-5 text-accent" />
                    <h3 className="font-medium text-text-primary">Port Groups</h3>
                    <Badge variant="default">{currentSwitch.portGroups.length}</Badge>
                  </div>
                  {expandedSections.portGroups ? (
                    <ChevronDown className="w-5 h-5 text-text-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-text-muted" />
                  )}
                </button>

                <AnimatePresence>
                  {expandedSections.portGroups && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4">
                        <p className="text-sm text-text-muted mb-4">
                          Port groups define network policies for VMs and VMkernel adapters.
                          Each port group can have its own VLAN, security settings, and traffic shaping policies.
                        </p>
                        <div className="space-y-3">
                          {currentSwitch.portGroups.map(pg => (
                            <PortGroupCard 
                              key={pg.id} 
                              portGroup={pg} 
                              uplinks={currentSwitch.uplinks}
                            />
                          ))}
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button variant="secondary" size="sm" onClick={() => setIsCreatePortGroupOpen(true)}>
                            <Plus className="w-4 h-4" />
                            Add Port Group
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Connected Hosts Section */}
              <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
                <button
                  onClick={() => toggleSection('hosts')}
                  className="w-full p-4 border-b border-border bg-bg-base flex items-center justify-between hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 text-accent" />
                    <h3 className="font-medium text-text-primary">Connected Hosts</h3>
                    <Badge variant="default">{currentSwitch.connectedHosts.length}</Badge>
                  </div>
                  {expandedSections.hosts ? (
                    <ChevronDown className="w-5 h-5 text-text-muted" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-text-muted" />
                  )}
                </button>

                <AnimatePresence>
                  {expandedSections.hosts && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4">
                        <p className="text-sm text-text-muted mb-4">
                          These hosts are connected to this distributed switch. Each host maps its physical NICs to the switch's uplinks.
                        </p>
                        
                        {nodesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-accent" />
                          </div>
                        ) : nodes.length > 0 ? (
                          <div className="space-y-2">
                            {nodes.slice(0, 5).map(node => (
                              <HostCard key={node.id} node={node} isConnected={currentSwitch.connectedHosts.includes(node.id)} />
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-8">
                            <Server className="w-8 h-8 text-text-muted mx-auto mb-2" />
                            <p className="text-sm text-text-muted">No hosts available</p>
                          </div>
                        )}

                        <div className="mt-4 flex justify-end">
                          <Button variant="secondary" size="sm">
                            <Plus className="w-4 h-4" />
                            Add Host
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </>
          ) : (
            <div className="rounded-xl bg-bg-surface border border-border p-12 text-center">
              <Network className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No Switch Selected</h3>
              <p className="text-text-muted mb-4">
                Select a distributed switch from the list or create a new one to get started.
              </p>
              <Button>
                <Plus className="w-4 h-4" />
                Create Distributed Switch
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Create Port Group Modal */}
      <CreatePortGroupModal
        isOpen={isCreatePortGroupOpen}
        onClose={() => setIsCreatePortGroupOpen(false)}
        uplinks={currentSwitch?.uplinks || []}
        networks={networks}
      />
    </div>
  );
}

function StatCard({ 
  label, 
  value, 
  status 
}: { 
  label: string; 
  value: string; 
  status?: 'healthy' | 'warning' | 'error';
}) {
  return (
    <div className="p-3 rounded-lg bg-bg-base">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className={cn(
        'text-lg font-semibold',
        status === 'healthy' ? 'text-success' :
        status === 'warning' ? 'text-warning' :
        status === 'error' ? 'text-error' :
        'text-text-primary'
      )}>
        {value}
      </p>
    </div>
  );
}

function UplinkCard({ uplink }: { uplink: Uplink }) {
  const statusConfig = UPLINK_STATUS[uplink.status];
  
  return (
    <div className="p-4 rounded-lg bg-bg-base border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-2 rounded-lg',
            uplink.status === 'active' ? 'bg-success/10 text-success' :
            uplink.status === 'standby' ? 'bg-warning/10 text-warning' :
            'bg-error/10 text-error'
          )}>
            <Cable className="w-4 h-4" />
          </div>
          <div>
            <p className="font-medium text-text-primary">{uplink.name}</p>
            <p className="text-xs text-text-muted">{uplink.physicalNic}</p>
          </div>
        </div>
        <Badge variant={statusConfig.color as any}>{statusConfig.label}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-text-muted">Speed</p>
          <p className="text-text-primary">{uplink.speed}</p>
        </div>
        <div>
          <p className="text-text-muted">MTU</p>
          <p className="text-text-primary">{uplink.mtu}</p>
        </div>
      </div>
    </div>
  );
}

function PortGroupCard({ 
  portGroup, 
  uplinks 
}: { 
  portGroup: PortGroup; 
  uplinks: Uplink[];
}) {
  const typeConfig = PORT_GROUP_TYPES[portGroup.type];
  const Icon = typeConfig.icon;
  
  return (
    <div className="p-4 rounded-lg bg-bg-base border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            'p-2 rounded-lg',
            typeConfig.color === 'blue' && 'bg-blue-500/10 text-blue-400',
            typeConfig.color === 'purple' && 'bg-purple-500/10 text-purple-400',
            typeConfig.color === 'green' && 'bg-green-500/10 text-green-400',
            typeConfig.color === 'orange' && 'bg-orange-500/10 text-orange-400',
          )}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="font-medium text-text-primary">{portGroup.name}</p>
            <p className="text-xs text-text-muted">{typeConfig.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {portGroup.vlanId && (
            <Badge variant="default">VLAN {portGroup.vlanId}</Badge>
          )}
          {portGroup.type === 'vm' && (
            <Badge variant="info">{portGroup.connectedVMs} VMs</Badge>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Active:</span>
          <div className="flex items-center gap-1">
            {portGroup.activeUplinks.map(id => {
              const uplink = uplinks.find(u => u.id === id);
              return (
                <span key={id} className="px-2 py-0.5 rounded bg-success/10 text-success text-xs">
                  {uplink?.name || id}
                </span>
              );
            })}
          </div>
        </div>
        {portGroup.standbyUplinks.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-text-muted">Standby:</span>
            <div className="flex items-center gap-1">
              {portGroup.standbyUplinks.map(id => {
                const uplink = uplinks.find(u => u.id === id);
                return (
                  <span key={id} className="px-2 py-0.5 rounded bg-warning/10 text-warning text-xs">
                    {uplink?.name || id}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HostCard({ node, isConnected }: { node: ApiNode; isConnected: boolean }) {
  const isReady = node.status?.phase === 'READY' || node.status?.phase === 'NODE_PHASE_READY';
  return (
    <div className="p-3 rounded-lg bg-bg-base border border-border flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={cn(
          'p-2 rounded-lg',
          isReady ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
        )}>
          <Server className="w-4 h-4" />
        </div>
        <div>
          <p className="font-medium text-text-primary">{node.hostname || node.id}</p>
          <p className="text-xs text-text-muted">{node.managementIp}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isConnected ? (
          <Badge variant="success">
            <Link className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        ) : (
          <Button variant="secondary" size="sm">
            <Link className="w-4 h-4" />
            Connect
          </Button>
        )}
      </div>
    </div>
  );
}

function CreatePortGroupModal({
  isOpen,
  onClose,
  uplinks,
  networks,
}: {
  isOpen: boolean;
  onClose: () => void;
  uplinks: Uplink[];
  networks: ApiVirtualNetwork[];
}) {
  const [formData, setFormData] = useState({
    name: '',
    type: 'vm' as 'vm' | 'management' | 'vmotion' | 'storage',
    vlanId: '',
    networkId: '',
    activeUplinks: [] as string[],
    standbyUplinks: [] as string[],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Implement port group creation
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-lg bg-bg-surface rounded-xl border border-border shadow-elevated"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Create Port Group</h2>
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
              placeholder="Production-VLAN-100"
              required
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
                <option value="vm">Virtual Machine</option>
                <option value="management">Management</option>
                <option value="vmotion">vMotion</option>
                <option value="storage">Storage</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">VLAN ID</label>
              <input
                type="number"
                value={formData.vlanId}
                onChange={(e) => setFormData({ ...formData, vlanId: e.target.value })}
                className="form-input w-full"
                placeholder="100"
                min="0"
                max="4094"
              />
            </div>
          </div>

          {formData.type === 'vm' && networks.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Link to Virtual Network (Optional)
              </label>
              <select
                value={formData.networkId}
                onChange={(e) => setFormData({ ...formData, networkId: e.target.value })}
                className="form-input w-full"
              >
                <option value="">None</option>
                {networks.map(net => (
                  <option key={net.id} value={net.id}>{net.name}</option>
                ))}
              </select>
              <p className="text-xs text-text-muted mt-1">
                Link this port group to a virtual network for automatic VLAN/overlay configuration
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Active Uplinks</label>
            <div className="flex flex-wrap gap-2">
              {uplinks.map(uplink => (
                <button
                  key={uplink.id}
                  type="button"
                  onClick={() => {
                    const isActive = formData.activeUplinks.includes(uplink.id);
                    if (isActive) {
                      setFormData({
                        ...formData,
                        activeUplinks: formData.activeUplinks.filter(id => id !== uplink.id),
                      });
                    } else {
                      setFormData({
                        ...formData,
                        activeUplinks: [...formData.activeUplinks, uplink.id],
                        standbyUplinks: formData.standbyUplinks.filter(id => id !== uplink.id),
                      });
                    }
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm transition-colors',
                    formData.activeUplinks.includes(uplink.id)
                      ? 'bg-success/20 text-success border border-success/30'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  {uplink.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Standby Uplinks</label>
            <div className="flex flex-wrap gap-2">
              {uplinks.filter(u => !formData.activeUplinks.includes(u.id)).map(uplink => (
                <button
                  key={uplink.id}
                  type="button"
                  onClick={() => {
                    const isStandby = formData.standbyUplinks.includes(uplink.id);
                    if (isStandby) {
                      setFormData({
                        ...formData,
                        standbyUplinks: formData.standbyUplinks.filter(id => id !== uplink.id),
                      });
                    } else {
                      setFormData({
                        ...formData,
                        standbyUplinks: [...formData.standbyUplinks, uplink.id],
                      });
                    }
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm transition-colors',
                    formData.standbyUplinks.includes(uplink.id)
                      ? 'bg-warning/20 text-warning border border-warning/30'
                      : 'bg-bg-elevated text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  {uplink.name}
                </button>
              ))}
            </div>
            {uplinks.filter(u => !formData.activeUplinks.includes(u.id)).length === 0 && (
              <p className="text-xs text-text-muted mt-1">All uplinks are set as active</p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              Create Port Group
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default DistributedSwitch;
