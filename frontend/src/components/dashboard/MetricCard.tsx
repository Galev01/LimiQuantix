import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  trend?: {
    value: number;
    label: string;
  };
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple';
  delay?: number;
}

const colorStyles = {
  blue: {
    icon: 'bg-accent/15 text-accent',
    glow: 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
  },
  green: {
    icon: 'bg-success/15 text-success',
    glow: 'shadow-[0_0_20px_rgba(34,197,94,0.15)]',
  },
  yellow: {
    icon: 'bg-warning/15 text-warning',
    glow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
  },
  red: {
    icon: 'bg-error/15 text-error',
    glow: 'shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  },
  purple: {
    icon: 'bg-purple-500/15 text-purple-400',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.15)]',
  },
};

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  color = 'blue',
  delay = 0,
}: MetricCardProps) {
  const styles = colorStyles[color];

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
        'group',
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-text-muted text-sm font-medium">{title}</p>
          <p className="text-3xl font-bold text-text-primary mt-2 tracking-tight">
            {value}
          </p>
          {subtitle && (
            <p className="text-text-muted text-sm mt-1">{subtitle}</p>
          )}
          {trend && (
            <div className="flex items-center gap-1.5 mt-3">
              <span
                className={cn(
                  'text-xs font-medium px-1.5 py-0.5 rounded',
                  trend.value >= 0
                    ? 'bg-success/15 text-success'
                    : 'bg-error/15 text-error',
                )}
              >
                {trend.value >= 0 ? '+' : ''}{trend.value}%
              </span>
              <span className="text-text-muted text-xs">{trend.label}</span>
            </div>
          )}
        </div>
        <div
          className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center',
            'transition-all duration-200',
            styles.icon,
            'group-hover:scale-110',
          )}
        >
          {icon}
        </div>
      </div>
    </motion.div>
  );
}

