import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types matching backend domain model
export interface ClusterStats {
  total_hosts: number;
  online_hosts: number;
  maintenance_hosts: number;
  offline_hosts: number;
  total_vms: number;
  running_vms: number;
  stopped_vms: number;
  cpu_total_ghz: number;
  cpu_used_ghz: number;
  memory_total_bytes: number;
  memory_used_bytes: number;
  storage_total_bytes: number;
  storage_used_bytes: number;
}

export type DRSMode = 'manual' | 'partially_automated' | 'fully_automated';
export type ClusterStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'MAINTENANCE';

export interface Cluster {
  id: string;
  name: string;
  description: string;
  project_id: string;
  labels: Record<string, string>;
  
  // HA settings
  ha_enabled: boolean;
  ha_admission_control: boolean;
  ha_host_monitoring: boolean;
  ha_vm_monitoring: boolean;
  ha_failover_capacity: number;
  ha_restart_priority: number;
  ha_isolation_response: number;
  
  // DRS settings
  drs_enabled: boolean;
  drs_mode: DRSMode;
  drs_migration_threshold: number;
  drs_power_management: boolean;
  drs_predictive_enabled: boolean;
  drs_vm_distribution_policy: string;
  
  // Storage/Network
  shared_storage_required: boolean;
  default_storage_pool_id: string;
  storage_pool_ids: string[];
  default_network_id: string;
  network_ids: string[];
  
  status: ClusterStatus;
  created_at: string;
  updated_at: string;
  
  // Stats (from ClusterWithStats)
  stats: ClusterStats;
}

export interface CreateClusterRequest {
  name: string;
  description?: string;
  project_id?: string;
  labels?: Record<string, string>;
  ha_enabled: boolean;
  ha_admission_control?: boolean;
  ha_failover_capacity?: number;
  drs_enabled: boolean;
  drs_mode?: DRSMode;
  drs_migration_threshold?: number;
  shared_storage_required?: boolean;
  default_storage_pool_id?: string;
  default_network_id?: string;
  // Initial hosts to add to the cluster
  initial_host_ids?: string[];
}

export interface UpdateClusterRequest {
  id: string;
  name?: string;
  description?: string;
  labels?: Record<string, string>;
  ha_enabled?: boolean;
  ha_admission_control?: boolean;
  ha_failover_capacity?: number;
  drs_enabled?: boolean;
  drs_mode?: DRSMode;
  drs_migration_threshold?: number;
  default_storage_pool_id?: string;
  default_network_id?: string;
}

interface ListClustersResponse {
  clusters: Cluster[];
  total: number;
}

const API_BASE = 'http://localhost:8080';

// Query keys
export const clusterKeys = {
  all: ['clusters'] as const,
  lists: () => [...clusterKeys.all, 'list'] as const,
  list: (projectId?: string) => [...clusterKeys.lists(), { projectId }] as const,
  details: () => [...clusterKeys.all, 'detail'] as const,
  detail: (id: string) => [...clusterKeys.details(), id] as const,
  hosts: (id: string) => [...clusterKeys.all, 'hosts', id] as const,
};

// Fetch clusters
async function fetchClusters(projectId?: string): Promise<ListClustersResponse> {
  const url = new URL(`${API_BASE}/api/clusters`);
  if (projectId) {
    url.searchParams.set('project_id', projectId);
  }
  
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Failed to fetch clusters');
  }
  return response.json();
}

// Fetch single cluster
async function fetchCluster(id: string): Promise<Cluster> {
  const response = await fetch(`${API_BASE}/api/clusters/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch cluster');
  }
  return response.json();
}

// Create cluster
async function createCluster(data: CreateClusterRequest): Promise<Cluster> {
  const response = await fetch(`${API_BASE}/api/clusters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create cluster');
  }
  return response.json();
}

// Update cluster
async function updateCluster(data: UpdateClusterRequest): Promise<Cluster> {
  const response = await fetch(`${API_BASE}/api/clusters/${data.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update cluster');
  }
  return response.json();
}

// Delete cluster
async function deleteCluster(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/clusters/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete cluster');
  }
}

// Add host to cluster
async function addHostToCluster(clusterId: string, hostId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/clusters/${clusterId}/hosts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host_id: hostId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add host to cluster');
  }
}

// Remove host from cluster
async function removeHostFromCluster(clusterId: string, hostId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/clusters/${clusterId}/hosts/${hostId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove host from cluster');
  }
}

// Fetch cluster hosts
async function fetchClusterHosts(clusterId: string): Promise<{ hosts: any[]; total: number }> {
  const response = await fetch(`${API_BASE}/api/clusters/${clusterId}/hosts`);
  if (!response.ok) {
    throw new Error('Failed to fetch cluster hosts');
  }
  return response.json();
}

// Hooks

export function useClusters(projectId?: string) {
  return useQuery({
    queryKey: clusterKeys.list(projectId),
    queryFn: () => fetchClusters(projectId),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function useCluster(id: string, enabled = true) {
  return useQuery({
    queryKey: clusterKeys.detail(id),
    queryFn: () => fetchCluster(id),
    enabled: enabled && !!id,
    staleTime: 10_000,
  });
}

export function useCreateCluster() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: createCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.lists() });
    },
  });
}

export function useUpdateCluster() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: updateCluster,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.lists() });
      queryClient.invalidateQueries({ queryKey: clusterKeys.detail(data.id) });
    },
  });
}

export function useDeleteCluster() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: deleteCluster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.lists() });
    },
  });
}

export function useAddHostToCluster() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ clusterId, hostId }: { clusterId: string; hostId: string }) =>
      addHostToCluster(clusterId, hostId),
    onSuccess: (_, { clusterId }) => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.detail(clusterId) });
      queryClient.invalidateQueries({ queryKey: clusterKeys.hosts(clusterId) });
      queryClient.invalidateQueries({ queryKey: clusterKeys.lists() });
    },
  });
}

export function useRemoveHostFromCluster() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ clusterId, hostId }: { clusterId: string; hostId: string }) =>
      removeHostFromCluster(clusterId, hostId),
    onSuccess: (_, { clusterId }) => {
      queryClient.invalidateQueries({ queryKey: clusterKeys.detail(clusterId) });
      queryClient.invalidateQueries({ queryKey: clusterKeys.hosts(clusterId) });
      queryClient.invalidateQueries({ queryKey: clusterKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ['nodes'] }); // Refresh nodes list
    },
  });
}

export function useClusterHosts(clusterId: string, enabled = true) {
  return useQuery({
    queryKey: clusterKeys.hosts(clusterId),
    queryFn: () => fetchClusterHosts(clusterId),
    enabled: enabled && !!clusterId,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

// Helper to convert API response to frontend Cluster type (for type compatibility)
export function toDisplayCluster(cluster: Cluster) {
  return {
    id: cluster.id,
    name: cluster.name,
    description: cluster.description,
    status: cluster.status,
    haEnabled: cluster.ha_enabled,
    drsEnabled: cluster.drs_enabled,
    hosts: {
      total: cluster.stats.total_hosts,
      online: cluster.stats.online_hosts,
      maintenance: cluster.stats.maintenance_hosts,
    },
    vms: {
      total: cluster.stats.total_vms,
      running: cluster.stats.running_vms,
      stopped: cluster.stats.stopped_vms,
    },
    resources: {
      cpuTotalGHz: cluster.stats.cpu_total_ghz,
      cpuUsedGHz: cluster.stats.cpu_used_ghz,
      memoryTotalBytes: cluster.stats.memory_total_bytes,
      memoryUsedBytes: cluster.stats.memory_used_bytes,
      storageTotalBytes: cluster.stats.storage_total_bytes,
      storageUsedBytes: cluster.stats.storage_used_bytes,
    },
    createdAt: cluster.created_at,
  };
}
