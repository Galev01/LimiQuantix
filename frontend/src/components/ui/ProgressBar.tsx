/**
 * ProgressBar Component
 * 
 * A simple animated progress bar for displaying update progress.
 */

import { cn } from '@/lib/utils';

interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  value: number;
  /** Optional label to display above the progress bar */
  label?: string;
  /** Whether to show the percentage text */
  showPercentage?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  variant?: 'default' | 'success' | 'error';
  /** Additional CSS classes */
  className?: string;
}

export function ProgressBar({
  value,
  label,
  showPercentage = true,
  size = 'md',
  variant = 'default',
  className,
}: ProgressBarProps) {
  // Clamp value between 0 and 100
  const clampedValue = Math.min(100, Math.max(0, value));

  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  const variantClasses = {
    default: 'bg-accent',
    success: 'bg-success',
    error: 'bg-error',
  };

  return (
    <div className={cn('w-full', className)}>
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-1.5">
          {label && (
            <span className="text-sm text-text-secondary truncate mr-2">
              {label}
            </span>
          )}
          {showPercentage && (
            <span className="text-sm font-medium text-text-primary tabular-nums">
              {Math.round(clampedValue)}%
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'w-full rounded-full bg-bg-base overflow-hidden',
          'shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)]',
          sizeClasses[size]
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out',
            variantClasses[variant],
            // Add subtle gradient and glow effect
            'bg-gradient-to-r from-accent/90 to-accent',
            'shadow-[0_0_8px_rgba(var(--accent-rgb),0.4)]'
          )}
          style={{ width: `${clampedValue}%` }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
