import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cloud,
  Disc,
  Search,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  HardDrive,
  Trash2,
  Package,
  Cpu,
  MemoryStick,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  useImages,
  useDeleteImage,
  useScanISOs,
  CLOUD_IMAGE_CATALOG,
  ISO_CATALOG,
  formatImageSize,
  type CloudImage,
  type ISOImage,
} from '@/hooks/useImages';
import { useOVATemplates, useDeleteOVATemplate, formatOVASize } from '@/hooks/useOVA';
import { toast } from 'sonner';

type ImageCategory = 'all' | 'cloud-images' | 'isos' | 'ova-templates';

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'default'; icon: typeof CheckCircle }> = {
  ready: { label: 'Ready', variant: 'success', icon: CheckCircle },
  downloading: { label: 'Downloading', variant: 'warning', icon: Loader2 },
  pending: { label: 'Pending', variant: 'default', icon: Loader2 },
  error: { label: 'Error', variant: 'error', icon: AlertCircle },
  uploading: { label: 'Uploading', variant: 'warning', icon: Loader2 },
};

export function AllImagesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ImageCategory>('all');

  // Fetch images from API
  const { data: apiImages, isLoading, refetch } = useImages();
  const deleteImage = useDeleteImage();
  const scanISOs = useScanISOs();

  // Fetch OVA templates
  const { data: ovaTemplates, isLoading: ovaLoading, refetch: refetchOVA } = useOVATemplates();
  const deleteOVATemplate = useDeleteOVATemplate();

  // Combine API images with catalog (fallback)
  const cloudImages: CloudImage[] = useMemo(() => {
    if (apiImages && apiImages.length > 0) {
      // Cloud images are those that are not ISOs and not OVAs (basically QCOW2/RAW)
      // Or explicitly marked as cloud-init capable
      return apiImages.filter(img =>
        (img.spec.format !== 'ISO' && img.spec.format !== 'OVA') &&
        (img.os.cloudInitEnabled || img.os.provisioningMethod === 'CLOUD_INIT' || img.spec.format === 'QCOW2' || img.spec.format === 'RAW')
      );
    }
    return CLOUD_IMAGE_CATALOG;
  }, [apiImages]);

  const isoImages: (CloudImage | ISOImage)[] = useMemo(() => {
    if (apiImages && apiImages.length > 0) {
      return apiImages.filter(img => img.spec.format === 'ISO' || img.name.toLowerCase().endsWith('.iso'));
    }
    return ISO_CATALOG;
  }, [apiImages]);

  const isUsingCatalog = !apiImages || apiImages.length === 0;

  // Stats
  const stats = useMemo(() => {
    const totalCloud = cloudImages.length;
    const totalIso = isoImages.length;
    const totalOva = ovaTemplates?.length || 0;
    const totalStorage = [...cloudImages, ...isoImages].reduce((acc, img) => acc + img.sizeBytes, 0);
    const ovaStorage = ovaTemplates?.reduce((acc, t) => acc + Number(t.status?.virtualSizeBytes || 0), 0) || 0;

    return {
      total: totalCloud + totalIso + totalOva,
      cloud: totalCloud,
      iso: totalIso,
      ova: totalOva,
      storageUsed: formatImageSize(totalStorage + ovaStorage),
    };
  }, [cloudImages, isoImages, ovaTemplates]);

  // Filtered images
  const filteredItems = useMemo(() => {
    const filter = (items: (CloudImage | ISOImage)[]) =>
      items.filter(img => img.name.toLowerCase().includes(searchQuery.toLowerCase()));

    if (categoryFilter === 'cloud-images') {
      return { cloud: filter(cloudImages), iso: [], ova: [] };
    }
    if (categoryFilter === 'isos') {
      return { cloud: [], iso: filter(isoImages), ova: [] };
    }
    if (categoryFilter === 'ova-templates') {
      return { cloud: [], iso: [], ova: ovaTemplates?.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase())) || [] };
    }
    return {
      cloud: filter(cloudImages),
      iso: filter(isoImages),
      ova: ovaTemplates?.filter(t => t.name.toLowerCase().includes(searchQuery.toLowerCase())) || [],
    };
  }, [cloudImages, isoImages, ovaTemplates, searchQuery, categoryFilter]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      await deleteImage.mutateAsync(id);
      toast.success('Image deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete image');
    }
  };

  const handleDeleteOVA = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    deleteOVATemplate.mutate(id, {
      onSuccess: () => {
        toast.success('Template deleted');
        refetchOVA();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to delete');
      },
    });
  };

  const handleScanISOs = async () => {
    scanISOs.mutate(undefined, {
      onSuccess: (data) => {
        if (data.discoveredCount > 0) {
          toast.success(`Discovered ${data.discoveredCount} new ISO${data.discoveredCount > 1 ? 's' : ''}`);
        } else {
          toast.info('No new ISOs found');
        }
        refetch();
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to scan ISOs');
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <HardDrive className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.total}</p>
              <p className="text-xs text-text-muted">Total Images</p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
              <Cloud className="w-5 h-5 text-info" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.cloud}</p>
              <p className="text-xs text-text-muted">Cloud Images</p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
              <Disc className="w-5 h-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.iso}</p>
              <p className="text-xs text-text-muted">ISO Images</p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-surface border border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-text-primary">{stats.storageUsed}</p>
              <p className="text-xs text-text-muted">Storage Used</p>
            </div>
          </div>
        </div>
      </div>

      {/* Catalog Warning */}
      {isUsingCatalog && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
          <AlertCircle className="w-5 h-5 text-warning shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">Using built-in catalog</p>
            <p className="text-xs text-text-muted">
              Download images to your storage pools for better performance, or upload your own ISOs.
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ImageCategory)}
            className="px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="cloud-images">Cloud Images</option>
            <option value="isos">ISO Images</option>
            <option value="ova-templates">OVA Templates</option>
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search images..."
              className="pl-10 pr-4 py-2 w-64 bg-bg-surface border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleScanISOs}
            disabled={scanISOs.isPending}
          >
            {scanISOs.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Disc className="w-4 h-4" />
            )}
            Scan ISOs
          </Button>
          <Button variant="secondary" onClick={() => { refetch(); refetchOVA(); }}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Image Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {isLoading || ovaLoading ? (
            [...Array(6)].map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="p-4 rounded-xl bg-bg-surface border border-border animate-pulse"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-bg-elevated" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 bg-bg-elevated rounded" />
                    <div className="h-3 w-1/2 bg-bg-elevated rounded" />
                  </div>
                </div>
              </div>
            ))
          ) : filteredItems.cloud.length === 0 && filteredItems.iso.length === 0 && filteredItems.ova.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <HardDrive className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No images found</p>
              <p className="text-sm text-text-muted mt-1">
                Download cloud images or upload ISOs to get started
              </p>
            </div>
          ) : (
            <div className="contents">
              {/* Cloud Images */}
              {filteredItems.cloud.map((image) => {
                const status = STATUS_CONFIG[image.status] || STATUS_CONFIG.pending;
                return (
                  <motion.div
                    key={`cloud-${image.id}`}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-4 rounded-xl bg-bg-surface border border-border hover:border-accent/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <Cloud className="w-6 h-6 text-accent" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-text-primary truncate">{image.name}</h3>
                          <Badge variant={status.variant} size="sm">{status.label}</Badge>
                        </div>
                        {image.description && (
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{image.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                          <span>{formatImageSize(image.sizeBytes)}</span>
                          <span>•</span>
                          <span className="capitalize">{image.os.distribution} {image.os.version}</span>
                        </div>
                      </div>
                      {!isUsingCatalog && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(image.id, image.name)}
                          disabled={deleteImage.isPending}
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </Button>
                      )}
                    </div>
                    {'os' in image && 'cloudInitEnabled' in image.os && image.os.cloudInitEnabled && (
                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 text-xs">
                        <span className="text-text-muted">
                          Default user: <span className="text-text-secondary">{'defaultUser' in image.os ? image.os.defaultUser : 'root'}</span>
                        </span>
                        <Badge variant="info" size="sm">cloud-init</Badge>
                      </div>
                    )}
                  </motion.div>
                );
              })}

              {/* ISO Images */}
              {filteredItems.iso.map((image) => {
                const status = STATUS_CONFIG[image.status] || STATUS_CONFIG.pending;
                const imagePath = 'path' in image ? image.path : undefined;
                return (
                  <motion.div
                    key={`iso-${image.id}`}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-4 rounded-xl bg-bg-surface border border-border hover:border-accent/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                        <Disc className="w-6 h-6 text-warning" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-text-primary truncate">{image.name}</h3>
                          <Badge variant={status.variant} size="sm">{status.label}</Badge>
                        </div>
                        {'description' in image && image.description && (
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{image.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                          <span>{formatImageSize(image.sizeBytes)}</span>
                          <span>•</span>
                          <span className="capitalize">{image.os.distribution} {image.os.version}</span>
                        </div>
                      </div>
                      {!isUsingCatalog && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(image.id, image.name)}
                          disabled={deleteImage.isPending}
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </Button>
                      )}
                    </div>
                    {imagePath && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-[10px] text-text-muted font-mono truncate" title={imagePath}>
                          {imagePath}
                        </p>
                      </div>
                    )}
                  </motion.div>
                );
              })}

              {/* OVA Templates */}
              {filteredItems.ova.map((template) => {
                const meta = template.spec?.ovaMetadata;
                return (
                  <motion.div
                    key={`ova-${template.id}`}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="p-4 rounded-xl bg-bg-surface border border-border hover:border-accent/50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-lg bg-info/10 flex items-center justify-center shrink-0">
                        <Package className="w-6 h-6 text-info" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-text-primary truncate">{template.name}</h3>
                          <Badge variant="info" size="sm">OVA</Badge>
                        </div>
                        {template.description && (
                          <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{template.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                          <span>{formatOVASize(template.status?.virtualSizeBytes || 0)}</span>
                          {template.spec?.os?.distribution && (
                            <>
                              <span>•</span>
                              <span className="capitalize">{template.spec.os.distribution}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteOVA(template.id, template.name)}
                        disabled={deleteOVATemplate.isPending}
                      >
                        <Trash2 className="w-4 h-4 text-error" />
                      </Button>
                    </div>
                    {meta?.hardware && (
                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 text-xs">
                        <span className="flex items-center gap-1 text-text-muted">
                          <Cpu className="w-3 h-3" />
                          {meta.hardware.cpuCount} vCPU
                        </span>
                        <span className="flex items-center gap-1 text-text-muted">
                          <MemoryStick className="w-3 h-3" />
                          {meta.hardware.memoryMib} MiB
                        </span>
                        {meta.disks && meta.disks.length > 0 && (
                          <span className="flex items-center gap-1 text-text-muted">
                            <HardDrive className="w-3 h-3" />
                            {meta.disks.length} disk{meta.disks.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <p className="text-sm text-text-muted">
          Showing {filteredItems.cloud.length + filteredItems.iso.length + filteredItems.ova.length} of {stats.total} images
        </p>
        {isUsingCatalog && (
          <p className="text-xs text-text-muted">
            Using built-in catalog. Upload or download images to populate your library.
          </p>
        )}
      </div>
    </div>
  );
}
