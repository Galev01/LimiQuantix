/**
 * VM Folder View - vCenter-Style Interface
 * 
 * Document ID: 000063
 * 
 * A full-screen 1920x1080 dedicated layout similar to VMware vCenter with:
 * - Left sidebar: Folder tree + VM list
 * - Right panel: Full VM details with all interactions
 * - Instant VM switching with prefetching
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  MoreHorizontal,
  Monitor,
  Play,
  Square,
  Trash2,
  Edit,
  Plus,
  Server,
  Loader2,
  X,
  Home,
  Maximize2,
  Minimize2,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  MonitorPlay,
  Camera,
  Settings,
  Code,
  Copy,
  Power,
  ArrowLeft,
  Wifi,
  WifiOff,
  Clock,
  Terminal,
  Info,
  Activity,
  CheckCircle2,
  AlertCircle,
  // Context menu icons
  RotateCcw,
  FolderInput,
  FileText,
  FileOutput,
  Tag,
  Shield,
  Bell,
  HardDriveDownload,
  Pencil,
  ArrowRightLeft,
} from 'lucide-react';
import { cn, formatBytes, formatUptime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { VMStatusBadge } from '@/components/vm/VMStatusBadge';
import { ProgressRing } from '@/components/dashboard/ProgressRing';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { NoVNCConsole } from '@/components/vm/NoVNCConsole';
import { ConsoleAccessModal } from '@/components/vm/ConsoleAccessModal';
import { ExecuteScriptModal } from '@/components/vm/ExecuteScriptModal';
import { EditSettingsModal } from '@/components/vm/EditSettingsModal';
import { EditResourcesModal } from '@/components/vm/EditResourcesModal';
import { DeleteVMModal } from '@/components/vm/DeleteVMModal';
import { QuantixAgentStatus } from '@/components/vm/QuantixAgentStatus';
import { FileBrowser } from '@/components/vm/FileBrowser';
import { 
  useFolders, 
  useFolderTree, 
  useCreateFolder, 
  useDeleteFolder,
  type Folder as FolderType,
  type FolderTree,
} from '@/hooks/useFolders';
import { 
  useVMs, 
  useVM,
  useStartVM, 
  useStopVM, 
  useDeleteVM,
  useUpdateVM,
  type ApiVM 
} from '@/hooks/useVMs';
import { useSnapshots, useCreateSnapshot, useRevertToSnapshot, useDeleteSnapshot } from '@/hooks/useSnapshots';
import { useApiConnection } from '@/hooks/useDashboard';
import { type VirtualMachine, type PowerState } from '@/types/models';
import { showInfo, showWarning } from '@/lib/toast';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

// Convert API VM to display format
function apiToDisplayVM(vm: ApiVM): VirtualMachine & { folderId?: string } {
  const state = (vm.status?.state || 'STOPPED') as PowerState;
  return {
    id: vm.id,
    name: vm.name,
    projectId: vm.projectId,
    description: vm.description || '',
    labels: vm.labels || {},
    folderId: vm.folderId,
    spec: {
      cpu: { cores: vm.spec?.cpu?.cores || 1, sockets: 1, model: 'host' },
      memory: { sizeMib: vm.spec?.memory?.sizeMib || 1024 },
      disks: (vm.spec?.disks || []).map((d, i) => ({
        id: `disk-${i}`,
        sizeGib: d.sizeGib || 0,
        bus: 'virtio',
      })),
      nics: [{ id: 'nic-0', networkId: 'default', macAddress: '00:00:00:00:00:00' }],
    },
    status: {
      state,
      nodeId: vm.status?.nodeId || '',
      ipAddresses: vm.status?.ipAddresses || [],
      resourceUsage: {
        cpuUsagePercent: vm.status?.resourceUsage?.cpuUsagePercent || 0,
        memoryUsedBytes: (vm.status?.resourceUsage?.memoryUsedMib || 0) * 1024 * 1024,
        memoryAllocatedBytes: (vm.spec?.memory?.sizeMib || 1024) * 1024 * 1024,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Linux',
        hostname: vm.name,
        agentVersion: '1.0.0',
        uptimeSeconds: 0,
      },
    },
    createdAt: vm.createdAt || new Date().toISOString(),
  };
}

// Info row component for VM details with subtle hover
function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-2.5 px-2 -mx-2 rounded-lg border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors duration-150">
      <span className="text-sm text-[var(--text-tertiary)]">{label}</span>
      <span className={cn('text-sm text-[var(--text-primary)] font-medium', mono && 'font-mono text-[var(--accent-blue)]')}>{value}</span>
    </div>
  );
}

// Hardware card for VM summary with depth and glow
function HardwareCard({ icon, label, value, subvalue }: { icon: React.ReactNode; label: string; value: string; subvalue: string }) {
  return (
    <motion.div 
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'relative overflow-hidden rounded-xl p-4',
        'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
        'border border-white/5',
        'shadow-[0_-1px_2px_rgba(255,255,255,0.05),0_4px_12px_rgba(0,0,0,0.2)]',
        'hover:shadow-[0_-1px_3px_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.3)]',
        'transition-shadow duration-200'
      )}
    >
      {/* Subtle glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--accent-blue)]/5 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]">
            {icon}
          </div>
          <span className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-2xl font-bold text-[var(--text-primary)] mb-1">{value}</div>
        <div className="text-xs text-[var(--text-tertiary)]">{subvalue}</div>
      </div>
    </motion.div>
  );
}

// Context menu item type
interface ContextMenuItem {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
  divider?: boolean;
}

// VM Context menu position
interface VMContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  vm: (VirtualMachine & { folderId?: string }) | null;
}

// Folder Context menu position
interface FolderContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  folder: FolderType | null;
}

// Sidebar VM item
interface VMSidebarItemProps {
  vm: VirtualMachine & { folderId?: string };
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
  onContextMenu: (e: React.MouseEvent, vm: VirtualMachine & { folderId?: string }) => void;
}

function VMSidebarItem({ vm, isSelected, onClick, onHover, onContextMenu }: VMSidebarItemProps) {
  return (
    <motion.div
      whileHover={{ x: 2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 cursor-pointer rounded-xl mx-2 my-0.5',
        'transition-all duration-200',
        'hover:bg-gradient-to-r hover:from-white/5 hover:to-transparent',
        isSelected && [
          'bg-gradient-to-r from-[var(--accent-blue)]/15 to-[var(--accent-blue)]/5',
          'shadow-[inset_0_1px_2px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.2)]',
          'border border-[var(--accent-blue)]/30'
        ],
        !isSelected && 'border border-transparent'
      )}
      onClick={onClick}
      onMouseEnter={onHover}
      onContextMenu={(e) => onContextMenu(e, vm)}
    >
      <div className={cn(
        'p-1.5 rounded-lg flex-shrink-0',
        vm.status.state === 'RUNNING' 
          ? 'bg-green-500/10 text-green-400' 
          : 'bg-white/5 text-[var(--text-tertiary)]'
      )}>
        <Monitor className="w-3.5 h-3.5" />
      </div>
      <span className={cn(
        'flex-1 text-sm truncate',
        isSelected ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'
      )}>
        {vm.name}
      </span>
      <div className={cn(
        'w-2 h-2 rounded-full flex-shrink-0 ring-2',
        vm.status.state === 'RUNNING' ? 'bg-green-400 ring-green-400/30 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 
        vm.status.state === 'STOPPED' ? 'bg-gray-500 ring-gray-500/30' : 'bg-yellow-400 ring-yellow-400/30'
      )} />
    </motion.div>
  );
}

// Folder node in sidebar
interface FolderNodeProps {
  folder: FolderType;
  children: FolderTree[];
  level: number;
  expandedFolders: Set<string>;
  selectedVmId: string | null;
  vmsByFolder: Map<string, (VirtualMachine & { folderId?: string })[]>;
  onToggleExpand: (folderId: string) => void;
  onSelectVM: (vmId: string) => void;
  onHoverVM: (vmId: string) => void;
  onContextMenu: (e: React.MouseEvent, vm: VirtualMachine & { folderId?: string }) => void;
  onFolderContextMenu: (e: React.MouseEvent, folder: FolderType) => void;
}

function FolderNode({
  folder,
  children,
  level,
  expandedFolders,
  selectedVmId,
  vmsByFolder,
  onToggleExpand,
  onSelectVM,
  onHoverVM,
  onContextMenu,
  onFolderContextMenu,
}: FolderNodeProps) {
  const isExpanded = expandedFolders.has(folder.id);
  const folderVMs = vmsByFolder.get(folder.id) || [];
  const childFolders = children || [];
  const hasChildren = childFolders.length > 0 || folderVMs.length > 0;

  return (
    <div>
      {/* Folder Row */}
      <motion.div
        whileHover={{ x: 2 }}
        transition={{ duration: 0.15 }}
        className={cn(
          'flex items-center gap-2 px-2 py-2 cursor-pointer rounded-xl mx-2 my-0.5',
          'transition-all duration-200',
          'hover:bg-gradient-to-r hover:from-amber-500/10 hover:to-transparent',
          'border border-transparent hover:border-amber-500/20'
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => onToggleExpand(folder.id)}
        onContextMenu={(e) => onFolderContextMenu(e, folder)}
      >
        <motion.button 
          animate={{ rotate: isExpanded ? 0 : -90 }}
          transition={{ duration: 0.2 }}
          className="w-4 h-4 flex items-center justify-center"
        >
          {hasChildren && (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          )}
        </motion.button>
        <div className={cn(
          'p-1 rounded-md transition-all duration-200',
          isExpanded ? 'bg-amber-500/15' : 'bg-amber-500/5'
        )}>
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-amber-400" />
          ) : (
            <Folder className="w-4 h-4 text-amber-400/70" />
          )}
        </div>
        <span className="text-sm text-[var(--text-secondary)] truncate flex-1 font-medium">
          {folder.name}
        </span>
        {folderVMs.length > 0 && (
          <span className="text-xs text-[var(--text-tertiary)] bg-white/5 px-2 py-0.5 rounded-full">
            {folderVMs.length}
          </span>
        )}
      </motion.div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {/* VMs in this folder */}
            {folderVMs.map((vm) => (
              <div key={vm.id} style={{ paddingLeft: `${(level + 1) * 12}px` }}>
                <VMSidebarItem
                  vm={vm}
                  isSelected={selectedVmId === vm.id}
                  onClick={() => onSelectVM(vm.id)}
                  onHover={() => onHoverVM(vm.id)}
                  onContextMenu={onContextMenu}
                />
              </div>
            ))}

            {/* Subfolders */}
            {childFolders.map((child) => (
              <FolderNode
                key={child.folder.id}
                folder={child.folder}
                children={child.children}
                level={level + 1}
                expandedFolders={expandedFolders}
                selectedVmId={selectedVmId}
                vmsByFolder={vmsByFolder}
                onToggleExpand={onToggleExpand}
                onSelectVM={onSelectVM}
                onHoverVM={onHoverVM}
                onContextMenu={onContextMenu}
                onFolderContextMenu={onFolderContextMenu}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function VMFolderView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['10000000-0000-0000-0000-000000000001']));
  const [selectedVmId, setSelectedVmId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Modal states
  const [isConsoleModalOpen, setIsConsoleModalOpen] = useState(false);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isResourcesModalOpen, setIsResourcesModalOpen] = useState(false);
  const [isCreateSnapshotOpen, setIsCreateSnapshotOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotDescription, setSnapshotDescription] = useState('');
  const [includeMemory, setIncludeMemory] = useState(false);
  const [quiesceFs, setQuiesceFs] = useState(false);
  
  // Folder dialog
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [parentIdForCreate, setParentIdForCreate] = useState<string>('');
  
  // Move to folder dialog
  const [showMoveToFolderDialog, setShowMoveToFolderDialog] = useState(false);
  const [vmToMove, setVmToMove] = useState<(VirtualMachine & { folderId?: string }) | null>(null);
  const [targetFolderId, setTargetFolderId] = useState<string>('');
  
  // Rename dialog
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [vmToRename, setVmToRename] = useState<(VirtualMachine & { folderId?: string }) | null>(null);
  const [newVmName, setNewVmName] = useState('');
  
  // VM Context menu state
  const [contextMenu, setContextMenu] = useState<VMContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    vm: null,
  });
  
  // Folder Context menu state
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    folder: null,
  });
  
  // Delete modal state
  const [deleteModalState, setDeleteModalState] = useState<{
    isOpen: boolean;
    vm: VirtualMachine | null;
  }>({ isOpen: false, vm: null });
  
  // Folder rename dialog
  const [showRenameFolderDialog, setShowRenameFolderDialog] = useState(false);
  const [folderToRename, setFolderToRename] = useState<FolderType | null>(null);
  const [newFolderNameForRename, setNewFolderNameForRename] = useState('');
  
  // Folder move dialog
  const [showMoveFolderDialog, setShowMoveFolderDialog] = useState(false);
  const [folderToMove, setFolderToMove] = useState<FolderType | null>(null);
  const [targetParentFolderId, setTargetParentFolderId] = useState<string>('');

  // API Connection
  const { data: isConnected = false } = useApiConnection();

  // Fetch folders and VMs
  const { data: foldersData, isLoading: isLoadingFolders, refetch: refetchFolders } = useFolders({ type: 'VM' });
  const { data: treeData } = useFolderTree({ type: 'VM', depth: 10 });
  const { data: vmsData, isLoading: isLoadingVMs, refetch: refetchVMs, isRefetching } = useVMs({ enabled: !!isConnected });
  
  // Selected VM data
  const { data: selectedApiVm, isLoading: isLoadingSelectedVm } = useVM(selectedVmId || '', !!isConnected && !!selectedVmId);
  const selectedVm = selectedApiVm ? apiToDisplayVM(selectedApiVm) : null;
  
  // Snapshots for selected VM
  const { data: snapshots = [], isLoading: isLoadingSnapshots } = useSnapshots(selectedVmId || '', !!isConnected && !!selectedVmId);

  // Mutations
  const createFolderMutation = useCreateFolder();
  const deleteFolderMutation = useDeleteFolder();
  const startVM = useStartVM();
  const stopVM = useStopVM();
  const deleteVM = useDeleteVM();
  const updateVM = useUpdateVM();
  const createSnapshot = useCreateSnapshot();
  const revertToSnapshot = useRevertToSnapshot();
  const deleteSnapshot = useDeleteSnapshot();

  // Convert VMs and group by folder
  const allVMs = useMemo(() => {
    return (vmsData?.vms || []).map(apiToDisplayVM);
  }, [vmsData]);

  const vmsByFolder = useMemo(() => {
    const map = new Map<string, (VirtualMachine & { folderId?: string })[]>();
    (foldersData?.folders || []).forEach((f) => map.set(f.id, []));
    allVMs.forEach((vm) => {
      const folderId = vm.folderId || '10000000-0000-0000-0000-000000000001';
      const existing = map.get(folderId) || [];
      existing.push(vm);
      map.set(folderId, existing);
    });
    return map;
  }, [allVMs, foldersData]);

  // Filter VMs based on search
  const filteredVMs = useMemo(() => {
    if (!searchQuery) return allVMs;
    return allVMs.filter((vm) =>
      vm.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allVMs, searchQuery]);

  // Build folder tree
  const folderTree = useMemo((): FolderTree[] => {
    const tree = treeData?.tree;
    if (!tree) {
      const folders = foldersData?.folders || [];
      return folders.map((f) => ({ folder: f, children: [] }));
    }
    if (tree.folder) {
      return tree.children?.length ? tree.children : [tree];
    }
    return tree.children || [];
  }, [treeData, foldersData]);

  // Prefetch VM data on hover for instant switching
  const handleHoverVM = useCallback((vmId: string) => {
    if (vmId !== selectedVmId) {
      queryClient.prefetchQuery({
        queryKey: ['vms', 'detail', vmId],
        staleTime: 30000,
      });
    }
  }, [selectedVmId, queryClient]);

  // Select first VM automatically
  useEffect(() => {
    if (!selectedVmId && allVMs.length > 0) {
      setSelectedVmId(allVMs[0].id);
    }
  }, [allVMs, selectedVmId]);

  // Handlers
  const handleToggleExpand = (folderId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const handleSelectVM = (vmId: string) => {
    setSelectedVmId(vmId);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Folder name is required');
      return;
    }
    try {
      await createFolderMutation.mutateAsync({
        name: newFolderName.trim(),
        parentId: parentIdForCreate || undefined,
        type: 'VM',
      });
      setShowCreateFolderDialog(false);
      setNewFolderName('');
      refetchFolders();
    } catch (error) {
      console.error('Failed to create folder:', error);
    }
  };

  // VM Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, vm: VirtualMachine & { folderId?: string }) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderContextMenu((prev) => ({ ...prev, isOpen: false }));
    setContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      vm,
    });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Folder Context menu handlers
  const handleFolderContextMenu = useCallback((e: React.MouseEvent, folder: FolderType) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
    setFolderContextMenu({
      isOpen: true,
      x: e.clientX,
      y: e.clientY,
      folder,
    });
  }, []);

  const closeFolderContextMenu = useCallback(() => {
    setFolderContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // Close context menus on click outside or escape
  useEffect(() => {
    const handleClick = () => {
      closeContextMenu();
      closeFolderContextMenu();
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        closeFolderContextMenu();
      }
    };
    if (contextMenu.isOpen || folderContextMenu.isOpen) {
      document.addEventListener('click', handleClick);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu.isOpen, folderContextMenu.isOpen, closeContextMenu, closeFolderContextMenu]);

  // Context menu actions
  const handleContextMenuAction = useCallback(async (action: string) => {
    const vm = contextMenu.vm;
    if (!vm) return;
    closeContextMenu();

    switch (action) {
      case 'start':
        if (!isConnected) return showInfo('Not connected to backend');
        await startVM.mutateAsync(vm.id);
        break;
      case 'stop':
        if (!isConnected) return showInfo('Not connected to backend');
        await stopVM.mutateAsync({ id: vm.id, force: false });
        break;
      case 'restart':
        if (!isConnected) return showInfo('Not connected to backend');
        await stopVM.mutateAsync({ id: vm.id, force: false });
        setTimeout(() => startVM.mutateAsync(vm.id), 2000);
        toast.info('Restarting VM...');
        break;
      case 'delete':
      case 'deleteFromDisk':
        // Both delete options now use the modal for proper handling
        if (!isConnected) return showInfo('Not connected to backend');
        setDeleteModalState({ isOpen: true, vm });
        break;
      case 'migrate':
        showWarning('Migrate VM feature coming soon');
        break;
      case 'editSettings':
        setSelectedVmId(vm.id);
        setIsSettingsModalOpen(true);
        break;
      case 'moveToFolder':
        setVmToMove(vm);
        setTargetFolderId(vm.folderId || '10000000-0000-0000-0000-000000000001');
        setShowMoveToFolderDialog(true);
        break;
      case 'rename':
        setVmToRename(vm);
        setNewVmName(vm.name);
        setShowRenameDialog(true);
        break;
      case 'convertToTemplate':
        showWarning('Convert to Template feature coming soon');
        break;
      case 'exportOva':
        showWarning('Export OVA/OVF feature coming soon');
        break;
      case 'addTag':
        showWarning('Add Tag feature coming soon');
        break;
      case 'addPermissions':
        showWarning('Add Permissions feature coming soon');
        break;
      case 'configureAlarms':
        showWarning('Configure Alarms feature coming soon');
        break;
      default:
        break;
    }
  }, [contextMenu.vm, isConnected, startVM, stopVM, closeContextMenu]);

  // Handle delete confirmation from modal
  const handleDeleteConfirm = async (options: {
    deleteVolumes: boolean;
    removeFromInventoryOnly: boolean;
    force: boolean;
  }) => {
    const vm = deleteModalState.vm;
    if (!vm || !isConnected) return;
    
    await deleteVM.mutateAsync({ 
      id: vm.id,
      force: options.force,
      deleteVolumes: options.deleteVolumes,
      removeFromInventoryOnly: options.removeFromInventoryOnly,
    });
    
    if (selectedVmId === vm.id) {
      setSelectedVmId(null);
    }
  };

  // Rename VM handler
  const handleRenameVM = async () => {
    if (!vmToRename || !newVmName.trim() || !isConnected) return;
    try {
      await updateVM.mutateAsync({
        id: vmToRename.id,
        name: newVmName.trim(),
      });
      setShowRenameDialog(false);
      setVmToRename(null);
      setNewVmName('');
      toast.success('VM renamed successfully');
    } catch (error) {
      console.error('Failed to rename VM:', error);
    }
  };

  // Move to folder handler
  const handleMoveToFolder = async () => {
    if (!vmToMove || !targetFolderId || !isConnected) return;
    try {
      await updateVM.mutateAsync({
        id: vmToMove.id,
        labels: { ...vmToMove.labels, 'quantix.io/folder-id': targetFolderId },
      });
      setShowMoveToFolderDialog(false);
      setVmToMove(null);
      setTargetFolderId('');
      toast.success('VM moved to folder');
      refetchVMs();
    } catch (error) {
      console.error('Failed to move VM:', error);
    }
  };

  // Build context menu items
  const getContextMenuItems = useCallback((): ContextMenuItem[] => {
    const vm = contextMenu.vm;
    if (!vm) return [];
    
    const isRunning = vm.status.state === 'RUNNING';
    const isStopped = vm.status.state === 'STOPPED';
    
    return [
      // Power operations
      {
        label: 'Power On',
        icon: <Play className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('start'),
        disabled: isRunning,
      },
      {
        label: 'Power Off',
        icon: <Square className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('stop'),
        disabled: isStopped,
      },
      {
        label: 'Restart',
        icon: <RotateCcw className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('restart'),
        disabled: isStopped,
        divider: true,
      },
      // VM management
      {
        label: 'Migrate...',
        icon: <ArrowRightLeft className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('migrate'),
      },
      {
        label: 'Edit Settings...',
        icon: <Settings className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('editSettings'),
      },
      {
        label: 'Move to Folder...',
        icon: <FolderInput className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('moveToFolder'),
      },
      {
        label: 'Rename...',
        icon: <Pencil className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('rename'),
        divider: true,
      },
      // Template operations
      {
        label: 'Convert to Template',
        icon: <FileText className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('convertToTemplate'),
      },
      {
        label: 'Export OVA/OVF...',
        icon: <FileOutput className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('exportOva'),
        divider: true,
      },
      // Tags & Permissions
      {
        label: 'Add Tag...',
        icon: <Tag className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('addTag'),
      },
      {
        label: 'Add Permissions...',
        icon: <Shield className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('addPermissions'),
      },
      {
        label: 'Configure Alarms...',
        icon: <Bell className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('configureAlarms'),
        divider: true,
      },
      // Delete operations
      {
        label: 'Delete',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('delete'),
        variant: 'danger',
      },
      {
        label: 'Delete from Disk',
        icon: <HardDriveDownload className="w-4 h-4" />,
        onClick: () => handleContextMenuAction('deleteFromDisk'),
        variant: 'danger',
      },
    ];
  }, [contextMenu.vm, handleContextMenuAction]);

  // Folder context menu actions
  const handleFolderContextMenuAction = useCallback(async (action: string) => {
    const folder = folderContextMenu.folder;
    if (!folder) return;
    closeFolderContextMenu();

    switch (action) {
      case 'newVM':
        // Open VM creation wizard with this folder pre-selected
        showWarning('New VM in folder feature - use the VM creation wizard and select this folder');
        break;
      case 'deployOvf':
        showWarning('Deploy OVF/OVA feature coming soon');
        break;
      case 'newFolder':
        setParentIdForCreate(folder.id);
        setShowCreateFolderDialog(true);
        break;
      case 'renameFolder':
        setFolderToRename(folder);
        setNewFolderNameForRename(folder.name);
        setShowRenameFolderDialog(true);
        break;
      case 'moveFolder':
        setFolderToMove(folder);
        setTargetParentFolderId(folder.parentId || '');
        setShowMoveFolderDialog(true);
        break;
      case 'addPermissions':
        showWarning('Add Permissions feature coming soon');
        break;
      case 'addTags':
        showWarning('Add Tags feature coming soon');
        break;
      case 'removeFolder':
        if (!confirm(`Are you sure you want to remove the folder "${folder.name}"? VMs inside will be moved to the parent folder.`)) return;
        try {
          await deleteFolderMutation.mutateAsync({ id: folder.id });
          refetchFolders();
          toast.success('Folder removed');
        } catch (error) {
          console.error('Failed to delete folder:', error);
        }
        break;
      default:
        break;
    }
  }, [folderContextMenu.folder, closeFolderContextMenu, deleteFolderMutation, refetchFolders]);

  // Rename folder handler
  const handleRenameFolder = async () => {
    if (!folderToRename || !newFolderNameForRename.trim()) return;
    try {
      // Use the folder update API (assuming it exists, or show placeholder)
      showWarning('Folder rename requires UpdateFolder API - coming soon');
      setShowRenameFolderDialog(false);
      setFolderToRename(null);
      setNewFolderNameForRename('');
    } catch (error) {
      console.error('Failed to rename folder:', error);
    }
  };

  // Move folder handler  
  const handleMoveFolderToParent = async () => {
    if (!folderToMove || !targetParentFolderId) return;
    try {
      // Use the folder update API (assuming it exists, or show placeholder)
      showWarning('Folder move requires UpdateFolder API - coming soon');
      setShowMoveFolderDialog(false);
      setFolderToMove(null);
      setTargetParentFolderId('');
    } catch (error) {
      console.error('Failed to move folder:', error);
    }
  };

  // Build folder context menu items
  const getFolderContextMenuItems = useCallback((): ContextMenuItem[] => {
    const folder = folderContextMenu.folder;
    if (!folder) return [];
    
    // Check if it's a system folder (root folders that shouldn't be deleted/renamed)
    const isSystemFolder = folder.id.startsWith('10000000-0000-0000-0000-');
    
    return [
      // Create operations
      {
        label: 'New Virtual Machine...',
        icon: <Plus className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('newVM'),
      },
      {
        label: 'Deploy OVF/OVA Template...',
        icon: <FileOutput className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('deployOvf'),
        divider: true,
      },
      // Folder operations
      {
        label: 'New Folder...',
        icon: <FolderPlus className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('newFolder'),
      },
      {
        label: 'Rename...',
        icon: <Pencil className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('renameFolder'),
        disabled: isSystemFolder,
      },
      {
        label: 'Move To...',
        icon: <FolderInput className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('moveFolder'),
        disabled: isSystemFolder,
        divider: true,
      },
      // Permissions & Tags
      {
        label: 'Add Permissions...',
        icon: <Shield className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('addPermissions'),
      },
      {
        label: 'Add Tags...',
        icon: <Tag className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('addTags'),
        divider: true,
      },
      // Delete
      {
        label: 'Remove Folder',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: () => handleFolderContextMenuAction('removeFolder'),
        disabled: isSystemFolder,
        variant: 'danger',
      },
    ];
  }, [folderContextMenu.folder, handleFolderContextMenuAction]);

  // VM Action handlers
  const handleStart = async () => {
    if (!isConnected || !selectedVmId) {
      showInfo('Not connected to backend');
      return;
    }
    await startVM.mutateAsync(selectedVmId);
  };

  const handleStop = async (force = false) => {
    if (!isConnected || !selectedVmId) {
      showInfo('Not connected to backend');
      return;
    }
    await stopVM.mutateAsync({ id: selectedVmId, force });
  };

  const handleForceStop = async () => {
    if (!confirm('Are you sure you want to force stop this VM?')) return;
    await handleStop(true);
  };

  const handleDelete = () => {
    if (!isConnected || !selectedVmId || !selectedVm) {
      showInfo('Not connected to backend');
      return;
    }
    setDeleteModalState({ isOpen: true, vm: selectedVm });
  };

  const handleSaveSettings = async (settings: { name: string; description: string; labels: Record<string, string> }) => {
    if (!selectedVmId || !isConnected) return;
    await updateVM.mutateAsync({
      id: selectedVmId,
      name: settings.name,
      description: settings.description,
      labels: settings.labels,
    });
  };

  const handleSaveResources = async (resources: { cores: number; memoryMib: number }) => {
    if (!selectedVmId || !isConnected) return;
    await updateVM.mutateAsync({
      id: selectedVmId,
      spec: {
        cpu: { cores: resources.cores },
        memory: { sizeMib: resources.memoryMib },
      },
    });
  };

  const handleCreateSnapshot = async () => {
    if (!selectedVmId || !snapshotName.trim()) return;
    await createSnapshot.mutateAsync({
      vmId: selectedVmId,
      name: snapshotName.trim(),
      description: snapshotDescription.trim() || undefined,
      includeMemory,
      quiesce: quiesceFs,
    });
    setSnapshotName('');
    setSnapshotDescription('');
    setIncludeMemory(false);
    setQuiesceFs(false);
    setIsCreateSnapshotOpen(false);
  };

  const handleRefresh = () => {
    refetchFolders();
    refetchVMs();
  };

  const isActionPending = startVM.isPending || stopVM.isPending || deleteVM.isPending || updateVM.isPending;
  const isLoading = isLoadingFolders || isLoadingVMs;

  // VM dropdown actions
  const getVMActions = (): DropdownMenuItem[] => {
    const isRunning = selectedVm?.status.state === 'RUNNING';
    return [
      { label: 'Edit Settings', icon: <Settings className="w-4 h-4" />, onClick: () => setIsSettingsModalOpen(true) },
      { label: 'Edit Resources', icon: <Cpu className="w-4 h-4" />, onClick: () => setIsResourcesModalOpen(true) },
      { label: 'Run Script', icon: <Code className="w-4 h-4" />, onClick: () => setIsScriptModalOpen(true), disabled: !isRunning },
      { label: 'Browse Files', icon: <Folder className="w-4 h-4" />, onClick: () => setIsFileBrowserOpen(true), disabled: !isRunning },
      { label: 'Clone VM', icon: <Copy className="w-4 h-4" />, onClick: () => showWarning('Clone VM coming soon'), divider: true },
      { label: 'Force Stop', icon: <Power className="w-4 h-4" />, onClick: handleForceStop, disabled: !isRunning, variant: 'danger', divider: true },
      { label: 'Delete VM', icon: <Trash2 className="w-4 h-4" />, onClick: handleDelete, variant: 'danger' },
    ];
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = allVMs.findIndex(vm => vm.id === selectedVmId);
        if (currentIndex !== -1) {
          const newIndex = e.key === 'ArrowDown' 
            ? Math.min(currentIndex + 1, allVMs.length - 1)
            : Math.max(currentIndex - 1, 0);
          setSelectedVmId(allVMs[newIndex].id);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, allVMs, selectedVmId]);

  const cpuPercent = selectedVm?.status.resourceUsage.cpuUsagePercent || 0;
  const memoryPercent = selectedVm?.status.resourceUsage.memoryAllocatedBytes 
    ? Math.round((selectedVm.status.resourceUsage.memoryUsedBytes / selectedVm.status.resourceUsage.memoryAllocatedBytes) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
      {/* Main Container - 95% of screen with small gaps */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className={cn(
          'w-[95vw] h-[95vh] rounded-2xl overflow-hidden flex flex-col',
          'bg-gradient-to-br from-[#1e2230] via-[var(--bg-base)] to-[#1a1d28]',
          'border border-white/10',
          'shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_20px_50px_-10px_rgba(0,0,0,0.5),0_0_100px_-20px_rgba(59,130,246,0.15)]'
        )}
      >
        {/* Top Bar with glass effect */}
        <div className={cn(
          'h-14 flex items-center justify-between px-6 flex-shrink-0',
          'bg-gradient-to-r from-[var(--bg-surface)] via-[var(--bg-elevated)]/50 to-[var(--bg-surface)]',
          'border-b border-white/10',
          'backdrop-blur-md'
        )}>
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ x: -2 }}
              onClick={() => navigate('/vms')}
              className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group"
            >
              <ArrowLeft className="w-4 h-4 group-hover:text-[var(--accent-blue)] transition-colors" />
              Back to VM List
            </motion.button>
            <div className="h-5 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
            <h1 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2">
              <Server className="w-4 h-4 text-[var(--accent-blue)]" />
              VM Inventory
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
              'border backdrop-blur-sm',
              isConnected 
                ? 'bg-green-500/10 text-green-400 border-green-500/30' 
                : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30'
            )}>
              <span className={cn(
                'w-2 h-2 rounded-full animate-pulse',
                isConnected ? 'bg-green-400' : 'bg-yellow-400'
              )} />
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Connected' : 'Disconnected'}
            </div>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5">
              <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefetching} className="hover:bg-white/10">
                <RefreshCw className={cn('w-4 h-4', isRefetching && 'animate-spin')} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsFullscreen(!isFullscreen)} className="hover:bg-white/10">
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate('/vms')} className="hover:bg-red-500/20 hover:text-red-400">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar - Folder Tree & VM List */}
          <div className={cn(
            'w-80 flex flex-col flex-shrink-0',
            'bg-gradient-to-b from-[var(--bg-surface)] to-[var(--bg-base)]',
            'border-r border-white/10'
          )}>
            {/* Search with glow effect */}
            <div className="p-4 border-b border-white/5">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)] group-focus-within:text-[var(--accent-blue)] transition-colors" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search VMs..."
                  className={cn(
                    'w-full pl-10 pr-4 py-2.5 rounded-xl text-sm',
                    'bg-[var(--bg-base)]/80 border border-white/10',
                    'text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]/30 focus:border-[var(--accent-blue)]/50',
                    'shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]',
                    'transition-all duration-200'
                  )}
                />
              </div>
            </div>

            {/* Folder Tree */}
            <div className="flex-1 overflow-y-auto py-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--accent-blue)]" />
                </div>
              ) : searchQuery ? (
                // Search results
                <div className="space-y-0.5">
                  <div className="px-3 py-1.5 text-xs text-[var(--text-tertiary)]">
                    {filteredVMs.length} results
                  </div>
                  {filteredVMs.map((vm) => (
                    <VMSidebarItem
                      key={vm.id}
                      vm={vm}
                      isSelected={selectedVmId === vm.id}
                      onClick={() => handleSelectVM(vm.id)}
                      onHover={() => handleHoverVM(vm.id)}
                      onContextMenu={handleContextMenu}
                    />
                  ))}
                </div>
              ) : (
                // Folder tree
                folderTree.map((tree) => (
                  <FolderNode
                    key={tree.folder.id}
                    folder={tree.folder}
                    children={tree.children}
                    level={0}
                    expandedFolders={expandedFolders}
                    selectedVmId={selectedVmId}
                    vmsByFolder={vmsByFolder}
                    onToggleExpand={handleToggleExpand}
                    onSelectVM={handleSelectVM}
                    onHoverVM={handleHoverVM}
                    onContextMenu={handleContextMenu}
                    onFolderContextMenu={handleFolderContextMenu}
                  />
                ))
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 border-t border-white/5 bg-[var(--bg-surface)]/50">
              <motion.div whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'w-full justify-start',
                    'bg-gradient-to-r from-amber-500/10 to-transparent',
                    'border border-amber-500/20',
                    'hover:from-amber-500/20 hover:border-amber-500/30',
                    'rounded-xl py-2.5'
                  )}
                  onClick={() => setShowCreateFolderDialog(true)}
                >
                  <FolderPlus className="w-4 h-4 mr-2 text-amber-400" />
                  <span className="text-[var(--text-secondary)]">New Folder</span>
                </Button>
              </motion.div>
            </div>
          </div>

        {/* Right Panel - VM Details */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-br from-[var(--bg-base)] via-[#1c2030] to-[var(--bg-base)]">
          {selectedVm ? (
            <motion.div
              key={selectedVm.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              {/* VM Header with glass effect */}
              <div className={cn(
                'h-16 flex items-center justify-between px-6 flex-shrink-0',
                'bg-gradient-to-r from-[var(--bg-surface)] via-[var(--bg-elevated)]/30 to-[var(--bg-surface)]',
                'border-b border-white/10',
                'backdrop-blur-md'
              )}>
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'p-2.5 rounded-xl',
                    selectedVm.status.state === 'RUNNING' 
                      ? 'bg-green-500/15 ring-1 ring-green-500/30' 
                      : 'bg-white/5 ring-1 ring-white/10'
                  )}>
                    <Monitor className={cn(
                      'w-6 h-6',
                      selectedVm.status.state === 'RUNNING' 
                        ? 'text-green-400' 
                        : 'text-[var(--text-tertiary)]'
                    )} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-[var(--text-primary)]">{selectedVm.name}</h2>
                      <VMStatusBadge status={selectedVm.status.state} size="sm" />
                    </div>
                    <p className="text-sm text-[var(--text-tertiary)]">{selectedVm.description || 'No description'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {selectedVm.status.state === 'RUNNING' ? (
                    <div className="flex items-center gap-2 p-1 rounded-xl bg-white/5 border border-white/10">
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={() => handleStop()} 
                        disabled={isActionPending}
                        className="hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30"
                      >
                        {stopVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                        Stop
                      </Button>
                      <Button variant="secondary" size="sm" className="hover:bg-amber-500/20 hover:text-amber-400">
                        <RefreshCw className="w-4 h-4" />
                        Restart
                      </Button>
                    </div>
                  ) : (
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button 
                        variant="primary" 
                        size="sm" 
                        onClick={handleStart} 
                        disabled={isActionPending}
                        className="shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                      >
                        {startVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        Start
                      </Button>
                    </motion.div>
                  )}
                  <div className="flex items-center gap-2 p-1 rounded-xl bg-white/5 border border-white/10">
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      onClick={() => setIsConsoleModalOpen(true)}
                      disabled={selectedVm.status.state !== 'RUNNING'}
                    >
                      <MonitorPlay className="w-4 h-4" />
                      Console
                    </Button>
                    <Button 
                      variant="secondary" 
                      size="sm"
                      onClick={() => setIsCreateSnapshotOpen(true)}
                    >
                      <Camera className="w-4 h-4" />
                      Snapshot
                    </Button>
                    <DropdownMenu
                      trigger={
                        <Button variant="ghost" size="sm" className="hover:bg-white/10">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      }
                      items={getVMActions()}
                    />
                  </div>
                </div>
              </div>

              {/* VM Content with Tabs */}
              <div className="flex-1 overflow-hidden">
                <Tabs defaultValue="summary" className="h-full flex flex-col">
                  <div className="border-b border-white/5 bg-[var(--bg-surface)]/50 px-6 backdrop-blur-sm">
                    <TabsList className="h-12">
                      <TabsTrigger value="summary">Summary</TabsTrigger>
                      <TabsTrigger value="console">Console</TabsTrigger>
                      <TabsTrigger value="agent">Agent</TabsTrigger>
                      <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
                      <TabsTrigger value="configuration">Configuration</TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6">
                    {/* Summary Tab */}
                    <TabsContent value="summary" className="mt-0 space-y-6">
                      {/* Quick Stats */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="grid grid-cols-4 gap-4"
                      >
                        <HardwareCard
                          icon={<Cpu className="w-5 h-5" />}
                          label="CPU"
                          value={`${selectedVm.spec.cpu.cores} vCPUs`}
                          subvalue={`${cpuPercent}% used`}
                        />
                        <HardwareCard
                          icon={<MemoryStick className="w-5 h-5" />}
                          label="Memory"
                          value={formatBytes(selectedVm.spec.memory.sizeMib * 1024 * 1024)}
                          subvalue={`${memoryPercent}% used`}
                        />
                        <HardwareCard
                          icon={<HardDrive className="w-5 h-5" />}
                          label="Storage"
                          value={`${selectedVm.spec.disks.reduce((a, d) => a + d.sizeGib, 0)} GB`}
                          subvalue={`${selectedVm.spec.disks.length} disk(s)`}
                        />
                        <HardwareCard
                          icon={<Network className="w-5 h-5" />}
                          label="Network"
                          value={`${selectedVm.spec.nics.length} NIC(s)`}
                          subvalue={selectedVm.status.ipAddresses[0] || 'No IP'}
                        />
                      </motion.div>

                      {/* General Info */}
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className={cn(
                          'rounded-2xl p-6',
                          'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
                          'border border-white/5',
                          'shadow-[0_-1px_2px_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.2)]'
                        )}
                      >
                        <h3 className="text-base font-bold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-[var(--accent-blue)]/10">
                            <Info className="w-4 h-4 text-[var(--accent-blue)]" />
                          </div>
                          General Information
                        </h3>
                        <div className="grid grid-cols-2 gap-x-12 gap-y-0.5">
                          <InfoRow label="Name" value={selectedVm.name} />
                          <InfoRow label="Project" value={selectedVm.projectId} />
                          <InfoRow label="Host" value={selectedVm.status.nodeId || '—'} mono />
                          <InfoRow label="Guest OS" value={selectedVm.status.guestInfo.osName || 'Linux'} />
                          <InfoRow label="Hostname" value={selectedVm.status.guestInfo.hostname || selectedVm.name} />
                          <InfoRow label="Created" value={new Date(selectedVm.createdAt).toLocaleDateString()} />
                          <InfoRow label="IP Addresses" value={selectedVm.status.ipAddresses.join(', ') || '—'} mono />
                          <InfoRow label="Agent Version" value={selectedVm.status.guestInfo.agentVersion || '1.0.0'} />
                        </div>
                      </motion.div>
                    </TabsContent>

                    {/* Console Tab */}
                    <TabsContent value="console" className="mt-0">
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className={cn(
                          'rounded-2xl p-4 h-[calc(100vh-320px)]',
                          'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
                          'border border-white/5',
                          'shadow-[0_-1px_2px_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.2)]'
                        )}
                      >
                        {selectedVm.status.state === 'RUNNING' ? (
                          <NoVNCConsole vmId={selectedVm.id} vmName={selectedVm.name} isOpen={true} onClose={() => {}} />
                        ) : (
                          <div className="flex flex-col items-center justify-center h-full">
                            <div className="p-6 rounded-2xl bg-white/5 mb-6">
                              <Monitor className="w-16 h-16 text-[var(--text-tertiary)]" />
                            </div>
                            <p className="text-[var(--text-secondary)] text-lg mb-4">VM must be running to access console</p>
                            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                              <Button variant="primary" size="sm" onClick={handleStart}>
                                <Play className="w-4 h-4 mr-2" />
                                Start VM
                              </Button>
                            </motion.div>
                          </div>
                        )}
                      </motion.div>
                    </TabsContent>

                    {/* Agent Tab */}
                    <TabsContent value="agent" className="mt-0">
                      <QuantixAgentStatus vmId={selectedVm.id} vmState={selectedVm.status.state} />
                    </TabsContent>

                    {/* Snapshots Tab */}
                    <TabsContent value="snapshots" className="mt-0 space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Snapshots</h3>
                        <Button variant="primary" size="sm" onClick={() => setIsCreateSnapshotOpen(true)}>
                          <Plus className="w-4 h-4 mr-1" />
                          Create Snapshot
                        </Button>
                      </div>
                      
                      {isLoadingSnapshots ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                      ) : snapshots.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center">
                          <Camera className="w-12 h-12 text-[var(--text-tertiary)] mb-3" />
                          <p className="text-sm text-[var(--text-tertiary)]">No snapshots yet</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {snapshots.map((snap) => (
                            <div key={snap.id} className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] p-3 flex items-center justify-between">
                              <div>
                                <div className="font-medium text-[var(--text-primary)]">{snap.name}</div>
                                <div className="text-xs text-[var(--text-tertiary)]">{snap.createdAt ? new Date(snap.createdAt).toLocaleString() : 'Unknown'}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button variant="ghost" size="sm" onClick={() => revertToSnapshot.mutateAsync({ vmId: selectedVmId!, snapshotId: snap.id })}>
                                  Revert
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => deleteSnapshot.mutateAsync({ vmId: selectedVmId!, snapshotId: snap.id })}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    {/* Configuration Tab */}
                    <TabsContent value="configuration" className="mt-0 space-y-6">
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        className="grid grid-cols-2 gap-6"
                      >
                        <div className={cn(
                          'rounded-2xl p-6',
                          'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
                          'border border-white/5',
                          'shadow-[0_-1px_2px_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.2)]'
                        )}>
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                              <div className="p-1.5 rounded-lg bg-[var(--accent-blue)]/10">
                                <Cpu className="w-4 h-4 text-[var(--accent-blue)]" />
                              </div>
                              CPU & Memory
                            </h3>
                            <Button variant="ghost" size="sm" onClick={() => setIsResourcesModalOpen(true)} className="hover:bg-white/10">
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                          <InfoRow label="vCPUs" value={`${selectedVm.spec.cpu.cores}`} />
                          <InfoRow label="Memory" value={formatBytes(selectedVm.spec.memory.sizeMib * 1024 * 1024)} />
                        </div>
                        
                        <div className={cn(
                          'rounded-2xl p-6',
                          'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
                          'border border-white/5',
                          'shadow-[0_-1px_2px_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.2)]'
                        )}>
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                              <div className="p-1.5 rounded-lg bg-purple-500/10">
                                <HardDrive className="w-4 h-4 text-purple-400" />
                              </div>
                              Storage
                            </h3>
                          </div>
                          {selectedVm.spec.disks.map((disk, i) => (
                            <InfoRow key={i} label={`Disk ${i + 1}`} value={`${disk.sizeGib} GB`} />
                          ))}
                        </div>
                      </motion.div>
                      
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className={cn(
                          'rounded-2xl p-6',
                          'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
                          'border border-white/5',
                          'shadow-[0_-1px_2px_rgba(255,255,255,0.05),0_4px_16px_rgba(0,0,0,0.2)]'
                        )}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-amber-500/10">
                              <Settings className="w-4 h-4 text-amber-400" />
                            </div>
                            Labels
                          </h3>
                          <Button variant="ghost" size="sm" onClick={() => setIsSettingsModalOpen(true)} className="hover:bg-white/10">
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                        {Object.keys(selectedVm.labels || {}).length === 0 ? (
                          <p className="text-sm text-[var(--text-tertiary)]">No labels configured</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(selectedVm.labels || {}).map(([key, value]) => (
                              <Badge key={key} variant="default">{key}: {value}</Badge>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    </TabsContent>
                  </div>
                </Tabs>
              </div>
            </motion.div>
          ) : (
            // Empty state - no VM selected
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex-1 flex items-center justify-center"
            >
              {isLoadingSelectedVm ? (
                <div className="flex flex-col items-center">
                  <div className="p-4 rounded-2xl bg-[var(--accent-blue)]/10 mb-4">
                    <Loader2 className="w-10 h-10 animate-spin text-[var(--accent-blue)]" />
                  </div>
                  <p className="text-sm text-[var(--text-tertiary)]">Loading VM details...</p>
                </div>
              ) : (
                <div className="text-center">
                  <motion.div 
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      'p-8 rounded-3xl mb-6 mx-auto w-fit',
                      'bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]',
                      'border border-white/10',
                      'shadow-[0_0_40px_-10px_rgba(59,130,246,0.3)]'
                    )}
                  >
                    <Monitor className="w-20 h-20 text-[var(--text-tertiary)]" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">Select a Virtual Machine</h3>
                  <p className="text-sm text-[var(--text-tertiary)] max-w-xs mx-auto">
                    Choose a virtual machine from the sidebar to view details and manage it
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </div>
        {/* End of Right Panel */}
      </div>
      {/* End of Main Content */}
      </motion.div>

      {/* Modals */}
      {selectedVm && (
        <>
          <ConsoleAccessModal
            isOpen={isConsoleModalOpen}
            onClose={() => setIsConsoleModalOpen(false)}
            onOpenWebConsole={() => {
              // Open console in new window/tab
              window.open(`/console/${selectedVm.id}`, `console-${selectedVm.id}`, 'width=1024,height=768');
              setIsConsoleModalOpen(false);
            }}
            vmId={selectedVm.id}
            vmName={selectedVm.name}
          />
          <ExecuteScriptModal
            isOpen={isScriptModalOpen}
            onClose={() => setIsScriptModalOpen(false)}
            vmId={selectedVm.id}
            vmName={selectedVm.name}
          />
          <EditSettingsModal
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            vmId={selectedVm.id}
            vmName={selectedVm.name}
            vmDescription={selectedVm.description || ''}
            vmLabels={selectedVm.labels || {}}
            onSave={handleSaveSettings}
          />
          <EditResourcesModal
            isOpen={isResourcesModalOpen}
            onClose={() => setIsResourcesModalOpen(false)}
            vmId={selectedVm.id}
            vmName={selectedVm.name}
            vmState={selectedVm.status?.state || 'UNKNOWN'}
            currentCores={selectedVm.spec?.cpu?.cores || 1}
            currentMemoryMib={selectedVm.spec?.memory?.sizeMib || 1024}
            onSave={handleSaveResources}
          />
          <FileBrowser
            vmId={selectedVm.id}
            isOpen={isFileBrowserOpen}
            onClose={() => setIsFileBrowserOpen(false)}
          />
        </>
      )}

      {/* Create Snapshot Modal */}
      <AnimatePresence>
        {isCreateSnapshotOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setIsCreateSnapshotOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Create Snapshot</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Name</label>
                  <input
                    type="text"
                    value={snapshotName}
                    onChange={(e) => setSnapshotName(e.target.value)}
                    placeholder="Snapshot name"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Description</label>
                  <textarea
                    value={snapshotDescription}
                    onChange={(e) => setSnapshotDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
                  />
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={includeMemory} onChange={(e) => setIncludeMemory(e.target.checked)} className="rounded" />
                    <span className="text-sm text-[var(--text-secondary)]">Include memory</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={quiesceFs} onChange={(e) => setQuiesceFs(e.target.checked)} className="rounded" />
                    <span className="text-sm text-[var(--text-secondary)]">Quiesce filesystem</span>
                  </label>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setIsCreateSnapshotOpen(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleCreateSnapshot} disabled={createSnapshot.isPending || !snapshotName.trim()}>
                  {createSnapshot.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Create Folder Modal */}
      <AnimatePresence>
        {showCreateFolderDialog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowCreateFolderDialog(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Create Folder</h3>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">Folder Name</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Enter folder name"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                />
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setShowCreateFolderDialog(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleCreateFolder} disabled={createFolderMutation.isPending || !newFolderName.trim()}>
                  {createFolderMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu.isOpen && contextMenu.vm && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-[100] bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 min-w-[200px]"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 220),
              top: Math.min(contextMenu.y, window.innerHeight - 400),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] border-b border-[var(--border-default)] mb-1">
              {contextMenu.vm.name}
            </div>
            {getContextMenuItems().map((item, idx) => (
              <div key={idx}>
                {item.divider && idx > 0 && (
                  <div className="h-px bg-[var(--border-default)] my-1" />
                )}
                <button
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                    item.disabled
                      ? 'text-[var(--text-tertiary)] cursor-not-allowed'
                      : item.variant === 'danger'
                        ? 'text-red-400 hover:bg-red-500/10'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  )}
                  onClick={() => !item.disabled && item.onClick()}
                  disabled={item.disabled}
                >
                  <span className={cn(
                    'flex-shrink-0',
                    item.disabled ? 'opacity-50' : ''
                  )}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename VM Modal */}
      <AnimatePresence>
        {showRenameDialog && vmToRename && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowRenameDialog(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Rename VM</h3>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">New Name</label>
                <input
                  type="text"
                  value={newVmName}
                  onChange={(e) => setNewVmName(e.target.value)}
                  placeholder="Enter new VM name"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleRenameVM()}
                />
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setShowRenameDialog(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleRenameVM} disabled={updateVM.isPending || !newVmName.trim()}>
                  {updateVM.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Rename
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Move to Folder Modal */}
      <AnimatePresence>
        {showMoveToFolderDialog && vmToMove && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowMoveToFolderDialog(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Move "{vmToMove.name}" to Folder</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(foldersData?.folders || []).map((folder) => (
                  <button
                    key={folder.id}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                      targetFolderId === folder.id
                        ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] ring-1 ring-[var(--accent-blue)]/40'
                        : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                    )}
                    onClick={() => setTargetFolderId(folder.id)}
                  >
                    <Folder className="w-4 h-4 text-amber-400" />
                    <span className="text-sm">{folder.name}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setShowMoveToFolderDialog(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleMoveToFolder} disabled={updateVM.isPending || !targetFolderId}>
                  {updateVM.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Move
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Folder Context Menu */}
      <AnimatePresence>
        {folderContextMenu.isOpen && folderContextMenu.folder && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-[100] bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg shadow-xl py-1 min-w-[220px]"
            style={{
              left: Math.min(folderContextMenu.x, window.innerWidth - 240),
              top: Math.min(folderContextMenu.y, window.innerHeight - 350),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-tertiary)] border-b border-[var(--border-default)] mb-1 flex items-center gap-2">
              <Folder className="w-3 h-3 text-amber-400" />
              {folderContextMenu.folder.name}
            </div>
            {getFolderContextMenuItems().map((item, idx) => (
              <div key={idx}>
                {item.divider && idx > 0 && (
                  <div className="h-px bg-[var(--border-default)] my-1" />
                )}
                <button
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                    item.disabled
                      ? 'text-[var(--text-tertiary)] cursor-not-allowed'
                      : item.variant === 'danger'
                        ? 'text-red-400 hover:bg-red-500/10'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                  )}
                  onClick={() => !item.disabled && item.onClick()}
                  disabled={item.disabled}
                >
                  <span className={cn(
                    'flex-shrink-0',
                    item.disabled ? 'opacity-50' : ''
                  )}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rename Folder Modal */}
      <AnimatePresence>
        {showRenameFolderDialog && folderToRename && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowRenameFolderDialog(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Rename Folder</h3>
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">New Name</label>
                <input
                  type="text"
                  value={newFolderNameForRename}
                  onChange={(e) => setNewFolderNameForRename(e.target.value)}
                  placeholder="Enter new folder name"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-blue)]"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleRenameFolder()}
                />
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setShowRenameFolderDialog(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleRenameFolder} disabled={!newFolderNameForRename.trim()}>
                  Rename
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Move Folder Modal */}
      <AnimatePresence>
        {showMoveFolderDialog && folderToMove && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-50"
              onClick={() => setShowMoveFolderDialog(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-xl p-6 w-full max-w-md shadow-xl"
            >
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Move "{folderToMove.name}" Under</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {/* Option for root level (no parent) */}
                <button
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                    targetParentFolderId === ''
                      ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] ring-1 ring-[var(--accent-blue)]/40'
                      : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                  )}
                  onClick={() => setTargetParentFolderId('')}
                >
                  <Home className="w-4 h-4 text-[var(--text-tertiary)]" />
                  <span className="text-sm">Root Level (No Parent)</span>
                </button>
                {(foldersData?.folders || [])
                  .filter((f) => f.id !== folderToMove.id) // Can't move folder under itself
                  .map((folder) => (
                    <button
                      key={folder.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                        targetParentFolderId === folder.id
                          ? 'bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] ring-1 ring-[var(--accent-blue)]/40'
                          : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
                      )}
                      onClick={() => setTargetParentFolderId(folder.id)}
                    >
                      <Folder className="w-4 h-4 text-amber-400" />
                      <span className="text-sm">{folder.name}</span>
                    </button>
                  ))}
              </div>
              <div className="flex items-center justify-end gap-3 mt-6">
                <Button variant="ghost" size="sm" onClick={() => setShowMoveFolderDialog(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={handleMoveFolderToParent}>
                  Move
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete VM Modal */}
      <DeleteVMModal
        isOpen={deleteModalState.isOpen}
        onClose={() => setDeleteModalState({ isOpen: false, vm: null })}
        vmId={deleteModalState.vm?.id || ''}
        vmName={deleteModalState.vm?.name || ''}
        vmState={deleteModalState.vm?.status.state || 'STOPPED'}
        onDelete={handleDeleteConfirm}
        isPending={deleteVM.isPending}
      />
    </div>
  );
}
