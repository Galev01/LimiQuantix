import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { VMList } from '@/pages/VMList';
import { VMDetail } from '@/pages/VMDetail';
import { HostList } from '@/pages/HostList';
import { HostDetail } from '@/pages/HostDetail';
import { StoragePools } from '@/pages/StoragePools';
import { Volumes } from '@/pages/Volumes';
import { ClusterList } from '@/pages/ClusterList';
import { ClusterDetail } from '@/pages/ClusterDetail';
import { VirtualNetworks } from '@/pages/VirtualNetworks';
import { SecurityGroups } from '@/pages/SecurityGroups';
import { LoadBalancers } from '@/pages/LoadBalancers';
import { VPNServices } from '@/pages/VPNServices';
import { BGPSpeakers } from '@/pages/BGPSpeakers';
import { Settings } from '@/pages/Settings';
import { Monitoring } from '@/pages/Monitoring';
import { Alerts } from '@/pages/Alerts';
import { DRSRecommendations } from '@/pages/DRSRecommendations';
import ImageLibrary from '@/pages/ImageLibrary';
import { AdminPanel } from '@/pages/admin';
import { RouteErrorBoundary } from '@/components/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Main App Routes Component
 * Handles routing between main layout and admin panel
 */
function AppRoutes() {
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  // Admin panel has its own layout with custom sidebar
  if (isAdminRoute) {
    return (
      <RouteErrorBoundary>
        <AdminPanel />
      </RouteErrorBoundary>
    );
  }

  // Main application with standard layout
  return (
    <RouteErrorBoundary>
      <Layout>
        <Routes>
        {/* Dashboard */}
        <Route path="/" element={<Dashboard />} />
        
        {/* Inventory */}
        <Route path="/vms" element={<VMList />} />
        <Route path="/vms/:id" element={<VMDetail />} />
        <Route path="/hosts" element={<HostList />} />
        <Route path="/hosts/:id" element={<HostDetail />} />
        <Route path="/clusters" element={<ClusterList />} />
        <Route path="/clusters/:id" element={<ClusterDetail />} />
        
        {/* Storage */}
        <Route path="/storage/pools" element={<StoragePools />} />
        <Route path="/storage/volumes" element={<Volumes />} />
        <Route path="/storage/images" element={<ImageLibrary />} />
        
        {/* Networking */}
        <Route path="/networks" element={<VirtualNetworks />} />
        <Route path="/networks/load-balancers" element={<LoadBalancers />} />
        <Route path="/networks/vpn" element={<VPNServices />} />
        <Route path="/networks/bgp" element={<BGPSpeakers />} />
        <Route path="/security" element={<SecurityGroups />} />
        
        {/* Operations */}
        <Route path="/monitoring" element={<Monitoring />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/drs" element={<DRSRecommendations />} />
        
        {/* Settings */}
        <Route path="/settings" element={<Settings />} />
        
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Layout>
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
