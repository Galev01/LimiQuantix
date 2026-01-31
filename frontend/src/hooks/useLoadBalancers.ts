/**
 * React Query hooks for Load Balancer operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  loadBalancerApi,
  type ApiLoadBalancer,
  type ApiListener,
  type ApiPoolMember,
  type LoadBalancerListResponse,
  type LoadBalancerStats,
} from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

// Query keys for cache management
export const loadBalancerKeys = {
  all: ['loadBalancers'] as const,
  lists: () => [...loadBalancerKeys.all, 'list'] as const,
  list: (projectId?: string, networkId?: string) =>
    [...loadBalancerKeys.lists(), { projectId, networkId }] as const,
  details: () => [...loadBalancerKeys.all, 'detail'] as const,
  detail: (id: string) => [...loadBalancerKeys.details(), id] as const,
  stats: (id: string) => [...loadBalancerKeys.detail(id), 'stats'] as const,
};

/**
 * Hook to fetch list of load balancers
 */
export function useLoadBalancers(options?: {
  projectId?: string;
  networkId?: string;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: loadBalancerKeys.list(options?.projectId, options?.networkId),
    queryFn: () =>
      loadBalancerApi.list({
        projectId: options?.projectId,
        networkId: options?.networkId,
      }),
    enabled: options?.enabled ?? true,
    staleTime: 30000,
    refetchInterval: options?.refetchInterval,
    retry: 2,
  });
}

/**
 * Hook to fetch a single load balancer by ID
 */
export function useLoadBalancer(id: string, enabled = true) {
  return useQuery({
    queryKey: loadBalancerKeys.detail(id),
    queryFn: () => loadBalancerApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

/**
 * Hook to fetch load balancer statistics
 */
export function useLoadBalancerStats(id: string, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: loadBalancerKeys.stats(id),
    queryFn: () => loadBalancerApi.getStats(id),
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 5000, // Stats are more volatile, refresh more often
    refetchInterval: options?.refetchInterval ?? 5000,
  });
}

/**
 * Hook to create a new load balancer
 */
export function useCreateLoadBalancer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      projectId: string;
      labels?: Record<string, string>;
      spec?: {
        networkId?: string;
        subnetId?: string;
        vipAddress?: string;
        listeners?: ApiListener[];
        pools?: Array<{
          id?: string;
          name?: string;
          algorithm?: 'ROUND_ROBIN' | 'LEAST_CONNECTIONS' | 'SOURCE_IP' | 'WEIGHTED_ROUND_ROBIN';
        }>;
      };
    }) => loadBalancerApi.create(data),
    onSuccess: (lb) => {
      showSuccess(`Load balancer "${lb.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create load balancer');
    },
  });
}

/**
 * Hook to update a load balancer
 */
export function useUpdateLoadBalancer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      id: string;
      description?: string;
      labels?: Record<string, string>;
    }) => loadBalancerApi.update(data),
    onSuccess: (lb) => {
      showSuccess(`Load balancer "${lb.name}" updated successfully`);
      queryClient.setQueryData(loadBalancerKeys.detail(lb.id), lb);
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to update load balancer');
    },
  });
}

/**
 * Hook to delete a load balancer
 */
export function useDeleteLoadBalancer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => loadBalancerApi.delete(id),
    onSuccess: (_, id) => {
      showSuccess('Load balancer deleted successfully');
      queryClient.removeQueries({ queryKey: loadBalancerKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete load balancer');
    },
  });
}

/**
 * Hook to add a listener to a load balancer
 */
export function useAddListener() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ loadBalancerId, listener }: { loadBalancerId: string; listener: ApiListener }) =>
      loadBalancerApi.addListener(loadBalancerId, listener),
    onSuccess: (lb) => {
      showSuccess('Listener added successfully');
      queryClient.setQueryData(loadBalancerKeys.detail(lb.id), lb);
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to add listener');
    },
  });
}

/**
 * Hook to remove a listener from a load balancer
 */
export function useRemoveListener() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ loadBalancerId, listenerId }: { loadBalancerId: string; listenerId: string }) =>
      loadBalancerApi.removeListener(loadBalancerId, listenerId),
    onSuccess: (lb) => {
      showSuccess('Listener removed successfully');
      queryClient.setQueryData(loadBalancerKeys.detail(lb.id), lb);
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to remove listener');
    },
  });
}

/**
 * Hook to add a pool member
 */
export function useAddPoolMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      loadBalancerId,
      poolId,
      member,
    }: {
      loadBalancerId: string;
      poolId: string;
      member: ApiPoolMember;
    }) => loadBalancerApi.addPoolMember(loadBalancerId, poolId, member),
    onSuccess: (lb) => {
      showSuccess('Pool member added successfully');
      queryClient.setQueryData(loadBalancerKeys.detail(lb.id), lb);
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to add pool member');
    },
  });
}

/**
 * Hook to remove a pool member
 */
export function useRemovePoolMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      loadBalancerId,
      poolId,
      memberId,
    }: {
      loadBalancerId: string;
      poolId: string;
      memberId: string;
    }) => loadBalancerApi.removePoolMember(loadBalancerId, poolId, memberId),
    onSuccess: (lb) => {
      showSuccess('Pool member removed successfully');
      queryClient.setQueryData(loadBalancerKeys.detail(lb.id), lb);
      queryClient.invalidateQueries({ queryKey: loadBalancerKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to remove pool member');
    },
  });
}

// Type exports for consumers
export type { ApiLoadBalancer, ApiListener, ApiPoolMember, LoadBalancerListResponse, LoadBalancerStats };
