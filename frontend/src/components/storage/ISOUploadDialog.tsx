import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Upload,
  Disc,
  Link,
  Check,
  AlertCircle,
  Loader2,
  FileUp,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useImportImage, useCreateImage, formatImageSize } from '@/hooks/useImages';
import { useStoragePools } from '@/hooks/useStorage';
import { toast } from 'sonner';

interface ISOUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type UploadMethod = 'url' | 'file';
type OsFamily = 'LINUX' | 'WINDOWS' | 'BSD' | 'OTHER';

interface FormData {
  name: string;
  description: string;
  method: UploadMethod;
  url: string;
  file: File | null;
  osFamily: OsFamily;
  distribution: string;
  version: string;
  storagePoolId: string;
}

const OS_DISTRIBUTIONS: Record<OsFamily, string[]> = {
  LINUX: ['Ubuntu', 'Debian', 'Rocky Linux', 'AlmaLinux', 'CentOS', 'Fedora', 'openSUSE', 'Arch Linux', 'Other'],
  WINDOWS: ['Windows Server 2022', 'Windows Server 2019', 'Windows 11', 'Windows 10', 'Other'],
  BSD: ['FreeBSD', 'OpenBSD', 'NetBSD', 'Other'],
  OTHER: ['Other'],
};

const initialFormData: FormData = {
  name: '',
  description: '',
  method: 'url',
  url: '',
  file: null,
  osFamily: 'LINUX',
  distribution: 'Ubuntu',
  version: '',
  storagePoolId: '',
};

export function ISOUploadDialog({ isOpen, onClose }: ISOUploadDialogProps) {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState(1); // 1 = method, 2 = details, 3 = uploading

  const importImage = useImportImage();
  const createImage = useCreateImage();
  const { data: storagePools } = useStoragePools();

  const readyPools = storagePools?.filter(p => p.status.phase === 'READY') || [];

  const updateFormData = (updates: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.iso')) {
        updateFormData({ 
          file,
          name: formData.name || file.name.replace('.iso', ''),
        });
      } else {
        toast.error('Please select an ISO file');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error('Please enter a name');
      return;
    }

    if (formData.method === 'url' && !formData.url.trim()) {
      toast.error('Please enter a URL');
      return;
    }

    if (formData.method === 'file' && !formData.file) {
      toast.error('Please select a file');
      return;
    }

    setStep(3);

    try {
      if (formData.method === 'url') {
        // Import from URL
        await importImage.mutateAsync({
          name: formData.name,
          description: formData.description,
          url: formData.url,
          osInfo: {
            family: osToNumber(formData.osFamily),
            distribution: formData.distribution.toLowerCase().replace(' ', '-'),
            version: formData.version,
            architecture: 'x86_64',
            defaultUser: '',
          },
          storagePoolId: formData.storagePoolId || undefined,
        });
        toast.success('ISO import started! Check the Image Library for progress.');
      } else {
        // Create image record (file upload would need backend support)
        await createImage.mutateAsync({
          name: formData.name,
          description: formData.description,
          spec: {
            format: 'ISO',
            visibility: 'PROJECT',
            osInfo: {
              family: formData.osFamily,
              distribution: formData.distribution.toLowerCase().replace(' ', '-'),
              version: formData.version,
              provisioningMethod: 'NONE',
            },
          },
        });
        toast.success('ISO registered successfully!');
      }
      onClose();
      setFormData(initialFormData);
      setStep(1);
    } catch (err) {
      setStep(2);
      toast.error(err instanceof Error ? err.message : 'Failed to upload ISO');
    }
  };

  const canProceed = () => {
    if (step === 1) {
      if (formData.method === 'url') return formData.url.trim().length > 0;
      return formData.file !== null;
    }
    if (step === 2) {
      return formData.name.trim().length > 0;
    }
    return false;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
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
              <Disc className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Upload ISO</h2>
              <p className="text-sm text-text-muted">
                {step === 1 && 'Choose upload method'}
                {step === 2 && 'Configure ISO details'}
                {step === 3 && 'Uploading...'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 min-h-[300px]">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Method Selection */}
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => updateFormData({ method: 'url' })}
                    className={cn(
                      'p-4 rounded-xl border-2 transition-all text-left',
                      formData.method === 'url'
                        ? 'border-accent bg-accent/10'
                        : 'border-border hover:border-accent/50'
                    )}
                  >
                    <Globe className="w-8 h-8 text-accent mb-2" />
                    <p className="font-medium text-text-primary">From URL</p>
                    <p className="text-xs text-text-muted mt-1">
                      Download from a web URL
                    </p>
                  </button>

                  <button
                    onClick={() => updateFormData({ method: 'file' })}
                    className={cn(
                      'p-4 rounded-xl border-2 transition-all text-left',
                      formData.method === 'file'
                        ? 'border-accent bg-accent/10'
                        : 'border-border hover:border-accent/50'
                    )}
                  >
                    <FileUp className="w-8 h-8 text-accent mb-2" />
                    <p className="font-medium text-text-primary">Upload File</p>
                    <p className="text-xs text-text-muted mt-1">
                      Upload from your computer
                    </p>
                  </button>
                </div>

                {/* URL Input */}
                {formData.method === 'url' && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-text-secondary">
                      ISO URL
                    </label>
                    <div className="relative">
                      <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                      <input
                        type="url"
                        value={formData.url}
                        onChange={(e) => updateFormData({ url: e.target.value })}
                        placeholder="https://releases.ubuntu.com/22.04/ubuntu-22.04.4-live-server-amd64.iso"
                        className="w-full pl-10 pr-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                      />
                    </div>
                    <p className="text-xs text-text-muted">
                      Enter a direct download URL to an ISO file
                    </p>
                  </div>
                )}

                {/* File Drop Zone */}
                {formData.method === 'file' && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={cn(
                      'border-2 border-dashed rounded-xl p-8 text-center transition-colors',
                      dragOver ? 'border-accent bg-accent/5' : 'border-border',
                      formData.file && 'border-success bg-success/5'
                    )}
                  >
                    {formData.file ? (
                      <div className="space-y-2">
                        <Check className="w-10 h-10 text-success mx-auto" />
                        <p className="font-medium text-text-primary">{formData.file.name}</p>
                        <p className="text-sm text-text-muted">
                          {formatImageSize(formData.file.size)}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateFormData({ file: null })}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="w-10 h-10 text-text-muted mx-auto" />
                        <p className="text-text-secondary">
                          Drag and drop your ISO file here
                        </p>
                        <p className="text-sm text-text-muted">or</p>
                        <label>
                          <input
                            type="file"
                            accept=".iso"
                            onChange={(e) => handleFileSelect(e.target.files)}
                            className="hidden"
                          />
                          <Button variant="secondary" size="sm" asChild>
                            <span>Browse Files</span>
                          </Button>
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">
                    Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => updateFormData({ name: e.target.value })}
                    placeholder="e.g., Ubuntu 22.04 LTS Server"
                    className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => updateFormData({ description: e.target.value })}
                    placeholder="Optional description..."
                    rows={2}
                    className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none resize-none"
                  />
                </div>

                {/* OS Family */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-secondary">
                      OS Family
                    </label>
                    <select
                      value={formData.osFamily}
                      onChange={(e) => {
                        const family = e.target.value as OsFamily;
                        updateFormData({ 
                          osFamily: family,
                          distribution: OS_DISTRIBUTIONS[family][0],
                        });
                      }}
                      className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="LINUX">Linux</option>
                      <option value="WINDOWS">Windows</option>
                      <option value="BSD">BSD</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-secondary">
                      Distribution
                    </label>
                    <select
                      value={formData.distribution}
                      onChange={(e) => updateFormData({ distribution: e.target.value })}
                      className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                    >
                      {OS_DISTRIBUTIONS[formData.osFamily].map((dist) => (
                        <option key={dist} value={dist}>{dist}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Version */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-text-secondary">
                    Version
                  </label>
                  <input
                    type="text"
                    value={formData.version}
                    onChange={(e) => updateFormData({ version: e.target.value })}
                    placeholder="e.g., 22.04"
                    className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                {/* Storage Pool */}
                {readyPools.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-text-secondary">
                      Storage Pool
                    </label>
                    <select
                      value={formData.storagePoolId}
                      onChange={(e) => updateFormData({ storagePoolId: e.target.value })}
                      className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="">Auto-select</option>
                      {readyPools.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.name} ({formatImageSize(pool.capacity.availableBytes)} free)
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-8 space-y-4"
              >
                <Loader2 className="w-12 h-12 text-accent animate-spin" />
                <p className="text-text-primary font-medium">
                  {formData.method === 'url' ? 'Starting download...' : 'Uploading ISO...'}
                </p>
                <p className="text-sm text-text-muted">
                  This may take a few minutes depending on the file size
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {step !== 3 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elevated/50">
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 1) onClose();
                else setStep(step - 1);
              }}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>

            <Button
              onClick={() => {
                if (step === 1) setStep(2);
                else handleSubmit();
              }}
              disabled={!canProceed()}
            >
              {step === 1 ? 'Next' : 'Upload ISO'}
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

function osToNumber(family: OsFamily): number {
  const map: Record<OsFamily, number> = { LINUX: 1, WINDOWS: 2, BSD: 3, OTHER: 4 };
  return map[family] ?? 0;
}
