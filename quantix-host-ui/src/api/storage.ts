/**
 * Storage API - Storage pools and volumes
 */

import { get, post, del } from './client';
import type { StoragePool } from './types';

/**
 * List all storage pools
 */
export async function listStoragePools(): Promise<StoragePool[]> {
  const response = await get<{ pools: StoragePool[] }>('/storage/pools');
  return response.pools || [];
}

/**
 * Get a single storage pool
 */
export async function getStoragePool(poolId: string): Promise<StoragePool> {
  return get<StoragePool>(`/storage/pools/${poolId}`);
}

/**
 * Initialize a new storage pool
 */
export interface CreatePoolRequest {
  poolId: string;
  type: 'LOCAL_DIR' | 'NFS' | 'CEPH_RBD' | 'ISCSI';
  config: {
    local?: { path: string };
    nfs?: { server: string; export: string };
    ceph?: { pool: string; monitors: string[] };
    iscsi?: { target: string; lun: number };
  };
}

export async function createStoragePool(request: CreatePoolRequest): Promise<StoragePool> {
  // Convert to backend expected format (camelCase)
  const backendRequest = {
    poolId: request.poolId,
    type: request.type,
    path: request.config.local?.path,
    nfsServer: request.config.nfs?.server,
    nfsExport: request.config.nfs?.export,
  };
  return post<StoragePool>('/storage/pools', backendRequest);
}

/**
 * Destroy a storage pool
 */
export async function destroyStoragePool(poolId: string): Promise<void> {
  return del(`/storage/pools/${poolId}`);
}

// ============================================================================
// Volumes
// ============================================================================

export interface VolumeInfo {
  volumeId: string;
  poolId: string;
  sizeBytes: number;
  path: string;
  attachedTo?: string;
}

/**
 * List volumes in a pool
 */
export async function listVolumes(poolId: string): Promise<VolumeInfo[]> {
  const response = await get<{ volumes: VolumeInfo[] }>(`/storage/pools/${poolId}/volumes`);
  return response.volumes || [];
}

/**
 * Create a new volume
 */
export interface CreateVolumeRequest {
  volumeId: string;
  sizeBytes: number;
  sourceType?: 'EMPTY' | 'CLONE' | 'IMAGE' | 'SNAPSHOT';
  sourceId?: string;
}

export async function createVolume(poolId: string, request: CreateVolumeRequest): Promise<void> {
  return post(`/storage/pools/${poolId}/volumes`, request);
}

/**
 * Delete a volume
 */
export async function deleteVolume(poolId: string, volumeId: string): Promise<void> {
  return del(`/storage/pools/${poolId}/volumes/${volumeId}`);
}

/**
 * Resize a volume
 */
export async function resizeVolume(
  poolId: string, 
  volumeId: string, 
  newSizeBytes: number
): Promise<void> {
  return post(`/storage/pools/${poolId}/volumes/${volumeId}/resize`, { newSizeBytes });
}

// ============================================================================
// Images (ISOs)
// ============================================================================

export interface ImageInfo {
  imageId: string;
  name: string;
  path: string;
  sizeBytes: number;
  format: string;
  uploadedAt: string;
}

/**
 * List available images/ISOs
 */
export async function listImages(): Promise<ImageInfo[]> {
  const response = await get<{ images: ImageInfo[] }>('/storage/images');
  return response.images || [];
}

// ============================================================================
// Local Devices (Physical Disk Discovery)
// ============================================================================

export interface LocalPartitionInfo {
  device: string;
  filesystem?: string;
  mountPoint?: string;
  sizeBytes: number;
  usedBytes: number;
  label?: string;
}

export interface LocalDeviceInfo {
  device: string;
  name: string;
  deviceType: string;
  totalBytes: number;
  inUse: boolean;
  partitions: LocalPartitionInfo[];
  canInitialize: boolean;
  serial?: string;
  model?: string;
}

/**
 * List local block devices available for storage
 */
export async function listLocalDevices(): Promise<LocalDeviceInfo[]> {
  const response = await get<{ devices: LocalDeviceInfo[] }>('/storage/local-devices');
  return response.devices || [];
}

/**
 * Initialize a local device as a qDV storage pool
 */
export interface InitializeDeviceRequest {
  poolName: string;
  filesystem?: string;
  confirmWipe: boolean;
}

export interface InitializeDeviceResponse {
  success: boolean;
  poolId?: string;
  message: string;
}

export async function initializeLocalDevice(
  device: string,
  request: InitializeDeviceRequest
): Promise<InitializeDeviceResponse> {
  // URL encode the device path
  const encodedDevice = encodeURIComponent(device);
  return post<InitializeDeviceResponse>(`/storage/local-devices/${encodedDevice}/initialize`, request);
}
