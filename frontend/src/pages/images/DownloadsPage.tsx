import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cloud,
  Search,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
  Info,
  Server,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  useDownloadImage,
  useImportStatus,
  useCatalogDownloadStatus,
  CLOUD_IMAGE_CATALOG,
  formatImageSize,
  type CloudImage,
  type DownloadProgress,
} from '@/hooks/useImages';
import { toast } from 'sonner';

// Track download jobs by image ID
interface DownloadJob {
  jobId: string;
  imageId: string;
  catalogId: string;
}

// Component to poll a single download job's progress
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

    onProgress(job.catalogId, {
      progressPercent: data.progressPercent,
      bytesDownloaded: data.bytesDownloaded,
      bytesTotal: data.bytesTotal,
    });

    // status: 1=pending, 2=downloading, 3=converting, 4=completed, 5=failed
    if (data.status === 4) {
      onComplete(job.catalogId);
    } else if (data.status === 5) {
      onError(job.catalogId, data.errorMessage || 'Download failed');
    }
  }, [job.catalogId, data, onProgress, onComplete, onError]);

  return null;
}

export function DownloadsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [distroFilter, setDistroFilter] = useState<string>('all');
  const [downloadJobs, setDownloadJobs] = useState<DownloadJob[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<Map<string, DownloadProgress>>(new Map());

  const downloadImage = useDownloadImage();

  // Get all catalog IDs to check their status
  const catalogIds = useMemo(() => CLOUD_IMAGE_CATALOG.map(img => img.id), []);
  
  // Use the new hook to check download status by catalog ID
  const { data: catalogStatus, refetch: refetchStatus } = useCatalogDownloadStatus(catalogIds);

  // Get unique distributions from catalog
  const distributions = [...new Set(CLOUD_IMAGE_CATALOG.map(img => img.os.distribution))];

  // Callbacks for download progress
  const handleProgress = useCallback((catalogId: string, progress: DownloadProgress) => {
    setDownloadProgress(prev => {
      const next = new Map(prev);
      next.set(catalogId, progress);
      return next;
    });
  }, []);

  const handleComplete = useCallback((catalogId: string) => {
    setDownloadJobs(prev => prev.filter(j => j.catalogId !== catalogId));
    setDownloadProgress(prev => {
      const next = new Map(prev);
      next.delete(catalogId);
      return next;
    });
    toast.success('Download complete!');
    refetchStatus();
  }, [refetchStatus]);

  const handleError = useCallback((catalogId: string, message: string) => {
    setDownloadJobs(prev => prev.filter(j => j.catalogId !== catalogId));
    setDownloadProgress(prev => {
      const next = new Map(prev);
      next.delete(catalogId);
      return next;
    });
    toast.error(`Download failed: ${message}`);
    refetchStatus();
  }, [refetchStatus]);

  // Filter catalog images
  const filteredImages = CLOUD_IMAGE_CATALOG.filter(img => {
    const matchesSearch = img.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDistro = distroFilter === 'all' || img.os.distribution === distroFilter;
    return matchesSearch && matchesDistro;
  });

  const handleDownload = async (image: CloudImage) => {
    // Check if already downloaded via the status API
    const status = catalogStatus?.get(image.id);
    if (status?.status === 'READY') {
      toast.info(`Image already downloaded (Pool: ${status.storagePoolId || 'default'})`);
      return;
    }
    if (status?.status === 'DOWNLOADING') {
      toast.info('Image is already being downloaded');
      return;
    }

    try {
      const result = await downloadImage.mutateAsync({ catalogId: image.id });
      if (result.jobId) {
        setDownloadJobs(prev => [...prev, {
          jobId: result.jobId,
          imageId: result.imageId || image.id,
          catalogId: image.id,
        }]);
        setDownloadProgress(prev => {
          const next = new Map(prev);
          next.set(image.id, { progressPercent: 0, bytesDownloaded: 0, bytesTotal: 0 });
          return next;
        });
        toast.success('Download started!');
        refetchStatus();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start download';
      // Check if it's an "already exists" error from the backend
      if (message.includes('already downloaded') || message.includes('already being downloaded')) {
        toast.info(message);
        refetchStatus();
      } else {
        toast.error(message);
      }
    }
  };

  // Get status for an image
  const getImageStatus = (catalogId: string) => {
    // First check local download jobs (in-progress downloads started this session)
    const localJob = downloadJobs.find(j => j.catalogId === catalogId);
    if (localJob) {
      return { status: 'DOWNLOADING' as const, progress: downloadProgress.get(catalogId) };
    }
    // Then check the API status
    const apiStatus = catalogStatus?.get(catalogId);
    return apiStatus || { status: 'NOT_DOWNLOADED' as const };
  };

  // Count downloaded images
  const downloadedCount = catalogStatus 
    ? Array.from(catalogStatus.values()).filter(s => s.status === 'READY').length 
    : 0;
  const downloadingCount = (catalogStatus 
    ? Array.from(catalogStatus.values()).filter(s => s.status === 'DOWNLOADING').length 
    : 0) + downloadJobs.length;

  return (
    <div className="space-y-6">
      {/* Download job trackers */}
      {downloadJobs.map(job => (
        <DownloadJobTracker
          key={job.jobId}
          job={job}
          onProgress={handleProgress}
          onComplete={handleComplete}
          onError={handleError}
        />
      ))}

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-info/10 border border-info/30">
        <Info className="w-5 h-5 text-info shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-info">Cloud Image Catalog</p>
          <p className="text-xs text-text-muted mt-1">
            Download cloud-init compatible images directly to your storage pools. These images are optimized
            for quick VM deployment and support automatic provisioning via cloud-init.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <CheckCircle className="w-4 h-4 text-success" />
            {downloadedCount} downloaded
          </span>
          {downloadingCount > 0 && (
            <span className="flex items-center gap-1">
              <Loader2 className="w-4 h-4 text-warning animate-spin" />
              {downloadingCount} in progress
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={distroFilter}
            onChange={(e) => setDistroFilter(e.target.value)}
            className="px-3 py-2 bg-bg-surface border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="all">All Distributions</option>
            {distributions.map(distro => (
              <option key={distro} value={distro} className="capitalize">{distro}</option>
            ))}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search catalog..."
              className="pl-10 pr-4 py-2 w-64 bg-bg-surface border border-border rounded-lg text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <Button variant="secondary" onClick={() => refetchStatus()}>
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Active Downloads (from API status) */}
      {downloadingCount > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-warning" />
            Active Downloads ({downloadingCount})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Show local download jobs first */}
            {downloadJobs.map(job => {
              const image = CLOUD_IMAGE_CATALOG.find(img => img.id === job.catalogId);
              const progress = downloadProgress.get(job.catalogId);
              if (!image) return null;

              return (
                <div key={job.jobId} className="p-4 rounded-xl bg-bg-surface border border-warning/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-warning animate-spin" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{image.name}</p>
                      <div className="flex items-center justify-between text-xs text-text-muted mt-1">
                        <span>Downloading...</span>
                        <span>
                          {progress?.bytesTotal ? `${formatImageSize(progress.bytesDownloaded)} / ${formatImageSize(progress.bytesTotal)}` : `${progress?.progressPercent || 0}%`}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-bg-base rounded-full overflow-hidden mt-2">
                        <div
                          className="h-full bg-warning rounded-full transition-all duration-300"
                          style={{ width: `${progress?.progressPercent || 0}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* Show API-tracked downloads that aren't in local jobs */}
            {catalogStatus && Array.from(catalogStatus.entries())
              .filter(([id, status]) => status.status === 'DOWNLOADING' && !downloadJobs.find(j => j.catalogId === id))
              .map(([catalogId, status]) => {
                const image = CLOUD_IMAGE_CATALOG.find(img => img.id === catalogId);
                if (!image) return null;

                return (
                  <div key={catalogId} className="p-4 rounded-xl bg-bg-surface border border-warning/30">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-warning animate-spin" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{image.name}</p>
                        <div className="flex items-center justify-between text-xs text-text-muted mt-1">
                          <span>Downloading...</span>
                          <span>{status.progressPercent || 0}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-bg-base rounded-full overflow-hidden mt-2">
                          <div
                            className="h-full bg-warning rounded-full transition-all duration-300"
                            style={{ width: `${status.progressPercent || 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Catalog Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {filteredImages.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <Cloud className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted">No images match your search</p>
            </div>
          ) : (
            filteredImages.map((image) => {
              const imageStatus = getImageStatus(image.id);
              const isDownloaded = imageStatus.status === 'READY';
              const isDownloading = imageStatus.status === 'DOWNLOADING';
              const hasError = imageStatus.status === 'ERROR';
              const storagePoolId = 'storagePoolId' in imageStatus ? imageStatus.storagePoolId : undefined;

              return (
                <motion.div
                  key={image.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={cn(
                    'p-4 rounded-xl border transition-colors',
                    isDownloaded
                      ? 'bg-success/5 border-success/30'
                      : hasError
                        ? 'bg-error/5 border-error/30'
                        : 'bg-bg-surface border-border hover:border-accent/50'
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      'w-12 h-12 rounded-lg flex items-center justify-center shrink-0',
                      isDownloaded ? 'bg-success/10' : hasError ? 'bg-error/10' : 'bg-accent/10'
                    )}>
                      {isDownloaded ? (
                        <CheckCircle className="w-6 h-6 text-success" />
                      ) : isDownloading ? (
                        <Loader2 className="w-6 h-6 text-warning animate-spin" />
                      ) : hasError ? (
                        <AlertCircle className="w-6 h-6 text-error" />
                      ) : (
                        <Cloud className="w-6 h-6 text-accent" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-text-primary truncate">{image.name}</h3>
                        {isDownloaded && <Badge variant="success" size="sm">Downloaded</Badge>}
                        {isDownloading && <Badge variant="warning" size="sm">Downloading</Badge>}
                        {hasError && <Badge variant="error" size="sm">Failed</Badge>}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{image.description}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                        <span>{formatImageSize(image.sizeBytes)}</span>
                        <span>•</span>
                        <span className="capitalize">{image.os.architecture}</span>
                      </div>
                    </div>
                  </div>

                  {/* Storage Pool Info (if downloaded) */}
                  {isDownloaded && storagePoolId && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                      <Database className="w-3 h-3" />
                      <span>Pool: {storagePoolId}</span>
                    </div>
                  )}

                  {/* Error Message */}
                  {hasError && 'errorMessage' in imageStatus && imageStatus.errorMessage && (
                    <div className="mt-3 p-2 rounded bg-error/10 text-xs text-error">
                      {imageStatus.errorMessage}
                    </div>
                  )}

                  {/* Requirements & Actions */}
                  <div className="mt-4 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 text-xs text-text-muted">
                        <span className="flex items-center gap-1">
                          <Server className="w-3 h-3" />
                          {image.requirements.minCpu} vCPU
                        </span>
                        <span>{image.requirements.minMemoryMib} MiB RAM</span>
                        <span>{image.requirements.minDiskGib} GiB disk</span>
                      </div>
                      <Button
                        variant={isDownloaded ? 'secondary' : hasError ? 'default' : 'default'}
                        size="sm"
                        onClick={() => handleDownload(image)}
                        disabled={isDownloading}
                      >
                        {isDownloading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isDownloaded ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : hasError ? (
                          <RefreshCw className="w-4 h-4" />
                        ) : (
                          <Download className="w-4 h-4" />
                        )}
                        {isDownloaded ? 'Ready' : hasError ? 'Retry' : 'Download'}
                      </Button>
                    </div>
                  </div>

                  {/* Cloud-init info */}
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="info" size="sm">cloud-init</Badge>
                    <span className="text-xs text-text-muted">
                      Default user: <span className="text-text-secondary">{image.os.defaultUser}</span>
                    </span>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* VM Wizard Integration Note */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-bg-surface border border-border">
        <AlertCircle className="w-5 h-5 text-text-muted shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-text-primary">VM Wizard Integration</p>
          <p className="text-xs text-text-muted mt-1">
            Downloaded images automatically appear in the VM Creation Wizard. Select any cloud image as a
            backing disk when creating new virtual machines for instant provisioning.
          </p>
        </div>
      </div>
    </div>
  );
}
