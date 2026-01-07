import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  HardDrive,
  Trash2,
  RefreshCw,
  FolderOpen,
  Server,
  Database,
  Network,
} from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useStoragePools, useDestroyStoragePool } from '@/hooks/useStorage';
import { formatBytes, cn } from '@/lib/utils';
import type { StoragePool, StoragePoolType } from '@/api/types';
import { CreatePoolModal } from '@/components/storage/CreatePoolModal';

export function StoragePools() {
  const { data: pools, isLoading, refetch, isFetching } = useStoragePools();
  const destroyPool = useDestroyStoragePool();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [_poolToDelete, _setPoolToDelete] = useState<string | null>(null);

  const handleDeletePool = (poolId: string) => {
    if (confirm(`Are you sure you want to destroy storage pool "${poolId}"? This cannot be undone.`)) {
      destroyPool.mutate(poolId);
    }
  };

  const getPoolIcon = (type: StoragePoolType) => {
    switch (type) {
      case 'LOCAL_DIR':
        return <FolderOpen className="w-5 h-5 text-accent" />;
      case 'NFS':
        return <Network className="w-5 h-5 text-info" />;
      case 'CEPH_RBD':
        return <Database className="w-5 h-5 text-warning" />;
      case 'ISCSI':
        return <Server className="w-5 h-5 text-success" />;
      default:
        return <HardDrive className="w-5 h-5" />;
    }
  };

  const getPoolTypeBadge = (type: StoragePoolType) => {
    const variants: Record<StoragePoolType, 'default' | 'info' | 'warning' | 'success'> = {
      LOCAL_DIR: 'default',
      NFS: 'info',
      CEPH_RBD: 'warning',
      ISCSI: 'success',
    };
    const labels: Record<StoragePoolType, string> = {
      LOCAL_DIR: 'Local',
      NFS: 'NFS',
      CEPH_RBD: 'Ceph RBD',
      ISCSI: 'iSCSI',
    };
    return <Badge variant={variants[type]}>{labels[type]}</Badge>;
  };

  const getUsagePercent = (pool: StoragePool) => {
    if (pool.totalBytes === 0) return 0;
    return (pool.usedBytes / pool.totalBytes) * 100;
  };

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return 'bg-error';
    if (percent >= 75) return 'bg-warning';
    return 'bg-accent';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Storage Pools"
        subtitle={`${pools?.length || 0} storage pools configured`}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </Button>
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4" />
              Add Pool
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="text-center text-text-muted py-12">
            Loading storage pools...
          </div>
        ) : !pools || pools.length === 0 ? (
          <Card className="text-center py-12">
            <HardDrive className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">
              No Storage Pools
            </h3>
            <p className="text-text-muted mb-6">
              Create a storage pool to store VM disk images
            </p>
            <Button onClick={() => setShowCreateModal(true)}>
              <Plus className="w-4 h-4" />
              Create Storage Pool
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pools.map(pool => {
              const usagePercent = getUsagePercent(pool);
              return (
                <Card key={pool.poolId} className="flex flex-col">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      {getPoolIcon(pool.type)}
                      <div>
                        <Link
                          to={`/storage/volumes?pool=${pool.poolId}`}
                          className="font-medium text-text-primary hover:text-accent transition-colors"
                        >
                          {pool.poolId}
                        </Link>
                        <div className="flex items-center gap-2 mt-1">
                          {getPoolTypeBadge(pool.type)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeletePool(pool.poolId)}
                      disabled={destroyPool.isPending}
                      className="text-error hover:text-error"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Path */}
                  <div className="text-sm text-text-muted mb-4 truncate" title={pool.mountPath}>
                    {pool.mountPath || 'N/A'}
                  </div>

                  {/* Usage Bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-text-muted">
                        {formatBytes(pool.usedBytes)} used
                      </span>
                      <span className="text-text-secondary">
                        {formatBytes(pool.totalBytes)} total
                      </span>
                    </div>
                    <div className="h-2 bg-bg-base rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', getUsageColor(usagePercent))}
                        style={{ width: `${Math.min(usagePercent, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex justify-between text-sm pt-3 border-t border-border">
                    <div>
                      <span className="text-text-muted">Available: </span>
                      <span className="text-text-secondary">{formatBytes(pool.availableBytes)}</span>
                    </div>
                    <div>
                      <span className="text-text-muted">Volumes: </span>
                      <span className="text-text-secondary">{pool.volumeCount || 0}</span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Pool Modal */}
      {showCreateModal && (
        <CreatePoolModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}
