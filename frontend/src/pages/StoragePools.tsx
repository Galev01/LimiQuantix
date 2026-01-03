import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  RefreshCw,
  Database,
  HardDrive,
  Server,
  CheckCircle,
  AlertTriangle,
  XCircle,
  MoreHorizontal,
  Trash2,
  BarChart3,
  WifiOff,
  Wifi,
  Loader2,
  Folder,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useStoragePools, useDeleteStoragePool, type StoragePoolUI } from '@/hooks/useStorage';
import { CreatePoolDialog } from '@/components/storage/CreatePoolDialog';
import { toast } from 'sonner';

// Fallback mock data when API is unavailable
const mockStoragePools: StoragePoolUI[] = [
  {
    id: 'pool-1',
    name: 'ceph-ssd',
    description: 'High-performance SSD-backed Ceph pool',
    projectId: 'default',
    type: 'CEPH_RBD',
    status: { phase: 'READY', volumeCount: 12 },
    capacity: {
      totalBytes: 10 * 1024 * 1024 * 1024 * 1024,
      usedBytes: 3.5 * 1024 * 1024 * 1024 * 1024,
      availableBytes: 6.5 * 1024 * 1024 * 1024 * 1024,
      provisionedBytes: 5 * 1024 * 1024 * 1024 * 1024,
    },
    createdAt: new Date(),
    labels: {},
  },
  {
    id: 'pool-2',
    name: 'nfs-archive',
    description: 'NFS storage for archives',
    projectId: 'default',
    type: 'NFS',
    status: { phase: 'READY', volumeCount: 5 },
    capacity: {
      totalBytes: 50 * 1024 * 1024 * 1024 * 1024,
      usedBytes: 30 * 1024 * 1024 * 1024 * 1024,
      availableBytes: 20 * 1024 * 1024 * 1024 * 1024,
      provisionedBytes: 35 * 1024 * 1024 * 1024 * 1024,
    },
    createdAt: new Date(),
    labels: {},
  },
  {
    id: 'pool-3',
    name: 'iscsi-san',
    description: 'Enterprise SAN storage',
    projectId: 'default',
    type: 'ISCSI',
    status: { phase: 'DEGRADED', volumeCount: 8, errorMessage: 'One path unavailable' },
    capacity: {
      totalBytes: 20 * 1024 * 1024 * 1024 * 1024,
      usedBytes: 18 * 1024 * 1024 * 1024 * 1024,
      availableBytes: 2 * 1024 * 1024 * 1024 * 1024,
      provisionedBytes: 19 * 1024 * 1024 * 1024 * 1024,
    },
    createdAt: new Date(),
    labels: {},
  },
];

type FilterTab = 'all' | 'ready' | 'degraded' | 'error';

const statusConfig = {
  PENDING: { label: 'Pending', variant: 'default' as const, icon: Loader2 },
  READY: { label: 'Ready', variant: 'success' as const, icon: CheckCircle },
  DEGRADED: { label: 'Degraded', variant: 'warning' as const, icon: AlertTriangle },
  ERROR: { label: 'Error', variant: 'error' as const, icon: XCircle },
  DELETING: { label: 'Deleting', variant: 'default' as const, icon: Loader2 },
};

const typeConfig = {
  CEPH_RBD: { label: 'Ceph RBD', icon: Database },
  NFS: { label: 'NFS', icon: Server },
  ISCSI: { label: 'iSCSI', icon: HardDrive },
  LOCAL_DIR: { label: 'Local', icon: Folder },
  LOCAL_LVM: { label: 'LVM', icon: HardDrive },
};

export function StoragePools() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch pools from API
  const { data: apiPools, isLoading, error, refetch } = useStoragePools();
  const deletePool = useDeleteStoragePool();
  
  // Use API data or fallback to mock
  const pools = apiPools && apiPools.length > 0 ? apiPools : mockStoragePools;
  const isUsingMock = !apiPools || apiPools.length === 0;

  const filteredPools = pools.filter((pool) => {
    const matchesSearch = pool.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'ready' && pool.status.phase === 'READY') ||
      (activeTab === 'degraded' && pool.status.phase === 'DEGRADED') ||
      (activeTab === 'error' && pool.status.phase === 'ERROR');
    return matchesSearch && matchesTab;
  });

  const poolCounts = {
    all: pools.length,
    ready: pools.filter((p) => p.status.phase === 'READY').length,
    degraded: pools.filter((p) => p.status.phase === 'DEGRADED').length,
    error: pools.filter((p) => p.status.phase === 'ERROR').length,
  };

  // Calculate totals
  const totalCapacity = pools.reduce((sum, p) => sum + p.capacity.totalBytes, 0);
  const usedCapacity = pools.reduce((sum, p) => sum + p.capacity.usedBytes, 0);
  const usagePercent = totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0;

  const handleDelete = async (pool: StoragePoolUI) => {
    if (!confirm(`Are you sure you want to delete pool "${pool.name}"?`)) return;
    
    try {
      await deletePool.mutateAsync(pool.id);
      toast.success(`Pool "${pool.name}" deleted`);
    } catch (err) {
      toast.error(`Failed to delete pool: ${(err as Error).message}`);
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
            <h1 className="text-2xl font-bold text-text-primary">Storage Pools</h1>
            <p className="text-text-muted mt-1">Manage your storage infrastructure</p>
          </div>
          {/* Connection status */}
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border',
            isUsingMock
              ? 'bg-warning/20 text-warning border-warning/30'
              : 'bg-success/20 text-success border-success/30'
          )}>
            {isUsingMock ? <WifiOff className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
            {isUsingMock ? 'Mock Data' : 'Connected'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Create Pool
          </Button>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-bg-surface rounded-xl border border-border p-5 shadow-floating"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Database className="w-5 h-5 text-accent" />
            </div>
            <span className="text-sm text-text-muted">Total Pools</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{pools.length}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-bg-surface rounded-xl border border-border p-5 shadow-floating"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-success" />
            </div>
            <span className="text-sm text-text-muted">Total Capacity</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{formatBytes(totalCapacity)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-bg-surface rounded-xl border border-border p-5 shadow-floating"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-warning" />
            </div>
            <span className="text-sm text-text-muted">Used Capacity</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{formatBytes(usedCapacity)}</p>
          <p className="text-xs text-text-muted mt-1">{usagePercent}% of total</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-bg-surface rounded-xl border border-border p-5 shadow-floating"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
              <Server className="w-5 h-5 text-info" />
            </div>
            <span className="text-sm text-text-muted">Available</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{formatBytes(totalCapacity - usedCapacity)}</p>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-border">
          {([
            { key: 'all', label: 'All' },
            { key: 'ready', label: 'Ready' },
            { key: 'degraded', label: 'Degraded' },
            { key: 'error', label: 'Error' },
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
              {label} ({poolCounts[key]})
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search pools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-64 pl-9 pr-4 py-2 rounded-lg',
              'bg-bg-base border border-border',
              'text-sm text-text-primary placeholder:text-text-muted',
              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
            )}
          />
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
        </div>
      )}

      {/* Pools Grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPools.map((pool, index) => (
            <PoolCard 
              key={pool.id} 
              pool={pool} 
              index={index} 
              onDelete={() => handleDelete(pool)}
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredPools.length === 0 && (
        <div className="text-center py-12 bg-bg-surface rounded-xl border border-border">
          <Database className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Storage Pools Found</h3>
          <p className="text-text-muted mb-4">
            {searchQuery ? 'No pools match your search criteria' : 'Create your first storage pool'}
          </p>
          {!searchQuery && (
            <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              Create Pool
            </Button>
          )}
        </div>
      )}

      {/* Create Dialog - only render when open to avoid unnecessary API calls */}
      {isCreateDialogOpen && (
        <CreatePoolDialog 
          isOpen={isCreateDialogOpen} 
          onClose={() => setIsCreateDialogOpen(false)} 
        />
      )}
    </div>
  );
}

function PoolCard({ pool, index, onDelete }: { pool: StoragePoolUI; index: number; onDelete: () => void }) {
  const [showMenu, setShowMenu] = useState(false);
  const statusInfo = statusConfig[pool.status.phase];
  const typeInfo = typeConfig[pool.type];
  const StatusIcon = statusInfo.icon;
  const TypeIcon = typeInfo.icon;
  const usagePercent = pool.capacity.totalBytes > 0 
    ? Math.round((pool.capacity.usedBytes / pool.capacity.totalBytes) * 100)
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.3 + index * 0.05 }}
      className={cn(
        'bg-bg-surface rounded-xl border border-border p-5',
        'shadow-floating hover:shadow-elevated',
        'transition-all duration-200 cursor-pointer group relative',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-bg-elevated group-hover:bg-accent/10 flex items-center justify-center transition-colors">
            <TypeIcon className="w-5 h-5 text-text-muted group-hover:text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
              {pool.name}
            </h3>
            <p className="text-xs text-text-muted">{typeInfo.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusInfo.variant}>
            <StatusIcon className={cn('w-3 h-3 mr-1', pool.status.phase === 'PENDING' && 'animate-spin')} />
            {statusInfo.label}
          </Badge>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-all"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-8 z-10 w-40 bg-bg-surface rounded-lg border border-border shadow-lg py-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                    onDelete();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-bg-hover"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Pool
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      {pool.description && (
        <p className="text-xs text-text-muted mb-3 line-clamp-1">{pool.description}</p>
      )}

      {/* Usage Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-text-muted">Usage</span>
          <span
            className={cn(
              'font-medium',
              usagePercent >= 80 ? 'text-error' : usagePercent >= 60 ? 'text-warning' : 'text-text-secondary',
            )}
          >
            {usagePercent}%
          </span>
        </div>
        <div className="h-2 bg-bg-base rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${usagePercent}%` }}
            transition={{ duration: 0.5, delay: 0.4 + index * 0.05 }}
            className={cn(
              'h-full rounded-full',
              usagePercent >= 80 ? 'bg-error' : usagePercent >= 60 ? 'bg-warning' : 'bg-accent',
            )}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border">
        <div>
          <p className="text-xs text-text-muted">Total</p>
          <p className="text-sm font-medium text-text-primary">
            {formatBytes(pool.capacity.totalBytes)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Used</p>
          <p className="text-sm font-medium text-text-primary">
            {formatBytes(pool.capacity.usedBytes)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Volumes</p>
          <p className="text-sm font-medium text-text-primary">
            {pool.status.volumeCount}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
