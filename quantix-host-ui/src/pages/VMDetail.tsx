import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Pause,
  Monitor,
  Trash2,
  RefreshCw,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Camera,
  Clock,
  Activity,
} from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useVM, useVMPowerOps, useVMSnapshots, useVMSnapshotOps, useDeleteVM } from '@/hooks/useVMs';
import { formatBytes, formatPercent, cn } from '@/lib/utils';
import { launchQVMRC } from '@/lib/qvmrc';
import { useAppStore } from '@/stores/useAppStore';
import type { PowerState } from '@/api/types';

type Tab = 'summary' | 'hardware' | 'snapshots' | 'console' | 'events';

export function VMDetail() {
  const { vmId } = useParams<{ vmId: string }>();
  const navigate = useNavigate();
  const { hostUrl } = useAppStore();
  const { data: vm, isLoading, refetch, isFetching } = useVM(vmId || '');
  const { data: snapshots } = useVMSnapshots(vmId || '');
  const powerOps = useVMPowerOps();
  const snapshotOps = useVMSnapshotOps(vmId || '');
  const deleteVm = useDeleteVM();
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [showCreateSnapshot, setShowCreateSnapshot] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');

  const handleOpenConsole = () => {
    if (vm) {
      launchQVMRC({
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
        { name: snapshotName },
        {
          onSuccess: () => {
            setSnapshotName('');
            setShowCreateSnapshot(false);
          },
        }
      );
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'summary', label: 'Summary', icon: <Activity className="w-4 h-4" /> },
    { id: 'hardware', label: 'Hardware', icon: <Cpu className="w-4 h-4" /> },
    { id: 'snapshots', label: 'Snapshots', icon: <Camera className="w-4 h-4" /> },
    { id: 'console', label: 'Console', icon: <Monitor className="w-4 h-4" /> },
    { id: 'events', label: 'Events', icon: <Clock className="w-4 h-4" /> },
  ];

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Loading VM details...</div>
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
                <Play className="w-4 h-4" />
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
                  <Monitor className="w-4 h-4" />
                  Console
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => powerOps.stop.mutate(vm.vmId)}
                  disabled={powerOps.stop.isPending}
                >
                  <Square className="w-4 h-4" />
                  Stop
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => powerOps.reboot.mutate(vm.vmId)}
                  disabled={powerOps.reboot.isPending}
                >
                  <RotateCcw className="w-4 h-4" />
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
                <Play className="w-4 h-4" />
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
          <div className="grid gap-6 md:grid-cols-2">
            {/* Resource Usage */}
            <Card>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Resource Usage</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-accent" />
                      <span className="text-text-secondary">CPU</span>
                    </div>
                    <span className="text-text-primary font-medium">
                      {formatPercent(vm.cpuUsagePercent)}
                    </span>
                  </div>
                  <div className="h-2 bg-bg-base rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${Math.min(vm.cpuUsagePercent, 100)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MemoryStick className="w-4 h-4 text-info" />
                      <span className="text-text-secondary">Memory</span>
                    </div>
                    <span className="text-text-primary font-medium">
                      {formatBytes(vm.memoryUsedBytes)} / {formatBytes(vm.memoryTotalBytes)}
                    </span>
                  </div>
                  <div className="h-2 bg-bg-base rounded-full overflow-hidden">
                    <div
                      className="h-full bg-info rounded-full transition-all"
                      style={{ width: `${(vm.memoryUsedBytes / vm.memoryTotalBytes) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* Guest Agent Info */}
            <Card>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Guest Information</h3>
              {vm.guestAgent?.connected ? (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Operating System</span>
                    <span className="text-text-primary">{vm.guestAgent.osName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Hostname</span>
                    <span className="text-text-primary">{vm.guestAgent.hostname}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Kernel</span>
                    <span className="text-text-primary font-mono text-sm">
                      {vm.guestAgent.kernelVersion}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">IP Addresses</span>
                    <div className="text-right">
                      {vm.guestAgent.ipAddresses?.map((ip, i) => (
                        <div key={i} className="text-text-primary font-mono text-sm">{ip}</div>
                      ))}
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Agent Version</span>
                    <span className="text-text-primary">{vm.guestAgent.version}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-text-muted">
                  <p>Guest agent not connected</p>
                  <p className="text-sm mt-1">Install the Quantix guest agent for detailed information</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'hardware' && (
          <div className="space-y-6">
            <Card>
              <h3 className="text-lg font-semibold text-text-primary mb-4">Configuration</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-5 h-5 text-accent" />
                    <span className="text-text-secondary">CPU</span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {vm.guestAgent?.resourceUsage?.cpuUsagePercent !== undefined
                      ? formatPercent(vm.guestAgent.resourceUsage.cpuUsagePercent)
                      : 'N/A'}
                  </div>
                </div>
                <div className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <MemoryStick className="w-5 h-5 text-info" />
                    <span className="text-text-secondary">Memory</span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {formatBytes(vm.memoryTotalBytes)}
                  </div>
                </div>
                <div className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <HardDrive className="w-5 h-5 text-warning" />
                    <span className="text-text-secondary">Storage</span>
                  </div>
                  <div className="text-2xl font-bold text-text-primary">
                    {vm.guestAgent?.resourceUsage?.disks?.length || 0} disks
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'snapshots' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-text-primary">Snapshots</h3>
              <Button size="sm" onClick={() => setShowCreateSnapshot(true)}>
                <Camera className="w-4 h-4" />
                Create Snapshot
              </Button>
            </div>

            {showCreateSnapshot && (
              <Card className="bg-bg-surface">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={snapshotName}
                    onChange={(e) => setSnapshotName(e.target.value)}
                    placeholder="Snapshot name"
                    className="flex-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <Button
                    onClick={handleCreateSnapshot}
                    disabled={snapshotOps.create.isPending || !snapshotName.trim()}
                  >
                    {snapshotOps.create.isPending ? 'Creating...' : 'Create'}
                  </Button>
                  <Button variant="ghost" onClick={() => setShowCreateSnapshot(false)}>
                    Cancel
                  </Button>
                </div>
              </Card>
            )}

            {snapshots && snapshots.length > 0 ? (
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
              <Card className="text-center py-8 text-text-muted">
                <Camera className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No snapshots yet</p>
                <p className="text-sm mt-1">Create a snapshot to save the VM state</p>
              </Card>
            )}
          </div>
        )}

        {activeTab === 'console' && (
          <Card className="text-center py-12">
            <Monitor className="w-16 h-16 text-accent mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">VM Console</h3>
            <p className="text-text-muted mb-6">
              Open the console to interact with the VM directly
            </p>
            <Button
              onClick={handleOpenConsole}
              disabled={vm.state !== 'RUNNING'}
            >
              <Monitor className="w-4 h-4" />
              Open Console
            </Button>
            {vm.state !== 'RUNNING' && (
              <p className="text-sm text-warning mt-4">
                VM must be running to access the console
              </p>
            )}
          </Card>
        )}

        {activeTab === 'events' && (
          <Card className="text-center py-12 text-text-muted">
            <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Event log coming soon</p>
          </Card>
        )}
      </div>
    </div>
  );
}

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
