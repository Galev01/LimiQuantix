import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2,
  Plus,
  Key,
  Copy,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  Calendar,
  Clock,
  Shield,
  AlertTriangle,
  Check,
  X,
  Activity,
  User,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface APIKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsed: string | null;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  permissions: string[];
  createdBy: string;
  usageCount: number;
}

export function APIManagement() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyRevealed, setNewKeyRevealed] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Mock API keys data
  const [apiKeys, setApiKeys] = useState<APIKey[]>([
    {
      id: 'key-1',
      name: 'Production API',
      prefix: 'qx_prod_',
      createdAt: '2025-06-15T10:00:00Z',
      lastUsed: '2026-01-04T14:30:00Z',
      expiresAt: null,
      status: 'active',
      permissions: ['vm.read', 'vm.write', 'host.read', 'storage.read'],
      createdBy: 'admin@company.com',
      usageCount: 125847,
    },
    {
      id: 'key-2',
      name: 'CI/CD Pipeline',
      prefix: 'qx_ci_',
      createdAt: '2025-08-20T14:00:00Z',
      lastUsed: '2026-01-04T12:15:00Z',
      expiresAt: '2026-08-20T14:00:00Z',
      status: 'active',
      permissions: ['vm.read', 'vm.write', 'vm.delete'],
      createdBy: 'devops@company.com',
      usageCount: 45632,
    },
    {
      id: 'key-3',
      name: 'Monitoring Integration',
      prefix: 'qx_mon_',
      createdAt: '2025-09-01T09:00:00Z',
      lastUsed: '2026-01-04T14:00:00Z',
      expiresAt: null,
      status: 'active',
      permissions: ['vm.read', 'host.read', 'metrics.read'],
      createdBy: 'admin@company.com',
      usageCount: 892156,
    },
    {
      id: 'key-4',
      name: 'Development Testing',
      prefix: 'qx_dev_',
      createdAt: '2025-10-15T11:00:00Z',
      lastUsed: '2025-12-20T16:00:00Z',
      expiresAt: '2026-01-15T11:00:00Z',
      status: 'expired',
      permissions: ['vm.read', 'vm.write'],
      createdBy: 'developer@company.com',
      usageCount: 1523,
    },
    {
      id: 'key-5',
      name: 'Old Integration',
      prefix: 'qx_old_',
      createdAt: '2024-06-01T08:00:00Z',
      lastUsed: '2024-12-01T10:00:00Z',
      expiresAt: null,
      status: 'revoked',
      permissions: ['vm.read'],
      createdBy: 'admin@company.com',
      usageCount: 8921,
    },
  ]);

  const filteredKeys = apiKeys.filter(
    (key) =>
      key.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      key.prefix.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleRevoke = (keyId: string) => {
    setApiKeys(
      apiKeys.map((key) =>
        key.id === keyId ? { ...key, status: 'revoked' as const } : key,
      ),
    );
  };

  const handleDelete = (keyId: string) => {
    setApiKeys(apiKeys.filter((key) => key.id !== keyId));
  };

  const stats = {
    total: apiKeys.length,
    active: apiKeys.filter((k) => k.status === 'active').length,
    expired: apiKeys.filter((k) => k.status === 'expired').length,
    revoked: apiKeys.filter((k) => k.status === 'revoked').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Code2 className="w-6 h-6 text-accent" />
            API Management
          </h1>
          <p className="text-text-muted mt-1">
            Create and manage API keys for programmatic access
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4" />
          Create API Key
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Keys"
          value={stats.total}
          icon={<Key className="w-5 h-5" />}
          color="blue"
        />
        <StatCard
          label="Active"
          value={stats.active}
          icon={<Check className="w-5 h-5" />}
          color="green"
        />
        <StatCard
          label="Expired"
          value={stats.expired}
          icon={<Clock className="w-5 h-5" />}
          color="yellow"
        />
        <StatCard
          label="Revoked"
          value={stats.revoked}
          icon={<X className="w-5 h-5" />}
          color="red"
        />
      </div>

      {/* New Key Revealed Banner */}
      <AnimatePresence>
        {newKeyRevealed && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-lg bg-warning/10 border border-warning/20"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-warning">API Key Created - Save This Now!</p>
                <p className="text-xs text-text-muted mt-1 mb-3">
                  This is the only time you'll see this key. Copy it now and store it securely.
                </p>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-bg-base border border-border font-mono text-sm">
                  <code className="flex-1 text-accent">{newKeyRevealed}</code>
                  <button
                    onClick={() => navigator.clipboard.writeText(newKeyRevealed)}
                    className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button
                onClick={() => setNewKeyRevealed(null)}
                className="p-1 hover:bg-bg-hover rounded"
              >
                <X className="w-4 h-4 text-text-muted" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search API keys..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input pl-10 w-full"
          />
        </div>
        <select className="form-select w-auto">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
      </div>

      {/* API Keys List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {filteredKeys.map((apiKey, index) => (
          <APIKeyCard
            key={apiKey.id}
            apiKey={apiKey}
            onRevoke={() => handleRevoke(apiKey.id)}
            onDelete={() => handleDelete(apiKey.id)}
            index={index}
          />
        ))}

        {filteredKeys.length === 0 && (
          <div className="p-12 rounded-xl bg-bg-surface border border-border text-center">
            <Key className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <p className="text-text-muted">No API keys found</p>
          </div>
        )}
      </motion.div>

      {/* API Documentation Link */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          API Documentation
        </h2>
        <p className="text-sm text-text-muted mb-4">
          Learn how to use the Quantix API to automate your infrastructure.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary">
            View API Docs
          </Button>
          <Button variant="secondary">
            OpenAPI Spec
          </Button>
        </div>
      </motion.div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateAPIKeyModal
            onClose={() => setShowCreateModal(false)}
            onCreated={(key) => {
              setNewKeyRevealed(key);
              setShowCreateModal(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
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

function APIKeyCard({
  apiKey,
  onRevoke,
  onDelete,
  index,
}: {
  apiKey: APIKey;
  onRevoke: () => void;
  onDelete: () => void;
  index: number;
}) {
  const statusConfig = {
    active: { variant: 'success' as const, label: 'Active' },
    expired: { variant: 'warning' as const, label: 'Expired' },
    revoked: { variant: 'danger' as const, label: 'Revoked' },
  };

  const { variant, label } = statusConfig[apiKey.status];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        'p-4 rounded-xl bg-bg-surface border border-border',
        apiKey.status !== 'active' && 'opacity-60',
      )}
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        {/* Key Info */}
        <div className="flex items-center gap-4 flex-1">
          <div className={cn(
            'p-3 rounded-lg',
            apiKey.status === 'active' ? 'bg-accent/10' : 'bg-bg-base',
          )}>
            <Key className={cn(
              'w-5 h-5',
              apiKey.status === 'active' ? 'text-accent' : 'text-text-muted',
            )} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-text-primary">{apiKey.name}</h3>
              <Badge variant={variant}>{label}</Badge>
            </div>
            <div className="flex items-center gap-4 mt-1">
              <code className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded">
                {apiKey.prefix}***
              </code>
              <span className="text-xs text-text-muted flex items-center gap-1">
                <User className="w-3 h-3" />
                {apiKey.createdBy}
              </span>
            </div>
          </div>
        </div>

        {/* Usage Stats */}
        <div className="grid grid-cols-3 gap-6 text-center">
          <div>
            <p className="text-xs text-text-muted">Created</p>
            <p className="text-sm text-text-primary">
              {new Date(apiKey.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Last Used</p>
            <p className="text-sm text-text-primary">
              {apiKey.lastUsed ? new Date(apiKey.lastUsed).toLocaleDateString() : 'Never'}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Requests</p>
            <p className="text-sm text-text-primary">
              {apiKey.usageCount.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {apiKey.status === 'active' && (
            <Button variant="secondary" size="sm" onClick={onRevoke}>
              <Shield className="w-3 h-3" />
              Revoke
            </Button>
          )}
          <button
            onClick={onDelete}
            className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Permissions */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-text-muted">Permissions:</span>
          {apiKey.permissions.map((perm) => (
            <code key={perm} className="text-xs px-2 py-0.5 rounded bg-bg-base text-text-secondary">
              {perm}
            </code>
          ))}
        </div>
        {apiKey.expiresAt && (
          <p className="text-xs text-text-muted mt-2 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Expires: {new Date(apiKey.expiresAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function CreateAPIKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: string) => void;
}) {
  const [name, setName] = useState('');
  const [expiration, setExpiration] = useState<'never' | '30d' | '90d' | '1y'>('never');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const permissionGroups = [
    {
      name: 'Virtual Machines',
      permissions: [
        { id: 'vm.read', label: 'Read VMs' },
        { id: 'vm.write', label: 'Create/Edit VMs' },
        { id: 'vm.delete', label: 'Delete VMs' },
        { id: 'vm.power', label: 'Power Operations' },
      ],
    },
    {
      name: 'Hosts',
      permissions: [
        { id: 'host.read', label: 'Read Hosts' },
        { id: 'host.write', label: 'Manage Hosts' },
      ],
    },
    {
      name: 'Storage',
      permissions: [
        { id: 'storage.read', label: 'Read Storage' },
        { id: 'storage.write', label: 'Manage Storage' },
      ],
    },
    {
      name: 'Metrics',
      permissions: [
        { id: 'metrics.read', label: 'Read Metrics' },
      ],
    },
  ];

  const togglePermission = (permId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permId) ? prev.filter((p) => p !== permId) : [...prev, permId],
    );
  };

  const handleCreate = () => {
    // Generate a mock API key
    const newKey = `qx_${name.toLowerCase().replace(/\s+/g, '_').slice(0, 8)}_${Math.random().toString(36).slice(2, 18)}`;
    onCreated(newKey);
  };

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
        className="w-full max-w-lg max-h-[80vh] overflow-hidden bg-bg-surface rounded-xl border border-border shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">Create API Key</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Key Name
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Production API"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Expiration
            </label>
            <select
              className="form-select"
              value={expiration}
              onChange={(e) => setExpiration(e.target.value as any)}
            >
              <option value="never">Never expires</option>
              <option value="30d">30 days</option>
              <option value="90d">90 days</option>
              <option value="1y">1 year</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Permissions ({selectedPermissions.length} selected)
            </label>
            <div className="space-y-4">
              {permissionGroups.map((group) => (
                <div key={group.name} className="p-3 rounded-lg bg-bg-base border border-border">
                  <h4 className="text-sm font-medium text-text-primary mb-2">{group.name}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {group.permissions.map((perm) => (
                      <label
                        key={perm.id}
                        className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-bg-hover"
                      >
                        <input
                          type="checkbox"
                          checked={selectedPermissions.includes(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="form-checkbox"
                        />
                        <span className="text-sm text-text-primary">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning">
                The API key will only be shown once after creation. Make sure to copy and store it securely.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!name || selectedPermissions.length === 0}>
            <Key className="w-4 h-4" />
            Create API Key
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default APIManagement;
