import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, HardDrive, Loader2, AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ResizeDiskModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  diskId: string;
  diskName: string;
  currentSizeGib: number;
  onResize: (newSizeGib: number) => Promise<void>;
  isPending?: boolean;
}

export function ResizeDiskModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  diskId,
  diskName,
  currentSizeGib,
  onResize,
  isPending = false,
}: ResizeDiskModalProps) {
  const [newSizeGib, setNewSizeGib] = useState(currentSizeGib + 10);

  const handleClose = () => {
    if (isPending) return;
    setNewSizeGib(currentSizeGib + 10);
    onClose();
  };

  const handleResize = async () => {
    if (newSizeGib <= currentSizeGib) return;
    await onResize(newSizeGib);
    handleClose();
  };

  const sizeIncrease = newSizeGib - currentSizeGib;
  const isValid = newSizeGib > currentSizeGib;

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
                <h2 className="text-lg font-semibold text-text-primary">Resize Disk</h2>
                <p className="text-sm text-text-muted">{diskName} on {vmName}</p>
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
            {/* Current Size */}
            <div className="flex items-center justify-between p-4 bg-bg-base rounded-lg border border-border">
              <div>
                <p className="text-sm text-text-muted">Current Size</p>
                <p className="text-xl font-semibold text-text-primary">{currentSizeGib} GiB</p>
              </div>
              <ArrowRight className="w-5 h-5 text-text-muted" />
              <div className="text-right">
                <p className="text-sm text-text-muted">New Size</p>
                <p className="text-xl font-semibold text-accent">{newSizeGib} GiB</p>
              </div>
            </div>

            {/* Size Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-secondary">
                New Disk Size (GiB)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={currentSizeGib + 1}
                  max={Math.max(currentSizeGib + 500, 1000)}
                  value={newSizeGib}
                  onChange={(e) => setNewSizeGib(Number(e.target.value))}
                  className="flex-1 h-2 bg-bg-base rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={currentSizeGib + 1}
                    value={newSizeGib}
                    onChange={(e) => setNewSizeGib(Math.max(currentSizeGib + 1, Number(e.target.value)))}
                    className="w-20 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary text-center focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                  <span className="text-sm text-text-muted">GiB</span>
                </div>
              </div>
              {isValid && (
                <p className="text-sm text-success">
                  +{sizeIncrease} GiB ({((sizeIncrease / currentSizeGib) * 100).toFixed(0)}% increase)
                </p>
              )}
            </div>

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-warning">Guest OS action required</p>
                <p className="text-text-muted mt-1">
                  After resizing, the guest OS must recognize the new space. 
                  For Linux, use <code className="px-1 py-0.5 bg-bg-base rounded text-xs">growpart</code> and <code className="px-1 py-0.5 bg-bg-base rounded text-xs">resize2fs</code> to expand the partition and filesystem.
                </p>
              </div>
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
              onClick={handleResize}
              disabled={isPending || !isValid}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <HardDrive className="w-4 h-4" />
              )}
              Resize Disk
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
