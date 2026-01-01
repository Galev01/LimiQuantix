import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type VolumeStatus = 'AVAILABLE' | 'IN_USE' | 'CREATING' | 'ERROR';

interface Volume {
  id: string;
  name: string;
  sizeBytes: number;
  poolId: string;
  poolName: string;
  status: VolumeStatus;
  attachedVmId?: string;
  attachedVmName?: string;
  provisioning: 'thin' | 'thick';
  createdAt: string;
}

// Mock volumes data
const mockVolumes: Volume[] = [
  {
    id: 'vol-001',
    name: 'prod-web-01-boot',
    sizeBytes: 107_374_182_400,
    poolId: 'pool-ceph-01',
    poolName: 'ceph-ssd-pool',
    status: 'IN_USE',
    attachedVmId: 'vm-001',
    attachedVmName: 'prod-web-01',
    provisioning: 'thin',
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'vol-002',
    name: 'prod-web-01-data',
    sizeBytes: 536_870_912_000,
    poolId: 'pool-ceph-01',
    poolName: 'ceph-ssd-pool',
    status: 'IN_USE',
    attachedVmId: 'vm-001',
    attachedVmName: 'prod-web-01',
    provisioning: 'thin',
    createdAt: '2024-01-15T10:05:00Z',
  },
  {
    id: 'vol-003',
    name: 'prod-db-01-boot',
    sizeBytes: 107_374_182_400,
    poolId: 'pool-ceph-01',
    poolName: 'ceph-ssd-pool',
    status: 'IN_USE',
    attachedVmId: 'vm-002',
    attachedVmName: 'prod-db-01',
    provisioning: 'thin',
    createdAt: '2024-01-16T14:30:00Z',
  },
  {
    id: 'vol-004',
    name: 'prod-db-01-data',
    sizeBytes: 2_147_483_648_000,
    poolId: 'pool-ceph-01',
    poolName: 'ceph-ssd-pool',
    status: 'IN_USE',
    attachedVmId: 'vm-002',
    attachedVmName: 'prod-db-01',
    provisioning: 'thick',
    createdAt: '2024-01-16T14:35:00Z',
  },
  {
    id: 'vol-005',
    name: 'backup-staging',
    sizeBytes: 1_099_511_627_776,
    poolId: 'pool-nfs-01',
    poolName: 'nfs-backup-pool',
    status: 'AVAILABLE',
    provisioning: 'thin',
    createdAt: '2024-01-20T09:00:00Z',
  },
  {
    id: 'vol-006',
    name: 'temp-migration',
    sizeBytes: 214_748_364_800,
    poolId: 'pool-ceph-01',
    poolName: 'ceph-ssd-pool',
    status: 'CREATING',
    provisioning: 'thin',
    createdAt: '2024-01-25T16:00:00Z',
  },
];

type FilterTab = 'all' | 'in_use' | 'available' | 'creating';

const statusConfig = {
  AVAILABLE: { label: 'Available', variant: 'success' as const, icon: CheckCircle },
  IN_USE: { label: 'In Use', variant: 'info' as const, icon: Link },
  CREATING: { label: 'Creating', variant: 'warning' as const, icon: Clock },
  ERROR: { label: 'Error', variant: 'error' as const, icon: AlertCircle },
};

export function Volumes() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredVolumes = mockVolumes.filter((vol) => {
    const matchesSearch =
      vol.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vol.poolName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (vol.attachedVmName?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'in_use' && vol.status === 'IN_USE') ||
      (activeTab === 'available' && vol.status === 'AVAILABLE') ||
      (activeTab === 'creating' && vol.status === 'CREATING');

    return matchesSearch && matchesTab;
  });

  const volumeCounts = {
    all: mockVolumes.length,
    in_use: mockVolumes.filter((v) => v.status === 'IN_USE').length,
    available: mockVolumes.filter((v) => v.status === 'AVAILABLE').length,
    creating: mockVolumes.filter((v) => v.status === 'CREATING').length,
  };

  // Calculate totals
  const totalSize = mockVolumes.reduce((sum, v) => sum + v.sizeBytes, 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Volumes</h1>
          <p className="text-text-muted mt-1">
            {mockVolumes.length} volumes · {formatBytes(totalSize)} total
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button size="sm">
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
          <Button variant="ghost" size="sm">
            <Filter className="w-4 h-4" />
            Filters
          </Button>
        </div>
      </div>

      {/* Volumes Table */}
      <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
        {/* Table Header */}
        <div className="px-5 py-3 border-b border-border bg-bg-elevated/50">
          <div className="grid grid-cols-12 gap-4 text-xs font-medium text-text-muted uppercase tracking-wider">
            <div className="col-span-3">Name</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Size</div>
            <div className="col-span-2">Pool</div>
            <div className="col-span-2">Attached To</div>
            <div className="col-span-1">Type</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
        </div>

        {/* Table Body */}
        <div className="divide-y divide-border">
          {filteredVolumes.map((volume, index) => {
            const statusInfo = statusConfig[volume.status];
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
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {statusInfo.label}
                  </Badge>
                </div>

                {/* Size */}
                <div className="col-span-2">
                  <p className="text-sm text-text-primary">{formatBytes(volume.sizeBytes)}</p>
                </div>

                {/* Pool */}
                <div className="col-span-2">
                  <p className="text-sm text-text-secondary">{volume.poolName}</p>
                </div>

                {/* Attached To */}
                <div className="col-span-2">
                  {volume.attachedVmName ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/vms/${volume.attachedVmId}`);
                      }}
                      className="flex items-center gap-2 text-sm text-accent hover:underline"
                    >
                      <MonitorCog className="w-3.5 h-3.5" />
                      {volume.attachedVmName}
                    </button>
                  ) : (
                    <span className="text-sm text-text-muted">—</span>
                  )}
                </div>

                {/* Type */}
                <div className="col-span-1">
                  <span
                    className={cn(
                      'text-xs px-2 py-1 rounded',
                      volume.provisioning === 'thin'
                        ? 'bg-info/10 text-info'
                        : 'bg-warning/10 text-warning',
                    )}
                  >
                    {volume.provisioning}
                  </span>
                </div>

                {/* Actions */}
                <div className="col-span-1 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {volume.status === 'AVAILABLE' ? (
                    <button
                      className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-accent transition-colors"
                      title="Attach"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link className="w-3.5 h-3.5" />
                    </button>
                  ) : volume.status === 'IN_USE' ? (
                    <button
                      className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-warning transition-colors"
                      title="Detach"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Unlink className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                  <button
                    className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-text-primary transition-colors"
                    title="Expand"
                    onClick={(e) => e.stopPropagation()}
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
                    className="p-1.5 rounded-md hover:bg-bg-active text-text-muted hover:text-text-primary transition-colors"
                    title="More"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
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
              <Button size="sm">
                <Plus className="w-4 h-4" />
                Create Volume
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

