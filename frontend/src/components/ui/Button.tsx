import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
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
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

