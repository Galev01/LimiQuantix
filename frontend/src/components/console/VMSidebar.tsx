/**
 * VMSidebar - Collapsible sidebar showing all VMs for quick console navigation
 * 
 * Features:
 * - Search/filter VMs
 * - Status indicators (running/stopped)
 * - "Open" badge for VMs with active console sessions
 * - Click to open/focus console
 * - Keyboard navigation
 * - Collapsible to icon-only mode
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Monitor,
  Server,
  Play,
  Square,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVMs, type ApiVM, isVMRunning } from '@/hooks/useVMs';
import { useConsoleSessions, useConsoleStore } from '@/hooks/useConsoleStore';
import { useApiConnection } from '@/hooks/useDashboard';

interface VMSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  className?: string;
}

export function VMSidebar({ collapsed, onToggleCollapse, className }: VMSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Data fetching
  const { data: isConnected } = useApiConnection();
  const { data: apiResponse, isLoading } = useVMs({ enabled: !!isConnected });
  const openSessions = useConsoleSessions();
  const { openConsole, setActiveSession } = useConsoleStore();

  const vms = apiResponse?.vms || [];

  // Filter VMs by search query
  const filteredVMs = useMemo(() => {
    if (!searchQuery.trim()) return vms;
    const query = searchQuery.toLowerCase();
    return vms.filter(
      (vm) =>
        vm.name.toLowerCase().includes(query) ||
        vm.id.toLowerCase().includes(query)
    );
  }, [vms, searchQuery]);

  // Check if VM is already open in console
  const getOpenSession = useCallback(
    (vmId: string) => openSessions.find((s) => s.vmId === vmId),
    [openSessions]
  );

  // Handle VM click
  const handleVMClick = useCallback(
    (vm: ApiVM) => {
      const isRunning = vm.status?.state === 'RUNNING';
      if (!isRunning) return;

      const existingSession = getOpenSession(vm.id);
      if (existingSession) {
        // Focus existing session
        setActiveSession(existingSession.id);
      } else {
        // Open new console
        openConsole(vm.id, vm.name);
      }
    },
    [getOpenSession, setActiveSession, openConsole]
  );

  // Keyboard navigation
  useEffect(() => {
    if (collapsed) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== searchInputRef.current && 
          !listRef.current?.contains(document.activeElement)) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => 
            prev < filteredVMs.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case 'Enter':
          if (focusedIndex >= 0 && focusedIndex < filteredVMs.length) {
            handleVMClick(filteredVMs[focusedIndex]);
          }
          break;
        case 'Escape':
          setSearchQuery('');
          setFocusedIndex(-1);
          searchInputRef.current?.blur();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [collapsed, filteredVMs, focusedIndex, handleVMClick]);

  // Reset focus when filtered list changes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery]);

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 48 : 240 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className={cn(
        'h-full flex flex-col bg-bg-surface border-r border-border',
        'shrink-0 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className={cn(
        'flex items-center gap-2 p-3 border-b border-border',
        collapsed ? 'justify-center' : 'justify-between'
      )}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-accent" />
            <span className="font-medium text-sm text-text-primary">VMs</span>
            <span className="px-1.5 py-0.5 bg-bg-base rounded text-[10px] text-text-muted">
              {vms.length}
            </span>
          </div>
        )}
        <button
          onClick={onToggleCollapse}
          className={cn(
            'w-7 h-7 rounded-md flex items-center justify-center',
            'text-text-muted hover:text-text-primary hover:bg-bg-hover',
            'transition-colors'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Search (only when expanded) */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 border-b border-border"
          >
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search VMs..."
                className={cn(
                  'w-full pl-8 pr-3 py-1.5 rounded-md text-xs',
                  'bg-bg-base border border-border',
                  'text-text-primary placeholder:text-text-muted',
                  'focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent'
                )}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* VM List */}
      <div ref={listRef} className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className={cn(
              'animate-spin text-accent',
              collapsed ? 'w-4 h-4' : 'w-5 h-5'
            )} />
          </div>
        ) : filteredVMs.length === 0 ? (
          !collapsed && (
            <div className="text-center py-8 px-3">
              <Server className="w-8 h-8 mx-auto mb-2 text-text-muted opacity-50" />
              <p className="text-xs text-text-muted">
                {searchQuery ? 'No VMs found' : 'No VMs available'}
              </p>
            </div>
          )
        ) : (
          <div className="px-1.5 space-y-0.5">
            {filteredVMs.map((vm, index) => (
              <VMListItem
                key={vm.id}
                vm={vm}
                collapsed={collapsed}
                isOpen={!!getOpenSession(vm.id)}
                isFocused={focusedIndex === index}
                onClick={() => handleVMClick(vm)}
                onFocus={() => setFocusedIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Collapse button at bottom (when collapsed) */}
      {collapsed && (
        <div className="p-1.5 border-t border-border">
          <button
            onClick={onToggleCollapse}
            className={cn(
              'w-full p-2 rounded-md flex items-center justify-center',
              'text-text-muted hover:text-text-primary hover:bg-bg-hover',
              'transition-colors'
            )}
            title="Expand sidebar"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </motion.aside>
  );
}

interface VMListItemProps {
  vm: ApiVM;
  collapsed: boolean;
  isOpen: boolean;
  isFocused: boolean;
  onClick: () => void;
  onFocus: () => void;
}

function VMListItem({ vm, collapsed, isOpen, isFocused, onClick, onFocus }: VMListItemProps) {
  const isRunning = isVMRunning(vm);
  const canOpen = isRunning;

  return (
    <button
      onClick={onClick}
      onFocus={onFocus}
      disabled={!canOpen}
      title={collapsed ? `${vm.name}${!isRunning ? ' (stopped)' : ''}` : undefined}
      className={cn(
        'w-full flex items-center gap-2 rounded-md transition-all',
        collapsed ? 'p-2 justify-center' : 'px-2.5 py-2',
        canOpen 
          ? 'hover:bg-bg-hover cursor-pointer' 
          : 'opacity-50 cursor-not-allowed',
        isOpen && 'bg-accent/10 border border-accent/20',
        isFocused && canOpen && 'ring-1 ring-accent/50'
      )}
    >
      {/* Status indicator */}
      <div className={cn(
        'shrink-0 flex items-center justify-center',
        collapsed ? 'w-4 h-4' : 'w-6 h-6 rounded bg-opacity-10',
        isRunning ? 'text-success' : 'text-text-muted'
      )}>
        {isRunning ? (
          collapsed ? (
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          ) : (
            <div className="w-6 h-6 rounded bg-success/10 flex items-center justify-center">
              <Play className="w-3 h-3" />
            </div>
          )
        ) : (
          collapsed ? (
            <div className="w-2 h-2 rounded-full bg-text-muted" />
          ) : (
            <div className="w-6 h-6 rounded bg-bg-base flex items-center justify-center">
              <Square className="w-3 h-3" />
            </div>
          )
        )}
      </div>

      {/* VM info (only when expanded) */}
      {!collapsed && (
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'text-xs font-medium truncate',
              isRunning ? 'text-text-primary' : 'text-text-muted'
            )}>
              {vm.name}
            </span>
            {isOpen && (
              <span className="shrink-0 px-1 py-0.5 bg-accent/20 text-accent text-[9px] rounded font-medium">
                Open
              </span>
            )}
          </div>
          {!isRunning && (
            <p className="text-[10px] text-text-muted truncate">
              Stopped
            </p>
          )}
        </div>
      )}

      {/* Console icon (when expanded and running) */}
      {!collapsed && isRunning && !isOpen && (
        <Monitor className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  );
}

export default VMSidebar;
