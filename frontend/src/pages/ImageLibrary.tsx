import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Disc,
  Cloud,
  Upload,
  Download,
  Trash2,
  Search,
  CheckCircle,
  AlertCircle,
  Loader2,
  RefreshCw,
  HardDrive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ISOUploadDialog } from '@/components/storage';
import {
  useImages,
  useDeleteImage,
  useDownloadImage,
  useImportStatus,
  CLOUD_IMAGE_CATALOG,
  ISO_CATALOG,
  formatImageSize,
  type CloudImage,
  type ISOImage,
  type DownloadProgress,
} from '@/hooks/useImages';
import { toast } from 'sonner';

// Track download jobs by image ID
interface DownloadJob {
  jobId: string;
  imageId: string;
  catalogId: string;
}

// Component to poll a single download job's progress (uses hook)
function DownloadJobTracker({
  job,
  onProgress,
  onComplete,
  onError,
}: {
  job: DownloadJob;
  onProgress: (catalogId: string, progress: DownloadProgress) => void;
  onComplete: (catalogId: string) => void;
  onError: (catalogId: string, message: string) => void;
}) {
  const { data } = useImportStatus(job.jobId, true);

  useEffect(() => {
    if (!data) return;

    // Update progress
    onProgress(job.catalogId, {
      progressPercent: data.progressPercent,
      bytesDownloaded: data.bytesDownloaded,
      bytesTotal: data.bytesTotal,
    });

    // Check completion status
    // status: 1=pending, 2=downloading, 3=converting, 4=completed, 5=failed
    if (data.status === 4) {
      onComplete(job.catalogId);
    } else if (data.status === 5) {
      onError(job.catalogId, data.errorMessage || 'Download failed');
    }
  }, [job.catalogId, data, onProgress, onComplete, onError]);

  return null; // This is a headless component
}

type TabType = 'cloud-images' | 'isos';
type FilterStatus = 'all' | 'ready' | 'downloading' | 'pending' | 'error';

const STATUS_CONFIG: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'default'; icon: typeof CheckCircle }> = {
  ready: { label: 'Ready', variant: 'success', icon: CheckCircle },
  downloading: { label: 'Downloading', variant: 'warning', icon: Loader2 },
  pending: { label: 'Pending', variant: 'default', icon: Loader2 },
  error: { label: 'Error', variant: 'error', icon: AlertCircle },
  uploading: { label: 'Uploading', variant: 'warning', icon: Loader2 },
};

export default function ImageLibrary() {
  const [activeTab, setActiveTab] = useState<TabType>('cloud-images');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [downloadingImages, setDownloadingImages] = useState<Set<string>>(new Set());
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map());

  // Fetch images from API
  const { data: apiImages, isLoading, error, refetch } = useImages();
  const deleteImage = useDeleteImage();
  const downloadImage = useDownloadImage();

  // Callbacks for download progress updates
  const handleProgress = useCallback((imageId: string, progress: DownloadProgress) => {
    setDownloadProgress(prev => {
      const next = new Map(prev);
      next.set(imageId, progress);
      return next;
    });
  }, []);

  const handleComplete = useCallback((imageId: string) => {
    // Remove from tracking
    setDownloadJobs(prev => prev.filter(j => j.catalogId !== imageId && j.imageId !== imageId));
    setDownloadingImages(prev => {
      const next = new Set(prev);
      next.delete(imageId);
      return next;
    });
    setDownloadProgress(prev => {
      const next = new Map(prev);
      next.delete(imageId);
      return next;
    });
    toast.success('Download complete!');
    refetch(); // Refresh image list
  }, [refetch]);

  const handleError = useCallback((imageId: string, message: string) => {
    setDownloadJobs(prev => prev.filter(j => j.catalogId !== imageId && j.imageId !== imageId));
    setDownloadingImages(prev => {
      const next = new Set(prev);
      next.delete(imageId);
      return next;
    });
    setDownloadProgress(prev => {
      const next = new Map(prev);
      next.delete(imageId);
      return next;
    });
    toast.error(`Download failed: ${message}`);
  }, []);

  // Combine API images with catalog (fallback)
  const cloudImages: CloudImage[] = apiImages && apiImages.length > 0 
    ? apiImages.filter(img => img.os.cloudInitEnabled || img.os.provisioningMethod === 'CLOUD_INIT')
    : CLOUD_IMAGE_CATALOG;

  const isoImages: (CloudImage | ISOImage)[] = apiImages && apiImages.length > 0
    ? apiImages.filter(img => !img.os.cloudInitEnabled && img.os.provisioningMethod !== 'CLOUD_INIT')
    : ISO_CATALOG;

  const isUsingCatalog = !apiImages || apiImages.length === 0;

  // Filter images based on search and status
  const filterImages = <T extends { name: string; status: string }>(images: T[]): T[] => {
    return images.filter(img => {
      const matchesSearch = img.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || img.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  };

  const filteredCloudImages = filterImages(cloudImages);
  const filteredISOs = filterImages(isoImages as any);

  const currentImages = activeTab === 'cloud-images' ? filteredCloudImages : filteredISOs;

  // Handle download from catalog
  const handleDownloadFromCatalog = async (catalogId: string) => {
    setDownloadingImages(prev => new Set(prev).add(catalogId));
    try {
      const result = await downloadImage.mutateAsync({ catalogId });
      if (result.jobId) {
        // Track this download job
        setDownloadJobs(prev => [...prev, { 
          jobId: result.jobId, 
          imageId: result.imageId || catalogId,
          catalogId 
        }]);
        // Initialize progress
        setDownloadProgress(prev => {
          const next = new Map(prev);
          next.set(catalogId, { progressPercent: 0, bytesDownloaded: 0, bytesTotal: 0 });
          return next;
        });
        toast.success('Download started!');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start download');
      setDownloadingImages(prev => {
        const next = new Set(prev);
        next.delete(catalogId);
        return next;
      });
    }
  };

  // Handle delete
  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      await deleteImage.mutateAsync(id);
      toast.success('Image deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete image');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Download job trackers (headless - just poll for progress) */}
      {downloadJobs.map(job => (
        <DownloadJobTracker
          key={job.jobId}
          job={job}
          onProgress={handleProgress}
          onComplete={handleComplete}
          onError={handleError}
        />
      ))}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Image Library</h1>
          <p className="text-text-muted mt-1">
            Manage cloud images and ISO files for VM provisioning
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsUploadDialogOpen(true)}>
            <Upload className="w-4 h-4" />
            Upload ISO
          </Button>
        </div>
      </div>

      {/* Catalog Warning */}
      {isUsingCatalog && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
          <AlertCircle className="w-5 h-5 text-warning" />
          <div className="flex-1">
            <p className="text-sm font-medium text-warning">Using built-in catalog</p>
            <p className="text-xs text-text-muted">
              Download images to your storage pools for better performance, or upload your own ISOs.
            </p>
          </div>
        </div>
      )}

      {/* Tabs & Filters */}
      <div className="flex items-center justify-between">
        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg bg-bg-base border border-border">
          <button
            onClick={() => setActiveTab('cloud-images')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              activeTab === 'cloud-images'
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            )}
          >
            <Cloud className="w-4 h-4" />
            Cloud Images
            <Badge variant="default" size="sm">{filteredCloudImages.length}</Badge>
          </button>
          <button
            onClick={() => setActiveTab('isos')}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              activeTab === 'isos'
                ? 'bg-accent text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
            )}
          >
            <Disc className="w-4 h-4" />
            ISO Images
            <Badge variant="default" size="sm">{filteredISOs.length}</Badge>
          </button>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search images..."
              className="pl-10 pr-4 py-2 w-64 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
            className="px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="all">All Status</option>
            <option value="ready">Ready</option>
            <option value="downloading">Downloading</option>
            <option value="pending">Pending</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      {/* Image Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {isLoading ? (
            // Loading skeleton
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
          ) : currentImages.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <HardDrive className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No images found</p>
              <p className="text-sm text-text-muted mt-1">
                {activeTab === 'isos' 
                  ? 'Upload an ISO to get started'
                  : 'Download a cloud image from the catalog'
                }
              </p>
            </div>
          ) : (
            currentImages.map((image) => {
              const status = STATUS_CONFIG[image.status] || STATUS_CONFIG.pending;
              const StatusIcon = status.icon;
              const isDownloading = downloadingImages.has(image.id);
              // Use progress from local tracking first, then fall back to API progress
              const progress = downloadProgress.get(image.id) || ('downloadProgress' in image ? image.downloadProgress : undefined);
              const isActivelyDownloading = image.status === 'downloading' || isDownloading;

              return (
                <motion.div
                  key={image.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="p-4 rounded-xl bg-bg-surface border border-border hover:border-accent/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={cn(
                      'w-12 h-12 rounded-lg flex items-center justify-center',
                      activeTab === 'cloud-images' ? 'bg-accent/10' : 'bg-warning/10'
                    )}>
                      {activeTab === 'cloud-images' ? (
                        <Cloud className="w-6 h-6 text-accent" />
                      ) : (
                        <Disc className="w-6 h-6 text-warning" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-text-primary truncate">
                          {image.name}
                        </h3>
                        <Badge variant={isActivelyDownloading ? 'warning' : status.variant} size="sm">
                          {isActivelyDownloading ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                              {progress ? `${progress.progressPercent}%` : 'Starting...'}
                            </>
                          ) : (
                            status.label
                          )}
                        </Badge>
                      </div>
                      {'description' in image && image.description && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-1">
                          {image.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                        <span>{formatImageSize(image.sizeBytes)}</span>
                        {'os' in image && (
                          <>
                            <span>•</span>
                            <span className="capitalize">{image.os.distribution} {image.os.version}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {isUsingCatalog && image.status === 'ready' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadFromCatalog(image.id)}
                          disabled={isDownloading}
                          title="Download to storage"
                        >
                          {isDownloading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </Button>
                      )}
                      {!isUsingCatalog && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(image.id, image.name)}
                          disabled={deleteImage.isPending}
                          title="Delete image"
                        >
                          <Trash2 className="w-4 h-4 text-error" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Download Progress Bar */}
                  {isActivelyDownloading && progress && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-center justify-between text-xs text-text-muted mb-1.5">
                        <span>Downloading...</span>
                        <span>
                          {progress.bytesTotal > 0 
                            ? `${formatImageSize(progress.bytesDownloaded)} / ${formatImageSize(progress.bytesTotal)}`
                            : `${progress.progressPercent}%`
                          }
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-bg-base rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-warning rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${progress.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Cloud Image specific info */}
                  {activeTab === 'cloud-images' && 'os' in image && !isActivelyDownloading && (
                    <div className="mt-3 pt-3 border-t border-border flex items-center gap-4 text-xs">
                      <span className="text-text-muted">
                        Default user: <span className="text-text-secondary">{image.os.defaultUser}</span>
                      </span>
                      {image.os.cloudInitEnabled && (
                        <Badge variant="info" size="sm">cloud-init</Badge>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <p className="text-sm text-text-muted">
          Showing {currentImages.length} {activeTab === 'cloud-images' ? 'cloud images' : 'ISO images'}
        </p>
        {isUsingCatalog && (
          <p className="text-xs text-text-muted">
            Using built-in catalog. Upload or download images to populate your library.
          </p>
        )}
      </div>

      {/* Upload Dialog */}
      {isUploadDialogOpen && (
        <ISOUploadDialog
          isOpen={isUploadDialogOpen}
          onClose={() => setIsUploadDialogOpen(false)}
        />
      )}
    </div>
  );
}
