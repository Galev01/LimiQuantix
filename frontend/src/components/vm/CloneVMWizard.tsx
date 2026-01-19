import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Loader2, Zap, HardDrive, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { useCloneVM } from '@/hooks/useVMs';
import { useNavigate } from 'react-router-dom';

interface CloneVMWizardProps {
  isOpen: boolean;
  onClose: () => void;
  sourceVmId: string;
  sourceVmName: string;
  sourceVmProjectId: string;
}

type CloneType = 'LINKED' | 'FULL';

export function CloneVMWizard({
  isOpen,
  onClose,
  sourceVmId,
  sourceVmName,
  sourceVmProjectId,
}: CloneVMWizardProps) {
  const navigate = useNavigate();
  const cloneVM = useCloneVM();
  
  const [step, setStep] = useState(1);
  const [cloneName, setCloneName] = useState(`${sourceVmName}-clone`);
  const [cloneType, setCloneType] = useState<CloneType>('LINKED');
  const [startAfterClone, setStartAfterClone] = useState(false);

  const handleClose = () => {
    if (cloneVM.isPending) return;
    // Reset state
    setStep(1);
    setCloneName(`${sourceVmName}-clone`);
    setCloneType('LINKED');
    setStartAfterClone(false);
    onClose();
  };

  const handleClone = async () => {
    const result = await cloneVM.mutateAsync({
      sourceVmId,
      name: cloneName,
      projectId: sourceVmProjectId,
      cloneType,
      startOnCreate: startAfterClone,
    });
    
    // Navigate to the new VM
    if (result.id) {
      navigate(`/vms/${result.id}`);
    }
    handleClose();
  };

  const canProceed = () => {
    if (step === 1) {
      return cloneName.trim().length > 0;
    }
    return true;
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
          className="relative w-full max-w-xl mx-4 bg-bg-surface rounded-xl border border-border shadow-floating overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/20">
                <Copy className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Clone VM</h2>
                <p className="text-sm text-text-muted">Create a copy of {sourceVmName}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={cloneVM.isPending}
              className="p-2 rounded-lg hover:bg-bg-hover transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5 text-text-muted" />
            </button>
          </div>

          {/* Progress Steps */}
          <div className="flex items-center justify-center gap-4 py-4 border-b border-border bg-bg-elevated/30">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                    step >= s
                      ? 'bg-accent text-white'
                      : 'bg-bg-base text-text-muted border border-border'
                  )}
                >
                  {step > s ? <CheckCircle2 className="w-5 h-5" /> : s}
                </div>
                <span className={cn(
                  'text-sm hidden sm:inline',
                  step >= s ? 'text-text-primary' : 'text-text-muted'
                )}>
                  {s === 1 ? 'Name & Type' : 'Confirm'}
                </span>
                {s < 2 && <ArrowRight className="w-4 h-4 text-text-muted" />}
              </div>
            ))}
          </div>

          {/* Content */}
          <div className="p-6">
            {step === 1 && (
              <div className="space-y-6">
                {/* Clone Name */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-secondary">
                    New VM Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    placeholder="Enter name for the cloned VM"
                    className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                    autoFocus
                  />
                </div>

                {/* Clone Type Selection */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-text-secondary">
                    Clone Type
                  </label>

                  {/* Linked Clone */}
                  <button
                    type="button"
                    onClick={() => setCloneType('LINKED')}
                    className={cn(
                      'w-full p-4 rounded-lg border text-left transition-all',
                      cloneType === 'LINKED'
                        ? 'border-accent bg-accent/10 ring-2 ring-accent/30'
                        : 'border-border bg-bg-base hover:bg-bg-hover'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'p-2 rounded-lg',
                        cloneType === 'LINKED' ? 'bg-accent/20' : 'bg-bg-surface'
                      )}>
                        <Zap className={cn(
                          'w-5 h-5',
                          cloneType === 'LINKED' ? 'text-accent' : 'text-text-muted'
                        )} />
                      </div>
                      <div className="flex-1">
                        <p className={cn(
                          'font-medium',
                          cloneType === 'LINKED' ? 'text-accent' : 'text-text-primary'
                        )}>
                          Linked Clone
                        </p>
                        <p className="text-sm text-text-muted mt-1">
                          <span className="text-success font-medium">Fast (~1 second)</span> — Creates a QCOW2 overlay disk. 
                          The clone shares the source disk's base layer (copy-on-write).
                        </p>
                        <p className="text-xs text-warning mt-2">
                          ⚠️ Source VM cannot be deleted while linked clones exist
                        </p>
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                        cloneType === 'LINKED'
                          ? 'border-accent bg-accent'
                          : 'border-border'
                      )}>
                        {cloneType === 'LINKED' && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Full Clone */}
                  <button
                    type="button"
                    onClick={() => setCloneType('FULL')}
                    className={cn(
                      'w-full p-4 rounded-lg border text-left transition-all',
                      cloneType === 'FULL'
                        ? 'border-accent bg-accent/10 ring-2 ring-accent/30'
                        : 'border-border bg-bg-base hover:bg-bg-hover'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        'p-2 rounded-lg',
                        cloneType === 'FULL' ? 'bg-accent/20' : 'bg-bg-surface'
                      )}>
                        <HardDrive className={cn(
                          'w-5 h-5',
                          cloneType === 'FULL' ? 'text-accent' : 'text-text-muted'
                        )} />
                      </div>
                      <div className="flex-1">
                        <p className={cn(
                          'font-medium',
                          cloneType === 'FULL' ? 'text-accent' : 'text-text-primary'
                        )}>
                          Full Clone
                        </p>
                        <p className="text-sm text-text-muted mt-1">
                          <span className="text-text-secondary font-medium">Independent copy</span> — Creates a complete 
                          copy of all disk data. Takes longer but fully independent.
                        </p>
                        <p className="text-xs text-success mt-2">
                          ✓ Source VM can be deleted afterward
                        </p>
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0',
                        cloneType === 'FULL'
                          ? 'border-accent bg-accent'
                          : 'border-border'
                      )}>
                        {cloneType === 'FULL' && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                {/* Summary */}
                <div className="bg-bg-base rounded-lg border border-border p-4">
                  <h3 className="text-sm font-medium text-text-primary mb-4">Clone Summary</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-text-muted">Source VM</span>
                      <span className="text-text-primary font-medium">{sourceVmName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">New VM Name</span>
                      <span className="text-text-primary font-medium">{cloneName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-muted">Clone Type</span>
                      <span className={cn(
                        'font-medium',
                        cloneType === 'LINKED' ? 'text-accent' : 'text-text-primary'
                      )}>
                        {cloneType === 'LINKED' ? 'Linked (Fast)' : 'Full (Independent)'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Options */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={startAfterClone}
                      onChange={(e) => setStartAfterClone(e.target.checked)}
                      className="w-4 h-4 rounded border-border text-accent focus:ring-accent/50"
                    />
                    <span className="text-sm text-text-secondary">
                      Start VM after cloning
                    </span>
                  </label>
                </div>

                {/* Info Box */}
                <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
                  <p className="text-sm text-text-secondary">
                    {cloneType === 'LINKED' ? (
                      <>
                        <span className="font-medium text-accent">Linked Clone:</span> The new VM will be created 
                        instantly using a QCOW2 overlay. Both VMs share the same base disk data.
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-accent">Full Clone:</span> All disk data will be copied. 
                        This may take several minutes depending on disk size.
                      </>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elevated/30">
            <div>
              {step > 1 && (
                <Button
                  variant="ghost"
                  onClick={() => setStep(step - 1)}
                  disabled={cloneVM.isPending}
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleClose}
                disabled={cloneVM.isPending}
              >
                Cancel
              </Button>
              {step < 2 ? (
                <Button
                  variant="primary"
                  onClick={() => setStep(step + 1)}
                  disabled={!canProceed()}
                >
                  Next
                  <ArrowRight className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleClone}
                  disabled={cloneVM.isPending || !canProceed()}
                >
                  {cloneVM.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {cloneVM.isPending ? 'Cloning...' : 'Clone VM'}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
