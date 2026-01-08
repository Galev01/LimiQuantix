import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ConsoleType = 'web' | 'qvmrc';

interface ConsoleStoreState {
  // Default console type preference
  defaultConsoleType: ConsoleType;
  setDefaultConsoleType: (type: ConsoleType) => void;
}

export const useConsoleStore = create<ConsoleStoreState>()(
  persist(
    (set) => ({
      defaultConsoleType: 'web',
      setDefaultConsoleType: (type) => set({ defaultConsoleType: type }),
    }),
    {
      name: 'quantix-host-console-store',
      partialize: (state) => ({
        defaultConsoleType: state.defaultConsoleType,
      }),
    }
  )
);

// Convenience hook
export const useDefaultConsoleType = () => 
  useConsoleStore((state) => state.defaultConsoleType);
