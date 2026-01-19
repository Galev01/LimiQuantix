/**
 * EditBootOptionsModal - Edit VM boot configuration
 * 
 * Allows editing boot order, firmware type, and secure boot settings.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, GripVertical, HardDrive, Disc, Network, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { type ApiVM } from '@/hooks/useVMs';

interface EditBootOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vm: ApiVM;
  onSave: (options: BootOptions) => Promise<void>;
}

interface BootOptions {
  bootOrder: string[];
  firmware: 'BIOS' | 'UEFI';
  secureBoot: boolean;
}

const bootDevices = [
  { id: 'disk', label: 'Hard Disk', icon: HardDrive, description: 'Boot from primary hard disk' },
  { id: 'cdrom', label: 'CD-ROM', icon: Disc, description: 'Boot from CD/DVD drive' },
  { id: 'network', label: 'Network (PXE)', icon: Network, description: 'Boot from network via PXE' },
];

export function EditBootOptionsModal({ isOpen, onClose, vm, onSave }: EditBootOptionsModalProps) {
  const [bootOrder, setBootOrder] = useState<string[]>(['disk', 'cdrom', 'network']);
  const [firmware, setFirmware] = useState<'BIOS' | 'UEFI'>('UEFI');
  const [secureBoot, setSecureBoot] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  // Initialize from VM data
  useEffect(() => {
    if (vm.spec?.boot) {
      setBootOrder(vm.spec.boot.order || ['disk', 'cdrom', 'network']);
      setFirmware((vm.spec.boot.firmware as 'BIOS' | 'UEFI') || 'UEFI');
      setSecureBoot(vm.spec.boot.secureBoot || false);
    }
  }, [vm]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedItem(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    const newOrder = [...bootOrder];
    const draggedIndex = newOrder.indexOf(draggedItem);
    const targetIndex = newOrder.indexOf(targetId);

    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);

    setBootOrder(newOrder);
    setDraggedItem(null);
  };

  const moveItem = (id: string, direction: 'up' | 'down') => {
    const index = bootOrder.indexOf(id);
    if (direction === 'up' && index > 0) {
      const newOrder = [...bootOrder];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      setBootOrder(newOrder);
    } else if (direction === 'down' && index < bootOrder.length - 1) {
      const newOrder = [...bootOrder];
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      setBootOrder(newOrder);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({ bootOrder, firmware, secureBoot });
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
          className="bg-bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">Boot Options</h2>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {/* Boot Order */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Boot Order
              </label>
              <p className="text-xs text-text-muted mb-3">
                Drag to reorder boot devices. The VM will try each device in order.
              </p>
              <div className="space-y-2">
                {bootOrder.map((deviceId, index) => {
                  const device = bootDevices.find((d) => d.id === deviceId);
                  if (!device) return null;
                  const Icon = device.icon;

                  return (
                    <div
                      key={deviceId}
                      draggable
                      onDragStart={(e) => handleDragStart(e, deviceId)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, deviceId)}
                      className={cn(
                        'flex items-center gap-3 p-3 bg-bg-base border border-border rounded-lg cursor-move transition-colors',
                        draggedItem === deviceId && 'opacity-50'
                      )}
                    >
                      <GripVertical className="w-4 h-4 text-text-muted" />
                      <span className="w-6 h-6 flex items-center justify-center bg-bg-elevated rounded text-xs font-bold text-text-secondary">
                        {index + 1}
                      </span>
                      <Icon className="w-4 h-4 text-text-secondary" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-text-primary">{device.label}</div>
                        <div className="text-xs text-text-muted">{device.description}</div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => moveItem(deviceId, 'up')}
                          disabled={index === 0}
                          className="text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                        >
                          ▲
                        </button>
                        <button
                          onClick={() => moveItem(deviceId, 'down')}
                          disabled={index === bootOrder.length - 1}
                          className="text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Firmware */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Firmware
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(['BIOS', 'UEFI'] as const).map((fw) => (
                  <button
                    key={fw}
                    onClick={() => {
                      setFirmware(fw);
                      if (fw === 'BIOS') setSecureBoot(false);
                    }}
                    className={cn(
                      'p-3 border rounded-lg text-left transition-all',
                      firmware === fw
                        ? 'bg-accent/10 border-accent text-text-primary'
                        : 'bg-bg-base border-border text-text-secondary hover:border-text-muted'
                    )}
                  >
                    <div className="font-medium">{fw}</div>
                    <div className="text-xs text-text-muted">
                      {fw === 'BIOS' ? 'Legacy BIOS mode' : 'Modern UEFI firmware'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Secure Boot (UEFI only) */}
            {firmware === 'UEFI' && (
              <div>
                <label className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-text-primary">Secure Boot</span>
                    <p className="text-xs text-text-muted">
                      Only boot signed operating system loaders
                    </p>
                  </div>
                  <button
                    onClick={() => setSecureBoot(!secureBoot)}
                    className={cn(
                      'w-12 h-6 rounded-full transition-colors relative',
                      secureBoot ? 'bg-accent' : 'bg-bg-base border border-border'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                        secureBoot ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </button>
                </label>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
