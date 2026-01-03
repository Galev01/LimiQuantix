import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useCurrentUser } from '@/stores/auth-store';

interface AdminGuardProps {
  children: ReactNode;
}

/**
 * AdminGuard component that protects admin routes.
 * Uses the auth store to check if the current user has super_admin role.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  const isSuperAdmin = useAuthStore((state) => state.isSuperAdmin);
  const user = useCurrentUser();

  // Check if user has super admin access
  if (!isSuperAdmin()) {
    return <AccessDenied user={user} />;
  }

  return <>{children}</>;
}

interface AccessDeniedProps {
  user: { name: string; email: string; roles: string[] } | null;
}

function AccessDenied({ user }: AccessDeniedProps) {
  const login = useAuthStore((state) => state.login);

  // Development helper: Grant super admin access
  const grantDevAccess = () => {
    login({
      id: 'dev-user-001',
      email: 'admin@quantix.local',
      name: 'Development Admin',
      roles: ['super_admin', 'admin'],
    });
  };

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full bg-bg-surface rounded-xl border border-border p-8 text-center shadow-floating"
      >
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-error/10 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8 text-error" />
        </div>
        
        <h1 className="text-2xl font-bold text-text-primary mb-2">
          Access Denied
        </h1>
        
        <p className="text-text-secondary mb-6">
          You don't have permission to access the Admin Panel. 
          This area is restricted to Super Administrators only.
        </p>

        {/* Current User Info */}
        {user && (
          <div className="p-4 rounded-lg bg-bg-base border border-border mb-4 text-left">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                <User className="w-5 h-5 text-accent" />
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">{user.name}</p>
                <p className="text-xs text-text-muted">{user.email}</p>
                <p className="text-xs text-text-muted mt-1">
                  Roles: {user.roles.join(', ') || 'none'}
                </p>
              </div>
            </div>
          </div>
        )}
        
        <div className="p-4 rounded-lg bg-bg-base border border-border mb-6">
          <div className="flex items-center gap-3 text-left">
            <Lock className="w-5 h-5 text-text-muted shrink-0" />
            <div>
              <p className="text-sm font-medium text-text-primary">
                Required Permission
              </p>
              <p className="text-xs text-text-muted">
                role: super_admin
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 justify-center">
            <Button
              variant="secondary"
              onClick={() => window.history.back()}
            >
              Go Back
            </Button>
            <Button
              onClick={() => window.location.href = '/'}
            >
              Return to Dashboard
            </Button>
          </div>

          {/* Development Mode: Grant Access Button */}
          {(
            <div className="pt-4 border-t border-border mt-4">
              <p className="text-xs text-text-muted mb-3">
                Development Mode
              </p>
              <Button
                variant="secondary"
                onClick={grantDevAccess}
                className="w-full"
              >
                <ShieldAlert className="w-4 h-4" />
                Grant Super Admin Access
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default AdminGuard;
