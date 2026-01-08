import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Upload,
  Package,
  Check,
  Loader2,
  FileArchive,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  AlertCircle,
  CheckCircle,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from 'sonner';
import { useUploadOVA, useOVAUploadStatus, type OVAMetadata } from '@/hooks/useOVA';

interface OVAUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (imageId: string) => void;
}

type UploadStep = 'select' | 'uploading' | 'processing' | 'complete' | 'error';

export function OVAUploadModal({ isOpen, onClose, onSuccess }: OVAUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState<UploadStep>('select');
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadOVA = useUploadOVA();
  const { data: uploadStatus, isLoading: statusLoading } = useOVAUploadStatus(jobId || '', {
    enabled: !!jobId && (step === 'uploading' || step === 'processing'),
    refetchInterval: step === 'uploading' || step === 'processing' ? 1000 : false,
  });

  // Update step based on upload status
  if (uploadStatus && jobId) {
    if (uploadStatus.status === 'COMPLETED' && step !== 'complete') {
      setStep('complete');
      toast.success('OVA template uploaded successfully!');
      if (uploadStatus.imageId && onSuccess) {
        onSuccess(uploadStatus.imageId);
      }
    } else if (uploadStatus.status === 'FAILED' && step !== 'error') {
      setStep('error');
      setError(uploadStatus.errorMessage || 'Upload failed');
      toast.error('OVA upload failed: ' + (uploadStatus.errorMessage || 'Unknown error'));
    } else if (
      ['EXTRACTING', 'PARSING', 'CONVERTING'].includes(uploadStatus.status) &&
      step === 'uploading'
    ) {
      setStep('processing');
    }
  }

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (files && files.length > 0) {
      const selectedFile = files[0];
      if (selectedFile.name.toLowerCase().endsWith('.ova')) {
        setFile(selectedFile);
        setError(null);
      } else {
        toast.error('Please select an OVA file (.ova extension)');
      }
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select an OVA file');
      return;
    }

    setStep('uploading');
    setError(null);

    try {
      const result = await uploadOVA.mutateAsync(file);
      setJobId(result.jobId);
    } catch (err) {
      setStep('error');
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      toast.error(message);
    }
  };

  const handleClose = () => {
    // Reset state
    setFile(null);
    setStep('select');
    setJobId(null);
    setError(null);
    onClose();
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={step === 'select' || step === 'complete' || step === 'error' ? handleClose : undefined}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={cn(
          'relative z-10 w-full max-w-xl',
          'bg-bg-surface rounded-2xl shadow-2xl border border-border',
          'flex flex-col overflow-hidden'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Upload OVA Template</h2>
              <p className="text-sm text-text-muted">
                {step === 'select' && 'Select an OVA file to upload'}
                {step === 'uploading' && 'Uploading file...'}
                {step === 'processing' && 'Processing OVA...'}
                {step === 'complete' && 'Upload complete!'}
                {step === 'error' && 'Upload failed'}
              </p>
            </div>
          </div>
          {(step === 'select' || step === 'complete' || step === 'error') && (
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6 min-h-[300px]">
          <AnimatePresence mode="wait">
            {/* File Selection */}
            {step === 'select' && (
              <motion.div
                key="select"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Info Banner */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-info/10 border border-info/20">
                  <Info className="w-5 h-5 text-info flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="text-text-primary font-medium">OVA/OVF Templates</p>
                    <p className="text-text-muted mt-1">
                      Upload OVA files exported from VMware, VirtualBox, or other virtualization platforms.
                      The VMDK disk will be automatically converted to QCOW2 format.
                    </p>
                  </div>
                </div>

                {/* Drop Zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-8 text-center transition-all',
                    dragOver ? 'border-accent bg-accent/5' : 'border-border',
                    file && 'border-success bg-success/5'
                  )}
                >
                  {file ? (
                    <div className="space-y-3">
                      <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto">
                        <FileArchive className="w-8 h-8 text-success" />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">{file.name}</p>
                        <p className="text-sm text-text-muted mt-1">
                          {formatBytes(file.size)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFile(null)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="w-16 h-16 rounded-2xl bg-bg-elevated flex items-center justify-center mx-auto">
                        <Upload className="w-8 h-8 text-text-muted" />
                      </div>
                      <div>
                        <p className="text-text-secondary font-medium">
                          Drag and drop your OVA file here
                        </p>
                        <p className="text-sm text-text-muted mt-1">or</p>
                      </div>
                      <label className="cursor-pointer inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 bg-bg-elevated hover:bg-bg-hover text-text-primary border border-border hover:border-border-hover px-4 py-2 text-sm">
                        <input
                          type="file"
                          accept=".ova"
                          onChange={(e) => handleFileSelect(e.target.files)}
                          className="hidden"
                        />
                        Browse Files
                      </label>
                      <p className="text-xs text-text-muted">
                        Supports .ova files up to 50 GB
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Uploading / Processing */}
            {(step === 'uploading' || step === 'processing') && (
              <motion.div
                key="progress"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6"
              >
                {/* Progress Circle */}
                <div className="flex flex-col items-center justify-center py-4">
                  <div className="relative w-24 h-24">
                    <svg className="w-24 h-24 transform -rotate-90">
                      <circle
                        cx="48"
                        cy="48"
                        r="40"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        className="text-bg-elevated"
                      />
                      <circle
                        cx="48"
                        cy="48"
                        r="40"
                        stroke="currentColor"
                        strokeWidth="8"
                        fill="none"
                        strokeLinecap="round"
                        className="text-accent transition-all duration-300"
                        strokeDasharray={251.2}
                        strokeDashoffset={251.2 - (251.2 * (uploadStatus?.progressPercent || 0)) / 100}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xl font-bold text-text-primary">
                        {uploadStatus?.progressPercent || 0}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status Info */}
                <div className="text-center space-y-2">
                  <p className="font-medium text-text-primary">
                    {uploadStatus?.currentStep || 'Starting upload...'}
                  </p>
                  {uploadStatus?.bytesTotal && uploadStatus.bytesTotal > 0 && (
                    <p className="text-sm text-text-muted">
                      {formatBytes(uploadStatus.bytesUploaded || 0)} / {formatBytes(uploadStatus.bytesTotal)}
                    </p>
                  )}
                </div>

                {/* Processing Steps */}
                {step === 'processing' && (
                  <div className="space-y-2">
                    <ProcessingStep
                      label="Extracting OVA archive"
                      status={getStepStatus('EXTRACTING', uploadStatus?.status)}
                    />
                    <ProcessingStep
                      label="Parsing OVF descriptor"
                      status={getStepStatus('PARSING', uploadStatus?.status)}
                    />
                    <ProcessingStep
                      label="Converting VMDK to QCOW2"
                      status={getStepStatus('CONVERTING', uploadStatus?.status)}
                    />
                  </div>
                )}

                {/* Metadata Preview */}
                {uploadStatus?.metadata && (
                  <MetadataPreview metadata={uploadStatus.metadata} />
                )}
              </motion.div>
            )}

            {/* Complete */}
            {step === 'complete' && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-6"
              >
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center mb-4">
                    <CheckCircle className="w-10 h-10 text-success" />
                  </div>
                  <h3 className="text-xl font-semibold text-text-primary">Upload Complete!</h3>
                  <p className="text-text-muted mt-2 text-center">
                    Your OVA template has been processed and is ready to use.
                  </p>
                </div>

                {uploadStatus?.metadata && (
                  <MetadataPreview metadata={uploadStatus.metadata} />
                )}
              </motion.div>
            )}

            {/* Error */}
            {step === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center justify-center py-8"
              >
                <div className="w-20 h-20 rounded-full bg-error/10 flex items-center justify-center mb-4">
                  <AlertCircle className="w-10 h-10 text-error" />
                </div>
                <h3 className="text-xl font-semibold text-text-primary">Upload Failed</h3>
                <p className="text-text-muted mt-2 text-center max-w-sm">
                  {error || 'An error occurred while processing the OVA file.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elevated/50">
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={!file || uploadOVA.isPending}>
                {uploadOVA.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Upload OVA'
                )}
              </Button>
            </>
          )}

          {(step === 'uploading' || step === 'processing') && (
            <p className="text-sm text-text-muted w-full text-center">
              Please wait while the OVA is being processed...
            </p>
          )}

          {(step === 'complete' || step === 'error') && (
            <Button className="w-full" onClick={handleClose}>
              {step === 'complete' ? 'Done' : 'Close'}
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// Helper component for processing steps
function ProcessingStep({ label, status }: { label: string; status: 'pending' | 'active' | 'complete' }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-base">
      {status === 'pending' && (
        <div className="w-5 h-5 rounded-full border-2 border-border" />
      )}
      {status === 'active' && (
        <Loader2 className="w-5 h-5 text-accent animate-spin" />
      )}
      {status === 'complete' && (
        <Check className="w-5 h-5 text-success" />
      )}
      <span className={cn(
        'text-sm',
        status === 'active' ? 'text-text-primary font-medium' : 'text-text-muted'
      )}>
        {label}
      </span>
    </div>
  );
}

function getStepStatus(stepName: string, currentStatus?: string): 'pending' | 'active' | 'complete' {
  const steps = ['UPLOADING', 'EXTRACTING', 'PARSING', 'CONVERTING', 'COMPLETED'];
  const currentIndex = steps.indexOf(currentStatus || 'UPLOADING');
  const stepIndex = steps.indexOf(stepName);

  if (currentIndex > stepIndex) return 'complete';
  if (currentIndex === stepIndex) return 'active';
  return 'pending';
}

// Metadata preview component
function MetadataPreview({ metadata }: { metadata: OVAMetadata }) {
  return (
    <div className="space-y-3 p-4 rounded-xl bg-bg-base border border-border">
      <h4 className="font-medium text-text-primary flex items-center gap-2">
        <Info className="w-4 h-4 text-accent" />
        Template Details
      </h4>

      <div className="grid grid-cols-2 gap-3">
        {metadata.vmName && (
          <div>
            <p className="text-xs text-text-muted">Name</p>
            <p className="text-sm text-text-primary font-medium">{metadata.vmName}</p>
          </div>
        )}

        {metadata.hardware && (
          <>
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-xs text-text-muted">CPU</p>
                <p className="text-sm text-text-primary">{metadata.hardware.cpuCount} vCPU</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <MemoryStick className="w-4 h-4 text-text-muted" />
              <div>
                <p className="text-xs text-text-muted">Memory</p>
                <p className="text-sm text-text-primary">{metadata.hardware.memoryMib} MiB</p>
              </div>
            </div>
          </>
        )}

        {metadata.disks && metadata.disks.length > 0 && (
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-text-muted" />
            <div>
              <p className="text-xs text-text-muted">Disks</p>
              <p className="text-sm text-text-primary">
                {metadata.disks.length} disk{metadata.disks.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}

        {metadata.networks && metadata.networks.length > 0 && (
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-text-muted" />
            <div>
              <p className="text-xs text-text-muted">Networks</p>
              <p className="text-sm text-text-primary">
                {metadata.networks.length} adapter{metadata.networks.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}
      </div>

      {metadata.description && (
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-text-muted">Description</p>
          <p className="text-sm text-text-secondary mt-1 line-clamp-2">{metadata.description}</p>
        </div>
      )}
    </div>
  );
}

export default OVAUploadModal;
