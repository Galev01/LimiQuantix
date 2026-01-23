/**
 * CDROMModal - Manage CD-ROM devices for a VM
 * 
 * Allows:
 * - Adding a new CD-ROM device
 * - Mounting ISO images to CD-ROM
 * - Ejecting ISO from CD-ROM
 * - Removing CD-ROM device
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Disc, Loader2, Search, Eject, Plus, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useImages, ISO_CATALOG, formatImageSize, type CloudImage, type ISOImage } from '@/hooks/useImages';

interface CDROMModalProps {
  isOpen: boolean;
  onClose: () => void;
  vmId: string;
  vmName: string;
  vmState: string;
  currentCDROMs: CDROMDevice[];
  onAttachCDROM: () => Promise<void>;
  onDetachCDROM: (cdromId: string) => Promise<void>;
  onMountISO: (cdromId: string, isoPath: string) => Promise<void>;
  onEjectISO: (cdromId: string) => Promise<void>;
  isPending?: boolean;
}

export interface CDROMDevice {
  id: string;
  name: string;
  mountedIso?: string;
  isoName?: string;
}

export function CDROMModal({
  isOpen,
  onClose,
  vmId,
  vmName,
  vmState,
  currentCDROMs,
  onAttachCDROM,
  onDetachCDROM,
  onMountISO,
  onEjectISO,
  isPending = false,
}: CDROMModalProps) {
  const [activeTab, setActiveTab] = useState<'manage' | 'mount'>('manage');
  const [selectedCDROM, setSelectedCDROM] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedISO, setSelectedISO] = useState<string | null>(null);

  // Fetch available ISO images
  const { data: apiImages, isLoading: isLoadingImages } = useImages();

  // Get ISO images from API or fallback to catalog
  const isoImages = useMemo(() => {
    if (apiImages && apiImages.length > 0) {
      return apiImages.filter(img => !img.os.cloudInitEnabled && img.os.provisioningMethod !== 'CLOUD_INIT');
    }
    return ISO_CATALOG;
  }, [apiImages]);

  // Filter ISOs by search
  const filteredISOs = useMemo(() => {
    if (!searchQuery.trim()) return isoImages;
    const query = searchQuery.toLowerCase();
    return isoImages.filter(iso => 
      iso.name.toLowerCase().includes(query) ||
      iso.os.distribution.toLowerCase().includes(query)
    );
  }, [isoImages, searchQuery]);

  const isVMRunning = vmState === 'RUNNING';

  const handleMountISO = async () => {
    if (!selectedCDROM || !selectedISO) return;
    const iso = isoImages.find(i => i.id === selectedISO);
    if (!iso) return;
    
    // Use path if available, otherwise construct from id
    const isoPath = iso.path || `/var/lib/limiquantix/isos/${iso.id}.iso`;
    await onMountISO(selectedCDROM, isoPath);
    setSelectedISO(null);
    setActiveTab('manage');
  };

  const handleEject = async (cdromId: string) => {
    await onEjectISO(cdromId);
  };

  const handleDetach = async (cdromId: string) => {
    if (!confirm('Are you sure you want to remove this CD-ROM device?')) return;
    await onDetachCDROM(cdromId);
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
          className="bg-bg-surface border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Disc className="w-5 h-5 text-accent" />
              <div>
                <h2 className="text-lg font-semibold text-text-primary">CD-ROM Management</h2>
                <p className="text-sm text-text-muted">{vmName}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('manage')}
              className={cn(
                'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === 'manage'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              Manage CD-ROMs
            </button>
            <button
              onClick={() => setActiveTab('mount')}
              className={cn(
                'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                activeTab === 'mount'
                  ? 'text-accent border-b-2 border-accent'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              Mount ISO
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === 'manage' ? (
              <div className="space-y-4">
                {/* Add CD-ROM Button */}
                <Button
                  variant="secondary"
                  onClick={onAttachCDROM}
                  disabled={isPending}
                  className="w-full"
                >
                  <Plus className="w-4 h-4" />
                  Add CD-ROM Device
                </Button>

                {/* CD-ROM List */}
                {currentCDROMs.length === 0 ? (
                  <div className="text-center py-8">
                    <Disc className="w-12 h-12 text-text-muted mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-text-primary mb-2">No CD-ROM Devices</h4>
                    <p className="text-sm text-text-muted">
                      Add a CD-ROM device to mount ISO images.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currentCDROMs.map((cdrom) => (
                      <div
                        key={cdrom.id}
                        className="p-4 bg-bg-base rounded-lg border border-border"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Disc className={cn(
                              'w-5 h-5',
                              cdrom.mountedIso ? 'text-accent' : 'text-text-muted'
                            )} />
                            <div>
                              <div className="font-medium text-text-primary">{cdrom.name}</div>
                              {cdrom.mountedIso ? (
                                <div className="flex items-center gap-2 mt-1">
                                  <CheckCircle className="w-3 h-3 text-success" />
                                  <span className="text-xs text-text-secondary">
                                    {cdrom.isoName || cdrom.mountedIso}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-text-muted">Empty</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {cdrom.mountedIso ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEject(cdrom.id)}
                                disabled={isPending}
                                title="Eject ISO"
                              >
                                <Eject className="w-4 h-4" />
                                Eject
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedCDROM(cdrom.id);
                                  setActiveTab('mount');
                                }}
                                disabled={isPending}
                              >
                                <Disc className="w-4 h-4" />
                                Mount
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDetach(cdrom.id)}
                              disabled={isPending || (cdrom.mountedIso && isVMRunning)}
                              title={cdrom.mountedIso && isVMRunning ? 'Eject ISO first' : 'Remove CD-ROM'}
                              className="text-error hover:text-error"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Hot-plug warning */}
                {isVMRunning && (
                  <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                    <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-text-secondary">
                      <p className="font-medium text-warning">VM is Running</p>
                      <p>
                        CD-ROM operations are supported while the VM is running (hot-plug).
                        Some guest operating systems may require a rescan to detect changes.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Mount ISO Tab */
              <div className="space-y-4">
                {/* Select CD-ROM */}
                {currentCDROMs.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Select CD-ROM Device
                    </label>
                    <select
                      value={selectedCDROM || ''}
                      onChange={(e) => setSelectedCDROM(e.target.value)}
                      className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <option value="">Select a CD-ROM...</option>
                      {currentCDROMs.filter(c => !c.mountedIso).map((cdrom) => (
                        <option key={cdrom.id} value={cdrom.id}>
                          {cdrom.name} (Empty)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search ISO images..."
                    className="w-full pl-10 pr-4 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>

                {/* ISO List */}
                {isLoadingImages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  </div>
                ) : filteredISOs.length === 0 ? (
                  <div className="text-center py-8">
                    <Disc className="w-12 h-12 text-text-muted mx-auto mb-4" />
                    <h4 className="text-lg font-medium text-text-primary mb-2">No ISO Images</h4>
                    <p className="text-sm text-text-muted">
                      Upload ISO images from the Images page.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {filteredISOs.map((iso) => (
                      <button
                        key={iso.id}
                        onClick={() => setSelectedISO(iso.id)}
                        className={cn(
                          'w-full p-3 rounded-lg border text-left transition-all',
                          selectedISO === iso.id
                            ? 'bg-accent/10 border-accent'
                            : 'bg-bg-base border-border hover:border-text-muted'
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Disc className={cn(
                            'w-5 h-5',
                            selectedISO === iso.id ? 'text-accent' : 'text-text-muted'
                          )} />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-text-primary truncate">{iso.name}</div>
                            <div className="flex items-center gap-2 text-xs text-text-muted">
                              <span>{formatImageSize(iso.sizeBytes)}</span>
                              <span>•</span>
                              <span className="capitalize">{iso.os.distribution} {iso.os.version}</span>
                            </div>
                          </div>
                          <Badge variant={iso.status === 'ready' ? 'success' : 'default'} size="sm">
                            {iso.status}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* No CD-ROM warning */}
                {currentCDROMs.length === 0 && (
                  <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                    <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-text-secondary">
                      <p className="font-medium text-warning">No CD-ROM Device</p>
                      <p>
                        Add a CD-ROM device first before mounting an ISO image.
                      </p>
                    </div>
                  </div>
                )}

                {/* All CD-ROMs have ISOs mounted */}
                {currentCDROMs.length > 0 && currentCDROMs.every(c => c.mountedIso) && (
                  <div className="flex items-start gap-3 p-4 bg-accent/10 rounded-lg border border-accent/30">
                    <Disc className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-text-secondary">
                      <p className="font-medium text-accent">All CD-ROMs In Use</p>
                      <p>
                        All CD-ROM devices have ISOs mounted. Eject an ISO or add another CD-ROM device.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {activeTab === 'mount' && (
              <Button
                variant="primary"
                onClick={handleMountISO}
                disabled={isPending || !selectedCDROM || !selectedISO}
              >
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                <Disc className="w-4 h-4" />
                Mount ISO
              </Button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
