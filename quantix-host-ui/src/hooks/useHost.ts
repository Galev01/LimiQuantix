import { useQuery } from '@tanstack/react-query';
import { getHostInfo, getHostHealth, getHardwareInventory } from '@/api/host';

/**
 * Hook to fetch host information
 */
export function useHostInfo() {
  return useQuery({
    queryKey: ['host', 'info'],
    queryFn: getHostInfo,
    staleTime: 30_000, // 30 seconds
    retry: 2,
  });
}

/**
 * Hook to fetch host health status
 */
export function useHostHealth() {
  return useQuery({
    queryKey: ['host', 'health'],
    queryFn: getHostHealth,
    staleTime: 10_000, // 10 seconds
    refetchInterval: 30_000, // Auto-refresh every 30 seconds
    retry: 1,
  });
}

/**
 * Hook to fetch hardware inventory
 */
export function useHardwareInventory() {
  return useQuery({
    queryKey: ['host', 'hardware'],
    queryFn: getHardwareInventory,
    staleTime: 60_000, // 1 minute
  });
}
