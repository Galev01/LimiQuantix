import { Outlet } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Sidebar } from './Sidebar';
import { CreateVMWizard } from '@/components/vm/CreateVMWizard';
import { useAppStore } from '@/stores/useAppStore';

export function Layout() {
  const { vmWizardOpen, closeVmWizard } = useAppStore();

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

      {/* VM Creation Wizard */}
      <CreateVMWizard isOpen={vmWizardOpen} onClose={closeVmWizard} />
    </div>
  );
}
