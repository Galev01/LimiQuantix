import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  WifiOff,
  ArrowRight,
  Server,
  Cpu,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  MemoryStick,
  Play,
  RefreshCw,
  Settings,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

// DRS Recommendation types
type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low';
type RecommendationStatus = 'pending' | 'approved' | 'applied' | 'rejected';

interface DRSRecommendation {
  id: string;
  priority: RecommendationPriority;
  status: RecommendationStatus;
  type: 'migrate' | 'power_on' | 'power_off';
  reason: string;
  impact: {
    cpuImprovement: number;
    memoryImprovement: number;
  };
  vm: {
    id: string;
    name: string;
    currentCpu: number;
    currentMemory: number;
  };
  sourceHost: {
    id: string;
    name: string;
    cpuUsage: number;
    memoryUsage: number;
  };
  targetHost?: {
    id: string;
    name: string;
    cpuUsage: number;
    memoryUsage: number;
  };
  createdAt: Date;
  estimatedDuration: string;
}

// Mock recommendations
const mockRecommendations: DRSRecommendation[] = [
  {
    id: 'rec-1',
    priority: 'critical',
    status: 'pending',
    type: 'migrate',
    reason: 'Source host CPU at critical levels (92%). Migration will balance load.',
    impact: { cpuImprovement: 15, memoryImprovement: 8 },
    vm: { id: 'vm-1', name: 'db-master-01', currentCpu: 45, currentMemory: 32 },
    sourceHost: { id: 'host-1', name: 'node-gpu-01', cpuUsage: 92, memoryUsage: 88 },
    targetHost: { id: 'host-2', name: 'node-prod-04', cpuUsage: 45, memoryUsage: 52 },
    createdAt: new Date(Date.now() - 5 * 60 * 1000),
    estimatedDuration: '2-3 minutes',
  },
  {
    id: 'rec-2',
    priority: 'high',
    status: 'pending',
    type: 'migrate',
    reason: 'Memory imbalance detected. Recommend moving VM to optimize cluster memory distribution.',
    impact: { cpuImprovement: 5, memoryImprovement: 12 },
    vm: { id: 'vm-2', name: 'app-server-03', currentCpu: 28, currentMemory: 48 },
    sourceHost: { id: 'host-3', name: 'node-prod-03', cpuUsage: 85, memoryUsage: 82 },
    targetHost: { id: 'host-4', name: 'node-dev-01', cpuUsage: 32, memoryUsage: 41 },
    createdAt: new Date(Date.now() - 15 * 60 * 1000),
    estimatedDuration: '1-2 minutes',
  },
  {
    id: 'rec-3',
    priority: 'medium',
    status: 'approved',
    type: 'migrate',
    reason: 'Affinity rule optimization. Moving VM closer to related workloads.',
    impact: { cpuImprovement: 3, memoryImprovement: 2 },
    vm: { id: 'vm-3', name: 'cache-server-01', currentCpu: 15, currentMemory: 22 },
    sourceHost: { id: 'host-5', name: 'node-dev-02', cpuUsage: 28, memoryUsage: 35 },
    targetHost: { id: 'host-6', name: 'node-prod-01', cpuUsage: 72, memoryUsage: 68 },
    createdAt: new Date(Date.now() - 30 * 60 * 1000),
    estimatedDuration: '1 minute',
  },
  {
    id: 'rec-4',
    priority: 'low',
    status: 'applied',
    type: 'migrate',
    reason: 'Routine load balancing to optimize resource distribution.',
    impact: { cpuImprovement: 2, memoryImprovement: 3 },
    vm: { id: 'vm-4', name: 'web-frontend-02', currentCpu: 12, currentMemory: 18 },
    sourceHost: { id: 'host-7', name: 'node-prod-02', cpuUsage: 58, memoryUsage: 71 },
    targetHost: { id: 'host-8', name: 'node-dr-01', cpuUsage: 15, memoryUsage: 22 },
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    estimatedDuration: '1 minute',
  },
  {
    id: 'rec-5',
    priority: 'medium',
    status: 'rejected',
    type: 'migrate',
    reason: 'Power-saving mode recommendation. Consolidate VMs to reduce active hosts.',
    impact: { cpuImprovement: 0, memoryImprovement: 5 },
    vm: { id: 'vm-5', name: 'test-vm-01', currentCpu: 5, currentMemory: 8 },
    sourceHost: { id: 'host-9', name: 'node-dev-01', cpuUsage: 32, memoryUsage: 41 },
    targetHost: { id: 'host-10', name: 'node-dev-02', cpuUsage: 28, memoryUsage: 35 },
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    estimatedDuration: '30 seconds',
  },
];

// Priority config
const priorityConfig = {
  critical: { color: 'bg-error/10 text-error border-error/30', label: 'Critical' },
  high: { color: 'bg-warning/10 text-warning border-warning/30', label: 'High' },
  medium: { color: 'bg-accent/10 text-accent border-accent/30', label: 'Medium' },
  low: { color: 'bg-success/10 text-success border-success/30', label: 'Low' },
};

// Status config
const statusConfig = {
  pending: { icon: Clock, color: 'text-warning', label: 'Pending' },
  approved: { icon: CheckCircle, color: 'text-accent', label: 'Approved' },
  applied: { icon: CheckCircle, color: 'text-success', label: 'Applied' },
  rejected: { icon: XCircle, color: 'text-error', label: 'Rejected' },
};

// Host card component
function HostCard({ host, label }: { host: { name: string; cpuUsage: number; memoryUsage: number }; label: string }) {
  const getCpuColor = (usage: number) => {
    if (usage >= 85) return 'bg-error';
    if (usage >= 70) return 'bg-warning';
    return 'bg-accent';
  };

  return (
    <div className="bg-bg-base rounded-lg p-3 border border-border">
      <p className="text-text-muted text-xs mb-1">{label}</p>
      <div className="flex items-center gap-2 mb-2">
        <Server className="w-4 h-4 text-text-muted" />
        <span className="text-text-primary font-medium text-sm">{host.name}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Cpu className="w-3 h-3 text-text-muted" />
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', getCpuColor(host.cpuUsage))}
              style={{ width: `${host.cpuUsage}%` }}
            />
          </div>
          <span className="text-text-muted text-xs w-10 text-right">{host.cpuUsage}%</span>
        </div>
        <div className="flex items-center gap-2">
          <MemoryStick className="w-3 h-3 text-text-muted" />
          <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', getCpuColor(host.memoryUsage))}
              style={{ width: `${host.memoryUsage}%` }}
            />
          </div>
          <span className="text-text-muted text-xs w-10 text-right">{host.memoryUsage}%</span>
        </div>
      </div>
    </div>
  );
}

// Recommendation card
function RecommendationCard({
  recommendation,
  onApprove,
  onReject,
  onApply,
}: {
  recommendation: DRSRecommendation;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onApply: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const priority = priorityConfig[recommendation.priority];
  const status = statusConfig[recommendation.status];
  const StatusIcon = status.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'bg-bg-surface rounded-xl border transition-all overflow-hidden',
        recommendation.status === 'applied' && 'opacity-60',
        recommendation.status === 'rejected' && 'opacity-50',
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center gap-4 text-left hover:bg-bg-hover/50 transition-colors"
      >
        <motion.div
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronRight className="w-5 h-5 text-text-muted" />
        </motion.div>

        <div className={cn('p-2 rounded-lg', priority.color.split(' ')[0])}>
          <Zap className={cn('w-5 h-5', priority.color.split(' ')[1])} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-text-primary font-medium">
              Migrate {recommendation.vm.name}
            </span>
            <Badge variant={recommendation.priority === 'critical' ? 'error' : recommendation.priority === 'high' ? 'warning' : 'default'}>
              {priority.label}
            </Badge>
          </div>
          <p className="text-text-muted text-sm mt-0.5 truncate">{recommendation.reason}</p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right hidden sm:block">
            <div className="flex items-center gap-1 text-success text-sm">
              <TrendingUp className="w-4 h-4" />
              <span>+{recommendation.impact.cpuImprovement}% CPU</span>
            </div>
            <p className="text-text-muted text-xs">
              +{recommendation.impact.memoryImprovement}% Memory
            </p>
          </div>

          <div className={cn('flex items-center gap-1', status.color)}>
            <StatusIcon className="w-4 h-4" />
            <span className="text-sm font-medium">{status.label}</span>
          </div>
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border"
          >
            <div className="p-4 space-y-4">
              {/* Migration Flow */}
              <div className="flex items-center gap-4">
                <HostCard host={recommendation.sourceHost} label="Source Host" />
                <div className="flex flex-col items-center gap-1">
                  <ArrowRight className="w-6 h-6 text-accent" />
                  <span className="text-text-muted text-xs">{recommendation.estimatedDuration}</span>
                </div>
                {recommendation.targetHost && (
                  <HostCard host={recommendation.targetHost} label="Target Host" />
                )}
              </div>

              {/* VM Info */}
              <div className="bg-bg-base rounded-lg p-3 border border-border">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-text-muted" />
                    <span className="text-text-secondary text-sm">
                      VM: <span className="text-text-primary font-medium">{recommendation.vm.name}</span>
                    </span>
                  </div>
                  <span className="text-text-muted">|</span>
                  <span className="text-text-muted text-sm">
                    CPU: {recommendation.vm.currentCpu}%
                  </span>
                  <span className="text-text-muted text-sm">
                    Memory: {recommendation.vm.currentMemory}%
                  </span>
                </div>
              </div>

              {/* Impact Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-success/5 rounded-lg p-3 border border-success/20">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="w-4 h-4 text-success" />
                    <span className="text-success font-medium">Expected Improvement</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-text-secondary">
                      CPU: <span className="text-success">+{recommendation.impact.cpuImprovement}%</span>
                    </span>
                    <span className="text-text-secondary">
                      Memory: <span className="text-success">+{recommendation.impact.memoryImprovement}%</span>
                    </span>
                  </div>
                </div>
                <div className="bg-bg-base rounded-lg p-3 border border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="w-4 h-4 text-text-muted" />
                    <span className="text-text-secondary font-medium">Estimated Duration</span>
                  </div>
                  <p className="text-text-primary text-sm">{recommendation.estimatedDuration}</p>
                </div>
              </div>

              {/* Actions */}
              {recommendation.status === 'pending' && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => onReject(recommendation.id)}>
                    <XCircle className="w-4 h-4" />
                    Reject
                  </Button>
                  <Button variant="secondary" onClick={() => onApprove(recommendation.id)}>
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </Button>
                  <Button onClick={() => onApply(recommendation.id)}>
                    <Play className="w-4 h-4" />
                    Apply Now
                  </Button>
                </div>
              )}
              {recommendation.status === 'approved' && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => onReject(recommendation.id)}>
                    <XCircle className="w-4 h-4" />
                    Cancel
                  </Button>
                  <Button onClick={() => onApply(recommendation.id)}>
                    <Play className="w-4 h-4" />
                    Apply Now
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function DRSRecommendations() {
  const [recommendations, setRecommendations] = useState(mockRecommendations);
  const [filterStatus, setFilterStatus] = useState<RecommendationStatus | 'all'>('all');
  const [drsEnabled, setDrsEnabled] = useState(true);
  const [automationLevel] = useState<'manual' | 'partial' | 'full'>('partial');

  // Filter recommendations
  const filteredRecommendations = recommendations.filter((rec) => {
    if (filterStatus === 'all') return true;
    return rec.status === filterStatus;
  });

  // Stats
  const pendingCount = recommendations.filter((r) => r.status === 'pending').length;
  const approvedCount = recommendations.filter((r) => r.status === 'approved').length;
  const appliedCount = recommendations.filter((r) => r.status === 'applied').length;

  // Actions
  const handleApprove = (id: string) => {
    setRecommendations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'approved' as RecommendationStatus } : r)),
    );
  };

  const handleReject = (id: string) => {
    setRecommendations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'rejected' as RecommendationStatus } : r)),
    );
  };

  const handleApply = (id: string) => {
    setRecommendations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'applied' as RecommendationStatus } : r)),
    );
  };

  const handleApplyAll = () => {
    setRecommendations((prev) =>
      prev.map((r) =>
        r.status === 'pending' || r.status === 'approved'
          ? { ...r, status: 'applied' as RecommendationStatus }
          : r,
      ),
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">DRS Recommendations</h1>
            <p className="text-text-muted mt-1">
              Distributed Resource Scheduler optimization suggestions
            </p>
          </div>
          {/* DRS service not yet exposed via HTTP - using mock data */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-warning/20 text-warning border border-warning/30">
            <WifiOff className="w-3 h-3" />
            Mock Data
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <Settings className="w-4 h-4" />
            DRS Settings
          </Button>
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={handleApplyAll} disabled={pendingCount === 0 && approvedCount === 0}>
            <Play className="w-4 h-4" />
            Apply All ({pendingCount + approvedCount})
          </Button>
        </div>
      </div>

      {/* DRS Status */}
      <div className="bg-bg-surface rounded-xl p-5 border border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={cn('p-3 rounded-lg', drsEnabled ? 'bg-success/10' : 'bg-bg-hover')}>
              <Zap className={cn('w-6 h-6', drsEnabled ? 'text-success' : 'text-text-muted')} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                DRS is {drsEnabled ? 'Enabled' : 'Disabled'}
              </h3>
              <p className="text-text-muted text-sm">
                Automation Level:{' '}
                <span className="text-text-secondary capitalize">{automationLevel}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-text-muted text-sm">Pending Recommendations</p>
              <p className="text-2xl font-bold text-text-primary">{pendingCount}</p>
            </div>
            <div className="text-right">
              <p className="text-text-muted text-sm">Applied Today</p>
              <p className="text-2xl font-bold text-success">{appliedCount}</p>
            </div>
            <button
              onClick={() => setDrsEnabled(!drsEnabled)}
              className={cn(
                'relative w-12 h-6 rounded-full transition-colors',
                drsEnabled ? 'bg-success' : 'bg-bg-hover',
              )}
            >
              <motion.div
                animate={{ x: drsEnabled ? 24 : 0 }}
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-md"
              />
            </button>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'pending', 'approved', 'applied', 'rejected'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all',
              filterStatus === status
                ? 'bg-accent text-white'
                : 'bg-bg-surface text-text-muted hover:text-text-primary border border-border',
            )}
          >
            {status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)}
            {status === 'pending' && pendingCount > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded-full bg-warning/20 text-warning text-xs">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Recommendations List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filteredRecommendations.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 bg-bg-surface rounded-xl border border-border"
            >
              <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
              <h3 className="text-lg font-medium text-text-primary">No recommendations</h3>
              <p className="text-text-muted mt-1">
                Your cluster is optimally balanced
              </p>
            </motion.div>
          ) : (
            filteredRecommendations.map((rec) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                onApprove={handleApprove}
                onReject={handleReject}
                onApply={handleApply}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

