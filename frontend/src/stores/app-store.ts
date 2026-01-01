import { create } from 'zustand';

interface AppState {
  sidebarCollapsed: boolean;
  selectedVmId: string | null;
  vmWizardOpen: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  selectVm: (id: string | null) => void;
  openVmWizard: () => void;
  closeVmWizard: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  selectedVmId: null,
  vmWizardOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  selectVm: (id) => set({ selectedVmId: id }),
  openVmWizard: () => set({ vmWizardOpen: true }),
  closeVmWizard: () => set({ vmWizardOpen: false }),
}));

