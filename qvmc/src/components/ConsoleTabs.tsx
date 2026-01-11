import { X, Plus, Monitor, Loader2 } from 'lucide-react';

export interface TabConnection {
  id: string;
  connectionId: string;
  vmId: string;
  vmName: string;
  controlPlaneUrl: string;
  status: 'connecting' | 'connected' | 'disconnected';
}

interface ConsoleTabsProps {
  tabs: TabConnection[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
}

export function ConsoleTabs({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
}: ConsoleTabsProps) {
  return (
    <div className="console-tabs">
      <div className="console-tabs-list">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`console-tab ${activeTabId === tab.id ? 'active' : ''} ${tab.status}`}
            onClick={() => onSelectTab(tab.id)}
          >
            <div className="console-tab-icon">
              {tab.status === 'connecting' ? (
                <Loader2 className="w-3.5 h-3.5 spinner" />
              ) : (
                <Monitor className="w-3.5 h-3.5" />
              )}
            </div>
            <span className="console-tab-name">{tab.vmName}</span>
            
            {/* Status indicator */}
            <div className={`console-tab-status ${tab.status}`} />
            
            {/* Close button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="console-tab-close"
              title="Close tab"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Add tab button */}
      <button onClick={onAddTab} className="console-tabs-add" title="Open new console">
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
