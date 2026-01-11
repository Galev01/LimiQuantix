import { useState, type ChangeEvent } from 'react';
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
} from 'lucide-react';
import { Card, Button, Input, Label, Badge } from '@/components/ui';
import { useCreateVM } from '@/hooks/useVMs';
import { useImages, formatImageSize, getDefaultUser, type CloudImage } from '@/hooks/useImages';
import { cn, formatBytes } from '@/lib/utils';
import type { CreateVmRequest, DiskSpec, NicSpec, CloudInitSpec } from '@/api/types';

interface CreateVMWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'basics' | 'boot-media' | 'compute' | 'storage' | 'network' | 'cloud-init' | 'review';

const steps: { id: Step; title: string; icon: React.ReactNode }[] = [
  { id: 'basics', title: 'Basics', icon: <Server className="w-4 h-4" /> },
  { id: 'boot-media', title: 'Boot Media', icon: <Disc className="w-4 h-4" /> },
  { id: 'compute', title: 'Compute', icon: <Cpu className="w-4 h-4" /> },
  { id: 'storage', title: 'Storage', icon: <HardDrive className="w-4 h-4" /> },
  { id: 'network', title: 'Network', icon: <Network className="w-4 h-4" /> },
  { id: 'cloud-init', title: 'Cloud-Init', icon: <Cloud className="w-4 h-4" /> },
  { id: 'review', title: 'Review', icon: <Check className="w-4 h-4" /> },
];

export function CreateVMWizard({ isOpen, onClose }: CreateVMWizardProps) {
  const navigate = useNavigate();
  const createVMMutation = useCreateVM();
  const { images: cloudImages, isLoading: imagesLoading, isUsingCatalog } = useImages();
  const [currentStep, setCurrentStep] = useState<Step>('basics');

  // Form state
  const [vmName, setVmName] = useState('');
  const [cpuCores, setCpuCores] = useState(2);
  const [memoryMib, setMemoryMib] = useState(2048);
  const [disks, setDisks] = useState<DiskSpec[]>([
    { id: 'disk0', sizeGib: 20, bus: 'virtio', format: 'qcow2', bootable: true },
  ]);
  const [nics, setNics] = useState<NicSpec[]>([
    { id: 'nic0', bridge: 'br0', model: 'virtio' },
  ]);
  const [cloudInit, setCloudInit] = useState<CloudInitSpec>({
    userData: '',
    metaData: '',
    networkConfig: '',
  });
  const [useCloudInit, setUseCloudInit] = useState(false);

  // Boot media state
  const [bootMediaType, setBootMediaType] = useState<'none' | 'cloud-image' | 'iso'>('cloud-image');
  const [selectedCloudImageId, setSelectedCloudImageId] = useState<string>('');
  const [selectedIsoPath, setSelectedIsoPath] = useState<string>('');

  // Get selected cloud image details
  const selectedCloudImage = cloudImages.find((img: CloudImage) => img.id === selectedCloudImageId);

  const currentStepIndex = steps.findIndex(s => s.id === currentStep);

  const goNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex].id);
    }
  };

  const goBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex].id);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 'basics':
        return vmName.trim().length >= 1;
      case 'boot-media':
        // Boot media is optional (can use 'none' for blank VM)
        return true;
      case 'compute':
        return cpuCores >= 1 && memoryMib >= 256;
      case 'storage':
        return disks.length > 0 && disks.every(d => d.sizeGib >= 1);
      case 'network':
        return true; // Network is optional
      case 'cloud-init':
        return true; // Cloud-init is optional
      case 'review':
        return true;
      default:
        return true;
    }
  };

  const handleCreate = async () => {
    // Prepare disks with backing file if cloud image selected
    const preparedDisks = disks.map((disk, index) => {
      // First disk gets the cloud image backing file
      if (index === 0 && bootMediaType === 'cloud-image' && selectedCloudImage) {
        return {
          ...disk,
          backingFile: selectedCloudImage.path,
        };
      }
      return disk;
    });

    const request: CreateVmRequest = {
      name: vmName,
      cpuCores,
      memoryMib,
      disks: preparedDisks,
      nics,
      cloudInit: useCloudInit ? cloudInit : undefined,
    };

    createVMMutation.mutate(request, {
      onSuccess: (result) => {
        onClose();
        navigate(`/vms/${result.vmId}`);
      },
    });
  };

  const addDisk = () => {
    const newId = `disk${disks.length}`;
    setDisks([...disks, { id: newId, sizeGib: 20, bus: 'virtio', format: 'qcow2' }]);
  };

  const removeDisk = (id: string) => {
    if (disks.length > 1) {
      setDisks(disks.filter(d => d.id !== id));
    }
  };

  const updateDisk = (id: string, updates: Partial<DiskSpec>) => {
    setDisks(disks.map(d => d.id === id ? { ...d, ...updates } : d));
  };

  const addNic = () => {
    const newId = `nic${nics.length}`;
    setNics([...nics, { id: newId, bridge: 'br0', model: 'virtio' }]);
  };

  const removeNic = (id: string) => {
    setNics(nics.filter(n => n.id !== id));
  };

  const updateNic = (id: string, updates: Partial<NicSpec>) => {
    setNics(nics.map(n => n.id === id ? { ...n, ...updates } : n));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-surface rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Create Virtual Machine</h2>
            <p className="text-sm text-text-muted mt-1">Configure your new VM step by step</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-hover rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-border bg-bg-base/50">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(step.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    currentStep === step.id
                      ? 'bg-accent text-white'
                      : index < currentStepIndex
                      ? 'bg-success/20 text-success'
                      : 'bg-bg-surface text-text-muted'
                  )}
                >
                  {index < currentStepIndex ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    step.icon
                  )}
                  <span className="hidden sm:inline">{step.title}</span>
                </button>
                {index < steps.length - 1 && (
                  <div className={cn(
                    'w-8 h-0.5 mx-2',
                    index < currentStepIndex ? 'bg-success' : 'bg-border'
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Basics Step */}
          {currentStep === 'basics' && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="vmName">Virtual Machine Name *</Label>
                <Input
                  id="vmName"
                  value={vmName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setVmName(e.target.value)}
                  placeholder="e.g., web-server-01"
                  className="mt-2"
                />
                <p className="text-xs text-text-muted mt-2">
                  Choose a descriptive name for your virtual machine
                </p>
              </div>
            </div>
          )}

          {/* Boot Media Step */}
          {currentStep === 'boot-media' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-4">Boot Media</h3>
                <p className="text-sm text-text-muted mb-6">
                  Select how to provision your virtual machine
                </p>

                {/* Boot Media Type Selection */}
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { id: 'cloud-image', label: 'Cloud Image', desc: 'Pre-built OS image with cloud-init', icon: <Cloud className="w-5 h-5" /> },
                    { id: 'iso', label: 'ISO Image', desc: 'Boot from CD/DVD installer', icon: <Disc className="w-5 h-5" /> },
                    { id: 'none', label: 'Empty', desc: 'Blank disk (PXE boot)', icon: <HardDrive className="w-5 h-5" /> },
                  ].map(option => (
                    <button
                      key={option.id}
                      onClick={() => setBootMediaType(option.id as 'none' | 'cloud-image' | 'iso')}
                      className={cn(
                        'flex flex-col items-center p-4 rounded-lg border-2 transition-all',
                        bootMediaType === option.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-accent/50'
                      )}
                    >
                      <div className={cn(
                        'p-3 rounded-full mb-2',
                        bootMediaType === option.id ? 'bg-accent text-white' : 'bg-bg-base text-text-muted'
                      )}>
                        {option.icon}
                      </div>
                      <span className="font-medium text-text-primary">{option.label}</span>
                      <span className="text-xs text-text-muted text-center mt-1">{option.desc}</span>
                    </button>
                  ))}
                </div>

                {/* Cloud Image Selection */}
                {bootMediaType === 'cloud-image' && (
                  <div className="space-y-4">
                    <Label>Select Cloud Image</Label>
                    {imagesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-accent" />
                        <span className="ml-2 text-text-muted">Loading images...</span>
                      </div>
                    ) : (
                      <div className="grid gap-3 max-h-64 overflow-y-auto">
                        {cloudImages.map((image: CloudImage) => (
                          <button
                            key={image.id}
                            onClick={() => {
                              setSelectedCloudImageId(image.id);
                              // Auto-enable cloud-init and set default user
                              setUseCloudInit(true);
                            }}
                            className={cn(
                              'flex items-center gap-4 p-3 rounded-lg border transition-all text-left',
                              selectedCloudImageId === image.id
                                ? 'border-accent bg-accent/10'
                                : 'border-border hover:border-accent/50'
                            )}
                          >
                            <div className={cn(
                              'p-2 rounded-lg',
                              selectedCloudImageId === image.id ? 'bg-accent text-white' : 'bg-bg-base text-text-muted'
                            )}>
                              <Cloud className="w-5 h-5" />
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-text-primary">{image.name}</p>
                              <p className="text-xs text-text-muted">
                                {formatImageSize(image.size)} • Default user: {image.defaultUser || getDefaultUser(image.os)}
                              </p>
                            </div>
                            {selectedCloudImageId === image.id && (
                              <Check className="w-5 h-5 text-accent" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                    {isUsingCatalog && (
                      <p className="text-xs text-warning mt-2">
                        Using image catalog. Some images may not be available on this host.
                      </p>
                    )}
                  </div>
                )}

                {/* ISO Selection */}
                {bootMediaType === 'iso' && (
                  <div className="space-y-4">
                    <Label htmlFor="isoPath">ISO Image Path</Label>
                    <Input
                      id="isoPath"
                      value={selectedIsoPath}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedIsoPath(e.target.value)}
                      placeholder="/var/lib/libvirt/images/ubuntu-22.04-server.iso"
                      className="font-mono"
                    />
                    <p className="text-xs text-text-muted">
                      Enter the full path to the ISO file on this host
                    </p>
                  </div>
                )}

                {/* Empty Disk Info */}
                {bootMediaType === 'none' && (
                  <div className="p-4 bg-bg-base rounded-lg border border-border">
                    <p className="text-sm text-text-secondary">
                      The VM will be created with an empty disk. You can use PXE boot or attach an ISO later to install an operating system.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Compute Step */}
          {currentStep === 'compute' && (
            <div className="space-y-6">
              <div>
                <Label htmlFor="cpuCores">CPU Cores</Label>
                <div className="flex items-center gap-4 mt-2">
                  <Input
                    id="cpuCores"
                    type="number"
                    min={1}
                    max={64}
                    value={cpuCores}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCpuCores(parseInt(e.target.value) || 1)}
                    className="w-32"
                  />
                  <div className="flex gap-2">
                    {[1, 2, 4, 8, 16].map(n => (
                      <button
                        key={n}
                        onClick={() => setCpuCores(n)}
                        className={cn(
                          'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                          cpuCores === n
                            ? 'bg-accent text-white'
                            : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="memory">Memory (MiB)</Label>
                <div className="flex items-center gap-4 mt-2">
                  <Input
                    id="memory"
                    type="number"
                    min={256}
                    step={256}
                    value={memoryMib}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setMemoryMib(parseInt(e.target.value) || 256)}
                    className="w-32"
                  />
                  <div className="flex gap-2 flex-wrap">
                    {[512, 1024, 2048, 4096, 8192, 16384].map(n => (
                      <button
                        key={n}
                        onClick={() => setMemoryMib(n)}
                        className={cn(
                          'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                          memoryMib === n
                            ? 'bg-accent text-white'
                            : 'bg-bg-base text-text-secondary hover:bg-bg-hover'
                        )}
                      >
                        {formatBytes(n * 1024 * 1024)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Storage Step */}
          {currentStep === 'storage' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-text-primary">Disks</h3>
                <Button size="sm" variant="secondary" onClick={addDisk}>
                  Add Disk
                </Button>
              </div>

              <div className="space-y-4">
                {disks.map((disk, index) => (
                  <Card key={disk.id} className="p-4">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-5 h-5 text-accent" />
                        <span className="font-medium text-text-primary">Disk {index + 1}</span>
                        {disk.bootable && <Badge variant="info">Boot</Badge>}
                      </div>
                      {disks.length > 1 && (
                        <button
                          onClick={() => removeDisk(disk.id)}
                          className="text-error hover:text-error/80"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div>
                        <Label>Size (GiB)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={disk.sizeGib}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => updateDisk(disk.id, { sizeGib: parseInt(e.target.value) || 1 })}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label>Bus</Label>
                        <select
                          value={disk.bus}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateDisk(disk.id, { bus: e.target.value as DiskSpec['bus'] })}
                          className="w-full mt-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary"
                        >
                          <option value="virtio">VirtIO</option>
                          <option value="scsi">SCSI</option>
                          <option value="sata">SATA</option>
                          <option value="ide">IDE</option>
                        </select>
                      </div>
                      <div>
                        <Label>Format</Label>
                        <select
                          value={disk.format}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) => updateDisk(disk.id, { format: e.target.value as DiskSpec['format'] })}
                          className="w-full mt-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary"
                        >
                          <option value="qcow2">QCOW2</option>
                          <option value="raw">Raw</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={disk.bootable}
                            onChange={(e) => updateDisk(disk.id, { bootable: e.target.checked })}
                            className="w-4 h-4 rounded border-border"
                          />
                          <span className="text-sm text-text-secondary">Bootable</span>
                        </label>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Network Step */}
          {currentStep === 'network' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-text-primary">Network Interfaces</h3>
                <Button size="sm" variant="secondary" onClick={addNic}>
                  Add NIC
                </Button>
              </div>

              {nics.length === 0 ? (
                <Card className="text-center py-8 text-text-muted">
                  <Network className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No network interfaces configured</p>
                  <p className="text-sm mt-1">Click "Add NIC" to add a network interface</p>
                </Card>
              ) : (
                <div className="space-y-4">
                  {nics.map((nic, index) => (
                    <Card key={nic.id} className="p-4">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Network className="w-5 h-5 text-success" />
                          <span className="font-medium text-text-primary">NIC {index + 1}</span>
                        </div>
                        <button
                          onClick={() => removeNic(nic.id)}
                          className="text-error hover:text-error/80"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <Label>Bridge</Label>
                          <Input
                            value={nic.bridge || ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateNic(nic.id, { bridge: e.target.value })}
                            placeholder="br0"
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label>Model</Label>
                          <select
                            value={nic.model}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => updateNic(nic.id, { model: e.target.value as NicSpec['model'] })}
                            className="w-full mt-1 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary"
                          >
                            <option value="virtio">VirtIO</option>
                            <option value="e1000">E1000</option>
                            <option value="rtl8139">RTL8139</option>
                          </select>
                        </div>
                        <div>
                          <Label>MAC Address (optional)</Label>
                          <Input
                            value={nic.macAddress || ''}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => updateNic(nic.id, { macAddress: e.target.value })}
                            placeholder="Auto-generated"
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cloud-Init Step */}
          {currentStep === 'cloud-init' && (
            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useCloudInit}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setUseCloudInit(e.target.checked)}
                    className="w-4 h-4 rounded border-border"
                  />
                  <span className="text-text-primary font-medium">Enable Cloud-Init</span>
                </label>
              </div>

              {useCloudInit && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="userData">User Data (cloud-config)</Label>
                    <textarea
                      id="userData"
                      value={cloudInit.userData || ''}
                      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setCloudInit({ ...cloudInit, userData: e.target.value })}
                      placeholder={`#cloud-config
users:
  - name: admin
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-rsa AAAA...`}
                      className="w-full mt-2 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary font-mono text-sm h-48 resize-y"
                    />
                  </div>
                  <div>
                    <Label htmlFor="metaData">Meta Data (optional)</Label>
                    <textarea
                      id="metaData"
                      value={cloudInit.metaData || ''}
                      onChange={(e) => setCloudInit({ ...cloudInit, metaData: e.target.value })}
                      placeholder={`instance-id: my-instance
local-hostname: my-vm`}
                      className="w-full mt-2 px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary font-mono text-sm h-24 resize-y"
                    />
                  </div>
                </div>
              )}

              {!useCloudInit && (
                <Card className="text-center py-8 text-text-muted">
                  <Cloud className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Cloud-Init is disabled</p>
                  <p className="text-sm mt-1">Enable it to configure the VM on first boot</p>
                </Card>
              )}
            </div>
          )}

          {/* Review Step */}
          {currentStep === 'review' && (
            <div className="space-y-6">
              <Card>
                <h3 className="text-lg font-semibold text-text-primary mb-4">VM Configuration Summary</h3>
                <div className="space-y-4">
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-text-muted">Name</span>
                    <span className="text-text-primary font-medium">{vmName}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-text-muted">CPU Cores</span>
                    <span className="text-text-primary font-medium">{cpuCores}</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className="text-text-muted">Memory</span>
                    <span className="text-text-primary font-medium">{formatBytes(memoryMib * 1024 * 1024)}</span>
                  </div>
                  <div className="py-2 border-b border-border">
                    <span className="text-text-muted">Disks</span>
                    <div className="mt-2 space-y-1">
                      {disks.map((disk, i) => (
                        <div key={disk.id} className="flex justify-between text-sm">
                          <span className="text-text-secondary">Disk {i + 1}</span>
                          <span className="text-text-primary">
                            {disk.sizeGib} GiB ({disk.format}, {disk.bus})
                            {disk.bootable && ' [Boot]'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="py-2 border-b border-border">
                    <span className="text-text-muted">Network</span>
                    <div className="mt-2 space-y-1">
                      {nics.length === 0 ? (
                        <span className="text-text-secondary text-sm">No network interfaces</span>
                      ) : (
                        nics.map((nic, i) => (
                          <div key={nic.id} className="flex justify-between text-sm">
                            <span className="text-text-secondary">NIC {i + 1}</span>
                            <span className="text-text-primary">
                              {nic.bridge || 'default'} ({nic.model})
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-text-muted">Cloud-Init</span>
                    <Badge variant={useCloudInit ? 'success' : 'default'}>
                      {useCloudInit ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={currentStepIndex === 0}
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {currentStep === 'review' ? (
              <Button
                onClick={handleCreate}
                disabled={createVMMutation.isPending}
              >
                {createVMMutation.isPending ? 'Creating...' : 'Create VM'}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={!canProceed()}>
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
