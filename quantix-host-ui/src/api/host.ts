/**
 * Host API - Endpoints for host/system information
 */

import { get, post } from './client';
import type { HostInfo, HostHealth } from './types';

/**
 * Get host information (CPU, memory, OS, hypervisor details)
 */
export async function getHostInfo(): Promise<HostInfo> {
  return get<HostInfo>('/host');
}

/**
 * Get host health status
 */
export async function getHostHealth(): Promise<HostHealth> {
  return get<HostHealth>('/host/health');
}

/**
 * Reboot the host (requires confirmation)
 */
export async function rebootHost(): Promise<void> {
  return post('/host/reboot');
}

/**
 * Shutdown the host (requires confirmation)
 */
export async function shutdownHost(): Promise<void> {
  return post('/host/shutdown');
}

/**
 * Get hardware inventory
 */
export interface HardwareInventory {
  cpu: CpuInfo;
  memory: MemoryInfo;
  storageDevices: StorageDevice[];
  networkDevices: NetworkDevice[];
  gpus: GpuInfo[];
}

export interface CpuInfo {
  model: string;
  sockets: number;
  coresPerSocket: number;
  threadsPerCore: number;
  totalCores: number;
  features: string[];
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  bufferedBytes: number;
  cachedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface StorageDevice {
  device: string;
  model: string;
  serial: string;
  sizeBytes: number;
  type: 'hdd' | 'ssd' | 'nvme';
  smartStatus: 'healthy' | 'warning' | 'failing' | 'unknown';
}

export interface NetworkDevice {
  name: string;
  driver: string;
  macAddress: string;
  speed: number;
  linkState: 'up' | 'down';
  mtu: number;
}

export interface GpuInfo {
  vendor: string;
  model: string;
  deviceId: string;
  memory?: number;
  passthrough: boolean;
}

export async function getHardwareInventory(): Promise<HardwareInventory> {
  return get<HardwareInventory>('/host/hardware');
}
