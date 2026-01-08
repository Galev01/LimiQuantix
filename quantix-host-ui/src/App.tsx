import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { Dashboard, VirtualMachines, VMDetail, Network, StoragePools, Volumes, Hardware, Performance, Events, Settings } from '@/pages';

// Create a query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Placeholder pages for routes not yet implemented
function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-text-primary mb-2">{title}</h1>
        <p className="text-text-muted">This page is coming soon...</p>
      </div>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            {/* Dashboard */}
            <Route path="/" element={<Dashboard />} />

            {/* Virtual Machines */}
            <Route path="/vms" element={<VirtualMachines />} />
            <Route path="/vms/:vmId" element={<VMDetail />} />

            {/* Storage */}
            <Route path="/storage/pools" element={<StoragePools />} />
            <Route path="/storage/volumes" element={<Volumes />} />

            {/* Networking */}
            <Route path="/networking" element={<Network />} />

            {/* Hardware */}
            <Route path="/hardware" element={<Hardware />} />

            {/* Performance Monitor */}
            <Route path="/monitor" element={<Performance />} />

            {/* Events */}
            <Route path="/events" element={<Events />} />

            {/* Configuration */}
            <Route path="/settings" element={<Settings />} />

            {/* 404 */}
            <Route path="*" element={<PlaceholderPage title="Page Not Found" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
