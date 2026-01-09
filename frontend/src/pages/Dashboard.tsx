import { motion } from 'framer-motion';
import {
  MonitorCog,
  Server,
  Cpu,
  MemoryStick,
  Activity,
  WifiOff,
  RefreshCw,
  Wifi,
  ServerOff,
} from 'lucide-react';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { ResourceCard } from '@/components/dashboard/ResourceCard';
import { NodeCard } from '@/components/dashboard/NodeCard';
import { VMTable } from '@/components/vm/VMTable';
import { type VirtualMachine, type Node, type PowerState } from '@/types/models';
import { useDashboard } from '@/hooks/useDashboard';
import type { ApiVM } from '@/hooks/useVMs';
import type { ApiNode } from '@/hooks/useNodes';

/**
 * Convert API VM to display format for the VMTable component
 */
function apiVMToDisplay(vm: ApiVM): VirtualMachine {
  const stateMap: Record<string, PowerState> = {
    'RUNNING': 'RUNNING',
    'POWER_STATE_RUNNING': 'RUNNING',
    'STOPPED': 'STOPPED',
    'POWER_STATE_STOPPED': 'STOPPED',
    'PAUSED': 'PAUSED',
    'POWER_STATE_PAUSED': 'PAUSED',
    'STARTING': 'STARTING',
    'PROVISIONING': 'STOPPED',
    'STOPPING': 'STOPPING',
    'MIGRATING': 'MIGRATING',
    'ERROR': 'ERROR',
    'POWER_STATE_ERROR': 'ERROR',
    'SUSPENDED': 'SUSPENDED',
    'CRASHED': 'CRASHED',
  };

  const apiState = vm.status?.state || vm.status?.powerState || 'STOPPED';
  const state: PowerState = stateMap[apiState] || 'STOPPED';

  return {
    id: vm.id,
    name: vm.name,
    projectId: vm.projectId,
    description: vm.description || '',
    labels: vm.labels || {},
    spec: {
      cpu: { cores: vm.spec?.cpu?.cores || 2, sockets: 1, model: 'host-passthrough' },
      memory: { sizeMib: vm.spec?.memory?.sizeMib || 4096 },
      disks: (vm.spec?.disks || []).map((d, i) => ({ 
        id: `disk-${i}`, 
        sizeGib: d.sizeGib || 0, 
        bus: 'VIRTIO_BLK' 
      })),
      nics: [{ id: 'nic-1', networkId: 'default', macAddress: '00:00:00:00:00:00' }],
    },
    status: {
      state,
      nodeId: vm.status?.nodeId || '',
      ipAddresses: vm.status?.ipAddresses || [],
      resourceUsage: {
        cpuUsagePercent: vm.status?.resourceUsage?.cpuUsagePercent || 0,
        memoryUsedBytes: (vm.status?.resourceUsage?.memoryUsedMib || 0) * 1024 * 1024,
        memoryAllocatedBytes: (vm.spec?.memory?.sizeMib || 0) * 1024 * 1024,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Linux',
        hostname: vm.name,
        agentVersion: '0.0.0',
        uptimeSeconds: 0,
      },
    },
    createdAt: vm.createdAt || new Date().toISOString(),
  };
}

/**
 * Convert API Node to display format for the NodeCard component
 */
function apiNodeToDisplay(node: ApiNode): Node {
  const phaseMap: Record<string, 'READY' | 'NOT_READY' | 'MAINTENANCE' | 'DRAINING'> = {
    'READY': 'READY',
    'NODE_PHASE_READY': 'READY',
    'NOT_READY': 'NOT_READY',
    'NODE_PHASE_NOT_READY': 'NOT_READY',
    'MAINTENANCE': 'MAINTENANCE',
    'NODE_PHASE_MAINTENANCE': 'MAINTENANCE',
    'DRAINING': 'DRAINING',
    'NODE_PHASE_DRAINING': 'DRAINING',
  };

  const phase = phaseMap[node.status?.phase || 'NOT_READY'] || 'NOT_READY';
  const cpuCores = (node.spec?.cpu?.sockets || 1) * (node.spec?.cpu?.coresPerSocket || 1);
  const memoryBytes = node.spec?.memory?.totalBytes || 0;
  
  return {
    id: node.id,
    hostname: node.hostname,
    managementIp: node.managementIp || '',
    labels: node.labels || {},
    spec: {
      cpu: { 
        model: node.spec?.cpu?.model || 'Unknown', 
        totalCores: cpuCores, 
        threads: (node.spec?.cpu?.threadsPerCore || 1) * cpuCores,
      },
      memory: { 
        totalBytes: memoryBytes,
        allocatableBytes: memoryBytes,
      },
      storage: [],
      networks: [],
      role: { compute: true, storage: false, controlPlane: false },
    },
    status: {
      phase,
      vmIds: node.status?.vmIds || [],
      resources: {
        cpuAllocatedCores: node.status?.resources?.cpu?.allocatedVcpus || 0,
        cpuUsagePercent: 0,
        memoryAllocatedBytes: node.status?.resources?.memory?.allocatedBytes || 0,
        memoryUsedBytes: 0,
      },
    },
  };
}

export function Dashboard() {
  // Fetch real data from the API
  const { vms, nodes, metrics, isLoading, isConnected, refetch } = useDashboard();
  
  // Convert API data to display format
  const displayVMs = vms.map(apiVMToDisplay);
  const displayNodes = nodes.map(apiNodeToDisplay);
  
  // Normalize stats from metrics
  const stats = {
    totalVMs: metrics.totalVMs,
    runningVMs: metrics.runningVMs,
    totalHosts: metrics.totalHosts,
    healthyHosts: metrics.healthyHosts,
    totalCPU: metrics.totalVCPUs,
    usedCPU: Math.round(metrics.totalVCPUs * (metrics.avgCpuUsage / 100)),
    totalMemory: metrics.totalMemoryGB,
    usedMemory: Math.round(metrics.totalMemoryGB * (metrics.avgMemoryUsage / 100)),
    totalStorage: metrics.totalStorageGB,
    usedStorage: metrics.usedStorageGB,
    alerts: { critical: metrics.criticalAlerts, warning: metrics.warningAlerts },
  };

  return (
    <div className="space-y-8">
      {/* Header with Connection Status */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">
            Cluster overview and resource utilization
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Connection Status Indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
            isConnected 
              ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {isConnected ? (
              <>
                <Wifi className="w-4 h-4" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4" />
                <span>Disconnected</span>
              </>
            )}
          </div>
          
          {/* Refresh Button */}
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Not Connected Banner */}
      {!isConnected && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-500/30 rounded-xl p-4 flex items-center gap-4"
        >
          <div className="p-2 bg-red-500/30 rounded-lg">
            <ServerOff className="w-6 h-6 text-red-400" />
          </div>
          <div>
            <h3 className="text-red-200 font-medium">Backend Not Connected</h3>
            <p className="text-red-300/70 text-sm">
              Start the control plane server with <code className="bg-black/30 px-1 rounded">go run ./cmd/controlplane</code> to view cluster data.
            </p>
          </div>
        </motion.div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <MetricCard
            title="Virtual Machines"
            value={stats.totalVMs}
            subtitle={`${stats.runningVMs} running`}
            icon={<MonitorCog className="w-6 h-6" />}
            trend={{ value: stats.runningVMs, label: 'active' }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <MetricCard
            title="Hosts"
            value={stats.totalHosts}
            subtitle={`${stats.healthyHosts} healthy`}
            icon={<Server className="w-6 h-6" />}
            trend={{ value: Math.round((stats.healthyHosts / (stats.totalHosts || 1)) * 100), label: 'uptime' }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <MetricCard
            title="vCPUs"
            value={stats.totalCPU}
            subtitle={`${stats.usedCPU} allocated`}
            icon={<Cpu className="w-6 h-6" />}
            trend={{ value: Math.round((stats.usedCPU / (stats.totalCPU || 1)) * 100), label: 'usage' }}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <MetricCard
            title="Memory"
            value={`${stats.totalMemory} GB`}
            subtitle={`${stats.usedMemory} GB used`}
            icon={<MemoryStick className="w-6 h-6" />}
            trend={{ value: Math.round((stats.usedMemory / (stats.totalMemory || 1)) * 100), label: 'usage' }}
          />
        </motion.div>
      </div>

      {/* Resource Utilization */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
        >
          <ResourceCard
            title="CPU Usage"
            used={stats.usedCPU}
            total={stats.totalCPU}
            unit="count"
            color="blue"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <ResourceCard
            title="Memory Usage"
            used={stats.usedMemory}
            total={stats.totalMemory}
            unit="count"
            color="yellow"
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.7 }}
        >
          <ResourceCard
            title="Storage Usage"
            used={stats.usedStorage}
            total={stats.totalStorage}
            unit="count"
            color="green"
          />
        </motion.div>
      </div>

      {/* Nodes Overview */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            Host Nodes
          </h2>
          <span className="text-sm text-gray-400">
            {stats.healthyHosts} of {stats.totalHosts} healthy
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {displayNodes.slice(0, 4).map((node, index) => (
            <motion.div
              key={node.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.9 + index * 0.1 }}
            >
              <NodeCard node={node} />
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Recent VMs */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2 }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-green-400" />
            Virtual Machines
          </h2>
          <span className="text-sm text-gray-400">
            {stats.runningVMs} of {stats.totalVMs} running
          </span>
        </div>
        <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden">
          <VMTable vms={displayVMs} />
        </div>
      </motion.div>
    </div>
  );
}
