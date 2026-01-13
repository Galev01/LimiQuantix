/**
 * SecurityGroupEditor - Intuitive security group rule editor
 * 
 * Features:
 * - Quick-add presets for common rules (SSH, HTTP, RDP, etc.)
 * - Custom rule creation with validation
 * - Inline editing of existing rules
 * - Visual rule representation
 * 
 * @see docs/Networking/000070-quantumnet-implementation-plan.md
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Plus,
  Zap,
  Trash2,
  Edit2,
  Globe,
  Terminal,
  Monitor,
  Database,
  Activity,
  Lock,
  Server,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';
import { clsx } from 'clsx';

// =============================================================================
// TYPES
// =============================================================================

type RuleDirection = 'INGRESS' | 'EGRESS';
type RuleAction = 'ALLOW' | 'DROP' | 'REJECT';
type Protocol = 'tcp' | 'udp' | 'icmp' | 'any';

interface SecurityGroupRule {
  id: string;
  direction: RuleDirection;
  protocol: Protocol;
  portMin?: number;
  portMax?: number;
  icmpType?: number;
  icmpCode?: number;
  remoteIpPrefix?: string;
  remoteSecurityGroupId?: string;
  action: RuleAction;
  description?: string;
  priority?: number;
}

interface SecurityGroup {
  id: string;
  name: string;
  description?: string;
  projectId: string;
  rules: SecurityGroupRule[];
  stateful: boolean;
}

interface SecurityGroupEditorProps {
  securityGroup?: SecurityGroup;
  onSave: (rules: SecurityGroupRule[]) => void;
  onCancel?: () => void;
}

// =============================================================================
// PRESETS
// =============================================================================

interface RulePreset {
  id: string;
  name: string;
  icon: React.ElementType;
  iconColor: string;
  description: string;
  rules: Omit<SecurityGroupRule, 'id'>[];
}

const RULE_PRESETS: RulePreset[] = [
  {
    id: 'web',
    name: 'Allow Web Traffic',
    icon: Globe,
    iconColor: 'text-blue-400',
    description: 'HTTP (80) and HTTPS (443)',
    rules: [
      { direction: 'INGRESS', protocol: 'tcp', portMin: 80, portMax: 80, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow HTTP' },
      { direction: 'INGRESS', protocol: 'tcp', portMin: 443, portMax: 443, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow HTTPS' },
    ],
  },
  {
    id: 'ssh',
    name: 'Allow SSH',
    icon: Terminal,
    iconColor: 'text-emerald-400',
    description: 'SSH access (22)',
    rules: [
      { direction: 'INGRESS', protocol: 'tcp', portMin: 22, portMax: 22, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow SSH' },
    ],
  },
  {
    id: 'rdp',
    name: 'Allow RDP',
    icon: Monitor,
    iconColor: 'text-purple-400',
    description: 'Remote Desktop (3389)',
    rules: [
      { direction: 'INGRESS', protocol: 'tcp', portMin: 3389, portMax: 3389, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow RDP' },
    ],
  },
  {
    id: 'database',
    name: 'Allow Database',
    icon: Database,
    iconColor: 'text-amber-400',
    description: 'MySQL, PostgreSQL, MongoDB, Redis',
    rules: [
      { direction: 'INGRESS', protocol: 'tcp', portMin: 3306, portMax: 3306, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow MySQL' },
      { direction: 'INGRESS', protocol: 'tcp', portMin: 5432, portMax: 5432, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow PostgreSQL' },
      { direction: 'INGRESS', protocol: 'tcp', portMin: 27017, portMax: 27017, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow MongoDB' },
      { direction: 'INGRESS', protocol: 'tcp', portMin: 6379, portMax: 6379, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow Redis' },
    ],
  },
  {
    id: 'ping',
    name: 'Allow ICMP/Ping',
    icon: Activity,
    iconColor: 'text-cyan-400',
    description: 'ICMP for ping and diagnostics',
    rules: [
      { direction: 'INGRESS', protocol: 'icmp', icmpType: -1, icmpCode: -1, remoteIpPrefix: '0.0.0.0/0', action: 'ALLOW', description: 'Allow ICMP' },
    ],
  },
  {
    id: 'internal',
    name: 'Allow Internal',
    icon: Lock,
    iconColor: 'text-rose-400',
    description: 'All RFC1918 private networks',
    rules: [
      { direction: 'INGRESS', protocol: 'any', remoteIpPrefix: '10.0.0.0/8', action: 'ALLOW', description: 'Allow 10.0.0.0/8' },
      { direction: 'INGRESS', protocol: 'any', remoteIpPrefix: '172.16.0.0/12', action: 'ALLOW', description: 'Allow 172.16.0.0/12' },
      { direction: 'INGRESS', protocol: 'any', remoteIpPrefix: '192.168.0.0/16', action: 'ALLOW', description: 'Allow 192.168.0.0/16' },
    ],
  },
];

// =============================================================================
// RULE ROW COMPONENT
// =============================================================================

interface RuleRowProps {
  rule: SecurityGroupRule;
  index: number;
  onEdit: (rule: SecurityGroupRule) => void;
  onRemove: () => void;
}

function RuleRow({ rule, index, onEdit, onRemove }: RuleRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedRule, setEditedRule] = useState(rule);

  const handleSave = () => {
    onEdit(editedRule);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedRule(rule);
    setIsEditing(false);
  };

  const getPortDisplay = () => {
    if (rule.protocol === 'icmp') {
      return 'ICMP';
    }
    if (rule.protocol === 'any') {
      return 'All Ports';
    }
    if (!rule.portMin) {
      return 'All Ports';
    }
    if (rule.portMin === rule.portMax) {
      return `${rule.portMin}`;
    }
    return `${rule.portMin}-${rule.portMax}`;
  };

  if (isEditing) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="p-4 bg-[var(--bg-elevated)] rounded-lg border border-accent/50 space-y-3"
      >
        <div className="grid grid-cols-4 gap-3">
          {/* Direction */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Direction</label>
            <select
              value={editedRule.direction}
              onChange={(e) => setEditedRule({ ...editedRule, direction: e.target.value as RuleDirection })}
              className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border)] rounded text-sm"
            >
              <option value="INGRESS">Ingress</option>
              <option value="EGRESS">Egress</option>
            </select>
          </div>

          {/* Protocol */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Protocol</label>
            <select
              value={editedRule.protocol}
              onChange={(e) => setEditedRule({ ...editedRule, protocol: e.target.value as Protocol })}
              className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border)] rounded text-sm"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
              <option value="any">Any</option>
            </select>
          </div>

          {/* Port Min */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Port Min</label>
            <input
              type="number"
              value={editedRule.portMin || ''}
              onChange={(e) => setEditedRule({ ...editedRule, portMin: parseInt(e.target.value) || undefined })}
              placeholder="1"
              disabled={editedRule.protocol === 'icmp' || editedRule.protocol === 'any'}
              className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border)] rounded text-sm disabled:opacity-50"
            />
          </div>

          {/* Port Max */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Port Max</label>
            <input
              type="number"
              value={editedRule.portMax || ''}
              onChange={(e) => setEditedRule({ ...editedRule, portMax: parseInt(e.target.value) || undefined })}
              placeholder="65535"
              disabled={editedRule.protocol === 'icmp' || editedRule.protocol === 'any'}
              className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border)] rounded text-sm disabled:opacity-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Remote IP */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Remote IP/CIDR</label>
            <input
              type="text"
              value={editedRule.remoteIpPrefix || ''}
              onChange={(e) => setEditedRule({ ...editedRule, remoteIpPrefix: e.target.value })}
              placeholder="0.0.0.0/0"
              className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border)] rounded text-sm"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Description</label>
            <input
              type="text"
              value={editedRule.description || ''}
              onChange={(e) => setEditedRule({ ...editedRule, description: e.target.value })}
              placeholder="Rule description"
              className="w-full px-2 py-1.5 bg-[var(--bg-base)] border border-[var(--border)] rounded text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-sm bg-accent hover:bg-accent/90 text-white rounded-lg transition-colors flex items-center gap-1"
          >
            <Check className="w-4 h-4" />
            Save
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ delay: index * 0.05 }}
      className="group flex items-center gap-3 p-3 bg-[var(--bg-base)] hover:bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] transition-colors"
    >
      {/* Direction badge */}
      <div
        className={clsx(
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          rule.direction === 'INGRESS'
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-amber-500/10 text-amber-400'
        )}
      >
        {rule.direction === 'INGRESS' ? (
          <ArrowDownToLine className="w-3 h-3" />
        ) : (
          <ArrowUpFromLine className="w-3 h-3" />
        )}
        {rule.direction === 'INGRESS' ? 'IN' : 'OUT'}
      </div>

      {/* Protocol */}
      <div className="w-16 text-sm text-text-primary font-mono uppercase">
        {rule.protocol}
      </div>

      {/* Ports */}
      <div className="w-24 text-sm text-text-secondary font-mono">
        {getPortDisplay()}
      </div>

      {/* Remote */}
      <div className="flex-1 text-sm text-text-secondary font-mono">
        {rule.remoteIpPrefix || 'Any'}
      </div>

      {/* Action */}
      <div
        className={clsx(
          'px-2 py-1 rounded text-xs font-medium',
          rule.action === 'ALLOW'
            ? 'bg-success/10 text-success'
            : rule.action === 'DROP'
            ? 'bg-error/10 text-error'
            : 'bg-amber-500/10 text-amber-400'
        )}
      >
        {rule.action}
      </div>

      {/* Description */}
      {rule.description && (
        <div className="w-32 text-xs text-text-muted truncate" title={rule.description}>
          {rule.description}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setIsEditing(true)}
          className="p-1.5 rounded hover:bg-[var(--bg-hover)] text-text-secondary hover:text-text-primary transition-colors"
          title="Edit rule"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        <button
          onClick={onRemove}
          className="p-1.5 rounded hover:bg-error/10 text-text-secondary hover:text-error transition-colors"
          title="Remove rule"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

// =============================================================================
// CUSTOM RULE FORM
// =============================================================================

interface CustomRuleFormProps {
  onAdd: (rule: Omit<SecurityGroupRule, 'id'>) => void;
  onCancel: () => void;
}

function CustomRuleForm({ onAdd, onCancel }: CustomRuleFormProps) {
  const [rule, setRule] = useState<Omit<SecurityGroupRule, 'id'>>({
    direction: 'INGRESS',
    protocol: 'tcp',
    portMin: 0,
    portMax: 0,
    remoteIpPrefix: '0.0.0.0/0',
    action: 'ALLOW',
    description: '',
  });

  const [errors, setErrors] = useState<string[]>([]);

  const validate = (): boolean => {
    const newErrors: string[] = [];

    if (rule.protocol === 'tcp' || rule.protocol === 'udp') {
      if (!rule.portMin || rule.portMin < 1 || rule.portMin > 65535) {
        newErrors.push('Port must be between 1 and 65535');
      }
      if (rule.portMax && rule.portMax < rule.portMin!) {
        newErrors.push('Port max must be >= port min');
      }
    }

    if (rule.remoteIpPrefix && !rule.remoteIpPrefix.match(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/)) {
      newErrors.push('Invalid CIDR format (e.g., 10.0.0.0/8)');
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleAdd = () => {
    if (validate()) {
      onAdd(rule);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="p-4 bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] space-y-4"
    >
      <div className="flex items-center gap-2 text-text-primary font-medium">
        <Plus className="w-4 h-4" />
        Add Custom Rule
      </div>

      {errors.length > 0 && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-lg space-y-1">
          {errors.map((error, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-error">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Direction</label>
          <select
            value={rule.direction}
            onChange={(e) => setRule({ ...rule, direction: e.target.value as RuleDirection })}
            className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-accent"
          >
            <option value="INGRESS">Ingress (Inbound)</option>
            <option value="EGRESS">Egress (Outbound)</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-1 block">Protocol</label>
          <select
            value={rule.protocol}
            onChange={(e) => setRule({ ...rule, protocol: e.target.value as Protocol })}
            className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-accent"
          >
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="icmp">ICMP</option>
            <option value="any">Any</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-1 block">Port (or range: min-max)</label>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="22"
              value={rule.portMin || ''}
              onChange={(e) => setRule({ ...rule, portMin: parseInt(e.target.value) || 0, portMax: parseInt(e.target.value) || 0 })}
              disabled={rule.protocol === 'icmp' || rule.protocol === 'any'}
              className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-1 block">Action</label>
          <select
            value={rule.action}
            onChange={(e) => setRule({ ...rule, action: e.target.value as RuleAction })}
            className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-accent"
          >
            <option value="ALLOW">Allow</option>
            <option value="DROP">Drop</option>
            <option value="REJECT">Reject</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Source/Destination CIDR</label>
          <input
            type="text"
            placeholder="0.0.0.0/0 (any)"
            value={rule.remoteIpPrefix || ''}
            onChange={(e) => setRule({ ...rule, remoteIpPrefix: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="text-xs text-text-secondary mb-1 block">Description</label>
          <input
            type="text"
            placeholder="Rule description"
            value={rule.description || ''}
            onChange={(e) => setRule({ ...rule, description: e.target.value })}
            className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          className="px-4 py-2 text-sm bg-accent hover:bg-accent/90 text-white rounded-lg transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </div>
    </motion.div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function SecurityGroupEditor({ securityGroup, onSave, onCancel }: SecurityGroupEditorProps) {
  const [rules, setRules] = useState<SecurityGroupRule[]>(securityGroup?.rules || []);
  const [showPresets, setShowPresets] = useState(false);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const generateId = () => `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const addPreset = useCallback((preset: RulePreset) => {
    const newRules = preset.rules.map((r) => ({
      ...r,
      id: generateId(),
    }));
    setRules((prev) => [...prev, ...newRules]);
    setShowPresets(false);
    setHasChanges(true);
  }, []);

  const addCustomRule = useCallback((rule: Omit<SecurityGroupRule, 'id'>) => {
    setRules((prev) => [...prev, { ...rule, id: generateId() }]);
    setShowCustomForm(false);
    setHasChanges(true);
  }, []);

  const updateRule = useCallback((updatedRule: SecurityGroupRule) => {
    setRules((prev) => prev.map((r) => (r.id === updatedRule.id ? updatedRule : r)));
    setHasChanges(true);
  }, []);

  const removeRule = useCallback((ruleId: string) => {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setHasChanges(true);
  }, []);

  const handleSave = () => {
    onSave(rules);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-500/10">
            <Shield className="w-5 h-5 text-rose-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-text-primary">
              {securityGroup?.name || 'New Security Group'}
            </h3>
            <p className="text-sm text-text-secondary">
              {rules.length} rule{rules.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={clsx(
              'px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2',
              hasChanges
                ? 'bg-accent hover:bg-accent/90 text-white'
                : 'bg-[var(--bg-surface)] text-text-muted cursor-not-allowed'
            )}
          >
            <Check className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>

      {/* Quick Add Section */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setShowPresets(!showPresets);
            setShowCustomForm(false);
          }}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            showPresets
              ? 'bg-accent text-white'
              : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
          )}
        >
          <Zap className="w-4 h-4" />
          Quick Add
          {showPresets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <button
          onClick={() => {
            setShowCustomForm(!showCustomForm);
            setShowPresets(false);
          }}
          className={clsx(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            showCustomForm
              ? 'bg-accent text-white'
              : 'bg-[var(--bg-surface)] text-text-primary hover:bg-[var(--bg-elevated)] border border-[var(--border)]'
          )}
        >
          <Plus className="w-4 h-4" />
          Custom Rule
        </button>
      </div>

      {/* Preset Selection */}
      <AnimatePresence>
        {showPresets && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-2 md:grid-cols-3 gap-3 p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]"
          >
            {RULE_PRESETS.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  key={preset.id}
                  onClick={() => addPreset(preset)}
                  className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-base)] border border-[var(--border)] hover:border-accent hover:bg-accent/5 transition-all text-left"
                >
                  <Icon className={clsx('w-5 h-5 mt-0.5', preset.iconColor)} />
                  <div>
                    <div className="font-medium text-text-primary text-sm">{preset.name}</div>
                    <div className="text-xs text-text-secondary">{preset.description}</div>
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Rule Form */}
      <AnimatePresence>
        {showCustomForm && (
          <CustomRuleForm onAdd={addCustomRule} onCancel={() => setShowCustomForm(false)} />
        )}
      </AnimatePresence>

      {/* Rules List */}
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center gap-3 px-3 py-2 text-xs text-text-secondary font-medium uppercase tracking-wider">
          <div className="w-14">Dir</div>
          <div className="w-16">Protocol</div>
          <div className="w-24">Port</div>
          <div className="flex-1">Source/Dest</div>
          <div className="w-16">Action</div>
          <div className="w-32">Description</div>
          <div className="w-16"></div>
        </div>

        {/* Rules */}
        <AnimatePresence mode="popLayout">
          {rules.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-12 text-center"
            >
              <Shield className="w-12 h-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary">No rules configured</p>
              <p className="text-sm text-text-muted">
                Use Quick Add or create a custom rule to get started
              </p>
            </motion.div>
          ) : (
            rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={index}
                onEdit={updateRule}
                onRemove={() => removeRule(rule.id)}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Default Deny Notice */}
      <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
        <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5" />
        <div>
          <div className="font-medium text-amber-400">Default Deny Policy</div>
          <p className="text-sm text-text-secondary">
            All traffic not explicitly allowed by a rule will be denied. Outbound traffic is allowed by default.
          </p>
        </div>
      </div>
    </div>
  );
}

export default SecurityGroupEditor;
