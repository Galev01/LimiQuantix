import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { StoragePoolService, VolumeService } from '@/api/limiquantix/storage/v1/storage_service_pb';
import type { 
  StoragePool, 
  Volume,
  StoragePoolSpec,
  StorageBackend_BackendType,
} from '@/api/limiquantix/storage/v1/storage_pb';

// Create transport for Connect-RPC
const transport = createConnectTransport({
  baseUrl: 'http://localhost:8080',
});

// Create service clients
const poolClient = createClient(StoragePoolService, transport);
const volumeClient = createClient(VolumeService, transport);

// Query keys
export const storageKeys = {
  pools: {
    all: ['storage-pools'] as const,
    lists: () => [...storageKeys.pools.all, 'list'] as const,
    list: (filters: PoolFilters) => [...storageKeys.pools.lists(), filters] as const,
    details: () => [...storageKeys.pools.all, 'detail'] as const,
    detail: (id: string) => [...storageKeys.pools.details(), id] as const,
    metrics: (id: string) => [...storageKeys.pools.all, 'metrics', id] as const,
  },
  volumes: {
    all: ['volumes'] as const,
    lists: () => [...storageKeys.volumes.all, 'list'] as const,
    list: (filters: VolumeFilters) => [...storageKeys.volumes.lists(), filters] as const,
    details: () => [...storageKeys.volumes.all, 'detail'] as const,
    detail: (id: string) => [...storageKeys.volumes.details(), id] as const,
  },
};

// Filter types
export interface PoolFilters {
  projectId?: string;
  backendType?: StorageBackend_BackendType;
}

export interface VolumeFilters {
  poolId?: string;
  projectId?: string;
  attachedVmId?: string;
}

// Simplified types for UI
export interface StoragePoolUI {
  id: string;
  name: string;
  description: string;
  projectId: string;
  type: 'CEPH_RBD' | 'NFS' | 'ISCSI' | 'LOCAL_DIR' | 'LOCAL_LVM';
  status: {
    phase: 'PENDING' | 'READY' | 'DEGRADED' | 'ERROR' | 'DELETING';
    errorMessage?: string;
    volumeCount: number;
  };
  capacity: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    provisionedBytes: number;
  };
  createdAt: Date;
  labels: Record<string, string>;
}

export interface VolumeUI {
  id: string;
  name: string;
  poolId: string;
  projectId: string;
  sizeBytes: number;
  actualSizeBytes: number;
  status: {
    phase: 'PENDING' | 'CREATING' | 'READY' | 'IN_USE' | 'DELETING' | 'ERROR' | 'RESIZING';
    attachedVmId?: string;
    devicePath?: string;
    errorMessage?: string;
    snapshotCount: number;
  };
  createdAt: Date;
  labels: Record<string, string>;
}

// Convert proto to UI types
function toStoragePoolUI(pool: StoragePool): StoragePoolUI {
  const backendType = pool.spec?.backend?.type;
  let type: StoragePoolUI['type'] = 'LOCAL_DIR';
  
  switch (backendType) {
    case 0: type = 'CEPH_RBD'; break;
    case 1: type = 'CEPH_RBD'; break; // CEPH_CEPHFS treated as CEPH
    case 2: type = 'LOCAL_LVM'; break;
    case 3: type = 'LOCAL_DIR'; break;
    case 4: type = 'NFS'; break;
    case 5: type = 'ISCSI'; break;
  }
  
  const phaseMap: Record<number, StoragePoolUI['status']['phase']> = {
    0: 'PENDING',
    1: 'PENDING',
    2: 'READY',
    3: 'DEGRADED',
    4: 'ERROR',
    5: 'DELETING',
  };
  
  return {
    id: pool.id,
    name: pool.name,
    description: pool.description,
    projectId: pool.projectId,
    type,
    status: {
      phase: phaseMap[pool.status?.phase ?? 0] ?? 'PENDING',
      errorMessage: pool.status?.errorMessage,
      volumeCount: pool.status?.volumeCount ?? 0,
    },
    capacity: {
      totalBytes: Number(pool.status?.capacity?.totalBytes ?? 0),
      usedBytes: Number(pool.status?.capacity?.usedBytes ?? 0),
      availableBytes: Number(pool.status?.capacity?.availableBytes ?? 0),
      provisionedBytes: Number(pool.status?.capacity?.provisionedBytes ?? 0),
    },
    createdAt: pool.createdAt?.toDate() ?? new Date(),
    labels: pool.labels,
  };
}

function toVolumeUI(vol: Volume): VolumeUI {
  const phaseMap: Record<number, VolumeUI['status']['phase']> = {
    0: 'PENDING',
    1: 'PENDING',
    2: 'CREATING',
    3: 'READY',
    4: 'IN_USE',
    5: 'DELETING',
    6: 'ERROR',
    7: 'RESIZING',
  };
  
  return {
    id: vol.id,
    name: vol.name,
    poolId: vol.poolId,
    projectId: vol.projectId,
    sizeBytes: Number(vol.spec?.sizeBytes ?? 0),
    actualSizeBytes: Number(vol.status?.actualSizeBytes ?? 0),
    status: {
      phase: phaseMap[vol.status?.phase ?? 0] ?? 'PENDING',
      attachedVmId: vol.status?.attachedVmId,
      devicePath: vol.status?.devicePath,
      errorMessage: vol.status?.errorMessage,
      snapshotCount: vol.status?.snapshotCount ?? 0,
    },
    createdAt: vol.createdAt?.toDate() ?? new Date(),
    labels: vol.labels,
  };
}

// =============================================================================
// STORAGE POOL HOOKS
// =============================================================================

// List storage pools
export function useStoragePools(filters: PoolFilters = {}) {
  return useQuery({
    queryKey: storageKeys.pools.list(filters),
    queryFn: async () => {
      const response = await poolClient.listPools({
        projectId: filters.projectId,
      });
      return response.pools.map(toStoragePoolUI);
    },
    staleTime: 30_000,
    retry: false, // Don't retry on failure - fallback to mock data
    retryOnMount: false,
  });
}

// Get a single pool
export function useStoragePool(id: string, enabled = true) {
  return useQuery({
    queryKey: storageKeys.pools.detail(id),
    queryFn: async () => {
      const response = await poolClient.getPool({ id });
      return toStoragePoolUI(response);
    },
    enabled: enabled && !!id,
    retry: false,
  });
}

// Get pool metrics
export function usePoolMetrics(id: string, enabled = true) {
  return useQuery({
    queryKey: storageKeys.pools.metrics(id),
    queryFn: async () => {
      const response = await poolClient.getPoolMetrics({ id });
      return {
        poolId: response.poolId,
        totalBytes: Number(response.totalBytes),
        usedBytes: Number(response.usedBytes),
        availableBytes: Number(response.availableBytes),
        provisionedBytes: Number(response.provisionedBytes),
        readIops: Number(response.readIops),
        writeIops: Number(response.writeIops),
        readThroughputBytes: Number(response.readThroughputBytes),
        writeThroughputBytes: Number(response.writeThroughputBytes),
        readLatencyUs: Number(response.readLatencyUs),
        writeLatencyUs: Number(response.writeLatencyUs),
        volumeCount: response.volumeCount,
      };
    },
    enabled: enabled && !!id,
    refetchInterval: 10_000, // Refresh every 10 seconds
    retry: false,
  });
}

// Create pool parameters
export interface CreatePoolParams {
  name: string;
  description?: string;
  projectId?: string;
  labels?: Record<string, string>;
  backendType: 'CEPH_RBD' | 'NFS' | 'ISCSI' | 'LOCAL_DIR' | 'LOCAL_LVM';
  // NFS config
  nfs?: {
    server: string;
    exportPath: string;
    version?: string;
    options?: string;
  };
  // Ceph config
  ceph?: {
    poolName: string;
    monitors: string[];
    user?: string;
    keyringPath?: string;
    namespace?: string;
  };
  // iSCSI config
  iscsi?: {
    portal: string;
    target: string;
    chapEnabled?: boolean;
    chapUser?: string;
    chapPassword?: string;
    lun?: number;
  };
  // Local config
  local?: {
    path: string;
  };
}

// Create storage pool
export function useCreateStoragePool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreatePoolParams) => {
      // Build spec based on backend type
      const backendTypeMap: Record<string, number> = {
        'CEPH_RBD': 0,
        'NFS': 4,
        'ISCSI': 5,
        'LOCAL_DIR': 3,
        'LOCAL_LVM': 2,
      };

      const spec: Partial<StoragePoolSpec> = {
        backend: {
          type: backendTypeMap[params.backendType] as StorageBackend_BackendType,
        },
      };

      // Add backend-specific config
      if (params.nfs && params.backendType === 'NFS') {
        spec.backend = {
          ...spec.backend,
          nfs: {
            server: params.nfs.server,
            exportPath: params.nfs.exportPath,
            version: params.nfs.version || '4.1',
            options: params.nfs.options || '',
            mountPoint: '',
          },
        };
      } else if (params.ceph && params.backendType === 'CEPH_RBD') {
        spec.backend = {
          ...spec.backend,
          ceph: {
            clusterId: '',
            poolName: params.ceph.poolName,
            monitors: params.ceph.monitors,
            user: params.ceph.user || 'admin',
            keyringPath: params.ceph.keyringPath || '/etc/ceph/ceph.client.admin.keyring',
            namespace: params.ceph.namespace || '',
            secretUuid: '',
          },
        };
      } else if (params.iscsi && params.backendType === 'ISCSI') {
        spec.backend = {
          ...spec.backend,
          iscsi: {
            portal: params.iscsi.portal,
            target: params.iscsi.target,
            chapEnabled: params.iscsi.chapEnabled || false,
            chapUser: params.iscsi.chapUser || '',
            chapPassword: params.iscsi.chapPassword || '',
            lun: params.iscsi.lun || 0,
            volumeGroup: '',
          },
        };
      } else if (params.local && params.backendType === 'LOCAL_DIR') {
        spec.backend = {
          ...spec.backend,
          localDir: {
            path: params.local.path,
            nodeId: '',
          },
        };
      }

      const response = await poolClient.createPool({
        name: params.name,
        description: params.description,
        projectId: params.projectId || 'default',
        labels: params.labels || {},
        spec: spec as StoragePoolSpec,
      });

      return toStoragePoolUI(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.pools.lists() });
    },
  });
}

// Delete storage pool
export function useDeleteStoragePool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await poolClient.deletePool({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: storageKeys.pools.lists() });
    },
  });
}

// =============================================================================
// VOLUME HOOKS
// =============================================================================

// List volumes
export function useVolumes(filters: VolumeFilters = {}) {
  return useQuery({
    queryKey: storageKeys.volumes.list(filters),
    queryFn: async () => {
      const response = await volumeClient.listVolumes({
        poolId: filters.poolId,
        projectId: filters.projectId,
      });
      return response.volumes.map(toVolumeUI);
    },
    staleTime: 30_000,
    retry: false, // Don't retry on failure - fallback to mock data
    retryOnMount: false,
  });
}

// Get a single volume
export function useVolume(id: string, enabled = true) {
  return useQuery({
    queryKey: storageKeys.volumes.detail(id),
    queryFn: async () => {
      const response = await volumeClient.getVolume({ id });
      return toVolumeUI(response);
    },
    enabled: enabled && !!id,
    retry: false,
  });
}

// Create volume parameters
export interface CreateVolumeParams {
  name: string;
  poolId: string;
  sizeBytes: number;
  projectId?: string;
  labels?: Record<string, string>;
  sourceType?: 'empty' | 'clone' | 'snapshot' | 'image';
  sourceId?: string;
}

// Create volume
export function useCreateVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateVolumeParams) => {
      const response = await volumeClient.createVolume({
        name: params.name,
        poolId: params.poolId,
        projectId: params.projectId || 'default',
        labels: params.labels || {},
        spec: {
          sizeBytes: BigInt(params.sizeBytes),
          provisioning: 0, // THIN
          accessMode: 0, // READ_WRITE_ONCE
        },
      });
      return toVolumeUI(response);
    },
    onSuccess: (_, params) => {
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.lists() });
      queryClient.invalidateQueries({ queryKey: storageKeys.pools.detail(params.poolId) });
    },
  });
}

// Delete volume
export function useDeleteVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, poolId }: { id: string; poolId: string }) => {
      await volumeClient.deleteVolume({ id });
      return poolId;
    },
    onSuccess: (poolId) => {
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.lists() });
      queryClient.invalidateQueries({ queryKey: storageKeys.pools.detail(poolId) });
    },
  });
}

// Resize volume
export function useResizeVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, newSizeBytes }: { id: string; newSizeBytes: number }) => {
      const response = await volumeClient.resizeVolume({
        id,
        newSizeBytes: BigInt(newSizeBytes),
      });
      return toVolumeUI(response);
    },
    onSuccess: (volume) => {
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.detail(volume.id) });
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.lists() });
    },
  });
}

// Attach volume to VM
export function useAttachVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ volumeId, vmId }: { volumeId: string; vmId: string }) => {
      const response = await volumeClient.attachVolume({
        volumeId,
        vmId,
      });
      return toVolumeUI(response);
    },
    onSuccess: (volume) => {
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.detail(volume.id) });
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.lists() });
    },
  });
}

// Detach volume from VM
export function useDetachVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (volumeId: string) => {
      const response = await volumeClient.detachVolume({ volumeId });
      return toVolumeUI(response);
    },
    onSuccess: (volume) => {
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.detail(volume.id) });
      queryClient.invalidateQueries({ queryKey: storageKeys.volumes.lists() });
    },
  });
}
