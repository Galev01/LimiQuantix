import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { VMList } from '@/pages/VMList';
import { VMDetail } from '@/pages/VMDetail';
import { VMFolderView } from '@/pages/VMFolderView';
import { HostList } from '@/pages/HostList';
import { HostDetail } from '@/pages/HostDetail';
import { StoragePools } from '@/pages/StoragePools';
import { StoragePoolDetail } from '@/pages/StoragePoolDetail';
import { Volumes } from '@/pages/Volumes';
import { ClusterList } from '@/pages/ClusterList';
import { ClusterDetail } from '@/pages/ClusterDetail';
import { VirtualNetworks } from '@/pages/VirtualNetworks';
import { SecurityGroups } from '@/pages/SecurityGroups';
import { LoadBalancers } from '@/pages/LoadBalancers';
import { VPNServices } from '@/pages/VPNServices';
import { BGPSpeakers } from '@/pages/BGPSpeakers';
import { DistributedSwitch } from '@/pages/DistributedSwitch';
import { Settings } from '@/pages/Settings';
import { Monitoring } from '@/pages/Monitoring';
import { Alerts } from '@/pages/Alerts';
import { DRSRecommendations } from '@/pages/DRSRecommendations';
import { Logs } from '@/pages/Logs';
import { ImageLibraryLayout, AllImagesPage, DownloadsPage, UploadsPage, ConfigPage } from '@/pages/images';
import { ConsoleDock } from '@/pages/ConsoleDock';
import { AdminPanel } from '@/pages/admin';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';
import { KeyboardShortcuts } from '@/components/KeyboardShortcuts';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Placeholder component for VM Cluster View
 * To be implemented in a future iteration
 */
function VMClusterView() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-text-primary mb-2">Cluster View</h2>
        <p className="text-text-muted">Coming soon - View VMs organized by cluster</p>
      </div>
    </div>
  );
}

/**
 * Main App Routes Component
 * Handles routing between main layout, admin panel, and full-screen views
 */
function AppRoutes() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isVMFolderRoute = location.pathname === '/vms/folders';

  // Admin panel has its own layout with custom sidebar
  if (isAdminRoute) {
    return (
      <RouteErrorBoundary>
        <AdminPanel />
      </RouteErrorBoundary>
    );
  }

  // VM Folder View - Full screen 1920x1080 dedicated layout (vCenter-style)
  if (isVMFolderRoute) {
    return (
      <RouteErrorBoundary>
        <VMFolderView />
      </RouteErrorBoundary>
    );
  }

  // Main application with standard layout
  return (
    <RouteErrorBoundary>
      <KeyboardShortcuts>
        <Layout>
          <Routes>
            {/* Dashboard */}
            <Route path="/" element={<Dashboard />} />
            
            {/* Inventory - Virtual Machines */}
            <Route path="/vms" element={<VMList />} />
            <Route path="/vms/clusters" element={<VMClusterView />} />
            <Route path="/vms/:id" element={<VMDetail />} />
            <Route path="/consoles" element={<ConsoleDock />} />
            
            {/* Inventory - Hosts & Clusters */}
            <Route path="/hosts" element={<HostList />} />
            <Route path="/hosts/:id" element={<HostDetail />} />
            <Route path="/clusters" element={<ClusterList />} />
            <Route path="/clusters/:id" element={<ClusterDetail />} />
            
            {/* Storage */}
            <Route path="/storage/pools" element={<StoragePools />} />
            <Route path="/storage/pools/:id" element={<StoragePoolDetail />} />
            <Route path="/storage/volumes" element={<Volumes />} />
            <Route path="/storage/images" element={<ImageLibraryLayout />}>
              <Route index element={<AllImagesPage />} />
              <Route path="downloads" element={<DownloadsPage />} />
              <Route path="uploads" element={<UploadsPage />} />
              <Route path="config" element={<ConfigPage />} />
            </Route>
            
            {/* Networking */}
            <Route path="/networks" element={<VirtualNetworks />} />
            <Route path="/networks/distributed-switch" element={<DistributedSwitch />} />
            <Route path="/networks/load-balancers" element={<LoadBalancers />} />
            <Route path="/networks/vpn" element={<VPNServices />} />
            <Route path="/networks/bgp" element={<BGPSpeakers />} />
            <Route path="/security" element={<SecurityGroups />} />
            
            {/* Operations */}
            <Route path="/monitoring" element={<Monitoring />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/drs" element={<DRSRecommendations />} />
            <Route path="/logs" element={<Logs />} />
            
            {/* Settings */}
            <Route path="/settings" element={<Settings />} />
            
            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </KeyboardShortcuts>
    </RouteErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
        theme="dark"
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: 'bg-surface border-white/10',
            title: 'text-white',
            description: 'text-gray-400',
          },
        }}
      />
    </QueryClientProvider>
  );
}

export default App;
