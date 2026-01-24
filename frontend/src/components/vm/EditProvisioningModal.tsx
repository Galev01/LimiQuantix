/**
 * EditProvisioningModal - Edit VM Cloud-Init / Provisioning settings
 * 
 * Shows cloud-init configuration for VMs that support it.
 * For non-cloud-init VMs, shows "Not configured" message.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Loader2, Info, Cloud, AlertTriangle, Key, FileText, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { type ApiVM } from '@/hooks/useVMs';

interface EditProvisioningModalProps {
  isOpen: boolean;
  onClose: () => void;
  vm: ApiVM;
  onSave: (settings: ProvisioningSettings) => Promise<void>;
}

interface ProvisioningSettings {
  enabled: boolean;
  hostname: string;
  sshKeys: string[];
  userData: string;
  networkConfig: 'dhcp' | 'static' | 'custom';
}

/**
 * Detect if a VM has cloud-init configured
 * Checks both spec.cloudInit and if created from a cloud image
 */
export function detectCloudInit(vm: ApiVM): { hasCloudInit: boolean; reason: string } {
  // Check if cloudInit is explicitly configured in spec
  if (vm.spec?.cloudInit) {
    return { hasCloudInit: true, reason: 'Cloud-init configuration present in VM spec' };
  }

  // Check if any disk has a backing file that suggests a cloud image
  const hasCloudImageDisk = vm.spec?.disks?.some(disk => {
    const backingFile = (disk as any).backingFile || '';
    return backingFile.toLowerCase().includes('cloud') ||
           backingFile.toLowerCase().includes('generic') ||
           backingFile.endsWith('.qcow2');
  });

  if (hasCloudImageDisk) {
    return { hasCloudInit: true, reason: 'VM created from cloud image' };
  }

  // Check provisioning method via cloudInit in provisioning config
  if (vm.spec?.provisioning?.cloudInit) {
    return { hasCloudInit: true, reason: 'Provisioning method is cloud-init' };
  }

  return { hasCloudInit: false, reason: 'No cloud-init configuration detected' };
}

export function EditProvisioningModal({ isOpen, onClose, vm, onSave }: EditProvisioningModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [hostname, setHostname] = useState('');
  const [sshKeys, setSshKeys] = useState<string[]>([]);
  const [sshKeyInput, setSshKeyInput] = useState('');
  const [userData, setUserData] = useState('');
  const [networkConfig, setNetworkConfig] = useState<'dhcp' | 'static' | 'custom'>('dhcp');
  const [isSaving, setIsSaving] = useState(false);

  // Detect cloud-init support
  const { hasCloudInit, reason } = detectCloudInit(vm);

  // Initialize from VM data
  useEffect(() => {
    if (vm.spec?.cloudInit) {
      setEnabled(true);
      setHostname(vm.spec.cloudInit.hostname || vm.name);
      setSshKeys(vm.spec.cloudInit.sshKeys || []);
      setUserData(vm.spec.cloudInit.userData || '');
      const netConfig = vm.spec.cloudInit.networkConfig;
      if (netConfig === 'dhcp' || netConfig === 'static' || netConfig === 'custom') {
        setNetworkConfig(netConfig);
      } else {
        setNetworkConfig('dhcp');
      }
    } else {
      setEnabled(false);
      setHostname(vm.name);
      setSshKeys([]);
      setUserData('');
      setNetworkConfig('dhcp');
    }
  }, [vm]);

  const handleAddSshKey = () => {
    if (sshKeyInput.trim() && !sshKeys.includes(sshKeyInput.trim())) {
      setSshKeys([...sshKeys, sshKeyInput.trim()]);
      setSshKeyInput('');
    }
  };

  const handleRemoveSshKey = (index: number) => {
    setSshKeys(sshKeys.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        enabled,
        hostname,
        sshKeys,
        userData,
        networkConfig,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
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
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-surface">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-text-primary">Provisioning (Cloud-Init)</h2>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {!hasCloudInit ? (
              /* No Cloud-Init */
              <div className="text-center py-8">
                <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">Cloud-Init Not Configured</h3>
                <p className="text-sm text-text-muted mb-4 max-w-sm mx-auto">
                  This VM was not created from a cloud image and does not have cloud-init configured.
                </p>
                <div className="p-4 bg-bg-base rounded-lg border border-border text-left">
                  <p className="text-xs text-text-muted">
                    <strong>Detection reason:</strong> {reason}
                  </p>
                  <p className="text-xs text-text-muted mt-2">
                    To use cloud-init, create a new VM using a cloud image (Ubuntu Cloud, Debian Generic, etc.)
                    from the Images page.
                  </p>
                </div>
              </div>
            ) : (
              /* Cloud-Init Configuration */
              <>
                {/* Enable Toggle */}
                <div className="flex items-center justify-between p-4 bg-bg-base rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <Cloud className={cn('w-5 h-5', enabled ? 'text-accent' : 'text-text-muted')} />
                    <div>
                      <span className="text-sm font-medium text-text-primary">Cloud-Init</span>
                      <p className="text-xs text-text-muted">
                        Automatic provisioning on first boot
                      </p>
                    </div>
                  </div>
                  <Toggle
                    enabled={enabled}
                    onChange={setEnabled}
                  />
                </div>

                {enabled && (
                  <>
                    {/* Hostname */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        Hostname
                      </label>
                      <input
                        type="text"
                        value={hostname}
                        onChange={(e) => setHostname(e.target.value)}
                        placeholder="my-server"
                        className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                    </div>

                    {/* SSH Keys */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        <Key className="w-4 h-4 inline mr-1" />
                        SSH Public Keys
                      </label>
                      <div className="space-y-2">
                        {sshKeys.map((key, index) => (
                          <div key={index} className="flex items-center gap-2 p-2 bg-bg-base rounded-lg border border-border">
                            <span className="flex-1 text-xs font-mono text-text-secondary truncate">
                              {key.substring(0, 50)}...
                            </span>
                            <button
                              onClick={() => handleRemoveSshKey(index)}
                              className="text-error hover:text-error/80 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={sshKeyInput}
                            onChange={(e) => setSshKeyInput(e.target.value)}
                            placeholder="ssh-rsa AAAA... user@host"
                            className="flex-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                            onKeyDown={(e) => e.key === 'Enter' && handleAddSshKey()}
                          />
                          <Button variant="secondary" size="sm" onClick={handleAddSshKey}>
                            Add
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Network Config */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        <Network className="w-4 h-4 inline mr-1" />
                        Network Configuration
                      </label>
                      <select
                        value={networkConfig}
                        onChange={(e) => setNetworkConfig(e.target.value as any)}
                        className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                      >
                        <option value="dhcp">DHCP (Automatic)</option>
                        <option value="static">Static IP (Configure in User Data)</option>
                        <option value="custom">Custom Network Config</option>
                      </select>
                    </div>

                    {/* User Data */}
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">
                        <FileText className="w-4 h-4 inline mr-1" />
                        User Data (cloud-config)
                      </label>
                      <textarea
                        value={userData}
                        onChange={(e) => setUserData(e.target.value)}
                        placeholder="#cloud-config&#10;packages:&#10;  - nginx&#10;runcmd:&#10;  - systemctl start nginx"
                        rows={6}
                        className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                      <p className="text-xs text-text-muted mt-1">
                        YAML format. Start with #cloud-config for cloud-init scripts.
                      </p>
                    </div>

                    {/* Info box */}
                    <div className="flex items-start gap-3 p-4 bg-accent/10 rounded-lg border border-accent/30">
                      <Info className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                      <div className="text-xs text-text-secondary">
                        <p className="font-medium text-text-primary mb-1">When does cloud-init run?</p>
                        <p>
                          Cloud-init runs on the first boot of the VM. Changes to these settings will only 
                          take effect if you reset the cloud-init state or recreate the VM.
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-bg-surface">
            <Button variant="ghost" onClick={onClose}>
              {hasCloudInit ? 'Cancel' : 'Close'}
            </Button>
            {hasCloudInit && (
              <Button variant="primary" onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Settings
              </Button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
