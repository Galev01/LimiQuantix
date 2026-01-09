import { useQuery } from '@tanstack/react-query';
import { getLogs, type LogsParams, type LogEntry } from '@/api/logs';

/**
 * Hook to fetch logs with filtering
 */
export function useLogs(params?: LogsParams) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => getLogs(params),
    refetchInterval: 3000, // Poll every 3 seconds for live updates
    staleTime: 1000,
  });
}

/**
 * Hook to stream logs in real-time via WebSocket
 * NOTE: WebSocket streaming is disabled until the backend endpoint is implemented.
 * For now, we use polling via useLogs instead.
 */
export function useLogStream(_enabled: boolean = true) {
  // WebSocket streaming disabled - endpoint not yet implemented
  // Return stub values to prevent connection errors
  return {
    logs: [] as LogEntry[],
    isConnected: false,
    error: null as string | null,
    clearLogs: () => {},
  };
}
