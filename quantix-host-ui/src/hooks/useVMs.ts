import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listVMs,
  getVM,
  createVM,
  deleteVM,
  startVM,
  stopVM,
  forceStopVM,
  rebootVM,
  pauseVM,
  resumeVM,
  getConsole,
  listSnapshots,
  createSnapshot,
  revertSnapshot,
  deleteSnapshot,
} from '@/api/vm';
import type { CreateVmRequest } from '@/api/types';
import { toast } from '@/lib/toast';

/**
 * Hook to list all VMs on this host
 */
export function useVMs() {
  return useQuery({
    queryKey: ['vms'],
    queryFn: listVMs,
    staleTime: 5_000, // 5 seconds
    refetchInterval: 10_000, // Auto-refresh every 10 seconds
  });
}

/**
 * Hook to get a single VM
 */
export function useVM(vmId: string) {
  return useQuery({
    queryKey: ['vms', vmId],
    queryFn: () => getVM(vmId),
    staleTime: 5_000,
    refetchInterval: 5_000,
    enabled: !!vmId,
  });
}

/**
 * Hook to get VM console info
 */
export function useVMConsole(vmId: string) {
  return useQuery({
    queryKey: ['vms', vmId, 'console'],
    queryFn: () => getConsole(vmId),
    staleTime: 30_000,
    enabled: !!vmId,
  });
}

/**
 * Hook to list VM snapshots
 */
export function useVMSnapshots(vmId: string) {
  return useQuery({
    queryKey: ['vms', vmId, 'snapshots'],
    queryFn: () => listSnapshots(vmId),
    enabled: !!vmId,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Hook to create a new VM
 */
export function useCreateVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreateVmRequest) => createVM(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      toast.success('VM created successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create VM: ${error.message}`);
    },
  });
}

/**
 * Hook to delete a VM
 */
export function useDeleteVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vmId: string) => deleteVM(vmId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      toast.success('VM deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete VM: ${error.message}`);
    },
  });
}

/**
 * Hook for VM power operations
 */
export function useVMPowerOps() {
  const queryClient = useQueryClient();

  const invalidateVM = (vmId: string) => {
    queryClient.invalidateQueries({ queryKey: ['vms'] });
    queryClient.invalidateQueries({ queryKey: ['vms', vmId] });
  };

  const start = useMutation({
    mutationFn: startVM,
    onSuccess: (_, vmId) => {
      invalidateVM(vmId);
      toast.success('VM starting...');
    },
    onError: (error: Error) => {
      toast.error(`Failed to start VM: ${error.message}`);
    },
  });

  const stop = useMutation({
    mutationFn: (vmId: string) => stopVM(vmId),
    onSuccess: (_, vmId) => {
      invalidateVM(vmId);
      toast.success('VM stopping...');
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop VM: ${error.message}`);
    },
  });

  const forceStop = useMutation({
    mutationFn: forceStopVM,
    onSuccess: (_, vmId) => {
      invalidateVM(vmId);
      toast.success('VM force stopped');
    },
    onError: (error: Error) => {
      toast.error(`Failed to force stop VM: ${error.message}`);
    },
  });

  const reboot = useMutation({
    mutationFn: rebootVM,
    onSuccess: (_, vmId) => {
      invalidateVM(vmId);
      toast.success('VM rebooting...');
    },
    onError: (error: Error) => {
      toast.error(`Failed to reboot VM: ${error.message}`);
    },
  });

  const pause = useMutation({
    mutationFn: pauseVM,
    onSuccess: (_, vmId) => {
      invalidateVM(vmId);
      toast.success('VM paused');
    },
    onError: (error: Error) => {
      toast.error(`Failed to pause VM: ${error.message}`);
    },
  });

  const resume = useMutation({
    mutationFn: resumeVM,
    onSuccess: (_, vmId) => {
      invalidateVM(vmId);
      toast.success('VM resumed');
    },
    onError: (error: Error) => {
      toast.error(`Failed to resume VM: ${error.message}`);
    },
  });

  return { start, stop, forceStop, reboot, pause, resume };
}

/**
 * Snapshot creation options
 */
export interface CreateSnapshotOptions {
  name: string;
  description?: string;
  /** Include memory state (enables VMware-like live snapshots) */
  includeMemory?: boolean;
  /** Quiesce filesystems before snapshot (requires guest agent) */
  quiesce?: boolean;
}

/**
 * Hook for VM snapshot operations
 */
export function useVMSnapshotOps(vmId: string) {
  const queryClient = useQueryClient();

  const invalidateSnapshots = () => {
    queryClient.invalidateQueries({ queryKey: ['vms', vmId, 'snapshots'] });
  };

  const create = useMutation({
    mutationFn: ({ name, description, includeMemory, quiesce }: CreateSnapshotOptions) =>
      createSnapshot(vmId, name, description, includeMemory, quiesce),
    onSuccess: (_, variables) => {
      invalidateSnapshots();
      const memoryNote = variables.includeMemory ? ' (with memory state)' : '';
      toast.success(`Snapshot created${memoryNote}`);
    },
    onError: (error: Error) => {
      // Parse error for user-friendly messages
      const msg = error.message;
      if (msg.includes('quiesce') && msg.includes('agent')) {
        toast.error('Filesystem quiesce failed - guest agent may not be running');
      } else if (msg.includes('snapshot directory')) {
        toast.error('Snapshot storage error - check directory permissions');
      } else {
        toast.error(`Failed to create snapshot: ${msg}`);
      }
    },
  });

  const revert = useMutation({
    mutationFn: (snapshotId: string) => revertSnapshot(vmId, snapshotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms', vmId] });
      invalidateSnapshots();
      toast.success('Reverted to snapshot');
    },
    onError: (error: Error) => {
      const msg = error.message;
      if (msg.includes('external')) {
        toast.error('External snapshots may require VM to be stopped first');
      } else {
        toast.error(`Failed to revert snapshot: ${msg}`);
      }
    },
  });

  const remove = useMutation({
    mutationFn: (snapshotId: string) => deleteSnapshot(vmId, snapshotId),
    onSuccess: () => {
      invalidateSnapshots();
      toast.success('Snapshot deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete snapshot: ${error.message}`);
    },
  });

  return { create, revert, remove };
}
