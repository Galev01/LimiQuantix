/**
 * React Query hooks for VM operations
 * 
 * These hooks connect the frontend to the LimiQuantix backend API
 * using the generated Connect-ES clients.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@connectrpc/connect';
import { getTransport } from '../lib/api-client';
import { VMService } from '../api/limiquantix/compute/v1/vm_service_connect';
import type { VirtualMachine } from '../api/limiquantix/compute/v1/vm_pb';
import type { ListVMsRequest, CreateVMRequest } from '../api/limiquantix/compute/v1/vm_service_pb';
import { create } from '@bufbuild/protobuf';
import { ListVMsRequestSchema, CreateVMRequestSchema, GetVMRequestSchema, StartVMRequestSchema, StopVMRequestSchema, DeleteVMRequestSchema } from '../api/limiquantix/compute/v1/vm_service_pb';

// Create the VM client
function getVMClient() {
  return createClient(VMService, getTransport());
}

// Query keys for cache invalidation
export const vmKeys = {
  all: ['vms'] as const,
  lists: () => [...vmKeys.all, 'list'] as const,
  list: (filters: Partial<ListVMsRequest>) => [...vmKeys.lists(), filters] as const,
  details: () => [...vmKeys.all, 'detail'] as const,
  detail: (id: string) => [...vmKeys.details(), id] as const,
};

/**
 * Hook to list all VMs with optional filtering
 */
export function useVMs(options?: {
  projectId?: string;
  nodeId?: string;
  nameContains?: string;
  pageSize?: number;
  enabled?: boolean;
}) {
  const { projectId, nodeId, nameContains, pageSize = 100, enabled = true } = options || {};

  return useQuery({
    queryKey: vmKeys.list({ projectId, nodeId, nameContains }),
    queryFn: async () => {
      const client = getVMClient();
      const request = create(ListVMsRequestSchema, {
        projectId: projectId || '',
        nodeId: nodeId || '',
        nameContains: nameContains || '',
        pageSize,
      });
      
      const response = await client.listVMs(request);
      return {
        vms: response.vms,
        totalCount: response.totalCount,
        nextPageToken: response.nextPageToken,
      };
    },
    enabled,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refetch every minute
  });
}

/**
 * Hook to get a single VM by ID
 */
export function useVM(id: string, options?: { enabled?: boolean }) {
  const { enabled = true } = options || {};

  return useQuery({
    queryKey: vmKeys.detail(id),
    queryFn: async () => {
      const client = getVMClient();
      const request = create(GetVMRequestSchema, { id });
      return await client.getVM(request);
    },
    enabled: enabled && !!id,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to create a new VM
 */
export function useCreateVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      projectId?: string;
      description?: string;
      labels?: Record<string, string>;
      cpuCores?: number;
      memoryMib?: number;
    }) => {
      const client = getVMClient();
      const request = create(CreateVMRequestSchema, {
        name: input.name,
        projectId: input.projectId || 'default',
        description: input.description || '',
        labels: input.labels || {},
        spec: {
          cpu: { cores: input.cpuCores || 2 },
          memory: { sizeMib: BigInt(input.memoryMib || 4096) },
        },
      });
      
      return await client.createVM(request);
    },
    onSuccess: () => {
      // Invalidate the VM list cache
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
  });
}

/**
 * Hook to start a VM
 */
export function useStartVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const client = getVMClient();
      const request = create(StartVMRequestSchema, { id });
      return await client.startVM(request);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: vmKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
  });
}

/**
 * Hook to stop a VM
 */
export function useStopVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; force?: boolean }) => {
      const client = getVMClient();
      const request = create(StopVMRequestSchema, { 
        id: input.id,
        force: input.force || false,
      });
      return await client.stopVM(request);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: vmKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
  });
}

/**
 * Hook to delete a VM
 */
export function useDeleteVM() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; force?: boolean }) => {
      const client = getVMClient();
      const request = create(DeleteVMRequestSchema, { 
        id: input.id,
        force: input.force || false,
      });
      return await client.deleteVM(request);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
  });
}

/**
 * Helper to get VM state as string
 */
export function getVMStateLabel(vm: VirtualMachine): string {
  const state = vm.status?.state;
  if (state === undefined) return 'Unknown';
  
  const stateMap: Record<number, string> = {
    0: 'Unknown',
    1: 'Running',
    2: 'Stopped',
    3: 'Paused',
    4: 'Suspended',
    5: 'Crashed',
    6: 'Migrating',
    7: 'Provisioning',
  };
  
  return stateMap[state] || 'Unknown';
}

/**
 * Helper to check if VM is running
 */
export function isVMRunning(vm: VirtualMachine): boolean {
  return vm.status?.state === 1; // RUNNING = 1
}

/**
 * Helper to check if VM is stopped
 */
export function isVMStopped(vm: VirtualMachine): boolean {
  return vm.status?.state === 2; // STOPPED = 2
}
