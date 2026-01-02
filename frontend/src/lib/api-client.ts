/**
 * Quantixkvm API Client
 * 
 * This module provides HTTP client for communicating with the Quantixkvm backend.
 * Uses simple fetch-based approach for compatibility.
 * 
 * The client supports:
 * - REST-style HTTP calls (Connect-RPC is HTTP-compatible)
 * - Automatic retry with exponential backoff
 * - Request/response logging
 */

// Configuration
const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8080',
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
};

// Auth token storage
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

// Connection status
interface ConnectionState {
  isConnected: boolean;
  lastCheck: number;
  error?: string;
}

let connectionState: ConnectionState = {
  isConnected: false,
  lastCheck: 0,
};

/**
 * Check if the backend is reachable
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    connectionState = {
      isConnected: response.ok,
      lastCheck: Date.now(),
      error: response.ok ? undefined : `Status: ${response.status}`,
    };
    
    return response.ok;
  } catch (error) {
    connectionState = {
      isConnected: false,
      lastCheck: Date.now(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return false;
  }
}

export function getConnectionStatus(): ConnectionState {
  return connectionState;
}

/**
 * Generic API call helper
 */
async function apiCall<T>(
  service: string,
  method: string,
  body?: unknown,
  options?: { timeout?: number; retries?: number }
): Promise<T> {
  const url = `${API_CONFIG.baseUrl}/${service}/${method}`;
  const timeout = options?.timeout ?? API_CONFIG.timeout;
  const maxRetries = options?.retries ?? API_CONFIG.retryAttempts;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : '{}',
        signal: AbortSignal.timeout(timeout),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Update connection state on success
      connectionState = {
        isConnected: true,
        lastCheck: Date.now(),
      };
      
      return data as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on 4xx errors
      if (lastError.message.includes('API Error 4')) {
        throw lastError;
      }
      
      // Wait before retry with exponential backoff
      if (attempt < maxRetries) {
        await new Promise(resolve => 
          setTimeout(resolve, API_CONFIG.retryDelay * Math.pow(2, attempt))
        );
      }
    }
  }
  
  // Update connection state on failure
  connectionState = {
    isConnected: false,
    lastCheck: Date.now(),
    error: lastError?.message,
  };
  
  throw lastError;
}

// =============================================================================
// VM Service API
// =============================================================================

export interface VMListRequest {
  projectId?: string;
  nodeId?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface VMListResponse {
  vms: ApiVM[];
  nextPageToken?: string;
  totalCount: number;
}

export interface ApiVM {
  id: string;
  name: string;
  projectId: string;
  description?: string;
  labels?: Record<string, string>;
  spec?: {
    cpu?: { 
      cores?: number;
      sockets?: number;
    };
    memory?: { sizeMib?: number };
    disks?: Array<{ 
      sizeMib?: number;
      name?: string;
    }>;
    nics?: Array<{
      networkId?: string;
      connected?: boolean;
    }>;
  };
  status?: {
    state?: string;
    powerState?: string;
    nodeId?: string;
    ipAddresses?: string[];
    resourceUsage?: {
      cpuUsagePercent?: number;
      memoryUsedMib?: number;
    };
  };
  createdAt?: string;
  updatedAt?: string;
}

export const vmApi = {
  async list(params?: VMListRequest): Promise<VMListResponse> {
    return apiCall<VMListResponse>(
      'Quantixkvm.compute.v1.VMService',
      'ListVMs',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'Quantixkvm.compute.v1.VMService',
      'GetVM',
      { id }
    );
  },
  
  async create(data: {
    name: string;
    projectId: string;
    description?: string;
    labels?: Record<string, string>;
    nodeId?: string; // Target host for manual placement
    spec?: ApiVM['spec'];
  }): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'CreateVM',
      data
    );
  },
  
  async start(id: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'Quantixkvm.compute.v1.VMService',
      'StartVM',
      { id }
    );
  },
  
  async stop(id: string, force?: boolean): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'Quantixkvm.compute.v1.VMService',
      'StopVM',
      { id, force }
    );
  },
  
  async delete(id: string, force?: boolean): Promise<void> {
    await apiCall<void>(
      'Quantixkvm.compute.v1.VMService',
      'DeleteVM',
      { id, force }
    );
  },
};

// =============================================================================
// Node Service API
// =============================================================================

export interface NodeListRequest {
  pageSize?: number;
  pageToken?: string;
}

export interface NodeListResponse {
  nodes: ApiNode[];
  nextPageToken?: string;
  totalCount: number;
}

export interface ApiNode {
  id: string;
  hostname: string;
  managementIp: string;
  labels?: Record<string, string>;
  spec?: {
    cpu?: {
      model?: string;
      sockets?: number;
      coresPerSocket?: number;
      threadsPerCore?: number;
    };
    memory?: {
      totalBytes?: number;
      allocatableBytes?: number;
    };
    storage?: Array<{
      path?: string;
      model?: string;
      sizeBytes?: number;
      type?: string; // HDD, SSD, NVME
    }>;
    network?: Array<{
      name?: string;
      macAddress?: string;
      speedMbps?: number;
      mtu?: number;
      sriovCapable?: boolean;
    }>;
  };
  status?: {
    phase?: string;
    conditions?: Array<{
      type?: string;
      status?: boolean;
      message?: string;
    }>;
    resources?: {
      cpu?: {
        allocatableVcpus?: number;
        allocatedVcpus?: number;
      };
      memory?: {
        allocatableBytes?: number;
        allocatedBytes?: number;
      };
    };
    vmIds?: string[];
  };
  createdAt?: string;
  updatedAt?: string;
}

export const nodeApi = {
  async list(params?: NodeListRequest): Promise<NodeListResponse> {
    return apiCall<NodeListResponse>(
      'Quantixkvm.compute.v1.NodeService',
      'ListNodes',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiNode> {
    return apiCall<ApiNode>(
      'Quantixkvm.compute.v1.NodeService',
      'GetNode',
      { id }
    );
  },
  
  async getMetrics(nodeId: string): Promise<{
    cpuUsagePercent: number;
    memoryUsedMib: number;
    memoryTotalMib: number;
  }> {
    return apiCall(
      'Quantixkvm.compute.v1.NodeService',
      'GetNodeMetrics',
      { nodeId }
    );
  },
};

// =============================================================================
// Virtual Network Service API
// =============================================================================

export interface ApiVirtualNetwork {
  id: string;
  name: string;
  projectId: string;
  description?: string;
  spec?: {
    type?: string;
    cidr?: string;
    gateway?: string;
    dhcpEnabled?: boolean;
    dnsServers?: string[];
    vlanId?: number;
  };
  status?: {
    phase?: string;
    availableIps?: number;
    usedIps?: number;
    portCount?: number;
  };
  createdAt?: string;
  updatedAt?: string;
}

export interface NetworkListResponse {
  networks: ApiVirtualNetwork[];
  nextPageToken?: string;
  totalCount: number;
}

export const networkApi = {
  async list(params?: { projectId?: string; pageSize?: number }): Promise<NetworkListResponse> {
    return apiCall<NetworkListResponse>(
      'Quantixkvm.network.v1.VirtualNetworkService',
      'ListVirtualNetworks',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiVirtualNetwork> {
    return apiCall<ApiVirtualNetwork>(
      'Quantixkvm.network.v1.VirtualNetworkService',
      'GetVirtualNetwork',
      { id }
    );
  },
  
  async create(data: {
    name: string;
    projectId: string;
    description?: string;
    spec?: ApiVirtualNetwork['spec'];
  }): Promise<ApiVirtualNetwork> {
    return apiCall<ApiVirtualNetwork>(
      'Quantixkvm.network.v1.VirtualNetworkService',
      'CreateVirtualNetwork',
      data
    );
  },
  
  async delete(id: string): Promise<void> {
    await apiCall<void>(
      'Quantixkvm.network.v1.VirtualNetworkService',
      'DeleteVirtualNetwork',
      { id }
    );
  },
};

// =============================================================================
// Security Group Service API
// =============================================================================

export interface ApiSecurityGroup {
  id: string;
  name: string;
  projectId: string;
  description?: string;
  rules?: Array<{
    id?: string;
    direction?: 'INGRESS' | 'EGRESS';
    protocol?: string;
    portRangeMin?: number;
    portRangeMax?: number;
    remoteIpPrefix?: string;
    remoteGroupId?: string;
  }>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SecurityGroupListResponse {
  securityGroups: ApiSecurityGroup[];
  nextPageToken?: string;
  totalCount: number;
}

export const securityGroupApi = {
  async list(params?: { projectId?: string; pageSize?: number }): Promise<SecurityGroupListResponse> {
    return apiCall<SecurityGroupListResponse>(
      'Quantixkvm.network.v1.SecurityGroupService',
      'ListSecurityGroups',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiSecurityGroup> {
    return apiCall<ApiSecurityGroup>(
      'Quantixkvm.network.v1.SecurityGroupService',
      'GetSecurityGroup',
      { id }
    );
  },
  
  async create(data: {
    name: string;
    projectId: string;
    description?: string;
  }): Promise<ApiSecurityGroup> {
    return apiCall<ApiSecurityGroup>(
      'Quantixkvm.network.v1.SecurityGroupService',
      'CreateSecurityGroup',
      data
    );
  },
  
  async addRule(securityGroupId: string, rule: {
    direction: 'INGRESS' | 'EGRESS';
    protocol: string;
    portRangeMin?: number;
    portRangeMax?: number;
    remoteIpPrefix?: string;
  }): Promise<ApiSecurityGroup> {
    return apiCall<ApiSecurityGroup>(
      'Quantixkvm.network.v1.SecurityGroupService',
      'AddRule',
      { securityGroupId, rule }
    );
  },
  
  async removeRule(securityGroupId: string, ruleId: string): Promise<ApiSecurityGroup> {
    return apiCall<ApiSecurityGroup>(
      'Quantixkvm.network.v1.SecurityGroupService',
      'RemoveRule',
      { securityGroupId, ruleId }
    );
  },
  
  async delete(id: string): Promise<void> {
    await apiCall<void>(
      'Quantixkvm.network.v1.SecurityGroupService',
      'DeleteSecurityGroup',
      { id }
    );
  },
};

// =============================================================================
// Storage Service API (placeholder - not yet in backend)
// =============================================================================

export interface ApiStoragePool {
  id: string;
  name: string;
  type: string;
  status?: {
    phase?: string;
    capacity?: {
      totalBytes?: number;
      usedBytes?: number;
      availableBytes?: number;
    };
  };
  createdAt?: string;
}

export interface StoragePoolListResponse {
  pools: ApiStoragePool[];
  totalCount: number;
}

export const storageApi = {
  async listPools(): Promise<StoragePoolListResponse> {
    // Placeholder - storage service not yet implemented in backend
    // Return empty for now, will use mock data fallback
    throw new Error('Storage service not implemented');
  },
  
  async getPool(id: string): Promise<ApiStoragePool> {
    throw new Error('Storage service not implemented');
  },
};

// =============================================================================
// Alert Service API (placeholder - not yet exposed via HTTP)
// =============================================================================

export interface ApiAlert {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description?: string;
  resource?: string;
  status?: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface AlertListResponse {
  alerts: ApiAlert[];
  totalCount: number;
}

export const alertApi = {
  async list(): Promise<AlertListResponse> {
    // Placeholder - alert service not yet exposed via HTTP
    throw new Error('Alert service not implemented');
  },
  
  async acknowledge(id: string): Promise<ApiAlert> {
    throw new Error('Alert service not implemented');
  },
  
  async resolve(id: string): Promise<ApiAlert> {
    throw new Error('Alert service not implemented');
  },
};

// Export for backwards compatibility
export function getTransport() {
  // This is a stub for code that imports getTransport
  // Real API calls use the vmApi/nodeApi objects above
  console.warn('getTransport() is deprecated. Use vmApi/nodeApi instead.');
  return null;
}
