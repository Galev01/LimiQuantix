import { motion } from 'framer-motion';
import {
  MonitorCog,
  Server,
  HardDrive,
  Cpu,
  MemoryStick,
  Activity,
} from 'lucide-react';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { ResourceCard } from '@/components/dashboard/ResourceCard';
import { NodeCard } from '@/components/dashboard/NodeCard';
import { VMTable } from '@/components/vm/VMTable';
import { mockVMs, mockNodes, getClusterStats } from '@/data/mock-data';

export function Dashboard() {
  const stats = getClusterStats();

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Cluster Overview</h1>
          <p className="text-text-muted mt-1">
            Monitor your infrastructure at a glance
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Activity className="w-4 h-4 text-success animate-pulse" />
          <span>Live</span>
          <span className="text-text-disabled">•</span>
          <span>Last updated: just now</span>
        </div>
      </motion.div>

      {/* Summary Cards - 4 column flex layout */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <MetricCard
            title="Virtual Machines"
            value={stats.vms.total}
            subtitle={`${stats.vms.running} running, ${stats.vms.stopped} stopped`}
            icon={<MonitorCog className="w-6 h-6" />}
            color="blue"
            delay={0}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <MetricCard
            title="Hosts"
            value={stats.nodes.total}
            subtitle={`${stats.nodes.ready} ready`}
            icon={<Server className="w-6 h-6" />}
            color="green"
            delay={0.1}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <MetricCard
            title="CPU Allocation"
            value={`${stats.cpu.allocated} vCPUs`}
            subtitle={`${Math.round(stats.cpu.avgUsage)}% avg usage`}
            icon={<Cpu className="w-6 h-6" />}
            color="purple"
            delay={0.2}
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <MetricCard
            title="Memory Allocation"
            value={`${Math.round(stats.memory.allocated / 1024 / 1024 / 1024)} GB`}
            subtitle={`${Math.round((stats.memory.used / stats.memory.allocated) * 100)}% in use`}
            icon={<MemoryStick className="w-6 h-6" />}
            color="yellow"
            delay={0.3}
          />
        </div>
      </div>

      {/* Resource Usage & Hosts */}
      <div className="grid-3-cols gap-6">
        {/* Resource Cards */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-text-primary">Resource Usage</h2>
          <ResourceCard
            title="Cluster Memory"
            used={stats.memory.used}
            total={stats.memory.allocated}
            unit="bytes"
            color="blue"
            delay={0.4}
          />
          <ResourceCard
            title="Cluster Storage"
            used={stats.storage.used}
            total={stats.storage.total}
            unit="bytes"
            color="green"
            delay={0.5}
          />
        </div>

        {/* Host Cards */}
        <div style={{ gridColumn: 'span 2' }}>
          <h2 className="text-lg font-semibold text-text-primary mb-4">Hosts</h2>
          <div className="grid-2-cols gap-4">
            {mockNodes.map((node, index) => (
              <NodeCard key={node.id} node={node} delay={0.4 + index * 0.1} />
            ))}
          </div>
        </div>
      </div>

      {/* VM Table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Virtual Machines</h2>
          <button className="text-sm text-accent hover:text-accent-hover transition-colors">
            View all →
          </button>
        </div>
        <VMTable vms={mockVMs} />
      </div>
    </div>
  );
}

