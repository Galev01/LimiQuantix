import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, HardDrive, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface AddDiskModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  onAddDisk: (disk: {
    sizeGib: number;
    bus: string;
    format: string;
  }) => Promise<void>;
  isPending?: boolean;
}

type DiskBus = 'virtio' | 'scsi' | 'sata';
type DiskFormat = 'qcow2' | 'raw';

export function AddDiskModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  onAddDisk,
  isPending = false,
}: AddDiskModalProps) {
  const [sizeGib, setSizeGib] = useState(20);
  const [bus, setBus] = useState<DiskBus>('virtio');
  const [format, setFormat] = useState<DiskFormat>('qcow2');

  const handleClose = () => {
    if (isPending) return;
    // Reset state
    setSizeGib(20);
    setBus('virtio');
    setFormat('qcow2');
    onClose();
  };

  const handleAdd = async () => {
    await onAddDisk({ sizeGib, bus, format });
    handleClose();
  };

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
                <HardDrive className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Add Disk</h2>
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
            {/* Size Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                Disk Size (GiB) <span className="text-error">*</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={500}
                  value={sizeGib}
                  onChange={(e) => setSizeGib(Number(e.target.value))}
                  className="flex-1 h-2 bg-bg-base rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={2000}
                    value={sizeGib}
                    onChange={(e) => setSizeGib(Math.max(1, Math.min(2000, Number(e.target.value))))}
                    className="w-20 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <span className="text-sm text-text-muted">GiB</span>
                </div>
              </div>
            </div>

            {/* Bus Type */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                Bus Type
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['virtio', 'scsi', 'sata'] as DiskBus[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBus(b)}
                    className={cn(
                      'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                      bus === b
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-bg-base text-text-secondary hover:bg-bg-hover'
                    )}
                  >
                    {b.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                VirtIO offers best performance. SCSI/SATA for compatibility with older OSes.
              </p>
            </div>

            {/* Format */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                Disk Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['qcow2', 'raw'] as DiskFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={cn(
                      'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                      format === f
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-bg-base text-text-secondary hover:bg-bg-hover'
                    )}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-xs text-text-muted flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                QCOW2 supports snapshots and thin provisioning. RAW for maximum performance.
              </p>
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
              disabled={isPending || sizeGib < 1}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <HardDrive className="w-4 h-4" />
              )}
              Add Disk
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
