import { cn } from '@/lib/utils';
import { Play, Square, Pause, Moon, ArrowRightLeft, AlertTriangle, Loader2, PowerOff, XCircle } from 'lucide-react';
import type { PowerState } from '@/types/models';

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
  ERROR: {
    label: 'Error',
    icon: XCircle,
    classes: 'bg-error/15 text-error border-error/30',
  },
  STARTING: {
    label: 'Starting',
    icon: Loader2,
    classes: 'bg-accent/15 text-accent border-accent/30',
  },
  STOPPING: {
    label: 'Stopping',
    icon: PowerOff,
    classes: 'bg-warning/15 text-warning border-warning/30',
  },
};

// Fallback config for unknown/undefined status values
const unknownConfig = {
  label: 'Unknown',
  icon: AlertTriangle,
  classes: 'bg-text-muted/15 text-text-muted border-text-muted/30',
};

export function VMStatusBadge({ status, size = 'md' }: VMStatusBadgeProps) {
  const config = statusConfig[status] ?? unknownConfig;
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

