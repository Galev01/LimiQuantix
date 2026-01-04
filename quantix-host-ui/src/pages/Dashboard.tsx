import { 
  Cpu, 
  MemoryStick, 
  MonitorCog, 
  Clock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { HostHeader } from '@/components/layout';
import { Card, CardHeader, Badge, Button, ProgressRing } from '@/components/ui';
import { useHostInfo, useHostHealth } from '@/hooks/useHost';
import { useVMs } from '@/hooks/useVMs';
import { useStoragePools } from '@/hooks/useStorage';
import { formatBytes, formatUptime, formatPercent } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function Dashboard() {
  const { data: hostInfo } = useHostInfo();
  const { data: health, refetch: refetchHealth, isFetching } = useHostHealth();
  const { data: vms } = useVMs();
  const { data: pools } = useStoragePools();

  // Calculate stats
  const runningVms = vms?.filter(vm => vm.state === 'RUNNING').length || 0;
  const stoppedVms = vms?.filter(vm => vm.state === 'STOPPED').length || 0;
  const totalVms = vms?.length || 0;

  const memoryUsedBytes = hostInfo 
    ? hostInfo.memoryTotalBytes - hostInfo.memoryAvailableBytes 
    : 0;
  const memoryPercent = hostInfo 
    ? (memoryUsedBytes / hostInfo.memoryTotalBytes) * 100 
    : 0;

  // Storage totals
  const totalStorage = pools?.reduce((acc, p) => acc + p.totalBytes, 0) || 0;
  const usedStorage = pools?.reduce((acc, p) => acc + p.usedBytes, 0) || 0;
  const storagePercent = totalStorage > 0 ? (usedStorage / totalStorage) * 100 : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <HostHeader
        hostname={hostInfo?.hostname || 'Loading...'}
        status={health?.healthy ? 'online' : 'offline'}
        onRefresh={() => refetchHealth()}
        refreshing={isFetching}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Quick Stats */}
        <div className="grid-4-cols">
          <StatCard
            icon={MonitorCog}
            label="Virtual Machines"
            value={totalVms}
            detail={`${runningVms} running, ${stoppedVms} stopped`}
            href="/vms"
          />
          <StatCard
            icon={Cpu}
            label="CPU Cores"
            value={hostInfo?.cpuCores || 0}
            detail={hostInfo?.cpuModel?.split(' ').slice(0, 4).join(' ') || '-'}
          />
          <StatCard
            icon={MemoryStick}
            label="Memory"
            value={formatBytes(hostInfo?.memoryTotalBytes || 0)}
            detail={`${formatBytes(hostInfo?.memoryAvailableBytes || 0)} available`}
          />
          <StatCard
            icon={Clock}
            label="Uptime"
            value={formatUptime(health?.uptimeSeconds || 0)}
            detail={`${health?.hypervisor || '-'} ${health?.hypervisorVersion || ''}`}
          />
        </div>

        {/* Resource Rings */}
        <div className="grid-3-cols">
          <Card className="flex items-center justify-center py-8">
            <div className="text-center">
              <ProgressRing
                value={memoryPercent}
                size={140}
                color={memoryPercent > 90 ? 'error' : memoryPercent > 70 ? 'warning' : 'accent'}
                label={formatPercent(memoryPercent, 0)}
                sublabel="Memory"
              />
              <div className="mt-4 text-sm text-text-muted">
                {formatBytes(memoryUsedBytes)} / {formatBytes(hostInfo?.memoryTotalBytes || 0)}
              </div>
            </div>
          </Card>

          <Card className="flex items-center justify-center py-8">
            <div className="text-center">
              <ProgressRing
                value={storagePercent}
                size={140}
                color={storagePercent > 90 ? 'error' : storagePercent > 70 ? 'warning' : 'success'}
                label={formatPercent(storagePercent, 0)}
                sublabel="Storage"
              />
              <div className="mt-4 text-sm text-text-muted">
                {formatBytes(usedStorage)} / {formatBytes(totalStorage)}
              </div>
            </div>
          </Card>

          <Card className="flex items-center justify-center py-8">
            <div className="text-center">
              <ProgressRing
                value={totalVms > 0 ? (runningVms / totalVms) * 100 : 0}
                size={140}
                color="info"
                label={`${runningVms}/${totalVms}`}
                sublabel="VMs Running"
              />
              <div className="mt-4 text-sm text-text-muted">
                {stoppedVms} stopped
              </div>
            </div>
          </Card>
        </div>

        {/* VM List Preview & System Info */}
        <div className="grid-2-cols">
          {/* Recent VMs */}
          <Card>
            <CardHeader
              title="Virtual Machines"
              action={
                <Link to="/vms">
                  <Button variant="ghost" size="sm">View All</Button>
                </Link>
              }
            />
            <div className="space-y-2">
              {vms?.slice(0, 5).map(vm => (
                <div
                  key={vm.vmId}
                  className="flex items-center justify-between p-3 rounded-lg bg-bg-base hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-2 h-2 rounded-full',
                      vm.state === 'RUNNING' ? 'bg-success' :
                      vm.state === 'STOPPED' ? 'bg-text-muted' :
                      vm.state === 'PAUSED' ? 'bg-warning' :
                      'bg-error'
                    )} />
                    <div>
                      <div className="font-medium text-text-primary">{vm.name}</div>
                      <div className="text-xs text-text-muted">
                        {vm.guestAgent?.osName || vm.vmId.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant={
                      vm.state === 'RUNNING' ? 'success' :
                      vm.state === 'STOPPED' ? 'default' :
                      vm.state === 'PAUSED' ? 'warning' :
                      'error'
                    }
                    size="sm"
                  >
                    {vm.state}
                  </Badge>
                </div>
              ))}
              {(!vms || vms.length === 0) && (
                <div className="text-center py-8 text-text-muted">
                  No virtual machines
                </div>
              )}
            </div>
          </Card>

          {/* System Information */}
          <Card>
            <CardHeader title="System Information" />
            <div className="space-y-3">
              <InfoRow label="Hostname" value={hostInfo?.hostname} />
              <InfoRow label="OS" value={`${hostInfo?.osName || '-'} ${hostInfo?.osVersion || ''}`} />
              <InfoRow label="Kernel" value={hostInfo?.kernelVersion} />
              <InfoRow label="Hypervisor" value={`${health?.hypervisor || '-'} ${health?.hypervisorVersion || ''}`} />
              <InfoRow label="Node ID" value={hostInfo?.nodeId?.slice(0, 8) + '...'} />
              <InfoRow 
                label="Status" 
                value={
                  <Badge variant={health?.healthy ? 'success' : 'error'}>
                    {health?.healthy ? 'Healthy' : 'Unhealthy'}
                  </Badge>
                }
              />
            </div>
          </Card>
        </div>

        {/* Storage Pools Preview */}
        <Card>
          <CardHeader
            title="Storage Pools"
            action={
              <Link to="/storage/pools">
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-sm text-text-muted">
                  <th className="pb-3 font-medium">Pool</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Capacity</th>
                  <th className="pb-3 font-medium">Used</th>
                  <th className="pb-3 font-medium">Usage</th>
                </tr>
              </thead>
              <tbody>
                {pools?.map(pool => {
                  const usagePercent = (pool.usedBytes / pool.totalBytes) * 100;
                  return (
                    <tr key={pool.poolId} className="border-b border-border/50">
                      <td className="py-3 font-medium text-text-primary">{pool.poolId}</td>
                      <td className="py-3 text-text-secondary">{pool.type}</td>
                      <td className="py-3 text-text-secondary">{formatBytes(pool.totalBytes)}</td>
                      <td className="py-3 text-text-secondary">{formatBytes(pool.usedBytes)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-bg-hover rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all',
                                usagePercent > 90 ? 'bg-error' :
                                usagePercent > 70 ? 'bg-warning' :
                                'bg-success'
                              )}
                              style={{ width: `${usagePercent}%` }}
                            />
                          </div>
                          <span className="text-sm text-text-muted">{formatPercent(usagePercent, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(!pools || pools.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-text-muted">
                      No storage pools configured
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

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  detail?: string;
  href?: string;
}

function StatCard({ icon: Icon, label, value, detail, href }: StatCardProps) {
  const content = (
    <Card className={cn(
      'flex items-center gap-4',
      href && 'hover:border-accent/50 cursor-pointer transition-colors'
    )}>
      <div className="p-3 rounded-lg bg-accent/10">
        <Icon className="w-6 h-6 text-accent" />
      </div>
      <div>
        <div className="text-2xl font-bold text-text-primary">{value}</div>
        <div className="text-sm text-text-muted">{label}</div>
        {detail && <div className="text-xs text-text-muted mt-0.5">{detail}</div>}
      </div>
    </Card>
  );

  if (href) {
    return <Link to={href}>{content}</Link>;
  }
  return content;
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value || '-'}</span>
    </div>
  );
}
