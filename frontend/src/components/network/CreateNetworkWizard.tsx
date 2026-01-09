import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Network,
  Cable,
  Globe,
  Wifi,
  Check,
  AlertCircle,
  HelpCircle,
  Server,
  Layers,
  Router,
  Settings,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { type VirtualNetwork } from '@/types/models';

interface CreateNetworkWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<VirtualNetwork>) => Promise<void>;
}

type NetworkType = 'VLAN' | 'OVERLAY' | 'EXTERNAL';

interface FormData {
  // Step 1: Type selection
  type: NetworkType;
  // Step 2: Basic info
  name: string;
  description: string;
  // Step 3: Network configuration
  vlanId: string;
  cidr: string;
  gateway: string;
  dhcpEnabled: boolean;
  dhcpRangeStart: string;
  dhcpRangeEnd: string;
  // Step 4: Advanced options
  mtu: string;
  enableRouting: boolean;
  externalGateway: string;
}

const initialFormData: FormData = {
  type: 'VLAN',
  name: '',
  description: '',
  vlanId: '',
  cidr: '',
  gateway: '',
  dhcpEnabled: true,
  dhcpRangeStart: '',
  dhcpRangeEnd: '',
  mtu: '1500',
  enableRouting: false,
  externalGateway: '',
};

const NETWORK_TYPES: {
  id: NetworkType;
  name: string;
  description: string;
  icon: typeof Cable;
  features: string[];
  useCase: string;
  color: string;
}[] = [
  {
    id: 'VLAN',
    name: 'VLAN Network',
    description: 'Traditional Layer 2 network with VLAN tagging',
    icon: Cable,
    features: ['802.1Q VLAN tagging', 'Direct host connectivity', 'Low latency', 'Hardware acceleration'],
    useCase: 'Best for: Production workloads requiring direct network access',
    color: 'blue',
  },
  {
    id: 'OVERLAY',
    name: 'Overlay Network',
    description: 'Software-defined network using Geneve encapsulation',
    icon: Layers,
    features: ['Isolated tenant networks', 'Cross-host connectivity', 'Security groups', 'Micro-segmentation'],
    useCase: 'Best for: Multi-tenant environments and isolated workloads',
    color: 'purple',
  },
  {
    id: 'EXTERNAL',
    name: 'External Network',
    description: 'Direct connection to physical network infrastructure',
    icon: Globe,
    features: ['Public IP routing', 'Floating IP support', 'NAT gateway', 'External access'],
    useCase: 'Best for: Internet-facing services and external connectivity',
    color: 'green',
  },
];

const STEPS = [
  { id: 1, title: 'Network Type', description: 'Choose the type of network' },
  { id: 2, title: 'Basic Info', description: 'Name and description' },
  { id: 3, title: 'Configuration', description: 'IP addressing and DHCP' },
  { id: 4, title: 'Review', description: 'Confirm settings' },
];

// Helper to calculate gateway from CIDR
function suggestGateway(cidr: string): string {
  if (!cidr.includes('/')) return '';
  const [ip] = cidr.split('/');
  const parts = ip.split('.');
  if (parts.length !== 4) return '';
  parts[3] = '1';
  return parts.join('.');
}

// Helper to calculate DHCP range from CIDR
function suggestDHCPRange(cidr: string): { start: string; end: string } {
  if (!cidr.includes('/')) return { start: '', end: '' };
  const [ip, prefix] = cidr.split('/');
  const parts = ip.split('.');
  if (parts.length !== 4) return { start: '', end: '' };
  
  const prefixNum = parseInt(prefix);
  if (prefixNum >= 24) {
    // /24 or smaller - suggest .100 to .200
    parts[3] = '100';
    const start = parts.join('.');
    parts[3] = '200';
    const end = parts.join('.');
    return { start, end };
  }
  return { start: '', end: '' };
}

// Validate CIDR format
function isValidCIDR(cidr: string): boolean {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;
  const [ip, prefix] = cidr.split('/');
  const parts = ip.split('.').map(Number);
  const prefixNum = parseInt(prefix);
  return parts.every(p => p >= 0 && p <= 255) && prefixNum >= 0 && prefixNum <= 32;
}

// Validate IP address format
function isValidIP(ip: string): boolean {
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipRegex.test(ip)) return false;
  return ip.split('.').map(Number).every(p => p >= 0 && p <= 255);
}

export function CreateNetworkWizard({ isOpen, onClose, onSubmit }: CreateNetworkWizardProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateFormData = (updates: Partial<FormData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
    // Clear errors for updated fields
    const clearedErrors = { ...errors };
    Object.keys(updates).forEach(key => delete clearedErrors[key]);
    setErrors(clearedErrors);
  };

  // Auto-suggest gateway and DHCP range when CIDR changes
  const handleCIDRChange = (cidr: string) => {
    updateFormData({ cidr });
    if (isValidCIDR(cidr)) {
      const gateway = suggestGateway(cidr);
      const dhcpRange = suggestDHCPRange(cidr);
      updateFormData({
        cidr,
        gateway: formData.gateway || gateway,
        dhcpRangeStart: formData.dhcpRangeStart || dhcpRange.start,
        dhcpRangeEnd: formData.dhcpRangeEnd || dhcpRange.end,
      });
    }
  };

  // Validation for each step
  const validateStep = (stepNum: number): boolean => {
    const newErrors: Record<string, string> = {};

    switch (stepNum) {
      case 1:
        if (!formData.type) newErrors.type = 'Please select a network type';
        break;
      case 2:
        if (!formData.name.trim()) newErrors.name = 'Network name is required';
        if (formData.name.length > 64) newErrors.name = 'Name must be 64 characters or less';
        break;
      case 3:
        if (!formData.cidr) {
          newErrors.cidr = 'CIDR is required';
        } else if (!isValidCIDR(formData.cidr)) {
          newErrors.cidr = 'Invalid CIDR format (e.g., 10.0.0.0/24)';
        }
        if (!formData.gateway) {
          newErrors.gateway = 'Gateway is required';
        } else if (!isValidIP(formData.gateway)) {
          newErrors.gateway = 'Invalid IP address format';
        }
        if (formData.type === 'VLAN' && !formData.vlanId) {
          newErrors.vlanId = 'VLAN ID is required for VLAN networks';
        } else if (formData.type === 'VLAN') {
          const vlanNum = parseInt(formData.vlanId);
          if (isNaN(vlanNum) || vlanNum < 1 || vlanNum > 4094) {
            newErrors.vlanId = 'VLAN ID must be between 1 and 4094';
          }
        }
        if (formData.dhcpEnabled) {
          if (formData.dhcpRangeStart && !isValidIP(formData.dhcpRangeStart)) {
            newErrors.dhcpRangeStart = 'Invalid IP address format';
          }
          if (formData.dhcpRangeEnd && !isValidIP(formData.dhcpRangeEnd)) {
            newErrors.dhcpRangeEnd = 'Invalid IP address format';
          }
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(step)) {
      setStep(prev => Math.min(prev + 1, STEPS.length));
    }
  };

  const handleBack = () => {
    setStep(prev => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!validateStep(3)) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: formData.name,
        description: formData.description,
        type: formData.type,
        vlanId: formData.vlanId ? parseInt(formData.vlanId) : undefined,
        cidr: formData.cidr,
        gateway: formData.gateway,
        dhcpEnabled: formData.dhcpEnabled,
        mtu: parseInt(formData.mtu),
      });
      // Reset and close on success
      setFormData(initialFormData);
      setStep(1);
      onClose();
    } catch (error) {
      // Error handling is done in parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFormData(initialFormData);
    setStep(1);
    setErrors({});
    onClose();
  };

  const selectedType = NETWORK_TYPES.find(t => t.id === formData.type);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-3xl bg-bg-surface rounded-xl border border-border shadow-elevated overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-base">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10">
              <Network className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Create Virtual Network</h2>
              <p className="text-sm text-text-muted">Configure a new network for your infrastructure</p>
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
            {STEPS.map((s, index) => (
              <div key={s.id} className="flex items-center">
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                      step > s.id
                        ? 'bg-success text-white'
                        : step === s.id
                        ? 'bg-accent text-white'
                        : 'bg-bg-elevated text-text-muted'
                    )}
                  >
                    {step > s.id ? <Check className="w-4 h-4" /> : s.id}
                  </div>
                  <div className="hidden sm:block">
                    <p className={cn(
                      'text-sm font-medium',
                      step >= s.id ? 'text-text-primary' : 'text-text-muted'
                    )}>
                      {s.title}
                    </p>
                    <p className="text-xs text-text-muted">{s.description}</p>
                  </div>
                </div>
                {index < STEPS.length - 1 && (
                  <div className={cn(
                    'w-12 sm:w-24 h-0.5 mx-2 sm:mx-4',
                    step > s.id ? 'bg-success' : 'bg-border'
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 min-h-[400px]">
          <AnimatePresence mode="wait">
            {/* Step 1: Network Type Selection */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-text-primary mb-2">Select Network Type</h3>
                  <p className="text-sm text-text-muted">
                    Choose the type of network that best fits your use case. Each type has different characteristics and is suited for different scenarios.
                  </p>
                </div>

                <div className="grid gap-4">
                  {NETWORK_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = formData.type === type.id;
                    return (
                      <motion.button
                        key={type.id}
                        onClick={() => updateFormData({ type: type.id })}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className={cn(
                          'relative p-4 rounded-xl border-2 text-left transition-all',
                          isSelected
                            ? 'border-accent bg-accent/5'
                            : 'border-border hover:border-accent/50 hover:bg-bg-hover'
                        )}
                      >
                        <div className="flex items-start gap-4">
                          <div className={cn(
                            'p-3 rounded-lg',
                            type.color === 'blue' && 'bg-blue-500/10 text-blue-400',
                            type.color === 'purple' && 'bg-purple-500/10 text-purple-400',
                            type.color === 'green' && 'bg-green-500/10 text-green-400',
                          )}>
                            <Icon className="w-6 h-6" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium text-text-primary">{type.name}</h4>
                              {isSelected && (
                                <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </div>
                            <p className="text-sm text-text-muted mb-3">{type.description}</p>
                            <div className="flex flex-wrap gap-2 mb-2">
                              {type.features.map((feature, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded-full text-xs bg-bg-elevated text-text-secondary"
                                >
                                  {feature}
                                </span>
                              ))}
                            </div>
                            <p className="text-xs text-accent">{type.useCase}</p>
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Step 2: Basic Info */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-text-primary mb-2">Basic Information</h3>
                  <p className="text-sm text-text-muted">
                    Provide a name and description for your {selectedType?.name || 'network'}.
                  </p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Network Name <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => updateFormData({ name: e.target.value })}
                      className={cn(
                        'form-input w-full',
                        errors.name && 'border-error focus:border-error focus:ring-error/20'
                      )}
                      placeholder="e.g., Production-VLAN-100"
                    />
                    {errors.name ? (
                      <p className="mt-1.5 text-sm text-error flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {errors.name}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-text-muted">
                        Use a descriptive name that identifies the network's purpose
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => updateFormData({ description: e.target.value })}
                      className="form-input w-full h-24 resize-none"
                      placeholder="Optional description of this network's purpose and usage..."
                    />
                  </div>
                </div>

                {/* Info Card */}
                <div className="p-4 rounded-lg bg-accent/5 border border-accent/20">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="w-5 h-5 text-accent mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-text-primary mb-1">Network Type: {selectedType?.name}</h4>
                      <p className="text-sm text-text-muted">{selectedType?.description}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 3: Network Configuration */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-text-primary mb-2">Network Configuration</h3>
                  <p className="text-sm text-text-muted">
                    Configure IP addressing and DHCP settings for your network.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* VLAN ID - only for VLAN type */}
                  {formData.type === 'VLAN' && (
                    <div>
                      <label className="block text-sm font-medium text-text-secondary mb-2">
                        VLAN ID <span className="text-error">*</span>
                      </label>
                      <input
                        type="number"
                        value={formData.vlanId}
                        onChange={(e) => updateFormData({ vlanId: e.target.value })}
                        className={cn(
                          'form-input w-full',
                          errors.vlanId && 'border-error focus:border-error focus:ring-error/20'
                        )}
                        placeholder="100"
                        min="1"
                        max="4094"
                      />
                      {errors.vlanId ? (
                        <p className="mt-1.5 text-sm text-error flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {errors.vlanId}
                        </p>
                      ) : (
                        <p className="mt-1.5 text-xs text-text-muted">802.1Q VLAN tag (1-4094)</p>
                      )}
                    </div>
                  )}

                  {/* CIDR */}
                  <div className={formData.type !== 'VLAN' ? 'col-span-2' : ''}>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Network CIDR <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.cidr}
                      onChange={(e) => handleCIDRChange(e.target.value)}
                      className={cn(
                        'form-input w-full font-mono',
                        errors.cidr && 'border-error focus:border-error focus:ring-error/20'
                      )}
                      placeholder="10.0.100.0/24"
                    />
                    {errors.cidr ? (
                      <p className="mt-1.5 text-sm text-error flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {errors.cidr}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-text-muted">IP range in CIDR notation</p>
                    )}
                  </div>

                  {/* Gateway */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      Gateway <span className="text-error">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.gateway}
                      onChange={(e) => updateFormData({ gateway: e.target.value })}
                      className={cn(
                        'form-input w-full font-mono',
                        errors.gateway && 'border-error focus:border-error focus:ring-error/20'
                      )}
                      placeholder="10.0.100.1"
                    />
                    {errors.gateway ? (
                      <p className="mt-1.5 text-sm text-error flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {errors.gateway}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-text-muted">Default gateway IP address</p>
                    )}
                  </div>

                  {/* MTU */}
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-2">
                      MTU
                    </label>
                    <input
                      type="number"
                      value={formData.mtu}
                      onChange={(e) => updateFormData({ mtu: e.target.value })}
                      className="form-input w-full"
                      min="576"
                      max="9000"
                    />
                    <p className="mt-1.5 text-xs text-text-muted">Maximum transmission unit (576-9000)</p>
                  </div>
                </div>

                {/* DHCP Section */}
                <div className="p-4 rounded-lg bg-bg-base border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <Server className="w-5 h-5 text-accent" />
                      <div>
                        <h4 className="text-sm font-medium text-text-primary">DHCP Server</h4>
                        <p className="text-xs text-text-muted">Automatically assign IP addresses to VMs</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.dhcpEnabled}
                        onChange={(e) => updateFormData({ dhcpEnabled: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-bg-elevated rounded-full peer peer-checked:after:translate-x-full peer-checked:bg-accent after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
                    </label>
                  </div>

                  {formData.dhcpEnabled && (
                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          DHCP Range Start
                        </label>
                        <input
                          type="text"
                          value={formData.dhcpRangeStart}
                          onChange={(e) => updateFormData({ dhcpRangeStart: e.target.value })}
                          className={cn(
                            'form-input w-full font-mono',
                            errors.dhcpRangeStart && 'border-error'
                          )}
                          placeholder="10.0.100.100"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-2">
                          DHCP Range End
                        </label>
                        <input
                          type="text"
                          value={formData.dhcpRangeEnd}
                          onChange={(e) => updateFormData({ dhcpRangeEnd: e.target.value })}
                          className={cn(
                            'form-input w-full font-mono',
                            errors.dhcpRangeEnd && 'border-error'
                          )}
                          placeholder="10.0.100.200"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step 4: Review */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-text-primary mb-2">Review Configuration</h3>
                  <p className="text-sm text-text-muted">
                    Please review your network configuration before creating.
                  </p>
                </div>

                <div className="rounded-xl bg-bg-base border border-border overflow-hidden">
                  {/* Network Type Header */}
                  <div className="p-4 border-b border-border bg-bg-elevated/50">
                    <div className="flex items-center gap-3">
                      {selectedType && (
                        <div className={cn(
                          'p-2 rounded-lg',
                          selectedType.color === 'blue' && 'bg-blue-500/10 text-blue-400',
                          selectedType.color === 'purple' && 'bg-purple-500/10 text-purple-400',
                          selectedType.color === 'green' && 'bg-green-500/10 text-green-400',
                        )}>
                          <selectedType.icon className="w-5 h-5" />
                        </div>
                      )}
                      <div>
                        <h4 className="font-medium text-text-primary">{formData.name}</h4>
                        <p className="text-sm text-text-muted">{selectedType?.name}</p>
                      </div>
                    </div>
                  </div>

                  {/* Configuration Details */}
                  <div className="p-4 space-y-4">
                    {formData.description && (
                      <div>
                        <p className="text-xs text-text-muted mb-1">Description</p>
                        <p className="text-sm text-text-secondary">{formData.description}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      {formData.type === 'VLAN' && formData.vlanId && (
                        <ReviewItem label="VLAN ID" value={formData.vlanId} />
                      )}
                      <ReviewItem label="CIDR" value={formData.cidr} mono />
                      <ReviewItem label="Gateway" value={formData.gateway} mono />
                      <ReviewItem label="MTU" value={formData.mtu} />
                      <ReviewItem 
                        label="DHCP" 
                        value={formData.dhcpEnabled ? 'Enabled' : 'Disabled'} 
                        highlight={formData.dhcpEnabled}
                      />
                      {formData.dhcpEnabled && formData.dhcpRangeStart && (
                        <ReviewItem 
                          label="DHCP Range" 
                          value={`${formData.dhcpRangeStart} - ${formData.dhcpRangeEnd}`} 
                          mono 
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Confirmation */}
                <div className="p-4 rounded-lg bg-success/5 border border-success/20">
                  <div className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-success mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-text-primary mb-1">Ready to Create</h4>
                      <p className="text-sm text-text-muted">
                        Click "Create Network" to provision this network. VMs can be connected to this network immediately after creation.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-base">
          <Button
            variant="ghost"
            onClick={step === 1 ? handleClose : handleBack}
            disabled={isSubmitting}
          >
            <ChevronLeft className="w-4 h-4" />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>

          <div className="flex items-center gap-3">
            {step < STEPS.length ? (
              <Button onClick={handleNext}>
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Create Network
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ReviewItem({ 
  label, 
  value, 
  mono = false,
  highlight = false 
}: { 
  label: string; 
  value: string; 
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="p-3 rounded-lg bg-bg-surface">
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className={cn(
        'text-sm font-medium',
        mono && 'font-mono',
        highlight ? 'text-success' : 'text-text-primary'
      )}>
        {value}
      </p>
    </div>
  );
}
