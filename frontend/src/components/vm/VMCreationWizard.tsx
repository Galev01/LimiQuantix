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
  Cloud,
  Key,
  Terminal,
  Lock,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useCreateVM } from '@/hooks/useVMs';
import { useNodes, type ApiNode } from '@/hooks/useNodes';
import { useClusters, type Cluster } from '@/hooks/useClusters';
import { useNetworks, type ApiVirtualNetwork } from '@/hooks/useNetworks';
import { useAvailableImages, useISOs, formatImageSize, getDefaultUser, useImageAvailability, useDownloadImage, type CloudImage, type ISOImage, ISO_CATALOG } from '@/hooks/useImages';
import { validateVMName, validatePassword, validateAccessMethod } from '@/components/vm/wizard-validation';
import { useStoragePools, useVolumes, type StoragePoolUI, type VolumeUI } from '@/hooks/useStorage';
import { useOVATemplates, type OVATemplate, formatOVASize } from '@/hooks/useOVA';
import { useFolders, type Folder as FolderType, useCreateFolder } from '@/hooks/useFolders';
import { useCustomizationSpecs, type CustomizationSpec } from '@/hooks/useCustomizationSpecs';

interface VMCreationWizardProps {
  isOpen?: boolean; // For AnimatePresence compatibility, component is always rendered when open
  onClose: () => void;
  onSuccess?: () => void;
  onSubmit?: (data: {
    name: string;
    description?: string;
    projectId?: string;
    nodeId?: string;
    spec?: {
      cpu?: { cores?: number };
      memory?: { sizeMib?: number };
      disks?: Array<{ sizeGib?: number; backingFile?: string }>;
      nics?: Array<{ networkId?: string }>;
      provisioning?: {
        cloudInit?: {
          userData?: string;
          metaData?: string;
        };
      };
    };
  }) => void;
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

  // Step 6: Boot Media (ISO, Cloud Image, or OVA Template)
  bootMediaType: 'none' | 'iso' | 'cloud-image' | 'ova-template';
  isoId: string;
  cloudImageId: string;
  ovaTemplateId: string;

  // Cloud-Init Configuration
  cloudInit: {
    enabled: boolean;
    sshKeys: string[];
    defaultUser: string;
    password: string;
    confirmPassword: string;
    customUserData: string;
  };

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
  // Volume selection support
  sourceType: 'new' | 'existing';
  existingVolumeId?: string;
  existingVolumePath?: string;
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

// Cloud images are now fetched via useAvailableImages hook
// The staticCloudImages have been moved to hooks/useImages.ts as CLOUD_IMAGE_CATALOG

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
  bootMediaType: 'cloud-image',  // Default to cloud image for quick provisioning
  isoId: '',
  cloudImageId: 'cloud-ubuntu22', // Default to Ubuntu 22.04 cloud image
  ovaTemplateId: '',
  cloudInit: {
    enabled: true,
    sshKeys: [],
    defaultUser: 'ubuntu',
    password: '',
    confirmPassword: '',
    customUserData: '',
  },
  storagePoolId: '',
  disks: [{ id: 'disk-1', name: 'Hard disk 1', sizeGib: 50, provisioning: 'thin', sourceType: 'new' }],
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
  const createFolder = useCreateFolder();

  // Create folder state
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Fetch real data from APIs
  const { data: nodesData, isLoading: nodesLoading, error: nodesError, refetch: refetchNodes } = useNodes();
  const { data: networksData, isLoading: networksLoading } = useNetworks();
  const { images: cloudImages, isLoading: imagesLoading, isUsingCatalog } = useAvailableImages();
  const { isos, isLoading: isosLoading, isUsingCatalog: isUsingIsoCatalog } = useISOs();
  const { data: storagePools, isLoading: storageLoading } = useStoragePools();
  const { data: ovaTemplates, isLoading: ovaLoading } = useOVATemplates();
  const { data: foldersData, isLoading: foldersLoading } = useFolders({ type: 'VM' });
  const { data: customizationSpecsData, isLoading: specsLoading } = useCustomizationSpecs();

  // Process folders for the UI
  const folders = useMemo(() => {
    if (foldersData?.folders?.length) {
      return foldersData.folders.map((f: FolderType) => ({
        id: f.id,
        name: f.name,
        path: f.path || `/${f.name}`,
      }));
    }
    // Fallback to static folders if API fails
    return staticFolders;
  }, [foldersData]);

  // Process customization specs for the UI
  const customizationSpecs = useMemo(() => {
    if (customizationSpecsData?.specs?.length) {
      return customizationSpecsData.specs.map((s: CustomizationSpec) => ({
        id: s.id,
        name: s.name,
        os: s.type === 'LINUX' ? 'Linux' : 'Windows',
        description: s.description,
        installAgent: s.installAgent,
      }));
    }
    // Fallback to static specs if API fails
    return staticCustomSpecs;
  }, [customizationSpecsData]);

  // Process nodes into a format usable by the wizard
  const nodes = useMemo(() => {
    if (!nodesData?.nodes?.length) return [];
    return nodesData.nodes.map((node: ApiNode) => {
      // Calculate CPU capacity from spec
      const cpuCapacity = (node.spec?.cpu?.coresPerSocket || 1) * (node.spec?.cpu?.sockets || 1);
      // Get CPU allocation from status.resources
      const cpuAllocated = node.status?.resources?.cpu?.allocatedVcpus || 0;
      // Get memory in MiB (API returns bytes, convert to MiB)
      const memoryCapacityMib = node.spec?.memory?.totalBytes
        ? Math.floor(node.spec.memory.totalBytes / (1024 * 1024))
        : 0;
      const memoryAllocatedMib = node.status?.resources?.memory?.allocatedBytes
        ? Math.floor(node.status.resources.memory.allocatedBytes / (1024 * 1024))
        : 0;

      return {
        id: node.id,
        hostname: node.hostname,
        managementIp: node.managementIp,
        phase: node.status?.phase || 'UNKNOWN',
        cpuAllocated,
        cpuCapacity,
        memoryAllocatedMib,
        memoryCapacityMib,
        // Include storage and network info for display
        storageDevices: node.spec?.storage || [],
        networkDevices: node.spec?.network || [],
      };
    });
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

  // Fetch clusters from API
  const { data: clustersData, isLoading: clustersLoading } = useClusters();

  // Process clusters for the UI
  const clusters = useMemo(() => {
    if (!clustersData?.clusters?.length) {
      return [];
    }
    return clustersData.clusters.map((cluster: Cluster) => ({
      id: cluster.id,
      name: cluster.name,
      // For now, assume all hosts are candidates if not explicitly assigned
      // In a real scenario, we would filter nodes by cluster membership
      hostIds: nodes.filter(n => {
        // Here we would check if node belongs to this cluster via API response
        // For now, we'll rely on the node labels or status if available
        return true;
        // TODO: Filter nodes based on cluster membership once API supports it
      }).map(n => n.id),
    }));
  }, [clustersData, nodes]);

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
      // Find selected host for the request
      const selectedHost = nodes.find(n => n.id === formData.hostId);

      // Get cloud image if using cloud image boot
      const selectedCloudImage = formData.bootMediaType === 'cloud-image'
        ? cloudImages.find(img => img.id === formData.cloudImageId)
        : undefined;

      // Build cloud-init user-data
      let cloudInitUserData = '';
      if (formData.bootMediaType === 'cloud-image' && formData.cloudInit.enabled) {
        if (formData.cloudInit.customUserData) {
          // Use custom user-data if provided
          cloudInitUserData = formData.cloudInit.customUserData;
        } else {
          // Generate default cloud-config
          const defaultUser = formData.cloudInit.defaultUser || 'ubuntu';
          const lines = [
            '#cloud-config',
            `hostname: ${formData.name}`,
            `fqdn: ${formData.name}.local`,
            'manage_etc_hosts: true',
            '',
            'users:',
            `  - name: ${defaultUser}`,
            '    groups: [sudo, adm]',
            '    sudo: ALL=(ALL) NOPASSWD:ALL',
            '    shell: /bin/bash',
            '    lock_passwd: false',
          ];

          // Add SSH keys if provided
          if (formData.cloudInit.sshKeys.length > 0) {
            lines.push('    ssh_authorized_keys:');
            formData.cloudInit.sshKeys.forEach(key => {
              // Ensure the key is properly formatted - no quotes needed in YAML list
              const trimmedKey = key.trim();
              lines.push(`      - ${trimmedKey}`);
            });
          }

          // Password configuration using chpasswd module (the correct way)
          // This sets the password for the user after creation
          if (formData.cloudInit.password) {
            lines.push('');
            lines.push('# Enable SSH password authentication');
            lines.push('ssh_pwauth: true');
            lines.push('');
            lines.push('# Set password using chpasswd module');
            lines.push('chpasswd:');
            lines.push('  expire: false');
            lines.push('  list:');
            lines.push(`    - ${defaultUser}:${formData.cloudInit.password}`);
          }

          lines.push('', 'package_update: true', 'packages:', '  - qemu-guest-agent');

          // Add Quantix Agent installation if enabled
          if (formData.installAgent) {
            // Get the control plane URL from browser location
            // In production, this should be configured via environment variable
            const controlPlaneUrl = window.location.origin;

            lines.push('');
            lines.push('# Quantix Agent Installation');
            lines.push('write_files:');
            lines.push('  - path: /etc/limiquantix/pre-freeze.d/.keep');
            lines.push('    content: ""');
            lines.push('  - path: /etc/limiquantix/post-thaw.d/.keep');
            lines.push('    content: ""');
            lines.push('');
            lines.push('runcmd:');
            lines.push('  # Start QEMU Guest Agent');
            lines.push('  - systemctl enable qemu-guest-agent');
            lines.push('  - systemctl start qemu-guest-agent');
            lines.push('  # Install Quantix Agent from Control Plane');
            lines.push(`  - curl -fsSL ${controlPlaneUrl}/api/agent/install.sh | bash`);
          } else {
            lines.push('', 'runcmd:', '  - systemctl enable qemu-guest-agent', '  - systemctl start qemu-guest-agent');
          }

          cloudInitUserData = lines.join('\n');
        }
      }

      await createVM.mutateAsync({
        name: formData.name,
        projectId: 'default',
        description: formData.description,
        // Include host placement info
        nodeId: formData.autoPlacement ? undefined : formData.hostId,
        labels: {
          ...(formData.department && { department: formData.department }),
          ...(formData.costCenter && { 'cost-center': formData.costCenter }),
          ...(selectedHost && !formData.autoPlacement && { 'assigned-host': selectedHost.hostname }),
          ...(selectedCloudImage && { 'os-image': selectedCloudImage.os.distribution }),
        },
        spec: {
          cpu: {
            cores: formData.cpuCores * formData.cpuSockets,
            sockets: formData.cpuSockets,
          },
          memory: { sizeMib: formData.memoryMib },
          disks: formData.disks.map((d, index) => ({
            id: d.name, // Proto expects 'id' field, not 'name'
            sizeGib: d.sizeGib,
            // Use cloud image as backing file for the first disk
            backingFile: index === 0 && selectedCloudImage ? selectedCloudImage.path : undefined,
          })),
          nics: formData.nics.map((nic) => ({
            networkId: nic.networkId,
            connected: nic.connected,
          })),
          // Include cloud-init provisioning configuration (must be under 'provisioning.cloudInit')
          provisioning: cloudInitUserData ? {
            cloudInit: {
              userData: cloudInitUserData,
              metaData: `instance-id: ${formData.name}\nlocal-hostname: ${formData.name}`,
            },
          } : undefined,
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
      case 0: { // Basic Info
        const nameValidation = validateVMName(formData.name);
        return nameValidation.valid;
      }
      case 1: // Placement
        // If no nodes available, allow skipping (will use auto-placement)
        if (nodes.length === 0) return true;
        return formData.clusterId !== '' && (formData.autoPlacement || formData.hostId !== '');
      case 2: // Folder
        return formData.folderId !== '';
      case 3: // Customization
        return true; // Optional
      case 4: // Hardware
        return formData.cpuCores > 0 && formData.cpuCores <= 128 &&
          formData.memoryMib >= 512 && formData.memoryMib <= 1048576;
      case 5: { // Boot Media
        // For cloud images, require either password or SSH key for access
        if (formData.bootMediaType === 'cloud-image') {
          // Check if a cloud image is selected
          if (!formData.cloudImageId) return false;
          
          const selectedImage = cloudImages.find(img => img.id === formData.cloudImageId);
          
          // Verify the image exists and is ready (has a path)
          if (!selectedImage) return false;
          if (selectedImage.status !== 'ready' || !selectedImage.path) {
            // Image is not downloaded yet - user needs to download it first
            return false;
          }
          
          const hasPassword = formData.cloudInit.password.length >= 8 &&
            formData.cloudInit.password === formData.cloudInit.confirmPassword;
          const hasSSHKeys = formData.cloudInit.sshKeys.length > 0;
          const accessValidation = validateAccessMethod(
            hasPassword,
            hasSSHKeys,
            selectedImage
          );
          if (!accessValidation.valid) return false;

          // Password validation if password is set
          if (formData.cloudInit.password) {
            const passwordValidation = validatePassword(
              formData.cloudInit.password,
              formData.cloudInit.confirmPassword
            );
            if (!passwordValidation.valid) return false;
          }

          return true;
        }
        // For ISO, check if selected ISO is valid
        if (formData.bootMediaType === 'iso') {
          if (!formData.isoId) return false;
          const selectedISO = isos.find(iso => iso.id === formData.isoId);
          // ISO must exist and be ready (have a path)
          if (!selectedISO) return false;
          // For catalog ISOs, we allow them (they're placeholders)
          // For real ISOs from DB, they should have a path
          if ('path' in selectedISO && selectedISO.path) {
            return true;
          }
          // Allow catalog ISOs (they don't have paths but are valid selections)
          return true;
        }
        return true; // None - no boot media needed
      }
      case 6: { // Storage
        if (!formData.storagePoolId || formData.disks.length === 0) return false;

        // Validate storage pool is accessible from selected node
        const selectedPool = storagePools?.find(p => p.id === formData.storagePoolId);
        if (!selectedPool) return false;

        // Check pool is accessible from node (if specific node selected)
        if (formData.hostId && !formData.autoPlacement) {
          if (selectedPool.assignedNodeIds?.length > 0 &&
            !selectedPool.assignedNodeIds.includes(formData.hostId)) {
            return false;
          }
        }

        // Validate disk sizes
        const totalDiskSize = formData.disks.reduce((sum, d) => sum + d.sizeGib, 0);
        const availableGib = selectedPool.capacity.availableBytes / (1024 * 1024 * 1024);
        if (totalDiskSize > availableGib) return false;

        return true;
      }
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
      {/* Backdrop - no onClick to prevent accidental closure */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
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
                <StepFolder
                  formData={formData}
                  updateFormData={updateFormData}
                  folders={folders}
                  foldersLoading={foldersLoading}
                  onCreateFolder={() => setIsCreateFolderOpen(true)}
                />
              )}
              {currentStep === 3 && (
                <StepCustomization formData={formData} updateFormData={updateFormData} customizationSpecs={customizationSpecs} specsLoading={specsLoading} />
              )}
              {currentStep === 4 && (
                <StepHardware
                  formData={formData}
                  updateFormData={updateFormData}
                  networks={networks}
                  isLoading={networksLoading}
                  selectedHost={nodes.find(n => n.id === formData.hostId)}
                />
              )}
              {currentStep === 5 && (
                <StepISO
                  formData={formData}
                  updateFormData={updateFormData}
                  cloudImages={cloudImages}
                  imagesLoading={imagesLoading}
                  isUsingCatalog={isUsingCatalog}
                  isos={isos}
                  isosLoading={isosLoading}
                  isUsingIsoCatalog={isUsingIsoCatalog}
                  ovaTemplates={ovaTemplates || []}
                  ovaLoading={ovaLoading}
                  selectedNodeId={formData.autoPlacement ? undefined : formData.hostId}
                  selectedNodeHostname={nodes.find(n => n.id === formData.hostId)?.hostname}
                />
              )}
              {currentStep === 6 && (
                <StepStorage
                  formData={formData}
                  updateFormData={updateFormData}
                  storagePools={storagePools || []}
                  isLoading={storageLoading}
                  nodes={nodes}
                />
              )}
              {currentStep === 7 && (
                <StepUserInfo formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 8 && (
                <StepReview
                  formData={formData}
                  clusters={clusters}
                  nodes={nodes}
                  cloudImages={cloudImages}
                  storagePools={storagePools || []}
                  isos={isos}
                  folders={folders}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Create Folder Dialog */}
        <AnimatePresence>
          {
            isCreateFolderOpen && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="w-full max-w-md bg-bg-surface p-6 rounded-xl border border-border shadow-xl"
                >
                  <h3 className="text-lg font-semibold text-text-primary mb-4">Create New Folder</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-1">
                        Folder Name
                      </label>
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="e.g. Production"
                        className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                        autoFocus
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setIsCreateFolderOpen(false);
                          setNewFolderName('');
                        }}
                        disabled={isCreatingFolder}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={async () => {
                          if (!newFolderName.trim()) return;
                          setIsCreatingFolder(true);
                          try {
                            const newFolder = await createFolder.mutateAsync({
                              name: newFolderName,
                              projectId: 'default', // Using default project for now
                              type: 'VM',
                              parentId: '', // Root folder
                            });
                            updateFormData({ folderId: newFolder.id });
                            setIsCreateFolderOpen(false);
                            setNewFolderName('');
                          } catch (err) {
                            // Error handled by hook toast
                          } finally {
                            setIsCreatingFolder(false);
                          }
                        }}
                        disabled={!newFolderName.trim() || isCreatingFolder}
                      >
                        {isCreatingFolder ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Creating...
                          </>
                        ) : (
                          'Create Folder'
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )
          }
        </AnimatePresence >

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

          {
            currentStep === STEPS.length - 1 ? (
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
            )
          }
        </div>
      </motion.div>
    </div>
  );
}

// Step Components

// Inline field error component
function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <div className="flex items-center gap-1 mt-1 text-error text-xs">
      <AlertCircle className="w-3 h-3" />
      {error}
    </div>
  );
}

function StepBasicInfo({
  formData,
  updateFormData,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
}) {
  // Real-time validation
  const nameValidation = useMemo(() => {
    if (!formData.name) return { valid: true }; // Don't show error when empty (required indicator handles this)
    return validateVMName(formData.name);
  }, [formData.name]);

  const descriptionTooLong = formData.description.length > 500;

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
            className={cn(
              "form-input",
              !nameValidation.valid && "border-error focus:border-error"
            )}
            autoFocus
          />
          <FieldError error={nameValidation.error} />
          {nameValidation.valid && formData.name && (
            <p className="text-xs text-success mt-1 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Valid VM name
            </p>
          )}
        </FormField>

        <FormField label="Description">
          <textarea
            value={formData.description}
            onChange={(e) => updateFormData({ description: e.target.value })}
            placeholder="Optional description of this VM's purpose..."
            rows={3}
            className={cn(
              "form-input resize-none",
              descriptionTooLong && "border-error focus:border-error"
            )}
          />
          <div className="flex justify-between mt-1">
            <FieldError error={descriptionTooLong ? "Description cannot exceed 500 characters" : undefined} />
            <span className={cn(
              "text-xs",
              descriptionTooLong ? "text-error" : "text-text-muted"
            )}>
              {formData.description.length}/500
            </span>
          </div>
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
  storageDevices: Array<{
    path?: string;
    model?: string;
    sizeBytes?: number;
    type?: string;
  }>;
  networkDevices: Array<{
    name?: string;
    macAddress?: string;
    speedMbps?: number;
  }>;
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
                          <div className="text-right text-xs space-y-0.5">
                            <p className="text-text-muted">
                              CPU: <span className={cpuPercent > 80 ? 'text-error' : 'text-text-secondary'}>
                                {host.cpuCapacity - host.cpuAllocated} / {host.cpuCapacity} cores free
                              </span>
                            </p>
                            <p className="text-text-muted">
                              RAM: <span className={memPercent > 80 ? 'text-error' : 'text-text-secondary'}>
                                {formatBytes((host.memoryCapacityMib - host.memoryAllocatedMib) * 1024 * 1024)} free
                              </span>
                            </p>
                            {host.storageDevices.length > 0 && (
                              <p className="text-text-muted">
                                Storage: {host.storageDevices.length} device(s)
                              </p>
                            )}
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
  folders,
  foldersLoading,
  onCreateFolder,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  folders: Array<{ id: string; name: string; path: string }>;
  foldersLoading: boolean;
  onCreateFolder: () => void;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">VM Location</h3>
        <p className="text-text-muted mt-1">Select a folder to organize this virtual machine</p>
      </div>

      <FormField label="Folder" required>
        <div className="grid gap-2">
          {foldersLoading ? (
            <div className="flex items-center gap-2 text-[var(--text-secondary)] py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading folders...</span>
            </div>
          ) : folders.map((folder) => (
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
          ))
          }
        </div>
      </FormField>

      <button
        onClick={onCreateFolder}
        className="flex items-center gap-2 text-sm text-accent hover:text-accent-hover"
      >
        <Plus className="w-4 h-4" />
        Create New Folder
      </button>
    </div>
  );
}

function StepCustomization({
  formData,
  updateFormData,
  customizationSpecs,
  specsLoading,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  customizationSpecs: Array<{ id: string; name: string; os: string; description?: string; installAgent?: boolean }>;
  specsLoading: boolean;
}) {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Guest Customization</h3>
        <p className="text-text-muted mt-1">Configure guest OS settings and agent installation</p>
      </div>

      {/* Quantix Agent Installation */}
      <div className={cn(
        "p-4 rounded-lg border transition-all",
        formData.installAgent
          ? "bg-accent/5 border-accent/30"
          : "bg-bg-base border-border"
      )}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={formData.installAgent}
            onChange={(e) => updateFormData({ installAgent: e.target.checked })}
            className="form-checkbox mt-1"
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">Install Quantix Agent</span>
              <Badge variant="success">Recommended</Badge>
            </div>
            <p className="text-xs text-text-muted mt-1">
              The Quantix Agent provides deep VM integration for enhanced management
            </p>
            {formData.installAgent && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle className="w-3 h-3" />
                  <span>Live metrics & telemetry</span>
                </div>
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle className="w-3 h-3" />
                  <span>IP address reporting</span>
                </div>
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle className="w-3 h-3" />
                  <span>Remote script execution</span>
                </div>
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle className="w-3 h-3" />
                  <span>File browser access</span>
                </div>
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle className="w-3 h-3" />
                  <span>Snapshot quiescing (fsfreeze)</span>
                </div>
                <div className="flex items-center gap-1.5 text-success">
                  <CheckCircle className="w-3 h-3" />
                  <span>Graceful shutdown/reboot</span>
                </div>
              </div>
            )}
          </div>
        </label>
      </div>

      <FormField label="Customization Specification">
        <select
          value={formData.customSpec}
          onChange={(e) => updateFormData({ customSpec: e.target.value })}
          className="form-select"
          disabled={specsLoading}
        >
          <option value="">None - Configure manually after creation</option>
          {customizationSpecs.map((spec) => (
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
          <optgroup label="Common">
            <option value="UTC">UTC (Coordinated Universal Time)</option>
            <option value="America/New_York">America/New_York (EST/EDT)</option>
            <option value="America/Chicago">America/Chicago (CST/CDT)</option>
            <option value="America/Denver">America/Denver (MST/MDT)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
            <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
          </optgroup>
          <optgroup label="Americas">
            <option value="America/Anchorage">America/Anchorage (AKST)</option>
            <option value="America/Phoenix">America/Phoenix (MST)</option>
            <option value="America/Toronto">America/Toronto (EST)</option>
            <option value="America/Vancouver">America/Vancouver (PST)</option>
            <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
            <option value="America/Mexico_City">America/Mexico_City (CST)</option>
            <option value="America/Argentina/Buenos_Aires">America/Buenos_Aires (ART)</option>
          </optgroup>
          <optgroup label="Europe">
            <option value="Europe/Amsterdam">Europe/Amsterdam (CET)</option>
            <option value="Europe/Dublin">Europe/Dublin (GMT)</option>
            <option value="Europe/Madrid">Europe/Madrid (CET)</option>
            <option value="Europe/Moscow">Europe/Moscow (MSK)</option>
            <option value="Europe/Rome">Europe/Rome (CET)</option>
            <option value="Europe/Stockholm">Europe/Stockholm (CET)</option>
            <option value="Europe/Warsaw">Europe/Warsaw (CET)</option>
            <option value="Europe/Zurich">Europe/Zurich (CET)</option>
          </optgroup>
          <optgroup label="Asia & Pacific">
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT)</option>
            <option value="Asia/Seoul">Asia/Seoul (KST)</option>
            <option value="Asia/Taipei">Asia/Taipei (CST)</option>
            <option value="Asia/Bangkok">Asia/Bangkok (ICT)</option>
            <option value="Asia/Dubai">Asia/Dubai (GST)</option>
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
            <option value="Australia/Melbourne">Australia/Melbourne (AEST)</option>
            <option value="Pacific/Auckland">Pacific/Auckland (NZST)</option>
            <option value="Pacific/Honolulu">Pacific/Honolulu (HST)</option>
          </optgroup>
          <optgroup label="Africa & Middle East">
            <option value="Africa/Cairo">Africa/Cairo (EET)</option>
            <option value="Africa/Johannesburg">Africa/Johannesburg (SAST)</option>
            <option value="Asia/Jerusalem">Asia/Jerusalem (IST)</option>
            <option value="Asia/Riyadh">Asia/Riyadh (AST)</option>
          </optgroup>
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
  selectedHost,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  networks: ProcessedNetwork[];
  isLoading: boolean;
  selectedHost?: ProcessedNode;
}) {
  // Calculate available resources on selected host
  const availableCpu = selectedHost
    ? selectedHost.cpuCapacity - selectedHost.cpuAllocated
    : 32; // Default max if no host selected
  const availableMemoryMib = selectedHost
    ? selectedHost.memoryCapacityMib - selectedHost.memoryAllocatedMib
    : 65536; // Default 64GB max if no host selected

  // Calculate if current selection exceeds available resources
  const totalVCPUs = formData.cpuCores * formData.cpuSockets;
  const cpuExceedsLimit = selectedHost && totalVCPUs > availableCpu;
  const memoryExceedsLimit = selectedHost && formData.memoryMib > availableMemoryMib;
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

            <div className="pt-3 border-t border-border space-y-1">
              <p className="text-sm text-text-muted">
                Total: <span className={cn("font-medium", cpuExceedsLimit ? "text-error" : "text-text-primary")}>
                  {formData.cpuCores * formData.cpuSockets} vCPUs
                </span>
              </p>
              {selectedHost && (
                <p className="text-xs text-text-muted">
                  Available on {selectedHost.hostname}: <span className="text-success">{availableCpu} cores</span>
                </p>
              )}
              {cpuExceedsLimit && (
                <p className="text-xs text-error flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Exceeds available resources
                </p>
              )}
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
                className={cn("form-input", memoryExceedsLimit && "border-error")}
              />
            </FormField>

            <div className="pt-3 border-t border-border space-y-1">
              <p className="text-sm text-text-muted">
                Selected: <span className={cn("font-medium", memoryExceedsLimit ? "text-error" : "text-text-primary")}>
                  {formatBytes(formData.memoryMib * 1024 * 1024)}
                </span>
              </p>
              {selectedHost && (
                <p className="text-xs text-text-muted">
                  Available on {selectedHost.hostname}: <span className="text-success">{formatBytes(availableMemoryMib * 1024 * 1024)}</span>
                </p>
              )}
              {memoryExceedsLimit && (
                <p className="text-xs text-error flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Exceeds available memory
                </p>
              )}
            </div>
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
  cloudImages = [],
  imagesLoading = false,
  isUsingCatalog = false,
  isos = [],
  isosLoading = false,
  isUsingIsoCatalog = false,
  ovaTemplates = [],
  ovaLoading = false,
  selectedNodeId,
  selectedNodeHostname,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  cloudImages?: CloudImage[];
  imagesLoading?: boolean;
  isUsingCatalog?: boolean;
  isos?: (CloudImage | ISOImage)[];
  isosLoading?: boolean;
  isUsingIsoCatalog?: boolean;
  ovaTemplates?: OVATemplate[];
  ovaLoading?: boolean;
  selectedNodeId?: string;
  selectedNodeHostname?: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newSshKey, setNewSshKey] = useState('');
  const [downloadingImage, setDownloadingImage] = useState<string | null>(null);

  // Get catalog IDs for availability checking
  const catalogIds = useMemo(() => cloudImages.map(img => img.id), [cloudImages]);

  // Check image availability for the selected node
  const {
    availabilityMap,
    isAvailable,
    getAvailability,
    isAnyDownloading
  } = useImageAvailability(catalogIds, selectedNodeId, catalogIds.length > 0);

  // Download image mutation
  const downloadImage = useDownloadImage();

  // Ensure cloudImages and isos are always arrays
  const images = cloudImages || [];
  const isoImages = isos || ISO_CATALOG;

  const [sshKeyError, setSshKeyError] = useState<string | null>(null);

  const validateSshKey = (key: string): boolean => {
    const trimmed = key.trim();
    // Check for common SSH key formats
    const validPrefixes = ['ssh-rsa', 'ssh-ed25519', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];
    const startsWithValidPrefix = validPrefixes.some(prefix => trimmed.startsWith(prefix));

    if (!startsWithValidPrefix) {
      setSshKeyError('Invalid SSH key format. Key should start with ssh-rsa, ssh-ed25519, etc.');
      return false;
    }

    // Check for at least 2 parts (type and key data)
    const parts = trimmed.split(' ');
    if (parts.length < 2) {
      setSshKeyError('Invalid SSH key format. Key appears incomplete.');
      return false;
    }

    // Check if the key data looks like base64
    const keyData = parts[1];
    if (keyData.length < 100) {
      setSshKeyError('SSH key data appears too short. Make sure you copied the entire key.');
      return false;
    }

    setSshKeyError(null);
    return true;
  };

  const addSshKey = () => {
    if (newSshKey.trim()) {
      // Validate the key before adding
      if (!validateSshKey(newSshKey)) {
        return;
      }

      // Check for duplicates
      if (formData.cloudInit.sshKeys.some(k => k.trim() === newSshKey.trim())) {
        setSshKeyError('This SSH key has already been added.');
        return;
      }

      updateFormData({
        cloudInit: {
          ...formData.cloudInit,
          sshKeys: [...formData.cloudInit.sshKeys, newSshKey.trim()],
        },
      });
      setNewSshKey('');
      setSshKeyError(null);
    }
  };

  const removeSshKey = (index: number) => {
    updateFormData({
      cloudInit: {
        ...formData.cloudInit,
        sshKeys: formData.cloudInit.sshKeys.filter((_, i) => i !== index),
      },
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Boot Media</h3>
        <p className="text-text-muted mt-1">Choose how to provision your VM</p>
      </div>

      {/* Boot Media Type Selection */}
      <FormField label="Provisioning Method">
        <div className="grid grid-cols-4 gap-3">
          {/* Cloud Image (Recommended) */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all text-center',
              formData.bootMediaType === 'cloud-image'
                ? 'bg-accent/10 border-accent ring-2 ring-accent/20'
                : 'bg-bg-base border-border hover:border-accent/50',
            )}
          >
            <input
              type="radio"
              name="bootMediaType"
              checked={formData.bootMediaType === 'cloud-image'}
              onChange={() => updateFormData({ bootMediaType: 'cloud-image' })}
              className="sr-only"
            />
            <Cloud className="w-7 h-7 text-accent" />
            <div>
              <p className="text-sm font-medium text-text-primary">Cloud Image</p>
              <p className="text-xs text-text-muted">Automated</p>
            </div>
            <Badge variant="success" size="sm">Recommended</Badge>
          </label>

          {/* OVA Template */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all text-center',
              formData.bootMediaType === 'ova-template'
                ? 'bg-accent/10 border-accent ring-2 ring-accent/20'
                : 'bg-bg-base border-border hover:border-accent/50',
              (!ovaTemplates || ovaTemplates.length === 0) && 'opacity-50',
            )}
          >
            <input
              type="radio"
              name="bootMediaType"
              checked={formData.bootMediaType === 'ova-template'}
              onChange={() => updateFormData({ bootMediaType: 'ova-template' })}
              className="sr-only"
              disabled={!ovaTemplates || ovaTemplates.length === 0}
            />
            <Folder className="w-7 h-7 text-info" />
            <div>
              <p className="text-sm font-medium text-text-primary">OVA Template</p>
              <p className="text-xs text-text-muted">Pre-built VM</p>
            </div>
            {ovaTemplates && ovaTemplates.length > 0 && (
              <Badge variant="info" size="sm">{ovaTemplates.length} available</Badge>
            )}
          </label>

          {/* ISO Installation */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all text-center',
              formData.bootMediaType === 'iso'
                ? 'bg-accent/10 border-accent ring-2 ring-accent/20'
                : 'bg-bg-base border-border hover:border-accent/50',
            )}
          >
            <input
              type="radio"
              name="bootMediaType"
              checked={formData.bootMediaType === 'iso'}
              onChange={() => updateFormData({ bootMediaType: 'iso' })}
              className="sr-only"
            />
            <Disc className="w-7 h-7 text-text-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">ISO Image</p>
              <p className="text-xs text-text-muted">Manual install</p>
            </div>
          </label>

          {/* No Boot Media */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-3 rounded-lg border cursor-pointer transition-all text-center',
              formData.bootMediaType === 'none'
                ? 'bg-accent/10 border-accent ring-2 ring-accent/20'
                : 'bg-bg-base border-border hover:border-accent/50',
            )}
          >
            <input
              type="radio"
              name="bootMediaType"
              checked={formData.bootMediaType === 'none'}
              onChange={() => updateFormData({ bootMediaType: 'none' })}
              className="sr-only"
            />
            <HardDrive className="w-7 h-7 text-text-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">None</p>
              <p className="text-xs text-text-muted">Configure later</p>
            </div>
          </label>
        </div>
      </FormField>

      {/* Cloud Image Selection */}
      {formData.bootMediaType === 'cloud-image' && (
        <>
          <FormField label="Cloud Image" description="Pre-installed OS with cloud-init for fast provisioning">
            {imagesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
                <span className="ml-2 text-text-muted">Loading images...</span>
              </div>
            ) : (
              <div className="grid gap-2 max-h-48 overflow-y-auto">
                {images.map((image) => {
                  // Check image status - prefer direct status from DB, fall back to availability check
                  const imageReady = image.status === 'ready' && !!image.path;
                  const imageDownloading = image.status === 'downloading';
                  const downloadProgress = image.downloadProgress?.progressPercent || 0;
                  
                  // Fall back to catalog availability check if image is from catalog
                  const catalogAvailability = !imageReady && !imageDownloading ? getAvailability(image.id) : null;
                  const imageAvailable = imageReady || catalogAvailability?.status === 'READY';
                  const isDownloading = imageDownloading || catalogAvailability?.status === 'DOWNLOADING';
                  const progress = downloadProgress || catalogAvailability?.progress || 0;

                  return (
                    <label
                      key={image.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                        formData.cloudImageId === image.id
                          ? 'bg-accent/10 border-accent'
                          : 'bg-bg-base border-border hover:border-accent/50',
                        !imageAvailable && !isDownloading && 'opacity-75',
                      )}
                    >
                      <input
                        type="radio"
                        name="cloudImageId"
                        checked={formData.cloudImageId === image.id}
                        onChange={() => {
                          // Update cloud image and set default user based on OS
                          updateFormData({
                            cloudImageId: image.id,
                            cloudInit: {
                              ...formData.cloudInit,
                              defaultUser: image.os.defaultUser || getDefaultUser(image.os.distribution),
                            }
                          });
                        }}
                        className="form-radio"
                      />
                      <Cloud className={cn(
                        'w-5 h-5',
                        imageAvailable ? 'text-success' : isDownloading ? 'text-info' : 'text-warning'
                      )} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-text-primary">{image.name}</p>
                          {/* Availability Status Badge */}
                          {imageAvailable ? (
                            <Badge variant="success" size="sm" className="flex items-center gap-1">
                              <CheckCircle className="w-3 h-3" />
                              Ready
                            </Badge>
                          ) : isDownloading ? (
                            <Badge variant="info" size="sm" className="flex items-center gap-1">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {progress}%
                            </Badge>
                          ) : (
                            <Badge variant="warning" size="sm" className="flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              Download required
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-text-muted">{image.description}</p>
                        <p className="text-xs text-accent mt-0.5">Default user: {image.os.defaultUser}</p>
                        {/* Show image path if available */}
                        {image.path && (
                          <p className="text-xs text-text-muted mt-0.5 font-mono truncate max-w-xs" title={image.path}>
                            📁 {image.path}
                          </p>
                        )}
                        {/* Download progress bar */}
                        {isDownloading && (
                          <div className="mt-2 h-1.5 bg-bg-surface rounded-full overflow-hidden">
                            <div
                              className="h-full bg-info transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs text-text-muted">{formatImageSize(image.sizeBytes)}</span>
                        {/* Download button for unavailable images */}
                        {!imageAvailable && !isDownloading && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDownloadingImage(image.id);
                              downloadImage.mutate({
                                catalogId: image.id,
                                nodeId: selectedNodeId,
                              }, {
                                onSettled: () => setDownloadingImage(null),
                              });
                            }}
                            disabled={downloadingImage === image.id || downloadImage.isPending}
                            className="text-xs"
                          >
                            {downloadingImage === image.id ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Cloud className="w-3 h-3 mr-1" />
                            )}
                            Download
                          </Button>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            {/* Warning for selected unavailable image */}
            {formData.cloudImageId && (() => {
              const selectedImg = images.find(img => img.id === formData.cloudImageId);
              const isReady = selectedImg?.status === 'ready' && !!selectedImg?.path;
              const catalogReady = isAvailable(formData.cloudImageId);
              return !isReady && !catalogReady;
            })() && (
              <div className="mt-3 p-3 rounded-lg bg-warning/10 border border-warning/30 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-warning">Image not downloaded</p>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {selectedNodeHostname
                      ? `This image needs to be downloaded to "${selectedNodeHostname}" before VM creation.`
                      : 'This image needs to be downloaded before VM creation.'}
                    {' '}Click the Download button or select a different image.
                  </p>
                </div>
              </div>
            )}
            {isUsingCatalog && !formData.cloudImageId && (
              <p className="text-xs text-warning mt-2">
                ⚠️ Using built-in catalog. Download images to nodes for best performance.
              </p>
            )}
          </FormField>

          {/* Cloud-Init Configuration */}
          <div className="border border-border rounded-lg p-4 bg-bg-base space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-accent" />
                <h4 className="font-medium text-text-primary">Access Configuration</h4>
              </div>
              <Badge variant="info" size="sm">Cloud-Init</Badge>
            </div>

            {/* Default User */}
            <FormField label="Username" description="Login username for this VM">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={formData.cloudInit.defaultUser}
                  onChange={(e) => updateFormData({
                    cloudInit: { ...formData.cloudInit, defaultUser: e.target.value }
                  })}
                  placeholder="ubuntu"
                  className="flex-1 px-3 py-2 bg-bg-surface border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                />
              </div>
            </FormField>

            {/* Password Section */}
            <div className="p-4 rounded-lg bg-bg-surface border border-border space-y-4">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-accent" />
                <h5 className="text-sm font-medium text-text-primary">Password Authentication</h5>
                <Badge variant="success" size="sm">Recommended</Badge>
              </div>
              <p className="text-xs text-text-muted">
                Set a password to access your VM via console or SSH. This is essential for initial access and recovery.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Password">
                  <PasswordInput
                    value={formData.cloudInit.password}
                    onChange={(value) => updateFormData({
                      cloudInit: { ...formData.cloudInit, password: value }
                    })}
                    placeholder="Enter password"
                  />
                </FormField>
                <FormField label="Confirm Password">
                  <PasswordInput
                    value={formData.cloudInit.confirmPassword}
                    onChange={(value) => updateFormData({
                      cloudInit: { ...formData.cloudInit, confirmPassword: value }
                    })}
                    placeholder="Confirm password"
                  />
                </FormField>
              </div>

              {/* Password validation messages */}
              {formData.cloudInit.password && formData.cloudInit.confirmPassword &&
                formData.cloudInit.password !== formData.cloudInit.confirmPassword && (
                  <p className="text-xs text-error flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Passwords do not match
                  </p>
                )}
              {formData.cloudInit.password && formData.cloudInit.password.length < 8 && (
                <p className="text-xs text-warning flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Password should be at least 8 characters for security
                </p>
              )}
              {formData.cloudInit.password && formData.cloudInit.password === formData.cloudInit.confirmPassword &&
                formData.cloudInit.password.length >= 8 && (
                  <p className="text-xs text-success flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    Password set - SSH and console login enabled
                  </p>
                )}
              {!formData.cloudInit.password && formData.cloudInit.sshKeys.length === 0 && (
                <p className="text-xs text-error flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Warning: No password or SSH key configured. You won't be able to access this VM!
                </p>
              )}
            </div>

            {/* SSH Keys */}
            <div className="p-4 rounded-lg bg-bg-surface border border-border space-y-4">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-accent" />
                <h5 className="text-sm font-medium text-text-primary">SSH Key Authentication</h5>
                <Badge variant="default" size="sm">Optional</Badge>
              </div>
              <p className="text-xs text-text-muted">
                Add SSH public keys for passwordless, secure access. Keys are added in addition to password authentication.
              </p>

              <div className="space-y-2">
                {formData.cloudInit.sshKeys.map((key, index) => {
                  // Parse the key to show type and comment
                  const keyParts = key.trim().split(' ');
                  const keyType = keyParts[0] || 'unknown';
                  const keyComment = keyParts[2] || 'no comment';

                  return (
                    <div key={index} className="flex items-center gap-2 p-2 bg-bg-base border border-border rounded-lg">
                      <ShieldCheck className="w-4 h-4 text-success flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-text-primary truncate">{keyComment}</p>
                        <p className="text-xs text-text-muted">{keyType}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSshKey(index)}
                        className="p-1 text-text-muted hover:text-error transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <textarea
                      value={newSshKey}
                      onChange={(e) => {
                        setNewSshKey(e.target.value);
                        setSshKeyError(null); // Clear error when typing
                      }}
                      placeholder="ssh-rsa AAAAB3NzaC1yc2E... user@host&#10;ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@host"
                      rows={2}
                      className={cn(
                        "flex-1 px-3 py-2 bg-bg-base border rounded-lg text-text-primary text-sm font-mono focus:border-accent focus:outline-none resize-none",
                        sshKeyError ? "border-error" : "border-border"
                      )}
                    />
                    <Button
                      variant="secondary"
                      onClick={addSshKey}
                      disabled={!newSshKey.trim()}
                      className="self-end"
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </Button>
                  </div>
                  {sshKeyError && (
                    <p className="text-xs text-error flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {sshKeyError}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Access Summary */}
            {(formData.cloudInit.password || formData.cloudInit.sshKeys.length > 0) && (
              <div className="p-3 rounded-lg bg-success/10 border border-success/30">
                <h5 className="text-sm font-medium text-success mb-2 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Access Methods Configured
                </h5>
                <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
                  {formData.cloudInit.password && (
                    <div className="flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      <span>Password: <code className="text-text-primary">{formData.cloudInit.defaultUser}</code></span>
                    </div>
                  )}
                  {formData.cloudInit.sshKeys.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      <span>SSH: {formData.cloudInit.sshKeys.length} key(s)</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-2">
                  <strong>To connect:</strong> {formData.cloudInit.password ? (
                    <>Use console or <code>ssh {formData.cloudInit.defaultUser}@{'<IP>'}</code></>
                  ) : (
                    <><code>ssh -i ~/.ssh/id_rsa {formData.cloudInit.defaultUser}@{'<IP>'}</code></>
                  )}
                </p>
              </div>
            )}

            {/* Advanced: Custom User-Data */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-accent hover:text-accent-hover"
            >
              <ChevronRight className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-90')} />
              Advanced: Custom cloud-config
            </button>

            {showAdvanced && (
              <FormField label="Custom User-Data (cloud-config)" description="Override all above settings with custom cloud-init configuration">
                <textarea
                  value={formData.cloudInit.customUserData}
                  onChange={(e) => updateFormData({
                    cloudInit: { ...formData.cloudInit, customUserData: e.target.value }
                  })}
                  placeholder={`#cloud-config
users:
  - name: myuser
    groups: [sudo, adm]
    shell: /bin/bash
    lock_passwd: false
    ssh_authorized_keys:
      - ssh-rsa AAAA...

ssh_pwauth: true
chpasswd:
  expire: false
  list:
    - myuser:mypassword

packages:
  - nginx
  - docker.io`}
                  rows={10}
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-text-primary text-sm font-mono focus:border-accent focus:outline-none resize-none"
                />
                <p className="text-xs text-warning mt-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Custom config overrides username, password, and SSH key settings above
                </p>
              </FormField>
            )}
          </div>
        </>
      )}

      {/* OVA Template Selection */}
      {formData.bootMediaType === 'ova-template' && (
        <FormField label="OVA Template" description="Deploy from a pre-configured OVA template">
          {ovaLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span className="ml-2 text-text-muted">Loading templates...</span>
            </div>
          ) : ovaTemplates && ovaTemplates.length > 0 ? (
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {ovaTemplates.map((template: OVATemplate) => (
                <label
                  key={template.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                    formData.ovaTemplateId === template.id
                      ? 'bg-accent/10 border-accent'
                      : 'bg-bg-base border-border hover:border-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="ovaTemplateId"
                    checked={formData.ovaTemplateId === template.id}
                    onChange={() => {
                      updateFormData({ ovaTemplateId: template.id });
                      // Auto-populate hardware specs from OVA metadata
                      const meta = template.spec?.ovaMetadata;
                      if (meta?.hardware) {
                        updateFormData({
                          cpuCores: meta.hardware.cpuCount || formData.cpuCores,
                          memoryMib: meta.hardware.memoryMib || formData.memoryMib,
                        });
                      }
                    }}
                    className="form-radio"
                  />
                  <Folder className="w-5 h-5 text-info" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">{template.name}</p>
                    {template.description && (
                      <p className="text-xs text-text-muted">{template.description}</p>
                    )}
                    {template.spec?.ovaMetadata?.hardware && (
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-accent">
                          {template.spec.ovaMetadata.hardware.cpuCount} vCPU
                        </span>
                        <span className="text-xs text-accent">
                          {template.spec.ovaMetadata.hardware.memoryMib} MiB RAM
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-text-muted">
                    {formatOVASize(template.status?.virtualSizeBytes || 0)}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Folder className="w-12 h-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary">No OVA templates available</p>
              <p className="text-xs text-text-muted mt-1">Upload OVA files in Storage → Image Library</p>
            </div>
          )}
          <a
            href="/storage/images"
            className="mt-3 flex items-center gap-2 text-sm text-accent hover:text-accent-hover"
          >
            <Plus className="w-4 h-4" />
            Upload OVA Template
          </a>
        </FormField>
      )}

      {/* ISO Selection */}
      {formData.bootMediaType === 'iso' && (
        <FormField label="ISO Image" description="Select an ISO image for manual OS installation">
          {isosLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-accent" />
              <span className="ml-2 text-text-muted">Loading ISOs...</span>
            </div>
          ) : (
            <>
              {isUsingIsoCatalog && (
                <p className="text-xs text-warning mb-2 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Using built-in catalog. Upload ISOs in Storage → Image Library for better performance.
                </p>
              )}
              <div className="grid gap-2 max-h-64 overflow-y-auto">
                {isoImages.map((iso) => (
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
                    <Disc className="w-5 h-5 text-accent" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary">{iso.name}</p>
                      {'description' in iso && iso.description && (
                        <p className="text-xs text-text-muted">{iso.description}</p>
                      )}
                    </div>
                    <span className="text-xs text-text-muted">
                      {formatImageSize(iso.sizeBytes)}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <a
            href="/storage/images"
            className="mt-3 flex items-center gap-2 text-sm text-accent hover:text-accent-hover"
          >
            <Plus className="w-4 h-4" />
            Upload New ISO
          </a>
        </FormField>
      )}

      {/* No Boot Media Info */}
      {formData.bootMediaType === 'none' && (
        <div className="p-4 bg-bg-base border border-border rounded-lg">
          <p className="text-text-secondary">
            The VM will be created without any boot media. You can attach an ISO or configure
            network boot (PXE) after creation.
          </p>
        </div>
      )}
    </div>
  );
}

function StepStorage({
  formData,
  updateFormData,
  storagePools,
  isLoading,
  nodes,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  storagePools: StoragePoolUI[];
  isLoading: boolean;
  nodes: ProcessedNode[];
}) {
  // Use only API data (no mock fallback)
  const pools = storagePools;

  // Fetch volumes for the selected pool
  const { data: volumes, isLoading: volumesLoading } = useVolumes({ poolId: formData.storagePoolId });

  // Filter available volumes (not attached to any VM)
  const availableVolumes = useMemo(() => {
    if (!volumes) return [];
    return volumes.filter(v => v.status.phase === 'READY' && !v.status.attachedVmId);
  }, [volumes]);

  // Get volumes already selected in this wizard
  const selectedVolumeIds = useMemo(() => {
    return formData.disks
      .filter(d => d.sourceType === 'existing' && d.existingVolumeId)
      .map(d => d.existingVolumeId!);
  }, [formData.disks]);

  const addDisk = (sourceType: 'new' | 'existing' = 'new') => {
    const newDisk: DiskConfig = {
      id: `disk-${Date.now()}`,
      name: `Hard disk ${formData.disks.length + 1}`,
      sizeGib: 50,
      provisioning: 'thin',
      sourceType,
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

  const selectExistingVolume = (diskId: string, volume: VolumeUI) => {
    updateDisk(diskId, {
      existingVolumeId: volume.id,
      existingVolumePath: volume.status.devicePath,
      sizeGib: Math.ceil(volume.sizeBytes / (1024 * 1024 * 1024)),
      name: volume.name,
    });
  };

  // Auto-select first pool if only one exists and none selected
  useEffect(() => {
    if (pools.length > 0 && !formData.storagePoolId) {
      const readyPools = pools.filter(p => p.status.phase === 'READY');
      if (readyPools.length > 0) {
        updateFormData({ storagePoolId: readyPools[0].id });
      }
    }
  }, [pools, formData.storagePoolId, updateFormData]);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-text-primary">Storage Configuration</h3>
        <p className="text-text-muted mt-1">Select a storage pool and configure virtual disks</p>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-accent mr-2" />
          <span className="text-text-muted">Loading storage pools...</span>
        </div>
      )}

      {/* Empty storage pools indicator */}
      {!isLoading && storagePools && storagePools.length === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30 mb-4">
          <WifiOff className="w-4 h-4 text-warning" />
          <p className="text-xs text-warning">
            No storage pools available. Create storage pools in Storage → Pools first.
          </p>
        </div>
      )}

      {/* Host/Pool compatibility warning */}
      {formData.hostId && formData.storagePoolId && (() => {
        const selectedPool = pools.find(p => p.id === formData.storagePoolId);
        const selectedHostName = nodes.find(n => n.id === formData.hostId)?.hostname;
        if (selectedPool && selectedPool.assignedNodeIds.length > 0 && !selectedPool.assignedNodeIds.includes(formData.hostId)) {
          return (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-error/10 border border-error/30 mb-4">
              <AlertCircle className="w-4 h-4 text-error shrink-0" />
              <div className="text-xs text-error">
                <p className="font-medium">Host not compatible with selected storage pool</p>
                <p className="mt-0.5">
                  Host "{selectedHostName}" does not have access to pool "{selectedPool.name}".
                  Either go back and select "Auto Placement" or choose a different host/pool combination.
                </p>
              </div>
            </div>
          );
        }
        return null;
      })()}

      <FormField label="Storage Pool" required>
        <div className="grid gap-3">
          {pools.filter(p => p.status.phase === 'READY').map((pool) => {
            const usagePercent = pool.capacity.totalBytes > 0
              ? Math.round((pool.capacity.usedBytes / pool.capacity.totalBytes) * 100)
              : 0;

            // Check if selected host has access to this pool
            const selectedHost = nodes.find(n => n.id === formData.hostId);
            const hasHostAccess = !formData.hostId ||
              !selectedHost ||
              pool.assignedNodeIds.length === 0 ||
              pool.assignedNodeIds.includes(formData.hostId);

            // Get node names that have access
            const assignedNodeNames = pool.assignedNodeIds
              .map(id => nodes.find(n => n.id === id)?.hostname)
              .filter(Boolean);

            return (
              <label
                key={pool.id}
                className={cn(
                  'flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-all',
                  formData.storagePoolId === pool.id
                    ? 'bg-accent/10 border-accent'
                    : 'bg-bg-base border-border hover:border-accent/50',
                  !hasHostAccess && 'opacity-50',
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
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary">{pool.name}</p>
                    <Badge variant="default" size="sm">{pool.type}</Badge>
                    {pool.status.volumeCount > 0 && (
                      <Badge variant="info" size="sm">{pool.status.volumeCount} volumes</Badge>
                    )}
                    {!hasHostAccess && (
                      <Badge variant="warning" size="sm">
                        Not available on selected host
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-text-muted">
                    {formatBytes(pool.capacity.availableBytes)} available of{' '}
                    {formatBytes(pool.capacity.totalBytes)}
                    {assignedNodeNames.length > 0 && (
                      <span className="ml-2">
                        • Available on: {assignedNodeNames.slice(0, 2).join(', ')}
                        {assignedNodeNames.length > 2 && ` +${assignedNodeNames.length - 2} more`}
                      </span>
                    )}
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
          {pools.filter(p => p.status.phase === 'READY').length === 0 && !isLoading && (
            <div className="p-4 text-center text-text-muted">
              <p>No ready storage pools available.</p>
              <p className="text-xs mt-1">Create a storage pool first in Storage → Pools.</p>
            </div>
          )}
        </div>
      </FormField>

      {/* Virtual Disks */}
      <div className="p-5 rounded-xl bg-bg-base border border-border">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-text-primary">Virtual Disks</h4>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => addDisk('existing')} disabled={!formData.storagePoolId}>
              <HardDrive className="w-4 h-4" />
              Attach Volume
            </Button>
            <Button variant="ghost" size="sm" onClick={() => addDisk('new')}>
              <Plus className="w-4 h-4" />
              New Disk
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {formData.disks.map((disk, index) => (
            <div
              key={disk.id}
              className="p-3 rounded-lg bg-bg-surface border border-border"
            >
              {/* Disk Header */}
              <div className="flex items-center gap-3 mb-3">
                <HardDrive className="w-4 h-4 text-text-muted shrink-0" />
                <span className="text-sm font-medium text-text-secondary">{disk.name}</span>
                {index === 0 && (
                  <Badge variant="info" size="sm">Boot Disk</Badge>
                )}
                {disk.sourceType === 'existing' && (
                  <Badge variant="success" size="sm">Existing Volume</Badge>
                )}
                <div className="flex-1" />
                {formData.disks.length > 1 && (
                  <button
                    onClick={() => removeDisk(disk.id)}
                    className="p-1.5 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Source Type Toggle */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => updateDisk(disk.id, { sourceType: 'new', existingVolumeId: undefined, existingVolumePath: undefined })}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md transition-all',
                    disk.sourceType === 'new'
                      ? 'bg-accent text-white'
                      : 'bg-bg-elevated text-text-muted hover:text-text-primary'
                  )}
                >
                  Create New
                </button>
                <button
                  onClick={() => updateDisk(disk.id, { sourceType: 'existing' })}
                  disabled={!formData.storagePoolId}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md transition-all',
                    disk.sourceType === 'existing'
                      ? 'bg-accent text-white'
                      : 'bg-bg-elevated text-text-muted hover:text-text-primary',
                    !formData.storagePoolId && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  Use Existing Volume
                </button>
              </div>

              {/* New Disk Configuration */}
              {disk.sourceType === 'new' && (
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-muted">Size:</label>
                    <input
                      type="number"
                      min="1"
                      value={disk.sizeGib}
                      onChange={(e) => updateDisk(disk.id, { sizeGib: parseInt(e.target.value) || 1 })}
                      className="form-input !w-20 text-center text-sm"
                    />
                    <span className="text-xs text-text-muted">GiB</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-text-muted">Provisioning:</label>
                    <select
                      value={disk.provisioning}
                      onChange={(e) => updateDisk(disk.id, { provisioning: e.target.value as 'thin' | 'thick' })}
                      className="form-select text-sm"
                    >
                      <option value="thin">Thin</option>
                      <option value="thick">Thick</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Existing Volume Selection */}
              {disk.sourceType === 'existing' && (
                <div className="space-y-2">
                  {volumesLoading ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      <span className="text-xs text-text-muted">Loading volumes...</span>
                    </div>
                  ) : availableVolumes.length === 0 ? (
                    <div className="p-3 rounded-md bg-warning/10 border border-warning/30">
                      <p className="text-xs text-warning">
                        No available volumes in this pool. All volumes are either attached to VMs or the pool is empty.
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        Create volumes in Storage → Volumes, or switch to "Create New" to create a disk.
                      </p>
                    </div>
                  ) : (
                    <>
                      {disk.existingVolumeId ? (
                        <div className="flex items-center justify-between p-2 rounded-md bg-success/10 border border-success/30">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-success" />
                            <div>
                              <p className="text-sm font-medium text-text-primary">{disk.existingVolumeId}</p>
                              <p className="text-xs text-text-muted">{formatBytes(disk.sizeGib * 1024 * 1024 * 1024)}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => updateDisk(disk.id, { existingVolumeId: undefined, existingVolumePath: undefined })}
                            className="text-xs text-text-muted hover:text-text-primary"
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {availableVolumes
                            .filter(v => !selectedVolumeIds.includes(v.id) || v.id === disk.existingVolumeId)
                            .map(volume => (
                              <button
                                key={volume.id}
                                onClick={() => selectExistingVolume(disk.id, volume)}
                                className="w-full flex items-center justify-between p-2 rounded-md bg-bg-elevated hover:bg-bg-hover border border-border hover:border-accent/50 transition-all text-left"
                              >
                                <div className="flex items-center gap-2">
                                  <HardDrive className="w-4 h-4 text-text-muted" />
                                  <div>
                                    <p className="text-sm font-medium text-text-primary">{volume.name}</p>
                                    <p className="text-xs text-text-muted">Pool: {volume.poolId}</p>
                                  </div>
                                </div>
                                <span className="text-xs text-text-muted">{formatBytes(volume.sizeBytes)}</span>
                              </button>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-4 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-text-muted">
              {formData.disks.filter(d => d.sourceType === 'new').length} new disk(s), {' '}
              {formData.disks.filter(d => d.sourceType === 'existing').length} existing volume(s)
            </span>
            <span className="text-text-muted">
              Total new disk space: <span className="font-medium text-text-primary">
                {formData.disks.filter(d => d.sourceType === 'new').reduce((sum, d) => sum + d.sizeGib, 0)} GiB
              </span>
            </span>
          </div>
        </div>

        {/* Disk capacity validation for new disks */}
        {(() => {
          const selectedPool = pools.find(p => p.id === formData.storagePoolId);
          const totalNewDiskSizeGib = formData.disks
            .filter(d => d.sourceType === 'new')
            .reduce((sum, d) => sum + d.sizeGib, 0);
          const availableGib = selectedPool
            ? selectedPool.capacity.availableBytes / (1024 * 1024 * 1024)
            : 0;
          const exceedsCapacity = selectedPool && totalNewDiskSizeGib > availableGib;

          if (exceedsCapacity) {
            return (
              <div className="mt-3 flex items-center gap-1 text-error text-xs">
                <AlertCircle className="w-3 h-3" />
                Total new disk size ({totalNewDiskSizeGib} GiB) exceeds available pool capacity ({Math.floor(availableGib)} GiB)
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* Volume Benefits Info */}
      {formData.disks.some(d => d.sourceType === 'existing') && (
        <div className="p-4 rounded-lg bg-info/10 border border-info/30">
          <h5 className="text-sm font-medium text-info mb-2">Using Existing Volumes</h5>
          <ul className="text-xs text-text-muted space-y-1">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-3 h-3 text-info" />
              <span>Data persists independently of VM lifecycle</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-3 h-3 text-info" />
              <span>Volumes can be detached and reattached to different VMs</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-3 h-3 text-info" />
              <span>Supports volume-level snapshots and cloning</span>
            </li>
          </ul>
        </div>
      )}
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
  cloudImages,
  storagePools,
  isos,
  folders,
}: {
  formData: VMCreationData;
  clusters: ProcessedCluster[];
  nodes: ProcessedNode[];
  cloudImages: CloudImage[];
  storagePools: StoragePoolUI[];
  isos: (CloudImage | ISOImage)[];
  folders: Array<{ id: string; name: string; path: string }>;
}) {
  const selectedCluster = clusters.find((c) => c.id === formData.clusterId);
  const selectedHost = nodes.find((n) => n.id === formData.hostId);
  const selectedFolder = folders.find((f) => f.id === formData.folderId);
  // Use only API storage pools (no mock fallback)
  const selectedPool = storagePools.find((p) => p.id === formData.storagePoolId);
  // Use API ISOs with fallback to catalog
  const allISOs = isos.length > 0 ? isos : ISO_CATALOG;
  const selectedISO = allISOs.find((i) => i.id === formData.isoId);
  const selectedCloudImage = cloudImages.find((i) => i.id === formData.cloudImageId);

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
            value={formData.autoPlacement ? 'Automatic (scheduler will choose)' : selectedHost?.hostname || '—'}
          />
          {!formData.autoPlacement && selectedHost && (
            <>
              <ReviewRow
                label="Host IP"
                value={selectedHost.managementIp}
              />
              <ReviewRow
                label="Host Resources"
                value={`${selectedHost.cpuCapacity} cores, ${formatBytes(selectedHost.memoryCapacityMib * 1024 * 1024)} RAM`}
              />
            </>
          )}
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
          {formData.disks.map((disk, index) => (
            <ReviewRow
              key={disk.id}
              label={`Disk ${index + 1}${index === 0 ? ' (Boot)' : ''}`}
              value={
                disk.sourceType === 'existing'
                  ? `${disk.existingVolumeId || disk.name} (existing volume, ${disk.sizeGib} GB)`
                  : `${disk.sizeGib} GB (${disk.provisioning}, new)`
              }
            />
          ))}
          <ReviewRow
            label="Summary"
            value={`${formData.disks.filter(d => d.sourceType === 'new').length} new, ${formData.disks.filter(d => d.sourceType === 'existing').length} existing`}
          />
        </ReviewSection>

        {/* Boot & Customization */}
        <ReviewSection title="Boot & Provisioning">
          <ReviewRow
            label="Method"
            value={
              formData.bootMediaType === 'cloud-image'
                ? 'Cloud Image (Automated)'
                : formData.bootMediaType === 'iso'
                  ? 'ISO (Manual Install)'
                  : 'None'
            }
          />
          {formData.bootMediaType === 'cloud-image' && selectedCloudImage && (
            <>
              <ReviewRow label="Cloud Image" value={selectedCloudImage.name} />
              <ReviewRow label="Username" value={formData.cloudInit.defaultUser || 'ubuntu'} />
              <ReviewRow
                label="Password"
                value={formData.cloudInit.password ? '••••••••  ✓ Set' : 'Not set'}
              />
              <ReviewRow
                label="SSH Keys"
                value={
                  formData.cloudInit.sshKeys.length > 0
                    ? `${formData.cloudInit.sshKeys.length} key(s) configured`
                    : 'None'
                }
              />
              <ReviewRow
                label="Access"
                value={
                  formData.cloudInit.password && formData.cloudInit.sshKeys.length > 0
                    ? 'Password + SSH keys'
                    : formData.cloudInit.password
                      ? 'Password only'
                      : formData.cloudInit.sshKeys.length > 0
                        ? 'SSH keys only'
                        : '⚠️ No access configured!'
                }
              />
              {formData.cloudInit.customUserData && (
                <ReviewRow label="Custom Config" value="Custom cloud-config provided" />
              )}
            </>
          )}
          {formData.bootMediaType === 'iso' && (
            <ReviewRow label="ISO" value={selectedISO?.name || 'None selected'} />
          )}
          <ReviewRow label="Quantix Agent" value={formData.installAgent ? 'Will be installed via cloud-init' : 'Not installed'} />
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
  description,
  children,
}: {
  label: string;
  required?: boolean;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
        {required && <span className="text-error ml-1">*</span>}
      </label>
      {description && (
        <p className="text-xs text-text-muted">{description}</p>
      )}
      {children}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form onSubmit={(e) => e.preventDefault()} className="relative">
      <input
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="new-password"
        className="w-full px-3 py-2 pr-10 bg-bg-surface border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary transition-colors"
      >
        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </form>
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

