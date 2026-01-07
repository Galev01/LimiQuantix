import { useState, type ChangeEvent } from 'react';
import { RefreshCw, Settings as SettingsIcon, Server, HardDrive, Network, Shield, RotateCcw } from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button, Input, Label } from '@/components/ui';
import { useSettings, useUpdateSettings, useServices, useRestartService } from '@/hooks/useSettings';
import { useHostInfo } from '@/hooks/useHost';
import { useClusterStatus } from '@/hooks/useCluster';
import { cn } from '@/lib/utils';

type Tab = 'general' | 'storage' | 'network' | 'services' | 'about';

export function Settings() {
  const { data: settings, isLoading, refetch, isFetching } = useSettings();
  const { data: hostInfo } = useHostInfo();
  const { data: clusterStatus } = useClusterStatus();
  const { data: servicesData } = useServices();
  const updateSettingsMutation = useUpdateSettings();
  const restartServiceMutation = useRestartService();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // Form state
  const [nodeName, setNodeName] = useState(settings?.node_name || '');
  const [logLevel, setLogLevel] = useState(settings?.log_level || 'info');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <SettingsIcon className="w-4 h-4" /> },
    { id: 'storage', label: 'Storage', icon: <HardDrive className="w-4 h-4" /> },
    { id: 'network', label: 'Network', icon: <Network className="w-4 h-4" /> },
    { id: 'services', label: 'Services', icon: <Server className="w-4 h-4" /> },
    { id: 'about', label: 'About', icon: <Shield className="w-4 h-4" /> },
  ];

  const handleSaveGeneral = () => {
    updateSettingsMutation.mutate({
      node_name: nodeName,
      log_level: logLevel,
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header
        title="Settings"
        subtitle="Configure your Quantix host"
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
          <div className="text-center text-text-muted py-12">Loading settings...</div>
        ) : (
          <>
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Node Configuration</h3>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="nodeName">Node Name</Label>
                      <Input
                        id="nodeName"
                        value={nodeName}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setNodeName(e.target.value)}
                        placeholder="Enter node name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="nodeId">Node ID</Label>
                      <Input
                        id="nodeId"
                        value={settings?.node_id || ''}
                        disabled
                        className="bg-bg-base"
                      />
                      <p className="text-xs text-text-muted mt-1">This ID is auto-generated and cannot be changed</p>
                    </div>
                    <div>
                      <Label htmlFor="logLevel">Log Level</Label>
                      <select
                        id="logLevel"
                        value={logLevel}
                        onChange={(e) => setLogLevel(e.target.value)}
                        className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                      >
                        <option value="error">Error</option>
                        <option value="warn">Warning</option>
                        <option value="info">Info</option>
                        <option value="debug">Debug</option>
                        <option value="trace">Trace</option>
                      </select>
                    </div>
                    <Button onClick={handleSaveGeneral} disabled={updateSettingsMutation.isPending}>
                      {updateSettingsMutation.isPending ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </Card>

                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Cluster Status</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-text-muted">Mode</span>
                      <Badge variant={clusterStatus?.mode === 'cluster' ? 'success' : 'default'}>
                        {clusterStatus?.mode === 'cluster' ? 'Cluster Member' : 'Standalone'}
                      </Badge>
                    </div>
                    {clusterStatus?.mode === 'cluster' && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-text-muted">Cluster Name</span>
                          <span className="text-text-primary">{clusterStatus.clusterName}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-text-muted">Controller</span>
                          <span className="text-text-primary">{clusterStatus.controllerUrl}</span>
                        </div>
                      </>
                    )}
                  </div>
                </Card>
              </div>
            )}

            {/* Storage Tab */}
            {activeTab === 'storage' && (
              <div className="space-y-6">
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Storage Defaults</h3>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="defaultPool">Default Storage Pool</Label>
                      <Input
                        id="defaultPool"
                        value={settings?.storage_default_pool || ''}
                        placeholder="default"
                      />
                      <p className="text-xs text-text-muted mt-1">New VMs will use this pool by default</p>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Network Tab */}
            {activeTab === 'network' && (
              <div className="space-y-6">
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Network Defaults</h3>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="defaultBridge">Default Bridge</Label>
                      <Input
                        id="defaultBridge"
                        value={settings?.network_default_bridge || ''}
                        placeholder="br0"
                      />
                      <p className="text-xs text-text-muted mt-1">New VMs will connect to this bridge by default</p>
                    </div>
                  </div>
                </Card>

                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">VNC Configuration</h3>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="vncListen">VNC Listen Address</Label>
                      <Input
                        id="vncListen"
                        value={settings?.vnc_listen_address || '0.0.0.0'}
                        placeholder="0.0.0.0"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="vncPortStart">VNC Port Range Start</Label>
                        <Input
                          id="vncPortStart"
                          type="number"
                          value={settings?.vnc_port_range_start || 5900}
                        />
                      </div>
                      <div>
                        <Label htmlFor="vncPortEnd">VNC Port Range End</Label>
                        <Input
                          id="vncPortEnd"
                          type="number"
                          value={settings?.vnc_port_range_end || 5999}
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Services Tab */}
            {activeTab === 'services' && (
              <div className="space-y-6">
                <Card padding="none">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border text-left text-sm text-text-muted">
                        <th className="p-4 font-medium">Service</th>
                        <th className="p-4 font-medium">Description</th>
                        <th className="p-4 font-medium">Status</th>
                        <th className="p-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {servicesData?.services.map(service => (
                        <tr key={service.name} className="border-b border-border/50 hover:bg-bg-hover/50">
                          <td className="p-4 font-medium text-text-primary">{service.name}</td>
                          <td className="p-4 text-text-secondary">{service.description}</td>
                          <td className="p-4">
                            <Badge variant={service.status === 'running' || service.status === 'active' ? 'success' : 'warning'}>
                              {service.status}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <div className="flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => restartServiceMutation.mutate(service.name)}
                                disabled={restartServiceMutation.isPending}
                              >
                                <RotateCcw className="w-4 h-4" />
                                Restart
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            )}

            {/* About Tab */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">System Information</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Hostname</span>
                      <span className="text-text-primary">{hostInfo?.hostname}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Operating System</span>
                      <span className="text-text-primary">{hostInfo?.osName} {hostInfo?.osVersion}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Kernel</span>
                      <span className="text-text-primary font-mono text-sm">{hostInfo?.kernelVersion}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">CPU</span>
                      <span className="text-text-primary">{hostInfo?.cpuModel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Hypervisor</span>
                      <span className="text-text-primary">{hostInfo?.hypervisorName} {hostInfo?.hypervisorVersion}</span>
                    </div>
                  </div>
                </Card>

                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">API Endpoints</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-text-muted">gRPC</span>
                      <span className="text-text-primary font-mono text-sm">{settings?.grpc_listen}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">HTTP/WebUI</span>
                      <span className="text-text-primary font-mono text-sm">{settings?.http_listen}</span>
                    </div>
                  </div>
                </Card>

                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Quantix-KVM</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Version</span>
                      <span className="text-text-primary">0.1.0-alpha</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Build</span>
                      <span className="text-text-primary font-mono text-sm">dev</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">License</span>
                      <span className="text-text-primary">Apache 2.0</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-sm text-text-muted">
                      Quantix-KVM is an open-source virtualization platform designed to be a modern,
                      fast, and easy-to-use alternative to traditional hypervisor management solutions.
                    </p>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
