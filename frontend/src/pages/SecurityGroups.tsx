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
  Ban,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { 
  useSecurityGroups, 
  useDeleteSecurityGroup, 
  useCreateSecurityGroup,
  useUpdateSecurityGroup,
  useAddSecurityGroupRule,
  useRemoveSecurityGroupRule,
  type ApiSecurityGroup 
} from '@/hooks/useSecurityGroups';
import { useApiConnection } from '@/hooks/useDashboard';
import { showInfo, showSuccess } from '@/lib/toast';
import { uiLogger } from '@/lib/uiLogger';

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddRuleModal, setShowAddRuleModal] = useState<{ groupId: string; direction: 'INGRESS' | 'EGRESS' } | null>(null);
  const [editingGroup, setEditingGroup] = useState<SecurityGroup | null>(null);
  const [editingRule, setEditingRule] = useState<{ groupId: string; rule: SecurityRule } | null>(null);
  const [ruleMenuOpen, setRuleMenuOpen] = useState<string | null>(null);

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiResponse, isLoading, refetch, isRefetching } = useSecurityGroups({ enabled: !!isConnected });
  const deleteSG = useDeleteSecurityGroup();
  const createSG = useCreateSecurityGroup();
  const updateSG = useUpdateSecurityGroup();
  const addRule = useAddSecurityGroupRule();
  const removeRule = useRemoveSecurityGroupRule();

  // Use only API data (no mock fallback)
  const apiGroups = apiResponse?.securityGroups || [];
  const allGroups: SecurityGroup[] = apiGroups.map(apiToDisplaySecurityGroup);

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
  const handleDelete = async (id: string, name: string) => {
    uiLogger.click('security-group', 'delete-sg', { id, name });
    if (!confirm(`Are you sure you want to delete security group "${name}"?`)) return;
    await deleteSG.mutateAsync(id);
  };

  // Handle create
  const handleCreate = async (data: { name: string; description: string }) => {
    uiLogger.click('security-group', 'create-sg', { name: data.name });
    await createSG.mutateAsync({ 
      name: data.name, 
      projectId: 'default', 
      description: data.description 
    });
    setShowCreateModal(false);
  };

  // Handle add rule
  const handleAddRule = async (rule: { 
    protocol: string; 
    portRangeMin?: number; 
    portRangeMax?: number; 
    remoteIpPrefix?: string;
    action?: 'ALLOW' | 'DENY';
  }) => {
    if (!showAddRuleModal) return;
    uiLogger.click('security-group', 'add-rule', { groupId: showAddRuleModal.groupId, direction: showAddRuleModal.direction });
    await addRule.mutateAsync({
      securityGroupId: showAddRuleModal.groupId,
      rule: {
        direction: showAddRuleModal.direction,
        ...rule,
      },
    });
    setShowAddRuleModal(null);
  };

  // Handle delete rule
  const handleDeleteRule = async (groupId: string, ruleId: string) => {
    uiLogger.click('security-group', 'delete-rule', { groupId, ruleId });
    if (!confirm('Are you sure you want to delete this rule?')) return;
    await removeRule.mutateAsync({ securityGroupId: groupId, ruleId });
    setRuleMenuOpen(null);
  };

  // Handle edit rule (delete old + add new)
  const handleEditRule = async (rule: { 
    protocol: string; 
    portRangeMin?: number; 
    portRangeMax?: number; 
    remoteIpPrefix?: string;
    action?: 'ALLOW' | 'DENY';
  }) => {
    if (!editingRule) return;
    uiLogger.click('security-group', 'edit-rule', { groupId: editingRule.groupId, ruleId: editingRule.rule.id });
    // Remove old rule first
    await removeRule.mutateAsync({ 
      securityGroupId: editingRule.groupId, 
      ruleId: editingRule.rule.id 
    });
    // Add new rule with updated values
    await addRule.mutateAsync({
      securityGroupId: editingRule.groupId,
      rule: {
        direction: editingRule.rule.direction,
        ...rule,
      },
    });
    setEditingRule(null);
  };

  // Handle edit
  const handleEdit = async (data: { name: string; description: string }) => {
    if (!editingGroup) return;
    uiLogger.click('security-group', 'update-sg', { id: editingGroup.id, name: data.name });
    await updateSG.mutateAsync({ 
      id: editingGroup.id, 
      name: data.name, 
      description: data.description 
    });
    setEditingGroup(null);
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
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4" />
            New Security Group
          </Button>
        </div>
      </div>

      {/* Create Security Group Modal */}
      <CreateSecurityGroupModal 
        open={showCreateModal} 
        onClose={() => setShowCreateModal(false)} 
        onSubmit={handleCreate}
        isLoading={createSG.isPending}
      />

      {/* Add Rule Modal */}
      <AddRuleModal
        open={!!showAddRuleModal}
        direction={showAddRuleModal?.direction || 'INGRESS'}
        onClose={() => setShowAddRuleModal(null)}
        onSubmit={handleAddRule}
        isLoading={addRule.isPending}
      />

      {/* Edit Security Group Modal */}
      <EditSecurityGroupModal
        open={!!editingGroup}
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onSubmit={handleEdit}
        isLoading={updateSG.isPending}
      />

      {/* Edit Rule Modal */}
      <EditRuleModal
        open={!!editingRule}
        rule={editingRule?.rule || null}
        onClose={() => setEditingRule(null)}
        onSubmit={handleEditRule}
        isLoading={addRule.isPending || removeRule.isPending}
      />

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
            onEdit={() => setEditingGroup(sg)}
            onDelete={() => handleDelete(sg.id, sg.name)}
            onAddRule={(direction) => setShowAddRuleModal({ groupId: sg.id, direction })}
            onEditRule={(rule) => setEditingRule({ groupId: sg.id, rule })}
            onDeleteRule={(ruleId) => handleDeleteRule(sg.id, ruleId)}
            ruleMenuOpen={ruleMenuOpen}
            onRuleMenuToggle={(ruleId) => setRuleMenuOpen(ruleMenuOpen === ruleId ? null : ruleId)}
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
  onEdit,
  onDelete,
  onAddRule,
  onEditRule,
  onDeleteRule,
  ruleMenuOpen,
  onRuleMenuToggle,
}: {
  group: SecurityGroup;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddRule: (direction: 'INGRESS' | 'EGRESS') => void;
  onEditRule: (rule: SecurityRule) => void;
  onDeleteRule: (ruleId: string) => void;
  ruleMenuOpen: string | null;
  onRuleMenuToggle: (ruleId: string) => void;
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
              onEdit();
            }}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title="Edit security group"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              showInfo('Clone functionality coming soon');
            }}
            className="p-1.5 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title="Clone security group"
          >
            <Copy className="w-4 h-4" />
          </button>
          {!group.isDefault && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 rounded-md hover:bg-error/10 text-text-muted hover:text-error transition-colors"
              title="Delete security group"
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
                  <Button variant="ghost" size="sm" onClick={() => onAddRule('INGRESS')}>
                    <Plus className="w-3 h-3" />
                    Add Rule
                  </Button>
                </div>
                {ingressRules.length > 0 ? (
                  <RulesTable 
                    rules={ingressRules}
                    onEdit={onEditRule}
                    onDelete={onDeleteRule}
                    menuOpen={ruleMenuOpen}
                    onMenuToggle={onRuleMenuToggle}
                  />
                ) : (
                  <p className="text-sm text-text-muted italic">No inbound rules defined</p>
                )}
              </div>

              {/* Outbound Rules */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ArrowUpRight className="w-4 h-4 text-success" />
                  <h4 className="font-medium text-text-primary">Outbound Rules</h4>
                  <Button variant="ghost" size="sm" onClick={() => onAddRule('EGRESS')}>
                    <Plus className="w-3 h-3" />
                    Add Rule
                  </Button>
                </div>
                {egressRules.length > 0 ? (
                  <RulesTable 
                    rules={egressRules}
                    onEdit={onEditRule}
                    onDelete={onDeleteRule}
                    menuOpen={ruleMenuOpen}
                    onMenuToggle={onRuleMenuToggle}
                  />
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

function RulesTable({ 
  rules,
  onEdit,
  onDelete,
  menuOpen,
  onMenuToggle,
}: { 
  rules: SecurityRule[];
  onEdit: (rule: SecurityRule) => void;
  onDelete: (ruleId: string) => void;
  menuOpen: string | null;
  onMenuToggle: (ruleId: string) => void;
}) {
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
                    <ShieldCheck className="w-3 h-3 mr-1" />
                  ) : (
                    <ShieldX className="w-3 h-3 mr-1" />
                  )}
                  {rule.action}
                </Badge>
              </td>
              <td className="py-2 px-3">
                <span className="text-sm text-text-muted">{rule.description}</span>
              </td>
              <td className="py-2 px-3 text-right relative">
                <button 
                  className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text-primary"
                  onClick={() => onMenuToggle(rule.id)}
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                
                {/* Dropdown menu */}
                <AnimatePresence>
                  {menuOpen === rule.id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 top-full mt-1 z-10 bg-bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[120px]"
                    >
                      <button
                        onClick={() => {
                          onEdit(rule);
                          onMenuToggle(rule.id);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-bg-hover transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          onDelete(rule.id);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// MODALS
// =============================================================================

function CreateSecurityGroupModal({
  open,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  // Reset form when modal closes
  const handleClose = () => {
    setName('');
    setDescription('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-text-primary mb-4">Create Security Group</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., web-servers"
              className="form-input w-full"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="form-input w-full h-20 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function AddRuleModal({
  open,
  direction,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  direction: 'INGRESS' | 'EGRESS';
  onClose: () => void;
  onSubmit: (rule: { protocol: string; portRangeMin?: number; portRangeMax?: number; remoteIpPrefix?: string; action?: 'ALLOW' | 'DENY' }) => void;
  isLoading: boolean;
}) {
  const [protocol, setProtocol] = useState('tcp');
  const [portMin, setPortMin] = useState('');
  const [portMax, setPortMax] = useState('');
  const [remoteIp, setRemoteIp] = useState('0.0.0.0/0');
  const [action, setAction] = useState<'ALLOW' | 'DENY'>('ALLOW');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      protocol,
      portRangeMin: portMin ? parseInt(portMin, 10) : undefined,
      portRangeMax: portMax ? parseInt(portMax, 10) : (portMin ? parseInt(portMin, 10) : undefined),
      remoteIpPrefix: remoteIp || undefined,
      action,
    });
  };

  // Reset form when modal closes
  const handleClose = () => {
    setProtocol('tcp');
    setPortMin('');
    setPortMax('');
    setRemoteIp('0.0.0.0/0');
    setAction('ALLOW');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-text-primary mb-1">
          Add {direction === 'INGRESS' ? 'Inbound' : 'Outbound'} Rule
        </h2>
        <p className="text-sm text-text-muted mb-4">
          Configure traffic {action === 'ALLOW' ? 'allowed' : 'denied'} for this rule
        </p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Action Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Action</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction('ALLOW')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-colors',
                  action === 'ALLOW'
                    ? 'bg-success/20 border-success text-success'
                    : 'bg-bg-base border-border text-text-muted hover:bg-bg-hover'
                )}
              >
                <ShieldCheck className="w-4 h-4" />
                Allow
              </button>
              <button
                type="button"
                onClick={() => setAction('DENY')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-colors',
                  action === 'DENY'
                    ? 'bg-error/20 border-error text-error'
                    : 'bg-bg-base border-border text-text-muted hover:bg-bg-hover'
                )}
              >
                <ShieldX className="w-4 h-4" />
                Deny
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Protocol</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="form-input w-full"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
              <option value="any">Any</option>
            </select>
          </div>

          {protocol !== 'icmp' && protocol !== 'any' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Port (from)</label>
                <input
                  type="number"
                  value={portMin}
                  onChange={(e) => setPortMin(e.target.value)}
                  placeholder="e.g., 22"
                  className="form-input w-full"
                  min="1"
                  max="65535"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Port (to)</label>
                <input
                  type="number"
                  value={portMax}
                  onChange={(e) => setPortMax(e.target.value)}
                  placeholder="Same as from"
                  className="form-input w-full"
                  min="1"
                  max="65535"
                />
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {direction === 'INGRESS' ? 'Source CIDR' : 'Destination CIDR'}
            </label>
            <input
              type="text"
              value={remoteIp}
              onChange={(e) => setRemoteIp(e.target.value)}
              placeholder="0.0.0.0/0 (anywhere)"
              className="form-input w-full"
            />
            <p className="text-xs text-text-muted mt-1">Use 0.0.0.0/0 for anywhere, or specify a CIDR like 10.0.0.0/8</p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Rule
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function EditSecurityGroupModal({
  open,
  group,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  group: SecurityGroup | null;
  onClose: () => void;
  onSubmit: (data: { name: string; description: string }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Update form when group changes
  useState(() => {
    if (group) {
      setName(group.name);
      setDescription(group.description);
    }
  });

  // Reset form when modal opens with a new group
  if (open && group && name !== group.name && description !== group.description) {
    setName(group.name);
    setDescription(group.description);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    onClose();
  };

  if (!open || !group) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-text-primary mb-4">Edit Security Group</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., web-servers"
              className="form-input w-full"
              autoFocus
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="form-input w-full h-20 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit className="w-4 h-4" />}
              Save Changes
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function EditRuleModal({
  open,
  rule,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  rule: SecurityRule | null;
  onClose: () => void;
  onSubmit: (rule: { protocol: string; portRangeMin?: number; portRangeMax?: number; remoteIpPrefix?: string; action?: 'ALLOW' | 'DENY' }) => void;
  isLoading: boolean;
}) {
  const [protocol, setProtocol] = useState('tcp');
  const [portMin, setPortMin] = useState('');
  const [portMax, setPortMax] = useState('');
  const [remoteIp, setRemoteIp] = useState('0.0.0.0/0');
  const [action, setAction] = useState<'ALLOW' | 'DENY'>('ALLOW');

  // Initialize form when rule changes
  if (open && rule) {
    const ruleProtocol = rule.protocol.toLowerCase();
    if (protocol !== ruleProtocol) setProtocol(ruleProtocol);
    
    // Parse port range
    if (rule.portRange && rule.portRange !== 'All') {
      const parts = rule.portRange.split('-');
      if (parts[0] && portMin !== parts[0]) setPortMin(parts[0]);
      if (parts[1] && portMax !== parts[1]) setPortMax(parts[1]);
      else if (parts[0] && portMax !== parts[0]) setPortMax(parts[0]);
    }
    
    if (rule.source && remoteIp !== rule.source) setRemoteIp(rule.source);
    if (rule.action && action !== rule.action) setAction(rule.action);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      protocol,
      portRangeMin: portMin ? parseInt(portMin, 10) : undefined,
      portRangeMax: portMax ? parseInt(portMax, 10) : (portMin ? parseInt(portMin, 10) : undefined),
      remoteIpPrefix: remoteIp || undefined,
      action,
    });
  };

  const handleClose = () => {
    setProtocol('tcp');
    setPortMin('');
    setPortMax('');
    setRemoteIp('0.0.0.0/0');
    setAction('ALLOW');
    onClose();
  };

  if (!open || !rule) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative bg-bg-surface rounded-xl border border-border shadow-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-text-primary mb-1">
          Edit {rule.direction === 'INGRESS' ? 'Inbound' : 'Outbound'} Rule
        </h2>
        <p className="text-sm text-text-muted mb-4">
          Modify the rule configuration
        </p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Action Selection */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">Action</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAction('ALLOW')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-colors',
                  action === 'ALLOW'
                    ? 'bg-success/20 border-success text-success'
                    : 'bg-bg-base border-border text-text-muted hover:bg-bg-hover'
                )}
              >
                <ShieldCheck className="w-4 h-4" />
                Allow
              </button>
              <button
                type="button"
                onClick={() => setAction('DENY')}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border transition-colors',
                  action === 'DENY'
                    ? 'bg-error/20 border-error text-error'
                    : 'bg-bg-base border-border text-text-muted hover:bg-bg-hover'
                )}
              >
                <ShieldX className="w-4 h-4" />
                Deny
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Protocol</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="form-input w-full"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
              <option value="any">Any</option>
            </select>
          </div>

          {protocol !== 'icmp' && protocol !== 'any' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Port (from)</label>
                <input
                  type="number"
                  value={portMin}
                  onChange={(e) => setPortMin(e.target.value)}
                  placeholder="e.g., 22"
                  className="form-input w-full"
                  min="1"
                  max="65535"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Port (to)</label>
                <input
                  type="number"
                  value={portMax}
                  onChange={(e) => setPortMax(e.target.value)}
                  placeholder="Same as from"
                  className="form-input w-full"
                  min="1"
                  max="65535"
                />
              </div>
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {rule.direction === 'INGRESS' ? 'Source CIDR' : 'Destination CIDR'}
            </label>
            <input
              type="text"
              value={remoteIp}
              onChange={(e) => setRemoteIp(e.target.value)}
              placeholder="0.0.0.0/0 (anywhere)"
              className="form-input w-full"
            />
            <p className="text-xs text-text-muted mt-1">Use 0.0.0.0/0 for anywhere, or specify a CIDR like 10.0.0.0/8</p>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit className="w-4 h-4" />}
              Save Changes
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

