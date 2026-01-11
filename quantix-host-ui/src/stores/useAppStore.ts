import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  // Search state
  searchOpen: boolean;
  searchQuery: string;
  toggleSearch: () => void;
  setSearchQuery: (query: string) => void;
  
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
      // Search
      searchOpen: false,
      searchQuery: '',
      toggleSearch: () => set((state) => ({ 
        searchOpen: !state.searchOpen,
        searchQuery: state.searchOpen ? '' : state.searchQuery, // Clear on close
      })),
      setSearchQuery: (query) => set({ searchQuery: query }),
      
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
        theme: state.theme,
      }),
    }
  )
);
