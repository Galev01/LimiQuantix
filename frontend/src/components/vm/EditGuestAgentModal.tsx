/**
 * EditGuestAgentModal - Edit VM Guest Agent settings
 * 
 * Allows editing guest agent settings like freeze on snapshot and time sync.
 * Status and agent version are read-only (system-determined).
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Activity, Loader2, Info, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { type ApiVM } from '@/hooks/useVMs';

interface EditGuestAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  vm: ApiVM;
  onSave: (settings: GuestAgentSettings) => Promise<void>;
}

interface GuestAgentSettings {
  freezeOnSnapshot: boolean;
  timeSync: boolean;
}

export function EditGuestAgentModal({ isOpen, onClose, vm, onSave }: EditGuestAgentModalProps) {
  const [freezeOnSnapshot, setFreezeOnSnapshot] = useState(true);
  const [timeSync, setTimeSync] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Get agent status from VM
  const isAgentConnected = Boolean(vm.status?.guestInfo?.agentVersion);
  const agentVersion = vm.status?.guestInfo?.agentVersion || 'Not installed';
  const communicationMethod = vm.spec?.guestAgent?.communication || 'virtio-serial';

  // Initialize from VM data
  useEffect(() => {
    if (vm.spec?.guestAgent) {
      setFreezeOnSnapshot(vm.spec.guestAgent.freezeOnSnapshot !== false);
      setTimeSync(vm.spec.guestAgent.timeSync !== false);
    }
  }, [vm]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        freezeOnSnapshot,
        timeSync,
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
          className="bg-bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-text-primary">Guest Agent Settings</h2>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Agent Status (Read-only) */}
            <div className="p-4 bg-bg-base rounded-lg border border-border space-y-3">
              <h4 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <Info className="w-4 h-4 text-text-muted" />
                Agent Status (Read-only)
              </h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-text-muted block">Status</span>
                  <div className="flex items-center gap-2 mt-1">
                    {isAgentConnected ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-success" />
                        <span className="text-sm font-medium text-success">Connected</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-text-muted" />
                        <span className="text-sm font-medium text-text-muted">Not Connected</span>
                      </>
                    )}
                  </div>
                </div>
                
                <div>
                  <span className="text-xs text-text-muted block">Agent Version</span>
                  <span className="text-sm font-mono text-text-primary">{agentVersion}</span>
                </div>
                
                <div className="col-span-2">
                  <span className="text-xs text-text-muted block">Communication Method</span>
                  <span className="text-sm font-mono text-text-primary capitalize">{communicationMethod}</span>
                </div>
              </div>
            </div>

            {/* Editable Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium text-text-primary">Agent Behavior</h4>
              
              <Toggle
                enabled={freezeOnSnapshot}
                onChange={setFreezeOnSnapshot}
                label="Freeze Filesystem on Snapshot"
                description="Quiesce the filesystem before taking snapshots for consistency"
              />

              <Toggle
                enabled={timeSync}
                onChange={setTimeSync}
                label="Time Synchronization"
                description="Sync guest time with host after resume or migration"
              />
            </div>

            {/* Info box */}
            {!isAgentConnected && (
              <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                <Info className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-xs text-text-secondary">
                  <p className="font-medium text-warning mb-1">Agent Not Connected</p>
                  <p>
                    The Quantix Guest Agent is not currently connected. Install the agent inside the VM 
                    to enable features like filesystem quiescing, graceful shutdown, and real-time metrics.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Settings
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
