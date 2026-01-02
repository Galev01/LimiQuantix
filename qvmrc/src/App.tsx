import { useState, useCallback } from 'react';
import { ConnectionList } from './components/ConnectionList';
import { ConsoleView } from './components/ConsoleView';
import { Settings } from './components/Settings';

interface ActiveConnection {
  connectionId: string;
  vmId: string;
  vmName: string;
}

function App() {
  const [view, setView] = useState<'list' | 'console' | 'settings'>('list');
  const [activeConnection, setActiveConnection] = useState<ActiveConnection | null>(null);

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
