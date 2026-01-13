/**
 * useNetworkStreaming - Real-time network port status streaming hooks
 * 
 * Provides React hooks for subscribing to live port status updates
 * using Connect-RPC server streaming.
 * 
 * @see docs/Networking/000070-quantumnet-implementation-plan.md
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

type PortPhase = 'PENDING' | 'BUILD' | 'ACTIVE' | 'DOWN' | 'ERROR' | 'DELETED';

interface PortStatusUpdate {
  portId: string;
  networkId: string;
  phase: PortPhase;
  ipAddresses: string[];
  hostId: string;
  vmId: string;
  ovnSyncStatus: 'SYNCING' | 'SYNCED' | 'ERROR';
  timestamp: Date;
}

interface NetworkEvent {
  type: 'created' | 'updated' | 'deleted';
  networkId: string;
  name: string;
  timestamp: Date;
}

interface StreamingState {
  isConnected: boolean;
  isConnecting: boolean;
  error: Error | null;
  lastUpdate: Date | null;
}

// =============================================================================
// PORT STATUS STREAM HOOK
// =============================================================================

interface UsePortStatusStreamOptions {
  enabled?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

interface UsePortStatusStreamResult {
  portStatuses: Map<string, PortStatusUpdate>;
  state: StreamingState;
  reconnect: () => void;
}

/**
 * Hook for subscribing to real-time port status updates for a network.
 */
export function usePortStatusStream(
  networkId: string,
  options: UsePortStatusStreamOptions = {}
): UsePortStatusStreamResult {
  const {
    enabled = true,
    reconnectDelay = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [portStatuses, setPortStatuses] = useState<Map<string, PortStatusUpdate>>(new Map());
  const [state, setState] = useState<StreamingState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastUpdate: null,
  });

  const reconnectAttemptsRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(async () => {
    if (!networkId || !enabled) {
      return;
    }

    // Clean up existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setState(prev => ({ ...prev, isConnecting: true, error: null }));

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
      const response = await fetch(`${apiUrl}/api/v1/networks/${networkId}/ports/watch`, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
        },
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      setState(prev => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
      }));
      reconnectAttemptsRef.current = 0;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const update: PortStatusUpdate = {
                portId: data.id,
                networkId: data.networkId,
                phase: data.status?.phase || 'PENDING',
                ipAddresses: data.status?.ipAddresses || [],
                hostId: data.status?.hostId || '',
                vmId: data.status?.vmId || '',
                ovnSyncStatus: data.status?.ovnPort ? 'SYNCED' : 'SYNCING',
                timestamp: new Date(),
              };

              setPortStatuses(prev => {
                const next = new Map(prev);
                if (update.phase === 'DELETED') {
                  next.delete(update.portId);
                } else {
                  next.set(update.portId, update);
                }
                return next;
              });

              setState(prev => ({ ...prev, lastUpdate: new Date() }));
            } catch (parseError) {
              console.warn('Failed to parse port update:', parseError);
            }
          }
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Port status stream error:', err);

      setState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        error: err,
      }));

      // Attempt reconnection
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, reconnectDelay);
      }
    }
  }, [networkId, enabled, reconnectDelay, maxReconnectAttempts]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    if (enabled && networkId) {
      connect();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect, enabled, networkId]);

  return {
    portStatuses,
    state,
    reconnect,
  };
}

// =============================================================================
// NETWORK EVENTS STREAM HOOK
// =============================================================================

interface UseNetworkEventsOptions {
  enabled?: boolean;
}

interface UseNetworkEventsResult {
  events: NetworkEvent[];
  state: StreamingState;
  clearEvents: () => void;
}

/**
 * Hook for subscribing to network creation/deletion events for a project.
 */
export function useNetworkEvents(
  projectId: string,
  options: UseNetworkEventsOptions = {}
): UseNetworkEventsResult {
  const { enabled = true } = options;

  const [events, setEvents] = useState<NetworkEvent[]>([]);
  const [state, setState] = useState<StreamingState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastUpdate: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    if (!projectId || !enabled) {
      return;
    }

    const connect = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setState(prev => ({ ...prev, isConnecting: true }));

      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
        const response = await fetch(`${apiUrl}/api/v1/projects/${projectId}/networks/events`, {
          method: 'GET',
          headers: {
            'Accept': 'text/event-stream',
          },
          signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        setState(prev => ({
          ...prev,
          isConnected: true,
          isConnecting: false,
        }));

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                const event: NetworkEvent = {
                  type: data.type,
                  networkId: data.networkId,
                  name: data.name,
                  timestamp: new Date(data.timestamp),
                };

                setEvents(prev => [...prev.slice(-99), event]);
                setState(prev => ({ ...prev, lastUpdate: new Date() }));
              } catch {
                // Ignore parse errors
              }
            }
          }
        }
      } catch (error) {
        if (signal.aborted) return;

        setState(prev => ({
          ...prev,
          isConnected: false,
          isConnecting: false,
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      }
    };

    connect();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [projectId, enabled]);

  return {
    events,
    state,
    clearEvents,
  };
}

// =============================================================================
// PORT STATUS POLLING HOOK (FALLBACK)
// =============================================================================

interface UsePortStatusPollingOptions {
  interval?: number;
  enabled?: boolean;
}

/**
 * Fallback hook that polls for port status when streaming is not available.
 */
export function usePortStatusPolling(
  networkId: string,
  options: UsePortStatusPollingOptions = {}
): UsePortStatusStreamResult {
  const { interval = 5000, enabled = true } = options;

  const [portStatuses, setPortStatuses] = useState<Map<string, PortStatusUpdate>>(new Map());
  const [state, setState] = useState<StreamingState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastUpdate: null,
  });

  const fetchPorts = useCallback(async () => {
    if (!networkId) return;

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8080';
      const response = await fetch(`${apiUrl}/api/v1/networks/${networkId}/ports`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const ports = data.ports || [];

      const newStatuses = new Map<string, PortStatusUpdate>();
      for (const port of ports) {
        newStatuses.set(port.id, {
          portId: port.id,
          networkId: port.networkId,
          phase: port.status?.phase || 'PENDING',
          ipAddresses: port.status?.ipAddresses || [],
          hostId: port.status?.hostId || '',
          vmId: port.status?.vmId || '',
          ovnSyncStatus: port.status?.ovnPort ? 'SYNCED' : 'SYNCING',
          timestamp: new Date(),
        });
      }

      setPortStatuses(newStatuses);
      setState(prev => ({
        ...prev,
        isConnected: true,
        lastUpdate: new Date(),
        error: null,
      }));
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error : new Error(String(error)),
      }));
    }
  }, [networkId]);

  const reconnect = useCallback(() => {
    fetchPorts();
  }, [fetchPorts]);

  useEffect(() => {
    if (!enabled || !networkId) return;

    fetchPorts();
    const timer = setInterval(fetchPorts, interval);

    return () => clearInterval(timer);
  }, [enabled, networkId, interval, fetchPorts]);

  return {
    portStatuses,
    state,
    reconnect,
  };
}

// =============================================================================
// COMBINED HOOK WITH AUTOMATIC FALLBACK
// =============================================================================

/**
 * Hook that attempts streaming first, falls back to polling if unavailable.
 */
export function usePortStatus(
  networkId: string,
  options: UsePortStatusStreamOptions & UsePortStatusPollingOptions = {}
): UsePortStatusStreamResult {
  const streamResult = usePortStatusStream(networkId, options);
  const pollingResult = usePortStatusPolling(networkId, {
    ...options,
    enabled: options.enabled && !streamResult.state.isConnected && streamResult.state.error !== null,
  });

  // Use streaming if connected, otherwise use polling
  if (streamResult.state.isConnected) {
    return streamResult;
  }

  return pollingResult;
}

export default usePortStatus;
