import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { ConnectionList } from './components/ConnectionList';
import { ConsoleView } from './components/ConsoleView';
import { Settings } from './components/Settings';

interface ActiveConnection {
  connectionId: string;
  vmId: string;
  vmName: string;
}

interface PendingConnection {
  control_plane_url: string;
  vm_id: string;
  vm_name: string;
}

function App() {
  const [view, setView] = useState<'list' | 'console' | 'settings'>('list');
  const [activeConnection, setActiveConnection] = useState<ActiveConnection | null>(null);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);

  // Check for pending connection on startup (from deep link)
  useEffect(() => {
    const checkPendingConnection = async () => {
      try {
        const pending = await invoke<PendingConnection | null>('get_pending_connection');
        
        if (pending) {
          console.log('Auto-connecting from deep link:', pending);
          setIsAutoConnecting(true);
          
          // Save connection to config
          await invoke<string>('add_and_connect', {
            controlPlaneUrl: pending.control_plane_url,
            vmId: pending.vm_id,
            vmName: pending.vm_name,
          });
          
          // Start VNC connection
          const vncConnectionId = await invoke<string>('connect_vnc', {
            controlPlaneUrl: pending.control_plane_url,
            vmId: pending.vm_id,
            password: null,
          });
          
          setActiveConnection({
            connectionId: vncConnectionId,
            vmId: pending.vm_id,
            vmName: pending.vm_name,
          });
          setView('console');
          setIsAutoConnecting(false);
        }
      } catch (err) {
        console.error('Auto-connect failed:', err);
        setIsAutoConnecting(false);
      }
    };
    
    checkPendingConnection();
  }, []);

  const handleConnect = useCallback((connection: ActiveConnection) => {
    setActiveConnection(connection);
    setView('console');
  }, []);

  const handleDisconnect = useCallback(() => {
    setActiveConnection(null);
    setView('list');
  }, []);

  const handleOpenSettings = useCallback(() => {
    setView('settings');
  }, []);

  const handleCloseSettings = useCallback(() => {
    setView('list');
  }, []);

  // Show loading screen while auto-connecting
  if (isAutoConnecting) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--bg-base)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--accent)]"></div>
        <p className="mt-4 text-[var(--text-muted)]">Connecting to VM...</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-[var(--bg-base)]">
      {view === 'list' && (
        <ConnectionList
          onConnect={handleConnect}
          onOpenSettings={handleOpenSettings}
        />
      )}

      {view === 'console' && activeConnection && (
        <ConsoleView
          connectionId={activeConnection.connectionId}
          vmId={activeConnection.vmId}
          vmName={activeConnection.vmName}
          onDisconnect={handleDisconnect}
        />
      )}

      {view === 'settings' && (
        <Settings onClose={handleCloseSettings} />
      )}
    </div>
  );
}

export default App;
