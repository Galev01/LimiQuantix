import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef } from 'react';

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
  const response = await fetch(`/api/logs${query ? `?${query}` : ''}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch logs');
  }
  
  return response.json();
}

/**
 * Hook to fetch logs with filtering
 */
export function useLogs(params?: LogsParams) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => getLogs(params),
    refetchInterval: params ? false : 5000, // Auto-refresh if no filters
    staleTime: 2000,
  });
}

/**
 * Hook to stream logs in real-time via WebSocket
 */
export function useLogStream(enabled: boolean = true) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxLogs = 1000; // Keep last 1000 streamed logs in memory
  
  const connect = useCallback(() => {
    if (!enabled) return;
    
    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/logs/stream`);
    
    ws.onopen = () => {
      console.log('Log stream connected');
      setIsConnected(true);
      setError(null);
    };
    
    ws.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data) as LogEntry;
        setLogs((prev) => {
          const newLogs = [...prev, log];
          // Keep only the last maxLogs entries
          if (newLogs.length > maxLogs) {
            return newLogs.slice(-maxLogs);
          }
          return newLogs;
        });
      } catch (e) {
        console.error('Failed to parse log entry:', e);
      }
    };
    
    ws.onerror = () => {
      setError('Connection error');
      setIsConnected(false);
    };
    
    ws.onclose = () => {
      console.log('Log stream disconnected');
      setIsConnected(false);
      // Attempt to reconnect after 3 seconds
      if (enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      }
    };
    
    cleanupRef.current = () => {
      ws.close();
    };
  }, [enabled]);
  
  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [enabled, connect]);
  
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);
  
  return {
    logs,
    isConnected,
    error,
    clearLogs,
  };
}
