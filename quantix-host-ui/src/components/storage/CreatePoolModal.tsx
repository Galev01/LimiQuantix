import { useState } from 'react';
import { X, FolderOpen, Network, Database, Server } from 'lucide-react';
import { Button } from '@/components/ui';
import { useCreateStoragePool } from '@/hooks/useStorage';
import type { StoragePoolType } from '@/api/types';

interface CreatePoolModalProps {
  onClose: () => void;
}

export function CreatePoolModal({ onClose }: CreatePoolModalProps) {
  const createPool = useCreateStoragePool();
  const [poolId, setPoolId] = useState('');
  const [poolType, setPoolType] = useState<StoragePoolType>('LOCAL_DIR');
  const [localPath, setLocalPath] = useState('/var/lib/limiquantix/pools/');
  const [nfsServer, setNfsServer] = useState('');
  const [nfsExport, setNfsExport] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const config: Record<string, any> = {};
    
    if (poolType === 'LOCAL_DIR') {
      config.local = { path: localPath };
    } else if (poolType === 'NFS') {
      config.nfs = { server: nfsServer, export: nfsExport };
    }
    
    createPool.mutate(
      {
        poolId,
        type: poolType,
        config,
      },
      {
        onSuccess: () => onClose(),
      }
    );
  };

  const poolTypes: { type: StoragePoolType; label: string; icon: React.ReactNode; description: string }[] = [
    {
      type: 'LOCAL_DIR',
      label: 'Local Directory',
      icon: <FolderOpen className="w-5 h-5" />,
      description: 'Store disk images in a local directory',
    },
    {
      type: 'NFS',
      label: 'NFS Share',
      icon: <Network className="w-5 h-5" />,
      description: 'Mount an NFS share for shared storage',
    },
    {
      type: 'CEPH_RBD',
      label: 'Ceph RBD',
      icon: <Database className="w-5 h-5" />,
      description: 'Use Ceph RADOS Block Devices (coming soon)',
    },
    {
      type: 'ISCSI',
      label: 'iSCSI Target',
      icon: <Server className="w-5 h-5" />,
      description: 'Connect to an iSCSI target (coming soon)',
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-surface rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">
            Create Storage Pool
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Pool ID */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Pool Name
            </label>
            <input
              type="text"
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
              placeholder="my-storage-pool"
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
              required
            />
          </div>

          {/* Pool Type Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Storage Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              {poolTypes.map(({ type, label, icon, description }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPoolType(type)}
                  disabled={type === 'CEPH_RBD' || type === 'ISCSI'}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    poolType === type
                      ? 'border-accent bg-accent/10'
                      : 'border-border hover:border-border-hover'
                  } ${(type === 'CEPH_RBD' || type === 'ISCSI') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {icon}
                    <span className="font-medium text-text-primary">{label}</span>
                  </div>
                  <p className="text-xs text-text-muted">{description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Type-specific Configuration */}
          {poolType === 'LOCAL_DIR' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Directory Path
              </label>
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/var/lib/limiquantix/pools/my-pool"
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                required
              />
              <p className="text-xs text-text-muted mt-1">
                Directory will be created if it doesn't exist
              </p>
            </div>
          )}

          {poolType === 'NFS' && (
            <>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  NFS Server
                </label>
                <input
                  type="text"
                  value={nfsServer}
                  onChange={(e) => setNfsServer(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Export Path
                </label>
                <input
                  type="text"
                  value={nfsExport}
                  onChange={(e) => setNfsExport(e.target.value)}
                  placeholder="/mnt/storage/vms"
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                  required
                />
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createPool.isPending || !poolId}>
              {createPool.isPending ? 'Creating...' : 'Create Pool'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
