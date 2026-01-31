/**
 * React Query hooks for VPN Service operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  vpnApi,
  type ApiVpnService,
  type ApiVpnConnection,
  type VpnListResponse,
  type VpnTunnelStatus,
} from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

// Query keys for cache management
export const vpnKeys = {
  all: ['vpn'] as const,
  lists: () => [...vpnKeys.all, 'list'] as const,
  list: (projectId?: string) => [...vpnKeys.lists(), { projectId }] as const,
  details: () => [...vpnKeys.all, 'detail'] as const,
  detail: (id: string) => [...vpnKeys.details(), id] as const,
  status: (id: string) => [...vpnKeys.detail(id), 'status'] as const,
};

/**
 * Hook to fetch list of VPN services
 */
export function useVPNs(options?: {
  projectId?: string;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: vpnKeys.list(options?.projectId),
    queryFn: () => vpnApi.list({ projectId: options?.projectId }),
    enabled: options?.enabled ?? true,
    staleTime: 30000,
    refetchInterval: options?.refetchInterval,
    retry: 2,
  });
}

/**
 * Hook to fetch a single VPN service by ID
 */
export function useVPN(id: string, enabled = true) {
  return useQuery({
    queryKey: vpnKeys.detail(id),
    queryFn: () => vpnApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

/**
 * Hook to fetch VPN tunnel status
 */
export function useVPNStatus(id: string, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: vpnKeys.status(id),
    queryFn: () => vpnApi.getStatus(id),
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 5000,
    refetchInterval: options?.refetchInterval ?? 5000,
  });
}

/**
 * Hook to create a new VPN service
 */
export function useCreateVPN() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      projectId: string;
      routerId?: string;
      connections?: ApiVpnConnection[];
    }) => vpnApi.create(data),
    onSuccess: (vpn) => {
      showSuccess(`VPN service "${vpn.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: vpnKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create VPN service');
    },
  });
}

/**
 * Hook to delete a VPN service
 */
export function useDeleteVPN() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => vpnApi.delete(id),
    onSuccess: (_, id) => {
      showSuccess('VPN service deleted successfully');
      queryClient.removeQueries({ queryKey: vpnKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: vpnKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete VPN service');
    },
  });
}

/**
 * Hook to add a connection to a VPN service
 */
export function useAddVPNConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vpnId, connection }: { vpnId: string; connection: ApiVpnConnection }) =>
      vpnApi.addConnection(vpnId, connection),
    onSuccess: (vpn) => {
      showSuccess('VPN connection added successfully');
      queryClient.setQueryData(vpnKeys.detail(vpn.id), vpn);
      queryClient.invalidateQueries({ queryKey: vpnKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to add VPN connection');
    },
  });
}

/**
 * Hook to remove a connection from a VPN service
 */
export function useRemoveVPNConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vpnId, connectionId }: { vpnId: string; connectionId: string }) =>
      vpnApi.removeConnection(vpnId, connectionId),
    onSuccess: (vpn) => {
      showSuccess('VPN connection removed successfully');
      queryClient.setQueryData(vpnKeys.detail(vpn.id), vpn);
      queryClient.invalidateQueries({ queryKey: vpnKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to remove VPN connection');
    },
  });
}

// Type exports
export type { ApiVpnService, ApiVpnConnection, VpnListResponse, VpnTunnelStatus };
