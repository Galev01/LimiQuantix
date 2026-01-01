import { useState, useEffect, useCallback } from 'react';
import {
  getConnectionStatus,
  subscribeToConnectionStatus,
  checkConnection,
  type ConnectionStatus,
} from '@/lib/api-client';

/**
 * Hook for monitoring API connection status
 * 
 * Returns the current connection state and provides
 * a function to manually trigger a connection check.
 */
export function useApiConnection() {
  const [status, setStatus] = useState<ConnectionStatus>(getConnectionStatus);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    // Subscribe to connection status changes
    const unsubscribe = subscribeToConnectionStatus(setStatus);

    // Initial connection check
    checkConnection();

    // Periodic health checks (every 30 seconds)
    const intervalId = setInterval(() => {
      checkConnection();
    }, 30000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
    };
  }, []);

  const reconnect = useCallback(async () => {
    setIsChecking(true);
    try {
      await checkConnection();
    } finally {
      setIsChecking(false);
    }
  }, []);

  return {
    status,
    isConnected: status.state === 'connected',
    isConnecting: status.state === 'connecting' || isChecking,
    hasError: status.state === 'error',
    lastError: status.lastError,
    reconnect,
  };
}

/**
 * Hook for real-time data streaming
 * 
 * Automatically handles subscription lifecycle and
 * provides loading/error states.
 */
export function useStream<T>(
  streamFn: () => AsyncIterable<T>,
  options: {
    enabled?: boolean;
    onData?: (data: T) => void;
    onError?: (error: Error) => void;
  } = {},
) {
  const { enabled = true, onData, onError } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let isActive = true;
    setIsStreaming(true);
    setError(null);

    async function startStream() {
      try {
        for await (const item of streamFn()) {
          if (!isActive) break;
          setData(item);
          onData?.(item);
        }
      } catch (err) {
        if (isActive) {
          const error = err as Error;
          setError(error);
          onError?.(error);
        }
      } finally {
        if (isActive) {
          setIsStreaming(false);
        }
      }
    }

    startStream();

    return () => {
      isActive = false;
      setIsStreaming(false);
    };
  }, [enabled, streamFn, onData, onError]);

  return {
    data,
    error,
    isStreaming,
  };
}

