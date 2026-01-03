import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import { Settings } from '@/pages/Settings';
import { Monitoring } from '@/pages/Monitoring';
import { Alerts } from '@/pages/Alerts';
import { DRSRecommendations } from '@/pages/DRSRecommendations';
import ImageLibrary from '@/pages/ImageLibrary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
