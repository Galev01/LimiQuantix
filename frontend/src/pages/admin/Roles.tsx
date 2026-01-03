import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Plus,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronDown,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  User,
  Search,
  X,
  Check,
  Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface Permission {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface Role {
  id: string;
  name: string;
  description: string;
  type: 'system' | 'custom';
  parentRole: string | null;
  permissions: string[];
  userCount: number;
  createdAt: string;
}

interface UserMember {
  id: string;
  name: string;
  email: string;
  roles: string[];
  lastActive: string;
}

export function Roles() {
  const [expandedRole, setExpandedRole] = useState<string | null>('role-admin');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [activeTab, setActiveTab] = useState<'roles' | 'permissions' | 'users'>('roles');

  // Permission categories and items
  const permissions: Permission[] = [
    // VM Permissions
    { id: 'vm.create', name: 'Create VMs', description: 'Create new virtual machines', category: 'Virtual Machines' },
    { id: 'vm.delete', name: 'Delete VMs', description: 'Delete virtual machines', category: 'Virtual Machines' },
    { id: 'vm.edit', name: 'Edit VMs', description: 'Modify VM configuration', category: 'Virtual Machines' },
    { id: 'vm.power', name: 'Power Operations', description: 'Start, stop, restart VMs', category: 'Virtual Machines' },
    { id: 'vm.console', name: 'Console Access', description: 'Access VM console', category: 'Virtual Machines' },
    { id: 'vm.snapshot', name: 'Manage Snapshots', description: 'Create and restore snapshots', category: 'Virtual Machines' },
    { id: 'vm.migrate', name: 'Live Migration', description: 'Migrate VMs between hosts', category: 'Virtual Machines' },
    // Host Permissions
    { id: 'host.view', name: 'View Hosts', description: 'View host information', category: 'Hosts' },
    { id: 'host.manage', name: 'Manage Hosts', description: 'Add, remove, configure hosts', category: 'Hosts' },
    { id: 'host.maintenance', name: 'Maintenance Mode', description: 'Enter/exit maintenance mode', category: 'Hosts' },
    // Storage Permissions
    { id: 'storage.view', name: 'View Storage', description: 'View storage pools and volumes', category: 'Storage' },
    { id: 'storage.manage', name: 'Manage Storage', description: 'Create pools, volumes, upload ISOs', category: 'Storage' },
    // Network Permissions
    { id: 'network.view', name: 'View Networks', description: 'View virtual networks', category: 'Networking' },
    { id: 'network.manage', name: 'Manage Networks', description: 'Create and configure networks', category: 'Networking' },
    // Admin Permissions
    { id: 'admin.users', name: 'Manage Users', description: 'Create, edit, delete users', category: 'Administration' },
    { id: 'admin.roles', name: 'Manage Roles', description: 'Create and assign roles', category: 'Administration' },
    { id: 'admin.settings', name: 'System Settings', description: 'Modify platform settings', category: 'Administration' },
    { id: 'admin.audit', name: 'View Audit Logs', description: 'Access audit logs', category: 'Administration' },
    { id: 'admin.billing', name: 'Billing Access', description: 'View and manage billing', category: 'Administration' },
  ];

  // Mock roles data
  const roles: Role[] = [
    {
      id: 'role-superadmin',
      name: 'Super Admin',
      description: 'Full platform access with all permissions',
      type: 'system',
      parentRole: null,
      permissions: permissions.map((p) => p.id),
      userCount: 2,
      createdAt: '2024-01-01',
    },
    {
      id: 'role-admin',
      name: 'Administrator',
      description: 'Platform administration without billing access',
      type: 'system',
      parentRole: 'role-superadmin',
      permissions: permissions.filter((p) => p.id !== 'admin.billing').map((p) => p.id),
      userCount: 5,
      createdAt: '2024-01-01',
    },
    {
      id: 'role-operator',
      name: 'Operator',
      description: 'Day-to-day VM and infrastructure operations',
      type: 'system',
      parentRole: 'role-admin',
      permissions: ['vm.create', 'vm.delete', 'vm.edit', 'vm.power', 'vm.console', 'vm.snapshot', 'host.view', 'storage.view', 'network.view'],
      userCount: 12,
      createdAt: '2024-01-01',
    },
    {
      id: 'role-viewer',
      name: 'Viewer',
      description: 'Read-only access to resources',
      type: 'system',
      parentRole: null,
      permissions: ['host.view', 'storage.view', 'network.view'],
      userCount: 25,
      createdAt: '2024-01-01',
    },
    {
      id: 'role-devops',
      name: 'DevOps Engineer',
      description: 'Custom role for DevOps team members',
      type: 'custom',
      parentRole: 'role-operator',
      permissions: ['vm.create', 'vm.delete', 'vm.edit', 'vm.power', 'vm.console', 'vm.snapshot', 'storage.view', 'storage.manage', 'network.view'],
      userCount: 8,
      createdAt: '2025-06-15',
    },
    {
      id: 'role-developer',
      name: 'Developer',
      description: 'Limited VM access for development teams',
      type: 'custom',
      parentRole: 'role-viewer',
      permissions: ['vm.power', 'vm.console', 'host.view', 'storage.view', 'network.view'],
      userCount: 35,
      createdAt: '2025-08-20',
    },
  ];

  // Mock users
  const users: UserMember[] = [
    { id: 'user-1', name: 'John Smith', email: 'john@company.com', roles: ['Super Admin'], lastActive: '2026-01-04T14:30:00Z' },
    { id: 'user-2', name: 'Jane Doe', email: 'jane@company.com', roles: ['Administrator'], lastActive: '2026-01-04T12:15:00Z' },
    { id: 'user-3', name: 'Bob Wilson', email: 'bob@company.com', roles: ['DevOps Engineer'], lastActive: '2026-01-04T10:00:00Z' },
    { id: 'user-4', name: 'Alice Chen', email: 'alice@company.com', roles: ['Developer'], lastActive: '2026-01-03T18:45:00Z' },
    { id: 'user-5', name: 'Charlie Brown', email: 'charlie@company.com', roles: ['Operator', 'Viewer'], lastActive: '2026-01-03T16:30:00Z' },
  ];

  const permissionCategories = [...new Set(permissions.map((p) => p.category))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Users className="w-6 h-6 text-accent" />
            Role Hierarchy
          </h1>
          <p className="text-text-muted mt-1">
            Manage roles, permissions, and user assignments
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>
          <Plus className="w-4 h-4" />
          Create Role
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1 rounded-lg bg-bg-base border border-border w-fit">
        {(['roles', 'permissions', 'users'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-all capitalize',
              activeTab === tab
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Roles Tab */}
      {activeTab === 'roles' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {roles.map((role, index) => (
            <motion.div
              key={role.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="rounded-xl bg-bg-surface border border-border overflow-hidden"
            >
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-bg-hover transition-colors"
                onClick={() => setExpandedRole(expandedRole === role.id ? null : role.id)}
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'p-3 rounded-lg',
                    role.type === 'system' ? 'bg-warning/10' : 'bg-accent/10',
                  )}>
                    {role.type === 'system' ? (
                      <ShieldCheck className={cn('w-5 h-5', role.type === 'system' ? 'text-warning' : 'text-accent')} />
                    ) : (
                      <Shield className="w-5 h-5 text-accent" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-text-primary">{role.name}</h3>
                      <Badge variant={role.type === 'system' ? 'warning' : 'default'}>
                        {role.type}
                      </Badge>
                    </div>
                    <p className="text-sm text-text-muted">{role.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-lg font-semibold text-text-primary">{role.userCount}</p>
                    <p className="text-xs text-text-muted">users</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-text-primary">{role.permissions.length}</p>
                    <p className="text-xs text-text-muted">permissions</p>
                  </div>
                  <motion.div
                    animate={{ rotate: expandedRole === role.id ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronRight className="w-5 h-5 text-text-muted" />
                  </motion.div>
                </div>
              </div>

              <AnimatePresence>
                {expandedRole === role.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-border"
                  >
                    <div className="p-4 bg-bg-base">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-medium text-text-primary">Permissions</h4>
                        <div className="flex gap-2">
                          {role.type === 'custom' && (
                            <>
                              <Button variant="secondary" size="sm" onClick={() => setSelectedRole(role)}>
                                <Edit2 className="w-3 h-3" />
                                Edit
                              </Button>
                              <Button variant="danger" size="sm">
                                <Trash2 className="w-3 h-3" />
                                Delete
                              </Button>
                            </>
                          )}
                          <Button variant="secondary" size="sm">
                            <Copy className="w-3 h-3" />
                            Clone
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {permissions
                          .filter((p) => role.permissions.includes(p.id))
                          .map((permission) => (
                            <div
                              key={permission.id}
                              className="flex items-center gap-2 p-2 rounded-lg bg-success/5 border border-success/20"
                            >
                              <Check className="w-3 h-3 text-success" />
                              <span className="text-xs text-text-primary truncate">{permission.name}</span>
                            </div>
                          ))}
                      </div>

                      {role.parentRole && (
                        <p className="text-xs text-text-muted mt-4">
                          Inherits from: <span className="text-accent">{roles.find((r) => r.id === role.parentRole)?.name}</span>
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Permissions Tab */}
      {activeTab === 'permissions' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {permissionCategories.map((category) => (
            <div key={category} className="p-6 rounded-xl bg-bg-surface border border-border">
              <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-accent" />
                {category}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {permissions
                  .filter((p) => p.category === category)
                  .map((permission) => (
                    <div
                      key={permission.id}
                      className="p-3 rounded-lg bg-bg-base border border-border"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Lock className="w-4 h-4 text-text-muted" />
                        <code className="text-xs text-accent">{permission.id}</code>
                      </div>
                      <p className="text-sm font-medium text-text-primary">{permission.name}</p>
                      <p className="text-xs text-text-muted mt-1">{permission.description}</p>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                placeholder="Search users..."
                className="form-input pl-10 w-full"
              />
            </div>
            <select className="form-select w-auto">
              <option value="">All Roles</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
            <Button>
              <Plus className="w-4 h-4" />
              Add User
            </Button>
          </div>

          <div className="rounded-xl bg-bg-surface border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-bg-base">
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">User</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Roles</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Last Active</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border last:border-0 hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">
                          {user.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-medium text-text-primary">{user.name}</p>
                          <p className="text-sm text-text-muted">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                          <Badge key={role} variant="default">{role}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {new Date(user.lastActive).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-2 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Create Role Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateRoleModal
            permissions={permissions}
            roles={roles}
            onClose={() => setShowCreateModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateRoleModal({
  permissions,
  roles,
  onClose,
}: {
  permissions: Permission[];
  roles: Role[];
  onClose: () => void;
}) {
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const permissionCategories = [...new Set(permissions.map((p) => p.category))];

  const togglePermission = (permissionId: string) => {
    setSelectedPermissions((prev) =>
      prev.includes(permissionId)
        ? prev.filter((p) => p !== permissionId)
        : [...prev, permissionId],
    );
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
        className="w-full max-w-2xl max-h-[80vh] overflow-hidden bg-bg-surface rounded-xl border border-border shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-text-primary">Create Custom Role</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Role Name
            </label>
            <input type="text" className="form-input" placeholder="e.g., DevOps Engineer" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Description
            </label>
            <input type="text" className="form-input" placeholder="Brief description of this role" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Inherit From (Optional)
            </label>
            <select className="form-select">
              <option value="">No inheritance</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Permissions ({selectedPermissions.length} selected)
            </label>
            <div className="space-y-4">
              {permissionCategories.map((category) => (
                <div key={category} className="p-3 rounded-lg bg-bg-base border border-border">
                  <h4 className="text-sm font-medium text-text-primary mb-2">{category}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {permissions
                      .filter((p) => p.category === category)
                      .map((permission) => (
                        <label
                          key={permission.id}
                          className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-bg-hover"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(permission.id)}
                            onChange={() => togglePermission(permission.id)}
                            className="form-checkbox"
                          />
                          <span className="text-sm text-text-primary">{permission.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button>
            <Plus className="w-4 h-4" />
            Create Role
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default Roles;
