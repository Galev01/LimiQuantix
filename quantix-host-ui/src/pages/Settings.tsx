import { useState, useEffect, type ChangeEvent } from 'react';
import { RefreshCw, Settings as SettingsIcon, Server, HardDrive, Network, Shield, Lock, Upload, Key, Globe, Terminal, Unplug, Link2, Clock, AlertTriangle, CheckCircle2, Copy, Check, KeyRound, Plug, RotateCcw, Database, Disc, Share2, Loader2 } from 'lucide-react';
import { Header } from '@/components/layout';
import { Card, Badge, Button, Input, Label } from '@/components/ui';
import { useSettings, useUpdateSettings, useServices, useRestartService, useCertificateInfo, useGenerateSelfSigned, useResetCertificate, useSshStatus, useEnableSsh, useDisableSsh } from '@/hooks/useSettings';
import { useHostInfo, useHardwareInventory } from '@/hooks/useHost';
import { useClusterStatus, useTestConnection, useGenerateToken, useLeaveCluster } from '@/hooks/useCluster';
import { useStoragePools, useLocalDevices, useInitializeDevice } from '@/hooks/useStorage';
import { cn, formatBytes } from '@/lib/utils';
import { toast } from '@/lib/toast';

type Tab = 'general' | 'storage' | 'network' | 'security' | 'services' | 'about';

export function Settings() {
  const { data: settings, isLoading, refetch, isFetching } = useSettings();
  const { data: hostInfo } = useHostInfo();
  const { data: clusterStatus } = useClusterStatus();
  const { data: servicesData } = useServices();
  const { data: certInfo } = useCertificateInfo();
  const { data: sshStatus } = useSshStatus();
  const updateSettingsMutation = useUpdateSettings();
  const restartServiceMutation = useRestartService();
  const generateSelfSignedMutation = useGenerateSelfSigned();
  const resetCertMutation = useResetCertificate();
  const testConnectionMutation = useTestConnection();
  const generateTokenMutation = useGenerateToken();
  const leaveClusterMutation = useLeaveCluster();
  const enableSshMutation = useEnableSsh();
  const disableSshMutation = useDisableSsh();
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // Form state
  const [nodeName, setNodeName] = useState(settings?.node_name || '');
  const [logLevel, setLogLevel] = useState(settings?.log_level || 'info');

  // Cluster test form state
  const [showTestForm, setShowTestForm] = useState(false);
  const [testUrl, setTestUrl] = useState('');
  
  // Generated token state
  const [generatedToken, setGeneratedToken] = useState<{
    token: string;
    nodeId: string;
    hostName: string;
    managementIp: string;
    expiresAt: string;
  } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  // SSH form state
  const [sshDuration, setSshDuration] = useState(30);

  // Update form when settings load
  useEffect(() => {
    if (settings) {
      setNodeName(settings.node_name || '');
      setLogLevel(settings.log_level || 'info');
    }
  }, [settings]);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: 'General', icon: <SettingsIcon className="w-4 h-4" /> },
    { id: 'storage', label: 'Storage', icon: <HardDrive className="w-4 h-4" /> },
    { id: 'network', label: 'Network', icon: <Network className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Lock className="w-4 h-4" /> },
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
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                      <Link2 className="w-5 h-5 text-accent" />
                      Quantix-vDC Cluster
                    </h3>
                    <Badge variant={clusterStatus?.joined || clusterStatus?.mode === 'cluster' ? 'success' : 'default'}>
                      {clusterStatus?.joined || clusterStatus?.mode === 'cluster' ? 'Connected' : 'Standalone'}
                    </Badge>
                  </div>

                  {/* Connected to cluster */}
                  {(clusterStatus?.joined || clusterStatus?.mode === 'cluster') ? (
                    <div className="space-y-4">
                      <div className="p-4 bg-success/10 border border-success/20 rounded-lg">
                        <div className="flex items-center gap-2 text-success mb-2">
                          <CheckCircle2 className="w-5 h-5" />
                          <span className="font-medium">Connected to Quantix-vDC</span>
                        </div>
                        <p className="text-sm text-text-muted">
                          This host is managed by a Quantix-vDC control plane.
                        </p>
                      </div>
                      <div className="grid gap-3">
                        {clusterStatus?.clusterName && (
                          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                            <span className="text-text-muted">Cluster Name</span>
                            <span className="text-text-primary font-medium">{clusterStatus.clusterName}</span>
                          </div>
                        )}
                        {clusterStatus?.controllerUrl && (
                          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                            <span className="text-text-muted">Controller URL</span>
                            <span className="text-text-primary font-mono text-sm">{clusterStatus.controllerUrl}</span>
                          </div>
                        )}
                        {clusterStatus?.control_plane_address && (
                          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                            <span className="text-text-muted">Control Plane</span>
                            <span className="text-text-primary font-mono text-sm">{clusterStatus.control_plane_address}</span>
                          </div>
                        )}
                        <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                          <span className="text-text-muted">Connection Status</span>
                          <Badge variant={clusterStatus?.status === 'connected' ? 'success' : 'warning'}>
                            {clusterStatus?.status || 'Unknown'}
                          </Badge>
                        </div>
                        {clusterStatus?.last_heartbeat && (
                          <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                            <span className="text-text-muted">Last Heartbeat</span>
                            <span className="text-text-primary text-sm">
                              {new Date(clusterStatus.last_heartbeat).toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="pt-4 border-t border-border">
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (confirm('Are you sure you want to leave the cluster? This will put the host in standalone mode.')) {
                              leaveClusterMutation.mutate();
                            }
                          }}
                          disabled={leaveClusterMutation.isPending}
                          className="text-error hover:bg-error/10"
                        >
                          <Unplug className="w-4 h-4" />
                          {leaveClusterMutation.isPending ? 'Leaving...' : 'Leave Cluster'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Standalone mode - show token generation and test connection */
                    <div className="space-y-4">
                      <div className="p-4 bg-bg-base rounded-lg">
                        <p className="text-text-muted text-sm">
                          This host is running in standalone mode. To add this host to a Quantix-vDC cluster:
                        </p>
                        <ol className="text-text-muted text-sm mt-2 list-decimal list-inside space-y-1">
                          <li>Generate a registration token below</li>
                          <li>Copy the token and host information</li>
                          <li>In the Quantix-vDC console, add this host using the token</li>
                        </ol>
                      </div>

                      {/* Generated Token Display */}
                      {generatedToken && (
                        <div className="p-4 border border-accent/30 rounded-lg bg-accent/5 space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="font-medium text-text-primary flex items-center gap-2">
                              <Key className="w-4 h-4 text-accent" />
                              Registration Token
                            </h4>
                            <button
                              onClick={() => setGeneratedToken(null)}
                              className="text-text-muted hover:text-text-primary text-sm"
                            >
                              ✕
                            </button>
                          </div>
                          
                          <div className="relative">
                            <code className="block p-3 bg-bg-base rounded-lg font-mono text-sm text-text-primary break-all border border-border">
                              {generatedToken.token}
                            </code>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="absolute top-1 right-1"
                              onClick={async () => {
                                await navigator.clipboard.writeText(generatedToken.token);
                                setTokenCopied(true);
                                toast.success('Token copied to clipboard');
                                setTimeout(() => setTokenCopied(false), 2000);
                              }}
                            >
                              {tokenCopied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="p-2 bg-bg-base rounded">
                              <span className="text-text-muted">Node ID:</span>
                              <span className="text-text-primary ml-2 font-mono">{generatedToken.nodeId.slice(0, 12)}...</span>
                            </div>
                            <div className="p-2 bg-bg-base rounded">
                              <span className="text-text-muted">Hostname:</span>
                              <span className="text-text-primary ml-2">{generatedToken.hostName}</span>
                            </div>
                            <div className="p-2 bg-bg-base rounded">
                              <span className="text-text-muted">IP:</span>
                              <span className="text-text-primary ml-2 font-mono">{generatedToken.managementIp}</span>
                            </div>
                            <div className="p-2 bg-bg-base rounded">
                              <span className="text-text-muted">Expires:</span>
                              <span className="text-text-primary ml-2">{new Date(generatedToken.expiresAt).toLocaleString()}</span>
                            </div>
                          </div>

                          <p className="text-xs text-text-muted">
                            Use this token in the Quantix-vDC console to add this host to your cluster.
                          </p>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            generateTokenMutation.mutate(undefined, {
                              onSuccess: (data) => {
                                setGeneratedToken(data);
                              }
                            });
                          }}
                          disabled={generateTokenMutation.isPending}
                        >
                          <KeyRound className="w-4 h-4" />
                          {generateTokenMutation.isPending ? 'Generating...' : 'Generate Registration Token'}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => setShowTestForm(!showTestForm)}
                        >
                          <Plug className="w-4 h-4" />
                          Test Connection
                        </Button>
                      </div>

                      {/* Test Connection Form */}
                      {showTestForm && (
                        <div className="space-y-4 p-4 border border-border rounded-lg">
                          <h4 className="font-medium text-text-primary">Test vDC Connection</h4>
                          <div>
                            <Label htmlFor="testUrl">Control Plane URL</Label>
                            <Input
                              id="testUrl"
                              value={testUrl}
                              onChange={(e: ChangeEvent<HTMLInputElement>) => setTestUrl(e.target.value)}
                              placeholder="https://vdc.example.com:8443"
                            />
                            <p className="text-xs text-text-muted mt-1">
                              Test connectivity to your Quantix-vDC control plane
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                testConnectionMutation.mutate({ controlPlaneUrl: testUrl });
                              }}
                              disabled={testConnectionMutation.isPending || !testUrl}
                            >
                              {testConnectionMutation.isPending ? 'Testing...' : 'Test Connection'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setShowTestForm(false);
                                setTestUrl('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                          {testConnectionMutation.isSuccess && (
                            <div className={cn(
                              'p-3 rounded-lg flex items-center gap-2',
                              testConnectionMutation.data?.success 
                                ? 'bg-success/10 text-success' 
                                : 'bg-error/10 text-error'
                            )}>
                              {testConnectionMutation.data?.success ? (
                                <CheckCircle2 className="w-4 h-4" />
                              ) : (
                                <AlertTriangle className="w-4 h-4" />
                              )}
                              <span className="text-sm">{testConnectionMutation.data?.message}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              </div>
            )}

            {/* Storage Tab */}
            {activeTab === 'storage' && (
              <StorageSettingsTab settings={settings} hostInfo={hostInfo} />
            )}

            {/* Network Tab */}
            {activeTab === 'network' && (
              <NetworkSettingsTab settings={settings} hostInfo={hostInfo} />
            )}

            {/* Security Tab */}
            {activeTab === 'security' && (
              <div className="space-y-6">
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <Key className="w-5 h-5 text-accent" />
                    TLS Certificate
                  </h3>
                  {certInfo ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                          <span className="text-text-muted">Mode</span>
                          <Badge variant={certInfo.mode === 'acme' ? 'success' : certInfo.mode === 'manual' ? 'info' : 'default'}>
                            {certInfo.mode === 'self-signed' ? 'Self-Signed' : 
                             certInfo.mode === 'acme' ? 'Let\'s Encrypt' : 'Custom'}
                          </Badge>
                        </div>
                        <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                          <span className="text-text-muted">Expires</span>
                          <span className={cn(
                            'text-text-primary font-medium',
                            certInfo.daysUntilExpiry < 30 && 'text-warning',
                            certInfo.daysUntilExpiry < 7 && 'text-error'
                          )}>
                            {certInfo.daysUntilExpiry} days
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-2 border-b border-border/50">
                          <span className="text-text-muted">Issuer</span>
                          <span className="text-text-primary font-mono">{certInfo.issuer}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-border/50">
                          <span className="text-text-muted">Subject</span>
                          <span className="text-text-primary font-mono">{certInfo.subject}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-border/50">
                          <span className="text-text-muted">Valid From</span>
                          <span className="text-text-primary">{certInfo.validFrom}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-border/50">
                          <span className="text-text-muted">Valid Until</span>
                          <span className="text-text-primary">{certInfo.validUntil}</span>
                        </div>
                        <div className="flex justify-between py-2">
                          <span className="text-text-muted">Fingerprint</span>
                          <span className="text-text-primary font-mono text-xs">{certInfo.fingerprint}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4 text-text-muted">
                      Loading certificate information...
                    </div>
                  )}
                </Card>

                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-info" />
                    Certificate Actions
                  </h3>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-text-primary mb-2">Self-Signed</h4>
                      <p className="text-sm text-text-muted mb-3">
                        Generate a new self-signed certificate for this host.
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => generateSelfSignedMutation.mutate(hostInfo?.hostname)}
                        disabled={generateSelfSignedMutation.isPending}
                      >
                        {generateSelfSignedMutation.isPending ? 'Generating...' : 'Regenerate'}
                      </Button>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-text-primary mb-2">Upload Custom</h4>
                      <p className="text-sm text-text-muted mb-3">
                        Upload your own certificate and private key.
                      </p>
                      <Button variant="secondary" size="sm">
                        <Upload className="w-4 h-4" />
                        Upload
                      </Button>
                    </div>
                    <div className="p-4 border border-border rounded-lg">
                      <h4 className="font-medium text-text-primary mb-2">Reset Default</h4>
                      <p className="text-sm text-text-muted mb-3">
                        Reset to the default self-signed certificate.
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetCertMutation.mutate()}
                        disabled={resetCertMutation.isPending}
                      >
                        {resetCertMutation.isPending ? 'Resetting...' : 'Reset'}
                      </Button>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                      <Terminal className="w-5 h-5 text-warning" />
                      SSH Access
                    </h3>
                    <Badge variant={sshStatus?.enabled ? 'success' : 'default'}>
                      {sshStatus?.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>

                  {sshStatus?.enabled ? (
                    <div className="space-y-4">
                      {/* SSH is enabled */}
                      <div className={cn(
                        'p-4 rounded-lg border',
                        sshStatus.timerActive 
                          ? 'bg-warning/10 border-warning/20'
                          : 'bg-success/10 border-success/20'
                      )}>
                        <div className="flex items-center gap-2 mb-2">
                          {sshStatus.timerActive ? (
                            <>
                              <Clock className="w-5 h-5 text-warning" />
                              <span className="font-medium text-warning">Time-Limited SSH Active</span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-5 h-5 text-success" />
                              <span className="font-medium text-success">SSH Enabled</span>
                            </>
                          )}
                        </div>
                        {sshStatus.timerActive && sshStatus.remainingMinutes !== undefined && (
                          <p className="text-sm text-text-muted">
                            SSH access will be automatically disabled in{' '}
                            <span className="font-medium text-warning">
                              {sshStatus.remainingMinutes} minute{sshStatus.remainingMinutes !== 1 ? 's' : ''}
                            </span>
                          </p>
                        )}
                        {sshStatus.expiresAt && (
                          <p className="text-xs text-text-muted mt-1">
                            Expires: {new Date(sshStatus.expiresAt).toLocaleString()}
                          </p>
                        )}
                      </div>

                      <div className="flex justify-between p-3 bg-bg-base rounded-lg">
                        <span className="text-text-muted">SSH Port</span>
                        <span className="text-text-primary font-mono">{sshStatus.port || 22}</span>
                      </div>

                      <div className="p-4 bg-bg-base rounded-lg">
                        <p className="text-sm text-text-muted mb-3">
                          Connect using: <code className="bg-bg-surface px-2 py-1 rounded text-text-primary">
                            ssh root@{hostInfo?.managementIp || 'host-ip'}
                          </code>
                        </p>
                      </div>

                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (confirm('Are you sure you want to disable SSH access?')) {
                            disableSshMutation.mutate();
                          }
                        }}
                        disabled={disableSshMutation.isPending}
                        className="text-error hover:bg-error/10"
                      >
                        <Unplug className="w-4 h-4" />
                        {disableSshMutation.isPending ? 'Disabling...' : 'Disable SSH'}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* SSH is disabled */}
                      <div className="p-4 bg-bg-base rounded-lg">
                        <div className="flex items-center gap-2 text-text-muted mb-2">
                          <AlertTriangle className="w-5 h-5" />
                          <span className="font-medium">SSH is Disabled</span>
                        </div>
                        <p className="text-sm text-text-muted">
                          Enable SSH access for remote administration. For security, 
                          it's recommended to use time-limited sessions.
                        </p>
                      </div>

                      <div>
                        <Label htmlFor="sshDuration">Session Duration (minutes)</Label>
                        <div className="flex gap-2 mt-1">
                          {[15, 30, 60, 120].map((mins) => (
                            <button
                              key={mins}
                              onClick={() => setSshDuration(mins)}
                              className={cn(
                                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                                sshDuration === mins
                                  ? 'bg-accent text-white'
                                  : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                              )}
                            >
                              {mins}m
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-text-muted mt-2">
                          SSH will be automatically disabled after this duration
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          onClick={() => enableSshMutation.mutate({ durationMinutes: sshDuration })}
                          disabled={enableSshMutation.isPending}
                        >
                          <Terminal className="w-4 h-4" />
                          {enableSshMutation.isPending ? 'Enabling...' : `Enable SSH (${sshDuration}m)`}
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>

                {/* Password Reset Placeholder */}
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-warning" />
                    Password Management
                  </h3>
                  <div className="p-4 bg-bg-base rounded-lg border border-border/50">
                    <div className="flex items-center gap-2 text-text-muted mb-2">
                      <Clock className="w-5 h-5" />
                      <span className="font-medium">Coming Soon</span>
                    </div>
                    <p className="text-sm text-text-muted">
                      Password reset functionality will be available in a future release.
                      This will allow you to change the root password for console and SSH access.
                    </p>
                  </div>
                  <div className="mt-4">
                    <Button variant="secondary" disabled>
                      <KeyRound className="w-4 h-4" />
                      Reset Password
                    </Button>
                  </div>
                </Card>

                {/* MFA Placeholder */}
                <Card>
                  <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-info" />
                    Multi-Factor Authentication (MFA)
                  </h3>
                  <div className="p-4 bg-bg-base rounded-lg border border-border/50">
                    <div className="flex items-center gap-2 text-text-muted mb-2">
                      <Clock className="w-5 h-5" />
                      <span className="font-medium">Coming Soon</span>
                    </div>
                    <p className="text-sm text-text-muted">
                      Multi-factor authentication will add an extra layer of security to your host.
                      Support for TOTP (Time-based One-Time Password) apps like Google Authenticator 
                      and hardware keys will be available in a future release.
                    </p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Button variant="secondary" disabled>
                      <Shield className="w-4 h-4" />
                      Configure MFA
                    </Button>
                    <Button variant="ghost" disabled>
                      Reset MFA
                    </Button>
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
                  <h3 className="text-lg font-semibold text-text-primary mb-4">QHMI (Quantix Host Management Interface)</h3>
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
                      <span className="text-text-muted">Build Date</span>
                      <span className="text-text-primary font-mono text-sm">{new Date().toISOString().split('T')[0]}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">License</span>
                      <span className="text-text-primary">Apache 2.0</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-border">
                    <p className="text-sm text-text-muted">
                      QHMI is the host management interface for Quantix-OS, providing a modern web-based 
                      console for managing individual hypervisor hosts. Part of the Quantix-KVM open-source 
                      virtualization platform.
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

// Storage Settings Tab Component
interface StorageSettingsTabProps {
  settings: ReturnType<typeof useSettings>['data'];
  hostInfo: ReturnType<typeof useHostInfo>['data'];
}

function StorageSettingsTab({ settings: _settings, hostInfo: _hostInfo }: StorageSettingsTabProps) {
  const { data: pools, isLoading: poolsLoading } = useStoragePools();
  const { data: localDevices, isLoading: devicesLoading, refetch: refetchDevices } = useLocalDevices();
  const initializeDeviceMutation = useInitializeDevice();
  
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [poolName, setPoolName] = useState('');
  const [confirmWipe, setConfirmWipe] = useState(false);

  const isLoading = poolsLoading || devicesLoading;

  // Separate pools by type
  const localPools = pools?.filter(p => p.type === 'LOCAL_DIR') || [];
  const sharedPools = pools?.filter(p => p.type !== 'LOCAL_DIR') || [];

  const handleInitializeDevice = async (devicePath: string) => {
    if (!poolName.trim()) {
      toast.error('Please enter a pool name');
      return;
    }
    if (!confirmWipe) {
      toast.error('You must confirm data wipe');
      return;
    }

    try {
      await initializeDeviceMutation.mutateAsync({
        device: devicePath,
        poolName: poolName.trim(),
        filesystem: 'xfs',
        confirmWipe: true,
      });
      setSelectedDevice(null);
      setPoolName('');
      setConfirmWipe(false);
      refetchDevices();
    } catch (error) {
      // Error is handled by mutation
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-muted">Loading storage information...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Physical Disks Section */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Disc className="w-5 h-5 text-accent" />
            Physical Disks
          </h3>
          <Button variant="ghost" size="sm" onClick={() => refetchDevices()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        
        {localDevices && localDevices.length > 0 ? (
          <div className="space-y-3">
            {localDevices.map((device, deviceIdx) => (
              <div 
                key={device.device || `device-${deviceIdx}`}
                className={cn(
                  "p-4 rounded-lg border transition-colors",
                  device.canInitialize 
                    ? "border-border hover:border-accent/50 cursor-pointer" 
                    : "border-border/50 bg-bg-base/50"
                )}
                onClick={() => device.canInitialize && setSelectedDevice(device.device)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      device.deviceType === 'nvme' ? 'bg-accent/10 text-accent' :
                      device.deviceType === 'ssd' ? 'bg-success/10 text-success' :
                      'bg-warning/10 text-warning'
                    )}>
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-text-primary">{device.name || 'Unknown Device'}</div>
                      <div className="text-sm text-text-muted font-mono">{device.device || ''}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-text-primary">{formatBytes(device.totalBytes)}</div>
                    <Badge variant={device.inUse ? 'warning' : 'success'} className="mt-1">
                      {device.inUse ? 'In Use' : 'Available'}
                    </Badge>
                  </div>
                </div>
                
                {/* Partitions */}
                {device.partitions && device.partitions.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <div className="text-xs text-text-muted mb-2">Partitions:</div>
                    <div className="grid gap-2">
                      {device.partitions.map((part, idx) => (
                        <div key={part.device || `part-${idx}`} className="flex items-center justify-between text-sm p-2 bg-bg-base rounded">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-text-secondary">{part.device?.split('/').pop() || 'unknown'}</span>
                            {part.filesystem && (
                              <Badge variant="default" className="text-xs">{part.filesystem}</Badge>
                            )}
                          </div>
                          <div className="text-text-muted">
                            {part.mountPoint ? (
                              <span className="text-text-secondary">{part.mountPoint}</span>
                            ) : (
                              formatBytes(part.sizeBytes)
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Initialize Dialog */}
                {selectedDevice === device.device && device.canInitialize && (
                  <div className="mt-4 pt-4 border-t border-border space-y-4" onClick={(e) => e.stopPropagation()}>
                    <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
                      <div className="flex items-center gap-2 text-warning mb-1">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="font-medium">Warning</span>
                      </div>
                      <p className="text-sm text-text-muted">
                        Initializing this device will erase ALL data on it. This cannot be undone.
                      </p>
                    </div>
                    
                    <div>
                      <Label htmlFor="poolName">Storage Pool Name</Label>
                      <Input
                        id="poolName"
                        value={poolName}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setPoolName(e.target.value)}
                        placeholder="e.g., local-nvme-1"
                      />
                    </div>
                    
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmWipe}
                        onChange={(e) => setConfirmWipe(e.target.checked)}
                        className="w-4 h-4 rounded border-border"
                      />
                      <span className="text-sm text-text-secondary">
                        I understand this will permanently erase all data on this device
                      </span>
                    </label>
                    
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleInitializeDevice(device.device)}
                        disabled={!poolName.trim() || !confirmWipe || initializeDeviceMutation.isPending}
                      >
                        {initializeDeviceMutation.isPending ? 'Initializing...' : 'Initialize as qDV'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setSelectedDevice(null);
                          setPoolName('');
                          setConfirmWipe(false);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-text-muted">
            <HardDrive className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No available physical disks found</p>
            <p className="text-sm">All disks are either in use or too small</p>
          </div>
        )}
      </Card>

      {/* Local Storage Pools */}
      <Card>
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-success" />
          Local Storage Pools (qDV)
        </h3>
        
        {localPools.length > 0 ? (
          <div className="space-y-3">
            {localPools.map((pool, idx) => {
              const usedPercent = pool.totalBytes && pool.totalBytes > 0 
                ? ((pool.usedBytes || 0) / pool.totalBytes) * 100 
                : 0;
              return (
                <div key={pool.poolId || `pool-${idx}`} className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="font-medium text-text-primary">{pool.poolId || 'Unknown Pool'}</div>
                      <div className="text-sm text-text-muted font-mono">{pool.mountPath || ''}</div>
                    </div>
                    <Badge variant="success">{pool.volumeCount ?? 0} volumes</Badge>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">
                        {formatBytes(pool.usedBytes)} / {formatBytes(pool.totalBytes)}
                      </span>
                      <span className={cn(
                        usedPercent > 90 ? 'text-error' :
                        usedPercent > 75 ? 'text-warning' :
                        'text-text-secondary'
                      )}>
                        {usedPercent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full transition-all",
                          usedPercent > 90 ? 'bg-error' :
                          usedPercent > 75 ? 'bg-warning' :
                          'bg-success'
                        )}
                        style={{ width: `${Math.min(usedPercent, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted">
            <Database className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No local storage pools configured</p>
            <p className="text-sm">Initialize a physical disk above to create one</p>
          </div>
        )}
      </Card>

      {/* Shared Storage */}
      <Card>
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Share2 className="w-5 h-5 text-info" />
          Shared Storage (from vDC)
        </h3>
        
        {sharedPools.length > 0 ? (
          <div className="space-y-3">
            {sharedPools.map((pool, idx) => {
              const usedPercent = pool.totalBytes && pool.totalBytes > 0 
                ? ((pool.usedBytes || 0) / pool.totalBytes) * 100 
                : 0;
              return (
                <div key={pool.poolId || `shared-${idx}`} className="p-4 bg-bg-base rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="info">{pool.type || 'UNKNOWN'}</Badge>
                      <span className="font-medium text-text-primary">{pool.poolId || 'Unknown Pool'}</span>
                    </div>
                    <span className="text-sm text-text-muted">{pool.volumeCount ?? 0} volumes</span>
                  </div>
                  <div className="text-sm text-text-muted font-mono mb-2">{pool.mountPath || ''}</div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">
                        {formatBytes(pool.usedBytes)} / {formatBytes(pool.totalBytes)}
                      </span>
                      <span className="text-text-secondary">{usedPercent.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-bg-surface rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-info transition-all"
                        style={{ width: `${Math.min(usedPercent, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted">
            <Share2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No shared storage connected</p>
            <p className="text-sm">Connect this host to a Quantix-vDC to access shared storage</p>
          </div>
        )}
      </Card>
    </div>
  );
}

// Network Settings Tab Component
interface NetworkSettingsTabProps {
  settings: ReturnType<typeof useSettings>['data'];
  hostInfo: ReturnType<typeof useHostInfo>['data'];
}

function NetworkSettingsTab({ settings, hostInfo: _hostInfo }: NetworkSettingsTabProps) {
  const { data: hardware, isLoading } = useHardwareInventory();
  
  // Get physical NICs from hardware inventory
  const physicalNics = hardware?.network?.filter(nic => 
    !nic.name.startsWith('vir') && 
    !nic.name.startsWith('docker') && 
    !nic.name.startsWith('br-') &&
    !nic.name.startsWith('veth') &&
    nic.name !== 'lo'
  ) || [];
  
  // Virtual bridges
  const bridges = hardware?.network?.filter(nic => 
    nic.name.startsWith('br') || nic.name.startsWith('virbr')
  ) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
        <span className="ml-2 text-text-muted">Loading network information...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Physical Uplinks */}
      <Card>
        <h3 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Network className="w-5 h-5 text-accent" />
          Physical Uplinks
        </h3>
        
        {physicalNics.length > 0 ? (
          <div className="space-y-3">
            {physicalNics.map((nic, idx) => (
              <div key={nic.name || `nic-${idx}`} className="p-4 bg-bg-base rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-3 h-3 rounded-full",
                      nic.linkState === 'up' ? 'bg-success' : 'bg-text-muted'
                    )} />
                    <div>
                      <div className="font-medium text-text-primary">{nic.name || 'Unknown'}</div>
                      <div className="text-sm text-text-muted font-mono">{nic.macAddress || 'No MAC'}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge variant={nic.linkState === 'up' ? 'success' : 'default'}>
                      {nic.linkState || 'unknown'}
                    </Badge>
                    {nic.speedMbps && (
                      <div className="text-sm text-text-muted mt-1">{nic.speedMbps} Mbps</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted">
            <Network className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No physical network interfaces found</p>
          </div>
        )}
      </Card>

      {/* Virtual Switches (Bridges) */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Share2 className="w-5 h-5 text-info" />
            vSwitches (Local Bridges)
          </h3>
          <Button variant="secondary" size="sm" disabled>
            Create vSwitch
          </Button>
        </div>
        
        {bridges.length > 0 ? (
          <div className="space-y-3">
            {bridges.map((bridge, idx) => (
              <div key={bridge.name || `bridge-${idx}`} className="p-4 bg-bg-base rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-3 h-3 rounded-full",
                      bridge.linkState === 'up' ? 'bg-success' : 'bg-text-muted'
                    )} />
                    <div>
                      <div className="font-medium text-text-primary">{bridge.name}</div>
                      <div className="text-sm text-text-muted">
                        {bridge.name.startsWith('virbr') ? 'NAT Bridge (libvirt)' : 'Bridge'}
                      </div>
                    </div>
                  </div>
                  <Badge variant={bridge.linkState === 'up' ? 'success' : 'default'}>
                    {bridge.linkState || 'unknown'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-text-muted">
            <Share2 className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No virtual switches configured</p>
            <p className="text-sm">Create a vSwitch to connect VMs to the network</p>
          </div>
        )}
        
        <div className="mt-4 p-3 bg-bg-base rounded-lg border border-border/50">
          <p className="text-sm text-text-muted">
            <strong>Note:</strong> For distributed virtual switches (dvSwitch), manage them from the 
            Quantix-vDC console. Local vSwitches created here are only available on this host.
          </p>
        </div>
      </Card>

      {/* VNC Configuration */}
      <Card>
        <h3 className="text-lg font-semibold text-text-primary mb-4">VNC Configuration</h3>
        <div className="space-y-4">
          <div>
            <Label htmlFor="vncListen">VNC Listen Address</Label>
            <Input
              id="vncListen"
              value={settings?.vnc_listen_address || '0.0.0.0'}
              placeholder="0.0.0.0"
              disabled
            />
            <p className="text-xs text-text-muted mt-1">Address VNC consoles listen on</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="vncPortStart">VNC Port Range Start</Label>
              <Input
                id="vncPortStart"
                type="number"
                value={settings?.vnc_port_range_start || 5900}
                disabled
              />
            </div>
            <div>
              <Label htmlFor="vncPortEnd">VNC Port Range End</Label>
              <Input
                id="vncPortEnd"
                type="number"
                value={settings?.vnc_port_range_end || 5999}
                disabled
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
