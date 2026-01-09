import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { ConnectionList } from './components/ConnectionList';
import { ConsoleView } from './components/ConsoleView';
import { Settings } from './components/Settings';

interface ActiveConnection {
  connectionId: string;
  vmId: string;
  vmName: string;
  controlPlaneUrl: string;
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
  const [connectionListKey, setConnectionListKey] = useState(0);
  const [autoConnectError, setAutoConnectError] = useState<string | null>(null);
  const hasCheckedPending = useRef(false);

  // Check for pending connection on startup (from deep link)
  useEffect(() => {
    // Only run once
    if (hasCheckedPending.current) return;
    hasCheckedPending.current = true;

    const checkPendingConnection = async () => {
      console.log('[qvmc] Checking for pending connection...');
      
      try {
        const pending = await invoke<PendingConnection | null>('get_pending_connection');
        
        if (pending) {
          console.log('[qvmc] Found pending connection:', pending);
          setIsAutoConnecting(true);
          setAutoConnectError(null);
          
          try {
            // Save connection to config
            console.log('[qvmc] Saving connection...');
            const savedId = await invoke<string>('add_and_connect', {
              controlPlaneUrl: pending.control_plane_url,
              vmId: pending.vm_id,
              vmName: pending.vm_name,
            });
            console.log('[qvmc] Connection saved with id:', savedId);
            
            // Refresh the connection list
            setConnectionListKey(k => k + 1);
            
            // Start VNC connection
            console.log('[qvmc] Starting VNC connection...');
            const vncConnectionId = await invoke<string>('connect_vnc', {
              controlPlaneUrl: pending.control_plane_url,
              vmId: pending.vm_id,
              password: null,
            });
            
            console.log('[qvmc] VNC connected:', vncConnectionId);
            
            setActiveConnection({
              connectionId: vncConnectionId,
              vmId: pending.vm_id,
              vmName: pending.vm_name,
              controlPlaneUrl: pending.control_plane_url,
            });
            setView('console');
          } catch (err) {
            console.error('[qvmc] Auto-connect failed:', err);
            setAutoConnectError(String(err));
            // Still refresh connection list even on VNC failure - connection was saved
            setConnectionListKey(k => k + 1);
          } finally {
            setIsAutoConnecting(false);
          }
        } else {
          console.log('[qvmc] No pending connection found');
        }
      } catch (err) {
        console.error('[qvmc] Failed to check pending connection:', err);
      }
    };
    
    // Small delay to ensure Tauri backend is ready
    setTimeout(checkPendingConnection, 100);
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
        <p className="mt-2 text-xs text-[var(--text-muted)]">From deep link</p>
      </div>
    );
  }

  // Show error if auto-connect failed but don't block
  if (autoConnectError && view === 'list') {
    // Error will be shown in connection list
  }

  return (
    <div className="h-full w-full flex flex-col bg-[var(--bg-base)]">
      {view === 'list' && (
        <ConnectionList
          key={connectionListKey}
          onConnect={handleConnect}
          onOpenSettings={handleOpenSettings}
        />
      )}

      {view === 'console' && activeConnection && (
        <ConsoleView
          connectionId={activeConnection.connectionId}
          vmId={activeConnection.vmId}
          vmName={activeConnection.vmName}
          controlPlaneUrl={activeConnection.controlPlaneUrl}
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
