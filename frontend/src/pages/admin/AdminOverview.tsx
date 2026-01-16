import { motion } from 'framer-motion';
import {
  Activity,
  Users,
  ShieldCheck,
  FileText,
  Server,
  HardDrive,
  Cpu,
  MemoryStick,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface QuickStatProps {
  title: string;
  value: string | number;
  change?: { value: number; positive: boolean };
  icon: React.ReactNode;
  href: string;
}

function QuickStat({ title, value, change, icon, href }: QuickStatProps) {
  return (
    <Link to={href}>
      <motion.div
        whileHover={{ y: -2 }}
        className={cn(
          'p-5 rounded-xl bg-bg-surface border border-border',
          'hover:border-border-hover hover:shadow-floating transition-all',
          'group cursor-pointer',
        )}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="p-2.5 rounded-lg bg-accent/10 text-accent">
            {icon}
          </div>
          {change && (
            <div
              className={cn(
                'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full',
                change.positive
                  ? 'bg-success/10 text-success'
                  : 'bg-error/10 text-error',
              )}
            >
              {change.positive ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              {Math.abs(change.value)}%
            </div>
          )}
        </div>
        <p className="text-2xl font-bold text-text-primary mb-1">{value}</p>
        <p className="text-sm text-text-muted group-hover:text-text-secondary transition-colors">
          {title}
        </p>
      </motion.div>
    </Link>
  );
}

interface ActivityItemProps {
  action: string;
  user: string;
  target: string;
  time: string;
  type: 'success' | 'warning' | 'info';
}

function ActivityItem({ action, user, target, time, type }: ActivityItemProps) {
  const icons = {
    success: <CheckCircle2 className="w-4 h-4 text-success" />,
    warning: <AlertTriangle className="w-4 h-4 text-warning" />,
    info: <Activity className="w-4 h-4 text-info" />,
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-bg-hover transition-colors">
      <div className="mt-0.5">{icons[type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-text-primary">
          <span className="font-medium">{user}</span>{' '}
          <span className="text-text-secondary">{action}</span>{' '}
          <span className="font-medium text-accent">{target}</span>
        </p>
        <p className="text-xs text-text-muted flex items-center gap-1 mt-1">
          <Clock className="w-3 h-3" />
          {time}
        </p>
      </div>
    </div>
  );
}

export function AdminOverview() {
  // Initial stats - will be populated from API when available
  // TODO: Replace with real API calls when admin stats endpoint is implemented
  const stats = {
    totalUsers: 1,      // Admin user created during first boot
    activeRoles: 1,     // Default admin role
    validCerts: 1,      // Self-signed cert generated during first boot
    auditEvents: 0,     // No events yet
  };

  // System health will be populated from node metrics
  // TODO: Aggregate from all registered nodes
  const systemHealth = {
    cpu: 0,
    memory: 0,
    storage: 0,
    network: 0,
  };

  // Recent activity - empty until audit logging is implemented
  const recentActivity: ActivityItemProps[] = [];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Admin Overview</h1>
        <p className="text-text-muted mt-1">
          Platform administration and system health at a glance
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <QuickStat
            title="Total Users"
            value={stats.totalUsers}
            change={{ value: 12, positive: true }}
            icon={<Users className="w-5 h-5" />}
            href="/admin/roles"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <QuickStat
            title="Active Roles"
            value={stats.activeRoles}
            icon={<ShieldCheck className="w-5 h-5" />}
            href="/admin/roles"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <QuickStat
            title="Valid Certificates"
            value={stats.validCerts}
            change={{ value: 2, positive: false }}
            icon={<ShieldCheck className="w-5 h-5" />}
            href="/admin/certifications"
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
        >
          <QuickStat
            title="Audit Events (24h)"
            value={stats.auditEvents.toLocaleString()}
            change={{ value: 8, positive: true }}
            icon={<FileText className="w-5 h-5" />}
            href="/admin/audit-logs"
          />
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* System Health */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 p-6 rounded-xl bg-bg-surface border border-border"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" />
              System Health
            </h2>
            <Link
              to="/admin/telemetry"
              className="text-sm text-accent hover:underline"
            >
              View Details →
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <HealthMetric
              icon={<Cpu className="w-5 h-5" />}
              label="CPU"
              value={systemHealth.cpu}
              color="blue"
            />
            <HealthMetric
              icon={<MemoryStick className="w-5 h-5" />}
              label="Memory"
              value={systemHealth.memory}
              color="yellow"
            />
            <HealthMetric
              icon={<HardDrive className="w-5 h-5" />}
              label="Storage"
              value={systemHealth.storage}
              color="green"
            />
            <HealthMetric
              icon={<Server className="w-5 h-5" />}
              label="Network"
              value={systemHealth.network}
              color="purple"
            />
          </div>

          {/* Mini chart placeholder */}
          <div className="mt-6 h-32 rounded-lg bg-bg-base border border-border flex items-center justify-center">
            <p className="text-text-muted text-sm">
              Resource utilization chart (last 24h)
            </p>
          </div>
        </motion.div>

        {/* Recent Activity */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="p-6 rounded-xl bg-bg-surface border border-border"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Activity className="w-5 h-5 text-accent" />
              Recent Activity
            </h2>
            <Link
              to="/admin/audit-logs"
              className="text-sm text-accent hover:underline"
            >
              View All →
            </Link>
          </div>

          <div className="space-y-1">
            {recentActivity.length > 0 ? (
              recentActivity.map((item, index) => (
                <ActivityItem key={index} {...item} />
              ))
            ) : (
              <div className="py-8 text-center">
                <Activity className="w-8 h-8 mx-auto text-text-muted mb-2" />
                <p className="text-sm text-text-muted">No recent activity</p>
                <p className="text-xs text-text-muted mt-1">
                  Activity will appear here as you use the platform
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="p-6 rounded-xl bg-bg-surface border border-border"
      >
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <QuickActionButton label="Add User" href="/admin/roles" />
          <QuickActionButton label="Create Role" href="/admin/roles" />
          <QuickActionButton label="Upload Cert" href="/admin/certifications" />
          <QuickActionButton label="Create API Key" href="/admin/apis" />
          <QuickActionButton label="Configure SSO" href="/admin/sso" />
          <QuickActionButton label="View Logs" href="/admin/audit-logs" />
        </div>
      </motion.div>
    </div>
  );
}

interface HealthMetricProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'blue' | 'yellow' | 'green' | 'purple';
}

function HealthMetric({ icon, label, value, color }: HealthMetricProps) {
  const colorClasses = {
    blue: 'text-accent bg-accent/10',
    yellow: 'text-warning bg-warning/10',
    green: 'text-success bg-success/10',
    purple: 'text-purple-400 bg-purple-400/10',
  };

  const barColors = {
    blue: 'bg-accent',
    yellow: 'bg-warning',
    green: 'bg-success',
    purple: 'bg-purple-400',
  };

  return (
    <div className="p-4 rounded-lg bg-bg-base border border-border">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colorClasses[color])}>
        {icon}
      </div>
      <p className="text-sm text-text-muted mb-1">{label}</p>
      <p className="text-xl font-bold text-text-primary">{value}%</p>
      <div className="mt-2 h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1, delay: 0.5 }}
          className={cn('h-full rounded-full', barColors[color])}
        />
      </div>
    </div>
  );
}

function QuickActionButton({ label, href }: { label: string; href: string }) {
  return (
    <Link
      to={href}
      className={cn(
        'px-4 py-3 rounded-lg text-sm font-medium text-center',
        'bg-bg-base border border-border',
        'hover:bg-bg-hover hover:border-border-hover',
        'text-text-secondary hover:text-text-primary',
        'transition-all duration-150',
      )}
    >
      {label}
    </Link>
  );
}

export default AdminOverview;
