/**
 * VM Creation Wizard for QHCI (Quantix Host Console Interface)
 * 
 * This wizard mirrors the functionality of the vDC VMCreationWizard
 * but adapted for standalone host management (no cluster/folder steps).
 * 
 * Steps:
 * 1. Basic Info - Name, description
 * 2. Hardware - CPU, memory, NICs
 * 3. Boot Media - Cloud image, ISO, cloud-init configuration
 * 4. Storage - Pool selection, disk configuration
 * 5. Customization - Agent install, hostname, timezone
 * 6. Review - Configuration summary
 */

import { useState, useEffect, useMemo, Fragment, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  Server,
  Cpu,
  HardDrive,
  Network,
  Cloud,
  Disc,
  Loader2,
  Plus,
  Trash2,
  Settings,
  CheckCircle,
  AlertCircle,
  MemoryStick,
  Key,
  Lock,
  User,
  Terminal,
  Eye,
  EyeOff,
  ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Button, Input, Label, Badge } from '@/components/ui';
import { useCreateVM } from '@/hooks/useVMs';
import { useImages, formatImageSize, getDefaultUser, type CloudImage, CLOUD_IMAGE_CATALOG } from '@/hooks/useImages';
import { useStoragePools } from '@/hooks/useStorage';
import { useNetworks } from '@/hooks/useNetwork';
import { cn, formatBytes } from '@/lib/utils';
import type { CreateVmRequest, DiskSpec, NicSpec, CloudInitSpec } from '@/api/types';

// ============================================================================
// Types
// ============================================================================

interface CreateVMWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DiskConfig {
  id: string;
  name: string;
  sizeGib: number;
  provisioning: 'thin' | 'thick';
}

interface NetworkInterface {
  id: string;
  networkId: string;
  networkName: string;
  connected: boolean;
}

interface CloudInitConfig {
  enabled: boolean;
  defaultUser: string;
  password: string;
  confirmPassword: string;
  sshKeys: string[];
  customUserData: string;
}

interface VMCreationData {
  // Basic Info
  name: string;
  description: string;
  
  // Hardware
  cpuCores: number;
  cpuSockets: number;
  memoryMib: number;
  nics: NetworkInterface[];
  
  // Boot Media
  bootMediaType: 'cloud-image' | 'iso' | 'none';
  cloudImageId: string;
  isoId: string;
  
  // Storage
  storagePoolId: string;
  disks: DiskConfig[];
  
  // Customization
  installAgent: boolean;
  hostname: string;
  timezone: string;
  
  // Cloud-Init
  cloudInit: CloudInitConfig;
  
  // Notes
  notes: string;
}

// ============================================================================
// Constants
// ============================================================================

const STEPS = [
  { id: 'basic', label: 'Basics', icon: Server },
  { id: 'hardware', label: 'Hardware', icon: Cpu },
  { id: 'boot', label: 'Boot Media', icon: Disc },
  { id: 'storage', label: 'Storage', icon: HardDrive },
  { id: 'customize', label: 'Options', icon: Settings },
  { id: 'review', label: 'Review', icon: Check },
];

const initialFormData: VMCreationData = {
  name: '',
  description: '',
  cpuCores: 2,
  cpuSockets: 1,
  memoryMib: 2048,
  nics: [{ id: 'nic-1', networkId: 'default', networkName: 'Default Network', connected: true }],
  bootMediaType: 'cloud-image',
  cloudImageId: '',
  isoId: '',
  storagePoolId: '',
  disks: [{ id: 'disk-1', name: 'Hard disk 1', sizeGib: 50, provisioning: 'thin' }],
  installAgent: true,
  hostname: '',
  timezone: 'UTC',
  cloudInit: {
    enabled: true,
    defaultUser: 'ubuntu',
    password: '',
    confirmPassword: '',
    sshKeys: [],
    customUserData: '',
  },
  notes: '',
};

// ISO catalog for fallback
const ISO_CATALOG = [
  { id: 'ubuntu-22.04-iso', name: 'Ubuntu 22.04 Server', description: 'Ubuntu 22.04 LTS Server ISO', sizeBytes: 1.4 * 1024 * 1024 * 1024 },
  { id: 'ubuntu-24.04-iso', name: 'Ubuntu 24.04 Server', description: 'Ubuntu 24.04 LTS Server ISO', sizeBytes: 2.6 * 1024 * 1024 * 1024 },
  { id: 'debian-12-iso', name: 'Debian 12 Netinst', description: 'Debian 12 Network Install ISO', sizeBytes: 600 * 1024 * 1024 },
  { id: 'rocky-9-iso', name: 'Rocky Linux 9 DVD', description: 'Rocky Linux 9 Full DVD ISO', sizeBytes: 10 * 1024 * 1024 * 1024 },
];

// ============================================================================
// Validation Helpers
// ============================================================================

function validateVMName(name: string): { valid: boolean; error?: string } {
  if (!name) return { valid: false, error: 'Name is required' };
  if (name.length < 1) return { valid: false, error: 'Name must be at least 1 character' };
  if (name.length > 63) return { valid: false, error: 'Name must be 63 characters or less' };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-._]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/.test(name)) {
    return { valid: false, error: 'Name must start and end with alphanumeric, can contain hyphens, dots, underscores' };
  }
  return { valid: true };
}

function validatePassword(password: string, confirmPassword: string): { valid: boolean; error?: string } {
  if (password && password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (password && password !== confirmPassword) {
    return { valid: false, error: 'Passwords do not match' };
  }
  return { valid: true };
}

// ============================================================================
// Main Component
// ============================================================================

export function CreateVMWizard({ isOpen, onClose }: CreateVMWizardProps) {
  const navigate = useNavigate();
  const createVM = useCreateVM();
  
  // Data fetching
  const { images: cloudImages, isLoading: imagesLoading, isUsingCatalog } = useImages();
  const { data: storagePools, isLoading: storageLoading } = useStoragePools();
  const { data: networksData, isLoading: networksLoading } = useNetworks();
  
  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [formData, setFormData] = useState<VMCreationData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  
  // Process networks
  const networks = useMemo(() => {
    const defaultNetwork = { id: 'default', name: 'Default Network (virbr0)', type: 'NAT' };
    if (!networksData?.networks?.length) {
      return [defaultNetwork];
    }
    return [defaultNetwork, ...networksData.networks.map((net: { id: string; name: string; type?: string }) => ({
      id: net.id,
      name: net.name,
      type: net.type || 'bridge',
    }))];
  }, [networksData]);
  
  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setFormData(initialFormData);
      setError(null);
    }
  }, [isOpen]);
  
  // Auto-select first cloud image
  useEffect(() => {
    if (cloudImages.length > 0 && !formData.cloudImageId) {
      const firstImage = cloudImages[0];
      setFormData(prev => ({
        ...prev,
        cloudImageId: firstImage.id,
        cloudInit: {
          ...prev.cloudInit,
          defaultUser: firstImage.defaultUser || getDefaultUser(firstImage.os),
        },
      }));
    }
  }, [cloudImages, formData.cloudImageId]);
  
  // Auto-select first storage pool
  useEffect(() => {
    if (storagePools?.pools?.length > 0 && !formData.storagePoolId) {
      const readyPools = storagePools.pools.filter((p: { state: string }) => p.state === 'running' || p.state === 'ready');
      if (readyPools.length > 0) {
        setFormData(prev => ({ ...prev, storagePoolId: readyPools[0].name }));
      }
    }
  }, [storagePools, formData.storagePoolId]);
  
  const updateFormData = (updates: Partial<VMCreationData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
  };
  
  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setDirection(1);
      setCurrentStep(prev => prev + 1);
    }
  };
  
  const handleBack = () => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep(prev => prev - 1);
    }
  };
  
  const handleSubmit = async () => {
    setError(null);
    try {
      // Find selected cloud image
      const selectedCloudImage = formData.bootMediaType === 'cloud-image'
        ? cloudImages.find(img => img.id === formData.cloudImageId)
        : undefined;
      
      // Build cloud-init user-data
      let cloudInitUserData = '';
      if (formData.bootMediaType === 'cloud-image' && formData.cloudInit.enabled) {
        if (formData.cloudInit.customUserData) {
          cloudInitUserData = formData.cloudInit.customUserData;
        } else {
          const defaultUser = formData.cloudInit.defaultUser || 'ubuntu';
          const lines = [
            '#cloud-config',
            `hostname: ${formData.hostname || formData.name}`,
            `fqdn: ${formData.hostname || formData.name}.local`,
            'manage_etc_hosts: true',
            '',
            'users:',
            `  - name: ${defaultUser}`,
            '    groups: [sudo, adm]',
            '    sudo: ALL=(ALL) NOPASSWD:ALL',
            '    shell: /bin/bash',
            '    lock_passwd: false',
          ];
          
          // Add SSH keys
          if (formData.cloudInit.sshKeys.length > 0) {
            lines.push('    ssh_authorized_keys:');
            formData.cloudInit.sshKeys.forEach(key => {
              lines.push(`      - ${key.trim()}`);
            });
          }
          
          // Add password
          if (formData.cloudInit.password) {
            lines.push('');
            lines.push('ssh_pwauth: true');
            lines.push('');
            lines.push('chpasswd:');
            lines.push('  expire: false');
            lines.push('  list:');
            lines.push(`    - ${defaultUser}:${formData.cloudInit.password}`);
          }
          
          // Add packages
          lines.push('', 'package_update: true', 'packages:', '  - qemu-guest-agent');
          
          // Add agent installation if enabled
          if (formData.installAgent) {
            lines.push('');
            lines.push('# Quantix Agent Installation');
            lines.push('write_files:');
            lines.push('  - path: /etc/limiquantix/pre-freeze.d/.keep');
            lines.push('    content: ""');
            lines.push('  - path: /etc/limiquantix/post-thaw.d/.keep');
            lines.push('    content: ""');
            lines.push('');
            lines.push('runcmd:');
            lines.push('  - systemctl enable qemu-guest-agent');
            lines.push('  - systemctl start qemu-guest-agent');
          } else {
            lines.push('', 'runcmd:', '  - systemctl enable qemu-guest-agent', '  - systemctl start qemu-guest-agent');
          }
          
          // Add timezone
          if (formData.timezone && formData.timezone !== 'UTC') {
            lines.push(`  - timedatectl set-timezone ${formData.timezone}`);
          }
          
          cloudInitUserData = lines.join('\n');
        }
      }
      
      // Prepare disks
      const preparedDisks: DiskSpec[] = formData.disks.map((disk, index) => ({
        id: disk.id,
        sizeGib: disk.sizeGib,
        bus: 'virtio',
        format: 'qcow2',
        bootable: index === 0,
        backingFile: index === 0 && selectedCloudImage ? selectedCloudImage.path : undefined,
      }));
      
      // Prepare NICs
      const preparedNics: NicSpec[] = formData.nics.map(nic => ({
        id: nic.id,
        bridge: nic.networkId === 'default' ? 'virbr0' : nic.networkId,
        model: 'virtio',
      }));
      
      // Build request
      const request: CreateVmRequest = {
        name: formData.name,
        cpuCores: formData.cpuCores * formData.cpuSockets,
        memoryMib: formData.memoryMib,
        disks: preparedDisks,
        nics: preparedNics,
        cloudInit: cloudInitUserData ? {
          userData: cloudInitUserData,
          metaData: `instance-id: ${formData.name}\nlocal-hostname: ${formData.hostname || formData.name}`,
          networkConfig: '',
        } : undefined,
      };
      
      const result = await createVM.mutateAsync(request);
      onClose();
      navigate(`/vms/${result.vmId}`);
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
      case 1: // Hardware
        return formData.cpuCores > 0 && formData.cpuCores <= 128 &&
               formData.memoryMib >= 512 && formData.memoryMib <= 1048576;
      case 2: { // Boot Media
        if (formData.bootMediaType === 'cloud-image') {
          const hasPassword = formData.cloudInit.password.length >= 8 &&
                             formData.cloudInit.password === formData.cloudInit.confirmPassword;
          const hasSSHKeys = formData.cloudInit.sshKeys.length > 0;
          if (!hasPassword && !hasSSHKeys) return false;
          if (formData.cloudInit.password) {
            const passwordValidation = validatePassword(
              formData.cloudInit.password,
              formData.cloudInit.confirmPassword
            );
            if (!passwordValidation.valid) return false;
          }
          return true;
        }
        return true;
      }
      case 3: // Storage
        return formData.disks.length > 0 && formData.disks.every(d => d.sizeGib >= 1);
      case 4: // Customization
        return true;
      default:
        return true;
    }
  };
  
  const canProceed = isStepValid(currentStep);
  
  // Escape key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
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
          'relative z-10 w-full max-w-4xl max-h-[90vh]',
          'bg-bg-surface rounded-2xl shadow-2xl border border-border',
          'flex flex-col overflow-hidden',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-elevated/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
              <Server className="w-5 h-5 text-accent" />
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
                <StepHardware
                  formData={formData}
                  updateFormData={updateFormData}
                  networks={networks}
                  isLoading={networksLoading}
                />
              )}
              {currentStep === 2 && (
                <StepBootMedia
                  formData={formData}
                  updateFormData={updateFormData}
                  cloudImages={cloudImages}
                  imagesLoading={imagesLoading}
                  isUsingCatalog={isUsingCatalog}
                />
              )}
              {currentStep === 3 && (
                <StepStorage
                  formData={formData}
                  updateFormData={updateFormData}
                  storagePools={storagePools?.pools || []}
                  isLoading={storageLoading}
                />
              )}
              {currentStep === 4 && (
                <StepCustomization formData={formData} updateFormData={updateFormData} />
              )}
              {currentStep === 5 && (
                <StepReview
                  formData={formData}
                  cloudImages={cloudImages}
                  storagePools={storagePools?.pools || []}
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

// ============================================================================
// Step Components
// ============================================================================

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
  const nameValidation = useMemo(() => {
    if (!formData.name) return { valid: true };
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
            placeholder="e.g., web-server-01"
            className={cn(
              'w-full px-3 py-2 bg-bg-base border rounded-lg text-text-primary focus:border-accent focus:outline-none transition-colors',
              !nameValidation.valid ? 'border-error focus:border-error' : 'border-border'
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
              'w-full px-3 py-2 bg-bg-base border rounded-lg text-text-primary focus:border-accent focus:outline-none resize-none transition-colors',
              descriptionTooLong ? 'border-error focus:border-error' : 'border-border'
            )}
          />
          <div className="flex justify-between mt-1">
            <FieldError error={descriptionTooLong ? 'Description cannot exceed 500 characters' : undefined} />
            <span className={cn(
              'text-xs',
              descriptionTooLong ? 'text-error' : 'text-text-muted'
            )}>
              {formData.description.length}/500
            </span>
          </div>
        </FormField>
      </div>
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
  networks: Array<{ id: string; name: string; type: string }>;
  isLoading: boolean;
}) {
  const totalVCPUs = formData.cpuCores * formData.cpuSockets;
  
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
    updateFormData({ nics: formData.nics.filter(n => n.id !== id) });
  };
  
  const updateNIC = (id: string, updates: Partial<NetworkInterface>) => {
    updateFormData({
      nics: formData.nics.map(n => (n.id === id ? { ...n, ...updates } : n)),
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
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
              >
                {[1, 2, 4].map(s => (
                  <option key={s} value={s}>
                    {s} socket{s > 1 ? 's' : ''}
                  </option>
                ))}
              </select>
            </FormField>
            
            <div className="pt-3 border-t border-border">
              <p className="text-sm text-text-muted">
                Total: <span className="font-medium text-text-primary">{totalVCPUs} vCPUs</span>
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
                {[2048, 4096, 8192, 16384].map(size => (
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
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
              />
            </FormField>
            
            <div className="pt-3 border-t border-border">
              <p className="text-sm text-text-muted">
                Selected: <span className="font-medium text-text-primary">{formatBytes(formData.memoryMib * 1024 * 1024)}</span>
              </p>
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
                  const network = networks.find(n => n.id === e.target.value);
                  updateNIC(nic.id, {
                    networkId: e.target.value,
                    networkName: network?.name || '',
                  });
                }}
                className="flex-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
                disabled={isLoading}
              >
                {isLoading ? (
                  <option>Loading networks...</option>
                ) : (
                  networks.map(net => (
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

function StepBootMedia({
  formData,
  updateFormData,
  cloudImages,
  imagesLoading,
  isUsingCatalog,
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  cloudImages: CloudImage[];
  imagesLoading: boolean;
  isUsingCatalog: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newSshKey, setNewSshKey] = useState('');
  const [sshKeyError, setSshKeyError] = useState<string | null>(null);
  
  const validateSshKey = (key: string): boolean => {
    const trimmed = key.trim();
    const validPrefixes = ['ssh-rsa', 'ssh-ed25519', 'ssh-dss', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521'];
    const startsWithValidPrefix = validPrefixes.some(prefix => trimmed.startsWith(prefix));
    
    if (!startsWithValidPrefix) {
      setSshKeyError('Invalid SSH key format. Key should start with ssh-rsa, ssh-ed25519, etc.');
      return false;
    }
    
    const parts = trimmed.split(' ');
    if (parts.length < 2) {
      setSshKeyError('Invalid SSH key format. Key appears incomplete.');
      return false;
    }
    
    if (parts[1].length < 100) {
      setSshKeyError('SSH key data appears too short. Make sure you copied the entire key.');
      return false;
    }
    
    setSshKeyError(null);
    return true;
  };
  
  const addSshKey = () => {
    if (newSshKey.trim()) {
      if (!validateSshKey(newSshKey)) return;
      
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
        <div className="grid grid-cols-3 gap-3">
          {/* Cloud Image */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer transition-all text-center',
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
            <Cloud className="w-8 h-8 text-accent" />
            <div>
              <p className="text-sm font-medium text-text-primary">Cloud Image</p>
              <p className="text-xs text-text-muted">Automated setup</p>
            </div>
            <Badge variant="success" size="sm">Recommended</Badge>
          </label>
          
          {/* ISO */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer transition-all text-center',
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
            <Disc className="w-8 h-8 text-text-muted" />
            <div>
              <p className="text-sm font-medium text-text-primary">ISO Image</p>
              <p className="text-xs text-text-muted">Manual install</p>
            </div>
          </label>
          
          {/* None */}
          <label
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-lg border cursor-pointer transition-all text-center',
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
            <HardDrive className="w-8 h-8 text-text-muted" />
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
                {cloudImages.map(image => (
                  <label
                    key={image.id}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all',
                      formData.cloudImageId === image.id
                        ? 'bg-accent/10 border-accent'
                        : 'bg-bg-base border-border hover:border-accent/50',
                    )}
                  >
                    <input
                      type="radio"
                      name="cloudImageId"
                      checked={formData.cloudImageId === image.id}
                      onChange={() => {
                        updateFormData({
                          cloudImageId: image.id,
                          cloudInit: {
                            ...formData.cloudInit,
                            defaultUser: image.defaultUser || getDefaultUser(image.os),
                          },
                        });
                      }}
                      className="form-radio"
                    />
                    <Cloud className="w-5 h-5 text-success" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text-primary">{image.name}</p>
                      <p className="text-xs text-accent mt-0.5">Default user: {image.defaultUser || getDefaultUser(image.os)}</p>
                    </div>
                    <span className="text-xs text-text-muted">{formatImageSize(image.size)}</span>
                  </label>
                ))}
              </div>
            )}
            {isUsingCatalog && (
              <p className="text-xs text-warning mt-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Using built-in catalog. Download images for best performance.
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
                Set a password to access your VM via console or SSH.
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
                  Password should be at least 8 characters
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
                Add SSH public keys for passwordless, secure access.
              </p>
              
              <div className="space-y-2">
                {formData.cloudInit.sshKeys.map((key, index) => {
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
                        setSshKeyError(null);
                      }}
                      placeholder="ssh-rsa AAAAB3NzaC1yc2E... user@host"
                      rows={2}
                      className={cn(
                        'flex-1 px-3 py-2 bg-bg-base border rounded-lg text-text-primary text-sm font-mono focus:border-accent focus:outline-none resize-none',
                        sshKeyError ? 'border-error' : 'border-border'
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
            
            {/* Advanced */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-accent hover:text-accent-hover"
            >
              <ChevronRight className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-90')} />
              Advanced: Custom cloud-config
            </button>
            
            {showAdvanced && (
              <FormField label="Custom User-Data" description="Override all above settings with custom cloud-init configuration">
                <textarea
                  value={formData.cloudInit.customUserData}
                  onChange={(e) => updateFormData({
                    cloudInit: { ...formData.cloudInit, customUserData: e.target.value }
                  })}
                  placeholder={`#cloud-config
users:
  - name: myuser
    groups: [sudo]
    shell: /bin/bash`}
                  rows={8}
                  className="w-full px-3 py-2 bg-bg-surface border border-border rounded-lg text-text-primary text-sm font-mono focus:border-accent focus:outline-none resize-none"
                />
              </FormField>
            )}
          </div>
        </>
      )}
      
      {/* ISO Selection */}
      {formData.bootMediaType === 'iso' && (
        <FormField label="ISO Image" description="Select an ISO image for manual OS installation">
          <div className="grid gap-2 max-h-64 overflow-y-auto">
            {ISO_CATALOG.map(iso => (
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
                  <p className="text-xs text-text-muted">{iso.description}</p>
                </div>
                <span className="text-xs text-text-muted">{formatBytes(iso.sizeBytes)}</span>
              </label>
            ))}
          </div>
        </FormField>
      )}
      
      {/* None Info */}
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
}: {
  formData: VMCreationData;
  updateFormData: (updates: Partial<VMCreationData>) => void;
  storagePools: Array<{ name: string; state: string; capacity: number; allocation: number; available: number; path: string }>;
  isLoading: boolean;
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
    updateFormData({ disks: formData.disks.filter(d => d.id !== id) });
  };
  
  const updateDisk = (id: string, updates: Partial<DiskConfig>) => {
    updateFormData({
      disks: formData.disks.map(d => (d.id === id ? { ...d, ...updates } : d)),
    });
  };
  
  // Auto-select first pool
  useEffect(() => {
    if (storagePools.length > 0 && !formData.storagePoolId) {
      const readyPools = storagePools.filter(p => p.state === 'running' || p.state === 'ready');
      if (readyPools.length > 0) {
        updateFormData({ storagePoolId: readyPools[0].name });
      }
    }
  }, [storagePools, formData.storagePoolId, updateFormData]);
  
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
      
      {/* Storage Pool Selection */}
      {!isLoading && (
        <FormField label="Storage Pool">
          <div className="grid gap-3">
            {storagePools.filter(p => p.state === 'running' || p.state === 'ready').map(pool => {
              const usagePercent = pool.capacity > 0
                ? Math.round((pool.allocation / pool.capacity) * 100)
                : 0;
              
              return (
                <label
                  key={pool.name}
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-lg border cursor-pointer transition-all',
                    formData.storagePoolId === pool.name
                      ? 'bg-accent/10 border-accent'
                      : 'bg-bg-base border-border hover:border-accent/50',
                  )}
                >
                  <input
                    type="radio"
                    name="storagePoolId"
                    checked={formData.storagePoolId === pool.name}
                    onChange={() => updateFormData({ storagePoolId: pool.name })}
                    className="form-radio"
                  />
                  <HardDrive className="w-5 h-5 text-text-muted" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">{pool.name}</p>
                    <p className="text-xs text-text-muted">
                      {formatBytes(pool.available)} available of {formatBytes(pool.capacity)}
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
            {storagePools.filter(p => p.state === 'running' || p.state === 'ready').length === 0 && (
              <div className="p-4 text-center text-text-muted">
                <p>No storage pools available.</p>
                <p className="text-xs mt-1">Create a storage pool first in Storage → Pools.</p>
              </div>
            )}
          </div>
        </FormField>
      )}
      
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
          {formData.disks.map(disk => (
            <div
              key={disk.id}
              className="flex items-center gap-4 p-3 rounded-lg bg-bg-surface border border-border"
            >
              <HardDrive className="w-4 h-4 text-text-muted shrink-0" />
              <span className="text-sm font-medium text-text-secondary shrink-0">{disk.name}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={disk.sizeGib}
                  onChange={(e) => updateDisk(disk.id, { sizeGib: parseInt(e.target.value) || 1 })}
                  className="w-20 px-2 py-1 bg-bg-base border border-border rounded text-center text-text-primary focus:border-accent focus:outline-none"
                />
                <span className="text-sm text-text-muted shrink-0">GiB</span>
              </div>
              <select
                value={disk.provisioning}
                onChange={(e) => updateDisk(disk.id, { provisioning: e.target.value as 'thin' | 'thick' })}
                className="w-28 px-2 py-1 bg-bg-base border border-border rounded text-text-primary focus:border-accent focus:outline-none"
              >
                <option value="thin">Thin</option>
                <option value="thick">Thick</option>
              </select>
              {formData.disks.length > 1 && (
                <button
                  onClick={() => removeDisk(disk.id)}
                  className="p-1.5 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        
        <div className="mt-3">
          <p className="text-xs text-text-muted">
            Total disk space: <span className="font-medium text-text-primary">
              {formData.disks.reduce((sum, d) => sum + d.sizeGib, 0)} GiB
            </span>
          </p>
        </div>
      </div>
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
      
      {/* Quantix Agent Installation */}
      <div className={cn(
        'p-4 rounded-lg border transition-all',
        formData.installAgent
          ? 'bg-accent/5 border-accent/30'
          : 'bg-bg-base border-border'
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
                  <span>Live metrics &amp; telemetry</span>
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
                  <span>Snapshot quiescing</span>
                </div>
              </div>
            )}
          </div>
        </label>
      </div>
      
      <FormField label="Guest Hostname">
        <input
          type="text"
          value={formData.hostname}
          onChange={(e) => updateFormData({ hostname: e.target.value })}
          placeholder={formData.name || 'Will use VM name if empty'}
          className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
        />
      </FormField>
      
      <FormField label="Timezone">
        <select
          value={formData.timezone}
          onChange={(e) => updateFormData({ timezone: e.target.value })}
          className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
        >
          <optgroup label="Common">
            <option value="UTC">UTC (Coordinated Universal Time)</option>
            <option value="America/New_York">America/New_York (EST/EDT)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET/CEST)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Asia/Shanghai">Asia/Shanghai (CST)</option>
          </optgroup>
          <optgroup label="Americas">
            <option value="America/Chicago">America/Chicago (CST/CDT)</option>
            <option value="America/Denver">America/Denver (MST/MDT)</option>
            <option value="America/Toronto">America/Toronto (EST)</option>
            <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
          </optgroup>
          <optgroup label="Europe">
            <option value="Europe/Paris">Europe/Paris (CET/CEST)</option>
            <option value="Europe/Moscow">Europe/Moscow (MSK)</option>
            <option value="Europe/Amsterdam">Europe/Amsterdam (CET)</option>
          </optgroup>
          <optgroup label="Asia & Pacific">
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
            <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT)</option>
            <option value="Asia/Seoul">Asia/Seoul (KST)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
          </optgroup>
        </select>
      </FormField>
      
      <FormField label="Notes">
        <textarea
          value={formData.notes}
          onChange={(e) => updateFormData({ notes: e.target.value })}
          placeholder="Any additional notes about this VM..."
          rows={4}
          className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none resize-none"
        />
      </FormField>
    </div>
  );
}

function StepReview({
  formData,
  cloudImages,
  storagePools,
}: {
  formData: VMCreationData;
  cloudImages: CloudImage[];
  storagePools: Array<{ name: string; state: string; capacity: number; allocation: number; available: number; path: string }>;
}) {
  const selectedCloudImage = cloudImages.find(i => i.id === formData.cloudImageId);
  const selectedPool = storagePools.find(p => p.name === formData.storagePoolId);
  
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
        </ReviewSection>
        
        {/* Hardware */}
        <ReviewSection title="Hardware">
          <ReviewRow
            label="CPU"
            value={`${formData.cpuCores * formData.cpuSockets} vCPUs (${formData.cpuCores} cores × ${formData.cpuSockets} socket${formData.cpuSockets > 1 ? 's' : ''})`}
          />
          <ReviewRow label="Memory" value={formatBytes(formData.memoryMib * 1024 * 1024)} />
          <ReviewRow
            label="Network"
            value={formData.nics.map(n => n.networkName).join(', ')}
          />
        </ReviewSection>
        
        {/* Storage */}
        <ReviewSection title="Storage">
          <ReviewRow label="Pool" value={selectedPool?.name || '—'} />
          <ReviewRow
            label="Disks"
            value={formData.disks.map(d => `${d.sizeGib} GB (${d.provisioning})`).join(', ')}
          />
          <ReviewRow
            label="Total"
            value={`${formData.disks.reduce((sum, d) => sum + d.sizeGib, 0)} GB`}
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
            </>
          )}
          <ReviewRow label="Quantix Agent" value={formData.installAgent ? 'Will be installed via cloud-init' : 'Not installed'} />
          {formData.hostname && <ReviewRow label="Hostname" value={formData.hostname} />}
          {formData.timezone && formData.timezone !== 'UTC' && (
            <ReviewRow label="Timezone" value={formData.timezone} />
          )}
        </ReviewSection>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

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
    <div className="relative">
      <input
        type={showPassword ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 pr-10 bg-bg-surface border border-border rounded-lg text-text-primary focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary transition-colors"
      >
        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
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
