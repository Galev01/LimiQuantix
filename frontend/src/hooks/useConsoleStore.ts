/**
 * Console Store - Zustand store for managing multi-console sessions
 * 
 * Manages open console tabs, active console selection, and view mode (tabs/grid).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ConsoleSession {
  id: string;
  vmId: string;
  vmName: string;
  openedAt: number;
  lastActiveAt: number;
  thumbnail?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}

export type ViewMode = 'tabs' | 'grid';
export type GridLayout = '1x1' | '2x1' | '2x2' | '3x2';

interface ConsoleState {
  // Open console sessions
  sessions: ConsoleSession[];
  // Currently focused console (receives keyboard input)
  activeSessionId: string | null;
  // View mode: tabs (one visible) or grid (multiple visible)
  viewMode: ViewMode;
  // Grid layout when in grid mode
  gridLayout: GridLayout;
  // User's default console preference
  defaultConsoleType: 'web' | 'qvmrc';
  
  // Actions
  openConsole: (vmId: string, vmName: string) => void;
  closeConsole: (sessionId: string) => void;
  closeAllConsoles: () => void;
  setActiveSession: (sessionId: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setGridLayout: (layout: GridLayout) => void;
  setDefaultConsoleType: (type: 'web' | 'qvmrc') => void;
  reorderSessions: (fromIndex: number, toIndex: number) => void;
  getSessionByVmId: (vmId: string) => ConsoleSession | undefined;
  updateThumbnail: (vmId: string, thumbnail: string, width?: number, height?: number) => void;
}

export const useConsoleStore = create<ConsoleState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      viewMode: 'tabs',
      gridLayout: '2x2',
      defaultConsoleType: 'web',

      openConsole: (vmId: string, vmName: string) => {
        const existing = get().sessions.find((s) => s.vmId === vmId);
        
        if (existing) {
          // Session already exists, just focus it
          set({
            activeSessionId: existing.id,
            sessions: get().sessions.map((s) =>
              s.id === existing.id ? { ...s, lastActiveAt: Date.now() } : s
            ),
          });
          return;
        }

        // Create new session
        const newSession: ConsoleSession = {
          id: `console-${vmId}-${Date.now()}`,
          vmId,
          vmName,
          openedAt: Date.now(),
          lastActiveAt: Date.now(),
        };

        set((state) => ({
          sessions: [...state.sessions, newSession],
          activeSessionId: newSession.id,
        }));
      },

      closeConsole: (sessionId: string) => {
        const sessions = get().sessions.filter((s) => s.id !== sessionId);
        const wasActive = get().activeSessionId === sessionId;
        
        set({
          sessions,
          // If closing active session, activate the last one or null
          activeSessionId: wasActive
            ? sessions[sessions.length - 1]?.id || null
            : get().activeSessionId,
        });
      },

      closeAllConsoles: () => {
        set({ sessions: [], activeSessionId: null });
      },

      setActiveSession: (sessionId: string) => {
        set({
          activeSessionId: sessionId,
          sessions: get().sessions.map((s) =>
            s.id === sessionId ? { ...s, lastActiveAt: Date.now() } : s
          ),
        });
      },

      setViewMode: (mode: ViewMode) => {
        set({ viewMode: mode });
      },

      setGridLayout: (layout: GridLayout) => {
        set({ gridLayout: layout });
      },

      setDefaultConsoleType: (type: 'web' | 'qvmrc') => {
        set({ defaultConsoleType: type });
      },

      reorderSessions: (fromIndex: number, toIndex: number) => {
        const sessions = [...get().sessions];
        const [moved] = sessions.splice(fromIndex, 1);
        sessions.splice(toIndex, 0, moved);
        set({ sessions });
      },

      getSessionByVmId: (vmId: string) => {
        return get().sessions.find((s) => s.vmId === vmId);
      },

      updateThumbnail: (vmId: string, thumbnail: string, width?: number, height?: number) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.vmId === vmId
              ? { ...s, thumbnail, thumbnailWidth: width, thumbnailHeight: height }
              : s
          ),
        }));
      },
    }),
    {
      name: 'limiquantix-console-store',
      // Only persist certain fields
      partialize: (state) => ({
        viewMode: state.viewMode,
        gridLayout: state.gridLayout,
        defaultConsoleType: state.defaultConsoleType,
        // Don't persist sessions - they should be fresh on page load
      }),
    }
  )
);

// Selectors for optimized re-renders
export const useConsoleSessions = () => useConsoleStore((state) => state.sessions);
export const useActiveSession = () => {
  const activeId = useConsoleStore((state) => state.activeSessionId);
  const sessions = useConsoleStore((state) => state.sessions);
  return sessions.find((s) => s.id === activeId);
};
export const useConsoleViewMode = () => useConsoleStore((state) => state.viewMode);
export const useConsoleGridLayout = () => useConsoleStore((state) => state.gridLayout);
export const useDefaultConsoleType = () => useConsoleStore((state) => state.defaultConsoleType);
