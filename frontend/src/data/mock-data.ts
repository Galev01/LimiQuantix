// Mock data for development - matches our proto definitions

export type PowerState = 'RUNNING' | 'STOPPED' | 'PAUSED' | 'SUSPENDED' | 'MIGRATING' | 'CRASHED';

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

export interface Node {
  id: string;
  hostname: string;
  managementIp: string;
  labels: Record<string, string>;
  spec: {
    cpu: { model: string; cores: number; threads: number };
    memory: { totalBytes: number; allocatableBytes: number };
  };
  status: {
    phase: 'READY' | 'NOT_READY' | 'MAINTENANCE' | 'DRAINING';
    vmIds: string[];
    resources: {
      cpuUsagePercent: number;
      memoryUsedBytes: number;
      memoryAllocatableBytes: number;
    };
  };
}

export interface StoragePool {
  id: string;
  name: string;
  type: 'CEPH_RBD' | 'LOCAL_LVM' | 'NFS';
  status: {
    phase: 'READY' | 'DEGRADED' | 'ERROR';
    capacity: {
      totalBytes: number;
      usedBytes: number;
      availableBytes: number;
    };
  };
}

// Mock VMs
export const mockVMs: VirtualMachine[] = [
  {
    id: 'vm-001',
    name: 'prod-web-01',
    projectId: 'default',
    description: 'Production web server',
    labels: { env: 'production', tier: 'web', app: 'nginx' },
    spec: {
      cpu: { cores: 4, sockets: 1, model: 'host-passthrough' },
      memory: { sizeMib: 8192 },
      disks: [{ id: 'disk-1', sizeGib: 100, bus: 'VIRTIO_BLK' }],
      nics: [{ id: 'nic-1', networkId: 'net-prod', macAddress: '52:54:00:12:34:56' }],
    },
    status: {
      state: 'RUNNING',
      nodeId: 'node-001',
      ipAddresses: ['10.0.1.10', '192.168.1.100'],
      resourceUsage: {
        cpuUsagePercent: 45,
        memoryUsedBytes: 6_442_450_944,
        memoryAllocatedBytes: 8_589_934_592,
        diskReadIops: 1250,
        diskWriteIops: 890,
        networkRxBytes: 125_000_000,
        networkTxBytes: 89_000_000,
      },
      guestInfo: {
        osName: 'Ubuntu 22.04 LTS',
        hostname: 'prod-web-01',
        agentVersion: '1.0.0',
        uptimeSeconds: 864000,
      },
    },
    createdAt: '2024-01-15T10:30:00Z',
  },
  {
    id: 'vm-002',
    name: 'prod-db-01',
    projectId: 'default',
    description: 'Production PostgreSQL database',
    labels: { env: 'production', tier: 'database', app: 'postgresql' },
    spec: {
      cpu: { cores: 8, sockets: 2, model: 'host-passthrough' },
      memory: { sizeMib: 32768 },
      disks: [
        { id: 'disk-1', sizeGib: 50, bus: 'VIRTIO_BLK' },
        { id: 'disk-2', sizeGib: 500, bus: 'VIRTIO_BLK' },
      ],
      nics: [{ id: 'nic-1', networkId: 'net-prod', macAddress: '52:54:00:12:34:57' }],
    },
    status: {
      state: 'RUNNING',
      nodeId: 'node-002',
      ipAddresses: ['10.0.1.20'],
      resourceUsage: {
        cpuUsagePercent: 68,
        memoryUsedBytes: 28_991_029_248,
        memoryAllocatedBytes: 34_359_738_368,
        diskReadIops: 5600,
        diskWriteIops: 3200,
        networkRxBytes: 45_000_000,
        networkTxBytes: 125_000_000,
      },
      guestInfo: {
        osName: 'Rocky Linux 9',
        hostname: 'prod-db-01',
        agentVersion: '1.0.0',
        uptimeSeconds: 1728000,
      },
    },
    createdAt: '2024-01-10T08:15:00Z',
  },
  {
    id: 'vm-003',
    name: 'dev-api-01',
    projectId: 'development',
    description: 'Development API server',
    labels: { env: 'development', tier: 'api', app: 'fastapi' },
    spec: {
      cpu: { cores: 2, sockets: 1, model: 'qemu64' },
      memory: { sizeMib: 4096 },
      disks: [{ id: 'disk-1', sizeGib: 50, bus: 'VIRTIO_BLK' }],
      nics: [{ id: 'nic-1', networkId: 'net-dev', macAddress: '52:54:00:12:34:58' }],
    },
    status: {
      state: 'STOPPED',
      nodeId: '',
      ipAddresses: [],
      resourceUsage: {
        cpuUsagePercent: 0,
        memoryUsedBytes: 0,
        memoryAllocatedBytes: 4_294_967_296,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Debian 12',
        hostname: 'dev-api-01',
        agentVersion: '1.0.0',
        uptimeSeconds: 0,
      },
    },
    createdAt: '2024-02-01T14:20:00Z',
  },
  {
    id: 'vm-004',
    name: 'staging-cache-01',
    projectId: 'staging',
    description: 'Staging Redis cache',
    labels: { env: 'staging', tier: 'cache', app: 'redis' },
    spec: {
      cpu: { cores: 4, sockets: 1, model: 'host-passthrough' },
      memory: { sizeMib: 16384 },
      disks: [{ id: 'disk-1', sizeGib: 100, bus: 'VIRTIO_BLK' }],
      nics: [{ id: 'nic-1', networkId: 'net-staging', macAddress: '52:54:00:12:34:59' }],
    },
    status: {
      state: 'RUNNING',
      nodeId: 'node-001',
      ipAddresses: ['10.0.2.15'],
      resourceUsage: {
        cpuUsagePercent: 12,
        memoryUsedBytes: 14_495_514_624,
        memoryAllocatedBytes: 17_179_869_184,
        diskReadIops: 890,
        diskWriteIops: 450,
        networkRxBytes: 78_000_000,
        networkTxBytes: 156_000_000,
      },
      guestInfo: {
        osName: 'Ubuntu 22.04 LTS',
        hostname: 'staging-cache-01',
        agentVersion: '1.0.0',
        uptimeSeconds: 432000,
      },
    },
    createdAt: '2024-02-10T09:45:00Z',
  },
  {
    id: 'vm-005',
    name: 'monitoring-01',
    projectId: 'infrastructure',
    description: 'Prometheus & Grafana monitoring stack',
    labels: { env: 'production', tier: 'monitoring', app: 'prometheus' },
    spec: {
      cpu: { cores: 4, sockets: 1, model: 'host-passthrough' },
      memory: { sizeMib: 8192 },
      disks: [
        { id: 'disk-1', sizeGib: 50, bus: 'VIRTIO_BLK' },
        { id: 'disk-2', sizeGib: 200, bus: 'VIRTIO_BLK' },
      ],
      nics: [{ id: 'nic-1', networkId: 'net-mgmt', macAddress: '52:54:00:12:34:60' }],
    },
    status: {
      state: 'RUNNING',
      nodeId: 'node-003',
      ipAddresses: ['10.0.100.5'],
      resourceUsage: {
        cpuUsagePercent: 35,
        memoryUsedBytes: 6_871_947_674,
        memoryAllocatedBytes: 8_589_934_592,
        diskReadIops: 2100,
        diskWriteIops: 1800,
        networkRxBytes: 250_000_000,
        networkTxBytes: 45_000_000,
      },
      guestInfo: {
        osName: 'Fedora CoreOS 39',
        hostname: 'monitoring-01',
        agentVersion: '1.0.0',
        uptimeSeconds: 2592000,
      },
    },
    createdAt: '2023-12-01T06:00:00Z',
  },
  {
    id: 'vm-006',
    name: 'gpu-ml-01',
    projectId: 'ml-team',
    description: 'GPU workstation for ML training',
    labels: { env: 'production', tier: 'compute', app: 'pytorch', gpu: 'a100' },
    spec: {
      cpu: { cores: 16, sockets: 2, model: 'host-passthrough' },
      memory: { sizeMib: 65536 },
      disks: [
        { id: 'disk-1', sizeGib: 100, bus: 'NVME' },
        { id: 'disk-2', sizeGib: 2000, bus: 'NVME' },
      ],
      nics: [{ id: 'nic-1', networkId: 'net-prod', macAddress: '52:54:00:12:34:61' }],
    },
    status: {
      state: 'PAUSED',
      nodeId: 'node-004',
      ipAddresses: ['10.0.1.50'],
      resourceUsage: {
        cpuUsagePercent: 0,
        memoryUsedBytes: 0,
        memoryAllocatedBytes: 68_719_476_736,
        diskReadIops: 0,
        diskWriteIops: 0,
        networkRxBytes: 0,
        networkTxBytes: 0,
      },
      guestInfo: {
        osName: 'Ubuntu 22.04 LTS',
        hostname: 'gpu-ml-01',
        agentVersion: '1.0.0',
        uptimeSeconds: 86400,
      },
    },
    createdAt: '2024-01-20T11:30:00Z',
  },
];

// Mock Nodes
export const mockNodes: Node[] = [
  {
    id: 'node-001',
    hostname: 'hv-rack1-01.limiquantix.local',
    managementIp: '192.168.1.11',
    labels: { rack: 'rack-1', zone: 'us-east-1a' },
    spec: {
      cpu: { model: 'AMD EPYC 7742', cores: 64, threads: 128 },
      memory: { totalBytes: 549_755_813_888, allocatableBytes: 515_396_075_520 },
    },
    status: {
      phase: 'READY',
      vmIds: ['vm-001', 'vm-004'],
      resources: {
        cpuUsagePercent: 32,
        memoryUsedBytes: 180_388_626_432,
        memoryAllocatableBytes: 515_396_075_520,
      },
    },
  },
  {
    id: 'node-002',
    hostname: 'hv-rack1-02.limiquantix.local',
    managementIp: '192.168.1.12',
    labels: { rack: 'rack-1', zone: 'us-east-1a' },
    spec: {
      cpu: { model: 'AMD EPYC 7742', cores: 64, threads: 128 },
      memory: { totalBytes: 549_755_813_888, allocatableBytes: 515_396_075_520 },
    },
    status: {
      phase: 'READY',
      vmIds: ['vm-002'],
      resources: {
        cpuUsagePercent: 45,
        memoryUsedBytes: 240_518_168_576,
        memoryAllocatableBytes: 515_396_075_520,
      },
    },
  },
  {
    id: 'node-003',
    hostname: 'hv-rack2-01.limiquantix.local',
    managementIp: '192.168.1.21',
    labels: { rack: 'rack-2', zone: 'us-east-1b' },
    spec: {
      cpu: { model: 'Intel Xeon Gold 6348', cores: 56, threads: 112 },
      memory: { totalBytes: 274_877_906_944, allocatableBytes: 257_698_037_760 },
    },
    status: {
      phase: 'READY',
      vmIds: ['vm-005'],
      resources: {
        cpuUsagePercent: 18,
        memoryUsedBytes: 85_899_345_920,
        memoryAllocatableBytes: 257_698_037_760,
      },
    },
  },
  {
    id: 'node-004',
    hostname: 'hv-gpu-01.limiquantix.local',
    managementIp: '192.168.1.100',
    labels: { rack: 'rack-gpu', zone: 'us-east-1a', gpu: 'nvidia-a100' },
    spec: {
      cpu: { model: 'AMD EPYC 7763', cores: 64, threads: 128 },
      memory: { totalBytes: 1_099_511_627_776, allocatableBytes: 1_030_792_151_040 },
    },
    status: {
      phase: 'READY',
      vmIds: ['vm-006'],
      resources: {
        cpuUsagePercent: 5,
        memoryUsedBytes: 68_719_476_736,
        memoryAllocatableBytes: 1_030_792_151_040,
      },
    },
  },
];

// Mock Storage Pools
export const mockStoragePools: StoragePool[] = [
  {
    id: 'pool-ceph-01',
    name: 'ceph-ssd-pool',
    type: 'CEPH_RBD',
    status: {
      phase: 'READY',
      capacity: {
        totalBytes: 107_374_182_400_000,
        usedBytes: 42_949_672_960_000,
        availableBytes: 64_424_509_440_000,
      },
    },
  },
  {
    id: 'pool-local-01',
    name: 'local-nvme',
    type: 'LOCAL_LVM',
    status: {
      phase: 'READY',
      capacity: {
        totalBytes: 3_298_534_883_328,
        usedBytes: 1_649_267_441_664,
        availableBytes: 1_649_267_441_664,
      },
    },
  },
];

// Summary stats
export const getClusterStats = () => {
  const runningVMs = mockVMs.filter(vm => vm.status.state === 'RUNNING').length;
  const stoppedVMs = mockVMs.filter(vm => vm.status.state === 'STOPPED').length;
  const totalCPU = mockVMs.reduce((acc, vm) => acc + vm.spec.cpu.cores, 0);
  const totalMemory = mockVMs.reduce((acc, vm) => acc + vm.spec.memory.sizeMib * 1024 * 1024, 0);
  const usedMemory = mockVMs.reduce((acc, vm) => acc + vm.status.resourceUsage.memoryUsedBytes, 0);
  const avgCPU = mockVMs.filter(vm => vm.status.state === 'RUNNING')
    .reduce((acc, vm) => acc + vm.status.resourceUsage.cpuUsagePercent, 0) / runningVMs || 0;
  
  return {
    vms: { total: mockVMs.length, running: runningVMs, stopped: stoppedVMs },
    nodes: { total: mockNodes.length, ready: mockNodes.filter(n => n.status.phase === 'READY').length },
    cpu: { allocated: totalCPU, avgUsage: avgCPU },
    memory: { allocated: totalMemory, used: usedMemory },
    storage: mockStoragePools.reduce((acc, p) => ({
      total: acc.total + p.status.capacity.totalBytes,
      used: acc.used + p.status.capacity.usedBytes,
    }), { total: 0, used: 0 }),
  };
};

