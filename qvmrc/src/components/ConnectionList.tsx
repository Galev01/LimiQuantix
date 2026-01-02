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
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <Monitor className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">QVMRC</h1>
            <p className="text-xs text-[var(--text-muted)]">Quantix VM Remote Console</p>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="p-2 rounded-lg hover:bg-[var(--bg-hover)] transition-colors"
          title="Settings"
        >
          <Settings className="w-5 h-5 text-[var(--text-muted)]" />
        </button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-6">
        {/* Error message */}
        {error && (
          <div className="mb-4 p-4 bg-[var(--error)]/10 border border-[var(--error)]/30 rounded-lg flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[var(--error)] shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-[var(--error)]">Connection Error</p>
              <p className="text-sm text-[var(--text-muted)]">{error}</p>
            </div>
          </div>
        )}

        {/* Add Connection Button */}
        <button
          onClick={() => setShowAddDialog(true)}
          className="w-full p-6 mb-4 border-2 border-dashed border-[var(--border)] rounded-xl 
                     hover:border-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors
                     flex flex-col items-center gap-2"
        >
          <Plus className="w-8 h-8 text-[var(--text-muted)]" />
          <span className="text-[var(--text-secondary)]">Add Connection</span>
        </button>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-[var(--accent)] animate-spin" />
          </div>
        )}

        {/* Connection List */}
        {!loading && connections.length === 0 && (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No saved connections</p>
            <p className="text-sm">Click "Add Connection" to get started</p>
          </div>
        )}

        <div className="grid gap-3">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="group relative p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)]
                         hover:border-[var(--accent)]/50 transition-colors"
            >
              <button
                onClick={() => handleConnect(connection)}
                disabled={connecting !== null}
                className="w-full text-left flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-lg bg-[var(--bg-elevated)] flex items-center justify-center">
                  {connecting === connection.id ? (
                    <Loader2 className="w-6 h-6 text-[var(--accent)] animate-spin" />
                  ) : (
                    <Monitor className="w-6 h-6 text-[var(--text-muted)]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--text-primary)] truncate">
                    {connection.name}
                  </p>
                  <p className="text-sm text-[var(--text-muted)] truncate">
                    {connection.control_plane_url}
                  </p>
                  {connection.last_connected && (
                    <p className="text-xs text-[var(--text-muted)] flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3" />
                      {connection.last_connected}
                    </p>
                  )}
                </div>
              </button>

              {/* Delete button */}
              <button
                onClick={() => handleDelete(connection.id)}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-lg
                           opacity-0 group-hover:opacity-100 hover:bg-[var(--error)]/10
                           text-[var(--text-muted)] hover:text-[var(--error)] transition-all"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </main>

      {/* Add Connection Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              Add Connection
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My VM"
                  className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg
                             text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1">
                  Control Plane URL
                </label>
                <input
                  type="text"
                  value={newControlPlane}
                  onChange={(e) => setNewControlPlane(e.target.value)}
                  placeholder="http://localhost:8080"
                  className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg
                             text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--text-muted)] mb-1">
                  VM ID
                </label>
                <input
                  type="text"
                  value={newVmId}
                  onChange={(e) => setNewVmId(e.target.value)}
                  placeholder="abc123-def456..."
                  className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg
                             text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
                             focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddDialog(false)}
                className="flex-1 px-4 py-2 bg-[var(--bg-elevated)] rounded-lg
                           text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddConnection}
                disabled={!newName || !newControlPlane || !newVmId}
                className="flex-1 px-4 py-2 bg-[var(--accent)] rounded-lg
                           text-white hover:bg-[var(--accent-hover)] transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
