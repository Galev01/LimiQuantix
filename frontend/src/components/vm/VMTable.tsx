import { motion } from 'framer-motion';
import {
  MoreHorizontal,
  Play,
  Square,
  RefreshCw,
  Trash2,
  MonitorCog,
} from 'lucide-react';
import { cn, formatBytes, formatUptime } from '@/lib/utils';
import { VMStatusBadge } from './VMStatusBadge';
import type { VirtualMachine } from '@/types/models';

interface VMTableProps {
  vms: VirtualMachine[];
  onSelect?: (vm: VirtualMachine) => void;
}

export function VMTable({ vms, onSelect }: VMTableProps) {
  return (
    <div className={cn(
      'bg-bg-surface rounded-xl border border-border',
      'shadow-floating overflow-hidden',
    )}>
      {/* Table Header */}
      <div className="px-5 py-3 border-b border-border bg-bg-elevated/50">
        <div className="grid grid-cols-12 gap-4 text-xs font-medium text-text-muted uppercase tracking-wider">
          <div className="col-span-3">Name</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-2">Host</div>
          <div className="col-span-1">CPU</div>
          <div className="col-span-1">Memory</div>
          <div className="col-span-2">IP Address</div>
          <div className="col-span-1">Uptime</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-border">
        {vms.map((vm, index) => (
          <motion.div
            key={vm.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: index * 0.03 }}
            onClick={() => onSelect?.(vm)}
            className={cn(
              'grid grid-cols-12 gap-4 px-5 py-4 items-center',
              'hover:bg-bg-hover cursor-pointer',
              'transition-colors duration-150',
              'group',
            )}
          >
            {/* Name */}
            <div className="col-span-3 flex items-center gap-3">
              <div className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center',
                'bg-bg-elevated group-hover:bg-accent/10',
                'transition-colors duration-150',
              )}>
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
              <p className="text-sm text-text-secondary truncate">
                {vm.status.nodeId || '—'}
              </p>
            </div>

            {/* CPU */}
            <div className="col-span-1">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      vm.status.resourceUsage.cpuUsagePercent >= 80 ? 'bg-error' :
                      vm.status.resourceUsage.cpuUsagePercent >= 60 ? 'bg-warning' : 'bg-success',
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
              <p className="text-xs text-text-muted">
                / {formatBytes(vm.status.resourceUsage.memoryAllocatedBytes)}
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

            {/* Uptime */}
            <div className="col-span-1">
              <p className="text-sm text-text-secondary">
                {vm.status.guestInfo.uptimeSeconds > 0
                  ? formatUptime(vm.status.guestInfo.uptimeSeconds)
                  : '—'}
              </p>
            </div>

            {/* Actions */}
            <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {vm.status.state === 'RUNNING' ? (
                <button
                  className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-error transition-colors"
                  title="Stop"
                  onClick={(e) => { e.stopPropagation(); }}
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-success transition-colors"
                  title="Start"
                  onClick={(e) => { e.stopPropagation(); }}
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-accent transition-colors"
                title="Restart"
                onClick={(e) => { e.stopPropagation(); }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-text-primary transition-colors"
                title="More"
                onClick={(e) => { e.stopPropagation(); }}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

