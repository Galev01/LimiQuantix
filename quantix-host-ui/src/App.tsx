import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '@/components/layout';
import { ConnectionSetup } from '@/components/ConnectionSetup';
import { StorageImages } from '@/pages/StorageImages';
import { Dashboard, VirtualMachines, VMDetail, Network, StoragePools, Volumes, Hardware, Performance, Events, Logs, Settings } from '@/pages';
import { getNodeConnection, isRemoteConnection } from '@/api/client';

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

// Check if we should show connection setup
// In development mode (vite dev server), we need to connect to a remote node
// In production (embedded in Quantix-OS), the proxy handles it
function shouldShowConnectionSetup(): boolean {
  // If we're in development and no connection is configured, show setup
  // Check if we're running on localhost (development)
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  // If in dev mode and no remote connection configured, show setup
  if (isDev && !isRemoteConnection()) {
    return true;
  }
  
  return false;
}

export function App() {
  const [showSetup, setShowSetup] = useState(shouldShowConnectionSetup);
  const [connectionInfo, setConnectionInfo] = useState(getNodeConnection);

  // Listen for connection changes
  useEffect(() => {
    const handleConnectionChange = () => {
      setConnectionInfo(getNodeConnection());
      setShowSetup(shouldShowConnectionSetup());
    };

    window.addEventListener('node-connection-changed', handleConnectionChange);
    return () => window.removeEventListener('node-connection-changed', handleConnectionChange);
  }, []);

  // Show connection setup if needed
  if (showSetup) {
    return (
      <ConnectionSetup 
        onConnected={() => {
          setShowSetup(false);
          setConnectionInfo(getNodeConnection());
        }} 
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout connectionInfo={connectionInfo} />}>
            {/* Dashboard */}
            <Route path="/" element={<Dashboard />} />

            {/* Virtual Machines */}
            <Route path="/vms" element={<VirtualMachines />} />
            <Route path="/vms/:vmId" element={<VMDetail />} />

            {/* Storage */}
            <Route path="/storage/pools" element={<StoragePools />} />
            <Route path="/storage/volumes" element={<Volumes />} />
            <Route path="storage/images" element={<StorageImages />} />

            {/* Networking */}
            <Route path="/networking" element={<Network />} />

            {/* Hardware */}
            <Route path="/hardware" element={<Hardware />} />

            {/* Performance Monitor */}
            <Route path="/monitor" element={<Performance />} />

            {/* Events */}
            <Route path="/events" element={<Events />} />

            {/* System Logs */}
            <Route path="/logs" element={<Logs />} />

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
