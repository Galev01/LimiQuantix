import { motion } from 'framer-motion';
import { cn, formatBytes } from '@/lib/utils';
import { ProgressRing } from './ProgressRing';

interface ResourceCardProps {
  title: string;
  used: number;
  total: number;
  unit?: 'bytes' | 'count' | 'percent';
  color?: 'blue' | 'green' | 'yellow' | 'red';
  delay?: number;
}

export function ResourceCard({
  title,
  used,
  total,
  unit = 'bytes',
  color = 'blue',
  delay = 0,
}: ResourceCardProps) {
  const percentage = total > 0 ? Math.round((used / total) * 100) : 0;

  const formatValue = (value: number) => {
    if (unit === 'bytes') return formatBytes(value);
    if (unit === 'count') return value.toString();
    return `${value}%`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className={cn(
        'bg-bg-surface rounded-xl p-5',
        'border border-border',
        'shadow-floating',
        'flex items-center gap-6',
      )}
    >
      <ProgressRing value={percentage} color={color} />
      <div className="flex-1">
        <h3 className="text-text-primary font-semibold">{title}</h3>
        <div className="mt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Used</span>
            <span className="text-text-primary font-medium">{formatValue(used)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Total</span>
            <span className="text-text-primary font-medium">{formatValue(total)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Available</span>
            <span className="text-success font-medium">{formatValue(total - used)}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

