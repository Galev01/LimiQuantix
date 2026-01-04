import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  // Sidebar state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  
  // Theme (future use)
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  
  // Host connection
  hostUrl: string;
  setHostUrl: (url: string) => void;
  
  // VM Creation wizard
  vmWizardOpen: boolean;
  openVmWizard: () => void;
  closeVmWizard: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Sidebar
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      // Theme
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      
      // Host connection
      hostUrl: window.location.origin,
      setHostUrl: (url) => set({ hostUrl: url }),
      
      // VM Wizard
      vmWizardOpen: false,
      openVmWizard: () => set({ vmWizardOpen: true }),
      closeVmWizard: () => set({ vmWizardOpen: false }),
    }),
    {
      name: 'quantix-host-ui-storage',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
      }),
    }
  )
);
