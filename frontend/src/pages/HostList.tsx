import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  RefreshCw,
  Server,
  AlertCircle,
  CheckCircle,
  Wrench,
  Settings,
  Power,
  PowerOff,
  ArrowRightLeft,
  Trash2,
  Edit,
  Terminal,
  Activity,
  Wifi,
  WifiOff,
  Loader2,
  ServerOff,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { type NodePhase } from '@/data/mock-data';
import { useNodes, type ApiNode } from '@/hooks/useNodes';
import { useApiConnection } from '@/hooks/useDashboard';
import { showInfo, showWarning } from '@/lib/toast';
import { AddHostModal } from '@/components/host/AddHostModal';

type FilterTab = 'all' | 'ready' | 'not_ready' | 'maintenance';

// Display node type derived from API node
interface DisplayNode {
  id: string;
  hostname: string;
  managementIp: string;
  labels: Record<string, string>;
  spec: {
    cpu: {
      model: string;
      sockets?: number;
      coresPerSocket?: number;
      threadsPerCore?: number;
      totalCores: number;
      threads?: number;
      features?: string[];
    };
    memory: {
      totalBytes: number;
      allocatableBytes: number;
    };
    storage: Array<{ name: string; type: string; sizeBytes: number; path?: string }>;
    networks: Array<{ name: string; macAddress?: string; speedMbps?: number }>;
    role: { compute: boolean; storage: boolean; controlPlane: boolean };
  };
  status: {
    phase: NodePhase;
    vmIds: string[];
    resources: {
      cpuAllocatedCores: number;
      cpuUsagePercent: number;
      memoryAllocatedBytes: number;
      memoryUsedBytes: number;
      storageUsedBytes?: number;
    };
    conditions?: Array<{ type: string; status: boolean; message: string; lastTransitionTime?: string }>;
    systemInfo?: { osName: string; kernelVersion: string; hypervisorVersion: string; agentVersion: string };
  };
  createdAt?: string;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  node: DisplayNode | null;
}

const phaseConfig: Record<NodePhase, { label: string; variant: 'success' | 'error' | 'warning' | 'info'; icon: typeof CheckCircle }> = {
  READY: { label: 'Ready', variant: 'success', icon: CheckCircle },
  NOT_READY: { label: 'Not Ready', variant: 'error', icon: AlertCircle },
  MAINTENANCE: { label: 'Maintenance', variant: 'warning', icon: Wrench },
  DRAINING: { label: 'Draining', variant: 'info', icon: Settings },
};

const variantColors = {
  success: 'text-success bg-success/10',
  error: 'text-error bg-error/10',
  warning: 'text-warning bg-warning/10',
  info: 'text-info bg-info/10',
};

// Convert API Node to display format
function apiToDisplayNode(node: ApiNode): DisplayNode {
  const phase = (node.status?.phase as NodePhase) || 'READY';
  return {
    id: node.id,
    hostname: node.hostname,
    managementIp: node.managementIp || '',
    labels: node.labels || {},
    spec: {
      cpu: {
        model: node.spec?.cpu?.model || 'Unknown',
        sockets: node.spec?.cpu?.sockets || 1,
        coresPerSocket: node.spec?.cpu?.coresPerSocket || 1,
        threadsPerCore: node.spec?.cpu?.threadsPerCore || 1,
        totalCores: (node.spec?.cpu?.sockets || 1) * (node.spec?.cpu?.coresPerSocket || 1),
        features: [],
      },
      memory: {
        totalBytes: (node.spec?.memory?.totalMib || 0) * 1024 * 1024,
        allocatableBytes: (node.spec?.memory?.totalMib || 0) * 1024 * 1024 * 0.9,
      },
      storage: [],
      networks: [],
      role: { compute: true, storage: false, controlPlane: false },
    },
    status: {
      phase,
      conditions: (node.status?.conditions || []).map((c) => ({
        type: c.type || 'Unknown',
        status: c.status || false,
        message: c.message || '',
        lastTransitionTime: '',
      })),
      resources: {
        cpuAllocatedCores: node.status?.allocation?.cpuAllocated || 0,
        cpuUsagePercent: 0,
        memoryAllocatedBytes: (node.status?.allocation?.memoryAllocatedMib || 0) * 1024 * 1024,
        memoryUsedBytes: 0,
        storageUsedBytes: 0,
      },
      vmIds: node.status?.vmIds || [],
      systemInfo: {
        osName: 'Linux',
        kernelVersion: '',
        hypervisorVersion: '',
        agentVersion: '',
      },
    },
    createdAt: node.createdAt || new Date().toISOString(),
  };
}

export function HostList() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [showAddHostModal, setShowAddHostModal] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    node: null,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiResponse, isLoading, refetch, isRefetching } = useNodes({ enabled: !!isConnected });

  // Get hosts from API (no mock data fallback)
  const apiNodes = apiResponse?.nodes || [];
  const allHosts: DisplayNode[] = apiNodes.map(apiToDisplayNode);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Filter hosts based on search and tab
  const filteredHosts = allHosts.filter((node) => {
    const matchesSearch =
      node.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.managementIp.includes(searchQuery) ||
      (node.labels['rack'] || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.labels['zone'] || '').toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'ready' && node.status.phase === 'READY') ||
      (activeTab === 'not_ready' && node.status.phase === 'NOT_READY') ||
      (activeTab === 'maintenance' && node.status.phase === 'MAINTENANCE');

    return matchesSearch && matchesTab;
  });

  const hostCounts = {
    all: allHosts.length,
    ready: allHosts.filter((n) => n.status.phase === 'READY').length,
    not_ready: allHosts.filter((n) => n.status.phase === 'NOT_READY').length,
    maintenance: allHosts.filter((n) => n.status.phase === 'MAINTENANCE').length,
  };

  const handleContextMenu = (e: React.MouseEvent, node: DisplayNode) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      node,
    });
  };

  const handleContextAction = (action: string) => {
    if (!contextMenu.node) return;
    
    // These actions are placeholders for future node management API
    switch (action) {
      case 'maintenance':
        showWarning(`Maintenance mode for "${contextMenu.node.hostname}" coming soon`);
        break;
      case 'migrate_vms':
        showWarning(`Migrate VMs from "${contextMenu.node.hostname}" coming soon`);
        break;
      case 'reboot':
        showWarning(`Reboot "${contextMenu.node.hostname}" coming soon`);
        break;
      case 'shutdown':
        showWarning(`Shutdown "${contextMenu.node.hostname}" coming soon`);
        break;
      case 'remove':
        showWarning(`Remove "${contextMenu.node.hostname}" from cluster coming soon`);
        break;
      default:
        showInfo(`Action "${action}" on host "${contextMenu.node.hostname}"`);
    }
    
    setContextMenu((prev) => ({ ...prev, visible: false }));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Hosts</h1>
            <p className="text-text-muted mt-1">Physical hypervisor nodes in your cluster</p>
          </div>
          {/* Connection Status Badge */}
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
              isConnected
                ? 'bg-success/20 text-success border border-success/30'
                : 'bg-error/20 text-error border border-error/30',
            )}
          >
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3" />
                Connected
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                Disconnected
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching || isLoading || !isConnected}
          >
            <RefreshCw className={cn('w-4 h-4', (isRefetching || isLoading) && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowAddHostModal(true)}>
            <Plus className="w-4 h-4" />
            Add Host
          </Button>
        </div>
      </motion.div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-border">
          {([
            { key: 'all', label: 'All' },
            { key: 'ready', label: 'Ready' },
            { key: 'not_ready', label: 'Not Ready' },
            { key: 'maintenance', label: 'Maintenance' },
          ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all',
                activeTab === key
                  ? 'bg-bg-elevated text-text-primary shadow-elevated'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              )}
            >
              {label} ({hostCounts[key]})
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by hostname, IP, rack, zone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-80 pl-9 pr-4 py-2 rounded-lg',
              'bg-bg-base border border-border',
              'text-sm text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
            )}
          />
        </div>
      </div>

      {/* Not Connected State */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-bg-surface border border-border rounded-xl p-8 text-center"
        >
          <ServerOff className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">Not Connected to Backend</h3>
          <p className="text-text-muted mb-4 max-w-md mx-auto">
            Start the control plane server to view and manage hosts. 
            Run <code className="bg-bg-base px-2 py-0.5 rounded text-sm">go run ./cmd/controlplane</code> in the backend directory.
          </p>
          <Button variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </Button>
        </motion.div>
      )}

      {/* Loading State */}
      {isConnected && isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}

      {/* Hosts Table */}
      {isConnected && !isLoading && (
        <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
          {/* Table Header */}
          <div className="px-5 py-3 border-b border-border bg-bg-elevated/50">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-text-muted uppercase tracking-wider">
              <div className="col-span-3">Hostname</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">IP Address</div>
              <div className="col-span-2">CPU Usage</div>
              <div className="col-span-2">Memory Usage</div>
              <div className="col-span-1 text-center">VMs</div>
              <div className="col-span-1 text-right">Location</div>
            </div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {filteredHosts.map((node, index) => {
              const cpuPercent = node.spec.cpu.totalCores > 0
                ? Math.round((node.status.resources.cpuAllocatedCores / node.spec.cpu.totalCores) * 100)
                : 0;
              const memPercent = node.spec.memory.totalBytes > 0
                ? Math.round((node.status.resources.memoryAllocatedBytes / node.spec.memory.totalBytes) * 100)
                : 0;
              const phaseInfo = phaseConfig[node.status.phase];
              const PhaseIcon = phaseInfo.icon;

              return (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  onClick={() => navigate(`/hosts/${node.id}`)}
                  onContextMenu={(e) => handleContextMenu(e, node)}
                  className={cn(
                    'grid grid-cols-12 gap-4 px-5 py-4 items-center',
                    'hover:bg-bg-hover cursor-pointer',
                    'transition-colors duration-150',
                    'group select-none',
                  )}
                >
                  {/* Hostname */}
                  <div className="col-span-3 flex items-center gap-3">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center',
                        'bg-bg-elevated group-hover:bg-accent/10',
                        'transition-colors duration-150',
                      )}
                    >
                      <Server className="w-5 h-5 text-text-muted group-hover:text-accent" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary group-hover:text-accent transition-colors">
                        {node.hostname}
                      </p>
                      <p className="text-xs text-text-muted">
                        {node.spec.cpu.model}
                      </p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="col-span-1">
                    <div
                      className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                        variantColors[phaseInfo.variant],
                      )}
                    >
                      <PhaseIcon className="w-3.5 h-3.5" />
                      {phaseInfo.label}
                    </div>
                  </div>

                  {/* IP Address */}
                  <div className="col-span-2">
                    <p className="text-sm text-text-primary font-mono">{node.managementIp}</p>
                  </div>

                  {/* CPU Usage */}
                  <div className="col-span-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">
                          {node.status.resources.cpuAllocatedCores} / {node.spec.cpu.totalCores} cores
                        </span>
                        <span
                          className={cn(
                            'font-medium',
                            cpuPercent >= 80
                              ? 'text-error'
                              : cpuPercent >= 60
                                ? 'text-warning'
                                : 'text-success',
                          )}
                        >
                          {cpuPercent}%
                        </span>
                      </div>
                      <div className="h-2 bg-bg-base rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${cpuPercent}%` }}
                          transition={{ duration: 0.5, delay: index * 0.03 }}
                          className={cn(
                            'h-full rounded-full',
                            cpuPercent >= 80
                              ? 'bg-error'
                              : cpuPercent >= 60
                                ? 'bg-warning'
                                : 'bg-success',
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Memory Usage */}
                  <div className="col-span-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-text-secondary">
                          {formatBytes(node.status.resources.memoryAllocatedBytes)} /{' '}
                          {formatBytes(node.spec.memory.totalBytes)}
                        </span>
                        <span
                          className={cn(
                            'font-medium',
                            memPercent >= 80
                              ? 'text-error'
                              : memPercent >= 60
                                ? 'text-warning'
                                : 'text-success',
                          )}
                        >
                          {memPercent}%
                        </span>
                      </div>
                      <div className="h-2 bg-bg-base rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${memPercent}%` }}
                          transition={{ duration: 0.5, delay: index * 0.03 + 0.1 }}
                          className={cn(
                            'h-full rounded-full',
                            memPercent >= 80
                              ? 'bg-error'
                              : memPercent >= 60
                                ? 'bg-warning'
                                : 'bg-success',
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* VMs */}
                  <div className="col-span-1 text-center">
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-semibold',
                        node.status.vmIds.length > 0
                          ? 'bg-accent/10 text-accent'
                          : 'bg-bg-elevated text-text-muted',
                      )}
                    >
                      {node.status.vmIds.length}
                    </span>
                  </div>

                  {/* Location (Rack + Zone) */}
                  <div className="col-span-1 text-right">
                    <div className="flex flex-col items-end gap-0.5">
                      {node.labels['rack'] && (
                        <span className="text-xs text-text-secondary">
                          Rack: <span className="text-text-primary font-medium">{node.labels['rack']}</span>
                        </span>
                      )}
                      {node.labels['zone'] && (
                        <span className="text-xs text-text-secondary">
                          Zone: <span className="text-text-primary font-medium">{node.labels['zone']}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Empty State */}
          {filteredHosts.length === 0 && (
            <div className="py-16 text-center">
              <Server className="w-12 h-12 mx-auto text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No Hosts Found</h3>
              <p className="text-text-muted mb-4 max-w-md mx-auto">
                {searchQuery
                  ? 'No hosts match your search criteria'
                  : 'No hosts have registered with the cluster yet. Generate a registration token to add your first host.'}
              </p>
              {!searchQuery && (
                <Button size="sm" onClick={() => setShowAddHostModal(true)}>
                  <Plus className="w-4 h-4" />
                  Add Host
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add Host Modal */}
      <AddHostModal 
        isOpen={showAddHostModal} 
        onClose={() => setShowAddHostModal(false)} 
      />

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu.visible && contextMenu.node && (
          <motion.div
            ref={contextMenuRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className={cn(
              'fixed z-50 min-w-[200px]',
              'bg-bg-surface border border-border rounded-lg shadow-xl',
              'py-1 overflow-hidden',
            )}
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
            }}
          >
            {/* Header */}
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium text-text-primary">{contextMenu.node.hostname}</p>
              <p className="text-xs text-text-muted">{contextMenu.node.managementIp}</p>
            </div>

            {/* Actions */}
            <div className="py-1">
              <ContextMenuItem
                icon={<Terminal className="w-4 h-4" />}
                label="Open Console"
                onClick={() => handleContextAction('console')}
              />
              <ContextMenuItem
                icon={<Activity className="w-4 h-4" />}
                label="View Metrics"
                onClick={() => handleContextAction('metrics')}
              />
              
              <div className="my-1 border-t border-border" />
              
              <ContextMenuItem
                icon={<ArrowRightLeft className="w-4 h-4" />}
                label="Migrate VMs"
                onClick={() => handleContextAction('migrate')}
              />
              <ContextMenuItem
                icon={<Wrench className="w-4 h-4" />}
                label="Enter Maintenance"
                onClick={() => handleContextAction('maintenance')}
              />
              <ContextMenuItem
                icon={<PowerOff className="w-4 h-4" />}
                label="Drain Host"
                onClick={() => handleContextAction('drain')}
              />
              
              <div className="my-1 border-t border-border" />
              
              <ContextMenuItem
                icon={<Edit className="w-4 h-4" />}
                label="Edit Labels"
                onClick={() => handleContextAction('edit-labels')}
              />
              <ContextMenuItem
                icon={<Settings className="w-4 h-4" />}
                label="Configure"
                onClick={() => handleContextAction('configure')}
              />
              
              <div className="my-1 border-t border-border" />
              
              <ContextMenuItem
                icon={<Power className="w-4 h-4" />}
                label="Reboot"
                onClick={() => handleContextAction('reboot')}
                variant="warning"
              />
              <ContextMenuItem
                icon={<Trash2 className="w-4 h-4" />}
                label="Remove from Cluster"
                onClick={() => handleContextAction('remove')}
                variant="danger"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Context Menu Item Component
function ContextMenuItem({
  icon,
  label,
  onClick,
  variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'warning' | 'danger';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-sm',
        'transition-colors duration-100',
        variant === 'default' && 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
        variant === 'warning' && 'text-warning hover:bg-warning/10',
        variant === 'danger' && 'text-error hover:bg-error/10',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
