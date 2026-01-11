import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  Play,
  Square,
  RotateCcw,
  Monitor,
  MoreVertical,
  RefreshCw,
} from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useVMs, useVMPowerOps } from '@/hooks/useVMs';
import { formatBytes, formatPercent, cn } from '@/lib/utils';
import { launchQvMC } from '@/lib/qvmc';
import { useAppStore } from '@/stores/useAppStore';
import type { VirtualMachine, PowerState } from '@/api/types';

export function VirtualMachines() {
  const { data: vms, isLoading, refetch, isFetching } = useVMs();
  const powerOps = useVMPowerOps();
  const { hostUrl, openVmWizard } = useAppStore();
  const [selectedVm, setSelectedVm] = useState<string | null>(null);

  const handlePowerAction = (vm: VirtualMachine, action: 'start' | 'stop' | 'reboot' | 'pause' | 'resume' | 'forceStop') => {
    switch (action) {
      case 'start':
        powerOps.start.mutate(vm.vmId);
        break;
      case 'stop':
        powerOps.stop.mutate(vm.vmId);
        break;
      case 'forceStop':
        powerOps.forceStop.mutate(vm.vmId);
        break;
      case 'reboot':
        powerOps.reboot.mutate(vm.vmId);
        break;
      case 'pause':
        powerOps.pause.mutate(vm.vmId);
        break;
      case 'resume':
        powerOps.resume.mutate(vm.vmId);
        break;
    }
  };

  const handleOpenConsole = (vm: VirtualMachine) => {
    launchQvMC({
      hostUrl,
      vmId: vm.vmId,
      vmName: vm.name,
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Virtual Machines"
        subtitle={`${vms?.length || 0} virtual machines on this host`}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={openVmWizard}>
              <Plus className="w-4 h-4" />
              Create VM
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-sm text-text-muted">
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">State</th>
                  <th className="p-4 font-medium">CPU</th>
                  <th className="p-4 font-medium">Memory</th>
                  <th className="p-4 font-medium">Guest OS</th>
                  <th className="p-4 font-medium">IP Address</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vms?.map(vm => (
                  <tr
                    key={vm.vmId}
                    className={cn(
                      'border-b border-border/50 hover:bg-bg-hover/50 transition-colors',
                      selectedVm === vm.vmId && 'bg-accent/5'
                    )}
                    onClick={() => setSelectedVm(vm.vmId)}
                  >
                    <td className="p-4">
                      <Link
                        to={`/vms/${vm.vmId}`}
                        className="font-medium text-text-primary hover:text-accent transition-colors"
                      >
                        {vm.name}
                      </Link>
                      <div className="text-xs text-text-muted mt-0.5">
                        {vm.vmId.slice(0, 8)}
                      </div>
                    </td>
                    <td className="p-4">
                      <PowerStateBadge state={vm.state} />
                    </td>
                    <td className="p-4 text-text-secondary">
                      {vm.cpuUsagePercent > 0 ? formatPercent(vm.cpuUsagePercent) : '-'}
                    </td>
                    <td className="p-4 text-text-secondary">
                      {vm.memoryTotalBytes > 0 ? (
                        <div>
                          <div>{formatBytes(vm.memoryUsedBytes)}</div>
                          <div className="text-xs text-text-muted">
                            / {formatBytes(vm.memoryTotalBytes)}
                          </div>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="p-4 text-text-secondary">
                      {vm.guestAgent?.osName || '-'}
                    </td>
                    <td className="p-4 text-text-secondary">
                      {vm.guestAgent?.ipAddresses?.[0] || '-'}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        {/* Power Actions */}
                        {vm.state === 'STOPPED' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handlePowerAction(vm, 'start'); }}
                            disabled={powerOps.start.isPending}
                            title="Start"
                          >
                            <Play className="w-4 h-4 text-success" />
                          </Button>
                        )}
                        {vm.state === 'RUNNING' && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handleOpenConsole(vm); }}
                              title="Console"
                            >
                              <Monitor className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handlePowerAction(vm, 'stop'); }}
                              disabled={powerOps.stop.isPending}
                              title="Stop"
                            >
                              <Square className="w-4 h-4 text-error" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); handlePowerAction(vm, 'reboot'); }}
                              disabled={powerOps.reboot.isPending}
                              title="Reboot"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                        {vm.state === 'PAUSED' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handlePowerAction(vm, 'resume'); }}
                            disabled={powerOps.resume.isPending}
                            title="Resume"
                          >
                            <Play className="w-4 h-4 text-success" />
                          </Button>
                        )}
                        
                        {/* More Options */}
                        <Button
                          variant="ghost"
                          size="sm"
                          title="More options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-text-muted">
                      Loading virtual machines...
                    </td>
                  </tr>
                )}
                {!isLoading && (!vms || vms.length === 0) && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-text-muted">
                      <div className="flex flex-col items-center gap-4">
                        <p>No virtual machines found</p>
                        <Button size="sm" onClick={openVmWizard}>
                          <Plus className="w-4 h-4" />
                          Create Your First VM
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
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
    <Badge variant={variants[state] || 'default'}>
      {state}
    </Badge>
  );
}
