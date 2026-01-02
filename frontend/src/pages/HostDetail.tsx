import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Activity,
  Settings,
  Wrench,
  PowerOff,
  ArrowRightLeft,
  CheckCircle,
  AlertCircle,
  MonitorCog,
  Thermometer,
  Fan,
  Zap,
  Clock,
  Globe,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { ProgressRing } from '@/components/dashboard/ProgressRing';
import { mockNodes, mockVMs, type NodePhase, type Node as MockNode } from '@/data/mock-data';
import { useNode, type ApiNode } from '@/hooks/useNodes';
import { useApiConnection } from '@/hooks/useDashboard';

const phaseConfig: Record<NodePhase, { label: string; variant: 'success' | 'error' | 'warning' | 'info'; icon: typeof CheckCircle }> = {
  READY: { label: 'Ready', variant: 'success', icon: CheckCircle },
  NOT_READY: { label: 'Not Ready', variant: 'error', icon: AlertCircle },
  MAINTENANCE: { label: 'Maintenance', variant: 'warning', icon: Wrench },
  DRAINING: { label: 'Draining', variant: 'info', icon: Settings },
};

// Convert API Node to display format
function apiToDisplayNode(apiNode: ApiNode): MockNode {
  const phase = (apiNode.status?.phase as NodePhase) || 'READY';
  return {
    id: apiNode.id,
    hostname: apiNode.hostname,
    managementIp: apiNode.managementIp || '',
    labels: apiNode.labels || {},
    spec: {
      cpu: {
        model: apiNode.spec?.cpu?.model || 'Unknown',
        sockets: apiNode.spec?.cpu?.sockets || 1,
        coresPerSocket: apiNode.spec?.cpu?.coresPerSocket || 1,
        threadsPerCore: apiNode.spec?.cpu?.threadsPerCore || 1,
        totalCores: (apiNode.spec?.cpu?.sockets || 1) * (apiNode.spec?.cpu?.coresPerSocket || 1),
        features: [],
      },
      memory: {
        totalBytes: apiNode.spec?.memory?.totalBytes || 0,
        allocatableBytes: apiNode.spec?.memory?.allocatableBytes || 0,
      },
      storage: (apiNode.spec?.storage || []).map((s) => ({
        name: s.model || s.path || 'Unknown',
        type: s.type || 'HDD',
        sizeBytes: s.sizeBytes || 0,
        path: s.path,
      })),
      networks: (apiNode.spec?.network || []).map((n) => ({
        name: n.name || 'Unknown',
        macAddress: n.macAddress,
        speedMbps: n.speedMbps,
      })),
      role: { compute: true, storage: false, controlPlane: false },
    },
    status: {
      phase,
      conditions: (apiNode.status?.conditions || []).map((c) => ({
        type: c.type || 'Unknown',
        status: c.status || false,
        message: c.message || '',
        lastTransitionTime: '',
      })),
      resources: {
        cpuAllocatedCores: apiNode.status?.resources?.cpu?.allocatedVcpus || 0,
        cpuUsagePercent: 0,
        memoryAllocatedBytes: apiNode.status?.resources?.memory?.allocatedBytes || 0,
        memoryUsedBytes: 0,
        storageUsedBytes: 0,
      },
      vmIds: apiNode.status?.vmIds || [],
      systemInfo: {
        osName: 'Linux',
        kernelVersion: '',
        hypervisorVersion: '',
        agentVersion: '',
      },
    },
    createdAt: apiNode.createdAt || new Date().toISOString(),
  };
}

export function HostDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiNode, isLoading } = useNode(id || '', !!isConnected && !!id);

  // Determine data source
  const mockNode = mockNodes.find((n) => n.id === id);
  const useMockData = !isConnected || !apiNode;
  const node: MockNode | undefined = useMockData ? mockNode : apiToDisplayNode(apiNode);

  if (isLoading && !useMockData) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Server className="w-16 h-16 text-text-muted mb-4" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Host Not Found</h2>
        <p className="text-text-muted mb-4">The host you're looking for doesn't exist.</p>
        <Button onClick={() => navigate('/hosts')}>
          <ArrowLeft className="w-4 h-4" />
          Back to Hosts
        </Button>
      </div>
    );
  }

  const cpuPercent = node.spec.cpu.totalCores > 0
    ? Math.round((node.status.resources.cpuAllocatedCores / node.spec.cpu.totalCores) * 100)
    : 0;
  const memPercent = node.spec.memory.totalBytes > 0
    ? Math.round((node.status.resources.memoryAllocatedBytes / node.spec.memory.totalBytes) * 100)
    : 0;

  const phaseInfo = phaseConfig[node.status.phase];
  const PhaseIcon = phaseInfo.icon;

  // Get VMs running on this host
  const hostedVMs = mockVMs.filter((vm) => node.status.vmIds.includes(vm.id));

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
            onClick={() => navigate('/hosts')}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            Hosts
          </button>
          <span className="text-text-muted">/</span>
          <span className="text-text-primary font-medium">{node.hostname}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/hosts')}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-text-muted" />
            </button>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-bg-elevated flex items-center justify-center">
                <Server className="w-6 h-6 text-accent" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-text-primary">{node.hostname}</h1>
                  <div
                    className={cn(
                      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                      phaseInfo.variant === 'success' && 'bg-success/10 text-success',
                      phaseInfo.variant === 'error' && 'bg-error/10 text-error',
                      phaseInfo.variant === 'warning' && 'bg-warning/10 text-warning',
                      phaseInfo.variant === 'info' && 'bg-info/10 text-info',
                    )}
                  >
                    <PhaseIcon className="w-3.5 h-3.5" />
                    {phaseInfo.label}
                  </div>
                </div>
                <p className="text-text-muted mt-1 font-mono text-sm">{node.managementIp}</p>
              </div>
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
            <Button variant="secondary" size="sm">
              <ArrowRightLeft className="w-4 h-4" />
              Migrate VMs
            </Button>
            <Button variant="secondary" size="sm">
              <Wrench className="w-4 h-4" />
              Maintenance
            </Button>
            <Button variant="secondary" size="sm">
              <PowerOff className="w-4 h-4" />
              Reboot
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="vms">Virtual Machines ({node.status.vmIds.length})</TabsTrigger>
          <TabsTrigger value="hardware">Hardware</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
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
                  <InfoRow label="Hostname" value={node.hostname} />
                  <InfoRow label="Management IP" value={node.managementIp} mono />
                  <InfoRow label="Rack" value={node.labels['rack'] || '—'} />
                  <InfoRow label="Zone" value={node.labels['zone'] || '—'} />
                  <InfoRow label="Status" value={phaseInfo.label} />
                  <InfoRow label="VMs Running" value={`${node.status.vmIds.length} virtual machines`} />
                </div>
              </div>

              {/* Hardware Summary */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Hardware Summary</h3>
                <div className="grid grid-cols-4 gap-4">
                  <HardwareCard
                    icon={<Cpu className="w-5 h-5" />}
                    label="CPU"
                    value={node.spec.cpu.model}
                    subvalue={`${node.spec.cpu.totalCores} cores / ${node.spec.cpu.threads} threads`}
                  />
                  <HardwareCard
                    icon={<MemoryStick className="w-5 h-5" />}
                    label="Memory"
                    value={formatBytes(node.spec.memory.totalBytes)}
                    subvalue={`${formatBytes(node.spec.memory.allocatableBytes)} allocatable`}
                  />
                  <HardwareCard
                    icon={<HardDrive className="w-5 h-5" />}
                    label="Storage"
                    value={node.spec.storage.length > 0 
                      ? formatBytes(node.spec.storage.reduce((sum, s) => sum + (s.sizeBytes || 0), 0))
                      : 'Not reported'}
                    subvalue={node.spec.storage.length > 0 
                      ? `${node.spec.storage.length}x ${node.spec.storage[0]?.type || 'Disk'}` 
                      : 'No storage devices'}
                  />
                  <HardwareCard
                    icon={<Network className="w-5 h-5" />}
                    label="Network"
                    value={node.spec.networks.length > 0
                      ? `${node.spec.networks.length} interface(s)`
                      : 'Not reported'}
                    subvalue={node.spec.networks.length > 0
                      ? node.spec.networks.map(n => n.name).join(', ')
                      : 'No network devices'}
                  />
                </div>
              </div>

              {/* Labels */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Labels</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(node.labels).map(([key, value]) => (
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
              {/* CPU Allocation */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">CPU Allocation</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={cpuPercent}
                    size={120}
                    color={cpuPercent >= 80 ? 'red' : cpuPercent >= 60 ? 'yellow' : 'blue'}
                    label="allocated"
                  />
                </div>
                <div className="mt-4 text-center text-sm text-text-muted">
                  <p>{node.status.resources.cpuAllocatedCores} / {node.spec.cpu.totalCores} cores</p>
                </div>
              </div>

              {/* Memory Allocation */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">Memory Allocation</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={memPercent}
                    size={120}
                    color={memPercent >= 80 ? 'red' : memPercent >= 60 ? 'yellow' : 'green'}
                    label="allocated"
                  />
                </div>
                <div className="mt-4 text-center text-sm text-text-muted">
                  <p>
                    {formatBytes(node.status.resources.memoryAllocatedBytes)} /{' '}
                    {formatBytes(node.spec.memory.totalBytes)}
                  </p>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">System Health</h3>
                <div className="space-y-3">
                  <StatRow icon={<Thermometer className="w-4 h-4" />} label="CPU Temp" value="62°C" status="normal" />
                  <StatRow icon={<Fan className="w-4 h-4" />} label="Fan Speed" value="4200 RPM" status="normal" />
                  <StatRow icon={<Zap className="w-4 h-4" />} label="Power Draw" value="485W" status="normal" />
                  <StatRow icon={<Clock className="w-4 h-4" />} label="Uptime" value="45 days" status="normal" />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* VMs Tab */}
        <TabsContent value="vms">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">
                Virtual Machines on {node.hostname}
              </h3>
              <Button size="sm">
                <MonitorCog className="w-4 h-4" />
                Create VM
              </Button>
            </div>
            {hostedVMs.length > 0 ? (
              <table className="w-full">
                <thead className="bg-bg-elevated/50">
                  <tr className="text-xs font-medium text-text-muted uppercase">
                    <th className="px-6 py-3 text-left">Name</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">CPU</th>
                    <th className="px-6 py-3 text-left">Memory</th>
                    <th className="px-6 py-3 text-left">IP Address</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {hostedVMs.map((vm) => (
                    <tr
                      key={vm.id}
                      onClick={() => navigate(`/vms/${vm.id}`)}
                      className="hover:bg-bg-hover cursor-pointer"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <MonitorCog className="w-4 h-4 text-text-muted" />
                          <div>
                            <p className="text-sm font-medium text-text-primary">{vm.name}</p>
                            <p className="text-xs text-text-muted">{vm.status.guestInfo.osName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={vm.status.state === 'RUNNING' ? 'success' : 'default'}>
                          {vm.status.state}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {vm.spec.cpu.cores} vCPUs ({vm.status.resourceUsage.cpuUsagePercent}%)
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary">
                        {formatBytes(vm.status.resourceUsage.memoryUsedBytes)}
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                        {vm.status.ipAddresses[0] || '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button variant="ghost" size="sm">Migrate</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-12 text-center">
                <MonitorCog className="w-12 h-12 mx-auto text-text-muted mb-4" />
                <h4 className="text-lg font-medium text-text-primary mb-2">No VMs on this Host</h4>
                <p className="text-text-muted">Create a new VM or migrate existing VMs to this host</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Hardware Tab */}
        <TabsContent value="hardware">
          <div className="grid grid-cols-2 gap-6">
            {/* CPU Info */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Cpu className="w-5 h-5 text-accent" />
                Processor
              </h3>
              <div className="space-y-3">
                <InfoRow label="Model" value={node.spec.cpu.model} />
                <InfoRow label="Physical Cores" value={`${node.spec.cpu.totalCores}`} />
                <InfoRow label="Threads" value={`${node.spec.cpu.threads}`} />
                <InfoRow label="Sockets" value="2" />
                <InfoRow label="Architecture" value="x86_64" />
                <InfoRow label="Virtualization" value="AMD-V / SVM" />
              </div>
            </div>

            {/* Memory Info */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <MemoryStick className="w-5 h-5 text-accent" />
                Memory
              </h3>
              <div className="space-y-3">
                <InfoRow label="Total" value={formatBytes(node.spec.memory.totalBytes)} />
                <InfoRow label="Allocatable" value={formatBytes(node.spec.memory.allocatableBytes)} />
                <InfoRow label="Type" value="DDR5-4800" />
                <InfoRow label="Channels" value="8" />
                <InfoRow label="DIMMs" value="16 x 32GB" />
                <InfoRow label="ECC" value="Enabled" />
              </div>
            </div>

            {/* Storage Info */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-accent" />
                Local Storage
              </h3>
              <div className="space-y-4">
                {node.spec.storage.length > 0 ? (
                  node.spec.storage.map((disk, idx) => (
                    <div key={disk.path || idx} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm font-medium text-text-primary font-mono">{disk.path || disk.name}</p>
                        <p className="text-xs text-text-muted">{disk.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-text-primary">{formatBytes(disk.sizeBytes)}</p>
                        <p className="text-xs text-text-muted">{disk.type}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-muted">No storage devices reported</p>
                )}
              </div>
            </div>

            {/* Network Info */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Network className="w-5 h-5 text-accent" />
                Network Interfaces
              </h3>
              <div className="space-y-4">
                {node.spec.networks.length > 0 ? (
                  node.spec.networks.map((nic, idx) => (
                    <div key={nic.name || idx} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm font-medium text-text-primary font-mono">{nic.name}</p>
                        <p className="text-xs text-text-muted">{nic.macAddress || 'Unknown MAC'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-text-primary">{nic.speedMbps ? `${nic.speedMbps >= 1000 ? (nic.speedMbps / 1000) + ' Gbps' : nic.speedMbps + ' Mbps'}` : 'Unknown speed'}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-text-muted">No network interfaces reported</p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Storage Tab */}
        <TabsContent value="storage">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Storage Configuration</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-text-muted mb-3">Ceph OSD Status</h4>
                  <div className="space-y-2">
                    {['osd.12', 'osd.13', 'osd.14', 'osd.15'].map((osd) => (
                      <div key={osd} className="flex items-center justify-between p-3 bg-bg-base rounded-lg">
                        <span className="text-sm font-mono text-text-primary">{osd}</span>
                        <Badge variant="success">Up</Badge>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-text-muted mb-3">Local Volumes</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-bg-base rounded-lg">
                      <span className="text-sm text-text-primary">Boot Volume</span>
                      <span className="text-sm text-text-secondary">480 GB</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-bg-base rounded-lg">
                      <span className="text-sm text-text-primary">Local Cache</span>
                      <span className="text-sm text-text-secondary">1.8 TB</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Network Tab */}
        <TabsContent value="network">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Network Configuration</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-text-muted mb-3">OVS Bridges</h4>
                  <div className="space-y-2">
                    <div className="p-3 bg-bg-base rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-mono font-medium text-text-primary">br-int</span>
                        <Badge variant="success">Active</Badge>
                      </div>
                      <p className="text-xs text-text-muted">Integration bridge for VM traffic</p>
                    </div>
                    <div className="p-3 bg-bg-base rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-mono font-medium text-text-primary">br-ex</span>
                        <Badge variant="success">Active</Badge>
                      </div>
                      <p className="text-xs text-text-muted">External network bridge</p>
                    </div>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-text-muted mb-3">Bond Interfaces</h4>
                  <div className="space-y-2">
                    <div className="p-3 bg-bg-base rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-mono font-medium text-text-primary">bond0</span>
                        <Badge variant="success">Active-Backup</Badge>
                      </div>
                      <p className="text-xs text-text-muted">eno1 + eno2 (Management + Storage)</p>
                    </div>
                    <div className="p-3 bg-bg-base rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-mono font-medium text-text-primary">bond1</span>
                        <Badge variant="success">LACP 802.3ad</Badge>
                      </div>
                      <p className="text-xs text-text-muted">enp65s0f0 + enp65s0f1 (200 Gbps)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
                <div className="text-center">
                  <Activity className="w-8 h-8 mx-auto text-text-muted mb-2" />
                  <p className="text-text-muted">CPU Utilization Chart</p>
                </div>
              </div>
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <div className="text-center">
                  <Activity className="w-8 h-8 mx-auto text-text-muted mb-2" />
                  <p className="text-text-muted">Memory Usage Chart</p>
                </div>
              </div>
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <div className="text-center">
                  <Activity className="w-8 h-8 mx-auto text-text-muted mb-2" />
                  <p className="text-text-muted">Network I/O Chart</p>
                </div>
              </div>
              <div className="h-48 bg-bg-base rounded-lg flex items-center justify-center border border-border">
                <div className="text-center">
                  <Activity className="w-8 h-8 mx-auto text-text-muted mb-2" />
                  <p className="text-text-muted">Disk I/O Chart</p>
                </div>
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
                { time: '2 hours ago', type: 'VM', message: 'VM prod-web-01 started', severity: 'info' },
                { time: '5 hours ago', type: 'Network', message: 'Bond interface failover detected', severity: 'warning' },
                { time: '1 day ago', type: 'Storage', message: 'Ceph OSD.12 recovered', severity: 'success' },
                { time: '2 days ago', type: 'System', message: 'Host rebooted for maintenance', severity: 'info' },
                { time: '3 days ago', type: 'VM', message: 'VM migration completed (prod-db-01)', severity: 'success' },
              ].map((event, index) => (
                <div key={index} className="px-6 py-4 hover:bg-bg-hover">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-text-muted w-24">{event.time}</span>
                    <Badge
                      variant={
                        event.severity === 'success' ? 'success' :
                        event.severity === 'warning' ? 'warning' :
                        event.severity === 'error' ? 'error' : 'default'
                      }
                      size="sm"
                    >
                      {event.type}
                    </Badge>
                    <span className="text-sm text-text-primary flex-1">{event.message}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
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
      <p className="text-sm font-semibold text-text-primary truncate" title={value}>{value}</p>
      <p className="text-xs text-text-muted mt-1">{subvalue}</p>
    </div>
  );
}

function StatRow({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: 'normal' | 'warning' | 'critical';
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span
        className={cn(
          'text-sm font-medium',
          status === 'normal' && 'text-success',
          status === 'warning' && 'text-warning',
          status === 'critical' && 'text-error',
        )}
      >
        {value}
      </span>
    </div>
  );
}

