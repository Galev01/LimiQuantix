import { create } from 'zustand';

interface AppState {
  // VM Selection
  selectedVmId: string | null;
  selectVm: (id: string | null) => void;
  
  // VM Wizard
  vmWizardOpen: boolean;
  openVmWizard: () => void;
  closeVmWizard: () => void;
  
  // Global Search (TopNavBar)
  searchOpen: boolean;
  searchQuery: string;
  toggleSearch: () => void;
  setSearchQuery: (query: string) => void;
  closeSearch: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  // VM Selection
  selectedVmId: null,
  selectVm: (id) => set({ selectedVmId: id }),
  
  // VM Wizard
  vmWizardOpen: false,
  openVmWizard: () => set({ vmWizardOpen: true }),
  closeVmWizard: () => set({ vmWizardOpen: false }),
  
  // Global Search
  searchOpen: false,
  searchQuery: '',
  toggleSearch: () => set((state) => ({ 
    searchOpen: !state.searchOpen,
    searchQuery: state.searchOpen ? '' : state.searchQuery,
  })),
  setSearchQuery: (query) => set({ searchQuery: query }),
  closeSearch: () => set({ searchOpen: false, searchQuery: '' }),
}));
