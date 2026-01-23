import { motion, AnimatePresence } from 'framer-motion';
import { X, Disc, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatImageSize } from '@/hooks/useImages';

export interface UploadProgress {
  id: string;
  filename: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  progressPercent: number;
  bytesUploaded: number;
  bytesTotal: number;
  errorMessage?: string;
}

interface UploadProgressToastProps {
  uploads: UploadProgress[];
  onDismiss: (id: string) => void;
}

export function UploadProgressToast({ uploads, onDismiss }: UploadProgressToastProps) {
  if (uploads.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      <AnimatePresence mode="popLayout">
        {uploads.map((upload) => (
          <motion.div
            key={upload.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            className={cn(
              'w-80 p-3 rounded-xl border shadow-lg backdrop-blur-sm',
              upload.status === 'completed'
                ? 'bg-success/10 border-success/30'
                : upload.status === 'failed'
                  ? 'bg-error/10 border-error/30'
                  : 'bg-bg-surface/95 border-border'
            )}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                upload.status === 'completed'
                  ? 'bg-success/20'
                  : upload.status === 'failed'
                    ? 'bg-error/20'
                    : 'bg-warning/20'
              )}>
                {upload.status === 'completed' ? (
                  <CheckCircle className="w-4 h-4 text-success" />
                ) : upload.status === 'failed' ? (
                  <AlertCircle className="w-4 h-4 text-error" />
                ) : (
                  <Disc className="w-4 h-4 text-warning" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {upload.filename}
                  </p>
                  {(upload.status === 'completed' || upload.status === 'failed') && (
                    <button
                      onClick={() => onDismiss(upload.id)}
                      className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Status text */}
                <p className="text-xs text-text-muted mt-0.5">
                  {upload.status === 'uploading' && 'Uploading...'}
                  {upload.status === 'processing' && 'Processing...'}
                  {upload.status === 'completed' && 'Upload complete'}
                  {upload.status === 'failed' && (upload.errorMessage || 'Upload failed')}
                </p>

                {/* Progress bar for active uploads */}
                {(upload.status === 'uploading' || upload.status === 'processing') && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                      <span>{formatImageSize(upload.bytesUploaded)} / {formatImageSize(upload.bytesTotal)}</span>
                      <span>{upload.progressPercent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-bg-base rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-warning rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${upload.progressPercent}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
