/**
 * Aggregate hook for Dashboard data
 * 
 * Combines VM and Node data to provide dashboard metrics
 */

import { useVMs, isVMRunning, type ApiVM } from './useVMs';
import { useNodes, isNodeReady, getNodeCPUUsage, getNodeMemoryUsage, type ApiNode } from './useNodes';
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
 * Hook to check API connection status
 */
export function useApiConnection(options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: ['api', 'connection'],
    queryFn: async () => {
      const isConnected = await checkConnection();
      return {
        isConnected,
        ...getConnectionStatus(),
      };
    },
    enabled: options?.enabled ?? true,
    staleTime: 5000,
    refetchInterval: options?.refetchInterval ?? 30000,
    retry: false,
  });
}

/**
 * Hook to fetch all dashboard data
 */
export function useDashboard() {
  const vmsQuery = useVMs({ pageSize: 1000 });
  const nodesQuery = useNodes({ pageSize: 100 });
  const connectionQuery = useApiConnection();

  // Calculate metrics from the data
  const metrics = calculateMetrics(
    vmsQuery.data?.vms || [],
    nodesQuery.data?.nodes || []
  );

  return {
    // Raw data
    vms: vmsQuery.data?.vms || [],
    nodes: nodesQuery.data?.nodes || [],
    
    // Aggregated metrics
    metrics,
    
    // Loading states
    isLoading: vmsQuery.isLoading || nodesQuery.isLoading,
    isError: vmsQuery.isError || nodesQuery.isError,
    error: vmsQuery.error || nodesQuery.error,
    
    // Connection status
    isConnected: connectionQuery.data?.isConnected ?? false,
    connectionError: connectionQuery.data?.error,
    
    // Refetch functions
    refetch: () => {
      vmsQuery.refetch();
      nodesQuery.refetch();
    },
  };
}

/**
 * Calculate dashboard metrics from raw data
 */
function calculateMetrics(vms: ApiVM[], nodes: ApiNode[]): DashboardMetrics {
  // VM metrics
  const runningVMs = vms.filter(isVMRunning).length;
  const stoppedVMs = vms.filter(vm => {
    const state = vm.status?.state || vm.status?.powerState || '';
    return state === 'STOPPED' || state === 'POWER_STATE_STOPPED';
  }).length;
  const pausedVMs = vms.filter(vm => {
    const state = vm.status?.state || vm.status?.powerState || '';
    return state === 'PAUSED' || state === 'POWER_STATE_PAUSED';
  }).length;
  
  // Calculate total resources
  let totalVCPUs = 0;
  let totalMemoryMB = 0;
  let totalDiskGB = 0;
  let usedDiskGB = 0;
  
  for (const vm of vms) {
    totalVCPUs += vm.spec?.cpu?.cores || 0;
    totalMemoryMB += vm.spec?.memory?.sizeMib || 0;
    for (const disk of vm.spec?.disks || []) {
      totalDiskGB += (disk.sizeMib || 0) / 1024;
    }
  }
  
  // Node metrics
  const healthyHosts = nodes.filter(isNodeReady).length;
  const unhealthyHosts = nodes.filter(node => {
    const phase = node.status?.phase || '';
    return phase === 'NOT_READY' || phase === 'NODE_PHASE_NOT_READY';
  }).length;
  const maintenanceHosts = nodes.filter(node => {
    const phase = node.status?.phase || '';
    return phase === 'MAINTENANCE' || phase === 'NODE_PHASE_MAINTENANCE';
  }).length;
  
  // Calculate average resource usage
  let totalCpuUsage = 0;
  let totalMemoryUsage = 0;
  
  for (const node of nodes) {
    totalCpuUsage += getNodeCPUUsage(node);
    totalMemoryUsage += getNodeMemoryUsage(node);
  }
  
  const nodeCount = nodes.length || 1;
  
  return {
    totalVMs: vms.length,
    runningVMs,
    stoppedVMs,
    pausedVMs,
    totalVCPUs,
    totalMemoryGB: Math.round(totalMemoryMB / 1024),
    
    totalHosts: nodes.length,
    healthyHosts,
    unhealthyHosts,
    maintenanceHosts,
    avgCpuUsage: Math.round(totalCpuUsage / nodeCount),
    avgMemoryUsage: Math.round(totalMemoryUsage / nodeCount),
    
    // Placeholder storage metrics
    totalStorageGB: Math.round(totalDiskGB) || 1000,
    usedStorageGB: Math.round(usedDiskGB) || 420,
    
    // Placeholder alerts
    criticalAlerts: 0,
    warningAlerts: 0,
  };
}

// Re-export for convenience
export { isVMRunning } from './useVMs';
export { isNodeReady, getNodeCPUUsage, getNodeMemoryUsage } from './useNodes';
