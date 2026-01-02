import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Plus,
  RefreshCw,
  Search,
  MoreVertical,
  ChevronDown,
  ChevronRight,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  X,
  Edit,
  Trash2,
  Copy,
  MonitorCog,
  Globe,
  Lock,
  Unlock,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useSecurityGroups, useDeleteSecurityGroup, type ApiSecurityGroup } from '@/hooks/useSecurityGroups';
import { useApiConnection } from '@/hooks/useDashboard';

interface SecurityRule {
  id: string;
  direction: 'INGRESS' | 'EGRESS';
  protocol: 'TCP' | 'UDP' | 'ICMP' | 'ANY';
  portRange: string;
  source: string;
  action: 'ALLOW' | 'DENY';
  description: string;
}

interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  attachedVMs: number;
  rules: SecurityRule[];
  createdAt: string;
}

const mockSecurityGroups: SecurityGroup[] = [
  {
    id: 'sg-default',
    name: 'default',
    description: 'Default security group - allows all outbound, denies all inbound',
    isDefault: true,
    attachedVMs: 12,
    rules: [
      {
        id: 'rule-1',
        direction: 'EGRESS',
        protocol: 'ANY',
        portRange: 'All',
        source: '0.0.0.0/0',
        action: 'ALLOW',
        description: 'Allow all outbound traffic',
      },
      {
        id: 'rule-2',
        direction: 'INGRESS',
        protocol: 'ANY',
        portRange: 'All',
        source: 'sg-default',
        action: 'ALLOW',
        description: 'Allow traffic from same security group',
      },
    ],
    createdAt: '2024-01-01',
  },
  {
    id: 'sg-web',
    name: 'web-servers',
    description: 'Security group for public-facing web servers',
    isDefault: false,
    attachedVMs: 8,
    rules: [
      {
        id: 'rule-3',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '80',
        source: '0.0.0.0/0',
        action: 'ALLOW',
        description: 'HTTP from anywhere',
      },
      {
        id: 'rule-4',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '443',
        source: '0.0.0.0/0',
        action: 'ALLOW',
        description: 'HTTPS from anywhere',
      },
      {
        id: 'rule-5',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '22',
        source: '10.0.0.0/8',
        action: 'ALLOW',
        description: 'SSH from internal networks',
      },
      {
        id: 'rule-6',
        direction: 'EGRESS',
        protocol: 'ANY',
        portRange: 'All',
        source: '0.0.0.0/0',
        action: 'ALLOW',
        description: 'Allow all outbound',
      },
    ],
    createdAt: '2024-02-15',
  },
  {
    id: 'sg-db',
    name: 'database-servers',
    description: 'Security group for database servers - restricted access',
    isDefault: false,
    attachedVMs: 4,
    rules: [
      {
        id: 'rule-7',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '5432',
        source: 'sg-web',
        action: 'ALLOW',
        description: 'PostgreSQL from web servers',
      },
      {
        id: 'rule-8',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '3306',
        source: 'sg-web',
        action: 'ALLOW',
        description: 'MySQL from web servers',
      },
      {
        id: 'rule-9',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '22',
        source: '10.0.0.0/8',
        action: 'ALLOW',
        description: 'SSH from internal',
      },
      {
        id: 'rule-10',
        direction: 'EGRESS',
        protocol: 'ANY',
        portRange: 'All',
        source: '0.0.0.0/0',
        action: 'ALLOW',
        description: 'Allow all outbound',
      },
    ],
    createdAt: '2024-02-20',
  },
  {
    id: 'sg-bastion',
    name: 'bastion-hosts',
    description: 'Security group for bastion/jump hosts',
    isDefault: false,
    attachedVMs: 2,
    rules: [
      {
        id: 'rule-11',
        direction: 'INGRESS',
        protocol: 'TCP',
        portRange: '22',
        source: '0.0.0.0/0',
        action: 'ALLOW',
        description: 'SSH from anywhere',
      },
      {
        id: 'rule-12',
        direction: 'EGRESS',
        protocol: 'TCP',
        portRange: '22',
        source: '10.0.0.0/8',
        action: 'ALLOW',
        description: 'SSH to internal hosts',
      },
    ],
    createdAt: '2024-03-01',
  },
];

// Convert API security group to display format
function apiToDisplaySecurityGroup(sg: ApiSecurityGroup): SecurityGroup {
  return {
    id: sg.id,
    name: sg.name,
    description: sg.description || '',
    isDefault: sg.name === 'default',
    attachedVMs: 0, // API doesn't provide this yet
    rules: (sg.rules || []).map((rule) => ({
      id: rule.id || '',
      direction: rule.direction || 'INGRESS',
      protocol: (rule.protocol?.toUpperCase() as 'TCP' | 'UDP' | 'ICMP' | 'ANY') || 'ANY',
      portRange: rule.portRangeMin && rule.portRangeMax
        ? rule.portRangeMin === rule.portRangeMax
          ? String(rule.portRangeMin)
          : `${rule.portRangeMin}-${rule.portRangeMax}`
        : 'All',
      source: rule.remoteIpPrefix || rule.remoteGroupId || '0.0.0.0/0',
      action: 'ALLOW' as const,
      description: '',
    })),
    createdAt: sg.createdAt || new Date().toISOString(),
  };
}

export function SecurityGroups() {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['sg-web']));

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiResponse, isLoading, refetch, isRefetching } = useSecurityGroups({ enabled: !!isConnected });
  const deleteSG = useDeleteSecurityGroup();

  // Determine data source
  const apiGroups = apiResponse?.securityGroups || [];
  const useMockData = !isConnected || apiGroups.length === 0;
  const allGroups: SecurityGroup[] = useMockData ? mockSecurityGroups : apiGroups.map(apiToDisplaySecurityGroup);

  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const filteredGroups = allGroups.filter((sg) =>
    sg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sg.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate totals
  const totals = {
    groups: allGroups.length,
    rules: allGroups.reduce((sum, sg) => sum + sg.rules.length, 0),
    vms: allGroups.reduce((sum, sg) => sum + sg.attachedVMs, 0),
  };

  // Handle delete
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this security group?')) return;
    if (useMockData) {
      console.log('Mock: Delete security group', id);
      return;
    }
    try {
      await deleteSG.mutateAsync(id);
    } catch (err) {
      console.error('Failed to delete security group:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Security Groups</h1>
          <p className="text-text-muted mt-1">Manage firewall rules and network access control</p>
        </div>
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
            isConnected
              ? 'bg-success/20 text-success border border-success/30'
              : 'bg-warning/20 text-warning border border-warning/30',
          )}
        >
          {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isConnected ? 'Connected' : 'Mock Data'}
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => refetch()}
            disabled={isRefetching || isLoading}
          >
            <RefreshCw className={cn('w-4 h-4', (isRefetching || isLoading) && 'animate-spin')} />
            Refresh
          </Button>
          <Button>
            <Plus className="w-4 h-4" />
            New Security Group
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          title="Security Groups"
          value={totals.groups}
          icon={<Shield className="w-5 h-5" />}
          color="blue"
        />
        <SummaryCard
          title="Total Rules"
          value={totals.rules}
          icon={<Lock className="w-5 h-5" />}
          color="purple"
        />
        <SummaryCard
          title="Protected VMs"
          value={totals.vms}
          icon={<MonitorCog className="w-5 h-5" />}
          color="green"
        />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search security groups..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="form-input pl-10"
        />
      </div>

      {/* Security Groups List */}
      <div className="space-y-4">
        {filteredGroups.map((sg, index) => (
          <SecurityGroupCard
            key={sg.id}
            group={sg}
            index={index}
            isExpanded={expandedGroups.has(sg.id)}
            onToggle={() => toggleGroup(sg.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'green' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    purple: 'bg-purple-500/10 text-purple-400',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-bg-surface border border-border shadow-floating"
    >
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', colorClasses[color])}>{icon}</div>
        <div>
          <p className="text-sm text-text-muted">{title}</p>
          <p className="text-xl font-bold text-text-primary">{value}</p>
        </div>
      </div>
    </motion.div>
  );
}

function SecurityGroupCard({
  group,
  index,
  isExpanded,
  onToggle,
}: {
  group: SecurityGroup;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const ingressRules = group.rules.filter((r) => r.direction === 'INGRESS');
  const egressRules = group.rules.filter((r) => r.direction === 'EGRESS');

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      className="rounded-xl bg-bg-surface border border-border overflow-hidden"
    >
      {/* Header */}
      <div
        onClick={onToggle}
        className="flex items-center gap-4 p-4 cursor-pointer hover:bg-bg-hover transition-colors"
      >
        <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight className="w-5 h-5 text-text-muted" />
        </motion.div>
        
        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-accent" />
        </div>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-text-primary">{group.name}</h3>
            {group.isDefault && <Badge variant="info">Default</Badge>}
          </div>
          <p className="text-sm text-text-muted">{group.description}</p>
        </div>

        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <p className="text-text-muted">Inbound</p>
            <p className="font-medium text-text-primary">{ingressRules.length} rules</p>
          </div>
          <div className="text-center">
            <p className="text-text-muted">Outbound</p>
            <p className="font-medium text-text-primary">{egressRules.length} rules</p>
          </div>
          <div className="text-center">
            <p className="text-text-muted">VMs</p>
            <p className="font-medium text-text-primary">{group.attachedVMs}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <Copy className="w-4 h-4" />
          </button>
          {!group.isDefault && (
            <button
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="p-1.5 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded Rules */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4 bg-bg-base">
              {/* Inbound Rules */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <ArrowDownLeft className="w-4 h-4 text-info" />
                  <h4 className="font-medium text-text-primary">Inbound Rules</h4>
                  <Button variant="ghost" size="sm">
                    <Plus className="w-3 h-3" />
                    Add Rule
                  </Button>
                </div>
                {ingressRules.length > 0 ? (
                  <RulesTable rules={ingressRules} />
                ) : (
                  <p className="text-sm text-text-muted italic">No inbound rules defined</p>
                )}
              </div>

              {/* Outbound Rules */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ArrowUpRight className="w-4 h-4 text-success" />
                  <h4 className="font-medium text-text-primary">Outbound Rules</h4>
                  <Button variant="ghost" size="sm">
                    <Plus className="w-3 h-3" />
                    Add Rule
                  </Button>
                </div>
                {egressRules.length > 0 ? (
                  <RulesTable rules={egressRules} />
                ) : (
                  <p className="text-sm text-text-muted italic">No outbound rules defined</p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function RulesTable({ rules }: { rules: SecurityRule[] }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-bg-elevated">
            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">Protocol</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">Port Range</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">Source/Dest</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">Action</th>
            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">Description</th>
            <th className="text-right py-2 px-3 text-xs font-medium text-text-muted"></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} className="border-t border-border hover:bg-bg-hover transition-colors">
              <td className="py-2 px-3">
                <Badge variant="default">{rule.protocol}</Badge>
              </td>
              <td className="py-2 px-3">
                <code className="text-sm text-accent">{rule.portRange}</code>
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-1">
                  {rule.source.startsWith('sg-') ? (
                    <>
                      <Shield className="w-3 h-3 text-accent" />
                      <span className="text-sm text-accent">{rule.source}</span>
                    </>
                  ) : rule.source === '0.0.0.0/0' ? (
                    <>
                      <Globe className="w-3 h-3 text-warning" />
                      <span className="text-sm text-text-secondary">Anywhere</span>
                    </>
                  ) : (
                    <span className="text-sm text-text-secondary font-mono">{rule.source}</span>
                  )}
                </div>
              </td>
              <td className="py-2 px-3">
                <Badge variant={rule.action === 'ALLOW' ? 'success' : 'error'}>
                  {rule.action === 'ALLOW' ? (
                    <Check className="w-3 h-3 mr-1" />
                  ) : (
                    <X className="w-3 h-3 mr-1" />
                  )}
                  {rule.action}
                </Badge>
              </td>
              <td className="py-2 px-3">
                <span className="text-sm text-text-muted">{rule.description}</span>
              </td>
              <td className="py-2 px-3 text-right">
                <button className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text-primary">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

