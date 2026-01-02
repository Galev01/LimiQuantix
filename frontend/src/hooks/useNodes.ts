/**
 * React Query hooks for Node operations
 * 
 * These hooks connect the frontend to the LimiQuantix backend API.
 */

import { useQuery } from '@tanstack/react-query';
import { nodeApi, type ApiNode, type NodeListRequest, type NodeListResponse } from '../lib/api-client';

// Query keys for cache invalidation
export const nodeKeys = {
  all: ['nodes'] as const,
  lists: () => [...nodeKeys.all, 'list'] as const,
  list: (filters: Partial<NodeListRequest>) => [...nodeKeys.lists(), filters] as const,
  details: () => [...nodeKeys.all, 'detail'] as const,
  detail: (id: string) => [...nodeKeys.details(), id] as const,
  metrics: (id: string) => [...nodeKeys.detail(id), 'metrics'] as const,
};

/**
 * Hook to list all nodes
 */
export function useNodes(options?: {
  pageSize?: number;
  enabled?: boolean;
}) {
  const queryParams: NodeListRequest = {
    pageSize: options?.pageSize || 100,
  };

  return useQuery({
    queryKey: nodeKeys.list(queryParams),
    queryFn: () => nodeApi.list(queryParams),
    enabled: options?.enabled ?? true,
    staleTime: 30000,
    retry: 2,
  });
}

/**
 * Hook to get a single node by ID
 */
export function useNode(id: string, enabled = true) {
  return useQuery({
    queryKey: nodeKeys.detail(id),
    queryFn: () => nodeApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

/**
 * Hook to get node metrics
 */
export function useNodeMetrics(nodeId: string, enabled = true) {
  return useQuery({
    queryKey: nodeKeys.metrics(nodeId),
    queryFn: () => nodeApi.getMetrics(nodeId),
    enabled: enabled && !!nodeId,
    staleTime: 5000,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

/**
 * Helper to check if node is ready
 */
export function isNodeReady(node: ApiNode): boolean {
  return node.status?.phase === 'READY' || node.status?.phase === 'NODE_PHASE_READY';
}

/**
 * Helper to get node CPU usage percentage
 */
export function getNodeCPUUsage(node: ApiNode): number {
  const allocation = node.status?.allocation;
  if (!allocation?.cpuCapacity || allocation.cpuCapacity === 0) return 0;
  return Math.round((allocation.cpuAllocated || 0) / allocation.cpuCapacity * 100);
}

/**
 * Helper to get node memory usage percentage
 */
export function getNodeMemoryUsage(node: ApiNode): number {
  const allocation = node.status?.allocation;
  if (!allocation?.memoryCapacityMib || allocation.memoryCapacityMib === 0) return 0;
  return Math.round((allocation.memoryAllocatedMib || 0) / allocation.memoryCapacityMib * 100);
}

// Re-export types
export type { ApiNode, NodeListRequest, NodeListResponse };
