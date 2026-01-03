import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  HardDrive,
  Database,
  Loader2,
  ChevronRight,
  Check,
  AlertCircle,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { useCreateVolume, useStoragePools, type CreateVolumeParams, type StoragePoolUI } from '@/hooks/useStorage';
import { toast } from 'sonner';

interface CreateVolumeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedPoolId?: string;
}

const sizePresets = [
  { label: '10 GB', bytes: 10 * 1024 * 1024 * 1024 },
  { label: '20 GB', bytes: 20 * 1024 * 1024 * 1024 },
  { label: '50 GB', bytes: 50 * 1024 * 1024 * 1024 },
  { label: '100 GB', bytes: 100 * 1024 * 1024 * 1024 },
  { label: '200 GB', bytes: 200 * 1024 * 1024 * 1024 },
  { label: '500 GB', bytes: 500 * 1024 * 1024 * 1024 },
  { label: '1 TB', bytes: 1024 * 1024 * 1024 * 1024 },
  { label: '2 TB', bytes: 2 * 1024 * 1024 * 1024 * 1024 },
];

export function CreateVolumeDialog({ isOpen, onClose, preselectedPoolId }: CreateVolumeDialogProps) {
  const [step, setStep] = useState<'pool' | 'config' | 'review'>('pool');
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(preselectedPoolId || null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    sizeBytes: 50 * 1024 * 1024 * 1024, // Default 50GB
    customSize: '',
    provisioning: 'thin' as 'thin' | 'thick',
  });
  
  const { data: pools, isLoading: poolsLoading } = useStoragePools();
  const createVolume = useCreateVolume();
  
  // Skip pool selection if preselected
  useEffect(() => {
    if (preselectedPoolId && isOpen) {
      setSelectedPoolId(preselectedPoolId);
      setStep('config');
    }
  }, [preselectedPoolId, isOpen]);
  
  const selectedPool = pools?.find(p => p.id === selectedPoolId);
  
  const resetForm = () => {
    setStep(preselectedPoolId ? 'config' : 'pool');
    setSelectedPoolId(preselectedPoolId || null);
    setFormData({
      name: '',
      description: '',
      sizeBytes: 50 * 1024 * 1024 * 1024,
      customSize: '',
      provisioning: 'thin',
    });
  };
  
  const handleClose = () => {
    resetForm();
    onClose();
  };
  
  const handleSubmit = async () => {
    if (!selectedPoolId) return;
    
    const params: CreateVolumeParams = {
      name: formData.name,
      poolId: selectedPoolId,
      sizeBytes: formData.sizeBytes,
      sourceType: 'empty',
    };
    
    try {
      await createVolume.mutateAsync(params);
      toast.success(`Volume "${formData.name}" created successfully`);
      handleClose();
    } catch (error) {
      toast.error(`Failed to create volume: ${(error as Error).message}`);
    }
  };
  
  const handleCustomSizeChange = (value: string) => {
    setFormData({ ...formData, customSize: value });
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setFormData(prev => ({
        ...prev,
        customSize: value,
        sizeBytes: num * 1024 * 1024 * 1024, // Assume GB
      }));
    }
  };
  
  const canProceed = () => {
    switch (step) {
      case 'pool':
        return selectedPoolId !== null;
      case 'config':
        return formData.name.trim() !== '' && formData.sizeBytes > 0;
      case 'review':
        return true;
      default:
        return false;
    }
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
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />
        
        {/* Dialog */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={cn(
            'relative z-10 w-full max-w-xl',
            'bg-bg-surface rounded-2xl border border-border',
            'shadow-2xl overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Create Volume</h2>
                <p className="text-sm text-text-muted">
                  {step === 'pool' && 'Select storage pool'}
                  {step === 'config' && 'Configure volume'}
                  {step === 'review' && 'Review and create'}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          {/* Progress Steps */}
          <div className="px-6 py-4 border-b border-border bg-bg-base/50">
            <div className="flex items-center justify-between">
              {(preselectedPoolId ? ['config', 'review'] : ['pool', 'config', 'review']).map((s, i, arr) => (
                <div key={s} className="flex items-center">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                      step === s
                        ? 'bg-accent text-white'
                        : arr.indexOf(step) > i
                        ? 'bg-success text-white'
                        : 'bg-bg-elevated text-text-muted',
                    )}
                  >
                    {arr.indexOf(step) > i ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {i < arr.length - 1 && (
                    <div
                      className={cn(
                        'w-16 h-0.5 mx-2',
                        arr.indexOf(step) > i ? 'bg-success' : 'bg-bg-elevated',
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Content */}
          <div className="p-6 max-h-[50vh] overflow-y-auto">
            <AnimatePresence mode="wait">
              {step === 'pool' && (
                <motion.div
                  key="pool"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-3"
                >
                  {poolsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-accent" />
                    </div>
                  ) : pools && pools.length > 0 ? (
                    pools.filter(p => p.status.phase === 'READY').map((pool) => (
                      <PoolOption
                        key={pool.id}
                        pool={pool}
                        selected={selectedPoolId === pool.id}
                        onClick={() => setSelectedPoolId(pool.id)}
                      />
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <Database className="w-12 h-12 mx-auto text-text-muted mb-3" />
                      <p className="text-text-muted">No storage pools available</p>
                      <p className="text-sm text-text-muted mt-1">
                        Create a storage pool first
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
              
              {step === 'config' && (
                <motion.div
                  key="config"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  {/* Volume name */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">
                      Volume Name *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., web-server-boot, db-data"
                      className={cn(
                        'w-full px-4 py-2.5 rounded-lg',
                        'bg-bg-base border border-border',
                        'text-text-primary placeholder:text-text-muted',
                        'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                      )}
                    />
                  </div>
                  
                  {/* Size presets */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Size
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {sizePresets.map((preset) => (
                        <button
                          key={preset.bytes}
                          onClick={() => setFormData({ ...formData, sizeBytes: preset.bytes, customSize: '' })}
                          className={cn(
                            'px-3 py-2 rounded-lg text-sm font-medium transition-all',
                            formData.sizeBytes === preset.bytes && !formData.customSize
                              ? 'bg-accent text-white'
                              : 'bg-bg-base border border-border text-text-secondary hover:border-accent hover:text-accent',
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-sm text-text-muted">Custom:</span>
                      <input
                        type="number"
                        value={formData.customSize}
                        onChange={(e) => handleCustomSizeChange(e.target.value)}
                        placeholder="Size in GB"
                        className={cn(
                          'w-32 px-3 py-1.5 rounded-lg text-sm',
                          'bg-bg-base border border-border',
                          'text-text-primary placeholder:text-text-muted',
                          'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                        )}
                      />
                      <span className="text-sm text-text-muted">GB</span>
                    </div>
                  </div>
                  
                  {/* Provisioning */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Provisioning
                    </label>
                    <div className="flex gap-3">
                      {(['thin', 'thick'] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setFormData({ ...formData, provisioning: type })}
                          className={cn(
                            'flex-1 px-4 py-3 rounded-lg border text-left transition-all',
                            formData.provisioning === type
                              ? 'border-accent bg-accent/10'
                              : 'border-border bg-bg-base hover:border-text-muted',
                          )}
                        >
                          <p className={cn(
                            'font-medium capitalize',
                            formData.provisioning === type ? 'text-accent' : 'text-text-primary',
                          )}>
                            {type}
                          </p>
                          <p className="text-xs text-text-muted mt-0.5">
                            {type === 'thin'
                              ? 'Allocate space on demand'
                              : 'Pre-allocate all space'}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  {/* Pool capacity warning */}
                  {selectedPool && formData.sizeBytes > selectedPool.capacity.availableBytes && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/30">
                      <AlertCircle className="w-4 h-4 text-error shrink-0" />
                      <p className="text-xs text-error">
                        Volume size exceeds available pool capacity ({formatBytes(selectedPool.capacity.availableBytes)})
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
              
              {step === 'review' && (
                <motion.div
                  key="review"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-6"
                >
                  <div className="bg-bg-base rounded-xl border border-border p-4 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                        <HardDrive className="w-5 h-5 text-accent" />
                      </div>
                      <div>
                        <h3 className="font-medium text-text-primary">{formData.name}</h3>
                        <p className="text-sm text-text-muted">{formatBytes(formData.sizeBytes)}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                      <div>
                        <p className="text-xs text-text-muted">Storage Pool</p>
                        <p className="text-sm text-text-primary">{selectedPool?.name || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Provisioning</p>
                        <p className="text-sm text-text-primary capitalize">{formData.provisioning}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Pool Type</p>
                        <p className="text-sm text-text-primary">{selectedPool?.type || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-muted">Available Space</p>
                        <p className="text-sm text-text-primary">
                          {selectedPool ? formatBytes(selectedPool.capacity.availableBytes) : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-base/50">
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 'pool' || (step === 'config' && preselectedPoolId)) {
                  handleClose();
                } else if (step === 'config') {
                  setStep('pool');
                } else {
                  setStep('config');
                }
              }}
            >
              {step === 'pool' || (step === 'config' && preselectedPoolId) ? 'Cancel' : 'Back'}
            </Button>
            <Button
              onClick={() => {
                if (step === 'pool') {
                  setStep('config');
                } else if (step === 'config') {
                  setStep('review');
                } else {
                  handleSubmit();
                }
              }}
              disabled={!canProceed() || createVolume.isPending}
            >
              {createVolume.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : step === 'review' ? (
                'Create Volume'
              ) : (
                <>
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function PoolOption({ pool, selected, onClick }: { pool: StoragePoolUI; selected: boolean; onClick: () => void }) {
  const usagePercent = pool.capacity.totalBytes > 0
    ? Math.round((pool.capacity.usedBytes / pool.capacity.totalBytes) * 100)
    : 0;
  
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left',
        selected
          ? 'border-accent bg-accent/10 shadow-lg'
          : 'border-border bg-bg-base hover:border-text-muted hover:bg-bg-hover',
      )}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          selected ? 'bg-accent/20' : 'bg-bg-elevated',
        )}
      >
        <Database
          className={cn(
            'w-5 h-5',
            selected ? 'text-accent' : 'text-text-muted',
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h3
            className={cn(
              'font-medium truncate',
              selected ? 'text-accent' : 'text-text-primary',
            )}
          >
            {pool.name}
          </h3>
          <span className="text-xs text-text-muted">{pool.type}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full',
                usagePercent >= 80 ? 'bg-error' : usagePercent >= 60 ? 'bg-warning' : 'bg-accent',
              )}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <span className="text-xs text-text-muted">
            {formatBytes(pool.capacity.availableBytes)} free
          </span>
        </div>
      </div>
      <ChevronRight
        className={cn(
          'w-5 h-5 shrink-0',
          selected ? 'text-accent' : 'text-text-muted',
        )}
      />
    </button>
  );
}
