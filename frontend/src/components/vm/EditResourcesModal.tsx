import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Cpu, MemoryStick, AlertTriangle, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn, formatBytes } from '@/lib/utils';

interface EditResourcesModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  vmState: string;
  currentCores: number;
  currentMemoryMib: number;
  onSave: (resources: { cores: number; memoryMib: number }) => Promise<void>;
}

const MEMORY_PRESETS = [
  { label: '1 GB', value: 1024 },
  { label: '2 GB', value: 2048 },
  { label: '4 GB', value: 4096 },
  { label: '8 GB', value: 8192 },
  { label: '16 GB', value: 16384 },
  { label: '32 GB', value: 32768 },
  { label: '64 GB', value: 65536 },
];

const CPU_PRESETS = [1, 2, 4, 6, 8, 12, 16, 24, 32];

export function EditResourcesModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  vmState,
  currentCores,
  currentMemoryMib,
  onSave,
}: EditResourcesModalProps) {
  const [cores, setCores] = useState(currentCores);
  const [memoryMib, setMemoryMib] = useState(currentMemoryMib);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRunning = vmState === 'RUNNING';

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setCores(currentCores);
      setMemoryMib(currentMemoryMib);
      setError(null);
    }
  }, [isOpen, currentCores, currentMemoryMib]);

  const handleSave = async () => {
    if (cores < 1) {
      setError('At least 1 CPU core is required');
      return;
    }
    if (memoryMib < 512) {
      setError('At least 512 MB of memory is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({ cores, memoryMib });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update resources');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = cores !== currentCores || memoryMib !== currentMemoryMib;

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
          transition={{ duration: 0.2 }}
          className="bg-bg-surface border border-border rounded-xl shadow-elevated w-full max-w-lg mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Cpu className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Edit Resources</h2>
                <p className="text-sm text-text-muted">{vmName}</p>
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
          <div className="p-6 space-y-6">
            {/* Warning for running VMs */}
            {isRunning && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-warning">VM is running</p>
                  <p className="text-text-muted mt-1">
                    Changes will require a VM restart to take effect. Hot-plug is not yet supported.
                  </p>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm">
                {error}
              </div>
            )}

            {/* CPU Cores */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Cpu className="w-4 h-4 text-text-muted" />
                CPU Cores
              </label>
              <div className="flex flex-wrap gap-2">
                {CPU_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setCores(preset)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                      cores === preset
                        ? 'bg-accent text-white shadow-floating'
                        : 'bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover',
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-muted">Custom:</span>
                <input
                  type="number"
                  value={cores}
                  onChange={(e) => setCores(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={128}
                  className={cn(
                    'w-24 px-3 py-2 rounded-lg',
                    'bg-bg-base border border-border',
                    'text-text-primary text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
                  )}
                />
                <span className="text-sm text-text-muted">vCPUs</span>
              </div>
            </div>

            {/* Memory */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <MemoryStick className="w-4 h-4 text-text-muted" />
                Memory
              </label>
              <div className="flex flex-wrap gap-2">
                {MEMORY_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setMemoryMib(preset.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                      memoryMib === preset.value
                        ? 'bg-accent text-white shadow-floating'
                        : 'bg-bg-elevated border border-border text-text-primary hover:bg-bg-hover',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-muted">Custom:</span>
                <input
                  type="number"
                  value={memoryMib}
                  onChange={(e) => setMemoryMib(Math.max(512, parseInt(e.target.value) || 512))}
                  min={512}
                  step={512}
                  className={cn(
                    'w-28 px-3 py-2 rounded-lg',
                    'bg-bg-base border border-border',
                    'text-text-primary text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
                  )}
                />
                <span className="text-sm text-text-muted">MiB ({formatBytes(memoryMib * 1024 * 1024)})</span>
              </div>
            </div>

            {/* Summary */}
            <div className="p-4 rounded-lg bg-bg-base border border-border">
              <h4 className="text-sm font-medium text-text-primary mb-2">Resource Summary</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-text-muted">Current:</span>
                  <p className="text-text-primary">
                    {currentCores} vCPUs, {formatBytes(currentMemoryMib * 1024 * 1024)}
                  </p>
                </div>
                <div>
                  <span className="text-text-muted">New:</span>
                  <p className={cn('text-text-primary', hasChanges && 'text-accent font-medium')}>
                    {cores} vCPUs, {formatBytes(memoryMib * 1024 * 1024)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-elevated/30">
            <Button variant="ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving || !hasChanges}>
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
