import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { logClick, type UIComponent } from '@/lib/uiLogger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** Enable logging for this button */
  logAction?: boolean;
  /** Component category for logging (required if logAction is true) */
  logComponent?: UIComponent;
  /** Target identifier for logging (defaults to button id or 'button') */
  logTarget?: string;
  /** Additional metadata to include in the log */
  logMetadata?: Record<string, unknown>;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ 
    className, 
    variant = 'primary', 
    size = 'md', 
    loading, 
    disabled, 
    children, 
    onClick,
    logAction,
    logComponent,
    logTarget,
    logMetadata,
    id,
    ...props 
  }, ref) => {
    const handleClick = useCallback((e: MouseEvent<HTMLButtonElement>) => {
      // Log the click if logging is enabled
      if (logAction && logComponent) {
        const target = logTarget || id || 'button';
        logClick(logComponent, target, logMetadata);
      }
      // Call the original onClick handler
      onClick?.(e);
    }, [onClick, logAction, logComponent, logTarget, logMetadata, id]);

    return (
      <button
        ref={ref}
        id={id}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-medium rounded-lg',
          'transition-all duration-150',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          // Variants
          variant === 'primary' && [
            'bg-accent hover:bg-accent-hover text-white',
            'shadow-floating hover:shadow-elevated',
          ],
          variant === 'secondary' && [
            'bg-bg-elevated hover:bg-bg-hover text-text-primary',
            'border border-border hover:border-border-hover',
          ],
          variant === 'ghost' && [
            'bg-transparent hover:bg-bg-hover text-text-secondary hover:text-text-primary',
          ],
          variant === 'danger' && [
            'bg-error hover:bg-red-600 text-white',
            'shadow-floating hover:shadow-elevated',
          ],
          // Sizes
          size === 'sm' && 'px-3 py-1.5 text-xs',
          size === 'md' && 'px-4 py-2 text-sm',
          size === 'lg' && 'px-6 py-3 text-base',
          className,
        )}
        onClick={handleClick}
        {...props}
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

/**
 * LoggedButton - A button that automatically logs clicks
 * 
 * This is a convenience wrapper around Button that requires logging props.
 * Use this when you want to ensure logging is always enabled for a button.
 * 
 * @example
 * ```tsx
 * <LoggedButton
 *   component="vm"
 *   target="start-vm"
 *   metadata={{ vmId: 'vm-123' }}
 *   onClick={handleStart}
 * >
 *   Start VM
 * </LoggedButton>
 * ```
 */
export interface LoggedButtonProps extends Omit<ButtonProps, 'logAction' | 'logComponent' | 'logTarget' | 'logMetadata'> {
  /** Component category for logging (required) */
  component: UIComponent;
  /** Target identifier for logging (required) */
  target: string;
  /** Additional metadata to include in the log */
  metadata?: Record<string, unknown>;
}

export const LoggedButton = forwardRef<HTMLButtonElement, LoggedButtonProps>(
  ({ component, target, metadata, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        logAction
        logComponent={component}
        logTarget={target}
        logMetadata={metadata}
        {...props}
      />
    );
  }
);

LoggedButton.displayName = 'LoggedButton';
