import { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { TopNavBar } from './TopNavBar';
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
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-base">
      <TopNavBar />
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1600px] mx-auto px-6 py-6 w-full">
        {children}
        </div>
      </main>

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
