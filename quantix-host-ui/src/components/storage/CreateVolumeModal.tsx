import { useState, useEffect } from 'react';
import { X, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui';
import { useVolumeOps, useImages } from '@/hooks/useStorage';

interface CreateVolumeModalProps {
  poolId: string;
  onClose: () => void;
  /** Volume purpose - affects default name and size */
  purpose?: 'general' | 'updates';
}

export function CreateVolumeModal({ poolId, onClose, purpose = 'general' }: CreateVolumeModalProps) {
  const volumeOps = useVolumeOps(poolId);
  const { data: images } = useImages();
  
  // Default values based on purpose
  const defaultName = purpose === 'updates' ? 'updates-storage' : '';
  const defaultSize = purpose === 'updates' ? 20 : 20;
  
  const [volumeId, setVolumeId] = useState(defaultName);
  const [sizeGib, setSizeGib] = useState(defaultSize);
  const [sourceType, setSourceType] = useState<'EMPTY' | 'IMAGE'>('EMPTY');
  const [selectedImage, setSelectedImage] = useState('');
  
  // Reset to defaults when purpose changes
  useEffect(() => {
    setVolumeId(purpose === 'updates' ? 'updates-storage' : '');
    setSizeGib(purpose === 'updates' ? 20 : 20);
    if (purpose === 'updates') {
      // Updates volumes are always empty
      setSourceType('EMPTY');
    }
  }, [purpose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    volumeOps.create.mutate(
      {
        volumeId,
        sizeBytes: sizeGib * 1024 * 1024 * 1024,
        sourceType,
        sourceId: sourceType === 'IMAGE' ? selectedImage : undefined,
      },
      {
        onSuccess: () => onClose(),
      }
    );
  };

  const modalTitle = purpose === 'updates' ? 'Create Updates Volume' : 'Create Volume';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-surface rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">
            {modalTitle}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Updates purpose info banner */}
          {purpose === 'updates' && (
            <div className="flex items-start gap-3 p-3 bg-info/10 border border-info/20 rounded-lg">
              <HardDrive className="w-5 h-5 text-info mt-0.5" />
              <div>
                <p className="text-sm font-medium text-text-secondary">Updates Storage Volume</p>
                <p className="text-xs text-text-muted mt-1">
                  This volume will be used to store downloaded system updates. 
                  Recommended size is 20 GiB minimum.
                </p>
              </div>
            </div>
          )}

          {/* Volume ID */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Volume Name
            </label>
            <input
              type="text"
              value={volumeId}
              onChange={(e) => setVolumeId(e.target.value)}
              placeholder="my-disk"
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
              required
            />
          </div>

          {/* Source Type */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Volume Type
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSourceType('EMPTY')}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all ${
                  sourceType === 'EMPTY'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-secondary hover:border-border-hover'
                }`}
              >
                Empty Disk
              </button>
              <button
                type="button"
                onClick={() => setSourceType('IMAGE')}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-all ${
                  sourceType === 'IMAGE'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-secondary hover:border-border-hover'
                }`}
              >
                From Image
              </button>
            </div>
          </div>

          {/* Size */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Size (GiB)
            </label>
            <input
              type="number"
              value={sizeGib}
              onChange={(e) => setSizeGib(parseInt(e.target.value) || 1)}
              min={1}
              max={10240}
              className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              required
            />
            <p className="text-xs text-text-muted mt-1">
              {purpose === 'updates' 
                ? 'Recommended: 20 GiB minimum for update staging area'
                : 'Minimum 1 GiB, maximum 10 TiB'}
            </p>
          </div>

          {/* Image Selection */}
          {sourceType === 'IMAGE' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Base Image
              </label>
              <select
                value={selectedImage}
                onChange={(e) => setSelectedImage(e.target.value)}
                className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                required
              >
                <option value="">Select an image...</option>
                {images?.map(image => (
                  <option key={image.imageId} value={image.path}>
                    {image.name}
                  </option>
                ))}
              </select>
              {(!images || images.length === 0) && (
                <p className="text-xs text-warning mt-1">
                  No images available. Upload an ISO or cloud image first.
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                volumeOps.create.isPending ||
                !volumeId ||
                (sourceType === 'IMAGE' && !selectedImage)
              }
            >
              {volumeOps.create.isPending ? 'Creating...' : 'Create Volume'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
