/**
 * Update Progress Card Component
 * 
 * Displays the current state of an update operation with visual feedback
 * including progress bar, status messages, and action buttons.
 */

import { Download, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { Card, Button, ProgressBar } from '@/components/ui';
import { formatBytes } from '@/api/updates';
import type { UpdateStatusResponse, UpdateCheckResponse } from '@/api/updates';
import { cn } from '@/lib/utils';

export interface UpdateProgressCardProps {
  /** Current update status from the API */
  status: UpdateStatusResponse | undefined;
  /** Check result with available update info */
  checkResult?: UpdateCheckResponse;
  /** Whether an update is currently in progress */
  isUpdating: boolean;
  /** Callback when user clicks retry after an error */
  onRetry?: () => void;
  /** Callback when user dismisses the card */
  onDismiss?: () => void;
  /** Additional class names */
  className?: string;
}

export function UpdateProgressCard({
  status,
  checkResult,
  isUpdating,
  onRetry,
  onDismiss,
  className,
}: UpdateProgressCardProps) {
  if (!status) {
    return null;
  }

  const { status: statusType, message, progress } = status;

  // Determine what to render based on status
  const renderContent = () => {
    switch (statusType) {
      case 'downloading':
        return <DownloadingState progress={progress} />;
      
      case 'applying':
        return <ApplyingState message={message} />;
      
      case 'checking':
        return <CheckingState />;
      
      case 'complete':
        return (
          <CompleteState 
            message={message} 
            checkResult={checkResult}
            onDismiss={onDismiss} 
          />
        );
      
      case 'error':
        return (
          <ErrorState 
            message={message} 
            onRetry={onRetry} 
            onDismiss={onDismiss} 
          />
        );
      
      case 'reboot_required':
        return <RebootRequiredState onDismiss={onDismiss} />;
      
      default:
        // For idle, up_to_date, available - don't show this card
        return null;
    }
  };

  const content = renderContent();
  
  // Don't render if there's no relevant content
  if (!content && !isUpdating) {
    return null;
  }

  return (
    <Card className={cn('relative', className)}>
      {content}
    </Card>
  );
}

// =============================================================================
// Sub-components for each state
// =============================================================================

interface DownloadingStateProps {
  progress?: {
    currentComponent: string;
    downloadedBytes: number;
    totalBytes: number;
    percentage: number;
  };
}

function DownloadingState({ progress }: DownloadingStateProps) {
  const percentage = progress?.percentage ?? 0;
  const currentComponent = progress?.currentComponent || 'update';
  const downloadedBytes = progress?.downloadedBytes ?? 0;
  const totalBytes = progress?.totalBytes ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-info/10">
          <Download className="w-5 h-5 text-info animate-pulse" />
        </div>
        <div>
          <h4 className="font-semibold text-text-primary">Downloading Update</h4>
          <p className="text-sm text-text-muted">
            Component: <span className="text-text-secondary font-mono">{currentComponent}</span>
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <ProgressBar 
          value={percentage} 
          color="info" 
          size="lg"
          showLabel
          labelPosition="above"
          animated
        />
        
        {/* Download stats */}
        <div className="flex justify-between text-sm text-text-muted">
          <span>{formatBytes(downloadedBytes)} downloaded</span>
          <span>{formatBytes(totalBytes)} total</span>
        </div>
      </div>

      {/* Tip */}
      <p className="text-xs text-text-muted">
        Please do not close this page or restart the system while the update is in progress.
      </p>
    </div>
  );
}

interface ApplyingStateProps {
  message?: string;
}

function ApplyingState({ message }: ApplyingStateProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-warning/10">
          <Loader2 className="w-5 h-5 text-warning animate-spin" />
        </div>
        <div>
          <h4 className="font-semibold text-text-primary">Applying Update</h4>
          <p className="text-sm text-text-muted">
            {message || 'Installing components...'}
          </p>
        </div>
      </div>

      {/* Indeterminate progress */}
      <ProgressBar 
        value={0} 
        color="warning" 
        size="md"
        indeterminate
      />

      {/* Warning */}
      <div className="flex items-start gap-2 p-3 bg-warning/10 border border-warning/20 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
        <p className="text-sm text-text-muted">
          Do not power off or restart the system during this process.
        </p>
      </div>
    </div>
  );
}

function CheckingState() {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-info/10">
        <Loader2 className="w-5 h-5 text-info animate-spin" />
      </div>
      <div>
        <h4 className="font-semibold text-text-primary">Checking for Updates</h4>
        <p className="text-sm text-text-muted">
          Contacting update server...
        </p>
      </div>
    </div>
  );
}

interface CompleteStateProps {
  message?: string;
  checkResult?: UpdateCheckResponse;
  onDismiss?: () => void;
}

function CompleteState({ message, checkResult, onDismiss }: CompleteStateProps) {
  // Extract version from message if available (format: "Updated to version X.X.X")
  const versionMatch = message?.match(/version\s+([\d.]+)/i);
  const version = versionMatch?.[1] || checkResult?.latestVersion;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-success/10">
            <CheckCircle2 className="w-5 h-5 text-success" />
          </div>
          <div>
            <h4 className="font-semibold text-text-primary">Update Complete!</h4>
            {version && (
              <p className="text-sm text-text-muted">
                Successfully updated to version <span className="font-mono text-success">{version}</span>
              </p>
            )}
          </div>
        </div>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Updated components */}
      {checkResult?.components && checkResult.components.length > 0 && (
        <div className="p-3 bg-success/5 border border-success/20 rounded-lg">
          <p className="text-xs text-text-muted mb-2">Updated components:</p>
          <div className="flex flex-wrap gap-2">
            {checkResult.components.map((comp) => (
              <span 
                key={comp.name}
                className="px-2 py-1 text-xs font-mono bg-bg-surface rounded text-text-secondary"
              >
                {comp.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Dismiss button */}
      {onDismiss && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

function ErrorState({ message, onRetry, onDismiss }: ErrorStateProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-error/10">
            <XCircle className="w-5 h-5 text-error" />
          </div>
          <div>
            <h4 className="font-semibold text-text-primary">Update Failed</h4>
            <p className="text-sm text-error">
              {message || 'An unknown error occurred'}
            </p>
          </div>
        </div>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Error details */}
      {message && (
        <div className="p-3 bg-error/5 border border-error/20 rounded-lg">
          <p className="text-sm text-text-muted font-mono break-all">
            {message}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

interface RebootRequiredStateProps {
  onDismiss?: () => void;
}

function RebootRequiredState({ onDismiss }: RebootRequiredStateProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-warning/10">
            <AlertTriangle className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h4 className="font-semibold text-text-primary">Reboot Required</h4>
            <p className="text-sm text-text-muted">
              A system reboot is required to complete the update.
            </p>
          </div>
        </div>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Info */}
      <div className="p-3 bg-warning/10 border border-warning/20 rounded-lg">
        <p className="text-sm text-text-muted">
          Please schedule a maintenance window and reboot the system to apply the updates.
          Services may be temporarily unavailable during the reboot.
        </p>
      </div>

      {/* Dismiss */}
      {onDismiss && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onDismiss}>
            Acknowledge
          </Button>
        </div>
      )}
    </div>
  );
}

export default UpdateProgressCard;
