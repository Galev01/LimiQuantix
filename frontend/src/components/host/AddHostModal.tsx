import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Server,
  Terminal,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Globe,
  Key,
  FolderTree,
  Database,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { toast } from 'sonner';

interface AddHostModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Types for host discovery
interface StorageInventory {
  local: LocalDisk[];
  nfs: NfsMount[];
  iscsi: IscsiTarget[];
}

interface LocalDisk {
  name: string;
  model: string;
  sizeBytes: number;
  diskType: string;
  interface: string;
  partitions: Partition[];
}

interface Partition {
  name: string;
  mountPoint: string | null;
  sizeBytes: number;
  usedBytes: number;
  filesystem: string;
}

interface NfsMount {
  mountPoint: string;
  server: string;
  exportPath: string;
  sizeBytes: number;
  usedBytes: number;
  availableBytes: number;
}

interface IscsiTarget {
  targetIqn: string;
  portal: string;
  devicePath: string;
  sizeBytes: number;
  lun: number;
}

interface HostDiscovery {
  hostname: string;
  managementIp: string;
  cpu: {
    model: string;
    cores: number;
    threads: number;
    sockets: number;
  };
  memory: {
    totalBytes: number;
    availableBytes: number;
  };
  storage: StorageInventory;
  network: {
    name: string;
    macAddress: string;
    speedMbps: number;
  }[];
  gpus: {
    name: string;
    vendor: string;
  }[];
}

type Step = 'input' | 'connecting' | 'discovery' | 'confirm' | 'success' | 'error';

export function AddHostModal({ isOpen, onClose }: AddHostModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [hostUrl, setHostUrl] = useState('');
  const [registrationToken, setRegistrationToken] = useState('');
  const [selectedCluster, setSelectedCluster] = useState('default');
  const [discoveryData, setDiscoveryData] = useState<HostDiscovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep('input');
      setHostUrl('');
      setRegistrationToken('');
      setSelectedCluster('default');
      setDiscoveryData(null);
      setError(null);
    }
  }, [isOpen]);

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Connect to host and discover resources
  const handleConnect = async () => {
    if (!hostUrl.trim() || !registrationToken.trim()) {
      setError('Please enter both host URL and registration token');
      return;
    }

    setStep('connecting');
    setError(null);
    setIsLoading(true);

    try {
      // Normalize the host URL
      let url = hostUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }
      if (!url.includes(':')) {
        url = `${url}:8443`; // Default port for node daemon
      }

      // First, validate the token with the host
      const tokenResponse = await fetch(`${url}/api/v1/registration/token`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${registrationToken.trim()}`,
        },
      });

      if (!tokenResponse.ok) {
        throw new Error('Invalid or expired registration token');
      }

      // Token is valid, now get full discovery data
      const discoveryResponse = await fetch(`${url}/api/v1/registration/discovery`, {
        headers: {
          'Authorization': `Bearer ${registrationToken.trim()}`,
        },
      });

      if (!discoveryResponse.ok) {
        throw new Error('Failed to discover host resources');
      }

      const discovery: HostDiscovery = await discoveryResponse.json();
      setDiscoveryData(discovery);
      setStep('discovery');
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to host');
      setStep('error');
    } finally {
      setIsLoading(false);
    }
  };

  // Confirm and add host to cluster
  const handleConfirmAdd = async () => {
    if (!discoveryData) return;

    setIsLoading(true);
    setStep('confirm');

    try {
      // Register the host with the control plane
      const response = await fetch('/api/nodes/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          hostname: discoveryData.hostname,
          managementIp: discoveryData.managementIp,
          hostUrl: hostUrl.trim(),
          registrationToken: registrationToken.trim(),
          clusterId: selectedCluster,
          resources: {
            cpu: discoveryData.cpu,
            memory: discoveryData.memory,
            storage: discoveryData.storage,
            network: discoveryData.network,
            gpus: discoveryData.gpus,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to register host');
      }

      setStep('success');
      toast.success(`Host ${discoveryData.hostname} added to cluster successfully`);
    } catch (err) {
      console.error('Registration error:', err);
      setError(err instanceof Error ? err.message : 'Failed to add host to cluster');
      setStep('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    setStep('input');
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className="bg-bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Server className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Add Host to Cluster</h2>
                <p className="text-sm text-text-muted">
                  {step === 'input' && 'Connect to a Quantix-OS host using its registration token'}
                  {step === 'connecting' && 'Connecting to host...'}
                  {step === 'discovery' && 'Review discovered resources'}
                  {step === 'confirm' && 'Adding host to cluster...'}
                  {step === 'success' && 'Host added successfully!'}
                  {step === 'error' && 'Connection failed'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[65vh]">
            {/* Step 1: Input */}
            {step === 'input' && (
              <div className="space-y-6">
                {/* Instructions */}
                <div className="p-4 bg-bg-base rounded-xl space-y-3">
                  <h4 className="font-medium text-text-primary flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    Get the Registration Token from the Host
                  </h4>
                  <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary">
                    <li>On the Quantix-OS host console, press <kbd className="px-1.5 py-0.5 bg-bg-elevated rounded text-xs font-mono">F4</kbd></li>
                    <li>Select "Generate Registration Token"</li>
                    <li>The token will be displayed (valid for 1 hour)</li>
                    <li>Enter the host's IP address and token below</li>
                  </ol>
                </div>

                {/* Host URL */}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    <Globe className="w-4 h-4 inline mr-1" />
                    Host IP Address or URL
                  </label>
                  <input
                    type="text"
                    value={hostUrl}
                    onChange={(e) => setHostUrl(e.target.value)}
                    placeholder="e.g., 192.168.1.100 or hypervisor-01.local"
                    className={cn(
                      'w-full px-4 py-3 rounded-lg',
                      'bg-bg-base border border-border',
                      'text-text-primary placeholder:text-text-muted',
                      'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                      'font-mono text-sm',
                    )}
                  />
                  <p className="text-xs text-text-muted mt-1">
                    The node daemon runs on port 8443 by default
                  </p>
                </div>

                {/* Registration Token */}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    <Key className="w-4 h-4 inline mr-1" />
                    Registration Token
                  </label>
                  <input
                    type="text"
                    value={registrationToken}
                    onChange={(e) => setRegistrationToken(e.target.value.toUpperCase())}
                    placeholder="QUANTIX-XXXX-XXXX-XXXX"
                    className={cn(
                      'w-full px-4 py-3 rounded-lg',
                      'bg-bg-base border border-border',
                      'text-text-primary placeholder:text-text-muted',
                      'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                      'font-mono text-sm tracking-wide',
                    )}
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Token is generated on the host and expires after 1 hour
                  </p>
                </div>

                {/* Cluster Selection */}
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    <FolderTree className="w-4 h-4 inline mr-1" />
                    Target Cluster
                  </label>
                  <select
                    value={selectedCluster}
                    onChange={(e) => setSelectedCluster(e.target.value)}
                    className={cn(
                      'w-full px-4 py-3 rounded-lg',
                      'bg-bg-base border border-border',
                      'text-text-primary',
                      'focus:outline-none focus:border-accent',
                    )}
                  >
                    <option value="default">Default Cluster</option>
                    <option value="production">Production</option>
                    <option value="development">Development</option>
                    <option value="edge">Edge / Remote</option>
                  </select>
                  <p className="text-xs text-text-muted mt-1">
                    The host will join this cluster and share its resources
                  </p>
                </div>

                {error && (
                  <div className="p-3 bg-error/10 border border-error/30 rounded-lg flex items-center gap-2 text-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{error}</span>
                  </div>
                )}

                <Button
                  onClick={handleConnect}
                  disabled={!hostUrl.trim() || !registrationToken.trim()}
                  className="w-full"
                >
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Connect & Discover Resources
                </Button>
              </div>
            )}

            {/* Step 2: Connecting */}
            {step === 'connecting' && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-accent mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">Connecting to Host</h3>
                <p className="text-sm text-text-muted">Validating token and discovering resources...</p>
              </div>
            )}

            {/* Step 3: Discovery - Show resources */}
            {step === 'discovery' && discoveryData && (
              <div className="space-y-6">
                {/* Host Summary */}
                <div className="p-4 bg-success/10 border border-success/30 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-5 h-5 text-success" />
                    <span className="font-medium text-success">Host Connected Successfully</span>
                  </div>
                  <p className="text-sm text-text-secondary">
                    <strong>{discoveryData.hostname}</strong> ({discoveryData.managementIp}) is ready to join the cluster.
                  </p>
                </div>

                {/* Resource Summary Cards */}
                <div className="grid grid-cols-2 gap-4">
                  {/* CPU */}
                  <div className="p-4 bg-bg-base rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <Cpu className="w-4 h-4 text-accent" />
                      <span className="font-medium text-text-primary">CPU</span>
                    </div>
                    <p className="text-sm text-text-secondary">{discoveryData.cpu.model}</p>
                    <p className="text-xs text-text-muted">
                      {discoveryData.cpu.cores} cores / {discoveryData.cpu.threads} threads
                    </p>
                  </div>

                  {/* Memory */}
                  <div className="p-4 bg-bg-base rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <MemoryStick className="w-4 h-4 text-purple-500" />
                      <span className="font-medium text-text-primary">Memory</span>
                    </div>
                    <p className="text-sm text-text-secondary">{formatBytes(discoveryData.memory.totalBytes)}</p>
                    <p className="text-xs text-text-muted">
                      {formatBytes(discoveryData.memory.availableBytes)} available
                    </p>
                  </div>
                </div>

                {/* Storage */}
                <div className="p-4 bg-bg-base rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <HardDrive className="w-4 h-4 text-orange-500" />
                    <span className="font-medium text-text-primary">Storage</span>
                  </div>
                  
                  {/* Local Storage */}
                  {discoveryData.storage.local.length > 0 && (
                    <div className="mb-3">
                      <h5 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">Local Disks</h5>
                      <div className="space-y-2">
                        {discoveryData.storage.local.map((disk, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-bg-surface rounded-lg">
                            <div>
                              <span className="text-sm text-text-primary font-mono">{disk.name}</span>
                              <span className="text-xs text-text-muted ml-2">{disk.diskType}</span>
                            </div>
                            <span className="text-sm text-text-secondary">{formatBytes(disk.sizeBytes)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* NFS Mounts */}
                  {discoveryData.storage.nfs.length > 0 && (
                    <div className="mb-3">
                      <h5 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">NFS Mounts</h5>
                      <div className="space-y-2">
                        {discoveryData.storage.nfs.map((mount, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-bg-surface rounded-lg">
                            <div>
                              <span className="text-sm text-text-primary font-mono">{mount.server}:{mount.exportPath}</span>
                              <span className="text-xs text-text-muted block">{mount.mountPoint}</span>
                            </div>
                            <span className="text-sm text-text-secondary">{formatBytes(mount.sizeBytes)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* iSCSI Targets */}
                  {discoveryData.storage.iscsi.length > 0 && (
                    <div>
                      <h5 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">iSCSI Targets</h5>
                      <div className="space-y-2">
                        {discoveryData.storage.iscsi.map((target, i) => (
                          <div key={i} className="flex items-center justify-between p-2 bg-bg-surface rounded-lg">
                            <div>
                              <span className="text-sm text-text-primary font-mono">{target.targetIqn}</span>
                              <span className="text-xs text-text-muted block">{target.devicePath}</span>
                            </div>
                            <span className="text-sm text-text-secondary">{formatBytes(target.sizeBytes)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {discoveryData.storage.local.length === 0 && 
                   discoveryData.storage.nfs.length === 0 && 
                   discoveryData.storage.iscsi.length === 0 && (
                    <p className="text-sm text-text-muted">No storage devices detected</p>
                  )}
                </div>

                {/* Network */}
                {discoveryData.network.length > 0 && (
                  <div className="p-4 bg-bg-base rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <Network className="w-4 h-4 text-blue-500" />
                      <span className="font-medium text-text-primary">Network Interfaces</span>
                    </div>
                    <div className="space-y-2">
                      {discoveryData.network.map((nic, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-bg-surface rounded-lg">
                          <div>
                            <span className="text-sm text-text-primary font-mono">{nic.name}</span>
                            <span className="text-xs text-text-muted ml-2">{nic.macAddress}</span>
                          </div>
                          <span className="text-sm text-text-secondary">{nic.speedMbps} Mbps</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* GPUs */}
                {discoveryData.gpus.length > 0 && (
                  <div className="p-4 bg-bg-base rounded-xl">
                    <div className="flex items-center gap-2 mb-3">
                      <Database className="w-4 h-4 text-green-500" />
                      <span className="font-medium text-text-primary">GPUs</span>
                    </div>
                    <div className="space-y-2">
                      {discoveryData.gpus.map((gpu, i) => (
                        <div key={i} className="p-2 bg-bg-surface rounded-lg">
                          <span className="text-sm text-text-primary">{gpu.name}</span>
                          <span className="text-xs text-text-muted ml-2">{gpu.vendor}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cluster Selection Confirmation */}
                <div className="p-4 bg-accent/10 border border-accent/30 rounded-xl">
                  <p className="text-sm text-text-secondary">
                    This host will join the <strong className="text-accent">{selectedCluster}</strong> cluster and share all discovered resources.
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={handleRetry} className="flex-1">
                    Back
                  </Button>
                  <Button onClick={handleConfirmAdd} disabled={isLoading} className="flex-1">
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                    )}
                    Add Host to Cluster
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Confirm/Loading */}
            {step === 'confirm' && (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-12 h-12 animate-spin text-accent mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">Adding Host to Cluster</h3>
                <p className="text-sm text-text-muted">Registering host and configuring resources...</p>
              </div>
            )}

            {/* Step 5: Success */}
            {step === 'success' && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                </div>
                <h3 className="text-lg font-medium text-text-primary mb-2">Host Added Successfully!</h3>
                <p className="text-sm text-text-muted mb-6">
                  {discoveryData?.hostname} is now part of the {selectedCluster} cluster.
                </p>
                <Button onClick={onClose}>
                  Close
                </Button>
              </div>
            )}

            {/* Step 6: Error */}
            {step === 'error' && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 rounded-full bg-error/20 flex items-center justify-center mb-4">
                  <AlertCircle className="w-8 h-8 text-error" />
                </div>
                <h3 className="text-lg font-medium text-text-primary mb-2">Connection Failed</h3>
                <p className="text-sm text-text-muted text-center mb-6 max-w-md">
                  {error || 'Unable to connect to the host. Please verify the IP address and registration token.'}
                </p>
                <div className="flex gap-3">
                  <Button variant="secondary" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleRetry}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Try Again
                  </Button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
