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
 * Host metrics response
 */
export interface HostMetrics {
  timestamp: string;
  cpu_usage_percent: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  memory_usage_percent: number;
  disk_read_bytes_per_sec: number;
  disk_write_bytes_per_sec: number;
  network_rx_bytes_per_sec: number;
  network_tx_bytes_per_sec: number;
  load_average_1min: number;
  load_average_5min: number;
  load_average_15min: number;
  vm_count: number;
  vm_running_count: number;
}

/**
 * Get current host metrics
 */
export async function getHostMetrics(): Promise<HostMetrics> {
  return get<HostMetrics>('/host/metrics');
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
  storage: StorageDevice[];
  network: NetworkDevice[];
  gpus: GpuInfo[];
  pciDevices: PciDevice[];
}

export interface CpuInfo {
  model: string;
  vendor: string;
  cores: number;
  threads: number;
  sockets: number;
  frequencyMhz: number;
  features: string[];
  architecture: string;
}

export interface MemoryInfo {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  eccEnabled: boolean;
  dimmCount: number;
}

export interface StorageDevice {
  name: string;
  model: string;
  serial: string;
  sizeBytes: number;
  diskType: string;
  interface: string;
  isRemovable: boolean;
  smartStatus: string;
  partitions: PartitionInfo[];
}

export interface PartitionInfo {
  name: string;
  mountPoint?: string;
  sizeBytes: number;
  usedBytes: number;
  filesystem: string;
}

export interface NetworkDevice {
  name: string;
  macAddress: string;
  driver: string;
  speedMbps?: number;
  linkState: string;
  pciAddress?: string;
  sriovCapable: boolean;
  sriovVfs: number;
}

export interface GpuInfo {
  name: string;
  vendor: string;
  pciAddress: string;
  driver: string;
  memoryBytes?: number;
  passthroughCapable: boolean;
}

export interface PciDevice {
  address: string;
  vendor: string;
  device: string;
  class: string;
  driver?: string;
  iommuGroup?: number;
}

export async function getHardwareInventory(): Promise<HardwareInventory> {
  return get<HardwareInventory>('/host/hardware');
}
