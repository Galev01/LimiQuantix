/**
 * React Query hooks for Virtual Network operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { networkApi, type ApiVirtualNetwork, type NetworkListResponse } from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

export const networkKeys = {
  all: ['networks'] as const,
  lists: () => [...networkKeys.all, 'list'] as const,
  list: (projectId?: string) => [...networkKeys.lists(), { projectId }] as const,
  details: () => [...networkKeys.all, 'detail'] as const,
  detail: (id: string) => [...networkKeys.details(), id] as const,
};

export function useNetworks(options?: { projectId?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: networkKeys.list(options?.projectId),
    queryFn: () => networkApi.list({ projectId: options?.projectId }),
    enabled: options?.enabled ?? true,
    staleTime: 30000,
    retry: 2,
  });
}

export function useNetwork(id: string, enabled = true) {
  return useQuery({
    queryKey: networkKeys.detail(id),
    queryFn: () => networkApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

export function useCreateNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      projectId: string;
      description?: string;
      spec?: ApiVirtualNetwork['spec'];
    }) => networkApi.create(data),
    onSuccess: (network) => {
      showSuccess(`Network "${network.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: networkKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create network');
    },
  });
}

export function useUpdateNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      id: string;
      name?: string;
      description?: string;
      spec?: ApiVirtualNetwork['spec'];
    }) => networkApi.update(data),
    onSuccess: (network) => {
      showSuccess(`Network "${network.name}" updated successfully`);
      queryClient.setQueryData(networkKeys.detail(network.id), network);
      queryClient.invalidateQueries({ queryKey: networkKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to update network');
    },
  });
}

export function useDeleteNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => networkApi.delete(id),
    onSuccess: (_, id) => {
      showSuccess('Network deleted successfully');
      queryClient.removeQueries({ queryKey: networkKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: networkKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete network');
    },
  });
}

export type { ApiVirtualNetwork, NetworkListResponse };
