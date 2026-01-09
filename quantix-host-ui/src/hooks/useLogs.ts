import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useRef } from 'react';
import { getLogs, streamLogs, type LogsParams, type LogEntry } from '@/api/logs';

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
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const maxLogs = 1000; // Keep last 1000 streamed logs in memory
  
  const connect = useCallback(() => {
    if (!enabled) return;
    
    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    cleanupRef.current = streamLogs(
      (log) => {
        setLogs((prev) => {
          const newLogs = [...prev, log];
          // Keep only the last maxLogs entries
          if (newLogs.length > maxLogs) {
            return newLogs.slice(-maxLogs);
          }
          return newLogs;
        });
      },
      () => {
        setError('Connection error');
        setIsConnected(false);
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      },
      () => {
        setIsConnected(true);
        setError(null);
      },
      () => {
        setIsConnected(false);
        // Attempt to reconnect after 3 seconds
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      }
    );
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
