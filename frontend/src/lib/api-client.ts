/**
 * limiquantix API Client
 * 
 * This module provides HTTP client for communicating with the limiquantix backend.
 * Uses simple fetch-based approach for compatibility.
 * 
 * The client supports:
 * - REST-style HTTP calls (Connect-RPC is HTTP-compatible)
 * - Automatic retry with exponential backoff
 * - Request/response logging
 */

// Configuration
// In production, use relative URLs (same origin as the frontend)
// In development, use VITE_API_URL or localhost:8080
function getDefaultBaseUrl(): string {
  // If explicitly set, use that
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // In production (served by nginx), use same origin
  if (import.meta.env.PROD || window.location.hostname !== 'localhost') {
    return window.location.origin;
  }
  // Development fallback
  return 'http://localhost:8080';
}

export const API_CONFIG = {
  baseUrl: getDefaultBaseUrl(),
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
};

// Auth token storage
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

/**
 * Convert camelCase keys to snake_case for proto JSON compatibility.
 * Go's proto3 JSON uses snake_case by default, but TypeScript uses camelCase.
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function convertKeysToSnakeCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => convertKeysToSnakeCase(item));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const snakeKey = toSnakeCase(key);
      result[snakeKey] = convertKeysToSnakeCase(value);
    }
    return result;
  }
  
  return obj;
}

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Get the API base URL for direct HTTP calls
 */
export function getApiBase(): string {
  return API_CONFIG.baseUrl;
}

// Connection status
export interface ConnectionState {
  state: 'connected' | 'connecting' | 'error' | 'disconnected';
  isConnected: boolean;
  lastCheck: number;
  lastError?: string;
  error?: string;
}

// Type alias for backwards compatibility
export type ConnectionStatus = ConnectionState;

let connectionState: ConnectionState = {
  state: 'disconnected',
  isConnected: false,
  lastCheck: 0,
};

// Subscribers for connection status changes
const connectionSubscribers: Set<(status: ConnectionState) => void> = new Set();

/**
 * Subscribe to connection status changes
 */
export function subscribeToConnectionStatus(callback: (status: ConnectionState) => void): () => void {
  connectionSubscribers.add(callback);
  // Call immediately with current state
  callback(connectionState);
  return () => connectionSubscribers.delete(callback);
}

function notifyConnectionSubscribers() {
  connectionSubscribers.forEach(callback => callback(connectionState));
}

/**
 * Check if the backend is reachable
 */
export async function checkConnection(): Promise<boolean> {
  connectionState = { ...connectionState, state: 'connecting' };
  notifyConnectionSubscribers();
  
  try {
    const response = await fetch(`${API_CONFIG.baseUrl}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    connectionState = {
      state: response.ok ? 'connected' : 'error',
      isConnected: response.ok,
      lastCheck: Date.now(),
      error: response.ok ? undefined : `Status: ${response.status}`,
      lastError: response.ok ? undefined : `Status: ${response.status}`,
    };
    notifyConnectionSubscribers();
    
    return response.ok;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    connectionState = {
      state: 'error',
      isConnected: false,
      lastCheck: Date.now(),
      error: errorMsg,
      lastError: errorMsg,
    };
    notifyConnectionSubscribers();
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
      
      // Convert camelCase keys to snake_case for Go proto compatibility
      const snakeCaseBody = body ? convertKeysToSnakeCase(body) : {};
      
      // Debug logging for VM creation
      if (method === 'CreateVM') {
        console.log('[API] CreateVM request body (snake_case):', JSON.stringify(snakeCaseBody, null, 2));
      }
      
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(snakeCaseBody),
        signal: AbortSignal.timeout(timeout),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      
      // Update connection state on success
      connectionState = {
        state: 'connected',
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
    state: 'error',
    isConnected: false,
    lastCheck: Date.now(),
    error: lastError?.message,
    lastError: lastError?.message,
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

export interface ApiVMEvent {
  id: string;
  vmId: string;
  type: string;       // power, config, snapshot, disk, network, error
  message: string;
  user?: string;
  severity: string;   // info, warning, error
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface ApiVM {
  id: string;
  name: string;
  projectId: string;
  folderId?: string;  // ID of the folder this VM belongs to
  description?: string;
  labels?: Record<string, string>;
  spec?: {
    cpu?: { 
      cores?: number;
      sockets?: number;
    };
    memory?: { sizeMib?: number };
    disks?: Array<{ 
      sizeGib?: number;
      name?: string;
      backingFile?: string;  // Cloud image path for copy-on-write
    }>;
    nics?: Array<{
      networkId?: string;
      connected?: boolean;
    }>;
    // Provisioning configuration (cloud-init, ignition, sysprep)
    provisioning?: {
      cloudInit?: {
        userData?: string;    // #cloud-config YAML
        metaData?: string;    // instance-id, hostname
        networkConfig?: string;  // Netplan v2 (optional)
        vendorData?: string;  // vendor-specific data (optional)
      };
    };
    // Boot configuration
    boot?: {
      order?: string[];      // Boot device order: 'disk', 'cdrom', 'network'
      firmware?: string;     // 'BIOS' or 'UEFI'
      secureBoot?: boolean;  // UEFI secure boot enabled
    };
    // Display/console settings
    display?: {
      type?: string;         // 'VNC' or 'SPICE'
      port?: number;         // Console port (auto if not set)
      password?: string;     // Console password
      listen?: string;       // Listen address (e.g., '0.0.0.0')
      clipboard?: boolean;   // Clipboard sharing (SPICE)
      audio?: boolean;       // Audio passthrough (SPICE)
    };
    // High Availability policy
    ha?: {
      enabled?: boolean;
      restartPriority?: string;      // 'highest', 'high', 'medium', 'low', 'lowest'
      isolationResponse?: string;    // 'none', 'shutdown', 'powerOff'
      vmMonitoring?: string;         // 'disabled', 'vmMonitoringOnly', 'vmAndAppMonitoring'
      maxRestarts?: number;
      restartPeriodMinutes?: number;
    };
    // Guest Agent configuration
    guestAgent?: {
      communication?: string;        // 'virtio-serial' or 'vsock'
      freezeOnSnapshot?: boolean;    // Quiesce filesystem before snapshot
      timeSync?: boolean;            // Sync guest time with host
    };
    // Cloud-Init configuration
    cloudInit?: {
      hostname?: string;
      sshKeys?: string[];
      userData?: string;             // #cloud-config YAML
      networkConfig?: string;        // 'dhcp', 'static', 'custom'
    };
    // Advanced VM options
    advanced?: {
      hardwareVersion?: string;      // 'v5', 'v6', 'v7'
      machineType?: string;          // 'q35', 'i440fx', 'virt'
      rtcBase?: string;              // 'utc', 'localtime'
      watchdog?: string;             // 'none', 'i6300esb', 'ib700', 'diag288'
      rngEnabled?: boolean;          // virtio-rng device
    };
    // CD-ROM devices
    cdroms?: Array<{
      id?: string;
      name?: string;
      isoPath?: string;              // Path to mounted ISO
    }>;
  };
  status?: {
    state?: string;
    powerState?: string;
    nodeId?: string;
    ipAddresses?: string[];
    resourceUsage?: {
      cpuPercent?: number;
      cpuUsagePercent?: number;
      memoryPercent?: number;
      memoryUsedMib?: number;
      memoryBytes?: number;
      diskReadBytesPerSec?: number;
      diskWriteBytesPerSec?: number;
      networkRxBytesPerSec?: number;
      networkTxBytesPerSec?: number;
    };
    guestInfo?: {
      agentVersion?: string;
      hostname?: string;
      osName?: string;
      osVersion?: string;
    };
  };
  createdAt?: string;
  updatedAt?: string;
}

export const vmApi = {
  async list(params?: VMListRequest): Promise<VMListResponse> {
    return apiCall<VMListResponse>(
      'limiquantix.compute.v1.VMService',
      'ListVMs',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
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
      'limiquantix.compute.v1.VMService',
      'StartVM',
      { id }
    );
  },
  
  async stop(id: string, force?: boolean): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'StopVM',
      { id, force }
    );
  },
  
  async reboot(id: string, force?: boolean): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'RebootVM',
      { id, force }
    );
  },
  
  async pause(id: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'PauseVM',
      { id }
    );
  },
  
  async resume(id: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'ResumeVM',
      { id }
    );
  },
  
  async suspend(id: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'SuspendVM',
      { id }
    );
  },

  async clone(data: {
    sourceVmId: string;
    name: string;
    projectId?: string;
    cloneType?: 'FULL' | 'LINKED';
    startOnCreate?: boolean;
  }): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'CloneVM',
      {
        sourceVmId: data.sourceVmId,
        name: data.name,
        projectId: data.projectId,
        cloneType: data.cloneType === 'LINKED' ? 1 : 0, // FULL=0, LINKED=1 (proto enum)
        startOnCreate: data.startOnCreate,
      }
    );
  },

  // Disk operations
  async attachDisk(vmId: string, disk: {
    sizeGib: number;
    bus: string;
    format?: string;
  }): Promise<ApiVM> {
    // Map bus string to proto enum
    const busMap: Record<string, number> = {
      'virtio': 0, 'VIRTIO': 0,
      'scsi': 1, 'SCSI': 1,
      'sata': 2, 'SATA': 2,
      'ide': 3, 'IDE': 3,
    };
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'AttachDisk',
      {
        vmId,
        disk: {
          sizeGib: disk.sizeGib,
          bus: busMap[disk.bus] ?? 0,
        },
      }
    );
  },

  async detachDisk(vmId: string, diskId: string, force?: boolean): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'DetachDisk',
      { vmId, diskId, force: force ?? false }
    );
  },

  async resizeDisk(vmId: string, diskId: string, newSizeGib: number): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'ResizeDisk',
      { vmId, diskId, newSizeGib }
    );
  },

  // NIC operations
  async attachNIC(vmId: string, nic: {
    networkId: string;
    macAddress?: string;
    model?: string;
  }): Promise<ApiVM> {
    // Map model string to proto enum
    const modelMap: Record<string, number> = {
      'virtio': 0, 'VIRTIO': 0,
      'e1000': 1, 'E1000': 1,
      'rtl8139': 2, 'RTL8139': 2,
    };
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'AttachNIC',
      {
        vmId,
        nic: {
          networkId: nic.networkId,
          macAddress: nic.macAddress,
          model: modelMap[nic.model || 'virtio'] ?? 0,
        },
      }
    );
  },

  async detachNIC(vmId: string, nicId: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'DetachNIC',
      { vmId, nicId }
    );
  },

  // CD-ROM operations
  async attachCDROM(vmId: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'AttachCDROM',
      { vmId }
    );
  },

  async detachCDROM(vmId: string, cdromId: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'DetachCDROM',
      { vmId, cdromId }
    );
  },

  async mountISO(vmId: string, cdromId: string, isoPath: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'MountISO',
      { vmId, cdromId, isoPath }
    );
  },

  async ejectISO(vmId: string, cdromId: string): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'EjectISO',
      { vmId, cdromId }
    );
  },

  // Events
  async listEvents(vmId: string, options?: {
    type?: string;
    severity?: string;
    limit?: number;
    since?: string;
  }): Promise<{ events: ApiVMEvent[] }> {
    return apiCall<{ events: ApiVMEvent[] }>(
      'limiquantix.compute.v1.VMService',
      'ListVMEvents',
      { vmId, ...options }
    );
  },

  // Agent operations
  async pingAgent(vmId: string): Promise<{
    connected: boolean;
    version?: string;
    uptimeSeconds?: number;
    error?: string;
  }> {
    return apiCall<{
      connected: boolean;
      version?: string;
      uptimeSeconds?: number;
      error?: string;
    }>(
      'limiquantix.compute.v1.VMService',
      'PingAgent',
      { vmId }
    );
  },
  
  async delete(id: string, options?: { 
    force?: boolean;
    deleteVolumes?: boolean;
    removeFromInventoryOnly?: boolean;
  }): Promise<void> {
    await apiCall<void>(
      'limiquantix.compute.v1.VMService',
      'DeleteVM',
      { 
        id, 
        force: options?.force,
        deleteVolumes: options?.deleteVolumes ?? true, // Default to true for full deletion
        removeFromInventoryOnly: options?.removeFromInventoryOnly ?? false,
      }
    );
  },
  
  async update(data: {
    id: string;
    name?: string;
    description?: string;
    labels?: Record<string, string>;
    spec?: ApiVM['spec'];
  }): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'UpdateVM',
      data
    );
  },

  // Snapshot operations
  async createSnapshot(data: {
    vmId: string;
    name: string;
    description?: string;
    includeMemory?: boolean;
    quiesce?: boolean;
  }): Promise<ApiSnapshot> {
    return apiCall<ApiSnapshot>(
      'limiquantix.compute.v1.VMService',
      'CreateSnapshot',
      data
    );
  },

  async listSnapshots(vmId: string): Promise<ListSnapshotsResponse> {
    return apiCall<ListSnapshotsResponse>(
      'limiquantix.compute.v1.VMService',
      'ListSnapshots',
      { vmId }
    );
  },

  async revertToSnapshot(vmId: string, snapshotId: string, startAfterRevert?: boolean): Promise<ApiVM> {
    return apiCall<ApiVM>(
      'limiquantix.compute.v1.VMService',
      'RevertToSnapshot',
      { vmId, snapshotId, startAfterRevert }
    );
  },

  async deleteSnapshot(vmId: string, snapshotId: string): Promise<void> {
    await apiCall<void>(
      'limiquantix.compute.v1.VMService',
      'DeleteSnapshot',
      { vmId, snapshotId }
    );
  },
};

// =============================================================================
// Snapshot Types
// =============================================================================

export interface ApiSnapshot {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  memoryIncluded?: boolean;
  quiesced?: boolean;
  createdAt?: string;
  sizeBytes?: number;
}

export interface ListSnapshotsResponse {
  snapshots: ApiSnapshot[];
}

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
  clusterId?: string; // ID of the cluster this node belongs to (if any)
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
      'limiquantix.compute.v1.NodeService',
      'ListNodes',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiNode> {
    return apiCall<ApiNode>(
      'limiquantix.compute.v1.NodeService',
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
      'limiquantix.compute.v1.NodeService',
      'GetNodeMetrics',
      { nodeId }
    );
  },

  async delete(id: string, force = false): Promise<void> {
    return apiCall(
      'limiquantix.compute.v1.NodeService',
      'DecommissionNode',
      { id, force }
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
      'limiquantix.network.v1.VirtualNetworkService',
      'ListNetworks',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiVirtualNetwork> {
    return apiCall<ApiVirtualNetwork>(
      'limiquantix.network.v1.VirtualNetworkService',
      'GetNetwork',
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
      'limiquantix.network.v1.VirtualNetworkService',
      'CreateNetwork',
      data
    );
  },
  
  async update(data: {
    id: string;
    name?: string;
    description?: string;
    spec?: ApiVirtualNetwork['spec'];
  }): Promise<ApiVirtualNetwork> {
    return apiCall<ApiVirtualNetwork>(
      'limiquantix.network.v1.VirtualNetworkService',
      'UpdateNetwork',
      data
    );
  },
  
  async delete(id: string): Promise<void> {
    await apiCall<void>(
      'limiquantix.network.v1.VirtualNetworkService',
      'DeleteNetwork',
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
      'limiquantix.network.v1.SecurityGroupService',
      'ListSecurityGroups',
      params || {}
    );
  },
  
  async get(id: string): Promise<ApiSecurityGroup> {
    return apiCall<ApiSecurityGroup>(
      'limiquantix.network.v1.SecurityGroupService',
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
      'limiquantix.network.v1.SecurityGroupService',
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
      'limiquantix.network.v1.SecurityGroupService',
      'AddRule',
      { securityGroupId, rule }
    );
  },
  
  async removeRule(securityGroupId: string, ruleId: string): Promise<ApiSecurityGroup> {
    return apiCall<ApiSecurityGroup>(
      'limiquantix.network.v1.SecurityGroupService',
      'RemoveRule',
      { securityGroupId, ruleId }
    );
  },
  
  async delete(id: string): Promise<void> {
    await apiCall<void>(
      'limiquantix.network.v1.SecurityGroupService',
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

// =============================================================================
// Registration Token API
// =============================================================================

export interface ApiRegistrationToken {
  id: string;
  token: string;
  description?: string;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  usedByNodes?: string[];
  isValid: boolean;
  createdAt: string;
  createdBy?: string;
  revokedAt?: string | null;
}

export interface RegistrationTokenListResponse {
  tokens: ApiRegistrationToken[];
  totalCount: number;
}

export interface CreateTokenRequest {
  description?: string;
  expiresInHours?: number;
  maxUses?: number;
}

export const registrationTokenApi = {
  async list(includeExpired = false): Promise<RegistrationTokenListResponse> {
    const url = `${API_CONFIG.baseUrl}/api/admin/registration-tokens${includeExpired ? '?include_expired=true' : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to list registration tokens: ${response.status}`);
    }
    
    return response.json();
  },
  
  async create(data: CreateTokenRequest = {}): Promise<ApiRegistrationToken> {
    const url = `${API_CONFIG.baseUrl}/api/admin/registration-tokens`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        description: data.description,
        expires_in_hours: data.expiresInHours,
        max_uses: data.maxUses,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create registration token: ${response.status}`);
    }
    
    return response.json();
  },
  
  async get(id: string): Promise<ApiRegistrationToken> {
    const url = `${API_CONFIG.baseUrl}/api/admin/registration-tokens/${id}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get registration token: ${response.status}`);
    }
    
    return response.json();
  },
  
  async revoke(id: string): Promise<ApiRegistrationToken> {
    const url = `${API_CONFIG.baseUrl}/api/admin/registration-tokens/${id}/revoke`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to revoke registration token: ${response.status}`);
    }
    
    return response.json();
  },
  
  async delete(id: string): Promise<void> {
    const url = `${API_CONFIG.baseUrl}/api/admin/registration-tokens/${id}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to delete registration token: ${response.status}`);
    }
  },
};

// Export for backwards compatibility
export function getTransport() {
  // This is a stub for code that imports getTransport
  // Real API calls use the vmApi/nodeApi objects above
  // Note: This function is deprecated - use vmApi/nodeApi instead
  return null;
}
