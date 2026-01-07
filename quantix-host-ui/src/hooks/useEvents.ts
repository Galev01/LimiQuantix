import { useQuery } from '@tanstack/react-query';
import { listEvents } from '@/api/events';

/**
 * Hook to fetch system events
 */
export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: listEvents,
    staleTime: 10_000, // 10 seconds
    refetchInterval: 30_000, // Auto-refresh every 30 seconds
  });
}
