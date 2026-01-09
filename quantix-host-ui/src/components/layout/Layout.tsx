import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { CreateVMWizard } from '@/components/vm/CreateVMWizard';
import { useAppStore } from '@/stores/useAppStore';
import { Server, Unplug } from 'lucide-react';
import { setNodeConnection } from '@/api/client';

interface LayoutProps {
  connectionInfo?: {
    url: string;
    name?: string;
  } | null;
}

export function Layout({ connectionInfo }: LayoutProps) {
  const { vmWizardOpen, closeVmWizard } = useAppStore();

  const handleDisconnect = () => {
    if (confirm('Disconnect from this node? You will need to reconnect to manage it.')) {
      setNodeConnection(null);
      window.location.reload();
    }
  };

  return (
    <div className="flex h-screen bg-bg-base">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Remote Connection Banner */}
        {connectionInfo && (
          <div className="bg-accent/10 border-b border-accent/20 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Server className="w-4 h-4 text-accent" />
              <span className="text-text-secondary">Connected to:</span>
              <span className="font-medium text-text-primary">
                {connectionInfo.name || 'Remote Node'}
              </span>
              <span className="text-text-muted font-mono text-xs">
                ({connectionInfo.url})
              </span>
            </div>
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-error transition-colors"
            >
              <Unplug className="w-3 h-3" />
              Disconnect
            </button>
          </div>
        )}
        
        <Outlet />
      </main>

      {/* VM Creation Wizard */}
      <CreateVMWizard isOpen={vmWizardOpen} onClose={closeVmWizard} />
    </div>
  );
}
