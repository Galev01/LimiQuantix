import { RefreshCw, Power, Settings, Activity } from 'lucide-react';
import { Button } from '@/components/ui';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { cn } from '@/lib/utils';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  return (
    <header className="h-16 bg-bg-surface border-b border-border flex items-center justify-between px-6">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">{title}</h1>
        {subtitle && (
          <p className="text-sm text-text-muted">{subtitle}</p>
        )}
      </div>
      
      <div className="flex items-center gap-3">
        {actions}
      </div>
    </header>
  );
}

interface HostHeaderProps {
  hostname: string;
  status: 'online' | 'offline' | 'maintenance';
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function HostHeader({ hostname, status, onRefresh, refreshing }: HostHeaderProps) {
  const statusColors = {
    online: 'bg-success',
    offline: 'bg-error',
    maintenance: 'bg-warning',
  };

  return (
    <header className="h-16 bg-bg-surface border-b border-border flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-2.5 h-2.5 rounded-full', statusColors[status])} />
          <div>
            <h1 className="text-lg font-semibold text-text-primary">{hostname}</h1>
            <p className="text-xs text-text-muted capitalize">{status}</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className="gap-2"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
        
        <div className="w-px h-6 bg-border mx-2" />
        
        <Button variant="ghost" size="sm">
          <Activity className="w-4 h-4" />
        </Button>
        
        <Button variant="ghost" size="sm">
          <Settings className="w-4 h-4" />
        </Button>
        
        <ThemeToggle />
        
        <Button variant="ghost" size="sm" className="text-warning hover:text-warning">
          <Power className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
