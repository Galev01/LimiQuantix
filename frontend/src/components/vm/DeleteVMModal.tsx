import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, FolderMinus, AlertTriangle, Loader2, HardDrive, Database } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface DeleteVMModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  vmState: string;
  onDelete: (options: { 
    deleteVolumes: boolean; 
    removeFromInventoryOnly: boolean;
    force: boolean;
  }) => Promise<void>;
  isPending?: boolean;
}

type DeleteMode = 'delete_from_disk' | 'remove_from_inventory';

export function DeleteVMModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  vmState,
  onDelete,
  isPending = false,
}: DeleteVMModalProps) {
  const [deleteMode, setDeleteMode] = useState<DeleteMode>('delete_from_disk');
  const [confirmText, setConfirmText] = useState('');
  
  const isRunning = vmState === 'RUNNING';
  const needsConfirmation = deleteMode === 'delete_from_disk';
  const isConfirmed = !needsConfirmation || confirmText === vmName;

  const handleDelete = async () => {
    if (!isConfirmed) return;
    
    await onDelete({
      deleteVolumes: deleteMode === 'delete_from_disk',
      removeFromInventoryOnly: deleteMode === 'remove_from_inventory',
      force: isRunning, // Force stop if running
    });
    
    // Reset state on successful deletion
    setConfirmText('');
    setDeleteMode('delete_from_disk');
    onClose();
  };

  const handleClose = () => {
    if (isPending) return;
    setConfirmText('');
    setDeleteMode('delete_from_disk');
    onClose();
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
          className="relative w-full max-w-lg mx-4 bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-error/20">
                <Trash2 className="w-5 h-5 text-error" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Delete VM</h2>
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
            {/* Running VM Warning */}
            {isRunning && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-warning">VM is currently running</p>
                  <p className="text-text-muted mt-1">
                    The VM will be force-stopped before deletion. This may cause data loss.
                  </p>
                </div>
              </div>
            )}

            {/* Delete Mode Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-text-secondary">
                Choose deletion type
              </label>
              
              {/* Delete from Disk */}
              <button
                type="button"
                onClick={() => setDeleteMode('delete_from_disk')}
                className={cn(
                  'w-full p-4 rounded-lg border text-left transition-all',
                  deleteMode === 'delete_from_disk'
                    ? 'border-error bg-error/10 ring-2 ring-error/30'
                    : 'border-border bg-bg-base hover:bg-bg-hover'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'p-2 rounded-lg',
                    deleteMode === 'delete_from_disk' ? 'bg-error/20' : 'bg-bg-surface'
                  )}>
                    <HardDrive className={cn(
                      'w-5 h-5',
                      deleteMode === 'delete_from_disk' ? 'text-error' : 'text-text-muted'
                    )} />
                  </div>
                  <div className="flex-1">
                    <p className={cn(
                      'font-medium',
                      deleteMode === 'delete_from_disk' ? 'text-error' : 'text-text-primary'
                    )}>
                      Delete from Disk
                    </p>
                    <p className="text-sm text-text-muted mt-1">
                      Permanently delete the VM definition and all associated disk files.
                      <span className="text-error font-medium"> This cannot be undone.</span>
                    </p>
                  </div>
                  <div className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                    deleteMode === 'delete_from_disk' 
                      ? 'border-error bg-error' 
                      : 'border-border'
                  )}>
                    {deleteMode === 'delete_from_disk' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </div>
              </button>

              {/* Remove from Inventory */}
              <button
                type="button"
                onClick={() => setDeleteMode('remove_from_inventory')}
                className={cn(
                  'w-full p-4 rounded-lg border text-left transition-all',
                  deleteMode === 'remove_from_inventory'
                    ? 'border-accent bg-accent/10 ring-2 ring-accent/30'
                    : 'border-border bg-bg-base hover:bg-bg-hover'
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    'p-2 rounded-lg',
                    deleteMode === 'remove_from_inventory' ? 'bg-accent/20' : 'bg-bg-surface'
                  )}>
                    <Database className={cn(
                      'w-5 h-5',
                      deleteMode === 'remove_from_inventory' ? 'text-accent' : 'text-text-muted'
                    )} />
                  </div>
                  <div className="flex-1">
                    <p className={cn(
                      'font-medium',
                      deleteMode === 'remove_from_inventory' ? 'text-accent' : 'text-text-primary'
                    )}>
                      Remove from Inventory
                    </p>
                    <p className="text-sm text-text-muted mt-1">
                      Remove the VM from the vDC management console only. 
                      The VM definition and disk files remain on the hypervisor host.
                    </p>
                  </div>
                  <div className={cn(
                    'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                    deleteMode === 'remove_from_inventory' 
                      ? 'border-accent bg-accent' 
                      : 'border-border'
                  )}>
                    {deleteMode === 'remove_from_inventory' && (
                      <div className="w-2 h-2 rounded-full bg-white" />
                    )}
                  </div>
                </div>
              </button>
            </div>

            {/* Confirmation Input for Delete from Disk */}
            {deleteMode === 'delete_from_disk' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-secondary">
                  Type <span className="font-mono text-error">{vmName}</span> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={vmName}
                  className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-error/50"
                  autoFocus
                />
              </div>
            )}
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
              variant={deleteMode === 'delete_from_disk' ? 'danger' : 'primary'}
              onClick={handleDelete}
              disabled={isPending || !isConfirmed}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : deleteMode === 'delete_from_disk' ? (
                <Trash2 className="w-4 h-4" />
              ) : (
                <FolderMinus className="w-4 h-4" />
              )}
              {deleteMode === 'delete_from_disk' ? 'Delete Permanently' : 'Remove from Inventory'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
