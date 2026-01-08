/**
 * Shared type definitions for the Quantix vDC frontend.
 * These types are used across components and match the API response structures.
 */

// =============================================================================
// POWER & STATUS TYPES
// =============================================================================

export type PowerState = 'RUNNING' | 'STOPPED' | 'PAUSED' | 'SUSPENDED' | 'MIGRATING' | 'CRASHED' | 'STARTING' | 'STOPPING' | 'ERROR';

export type NodePhase = 'READY' | 'NOT_READY' | 'MAINTENANCE' | 'DRAINING';

export type StoragePoolPhase = 'PENDING' | 'READY' | 'DEGRADED' | 'ERROR' | 'DELETING';

export type VolumePhase = 'PENDING' | 'CREATING' | 'READY' | 'IN_USE' | 'DELETING' | 'ERROR' | 'RESIZING';

export type NetworkStatus = 'ACTIVE' | 'PENDING' | 'ERROR' | 'DELETING';

export type ClusterStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'MAINTENANCE';

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'resolved';

// =============================================================================
// VIRTUAL MACHINE TYPES
// =============================================================================

export interface VirtualMachine {
  id: string;
  name: string;
  projectId: string;
  description: string;
  labels: Record<string, string>;
  spec: {
    cpu: { cores: number; sockets: number; model: string };
    memory: { sizeMib: number };
    disks: { id: string; sizeGib: number; bus: string }[];
    nics: { id: string; networkId: string; macAddress: string }[];
  };
  status: {
    state: PowerState;
    nodeId: string;
    ipAddresses: string[];
    resourceUsage: {
      cpuUsagePercent: number;
      memoryUsedBytes: number;
      memoryAllocatedBytes: number;
      diskReadIops: number;
      diskWriteIops: number;
      networkRxBytes: number;
      networkTxBytes: number;
    };
    guestInfo: {
      osName: string;
      hostname: string;
      agentVersion: string;
      uptimeSeconds: number;
    };
  };
  createdAt: string;
}

// =============================================================================
// NODE TYPES
// =============================================================================

export interface Node {
  id: string;
  hostname: string;
  managementIp: string;
  labels: Record<string, string>;
  spec: {
    cpu: { 
      model: string; 
      sockets?: number; 
      coresPerSocket?: number; 
      threadsPerCore?: number; 
      totalCores: number; 
      threads?: number; 
      features?: string[] 
    };
    memory: { totalBytes: number; allocatableBytes: number };
    storage: Array<{ name: string; type: string; sizeBytes: number; path?: string }>;
    networks: Array<{ name: string; macAddress?: string; speedMbps?: number }>;
    role: { compute: boolean; storage: boolean; controlPlane: boolean };
  };
  status: {
    phase: NodePhase;
    vmIds: string[];
    resources: {
      cpuAllocatedCores: number;
      cpuUsagePercent: number;
      memoryAllocatedBytes: number;
      memoryUsedBytes: number;
      storageUsedBytes?: number;
    };
    conditions?: Array<{ type: string; status: boolean; message: string; lastTransitionTime?: string }>;
    systemInfo?: { osName: string; kernelVersion: string; hypervisorVersion: string; agentVersion: string };
  };
  createdAt?: string;
}

// =============================================================================
// STORAGE TYPES
// =============================================================================

export interface StoragePool {
  id: string;
  name: string;
  description?: string;
  projectId?: string;
  type: 'CEPH_RBD' | 'LOCAL_LVM' | 'NFS' | 'ISCSI' | 'LOCAL_DIR';
  status: {
    phase: StoragePoolPhase;
    errorMessage?: string;
    volumeCount?: number;
    capacity: {
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
      provisionedBytes?: number;
    };
  };
  labels?: Record<string, string>;
  createdAt?: string;
}

export interface Volume {
  id: string;
  name: string;
  poolId: string;
  projectId: string;
  sizeBytes: number;
  actualSizeBytes: number;
  status: {
    phase: VolumePhase;
    attachedVmId?: string;
    devicePath?: string;
    errorMessage?: string;
    snapshotCount: number;
  };
  createdAt: Date;
  labels: Record<string, string>;
}

// =============================================================================
// NETWORK TYPES
// =============================================================================

export interface VirtualNetwork {
  id: string;
  name: string;
  description: string;
  type: 'OVERLAY' | 'VLAN' | 'EXTERNAL';
  status: NetworkStatus;
  vlanId?: number;
  cidr: string;
  gateway: string;
  dhcpEnabled: boolean;
  connectedVMs: number;
  connectedPorts: number;
  quantrixSwitch?: string;
  mtu: number;
  createdAt: string;
}

export interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  projectId: string;
  rules: SecurityGroupRule[];
  attachedVMs: number;
  createdAt: string;
}

export interface SecurityGroupRule {
  id: string;
  direction: 'INGRESS' | 'EGRESS';
  protocol: 'TCP' | 'UDP' | 'ICMP' | 'ANY';
  portRangeMin?: number;
  portRangeMax?: number;
  remoteIpPrefix?: string;
  remoteGroupId?: string;
  etherType: 'IPv4' | 'IPv6';
  action: 'ALLOW' | 'DENY';
}

export interface LoadBalancer {
  id: string;
  name: string;
  description: string;
  projectId: string;
  vipAddress: string;
  networkId: string;
  status: 'ACTIVE' | 'PENDING' | 'ERROR' | 'UPDATING';
  listeners: LoadBalancerListener[];
  createdAt: string;
}

export interface LoadBalancerListener {
  id: string;
  name: string;
  protocol: 'HTTP' | 'HTTPS' | 'TCP' | 'UDP';
  port: number;
  poolId: string;
  defaultPoolId?: string;
}

export interface VPNService {
  id: string;
  name: string;
  description: string;
  projectId: string;
  routerId: string;
  status: 'ACTIVE' | 'PENDING' | 'ERROR' | 'DOWN';
  connections: VPNConnection[];
  createdAt: string;
}

export interface VPNConnection {
  id: string;
  name: string;
  peerAddress: string;
  peerCidrs: string[];
  localCidrs: string[];
  status: 'ACTIVE' | 'DOWN' | 'ERROR';
}

export interface BGPSpeaker {
  id: string;
  name: string;
  localAs: number;
  routerId: string;
  status: 'ACTIVE' | 'PENDING' | 'ERROR';
  peers: BGPPeer[];
  createdAt: string;
}

export interface BGPPeer {
  id: string;
  name: string;
  peerIp: string;
  remoteAs: number;
  status: 'ESTABLISHED' | 'ACTIVE' | 'IDLE' | 'CONNECT';
}

// =============================================================================
// CLUSTER TYPES
// =============================================================================

export interface Cluster {
  id: string;
  name: string;
  description: string;
  status: ClusterStatus;
  haEnabled: boolean;
  drsEnabled: boolean;
  hosts: {
    total: number;
    online: number;
    maintenance: number;
  };
  vms: {
    total: number;
    running: number;
    stopped: number;
  };
  resources: {
    cpuTotalGHz: number;
    cpuUsedGHz: number;
    memoryTotalBytes: number;
    memoryUsedBytes: number;
    storageTotalBytes: number;
    storageUsedBytes: number;
  };
  createdAt: string;
}

export interface DRSRecommendation {
  id: string;
  type: 'MIGRATION' | 'POWER_ON' | 'POWER_OFF' | 'RESIZE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reason: string;
  sourceNode?: string;
  targetNode?: string;
  vmId: string;
  vmName: string;
  estimatedImprovement: number;
  createdAt: string;
}

// =============================================================================
// ALERT TYPES
// =============================================================================

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  sourceType: 'host' | 'vm' | 'storage' | 'network' | 'cluster';
  timestamp: Date;
  acknowledged: boolean;
  resolved: boolean;
}

// =============================================================================
// METRICS TYPES
// =============================================================================

export interface TimeSeriesPoint {
  time: string;
  value: number;
}

export interface ClusterMetrics {
  cpu: TimeSeriesPoint[];
  memory: TimeSeriesPoint[];
  storage: TimeSeriesPoint[];
  network: TimeSeriesPoint[];
}

export interface HostMetrics {
  name: string;
  cpu: number;
  memory: number;
  vms: number;
  status: 'healthy' | 'warning' | 'critical';
}

// =============================================================================
// DASHBOARD STATS
// =============================================================================

export interface DashboardStats {
  totalVMs: number;
  runningVMs: number;
  totalHosts: number;
  healthyHosts: number;
  totalCPU: number;
  usedCPU: number;
  totalMemory: number;
  usedMemory: number;
  totalStorage: number;
  usedStorage: number;
  alerts: {
    critical: number;
    warning: number;
  };
}
