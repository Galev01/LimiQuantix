/**
 * ConsoleTabBar - Tab navigation for multi-console view
 * 
 * Features:
 * - Tab bar with VM names and close buttons
 * - Add new console button
 * - View mode toggle (tabs/grid)
 * - Grid layout selector
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Monitor,
  Grid3X3,
  Rows3,
  ChevronDown,
  Maximize2,
  LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useConsoleStore,
  useConsoleSessions,
  type ViewMode,
  type GridLayout,
  type ConsoleSession,
} from '@/hooks/useConsoleStore';

interface ConsoleTabBarProps {
  onAddConsole: () => void;
}

const gridLayoutOptions: { value: GridLayout; label: string; icon: React.ReactNode }[] = [
  { value: '1x1', label: '1×1', icon: <Monitor className="w-4 h-4" /> },
  { value: '2x1', label: '2×1', icon: <Rows3 className="w-4 h-4" /> },
  { value: '2x2', label: '2×2', icon: <Grid3X3 className="w-4 h-4" /> },
  { value: '3x2', label: '3×2', icon: <LayoutGrid className="w-4 h-4" /> },
];

export function ConsoleTabBar({ onAddConsole }: ConsoleTabBarProps) {
  const sessions = useConsoleSessions();
  const {
    activeSessionId,
    viewMode,
    gridLayout,
    setActiveSession,
    closeConsole,
    setViewMode,
    setGridLayout,
  } = useConsoleStore();

  const [showGridMenu, setShowGridMenu] = useState(false);

  const handleTabClick = (session: ConsoleSession) => {
    setActiveSession(session.id);
  };

  const handleCloseTab = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    closeConsole(sessionId);
  };

  const toggleViewMode = () => {
    setViewMode(viewMode === 'tabs' ? 'grid' : 'tabs');
  };

  return (
    <div className="flex items-center justify-between h-12 px-3 bg-bg-surface border-b border-border">
      {/* Left: Tabs */}
      <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
        <AnimatePresence mode="popLayout">
          {sessions.map((session, index) => (
            <motion.button
              key={session.id}
              initial={{ opacity: 0, scale: 0.9, x: -10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9, x: -10 }}
              transition={{ duration: 0.15 }}
              onClick={() => handleTabClick(session)}
              className={cn(
                'group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                'hover:bg-bg-hover',
                session.id === activeSessionId
                  ? 'bg-bg-elevated text-text-primary shadow-sm border border-border'
                  : 'text-text-muted hover:text-text-secondary'
              )}
            >
              <Monitor className="w-4 h-4 text-accent shrink-0" />
              <span className="truncate max-w-[120px]">{session.vmName}</span>
              <button
                onClick={(e) => handleCloseTab(e, session.id)}
                className={cn(
                  'w-5 h-5 rounded flex items-center justify-center',
                  'opacity-0 group-hover:opacity-100 transition-opacity',
                  'hover:bg-error/20 hover:text-error'
                )}
                title="Close console"
              >
                <X className="w-3 h-3" />
              </button>
              {/* Keyboard shortcut hint */}
              {index < 9 && (
                <kbd className="hidden group-hover:inline-flex text-[10px] px-1 py-0.5 bg-bg-base rounded border border-border text-text-muted">
                  {index + 1}
                </kbd>
              )}
            </motion.button>
          ))}
        </AnimatePresence>

        {/* Add Console Button */}
        <button
          onClick={onAddConsole}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
            'text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors',
            'border border-dashed border-border hover:border-accent/50'
          )}
          title="Add console"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add</span>
        </button>
      </div>

      {/* Right: View Controls */}
      <div className="flex items-center gap-2 ml-4">
        {/* View Mode Toggle */}
        <div className="flex items-center bg-bg-base rounded-lg p-0.5 border border-border">
          <button
            onClick={() => setViewMode('tabs')}
            className={cn(
              'p-1.5 rounded transition-colors',
              viewMode === 'tabs'
                ? 'bg-bg-elevated text-accent shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
            title="Tab view"
          >
            <Rows3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 rounded transition-colors',
              viewMode === 'grid'
                ? 'bg-bg-elevated text-accent shadow-sm'
                : 'text-text-muted hover:text-text-primary'
            )}
            title="Grid view"
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
        </div>

        {/* Grid Layout Selector (only visible in grid mode) */}
        {viewMode === 'grid' && (
          <div className="relative">
            <button
              onClick={() => setShowGridMenu(!showGridMenu)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm',
                'bg-bg-base border border-border text-text-secondary',
                'hover:bg-bg-hover hover:text-text-primary transition-colors'
              )}
            >
              <span>{gridLayout}</span>
              <ChevronDown className={cn('w-3 h-3 transition-transform', showGridMenu && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {showGridMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute right-0 top-full mt-1 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-50"
                >
                  {gridLayoutOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setGridLayout(option.value);
                        setShowGridMenu(false);
                      }}
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-2 text-sm',
                        'hover:bg-bg-hover transition-colors',
                        gridLayout === option.value
                          ? 'text-accent bg-accent/10'
                          : 'text-text-secondary'
                      )}
                    >
                      {option.icon}
                      <span>{option.label}</span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
