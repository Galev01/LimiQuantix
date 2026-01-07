/**
 * React hooks for cluster operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as clusterApi from '@/api/cluster';

// Query keys
const CLUSTER_KEYS = {
  all: ['cluster'] as const,
  status: () => [...CLUSTER_KEYS.all, 'status'] as const,
  config: () => [...CLUSTER_KEYS.all, 'config'] as const,
};

// Get cluster status
export function useClusterStatus() {
  return useQuery({
    queryKey: CLUSTER_KEYS.status(),
    queryFn: clusterApi.getClusterStatus,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

// Get cluster configuration
export function useClusterConfig() {
  return useQuery({
    queryKey: CLUSTER_KEYS.config(),
    queryFn: clusterApi.getClusterConfig,
  });
}

// Join cluster
export function useJoinCluster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clusterApi.joinCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLUSTER_KEYS.status() });
      queryClient.invalidateQueries({ queryKey: CLUSTER_KEYS.config() });
      toast.success('Successfully joined Quantix-vDC cluster. Please restart the node daemon for changes to take effect.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to join cluster: ${error.message}`);
    },
  });
}

// Leave cluster
export function useLeaveCluster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: clusterApi.leaveCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLUSTER_KEYS.status() });
      queryClient.invalidateQueries({ queryKey: CLUSTER_KEYS.config() });
      toast.success('Successfully left cluster. Node is now in standalone mode.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to leave cluster: ${error.message}`);
    },
  });
}
