import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Network, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface AddNICModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  availableNetworks: Array<{
    id: string;
    name: string;
    cidr?: string;
  }>;
  onAddNIC: (nic: {
    networkId: string;
    macAddress?: string;
    model: string;
  }) => Promise<void>;
  isPending?: boolean;
}

type NICModel = 'virtio' | 'e1000' | 'rtl8139';

// Generate a random MAC address with Quantix OUI
function generateMacAddress(): string {
  const oui = '52:54:00'; // QEMU/KVM OUI
  const nic = Array.from({ length: 3 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')
  ).join(':');
  return `${oui}:${nic}`;
}

export function AddNICModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  availableNetworks,
  onAddNIC,
  isPending = false,
}: AddNICModalProps) {
  const [selectedNetworkId, setSelectedNetworkId] = useState(availableNetworks[0]?.id || '');
  const [model, setModel] = useState<NICModel>('virtio');
  const [customMac, setCustomMac] = useState('');
  const [useCustomMac, setUseCustomMac] = useState(false);

  const handleClose = () => {
    if (isPending) return;
    // Reset state
    setSelectedNetworkId(availableNetworks[0]?.id || '');
    setModel('virtio');
    setCustomMac('');
    setUseCustomMac(false);
    onClose();
  };

  const handleAdd = async () => {
    if (!selectedNetworkId) return;
    
    await onAddNIC({
      networkId: selectedNetworkId,
      macAddress: useCustomMac ? customMac : undefined,
      model,
    });
    handleClose();
  };

  const selectedNetwork = availableNetworks.find(n => n.id === selectedNetworkId);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-md mx-4 bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/20">
                <Network className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Add Network Interface</h2>
                <p className="text-sm text-text-muted">{vmName}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={isPending}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Network Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                Network <span className="text-error">*</span>
              </label>
              {availableNetworks.length === 0 ? (
                <div className="p-4 bg-bg-base rounded-lg border border-border text-center">
                  <p className="text-sm text-text-muted">No networks available</p>
                </div>
              ) : (
                <select
                  value={selectedNetworkId}
                  onChange={(e) => setSelectedNetworkId(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {availableNetworks.map((network) => (
                    <option key={network.id} value={network.id}>
                      {network.name} {network.cidr && `(${network.cidr})`}
                    </option>
                  ))}
                </select>
              )}
              {selectedNetwork && (
                <p className="text-xs text-text-muted">
                  Connected to: {selectedNetwork.name}
                </p>
              )}
            </div>

            {/* NIC Model */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                NIC Model
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['virtio', 'e1000', 'rtl8139'] as NICModel[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={cn(
                      'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                      model === m
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-bg-base text-text-secondary hover:bg-bg-hover'
                    )}
                  >
                    {m === 'virtio' ? 'VirtIO' : m.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                VirtIO offers best performance. E1000/RTL8139 for legacy OS compatibility.
              </p>
            </div>

            {/* MAC Address */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useCustomMac}
                  onChange={(e) => {
                    setUseCustomMac(e.target.checked);
                    if (e.target.checked && !customMac) {
                      setCustomMac(generateMacAddress());
                    }
                  }}
                  className="w-4 h-4 rounded border-border text-accent focus:ring-accent/50"
                />
                <span className="text-sm font-medium text-text-secondary">Custom MAC Address</span>
              </label>
              {useCustomMac && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customMac}
                    onChange={(e) => setCustomMac(e.target.value)}
                    placeholder="52:54:00:xx:xx:xx"
                    className="flex-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary font-mono placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCustomMac(generateMacAddress())}
                  >
                    Generate
                  </Button>
                </div>
              )}
              {!useCustomMac && (
                <p className="text-xs text-text-muted">
                  MAC address will be auto-generated by the hypervisor
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-elevated/30">
            <Button
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleAdd}
              disabled={isPending || !selectedNetworkId}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Network className="w-4 h-4" />
              )}
              Add NIC
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
