import { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { getConsoleInfo } from './lib/tauri-api';
import { VMSidebar, SavedConnection } from './components/VMSidebar';
import { ConsoleTabs, TabConnection } from './components/ConsoleTabs';
import { ConsoleTabPane } from './components/ConsoleTabPane';
import { Settings } from './components/Settings';
import { DebugPanel } from './components/DebugPanel';
import { Monitor } from 'lucide-react';

interface PendingConnection {
  control_plane_url: string;
  vm_id: string;
  vm_name: string;
}

function App() {
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Tab state
  const [tabs, setTabs] = useState<TabConnection[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Loading states
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [connectingVmId, setConnectingVmId] = useState<string | null>(null);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Deep link check
  const hasCheckedPending = useRef(false);

  // Check for pending connection on startup (from deep link)
  useEffect(() => {
    if (hasCheckedPending.current) return;
    hasCheckedPending.current = true;

    const checkPendingConnection = async () => {
      console.log('[QvMC] Checking for pending connection...');

      try {
        const pending = await invoke<PendingConnection | null>('get_pending_connection');

        if (pending) {
          console.log('[QvMC] Found pending connection:', pending);
          setIsAutoConnecting(true);

          try {
            // Save connection to config
            console.log('[QvMC] Saving connection...');
            await invoke<string>('add_and_connect', {
              controlPlaneUrl: pending.control_plane_url,
              vmId: pending.vm_id,
              vmName: pending.vm_name,
            });

            // Fetch console info (including password)
            console.log('[QvMC] Fetching console info...');
            const consoleInfo = await getConsoleInfo(pending.control_plane_url, pending.vm_id);

            // Start VNC connection
            console.log('[QvMC] Starting VNC connection...');
            const vncConnectionId = await invoke<string>('connect_vnc', {
              controlPlaneUrl: pending.control_plane_url,
              vmId: pending.vm_id,
              password: consoleInfo.password || null,
            });

            console.log('[QvMC] VNC connected:', vncConnectionId);

            // Create new tab
            const newTab: TabConnection = {
              id: crypto.randomUUID(),
              connectionId: vncConnectionId,
              vmId: pending.vm_id,
              vmName: pending.vm_name,
              controlPlaneUrl: pending.control_plane_url,
              status: 'connecting',
            };

            setTabs([newTab]);
            setActiveTabId(newTab.id);
          } catch (err) {
            console.error('[QvMC] Auto-connect failed:', err);
          } finally {
            setIsAutoConnecting(false);
          }
        } else {
          console.log('[QvMC] No pending connection found');
        }
      } catch (err) {
        console.error('[QvMC] Failed to check pending connection:', err);
      }
    };

    setTimeout(checkPendingConnection, 100);
  }, []);

  // Handle selecting a VM from sidebar
  const handleSelectVM = useCallback(async (connection: SavedConnection) => {
    // Check if this VM already has an open tab
    const existingTab = tabs.find(t => t.vmId === connection.vm_id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    // Start connecting
    setConnectingVmId(connection.vm_id);

    try {
      // Fetch console info (including password)
      const consoleInfo = await getConsoleInfo(connection.control_plane_url, connection.vm_id);

      const vncConnectionId = await invoke<string>('connect_vnc', {
        controlPlaneUrl: connection.control_plane_url,
        vmId: connection.vm_id,
        password: consoleInfo.password || null,
      });

      // Create new tab
      const newTab: TabConnection = {
        id: crypto.randomUUID(),
        connectionId: vncConnectionId,
        vmId: connection.vm_id,
        vmName: connection.name,
        controlPlaneUrl: connection.control_plane_url,
        status: 'connecting',
      };

      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTab.id);
    } catch (err) {
      console.error('Connection failed:', err);
    } finally {
      setConnectingVmId(null);
    }
  }, [tabs]);

  // Handle tab selection
  const handleSelectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  // Handle closing a tab
  const handleCloseTab = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      try {
        await invoke('disconnect_vnc', { connectionId: tab.connectionId });
      } catch (err) {
        console.error('Disconnect error:', err);
      }
    }

    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);

      // If we closed the active tab, switch to another
      if (activeTabId === tabId && newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      } else if (newTabs.length === 0) {
        setActiveTabId(null);
      }

      return newTabs;
    });
  }, [tabs, activeTabId]);

  // Handle add tab button (opens sidebar if collapsed)
  const handleAddTab = useCallback(() => {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
  }, [sidebarCollapsed]);

  // Handle tab status change
  const handleTabStatusChange = useCallback((tabId: string, status: 'connecting' | 'connected' | 'disconnected') => {
    setTabs(prev => prev.map(t =>
      t.id === tabId ? { ...t, status } : t
    ));
  }, []);

  // Get active VM IDs for sidebar highlighting
  const activeVmIds = tabs.map(t => t.vmId);

  // Show loading screen while auto-connecting from deep link
  if (isAutoConnecting) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--bg-base)]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[var(--accent)]"></div>
        <p className="mt-4 text-[var(--text-muted)]">Connecting to VM...</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">From deep link</p>
      </div>
    );
  }

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sidebar */}
      <VMSidebar
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        onSelectVM={handleSelectVM}
        onOpenSettings={() => setShowSettings(true)}
        activeVmIds={activeVmIds}
        connectingVmId={connectingVmId}
      />

      {/* Main content area */}
      <div className="app-main">
        {/* Tab bar (only shown when tabs exist) */}
        {tabs.length > 0 && (
          <ConsoleTabs
            tabs={tabs}
            activeTabId={activeTabId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onAddTab={handleAddTab}
          />
        )}

        {/* Console panes */}
        <div className="app-console-area">
          {tabs.length === 0 ? (
            // Empty state
            <div className="app-empty-state">
              <div className="app-empty-icon">
                <Monitor className="w-12 h-12" />
              </div>
              <h2 className="app-empty-title">No Active Consoles</h2>
              <p className="app-empty-description">
                Select a VM from the sidebar to open a console session
              </p>
            </div>
          ) : (
            // Render all tab panes (only active one is visible)
            tabs.map(tab => (
              <ConsoleTabPane
                key={tab.id}
                connectionId={tab.connectionId}
                vmId={tab.vmId}
                vmName={tab.vmName}
                controlPlaneUrl={tab.controlPlaneUrl}
                isActive={tab.id === activeTabId}
                onStatusChange={(status) => handleTabStatusChange(tab.id, status)}
              />
            ))
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <Settings
              onClose={() => setShowSettings(false)}
              onOpenDebugLogs={() => {
                setShowSettings(false);
                setShowDebugPanel(true);
              }}
            />
          </div>
        </div>
      )}

      {/* Global Debug Panel */}
      <DebugPanel isOpen={showDebugPanel} onClose={() => setShowDebugPanel(false)} />
    </div>
  );
}

export default App;
