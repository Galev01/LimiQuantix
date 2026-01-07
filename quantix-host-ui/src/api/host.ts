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
  pci_devices: PciDevice[];
}

export interface CpuInfo {
  model: string;
  vendor: string;
  cores: number;
  threads: number;
  sockets: number;
  frequency_mhz: number;
  features: string[];
  architecture: string;
}

export interface MemoryInfo {
  total_bytes: number;
  available_bytes: number;
  used_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  ecc_enabled: boolean;
  dimm_count: number;
}

export interface StorageDevice {
  name: string;
  model: string;
  serial: string;
  size_bytes: number;
  disk_type: string;
  interface: string;
  is_removable: boolean;
  smart_status: string;
  partitions: PartitionInfo[];
}

export interface PartitionInfo {
  name: string;
  mount_point?: string;
  size_bytes: number;
  used_bytes: number;
  filesystem: string;
}

export interface NetworkDevice {
  name: string;
  mac_address: string;
  driver: string;
  speed_mbps?: number;
  link_state: string;
  pci_address?: string;
  sriov_capable: boolean;
  sriov_vfs: number;
}

export interface GpuInfo {
  name: string;
  vendor: string;
  pci_address: string;
  driver: string;
  memory_bytes?: number;
  passthrough_capable: boolean;
}

export interface PciDevice {
  address: string;
  vendor: string;
  device: string;
  class: string;
  driver?: string;
  iommu_group?: number;
}

export async function getHardwareInventory(): Promise<HardwareInventory> {
  return get<HardwareInventory>('/host/hardware');
}
