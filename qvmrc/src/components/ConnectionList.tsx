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
  Link,
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

  const handleDelete = async (id: string) => {
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
      <header className="app-header flex items-center justify-between px-6 py-5">
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
      <main className="flex-1 overflow-auto p-6">
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
          className="add-card mb-6"
        >
          <Plus />
          <span>Add Connection</span>
        </button>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-[var(--accent)] animate-spin" />
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
              Click "Add Connection" to get started
            </p>
          </div>
        )}

        {/* Connection List */}
        <div className="grid gap-4">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="connection-card group"
            >
              <button
                onClick={() => handleConnect(connection)}
                disabled={connecting !== null}
                className="w-full text-left flex items-center gap-4"
              >
                <div className="connection-card-icon">
                  {connecting === connection.id ? (
                    <Loader2 className="w-6 h-6 text-[var(--accent)] animate-spin" />
                  ) : (
                    <Monitor className="w-6 h-6" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[var(--text-primary)] truncate text-[15px]">
                    {connection.name}
                  </p>
                  <p className="text-sm text-[var(--text-muted)] truncate flex items-center gap-1.5 mt-1">
                    <Link className="w-3 h-3" />
                    {connection.control_plane_url}
                  </p>
                  {connection.last_connected && (
                    <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 mt-2">
                      <Clock className="w-3 h-3" />
                      Last connected: {connection.last_connected}
                    </p>
                  )}
                </div>
              </button>

              {/* Delete button */}
              <button
                onClick={() => handleDelete(connection.id)}
                className="absolute right-4 top-1/2 -translate-y-1/2 icon-btn
                           opacity-0 group-hover:opacity-100 hover:!bg-[var(--error-light)]
                           hover:!text-[var(--error)] transition-all"
                title="Delete connection"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* Add Connection Dialog */}
      {showAddDialog && (
        <div className="modal-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header flex items-center justify-between">
              <h2 className="modal-title">Add Connection</h2>
              <button
                onClick={() => setShowAddDialog(false)}
                className="icon-btn"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body space-y-5">
              <div className="form-group">
                <label className="label">Connection Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Production Server"
                  className="input"
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
                <label className="label">VM ID</label>
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
                Add Connection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
