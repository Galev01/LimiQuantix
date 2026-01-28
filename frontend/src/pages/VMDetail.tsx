import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Play,
  Square,
  RefreshCw,
  MonitorPlay,
  Camera,
  MoreHorizontal,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Clock,
  Server,
  Terminal,
  Activity,
  Wifi,
  WifiOff,
  Loader2,
  Trash2,
  Download,
  Code,
  FolderOpen,
  Settings,
  Copy,
  Power,
  Pause,
  RotateCcw,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  GitBranch,
  List,
  Disc,
  User,
} from 'lucide-react';
import { cn, formatBytes, formatUptime } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import { VMStatusBadge } from '@/components/vm/VMStatusBadge';
import { ProgressRing } from '@/components/dashboard/ProgressRing';
import { NoVNCConsole } from '@/components/vm/NoVNCConsole';
import { ConsoleAccessModal } from '@/components/vm/ConsoleAccessModal';
import { ExecuteScriptModal } from '@/components/vm/ExecuteScriptModal';
import { EditSettingsModal } from '@/components/vm/EditSettingsModal';
import { EditResourcesModal } from '@/components/vm/EditResourcesModal';
import { DeleteVMModal } from '@/components/vm/DeleteVMModal';
import { StartAndOpenConsoleModal } from '@/components/vm/StartAndOpenConsoleModal';
import { CloneVMWizard } from '@/components/vm/CloneVMWizard';
import { SnapshotTree, SnapshotList } from '@/components/vm/SnapshotTree';
import { AddDiskModal } from '@/components/vm/AddDiskModal';
import { ResizeDiskModal } from '@/components/vm/ResizeDiskModal';
import { AddNICModal } from '@/components/vm/AddNICModal';
import { QuantixAgentStatus } from '@/components/vm/QuantixAgentStatus';
import { FileBrowser } from '@/components/vm/FileBrowser';
import { VMMonitoringCharts } from '@/components/vm/VMMonitoringCharts';
import { EditBootOptionsModal } from '@/components/vm/EditBootOptionsModal';
import { EditDisplaySettingsModal } from '@/components/vm/EditDisplaySettingsModal';
import { EditHAPolicyModal } from '@/components/vm/EditHAPolicyModal';
import { EditGuestAgentModal } from '@/components/vm/EditGuestAgentModal';
import { EditProvisioningModal } from '@/components/vm/EditProvisioningModal';
import { EditAdvancedOptionsModal } from '@/components/vm/EditAdvancedOptionsModal';
import { CDROMModal, type CDROMDevice } from '@/components/vm/CDROMModal';
import { VMLogsPanel } from '@/components/vm/VMLogsPanel';
import { type VirtualMachine, type PowerState } from '@/types/models';
import { useVM, useStartVM, useStopVM, useRebootVM, usePauseVM, useResumeVM, useSuspendVM, useResetVMState, useDeleteVM, useUpdateVM, useAttachDisk, useDetachDisk, useResizeDisk, useAttachNIC, useDetachNIC, useVMEvents, useAttachCDROM, useDetachCDROM, useMountISO, useEjectISO, type ApiVM } from '@/hooks/useVMs';
import { useApiConnection } from '@/hooks/useDashboard';
import { useSnapshots, useCreateSnapshot, useRevertToSnapshot, useDeleteSnapshot, formatSnapshotSize, type ApiSnapshot } from '@/hooks/useSnapshots';
import { showInfo, showSuccess, showError } from '@/lib/toast';

// Convert API VM to display format
function apiToDisplayVM(apiVm: ApiVM): VirtualMachine {
  const state = (apiVm.status?.state || 'STOPPED') as PowerState;
  return {
    id: apiVm.id,
    name: apiVm.name,
    projectId: apiVm.projectId,
    description: apiVm.description || '',
    labels: apiVm.labels || {},
    spec: {
      cpu: { cores: apiVm.spec?.cpu?.cores || 1, sockets: 1, model: 'host' },
      memory: { sizeMib: apiVm.spec?.memory?.sizeMib || 1024 },
      disks: (apiVm.spec?.disks || []).map((d, i) => ({
        id: `disk-${i}`,
        sizeGib: d.sizeGib || 0,
        bus: 'virtio',
      })),
      nics: [{ id: 'nic-0', networkId: 'default', macAddress: '00:00:00:00:00:00' }],
    },
    status: {
      state,
      nodeId: apiVm.status?.nodeId || '',
      ipAddresses: apiVm.status?.ipAddresses || [],
      resourceUsage: {
        cpuUsagePercent: apiVm.status?.resourceUsage?.cpuUsagePercent || 0,
        memoryUsedBytes: (apiVm.status?.resourceUsage?.memoryUsedMib || 0) * 1024 * 1024,
        memoryAllocatedBytes: (apiVm.spec?.memory?.sizeMib || 1024) * 1024 * 1024,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Linux',
        hostname: apiVm.name,
        agentVersion: '1.0.0',
        uptimeSeconds: 0,
      },
    },
    createdAt: apiVm.createdAt || new Date().toISOString(),
  };
}

export function VMDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  // Console state
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isConsoleModalOpen, setIsConsoleModalOpen] = useState(false);
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isResourcesModalOpen, setIsResourcesModalOpen] = useState(false);
  
  // Snapshot state
  const [isCreateSnapshotOpen, setIsCreateSnapshotOpen] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotDescription, setSnapshotDescription] = useState('');
  const [includeMemory, setIncludeMemory] = useState(false);
  const [quiesceFs, setQuiesceFs] = useState(false);
  
  // Delete VM modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  
  // Start and Open Console modal state
  const [isStartAndConsoleModalOpen, setIsStartAndConsoleModalOpen] = useState(false);
  
  // Clone VM wizard state
  const [isCloneWizardOpen, setIsCloneWizardOpen] = useState(false);
  
  // Snapshot view mode: 'tree' or 'list'
  const [snapshotViewMode, setSnapshotViewMode] = useState<'tree' | 'list'>('tree');
  
  // Disk modal state
  const [isAddDiskModalOpen, setIsAddDiskModalOpen] = useState(false);
  const [resizeDiskInfo, setResizeDiskInfo] = useState<{ diskId: string; diskName: string; currentSizeGib: number } | null>(null);
  
  // NIC modal state
  const [isAddNICModalOpen, setIsAddNICModalOpen] = useState(false);
  
  // Configuration edit modals
  const [isBootOptionsModalOpen, setIsBootOptionsModalOpen] = useState(false);
  const [isDisplaySettingsModalOpen, setIsDisplaySettingsModalOpen] = useState(false);
  const [isHAPolicyModalOpen, setIsHAPolicyModalOpen] = useState(false);
  const [isGuestAgentModalOpen, setIsGuestAgentModalOpen] = useState(false);
  const [isProvisioningModalOpen, setIsProvisioningModalOpen] = useState(false);
  const [isAdvancedOptionsModalOpen, setIsAdvancedOptionsModalOpen] = useState(false);
  const [isCDROMModalOpen, setIsCDROMModalOpen] = useState(false);

  // API connection and data
  const { data: isConnected = false } = useApiConnection();
  const { data: apiVm, isLoading } = useVM(id || '', !!isConnected && !!id);

  // Mutations
  const startVM = useStartVM();
  const stopVM = useStopVM();
  const rebootVM = useRebootVM();
  const pauseVM = usePauseVM();
  const resumeVM = useResumeVM();
  const suspendVM = useSuspendVM();
  const resetVMState = useResetVMState();
  const deleteVM = useDeleteVM();
  const updateVM = useUpdateVM();
  
  // Snapshot hooks
  const { data: snapshots = [], isLoading: isLoadingSnapshots } = useSnapshots(id || '', !!isConnected && !!id);
  const createSnapshot = useCreateSnapshot();
  const revertToSnapshot = useRevertToSnapshot();
  const deleteSnapshot = useDeleteSnapshot();
  
  // Disk hooks
  const attachDisk = useAttachDisk();
  const detachDisk = useDetachDisk();
  const resizeDisk = useResizeDisk();
  
  // NIC hooks
  const attachNIC = useAttachNIC();
  const detachNIC = useDetachNIC();
  
  // CD-ROM hooks
  const attachCDROM = useAttachCDROM();
  const detachCDROM = useDetachCDROM();
  const mountISO = useMountISO();
  const ejectISO = useEjectISO();
  
  // Events
  const { data: eventsData, refetch: refetchEvents, isLoading: isEventsLoading } = useVMEvents(id || '', { enabled: !!isConnected && !!id, limit: 50 });

  // Convert API data to display format (no mock fallback)
  const vm: VirtualMachine | undefined = apiVm ? apiToDisplayVM(apiVm) : undefined;

  const isActionPending = startVM.isPending || stopVM.isPending || rebootVM.isPending || pauseVM.isPending || resumeVM.isPending || suspendVM.isPending || resetVMState.isPending || deleteVM.isPending || updateVM.isPending;
  const isSnapshotActionPending = createSnapshot.isPending || revertToSnapshot.isPending || deleteSnapshot.isPending;
  const isDiskActionPending = attachDisk.isPending || detachDisk.isPending || resizeDisk.isPending;
  const isNICActionPending = attachNIC.isPending || detachNIC.isPending;
  const isCDROMActionPending = attachCDROM.isPending || detachCDROM.isPending || mountISO.isPending || ejectISO.isPending;

  // Action handlers
  const handleStart = async () => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await startVM.mutateAsync(id);
  };

  const handleStop = async (force = false) => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await stopVM.mutateAsync({ id, force });
  };

  const handleForceStop = async () => {
    if (!confirm('Are you sure you want to force stop this VM? This is equivalent to pulling the power plug and may cause data loss.')) {
      return;
    }
    await handleStop(true);
  };

  const handleReboot = async (force = false) => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await rebootVM.mutateAsync({ id, force });
  };

  const handlePause = async () => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await pauseVM.mutateAsync(id);
  };

  const handleResume = async () => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await resumeVM.mutateAsync(id);
  };

  const handleSuspend = async () => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await suspendVM.mutateAsync(id);
  };

  const handleResetState = async (force = false) => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    if (!confirm(
      force 
        ? 'This will force the VM state to STOPPED. Use this when the hypervisor is unreachable. Continue?'
        : 'This will query the hypervisor for the actual VM state and update the control plane. Continue?'
    )) {
      return;
    }
    await resetVMState.mutateAsync({ id, force });
  };

  const handleDeleteClick = () => {
    setIsDeleteModalOpen(true);
  };

  const handleDeleteConfirm = async (options: {
    deleteVolumes: boolean;
    removeFromInventoryOnly: boolean;
    force: boolean;
  }) => {
    if (!isConnected || !id) {
      showInfo('Not connected to backend');
      return;
    }
    await deleteVM.mutateAsync({ 
      id, 
      force: options.force,
      deleteVolumes: options.deleteVolumes,
      removeFromInventoryOnly: options.removeFromInventoryOnly,
    });
    navigate('/vms');
  };

  const handleSaveSettings = async (settings: { name: string; description: string; labels: Record<string, string> }) => {
    if (!id || !isConnected) {
      showInfo('Not connected to backend');
      return;
    }
    await updateVM.mutateAsync({
      id,
      name: settings.name,
      description: settings.description,
      labels: settings.labels,
    });
  };

  const handleSaveResources = async (resources: { cores: number; memoryMib: number }) => {
    if (!id || !isConnected) {
      showInfo('Not connected to backend');
      return;
    }
    await updateVM.mutateAsync({
      id,
      spec: {
        cpu: { cores: resources.cores },
        memory: { sizeMib: resources.memoryMib },
      },
    });
  };

  const handleCloneVM = () => {
    setIsCloneWizardOpen(true);
  };

  // Graceful reboot via agent
  const handleGracefulReboot = async () => {
    if (!id) return;
    try {
      const response = await fetch(`/api/vms/${id}/agent/reboot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to send reboot signal');
      }
      const data = await response.json();
      if (data.success) {
        showInfo('Graceful reboot signal sent to guest');
      } else {
        throw new Error(data.error || 'Reboot failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reboot';
      showInfo(`Error: ${message}`);
    }
  };

  // Graceful shutdown via agent
  const handleGracefulShutdown = async () => {
    if (!id) return;
    try {
      const response = await fetch(`/api/vms/${id}/agent/shutdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to send shutdown signal');
      }
      const data = await response.json();
      if (data.success) {
        showInfo('Graceful shutdown signal sent to guest');
      } else {
        throw new Error(data.error || 'Shutdown failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to shutdown';
      showInfo(`Error: ${message}`);
    }
  };

  // Smart console button - opens StartAndOpenConsoleModal for stopped VMs
  const handleConsoleClick = () => {
    if (vm?.status.state === 'RUNNING') {
      // VM is running, open console directly
      setIsConsoleModalOpen(true);
    } else {
      // VM is stopped, show Start & Open Console modal
      setIsStartAndConsoleModalOpen(true);
    }
  };

  // Snapshot handlers
  const handleCreateSnapshot = async () => {
    if (!id || !snapshotName.trim()) return;
    
    await createSnapshot.mutateAsync({
      vmId: id,
      name: snapshotName.trim(),
      description: snapshotDescription.trim() || undefined,
      includeMemory,
      quiesce: quiesceFs,
    });
    // Reset form on success (error is handled by the hook's onError)
    setSnapshotName('');
    setSnapshotDescription('');
    setIncludeMemory(false);
    setQuiesceFs(false);
    setIsCreateSnapshotOpen(false);
  };

  const handleRevertToSnapshot = async (snapshotId: string) => {
    if (!id) return;
    if (!confirm('Are you sure you want to revert to this snapshot? Any unsaved changes will be lost.')) return;
    
    await revertToSnapshot.mutateAsync({
      vmId: id,
      snapshotId,
      startAfterRevert: false,
    });
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    if (!id) return;
    if (!confirm('Are you sure you want to delete this snapshot? This action cannot be undone.')) return;
    
    await deleteSnapshot.mutateAsync({ vmId: id, snapshotId });
  };

  // Disk handlers
  const handleAddDisk = async (disk: { sizeGib: number; bus: string; format: string }) => {
    if (!id) return;
    await attachDisk.mutateAsync({
      vmId: id,
      disk: { sizeGib: disk.sizeGib, bus: disk.bus, format: disk.format },
    });
  };

  const handleResizeDisk = async (newSizeGib: number) => {
    if (!id || !resizeDiskInfo) return;
    await resizeDisk.mutateAsync({
      vmId: id,
      diskId: resizeDiskInfo.diskName,
      newSizeGib,
    });
    setResizeDiskInfo(null);
  };

  const handleDetachDisk = async (diskId: string) => {
    if (!id) return;
    if (!confirm('Are you sure you want to detach this disk? The data will not be deleted.')) return;
    const isRunning = vm?.status.state === 'RUNNING';
    await detachDisk.mutateAsync({
      vmId: id,
      diskId,
      force: isRunning,
    });
  };

  // NIC handlers
  const handleAddNIC = async (nic: { networkId: string; macAddress?: string; model: string }) => {
    if (!id) return;
    await attachNIC.mutateAsync({
      vmId: id,
      nic: { networkId: nic.networkId, macAddress: nic.macAddress, model: nic.model },
    });
  };

  const handleRemoveNIC = async (nicId: string) => {
    if (!id) return;
    if (!confirm('Are you sure you want to remove this network interface?')) return;
    await detachNIC.mutateAsync({ vmId: id, nicId });
  };

  // Configuration edit handlers
  const handleSaveBootOptions = async (options: { bootOrder: string[]; firmware: string; secureBoot: boolean }) => {
    if (!id || !apiVm) return;
    await updateVM.mutateAsync({
      id,
      spec: {
        ...apiVm.spec,
        boot: {
          order: options.bootOrder,
          firmware: options.firmware,
          secureBoot: options.secureBoot,
        },
      },
    });
  };

  const handleSaveDisplaySettings = async (settings: { type: string; port: number | 'auto'; password: string; listen: string; enableClipboard: boolean; enableAudio: boolean }) => {
    if (!id || !apiVm) return;
    await updateVM.mutateAsync({
      id,
      spec: {
        ...apiVm.spec,
        display: {
          type: settings.type,
          port: settings.port === 'auto' ? undefined : settings.port,
          password: settings.password || undefined,
          listen: settings.listen,
          clipboard: settings.enableClipboard,
          audio: settings.enableAudio,
        },
      },
    });
  };

  const handleSaveHAPolicy = async (policy: { enabled: boolean; restartPriority: string; isolationResponse: string; vmMonitoring: string; maxRestarts: number; restartPeriodMinutes: number }) => {
    if (!id || !apiVm) return;
    
    // Convert priority string to number (higher = restart first)
    const priorityMap: Record<string, number> = {
      'highest': 100,
      'high': 75,
      'medium': 50,
      'low': 25,
      'lowest': 0,
    };
    
    await updateVM.mutateAsync({
      id,
      spec: {
        ...apiVm.spec,
        // Use haPolicy for proto compatibility
        haPolicy: {
          autoRestart: policy.enabled,
          priority: priorityMap[policy.restartPriority] ?? 50,
          maxRestarts: policy.maxRestarts,
          restartDelaySec: policy.restartPeriodMinutes * 60, // Convert minutes to seconds
        },
        // Also keep ha for display compatibility
        ha: {
          enabled: policy.enabled,
          restartPriority: policy.restartPriority,
          isolationResponse: policy.isolationResponse,
          vmMonitoring: policy.vmMonitoring,
          maxRestarts: policy.maxRestarts,
          restartPeriodMinutes: policy.restartPeriodMinutes,
        },
      },
    });
  };

  const handleSaveGuestAgent = async (settings: { freezeOnSnapshot: boolean; timeSync: boolean }) => {
    if (!id || !apiVm) return;
    await updateVM.mutateAsync({
      id,
      spec: {
        ...apiVm.spec,
        guestAgent: {
          ...apiVm.spec?.guestAgent,
          freezeOnSnapshot: settings.freezeOnSnapshot,
          timeSync: settings.timeSync,
        },
      },
    });
  };

  const handleSaveProvisioning = async (settings: { enabled: boolean; hostname: string; sshKeys: string[]; userData: string; networkConfig: string }) => {
    if (!id || !apiVm) return;
    await updateVM.mutateAsync({
      id,
      spec: {
        ...apiVm.spec,
        cloudInit: settings.enabled ? {
          hostname: settings.hostname,
          sshKeys: settings.sshKeys,
          userData: settings.userData,
          networkConfig: settings.networkConfig,
        } : undefined,
      },
    });
  };

  const handleSaveAdvancedOptions = async (options: { hardwareVersion: string; machineType: string; rtcBase: string; watchdog: string; rngEnabled: boolean }) => {
    if (!id || !apiVm) return;
    await updateVM.mutateAsync({
      id,
      spec: {
        ...apiVm.spec,
        advanced: {
          hardwareVersion: options.hardwareVersion,
          machineType: options.machineType,
          rtcBase: options.rtcBase,
          watchdog: options.watchdog,
          rngEnabled: options.rngEnabled,
        },
      },
    });
  };

  // CD-ROM handlers
  const handleAttachCDROM = async () => {
    if (!id) return;
    await attachCDROM.mutateAsync({ vmId: id });
  };

  const handleDetachCDROM = async (cdromId: string) => {
    if (!id) return;
    await detachCDROM.mutateAsync({ vmId: id, cdromId });
  };

  const handleMountISO = async (cdromId: string, isoPath: string) => {
    if (!id) return;
    await mountISO.mutateAsync({ vmId: id, cdromId, isoPath });
  };

  const handleEjectISO = async (cdromId: string) => {
    if (!id) return;
    await ejectISO.mutateAsync({ vmId: id, cdromId });
  };

  // Get CD-ROM devices from VM spec
  const getCDROMDevices = (): CDROMDevice[] => {
    if (!apiVm?.spec?.cdroms) return [];
    return apiVm.spec.cdroms.map((cdrom: any, index: number) => ({
      id: cdrom.id || `cdrom-${index}`,
      name: cdrom.name || `CD-ROM ${index + 1}`,
      mountedIso: cdrom.isoPath,
      isoName: cdrom.isoPath?.split('/').pop(),
    }));
  };

  // Generate dropdown menu items
  const getVMActions = (): DropdownMenuItem[] => {
    const isRunning = vm?.status.state === 'RUNNING';
    const isPaused = vm?.status.state === 'PAUSED';
    
    return [
      {
        label: 'Edit Settings',
        icon: <Settings className="w-4 h-4" />,
        onClick: () => setIsSettingsModalOpen(true),
      },
      {
        label: 'Edit Resources',
        icon: <Cpu className="w-4 h-4" />,
        onClick: () => setIsResourcesModalOpen(true),
      },
      {
        label: 'Run Script',
        icon: <Code className="w-4 h-4" />,
        onClick: () => setIsScriptModalOpen(true),
        disabled: !isRunning,
      },
      {
        label: 'Browse Files',
        icon: <FolderOpen className="w-4 h-4" />,
        onClick: () => setIsFileBrowserOpen(true),
        disabled: !isRunning,
      },
      {
        label: 'Clone VM',
        icon: <Copy className="w-4 h-4" />,
        onClick: handleCloneVM,
        divider: true,
      },
      // Power operations
      {
        label: isPaused ? 'Resume' : 'Pause',
        icon: <Pause className="w-4 h-4" />,
        onClick: isPaused ? handleResume : handlePause,
        disabled: !isRunning && !isPaused,
      },
      {
        label: 'Suspend to Disk',
        icon: <Download className="w-4 h-4" />,
        onClick: handleSuspend,
        disabled: !isRunning,
      },
      {
        label: 'Force Stop',
        icon: <Power className="w-4 h-4" />,
        onClick: handleForceStop,
        disabled: !isRunning && !isPaused,
        variant: 'danger',
      },
      {
        label: 'Reset State',
        icon: <RotateCcw className="w-4 h-4" />,
        onClick: () => handleResetState(false),
      },
      {
        label: 'Force Reset State',
        icon: <RotateCcw className="w-4 h-4" />,
        onClick: () => handleResetState(true),
        variant: 'danger',
        divider: true,
      },
      {
        label: 'Delete VM',
        icon: <Trash2 className="w-4 h-4" />,
        onClick: handleDeleteClick,
        variant: 'danger',
        divider: true,
      },
    ];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!vm) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <h2 className="text-xl font-semibold text-text-primary mb-2">VM Not Found</h2>
        <p className="text-text-muted mb-4">The virtual machine you're looking for doesn't exist.</p>
        <Button onClick={() => navigate('/vms')}>
          <ArrowLeft className="w-4 h-4" />
          Back to VMs
        </Button>
      </div>
    );
  }

  const cpuPercent = vm.status.resourceUsage.cpuUsagePercent;
  const memoryPercent = vm.status.resourceUsage.memoryAllocatedBytes > 0
    ? Math.round((vm.status.resourceUsage.memoryUsedBytes / vm.status.resourceUsage.memoryAllocatedBytes) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/vms')}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            Virtual Machines
          </button>
          <span className="text-text-muted">/</span>
          <span className="text-text-primary font-medium">{vm.name}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/vms')}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-text-muted" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-text-primary">{vm.name}</h1>
                <VMStatusBadge status={vm.status.state} />
              </div>
              <p className="text-text-muted mt-1">{vm.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Connection Status */}
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
                isConnected
                  ? 'bg-success/20 text-success border border-success/30'
                  : 'bg-warning/20 text-warning border border-warning/30',
              )}
            >
              {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isConnected ? 'Connected' : 'Mock Data'}
            </div>

            {vm.status.state === 'RUNNING' ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => handleStop()} disabled={isActionPending}>
                  {stopVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4" />}
                  Stop
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleReboot()} disabled={isActionPending}>
                  {rebootVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Restart
                </Button>
              </>
            ) : vm.status.state === 'PAUSED' ? (
              <Button variant="primary" size="sm" onClick={handleResume} disabled={isActionPending}>
                {resumeVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Resume
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={handleStart} disabled={isActionPending}>
                {startVM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Start
              </Button>
            )}
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={handleConsoleClick}
              title="Open VM console"
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
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              }
              items={getVMActions()}
            />
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="agent">Quantix Agent</TabsTrigger>
          <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
          <TabsTrigger value="disks">Disks</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
        </TabsList>

        {/* Summary Tab */}
        <TabsContent value="summary">
          <div className="grid grid-cols-3 gap-6">
            {/* Left Column - General Info */}
            <div className="col-span-2 space-y-6">
              {/* General Information Card */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">General Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Name" value={vm.name} />
                  <InfoRow label="Description" value={vm.description || '—'} />
                  <InfoRow label="Project" value={vm.projectId} />
                  <InfoRow label="Created" value={new Date(vm.createdAt).toLocaleDateString()} />
                  <InfoRow label="Host" value={vm.status.nodeId || '—'} />
                  <InfoRow label="Guest OS" value={vm.status.guestInfo.osName} />
                  <InfoRow label="Hostname" value={vm.status.guestInfo.hostname} />
                  <InfoRow label="Agent Version" value={vm.status.guestInfo.agentVersion} />
                  <InfoRow
                    label="Uptime"
                    value={
                      vm.status.guestInfo.uptimeSeconds > 0
                        ? formatUptime(vm.status.guestInfo.uptimeSeconds)
                        : '—'
                    }
                  />
                  <InfoRow
                    label="IP Addresses"
                    value={vm.status.ipAddresses.join(', ') || '—'}
                    mono
                  />
                </div>
              </div>

              {/* Hardware Summary */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Hardware Summary</h3>
                <div className="grid grid-cols-4 gap-4">
                  <HardwareCard
                    icon={<Cpu className="w-5 h-5" />}
                    label="CPU"
                    value={`${vm.spec.cpu.cores} vCPUs`}
                    subvalue={`${vm.spec.cpu.sockets} socket(s)`}
                  />
                  <HardwareCard
                    icon={<MemoryStick className="w-5 h-5" />}
                    label="Memory"
                    value={formatBytes(vm.spec.memory.sizeMib * 1024 * 1024)}
                    subvalue={`${memoryPercent}% used`}
                  />
                  <HardwareCard
                    icon={<HardDrive className="w-5 h-5" />}
                    label="Storage"
                    value={`${vm.spec.disks.reduce((a, d) => a + Number(d.sizeGib), 0)} GB`}
                    subvalue={`${vm.spec.disks.length} disk(s)`}
                  />
                  <HardwareCard
                    icon={<Network className="w-5 h-5" />}
                    label="Network"
                    value={`${vm.spec.nics.length} NIC(s)`}
                    subvalue={vm.status.ipAddresses[0] || '—'}
                  />
                </div>
              </div>

              {/* Labels */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Labels</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(vm.labels).map(([key, value]) => (
                    <Badge key={key} variant="default">
                      {key}: {value}
                    </Badge>
                  ))}
                  <button className="text-sm text-accent hover:text-accent-hover">
                    + Add Label
                  </button>
                </div>
              </div>
            </div>

            {/* Right Column - Resource Usage */}
            <div className="space-y-6">
              {/* CPU Usage */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">CPU Usage</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={cpuPercent}
                    size={120}
                    color={cpuPercent >= 80 ? 'red' : cpuPercent >= 60 ? 'yellow' : 'blue'}
                    label="usage"
                  />
                </div>
                <div className="mt-4 text-center">
                  <p className="text-sm text-text-muted">
                    {vm.spec.cpu.cores} vCPUs allocated
                  </p>
                </div>
              </div>

              {/* Memory Usage */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">Memory Usage</h3>
                <div className="flex items-center justify-center">
                  <ProgressRing
                    value={memoryPercent}
                    size={120}
                    color={memoryPercent >= 80 ? 'red' : memoryPercent >= 60 ? 'yellow' : 'green'}
                    label="usage"
                  />
                </div>
                <div className="mt-4 text-center text-sm text-text-muted">
                  <p>
                    {formatBytes(vm.status.resourceUsage.memoryUsedBytes)} /{' '}
                    {formatBytes(vm.status.resourceUsage.memoryAllocatedBytes)}
                  </p>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-medium text-text-muted mb-4">Quick Stats</h3>
                <div className="space-y-3">
                  <StatRow
                    icon={<User className="w-4 h-4" />}
                    label="Owner"
                    value={apiVm?.createdBy || '—'}
                  />
                  <StatRow
                    icon={<Server className="w-4 h-4" />}
                    label="Host"
                    value={vm.status.nodeId || 'Not assigned'}
                  />
                  <StatRow
                    icon={<Activity className="w-4 h-4" />}
                    label="Disk IOPS"
                    value={`${vm.status.resourceUsage.diskReadIops + vm.status.resourceUsage.diskWriteIops}`}
                  />
                  <StatRow
                    icon={<Network className="w-4 h-4" />}
                    label="Network RX"
                    value={formatBytes(vm.status.resourceUsage.networkRxBytes)}
                  />
                  <StatRow
                    icon={<Network className="w-4 h-4" />}
                    label="Network TX"
                    value={formatBytes(vm.status.resourceUsage.networkTxBytes)}
                  />
                  <StatRow
                    icon={<Clock className="w-4 h-4" />}
                    label="Uptime"
                    value={
                      vm.status.guestInfo.uptimeSeconds > 0
                        ? formatUptime(vm.status.guestInfo.uptimeSeconds)
                        : '—'
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Quantix Agent Tab */}
        <TabsContent value="agent">
          <div className="grid grid-cols-3 gap-6">
            <div className="col-span-2">
              <QuantixAgentStatus 
                vmId={id || ''} 
                vmState={vm.status.state}
                guestOsFamily={apiVm?.spec?.guestOs?.family}
                guestOsName={apiVm?.status?.guestInfo?.osName}
                nodeId={apiVm?.status?.nodeId}
                onMountAgentISO={async () => {
                  // Mount the Quantix Agent ISO via the node's dedicated endpoint
                  // This endpoint automatically finds the ISO in the correct location
                  if (!id || !apiVm?.status?.nodeId) return;
                  try {
                    const nodeId = apiVm.status.nodeId;
                    // Call the node's mount-agent-iso endpoint via the control plane proxy
                    const response = await fetch(`/api/nodes/${nodeId}/vms/${id}/cdrom/mount-agent-iso`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                    });
                    if (!response.ok) {
                      const error = await response.json();
                      throw new Error(error.message || 'Failed to mount ISO');
                    }
                    const result = await response.json();
                    if (result.success) {
                      showSuccess(result.message || 'Agent ISO mounted successfully');
                    } else {
                      throw new Error(result.error || 'Failed to mount ISO');
                    }
                  } catch (error) {
                    showError(error as Error, 'Failed to mount ISO');
                  }
                }}
                isMountingISO={mountISO.isPending}
              />
            </div>
            <div className="space-y-4">
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Quick Actions</h3>
                <div className="space-y-3">
                  <Button
                    className="w-full justify-start"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsScriptModalOpen(true)}
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <Code className="w-4 h-4" />
                    Run Script
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsFileBrowserOpen(true)}
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <FolderOpen className="w-4 h-4" />
                    Browse Files
                  </Button>
                  <Button
                    className="w-full justify-start"
                    variant="secondary"
                    size="sm"
                    onClick={handleGracefulReboot}
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <RefreshCw className="w-4 h-4" />
                    Graceful Reboot
                  </Button>
                  <Button
                    className="w-full justify-start text-warning hover:text-warning"
                    variant="secondary"
                    size="sm"
                    onClick={handleGracefulShutdown}
                    disabled={vm.status.state !== 'RUNNING'}
                  >
                    <Square className="w-4 h-4" />
                    Graceful Shutdown
                  </Button>
                </div>
              </div>
              <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
                <h3 className="text-sm font-semibold text-text-primary mb-3">About Quantix Agent</h3>
                <p className="text-xs text-text-muted leading-relaxed">
                  The Quantix Agent runs inside the VM and provides:
                </p>
                <ul className="text-xs text-text-muted mt-2 space-y-1">
                  <li>• Real resource usage metrics</li>
                  <li>• IP address reporting</li>
                  <li>• Remote script execution</li>
                  <li>• Graceful shutdown/reboot</li>
                  <li>• File transfer capabilities</li>
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Snapshots Tab */}
        <TabsContent value="snapshots">
          <div className="space-y-6">
            {/* Create Snapshot Form */}
            {isCreateSnapshotOpen && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary">Create Snapshot</h3>
                  <button
                    onClick={() => setIsCreateSnapshotOpen(false)}
                    className="p-1 rounded hover:bg-bg-hover transition-colors"
                  >
                    <X className="w-5 h-5 text-text-muted" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Snapshot Name <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={snapshotName}
                      onChange={(e) => setSnapshotName(e.target.value)}
                      placeholder="e.g., before-update"
                      className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={snapshotDescription}
                      onChange={(e) => setSnapshotDescription(e.target.value)}
                      placeholder="Optional description"
                      className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <div className="col-span-2 flex flex-wrap gap-6">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeMemory}
                        onChange={(e) => setIncludeMemory(e.target.checked)}
                        disabled={vm?.status.state !== 'RUNNING'}
                        className="w-4 h-4 rounded border-border text-accent focus:ring-accent/50 disabled:opacity-50"
                      />
                      <span className={cn("text-sm", vm?.status.state !== 'RUNNING' ? 'text-text-muted' : 'text-text-secondary')}>
                        Include memory state
                      </span>
                      <span className="text-xs text-text-muted">(hot snapshot)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={quiesceFs}
                        onChange={(e) => setQuiesceFs(e.target.checked)}
                        disabled={vm?.status.state !== 'RUNNING'}
                        className="w-4 h-4 rounded border-border text-accent focus:ring-accent/50 disabled:opacity-50"
                      />
                      <span className={cn("text-sm", vm?.status.state !== 'RUNNING' ? 'text-text-muted' : 'text-text-secondary')}>
                        Quiesce filesystem
                      </span>
                      <span className="text-xs text-text-muted">(requires agent)</span>
                    </label>
                  </div>
                  {/* Warning for memory snapshots */}
                  {includeMemory && vm?.status.state === 'RUNNING' && (
                    <div className="col-span-2 flex items-start gap-2 p-3 bg-warning/10 rounded-lg border border-warning/30">
                      <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-text-secondary">
                        <p className="font-medium text-warning mb-1">Memory snapshots may fail</p>
                        <p>
                          Some VMs with host-passthrough CPU or certain CPU features (like invtsc) cannot create memory snapshots.
                          If this fails, try stopping the VM first and taking a disk-only snapshot.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsCreateSnapshotOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCreateSnapshot}
                    disabled={!snapshotName.trim() || isSnapshotActionPending}
                  >
                    {createSnapshot.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Camera className="w-4 h-4" />
                    )}
                    Create Snapshot
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Snapshot List */}
            <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-text-primary">Snapshots</h3>
                  {snapshots.length > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-accent/20 text-accent rounded-full">
                      {snapshots.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* View Mode Toggle */}
                  {snapshots.length > 0 && (
                    <div className="flex items-center gap-1 p-1 bg-bg-base rounded-lg border border-border">
                      <button
                        onClick={() => setSnapshotViewMode('tree')}
                        className={cn(
                          'p-1.5 rounded transition-colors',
                          snapshotViewMode === 'tree'
                            ? 'bg-bg-elevated text-accent shadow-sm'
                            : 'text-text-muted hover:text-text-primary'
                        )}
                        title="Tree View"
                      >
                        <GitBranch className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setSnapshotViewMode('list')}
                        className={cn(
                          'p-1.5 rounded transition-colors',
                          snapshotViewMode === 'list'
                            ? 'bg-bg-elevated text-accent shadow-sm'
                            : 'text-text-muted hover:text-text-primary'
                        )}
                        title="List View"
                      >
                        <List className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {!isCreateSnapshotOpen && (
                    <Button size="sm" onClick={() => setIsCreateSnapshotOpen(true)}>
                      <Plus className="w-4 h-4" />
                      Create Snapshot
                    </Button>
                  )}
                </div>
              </div>

              {isLoadingSnapshots ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-accent" />
                </div>
              ) : snapshots.length === 0 ? (
                <div className="text-center py-12">
                  <Camera className="w-12 h-12 mx-auto text-text-muted mb-4" />
                  <h4 className="text-lg font-medium text-text-primary mb-2">No Snapshots</h4>
                  <p className="text-text-muted mb-4">
                    Create a snapshot to save the current state of this VM
                  </p>
                  {!isCreateSnapshotOpen && (
                    <Button size="sm" onClick={() => setIsCreateSnapshotOpen(true)}>
                      <Camera className="w-4 h-4" />
                      Create First Snapshot
                    </Button>
                  )}
                </div>
              ) : snapshotViewMode === 'tree' ? (
                <SnapshotTree
                  snapshots={snapshots}
                  onRevert={handleRevertToSnapshot}
                  onDelete={handleDeleteSnapshot}
                  isActionPending={isSnapshotActionPending}
                  vmState={vm?.status.state || 'STOPPED'}
                />
              ) : (
                <SnapshotList
                  snapshots={snapshots}
                  onRevert={handleRevertToSnapshot}
                  onDelete={handleDeleteSnapshot}
                  isActionPending={isSnapshotActionPending}
                  vmState={vm?.status.state || 'STOPPED'}
                />
              )}
            </div>

            {/* Snapshot Info */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <h3 className="text-sm font-semibold text-text-primary mb-3">About Snapshots</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-text-muted">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Snapshots capture the complete disk state at a point in time</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>Memory snapshots allow resuming from the exact running state</span>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  <span>Reverting will discard all changes since the snapshot</span>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                  <span>VM must be stopped to revert to a disk-only snapshot</span>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Disks Tab */}
        <TabsContent value="disks">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Disks</h3>
              <Button size="sm" onClick={() => setIsAddDiskModalOpen(true)}>
                <HardDrive className="w-4 h-4" />
                Add Disk
              </Button>
            </div>
            {vm.spec.disks.length === 0 ? (
              <div className="text-center py-12">
                <HardDrive className="w-12 h-12 mx-auto text-text-muted mb-4" />
                <h4 className="text-lg font-medium text-text-primary mb-2">No Disks</h4>
                <p className="text-text-muted mb-4">
                  This VM has no disks attached
                </p>
                <Button size="sm" onClick={() => setIsAddDiskModalOpen(true)}>
                  <HardDrive className="w-4 h-4" />
                  Add First Disk
                </Button>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-bg-elevated/50">
                  <tr className="text-xs font-medium text-text-muted uppercase">
                    <th className="px-6 py-3 text-left">Device</th>
                    <th className="px-6 py-3 text-left">Size</th>
                    <th className="px-6 py-3 text-left">Bus Type</th>
                    <th className="px-6 py-3 text-left">Pool</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vm.spec.disks.map((disk, index) => {
                    // Get the actual disk name from API, fallback to generated device name for display
                    const apiDisk = apiVm?.spec?.disks?.[index];
                    const actualDiskName = apiDisk?.name || disk.id;
                    const displayName = `vd${String.fromCharCode(97 + index)}`;
                    return (
                      <tr key={disk.id} className="hover:bg-bg-hover">
                        <td className="px-6 py-4 text-sm text-text-primary font-mono">
                          {displayName}
                          {actualDiskName && actualDiskName !== displayName && (
                            <span className="text-text-muted ml-2 text-xs">({actualDiskName})</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-text-secondary">{disk.sizeGib} GB</td>
                        <td className="px-6 py-4 text-sm text-text-secondary">{disk.bus}</td>
                        <td className="px-6 py-4 text-sm text-text-secondary">default</td>
                        <td className="px-6 py-4 text-right space-x-1">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setResizeDiskInfo({ 
                              diskId: disk.id, 
                              diskName: actualDiskName,  // Use actual name from API for backend
                              currentSizeGib: disk.sizeGib 
                            })}
                          >
                            Resize
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => handleDetachDisk(disk.id)}
                            disabled={index === 0} // Can't detach boot disk
                            title={index === 0 ? 'Cannot detach boot disk' : 'Detach disk'}
                          >
                            Detach
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* Network Tab */}
        <TabsContent value="network">
          <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">Network Interfaces</h3>
              <Button size="sm" onClick={() => setIsAddNICModalOpen(true)}>
                <Network className="w-4 h-4" />
                Add NIC
              </Button>
            </div>
            {vm.spec.nics.length === 0 ? (
              <div className="text-center py-12">
                <Network className="w-12 h-12 mx-auto text-text-muted mb-4" />
                <h4 className="text-lg font-medium text-text-primary mb-2">No Network Interfaces</h4>
                <p className="text-text-muted mb-4">
                  This VM has no network interfaces
                </p>
                <Button size="sm" onClick={() => setIsAddNICModalOpen(true)}>
                  <Network className="w-4 h-4" />
                  Add NIC
                </Button>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-bg-elevated/50">
                  <tr className="text-xs font-medium text-text-muted uppercase">
                    <th className="px-6 py-3 text-left">Device</th>
                    <th className="px-6 py-3 text-left">Network</th>
                    <th className="px-6 py-3 text-left">MAC Address</th>
                    <th className="px-6 py-3 text-left">IP Address</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {vm.spec.nics.map((nic, index) => (
                    <tr key={nic.id} className="hover:bg-bg-hover">
                      <td className="px-6 py-4 text-sm text-text-primary font-mono">eth{index}</td>
                      <td className="px-6 py-4 text-sm text-text-secondary">{nic.networkId}</td>
                      <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                        {nic.macAddress || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-text-secondary font-mono">
                        {vm.status.ipAddresses[index] || '—'}
                      </td>
                      <td className="px-6 py-4 text-right space-x-1">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleRemoveNIC(nic.id)}
                          disabled={index === 0} // Can't remove primary NIC
                          title={index === 0 ? 'Cannot remove primary NIC' : 'Remove NIC'}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* Configuration Tab */}
        <TabsContent value="configuration">
          <div className="grid grid-cols-2 gap-6">
            {/* Boot Options */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Power className="w-5 h-5 text-accent" />
                  Boot Options
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsBootOptionsModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="Boot Device" value={apiVm?.spec?.boot?.order?.[0] || 'disk'} />
                <ConfigRow label="Boot Order" value={apiVm?.spec?.boot?.order?.join(', ') || 'disk, cdrom, network'} />
                <ConfigRow label="Firmware" value={apiVm?.spec?.boot?.firmware || 'UEFI'} />
                <ConfigRow label="Secure Boot" value={apiVm?.spec?.boot?.secureBoot ? 'Enabled' : 'Disabled'} />
                <ConfigRow label="TPM" value="Not configured" />
              </div>
            </div>

            {/* CPU Configuration */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-accent" />
                  CPU Configuration
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsResourcesModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="vCPUs" value={`${vm.spec.cpu.cores}`} />
                <ConfigRow label="Sockets" value={`${vm.spec.cpu.sockets}`} />
                <ConfigRow label="Cores per Socket" value={`${Math.floor(vm.spec.cpu.cores / vm.spec.cpu.sockets)}`} />
                <ConfigRow label="CPU Model" value={vm.spec.cpu.model || 'host'} />
                <ConfigRow label="CPU Reservation" value="None" />
                <ConfigRow label="CPU Limit" value="Unlimited" />
              </div>
            </div>

            {/* Memory Configuration */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <MemoryStick className="w-5 h-5 text-accent" />
                  Memory Configuration
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsResourcesModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="Memory" value={`${vm.spec.memory.sizeMib} MiB`} />
                <ConfigRow label="Memory Ballooning" value="Enabled" />
                <ConfigRow label="Huge Pages" value="Disabled" />
                <ConfigRow label="Memory Reservation" value="None" />
                <ConfigRow label="Memory Limit" value="Unlimited" />
              </div>
            </div>

            {/* Display & Console */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-accent" />
                  Display & Console
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsDisplaySettingsModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="Display Type" value={apiVm?.spec?.display?.type?.toUpperCase() || 'VNC'} />
                <ConfigRow label="Port" value={apiVm?.spec?.display?.port ? String(apiVm.spec.display.port) : 'Auto'} />
                <ConfigRow label="Password" value={apiVm?.spec?.display?.password ? 'Enabled' : 'Disabled'} />
                <ConfigRow label="Listen Address" value={apiVm?.spec?.display?.listen || '0.0.0.0'} />
                <ConfigRow label="Clipboard Sharing" value={apiVm?.spec?.display?.clipboard !== false ? 'Enabled' : 'Disabled'} />
              </div>
            </div>

            {/* Guest Agent */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Activity className="w-5 h-5 text-accent" />
                  Guest Agent (QEMU Agent)
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsGuestAgentModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="Status" value={vm.status.guestInfo.agentVersion ? 'Connected' : 'Not Connected'} />
                <ConfigRow label="Agent Version" value={vm.status.guestInfo.agentVersion || '—'} />
                <ConfigRow label="Communication" value={apiVm?.spec?.guestAgent?.communication || 'virtio-serial'} />
                <ConfigRow label="Freeze on Snapshot" value={apiVm?.spec?.guestAgent?.freezeOnSnapshot !== false ? 'Enabled' : 'Disabled'} />
                <ConfigRow label="Time Sync" value={apiVm?.spec?.guestAgent?.timeSync !== false ? 'Enabled' : 'Disabled'} />
              </div>
            </div>

            {/* High Availability */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-accent" />
                  High Availability
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsHAPolicyModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="HA Enabled" value={apiVm?.spec?.ha?.enabled !== false ? 'Yes' : 'No'} />
                <ConfigRow label="Restart Priority" value={apiVm?.spec?.ha?.restartPriority || 'Medium'} />
                <ConfigRow label="Isolation Response" value={apiVm?.spec?.ha?.isolationResponse || 'Shutdown'} />
                <ConfigRow label="VM Monitoring" value={apiVm?.spec?.ha?.vmMonitoring || 'VM Monitoring'} />
                <ConfigRow label="Max Restarts" value={String(apiVm?.spec?.ha?.maxRestarts || 3)} />
              </div>
            </div>

            {/* Advanced Options */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Settings className="w-5 h-5 text-accent" />
                  Advanced Options
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsAdvancedOptionsModalOpen(true)}>Edit</Button>
              </div>
              <div className="space-y-3">
                <ConfigRow label="Hardware Version" value={apiVm?.spec?.advanced?.hardwareVersion || 'v6'} />
                <ConfigRow label="Machine Type" value={apiVm?.spec?.advanced?.machineType || 'q35'} />
                <ConfigRow label="RTC Base" value={apiVm?.spec?.advanced?.rtcBase || 'UTC'} />
                <ConfigRow label="Watchdog" value={apiVm?.spec?.advanced?.watchdog || 'i6300esb'} />
                <ConfigRow label="RNG Device" value={apiVm?.spec?.advanced?.rngEnabled !== false ? 'virtio-rng' : 'Disabled'} />
              </div>
            </div>

            {/* CD-ROM Devices */}
            <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                  <Disc className="w-5 h-5 text-accent" />
                  CD-ROM Devices
                </h3>
                <Button variant="secondary" size="sm" onClick={() => setIsCDROMModalOpen(true)}>Manage</Button>
              </div>
              <div className="space-y-3">
                {getCDROMDevices().length === 0 ? (
                  <p className="text-sm text-text-muted">No CD-ROM devices attached</p>
                ) : (
                  getCDROMDevices().map((cdrom) => (
                    <ConfigRow 
                      key={cdrom.id} 
                      label={cdrom.name} 
                      value={cdrom.mountedIso ? cdrom.isoName || 'ISO mounted' : 'Empty'} 
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Monitoring Tab */}
        <TabsContent value="monitoring">
          {apiVm && <VMMonitoringCharts vm={apiVm} />}
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <div className="bg-bg-surface rounded-xl border border-border p-6 shadow-floating">
            <VMLogsPanel
              vmId={id || ''}
              vmName={vm.name}
              nodeId={vm.status.nodeId}
            />
          </div>
        </TabsContent>

        {/* Events Tab */}
        <TabsContent value="events">
          <div className="space-y-6">
            <div className="bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <h3 className="text-lg font-semibold text-text-primary">Event Log</h3>
                  {eventsData?.events && eventsData.events.length > 0 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-accent/20 text-accent rounded-full">
                      {eventsData.events.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select className="px-3 py-1.5 text-sm bg-bg-base border border-border rounded-lg text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent/50">
                    <option value="all">All Events</option>
                    <option value="power">Power</option>
                    <option value="config">Configuration</option>
                    <option value="snapshot">Snapshots</option>
                    <option value="disk">Disk</option>
                    <option value="network">Network</option>
                    <option value="error">Errors</option>
                  </select>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => refetchEvents?.()}
                    disabled={isEventsLoading}
                    title="Refresh events"
                  >
                    <RefreshCw className={cn("w-4 h-4", isEventsLoading && "animate-spin")} />
                  </Button>
                </div>
              </div>
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
                {(eventsData?.events && eventsData.events.length > 0 ? eventsData.events : []).map((event) => (
                  <div key={event.id} className="px-6 py-4 hover:bg-bg-hover transition-colors">
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-text-muted w-32 flex-shrink-0">
                        {new Date(event.createdAt).toLocaleString([], { 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                      <Badge 
                        variant="default" 
                        size="sm"
                        className={cn(
                          event.type === 'power' && 'bg-accent/20 text-accent border-accent/30',
                          event.type === 'config' && 'bg-purple-500/20 text-purple-400 border-purple-500/30',
                          event.type === 'snapshot' && 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                          event.type === 'error' && 'bg-error/20 text-error border-error/30',
                          event.type === 'network' && 'bg-green-500/20 text-green-400 border-green-500/30',
                          event.type === 'disk' && 'bg-orange-500/20 text-orange-400 border-orange-500/30',
                        )}
                      >
                        {event.type}
                      </Badge>
                      {/* Source indicator (QvDC or QHCI) */}
                      <Badge 
                        variant="default" 
                        size="sm"
                        className={cn(
                          'text-[10px] px-1.5',
                          event.source === 'qhci' || event.source === 'host' 
                            ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' 
                            : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        )}
                      >
                        {event.source === 'qhci' || event.source === 'host' ? 'QHCI' : 'QvDC'}
                      </Badge>
                      <span className="text-sm text-text-primary flex-1">{event.message}</span>
                      <span className="text-xs text-text-muted">{event.user || 'system'}</span>
                    </div>
                    {/* Event details (if available) */}
                    {event.details && (
                      <div className="mt-2 ml-36 text-xs text-text-muted font-mono bg-bg-base rounded px-2 py-1">
                        {event.details}
                      </div>
                    )}
                  </div>
                ))}
                {(!eventsData?.events || eventsData.events.length === 0) && (
                  <div className="px-6 py-12 text-center">
                    <Activity className="w-12 h-12 mx-auto text-text-muted mb-4" />
                    <h4 className="text-lg font-medium text-text-primary mb-2">No Events Yet</h4>
                    <p className="text-text-muted max-w-md mx-auto">
                      Events will appear here as you perform actions on this VM, such as starting, stopping, 
                      creating snapshots, or modifying configuration.
                    </p>
                    <div className="mt-4 flex items-center justify-center gap-4 text-xs text-text-muted">
                      <div className="flex items-center gap-1">
                        <Badge variant="default" size="sm" className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px] px-1.5">QvDC</Badge>
                        <span>Control Plane</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant="default" size="sm" className="bg-orange-500/10 text-orange-400 border-orange-500/20 text-[10px] px-1.5">QHCI</Badge>
                        <span>Host</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* noVNC Console Modal */}
      <NoVNCConsole
        vmId={id || ''}
        vmName={vm.name}
        isOpen={isConsoleOpen}
        onClose={() => setIsConsoleOpen(false)}
      />

      {/* Console Access Modal (Web vs QvMC choice) */}
      <ConsoleAccessModal
        isOpen={isConsoleModalOpen}
        onClose={() => setIsConsoleModalOpen(false)}
        onOpenWebConsole={() => setIsConsoleOpen(true)}
        vmId={id || ''}
        vmName={vm.name}
      />

      {/* Execute Script Modal */}
      <ExecuteScriptModal
        isOpen={isScriptModalOpen}
        onClose={() => setIsScriptModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
      />

      {/* File Browser Modal */}
      <FileBrowser
        vmId={id || ''}
        isOpen={isFileBrowserOpen}
        onClose={() => setIsFileBrowserOpen(false)}
      />

      {/* Edit Settings Modal */}
      <EditSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        vmDescription={vm.description}
        vmLabels={vm.labels}
        onSave={handleSaveSettings}
      />

      {/* Edit Resources Modal */}
      <EditResourcesModal
        isOpen={isResourcesModalOpen}
        onClose={() => setIsResourcesModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        vmState={vm.status.state}
        currentCores={vm.spec.cpu.cores}
        currentMemoryMib={vm.spec.memory.sizeMib}
        onSave={handleSaveResources}
      />

      {/* Delete VM Modal */}
      <DeleteVMModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        vmState={vm.status.state}
        onDelete={handleDeleteConfirm}
        isPending={deleteVM.isPending}
      />

      {/* Start and Open Console Modal (for stopped VMs) */}
      <StartAndOpenConsoleModal
        isOpen={isStartAndConsoleModalOpen}
        onClose={() => setIsStartAndConsoleModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        onStartVM={handleStart}
        onOpenConsole={() => setIsConsoleOpen(true)}
        isStarting={startVM.isPending}
        vmState={vm.status.state}
      />

      {/* Clone VM Wizard */}
      <CloneVMWizard
        isOpen={isCloneWizardOpen}
        onClose={() => setIsCloneWizardOpen(false)}
        sourceVmId={id || ''}
        sourceVmName={vm.name}
        sourceVmProjectId={vm.projectId}
      />

      {/* Add Disk Modal */}
      <AddDiskModal
        isOpen={isAddDiskModalOpen}
        onClose={() => setIsAddDiskModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        onAddDisk={handleAddDisk}
      />

      {/* Resize Disk Modal */}
      {resizeDiskInfo && (
        <ResizeDiskModal
          isOpen={!!resizeDiskInfo}
          onClose={() => setResizeDiskInfo(null)}
          vmId={id || ''}
          vmName={vm.name}
          diskId={resizeDiskInfo.diskId}
          diskName={resizeDiskInfo.diskName}
          currentSizeGib={resizeDiskInfo.currentSizeGib}
          onResize={handleResizeDisk}
        />
      )}

      {/* Add NIC Modal */}
      <AddNICModal
        isOpen={isAddNICModalOpen}
        onClose={() => setIsAddNICModalOpen(false)}
        vmId={id || ''}
        vmName={vm.name}
        availableNetworks={[
          { id: 'default', name: 'Default Network', cidr: '192.168.0.0/24' },
          { id: 'management', name: 'Management', cidr: '10.0.0.0/24' },
        ]}
        onAddNIC={handleAddNIC}
      />

      {/* Configuration Edit Modals */}
      {apiVm && (
        <>
          <EditBootOptionsModal
            isOpen={isBootOptionsModalOpen}
            onClose={() => setIsBootOptionsModalOpen(false)}
            vm={apiVm}
            onSave={handleSaveBootOptions}
          />
          <EditDisplaySettingsModal
            isOpen={isDisplaySettingsModalOpen}
            onClose={() => setIsDisplaySettingsModalOpen(false)}
            vm={apiVm}
            onSave={handleSaveDisplaySettings}
          />
          <EditHAPolicyModal
            isOpen={isHAPolicyModalOpen}
            onClose={() => setIsHAPolicyModalOpen(false)}
            vm={apiVm}
            onSave={handleSaveHAPolicy}
          />
          <EditGuestAgentModal
            isOpen={isGuestAgentModalOpen}
            onClose={() => setIsGuestAgentModalOpen(false)}
            vm={apiVm}
            onSave={handleSaveGuestAgent}
          />
          <EditProvisioningModal
            isOpen={isProvisioningModalOpen}
            onClose={() => setIsProvisioningModalOpen(false)}
            vm={apiVm}
            onSave={handleSaveProvisioning}
          />
          <EditAdvancedOptionsModal
            isOpen={isAdvancedOptionsModalOpen}
            onClose={() => setIsAdvancedOptionsModalOpen(false)}
            vm={apiVm}
            vmState={vm?.status.state || 'STOPPED'}
            onSave={handleSaveAdvancedOptions}
          />
          <CDROMModal
            isOpen={isCDROMModalOpen}
            onClose={() => setIsCDROMModalOpen(false)}
            vmId={id || ''}
            vmName={vm?.name || ''}
            vmState={vm?.status.state || 'STOPPED'}
            currentCDROMs={getCDROMDevices()}
            onAttachCDROM={handleAttachCDROM}
            onDetachCDROM={handleDetachCDROM}
            onMountISO={handleMountISO}
            onEjectISO={handleEjectISO}
            isPending={isCDROMActionPending}
          />
        </>
      )}
    </div>
  );
}

// Helper Components
function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className={cn('text-sm text-text-primary', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function HardwareCard({
  icon,
  label,
  value,
  subvalue,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subvalue: string;
}) {
  return (
    <div className="bg-bg-base rounded-lg p-4 border border-border">
      <div className="flex items-center gap-2 text-text-muted mb-2">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-lg font-semibold text-text-primary">{value}</p>
      <p className="text-xs text-text-muted mt-1">{subvalue}</p>
    </div>
  );
}

function StatRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-sm text-text-primary font-mono">{value}</span>
    </div>
  );
}

