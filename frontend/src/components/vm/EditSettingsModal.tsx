import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Info, Tags, FileText, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface EditSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  vmDescription: string;
  vmLabels: Record<string, string>;
  onSave: (settings: { name: string; description: string; labels: Record<string, string> }) => Promise<void>;
}

export function EditSettingsModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  vmDescription,
  vmLabels,
  onSave,
}: EditSettingsModalProps) {
  const [name, setName] = useState(vmName);
  const [description, setDescription] = useState(vmDescription);
  const [labels, setLabels] = useState<Record<string, string>>(vmLabels);
  const [newLabelKey, setNewLabelKey] = useState('');
  const [newLabelValue, setNewLabelValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(vmName);
      setDescription(vmDescription);
      setLabels({ ...vmLabels });
      setNewLabelKey('');
      setNewLabelValue('');
      setError(null);
    }
  }, [isOpen, vmName, vmDescription, vmLabels]);

  const handleAddLabel = () => {
    if (newLabelKey.trim() && newLabelValue.trim()) {
      setLabels({ ...labels, [newLabelKey.trim()]: newLabelValue.trim() });
      setNewLabelKey('');
      setNewLabelValue('');
    }
  };

  const handleRemoveLabel = (key: string) => {
    const updated = { ...labels };
    delete updated[key];
    setLabels(updated);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('VM name is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({ name: name.trim(), description: description.trim(), labels });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
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
                <Settings className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Edit Settings</h2>
                <p className="text-sm text-text-muted">Modify VM configuration</p>
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
          <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-lg bg-error/10 border border-error/30 text-error text-sm">
                {error}
              </div>
            )}

            {/* Name Field */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Info className="w-4 h-4 text-text-muted" />
                VM Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={cn(
                  'w-full px-4 py-2.5 rounded-lg',
                  'bg-bg-base border border-border',
                  'text-text-primary placeholder-text-muted',
                  'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
                  'transition-all duration-150',
                )}
                placeholder="Enter VM name"
              />
            </div>

            {/* Description Field */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <FileText className="w-4 h-4 text-text-muted" />
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={cn(
                  'w-full px-4 py-2.5 rounded-lg',
                  'bg-bg-base border border-border',
                  'text-text-primary placeholder-text-muted',
                  'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
                  'transition-all duration-150 resize-none',
                )}
                placeholder="Enter VM description"
              />
            </div>

            {/* Labels Section */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <Tags className="w-4 h-4 text-text-muted" />
                Labels
              </label>

              {/* Existing Labels */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(labels).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-bg-elevated border border-border text-sm"
                  >
                    <span className="text-text-primary">
                      {key}: {value}
                    </span>
                    <button
                      onClick={() => handleRemoveLabel(key)}
                      className="ml-1 p-0.5 rounded hover:bg-bg-hover transition-colors"
                    >
                      <X className="w-3 h-3 text-text-muted hover:text-text-primary" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add New Label */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabelKey}
                  onChange={(e) => setNewLabelKey(e.target.value)}
                  placeholder="Key"
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg',
                    'bg-bg-base border border-border',
                    'text-text-primary placeholder-text-muted text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
                  )}
                />
                <input
                  type="text"
                  value={newLabelValue}
                  onChange={(e) => setNewLabelValue(e.target.value)}
                  placeholder="Value"
                  className={cn(
                    'flex-1 px-3 py-2 rounded-lg',
                    'bg-bg-base border border-border',
                    'text-text-primary placeholder-text-muted text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent',
                  )}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddLabel()}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleAddLabel}
                  disabled={!newLabelKey.trim() || !newLabelValue.trim()}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-bg-elevated/30">
            <Button variant="ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
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
