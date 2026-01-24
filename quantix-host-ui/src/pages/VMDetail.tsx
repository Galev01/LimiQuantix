import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Monitor,
  Trash2,
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Camera,
  Clock,
  Activity,
  Network,
  Settings,
  Terminal,
  MonitorPlay,
  Plus,
  X,
  Loader2,
  Server,
  Info,
  Copy,
  Check,
  FileText,
} from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { useVM, useVMPowerOps, useVMSnapshots, useVMSnapshotOps, useDeleteVM, useVMConsole } from '@/hooks/useVMs';
import { formatBytes, formatPercent, cn } from '@/lib/utils';
import { launchQvMC } from '@/lib/qvmc';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/stores/useAppStore';
import { ConsoleAccessModal } from '@/components/vm/ConsoleAccessModal';
import { NoVNCConsole } from '@/components/vm/NoVNCConsole';
import { VMLogsPanel } from '@/components/vm/VMLogsPanel';
import type { PowerState } from '@/api/types';

type Tab = 'summary' | 'console' | 'hardware' | 'snapshots' | 'network' | 'configuration' | 'logs' | 'events';

export function VMDetail() {
  const { vmId } = useParams<{ vmId: string }>();
  const navigate = useNavigate();
  const { hostUrl } = useAppStore();
  const { data: vm, isLoading, refetch, isFetching } = useVM(vmId || '');
  const { data: snapshots, isLoading: isLoadingSnapshots } = useVMSnapshots(vmId || '');
  const { data: consoleInfo } = useVMConsole(vmId || '');
  const powerOps = useVMPowerOps();
  const snapshotOps = useVMSnapshotOps(vmId || '');
  const deleteVm = useDeleteVM();
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  
  // Console state
  const [isConsoleModalOpen, setIsConsoleModalOpen] = useState(false);
  const [isWebConsoleOpen, setIsWebConsoleOpen] = useState(false);
  
  // Snapshot state
  const [showCreateSnapshot, setShowCreateSnapshot] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotDescription, setSnapshotDescription] = useState('');

  // Copy state for console info
  const [copied, setCopied] = useState<'address' | 'password' | null>(null);

  const handleOpenConsole = () => {
    if (vm && vm.state === 'RUNNING') {
      setIsConsoleModalOpen(true);
    }
  };

  const handleLaunchQvMC = () => {
    if (vm) {
      launchQvMC({
        hostUrl,
        vmId: vm.vmId,
        vmName: vm.name,
      });
    }
  };

  const handleDelete = () => {
    if (vm && confirm(`Are you sure you want to delete VM "${vm.name}"? This cannot be undone.`)) {
      deleteVm.mutate(vm.vmId, {
        onSuccess: () => navigate('/vms'),
      });
    }
  };

  const handleCreateSnapshot = () => {
    if (snapshotName.trim()) {
      snapshotOps.create.mutate(
        { name: snapshotName, description: snapshotDescription },
        {
          onSuccess: () => {
            setSnapshotName('');
            setSnapshotDescription('');
            setShowCreateSnapshot(false);
          },
        }
      );
    }
  };

  const handleCopyToClipboard = async (text: string, type: 'address' | 'password') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'summary', label: 'Summary', icon: <Activity className="w-4 h-4" /> },
    { id: 'console', label: 'Console', icon: <Terminal className="w-4 h-4" /> },
    { id: 'hardware', label: 'Hardware', icon: <Cpu className="w-4 h-4" /> },
    { id: 'snapshots', label: 'Snapshots', icon: <Camera className="w-4 h-4" /> },
    { id: 'network', label: 'Network', icon: <Network className="w-4 h-4" /> },
    { id: 'configuration', label: 'Configuration', icon: <Settings className="w-4 h-4" /> },
    { id: 'logs', label: 'Logs', icon: <FileText className="w-4 h-4" /> },
    { id: 'events', label: 'Events', icon: <Clock className="w-4 h-4" /> },
  ];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-text-primary mb-2">VM Not Found</h2>
          <p className="text-text-muted mb-4">The virtual machine could not be found.</p>
          <Button onClick={() => navigate('/vms')}>
            <ArrowLeft className="w-4 h-4" />
            Back to VMs
          </Button>
        </div>
      </div>
    );
  }

  const cpuPercent = vm.cpuUsagePercent || 0;
  const memoryPercent = vm.memoryTotalBytes > 0 
    ? Math.round((vm.memoryUsedBytes / vm.memoryTotalBytes) * 100) 
    : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title={vm.name}
        subtitle={`VM ID: ${vm.vmId}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </Button>
            
            {/* Power Controls */}
            {vm.state === 'STOPPED' && (
              <Button
                size="sm"
                onClick={() => powerOps.start.mutate(vm.vmId)}
                disabled={powerOps.start.isPending}
              >
                {powerOps.start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start
              </Button>
            )}
            {vm.state === 'RUNNING' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleOpenConsole}
                >
                  <MonitorPlay className="w-4 h-4" />
                  Console
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => powerOps.stop.mutate(vm.vmId)}
                  disabled={powerOps.stop.isPending}
                >
                  {powerOps.stop.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  Stop
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => powerOps.reboot.mutate(vm.vmId)}
                  disabled={powerOps.reboot.isPending}
                >
                  {powerOps.reboot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Reboot
                </Button>
              </>
            )}
            {vm.state === 'PAUSED' && (
              <Button
                size="sm"
                onClick={() => powerOps.resume.mutate(vm.vmId)}
                disabled={powerOps.resume.isPending}
              >
                {powerOps.resume.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Resume
              </Button>
            )}
            
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={vm.state === 'RUNNING' || deleteVm.isPending}
              className="text-error hover:text-error"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Status Badge */}
        <div className="mb-6">
          <PowerStateBadge state={vm.state} />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-accent text-white'
                  : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'summary' && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Column - General Info */}
            <div className="lg:col-span-2 space-y-6">
              {/* General Information */}
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">General Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Name" value={vm.name} />
                  <InfoRow label="VM ID" value={vm.vmId} mono />
                  <InfoRow label="State" value={vm.state} />
                  <InfoRow label="Started At" value={vm.startedAt ? new Date(vm.startedAt).toLocaleString() : '—'} />
                </div>
              </Card>

              {/* Hardware Summary */}
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Hardware Summary</h3>
                <div className="grid grid-cols-3 gap-4">
                  <HardwareCard
                    icon={<Cpu className="w-5 h-5" />}
                    label="CPU"
                    value={`${formatPercent(cpuPercent)} used`}
                    color="accent"
                  />
                  <HardwareCard
                    icon={<MemoryStick className="w-5 h-5" />}
                    label="Memory"
                    value={formatBytes(vm.memoryTotalBytes)}
                    subvalue={`${formatPercent(memoryPercent)} used`}
                    color="info"
                  />
                  <HardwareCard
                    icon={<HardDrive className="w-5 h-5" />}
                    label="Storage"
                    value={vm.guestAgent ? '1 disk(s)' : 'Unknown'}
                    color="warning"
                  />
                </div>
              </Card>

              {/* Guest Agent Info */}
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Guest Agent</h3>
                {vm.guestAgent?.connected ? (
                  <div className="grid grid-cols-2 gap-4">
                    <InfoRow label="Status" value="Connected" valueClass="text-success" />
                    <InfoRow label="Version" value={vm.guestAgent.version} />
                    <InfoRow label="Operating System" value={vm.guestAgent.osName} />
                    <InfoRow label="Kernel" value={vm.guestAgent.kernelVersion} mono />
                    <InfoRow label="Hostname" value={vm.guestAgent.hostname} />
                    <InfoRow 
                      label="IP Addresses" 
                      value={vm.guestAgent.ipAddresses?.join(', ') || '—'} 
                      mono 
                    />
                  </div>
                ) : (
                  <div className="text-center py-6 text-text-muted">
                    <Server className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p>Guest agent not connected</p>
                    <p className="text-sm mt-1">Install the Quantix guest agent inside the VM for detailed information</p>
                  </div>
                )}
              </Card>
            </div>

            {/* Right Column - Resource Usage */}
            <div className="space-y-6">
              {/* CPU Usage */}
              <Card>
                <h3 className="text-sm font-medium text-text-muted mb-4">CPU Usage</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={cpuPercent}
                    size={120}
                    color={cpuPercent >= 80 ? 'error' : cpuPercent >= 60 ? 'warning' : 'accent'}
                    label={`${cpuPercent}%`}
                    sublabel="usage"
                  />
                </div>
              </Card>

              {/* Memory Usage */}
              <Card>
                <h3 className="text-sm font-medium text-text-muted mb-4">Memory Usage</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={memoryPercent}
                    size={120}
                    color={memoryPercent >= 80 ? 'error' : memoryPercent >= 60 ? 'warning' : 'info'}
                    label={`${memoryPercent}%`}
                    sublabel="usage"
                  />
                </div>
                <div className="mt-4 text-center text-sm text-text-muted">
                  {formatBytes(vm.memoryUsedBytes)} / {formatBytes(vm.memoryTotalBytes)}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Console Tab */}
        {activeTab === 'console' && (
          <div className="space-y-6">
            <Card>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Terminal className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">Console Access</h3>
                    <p className="text-sm text-text-muted">Connect to the VM's display</p>
                  </div>
                </div>
                {vm.state === 'RUNNING' ? (
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

              {vm.state === 'RUNNING' ? (
                <div className="space-y-6">
                  {/* Console Options */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* Web Console */}
                    <button
                      onClick={() => setIsWebConsoleOpen(true)}
                      className="p-6 bg-bg-base rounded-xl border border-border hover:border-accent/50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center group-hover:bg-accent/30 transition-colors">
                          <MonitorPlay className="w-6 h-6 text-accent" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-text-primary">Web Console</h4>
                          <p className="text-sm text-text-muted mt-0.5">
                            Opens in browser using noVNC
                          </p>
                        </div>
                      </div>
                    </button>

                    {/* QvMC Native */}
                    <button
                      onClick={handleLaunchQvMC}
                      className="p-6 bg-bg-base rounded-xl border border-border hover:border-purple-500/50 transition-colors text-left group"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                          <Monitor className="w-6 h-6 text-purple-400" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-text-primary">QvMC Native</h4>
                          <p className="text-sm text-text-muted mt-0.5">
                            Better performance, USB passthrough
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* VNC Connection Info */}
                  {consoleInfo && (
                    <div className="p-4 bg-bg-base rounded-lg border border-border">
                      <h4 className="text-sm font-medium text-text-muted mb-3">Direct VNC Connection</h4>
                      <div className="flex items-center gap-3">
                        <code className="flex-1 px-3 py-2 bg-bg-surface rounded border border-border font-mono text-sm text-text-primary">
                          {consoleInfo.host}:{consoleInfo.port}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopyToClipboard(`${consoleInfo.host}:${consoleInfo.port}`, 'address')}
                        >
                          {copied === 'address' ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                      {consoleInfo.password && (
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-sm text-text-muted">Password:</span>
                          <code className="flex-1 px-3 py-2 bg-bg-surface rounded border border-border font-mono text-sm text-text-primary">
                            {consoleInfo.password}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyToClipboard(consoleInfo.password!, 'password')}
                          >
                            {copied === 'password' ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Help text */}
                  <div className="flex items-start gap-3 p-4 bg-accent/5 border border-accent/20 rounded-lg">
                    <Info className="w-5 h-5 text-accent mt-0.5" />
                    <div className="text-sm text-text-muted">
                      <strong className="text-text-secondary">Tip:</strong> Web Console works in any browser without installation. 
                      qvmc provides better performance and features like USB passthrough but requires the desktop app.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12">
                  <MonitorPlay className="w-16 h-16 mx-auto text-text-muted mb-4" />
                  <h4 className="text-lg font-medium text-text-primary mb-2">Console Unavailable</h4>
                  <p className="text-text-muted mb-6">Start the VM to access the console</p>
                  <Button
                    onClick={() => powerOps.start.mutate(vm.vmId)}
                    disabled={powerOps.start.isPending}
                  >
                    {powerOps.start.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    Start VM
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Hardware Tab */}
        {activeTab === 'hardware' && (
          <div className="space-y-6">
            <Card>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Resource Allocation</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-5 h-5 text-accent" />
                    <span className="text-text-secondary">CPU</span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {formatPercent(cpuPercent)}
                  </div>
                  <div className="text-sm text-text-muted mt-1">current usage</div>
                </div>
                <div className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <MemoryStick className="w-5 h-5 text-info" />
                    <span className="text-text-secondary">Memory</span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {formatBytes(vm.memoryTotalBytes)}
                  </div>
                  <div className="text-sm text-text-muted mt-1">
                    {formatBytes(vm.memoryUsedBytes)} used
                  </div>
                </div>
                <div className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="w-5 h-5 text-warning" />
                    <span className="text-text-secondary">Storage</span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {vm.guestAgent ? '1' : 'N/A'}
                  </div>
                  <div className="text-sm text-text-muted mt-1">disk(s) attached</div>
                </div>
              </div>
            </Card>

            {vm.guestAgent?.resourceUsage && (
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Guest Resource Usage</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <InfoRow label="CPU Usage" value={formatPercent(vm.guestAgent.resourceUsage.cpuUsagePercent)} />
                  <InfoRow label="Memory Used" value={formatBytes(vm.guestAgent.resourceUsage.memoryUsedBytes)} />
                  <InfoRow label="Memory Total" value={formatBytes(vm.guestAgent.resourceUsage.memoryTotalBytes)} />
                  <InfoRow label="Process Count" value={String(vm.guestAgent.resourceUsage.processCount)} />
                  <InfoRow label="Load Avg (1m)" value={vm.guestAgent.resourceUsage.loadAvg1.toFixed(2)} />
                  <InfoRow label="Uptime" value={`${Math.floor(vm.guestAgent.resourceUsage.uptimeSeconds / 3600)}h ${Math.floor((vm.guestAgent.resourceUsage.uptimeSeconds % 3600) / 60)}m`} />
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Snapshots Tab */}
        {activeTab === 'snapshots' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-text-primary">Snapshots</h3>
              <Button size="sm" onClick={() => setShowCreateSnapshot(true)}>
                <Plus className="w-4 h-4" />
                Create Snapshot
              </Button>
            </div>

            {showCreateSnapshot && (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-medium text-text-primary">Create Snapshot</h4>
                  <button
                    onClick={() => setShowCreateSnapshot(false)}
                    className="p-1 rounded hover:bg-bg-hover"
                  >
                    <X className="w-5 h-5 text-text-muted" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Name <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={snapshotName}
                      onChange={(e) => setSnapshotName(e.target.value)}
                      placeholder="e.g., before-update"
                      className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={snapshotDescription}
                      onChange={(e) => setSnapshotDescription(e.target.value)}
                      placeholder="Optional description"
                      className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleCreateSnapshot}
                      disabled={snapshotOps.create.isPending || !snapshotName.trim()}
                    >
                      {snapshotOps.create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                      Create
                    </Button>
                    <Button variant="ghost" onClick={() => setShowCreateSnapshot(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {isLoadingSnapshots ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
              </div>
            ) : snapshots && snapshots.length > 0 ? (
              <Card padding="none">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left text-sm text-text-muted">
                      <th className="p-4 font-medium">Name</th>
                      <th className="p-4 font-medium">Created</th>
                      <th className="p-4 font-medium">State</th>
                      <th className="p-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map(snapshot => (
                      <tr key={snapshot.snapshotId} className="border-b border-border/50 hover:bg-bg-hover/50">
                        <td className="p-4">
                          <div className="font-medium text-text-primary">{snapshot.name}</div>
                          {snapshot.description && (
                            <div className="text-sm text-text-muted">{snapshot.description}</div>
                          )}
                        </td>
                        <td className="p-4 text-text-secondary">{snapshot.createdAt}</td>
                        <td className="p-4">
                          <Badge variant="default">{snapshot.vmState}</Badge>
                        </td>
                        <td className="p-4">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => snapshotOps.revert.mutate(snapshot.snapshotId)}
                              disabled={snapshotOps.revert.isPending}
                            >
                              <RotateCcw className="w-4 h-4" />
                              Revert
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => snapshotOps.remove.mutate(snapshot.snapshotId)}
                              disabled={snapshotOps.remove.isPending}
                              className="text-error hover:text-error"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : (
              <Card className="text-center py-12 text-text-muted">
                <Camera className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium text-text-primary">No snapshots yet</p>
                <p className="text-sm mt-1">Create a snapshot to save the VM state</p>
              </Card>
            )}
          </div>
        )}

        {/* Network Tab */}
        {activeTab === 'network' && (
          <div className="space-y-6">
            {vm.guestAgent?.ipAddresses && vm.guestAgent.ipAddresses.length > 0 ? (
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">IP Addresses</h3>
                <div className="space-y-2">
                  {vm.guestAgent.ipAddresses.map((ip, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-bg-base rounded-lg">
                      <Network className="w-4 h-4 text-accent" />
                      <code className="font-mono text-text-primary">{ip}</code>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="text-center py-12 text-text-muted">
                <Network className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium text-text-primary">Network information unavailable</p>
                <p className="text-sm mt-1">Install the guest agent to see IP addresses</p>
              </Card>
            )}
          </div>
        )}

        {/* Configuration Tab */}
        {activeTab === 'configuration' && (
          <div className="space-y-6">
            <Card>
              <h3 className="text-lg font-semibold text-text-primary mb-4">VM Configuration</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <ConfigRow label="VM ID" value={vm.vmId} />
                <ConfigRow label="Name" value={vm.name} />
                <ConfigRow label="Power State" value={vm.state} />
                <ConfigRow label="Memory" value={formatBytes(vm.memoryTotalBytes)} />
              </div>
            </Card>

            {vm.guestAgent && (
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Guest OS</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <ConfigRow label="OS Name" value={vm.guestAgent.osName} />
                  <ConfigRow label="OS Version" value={vm.guestAgent.osVersion} />
                  <ConfigRow label="Kernel" value={vm.guestAgent.kernelVersion} />
                  <ConfigRow label="Hostname" value={vm.guestAgent.hostname} />
                  <ConfigRow label="Agent Version" value={vm.guestAgent.version} />
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <Card>
            <VMLogsPanel vmId={vm.vmId} vmName={vm.name} />
          </Card>
        )}

        {/* Events Tab */}
        {activeTab === 'events' && (
          <Card className="text-center py-12 text-text-muted">
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium text-text-primary">Event log coming soon</p>
            <p className="text-sm mt-1">VM events will be displayed here</p>
          </Card>
        )}
      </div>

      {/* Console Access Modal */}
      <ConsoleAccessModal
        isOpen={isConsoleModalOpen}
        onClose={() => setIsConsoleModalOpen(false)}
        onOpenWebConsole={() => {
          setIsConsoleModalOpen(false);
          setIsWebConsoleOpen(true);
        }}
        vmId={vm.vmId}
        vmName={vm.name}
      />

      {/* Web Console */}
      <NoVNCConsole
        vmId={vm.vmId}
        vmName={vm.name}
        isOpen={isWebConsoleOpen}
        onClose={() => setIsWebConsoleOpen(false)}
      />
    </div>
  );
}

// Helper Components
function PowerStateBadge({ state }: { state: PowerState }) {
  const variants: Record<PowerState, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
    RUNNING: 'success',
    STOPPED: 'default',
    PAUSED: 'warning',
    SUSPENDED: 'warning',
    CRASHED: 'error',
    MIGRATING: 'info',
    UNKNOWN: 'default',
  };

  return (
    <Badge variant={variants[state] || 'default'} className="text-sm">
      {state}
    </Badge>
  );
}

function InfoRow({ label, value, mono, valueClass }: { label: string; value: string; mono?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm text-text-primary', mono && 'font-mono', valueClass)}>{value}</span>
    </div>
  );
}

function HardwareCard({
  icon,
  label,
  value,
  subvalue,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subvalue?: string;
  color: 'accent' | 'info' | 'warning' | 'error';
}) {
  const colorClasses = {
    accent: 'text-accent',
    info: 'text-info',
    warning: 'text-warning',
    error: 'text-error',
  };

  return (
    <div className="p-4 bg-bg-base rounded-lg border border-border">
      <div className={cn('flex items-center gap-2 mb-2', colorClasses[color])}>
        {icon}
        <span className="text-xs font-medium text-text-muted">{label}</span>
      </div>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
      {subvalue && <p className="text-xs text-text-muted mt-1">{subvalue}</p>}
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-primary font-mono">{value}</span>
    </div>
  );
}
