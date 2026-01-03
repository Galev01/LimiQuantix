import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Monitor,
  Plus,
  Settings,
  Trash2,
  Loader2,
  AlertTriangle,
  X,
  Search,
  Pencil,
  Check,
  Server,
  Power,
  RotateCcw,
  Play,
  Square,
  MoreVertical,
  Disc,
  Network,
  Upload,
} from 'lucide-react';

interface SavedConnection {
  id: string;
  name: string;
  control_plane_url: string;
  vm_id: string;
  last_connected?: string;
  thumbnail?: string;
}

interface ConnectionListProps {
  onConnect: (connection: {
    connectionId: string;
    vmId: string;
    vmName: string;
    controlPlaneUrl: string;
  }) => void;
  onOpenSettings: () => void;
}

type VMAction = 'start' | 'stop' | 'reboot' | 'shutdown';

export function ConnectionList({ onConnect, onOpenSettings }: ConnectionListProps) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [executingAction, setExecutingAction] = useState<{ id: string; action: VMAction } | null>(null);
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
    const handleClick = () => setActionMenuId(null);
    if (actionMenuId) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [actionMenuId]);

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
    return connections.filter(conn => 
      conn.name.toLowerCase().includes(query) ||
      conn.control_plane_url.toLowerCase().includes(query) ||
      conn.vm_id.toLowerCase().includes(query)
    );
  }, [connections, searchQuery]);

  const handleConnect = async (connection: SavedConnection) => {
    // Don't connect if we're editing or action menu is open
    if (editingId === connection.id || actionMenuId === connection.id) return;
    
    setConnecting(connection.id);
    setError(null);

    try {
      const connectionId = await invoke<string>('connect_vnc', {
        controlPlaneUrl: connection.control_plane_url,
        vmId: connection.vm_id,
      });

      onConnect({
        connectionId,
        vmId: connection.vm_id,
        vmName: connection.name,
        controlPlaneUrl: connection.control_plane_url,
      });
    } catch (err) {
      console.error('Connection failed:', err);
      setError(String(err));
    } finally {
      setConnecting(null);
    }
  };

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

  const handleStartEdit = (e: React.MouseEvent, connection: SavedConnection) => {
    e.stopPropagation();
    setEditingId(connection.id);
    setEditName(connection.name);
  };

  const handleSaveEdit = async (e: React.MouseEvent, connection: SavedConnection) => {
    e.stopPropagation();
    
    if (!editName.trim()) {
      setEditingId(null);
      return;
    }

    const updatedConnection = { ...connection, name: editName.trim() };
    
    try {
      await invoke('save_connection', { connection: updatedConnection });
      setConnections(connections.map(c => 
        c.id === connection.id ? updatedConnection : c
      ));
    } catch (err) {
      console.error('Failed to save:', err);
    }
    
    setEditingId(null);
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

  const handleVMAction = async (e: React.MouseEvent, connection: SavedConnection, action: VMAction) => {
    e.stopPropagation();
    setActionMenuId(null);
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

  // Format the last connected time nicely
  const formatLastConnected = (timestamp?: string) => {
    if (!timestamp) return null;
    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString();
    } catch {
      return null;
    }
  };

  const toggleActionMenu = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActionMenuId(actionMenuId === id ? null : id);
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-base)]">
      {/* Header */}
      <header className="app-header">
        <div className="app-brand">
          <div className="app-brand-icon">
            <Monitor />
          </div>
          <div className="app-brand-text">
            <h1>QVMRC</h1>
            <p>Quantix VM Remote Console</p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="icon-btn"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto page-content">
        {/* Error message */}
        {error && (
          <div className="alert alert-error mb-4">
            <AlertTriangle className="w-5 h-5 alert-icon" />
            <div className="flex-1">
              <p className="alert-title">Error</p>
              <p className="alert-description">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="icon-btn !w-8 !h-8">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Search Bar */}
        <div className="search-wrapper mb-6">
          <Search className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, URL, or VM ID..."
            className="input"
          />
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 text-[var(--accent)] spinner" />
          </div>
        )}

        {/* Empty State */}
        {!loading && connections.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Server />
            </div>
            <p className="empty-state-title">No saved connections</p>
            <p className="empty-state-description">
              Click the + button to add your first VM connection
            </p>
          </div>
        )}

        {/* No Search Results */}
        {!loading && connections.length > 0 && filteredConnections.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Search />
            </div>
            <p className="empty-state-title">No matches found</p>
            <p className="empty-state-description">
              Try a different search term
            </p>
          </div>
        )}

        {/* Connection Grid - 3 cards per row */}
        {!loading && filteredConnections.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {/* Add Connection Card - First in grid */}
            <button
              onClick={() => setShowAddDialog(true)}
              className="vm-card-add group"
            >
              <div className="flex flex-col items-center justify-center h-full gap-3 py-8">
                <div className="w-14 h-14 rounded-2xl bg-[var(--accent)]/10 
                              flex items-center justify-center
                              group-hover:bg-[var(--accent)]/20 
                              group-hover:scale-110 transition-all duration-300">
                  <Plus className="w-7 h-7 text-[var(--accent)]" />
                </div>
                <span className="text-sm font-medium text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
                  Add Connection
                </span>
              </div>
            </button>

            {/* Connection Cards */}
            {filteredConnections.map((connection, index) => (
              <div
                key={connection.id}
                className="vm-card group animate-fade-in-up cursor-pointer"
                style={{ animationDelay: `${index * 50}ms` }}
                onClick={() => handleConnect(connection)}
              >
                {/* Card Content */}
                <div className="flex flex-col h-full relative">
                  {/* Top section - Icon and actions */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 
                                  flex items-center justify-center
                                  group-hover:bg-[var(--accent)]/20 transition-colors">
                      {connecting === connection.id || executingAction?.id === connection.id ? (
                        <Loader2 className="w-6 h-6 text-[var(--accent)] spinner" />
                      ) : (
                        <Monitor className="w-6 h-6 text-[var(--accent)]" />
                      )}
                    </div>
                    
                    {/* Action buttons - top right */}
                    <div className="flex items-center gap-1">
                      {/* More actions menu */}
                      <div className="relative">
                        <button
                          onClick={(e) => toggleActionMenu(e, connection.id)}
                          className="icon-btn !w-8 !h-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="VM Actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        
                        {/* Dropdown Menu */}
                        {actionMenuId === connection.id && (
                          <div className="action-menu" onClick={e => e.stopPropagation()}>
                            <div className="action-menu-header">Power</div>
                            <button 
                              className="action-menu-item"
                              onClick={(e) => handleVMAction(e, connection, 'start')}
                            >
                              <Play className="w-4 h-4 text-green-400" />
                              <span>Start</span>
                            </button>
                            <button 
                              className="action-menu-item"
                              onClick={(e) => handleVMAction(e, connection, 'shutdown')}
                            >
                              <Power className="w-4 h-4 text-yellow-400" />
                              <span>Shutdown</span>
                            </button>
                            <button 
                              className="action-menu-item"
                              onClick={(e) => handleVMAction(e, connection, 'reboot')}
                            >
                              <RotateCcw className="w-4 h-4 text-blue-400" />
                              <span>Reboot</span>
                            </button>
                            <button 
                              className="action-menu-item"
                              onClick={(e) => handleVMAction(e, connection, 'stop')}
                            >
                              <Square className="w-4 h-4 text-red-400" />
                              <span>Force Stop</span>
                            </button>
                            
                            <div className="action-menu-divider" />
                            <div className="action-menu-header">Media</div>
                            <button 
                              className="action-menu-item"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionMenuId(null);
                                setShowISODialog(connection);
                              }}
                            >
                              <Disc className="w-4 h-4 text-purple-400" />
                              <span>Mount ISO</span>
                            </button>
                            
                            <div className="action-menu-divider" />
                            <div className="action-menu-header">Network</div>
                            <button 
                              className="action-menu-item action-menu-item-disabled"
                              disabled
                            >
                              <Network className="w-4 h-4" />
                              <span>Change Network</span>
                              <span className="text-[10px] ml-auto opacity-50">Soon</span>
                            </button>
                          </div>
                        )}
                      </div>
                      
                      {/* Delete button */}
                      <button
                        onClick={(e) => handleDelete(e, connection.id)}
                        className="icon-btn !w-8 !h-8 opacity-0 group-hover:opacity-100 
                                 hover:!bg-red-500/20 hover:!text-red-400 transition-all"
                        title="Delete connection"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Middle section - VM Name */}
                  <div className="flex-1 mb-3">
                    <h3 className="font-semibold text-[var(--text-primary)] text-base truncate mb-1">
                      {connection.name}
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] truncate font-mono">
                      {connection.vm_id.slice(0, 8)}...
                    </p>
                  </div>

                  {/* Bottom section - URL and edit */}
                  <div className="pt-3 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between">
                      {/* Editable name section */}
                      {editingId === connection.id ? (
                        <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="input !py-1 !px-2 text-sm flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(e as unknown as React.MouseEvent, connection);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <button
                            onClick={(e) => handleSaveEdit(e, connection)}
                            className="icon-btn !w-7 !h-7 !bg-[var(--accent)]/20 hover:!bg-[var(--accent)]/30"
                          >
                            <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[var(--text-muted)] truncate">
                              {connection.control_plane_url.replace('http://', '').replace('https://', '')}
                            </p>
                            {connection.last_connected && (
                              <p className="text-[10px] text-[var(--text-muted)] opacity-60 mt-0.5">
                                {formatLastConnected(connection.last_connected)}
                              </p>
                            )}
                          </div>
                          
                          {/* Edit button */}
                          <button
                            onClick={(e) => handleStartEdit(e, connection)}
                            className="icon-btn !w-7 !h-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Edit name"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add Connection Dialog */}
      {showAddDialog && (
        <div className="modal-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">New Connection</h2>
              <button
                onClick={() => setShowAddDialog(false)}
                className="icon-btn"
              >
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
              <button
                onClick={() => setShowAddDialog(false)}
                className="btn btn-secondary flex-1"
              >
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

      {/* Mount ISO Dialog */}
      {showISODialog && (
        <div className="modal-overlay" onClick={() => setShowISODialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Mount ISO</h2>
              <button
                onClick={() => setShowISODialog(null)}
                className="icon-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body">
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Mount an ISO image to <span className="text-[var(--accent)]">{showISODialog.name}</span>
              </p>
              
              <div className="form-group">
                <label className="label">ISO Path (on hypervisor)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={isoPath}
                    onChange={(e) => setIsoPath(e.target.value)}
                    placeholder="/var/lib/libvirt/images/ubuntu.iso"
                    className="input flex-1"
                    autoFocus
                  />
                  <button
                    onClick={handleBrowseISO}
                    className="btn btn-secondary !px-4"
                    title="Browse local files"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  Enter the path to the ISO on the hypervisor host, or browse to upload a local ISO.
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button
                onClick={() => setShowISODialog(null)}
                className="btn btn-secondary flex-1"
              >
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
    </div>
  );
}
