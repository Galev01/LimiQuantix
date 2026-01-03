import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldAlert, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface AdminGuardProps {
  children: ReactNode;
}

/**
 * AdminGuard component that protects admin routes.
 * Currently uses a placeholder permission check.
 * Will be integrated with actual auth system later.
 */
export function AdminGuard({ children }: AdminGuardProps) {
  // TODO: Replace with actual permission check from auth context/store
  // For now, we'll use a mock super admin check
  const isSuperAdmin = useMockSuperAdminCheck();

  if (!isSuperAdmin) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

/**
 * Mock function to check if user is super admin
 * In production, this would check JWT claims, API response, or auth context
 */
function useMockSuperAdminCheck(): boolean {
  // TODO: Implement actual permission check
  // For development, always return true to allow access
  // In production, this would check:
  // - User's role from auth context
  // - JWT token claims
  // - API call to verify permissions
  
  // Mock: Check localStorage for dev override
  const devOverride = localStorage.getItem('quantix_dev_admin');
  if (devOverride === 'false') {
    return false;
  }
  
  // Default to true for development
  return true;
}

function AccessDenied() {
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
      </motion.div>
    </div>
  );
}

export default AdminGuard;
