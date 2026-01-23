/**
 * React Query hooks for VM operations
 * 
 * These hooks connect the frontend to the limiquantix backend API.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vmApi, type ApiVM, type VMListRequest, type VMListResponse } from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

// Query keys for cache invalidation
export const vmKeys = {
  all: ['vms'] as const,
  lists: () => [...vmKeys.all, 'list'] as const,
  list: (filters: Partial<VMListRequest>) => [...vmKeys.lists(), filters] as const,
  details: () => [...vmKeys.all, 'detail'] as const,
  detail: (id: string) => [...vmKeys.details(), id] as const,
};

/**
 * Hook to list all VMs with optional filtering
 */
export function useVMs(options?: {
  projectId?: string;
  nodeId?: string;
  pageSize?: number;
  enabled?: boolean;
}) {
  const queryParams: VMListRequest = {
    projectId: options?.projectId,
    nodeId: options?.nodeId,
    pageSize: options?.pageSize || 100,
  };

  return useQuery({
    queryKey: vmKeys.list(queryParams),
    queryFn: async () => {
      const response = await vmApi.list(queryParams);
      return response;
    },
    enabled: options?.enabled ?? true,
    staleTime: 30000, // Consider fresh for 30 seconds
    retry: 2,
  });
}

/**
 * Hook to get a single VM by ID
 */
export function useVM(id: string, enabled = true) {
  return useQuery({
    queryKey: vmKeys.detail(id),
    queryFn: () => vmApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

/**
 * Hook to create a new VM
 */
export function useCreateVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      projectId: string;
      description?: string;
      labels?: Record<string, string>;
      nodeId?: string;
      spec?: ApiVM['spec'];
    }) => vmApi.create(data),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" created successfully`);
      // Invalidate VM list cache
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create VM');
    },
  });
}

/**
 * Hook to start a VM
 */
export function useStartVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vmApi.start(id),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" is starting`);
      // Update the VM in the cache
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to start VM');
    },
  });
}

/**
 * Hook to stop a VM
 */
export function useStopVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force = false }: { id: string; force?: boolean }) =>
      vmApi.stop(id, force),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" is stopping`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to stop VM');
    },
  });
}

/**
 * Hook to reboot a VM
 */
export function useRebootVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force = false }: { id: string; force?: boolean }) =>
      vmApi.reboot(id, force),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" is rebooting`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to reboot VM');
    },
  });
}

/**
 * Hook to pause a VM (freeze in place)
 */
export function usePauseVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vmApi.pause(id),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" is paused`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to pause VM');
    },
  });
}

/**
 * Hook to resume a paused VM
 */
export function useResumeVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vmApi.resume(id),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" is resuming`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to resume VM');
    },
  });
}

/**
 * Hook to suspend a VM (save state to disk)
 */
export function useSuspendVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vmApi.suspend(id),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" is suspending to disk`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to suspend VM');
    },
  });
}

/**
 * Hook to clone a VM
 * Supports two clone types:
 * - LINKED: Fast clone using QCOW2 overlay, depends on source disk
 * - FULL: Complete copy of disk, fully independent
 */
export function useCloneVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      sourceVmId: string;
      name: string;
      projectId?: string;
      cloneType?: 'FULL' | 'LINKED';
      startOnCreate?: boolean;
    }) => vmApi.clone(data),
    onSuccess: (vm, variables) => {
      const cloneType = variables.cloneType === 'LINKED' ? 'linked' : 'full';
      showSuccess(`VM "${vm.name}" cloned successfully (${cloneType} clone)`);
      // Invalidate lists to show new VM
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to clone VM');
    },
  });
}

/**
 * Hook to delete a VM
 * Supports two modes:
 * - removeFromInventoryOnly=true: Only removes from vDC, keeps VM on hypervisor
 * - removeFromInventoryOnly=false (default): Full deletion including disk files
 */
export function useDeleteVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ 
      id, 
      force = false,
      deleteVolumes = true,
      removeFromInventoryOnly = false,
    }: { 
      id: string; 
      force?: boolean;
      deleteVolumes?: boolean;
      removeFromInventoryOnly?: boolean;
    }) =>
      vmApi.delete(id, { force, deleteVolumes, removeFromInventoryOnly }),
    onSuccess: (_, variables) => {
      if (variables.removeFromInventoryOnly) {
        showSuccess('VM removed from inventory (kept on hypervisor)');
      } else {
        showSuccess('VM deleted successfully');
      }
      // Remove from cache
      queryClient.removeQueries({ queryKey: vmKeys.detail(variables.id) });
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete VM');
    },
  });
}

/**
 * Hook to update a VM's settings (name, description, labels)
 */
export function useUpdateVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      id: string;
      name?: string;
      description?: string;
      labels?: Record<string, string>;
      spec?: ApiVM['spec'];
    }) => vmApi.update(data),
    onSuccess: (vm) => {
      showSuccess(`VM "${vm.name}" updated successfully`);
      // Update the VM in the cache
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to update VM');
    },
  });
}

/**
 * Helper to check if a VM is running
 */
export function isVMRunning(vm: ApiVM): boolean {
  const state = vm.status?.state || vm.status?.powerState || '';
  return state === 'RUNNING' || state === 'POWER_STATE_RUNNING';
}

/**
 * Helper to check if a VM is stopped
 */
export function isVMStopped(vm: ApiVM): boolean {
  const state = vm.status?.state || vm.status?.powerState || '';
  return state === 'STOPPED' || state === 'POWER_STATE_STOPPED';
}

// ============================================================================
// Disk Operations
// ============================================================================

/**
 * Hook to attach a new disk to a VM
 */
export function useAttachDisk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      vmId: string;
      disk: { sizeGib: number; bus: string; format?: string };
    }) => vmApi.attachDisk(data.vmId, data.disk),
    onSuccess: (vm) => {
      showSuccess(`Disk attached to "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to attach disk');
    },
  });
}

/**
 * Hook to detach a disk from a VM
 */
export function useDetachDisk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string; diskId: string; force?: boolean }) =>
      vmApi.detachDisk(data.vmId, data.diskId, data.force),
    onSuccess: (vm) => {
      showSuccess(`Disk detached from "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to detach disk');
    },
  });
}

/**
 * Hook to resize a disk attached to a VM
 */
export function useResizeDisk() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string; diskId: string; newSizeGib: number }) =>
      vmApi.resizeDisk(data.vmId, data.diskId, data.newSizeGib),
    onSuccess: (vm) => {
      showSuccess(`Disk resized on "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to resize disk');
    },
  });
}

// ============================================================================
// NIC Operations
// ============================================================================

/**
 * Hook to attach a new NIC to a VM
 */
export function useAttachNIC() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      vmId: string;
      nic: { networkId: string; macAddress?: string; model?: string };
    }) => vmApi.attachNIC(data.vmId, data.nic),
    onSuccess: (vm) => {
      showSuccess(`NIC attached to "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to attach NIC');
    },
  });
}

/**
 * Hook to detach a NIC from a VM
 */
export function useDetachNIC() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string; nicId: string }) =>
      vmApi.detachNIC(data.vmId, data.nicId),
    onSuccess: (vm) => {
      showSuccess(`NIC detached from "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to detach NIC');
    },
  });
}

// ============================================================================
// Events
// ============================================================================

/**
 * Hook to list VM events
 */
export function useVMEvents(vmId: string, options?: {
  type?: string;
  severity?: string;
  limit?: number;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['vm-events', vmId, options?.type, options?.severity],
    queryFn: () => vmApi.listEvents(vmId, {
      type: options?.type,
      severity: options?.severity,
      limit: options?.limit || 50,
    }),
    enabled: (options?.enabled ?? true) && !!vmId,
    staleTime: 10000, // Refresh every 10 seconds
  });
}

// ============================================================================
// Agent
// ============================================================================

/**
 * Hook to ping the guest agent
 */
export function usePingAgent(vmId: string, enabled = true) {
  return useQuery({
    queryKey: ['vm-agent', vmId],
    queryFn: () => vmApi.pingAgent(vmId),
    enabled: enabled && !!vmId,
    staleTime: 10000, // Refresh every 10 seconds
    retry: 1,
  });
}

// ============================================================================
// CD-ROM Operations
// ============================================================================

/**
 * Hook to attach a CD-ROM device to a VM
 */
export function useAttachCDROM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string }) =>
      vmApi.attachCDROM(data.vmId),
    onSuccess: (vm) => {
      showSuccess(`CD-ROM device added to "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to add CD-ROM device');
    },
  });
}

/**
 * Hook to detach a CD-ROM device from a VM
 */
export function useDetachCDROM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string; cdromId: string }) =>
      vmApi.detachCDROM(data.vmId, data.cdromId),
    onSuccess: (vm) => {
      showSuccess(`CD-ROM device removed from "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to remove CD-ROM device');
    },
  });
}

/**
 * Hook to mount an ISO to a CD-ROM device
 */
export function useMountISO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string; cdromId: string; isoPath: string }) =>
      vmApi.mountISO(data.vmId, data.cdromId, data.isoPath),
    onSuccess: (vm) => {
      showSuccess(`ISO mounted to "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to mount ISO');
    },
  });
}

/**
 * Hook to eject an ISO from a CD-ROM device
 */
export function useEjectISO() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { vmId: string; cdromId: string }) =>
      vmApi.ejectISO(data.vmId, data.cdromId),
    onSuccess: (vm) => {
      showSuccess(`ISO ejected from "${vm.name}"`);
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to eject ISO');
    },
  });
}

// Re-export types
export type { ApiVM, VMListRequest, VMListResponse };
