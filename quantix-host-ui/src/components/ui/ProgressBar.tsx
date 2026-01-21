import { cn } from '@/lib/utils';

export interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  value: number;
  /** Color variant */
  color?: 'accent' | 'success' | 'warning' | 'error' | 'info';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show percentage label */
  showLabel?: boolean;
  /** Label position */
  labelPosition?: 'right' | 'inside' | 'above';
  /** Enable pulse animation for indeterminate state */
  indeterminate?: boolean;
  /** Enable striped animation */
  animated?: boolean;
  /** Additional class names */
  className?: string;
  /** Custom label text (overrides percentage) */
  label?: string;
}

const colorClasses = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
};

const sizeClasses = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

const labelSizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

export function ProgressBar({
  value,
  color = 'accent',
  size = 'md',
  showLabel = false,
  labelPosition = 'right',
  indeterminate = false,
  animated = false,
  className,
  label,
}: ProgressBarProps) {
  // Clamp value between 0 and 100
  const clampedValue = Math.min(100, Math.max(0, value));
  const displayLabel = label ?? `${Math.round(clampedValue)}%`;

  return (
    <div className={cn('w-full', className)}>
      {/* Label above */}
      {showLabel && labelPosition === 'above' && (
        <div className="flex justify-between mb-1">
          <span className={cn('text-text-muted', labelSizeClasses[size])}>
            Progress
          </span>
          <span className={cn('font-medium text-text-primary', labelSizeClasses[size])}>
            {displayLabel}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Progress bar container */}
        <div
          className={cn(
            'flex-1 bg-bg-hover rounded-full overflow-hidden',
            sizeClasses[size]
          )}
          role="progressbar"
          aria-valuenow={indeterminate ? undefined : clampedValue}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {indeterminate ? (
            /* Indeterminate animation */
            <div
              className={cn(
                'h-full rounded-full',
                colorClasses[color],
                'animate-progress-indeterminate'
              )}
              style={{ width: '40%' }}
            />
          ) : (
            /* Determinate progress */
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300 ease-out',
                colorClasses[color],
                animated && 'animate-progress-stripes bg-gradient-to-r from-transparent via-white/20 to-transparent bg-[length:20px_100%]'
              )}
              style={{ width: `${clampedValue}%` }}
            />
          )}
        </div>

        {/* Label right */}
        {showLabel && labelPosition === 'right' && !indeterminate && (
          <span className={cn('font-medium text-text-primary min-w-[3rem] text-right', labelSizeClasses[size])}>
            {displayLabel}
          </span>
        )}
      </div>

      {/* Label inside (only for lg size) */}
      {showLabel && labelPosition === 'inside' && size === 'lg' && !indeterminate && (
        <div className="relative -mt-4">
          <span
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-bold text-white drop-shadow-sm"
          >
            {displayLabel}
          </span>
        </div>
      )}
    </div>
  );
}
