import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertTriangle,
  Bell,
  FileText,
  Clock,
  Send,
  X,
  Shield,
  Activity,
  Server,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface AdminEmail {
  id: string;
  email: string;
  name: string;
  role: 'primary' | 'secondary';
  notifications: {
    alerts: boolean;
    reports: boolean;
    security: boolean;
    billing: boolean;
  };
  verified: boolean;
  addedAt: string;
  lastNotification: string | null;
}

export function AdminEmails() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmail, setEditingEmail] = useState<AdminEmail | null>(null);

  // Mock admin email data
  const [emails, setEmails] = useState<AdminEmail[]>([
    {
      id: 'email-1',
      email: 'admin@company.com',
      name: 'John Smith',
      role: 'primary',
      notifications: { alerts: true, reports: true, security: true, billing: true },
      verified: true,
      addedAt: '2024-06-15',
      lastNotification: '2026-01-04T14:30:00Z',
    },
    {
      id: 'email-2',
      email: 'ops@company.com',
      name: 'Operations Team',
      role: 'secondary',
      notifications: { alerts: true, reports: false, security: false, billing: false },
      verified: true,
      addedAt: '2024-08-20',
      lastNotification: '2026-01-04T12:15:00Z',
    },
    {
      id: 'email-3',
      email: 'security@company.com',
      name: 'Security Team',
      role: 'secondary',
      notifications: { alerts: false, reports: false, security: true, billing: false },
      verified: true,
      addedAt: '2024-09-01',
      lastNotification: '2026-01-03T18:45:00Z',
    },
    {
      id: 'email-4',
      email: 'cfo@company.com',
      name: 'Finance Department',
      role: 'secondary',
      notifications: { alerts: false, reports: true, security: false, billing: true },
      verified: false,
      addedAt: '2025-01-02',
      lastNotification: null,
    },
  ]);

  const handleDeleteEmail = (id: string) => {
    setEmails(emails.filter((e) => e.id !== id));
  };

  const notificationTypes = [
    { key: 'alerts', label: 'Critical Alerts', icon: <AlertTriangle className="w-4 h-4" />, color: 'text-error' },
    { key: 'reports', label: 'Weekly Reports', icon: <FileText className="w-4 h-4" />, color: 'text-info' },
    { key: 'security', label: 'Security Events', icon: <Shield className="w-4 h-4" />, color: 'text-warning' },
    { key: 'billing', label: 'Billing Updates', icon: <Mail className="w-4 h-4" />, color: 'text-success' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Mail className="w-6 h-6 text-accent" />
            Admin Emails
          </h1>
          <p className="text-text-muted mt-1">
            Manage email recipients for alerts, reports, and notifications
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <Send className="w-4 h-4" />
            Send Test Email
          </Button>
          <Button onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4" />
            Add Email
          </Button>
        </div>
      </div>

      {/* Notification Type Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {notificationTypes.map((type) => {
          const count = emails.filter((e) => e.notifications[type.key as keyof AdminEmail['notifications']]).length;
          return (
            <motion.div
              key={type.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-bg-surface border border-border"
            >
              <div className={cn('flex items-center gap-2 mb-2', type.color)}>
                {type.icon}
                <span className="text-sm font-medium">{type.label}</span>
              </div>
              <p className="text-2xl font-bold text-text-primary">{count}</p>
              <p className="text-sm text-text-muted">recipients</p>
            </motion.div>
          );
        })}
      </div>

      {/* Email List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {emails.map((email, index) => (
          <motion.div
            key={email.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="p-4 rounded-xl bg-bg-surface border border-border"
          >
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              {/* Email Info */}
              <div className="flex items-center gap-4 flex-1">
                <div className={cn(
                  'w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold',
                  email.role === 'primary' ? 'bg-accent/20 text-accent' : 'bg-bg-elevated text-text-secondary',
                )}>
                  {email.name.charAt(0)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-text-primary">{email.name}</p>
                    {email.role === 'primary' && (
                      <Badge variant="info">Primary</Badge>
                    )}
                    {!email.verified && (
                      <Badge variant="warning">Unverified</Badge>
                    )}
                  </div>
                  <p className="text-sm text-text-muted">{email.email}</p>
                  {email.lastNotification && (
                    <p className="text-xs text-text-muted flex items-center gap-1 mt-1">
                      <Clock className="w-3 h-3" />
                      Last notification: {new Date(email.lastNotification).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Notification Toggles */}
              <div className="flex flex-wrap gap-2">
                {notificationTypes.map((type) => {
                  const isEnabled = email.notifications[type.key as keyof AdminEmail['notifications']];
                  return (
                    <button
                      key={type.key}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                        isEnabled
                          ? 'bg-accent/10 text-accent border border-accent/30'
                          : 'bg-bg-base text-text-muted border border-border',
                      )}
                    >
                      {isEnabled ? <CheckCircle2 className="w-3 h-3" /> : type.icon}
                      {type.label}
                    </button>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingEmail(email)}
                  className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                {email.role !== 'primary' && (
                  <button
                    onClick={() => handleDeleteEmail(email.id)}
                    className="p-2 rounded-lg hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Notification Settings */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-accent" />
          Notification Settings
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary">Alert Thresholds</h3>
            <NotificationSetting
              icon={<Activity className="w-4 h-4" />}
              label="CPU Alert Threshold"
              value="80%"
              description="Send alert when CPU usage exceeds this value"
            />
            <NotificationSetting
              icon={<Server className="w-4 h-4" />}
              label="Memory Alert Threshold"
              value="90%"
              description="Send alert when memory usage exceeds this value"
            />
            <NotificationSetting
              icon={<HardDrive className="w-4 h-4" />}
              label="Storage Alert Threshold"
              value="85%"
              description="Send alert when storage usage exceeds this value"
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-text-primary">Report Schedule</h3>
            <NotificationSetting
              icon={<FileText className="w-4 h-4" />}
              label="Weekly Report Day"
              value="Monday"
              description="Day of week for weekly summary reports"
            />
            <NotificationSetting
              icon={<Clock className="w-4 h-4" />}
              label="Report Time"
              value="09:00 AM"
              description="Time to send scheduled reports"
            />
            <NotificationSetting
              icon={<Mail className="w-4 h-4" />}
              label="Digest Frequency"
              value="Daily"
              description="How often to batch non-critical notifications"
            />
          </div>
        </div>
      </motion.div>

      {/* Add Email Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddEmailModal onClose={() => setShowAddModal(false)} />
        )}
      </AnimatePresence>

      {/* Edit Email Modal */}
      <AnimatePresence>
        {editingEmail && (
          <EditEmailModal
            email={editingEmail}
            onClose={() => setEditingEmail(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationSetting({
  icon,
  label,
  value,
  description,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-bg-base border border-border">
      <div className="flex items-center gap-3">
        <div className="text-text-muted">{icon}</div>
        <div>
          <p className="text-sm font-medium text-text-primary">{label}</p>
          <p className="text-xs text-text-muted">{description}</p>
        </div>
      </div>
      <select className="form-select w-auto text-sm">
        <option>{value}</option>
      </select>
    </div>
  );
}

function AddEmailModal({ onClose }: { onClose: () => void }) {
  const [notifications, setNotifications] = useState({
    alerts: true,
    reports: false,
    security: false,
    billing: false,
  });

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
        className="w-full max-w-md bg-bg-surface rounded-xl border border-border shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Add Admin Email</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Name
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., John Smith"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Email Address
            </label>
            <input
              type="email"
              className="form-input"
              placeholder="e.g., john@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Role
            </label>
            <select className="form-select">
              <option value="secondary">Secondary Contact</option>
              <option value="primary">Primary Contact</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Notification Types
            </label>
            <div className="space-y-2">
              {[
                { key: 'alerts', label: 'Critical Alerts' },
                { key: 'reports', label: 'Weekly Reports' },
                { key: 'security', label: 'Security Events' },
                { key: 'billing', label: 'Billing Updates' },
              ].map((type) => (
                <label
                  key={type.key}
                  className="flex items-center gap-3 p-3 rounded-lg bg-bg-base border border-border cursor-pointer hover:bg-bg-hover"
                >
                  <input
                    type="checkbox"
                    checked={notifications[type.key as keyof typeof notifications]}
                    onChange={(e) =>
                      setNotifications({ ...notifications, [type.key]: e.target.checked })
                    }
                    className="form-checkbox"
                  />
                  <span className="text-sm text-text-primary">{type.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button>
            <Plus className="w-4 h-4" />
            Add Email
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function EditEmailModal({
  email,
  onClose,
}: {
  email: AdminEmail;
  onClose: () => void;
}) {
  const [notifications, setNotifications] = useState(email.notifications);

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
        className="w-full max-w-md bg-bg-surface rounded-xl border border-border shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Edit Email Settings</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-bg-hover">
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-lg bg-bg-base border border-border">
            <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-lg">
              {email.name.charAt(0)}
            </div>
            <div>
              <p className="font-medium text-text-primary">{email.name}</p>
              <p className="text-sm text-text-muted">{email.email}</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-3">
              Notification Types
            </label>
            <div className="space-y-2">
              {[
                { key: 'alerts', label: 'Critical Alerts' },
                { key: 'reports', label: 'Weekly Reports' },
                { key: 'security', label: 'Security Events' },
                { key: 'billing', label: 'Billing Updates' },
              ].map((type) => (
                <label
                  key={type.key}
                  className="flex items-center gap-3 p-3 rounded-lg bg-bg-base border border-border cursor-pointer hover:bg-bg-hover"
                >
                  <input
                    type="checkbox"
                    checked={notifications[type.key as keyof typeof notifications]}
                    onChange={(e) =>
                      setNotifications({ ...notifications, [type.key]: e.target.checked })
                    }
                    className="form-checkbox"
                  />
                  <span className="text-sm text-text-primary">{type.label}</span>
                </label>
              ))}
            </div>
          </div>

          {!email.verified && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/20">
              <div className="flex items-center gap-2 text-warning">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">Email not verified</span>
              </div>
              <p className="text-xs text-text-muted mt-1">
                A verification email will be sent when you save changes.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-border">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button>
            Save Changes
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default AdminEmails;
