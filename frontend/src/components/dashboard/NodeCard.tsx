import { motion } from 'framer-motion';
import { Server, Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import type { Node } from '@/data/mock-data';

interface NodeCardProps {
  node: Node;
  delay?: number;
}

const phaseColors = {
  READY: 'bg-success',
  NOT_READY: 'bg-error',
  MAINTENANCE: 'bg-warning',
  DRAINING: 'bg-info',
};

export function NodeCard({ node, delay = 0 }: NodeCardProps) {
  const memoryPercent = Math.round(
    (node.status.resources.memoryUsedBytes / node.status.resources.memoryAllocatableBytes) * 100
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={cn(
        'bg-bg-surface rounded-xl p-5',
        'border border-border',
        'shadow-floating hover:shadow-elevated',
        'transition-all duration-200',
        'group cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-bg-elevated flex items-center justify-center group-hover:bg-accent/10 transition-colors">
            <Server className="w-5 h-5 text-text-muted group-hover:text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
              {node.hostname.split('.')[0]}
            </h3>
            <p className="text-xs text-text-muted">{node.managementIp}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('w-2 h-2 rounded-full', phaseColors[node.status.phase])} />
          <span className="text-xs text-text-muted">{node.status.phase}</span>
        </div>
      </div>

      <div className="space-y-3">
        {/* CPU */}
        <div className="flex items-center gap-3">
          <Cpu className="w-4 h-4 text-text-muted" />
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-text-muted">CPU</span>
              <span className="text-text-secondary">{node.status.resources.cpuUsagePercent}%</span>
            </div>
            <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${node.status.resources.cpuUsagePercent}%` }}
                transition={{ duration: 0.5, delay: delay + 0.1 }}
                className={cn(
                  'h-full rounded-full',
                  node.status.resources.cpuUsagePercent >= 80 ? 'bg-error' :
                  node.status.resources.cpuUsagePercent >= 60 ? 'bg-warning' : 'bg-accent',
                )}
              />
            </div>
          </div>
        </div>

        {/* Memory */}
        <div className="flex items-center gap-3">
          <MemoryStick className="w-4 h-4 text-text-muted" />
          <div className="flex-1">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-text-muted">Memory</span>
              <span className="text-text-secondary">{memoryPercent}%</span>
            </div>
            <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${memoryPercent}%` }}
                transition={{ duration: 0.5, delay: delay + 0.2 }}
                className={cn(
                  'h-full rounded-full',
                  memoryPercent >= 80 ? 'bg-error' :
                  memoryPercent >= 60 ? 'bg-warning' : 'bg-success',
                )}
              />
            </div>
          </div>
        </div>

        {/* VMs */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-xs text-text-muted">Virtual Machines</span>
          <span className="text-sm font-medium text-text-primary">
            {node.status.vmIds.length}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

