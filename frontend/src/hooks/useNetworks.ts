/**
 * React Query hooks for Virtual Network operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { networkApi, type ApiVirtualNetwork, type NetworkListResponse } from '../lib/api-client';

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: networkKeys.lists() });
    },
  });
}

export function useDeleteNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => networkApi.delete(id),
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: networkKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: networkKeys.lists() });
    },
  });
}

export type { ApiVirtualNetwork, NetworkListResponse };
