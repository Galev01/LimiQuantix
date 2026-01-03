import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AdminGuard } from '@/components/admin/AdminGuard';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminOverview } from './AdminOverview';
import { Telemetry } from './Telemetry';
import { Certifications } from './Certifications';
import { AuditLogs } from './AuditLogs';
import { AdminEmails } from './AdminEmails';
import { Subscriptions } from './Subscriptions';
import { Roles } from './Roles';
import { SSOConfig } from './SSOConfig';
import { GlobalRules } from './GlobalRules';
import { Organization } from './Organization';
import { APIManagement } from './APIManagement';

/**
 * Admin Panel Layout
 * Provides the main structure for all admin pages with:
 * - Permission guard (super admin only)
 * - Admin-specific sidebar navigation
 * - Content area with sub-routing
 */
export function AdminPanel() {
  const location = useLocation();
  
  // Get the sub-path after /admin
  const subPath = location.pathname.replace(/^\/admin\/?/, '') || '';

  // Render the appropriate component based on the sub-path
  const renderContent = () => {
    switch (subPath) {
      case '':
        return <AdminOverview />;
      case 'telemetry':
        return <Telemetry />;
      case 'certifications':
        return <Certifications />;
      case 'audit-logs':
        return <AuditLogs />;
      case 'emails':
        return <AdminEmails />;
      case 'subscriptions':
        return <Subscriptions />;
      case 'roles':
        return <Roles />;
      case 'sso':
        return <SSOConfig />;
      case 'rules':
        return <GlobalRules />;
      case 'organization':
        return <Organization />;
      case 'apis':
        return <APIManagement />;
      default:
        // Redirect unknown paths to admin overview
        return <AdminOverview />;
    }
  };

  return (
    <AdminGuard>
      <div className="flex h-screen w-full overflow-hidden bg-bg-base">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}

export default AdminPanel;
