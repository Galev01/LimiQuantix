import { Routes, Route, Navigate } from 'react-router-dom';
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
  return (
    <AdminGuard>
      <div className="flex h-screen w-full overflow-hidden bg-bg-base">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<AdminOverview />} />
              <Route path="/telemetry" element={<Telemetry />} />
              <Route path="/certifications" element={<Certifications />} />
              <Route path="/audit-logs" element={<AuditLogs />} />
              <Route path="/emails" element={<AdminEmails />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/roles" element={<Roles />} />
              <Route path="/sso" element={<SSOConfig />} />
              <Route path="/rules" element={<GlobalRules />} />
              <Route path="/organization" element={<Organization />} />
              <Route path="/apis" element={<APIManagement />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </AdminGuard>
  );
}

export default AdminPanel;
