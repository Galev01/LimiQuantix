/**
 * ConsoleDock - Multi-console workspace page
 * 
 * Allows users to open and manage multiple VM consoles in tabs or grid layout.
 * Includes a collapsible VM sidebar for quick navigation.
 * Route: /consoles
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Monitor,
  Search,
  X,
  Loader2,
  Server,
  Play,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ConsoleTabBar, ConsoleGrid, VMSidebar } from '@/components/console';
import { useConsoleStore, useConsoleSessions, useSidebarCollapsed } from '@/hooks/useConsoleStore';
import { useVMs, type ApiVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';

export function ConsoleDock() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessions = useConsoleSessions();
  const sidebarCollapsed = useSidebarCollapsed();
  const { openConsole, setActiveSession, setSidebarCollapsed, updateThumbnail } = useConsoleStore();

  // VM picker modal state
  const [showVMPicker, setShowVMPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Check for vmId in URL params (for direct linking)
  useEffect(() => {
    const vmId = searchParams.get('vmId');
    const vmName = searchParams.get('vmName');
    if (vmId && vmName) {
      openConsole(vmId, vmName);
      // Remove params from URL after opening
      navigate('/consoles', { replace: true });
    }
  }, [searchParams, openConsole, navigate]);

  // Listen for thumbnail messages from console iframes
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'consoleThumbnail') {
        const { vmId, thumbnail, width, height } = event.data;
        if (vmId && thumbnail) {
          updateThumbnail(vmId, thumbnail, width, height);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [updateThumbnail]);

  // Keyboard shortcuts for switching tabs (Ctrl+1-9)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key, 10);
        if (num >= 1 && num <= 9) {
          const session = sessions[num - 1];
          if (session) {
            e.preventDefault();
            setActiveSession(session.id);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessions, setActiveSession]);

  const handleAddConsole = useCallback(() => {
    setShowVMPicker(true);
    setSearchQuery('');
  }, []);

  const handleSelectVM = useCallback(
    (vm: ApiVM) => {
      openConsole(vm.id, vm.name);
      setShowVMPicker(false);
    },
    [openConsole]
  );

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed, setSidebarCollapsed]);

  return (
    <div className="h-full flex bg-bg-base">
      {/* VM Sidebar */}
      <VMSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      />

      {/* Main Console Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab Bar */}
        <ConsoleTabBar onAddConsole={handleAddConsole} />

        {/* Console Grid */}
        <ConsoleGrid className="flex-1" />
      </div>

      {/* VM Picker Modal */}
      <AnimatePresence>
        {showVMPicker && (
          <VMPickerModal
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelect={handleSelectVM}
            onClose={() => setShowVMPicker(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface VMPickerModalProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (vm: ApiVM) => void;
  onClose: () => void;
}

function VMPickerModal({ searchQuery, onSearchChange, onSelect, onClose }: VMPickerModalProps) {
  const { data: isConnected } = useApiConnection();
  const { data: apiResponse, isLoading } = useVMs({ enabled: !!isConnected });
  const openSessions = useConsoleSessions();

  const vms = apiResponse?.vms || [];
  const filteredVMs = vms.filter(
    (vm) =>
      vm.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vm.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if VM is already open
  const isVMOpen = (vmId: string) => openSessions.some((s) => s.vmId === vmId);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <motion.div
        initial={{ backdropFilter: 'blur(0px)' }}
        animate={{ backdropFilter: 'blur(8px)' }}
        className="absolute inset-0 bg-black/60"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={cn(
          'relative w-full max-w-lg rounded-xl overflow-hidden',
          'bg-bg-elevated border border-border shadow-2xl'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Monitor className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="font-semibold text-text-primary">Open Console</h2>
              <p className="text-xs text-text-muted">Select a VM to open its console</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search VMs by name or ID..."
              className={cn(
                'w-full pl-9 pr-4 py-2.5 rounded-lg text-sm',
                'bg-bg-base border border-border',
                'text-text-primary placeholder:text-text-muted',
                'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent'
              )}
              autoFocus
            />
          </div>
        </div>

        {/* VM List */}
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
            </div>
          ) : filteredVMs.length === 0 ? (
            <div className="text-center py-12">
              <Server className="w-12 h-12 mx-auto mb-3 text-text-muted opacity-50" />
              <p className="text-text-muted">
                {searchQuery ? 'No VMs match your search' : 'No VMs available'}
              </p>
            </div>
          ) : (
            <div className="p-2">
              {filteredVMs.map((vm) => {
                const isRunning = vm.status?.state === 'RUNNING';
                const alreadyOpen = isVMOpen(vm.id);

                return (
                  <button
                    key={vm.id}
                    onClick={() => onSelect(vm)}
                    disabled={!isRunning}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors',
                      isRunning && !alreadyOpen
                        ? 'hover:bg-bg-hover'
                        : 'opacity-50 cursor-not-allowed',
                      alreadyOpen && 'bg-accent/10 border border-accent/20'
                    )}
                  >
                    {/* Status indicator */}
                    <div
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center',
                        isRunning ? 'bg-success/10' : 'bg-bg-surface'
                      )}
                    >
                      {isRunning ? (
                        <Play className="w-5 h-5 text-success" />
                      ) : (
                        <Square className="w-5 h-5 text-text-muted" />
                      )}
                    </div>

                    {/* VM Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-text-primary truncate">
                          {vm.name}
                        </span>
                        {alreadyOpen && (
                          <span className="px-1.5 py-0.5 bg-accent/20 text-accent text-[10px] rounded font-medium">
                            Open
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted truncate">
                        {vm.id.slice(0, 8)}...
                        {!isRunning && ' • VM is not running'}
                      </p>
                    </div>

                    {/* Action hint */}
                    {isRunning && !alreadyOpen && (
                      <Monitor className="w-5 h-5 text-text-muted group-hover:text-accent" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border bg-bg-surface text-xs text-text-muted">
          <span>Only running VMs can have their console opened</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ConsoleDock;
