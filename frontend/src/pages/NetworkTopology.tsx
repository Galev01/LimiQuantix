/**
 * NetworkTopologyPage - Full-page network topology visualization
 * 
 * Provides an interactive view of the SDN topology including:
 * - Virtual networks
 * - Routers
 * - VMs and their connections
 * - Load balancers
 * - Security group associations
 * 
 * @see docs/Networking/000070-quantumnet-implementation-plan.md
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Network,
  Filter,
  Search,
  Plus,
  Download,
  RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';

import { NetworkTopology } from '../components/network/NetworkTopology';

// =============================================================================
// TYPES
// =============================================================================

interface FilterState {
  projectId: string;
  networkType: 'all' | 'overlay' | 'vlan' | 'external';
  showVMs: boolean;
  showLoadBalancers: boolean;
  showSecurityGroups: boolean;
  searchQuery: string;
}

// =============================================================================
// FILTER PANEL
// =============================================================================

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
}

function FilterPanel({ filters, onChange }: FilterPanelProps) {
  return (
    <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4 space-y-4">
      <div className="flex items-center gap-2 text-text-primary font-medium">
        <Filter className="w-4 h-4" />
        Filters
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search networks..."
          value={filters.searchQuery}
          onChange={(e) => onChange({ ...filters, searchQuery: e.target.value })}
          className="w-full pl-9 pr-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </div>

      {/* Network Type */}
      <div className="space-y-2">
        <label className="text-sm text-text-secondary">Network Type</label>
        <select
          value={filters.networkType}
          onChange={(e) => onChange({ ...filters, networkType: e.target.value as FilterState['networkType'] })}
          className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="all">All Types</option>
          <option value="overlay">Overlay</option>
          <option value="vlan">VLAN</option>
          <option value="external">External</option>
        </select>
      </div>

      {/* Show/Hide toggles */}
      <div className="space-y-2">
        <label className="text-sm text-text-secondary">Display</label>
        
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showVMs}
            onChange={(e) => onChange({ ...filters, showVMs: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--border)] text-accent focus:ring-accent/20"
          />
          <span className="text-sm text-text-primary">Show VMs</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showLoadBalancers}
            onChange={(e) => onChange({ ...filters, showLoadBalancers: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--border)] text-accent focus:ring-accent/20"
          />
          <span className="text-sm text-text-primary">Show Load Balancers</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.showSecurityGroups}
            onChange={(e) => onChange({ ...filters, showSecurityGroups: e.target.checked })}
            className="w-4 h-4 rounded border-[var(--border)] text-accent focus:ring-accent/20"
          />
          <span className="text-sm text-text-primary">Show Security Groups</span>
        </label>
      </div>
    </div>
  );
}

// =============================================================================
// QUICK ACTIONS
// =============================================================================

function QuickActions() {
  return (
    <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4 space-y-3">
      <div className="text-text-primary font-medium">Quick Actions</div>

      <button className="w-full flex items-center gap-2 px-3 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-sm transition-colors">
        <Plus className="w-4 h-4" />
        Create Network
      </button>

      <button className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-text-primary rounded-lg text-sm transition-colors">
        <Download className="w-4 h-4" />
        Export Topology
      </button>
    </div>
  );
}

// =============================================================================
// STATISTICS
// =============================================================================

interface StatCardProps {
  label: string;
  value: number;
  color: string;
}

function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] p-3">
      <div className="text-2xl font-bold text-text-primary" style={{ color }}>
        {value}
      </div>
      <div className="text-xs text-text-secondary">{label}</div>
    </div>
  );
}

function Statistics() {
  const stats = [
    { label: 'Networks', value: 3, color: 'var(--accent)' },
    { label: 'VMs', value: 4, color: 'var(--success)' },
    { label: 'Routers', value: 1, color: '#a855f7' },
    { label: 'Load Balancers', value: 1, color: '#06b6d4' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export function NetworkTopologyPage() {
  const [filters, setFilters] = useState<FilterState>({
    projectId: 'default',
    networkType: 'all',
    showVMs: true,
    showLoadBalancers: true,
    showSecurityGroups: false,
    searchQuery: '',
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<string | null>(null);

  const handleNodeSelect = (nodeId: string, type: string) => {
    setSelectedNodeId(nodeId);
    setSelectedNodeType(type);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/10">
            <Network className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Network Topology</h1>
            <p className="text-sm text-text-secondary">
              Visualize your SDN infrastructure
            </p>
          </div>
        </div>

        <button className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg text-sm text-text-primary transition-colors">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-[280px_1fr] gap-6">
        {/* Sidebar */}
        <div className="space-y-4">
          <Statistics />
          <FilterPanel filters={filters} onChange={setFilters} />
          <QuickActions />
        </div>

        {/* Topology Canvas */}
        <div className="min-h-0">
          <NetworkTopology
            projectId={filters.projectId}
            onNodeSelect={handleNodeSelect}
            className="h-full"
          />

          {/* Selected node info bar */}
          {selectedNodeId && selectedNodeType && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 px-4 py-3 bg-[var(--bg-surface)] rounded-lg border border-[var(--border)] flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-secondary text-sm">Selected:</span>
                <span className="text-text-primary font-medium">{selectedNodeId}</span>
                <span className={clsx(
                  'px-2 py-0.5 text-xs rounded capitalize',
                  'bg-accent/10 text-accent'
                )}>
                  {selectedNodeType}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button className="px-3 py-1.5 text-sm bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors">
                  View Details
                </button>
                <button className="px-3 py-1.5 text-sm bg-accent hover:bg-accent/90 text-white rounded-lg transition-colors">
                  Edit
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default NetworkTopologyPage;
