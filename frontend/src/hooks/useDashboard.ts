/**
 * Aggregate hook for Dashboard data
 * 
 * Combines VM and Node data to provide dashboard metrics
 */

import { useVMs, isVMRunning } from './useVMs';
import { useNodes, isNodeReady, getNodeCPUUsage, getNodeMemoryUsage } from './useNodes';
import { checkConnection, getConnectionStatus } from '../lib/api-client';
import { useQuery } from '@tanstack/react-query';

export interface DashboardMetrics {
  // VM metrics
  totalVMs: number;
  runningVMs: number;
  stoppedVMs: number;
  pausedVMs: number;
  totalVCPUs: number;
  totalMemoryGB: number;
  
  // Node metrics
  totalHosts: number;
  healthyHosts: number;
  unhealthyHosts: number;
  maintenanceHosts: number;
  avgCpuUsage: number;
  avgMemoryUsage: number;
  
  // Storage metrics (placeholder until storage service is connected)
  totalStorageGB: number;
  usedStorageGB: number;
  
  // Alerts (placeholder)
  criticalAlerts: number;
  warningAlerts: number;
}

/**
 * Hook to fetch all dashboard data
 */
export function useDashboard() {
  const vmsQuery = useVMs();
  const nodesQuery = useNodes();
  
  // Calculate metrics from the data
  const metrics: DashboardMetrics = {
    // VM metrics
    totalVMs: vmsQuery.data?.vms?.length || 0,
    runningVMs: vmsQuery.data?.vms?.filter(vm => isVMRunning(vm)).length || 0,
    stoppedVMs: vmsQuery.data?.vms?.filter(vm => vm.status?.state === 2).length || 0,
    pausedVMs: vmsQuery.data?.vms?.filter(vm => vm.status?.state === 3).length || 0,
    totalVCPUs: vmsQuery.data?.vms?.reduce((sum, vm) => sum + (vm.spec?.cpu?.cores || 0), 0) || 0,
    totalMemoryGB: vmsQuery.data?.vms?.reduce((sum, vm) => {
      const memMib = Number(vm.spec?.memory?.sizeMib || 0n);
      return sum + (memMib / 1024);
    }, 0) || 0,
    
    // Node metrics
    totalHosts: nodesQuery.data?.nodes?.length || 0,
    healthyHosts: nodesQuery.data?.nodes?.filter(node => isNodeReady(node)).length || 0,
    unhealthyHosts: nodesQuery.data?.nodes?.filter(node => node.status?.phase === 3).length || 0,
    maintenanceHosts: nodesQuery.data?.nodes?.filter(node => node.status?.phase === 5).length || 0,
    avgCpuUsage: nodesQuery.data?.nodes?.length 
      ? nodesQuery.data.nodes.reduce((sum, node) => sum + getNodeCPUUsage(node), 0) / nodesQuery.data.nodes.length
      : 0,
    avgMemoryUsage: nodesQuery.data?.nodes?.length
      ? nodesQuery.data.nodes.reduce((sum, node) => sum + getNodeMemoryUsage(node), 0) / nodesQuery.data.nodes.length
      : 0,
    
    // Storage (placeholder - will be connected later)
    totalStorageGB: 10000,
    usedStorageGB: 6500,
    
    // Alerts (placeholder - will be connected later)
    criticalAlerts: 0,
    warningAlerts: 0,
  };
  
  return {
    metrics,
    vms: vmsQuery.data?.vms || [],
    nodes: nodesQuery.data?.nodes || [],
    isLoading: vmsQuery.isLoading || nodesQuery.isLoading,
    isError: vmsQuery.isError || nodesQuery.isError,
    error: vmsQuery.error || nodesQuery.error,
    refetch: () => {
      vmsQuery.refetch();
      nodesQuery.refetch();
    },
  };
}

/**
 * Hook to check API connection status
 */
export function useApiConnection() {
  return useQuery({
    queryKey: ['api', 'connection'],
    queryFn: async () => {
      const connected = await checkConnection();
      return {
        connected,
        status: getConnectionStatus(),
      };
    },
    staleTime: 10000,
    refetchInterval: 30000,
    retry: false,
  });
}

/**
 * Hook to get recent VMs for the dashboard
 */
export function useRecentVMs(limit: number = 5) {
  const vmsQuery = useVMs();
  
  // Sort by updated_at descending and take the first N
  const recentVMs = (vmsQuery.data?.vms || [])
    .slice()
    .sort((a, b) => {
      const aTime = a.updatedAt?.seconds || 0n;
      const bTime = b.updatedAt?.seconds || 0n;
      return Number(bTime - aTime);
    })
    .slice(0, limit);
  
  return {
    vms: recentVMs,
    isLoading: vmsQuery.isLoading,
    isError: vmsQuery.isError,
  };
}
