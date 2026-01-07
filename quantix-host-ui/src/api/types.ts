/**
 * API Types for Quantix-OS Host Management
 */

// ============================================================================
// Host Types
// ============================================================================

export interface HostInfo {
  nodeId: string;
  hostname: string;
  managementIp: string;
  cpuModel: string;
  cpuCores: number;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  uptimeSeconds: number;
  hypervisorName: string;
  hypervisorVersion: string;
  supportsLiveMigration: boolean;
  supportsSnapshots: boolean;
  supportsHotplug: boolean;
  maxVcpus: number;
  maxMemoryBytes: number;
}

export interface HostHealth {
  healthy: boolean;
  version: string;
  hypervisor: string;
  hypervisorVersion: string;
  uptimeSeconds: number;
}

// ============================================================================
// VM Types
// ============================================================================

export type PowerState = 
  | 'UNKNOWN'
  | 'RUNNING'
  | 'STOPPED'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'CRASHED'
  | 'MIGRATING';

export interface VirtualMachine {
  vmId: string;
  name: string;
  state: PowerState;
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  startedAt?: string;
  guestAgent?: GuestAgentInfo;
}

export interface GuestAgentInfo {
  connected: boolean;
  version: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  hostname: string;
  ipAddresses: string[];
  resourceUsage?: GuestResourceUsage;
}

export interface GuestResourceUsage {
  cpuUsagePercent: number;
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  processCount: number;
  uptimeSeconds: number;
}

export interface CreateVmRequest {
  name: string;
  cpuCores: number;
  cpuSockets?: number;
  memoryMib: number;
  disks: DiskSpec[];
  nics: NicSpec[];
  cloudInit?: CloudInitSpec;
}

export interface DiskSpec {
  id: string;
  sizeGib: number;
  bus?: 'virtio' | 'scsi' | 'sata' | 'ide';
  format?: 'qcow2' | 'raw';
  backingFile?: string;
  bootable?: boolean;
}

export interface NicSpec {
  id: string;
  network?: string;
  bridge?: string;
  macAddress?: string;
  model?: 'virtio' | 'e1000' | 'rtl8139';
}

export interface CloudInitSpec {
  userData?: string;
  metaData?: string;
  networkConfig?: string;
}

export interface ConsoleInfo {
  consoleType: 'vnc' | 'spice';
  host: string;
  port: number;
  password?: string;
  websocketPath?: string;
}

// ============================================================================
// Snapshot Types
// ============================================================================

export interface Snapshot {
  snapshotId: string;
  name: string;
  description: string;
  createdAt: string;
  vmState: PowerState;
  parentId?: string;
}

// ============================================================================
// Storage Types
// ============================================================================

export type StoragePoolType = 'LOCAL_DIR' | 'NFS' | 'CEPH_RBD' | 'ISCSI';

export interface StoragePool {
  poolId: string;
  type: StoragePoolType;
  mountPath: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  volumeCount: number;
}

export interface Volume {
  volumeId: string;
  poolId: string;
  sizeBytes: number;
  attachedVmId?: string;
  path: string;
}

// ============================================================================
// Network Types
// ============================================================================

export interface NetworkInterface {
  name: string;
  macAddress: string;
  ipv4Addresses: string[];
  ipv6Addresses: string[];
  speed?: number;
  linkState: 'up' | 'down';
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface NodeMetrics {
  timestamp: string;
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  vms: VmMetrics[];
}

export interface VmMetrics {
  vmId: string;
  name: string;
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type EventType = 
  | 'VM_STARTED'
  | 'VM_STOPPED'
  | 'VM_CREATED'
  | 'VM_DELETED'
  | 'SNAPSHOT_CREATED'
  | 'SNAPSHOT_REVERTED'
  | 'SYSTEM_ERROR'
  | 'AGENT_CONNECTED'
  | 'AGENT_DISCONNECTED';

export interface NodeEvent {
  id: string;
  timestamp: string;
  type: EventType;
  vmId?: string;
  message: string;
  metadata?: Record<string, string>;
}
