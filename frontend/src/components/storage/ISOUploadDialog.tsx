import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Upload,
  Disc,
  Link,
  Check,
  Loader2,
  FileUp,
  Globe,
  Database,
  HardDrive,
  Server,
  FolderOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useImportImage, useCreateImage, formatImageSize } from '@/hooks/useImages';
import { useStoragePools, type StoragePoolUI } from '@/hooks/useStorage';
import { useNodes, isNodeReady } from '@/hooks/useNodes';
import { toast } from 'sonner';

interface ISOUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type UploadMethod = 'url' | 'file';
type OsFamily = 'LINUX' | 'WINDOWS' | 'BSD' | 'OTHER';
type StorageDestination = 'auto' | 'pool' | 'node';

interface FormData {
  name: string;
  description: string;
  method: UploadMethod;
  url: string;
  file: File | null;
  osFamily: OsFamily;
  distribution: string;
  version: string;
  storageDestination: StorageDestination;
  storagePoolId: string;
  nodeId: string;
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
  storageDestination: 'auto',
  storagePoolId: '',
  nodeId: '',
};

export function ISOUploadDialog({ isOpen, onClose }: ISOUploadDialogProps) {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [dragOver, setDragOver] = useState(false);
  const [step, setStep] = useState(1); // 1 = method, 2 = details, 3 = uploading

  const importImage = useImportImage();
  const createImage = useCreateImage();
  const { data: storagePools, isLoading: poolsLoading } = useStoragePools();
  const { data: nodesData, isLoading: nodesLoading } = useNodes({ pageSize: 100 });

  const readyPools = storagePools?.filter(p => p.status.phase === 'READY') || [];
  const readyNodes = nodesData?.nodes?.filter(isNodeReady) || [];

  // Group pools by type for better UX
  const poolsByType = readyPools.reduce((acc, pool) => {
    const type = pool.type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(pool);
    return acc;
  }, {} as Record<string, StoragePoolUI[]>);

  const storageTypeIcon = (type: string) => {
    switch (type) {
      case 'NFS': return <FolderOpen className="w-4 h-4" />;
      case 'CEPH_RBD': return <Database className="w-4 h-4" />;
      case 'LOCAL_DIR':
      case 'LOCAL_LVM': return <HardDrive className="w-4 h-4" />;
      default: return <HardDrive className="w-4 h-4" />;
    }
  };

  const storageTypeLabel = (type: string) => {
    switch (type) {
      case 'NFS': return 'NFS Storage';
      case 'CEPH_RBD': return 'Ceph RBD';
      case 'LOCAL_DIR': return 'Local Directory';
      case 'LOCAL_LVM': return 'LVM Storage';
      case 'ISCSI': return 'iSCSI';
      default: return type;
    }
  };

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

    // Validate storage selection
    if (formData.storageDestination === 'pool' && !formData.storagePoolId) {
      toast.error('Please select a storage pool');
      return;
    }

    if (formData.storageDestination === 'node' && !formData.nodeId) {
      toast.error('Please select a node');
      return;
    }

    setStep(3);

    try {
      if (formData.method === 'url') {
        // Determine storage parameters based on destination
        const storageParams: { storagePoolId?: string; nodeId?: string } = {};
        if (formData.storageDestination === 'pool') {
          storageParams.storagePoolId = formData.storagePoolId;
        } else if (formData.storageDestination === 'node') {
          storageParams.nodeId = formData.nodeId;
        }
        // 'auto' = don't pass any, let backend decide

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
          ...storageParams,
        });

        // Build success message
        let destinationMsg = '';
        if (formData.storageDestination === 'pool') {
          const pool = readyPools.find(p => p.id === formData.storagePoolId);
          destinationMsg = pool ? ` to ${pool.name}` : '';
        } else if (formData.storageDestination === 'node') {
          const node = readyNodes.find(n => n.id === formData.nodeId);
          destinationMsg = node ? ` to ${node.hostname || node.id}` : '';
        }
        toast.success(`ISO import started${destinationMsg}! Check the Image Library for progress.`);
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
                        <label className="cursor-pointer inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 bg-bg-elevated hover:bg-bg-hover text-text-primary border border-border hover:border-border-hover px-3 py-1.5 text-xs">
                          <input
                            type="file"
                            accept=".iso"
                            onChange={(e) => handleFileSelect(e.target.files)}
                            className="hidden"
                          />
                          Browse Files
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
                className="space-y-4 max-h-[400px] overflow-y-auto pr-2"
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

                {/* Storage Destination Section */}
                <div className="space-y-3 pt-2 border-t border-border">
                  <label className="text-sm font-medium text-text-secondary flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Storage Destination
                  </label>

                  {/* Destination Type Selection */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => updateFormData({ storageDestination: 'auto', storagePoolId: '', nodeId: '' })}
                      className={cn(
                        'p-3 rounded-lg border-2 transition-all text-center',
                        formData.storageDestination === 'auto'
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-accent/50'
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg bg-bg-elevated mx-auto mb-1.5 flex items-center justify-center">
                        <Check className="w-4 h-4 text-accent" />
                      </div>
                      <p className="text-xs font-medium text-text-primary">Auto</p>
                      <p className="text-[10px] text-text-muted mt-0.5">Let system decide</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateFormData({ storageDestination: 'pool', nodeId: '' })}
                      disabled={readyPools.length === 0}
                      className={cn(
                        'p-3 rounded-lg border-2 transition-all text-center',
                        formData.storageDestination === 'pool'
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-accent/50',
                        readyPools.length === 0 && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg bg-bg-elevated mx-auto mb-1.5 flex items-center justify-center">
                        <Database className="w-4 h-4 text-info" />
                      </div>
                      <p className="text-xs font-medium text-text-primary">Storage Pool</p>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {readyPools.length > 0 ? `${readyPools.length} available` : 'None available'}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => updateFormData({ storageDestination: 'node', storagePoolId: '' })}
                      disabled={readyNodes.length === 0}
                      className={cn(
                        'p-3 rounded-lg border-2 transition-all text-center',
                        formData.storageDestination === 'node'
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-accent/50',
                        readyNodes.length === 0 && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      <div className="w-8 h-8 rounded-lg bg-bg-elevated mx-auto mb-1.5 flex items-center justify-center">
                        <Server className="w-4 h-4 text-success" />
                      </div>
                      <p className="text-xs font-medium text-text-primary">Specific Node</p>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {readyNodes.length > 0 ? `${readyNodes.length} online` : 'None online'}
                      </p>
                    </button>
                  </div>

                  {/* Pool Selection */}
                  {formData.storageDestination === 'pool' && readyPools.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2"
                    >
                      <label className="text-xs text-text-muted">Select Storage Pool</label>
                      <div className="space-y-2 max-h-[120px] overflow-y-auto">
                        {Object.entries(poolsByType).map(([type, pools]) => (
                          <div key={type}>
                            <div className="flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider mb-1">
                              {storageTypeIcon(type)}
                              {storageTypeLabel(type)}
                            </div>
                            {pools.map((pool) => (
                              <button
                                key={pool.id}
                                type="button"
                                onClick={() => updateFormData({ storagePoolId: pool.id })}
                                className={cn(
                                  'w-full px-3 py-2 rounded-lg border text-left transition-all mb-1',
                                  formData.storagePoolId === pool.id
                                    ? 'border-accent bg-accent/10'
                                    : 'border-border hover:border-accent/50 bg-bg-base'
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-text-primary">{pool.name}</span>
                                  <Badge variant="info" size="sm">
                                    {formatImageSize(pool.capacity.availableBytes)} free
                                  </Badge>
                                </div>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Node Selection */}
                  {formData.storageDestination === 'node' && readyNodes.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2"
                    >
                      <label className="text-xs text-text-muted">Select Node (local storage)</label>
                      <div className="space-y-1 max-h-[120px] overflow-y-auto">
                        {readyNodes.map((node) => (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => updateFormData({ nodeId: node.id })}
                            className={cn(
                              'w-full px-3 py-2 rounded-lg border text-left transition-all',
                              formData.nodeId === node.id
                                ? 'border-accent bg-accent/10'
                                : 'border-border hover:border-accent/50 bg-bg-base'
                            )}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Server className="w-4 h-4 text-text-muted" />
                                <span className="text-sm text-text-primary">{node.hostname || node.id}</span>
                              </div>
                              <Badge variant="success" size="sm">Online</Badge>
                            </div>
                            {node.managementIp && (
                              <p className="text-[10px] text-text-muted mt-0.5 ml-6">{node.managementIp}</p>
                            )}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-muted">
                        ISO will be stored on the node's local ISO directory
                      </p>
                    </motion.div>
                  )}

                  {/* Loading state */}
                  {(poolsLoading || nodesLoading) && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 text-text-muted animate-spin" />
                      <span className="ml-2 text-sm text-text-muted">Loading storage options...</span>
                    </div>
                  )}
                </div>
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
