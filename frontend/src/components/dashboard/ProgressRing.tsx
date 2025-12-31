import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ProgressRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: 'blue' | 'green' | 'yellow' | 'red';
  label?: string;
  sublabel?: string;
}

const colorClasses = {
  blue: 'stroke-accent',
  green: 'stroke-success',
  yellow: 'stroke-warning',
  red: 'stroke-error',
};

export function ProgressRing({
  value,
  size = 120,
  strokeWidth = 8,
  color = 'blue',
  label,
  sublabel,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  // Determine color based on value if not specified
  const dynamicColor = value >= 90 ? 'red' : value >= 70 ? 'yellow' : color;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-bg-hover"
        />
        {/* Progress circle */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className={cn(colorClasses[dynamicColor])}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{
            strokeDasharray: circumference,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-text-primary">{value}%</span>
        {label && <span className="text-xs text-text-muted mt-0.5">{label}</span>}
        {sublabel && <span className="text-[10px] text-text-muted">{sublabel}</span>}
      </div>
    </div>
  );
}

