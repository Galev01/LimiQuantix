import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  Play,
  Square,
  MoreHorizontal,
  MonitorCog,
  Download,
  Trash2,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { VMStatusBadge } from '@/components/vm/VMStatusBadge';
import { VMCreationWizard } from '@/components/vm/VMCreationWizard';
import { useVMs, useStartVM, useStopVM, useDeleteVM, isVMRunning, isVMStopped, type ApiVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';
import { mockVMs, type VirtualMachine as MockVM, type PowerState } from '@/data/mock-data';

type FilterTab = 'all' | 'running' | 'stopped' | 'other';

// Convert API VM to display format
function apiToDisplayVM(vm: ApiVM): MockVM {
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
        sizeGib: (d.sizeMib || 0) / 1024,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [selectedVMs, setSelectedVMs] = useState<Set<string>>(new Set());
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // API connection and data
  const { data: isConnected = false, isLoading: isCheckingConnection } = useApiConnection();
  const { data: apiResponse, isLoading: isLoadingVMs, refetch, isRefetching } = useVMs({ enabled: !!isConnected });

  // Mutations for VM actions
  const startVM = useStartVM();
  const stopVM = useStopVM();
  const deleteVM = useDeleteVM();

  // Determine data source: API or mock
  const apiVMs = apiResponse?.vms || [];
  const useMockData = !isConnected || apiVMs.length === 0;
  const allVMs: MockVM[] = useMockData ? mockVMs : apiVMs.map(apiToDisplayVM);

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

  const handleVMClick = (vm: MockVM) => {
    navigate(`/vms/${vm.id}`);
  };

  // Action handlers
  const handleStartVM = async (vmId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (useMockData) {
      console.log('Mock: Start VM', vmId);
      return;
    }
    setActionInProgress(vmId);
    try {
      await startVM.mutateAsync(vmId);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleStopVM = async (vmId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (useMockData) {
      console.log('Mock: Stop VM', vmId);
      return;
    }
    setActionInProgress(vmId);
    try {
      await stopVM.mutateAsync({ id: vmId });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteVM = async (vmId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm('Are you sure you want to delete this VM?')) return;
    if (useMockData) {
      console.log('Mock: Delete VM', vmId);
      return;
    }
    setActionInProgress(vmId);
    try {
      await deleteVM.mutateAsync({ id: vmId });
    } finally {
      setActionInProgress(null);
    }
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
    if (!confirm(`Are you sure you want to delete ${selectedVMs.size} VMs?`)) return;
    for (const vmId of selectedVMs) {
      await handleDeleteVM(vmId);
    }
    setSelectedVMs(new Set());
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
                Using Mock Data
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
      {isLoadingVMs && !useMockData && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}

      {/* VM Table */}
      {(!isLoadingVMs || useMockData) && (
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
                className={cn(
                  'grid grid-cols-12 gap-4 px-5 py-4 items-center',
                  'hover:bg-bg-hover cursor-pointer',
                  'transition-colors duration-150',
                  'group',
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
                        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
