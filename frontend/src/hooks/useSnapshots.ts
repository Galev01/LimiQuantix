/**
 * React Query hooks for VM Snapshot operations
 * 
 * These hooks provide snapshot management for virtual machines.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vmApi, type ApiSnapshot, type ListSnapshotsResponse } from '../lib/api-client';
import { vmKeys } from './useVMs';
import { showSuccess, showError } from '../lib/toast';

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
 * Parse snapshot error and return user-friendly message
 */
function parseSnapshotError(error: unknown): { message: string; suggestion?: string } {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Check for quiesce/guest agent errors
  if (errorMessage.includes('quiesce') && errorMessage.includes('agent')) {
    return {
      message: 'Filesystem quiesce failed',
      suggestion: 'The guest agent may not be running. Try again without the "Quiesce filesystems" option, or install/start the guest agent inside the VM.',
    };
  }
  
  // Check for VM not running
  if (errorMessage.includes('domain is not running')) {
    return {
      message: 'VM must be running for memory snapshots',
      suggestion: 'Start the VM first, or uncheck "Include memory state" to take a disk-only snapshot.',
    };
  }
  
  // Check for disk busy
  if (errorMessage.includes('disk is busy') || errorMessage.includes('locked')) {
    return {
      message: 'Disk is currently busy',
      suggestion: 'Wait for any ongoing disk operations to complete and try again.',
    };
  }
  
  // Check for snapshot directory issues
  if (errorMessage.includes('snapshot directory') || errorMessage.includes('permission denied')) {
    return {
      message: 'Snapshot storage error',
      suggestion: 'Check that the snapshot directory exists and has proper permissions.',
    };
  }
  
  // Check for external snapshot revert issues
  if (errorMessage.includes('revert') && errorMessage.includes('external')) {
    return {
      message: 'Cannot revert to external snapshot',
      suggestion: 'External snapshots with memory may require the VM to be stopped first. Try stopping the VM and reverting again.',
    };
  }
  
  return {
    message: errorMessage,
  };
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
      showSuccess(`Snapshot "${snapshot.name}" created successfully`);
      // Invalidate snapshot list cache for this VM
      queryClient.invalidateQueries({ queryKey: snapshotKeys.list(variables.vmId) });
      // Also invalidate the VM to refresh snapshot count
      queryClient.invalidateQueries({ queryKey: vmKeys.detail(variables.vmId) });
    },
    onError: (error) => {
      const parsed = parseSnapshotError(error);
      if (parsed.suggestion) {
        // Show detailed error with suggestion
        showError(new Error(`${parsed.message}\n\n${parsed.suggestion}`), 'Snapshot failed');
      } else {
        showError(new Error(parsed.message), 'Failed to create snapshot');
      }
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
      showSuccess(`VM reverted to snapshot successfully`);
      // Update the VM in the cache
      queryClient.setQueryData(vmKeys.detail(vm.id), vm);
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: vmKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to revert to snapshot');
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
      showSuccess('Snapshot deleted successfully');
      // Invalidate snapshot list cache for this VM
      queryClient.invalidateQueries({ queryKey: snapshotKeys.list(variables.vmId) });
      // Also invalidate the VM
      queryClient.invalidateQueries({ queryKey: vmKeys.detail(variables.vmId) });
    },
    onError: (error) => {
      showError(error, 'Failed to delete snapshot');
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
