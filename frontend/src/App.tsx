import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '@/components/layout/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { VMList } from '@/pages/VMList';
import { VMDetail } from '@/pages/VMDetail';
import { HostList } from '@/pages/HostList';

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
            <Route path="/" element={<Dashboard />} />
            <Route path="/vms" element={<VMList />} />
            <Route path="/vms/:id" element={<VMDetail />} />
            <Route path="/hosts" element={<HostList />} />
            {/* Placeholder routes for future pages */}
            <Route path="/clusters" element={<PlaceholderPage title="Clusters" />} />
            <Route path="/storage/pools" element={<PlaceholderPage title="Storage Pools" />} />
            <Route path="/storage/volumes" element={<PlaceholderPage title="Volumes" />} />
            <Route path="/networks" element={<PlaceholderPage title="Virtual Networks" />} />
            <Route path="/security" element={<PlaceholderPage title="Security Groups" />} />
            <Route path="/settings" element={<PlaceholderPage title="Settings" />} />
            {/* Catch-all redirect */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

// Placeholder component for unimplemented pages
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-96">
      <h2 className="text-2xl font-bold text-text-primary mb-2">{title}</h2>
      <p className="text-text-muted">This page is coming in a future phase.</p>
    </div>
  );
}

export default App;
