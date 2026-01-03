import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  HardDrive,
  Cloud,
  Check,
  AlertCircle,
  Loader2,
  Server,
  Cpu,
  MemoryStick,
  HardDrive as DiskIcon,
  User,
  RefreshCw,
  Trash2,
  Search,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useImages,
  useImageCatalog,
  useDownloadImage,
  useDeleteImage,
  useImportStatus,
  formatImageSize,
  type CloudImage,
  type CatalogImage,
  CLOUD_IMAGE_CATALOG,
} from '@/hooks/useImages';
import { cn } from '@/lib/utils';

// Distribution logos
const distroLogos: Record<string, string> = {
  ubuntu: '🟠',
  debian: '🔴',
  rocky: '🟢',
  almalinux: '🔵',
  centos: '🟣',
  fedora: '💙',
  opensuse: '🟩',
  windows: '🪟',
};

function getDistroLogo(distribution: string): string {
  return distroLogos[distribution.toLowerCase()] || '🐧';
}

export default function ImageLibrary() {
  const [activeTab, setActiveTab] = useState<'local' | 'catalog'>('catalog');
  const [searchQuery, setSearchQuery] = useState('');
  const [downloadingJobs, setDownloadingJobs] = useState<Record<string, string>>({});

  const { data: localImages, isLoading: loadingLocal, refetch: refetchLocal } = useImages();
  const { data: catalogImages, isLoading: loadingCatalog } = useImageCatalog();
  const downloadImage = useDownloadImage();
  const deleteImage = useDeleteImage();

  // Use local catalog as fallback
  const catalog = catalogImages || CLOUD_IMAGE_CATALOG.map(img => ({
    id: img.id,
    name: img.name,
    description: img.description,
    url: '',
    checksum: '',
    checksumType: 'sha256',
    sizeBytes: img.sizeBytes,
    verified: true,
    os: img.os,
    requirements: img.requirements,
  }));

  // Filter images based on search
  const filteredCatalog = catalog.filter(img => 
    img.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    img.os.distribution.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLocal = (localImages || []).filter(img =>
    img.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    img.os.distribution.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDownload = async (catalogId: string) => {
    try {
      const result = await downloadImage.mutateAsync({ catalogId });
      if (result.jobId) {
        setDownloadingJobs(prev => ({ ...prev, [catalogId]: result.jobId }));
        toast.success('Download started', {
          description: `Downloading ${catalogId}...`,
        });
      }
    } catch (error) {
      toast.error('Download failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  const handleDelete = async (imageId: string, imageName: string) => {
    if (!confirm(`Are you sure you want to delete "${imageName}"?`)) {
      return;
    }
    try {
      await deleteImage.mutateAsync(imageId);
      toast.success('Image deleted');
    } catch (error) {
      toast.error('Delete failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Image Library</h1>
          <p className="text-text-secondary mt-1">
            Download and manage cloud images for VM provisioning
          </p>
        </div>
        <button
          onClick={() => refetchLocal()}
          className="flex items-center gap-2 px-4 py-2 bg-bg-surface border border-border rounded-lg hover:bg-bg-hover transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('catalog')}
          className={cn(
            'flex items-center gap-2 px-4 py-3 font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'catalog'
              ? 'text-neonBlue border-neonBlue'
              : 'text-text-muted border-transparent hover:text-text-primary'
          )}
        >
          <Cloud className="w-4 h-4" />
          Cloud Catalog
          <span className="px-2 py-0.5 text-xs rounded-full bg-bg-surface">
            {catalog.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('local')}
          className={cn(
            'flex items-center gap-2 px-4 py-3 font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'local'
              ? 'text-neonBlue border-neonBlue'
              : 'text-text-muted border-transparent hover:text-text-primary'
          )}
        >
          <HardDrive className="w-4 h-4" />
          Local Images
          <span className="px-2 py-0.5 text-xs rounded-full bg-bg-surface">
            {localImages?.length || 0}
          </span>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
        <input
          type="text"
          placeholder="Search images..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-bg-surface border border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-neonBlue/50"
        />
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'catalog' ? (
          <motion.div
            key="catalog"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {loadingCatalog ? (
              <div className="col-span-full flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="col-span-full text-center py-12 text-text-muted">
                No images found matching "{searchQuery}"
              </div>
            ) : (
              filteredCatalog.map((image) => (
                <CatalogImageCard
                  key={image.id}
                  image={image}
                  isDownloaded={localImages?.some(img => img.id === image.id) || false}
                  isDownloading={!!downloadingJobs[image.id]}
                  jobId={downloadingJobs[image.id]}
                  onDownload={() => handleDownload(image.id)}
                />
              ))
            )}
          </motion.div>
        ) : (
          <motion.div
            key="local"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {loadingLocal ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
              </div>
            ) : filteredLocal.length === 0 ? (
              <div className="text-center py-12">
                <HardDrive className="w-12 h-12 mx-auto text-text-muted mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  No local images
                </h3>
                <p className="text-text-secondary mb-4">
                  Download images from the Cloud Catalog to use them for VM provisioning.
                </p>
                <button
                  onClick={() => setActiveTab('catalog')}
                  className="px-4 py-2 bg-neonBlue text-white rounded-lg hover:bg-neonBlue/90 transition-colors"
                >
                  Browse Catalog
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredLocal.map((image) => (
                  <LocalImageCard
                    key={image.id}
                    image={image}
                    onDelete={() => handleDelete(image.id, image.name)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Catalog image card
function CatalogImageCard({
  image,
  isDownloaded,
  isDownloading,
  jobId,
  onDownload,
}: {
  image: CatalogImage;
  isDownloaded: boolean;
  isDownloading: boolean;
  jobId?: string;
  onDownload: () => void;
}) {
  const { data: status } = useImportStatus(jobId || '', isDownloading && !!jobId);

  const progressPercent = status?.progressPercent || 0;
  const downloading = isDownloading && status?.status !== 4; // not completed

  return (
    <motion.div
      layout
      className="bg-bg-surface border border-border rounded-xl overflow-hidden hover:border-neonBlue/50 transition-colors"
    >
      {/* Header with distro logo */}
      <div className="p-4 border-b border-border flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{getDistroLogo(image.os.distribution)}</div>
          <div>
            <h3 className="font-medium text-text-primary">{image.name}</h3>
            <p className="text-sm text-text-muted">
              {image.os.architecture} • {formatImageSize(image.sizeBytes)}
            </p>
          </div>
        </div>
        {image.verified && (
          <span className="px-2 py-1 text-xs font-medium text-green-400 bg-green-400/10 rounded-full flex items-center gap-1">
            <Check className="w-3 h-3" /> Verified
          </span>
        )}
      </div>

      {/* Description */}
      <div className="p-4">
        <p className="text-sm text-text-secondary mb-4">{image.description}</p>

        {/* Requirements */}
        <div className="grid grid-cols-3 gap-2 text-xs text-text-muted mb-4">
          <div className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            {image.requirements.minCpu} vCPU
          </div>
          <div className="flex items-center gap-1">
            <MemoryStick className="w-3 h-3" />
            {image.requirements.minMemoryMib} MB
          </div>
          <div className="flex items-center gap-1">
            <DiskIcon className="w-3 h-3" />
            {image.requirements.minDiskGib} GB
          </div>
        </div>

        {/* Default user info */}
        <div className="flex items-center gap-1 text-xs text-text-muted mb-4">
          <User className="w-3 h-3" />
          Default user: <code className="text-neonBlue">{image.os.defaultUser}</code>
        </div>

        {/* Download progress */}
        {downloading && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-text-muted mb-1">
              <span>Downloading...</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 bg-bg-base rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-neonBlue"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        )}

        {/* Action button */}
        <button
          onClick={onDownload}
          disabled={isDownloaded || downloading}
          className={cn(
            'w-full py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2',
            isDownloaded
              ? 'bg-green-500/10 text-green-400 cursor-not-allowed'
              : downloading
              ? 'bg-bg-base text-text-muted cursor-not-allowed'
              : 'bg-neonBlue text-white hover:bg-neonBlue/90'
          )}
        >
          {isDownloaded ? (
            <>
              <Check className="w-4 h-4" /> Downloaded
            </>
          ) : downloading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Downloading...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" /> Download
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

// Local image card
function LocalImageCard({
  image,
  onDelete,
}: {
  image: CloudImage;
  onDelete: () => void;
}) {
  return (
    <motion.div
      layout
      className="bg-bg-surface border border-border rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-border flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="text-3xl">{getDistroLogo(image.os.distribution)}</div>
          <div>
            <h3 className="font-medium text-text-primary">{image.name}</h3>
            <p className="text-sm text-text-muted">
              {image.os.architecture} • {formatImageSize(image.sizeBytes)}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'px-2 py-1 text-xs font-medium rounded-full',
            image.status === 'ready'
              ? 'text-green-400 bg-green-400/10'
              : image.status === 'downloading'
              ? 'text-yellow-400 bg-yellow-400/10'
              : image.status === 'error'
              ? 'text-red-400 bg-red-400/10'
              : 'text-text-muted bg-bg-base'
          )}
        >
          {image.status}
        </span>
      </div>

      {/* Info */}
      <div className="p-4">
        <p className="text-sm text-text-secondary mb-4">{image.description}</p>

        {/* Path */}
        {image.path && (
          <div className="mb-4">
            <p className="text-xs text-text-muted mb-1">Path:</p>
            <code className="text-xs text-text-secondary bg-bg-base px-2 py-1 rounded block overflow-x-auto">
              {image.path}
            </code>
          </div>
        )}

        {/* Node info */}
        {image.nodeId && (
          <div className="flex items-center gap-1 text-xs text-text-muted mb-4">
            <Server className="w-3 h-3" />
            Node: {image.nodeId}
          </div>
        )}

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="w-full py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 text-red-400 hover:bg-red-500/20"
        >
          <Trash2 className="w-4 h-4" /> Delete
        </button>
      </div>
    </motion.div>
  );
}
