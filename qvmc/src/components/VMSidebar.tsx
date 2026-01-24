import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Portal } from './Portal';
import {
  Monitor,
  Plus,
  Settings,
  Trash2,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  Play,
  Square,
  Power,
  RotateCcw,
  Disc,
  X,
  Upload,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

export interface SavedConnection {
  id: string;
  name: string;
  control_plane_url: string;
  vm_id: string;
  last_connected?: string;
  thumbnail?: string;
}

interface VMSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectVM: (connection: SavedConnection) => void;
  onOpenSettings: () => void;
  activeVmIds: string[]; // VMs with open tabs
  connectingVmId: string | null;
}

type VMAction = 'start' | 'stop' | 'reboot' | 'shutdown';

export function VMSidebar({
  isCollapsed,
  onToggleCollapse,
  onSelectVM,
  onOpenSettings,
  activeVmIds,
  connectingVmId,
}: VMSidebarProps) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [_error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [executingAction, setExecutingAction] = useState<{ id: string; action: VMAction } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showISODialog, setShowISODialog] = useState<SavedConnection | null>(null);
  const [isoPath, setIsoPath] = useState('');

  // New connection form state
  const [newName, setNewName] = useState('');
  const [newControlPlane, setNewControlPlane] = useState('http://localhost:8080');
  const [newVmId, setNewVmId] = useState('');

  useEffect(() => {
    loadConnections();
  }, []);

  // Close action menu when clicking outside
  useEffect(() => {
    const handleClick = () => {
      setActionMenuId(null);
      setMenuPosition(null);
    };
    if (actionMenuId) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [actionMenuId]);

  // Handle window resize to close menu
  useEffect(() => {
    const handleResize = () => {
      setActionMenuId(null);
      setMenuPosition(null);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const result = await invoke<{ connections: SavedConnection[] }>('get_saved_connections');
      setConnections(result.connections || []);
    } catch (err) {
      console.error('Failed to load connections:', err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Filter connections based on search query
  const filteredConnections = useMemo(() => {
    if (!searchQuery.trim()) return connections;
    const query = searchQuery.toLowerCase();
    return connections.filter(
      (conn) =>
        conn.name.toLowerCase().includes(query) ||
        conn.control_plane_url.toLowerCase().includes(query) ||
        conn.vm_id.toLowerCase().includes(query)
    );
  }, [connections, searchQuery]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this connection?')) return;

    try {
      await invoke('delete_connection', { id });
      setConnections(connections.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleVMAction = async (e: React.MouseEvent, connection: SavedConnection, action: VMAction) => {
    e.stopPropagation();
    setActionMenuId(null);
    setMenuPosition(null);
    setExecutingAction({ id: connection.id, action });
    setError(null);

    try {
      await invoke('vm_power_action', {
        controlPlaneUrl: connection.control_plane_url,
        vmId: connection.vm_id,
        action,
      });
    } catch (err) {
      console.error(`VM ${action} failed:`, err);
      setError(`Failed to ${action} VM: ${err}`);
    } finally {
      setExecutingAction(null);
    }
  };

  const handleAddConnection = async () => {
    if (!newName || !newControlPlane || !newVmId) return;

    const connection: SavedConnection = {
      id: crypto.randomUUID(),
      name: newName,
      control_plane_url: newControlPlane,
      vm_id: newVmId,
    };

    try {
      await invoke('save_connection', { connection });
      setConnections([...connections, connection]);
      setShowAddDialog(false);
      setNewName('');
      setNewVmId('');
    } catch (err) {
      console.error('Failed to save:', err);
    }
  };

  const handleMountISO = async (connection: SavedConnection) => {
    if (!isoPath.trim()) return;

    setError(null);
    try {
      await invoke('vm_mount_iso', {
        controlPlaneUrl: connection.control_plane_url,
        vmId: connection.vm_id,
        isoPath: isoPath.trim(),
      });
      setShowISODialog(null);
      setIsoPath('');
    } catch (err) {
      console.error('Mount ISO failed:', err);
      setError(`Failed to mount ISO: ${err}`);
    }
  };

  const handleBrowseISO = async () => {
    try {
      const selected = await invoke<string | null>('browse_file', {
        title: 'Select ISO File',
        filters: [{ name: 'ISO Images', extensions: ['iso'] }],
      });
      if (selected) {
        setIsoPath(selected);
      }
    } catch (err) {
      console.error('Browse failed:', err);
    }
  };

  const toggleActionMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    if (actionMenuId === id) {
      setActionMenuId(null);
      setMenuPosition(null);
    } else {
      const button = e.currentTarget as HTMLElement;
      const rect = button.getBoundingClientRect();

      // Calculate position (aligned to right of button, slightly offset)
      setMenuPosition({
        top: rect.bottom + 5,
        left: rect.left,
      });
      setActionMenuId(id);
    }
  };

  return (
    <>
      <aside className={`vm-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
        {/* Sidebar Header */}
        <div className="vm-sidebar-header">
          {!isCollapsed && (
            <div className="vm-sidebar-brand">
              <div className="vm-sidebar-logo">
                <Monitor className="w-5 h-5" />
              </div>
              <span className="vm-sidebar-title">QvMC</span>
            </div>
          )}
          <button
            onClick={onToggleCollapse}
            className="vm-sidebar-toggle"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Search (only when expanded) */}
        {!isCollapsed && (
          <div className="vm-sidebar-search">
            <Search className="vm-sidebar-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search VMs..."
              className="vm-sidebar-search-input"
            />
          </div>
        )}

        {/* VM List */}
        <div className="vm-sidebar-list">
          {loading && (
            <div className="vm-sidebar-loading">
              <Loader2 className="w-5 h-5 spinner" />
            </div>
          )}

          {!loading && filteredConnections.length === 0 && !isCollapsed && (
            <div className="vm-sidebar-empty">
              <p>No VMs found</p>
            </div>
          )}

          {!loading &&
            filteredConnections.map((connection) => {
              const isActive = activeVmIds.includes(connection.vm_id);
              const isConnecting = connectingVmId === connection.vm_id;
              const isExecuting = executingAction?.id === connection.id;

              return (
                <div
                  key={connection.id}
                  className={`vm-sidebar-item ${isActive ? 'active' : ''} ${isConnecting ? 'connecting' : ''}`}
                  onClick={() => onSelectVM(connection)}
                  title={isCollapsed ? connection.name : undefined}
                >
                  <div className="vm-sidebar-item-icon">
                    {isConnecting || isExecuting ? (
                      <Loader2 className="w-4 h-4 spinner" />
                    ) : (
                      <Monitor className="w-4 h-4" />
                    )}
                  </div>

                  {!isCollapsed && (
                    <>
                      <div className="vm-sidebar-item-info">
                        <span className="vm-sidebar-item-name">{connection.name}</span>
                        <span className="vm-sidebar-item-id">{connection.vm_id.slice(0, 8)}...</span>
                      </div>

                      {/* Status indicator */}
                      <div className={`vm-sidebar-item-status ${isActive ? 'active' : ''}`} />

                      {/* Action menu button */}
                      <div className="relative">
                        <button
                          onClick={(e) => toggleActionMenu(e, connection.id)}
                          className="vm-sidebar-item-menu"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>

                        {/* Dropdown Menu via Portal */}
                        {actionMenuId === connection.id && menuPosition && (
                          <Portal>
                            <div
                              className="dropdown-menu vm-sidebar-dropdown"
                              style={{
                                position: 'fixed',
                                top: menuPosition.top,
                                left: menuPosition.left,
                                width: '200px',
                                // ensure it's on top of everything
                                zIndex: 9999,
                                margin: 0 // clear sidebar margin overrides
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="dropdown-section-title">Power</div>
                              <button
                                className="dropdown-item"
                                onClick={(e) => handleVMAction(e, connection, 'start')}
                              >
                                <Play className="text-green-400" />
                                <span>Start</span>
                              </button>
                              <button
                                className="dropdown-item"
                                onClick={(e) => handleVMAction(e, connection, 'shutdown')}
                              >
                                <Power className="text-yellow-400" />
                                <span>Shutdown</span>
                              </button>
                              <button
                                className="dropdown-item"
                                onClick={(e) => handleVMAction(e, connection, 'reboot')}
                              >
                                <RotateCcw className="text-blue-400" />
                                <span>Reboot</span>
                              </button>
                              <button
                                className="dropdown-item"
                                onClick={(e) => handleVMAction(e, connection, 'stop')}
                              >
                                <Square className="text-red-400" />
                                <span>Force Stop</span>
                              </button>
                              <div className="dropdown-divider" />
                              <button
                                className="dropdown-item"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActionMenuId(null);
                                  setMenuPosition(null);
                                  setShowISODialog(connection);
                                }}
                              >
                                <Disc className="text-purple-400" />
                                <span>Mount ISO</span>
                              </button>
                              <div className="dropdown-divider" />
                              <button
                                className="dropdown-item text-red-400"
                                onClick={(e) => handleDelete(e, connection.id)}
                              >
                                <Trash2 />
                                <span>Delete</span>
                              </button>
                            </div>
                          </Portal>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
        </div>

        {/* Bottom Actions */}
        <div className="vm-sidebar-footer">
          <button
            onClick={() => setShowAddDialog(true)}
            className="vm-sidebar-action"
            title="Add VM"
          >
            <Plus className="w-4 h-4" />
            {!isCollapsed && <span>Add VM</span>}
          </button>

          <div className="vm-sidebar-footer-row">
            <ThemeToggle />
            <button onClick={onOpenSettings} className="vm-sidebar-icon-btn" title="Settings">
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Add Connection Modal */}
      {showAddDialog && (
        <div className="modal-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-4">
                <div className="modal-header-icon">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="modal-title">New Connection</h2>
                  <p className="modal-subtitle">Add a VM to your console list</p>
                </div>
              </div>
              <button onClick={() => setShowAddDialog(false)} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="label">Connection Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Production Server"
                  className="input"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="label">Control Plane URL</label>
                <input
                  type="text"
                  value={newControlPlane}
                  onChange={(e) => setNewControlPlane(e.target.value)}
                  placeholder="http://localhost:8080"
                  className="input"
                />
              </div>

              <div className="form-group">
                <label className="label">Virtual Machine ID</label>
                <input
                  type="text"
                  value={newVmId}
                  onChange={(e) => setNewVmId(e.target.value)}
                  placeholder="abc123-def456-..."
                  className="input font-mono text-sm"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowAddDialog(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={handleAddConnection}
                disabled={!newName || !newControlPlane || !newVmId}
                className="btn btn-primary flex-1"
              >
                <Plus className="w-4 h-4" />
                Add Connection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mount ISO Modal */}
      {showISODialog && (
        <div className="modal-overlay" onClick={() => setShowISODialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-4">
                <div className="modal-header-icon">
                  <Disc className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="modal-title">Mount ISO</h2>
                  <p className="modal-subtitle">Attach a virtual disc to {showISODialog.name}</p>
                </div>
              </div>
              <button onClick={() => setShowISODialog(null)} className="icon-btn">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="label">ISO Path (on hypervisor)</label>
                <div className="file-input-group">
                  <input
                    type="text"
                    value={isoPath}
                    onChange={(e) => setIsoPath(e.target.value)}
                    placeholder="/var/lib/libvirt/images/ubuntu.iso"
                    className="input font-mono text-sm"
                    autoFocus
                  />
                  <button onClick={handleBrowseISO} className="browse-btn" title="Browse local files">
                    <Upload />
                  </button>
                </div>
              </div>

              <div className="modal-info-box mt-4">
                <p>Enter the path to the ISO on the hypervisor host, or browse to upload a local ISO.</p>
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setShowISODialog(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                onClick={() => handleMountISO(showISODialog)}
                disabled={!isoPath.trim()}
                className="btn btn-primary flex-1"
              >
                <Disc className="w-4 h-4" />
                Mount ISO
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
