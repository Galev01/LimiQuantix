/**
 * ConsoleGrid - Grid layout manager for multi-console view
 * 
 * Renders console iframes in a grid or single-tab layout based on view mode.
 * Handles focus management for keyboard input routing.
 */

import { useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, AlertCircle, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useConsoleStore,
  useConsoleSessions,
  type GridLayout,
  type ConsoleSession,
} from '@/hooks/useConsoleStore';

// Calculate grid dimensions from layout string
function getGridDimensions(layout: GridLayout): { cols: number; rows: number } {
  switch (layout) {
    case '1x1':
      return { cols: 1, rows: 1 };
    case '2x1':
      return { cols: 2, rows: 1 };
    case '2x2':
      return { cols: 2, rows: 2 };
    case '3x2':
      return { cols: 3, rows: 2 };
    default:
      return { cols: 2, rows: 2 };
  }
}

interface ConsoleGridProps {
  className?: string;
}

export function ConsoleGrid({ className }: ConsoleGridProps) {
  const sessions = useConsoleSessions();
  const { activeSessionId, viewMode, gridLayout, setActiveSession } = useConsoleStore();

  const { cols, rows } = useMemo(() => getGridDimensions(gridLayout), [gridLayout]);
  const maxVisible = cols * rows;

  // In tabs mode, only show the active session
  // In grid mode, show up to maxVisible sessions
  const visibleSessions = useMemo(() => {
    if (viewMode === 'tabs') {
      const active = sessions.find((s) => s.id === activeSessionId);
      return active ? [active] : sessions.slice(0, 1);
    }
    return sessions.slice(0, maxVisible);
  }, [sessions, viewMode, activeSessionId, maxVisible]);

  const handleConsoleFocus = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId);
    },
    [setActiveSession]
  );

  if (sessions.length === 0) {
    return (
      <div className={cn('flex-1 flex items-center justify-center', className)}>
        <EmptyState />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex-1 p-2 gap-2',
        viewMode === 'grid' ? 'grid' : 'flex',
        className
      )}
      style={
        viewMode === 'grid'
          ? {
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }
          : undefined
      }
    >
      <AnimatePresence mode="popLayout">
        {visibleSessions.map((session) => (
          <ConsolePane
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onFocus={() => handleConsoleFocus(session.id)}
            isSingleView={viewMode === 'tabs' || visibleSessions.length === 1}
          />
        ))}
      </AnimatePresence>

      {/* Show placeholder slots in grid mode if fewer sessions than grid capacity */}
      {viewMode === 'grid' &&
        visibleSessions.length < maxVisible &&
        Array.from({ length: maxVisible - visibleSessions.length }).map((_, i) => (
          <PlaceholderSlot key={`placeholder-${i}`} />
        ))}
    </div>
  );
}

interface ConsolePaneProps {
  session: ConsoleSession;
  isActive: boolean;
  onFocus: () => void;
  isSingleView: boolean;
}

function ConsolePane({ session, isActive, onFocus, isSingleView }: ConsolePaneProps) {
  // Build noVNC URL for this session
  const novncUrl = `/novnc/limiquantix.html?vmId=${encodeURIComponent(session.vmId)}&vmName=${encodeURIComponent(session.vmName)}`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      onClick={onFocus}
      className={cn(
        'relative flex flex-col rounded-lg overflow-hidden',
        'bg-black border transition-all duration-200',
        isActive
          ? 'border-accent shadow-[0_0_0_2px_rgba(147,51,234,0.3)]'
          : 'border-border hover:border-accent/50',
        isSingleView && 'flex-1'
      )}
    >
      {/* Console Header (visible in grid mode) */}
      {!isSingleView && (
        <div
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 text-xs font-medium',
            'bg-bg-surface border-b border-border',
            isActive ? 'text-accent' : 'text-text-muted'
          )}
        >
          <Monitor className="w-3.5 h-3.5" />
          <span className="truncate">{session.vmName}</span>
          {isActive && (
            <span className="ml-auto px-1.5 py-0.5 bg-accent/20 text-accent rounded text-[10px]">
              Focus
            </span>
          )}
        </div>
      )}

      {/* noVNC iframe */}
      <iframe
        src={novncUrl}
        className="flex-1 w-full border-0 bg-black"
        allow="clipboard-read; clipboard-write; fullscreen"
        title={`Console: ${session.vmName}`}
        tabIndex={isActive ? 0 : -1}
      />

      {/* Focus indicator overlay (when not focused in grid mode) */}
      {!isActive && !isSingleView && (
        <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="px-4 py-2 bg-bg-elevated/90 backdrop-blur rounded-lg text-sm font-medium text-text-primary border border-border">
            Click to focus
          </div>
        </div>
      )}
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-bg-surface flex items-center justify-center border border-border">
        <Monitor className="w-10 h-10 text-text-muted" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">No Consoles Open</h3>
      <p className="text-sm text-text-muted max-w-xs mx-auto">
        Click the <strong>+ Add</strong> button above to open a VM console, or select a VM from the list.
      </p>
    </div>
  );
}

function PlaceholderSlot() {
  return (
    <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-border bg-bg-base/50">
      <div className="text-center text-text-muted p-4">
        <Monitor className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs">Empty slot</p>
      </div>
    </div>
  );
}
