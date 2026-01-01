/**
 * React Query hooks for Node operations
 * 
 * These hooks connect the frontend to the LimiQuantix backend API
 * using the generated Connect-ES clients.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@connectrpc/connect';
import { getTransport } from '../lib/api-client';
import { NodeService } from '../api/limiquantix/compute/v1/node_service_connect';
import type { Node } from '../api/limiquantix/compute/v1/node_pb';
import type { ListNodesRequest } from '../api/limiquantix/compute/v1/node_service_pb';
import { create } from '@bufbuild/protobuf';
import { ListNodesRequestSchema, GetNodeRequestSchema, GetNodeMetricsRequestSchema, DrainNodeRequestSchema, EnableNodeRequestSchema, DisableNodeRequestSchema } from '../api/limiquantix/compute/v1/node_service_pb';

// Create the Node client
function getNodeClient() {
  return createClient(NodeService, getTransport());
}

// Query keys for cache invalidation
export const nodeKeys = {
  all: ['nodes'] as const,
  lists: () => [...nodeKeys.all, 'list'] as const,
  list: (filters: Partial<ListNodesRequest>) => [...nodeKeys.lists(), filters] as const,
  details: () => [...nodeKeys.all, 'detail'] as const,
  detail: (id: string) => [...nodeKeys.details(), id] as const,
  metrics: (id: string) => [...nodeKeys.all, 'metrics', id] as const,
};

/**
 * Hook to list all nodes with optional filtering
 */
export function useNodes(options?: {
  clusterId?: string;
  pageSize?: number;
  enabled?: boolean;
}) {
  const { clusterId, pageSize = 100, enabled = true } = options || {};

  return useQuery({
    queryKey: nodeKeys.list({ clusterId }),
    queryFn: async () => {
      const client = getNodeClient();
      const request = create(ListNodesRequestSchema, {
        clusterId: clusterId || '',
        pageSize,
      });
      
      const response = await client.listNodes(request);
      return {
        nodes: response.nodes,
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
 * Hook to get a single node by ID
 */
export function useNode(id: string, options?: { enabled?: boolean }) {
  const { enabled = true } = options || {};

  return useQuery({
    queryKey: nodeKeys.detail(id),
    queryFn: async () => {
      const client = getNodeClient();
      const request = create(GetNodeRequestSchema, { id });
      return await client.getNode(request);
    },
    enabled: enabled && !!id,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to get node metrics
 */
export function useNodeMetrics(id: string, options?: { enabled?: boolean }) {
  const { enabled = true } = options || {};

  return useQuery({
    queryKey: nodeKeys.metrics(id),
    queryFn: async () => {
      const client = getNodeClient();
      const request = create(GetNodeMetricsRequestSchema, { id });
      return await client.getNodeMetrics(request);
    },
    enabled: enabled && !!id,
    staleTime: 5000, // 5 seconds - metrics should refresh frequently
    refetchInterval: 10000, // Refetch every 10 seconds
  });
}

/**
 * Hook to drain a node (migrate all VMs off)
 */
export function useDrainNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; gracePeriodSeconds?: number }) => {
      const client = getNodeClient();
      const request = create(DrainNodeRequestSchema, { 
        id: input.id,
        gracePeriodSeconds: input.gracePeriodSeconds || 300,
      });
      return await client.drainNode(request);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: nodeKeys.lists() });
    },
  });
}

/**
 * Hook to enable a node (make schedulable)
 */
export function useEnableNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const client = getNodeClient();
      const request = create(EnableNodeRequestSchema, { id });
      return await client.enableNode(request);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: nodeKeys.lists() });
    },
  });
}

/**
 * Hook to disable a node (make unschedulable)
 */
export function useDisableNode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const client = getNodeClient();
      const request = create(DisableNodeRequestSchema, { id });
      return await client.disableNode(request);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: nodeKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: nodeKeys.lists() });
    },
  });
}

/**
 * Helper to get node phase as string
 */
export function getNodePhaseLabel(node: Node): string {
  const phase = node.status?.phase;
  if (phase === undefined) return 'Unknown';
  
  const phaseMap: Record<number, string> = {
    0: 'Unknown',
    1: 'Pending',
    2: 'Ready',
    3: 'Not Ready',
    4: 'Draining',
    5: 'Maintenance',
    6: 'Decommissioning',
  };
  
  return phaseMap[phase] || 'Unknown';
}

/**
 * Helper to check if node is ready
 */
export function isNodeReady(node: Node): boolean {
  return node.status?.phase === 2; // READY = 2
}

/**
 * Helper to calculate node CPU usage percentage
 */
export function getNodeCPUUsage(node: Node): number {
  const allocated = node.status?.resources?.cpu?.allocatedVcpus || 0;
  const total = node.status?.resources?.cpu?.allocatableVcpus || 1;
  return Math.round((allocated / total) * 100);
}

/**
 * Helper to calculate node memory usage percentage
 */
export function getNodeMemoryUsage(node: Node): number {
  const used = Number(node.status?.resources?.memory?.usedBytes || 0n);
  const total = Number(node.status?.resources?.memory?.allocatableBytes || 1n);
  return Math.round((used / total) * 100);
}
