/**
 * React hooks for cluster operations
 * 
 * The Host UI does NOT join clusters directly.
 * Instead, it:
 * 1. Tests connectivity to the vDC control plane
 * 2. Generates a registration token that the vDC can use to add this host
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
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

// Test connection to vDC control plane
export function useTestConnection() {
  return useMutation({
    mutationFn: clusterApi.testConnection,
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Connection successful! Cluster: ${data.clusterName || 'Unknown'}`);
      } else {
        toast.error(`Connection failed: ${data.message}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Connection test failed: ${error.message}`);
    },
  });
}

// Generate registration token for vDC to use
export function useGenerateToken() {
  return useMutation({
    mutationFn: clusterApi.generateRegistrationToken,
    onSuccess: () => {
      toast.success('Registration token generated. Copy it and add this host from the vDC console.');
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate token: ${error.message}`);
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

// Join cluster (legacy - now hosts generate tokens instead)
// This is kept for backward compatibility but should show a message directing users to use token generation
export function useJoinCluster() {
  return useMutation({
    mutationFn: async (_data: { control_plane_address: string; registration_token: string }) => {
      // The new flow is: host generates token, vDC uses it to add the host
      throw new Error('Direct cluster join is no longer supported. Generate a registration token instead and add this host from the vDC console.');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}