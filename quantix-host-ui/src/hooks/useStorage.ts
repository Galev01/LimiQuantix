import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listStoragePools,
  getStoragePool,
  createStoragePool,
  destroyStoragePool,
  listVolumes,
  createVolume,
  deleteVolume,
  resizeVolume,
  listImages,
} from '@/api/storage';
import type { CreatePoolRequest, CreateVolumeRequest } from '@/api/storage';
import { toast } from '@/lib/toast';

/**
 * Hook to list all storage pools
 */
export function useStoragePools() {
  return useQuery({
    queryKey: ['storage', 'pools'],
    queryFn: listStoragePools,
    staleTime: 30_000,
  });
}

/**
 * Hook to get a single storage pool
 */
export function useStoragePool(poolId: string) {
  return useQuery({
    queryKey: ['storage', 'pools', poolId],
    queryFn: () => getStoragePool(poolId),
    enabled: !!poolId,
  });
}

/**
 * Hook to list volumes in a pool
 */
export function useVolumes(poolId: string) {
  return useQuery({
    queryKey: ['storage', 'pools', poolId, 'volumes'],
    queryFn: () => listVolumes(poolId),
    enabled: !!poolId,
  });
}

/**
 * Hook to list available images/ISOs
 */
export function useImages() {
  return useQuery({
    queryKey: ['storage', 'images'],
    queryFn: listImages,
    staleTime: 60_000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Hook to create a storage pool
 */
export function useCreateStoragePool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: CreatePoolRequest) => createStoragePool(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage', 'pools'] });
      toast.success('Storage pool created');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create storage pool: ${error.message}`);
    },
  });
}

/**
 * Hook to destroy a storage pool
 */
export function useDestroyStoragePool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (poolId: string) => destroyStoragePool(poolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage', 'pools'] });
      toast.success('Storage pool destroyed');
    },
    onError: (error: Error) => {
      toast.error(`Failed to destroy storage pool: ${error.message}`);
    },
  });
}

/**
 * Hook for volume operations
 */
export function useVolumeOps(poolId: string) {
  const queryClient = useQueryClient();

  const invalidateVolumes = () => {
    queryClient.invalidateQueries({ queryKey: ['storage', 'pools', poolId, 'volumes'] });
  };

  const create = useMutation({
    mutationFn: (request: CreateVolumeRequest) => createVolume(poolId, request),
    onSuccess: () => {
      invalidateVolumes();
      toast.success('Volume created');
    },
    onError: (error: Error) => {
      toast.error(`Failed to create volume: ${error.message}`);
    },
  });

  const remove = useMutation({
    mutationFn: (volumeId: string) => deleteVolume(poolId, volumeId),
    onSuccess: () => {
      invalidateVolumes();
      toast.success('Volume deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete volume: ${error.message}`);
    },
  });

  const resize = useMutation({
    mutationFn: ({ volumeId, newSizeBytes }: { volumeId: string; newSizeBytes: number }) =>
      resizeVolume(poolId, volumeId, newSizeBytes),
    onSuccess: () => {
      invalidateVolumes();
      toast.success('Volume resized');
    },
    onError: (error: Error) => {
      toast.error(`Failed to resize volume: ${error.message}`);
    },
  });

  return { create, remove, resize };
}
