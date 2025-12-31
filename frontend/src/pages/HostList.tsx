import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Plus,
  Search,
  RefreshCw,
  Server,
  LayoutGrid,
  List,
  Settings,
  AlertCircle,
  CheckCircle,
  Wrench,
  MoreHorizontal,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { mockNodes, type Node, type NodePhase } from '@/data/mock-data';

type ViewMode = 'grid' | 'table';
type FilterTab = 'all' | 'ready' | 'not_ready' | 'maintenance';

const phaseConfig: Record<NodePhase, { label: string; color: string; icon: typeof CheckCircle }> = {
  READY: { label: 'Ready', color: 'text-success', icon: CheckCircle },
  NOT_READY: { label: 'Not Ready', color: 'text-error', icon: AlertCircle },
  MAINTENANCE: { label: 'Maintenance', color: 'text-warning', icon: Wrench },
  DRAINING: { label: 'Draining', color: 'text-info', icon: Settings },
};

export function HostList() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Filter hosts based on search and tab
  const filteredHosts = mockNodes.filter((node) => {
    const matchesSearch =
      node.hostname.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.managementIp.includes(searchQuery);

    const matchesTab =
      activeTab === 'all' ||
      (activeTab === 'ready' && node.status.phase === 'READY') ||
      (activeTab === 'not_ready' && node.status.phase === 'NOT_READY') ||
      (activeTab === 'maintenance' && node.status.phase === 'MAINTENANCE');

    return matchesSearch && matchesTab;
  });

  const hostCounts = {
    all: mockNodes.length,
    ready: mockNodes.filter((n) => n.status.phase === 'READY').length,
    not_ready: mockNodes.filter((n) => n.status.phase === 'NOT_READY').length,
    maintenance: mockNodes.filter((n) => n.status.phase === 'MAINTENANCE').length,
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Hosts</h1>
          <p className="text-text-muted mt-1">Physical hypervisor nodes in your cluster</p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm">
            <Plus className="w-4 h-4" />
            Add Host
          </Button>
        </div>
      </motion.div>

      {/* Filters and View Toggle */}
      <div className="flex items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-border">
          {([
            { key: 'all', label: 'All' },
            { key: 'ready', label: 'Ready' },
            { key: 'not_ready', label: 'Not Ready' },
            { key: 'maintenance', label: 'Maintenance' },
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
              {label} ({hostCounts[key]})
            </button>
          ))}
        </div>

        {/* Search and View Toggle */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search hosts..."
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
          <div className="flex p-1 bg-bg-surface rounded-lg border border-border">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-2 rounded-md transition-all',
                viewMode === 'grid'
                  ? 'bg-bg-elevated text-text-primary shadow-elevated'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                'p-2 rounded-md transition-all',
                viewMode === 'table'
                  ? 'bg-bg-elevated text-text-primary shadow-elevated'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <Button variant="ghost" size="sm">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredHosts.map((node, index) => (
            <HostCard key={node.id} node={node} index={index} onClick={() => navigate(`/hosts/${node.id}`)} />
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
          {/* Table Header */}
          <div className="px-5 py-3 border-b border-border bg-bg-elevated/50">
            <div className="grid grid-cols-12 gap-4 text-xs font-medium text-text-muted uppercase tracking-wider">
              <div className="col-span-3">Hostname</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">IP Address</div>
              <div className="col-span-2">CPU</div>
              <div className="col-span-2">Memory</div>
              <div className="col-span-1 text-right">VMs</div>
            </div>
          </div>

          {/* Table Body */}
          <div className="divide-y divide-border">
            {filteredHosts.map((node, index) => {
              const cpuPercent = Math.round(
                (node.status.resources.cpuAllocatedCores / node.spec.cpu.totalCores) * 100
              );
              const memPercent = Math.round(
                (node.status.resources.memoryAllocatedBytes / node.spec.memory.totalBytes) * 100
              );
              const PhaseIcon = phaseConfig[node.status.phase].icon;

              return (
                <motion.div
                  key={node.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: index * 0.02 }}
                  onClick={() => navigate(`/hosts/${node.id}`)}
                  className={cn(
                    'grid grid-cols-12 gap-4 px-5 py-4 items-center',
                    'hover:bg-bg-hover cursor-pointer',
                    'transition-colors duration-150',
                    'group',
                  )}
                >
                  {/* Hostname */}
                  <div className="col-span-3 flex items-center gap-3">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center',
                        'bg-bg-elevated group-hover:bg-accent/10',
                        'transition-colors duration-150',
                      )}
                    >
                      <Server className="w-4 h-4 text-text-muted group-hover:text-accent" />
                    </div>
                    <div>
                      <p className="font-medium text-text-primary group-hover:text-accent transition-colors">
                        {node.hostname}
                      </p>
                      <p className="text-xs text-text-muted">
                        {node.labels['rack'] && `Rack: ${node.labels['rack']}`}
                      </p>
                    </div>
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    <div className={cn('flex items-center gap-2', phaseConfig[node.status.phase].color)}>
                      <PhaseIcon className="w-4 h-4" />
                      <span className="text-sm font-medium">{phaseConfig[node.status.phase].label}</span>
                    </div>
                  </div>

                  {/* IP Address */}
                  <div className="col-span-2">
                    <p className="text-sm text-text-secondary font-mono">{node.managementIp}</p>
                  </div>

                  {/* CPU */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            cpuPercent >= 80 ? 'bg-error' : cpuPercent >= 60 ? 'bg-warning' : 'bg-success',
                          )}
                          style={{ width: `${cpuPercent}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-muted w-12">
                        {node.status.resources.cpuAllocatedCores}/{node.spec.cpu.totalCores}
                      </span>
                    </div>
                  </div>

                  {/* Memory */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-500',
                            memPercent >= 80 ? 'bg-error' : memPercent >= 60 ? 'bg-warning' : 'bg-success',
                          )}
                          style={{ width: `${memPercent}%` }}
                        />
                      </div>
                      <span className="text-xs text-text-muted w-16">
                        {formatBytes(node.status.resources.memoryAllocatedBytes)}
                      </span>
                    </div>
                  </div>

                  {/* VMs */}
                  <div className="col-span-1 text-right">
                    <span className="text-sm font-medium text-text-primary">{node.status.vmIds.length}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredHosts.length === 0 && (
        <div className="text-center py-12 bg-bg-surface rounded-xl border border-border">
          <Server className="w-12 h-12 mx-auto text-text-muted mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No Hosts Found</h3>
          <p className="text-text-muted mb-4">
            {searchQuery ? 'No hosts match your search criteria' : 'Add your first host to get started'}
          </p>
          {!searchQuery && (
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Add Host
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Host Card Component
function HostCard({
  node,
  index,
  onClick,
}: {
  node: Node;
  index: number;
  onClick: () => void;
}) {
  const cpuPercent = Math.round(
    (node.status.resources.cpuAllocatedCores / node.spec.cpu.totalCores) * 100
  );
  const memPercent = Math.round(
    (node.status.resources.memoryAllocatedBytes / node.spec.memory.totalBytes) * 100
  );
  const PhaseIcon = phaseConfig[node.status.phase].icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      onClick={onClick}
      className={cn(
        'bg-bg-surface rounded-xl border border-border p-5',
        'shadow-floating hover:shadow-elevated',
        'cursor-pointer transition-all duration-200',
        'group',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-10 h-10 rounded-lg flex items-center justify-center',
              'bg-bg-elevated group-hover:bg-accent/10',
              'transition-colors duration-150',
            )}
          >
            <Server className="w-5 h-5 text-text-muted group-hover:text-accent" />
          </div>
          <div>
            <h3 className="font-semibold text-text-primary group-hover:text-accent transition-colors">
              {node.hostname}
            </h3>
            <p className="text-sm text-text-muted font-mono">{node.managementIp}</p>
          </div>
        </div>
        <div className={cn('flex items-center gap-1.5', phaseConfig[node.status.phase].color)}>
          <PhaseIcon className="w-4 h-4" />
          <span className="text-sm font-medium">{phaseConfig[node.status.phase].label}</span>
        </div>
      </div>

      {/* Resource Bars */}
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-text-muted">CPU</span>
            <span className="text-text-secondary">
              {cpuPercent}% ({node.status.resources.cpuAllocatedCores} / {node.spec.cpu.totalCores} cores)
            </span>
          </div>
          <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                cpuPercent >= 80 ? 'bg-error' : cpuPercent >= 60 ? 'bg-warning' : 'bg-success',
              )}
              style={{ width: `${cpuPercent}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-text-muted">Memory</span>
            <span className="text-text-secondary">
              {memPercent}% ({formatBytes(node.status.resources.memoryAllocatedBytes)} /{' '}
              {formatBytes(node.spec.memory.totalBytes)})
            </span>
          </div>
          <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                memPercent >= 80 ? 'bg-error' : memPercent >= 60 ? 'bg-warning' : 'bg-success',
              )}
              style={{ width: `${memPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>VMs: {node.status.vmIds.length}</span>
          {node.labels['rack'] && <span>Rack: {node.labels['rack']}</span>}
          {node.labels['zone'] && <span>Zone: {node.labels['zone']}</span>}
        </div>
        <button
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

