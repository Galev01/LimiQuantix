/**
 * API Client for Quantix-OS Node Daemon
 * 
 * This client communicates with the node daemon's REST API gateway.
 * The gateway proxies requests to the underlying gRPC service.
 */

const API_BASE = '/api/v1';

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
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });
  return handleResponse<T>(response);
}

export async function post<T>(endpoint: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
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
  const response = await fetch(`${API_BASE}${endpoint}`, {
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
  const response = await fetch(`${API_BASE}${endpoint}`, {
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
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/json',
    },
  });
  return handleResponse<T>(response);
}
