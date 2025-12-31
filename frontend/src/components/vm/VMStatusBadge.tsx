import { cn } from '@/lib/utils';
import { Play, Square, Pause, Moon, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import type { PowerState } from '@/data/mock-data';

interface VMStatusBadgeProps {
  status: PowerState;
  size?: 'sm' | 'md';
}

const statusConfig: Record<PowerState, { label: string; icon: React.ElementType; classes: string }> = {
  RUNNING: {
    label: 'Running',
    icon: Play,
    classes: 'bg-success/15 text-success border-success/30',
  },
  STOPPED: {
    label: 'Stopped',
    icon: Square,
    classes: 'bg-text-muted/15 text-text-muted border-text-muted/30',
  },
  PAUSED: {
    label: 'Paused',
    icon: Pause,
    classes: 'bg-warning/15 text-warning border-warning/30',
  },
  SUSPENDED: {
    label: 'Suspended',
    icon: Moon,
    classes: 'bg-info/15 text-info border-info/30',
  },
  MIGRATING: {
    label: 'Migrating',
    icon: ArrowRightLeft,
    classes: 'bg-accent/15 text-accent border-accent/30',
  },
  CRASHED: {
    label: 'Crashed',
    icon: AlertTriangle,
    classes: 'bg-error/15 text-error border-error/30',
  },
};

export function VMStatusBadge({ status, size = 'md' }: VMStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        config.classes,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
      )}
    >
      <Icon className={cn(size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5')} />
      {config.label}
    </span>
  );
}

