import { cn } from '@/lib/utils';

interface ToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  description?: string;
  className?: string;
}

const sizeClasses = {
  sm: {
    track: 'w-9 h-5',
    knob: 'w-4 h-4 top-0.5 left-0.5',
    translate: 'translate-x-4',
  },
  md: {
    track: 'w-12 h-6',
    knob: 'w-5 h-5 top-0.5 left-0.5',
    translate: 'translate-x-6',
  },
  lg: {
    track: 'w-14 h-7',
    knob: 'w-6 h-6 top-0.5 left-0.5',
    translate: 'translate-x-7',
  },
};

export function Toggle({
  enabled,
  onChange,
  disabled = false,
  size = 'md',
  label,
  description,
  className,
}: ToggleProps) {
  const sizeClass = sizeClasses[size];

  const handleClick = () => {
    if (!disabled) {
      onChange(!enabled);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
        sizeClass.track,
        enabled
          ? 'bg-success'
          : 'bg-bg-base border border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out',
          sizeClass.knob,
          enabled && sizeClass.translate
        )}
      />
    </button>
  );

  if (label || description) {
    return (
      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <div className="flex flex-col">
          {label && (
            <span className={cn(
              'text-sm font-medium',
              disabled ? 'text-text-muted' : 'text-text-primary'
            )}>
              {label}
            </span>
          )}
          {description && (
            <span className="text-xs text-text-muted">{description}</span>
          )}
        </div>
        {toggle}
      </label>
    );
  }

  return toggle;
}

// Standalone toggle for inline use without label wrapper
export function ToggleSwitch({
  enabled,
  onChange,
  disabled = false,
  size = 'md',
  className,
}: Omit<ToggleProps, 'label' | 'description'>) {
  const sizeClass = sizeClasses[size];

  const handleClick = () => {
    if (!disabled) {
      onChange(!enabled);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface',
        sizeClass.track,
        enabled
          ? 'bg-success'
          : 'bg-bg-base border border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none absolute rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out',
          sizeClass.knob,
          enabled && sizeClass.translate
        )}
      />
    </button>
  );
}
