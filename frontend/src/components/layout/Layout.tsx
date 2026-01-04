import { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { VMCreationWizard } from '../vm/VMCreationWizard';
import { useAppStore } from '@/stores/app-store';
import { useCreateVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';
import { showInfo } from '@/lib/toast';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { vmWizardOpen, closeVmWizard } = useAppStore();
  const { data: isConnected = false } = useApiConnection();
  const createVM = useCreateVM();

  const handleVMSubmit = async (data: {
    name: string;
    description?: string;
    projectId?: string;
    nodeId?: string;
    spec?: {
      cpu?: { cores?: number };
      memory?: { sizeMib?: number };
      disks?: Array<{ sizeGib?: number; backingFile?: string }>;
      nics?: Array<{ networkId?: string }>;
      provisioning?: {
        cloudInit?: {
          userData?: string;
          metaData?: string;
        };
      };
    };
  }) => {
    if (!isConnected) {
      showInfo('Demo mode: VM creation simulated');
      closeVmWizard();
      return;
    }

    await createVM.mutateAsync({
      name: data.name,
      projectId: data.projectId || 'default',
      description: data.description,
      nodeId: data.nodeId,
      spec: data.spec,
    });
    closeVmWizard();
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
