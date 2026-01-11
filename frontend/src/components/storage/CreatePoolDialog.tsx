import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Database,
  HardDrive,
  Server,
  Folder,
  ChevronRight,
  AlertCircle,
  Loader2,
  Check,
  Monitor,
  CheckCircle,
  Circle,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useCreateStoragePool, type CreatePoolParams } from '@/hooks/useStorage';
import { useNodes } from '@/hooks/useNodes';
import { toast } from 'sonner';

interface CreatePoolDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type BackendType = 'CEPH_RBD' | 'NFS' | 'ISCSI' | 'LOCAL_DIR';

const backendOptions: { type: BackendType; label: string; description: string; icon: typeof Database }[] = [
  {
    type: 'CEPH_RBD',
    label: 'Ceph RBD',
    description: 'Distributed block storage (recommended for HA)',
    icon: Database,
  },
  {
    type: 'NFS',
    label: 'NFS',
    description: 'Network file storage (enterprise NAS)',
    icon: Server,
  },
  {
    type: 'ISCSI',
    label: 'iSCSI',
    description: 'Block storage over network (enterprise SAN)',
    icon: HardDrive,
  },
  {
    type: 'LOCAL_DIR',
    label: 'Local Directory',
    description: 'Local storage (development/single-node)',
    icon: Folder,
  },
];

export function CreatePoolDialog({ isOpen, onClose }: CreatePoolDialogProps) {
  const [step, setStep] = useState<'type' | 'config' | 'hosts' | 'review'>('type');
  const [selectedType, setSelectedType] = useState<BackendType | null>(null);
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    // NFS
    nfsServer: '',
    nfsExportPath: '',
    nfsVersion: '4.1',
    // Ceph
    cephPoolName: '',
    cephMonitors: '',
    cephUser: 'admin',
    cephKeyringPath: '/etc/ceph/ceph.client.admin.keyring',
    // iSCSI
    iscsiPortal: '',
    iscsiTarget: '',
    iscsiChapEnabled: false,
    iscsiChapUser: '',
    iscsiChapPassword: '',
    // Local
    localPath: '/var/lib/limiquantix/pools',
  });
  
  const createPool = useCreateStoragePool();
  const { data: nodesResponse, isLoading: nodesLoading } = useNodes();
  
  // Extract nodes array from response
  const nodes = nodesResponse?.nodes ?? [];
  
  // Get only ready nodes
  const readyNodes = useMemo(() => 
    nodes.filter(node => node.status?.phase === 'READY' || node.status?.phase === 'NODE_PHASE_READY'),
    [nodes]
  );
  
  // Helper to check if storage type supports multi-host
  const isSharedStorage = selectedType === 'NFS' || selectedType === 'CEPH_RBD';
  
  // Toggle host selection
  const toggleHost = (nodeId: string) => {
    if (selectedHostIds.includes(nodeId)) {
      setSelectedHostIds(selectedHostIds.filter(id => id !== nodeId));
    } else {
      // For local storage, only allow one host
      if (selectedType === 'LOCAL_DIR') {
        setSelectedHostIds([nodeId]);
      } else {
        setSelectedHostIds([...selectedHostIds, nodeId]);
      }
    }
  };
  
  // Select all hosts (for shared storage)
  const selectAllHosts = () => {
    setSelectedHostIds(readyNodes.map(n => n.id));
  };
  
  // Clear selection
  const clearHostSelection = () => {
    setSelectedHostIds([]);
  };
  
  const resetForm = () => {
    setStep('type');
    setSelectedType(null);
    setSelectedHostIds([]);
    setFormData({
      name: '',
      description: '',
      nfsServer: '',
      nfsExportPath: '',
      nfsVersion: '4.1',
      cephPoolName: '',
      cephMonitors: '',
      cephUser: 'admin',
      cephKeyringPath: '/etc/ceph/ceph.client.admin.keyring',
      iscsiPortal: '',
      iscsiTarget: '',
      iscsiChapEnabled: false,
      iscsiChapUser: '',
      iscsiChapPassword: '',
      localPath: '/var/lib/limiquantix/pools',
    });
  };
  
  const handleClose = () => {
    resetForm();
    onClose();
  };
  
  const handleSubmit = async () => {
    if (!selectedType) return;
    
    const params: CreatePoolParams = {
      name: formData.name,
      description: formData.description,
      backendType: selectedType,
      assignedNodeIds: selectedHostIds,
    };
    
    switch (selectedType) {
      case 'NFS':
        params.nfs = {
          server: formData.nfsServer,
          exportPath: formData.nfsExportPath,
          version: formData.nfsVersion,
        };
        break;
      case 'CEPH_RBD':
        params.ceph = {
          poolName: formData.cephPoolName,
          monitors: formData.cephMonitors.split(',').map(m => m.trim()),
          user: formData.cephUser,
          keyringPath: formData.cephKeyringPath,
        };
        break;
      case 'ISCSI':
        params.iscsi = {
          portal: formData.iscsiPortal,
          target: formData.iscsiTarget,
          chapEnabled: formData.iscsiChapEnabled,
          chapUser: formData.iscsiChapUser,
          chapPassword: formData.iscsiChapPassword,
        };
        break;
      case 'LOCAL_DIR':
        params.local = {
          path: formData.localPath,
        };
        break;
    }
    
    try {
      await createPool.mutateAsync(params);
      toast.success(`Storage pool "${formData.name}" created successfully`);
      handleClose();
    } catch (error) {
      toast.error(`Failed to create pool: ${(error as Error).message}`);
    }
  };
  
  const canProceed = () => {
    switch (step) {
      case 'type':
        return selectedType !== null;
      case 'config':
        if (!formData.name) return false;
        switch (selectedType) {
          case 'NFS':
            return formData.nfsServer && formData.nfsExportPath;
          case 'CEPH_RBD':
            return formData.cephPoolName && formData.cephMonitors;
          case 'ISCSI':
            return formData.iscsiPortal && formData.iscsiTarget;
          case 'LOCAL_DIR':
            return formData.localPath;
          default:
            return false;
        }
      case 'hosts':
        // Host selection is optional for shared storage, required for local
        if (selectedType === 'LOCAL_DIR') {
          return selectedHostIds.length === 1;
        }
        return true; // Optional for shared storage
      case 'review':
        return true;
      default:
        return false;
    }
  };
  
  // Step labels and count
  const steps = ['type', 'config', 'hosts', 'review'] as const;
  const stepLabels = {
    type: 'Select Type',
    config: 'Configure',
    hosts: 'Assign Hosts',
    review: 'Review',
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
            'relative z-10 w-full max-w-2xl',
            'bg-bg-surface rounded-2xl border border-border',
            'shadow-2xl overflow-hidden',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                <Database className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Create Storage Pool</h2>
                <p className="text-sm text-text-muted">
                  {step === 'type' && 'Select storage backend type'}
                  {step === 'config' && 'Configure pool settings'}
                  {step === 'hosts' && 'Select hosts to assign'}
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
              {steps.map((s, i) => (
                <div key={s} className="flex items-center">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                      step === s
                        ? 'bg-accent text-white'
                        : steps.indexOf(step) > i
                        ? 'bg-success text-white'
                        : 'bg-bg-elevated text-text-muted',
                    )}
                  >
                    {steps.indexOf(step) > i ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      i + 1
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={cn(
                        'w-16 h-0.5 mx-2',
                        steps.indexOf(step) > i
                          ? 'bg-success'
                          : 'bg-bg-elevated',
                      )}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          
          {/* Content */}
          <div className="p-6 max-h-[60vh] overflow-y-auto">
            <AnimatePresence mode="wait">
              {step === 'type' && (
                <motion.div
                  key="type"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-3"
                >
                  {backendOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.type}
                        onClick={() => setSelectedType(option.type)}
                        className={cn(
                          'w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left',
                          selectedType === option.type
                            ? 'border-accent bg-accent/10 shadow-lg'
                            : 'border-border bg-bg-base hover:border-text-muted hover:bg-bg-hover',
                        )}
                      >
                        <div
                          className={cn(
                            'w-12 h-12 rounded-lg flex items-center justify-center',
                            selectedType === option.type
                              ? 'bg-accent/20'
                              : 'bg-bg-elevated',
                          )}
                        >
                          <Icon
                            className={cn(
                              'w-6 h-6',
                              selectedType === option.type
                                ? 'text-accent'
                                : 'text-text-muted',
                            )}
                          />
                        </div>
                        <div className="flex-1">
                          <h3
                            className={cn(
                              'font-medium',
                              selectedType === option.type
                                ? 'text-accent'
                                : 'text-text-primary',
                            )}
                          >
                            {option.label}
                          </h3>
                          <p className="text-sm text-text-muted">{option.description}</p>
                        </div>
                        <ChevronRight
                          className={cn(
                            'w-5 h-5',
                            selectedType === option.type
                              ? 'text-accent'
                              : 'text-text-muted',
                          )}
                        />
                      </button>
                    );
                  })}
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
                  {/* Common fields */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-medium text-text-secondary">General Settings</h3>
                    <div className="grid gap-4">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1.5">
                          Pool Name *
                        </label>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          placeholder="e.g., fast-nvme, ceph-ssd"
                          className={cn(
                            'w-full px-4 py-2.5 rounded-lg',
                            'bg-bg-base border border-border',
                            'text-text-primary placeholder:text-text-muted',
                            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                          )}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1.5">
                          Description
                        </label>
                        <input
                          type="text"
                          value={formData.description}
                          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                          placeholder="Optional description"
                          className={cn(
                            'w-full px-4 py-2.5 rounded-lg',
                            'bg-bg-base border border-border',
                            'text-text-primary placeholder:text-text-muted',
                            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                          )}
                        />
                      </div>
                    </div>
                  </div>
                  
                  {/* Backend-specific fields */}
                  {selectedType === 'NFS' && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-text-secondary">NFS Configuration</h3>
                      <div className="grid gap-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1.5">
                              Server Address *
                            </label>
                            <input
                              type="text"
                              value={formData.nfsServer}
                              onChange={(e) => setFormData({ ...formData, nfsServer: e.target.value })}
                              placeholder="192.168.1.50 or nfs.example.com"
                              className={cn(
                                'w-full px-4 py-2.5 rounded-lg',
                                'bg-bg-base border border-border',
                                'text-text-primary placeholder:text-text-muted',
                                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                              )}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1.5">
                              NFS Version
                            </label>
                            <select
                              value={formData.nfsVersion}
                              onChange={(e) => setFormData({ ...formData, nfsVersion: e.target.value })}
                              className={cn(
                                'w-full px-4 py-2.5 rounded-lg',
                                'bg-bg-base border border-border',
                                'text-text-primary',
                                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                              )}
                            >
                              <option value="3">NFSv3</option>
                              <option value="4">NFSv4</option>
                              <option value="4.1">NFSv4.1</option>
                              <option value="4.2">NFSv4.2</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-text-secondary mb-1.5">
                            Export Path *
                          </label>
                          <input
                            type="text"
                            value={formData.nfsExportPath}
                            onChange={(e) => setFormData({ ...formData, nfsExportPath: e.target.value })}
                            placeholder="/mnt/ssd-pool"
                            className={cn(
                              'w-full px-4 py-2.5 rounded-lg',
                              'bg-bg-base border border-border',
                              'text-text-primary placeholder:text-text-muted',
                              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {selectedType === 'CEPH_RBD' && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-text-secondary">Ceph Configuration</h3>
                      <div className="grid gap-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1.5">
                              Pool Name *
                            </label>
                            <input
                              type="text"
                              value={formData.cephPoolName}
                              onChange={(e) => setFormData({ ...formData, cephPoolName: e.target.value })}
                              placeholder="libvirt-pool"
                              className={cn(
                                'w-full px-4 py-2.5 rounded-lg',
                                'bg-bg-base border border-border',
                                'text-text-primary placeholder:text-text-muted',
                                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                              )}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1.5">
                              User
                            </label>
                            <input
                              type="text"
                              value={formData.cephUser}
                              onChange={(e) => setFormData({ ...formData, cephUser: e.target.value })}
                              placeholder="admin"
                              className={cn(
                                'w-full px-4 py-2.5 rounded-lg',
                                'bg-bg-base border border-border',
                                'text-text-primary placeholder:text-text-muted',
                                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                              )}
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-text-secondary mb-1.5">
                            Monitors *
                          </label>
                          <input
                            type="text"
                            value={formData.cephMonitors}
                            onChange={(e) => setFormData({ ...formData, cephMonitors: e.target.value })}
                            placeholder="10.0.0.1:6789, 10.0.0.2:6789, 10.0.0.3:6789"
                            className={cn(
                              'w-full px-4 py-2.5 rounded-lg',
                              'bg-bg-base border border-border',
                              'text-text-primary placeholder:text-text-muted',
                              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                            )}
                          />
                          <p className="text-xs text-text-muted mt-1">Comma-separated list of monitor addresses</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-text-secondary mb-1.5">
                            Keyring Path
                          </label>
                          <input
                            type="text"
                            value={formData.cephKeyringPath}
                            onChange={(e) => setFormData({ ...formData, cephKeyringPath: e.target.value })}
                            placeholder="/etc/ceph/ceph.client.admin.keyring"
                            className={cn(
                              'w-full px-4 py-2.5 rounded-lg',
                              'bg-bg-base border border-border',
                              'text-text-primary placeholder:text-text-muted',
                              'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {selectedType === 'ISCSI' && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-text-secondary">iSCSI Configuration</h3>
                      <div className="grid gap-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1.5">
                              Portal Address *
                            </label>
                            <input
                              type="text"
                              value={formData.iscsiPortal}
                              onChange={(e) => setFormData({ ...formData, iscsiPortal: e.target.value })}
                              placeholder="192.168.1.50:3260"
                              className={cn(
                                'w-full px-4 py-2.5 rounded-lg',
                                'bg-bg-base border border-border',
                                'text-text-primary placeholder:text-text-muted',
                                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                              )}
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-text-secondary mb-1.5">
                              Target IQN *
                            </label>
                            <input
                              type="text"
                              value={formData.iscsiTarget}
                              onChange={(e) => setFormData({ ...formData, iscsiTarget: e.target.value })}
                              placeholder="iqn.2023-01.com.storage:ssd-pool"
                              className={cn(
                                'w-full px-4 py-2.5 rounded-lg',
                                'bg-bg-base border border-border',
                                'text-text-primary placeholder:text-text-muted',
                                'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                              )}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id="chapEnabled"
                            checked={formData.iscsiChapEnabled}
                            onChange={(e) => setFormData({ ...formData, iscsiChapEnabled: e.target.checked })}
                            className="w-4 h-4 rounded border-border text-accent focus:ring-accent/30"
                          />
                          <label htmlFor="chapEnabled" className="text-sm text-text-secondary">
                            Enable CHAP Authentication
                          </label>
                        </div>
                        {formData.iscsiChapEnabled && (
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                                CHAP Username
                              </label>
                              <input
                                type="text"
                                value={formData.iscsiChapUser}
                                onChange={(e) => setFormData({ ...formData, iscsiChapUser: e.target.value })}
                                placeholder="username"
                                className={cn(
                                  'w-full px-4 py-2.5 rounded-lg',
                                  'bg-bg-base border border-border',
                                  'text-text-primary placeholder:text-text-muted',
                                  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                                )}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-text-secondary mb-1.5">
                                CHAP Password
                              </label>
                              <input
                                type="password"
                                value={formData.iscsiChapPassword}
                                onChange={(e) => setFormData({ ...formData, iscsiChapPassword: e.target.value })}
                                placeholder="••••••••"
                                className={cn(
                                  'w-full px-4 py-2.5 rounded-lg',
                                  'bg-bg-base border border-border',
                                  'text-text-primary placeholder:text-text-muted',
                                  'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                                )}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {selectedType === 'LOCAL_DIR' && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-text-secondary">Local Directory Configuration</h3>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1.5">
                          Directory Path *
                        </label>
                        <input
                          type="text"
                          value={formData.localPath}
                          onChange={(e) => setFormData({ ...formData, localPath: e.target.value })}
                          placeholder="/var/lib/limiquantix/pools/my-pool"
                          className={cn(
                            'w-full px-4 py-2.5 rounded-lg',
                            'bg-bg-base border border-border',
                            'text-text-primary placeholder:text-text-muted',
                            'focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
                          )}
                        />
                        <p className="text-xs text-text-muted mt-1">
                          Directory will be created if it doesn't exist
                        </p>
                      </div>
                      <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
                        <AlertCircle className="w-4 h-4 text-warning shrink-0" />
                        <p className="text-xs text-warning">
                          Local storage is only accessible from a single node. Not recommended for production.
                        </p>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
              
              {step === 'hosts' && (
                <motion.div
                  key="hosts"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  {/* Info banner */}
                  <div className={cn(
                    'flex items-start gap-3 p-4 rounded-lg',
                    isSharedStorage ? 'bg-info/10 border border-info/30' : 'bg-warning/10 border border-warning/30'
                  )}>
                    <Info className={cn('w-5 h-5 shrink-0', isSharedStorage ? 'text-info' : 'text-warning')} />
                    <div>
                      <p className={cn('text-sm font-medium', isSharedStorage ? 'text-info' : 'text-warning')}>
                        {isSharedStorage ? 'Shared Storage' : 'Local Storage'}
                      </p>
                      <p className={cn('text-xs mt-1', isSharedStorage ? 'text-info/80' : 'text-warning/80')}>
                        {isSharedStorage 
                          ? 'This pool can be accessed by multiple hosts simultaneously. Select all hosts that should have access.'
                          : 'Local storage can only be accessed by a single host. Select exactly one host.'}
                      </p>
                    </div>
                  </div>
                  
                  {/* Quick actions for shared storage */}
                  {isSharedStorage && (
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="secondary" 
                        size="sm" 
                        onClick={selectAllHosts}
                        disabled={readyNodes.length === 0}
                      >
                        Select All ({readyNodes.length})
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={clearHostSelection}
                        disabled={selectedHostIds.length === 0}
                      >
                        Clear Selection
                      </Button>
                    </div>
                  )}
                  
                  {/* Loading state */}
                  {nodesLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-accent mr-2" />
                      <span className="text-text-muted">Loading hosts...</span>
                    </div>
                  )}
                  
                  {/* No hosts warning */}
                  {!nodesLoading && readyNodes.length === 0 && (
                    <div className="flex items-center gap-2 p-4 rounded-lg bg-warning/10 border border-warning/30">
                      <AlertCircle className="w-5 h-5 text-warning shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-warning">No Hosts Available</p>
                        <p className="text-xs text-warning/80 mt-1">
                          Register Quantix-OS hosts first to assign storage pools.
                        </p>
                      </div>
                    </div>
                  )}
                  
                  {/* Host list */}
                  {!nodesLoading && readyNodes.length > 0 && (
                    <div className="space-y-2">
                      {readyNodes.map((node) => {
                        const isSelected = selectedHostIds.includes(node.id);
                        return (
                          <button
                            key={node.id}
                            onClick={() => toggleHost(node.id)}
                            className={cn(
                              'w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left',
                              isSelected
                                ? 'border-accent bg-accent/10 shadow-lg'
                                : 'border-border bg-bg-base hover:border-text-muted hover:bg-bg-hover',
                            )}
                          >
                            <div
                              className={cn(
                                'w-10 h-10 rounded-lg flex items-center justify-center',
                                isSelected ? 'bg-accent/20' : 'bg-bg-elevated',
                              )}
                            >
                              {isSelected ? (
                                <CheckCircle className="w-5 h-5 text-accent" />
                              ) : (
                                <Monitor className="w-5 h-5 text-text-muted" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className={cn('font-medium truncate', isSelected ? 'text-accent' : 'text-text-primary')}>
                                  {node.hostname}
                                </h3>
                                <Badge variant="success" className="shrink-0">
                                  Ready
                                </Badge>
                              </div>
                              <p className="text-sm text-text-muted truncate">
                                {node.managementIp}
                              </p>
                            </div>
                            <div className="text-right text-xs text-text-muted shrink-0">
                              <p>{(node.spec?.cpu?.coresPerSocket ?? 0) * (node.spec?.cpu?.sockets ?? 1)} vCPUs</p>
                              <p>{Math.round((node.spec?.memory?.totalBytes ?? 0) / (1024 * 1024 * 1024))} GB RAM</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  
                  {/* Selection summary */}
                  {selectedHostIds.length > 0 && (
                    <div className="pt-4 border-t border-border">
                      <p className="text-sm text-text-muted">
                        <span className="font-medium text-accent">{selectedHostIds.length}</span>
                        {' '}host{selectedHostIds.length !== 1 ? 's' : ''} selected
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
                      {selectedType && (
                        <>
                          {backendOptions.find(o => o.type === selectedType)?.icon && (
                            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                              {(() => {
                                const Icon = backendOptions.find(o => o.type === selectedType)?.icon;
                                return Icon ? <Icon className="w-5 h-5 text-accent" /> : null;
                              })()}
                            </div>
                          )}
                          <div>
                            <h3 className="font-medium text-text-primary">{formData.name}</h3>
                            <p className="text-sm text-text-muted">
                              {backendOptions.find(o => o.type === selectedType)?.label}
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                      {formData.description && (
                        <div className="col-span-2">
                          <p className="text-xs text-text-muted">Description</p>
                          <p className="text-sm text-text-primary">{formData.description}</p>
                        </div>
                      )}
                      
                      {selectedType === 'NFS' && (
                        <>
                          <div>
                            <p className="text-xs text-text-muted">Server</p>
                            <p className="text-sm text-text-primary">{formData.nfsServer}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-muted">Export Path</p>
                            <p className="text-sm text-text-primary">{formData.nfsExportPath}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-muted">Version</p>
                            <p className="text-sm text-text-primary">NFSv{formData.nfsVersion}</p>
                          </div>
                        </>
                      )}
                      
                      {selectedType === 'CEPH_RBD' && (
                        <>
                          <div>
                            <p className="text-xs text-text-muted">Pool Name</p>
                            <p className="text-sm text-text-primary">{formData.cephPoolName}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-muted">User</p>
                            <p className="text-sm text-text-primary">{formData.cephUser}</p>
                          </div>
                          <div className="col-span-2">
                            <p className="text-xs text-text-muted">Monitors</p>
                            <p className="text-sm text-text-primary">{formData.cephMonitors}</p>
                          </div>
                        </>
                      )}
                      
                      {selectedType === 'ISCSI' && (
                        <>
                          <div>
                            <p className="text-xs text-text-muted">Portal</p>
                            <p className="text-sm text-text-primary">{formData.iscsiPortal}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-muted">Target</p>
                            <p className="text-sm text-text-primary font-mono text-xs">{formData.iscsiTarget}</p>
                          </div>
                          <div>
                            <p className="text-xs text-text-muted">CHAP</p>
                            <p className="text-sm text-text-primary">
                              {formData.iscsiChapEnabled ? 'Enabled' : 'Disabled'}
                            </p>
                          </div>
                        </>
                      )}
                      
                      {selectedType === 'LOCAL_DIR' && (
                        <div className="col-span-2">
                          <p className="text-xs text-text-muted">Path</p>
                          <p className="text-sm text-text-primary font-mono">{formData.localPath}</p>
                        </div>
                      )}
                      
                      {/* Assigned Hosts */}
                      <div className="col-span-2 pt-4 border-t border-border">
                        <p className="text-xs text-text-muted mb-2">Assigned Hosts</p>
                        {selectedHostIds.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedHostIds.map((nodeId) => {
                              const node = nodes.find(n => n.id === nodeId);
                              return (
                                <Badge key={nodeId} variant="default" className="flex items-center gap-1.5">
                                  <Monitor className="w-3 h-3" />
                                  {node?.hostname || nodeId.slice(0, 8)}
                                </Badge>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-text-muted italic">
                            No hosts assigned - will initialize on first available node
                          </p>
                        )}
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
                if (step === 'type') {
                  handleClose();
                } else if (step === 'config') {
                  setStep('type');
                } else if (step === 'hosts') {
                  setStep('config');
                } else if (step === 'review') {
                  setStep('hosts');
                }
              }}
            >
              {step === 'type' ? 'Cancel' : 'Back'}
            </Button>
            <Button
              onClick={() => {
                if (step === 'type') {
                  setStep('config');
                } else if (step === 'config') {
                  setStep('hosts');
                } else if (step === 'hosts') {
                  setStep('review');
                } else {
                  handleSubmit();
                }
              }}
              disabled={!canProceed() || createPool.isPending}
            >
              {createPool.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : step === 'review' ? (
                'Create Pool'
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
