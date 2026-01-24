/**
 * Cluster View - Hierarchical Tree Interface
 * 
 * A vCenter-style hierarchical view showing:
 * - Clusters at the top level
 * - Hosts under each cluster
 * - VMs under each host
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Boxes,
  Server,
  Monitor,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  Plus,
  Loader2,
  X,
  Maximize2,
  Minimize2,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Play,
  Square,
  Settings,
  Trash2,
  ArrowLeft,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Shield,
  Zap,
  Power,
  RotateCcw,
  Edit,
  Copy,
  ArrowRightLeft,
  Wrench,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { VMStatusBadge } from '@/components/vm/VMStatusBadge';
import { useClusters, useClusterHosts, toDisplayCluster, type Cluster } from '@/hooks/useClusters';
import { useNodes, type ApiNode } from '@/hooks/useNodes';
import { useVMs, useStartVM, useStopVM, useDeleteVM, type ApiVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';
import { type VirtualMachine, type PowerState } from '@/types/models';
import { showInfo, showWarning, showSuccess, showError } from '@/lib/toast';
import { toast } from 'sonner';

// Status configurations
const clusterStatusConfig = {
  HEALTHY: { color: 'success', icon: CheckCircle, label: 'Healthy' },
  WARNING: { color: 'warning', icon: AlertTriangle, label: 'Warning' },
  CRITICAL: { color: 'error', icon: XCircle, label: 'Critical' },
  MAINTENANCE: { color: 'info', icon: Settings, label: 'Maintenance' },
} as const;

const nodePhaseConfig: Record<string, { color: string; label: string }> = {
  READY: { color: 'success', label: 'Ready' },
  NODE_PHASE_READY: { color: 'success', label: 'Ready' },
  NOT_READY: { color: 'error', label: 'Not Ready' },
  MAINTENANCE: { color: 'info', label: 'Maintenance' },
  DRAINING: { color: 'warning', label: 'Draining' },
  PENDING: { color: 'warning', label: 'Pending' },
  DISCONNECTED: { color: 'error', label: 'Disconnected' },
  OFFLINE: { color: 'error', label: 'Disconnected' },
  ERROR: { color: 'error', label: 'Error' },
  UNKNOWN: { color: 'warning', label: 'Unknown' },
};

// Convert API VM to display format
function apiToDisplayVM(vm: ApiVM): VirtualMachine {
  const state = (vm.status?.state || 'STOPPED') as PowerState;
  return {
    id: vm.id,
    name: vm.name,
    projectId: vm.projectId,
    description: vm.description || '',
    labels: vm.labels || {},
    spec: {
      cpu: { cores: vm.spec?.cpu?.cores || 1, sockets: 1, model: 'host' },
      memory: { sizeMib: vm.spec?.memory?.sizeMib || 1024 },
      disks: (vm.spec?.disks || []).map((d, i) => ({
        id: `disk-${i}`,
        sizeGib: d.sizeGib || 0,
        bus: 'virtio',
      })),
      nics: [{ id: 'nic-0', networkId: 'default', macAddress: '00:00:00:00:00:00' }],
    },
    status: {
      state,
      nodeId: vm.status?.nodeId || '',
      ipAddresses: vm.status?.ipAddresses || [],
      resourceUsage: {
        cpuUsagePercent: vm.status?.resourceUsage?.cpuUsagePercent || 0,
        memoryUsedBytes: (vm.status?.resourceUsage?.memoryUsedMib || 0) * 1024 * 1024,
        memoryAllocatedBytes: (vm.spec?.memory?.sizeMib || 1024) * 1024 * 1024,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Linux',
        hostname: vm.name,
        agentVersion: '1.0.0',
        uptimeSeconds: 0,
      },
    },
    createdAt: vm.createdAt || new Date().toISOString(),
  };
}

// Context menu state types
interface VMContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  vm: VirtualMachine | null;
}

interface HostContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  host: ApiNode | null;
}

interface ClusterContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  cluster: Cluster | null;
}

// Selection types
type SelectionType = 'cluster' | 'host' | 'vm' | null;
interface Selection {
  type: SelectionType;
  id: string | null;
  data: Cluster | ApiNode | VirtualMachine | null;
}

export function ClusterView() {
  const navigate = useNavigate();
  
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<Selection>({ type: null, id: null, data: null });
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Context menu states
  const [vmContextMenu, setVmContextMenu] = useState<VMContextMenuState>({ visible: false, x: 0, y: 0, vm: null });
  const [hostContextMenu, setHostContextMenu] = useState<HostContextMenuState>({ visible: false, x: 0, y: 0, host: null });
  const [clusterContextMenu, setClusterContextMenu] = useState<ClusterContextMenuState>({ visible: false, x: 0, y: 0, cluster: null });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // API Connection
  const { data: isConnected = false } = useApiConnection();

  // Fetch data
  const { data: clustersResponse, isLoading: isLoadingClusters, refetch: refetchClusters, isRefetching: isRefetchingClusters } = useClusters();
  const { data: nodesResponse, isLoading: isLoadingNodes, refetch: refetchNodes } = useNodes({ pageSize: 100 });
  const { data: vmsResponse, isLoading: isLoadingVMs, refetch: refetchVMs } = useVMs({ enabled: !!isConnected });

  // Mutations
  const startVM = useStartVM();
  const stopVM = useStopVM();
  const deleteVM = useDeleteVM();

  // Process data
  const clusters = clustersResponse?.clusters || [];
  const allNodes = nodesResponse?.nodes || [];
  const allVMs = useMemo(() => (vmsResponse?.vms || []).map(apiToDisplayVM), [vmsResponse]);

  // Group hosts by cluster
  const hostsByCluster = useMemo(() => {
    const map = new Map<string, ApiNode[]>();
    allNodes.forEach((node) => {
      const clusterId = node.clusterId || '';
      if (clusterId) {
        const existing = map.get(clusterId) || [];
        existing.push(node);
        map.set(clusterId, existing);
      }
    });
    return map;
  }, [allNodes]);

  // Group VMs by host (nodeId)
  const vmsByHost = useMemo(() => {
    const map = new Map<string, VirtualMachine[]>();
    allVMs.forEach((vm) => {
      const nodeId = vm.status.nodeId || '';
      if (nodeId) {
        const existing = map.get(nodeId) || [];
        existing.push(vm);
        map.set(nodeId, existing);
      }
    });
    return map;
  }, [allVMs]);

  // Standalone hosts (not in any cluster)
  const standaloneHosts = useMemo(() => {
    return allNodes.filter((node) => !node.clusterId || node.clusterId === '');
  }, [allNodes]);

  // Close context menus on click outside or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setVmContextMenu((prev) => ({ ...prev, visible: false }));
        setHostContextMenu((prev) => ({ ...prev, visible: false }));
        setClusterContextMenu((prev) => ({ ...prev, visible: false }));
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVmContextMenu((prev) => ({ ...prev, visible: false }));
        setHostContextMenu((prev) => ({ ...prev, visible: false }));
        setClusterContextMenu((prev) => ({ ...prev, visible: false }));
        if (isFullscreen) setIsFullscreen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFullscreen]);

  // Handlers
  const handleToggleCluster = (clusterId: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  };

  const handleToggleHost = (hostId: string) => {
    setExpandedHosts((prev) => {
      const next = new Set(prev);
      if (next.has(hostId)) {
        next.delete(hostId);
      } else {
        next.add(hostId);
      }
      return next;
    });
  };

  const handleSelectCluster = (cluster: Cluster) => {
    setSelection({ type: 'cluster', id: cluster.id, data: cluster });
  };

  const handleSelectHost = (host: ApiNode) => {
    setSelection({ type: 'host', id: host.id, data: host });
  };

  const handleSelectVM = (vm: VirtualMachine) => {
    setSelection({ type: 'vm', id: vm.id, data: vm });
  };

  const handleRefresh = () => {
    refetchClusters();
    refetchNodes();
    refetchVMs();
  };

  // VM Context menu
  const handleVMContextMenu = (e: React.MouseEvent, vm: VirtualMachine) => {
    e.preventDefault();
    e.stopPropagation();
    setHostContextMenu((prev) => ({ ...prev, visible: false }));
    setClusterContextMenu((prev) => ({ ...prev, visible: false }));
    setVmContextMenu({ visible: true, x: e.clientX, y: e.clientY, vm });
  };

  const handleVMContextAction = async (action: string) => {
    if (!vmContextMenu.vm) return;
    const vm = vmContextMenu.vm;
    setVmContextMenu((prev) => ({ ...prev, visible: false }));

    switch (action) {
      case 'start':
        if (!isConnected) return showInfo('Not connected to backend');
        await startVM.mutateAsync(vm.id);
        break;
      case 'stop':
        if (!isConnected) return showInfo('Not connected to backend');
        await stopVM.mutateAsync({ id: vm.id, force: false });
        break;
      case 'restart':
        if (!isConnected) return showInfo('Not connected to backend');
        await stopVM.mutateAsync({ id: vm.id, force: false });
        setTimeout(() => startVM.mutateAsync(vm.id), 2000);
        toast.info('Restarting VM...');
        break;
      case 'details':
        navigate(`/vms/${vm.id}`);
        break;
      case 'console':
        if (vm.status.state !== 'RUNNING') {
          showInfo('VM must be running to open console');
          return;
        }
        navigate(`/vms/${vm.id}?tab=console`);
        break;
      case 'delete':
        if (!confirm(`Are you sure you want to delete "${vm.name}"?`)) return;
        if (!isConnected) return showInfo('Not connected to backend');
        await deleteVM.mutateAsync({ id: vm.id });
        break;
      default:
        showInfo(`Action "${action}" on VM "${vm.name}"`);
    }
  };

  // Host Context menu
  const handleHostContextMenu = (e: React.MouseEvent, host: ApiNode) => {
    e.preventDefault();
    e.stopPropagation();
    setVmContextMenu((prev) => ({ ...prev, visible: false }));
    setClusterContextMenu((prev) => ({ ...prev, visible: false }));
    setHostContextMenu({ visible: true, x: e.clientX, y: e.clientY, host });
  };

  const handleHostContextAction = (action: string) => {
    if (!hostContextMenu.host) return;
    const host = hostContextMenu.host;
    setHostContextMenu((prev) => ({ ...prev, visible: false }));

    switch (action) {
      case 'details':
        navigate(`/hosts/${host.id}`);
        break;
      case 'maintenance':
        showWarning(`Maintenance mode for "${host.hostname}" coming soon`);
        break;
      case 'migrate_vms':
        showWarning(`Migrate VMs from "${host.hostname}" coming soon`);
        break;
      default:
        showInfo(`Action "${action}" on host "${host.hostname}"`);
    }
  };

  // Cluster Context menu
  const handleClusterContextMenu = (e: React.MouseEvent, cluster: Cluster) => {
    e.preventDefault();
    e.stopPropagation();
    setVmContextMenu((prev) => ({ ...prev, visible: false }));
    setHostContextMenu((prev) => ({ ...prev, visible: false }));
    setClusterContextMenu({ visible: true, x: e.clientX, y: e.clientY, cluster });
  };

  const handleClusterContextAction = (action: string) => {
    if (!clusterContextMenu.cluster) return;
    const cluster = clusterContextMenu.cluster;
    setClusterContextMenu((prev) => ({ ...prev, visible: false }));

    switch (action) {
      case 'details':
        navigate(`/clusters/${cluster.id}`);
        break;
      case 'add_host':
        navigate(`/clusters/${cluster.id}?tab=hosts`);
        break;
      case 'settings':
        navigate(`/clusters/${cluster.id}?tab=settings`);
        break;
      default:
        showInfo(`Action "${action}" on cluster "${cluster.name}"`);
    }
  };

  const isLoading = isLoadingClusters || isLoadingNodes || isLoadingVMs;
  const isRefetching = isRefetchingClusters;

  return (
    <div className={cn(
      'flex flex-col',
      isFullscreen ? 'fixed inset-0 z-50 bg-bg-base' : 'h-[calc(100vh-120px)]'
    )}>
      {/* Header */}
      <div className={cn(
        'flex items-center justify-between px-6 py-4 border-b border-border',
        'bg-bg-surface'
      )}>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/clusters')}>
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div className="h-5 w-px bg-border" />
          <h1 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Boxes className="w-5 h-5 text-accent" />
            Cluster Inventory
          </h1>
          {/* Connection Status */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            isConnected
              ? 'bg-success/20 text-success border border-success/30'
              : 'bg-warning/20 text-warning border border-warning/30',
          )}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefetching}>
            <RefreshCw className={cn('w-4 h-4', isRefetching && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsFullscreen(!isFullscreen)}>
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Tree View */}
        <div className={cn(
          'w-80 flex flex-col flex-shrink-0 border-r border-border',
          'bg-bg-surface'
        )}>
          {/* Search */}
          <div className="p-4 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className={cn(
                  'w-full pl-10 pr-4 py-2 rounded-lg text-sm',
                  'bg-bg-base border border-border',
                  'text-text-primary placeholder:text-text-muted',
                  'focus:outline-none focus:ring-1 focus:ring-accent/30 focus:border-accent',
                )}
              />
            </div>
          </div>

          {/* Tree */}
          <div className="flex-1 overflow-y-auto py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            ) : (
              <>
                {/* Clusters */}
                {clusters.map((cluster) => (
                  <ClusterNode
                    key={cluster.id}
                    cluster={cluster}
                    isExpanded={expandedClusters.has(cluster.id)}
                    isSelected={selection.type === 'cluster' && selection.id === cluster.id}
                    hosts={hostsByCluster.get(cluster.id) || []}
                    vmsByHost={vmsByHost}
                    expandedHosts={expandedHosts}
                    selection={selection}
                    onToggle={() => handleToggleCluster(cluster.id)}
                    onSelect={() => handleSelectCluster(cluster)}
                    onToggleHost={handleToggleHost}
                    onSelectHost={handleSelectHost}
                    onSelectVM={handleSelectVM}
                    onContextMenu={handleClusterContextMenu}
                    onHostContextMenu={handleHostContextMenu}
                    onVMContextMenu={handleVMContextMenu}
                  />
                ))}

                {/* Standalone Hosts (not in any cluster) */}
                {standaloneHosts.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border mx-2">
                    <div className="px-3 py-1 text-xs font-medium text-text-muted uppercase tracking-wider">
                      Standalone Hosts
                    </div>
                    {standaloneHosts.map((host) => (
                      <HostNode
                        key={host.id}
                        host={host}
                        level={0}
                        isExpanded={expandedHosts.has(host.id)}
                        isSelected={selection.type === 'host' && selection.id === host.id}
                        vms={vmsByHost.get(host.id) || []}
                        selection={selection}
                        onToggle={() => handleToggleHost(host.id)}
                        onSelect={() => handleSelectHost(host)}
                        onSelectVM={handleSelectVM}
                        onContextMenu={handleHostContextMenu}
                        onVMContextMenu={handleVMContextMenu}
                      />
                    ))}
                  </div>
                )}

                {/* Empty State */}
                {clusters.length === 0 && standaloneHosts.length === 0 && (
                  <div className="text-center py-8 px-4">
                    <Boxes className="w-10 h-10 text-text-muted mx-auto mb-3" />
                    <p className="text-sm text-text-muted">No clusters or hosts found</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Panel - Details */}
        <div className="flex-1 overflow-y-auto bg-bg-base p-6">
          {selection.type === null ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Boxes className="w-16 h-16 text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">Select an Item</h3>
              <p className="text-sm text-text-muted max-w-md">
                Select a cluster, host, or VM from the tree to view details
              </p>
            </div>
          ) : selection.type === 'cluster' && selection.data ? (
            <ClusterDetails cluster={selection.data as Cluster} />
          ) : selection.type === 'host' && selection.data ? (
            <HostDetails host={selection.data as ApiNode} vms={vmsByHost.get(selection.id!) || []} />
          ) : selection.type === 'vm' && selection.data ? (
            <VMDetails vm={selection.data as VirtualMachine} />
          ) : null}
        </div>
      </div>

      {/* VM Context Menu */}
      <AnimatePresence>
        {vmContextMenu.visible && vmContextMenu.vm && (
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
            style={{ left: vmContextMenu.x, top: vmContextMenu.y }}
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium text-text-primary">{vmContextMenu.vm.name}</p>
              <p className="text-xs text-text-muted">{vmContextMenu.vm.status.state}</p>
            </div>
            <div className="py-1">
              <ContextMenuItem icon={<Monitor className="w-4 h-4" />} label="View Details" onClick={() => handleVMContextAction('details')} />
              <ContextMenuItem icon={<Monitor className="w-4 h-4" />} label="Open Console" onClick={() => handleVMContextAction('console')} disabled={vmContextMenu.vm.status.state !== 'RUNNING'} />
              <div className="my-1 border-t border-border" />
              {vmContextMenu.vm.status.state === 'RUNNING' ? (
                <>
                  <ContextMenuItem icon={<Square className="w-4 h-4" />} label="Stop" onClick={() => handleVMContextAction('stop')} />
                  <ContextMenuItem icon={<RotateCcw className="w-4 h-4" />} label="Restart" onClick={() => handleVMContextAction('restart')} />
                </>
              ) : (
                <ContextMenuItem icon={<Play className="w-4 h-4" />} label="Start" onClick={() => handleVMContextAction('start')} />
              )}
              <div className="my-1 border-t border-border" />
              <ContextMenuItem icon={<Trash2 className="w-4 h-4" />} label="Delete" onClick={() => handleVMContextAction('delete')} variant="danger" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Host Context Menu */}
      <AnimatePresence>
        {hostContextMenu.visible && hostContextMenu.host && (
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
            style={{ left: hostContextMenu.x, top: hostContextMenu.y }}
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium text-text-primary">{hostContextMenu.host.hostname}</p>
              <p className="text-xs text-text-muted">{hostContextMenu.host.managementIp}</p>
            </div>
            <div className="py-1">
              <ContextMenuItem icon={<Server className="w-4 h-4" />} label="View Details" onClick={() => handleHostContextAction('details')} />
              <div className="my-1 border-t border-border" />
              <ContextMenuItem icon={<Wrench className="w-4 h-4" />} label="Enter Maintenance" onClick={() => handleHostContextAction('maintenance')} />
              <ContextMenuItem icon={<ArrowRightLeft className="w-4 h-4" />} label="Migrate VMs" onClick={() => handleHostContextAction('migrate_vms')} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cluster Context Menu */}
      <AnimatePresence>
        {clusterContextMenu.visible && clusterContextMenu.cluster && (
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
            style={{ left: clusterContextMenu.x, top: clusterContextMenu.y }}
          >
            <div className="px-3 py-2 border-b border-border">
              <p className="text-sm font-medium text-text-primary">{clusterContextMenu.cluster.name}</p>
              <p className="text-xs text-text-muted">{clusterContextMenu.cluster.status}</p>
            </div>
            <div className="py-1">
              <ContextMenuItem icon={<Boxes className="w-4 h-4" />} label="View Details" onClick={() => handleClusterContextAction('details')} />
              <ContextMenuItem icon={<Plus className="w-4 h-4" />} label="Add Host" onClick={() => handleClusterContextAction('add_host')} />
              <ContextMenuItem icon={<Settings className="w-4 h-4" />} label="Settings" onClick={() => handleClusterContextAction('settings')} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Cluster Node Component
function ClusterNode({
  cluster,
  isExpanded,
  isSelected,
  hosts,
  vmsByHost,
  expandedHosts,
  selection,
  onToggle,
  onSelect,
  onToggleHost,
  onSelectHost,
  onSelectVM,
  onContextMenu,
  onHostContextMenu,
  onVMContextMenu,
}: {
  cluster: Cluster;
  isExpanded: boolean;
  isSelected: boolean;
  hosts: ApiNode[];
  vmsByHost: Map<string, VirtualMachine[]>;
  expandedHosts: Set<string>;
  selection: Selection;
  onToggle: () => void;
  onSelect: () => void;
  onToggleHost: (hostId: string) => void;
  onSelectHost: (host: ApiNode) => void;
  onSelectVM: (vm: VirtualMachine) => void;
  onContextMenu: (e: React.MouseEvent, cluster: Cluster) => void;
  onHostContextMenu: (e: React.MouseEvent, host: ApiNode) => void;
  onVMContextMenu: (e: React.MouseEvent, vm: VirtualMachine) => void;
}) {
  const status = clusterStatusConfig[cluster.status] || clusterStatusConfig.HEALTHY;
  const hasChildren = hosts.length > 0;
  const totalVMs = hosts.reduce((acc, host) => acc + (vmsByHost.get(host.id)?.length || 0), 0);

  return (
    <div>
      {/* Cluster Row */}
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer rounded-lg mx-2 my-0.5',
          'transition-all duration-200',
          'hover:bg-bg-hover',
          isSelected && 'bg-accent/10 border border-accent/30',
          !isSelected && 'border border-transparent'
        )}
        onClick={onSelect}
        onDoubleClick={onToggle}
        onContextMenu={(e) => onContextMenu(e, cluster)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        >
          {hasChildren && (
            <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
            </motion.div>
          )}
        </button>
        <div className={cn(
          'p-1.5 rounded-md flex-shrink-0',
          'bg-accent/10'
        )}>
          <Boxes className="w-4 h-4 text-accent" />
        </div>
        <span className={cn(
          'flex-1 text-sm truncate font-medium',
          isSelected ? 'text-text-primary' : 'text-text-secondary'
        )}>
          {cluster.name}
        </span>
        <div className="flex items-center gap-2">
          {cluster.ha_enabled && <Shield className="w-3 h-3 text-success" />}
          {cluster.drs_enabled && <Zap className="w-3 h-3 text-accent" />}
          <span className="text-xs text-text-muted">{hosts.length}H / {totalVMs}VM</span>
        </div>
      </motion.div>

      {/* Expanded Content - Hosts */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {hosts.map((host) => (
              <HostNode
                key={host.id}
                host={host}
                level={1}
                isExpanded={expandedHosts.has(host.id)}
                isSelected={selection.type === 'host' && selection.id === host.id}
                vms={vmsByHost.get(host.id) || []}
                selection={selection}
                onToggle={() => onToggleHost(host.id)}
                onSelect={() => onSelectHost(host)}
                onSelectVM={onSelectVM}
                onContextMenu={onHostContextMenu}
                onVMContextMenu={onVMContextMenu}
              />
            ))}
            {hosts.length === 0 && (
              <div className="pl-12 pr-3 py-2 text-xs text-text-muted italic">
                No hosts in this cluster
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Host Node Component
function HostNode({
  host,
  level,
  isExpanded,
  isSelected,
  vms,
  selection,
  onToggle,
  onSelect,
  onSelectVM,
  onContextMenu,
  onVMContextMenu,
}: {
  host: ApiNode;
  level: number;
  isExpanded: boolean;
  isSelected: boolean;
  vms: VirtualMachine[];
  selection: Selection;
  onToggle: () => void;
  onSelect: () => void;
  onSelectVM: (vm: VirtualMachine) => void;
  onContextMenu: (e: React.MouseEvent, host: ApiNode) => void;
  onVMContextMenu: (e: React.MouseEvent, vm: VirtualMachine) => void;
}) {
  let phase = host.status?.phase || 'PENDING';
  if (phase === 'OFFLINE') phase = 'DISCONNECTED';
  const phaseConfig = nodePhaseConfig[phase] || { color: 'default', label: phase };
  const hasChildren = vms.length > 0;
  const isDisconnected = phase === 'DISCONNECTED';

  return (
    <div>
      {/* Host Row */}
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer rounded-lg mx-2 my-0.5',
          'transition-all duration-200',
          'hover:bg-bg-hover',
          isSelected && 'bg-accent/10 border border-accent/30',
          !isSelected && 'border border-transparent',
          isDisconnected && 'bg-error/5'
        )}
        style={{ paddingLeft: `${level * 16 + 12}px` }}
        onClick={onSelect}
        onDoubleClick={onToggle}
        onContextMenu={(e) => onContextMenu(e, host)}
      >
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        >
          {hasChildren && (
            <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
            </motion.div>
          )}
        </button>
        <div className={cn(
          'p-1.5 rounded-md flex-shrink-0',
          isDisconnected ? 'bg-error/10' : 'bg-success/10'
        )}>
          <Server className={cn('w-4 h-4', isDisconnected ? 'text-error' : 'text-success')} />
        </div>
        <span className={cn(
          'flex-1 text-sm truncate',
          isSelected ? 'text-text-primary font-medium' : 'text-text-secondary',
          isDisconnected && 'text-error'
        )}>
          {host.hostname || host.id}
        </span>
        <Badge variant={phaseConfig.color as any} className="text-xs">
          {phaseConfig.label}
        </Badge>
        <span className="text-xs text-text-muted">{vms.length} VM</span>
      </motion.div>

      {/* Expanded Content - VMs */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {vms.map((vm) => (
              <VMNode
                key={vm.id}
                vm={vm}
                level={level + 1}
                isSelected={selection.type === 'vm' && selection.id === vm.id}
                onSelect={() => onSelectVM(vm)}
                onContextMenu={onVMContextMenu}
              />
            ))}
            {vms.length === 0 && (
              <div className="pr-3 py-2 text-xs text-text-muted italic" style={{ paddingLeft: `${(level + 1) * 16 + 28}px` }}>
                No VMs on this host
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// VM Node Component
function VMNode({
  vm,
  level,
  isSelected,
  onSelect,
  onContextMenu,
}: {
  vm: VirtualMachine;
  level: number;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent, vm: VirtualMachine) => void;
}) {
  const isRunning = vm.status.state === 'RUNNING';

  return (
    <motion.div
      whileHover={{ x: 2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'flex items-center gap-2 px-3 py-2 cursor-pointer rounded-lg mx-2 my-0.5',
        'transition-all duration-200',
        'hover:bg-bg-hover',
        isSelected && 'bg-accent/10 border border-accent/30',
        !isSelected && 'border border-transparent'
      )}
      style={{ paddingLeft: `${level * 16 + 28}px` }}
      onClick={onSelect}
      onContextMenu={(e) => onContextMenu(e, vm)}
    >
      <div className={cn(
        'p-1.5 rounded-md flex-shrink-0',
        isRunning ? 'bg-green-500/10' : 'bg-gray-500/10'
      )}>
        <Monitor className={cn('w-3.5 h-3.5', isRunning ? 'text-green-400' : 'text-gray-400')} />
      </div>
      <span className={cn(
        'flex-1 text-sm truncate',
        isSelected ? 'text-text-primary font-medium' : 'text-text-secondary'
      )}>
        {vm.name}
      </span>
      <div className={cn(
        'w-2 h-2 rounded-full flex-shrink-0',
        isRunning ? 'bg-green-400' : 'bg-gray-500'
      )} />
    </motion.div>
  );
}

// Detail Components
function ClusterDetails({ cluster }: { cluster: Cluster }) {
  const status = clusterStatusConfig[cluster.status] || clusterStatusConfig.HEALTHY;
  const StatusIcon = status.icon;
  const cpuPercent = cluster.stats.cpu_total_ghz > 0 ? Math.round((cluster.stats.cpu_used_ghz / cluster.stats.cpu_total_ghz) * 100) : 0;
  const memPercent = cluster.stats.memory_total_bytes > 0 ? Math.round((cluster.stats.memory_used_bytes / cluster.stats.memory_total_bytes) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center">
          <Boxes className="w-7 h-7 text-accent" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-primary">{cluster.name}</h2>
            <Badge variant={status.color as any}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {status.label}
            </Badge>
          </div>
          <p className="text-text-muted mt-1">{cluster.description || 'No description'}</p>
          <div className="flex items-center gap-3 mt-2">
            {cluster.ha_enabled && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 text-success text-xs">
                <Shield className="w-3 h-3" />
                HA Enabled
              </div>
            )}
            {cluster.drs_enabled && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent/10 text-accent text-xs">
                <Zap className="w-3 h-3" />
                DRS ({cluster.drs_mode})
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Hosts" value={`${cluster.stats.online_hosts}/${cluster.stats.total_hosts}`} icon={<Server className="w-5 h-5" />} />
        <StatCard label="VMs" value={`${cluster.stats.running_vms}/${cluster.stats.total_vms}`} icon={<Monitor className="w-5 h-5" />} />
        <StatCard label="CPU" value={`${cpuPercent}%`} icon={<Cpu className="w-5 h-5" />} />
        <StatCard label="Memory" value={`${memPercent}%`} icon={<MemoryStick className="w-5 h-5" />} />
      </div>
    </div>
  );
}

function HostDetails({ host, vms }: { host: ApiNode; vms: VirtualMachine[] }) {
  let phase = host.status?.phase || 'PENDING';
  if (phase === 'OFFLINE') phase = 'DISCONNECTED';
  const phaseConfig = nodePhaseConfig[phase] || { color: 'default', label: phase };
  const cpuCores = (host.spec?.cpu?.sockets || 1) * (host.spec?.cpu?.coresPerSocket || 1);
  const memoryGiB = Math.round((host.spec?.memory?.totalBytes || 0) / 1024 / 1024 / 1024);
  const runningVMs = vms.filter(vm => vm.status.state === 'RUNNING').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-xl bg-success/10 flex items-center justify-center">
          <Server className="w-7 h-7 text-success" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-primary">{host.hostname || host.id}</h2>
            <Badge variant={phaseConfig.color as any}>{phaseConfig.label}</Badge>
          </div>
          <p className="text-text-muted mt-1 font-mono text-sm">{host.managementIp}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="CPU Cores" value={cpuCores.toString()} icon={<Cpu className="w-5 h-5" />} />
        <StatCard label="Memory" value={`${memoryGiB} GB`} icon={<MemoryStick className="w-5 h-5" />} />
        <StatCard label="VMs" value={`${runningVMs}/${vms.length}`} icon={<Monitor className="w-5 h-5" />} />
        <StatCard label="Model" value={host.spec?.cpu?.model || 'Unknown'} icon={<Server className="w-5 h-5" />} />
      </div>
    </div>
  );
}

function VMDetails({ vm }: { vm: VirtualMachine }) {
  const memoryGiB = Math.round(vm.spec.memory.sizeMib / 1024);
  const diskTotal = vm.spec.disks.reduce((acc, d) => acc + d.sizeGib, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className={cn(
          'w-14 h-14 rounded-xl flex items-center justify-center',
          vm.status.state === 'RUNNING' ? 'bg-green-500/10' : 'bg-gray-500/10'
        )}>
          <Monitor className={cn('w-7 h-7', vm.status.state === 'RUNNING' ? 'text-green-400' : 'text-gray-400')} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-primary">{vm.name}</h2>
            <VMStatusBadge status={vm.status.state} />
          </div>
          <p className="text-text-muted mt-1">{vm.description || 'No description'}</p>
          {vm.status.ipAddresses.length > 0 && (
            <p className="text-text-secondary mt-1 font-mono text-sm">{vm.status.ipAddresses.join(', ')}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="vCPUs" value={vm.spec.cpu.cores.toString()} icon={<Cpu className="w-5 h-5" />} />
        <StatCard label="Memory" value={`${memoryGiB} GB`} icon={<MemoryStick className="w-5 h-5" />} />
        <StatCard label="Storage" value={`${diskTotal} GB`} icon={<HardDrive className="w-5 h-5" />} />
        <StatCard label="Host" value={vm.status.nodeId || 'Unassigned'} icon={<Server className="w-5 h-5" />} />
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-bg-surface border border-border">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-accent/10 text-accent">{icon}</div>
        <div>
          <p className="text-xs text-text-muted">{label}</p>
          <p className="text-lg font-bold text-text-primary">{value}</p>
        </div>
      </div>
    </div>
  );
}

// Context Menu Item Component
function ContextMenuItem({
  icon,
  label,
  onClick,
  variant = 'default',
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'warning' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 text-sm',
        'transition-colors duration-100',
        disabled && 'opacity-50 cursor-not-allowed',
        !disabled && variant === 'default' && 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
        !disabled && variant === 'warning' && 'text-warning hover:bg-warning/10',
        !disabled && variant === 'danger' && 'text-error hover:bg-error/10',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
