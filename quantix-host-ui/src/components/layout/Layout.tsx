import { Outlet } from 'react-router-dom';
import { TopNavBar } from './TopNavBar';
import { CreateVMWizard } from '@/components/vm/CreateVMWizard';
import { useAppStore } from '@/stores/useAppStore';

interface LayoutProps {
  connectionInfo?: {
    url: string;
    name?: string;
  } | null;
}

export function Layout({ connectionInfo }: LayoutProps) {
  const { vmWizardOpen, closeVmWizard } = useAppStore();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-bg-base">
      {/* Top Navigation Bar */}
      <TopNavBar connectionInfo={connectionInfo} />
      
      {/* Main Content - 90% width, centered */}
      <main className="flex-1 overflow-auto">
        <div className="w-[90%] max-w-[1800px] mx-auto px-6 py-6">
          <Outlet />
        </div>
      </main>

      {/* VM Creation Wizard */}
      <CreateVMWizard isOpen={vmWizardOpen} onClose={closeVmWizard} />
    </div>
  );
}
