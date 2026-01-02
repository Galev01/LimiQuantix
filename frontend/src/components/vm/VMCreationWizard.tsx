import { useState, useEffect, Fragment, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  MonitorCog,
  Server,
  Folder,
  Settings,
  Cpu,
  Network,
  Disc,
  HardDrive,
  User,
  FileText,
  Plus,
  Trash2,
  Edit,
  CheckCircle,
  AlertCircle,
  MemoryStick,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { mockStoragePools } from '@/data/mock-data';
import { useCreateVM } from '@/hooks/useVMs';
import { useNodes, type ApiNode } from '@/hooks/useNodes';
import { useNetworks, type ApiVirtualNetwork } from '@/hooks/useNetworks';

interface VMCreationWizardProps {
  onClose: () => void;
  onSuccess?: () => void;
}

interface VMCreationData {
  // Step 1: Basic Info
  name: string;
  description: string;
  owner: string;
  scheduleType: 'immediate' | 'scheduled';
  scheduledDate?: string;
  scheduledTime?: string;

  // Step 2: Placement
  clusterId: string;
  hostId: string;
  autoPlacement: boolean;

  // Step 3: Folder
  folderId: string;

  // Step 4: Customization
  installAgent: boolean;
  customSpec: string;
  timezone: string;
  hostname: string;

  // Step 5: Hardware
  cpuCores: number;
  cpuSockets: number;
  memoryMib: number;
  nics: NetworkInterface[];

  // Step 6: ISO
  isoId: string;

  // Step 7: Storage
  storagePoolId: string;
  disks: DiskConfig[];

  // Step 8: User Info (Optional)
  department: string;
  costCenter: string;
  notes: string;
  tags: string[];
}

interface NetworkInterface {
  id: string;
  networkId: string;
  networkName: string;
  connected: boolean;
}

interface DiskConfig {
  id: string;
  name: string;
  sizeGib: number;
  provisioning: 'thin' | 'thick';
}

const STEPS = [
  { id: 'basic', label: 'Basic Info', icon: MonitorCog },
  { id: 'placement', label: 'Placement', icon: Server },
  { id: 'folder', label: 'Folder', icon: Folder },
  { id: 'customization', label: 'Customization', icon: Settings },
  { id: 'hardware', label: 'Hardware', icon: Cpu },
  { id: 'iso', label: 'Boot Media', icon: Disc },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'userinfo', label: 'Additional Info', icon: User },
  { id: 'review', label: 'Review', icon: FileText },
];

// Static data (folders, ISOs, custom specs don't have backend APIs yet)
const staticFolders = [
  { id: 'folder-root', name: '/', path: '/' },
  { id: 'folder-prod', name: 'Production', path: '/Production' },
  { id: 'folder-dev', name: 'Development', path: '/Development' },
  { id: 'folder-test', name: 'Testing', path: '/Testing' },
  { id: 'folder-web', name: 'Web Servers', path: '/Production/Web Servers' },
  { id: 'folder-db', name: 'Databases', path: '/Production/Databases' },
];

const staticISOs = [
  { id: 'iso-ubuntu22', name: 'Ubuntu 22.04 LTS', size: '1.2 GB' },
  { id: 'iso-ubuntu24', name: 'Ubuntu 24.04 LTS', size: '1.4 GB' },
  { id: 'iso-rocky9', name: 'Rocky Linux 9.3', size: '1.8 GB' },
  { id: 'iso-windows-2022', name: 'Windows Server 2022', size: '4.7 GB' },
  { id: 'iso-windows-11', name: 'Windows 11 Enterprise', size: '5.2 GB' },
  { id: 'iso-debian12', name: 'Debian 12 Bookworm', size: '650 MB' },
];

const staticCustomSpecs = [
  { id: 'spec-linux-default', name: 'Linux Default', os: 'Linux' },
  { id: 'spec-windows-default', name: 'Windows Default', os: 'Windows' },
  { id: 'spec-ubuntu-server', name: 'Ubuntu Server Hardened', os: 'Linux' },
  { id: 'spec-custom', name: 'Create New...', os: 'any' },
];

// Fallback network when API returns empty
const fallbackNetwork = {
  id: 'default',
  name: 'Default Network',
  type: 'bridge',
};

const initialFormData: VMCreationData = {
  name: '',
  description: '',
  owner: '',
  scheduleType: 'immediate',
  scheduledDate: '',
  scheduledTime: '',
  clusterId: '',
  hostId: '',
  autoPlacement: true,
  folderId: 'folder-root',
  installAgent: true,
  customSpec: '',
  timezone: 'UTC',
  hostname: '',
  cpuCores: 2,
  cpuSockets: 1,
  memoryMib: 4096,
  nics: [{ id: 'nic-1', networkId: 'net-prod', networkName: 'Production VLAN 100', connected: true }],
  isoId: '',
  storagePoolId: '',
  disks: [{ id: 'disk-1', name: 'Hard disk 1', sizeGib: 50, provisioning: 'thin' }],
  department: '',
  costCenter: '',
  notes: '',
  tags: [],
};

export function VMCreationWizard({ onClose, onSuccess }: VMCreationWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<VMCreationData>(initialFormData);
  const [direction, setDirection] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // API mutation for creating VMs
  const createVM = useCreateVM();

  // Fetch real data from APIs
  const { data: nodesData, isLoading: nodesLoading, error: nodesError, refetch: refetchNodes } = useNodes();
  const { data: networksData, isLoading: networksLoading } = useNetworks();

  // Process nodes into a format usable by the wizard
  const nodes = useMemo(() => {
    if (!nodesData?.nodes?.length) return [];
    return nodesData.nodes.map((node: ApiNode) => ({
      id: node.id,
      hostname: node.hostname,
      managementIp: node.managementIp,
      phase: node.status?.phase || 'UNKNOWN',
      cpuAllocated: node.status?.allocation?.cpuAllocated || 0,
      cpuCapacity: node.status?.allocation?.cpuCapacity || (node.spec?.cpu?.coresPerSocket || 1) * (node.spec?.cpu?.sockets || 1),
      memoryAllocatedMib: node.status?.allocation?.memoryAllocatedMib || 0,
      memoryCapacityMib: node.status?.allocation?.memoryCapacityMib || node.spec?.memory?.totalMib || 0,
    }));
  }, [nodesData]);

  // Process networks into a format usable by the wizard
  const networks = useMemo(() => {
    if (!networksData?.networks?.length) {
      return [fallbackNetwork]; // Fallback if no networks
    }
    return networksData.networks.map((net: ApiVirtualNetwork) => ({
      id: net.id,
      name: net.name,
      type: net.spec?.type || 'overlay',
    }));
  }, [networksData]);

  // Generate "clusters" from nodes (group by label or create a default cluster)
  const clusters = useMemo(() => {
    if (!nodes.length) {
      return [{ id: 'default', name: 'Default Cluster', hostIds: [] as string[] }];
    }
    // For now, put all nodes in a single cluster
    // In the future, this could group by node labels
    return [{
      id: 'default',
      name: 'Default Cluster',
      hostIds: nodes.map(n => n.id),
    }];
  }, [nodes]);

  // Reset form when mounted
  useEffect(() => {
    setCurrentStep(0);
    setFormData(initialFormData);
  }, []);

  const updateFormData = (updates: Partial<VMCreationData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setDirection(1);
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    try {
      await createVM.mutateAsync({
        name: formData.name,
        projectId: 'default',
        description: formData.description,
        spec: {
          cpu: { cores: formData.cpuCores * formData.cpuSockets },
          memory: { sizeMib: formData.memoryMib },
          disks: formData.disks.map((d) => ({ sizeMib: d.sizeGib * 1024 })),
        },
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create VM');
    }
  };

  const isStepValid = (step: number): boolean => {
    switch (step) {
      case 0: // Basic Info
        return formData.name.trim().length > 0;
      case 1: // Placement
        // If no nodes available, allow skipping (will use auto-placement)
        if (nodes.length === 0) return true;
        return formData.clusterId !== '' && (formData.autoPlacement || formData.hostId !== '');
      case 2: // Folder
        return formData.folderId !== '';
      case 3: // Customization
        return true; // Optional
      case 4: // Hardware
        return formData.cpuCores > 0 && formData.memoryMib >= 512;
      case 5: // ISO
        return true; // Optional - can install later
      case 6: // Storage
        return formData.storagePoolId !== '' && formData.disks.length > 0;
      case 7: // User Info
        return true; // Optional
      default:
        return true;
    }
  };

  const canProceed = isStepValid(currentStep);

  // Escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

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

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'relative z-10 w-full max-w-5xl max-h-[90vh]',
          'bg-bg-surface rounded-2xl shadow-2xl border border-border',
          'flex flex-col overflow-hidden',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <MonitorCog className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Create Virtual Machine</h2>
              <p className="text-sm text-text-muted">Configure your new VM in a few simple steps</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-border bg-bg-base/50">
          <div className="flex items-center justify-between">
            {STEPS.map((step, index) => {
              const StepIcon = step.icon;
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              const isClickable = index < currentStep || (index === currentStep + 1 && canProceed);

              return (
                <Fragment key={step.id}>
                  <button
                    onClick={() => {
                      if (isClickable || isCompleted) {
                        setDirection(index > currentStep ? 1 : -1);
                        setCurrentStep(index);
                      }
                    }}
                    disabled={!isClickable && !isCompleted && !isActive}
                    className={cn(
                      'flex flex-col items-center gap-1.5 group',
                      'transition-all duration-200',
                      (isClickable || isCompleted) && 'cursor-pointer',
                    )}
                  >
                    <div
                      className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200',
                        isActive && 'bg-accent text-white shadow-lg shadow-accent/30',
                        isCompleted && 'bg-success text-white',
                        !isActive && !isCompleted && 'bg-bg-elevated text-text-muted',
                        (isClickable || isCompleted) && 'group-hover:scale-110',
                      )}
                    >
                      {isCompleted ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <StepIcon className="w-4 h-4" />
                      )}
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium transition-colors',
                        isActive && 'text-accent',
                        isCompleted && 'text-success',
                        !isActive && !isCompleted && 'text-text-muted',
                      )}
                    >
                      {step.label}
                    </span>
                  </button>

                  {index < STEPS.length - 1 && (
                    <div
                      className={cn(
                        'flex-1 h-0.5 mx-2 rounded-full transition-colors',
                        index < currentStep ? 'bg-success' : 'bg-border',
                      )}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: direction * 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -direction * 50 }}
              transition={{ duration: 0.2 }}
            >
              {currentStep === 0 && (
                <StepBasicInfo formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 1 && (
                <StepPlacement 
                  formData={formData} 
                  updateFormData={updateFormData}
                  clusters={clusters}
                  nodes={nodes}
                  isLoading={nodesLoading}
                  error={nodesError}
                  onRefresh={refetchNodes}
                />
              )}
              {currentStep === 2 && (
                <StepFolder formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 3 && (
                <StepCustomization formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 4 && (
                <StepHardware 
                  formData={formData} 
                  updateFormData={updateFormData}
                  networks={networks}
                  isLoading={networksLoading}
                />
              )}
              {currentStep === 5 && (
                <StepISO formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 6 && (
                <StepStorage formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 7 && (
                <StepUserInfo formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 8 && (
                <StepReview 
                  formData={formData} 
                  clusters={clusters}
                  nodes={nodes}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-elevated/50">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={currentStep === 0 || createVM.isPending}
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>

          <div className="flex flex-col items-center gap-1">
            <span className="text-sm text-text-muted">
              Step {currentStep + 1} of {STEPS.length}
            </span>
            {error && (
              <span className="text-xs text-error">{error}</span>
            )}
          </div>

          {currentStep === STEPS.length - 1 ? (
            <Button onClick={handleSubmit} disabled={createVM.isPending}>
              {createVM.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Create VM
                </>
              )}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canProceed}>
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// Step Components

function StepBasicInfo({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Basic Information</h3>
        <p className="text-text-muted mt-1">Enter the basic details for your new virtual machine</p>
      </div>

      <div className="space-y-4">
        <FormField label="Virtual Machine Name" required>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => updateFormData({ name: e.target.value })}
            placeholder="e.g., prod-web-server-01"
            className="form-input"
            autoFocus
          />
        </FormField>

        <FormField label="Description">
          <textarea
            value={formData.description}
            onChange={(e) => updateFormData({ description: e.target.value })}
            placeholder="Optional description of this VM's purpose..."
            rows={3}
            className="form-input resize-none"
          />
        </FormField>

        <FormField label="Owner">
          <input
            type="text"
            value={formData.owner}
            onChange={(e) => updateFormData({ owner: e.target.value })}
            placeholder="e.g., john.doe@company.com"
            className="form-input"
          />
        </FormField>

        <FormField label="Creation Schedule">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                checked={formData.scheduleType === 'immediate'}
                onChange={() => updateFormData({ scheduleType: 'immediate' })}
                className="form-radio"
              />
              <span className="text-sm text-text-primary">Create Immediately</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="scheduleType"
                checked={formData.scheduleType === 'scheduled'}
                onChange={() => updateFormData({ scheduleType: 'scheduled' })}
                className="form-radio"
              />
              <span className="text-sm text-text-primary">Schedule for Later</span>
            </label>
          </div>
        </FormField>

        {formData.scheduleType === 'scheduled' && (
          <div className="grid grid-cols-2 gap-4 pl-6 border-l-2 border-accent/30">
            <FormField label="Date">
              <input
                type="date"
                value={formData.scheduledDate}
                onChange={(e) => updateFormData({ scheduledDate: e.target.value })}
                className="form-input"
              />
            </FormField>
            <FormField label="Time">
              <input
                type="time"
                value={formData.scheduledTime}
                onChange={(e) => updateFormData({ scheduledTime: e.target.value })}
                className="form-input"
              />
            </FormField>
          </div>
        )}
      </div>
    </div>
  );
}

interface ProcessedNode {
  id: string;
  hostname: string;
  managementIp: string;
  phase: string;
  cpuAllocated: number;
  cpuCapacity: number;
  memoryAllocatedMib: number;
  memoryCapacityMib: number;
}

interface ProcessedCluster {
  id: string;
  name: string;
  hostIds: string[];
}

interface ProcessedNetwork {
  id: string;
  name: string;
  type: string;
}

function StepPlacement({
  formData,
  updateFormData,
  clusters,
  nodes,
  isLoading,
  error,
  onRefresh,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  clusters: ProcessedCluster[];
  nodes: ProcessedNode[];
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
}) {
  const selectedCluster = clusters.find((c) => c.id === formData.clusterId);
  const availableHosts = selectedCluster
    ? nodes.filter((n) => selectedCluster.hostIds.includes(n.id))
    : nodes; // If no cluster selected, show all nodes

  // Auto-select first cluster if only one exists
  useEffect(() => {
    if (clusters.length === 1 && !formData.clusterId) {
      updateFormData({ clusterId: clusters[0].id });
    }
  }, [clusters, formData.clusterId, updateFormData]);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Compute Placement</h3>
        <p className="text-text-muted mt-1">Select where this VM will run</p>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-accent mr-2" />
          <span className="text-text-muted">Loading hosts...</span>
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="p-4 rounded-lg bg-error/10 border border-error/30">
          <div className="flex items-center gap-3">
            <WifiOff className="w-5 h-5 text-error" />
            <div className="flex-1">
              <p className="text-sm font-medium text-error">Failed to load hosts</p>
              <p className="text-xs text-text-muted mt-0.5">{error.message}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onRefresh()}>
              <RefreshCw className="w-4 h-4" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* No hosts available */}
      {!isLoading && !error && nodes.length === 0 && (
        <div className="p-4 rounded-lg bg-warning/10 border border-warning/30">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-warning" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning">No hosts available</p>
              <p className="text-xs text-text-muted mt-0.5">
                Register a node daemon to create VMs. Run limiquantix-node on a Linux host with KVM.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onRefresh()}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>
      )}

      {/* Cluster selection */}
      {!isLoading && nodes.length > 0 && (
        <>
          <FormField label="Cluster" required>
            <select
              value={formData.clusterId}
              onChange={(e) => updateFormData({ clusterId: e.target.value, hostId: '' })}
              className="form-select"
            >
              <option value="">Select a cluster...</option>
              {clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name} ({cluster.hostIds.length} hosts)
                </option>
              ))}
            </select>
          </FormField>

          {formData.clusterId && (
            <>
              <FormField label="Host Placement">
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-3 rounded-lg bg-bg-base border border-border cursor-pointer hover:border-accent transition-colors">
                    <input
                      type="radio"
                      name="autoPlacement"
                      checked={formData.autoPlacement}
                      onChange={() => updateFormData({ autoPlacement: true, hostId: '' })}
                      className="form-radio"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-text-primary">Automatic Placement</span>
                      <p className="text-xs text-text-muted mt-0.5">
                        Let the scheduler choose the best host based on resource availability
                      </p>
                    </div>
                    <Badge variant="info">Recommended</Badge>
                  </label>

                  <label className="flex items-center gap-3 p-3 rounded-lg bg-bg-base border border-border cursor-pointer hover:border-accent transition-colors">
                    <input
                      type="radio"
                      name="autoPlacement"
                      checked={!formData.autoPlacement}
                      onChange={() => updateFormData({ autoPlacement: false })}
                      className="form-radio"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-text-primary">Manual Selection</span>
                      <p className="text-xs text-text-muted mt-0.5">Choose a specific host for this VM</p>
                    </div>
                  </label>
                </div>
              </FormField>

              {!formData.autoPlacement && (
                <FormField label="Select Host" required>
                  <div className="grid gap-2">
                    {availableHosts.length === 0 && (
                      <p className="text-sm text-text-muted py-4 text-center">No hosts available in this cluster</p>
                    )}
                    {availableHosts.map((host) => {
                      const cpuPercent = host.cpuCapacity > 0 
                        ? Math.round((host.cpuAllocated / host.cpuCapacity) * 100)
                        : 0;
                      const memPercent = host.memoryCapacityMib > 0
                        ? Math.round((host.memoryAllocatedMib / host.memoryCapacityMib) * 100)
                        : 0;
                      const isReady = host.phase === 'READY' || host.phase === 'NODE_PHASE_READY';

                      return (
                        <label
                          key={host.id}
                          className={cn(
                            'flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-all',
                            formData.hostId === host.id
                              ? 'bg-accent/10 border-accent'
                              : 'bg-bg-base border-border hover:border-accent/50',
                            !isReady && 'opacity-50',
                          )}
                        >
                          <input
                            type="radio"
                            name="hostId"
                            checked={formData.hostId === host.id}
                            onChange={() => updateFormData({ hostId: host.id })}
                            className="form-radio"
                            disabled={!isReady}
                          />
                          <Server className="w-5 h-5 text-text-muted" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-text-primary">{host.hostname}</p>
                              {isReady ? (
                                <Badge variant="success" className="text-xs">Ready</Badge>
                              ) : (
                                <Badge variant="warning" className="text-xs">{host.phase}</Badge>
                              )}
                            </div>
                            <p className="text-xs text-text-muted">{host.managementIp}</p>
                          </div>
                          <div className="text-right text-xs">
                            <p className="text-text-muted">
                              CPU: <span className={cpuPercent > 80 ? 'text-error' : 'text-text-secondary'}>{cpuPercent}%</span>
                            </p>
                            <p className="text-text-muted">
                              RAM: <span className={memPercent > 80 ? 'text-error' : 'text-text-secondary'}>{memPercent}%</span>
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </FormField>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function StepFolder({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">VM Location</h3>
        <p className="text-text-muted mt-1">Select a folder to organize this virtual machine</p>
      </div>

      <FormField label="Folder" required>
        <div className="grid gap-2">
          {staticFolders.map((folder) => (
            <label
              key={folder.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                formData.folderId === folder.id
                  ? 'bg-accent/10 border-accent'
                  : 'bg-bg-base border-border hover:border-accent/50',
              )}
            >
              <input
                type="radio"
                name="folderId"
                checked={formData.folderId === folder.id}
                onChange={() => updateFormData({ folderId: folder.id })}
                className="form-radio"
              />
              <Folder className="w-4 h-4 text-warning" />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{folder.name}</p>
                <p className="text-xs text-text-muted font-mono">{folder.path}</p>
              </div>
            </label>
          ))}
        </div>
      </FormField>

      <button className="flex items-center gap-2 text-sm text-accent hover:text-accent-hover">
        <Plus className="w-4 h-4" />
        Create New Folder
      </button>
    </div>
  );
}

function StepCustomization({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Guest Customization</h3>
        <p className="text-text-muted mt-1">Configure guest OS settings and agent installation</p>
      </div>

      <div className="p-4 rounded-lg bg-bg-base border border-border">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.installAgent}
            onChange={(e) => updateFormData({ installAgent: e.target.checked })}
            className="form-checkbox mt-1"
          />
          <div>
            <span className="text-sm font-medium text-text-primary">Install LimiQuantix Agent</span>
            <p className="text-xs text-text-muted mt-0.5">
              The agent enables advanced features like live metrics, filesystem quiescing, and remote commands
            </p>
          </div>
          <Badge variant="success">Recommended</Badge>
        </label>
      </div>

      <FormField label="Customization Specification">
        <select
          value={formData.customSpec}
          onChange={(e) => updateFormData({ customSpec: e.target.value })}
          className="form-select"
        >
          <option value="">None - Configure manually after creation</option>
          {staticCustomSpecs.map((spec) => (
            <option key={spec.id} value={spec.id}>
              {spec.name} ({spec.os})
            </option>
          ))}
        </select>
        {formData.customSpec && formData.customSpec !== 'spec-custom' && (
          <button className="mt-2 flex items-center gap-1 text-sm text-accent hover:text-accent-hover">
            <Edit className="w-3 h-3" />
            Edit Specification
          </button>
        )}
      </FormField>

      <FormField label="Guest Hostname">
        <input
          type="text"
          value={formData.hostname}
          onChange={(e) => updateFormData({ hostname: e.target.value })}
          placeholder={formData.name || 'Will use VM name if empty'}
          className="form-input"
        />
      </FormField>

      <FormField label="Timezone">
        <select
          value={formData.timezone}
          onChange={(e) => updateFormData({ timezone: e.target.value })}
          className="form-select"
        >
          <option value="UTC">UTC</option>
          <option value="America/New_York">America/New_York (EST)</option>
          <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
          <option value="Europe/London">Europe/London (GMT)</option>
          <option value="Europe/Berlin">Europe/Berlin (CET)</option>
          <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
        </select>
      </FormField>
    </div>
  );
}

function StepHardware({
  formData,
  updateFormData,
  networks,
  isLoading,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  networks: ProcessedNetwork[];
  isLoading: boolean;
}) {
  const addNIC = () => {
    const defaultNetwork = networks[0] || { id: 'default', name: 'Default Network' };
    const newNic: NetworkInterface = {
      id: `nic-${Date.now()}`,
      networkId: defaultNetwork.id,
      networkName: defaultNetwork.name,
      connected: true,
    };
    updateFormData({ nics: [...formData.nics, newNic] });
  };

  const removeNIC = (id: string) => {
    updateFormData({ nics: formData.nics.filter((n) => n.id !== id) });
  };

  const updateNIC = (id: string, updates: Partial<NetworkInterface>) => {
    updateFormData({
      nics: formData.nics.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Hardware Configuration</h3>
        <p className="text-text-muted mt-1">Configure CPU, memory, and network adapters</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* CPU Section */}
        <div className="p-5 rounded-xl bg-bg-base border border-border">
          <div className="flex items-center gap-2 mb-4">
            <Cpu className="w-5 h-5 text-accent" />
            <h4 className="font-medium text-text-primary">CPU</h4>
          </div>

          <div className="space-y-4">
            <FormField label="Cores per Socket">
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="32"
                  value={formData.cpuCores}
                  onChange={(e) => updateFormData({ cpuCores: parseInt(e.target.value) })}
                  className="flex-1"
                />
                <span className="w-12 text-center text-text-primary font-medium">
                  {formData.cpuCores}
                </span>
              </div>
            </FormField>

            <FormField label="Sockets">
              <select
                value={formData.cpuSockets}
                onChange={(e) => updateFormData({ cpuSockets: parseInt(e.target.value) })}
                className="form-select"
              >
                {[1, 2, 4].map((s) => (
                  <option key={s} value={s}>
                    {s} socket{s > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </FormField>

            <div className="pt-3 border-t border-border">
              <p className="text-sm text-text-muted">
                Total: <span className="text-text-primary font-medium">{formData.cpuCores * formData.cpuSockets} vCPUs</span>
              </p>
            </div>
          </div>
        </div>

        {/* Memory Section */}
        <div className="p-5 rounded-xl bg-bg-base border border-border">
          <div className="flex items-center gap-2 mb-4">
            <MemoryStick className="w-5 h-5 text-success" />
            <h4 className="font-medium text-text-primary">Memory</h4>
          </div>

          <div className="space-y-4">
            <FormField label="RAM Size">
              <div className="grid grid-cols-4 gap-2">
                {[2048, 4096, 8192, 16384].map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={() => updateFormData({ memoryMib: size })}
                    className={cn(
                      'py-2 px-3 rounded-lg text-sm font-medium transition-all',
                      formData.memoryMib === size
                        ? 'bg-accent text-white'
                        : 'bg-bg-elevated text-text-secondary hover:text-text-primary hover:bg-bg-hover',
                    )}
                  >
                    {size / 1024} GB
                  </button>
                ))}
              </div>
            </FormField>

            <FormField label="Custom Size (MiB)">
              <input
                type="number"
                min="512"
                step="512"
                value={formData.memoryMib}
                onChange={(e) => updateFormData({ memoryMib: parseInt(e.target.value) || 512 })}
                className="form-input"
              />
            </FormField>
          </div>
        </div>
      </div>

      {/* Network Adapters */}
      <div className="p-5 rounded-xl bg-bg-base border border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-info" />
            <h4 className="font-medium text-text-primary">Network Adapters</h4>
          </div>
          <Button variant="ghost" size="sm" onClick={addNIC}>
            <Plus className="w-4 h-4" />
            Add NIC
          </Button>
        </div>

        <div className="space-y-3">
          {formData.nics.map((nic, index) => (
            <div
              key={nic.id}
              className="flex items-center gap-4 p-3 rounded-lg bg-bg-surface border border-border"
            >
              <span className="text-sm font-medium text-text-muted w-16">NIC {index + 1}</span>
              <select
                value={nic.networkId}
                onChange={(e) => {
                  const network = networks.find((n) => n.id === e.target.value);
                  updateNIC(nic.id, {
                    networkId: e.target.value,
                    networkName: network?.name || '',
                  });
                }}
                className="form-select flex-1"
                disabled={isLoading}
              >
                {isLoading ? (
                  <option>Loading networks...</option>
                ) : (
                  networks.map((net) => (
                    <option key={net.id} value={net.id}>
                      {net.name} ({net.type})
                    </option>
                  ))
                )}
              </select>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nic.connected}
                  onChange={(e) => updateNIC(nic.id, { connected: e.target.checked })}
                  className="form-checkbox"
                />
                <span className="text-sm text-text-secondary">Connected</span>
              </label>
              {formData.nics.length > 1 && (
                <button
                  onClick={() => removeNIC(nic.id)}
                  className="p-1.5 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepISO({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Boot Media</h3>
        <p className="text-text-muted mt-1">Select an ISO image to install the operating system</p>
      </div>

      <FormField label="ISO Image">
        <div className="grid gap-2">
          <label
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
              formData.isoId === ''
                ? 'bg-accent/10 border-accent'
                : 'bg-bg-base border-border hover:border-accent/50',
            )}
          >
            <input
              type="radio"
              name="isoId"
              checked={formData.isoId === ''}
              onChange={() => updateFormData({ isoId: '' })}
              className="form-radio"
            />
            <Disc className="w-4 h-4 text-text-muted" />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">No Boot Media</p>
              <p className="text-xs text-text-muted">Configure boot media after creation</p>
            </div>
          </label>

          {staticISOs.map((iso) => (
            <label
              key={iso.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                formData.isoId === iso.id
                  ? 'bg-accent/10 border-accent'
                  : 'bg-bg-base border-border hover:border-accent/50',
              )}
            >
              <input
                type="radio"
                name="isoId"
                checked={formData.isoId === iso.id}
                onChange={() => updateFormData({ isoId: iso.id })}
                className="form-radio"
              />
              <Disc className="w-4 h-4 text-accent" />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">{iso.name}</p>
                <p className="text-xs text-text-muted">{iso.size}</p>
              </div>
            </label>
          ))}
        </div>
      </FormField>

      <button className="flex items-center gap-2 text-sm text-accent hover:text-accent-hover">
        <Plus className="w-4 h-4" />
        Upload New ISO
      </button>
    </div>
  );
}

function StepStorage({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  const addDisk = () => {
    const newDisk: DiskConfig = {
      id: `disk-${Date.now()}`,
      name: `Hard disk ${formData.disks.length + 1}`,
      sizeGib: 50,
      provisioning: 'thin',
    };
    updateFormData({ disks: [...formData.disks, newDisk] });
  };

  const removeDisk = (id: string) => {
    updateFormData({ disks: formData.disks.filter((d) => d.id !== id) });
  };

  const updateDisk = (id: string, updates: Partial<DiskConfig>) => {
    updateFormData({
      disks: formData.disks.map((d) => (d.id === id ? { ...d, ...updates } : d)),
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Storage Configuration</h3>
        <p className="text-text-muted mt-1">Select a storage pool and configure virtual disks</p>
      </div>

      <FormField label="Storage Pool" required>
        <div className="grid gap-3">
          {mockStoragePools.map((pool) => {
            const usagePercent = Math.round(
              (pool.status.capacity.usedBytes / pool.status.capacity.totalBytes) * 100
            );

            return (
              <label
                key={pool.id}
                className={cn(
                  'flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-all',
                  formData.storagePoolId === pool.id
                    ? 'bg-accent/10 border-accent'
                    : 'bg-bg-base border-border hover:border-accent/50',
                )}
              >
                <input
                  type="radio"
                  name="storagePoolId"
                  checked={formData.storagePoolId === pool.id}
                  onChange={() => updateFormData({ storagePoolId: pool.id })}
                  className="form-radio"
                />
                <HardDrive className="w-5 h-5 text-text-muted" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">{pool.name}</p>
                  <p className="text-xs text-text-muted">
                    {formatBytes(pool.status.capacity.availableBytes)} available of{' '}
                    {formatBytes(pool.status.capacity.totalBytes)}
                  </p>
                </div>
                <div className="w-24">
                  <div className="h-2 bg-bg-elevated rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        usagePercent >= 80 ? 'bg-error' : usagePercent >= 60 ? 'bg-warning' : 'bg-success',
                      )}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  <p className="text-xs text-text-muted text-center mt-1">{usagePercent}% used</p>
                </div>
              </label>
            );
          })}
        </div>
      </FormField>

      {/* Virtual Disks */}
      <div className="p-5 rounded-xl bg-bg-base border border-border">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-text-primary">Virtual Disks</h4>
          <Button variant="ghost" size="sm" onClick={addDisk}>
            <Plus className="w-4 h-4" />
            Add Disk
          </Button>
        </div>

        <div className="space-y-3">
          {formData.disks.map((disk) => (
            <div
              key={disk.id}
              className="flex items-center gap-4 p-3 rounded-lg bg-bg-surface border border-border"
            >
              <HardDrive className="w-4 h-4 text-text-muted" />
              <span className="text-sm font-medium text-text-secondary w-24">{disk.name}</span>
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="number"
                  min="1"
                  value={disk.sizeGib}
                  onChange={(e) => updateDisk(disk.id, { sizeGib: parseInt(e.target.value) || 1 })}
                  className="form-input w-24"
                />
                <span className="text-sm text-text-muted">GiB</span>
              </div>
              <select
                value={disk.provisioning}
                onChange={(e) => updateDisk(disk.id, { provisioning: e.target.value as 'thin' | 'thick' })}
                className="form-select w-32"
              >
                <option value="thin">Thin</option>
                <option value="thick">Thick</option>
              </select>
              {formData.disks.length > 1 && (
                <button
                  onClick={() => removeDisk(disk.id)}
                  className="p-1.5 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        <p className="text-xs text-text-muted mt-3">
          Total disk space:{' '}
          <span className="text-text-primary font-medium">
            {formData.disks.reduce((sum, d) => sum + d.sizeGib, 0)} GiB
          </span>
        </p>
      </div>
    </div>
  );
}

function StepUserInfo({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  const [tagInput, setTagInput] = useState('');

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      updateFormData({ tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    updateFormData({ tags: formData.tags.filter((t) => t !== tag) });
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Additional Information</h3>
        <p className="text-text-muted mt-1">Optional metadata for organizational tracking</p>
        <Badge variant="default" className="mt-2">Optional - Skip if not needed</Badge>
      </div>

      <div className="space-y-4">
        <FormField label="Department">
          <input
            type="text"
            value={formData.department}
            onChange={(e) => updateFormData({ department: e.target.value })}
            placeholder="e.g., Engineering, Marketing, IT"
            className="form-input"
          />
        </FormField>

        <FormField label="Cost Center">
          <input
            type="text"
            value={formData.costCenter}
            onChange={(e) => updateFormData({ costCenter: e.target.value })}
            placeholder="e.g., CC-12345"
            className="form-input"
          />
        </FormField>

        <FormField label="Tags">
          <div className="flex flex-wrap gap-2 mb-2">
            {formData.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent text-sm"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="hover:text-error transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Add a tag..."
              className="form-input flex-1"
            />
            <Button variant="secondary" size="sm" onClick={addTag}>
              Add
            </Button>
          </div>
        </FormField>

        <FormField label="Notes">
          <textarea
            value={formData.notes}
            onChange={(e) => updateFormData({ notes: e.target.value })}
            placeholder="Any additional notes about this VM..."
            rows={4}
            className="form-input resize-none"
          />
        </FormField>
      </div>
    </div>
  );
}

function StepReview({ 
  formData,
  clusters,
  nodes,
}: { 
  formData: VMCreationData;
  clusters: ProcessedCluster[];
  nodes: ProcessedNode[];
}) {
  const selectedCluster = clusters.find((c) => c.id === formData.clusterId);
  const selectedHost = nodes.find((n) => n.id === formData.hostId);
  const selectedFolder = staticFolders.find((f) => f.id === formData.folderId);
  const selectedPool = mockStoragePools.find((p) => p.id === formData.storagePoolId);
  const selectedISO = staticISOs.find((i) => i.id === formData.isoId);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-success/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-success" />
        </div>
        <h3 className="text-xl font-semibold text-text-primary">Ready to Create</h3>
        <p className="text-text-muted mt-1">Review your configuration before creating the VM</p>
      </div>

      <div className="grid gap-4">
        {/* Basic Info */}
        <ReviewSection title="Basic Information">
          <ReviewRow label="Name" value={formData.name} />
          {formData.description && <ReviewRow label="Description" value={formData.description} />}
          {formData.owner && <ReviewRow label="Owner" value={formData.owner} />}
          <ReviewRow
            label="Creation"
            value={
              formData.scheduleType === 'immediate'
                ? 'Immediate'
                : `Scheduled: ${formData.scheduledDate} at ${formData.scheduledTime}`
            }
          />
        </ReviewSection>

        {/* Placement */}
        <ReviewSection title="Placement">
          <ReviewRow label="Cluster" value={selectedCluster?.name || '—'} />
          <ReviewRow
            label="Host"
            value={formData.autoPlacement ? 'Automatic' : selectedHost?.hostname || '—'}
          />
          <ReviewRow label="Folder" value={selectedFolder?.path || '—'} />
        </ReviewSection>

        {/* Hardware */}
        <ReviewSection title="Hardware">
          <ReviewRow
            label="CPU"
            value={`${formData.cpuCores * formData.cpuSockets} vCPUs (${formData.cpuCores} cores × ${formData.cpuSockets} socket${formData.cpuSockets > 1 ? 's' : ''})`}
          />
          <ReviewRow label="Memory" value={`${formData.memoryMib / 1024} GB`} />
          <ReviewRow
            label="Network"
            value={formData.nics.map((n) => n.networkName).join(', ')}
          />
        </ReviewSection>

        {/* Storage */}
        <ReviewSection title="Storage">
          <ReviewRow label="Pool" value={selectedPool?.name || '—'} />
          <ReviewRow
            label="Disks"
            value={formData.disks.map((d) => `${d.sizeGib} GB (${d.provisioning})`).join(', ')}
          />
          <ReviewRow
            label="Total"
            value={`${formData.disks.reduce((sum, d) => sum + d.sizeGib, 0)} GB`}
          />
        </ReviewSection>

        {/* Boot & Customization */}
        <ReviewSection title="Boot & Customization">
          <ReviewRow label="ISO" value={selectedISO?.name || 'None'} />
          <ReviewRow label="Agent" value={formData.installAgent ? 'Will be installed' : 'Not installed'} />
          {formData.hostname && <ReviewRow label="Hostname" value={formData.hostname} />}
        </ReviewSection>

        {/* Optional Info */}
        {(formData.department || formData.costCenter || formData.tags.length > 0) && (
          <ReviewSection title="Additional Info">
            {formData.department && <ReviewRow label="Department" value={formData.department} />}
            {formData.costCenter && <ReviewRow label="Cost Center" value={formData.costCenter} />}
            {formData.tags.length > 0 && <ReviewRow label="Tags" value={formData.tags.join(', ')} />}
          </ReviewSection>
        )}
      </div>
    </div>
  );
}

// Helper Components

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
        {required && <span className="text-error ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-bg-base border border-border">
      <h4 className="text-sm font-medium text-text-muted mb-3">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

