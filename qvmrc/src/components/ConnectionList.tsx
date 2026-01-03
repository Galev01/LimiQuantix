import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import {
  Monitor,
  Plus,
  Settings,
  Trash2,
  Clock,
  Server,
  Loader2,
  AlertTriangle,
  X,
  ExternalLink,
  Zap,
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
  }) => void;
  onOpenSettings: () => void;
}

export function ConnectionList({ onConnect, onOpenSettings }: ConnectionListProps) {
  const [connections, setConnections] = useState<SavedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  // New connection form state
  const [newName, setNewName] = useState('');
  const [newControlPlane, setNewControlPlane] = useState('http://localhost:8080');
  const [newVmId, setNewVmId] = useState('');

  useEffect(() => {
    loadConnections();
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

  const handleConnect = async (connection: SavedConnection) => {
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
          <div className="alert alert-error">
            <AlertTriangle className="w-5 h-5 alert-icon" />
            <div>
              <p className="alert-title">Connection Error</p>
              <p className="alert-description">{error}</p>
            </div>
          </div>
        )}

        {/* Add Connection Button */}
        <button
          onClick={() => setShowAddDialog(true)}
          className="add-card mb-8"
        >
          <div className="add-card-icon">
            <Plus />
          </div>
          <span>Add Connection</span>
        </button>

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
              Click "Add Connection" above to connect to your first VM
            </p>
          </div>
        )}

        {/* Connection List */}
        {!loading && connections.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-[var(--accent)]" />
              <span className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wider">
                Recent Connections
              </span>
            </div>
            <div className="grid gap-4">
              {connections.map((connection, index) => (
                <div
                  key={connection.id}
                  className="connection-card group animate-fade-in-up"
                  style={{ animationDelay: `${index * 50}ms` }}
                  onClick={() => handleConnect(connection)}
                >
                  <div className="flex items-center gap-5 relative z-10">
                    <div className="connection-card-icon">
                      {connecting === connection.id ? (
                        <Loader2 className="w-6 h-6 text-[var(--accent)] spinner" />
                      ) : (
                        <Monitor className="w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[var(--text-primary)] truncate text-[15px] mb-1">
                        {connection.name}
                      </p>
                      <p className="text-sm text-[var(--text-muted)] truncate flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{connection.control_plane_url}</span>
                      </p>
                      {connection.last_connected && (
                        <p className="text-xs text-[var(--text-muted)] flex items-center gap-2 mt-2 opacity-70">
                          <Clock className="w-3 h-3" />
                          {connection.last_connected}
                        </p>
                      )}
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDelete(e, connection.id)}
                      className="icon-btn opacity-0 group-hover:opacity-100 
                                 hover:!bg-[var(--error-light)] hover:!text-[var(--error)]"
                      title="Delete connection"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
    </div>
  );
}
