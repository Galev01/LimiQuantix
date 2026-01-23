/**
 * EditAdvancedOptionsModal - Edit VM Advanced Options
 * 
 * Allows editing hardware version, machine type, RTC, watchdog, and RNG settings.
 * Only editable when VM is stopped.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, Loader2, AlertTriangle, Info, Power } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { type ApiVM } from '@/hooks/useVMs';
import { type PowerState } from '@/types/models';

interface EditAdvancedOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vm: ApiVM;
  vmState: PowerState;
  onSave: (options: AdvancedOptions) => Promise<void>;
}

interface AdvancedOptions {
  hardwareVersion: string;
  machineType: string;
  rtcBase: string;
  watchdog: string;
  rngEnabled: boolean;
}

const hardwareVersions = [
  { value: 'v5', label: 'v5', description: 'Legacy compatibility' },
  { value: 'v6', label: 'v6', description: 'Recommended (default)' },
  { value: 'v7', label: 'v7', description: 'Latest features' },
];

const machineTypes = [
  { value: 'q35', label: 'Q35', description: 'Modern chipset with PCIe support (recommended)' },
  { value: 'i440fx', label: 'i440FX', description: 'Legacy chipset for older OS' },
  { value: 'virt', label: 'Virt', description: 'Minimal virtual machine (ARM/RISC-V)' },
];

const rtcBases = [
  { value: 'utc', label: 'UTC', description: 'Coordinated Universal Time (recommended)' },
  { value: 'localtime', label: 'Local Time', description: 'Host local time (for Windows)' },
];

const watchdogTypes = [
  { value: 'none', label: 'None', description: 'No watchdog device' },
  { value: 'i6300esb', label: 'i6300esb', description: 'Intel 6300ESB watchdog (recommended)' },
  { value: 'ib700', label: 'iB700', description: 'iBase 700 watchdog' },
  { value: 'diag288', label: 'diag288', description: 'S390 DIAG288 watchdog' },
];

export function EditAdvancedOptionsModal({ isOpen, onClose, vm, vmState, onSave }: EditAdvancedOptionsModalProps) {
  const [hardwareVersion, setHardwareVersion] = useState('v6');
  const [machineType, setMachineType] = useState('q35');
  const [rtcBase, setRtcBase] = useState('utc');
  const [watchdog, setWatchdog] = useState('i6300esb');
  const [rngEnabled, setRngEnabled] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const isVMStopped = vmState === 'STOPPED';

  // Initialize from VM data
  useEffect(() => {
    if (vm.spec?.advanced) {
      setHardwareVersion(vm.spec.advanced.hardwareVersion || 'v6');
      setMachineType(vm.spec.advanced.machineType || 'q35');
      setRtcBase(vm.spec.advanced.rtcBase || 'utc');
      setWatchdog(vm.spec.advanced.watchdog || 'i6300esb');
      setRngEnabled(vm.spec.advanced.rngEnabled !== false);
    }
  }, [vm]);

  const handleSave = async () => {
    if (!isVMStopped) return;
    
    setIsSaving(true);
    try {
      await onSave({
        hardwareVersion,
        machineType,
        rtcBase,
        watchdog,
        rngEnabled,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="bg-bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-bg-surface">
            <div className="flex items-center gap-3">
              <Settings className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-semibold text-text-primary">Advanced Options</h2>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* VM Running Warning */}
            {!isVMStopped && (
              <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                <Power className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-warning">VM Must Be Stopped</p>
                  <p className="text-text-muted mt-1">
                    Advanced options can only be modified when the VM is powered off.
                    Stop the VM to make changes.
                  </p>
                </div>
              </div>
            )}

            {/* Hardware Version */}
            <div className={cn(!isVMStopped && 'opacity-50 pointer-events-none')}>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Hardware Version
              </label>
              <div className="grid grid-cols-3 gap-2">
                {hardwareVersions.map((version) => (
                  <button
                    key={version.value}
                    onClick={() => setHardwareVersion(version.value)}
                    disabled={!isVMStopped}
                    className={cn(
                      'p-3 border rounded-lg text-center transition-all',
                      hardwareVersion === version.value
                        ? 'bg-accent/10 border-accent'
                        : 'bg-bg-base border-border hover:border-text-muted'
                    )}
                  >
                    <div className="font-medium text-text-primary">{version.label}</div>
                    <div className="text-xs text-text-muted">{version.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Machine Type */}
            <div className={cn(!isVMStopped && 'opacity-50 pointer-events-none')}>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Machine Type
              </label>
              <select
                value={machineType}
                onChange={(e) => setMachineType(e.target.value)}
                disabled={!isVMStopped}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
              >
                {machineTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} - {type.description}
                  </option>
                ))}
              </select>
            </div>

            {/* RTC Base */}
            <div className={cn(!isVMStopped && 'opacity-50 pointer-events-none')}>
              <label className="block text-sm font-medium text-text-primary mb-2">
                RTC Base (Real-Time Clock)
              </label>
              <div className="grid grid-cols-2 gap-2">
                {rtcBases.map((rtc) => (
                  <button
                    key={rtc.value}
                    onClick={() => setRtcBase(rtc.value)}
                    disabled={!isVMStopped}
                    className={cn(
                      'p-3 border rounded-lg text-left transition-all',
                      rtcBase === rtc.value
                        ? 'bg-accent/10 border-accent'
                        : 'bg-bg-base border-border hover:border-text-muted'
                    )}
                  >
                    <div className="font-medium text-text-primary">{rtc.label}</div>
                    <div className="text-xs text-text-muted">{rtc.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Watchdog */}
            <div className={cn(!isVMStopped && 'opacity-50 pointer-events-none')}>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Watchdog Device
              </label>
              <select
                value={watchdog}
                onChange={(e) => setWatchdog(e.target.value)}
                disabled={!isVMStopped}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
              >
                {watchdogTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} - {type.description}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted mt-1">
                Watchdog resets the VM if the guest OS becomes unresponsive.
              </p>
            </div>

            {/* RNG Device */}
            <div className={cn(!isVMStopped && 'opacity-50 pointer-events-none')}>
              <Toggle
                enabled={rngEnabled}
                onChange={setRngEnabled}
                disabled={!isVMStopped}
                label="Random Number Generator (virtio-rng)"
                description="Provides high-quality random numbers to the guest OS"
              />
            </div>

            {/* Info box */}
            <div className="flex items-start gap-3 p-4 bg-accent/10 rounded-lg border border-accent/30">
              <Info className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
              <div className="text-xs text-text-secondary">
                <p className="font-medium text-text-primary mb-1">About Advanced Options</p>
                <p>
                  These settings affect low-level VM hardware emulation. Changing them may affect 
                  OS compatibility. The defaults are suitable for most modern operating systems.
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border sticky bottom-0 bg-bg-surface">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button 
              variant="primary" 
              onClick={handleSave} 
              disabled={isSaving || !isVMStopped}
            >
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {isVMStopped ? 'Save Changes' : 'Stop VM to Edit'}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
