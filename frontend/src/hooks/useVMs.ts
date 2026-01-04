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
 * Hook to delete a VM
 */
export function useDeleteVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force = false }: { id: string; force?: boolean }) =>
      vmApi.delete(id, force),
    onSuccess: (_, variables) => {
      showSuccess('VM deleted successfully');
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

// Re-export types
export type { ApiVM, VMListRequest, VMListResponse };
