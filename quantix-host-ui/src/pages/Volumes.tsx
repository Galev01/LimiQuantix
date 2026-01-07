import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  HardDrive,
  Trash2,
  RefreshCw,
  Maximize2,
  Link as LinkIcon,
} from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useStoragePools, useVolumes, useVolumeOps } from '@/hooks/useStorage';
import { formatBytes, cn } from '@/lib/utils';
import { CreateVolumeModal } from '@/components/storage/CreateVolumeModal';

export function Volumes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPoolId = searchParams.get('pool') || '';
  
  const { data: pools, isLoading: poolsLoading } = useStoragePools();
  const { data: volumes, isLoading: volumesLoading, refetch, isFetching } = useVolumes(selectedPoolId);
  const volumeOps = useVolumeOps(selectedPoolId);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSelectPool = (poolId: string) => {
    setSearchParams({ pool: poolId });
  };

  const handleDeleteVolume = (volumeId: string) => {
    if (confirm(`Are you sure you want to delete volume "${volumeId}"? This cannot be undone.`)) {
      volumeOps.remove.mutate(volumeId);
    }
  };

  // Combined loading state for potential future use
  void (poolsLoading || volumesLoading);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Volumes"
        subtitle={selectedPoolId ? `Volumes in ${selectedPoolId}` : 'Select a storage pool'}
        actions={
          selectedPoolId && (
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
                Create Volume
              </Button>
            </>
          )
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-6">
          {/* Pool Selector Sidebar */}
          <div className="w-64 flex-shrink-0">
            <Card padding="sm">
              <h3 className="text-sm font-medium text-text-secondary mb-3">
                Storage Pools
              </h3>
              <div className="space-y-1">
                {pools?.map(pool => (
                  <button
                    key={pool.poolId}
                    onClick={() => handleSelectPool(pool.poolId)}
                    className={cn(
                      'w-full px-3 py-2 rounded-lg text-left text-sm transition-colors',
                      selectedPoolId === pool.poolId
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:bg-bg-hover'
                    )}
                  >
                    <div className="font-medium">{pool.poolId}</div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {pool.volumeCount || 0} volumes • {formatBytes(pool.availableBytes)} free
                    </div>
                  </button>
                ))}
                {poolsLoading && (
                  <div className="text-sm text-text-muted py-2 text-center">
                    Loading pools...
                  </div>
                )}
                {!poolsLoading && (!pools || pools.length === 0) && (
                  <div className="text-sm text-text-muted py-2 text-center">
                    No storage pools
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Volumes List */}
          <div className="flex-1">
            {!selectedPoolId ? (
              <Card className="text-center py-12">
                <HardDrive className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  Select a Storage Pool
                </h3>
                <p className="text-text-muted">
                  Choose a storage pool from the sidebar to view its volumes
                </p>
              </Card>
            ) : volumesLoading ? (
              <div className="text-center text-text-muted py-12">
                Loading volumes...
              </div>
            ) : !volumes || volumes.length === 0 ? (
              <Card className="text-center py-12">
                <HardDrive className="w-12 h-12 text-text-muted mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  No Volumes
                </h3>
                <p className="text-text-muted mb-6">
                  This storage pool is empty
                </p>
                <Button onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4" />
                  Create Volume
                </Button>
              </Card>
            ) : (
              <Card padding="none">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left text-sm text-text-muted">
                      <th className="p-4 font-medium">Volume</th>
                      <th className="p-4 font-medium">Size</th>
                      <th className="p-4 font-medium">Format</th>
                      <th className="p-4 font-medium">Path</th>
                      <th className="p-4 font-medium">Attached To</th>
                      <th className="p-4 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {volumes.map(volume => (
                      <tr
                        key={volume.volumeId}
                        className="border-b border-border/50 hover:bg-bg-hover/50 transition-colors"
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <HardDrive className="w-4 h-4 text-text-muted" />
                            <span className="font-medium text-text-primary">
                              {volume.volumeId}
                            </span>
                          </div>
                        </td>
                        <td className="p-4 text-text-secondary">
                          {formatBytes(volume.sizeBytes)}
                        </td>
                        <td className="p-4">
                          <Badge variant="default">qcow2</Badge>
                        </td>
                        <td className="p-4 text-text-muted text-sm max-w-xs truncate" title={volume.path}>
                          {volume.path}
                        </td>
                        <td className="p-4">
                          {volume.attachedTo ? (
                            <div className="flex items-center gap-1 text-text-secondary">
                              <LinkIcon className="w-3 h-3" />
                              {volume.attachedTo}
                            </div>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Resize"
                              disabled
                            >
                              <Maximize2 className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteVolume(volume.volumeId)}
                              disabled={volumeOps.remove.isPending || !!volume.attachedTo}
                              className="text-error hover:text-error"
                              title={volume.attachedTo ? 'Cannot delete attached volume' : 'Delete'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Create Volume Modal */}
      {showCreateModal && selectedPoolId && (
        <CreateVolumeModal
          poolId={selectedPoolId}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
