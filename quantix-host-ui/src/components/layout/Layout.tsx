import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Sidebar } from './Sidebar';

export function Layout() {
  return (
    <div className="flex h-screen bg-bg-base">
      <Sidebar />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      
      <Toaster 
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
          },
        }}
      />
    </div>
  );
}
