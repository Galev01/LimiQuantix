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
  Settings,
  Trash2,
  BarChart3,
  WifiOff,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { mockStoragePools, type StoragePool } from '@/data/mock-data';
// Note: Storage service not yet implemented in backend - using mock data only

type FilterTab = 'all' | 'ready' | 'degraded' | 'error';

const statusConfig = {
  READY: { label: 'Ready', variant: 'success' as const, icon: CheckCircle },
  DEGRADED: { label: 'Degraded', variant: 'warning' as const, icon: AlertTriangle },
  ERROR: { label: 'Error', variant: 'error' as const, icon: XCircle },
};

const typeLabels = {
  CEPH_RBD: 'Ceph RBD',
  LOCAL_LVM: 'Local LVM',
  NFS: 'NFS',
};

export function StoragePools() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredPools = mockStoragePools.filter((pool) => {
    const matchesSearch = pool.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'ready' && pool.status.phase === 'READY') ||
      (activeTab === 'degraded' && pool.status.phase === 'DEGRADED') ||
      (activeTab === 'error' && pool.status.phase === 'ERROR');
    return matchesSearch && matchesTab;
  });

  const poolCounts = {
    all: mockStoragePools.length,
    ready: mockStoragePools.filter((p) => p.status.phase === 'READY').length,
    degraded: mockStoragePools.filter((p) => p.status.phase === 'DEGRADED').length,
    error: mockStoragePools.filter((p) => p.status.phase === 'ERROR').length,
  };

  // Calculate totals
  const totalCapacity = mockStoragePools.reduce((sum, p) => sum + p.status.capacity.totalBytes, 0);
  const usedCapacity = mockStoragePools.reduce((sum, p) => sum + p.status.capacity.usedBytes, 0);
  const usagePercent = Math.round((usedCapacity / totalCapacity) * 100);

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
          {/* Storage service not yet implemented - always mock */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-warning/20 text-warning border border-warning/30">
            <WifiOff className="w-3 h-3" />
            Mock Data
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button size="sm">
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
          <p className="text-2xl font-bold text-text-primary">{mockStoragePools.length}</p>
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

      {/* Pools Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPools.map((pool, index) => (
          <PoolCard key={pool.id} pool={pool} index={index} />
        ))}
      </div>

      {/* Empty State */}
      {filteredPools.length === 0 && (
        <div className="text-center py-12 bg-bg-surface rounded-xl border border-border">
          <Database className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Storage Pools Found</h3>
          <p className="text-text-muted mb-4">
            {searchQuery ? 'No pools match your search criteria' : 'Create your first storage pool'}
          </p>
          {!searchQuery && (
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Create Pool
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function PoolCard({ pool, index }: { pool: StoragePool; index: number }) {
  const statusInfo = statusConfig[pool.status.phase];
  const StatusIcon = statusInfo.icon;
  const usagePercent = Math.round(
    (pool.status.capacity.usedBytes / pool.status.capacity.totalBytes) * 100
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.3 + index * 0.05 }}
      className={cn(
        'bg-bg-surface rounded-xl border border-border p-5',
        'shadow-floating hover:shadow-elevated',
        'transition-all duration-200 cursor-pointer group',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-bg-elevated group-hover:bg-accent/10 flex items-center justify-center transition-colors">
            <Database className="w-5 h-5 text-text-muted group-hover:text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
              {pool.name}
            </h3>
            <p className="text-xs text-text-muted">{typeLabels[pool.type]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusInfo.variant}>
            <StatusIcon className="w-3 h-3 mr-1" />
            {statusInfo.label}
          </Badge>
          <button
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary opacity-0 group-hover:opacity-100 transition-all"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>

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
            {formatBytes(pool.status.capacity.totalBytes)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Used</p>
          <p className="text-sm font-medium text-text-primary">
            {formatBytes(pool.status.capacity.usedBytes)}
          </p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Available</p>
          <p className="text-sm font-medium text-text-primary">
            {formatBytes(pool.status.capacity.availableBytes)}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

