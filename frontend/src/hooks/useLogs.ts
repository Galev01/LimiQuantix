import { useQuery } from '@tanstack/react-query';

/**
 * Log entry from the system
 */
export interface LogEntry {
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  fields?: Record<string, unknown>;
  stackTrace?: string;
  requestId?: string;
  vmId?: string;
  nodeId?: string;
  durationMs?: number;
}

/**
 * Response from logs endpoint
 */
export interface LogsResponse {
  logs: LogEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * Parameters for fetching logs
 */
export interface LogsParams {
  level?: string;
  source?: string;
  search?: string;
  limit?: number;
  offset?: number;
  since?: string;
  until?: string;
}

/**
 * Fetch logs from the backend
 */
async function getLogs(params?: LogsParams): Promise<LogsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.level) searchParams.set('level', params.level);
  if (params?.source) searchParams.set('source', params.source);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());
  if (params?.since) searchParams.set('since', params.since);
  if (params?.until) searchParams.set('until', params.until);
  
  const query = searchParams.toString();
  
  try {
    const response = await fetch(`/api/logs${query ? `?${query}` : ''}`);
    
    if (!response.ok) {
      if (response.status === 404) {
        // Backend might not be running - return empty logs
        console.warn('Logs API not available. Is the backend running on port 8080?');
        return { logs: [], total: 0, hasMore: false };
      }
      throw new Error(`Failed to fetch logs: ${response.status}`);
    }
    
    return response.json();
  } catch (error) {
    // Network error - backend probably not running
    console.warn('Failed to connect to logs API. Ensure backend is running on port 8080.');
    return { logs: [], total: 0, hasMore: false };
  }
}

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
