import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  Play,
  Square,
  MoreHorizontal,
  MonitorCog,
  Monitor,
  Download,
  Trash2,
  Wifi,
  WifiOff,
  Loader2,
  RotateCcw,
  Settings,
  Copy,
  Power,
  Edit,
  ArrowRightLeft,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { VMStatusBadge } from '@/components/vm/VMStatusBadge';
import { VMCreationWizard } from '@/components/vm/VMCreationWizard';
import { DeleteVMModal } from '@/components/vm/DeleteVMModal';
import { useVMs, useStartVM, useStopVM, useDeleteVM, isVMRunning, isVMStopped, type ApiVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';
import { useActionLogger } from '@/hooks/useActionLogger';
import { type VirtualMachine, type PowerState } from '@/types/models';
import { showInfo, showWarning, showSuccess, showError } from '@/lib/toast';
import { useConsoleStore, useDefaultConsoleType } from '@/hooks/useConsoleStore';
import { openDefaultConsole } from '@/components/vm/ConsoleAccessModal';
import { API_CONFIG } from '@/lib/api-client';

type FilterTab = 'all' | 'running' | 'stopped' | 'other';

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  vm: VirtualMachine | null;
}

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

export function VMList() {
  const navigate = useNavigate();
  const logger = useActionLogger('vm');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set());
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    vm: null,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  
  // Delete modal state
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    vm: VirtualMachine | null;
  }>({ isOpen: false, vm: null });

  // Console store for quick console access
  const { openConsole } = useConsoleStore();

  // API connection and data
  const { data: isConnected = false, isLoading: isCheckingConnection } = useApiConnection();
  const { data: apiResponse, isLoading: isLoadingVMs, refetch, isRefetching } = useVMs({ enabled: !!isConnected });

  // Mutations for VM actions
  const startVM = useStartVM();
  const stopVM = useStopVM();
  const deleteVM = useDeleteVM();

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

  // Get data from API
  const apiVMs = apiResponse?.vms || [];
  const allVMs: VirtualMachine[] = apiVMs.map(apiToDisplayVM);

  // Filter VMs based on search and tab
  const filteredVMs = allVMs.filter((vm) => {
    const matchesSearch =
      vm.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vm.status.ipAddresses.some((ip) => ip.includes(searchQuery)) ||
      vm.status.guestInfo.osName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'running' && vm.status.state === 'RUNNING') ||
      (activeTab === 'stopped' && vm.status.state === 'STOPPED') ||
      (activeTab === 'other' && !['RUNNING', 'STOPPED'].includes(vm.status.state));

    return matchesSearch && matchesTab;
  });

  const vmCounts = {
    all: allVMs.length,
    running: allVMs.filter((vm) => vm.status.state === 'RUNNING').length,
    stopped: allVMs.filter((vm) => vm.status.state === 'STOPPED').length,
    other: allVMs.filter((vm) => !['RUNNING', 'STOPPED'].includes(vm.status.state)).length,
  };

  const toggleSelectVM = (id: string) => {
    setSelectedVMs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedVMs.size === filteredVMs.length) {
      setSelectedVMs(new Set());
    } else {
      setSelectedVMs(new Set(filteredVMs.map((vm) => vm.id)));
    }
  };

  const handleVMClick = (vm: VirtualMachine) => {
    navigate(`/vms/${vm.id}`);
  };

  // Action handlers
  const handleStartVM = async (vmId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    logger.logClick('start-vm', { vmId });
    if (!isConnected) {
      showInfo('Not connected to backend');
      return;
    }
    setActionInProgress(vmId);
    try {
      await startVM.mutateAsync(vmId);
      logger.logSuccess('start-vm', `VM ${vmId} started successfully`, { vmId });
    } catch (error) {
      logger.logError('start-vm', error instanceof Error ? error : 'Failed to start VM', { vmId });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStopVM = async (vmId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    logger.logClick('stop-vm', { vmId });
    if (!isConnected) {
      showInfo('Not connected to backend');
      return;
    }
    setActionInProgress(vmId);
    try {
      await stopVM.mutateAsync({ id: vmId });
      logger.logSuccess('stop-vm', `VM ${vmId} stopped successfully`, { vmId });
    } catch (error) {
      logger.logError('stop-vm', error instanceof Error ? error : 'Failed to stop VM', { vmId });
    } finally {
      setActionInProgress(null);
    }
  };

  // Open delete modal for a VM
  const handleDeleteVM = (vmId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    logger.logClick('delete-vm', { vmId });
    
    if (!isConnected) {
      showInfo('Not connected to backend');
      return;
    }
    
    // Find the VM to get its details for the modal
    const vm = vms.find(v => v.id === vmId);
    if (vm) {
      setDeleteModalState({ isOpen: true, vm });
    }
  };

  // Handle delete confirmation from modal
  const handleDeleteConfirm = async (options: {
    deleteVolumes: boolean;
    removeFromInventoryOnly: boolean;
    force: boolean;
  }) => {
    const vm = deleteModalState.vm;
    if (!vm || !isConnected) return;
    
    setActionInProgress(vm.id);
    try {
      await deleteVM.mutateAsync({ 
        id: vm.id,
        force: options.force,
        deleteVolumes: options.deleteVolumes,
        removeFromInventoryOnly: options.removeFromInventoryOnly,
      });
      logger.logSuccess('delete-vm', `VM ${vm.id} deleted successfully`, { vmId: vm.id });
    } catch (error) {
      logger.logError('delete-vm', error instanceof Error ? error : 'Failed to delete VM', { vmId: vm.id });
    } finally {
      setActionInProgress(null);
    }
  };

  // Quick console access - uses default console preference
  const handleOpenConsole = (vm: VirtualMachine, e: React.MouseEvent) => {
    e.stopPropagation();
    if (vm.status.state !== 'RUNNING') {
      showInfo('VM must be running to open console');
      return;
    }
    
    // Use default console type preference
    openDefaultConsole(
      vm.id,
      vm.name,
      API_CONFIG.baseUrl,
      () => {
        // Web console: open in console dock
        openConsole(vm.id, vm.name);
        navigate('/consoles');
      }
    );
  };

  // Bulk actions
  const handleBulkStart = async () => {
    for (const vmId of selectedVMs) {
      await handleStartVM(vmId);
    }
    setSelectedVMs(new Set());
  };

  const handleBulkStop = async () => {
    for (const vmId of selectedVMs) {
      await handleStopVM(vmId);
    }
    setSelectedVMs(new Set());
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Are you sure you want to delete ${selectedVMs.size} VMs? This will permanently delete all disk files.`)) return;
    if (!isConnected) {
      showInfo('Not connected to backend');
      return;
    }
    
    for (const vmId of selectedVMs) {
      setActionInProgress(vmId);
      try {
        await deleteVM.mutateAsync({ 
          id: vmId,
          force: true,
          deleteVolumes: true,
          removeFromInventoryOnly: false,
        });
        logger.logSuccess('delete-vm', `VM ${vmId} deleted successfully`, { vmId });
      } catch (error) {
        logger.logError('delete-vm', error instanceof Error ? error : 'Failed to delete VM', { vmId });
      } finally {
        setActionInProgress(null);
      }
    }
    setSelectedVMs(new Set());
  };

  const handleContextMenu = (e: React.MouseEvent, vm: VirtualMachine) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      vm,
    });
  };

  const handleContextAction = async (action: string) => {
    if (!contextMenu.vm) return;
    const vm = contextMenu.vm;
    
    setContextMenu((prev) => ({ ...prev, visible: false }));
    
    // Handle actions
    switch (action) {
      case 'start':
        await handleStartVM(vm.id);
        break;
      case 'stop':
        await handleStopVM(vm.id);
        break;
      case 'restart':
        if (!isConnected) {
          showInfo('Not connected to backend');
          return;
        }
        setActionInProgress(vm.id);
        try {
          await stopVM.mutateAsync({ id: vm.id });
          // Wait a moment then start
          setTimeout(async () => {
            await startVM.mutateAsync(vm.id);
            setActionInProgress(null);
          }, 2000);
          showInfo(`Restarting "${vm.name}"...`);
        } catch (error) {
          showError(error instanceof Error ? error.message : 'Failed to restart VM');
          setActionInProgress(null);
        }
        break;
      case 'console':
        if (vm.status.state !== 'RUNNING') {
          showInfo('VM must be running to open console');
          return;
        }
        openDefaultConsole(
          vm.id,
          vm.name,
          API_CONFIG.baseUrl,
          () => {
            openConsole(vm.id, vm.name);
            navigate('/consoles');
          }
        );
        break;
      case 'details':
        navigate(`/vms/${vm.id}`);
        break;
      case 'edit':
        showWarning(`Edit settings for "${vm.name}" coming soon`);
        break;
      case 'clone':
        showWarning(`Clone "${vm.name}" coming soon`);
        break;
      case 'migrate':
        showWarning(`Migrate "${vm.name}" coming soon`);
        break;
      case 'delete':
        await handleDeleteVM(vm.id);
        break;
      default:
        showInfo(`Action "${action}" on VM "${vm.name}"`);
    }
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
            <h1 className="text-2xl font-bold text-text-primary">Virtual Machines</h1>
            <p className="text-text-muted mt-1">Manage your virtual machine inventory</p>
          </div>
          {/* Connection Status Badge */}
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
              isConnected
                ? 'bg-success/20 text-success border border-success/30'
                : 'bg-warning/20 text-warning border border-warning/30',
            )}
          >
            {isConnected ? (
              <>
                <Wifi className="w-3 h-3" />
                Connected to Backend
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                Not Connected
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm">
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button size="sm" onClick={() => setShowCreateWizard(true)}>
            <Plus className="w-4 h-4" />
            New VM
          </Button>
        </div>
      </motion.div>

      {/* Filters and Search */}
      <div className="flex items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-border">
          {(['all', 'running', 'stopped', 'other'] as FilterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all',
                activeTab === tab
                  ? 'bg-bg-elevated text-text-primary shadow-elevated'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              )}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)} ({vmCounts[tab]})
            </button>
          ))}
        </div>

        {/* Search and Actions */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search VMs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                'w-64 pl-9 pr-4 py-2 rounded-lg',
                'bg-bg-base border border-border',
                'text-sm text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
              )}
            />
          </div>
          <Button variant="ghost" size="sm">
            <Filter className="w-4 h-4" />
            Filters
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching || isLoadingVMs}
          >
            <RefreshCw className={cn('w-4 h-4', (isRefetching || isLoadingVMs) && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedVMs.size > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="flex items-center gap-3 p-3 bg-accent/10 border border-accent/30 rounded-lg"
        >
          <span className="text-sm text-text-primary">
            {selectedVMs.size} VM{selectedVMs.size > 1 ? 's' : ''} selected
          </span>
          <div className="flex-1" />
          <Button variant="secondary" size="sm" onClick={handleBulkStart}>
            <Play className="w-4 h-4" />
            Start
          </Button>
          <Button variant="secondary" size="sm" onClick={handleBulkStop}>
            <Square className="w-4 h-4" />
            Stop
          </Button>
          <Button variant="danger" size="sm" onClick={handleBulkDelete}>
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </motion.div>
      )}

      {/* Loading State */}
      {isLoadingVMs && isConnected && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}

      {/* Not Connected State */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-bg-surface border border-border rounded-xl p-8 text-center"
        >
          <MonitorCog className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">Not Connected to Backend</h3>
          <p className="text-text-muted mb-4 max-w-md mx-auto">
            Start the control plane server to view and manage VMs. 
            Run <code className="bg-bg-base px-2 py-0.5 rounded text-sm">go run ./cmd/controlplane</code> in the backend directory.
          </p>
          <Button variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </Button>
        </motion.div>
      )}

      {/* VM Table */}
      {isConnected && !isLoadingVMs && (
        <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
          {/* Table Header */}
          <div className="px-5 py-3 border-b border-border bg-bg-elevated/50">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-text-muted uppercase tracking-wider">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={selectedVMs.size === filteredVMs.length && filteredVMs.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-border bg-bg-base"
                />
              </div>
              <div className="col-span-3">Name</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Host</div>
              <div className="col-span-1">CPU</div>
              <div className="col-span-1">Memory</div>
              <div className="col-span-2">IP Address</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {filteredVMs.map((vm, index) => (
              <motion.div
                key={vm.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: index * 0.02 }}
                onContextMenu={(e) => handleContextMenu(e, vm)}
                className={cn(
                  'grid grid-cols-12 gap-4 px-5 py-4 items-center',
                  'hover:bg-bg-hover cursor-pointer',
                  'transition-colors duration-150',
                  'group select-none',
                  selectedVMs.has(vm.id) && 'bg-accent/5',
                  actionInProgress === vm.id && 'opacity-50',
                )}
              >
                {/* Checkbox */}
                <div className="col-span-1">
                  <input
                    type="checkbox"
                    checked={selectedVMs.has(vm.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelectVM(vm.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-border bg-bg-base"
                  />
                </div>

                {/* Name */}
                <div
                  className="col-span-3 flex items-center gap-3"
                  onClick={() => handleVMClick(vm)}
                >
                  <div
                    className={cn(
                      'w-9 h-9 rounded-lg flex items-center justify-center',
                      'bg-bg-elevated group-hover:bg-accent/10',
                      'transition-colors duration-150',
                    )}
                  >
                    <MonitorCog className="w-4 h-4 text-text-muted group-hover:text-accent" />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary group-hover:text-accent transition-colors">
                      {vm.name}
                    </p>
                    <p className="text-xs text-text-muted">{vm.status.guestInfo.osName}</p>
                  </div>
                </div>

                {/* Status */}
                <div className="col-span-1">
                  <VMStatusBadge status={vm.status.state} size="sm" />
                </div>

                {/* Host */}
                <div className="col-span-2">
                  <p className="text-sm text-text-secondary truncate">{vm.status.nodeId || '—'}</p>
                </div>

                {/* CPU */}
                <div className="col-span-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          vm.status.resourceUsage.cpuUsagePercent >= 80
                            ? 'bg-error'
                            : vm.status.resourceUsage.cpuUsagePercent >= 60
                              ? 'bg-warning'
                              : 'bg-success',
                        )}
                        style={{ width: `${vm.status.resourceUsage.cpuUsagePercent}%` }}
                      />
                    </div>
                    <span className="text-xs text-text-muted w-8">
                      {vm.status.resourceUsage.cpuUsagePercent}%
                    </span>
                  </div>
                </div>

                {/* Memory */}
                <div className="col-span-1">
                  <p className="text-sm text-text-secondary">
                    {formatBytes(vm.status.resourceUsage.memoryUsedBytes)}
                  </p>
                </div>

                {/* IP Address */}
                <div className="col-span-2">
                  {vm.status.ipAddresses.length > 0 ? (
                    <p className="text-sm text-text-secondary font-mono">
                      {vm.status.ipAddresses[0]}
                    </p>
                  ) : (
                    <p className="text-sm text-text-muted">—</p>
                  )}
                </div>

                {/* Actions */}
                <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {actionInProgress === vm.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  ) : (
                    <>
                      {/* Quick Console Button - only for running VMs */}
                      {vm.status.state === 'RUNNING' && (
                        <button
                          className="p-1.5 rounded-md hover:bg-accent/20 text-text-muted hover:text-accent transition-colors"
                          title="Open Console"
                          onClick={(e) => handleOpenConsole(vm, e)}
                        >
                          <Monitor className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {vm.status.state === 'RUNNING' ? (
                        <button
                          className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-error transition-colors"
                          title="Stop"
                          onClick={(e) => handleStopVM(vm.id, e)}
                        >
                          <Square className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-success transition-colors"
                          title="Start"
                          onClick={(e) => handleStartVM(vm.id, e)}
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-error transition-colors"
                        title="Delete"
                        onClick={(e) => handleDeleteVM(vm.id, e)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
<button
                                        className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-text-primary transition-colors"
                                        title="More"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Open context menu at button position
                                          const rect = e.currentTarget.getBoundingClientRect();
                                          setContextMenu({
                                            visible: true,
                                            x: rect.left,
                                            y: rect.bottom + 4,
                                            vm,
                                          });
                                        }}
                                      >
                                        <MoreHorizontal className="w-3.5 h-3.5" />
                                      </button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Empty State */}
          {filteredVMs.length === 0 && (
            <div className="py-12 text-center">
              <MonitorCog className="w-12 h-12 mx-auto text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No Virtual Machines</h3>
              <p className="text-text-muted mb-4">
                {searchQuery
                  ? 'No VMs match your search criteria'
                  : 'Create your first VM to get started'}
              </p>
              {!searchQuery && (
                <Button size="sm" onClick={() => setShowCreateWizard(true)}>
                  <Plus className="w-4 h-4" />
                  Create VM
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* VM Creation Wizard Modal */}
      {showCreateWizard && (
        <VMCreationWizard
          onClose={() => setShowCreateWizard(false)}
          onSuccess={() => {
            setShowCreateWizard(false);
            refetch();
          }}
        />
      )}

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu.visible && contextMenu.vm && (
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
              <p className="text-sm font-medium text-text-primary">{contextMenu.vm.name}</p>
              <p className="text-xs text-text-muted">{contextMenu.vm.status.state}</p>
            </div>

            {/* Actions */}
            <div className="py-1">
              <ContextMenuItem
                icon={<Monitor className="w-4 h-4" />}
                label="View Details"
                onClick={() => handleContextAction('details')}
              />
              <ContextMenuItem
                icon={<Monitor className="w-4 h-4" />}
                label="Open Console"
                onClick={() => handleContextAction('console')}
                disabled={contextMenu.vm.status.state !== 'RUNNING'}
              />
              
              <div className="my-1 border-t border-border" />
              
              {contextMenu.vm.status.state === 'RUNNING' ? (
                <>
                  <ContextMenuItem
                    icon={<Square className="w-4 h-4" />}
                    label="Stop"
                    onClick={() => handleContextAction('stop')}
                  />
                  <ContextMenuItem
                    icon={<RotateCcw className="w-4 h-4" />}
                    label="Restart"
                    onClick={() => handleContextAction('restart')}
                  />
                </>
              ) : (
                <ContextMenuItem
                  icon={<Play className="w-4 h-4" />}
                  label="Start"
                  onClick={() => handleContextAction('start')}
                />
              )}
              
              <div className="my-1 border-t border-border" />
              
              <ContextMenuItem
                icon={<Settings className="w-4 h-4" />}
                label="Edit Settings"
                onClick={() => handleContextAction('edit')}
              />
              <ContextMenuItem
                icon={<Copy className="w-4 h-4" />}
                label="Clone VM"
                onClick={() => handleContextAction('clone')}
              />
              <ContextMenuItem
                icon={<ArrowRightLeft className="w-4 h-4" />}
                label="Migrate"
                onClick={() => handleContextAction('migrate')}
              />
              
              <div className="my-1 border-t border-border" />
              
              <ContextMenuItem
                icon={<Trash2 className="w-4 h-4" />}
                label="Delete"
                onClick={() => handleContextAction('delete')}
                variant="danger"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete VM Modal */}
      <DeleteVMModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState({ isOpen: false, vm: null })}
        vmId={deleteModalState.vm?.id || ''}
        vmName={deleteModalState.vm?.name || ''}
        vmState={deleteModalState.vm?.status.state || 'STOPPED'}
        onDelete={handleDeleteConfirm}
        isPending={deleteVM.isPending}
      />
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
