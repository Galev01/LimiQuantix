import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Play,
  Square,
  RefreshCw,
  MonitorPlay,
  Camera,
  MoreHorizontal,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Clock,
  Server,
  Terminal,
  Activity,
  Wifi,
  WifiOff,
  Loader2,
  Trash2,
  Download,
  Code,
  FolderOpen,
  Settings,
  Copy,
  Power,
  Pause,
} from 'lucide-react';
import { cn, formatBytes, formatUptime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { VMStatusBadge } from '@/components/vm/VMStatusBadge';
import { ProgressRing } from '@/components/dashboard/ProgressRing';
import { NoVNCConsole } from '@/components/vm/NoVNCConsole';
import { ConsoleAccessModal } from '@/components/vm/ConsoleAccessModal';
import { ExecuteScriptModal } from '@/components/vm/ExecuteScriptModal';
import { EditSettingsModal } from '@/components/vm/EditSettingsModal';
import { EditResourcesModal } from '@/components/vm/EditResourcesModal';
import { QuantixAgentStatus } from '@/components/vm/QuantixAgentStatus';
import { FileBrowser } from '@/components/vm/FileBrowser';
import { mockVMs, type VirtualMachine as MockVM, type PowerState } from '@/data/mock-data';
import { useVM, useStartVM, useStopVM, useDeleteVM, type ApiVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';

// Convert API VM to display format
function apiToDisplayVM(apiVm: ApiVM): MockVM {
  const state = (apiVm.status?.state || 'STOPPED') as PowerState;
  return {
    id: apiVm.id,
    name: apiVm.name,
    projectId: apiVm.projectId,
    description: apiVm.description || '',
    labels: apiVm.labels || {},
    spec: {
      cpu: { cores: apiVm.spec?.cpu?.cores || 1, sockets: 1, model: 'host' },
      memory: { sizeMib: apiVm.spec?.memory?.sizeMib || 1024 },
      disks: (apiVm.spec?.disks || []).map((d, i) => ({
        id: `disk-${i}`,
        sizeGib: (d.sizeMib || 0) / 1024,
        bus: 'virtio',
      })),
      nics: [{ id: 'nic-0', networkId: 'default', macAddress: '00:00:00:00:00:00' }],
    },
    status: {
      state,
      nodeId: apiVm.status?.nodeId || '',
      ipAddresses: apiVm.status?.ipAddresses || [],
      resourceUsage: {
        cpuUsagePercent: apiVm.status?.resourceUsage?.cpuUsagePercent || 0,
        memoryUsedBytes: (apiVm.status?.resourceUsage?.memoryUsedMib || 0) * 1024 * 1024,
        memoryAllocatedBytes: (apiVm.spec?.memory?.sizeMib || 1024) * 1024 * 1024,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Linux',
        hostname: apiVm.name,
        agentVersion: '1.0.0',
        uptimeSeconds: 0,
      },
    },
    createdAt: apiVm.createdAt || new Date().toISOString(),
  };
}

export function VMDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  // Console state
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isConsoleModalOpen, setIsConsoleModalOpen] = useState(false);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isResourcesModalOpen, setIsResourcesModalOpen] = useState(false);

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiVm, isLoading } = useVM(id || '', !!isConnected && !!id);

  // Mutations
  const startVM = useStartVM();
  const stopVM = useStopVM();
  const deleteVM = useDeleteVM();

  // Determine data source
  const mockVm = mockVMs.find((v) => v.id === id);
  const useMockData = !isConnected || !apiVm;
  const vm: MockVM | undefined = useMockData ? mockVm : apiToDisplayVM(apiVm);

  const isActionPending = startVM.isPending || stopVM.isPending || deleteVM.isPending;

  // Action handlers
  const handleStart = async () => {
    if (useMockData || !id) {
      console.log('Mock: Start VM', id);
      return;
    }
    await startVM.mutateAsync(id);
  };

  const handleStop = async () => {
    if (useMockData || !id) {
      console.log('Mock: Stop VM', id);
      return;
    }
    await stopVM.mutateAsync({ id });
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this VM?')) return;
    if (useMockData || !id) {
      console.log('Mock: Delete VM', id);
      navigate('/vms');
      return;
    }
    await deleteVM.mutateAsync({ id });
    navigate('/vms');
  };

  const handleSaveSettings = async (settings: { name: string; description: string; labels: Record<string, string> }) => {
    if (useMockData || !id) {
      console.log('Mock: Update VM settings', id, settings);
      return;
    }
    // TODO: Call update VM API when available
    console.log('Update VM settings', id, settings);
  };

  const handleSaveResources = async (resources: { cores: number; memoryMib: number }) => {
    if (useMockData || !id) {
      console.log('Mock: Update VM resources', id, resources);
      return;
    }
    // TODO: Call update VM API when available
    console.log('Update VM resources', id, resources);
  };

  const handleCloneVM = () => {
    console.log('Clone VM', id);
    // TODO: Open clone VM modal
  };

  // Generate dropdown menu items
  const getVMActions = (): DropdownMenuItem[] => {
    const isRunning = vm?.status.state === 'RUNNING';
    
    return [
      {
        label: 'Edit Settings',
        icon: <Settings className="w-4 h-4" />,
        onClick: () => setIsSettingsModalOpen(true),
      },
      {
        label: 'Edit Resources',
        icon: <Cpu className="w-4 h-4" />,
        onClick: () => setIsResourcesModalOpen(true),
      },
      {
        label: 'Run Script',
        icon: <Code className="w-4 h-4" />,
        onClick: () => setIsScriptModalOpen(true),
        disabled: !isRunning,
      },
      {
        label: 'Browse Files',
        icon: <FolderOpen className="w-4 h-4" />,
        onClick: () => setIsFileBrowserOpen(true),
        disabled: !isRunning,
      },
      {
        label: 'Clone VM',
        icon: <Copy className="w-4 h-4" />,
        onClick: handleCloneVM,
        divider: true,
      },
      {
        label: 'Force Stop',
        icon: <Power className="w-4 h-4" />,
        onClick: handleStop,
        disabled: !isRunning,
        divider: true,
      },
      {
        label: 'Delete VM',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: handleDelete,
        variant: 'danger',
        divider: true,
      },
    ];
  };

  if (isLoading && !useMockData) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <h2 className="text-xl font-semibold text-text-primary mb-2">VM Not Found</h2>
        <p className="text-text-muted mb-4">The virtual machine you're looking for doesn't exist.</p>
        <Button onClick={() => navigate('/vms')}>
          <ArrowLeft className="w-4 h-4" />
          Back to VMs
        </Button>
      </div>
    );
  }

  const cpuPercent = vm.status.resourceUsage.cpuUsagePercent;
  const memoryPercent = vm.status.resourceUsage.memoryAllocatedBytes > 0
    ? Math.round((vm.status.resourceUsage.memoryUsedBytes / vm.status.resourceUsage.memoryAllocatedBytes) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/vms')}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            Virtual Machines
          </button>
          <span className="text-text-muted">/</span>
          <span className="text-text-primary font-medium">{vm.name}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/vms')}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-text-muted" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-text-primary">{vm.name}</h1>
                <VMStatusBadge status={vm.status.state} />
              </div>
              <p className="text-text-muted mt-1">{vm.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Connection Status */}
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
                isConnected
                  ? 'bg-success/20 text-success border border-success/30'
                  : 'bg-warning/20 text-warning border border-warning/30',
              )}
            >
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Connected' : 'Mock Data'}
            </div>

            {vm.status.state === 'RUNNING' ? (
              <>
                <Button variant="secondary" size="sm" onClick={handleStop} disabled={isActionPending}>
                  {stopVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  Stop
                </Button>
                <Button variant="secondary" size="sm">
                  <RefreshCw className="w-4 h-4" />
                  Restart
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={handleStart} disabled={isActionPending}>
                {startVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start
              </Button>
            )}
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={() => setIsConsoleModalOpen(true)}
              disabled={vm.status.state !== 'RUNNING'}
              title={vm.status.state !== 'RUNNING' ? 'VM must be running to access console' : 'Open VM console'}
            >
              <MonitorPlay className="w-4 h-4" />
              Console
            </Button>
            <Button variant="secondary" size="sm">
              <Camera className="w-4 h-4" />
              Snapshot
            </Button>
            <DropdownMenu
              trigger={
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              }
              items={getVMActions()}
            />
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="console">Console</TabsTrigger>
          <TabsTrigger value="agent">Quantix Agent</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="disks">Disks</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        {/* Summary Tab */}
        <TabsContent value="summary">
          <div className="grid grid-cols-3 gap-6">
            {/* Left Column - General Info */}
            <div className="col-span-2 space-y-6">
              {/* General Information Card */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">General Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Name" value={vm.name} />
                  <InfoRow label="Description" value={vm.description || '—'} />
                  <InfoRow label="Project" value={vm.projectId} />
                  <InfoRow label="Created" value={new Date(vm.createdAt).toLocaleDateString()} />
                  <InfoRow label="Host" value={vm.status.nodeId || '—'} />
                  <InfoRow label="Guest OS" value={vm.status.guestInfo.osName} />
                  <InfoRow label="Hostname" value={vm.status.guestInfo.hostname} />
                  <InfoRow label="Agent Version" value={vm.status.guestInfo.agentVersion} />
                  <InfoRow
                    label="Uptime"
                    value={
                      vm.status.guestInfo.uptimeSeconds > 0
                        ? formatUptime(vm.status.guestInfo.uptimeSeconds)
                        : '—'
                    }
                  />
                  <InfoRow
                    label="IP Addresses"
                    value={vm.status.ipAddresses.join(', ') || '—'}
                    mono
                  />
                </div>
              </div>

              {/* Hardware Summary */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Hardware Summary</h3>
                <div className="grid grid-cols-4 gap-4">
                  <HardwareCard
                    icon={<Cpu className="w-5 h-5" />}
                    label="CPU"
                    value={`${vm.spec.cpu.cores} vCPUs`}
                    subvalue={`${vm.spec.cpu.sockets} socket(s)`}
                  />
                  <HardwareCard
                    icon={<MemoryStick className="w-5 h-5" />}
                    label="Memory"
                    value={formatBytes(vm.spec.memory.sizeMib * 1024 * 1024)}
                    subvalue={`${memoryPercent}% used`}
                  />
                  <HardwareCard
                    icon={<HardDrive className="w-5 h-5" />}
                    label="Storage"
                    value={`${vm.spec.disks.reduce((a, d) => a + d.sizeGib, 0)} GB`}
                    subvalue={`${vm.spec.disks.length} disk(s)`}
                  />
                  <HardwareCard
                    icon={<Network className="w-5 h-5" />}
                    label="Network"
                    value={`${vm.spec.nics.length} NIC(s)`}
                    subvalue={vm.status.ipAddresses[0] || '—'}
                  />
                </div>
              </div>

              {/* Labels */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Labels</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(vm.labels).map(([key, value]) => (
                    <Badge key={key} variant="default">
                      {key}: {value}
                    </Badge>
                  ))}
                  <button className="text-sm text-accent hover:text-accent-hover">
                    + Add Label
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column - Resource Usage */}
            <div className="space-y-6">
              {/* CPU Usage */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">CPU Usage</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={cpuPercent}
                    size={120}
                    color={cpuPercent >= 80 ? 'red' : cpuPercent >= 60 ? 'yellow' : 'blue'}
                    label="usage"
                  />
                </div>
                <div className="mt-4 text-center">
                  <p className="text-sm text-text-muted">
                    {vm.spec.cpu.cores} vCPUs allocated
                  </p>
                </div>
              </div>

              {/* Memory Usage */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">Memory Usage</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={memoryPercent}
                    size={120}
                    color={memoryPercent >= 80 ? 'red' : memoryPercent >= 60 ? 'yellow' : 'green'}
                    label="usage"
                  />
                </div>
                <div className="mt-4 text-center text-sm text-text-muted">
                  <p>
                    {formatBytes(vm.status.resourceUsage.memoryUsedBytes)} /{' '}
                    {formatBytes(vm.status.resourceUsage.memoryAllocatedBytes)}
                  </p>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">Quick Stats</h3>
                <div className="space-y-3">
                  <StatRow
                    icon={<Activity className="w-4 h-4" />}
                    label="Disk IOPS"
                    value={`${vm.status.resourceUsage.diskReadIops + vm.status.resourceUsage.diskWriteIops}`}
                  />
                  <StatRow
                    icon={<Network className="w-4 h-4" />}
                    label="Network RX"
                    value={formatBytes(vm.status.resourceUsage.networkRxBytes)}
                  />
                  <StatRow
                    icon={<Network className="w-4 h-4" />}
                    label="Network TX"
                    value={formatBytes(vm.status.resourceUsage.networkTxBytes)}
                  />
                  <StatRow
                    icon={<Clock className="w-4 h-4" />}
                    label="Uptime"
                    value={
                      vm.status.guestInfo.uptimeSeconds > 0
                        ? formatUptime(vm.status.guestInfo.uptimeSeconds)
                        : '—'
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Console Tab */}
        <TabsContent value="console">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-elevated/50">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-text-muted" />
                <span className="text-sm font-medium text-text-primary">Console Access</span>
              </div>
              <div className="flex items-center gap-2">
                {vm.status.state === 'RUNNING' ? (
                  <div className="flex items-center gap-2 text-sm text-success">
                    <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
                    VM Running
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-warning">
                    <span className="w-2 h-2 bg-warning rounded-full" />
                    VM Stopped
                  </div>
                )}
              </div>
            </div>
            <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
              {vm.status.state === 'RUNNING' ? (
                <div className="text-center">
                  <MonitorPlay className="w-16 h-16 mx-auto text-accent mb-4" />
                  <h3 className="text-lg font-medium text-text-primary mb-2">Console Available</h3>
                  <p className="text-text-muted mb-6 max-w-md">
                    Access the VM console using VNC. Choose between web console or QVMRC native client.
                  </p>
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3">
                      <Button onClick={() => setIsConsoleOpen(true)}>
                        <MonitorPlay className="w-4 h-4" />
                        Web Console
                      </Button>
                      <Button variant="secondary" onClick={() => setIsConsoleModalOpen(true)}>
                        <Download className="w-4 h-4" />
                        QVMRC Native
                      </Button>
                    </div>
                    <p className="text-xs text-text-muted max-w-sm">
                      <strong>Web Console:</strong> Opens in browser, no installation needed.
                      <br />
                      <strong>QVMRC:</strong> Better performance, USB passthrough, lower latency.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <MonitorPlay className="w-16 h-16 mx-auto text-text-muted mb-4" />
                  <h3 className="text-lg font-medium text-text-primary mb-2">Console Unavailable</h3>
                  <p className="text-text-muted mb-6">
                    Start the VM to access the console.
                  </p>
                  <Button onClick={handleStart} disabled={isActionPending}>
                    <Play className="w-4 h-4" />
                    Start VM
                  </Button>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Quantix Agent Tab */}
        <TabsContent value="agent">
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              <QuantixAgentStatus vmId={id || ''} vmState={vm.status.state} />
            </div>
            <div className="space-y-4">
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Button
                    className="w-full justify-start"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsScriptModalOpen(true)}
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <Code className="w-4 h-4" />
                    Run Script
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsFileBrowserOpen(true)}
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse Files
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="secondary"
                    size="sm"
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Graceful Reboot
                  </Button>
                  <Button
                    className="w-full justify-start text-warning hover:text-warning"
                    variant="secondary"
                    size="sm"
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <Square className="w-4 h-4" />
                    Graceful Shutdown
                  </Button>
                </div>
              </div>
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-semibold text-text-primary mb-3">About Quantix Agent</h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  The Quantix Agent runs inside the VM and provides:
                </p>
                <ul className="text-xs text-text-muted mt-2 space-y-1">
                  <li>• Real resource usage metrics</li>
                  <li>• IP address reporting</li>
                  <li>• Remote script execution</li>
                  <li>• Graceful shutdown/reboot</li>
                  <li>• File transfer capabilities</li>
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Snapshots Tab */}
        <TabsContent value="snapshots">
          <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-text-primary">Snapshots</h3>
              <Button size="sm">
                <Camera className="w-4 h-4" />
                Create Snapshot
              </Button>
            </div>
            <div className="text-center py-12">
              <Camera className="w-12 h-12 mx-auto text-text-muted mb-4" />
              <h4 className="text-lg font-medium text-text-primary mb-2">No Snapshots</h4>
              <p className="text-text-muted">Create a snapshot to save the current state of this VM</p>
            </div>
          </div>
        </TabsContent>

        {/* Disks Tab */}
        <TabsContent value="disks">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Disks</h3>
              <Button size="sm">
                <HardDrive className="w-4 h-4" />
                Add Disk
              </Button>
            </div>
            <table className="w-full">
              <thead className="bg-bg-elevated/50">
                <tr className="text-xs font-medium text-text-muted uppercase">
                  <th className="px-6 py-3 text-left">Device</th>
                  <th className="px-6 py-3 text-left">Size</th>
                  <th className="px-6 py-3 text-left">Bus Type</th>
                  <th className="px-6 py-3 text-left">Pool</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vm.spec.disks.map((disk, index) => (
                  <tr key={disk.id} className="hover:bg-bg-hover">
                    <td className="px-6 py-4 text-sm text-text-primary font-mono">
                      vd{String.fromCharCode(97 + index)}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary">{disk.sizeGib} GB</td>
                    <td className="px-6 py-4 text-sm text-text-secondary">{disk.bus}</td>
                    <td className="px-6 py-4 text-sm text-text-secondary">ceph-ssd</td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm">Resize</Button>
                      <Button variant="ghost" size="sm">Detach</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Network Tab */}
        <TabsContent value="network">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Network Interfaces</h3>
              <Button size="sm">
                <Network className="w-4 h-4" />
                Add NIC
              </Button>
            </div>
            <table className="w-full">
              <thead className="bg-bg-elevated/50">
                <tr className="text-xs font-medium text-text-muted uppercase">
                  <th className="px-6 py-3 text-left">Device</th>
                  <th className="px-6 py-3 text-left">Network</th>
                  <th className="px-6 py-3 text-left">MAC Address</th>
                  <th className="px-6 py-3 text-left">IP Address</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vm.spec.nics.map((nic, index) => (
                  <tr key={nic.id} className="hover:bg-bg-hover">
                    <td className="px-6 py-4 text-sm text-text-primary font-mono">eth{index}</td>
                    <td className="px-6 py-4 text-sm text-text-secondary">{nic.networkId}</td>
                    <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                      {nic.macAddress}
                    </td>
                    <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                      {vm.status.ipAddresses[index] || '—'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm">Edit</Button>
                      <Button variant="ghost" size="sm">Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Monitoring Tab */}
        <TabsContent value="monitoring">
          <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-text-primary">Performance Monitoring</h3>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm">1h</Button>
                <Button variant="secondary" size="sm">6h</Button>
                <Button variant="ghost" size="sm">24h</Button>
                <Button variant="ghost" size="sm">7d</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <p className="text-text-muted">CPU Usage Chart</p>
              </div>
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <p className="text-text-muted">Memory Usage Chart</p>
              </div>
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <p className="text-text-muted">Disk I/O Chart</p>
              </div>
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <p className="text-text-muted">Network I/O Chart</p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Event Log</h3>
            </div>
            <div className="divide-y divide-border">
              {[
                { time: '10:30 AM', type: 'Power', message: 'VM started', user: 'admin' },
                { time: '10:25 AM', type: 'Config', message: 'Memory increased to 8GB', user: 'admin' },
                { time: '10:00 AM', type: 'Snapshot', message: 'Snapshot created', user: 'system' },
              ].map((event, index) => (
                <div key={index} className="px-6 py-4 hover:bg-bg-hover">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-text-muted w-20">{event.time}</span>
                    <Badge variant="default" size="sm">{event.type}</Badge>
                    <span className="text-sm text-text-primary flex-1">{event.message}</span>
                    <span className="text-sm text-text-muted">{event.user}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* noVNC Console Modal */}
      <NoVNCConsole
        vmId={id || ''}
        vmName={vm.name}
        isOpen={isConsoleOpen}
        onClose={() => setIsConsoleOpen(false)}
      />

      {/* Console Access Modal (Web vs QVMRC choice) */}
      <ConsoleAccessModal
        isOpen={isConsoleModalOpen}
        onClose={() => setIsConsoleModalOpen(false)}
        onOpenWebConsole={() => setIsConsoleOpen(true)}
        vmId={id || ''}
        vmName={vm.name}
      />

      {/* Execute Script Modal */}
      <ExecuteScriptModal
        isOpen={isScriptModalOpen}
        onClose={() => setIsScriptModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
      />

      {/* File Browser Modal */}
      <FileBrowser
        vmId={id || ''}
        isOpen={isFileBrowserOpen}
        onClose={() => setIsFileBrowserOpen(false)}
      />

      {/* Edit Settings Modal */}
      <EditSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        vmDescription={vm.description}
        vmLabels={vm.labels}
        onSave={handleSaveSettings}
      />

      {/* Edit Resources Modal */}
      <EditResourcesModal
        isOpen={isResourcesModalOpen}
        onClose={() => setIsResourcesModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        vmState={vm.status.state}
        currentCores={vm.spec.cpu.cores}
        currentMemoryMib={vm.spec.memory.sizeMib}
        onSave={handleSaveResources}
      />
    </div>
  );
}

// Helper Components
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm text-text-primary', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function HardwareCard({
  icon,
  label,
  value,
  subvalue,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subvalue: string;
}) {
  return (
    <div className="bg-bg-base rounded-lg p-4 border border-border">
      <div className="flex items-center gap-2 text-text-muted mb-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted mt-1">{subvalue}</p>
    </div>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

