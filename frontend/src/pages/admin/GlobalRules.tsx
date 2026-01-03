import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Blocks,
  Plus,
  Edit2,
  Trash2,
  Power,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Shield,
  AlertTriangle,
  Check,
  X,
  GripVertical,
  Info,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface GlobalRule {
  id: string;
  name: string;
  description: string;
  category: 'compute' | 'storage' | 'network' | 'security';
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

interface RuleCondition {
  field: string;
  operator: 'equals' | 'greater_than' | 'less_than' | 'contains' | 'not_equals';
  value: string | number;
}

interface RuleAction {
  type: 'allow' | 'deny' | 'modify' | 'warn';
  message?: string;
  modifications?: Record<string, string | number>;
}

export function GlobalRules() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState<GlobalRule | null>(null);

  // Mock global rules data
  const [rules, setRules] = useState<GlobalRule[]>([
    {
      id: 'rule-1',
      name: 'Maximum VM CPU Limit',
      description: 'Limit maximum vCPUs per VM to prevent resource hogging',
      category: 'compute',
      enabled: true,
      priority: 1,
      conditions: [{ field: 'vm.cpu.cores', operator: 'greater_than', value: 32 }],
      actions: [{ type: 'deny', message: 'VMs cannot have more than 32 vCPUs. Please contact admin for exceptions.' }],
    },
    {
      id: 'rule-2',
      name: 'Maximum VM Memory',
      description: 'Limit maximum memory per VM to 128 GB',
      category: 'compute',
      enabled: true,
      priority: 2,
      conditions: [{ field: 'vm.memory.size_mib', operator: 'greater_than', value: 131072 }],
      actions: [{ type: 'deny', message: 'VMs cannot have more than 128 GB of memory.' }],
    },
    {
      id: 'rule-3',
      name: 'Maximum Disk Size',
      description: 'Limit single disk size to 2 TB',
      category: 'storage',
      enabled: true,
      priority: 3,
      conditions: [{ field: 'disk.size_gib', operator: 'greater_than', value: 2048 }],
      actions: [{ type: 'deny', message: 'Single disk cannot exceed 2 TB. Use multiple disks for larger storage needs.' }],
    },
    {
      id: 'rule-4',
      name: 'Require Security Group',
      description: 'All VMs must have at least one security group assigned',
      category: 'security',
      enabled: true,
      priority: 4,
      conditions: [{ field: 'vm.security_groups.count', operator: 'equals', value: 0 }],
      actions: [{ type: 'deny', message: 'VMs must have at least one security group assigned.' }],
    },
    {
      id: 'rule-5',
      name: 'Production Network Restriction',
      description: 'Only admins can connect VMs to production network',
      category: 'network',
      enabled: true,
      priority: 5,
      conditions: [
        { field: 'network.name', operator: 'contains', value: 'production' },
        { field: 'user.role', operator: 'not_equals', value: 'admin' },
      ],
      actions: [{ type: 'deny', message: 'Only administrators can connect VMs to production networks.' }],
    },
    {
      id: 'rule-6',
      name: 'Large VM Warning',
      description: 'Warn when creating VMs with more than 16 vCPUs',
      category: 'compute',
      enabled: false,
      priority: 6,
      conditions: [{ field: 'vm.cpu.cores', operator: 'greater_than', value: 16 }],
      actions: [{ type: 'warn', message: 'You are creating a large VM. Consider if this is necessary.' }],
    },
  ]);

  const toggleRule = (ruleId: string) => {
    setRules(rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r)));
  };

  const deleteRule = (ruleId: string) => {
    setRules(rules.filter((r) => r.id !== ruleId));
  };

  const categoryIcons = {
    compute: Cpu,
    storage: HardDrive,
    network: Network,
    security: Shield,
  };

  const categoryColors = {
    compute: 'text-accent bg-accent/10',
    storage: 'text-success bg-success/10',
    network: 'text-info bg-info/10',
    security: 'text-warning bg-warning/10',
  };

  const groupedRules = {
    compute: rules.filter((r) => r.category === 'compute'),
    storage: rules.filter((r) => r.category === 'storage'),
    network: rules.filter((r) => r.category === 'network'),
    security: rules.filter((r) => r.category === 'security'),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Blocks className="w-6 h-6 text-accent" />
            Global Rules
          </h1>
          <p className="text-text-muted mt-1">
            Define policies for VM creation that appear in the VM wizard
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4" />
          Create Rule
        </Button>
      </div>

      {/* Info Banner */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 rounded-lg bg-info/10 border border-info/20 flex items-start gap-3"
      >
        <Info className="w-5 h-5 text-info shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-info font-medium">How Global Rules Work</p>
          <p className="text-xs text-text-muted mt-1">
            These rules are evaluated during VM creation (Step 2 of the wizard). Rules with higher priority
            are evaluated first. Deny rules will prevent VM creation, while warn rules will show a message
            but allow the user to proceed.
          </p>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <RuleStatCard
          label="Total Rules"
          value={rules.length}
          icon={<Blocks className="w-5 h-5" />}
        />
        <RuleStatCard
          label="Active Rules"
          value={rules.filter((r) => r.enabled).length}
          icon={<Check className="w-5 h-5" />}
          color="green"
        />
        <RuleStatCard
          label="Deny Rules"
          value={rules.filter((r) => r.actions.some((a) => a.type === 'deny')).length}
          icon={<X className="w-5 h-5" />}
          color="red"
        />
        <RuleStatCard
          label="Warning Rules"
          value={rules.filter((r) => r.actions.some((a) => a.type === 'warn')).length}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="yellow"
        />
      </div>

      {/* Rules by Category */}
      {Object.entries(groupedRules).map(([category, categoryRules]) => {
        if (categoryRules.length === 0) return null;
        const Icon = categoryIcons[category as keyof typeof categoryIcons];

        return (
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-xl bg-bg-surface border border-border"
          >
            <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2 capitalize">
              <Icon className="w-5 h-5 text-accent" />
              {category} Rules
            </h2>

            <div className="space-y-3">
              {categoryRules.map((rule, index) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={() => toggleRule(rule.id)}
                  onEdit={() => setEditingRule(rule)}
                  onDelete={() => deleteRule(rule.id)}
                  index={index}
                />
              ))}
            </div>
          </motion.div>
        );
      })}

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {(showCreateModal || editingRule) && (
          <RuleModal
            rule={editingRule}
            onClose={() => {
              setShowCreateModal(false);
              setEditingRule(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function RuleStatCard({
  label,
  value,
  icon,
  color = 'blue',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-accent/10 text-accent',
    green: 'bg-success/10 text-success',
    yellow: 'bg-warning/10 text-warning',
    red: 'bg-error/10 text-error',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl bg-bg-surface border border-border"
    >
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colorClasses[color])}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className="text-sm text-text-muted">{label}</p>
    </motion.div>
  );
}

function RuleCard({
  rule,
  onToggle,
  onEdit,
  onDelete,
  index,
}: {
  rule: GlobalRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  index: number;
}) {
  const actionType = rule.actions[0]?.type || 'allow';
  const actionColors = {
    allow: 'bg-success/10 text-success',
    deny: 'bg-error/10 text-error',
    warn: 'bg-warning/10 text-warning',
    modify: 'bg-info/10 text-info',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        'p-4 rounded-lg border transition-all',
        rule.enabled
          ? 'bg-bg-base border-border'
          : 'bg-bg-base/50 border-border/50 opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button className="p-1 text-text-muted cursor-grab hover:text-text-primary">
            <GripVertical className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-medium text-text-primary">{rule.name}</h3>
              <Badge variant={actionType === 'deny' ? 'danger' : actionType === 'warn' ? 'warning' : 'success'}>
                {actionType}
              </Badge>
              <span className="text-xs text-text-muted">Priority: {rule.priority}</span>
            </div>
            <p className="text-sm text-text-muted mb-2">{rule.description}</p>
            <div className="flex flex-wrap gap-2">
              {rule.conditions.map((condition, i) => (
                <code key={i} className="text-xs px-2 py-1 rounded bg-bg-surface text-accent">
                  {condition.field} {condition.operator} {condition.value}
                </code>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ToggleSwitch checked={rule.enabled} onChange={onToggle} />
          <button
            onClick={onEdit}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'relative w-11 h-6 rounded-full transition-colors',
        checked ? 'bg-accent' : 'bg-bg-elevated',
      )}
    >
      <motion.div
        animate={{ x: checked ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 rounded-full bg-white shadow"
      />
    </button>
  );
}

function RuleModal({
  rule,
  onClose,
}: {
  rule: GlobalRule | null;
  onClose: () => void;
}) {
  const isEditing = rule !== null;
  const [actionType, setActionType] = useState<'allow' | 'deny' | 'warn'>(
    rule?.actions[0]?.type as any || 'deny',
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[80vh] overflow-hidden bg-bg-surface rounded-xl border border-border shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">
            {isEditing ? 'Edit Rule' : 'Create Rule'}
          </h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Rule Name
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g., Maximum CPU Limit"
                defaultValue={rule?.name}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Category
              </label>
              <select className="form-select" defaultValue={rule?.category || 'compute'}>
                <option value="compute">Compute</option>
                <option value="storage">Storage</option>
                <option value="network">Network</option>
                <option value="security">Security</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Description
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Brief description of what this rule does"
              defaultValue={rule?.description}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Priority (lower = higher priority)
            </label>
            <input
              type="number"
              className="form-input w-32"
              placeholder="1"
              defaultValue={rule?.priority || 1}
              min={1}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Conditions
            </label>
            <div className="space-y-2">
              {(rule?.conditions || [{ field: '', operator: 'equals', value: '' }]).map((condition, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select className="form-select flex-1" defaultValue={condition.field}>
                    <option value="">Select field...</option>
                    <option value="vm.cpu.cores">VM CPU Cores</option>
                    <option value="vm.memory.size_mib">VM Memory (MiB)</option>
                    <option value="disk.size_gib">Disk Size (GiB)</option>
                    <option value="vm.security_groups.count">Security Group Count</option>
                    <option value="network.name">Network Name</option>
                    <option value="user.role">User Role</option>
                  </select>
                  <select className="form-select w-40" defaultValue={condition.operator}>
                    <option value="equals">equals</option>
                    <option value="not_equals">not equals</option>
                    <option value="greater_than">greater than</option>
                    <option value="less_than">less than</option>
                    <option value="contains">contains</option>
                  </select>
                  <input
                    type="text"
                    className="form-input flex-1"
                    placeholder="Value"
                    defaultValue={condition.value}
                  />
                  <button className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <Button variant="secondary" size="sm">
                <Plus className="w-3 h-3" />
                Add Condition
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Action
            </label>
            <div className="flex gap-3">
              {(['deny', 'warn', 'allow'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setActionType(type)}
                  className={cn(
                    'flex-1 p-3 rounded-lg border text-center transition-all capitalize',
                    actionType === type
                      ? type === 'deny'
                        ? 'bg-error/10 border-error/30 text-error'
                        : type === 'warn'
                          ? 'bg-warning/10 border-warning/30 text-warning'
                          : 'bg-success/10 border-success/30 text-success'
                      : 'bg-bg-base border-border text-text-secondary hover:border-border-hover',
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {actionType !== 'allow' && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Message
              </label>
              <textarea
                className="form-input h-20"
                placeholder="Message to show when rule is triggered"
                defaultValue={rule?.actions[0]?.message}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button>
            {isEditing ? 'Save Changes' : 'Create Rule'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default GlobalRules;
