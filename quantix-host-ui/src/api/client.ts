/**
 * API Client for Quantix-OS Node Daemon
 * 
 * This client communicates with the node daemon's REST API gateway.
 * The gateway proxies requests to the underlying gRPC service.
 * 
 * For development, you can connect to a remote node daemon by setting
 * the node URL in the Settings page or via localStorage.
 */

// Storage key for remote node configuration
const STORAGE_KEY = 'quantix-node-connection';

interface NodeConnection {
  url: string;  // e.g., "https://192.168.1.101:8443"
  name?: string;
  connected?: boolean;
  lastConnected?: string;
}

/**
 * Get the current node connection configuration
 */
export function getNodeConnection(): NodeConnection | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to parse node connection config:', e);
  }
  return null;
}

/**
 * Set the node connection configuration
 */
export function setNodeConnection(connection: NodeConnection | null): void {
  if (connection) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  // Dispatch event so components can react to connection changes
  window.dispatchEvent(new CustomEvent('node-connection-changed', { detail: connection }));
}

/**
 * Check if we're connected to a remote node
 */
export function isRemoteConnection(): boolean {
  return getNodeConnection() !== null;
}

/**
 * Get the API base URL - either local proxy or remote node
 */
function getApiBase(): string {
  const connection = getNodeConnection();
  if (connection?.url) {
    // Remote node - use full URL
    return `${connection.url.replace(/\/$/, '')}/api/v1`;
  }
  // Local - use relative URL (goes through vite proxy)
  return '/api/v1';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}: ${response.statusText}`;
    let details: unknown;
    
    try {
      const errorData = await response.json();
      message = errorData.message || errorData.error || message;
      details = errorData;
    } catch {
      // Response wasn't JSON
    }
    
    throw new ApiError(message, response.status, details);
  }
  
  // Handle empty responses (204 No Content)
  if (response.status === 204) {
    return {} as T;
  }
  
  return response.json();
}

export async function get<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${getApiBase()}${endpoint}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });
  return handleResponse<T>(response);
}

export async function post<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${endpoint}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function put<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${endpoint}`, {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function patch<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${getApiBase()}${endpoint}`, {
    method: 'PATCH',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function del<T = void>(endpoint: string): Promise<T> {
  const response = await fetch(`${getApiBase()}${endpoint}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
    },
  });
  return handleResponse<T>(response);
}

/**
 * Test connection to a node daemon
 */
export async function testNodeConnection(url: string): Promise<{ success: boolean; message: string; info?: unknown }> {
  try {
    const baseUrl = url.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/v1/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: `Connected to ${data.hostname || 'node'}`,
        info: data,
      };
    } else {
      return {
        success: false,
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}
