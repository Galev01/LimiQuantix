import { useState } from 'react';
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Monitor,
  Usb,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button } from '@/components/ui';
import { useHardwareInventory } from '@/hooks/useHost';
import { formatBytes, cn } from '@/lib/utils';

type Tab = 'cpu' | 'memory' | 'storage' | 'network' | 'gpu' | 'pci';

export function Hardware() {
  const { data: hardware, isLoading, refetch, isFetching } = useHardwareInventory();
  const [activeTab, setActiveTab] = useState<Tab>('cpu');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'cpu', label: 'CPU', icon: <Cpu className="w-4 h-4" /> },
    { id: 'memory', label: 'Memory', icon: <MemoryStick className="w-4 h-4" /> },
    { id: 'storage', label: 'Storage', icon: <HardDrive className="w-4 h-4" /> },
    { id: 'network', label: 'Network', icon: <Network className="w-4 h-4" /> },
    { id: 'gpu', label: 'GPU', icon: <Monitor className="w-4 h-4" /> },
    { id: 'pci', label: 'PCI Devices', icon: <Usb className="w-4 h-4" /> },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Hardware"
        subtitle="System hardware inventory and status"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'bg-accent text-white'
                  : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center text-text-muted py-12">
            Loading hardware information...
          </div>
        ) : !hardware ? (
          <Card className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-warning mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text-primary mb-2">
              Failed to Load Hardware Info
            </h3>
            <p className="text-text-muted">
              Unable to retrieve hardware inventory
            </p>
          </Card>
        ) : (
          <>
            {/* CPU Tab */}
            {activeTab === 'cpu' && (
              <div className="space-y-6">
                <Card>
                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-accent/10 rounded-lg">
                      <Cpu className="w-8 h-8 text-accent" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-text-primary">
                        {hardware.cpu.model || 'Unknown CPU'}
                      </h3>
                      <p className="text-text-muted">{hardware.cpu.vendor}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                    <div className="p-4 bg-bg-base rounded-lg">
                      <div className="text-2xl font-bold text-text-primary">
                        {hardware.cpu.cores}
                      </div>
                      <div className="text-sm text-text-muted">Physical Cores</div>
                    </div>
                    <div className="p-4 bg-bg-base rounded-lg">
                      <div className="text-2xl font-bold text-text-primary">
                        {hardware.cpu.threads}
                      </div>
                      <div className="text-sm text-text-muted">Logical Threads</div>
                    </div>
                    <div className="p-4 bg-bg-base rounded-lg">
                      <div className="text-2xl font-bold text-text-primary">
                        {hardware.cpu.sockets}
                      </div>
                      <div className="text-sm text-text-muted">Sockets</div>
                    </div>
                    <div className="p-4 bg-bg-base rounded-lg">
                      <div className="text-2xl font-bold text-text-primary">
                        {((hardware.cpu.frequencyMhz || 0) / 1000).toFixed(2)} GHz
                      </div>
                      <div className="text-sm text-text-muted">Base Frequency</div>
                    </div>
                  </div>

                  {hardware.cpu.features.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-text-secondary mb-3">
                        CPU Features
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {hardware.cpu.features.map(feature => (
                          <Badge key={feature} variant="default">
                            {feature}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* Memory Tab */}
            {activeTab === 'memory' && (
              <div className="space-y-6">
                <Card>
                  <div className="flex items-start gap-4 mb-6">
                    <div className="p-3 bg-info/10 rounded-lg">
                      <MemoryStick className="w-8 h-8 text-info" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-text-primary">
                        System Memory
                      </h3>
                      <p className="text-text-muted">
                        {formatBytes(hardware.memory.totalBytes)} Total
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Memory Usage Bar */}
                    <div>
                      <div className="flex justify-between text-sm mb-2">
                        <span className="text-text-muted">Memory Usage</span>
                        <span className="text-text-secondary">
                          {formatBytes(hardware.memory.usedBytes)} / {formatBytes(hardware.memory.totalBytes)}
                        </span>
                      </div>
                      <div className="h-3 bg-bg-base rounded-full overflow-hidden">
                        <div
                          className="h-full bg-info rounded-full transition-all"
                          style={{
                            width: `${(hardware.memory.usedBytes / hardware.memory.totalBytes) * 100}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Swap Usage Bar */}
                    {hardware.memory.swapTotalBytes > 0 && (
                      <div>
                        <div className="flex justify-between text-sm mb-2">
                          <span className="text-text-muted">Swap Usage</span>
                          <span className="text-text-secondary">
                            {formatBytes(hardware.memory.swapUsedBytes)} / {formatBytes(hardware.memory.swapTotalBytes)}
                          </span>
                        </div>
                        <div className="h-3 bg-bg-base rounded-full overflow-hidden">
                          <div
                            className="h-full bg-warning rounded-full transition-all"
                            style={{
                              width: `${(hardware.memory.swapUsedBytes / hardware.memory.swapTotalBytes) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="p-4 bg-bg-base rounded-lg">
                      <div className="text-xl font-bold text-text-primary">
                        {formatBytes(hardware.memory.availableBytes)}
                      </div>
                      <div className="text-sm text-text-muted">Available</div>
                    </div>
                    <div className="p-4 bg-bg-base rounded-lg flex items-center gap-2">
                      {hardware.memory.eccEnabled ? (
                        <CheckCircle className="w-5 h-5 text-success" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-text-muted" />
                      )}
                      <div>
                        <div className="text-sm font-medium text-text-primary">
                          {hardware.memory.eccEnabled ? 'ECC Enabled' : 'Non-ECC'}
                        </div>
                        <div className="text-xs text-text-muted">Error Correction</div>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Storage Tab */}
            {activeTab === 'storage' && (
              <div className="space-y-4">
                {hardware.storage.map((disk, idx) => (
                  <Card key={idx}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-warning/10 rounded-lg">
                          <HardDrive className="w-6 h-6 text-warning" />
                        </div>
                        <div>
                          <h3 className="font-medium text-text-primary">{disk.name}</h3>
                          <p className="text-sm text-text-muted">
                            {disk.diskType} • {disk.interface}
                          </p>
                        </div>
                      </div>
                      <Badge variant={disk.smartStatus === 'healthy' ? 'success' : 'default'}>
                        {disk.smartStatus}
                      </Badge>
                    </div>

                    <div className="text-sm text-text-secondary mb-4">
                      Total: {formatBytes(disk.sizeBytes)}
                    </div>

                    {disk.partitions.length > 0 && (
                      <div className="space-y-2">
                        {disk.partitions.map((part, pidx) => (
                          <div key={pidx} className="p-3 bg-bg-base rounded-lg">
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-text-primary">{part.mountPoint || part.name}</span>
                              <span className="text-text-muted">{part.filesystem}</span>
                            </div>
                            <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                              <div
                                className="h-full bg-warning rounded-full"
                                style={{
                                  width: `${(part.usedBytes / part.sizeBytes) * 100}%`,
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-xs text-text-muted mt-1">
                              <span>{formatBytes(part.usedBytes)} used</span>
                              <span>{formatBytes(part.sizeBytes)} total</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
                {hardware.storage.length === 0 && (
                  <Card className="text-center py-8 text-text-muted">
                    No storage devices detected
                  </Card>
                )}
              </div>
            )}

            {/* Network Tab */}
            {activeTab === 'network' && (
              <div className="space-y-4">
                {hardware.network.map((nic, idx) => (
                  <Card key={idx}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-success/10 rounded-lg">
                          <Network className="w-6 h-6 text-success" />
                        </div>
                        <div>
                          <h3 className="font-medium text-text-primary">{nic.name}</h3>
                          <p className="text-sm text-text-muted font-mono">
                            {nic.macAddress}
                          </p>
                        </div>
                      </div>
                      <Badge variant={nic.linkState === 'up' ? 'success' : 'default'}>
                        {nic.linkState}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                      <div>
                        <div className="text-xs text-text-muted">Driver</div>
                        <div className="text-sm text-text-secondary">{nic.driver || '-'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-text-muted">Speed</div>
                        <div className="text-sm text-text-secondary">
                          {nic.speedMbps ? `${nic.speedMbps} Mbps` : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-text-muted">SR-IOV</div>
                        <div className="text-sm text-text-secondary">
                          {nic.sriovCapable ? (
                            <span className="text-success">Capable ({nic.sriovVfs} VFs)</span>
                          ) : (
                            'Not supported'
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-text-muted">PCI Address</div>
                        <div className="text-sm text-text-secondary font-mono">
                          {nic.pciAddress || '-'}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
                {hardware.network.length === 0 && (
                  <Card className="text-center py-8 text-text-muted">
                    No network interfaces detected
                  </Card>
                )}
              </div>
            )}

            {/* GPU Tab */}
            {activeTab === 'gpu' && (
              <div className="space-y-4">
                {hardware.gpus.map((gpu, idx) => (
                  <Card key={idx}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-accent/10 rounded-lg">
                          <Monitor className="w-6 h-6 text-accent" />
                        </div>
                        <div>
                          <h3 className="font-medium text-text-primary">{gpu.name}</h3>
                          <p className="text-sm text-text-muted">{gpu.vendor}</p>
                        </div>
                      </div>
                      <Badge variant={gpu.passthroughCapable ? 'success' : 'default'}>
                        {gpu.passthroughCapable ? 'Passthrough Ready' : 'No Passthrough'}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <div className="text-xs text-text-muted">PCI Address</div>
                        <div className="text-sm text-text-secondary font-mono">{gpu.pciAddress}</div>
                      </div>
                      <div>
                        <div className="text-xs text-text-muted">Driver</div>
                        <div className="text-sm text-text-secondary">{gpu.driver || '-'}</div>
                      </div>
                      {gpu.memoryBytes && (
                        <div>
                          <div className="text-xs text-text-muted">Memory</div>
                          <div className="text-sm text-text-secondary">{formatBytes(gpu.memoryBytes)}</div>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
                {hardware.gpus.length === 0 && (
                  <Card className="text-center py-8 text-text-muted">
                    No GPUs detected
                  </Card>
                )}
              </div>
            )}

            {/* PCI Devices Tab */}
            {activeTab === 'pci' && (
              <Card padding="none">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border text-left text-sm text-text-muted">
                      <th className="p-4 font-medium">Address</th>
                      <th className="p-4 font-medium">Class</th>
                      <th className="p-4 font-medium">Device</th>
                      <th className="p-4 font-medium">Driver</th>
                      <th className="p-4 font-medium">IOMMU Group</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(hardware.pciDevices || []).map((device, idx) => (
                      <tr key={idx} className="border-b border-border/50 hover:bg-bg-hover/50">
                        <td className="p-4 font-mono text-sm text-text-secondary">
                          {device.address}
                        </td>
                        <td className="p-4 text-text-secondary">{device.class}</td>
                        <td className="p-4 text-text-primary">{device.device}</td>
                        <td className="p-4 text-text-secondary">{device.driver || '-'}</td>
                        <td className="p-4">
                          {device.iommuGroup !== undefined ? (
                            <Badge variant="success">Group {device.iommuGroup}</Badge>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(hardware.pciDevices || []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-text-muted">
                          No PCI devices found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
