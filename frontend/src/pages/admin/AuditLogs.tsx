import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Search,
  Download,
  Filter,
  Calendar,
  User,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  userEmail: string;
  action: string;
  resource: string;
  resourceType: string;
  ipAddress: string;
  userAgent: string;
  status: 'success' | 'failure' | 'warning';
  details: Record<string, string>;
}

type Severity = 'all' | 'info' | 'warning' | 'error';

export function AuditLogs() {
  const [searchQuery, setSearchQuery] = useState('');
  const [severity, setSeverity] = useState<Severity>('all');
  const [dateRange, setDateRange] = useState('7d');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Mock audit log data
  const logs: AuditLog[] = [
    {
      id: 'log-1',
      timestamp: '2026-01-04T14:32:15Z',
      user: 'John Admin',
      userEmail: 'admin@company.com',
      action: 'user.role.create',
      resource: 'DevOps Engineer',
      resourceType: 'Role',
      ipAddress: '192.168.1.100',
      userAgent: 'Chrome 120.0',
      status: 'success',
      details: { permissions: '12 added', parentRole: 'Developer' },
    },
    {
      id: 'log-2',
      timestamp: '2026-01-04T14:28:45Z',
      user: 'John Admin',
      userEmail: 'admin@company.com',
      action: 'sso.config.update',
      resource: 'OIDC Provider',
      resourceType: 'SSO',
      ipAddress: '192.168.1.100',
      userAgent: 'Chrome 120.0',
      status: 'success',
      details: { provider: 'Okta', clientId: 'updated' },
    },
    {
      id: 'log-3',
      timestamp: '2026-01-04T13:15:22Z',
      user: 'Security Bot',
      userEmail: 'security@company.com',
      action: 'api.key.revoke',
      resource: 'prod-api-key-3',
      resourceType: 'API Key',
      ipAddress: '10.0.0.1',
      userAgent: 'System',
      status: 'warning',
      details: { reason: 'Expired', lastUsed: '30+ days ago' },
    },
    {
      id: 'log-4',
      timestamp: '2026-01-04T12:45:00Z',
      user: 'Jane Ops',
      userEmail: 'ops@company.com',
      action: 'vm.create',
      resource: 'web-server-04',
      resourceType: 'VM',
      ipAddress: '192.168.1.105',
      userAgent: 'Firefox 121.0',
      status: 'success',
      details: { template: 'Ubuntu 22.04', vCPUs: '4', memory: '8 GB' },
    },
    {
      id: 'log-5',
      timestamp: '2026-01-04T11:30:18Z',
      user: 'Unknown',
      userEmail: 'attacker@malicious.com',
      action: 'auth.login.failed',
      resource: 'admin@company.com',
      resourceType: 'User',
      ipAddress: '45.33.32.156',
      userAgent: 'curl/7.68.0',
      status: 'failure',
      details: { reason: 'Invalid password', attempts: '5' },
    },
    {
      id: 'log-6',
      timestamp: '2026-01-04T10:22:33Z',
      user: 'John Admin',
      userEmail: 'admin@company.com',
      action: 'cert.renew',
      resource: '*.company.com',
      resourceType: 'Certificate',
      ipAddress: '192.168.1.100',
      userAgent: 'Chrome 120.0',
      status: 'success',
      details: { issuer: "Let's Encrypt", validUntil: '2026-04-04' },
    },
    {
      id: 'log-7',
      timestamp: '2026-01-04T09:15:00Z',
      user: 'System',
      userEmail: 'system@quantix.local',
      action: 'backup.complete',
      resource: 'Daily Backup',
      resourceType: 'Backup',
      ipAddress: '10.0.0.1',
      userAgent: 'System',
      status: 'success',
      details: { size: '1.2 TB', duration: '45 min' },
    },
    {
      id: 'log-8',
      timestamp: '2026-01-04T08:00:00Z',
      user: 'Scheduler',
      userEmail: 'scheduler@quantix.local',
      action: 'vm.snapshot.create',
      resource: 'db-primary-01',
      resourceType: 'VM',
      ipAddress: '10.0.0.1',
      userAgent: 'System',
      status: 'failure',
      details: { error: 'Insufficient storage', required: '50 GB', available: '12 GB' },
    },
  ];

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.resource.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.userEmail.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesSeverity =
      severity === 'all' ||
      (severity === 'info' && log.status === 'success') ||
      (severity === 'warning' && log.status === 'warning') ||
      (severity === 'error' && log.status === 'failure');

    return matchesSearch && matchesSeverity;
  });

  const logStats = {
    total: logs.length,
    success: logs.filter((l) => l.status === 'success').length,
    warning: logs.filter((l) => l.status === 'warning').length,
    failure: logs.filter((l) => l.status === 'failure').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <FileText className="w-6 h-6 text-accent" />
            Admin Audit Logs
          </h1>
          <p className="text-text-muted mt-1">
            Track administrative actions and security events
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button variant="secondary">
            <Download className="w-4 h-4" />
            Export Logs
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <LogStatCard
          label="Total Events"
          value={logStats.total}
          icon={<Activity className="w-5 h-5" />}
          color="blue"
        />
        <LogStatCard
          label="Successful"
          value={logStats.success}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="green"
        />
        <LogStatCard
          label="Warnings"
          value={logStats.warning}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="yellow"
        />
        <LogStatCard
          label="Failures"
          value={logStats.failure}
          icon={<XCircle className="w-5 h-5" />}
          color="red"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-bg-surface border border-border">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by user, action, or resource..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="form-input pl-10 w-full"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-muted" />
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            className="form-select w-auto"
          >
            <option value="all">All Severity</option>
            <option value="info">Info/Success</option>
            <option value="warning">Warnings</option>
            <option value="error">Failures</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-text-muted" />
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="form-select w-auto"
          >
            <option value="1h">Last Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl bg-bg-surface border border-border overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-bg-base">
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Timestamp</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">User</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Action</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Resource</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-text-muted">IP Address</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-text-muted">Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <>
                  <tr
                    key={log.id}
                    className={cn(
                      'border-b border-border hover:bg-bg-hover transition-colors cursor-pointer',
                      expandedLog === log.id && 'bg-bg-hover',
                    )}
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-3 text-sm text-text-secondary whitespace-nowrap">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                          <User className="w-4 h-4 text-accent" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-primary">{log.user}</p>
                          <p className="text-xs text-text-muted">{log.userEmail}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-sm text-accent bg-accent/10 px-2 py-1 rounded">
                        {log.action}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm text-text-primary">{log.resource}</p>
                        <p className="text-xs text-text-muted">{log.resourceType}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <LogStatusBadge status={log.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary font-mono">
                      {log.ipAddress}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="p-2 rounded-lg hover:bg-bg-elevated text-text-muted hover:text-text-primary">
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                  {expandedLog === log.id && (
                    <tr key={`${log.id}-details`}>
                      <td colSpan={7} className="px-4 py-4 bg-bg-base border-b border-border">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <DetailItem label="User Agent" value={log.userAgent} />
                          {Object.entries(log.details).map(([key, value]) => (
                            <DetailItem key={key} label={formatLabel(key)} value={value} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <p className="text-sm text-text-muted">
            Showing {filteredLogs.length} of {logs.length} events
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-text-muted" />
            </button>
            <span className="text-sm text-text-secondary px-3">
              Page {currentPage} of 1
            </span>
            <button
              onClick={() => setCurrentPage(currentPage + 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg hover:bg-bg-hover disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-text-muted" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LogStatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
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

function LogStatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: React.ReactNode; variant: 'success' | 'warning' | 'danger' }> = {
    success: { icon: <CheckCircle2 className="w-3 h-3" />, variant: 'success' },
    warning: { icon: <AlertTriangle className="w-3 h-3" />, variant: 'warning' },
    failure: { icon: <XCircle className="w-3 h-3" />, variant: 'danger' },
  };

  const { icon, variant } = config[status] || { icon: <Info className="w-3 h-3" />, variant: 'default' as any };

  return (
    <Badge variant={variant} className="flex items-center gap-1">
      {icon}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-sm text-text-primary font-medium">{value}</p>
    </div>
  );
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

export default AuditLogs;
