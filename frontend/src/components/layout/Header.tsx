import { Bell, Search, User, Plus, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header() {
  return (
    <header className="h-16 bg-bg-surface border-b border-border flex items-center justify-between px-6 shrink-0">
      {/* Left: Breadcrumb / Title */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text-primary whitespace-nowrap">Dashboard</h1>
        <span className="hidden sm:inline text-text-muted/60">•</span>
        <span className="hidden sm:inline text-text-muted text-sm whitespace-nowrap">Overview of your infrastructure</span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search VMs, hosts..."
            className={cn(
              'w-64 pl-9 pr-4 py-2 rounded-lg',
              'bg-bg-base border border-border',
              'text-sm text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
              'transition-all duration-150',
            )}
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-text-muted bg-bg-elevated px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </div>

        {/* Refresh */}
        <button
          className={cn(
            'p-2 rounded-lg',
            'text-text-muted hover:text-text-primary',
            'hover:bg-bg-hover',
            'transition-all duration-150',
          )}
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Create New */}
        <button
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg',
            'bg-accent hover:bg-accent-hover',
            'text-white text-sm font-medium',
            'shadow-floating hover:shadow-elevated',
            'transition-all duration-150',
          )}
        >
          <Plus className="w-4 h-4" />
          <span>New VM</span>
        </button>

        {/* Notifications */}
        <button
          className={cn(
            'relative p-2 rounded-lg',
            'text-text-muted hover:text-text-primary',
            'hover:bg-bg-hover',
            'transition-all duration-150',
          )}
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-error rounded-full" />
        </button>

        {/* User */}
        <button
          className={cn(
            'flex items-center gap-2 p-1.5 rounded-lg',
            'hover:bg-bg-hover',
            'transition-all duration-150',
          )}
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center">
            <User className="w-4 h-4 text-white" />
          </div>
        </button>
      </div>
    </header>
  );
}

