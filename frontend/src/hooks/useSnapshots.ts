/**
 * React Query hooks for VM Snapshot operations
 * 
 * These hooks provide snapshot management for virtual machines.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vmApi, type ApiSnapshot, type ListSnapshotsResponse } from '../lib/api-client';
import { vmKeys } from './useVMs';

// Query keys for cache invalidation
export const snapshotKeys = {
  all: ['snapshots'] as const,
  lists: () => [...snapshotKeys.all, 'list'] as const,
  list: (vmId: string) => [...snapshotKeys.lists(), vmId] as const,
  detail: (vmId: string, snapshotId: string) => [...snapshotKeys.all, 'detail', vmId, snapshotId] as const,
};

/**
 * Hook to list all snapshots for a VM
 */
export function useSnapshots(vmId: string, enabled = true) {
  return useQuery({
    queryKey: snapshotKeys.list(vmId),
    queryFn: async () => {
      const response = await vmApi.listSnapshots(vmId);
      return response.snapshots || [];
    },
    enabled: enabled && !!vmId,
    staleTime: 30000, // Consider fresh for 30 seconds
    retry: 2,
  });
}

/**
 * Hook to create a new snapshot
 */
export function useCreateSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      vmId: string;
      name: string;
      description?: string;
      includeMemory?: boolean;
      quiesce?: boolean;
    }) => vmApi.createSnapshot(data),
    onSuccess: (snapshot, variables) => {
      // Invalidate snapshot list cache for this VM
      queryClient.invalidateQueries({ queryKey: snapshotKeys.list(variables.vmId) });
      // Also invalidate the VM to refresh snapshot count
      queryClient.invalidateQueries({ queryKey: vmKeys.detail(variables.vmId) });
    },
  });
}

/**
 * Hook to revert to a snapshot
 */
export function useRevertToSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, snapshotId, startAfterRevert }: {
      vmId: string;
      snapshotId: string;
      startAfterRevert?: boolean;
    }) => vmApi.revertToSnapshot(vmId, snapshotId, startAfterRevert),
    onSuccess: (vm) => {
      // Update the VM in the cache
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
  });
}

/**
 * Hook to delete a snapshot
 */
export function useDeleteSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, snapshotId }: { vmId: string; snapshotId: string }) =>
      vmApi.deleteSnapshot(vmId, snapshotId),
    onSuccess: (_, variables) => {
      // Invalidate snapshot list cache for this VM
      queryClient.invalidateQueries({ queryKey: snapshotKeys.list(variables.vmId) });
      // Also invalidate the VM
      queryClient.invalidateQueries({ queryKey: vmKeys.detail(variables.vmId) });
    },
  });
}

/**
 * Format snapshot size for display
 */
export function formatSnapshotSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '—';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Re-export types
export type { ApiSnapshot, ListSnapshotsResponse };
