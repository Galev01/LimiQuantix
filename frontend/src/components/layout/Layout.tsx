import { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { VMCreationWizard } from '../vm/VMCreationWizard';
import { useAppStore } from '@/stores/app-store';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { vmWizardOpen, closeVmWizard } = useAppStore();

  const handleVMSubmit = (data: any) => {
    console.log('Creating VM:', data);
    // TODO: Implement actual VM creation via gRPC
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg-base">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>

      {/* VM Creation Wizard Modal */}
      <AnimatePresence>
        {vmWizardOpen && (
          <VMCreationWizard
            isOpen={vmWizardOpen}
            onClose={closeVmWizard}
            onSubmit={handleVMSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
