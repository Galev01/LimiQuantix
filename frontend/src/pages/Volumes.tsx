import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  RefreshCw,
  HardDrive,
  MonitorCog,
  CheckCircle,
  Clock,
  AlertCircle,
  MoreHorizontal,
  Link,
  Unlink,
  Expand,
  Copy,
  Trash2,
  Filter,
  WifiOff,
  Wifi,
  Loader2,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { 
  useVolumes, 
  useDeleteVolume, 
  useAttachVolume, 
  useDetachVolume, 
  useResizeVolume,
  type VolumeUI 
} from '@/hooks/useStorage';
import { CreateVolumeDialog } from '@/components/storage/CreateVolumeDialog';
import { toast } from 'sonner';
import { useApiConnection } from '@/hooks/useDashboard';

type FilterTab = 'all' | 'in_use' | 'available' | 'creating';

const statusConfig = {
  PENDING: { label: 'Pending', variant: 'default' as const, icon: Clock },
  CREATING: { label: 'Creating', variant: 'warning' as const, icon: Clock },
  READY: { label: 'Available', variant: 'success' as const, icon: CheckCircle },
  IN_USE: { label: 'In Use', variant: 'info' as const, icon: Link },
  DELETING: { label: 'Deleting', variant: 'default' as const, icon: Loader2 },
  ERROR: { label: 'Error', variant: 'error' as const, icon: AlertCircle },
  RESIZING: { label: 'Resizing', variant: 'warning' as const, icon: Expand },
};

export function Volumes() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [resizingVolume, setResizingVolume] = useState<string | null>(null);
  const [resizeSize, setResizeSize] = useState('');

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiVolumes, isLoading, refetch } = useVolumes();
  const deleteVolume = useDeleteVolume();
  const attachVolume = useAttachVolume();
  const detachVolume = useDetachVolume();
  const resizeVolume = useResizeVolume();
  
  // Use only API data (no mock fallback)
  const volumes = apiVolumes || [];

  const filteredVolumes = volumes.filter((vol) => {
    const matchesSearch =
      vol.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vol.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'in_use' && vol.status.phase === 'IN_USE') ||
      (activeTab === 'available' && vol.status.phase === 'READY') ||
      (activeTab === 'creating' && (vol.status.phase === 'CREATING' || vol.status.phase === 'PENDING'));

    return matchesSearch && matchesTab;
  });

  const volumeCounts = {
    all: volumes.length,
    in_use: volumes.filter((v) => v.status.phase === 'IN_USE').length,
    available: volumes.filter((v) => v.status.phase === 'READY').length,
    creating: volumes.filter((v) => v.status.phase === 'CREATING' || v.status.phase === 'PENDING').length,
  };

  // Calculate totals
  const totalSize = volumes.reduce((sum, v) => sum + v.sizeBytes, 0);

  const handleDelete = async (volume: VolumeUI) => {
    if (!confirm(`Are you sure you want to delete volume "${volume.name}"?`)) return;
    
    try {
      await deleteVolume.mutateAsync({ id: volume.id, poolId: volume.poolId });
      toast.success(`Volume "${volume.name}" deleted`);
    } catch (err) {
      toast.error(`Failed to delete volume: ${(err as Error).message}`);
    }
  };

  const handleDetach = async (volume: VolumeUI) => {
    try {
      await detachVolume.mutateAsync(volume.id);
      toast.success(`Volume "${volume.name}" detached`);
    } catch (err) {
      toast.error(`Failed to detach volume: ${(err as Error).message}`);
    }
  };

  const handleResize = async (volume: VolumeUI) => {
    const newSizeGB = parseFloat(resizeSize);
    if (isNaN(newSizeGB) || newSizeGB <= 0) {
      toast.error('Please enter a valid size');
      return;
    }
    
    const newSizeBytes = newSizeGB * 1024 * 1024 * 1024;
    if (newSizeBytes <= volume.sizeBytes) {
      toast.error('New size must be larger than current size');
      return;
    }
    
    try {
      await resizeVolume.mutateAsync({ id: volume.id, newSizeBytes });
      toast.success(`Volume "${volume.name}" resized to ${newSizeGB} GB`);
      setResizingVolume(null);
      setResizeSize('');
    } catch (err) {
      toast.error(`Failed to resize volume: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Volumes</h1>
            <p className="text-text-muted mt-1">
              {volumes.length} volumes · {formatBytes(totalSize)} total
            </p>
          </div>
          {/* Connection status */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
            isConnected
              ? 'bg-success/20 text-success border-success/30'
              : 'bg-error/20 text-error border-error/30'
          )}>
            {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {isConnected ? 'Connected' : 'Not Connected'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Create Volume
          </Button>
        </div>
      </motion.div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-border">
          {([
            { key: 'all', label: 'All' },
            { key: 'in_use', label: 'In Use' },
            { key: 'available', label: 'Available' },
            { key: 'creating', label: 'Creating' },
          ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-all',
                activeTab === key
                  ? 'bg-bg-elevated text-text-primary shadow-elevated'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              )}
            >
              {label} ({volumeCounts[key]})
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search volumes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                'w-72 pl-9 pr-4 py-2 rounded-lg',
                'bg-bg-base border border-border',
                'text-sm text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
              )}
            />
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}

      {/* Volumes Table */}
      {!isLoading && (
        <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
          {/* Table Header */}
          <div className="px-5 py-3 border-b border-border bg-bg-elevated/50">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-text-muted uppercase tracking-wider">
              <div className="col-span-3">Name</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Size</div>
              <div className="col-span-2">Pool</div>
              <div className="col-span-2">Attached To</div>
              <div className="col-span-1">Snapshots</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {filteredVolumes.map((volume, index) => {
              const statusInfo = statusConfig[volume.status.phase];
              const StatusIcon = statusInfo.icon;

              return (
                <motion.div
                  key={volume.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.03 }}
                  className={cn(
                    'grid grid-cols-12 gap-4 px-5 py-4 items-center',
                    'hover:bg-bg-hover cursor-pointer',
                    'transition-colors duration-150',
                    'group',
                  )}
                >
                  {/* Name */}
                  <div className="col-span-3 flex items-center gap-3">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center',
                        'bg-bg-elevated group-hover:bg-accent/10',
                        'transition-colors duration-150',
                      )}
                    >
                      <HardDrive className="w-4 h-4 text-text-muted group-hover:text-accent" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary group-hover:text-accent transition-colors">
                        {volume.name}
                      </p>
                      <p className="text-xs text-text-muted font-mono">{volume.id}</p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="col-span-1">
                    <Badge variant={statusInfo.variant}>
                      <StatusIcon className={cn(
                        'w-3 h-3 mr-1',
                        (volume.status.phase === 'CREATING' || volume.status.phase === 'DELETING' || volume.status.phase === 'RESIZING') && 'animate-spin'
                      )} />
                      {statusInfo.label}
                    </Badge>
                  </div>

                  {/* Size */}
                  <div className="col-span-2">
                    {resizingVolume === volume.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={resizeSize}
                          onChange={(e) => setResizeSize(e.target.value)}
                          placeholder={`${Math.ceil(volume.sizeBytes / 1024 / 1024 / 1024)}`}
                          className="w-20 px-2 py-1 text-sm rounded border border-border bg-bg-base text-text-primary"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="text-xs text-text-muted">GB</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResize(volume);
                          }}
                          className="p-1 rounded bg-accent text-white hover:bg-accent/80"
                        >
                          <CheckCircle className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setResizingVolume(null);
                            setResizeSize('');
                          }}
                          className="p-1 rounded bg-bg-elevated text-text-muted hover:text-text-primary"
                        >
                          <AlertCircle className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="text-sm text-text-primary">{formatBytes(volume.sizeBytes)}</p>
                        {volume.actualSizeBytes > 0 && volume.actualSizeBytes < volume.sizeBytes && (
                          <p className="text-xs text-text-muted">
                            {formatBytes(volume.actualSizeBytes)} used
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Pool */}
                  <div className="col-span-2">
                    <p className="text-sm text-text-secondary">{volume.poolId}</p>
                  </div>

                  {/* Attached To */}
                  <div className="col-span-2">
                    {volume.status.attachedVmId ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/vms/${volume.status.attachedVmId}`);
                        }}
                        className="flex items-center gap-2 text-sm text-accent hover:underline"
                      >
                        <MonitorCog className="w-3.5 h-3.5" />
                        {volume.status.attachedVmId}
                      </button>
                    ) : (
                      <span className="text-sm text-text-muted">—</span>
                    )}
                  </div>

                  {/* Snapshots */}
                  <div className="col-span-1">
                    <span className="text-sm text-text-secondary">{volume.status.snapshotCount}</span>
                  </div>

                  {/* Actions */}
                  <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {volume.status.phase === 'READY' ? (
                      <button
                        className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-accent transition-colors"
                        title="Attach"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Link className="w-3.5 h-3.5" />
                      </button>
                    ) : volume.status.phase === 'IN_USE' ? (
                      <button
                        className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-warning transition-colors"
                        title="Detach"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDetach(volume);
                        }}
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                    <button
                      className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-text-primary transition-colors"
                      title="Resize"
                      onClick={(e) => {
                        e.stopPropagation();
                        setResizingVolume(volume.id);
                        setResizeSize(String(Math.ceil(volume.sizeBytes / 1024 / 1024 / 1024)));
                      }}
                    >
                      <Expand className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-text-primary transition-colors"
                      title="Clone"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-error transition-colors"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(volume);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Empty State */}
          {filteredVolumes.length === 0 && (
            <div className="py-16 text-center">
              <HardDrive className="w-12 h-12 mx-auto text-text-muted mb-4" />
              <h3 className="text-lg font-medium text-text-primary mb-2">No Volumes Found</h3>
              <p className="text-text-muted mb-4">
                {searchQuery ? 'No volumes match your search criteria' : 'Create your first volume'}
              </p>
              {!searchQuery && (
                <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4" />
                  Create Volume
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Dialog - only render when open to avoid unnecessary API calls */}
      {isCreateDialogOpen && (
        <CreateVolumeDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
        />
      )}
    </div>
  );
}
