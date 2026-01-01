/**
 * LimiQuantix API Client
 * 
 * This module provides the Connect-ES client setup for communicating with
 * the LimiQuantix backend gRPC services.
 * 
 * The client supports:
 * - Unary RPC calls (request/response)
 * - Server streaming for real-time updates
 * - Automatic reconnection on failure
 * - Request/response interceptors for auth and logging
 */

import { createClient, Transport, Interceptor, type Client } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';

// Configuration
const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8080',
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
};

// Auth token storage (in production, use a more secure method)
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

// Logging interceptor
const loggingInterceptor: Interceptor = (next) => async (req) => {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  
  console.debug(`[API] Request ${requestId}:`, {
    method: req.method.name,
    service: req.service.typeName,
    timestamp: new Date().toISOString(),
  });

  try {
    const response = await next(req);
    const duration = Date.now() - startTime;
    
    console.debug(`[API] Response ${requestId}:`, {
      duration: `${duration}ms`,
      success: true,
    });
    
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    console.error(`[API] Error ${requestId}:`, {
      duration: `${duration}ms`,
      error,
    });
    
    throw error;
  }
};

// Auth interceptor
const authInterceptor: Interceptor = (next) => async (req) => {
  if (authToken) {
    req.header.set('Authorization', `Bearer ${authToken}`);
  }
  
  // Add request ID for tracing
  req.header.set('X-Request-ID', crypto.randomUUID());
  
  return next(req);
};

// Create the transport with interceptors
function createApiTransport(): Transport {
  return createConnectTransport({
    baseUrl: API_CONFIG.baseUrl,
    interceptors: [loggingInterceptor, authInterceptor],
  });
}

// Singleton transport instance
let transport: Transport | null = null;

export function getTransport(): Transport {
  if (!transport) {
    transport = createApiTransport();
  }
  return transport;
}

// Generic client factory
export function createApiClient<T extends object>(service: { new(): T }): Client<T> {
  return createClient(service, getTransport());
}

// Connection state management
type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error';

interface ConnectionStatus {
  state: ConnectionState;
  lastConnected: Date | null;
  lastError: Error | null;
  retryCount: number;
}

let connectionStatus: ConnectionStatus = {
  state: 'disconnected',
  lastConnected: null,
  lastError: null,
  retryCount: 0,
};

const connectionListeners: Set<(status: ConnectionStatus) => void> = new Set();

export function getConnectionStatus(): ConnectionStatus {
  return { ...connectionStatus };
}

export function subscribeToConnectionStatus(
  listener: (status: ConnectionStatus) => void,
): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

function updateConnectionStatus(update: Partial<ConnectionStatus>) {
  connectionStatus = { ...connectionStatus, ...update };
  connectionListeners.forEach((listener) => listener(connectionStatus));
}

// Health check function
export async function checkConnection(): Promise<boolean> {
  try {
    updateConnectionStatus({ state: 'connecting' });
    
    // In a real implementation, this would call a health check endpoint
    // For now, we simulate a connection check
    const response = await fetch(`${API_CONFIG.baseUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (response.ok) {
      updateConnectionStatus({
        state: 'connected',
        lastConnected: new Date(),
        lastError: null,
        retryCount: 0,
      });
      return true;
    }
    
    throw new Error(`Health check failed: ${response.status}`);
  } catch (error) {
    updateConnectionStatus({
      state: 'error',
      lastError: error as Error,
      retryCount: connectionStatus.retryCount + 1,
    });
    return false;
  }
}

// Retry logic for failed requests
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delay?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {},
): Promise<T> {
  const { maxAttempts = API_CONFIG.retryAttempts, delay = API_CONFIG.retryDelay, onRetry } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < maxAttempts) {
        onRetry?.(attempt, lastError);
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }
  
  throw lastError;
}

// Real-time subscription helper
export interface StreamSubscription<T> {
  subscribe: (callback: (data: T) => void) => void;
  unsubscribe: () => void;
}

export function createStreamSubscription<T>(
  streamFn: () => AsyncIterable<T>,
): StreamSubscription<T> {
  let abortController: AbortController | null = null;
  let isActive = false;
  let callback: ((data: T) => void) | null = null;

  async function startStream() {
    if (!callback || isActive) return;
    
    isActive = true;
    abortController = new AbortController();

    try {
      for await (const data of streamFn()) {
        if (!isActive) break;
        callback(data);
      }
    } catch (error) {
      if (isActive) {
        console.error('[API] Stream error:', error);
        // Attempt to reconnect after a delay
        setTimeout(() => {
          if (isActive) startStream();
        }, 5000);
      }
    }
  }

  return {
    subscribe: (cb) => {
      callback = cb;
      startStream();
    },
    unsubscribe: () => {
      isActive = false;
      abortController?.abort();
      callback = null;
    },
  };
}

// Export types for use in components
export type { Transport, Interceptor, Client };

// Example usage (commented out as services are not yet generated):
/*
import { VMService } from '@/api/limiquantix/compute/v1/vm_service_connect';

// Create a client
const vmClient = createApiClient(VMService);

// Make a unary call
const vm = await vmClient.getVM({ id: 'vm-123' });

// Stream updates
const subscription = createStreamSubscription(() => vmClient.watchVM({ vmId: 'vm-123' }));
subscription.subscribe((update) => {
  console.log('VM updated:', update);
});

// Later, unsubscribe
subscription.unsubscribe();
*/

