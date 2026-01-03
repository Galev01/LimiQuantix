import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Activity,
  ShieldCheck,
  FileText,
  Mail,
  CreditCard,
  Users,
  KeyRound,
  Blocks,
  Building2,
  Code2,
  ChevronLeft,
  Shield,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import QuantixLogo from '@/assets/Logo.png';
import { useAuthStore, useCurrentUser } from '@/stores/auth-store';

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  href: string;
  badge?: string;
}

const adminNavigation: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, href: '/admin' },
  { id: 'telemetry', label: 'Platform Telemetry', icon: Activity, href: '/admin/telemetry' },
  { id: 'certifications', label: 'Certifications', icon: ShieldCheck, href: '/admin/certifications' },
  { id: 'audit-logs', label: 'Audit Logs', icon: FileText, href: '/admin/audit-logs' },
  { id: 'admin-emails', label: 'Admin Emails', icon: Mail, href: '/admin/emails' },
  { id: 'subscriptions', label: 'Subscription Plans', icon: CreditCard, href: '/admin/subscriptions' },
  { id: 'roles', label: 'Role Hierarchy', icon: Users, href: '/admin/roles' },
  { id: 'sso', label: 'SSO Configuration', icon: KeyRound, href: '/admin/sso' },
  { id: 'global-rules', label: 'Global Rules', icon: Blocks, href: '/admin/rules' },
  { id: 'organization', label: 'Organization', icon: Building2, href: '/admin/organization' },
  { id: 'api-management', label: 'API Management', icon: Code2, href: '/admin/apis' },
];

export function AdminSidebar() {
  const location = useLocation();
  const user = useCurrentUser();
  const logout = useAuthStore((state) => state.logout);

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className={cn(
        'w-64 h-screen bg-sidebar border-r border-border',
        'flex flex-col shrink-0',
        'overflow-hidden',
      )}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        <Link to="/admin" className="flex items-center gap-3">
          <img 
            src={QuantixLogo} 
            alt="Quantix" 
            className="w-10 h-10 object-contain"
          />
          <div className="flex flex-col">
            <span className="font-bold text-text-primary tracking-tight">Admin Panel</span>
            <span className="text-[10px] text-accent uppercase tracking-widest flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Super Admin
            </span>
          </div>
        </Link>
      </div>

      {/* Back to Main App */}
      <div className="px-3 py-3 border-b border-border">
        <Link
          to="/"
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
            'text-text-muted hover:text-text-primary hover:bg-sidebar-hover',
            'transition-all duration-150',
          )}
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {adminNavigation.map((item, index) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.href || 
            (item.href !== '/admin' && location.pathname.startsWith(item.href));

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <Link
                to={item.href}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
                  'transition-all duration-150 group',
                  isActive
                    ? 'bg-accent/10 text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-sidebar-hover',
                )}
              >
                <Icon
                  className={cn(
                    'w-[18px] h-[18px] shrink-0 transition-colors',
                    isActive ? 'text-accent' : 'text-text-muted group-hover:text-accent',
                  )}
                />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {item.badge && (
                  <span className="px-1.5 py-0.5 text-xs rounded-md bg-accent/20 text-accent">
                    {item.badge}
                  </span>
                )}
              </Link>
            </motion.div>
          );
        })}
      </nav>

      {/* User Info */}
      {user && (
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent font-semibold text-sm">
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{user.name}</p>
              <p className="text-xs text-text-muted truncate">{user.email}</p>
            </div>
            <button
              onClick={() => {
                logout();
                window.location.href = '/';
              }}
              className="p-1.5 rounded-lg hover:bg-sidebar-hover text-text-muted hover:text-text-primary transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="px-3 py-2 rounded-lg bg-warning/10 border border-warning/20">
          <p className="text-xs text-warning font-medium">Admin Area</p>
          <p className="text-xs text-text-muted mt-0.5">
            Changes here affect the entire platform
          </p>
        </div>
      </div>
    </motion.aside>
  );
}

export default AdminSidebar;
