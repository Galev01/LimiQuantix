/**
 * React hooks for the OTA update system
 * 
 * Provides React Query hooks for interacting with the update API.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { uiLogger } from '@/lib/uiLogger';
import {
  checkForUpdates,
  getCurrentVersions,
  getUpdateStatus,
  applyUpdates,
  resetUpdateStatus,
  getUpdateConfig,
  saveUpdateConfig,
  listUpdateVolumes,
  isUpdateInProgress,
  type UpdateCheckResponse,
  type InstalledVersions,
  type UpdateStatusResponse,
  type UpdateConfig,
  type UpdateConfigRequest,
  type UpdateVolumeInfo,
  type UpdateStatusType,
  type ResetUpdateResponse,
} from '@/api/updates';

// =============================================================================
// Query Keys
// =============================================================================

export const updateKeys = {
  all: ['updates'] as const,
  check: () => [...updateKeys.all, 'check'] as const,
  current: () => [...updateKeys.all, 'current'] as const,
  status: () => [...updateKeys.all, 'status'] as const,
  config: () => [...updateKeys.all, 'config'] as const,
  volumes: () => [...updateKeys.all, 'volumes'] as const,
};

// =============================================================================
// Queries
// =============================================================================

/**
 * Get currently installed versions
 * 
 * Fetches version info for OS, qx-node, and other components.
 * Refetches every minute.
 */
export function useInstalledVersions() {
  return useQuery<InstalledVersions>({
    queryKey: updateKeys.current(),
    queryFn: getCurrentVersions,
    staleTime: 60_000, // 1 minute
    refetchOnWindowFocus: false,
  });
}

/**
 * Get current update status
 * 
 * Polls for status updates. When an update is in progress,
 * automatically polls every 2 seconds.
 */
export function useUpdateStatus(options?: { 
  enabled?: boolean;
  pollingEnabled?: boolean;
}) {
  const query = useQuery<UpdateStatusResponse>({
    queryKey: updateKeys.status(),
    queryFn: getUpdateStatus,
    staleTime: 2_000, // 2 seconds - shorter for better responsiveness
    refetchOnWindowFocus: true,
    enabled: options?.enabled ?? true,
    // Dynamic polling: poll every 2 seconds when update is in progress
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 5_000; // Poll every 5s until we get initial data
      if (isUpdateInProgress(data.status)) return 2_000; // Poll every 2s during update
      return false; // Stop polling when idle/complete/error
    },
  });

  return query;
}

/**
 * Get update configuration
 * 
 * Returns server URL, channel, and other update settings.
 */
export function useUpdateConfig() {
  return useQuery<UpdateConfig>({
    queryKey: updateKeys.config(),
    queryFn: getUpdateConfig,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Check for available updates
 * 
 * Triggers a check against the update server. Shows toast notifications
 * for success/failure.
 */
export function useCheckForUpdates() {
  const queryClient = useQueryClient();

  return useMutation<UpdateCheckResponse>({
    mutationFn: checkForUpdates,
    onSuccess: (data) => {
      // Invalidate status query to reflect new state
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
      
      if (data.available) {
        toast.success(`Update available: v${data.latestVersion}`);
      } else {
        toast.info('System is up to date');
      }
    },
    onError: (error) => {
      toast.error(`Failed to check for updates: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });
}

/**
 * Apply available updates
 * 
 * Starts the update process in the background. 
 * Use useUpdateStatus() to poll for progress.
 */
export function useApplyUpdates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: applyUpdates,
    onSuccess: () => {
      console.log('[useApplyUpdates] Update started successfully');
      toast.success('Update started - monitoring progress...');
      // Immediately refetch status to start polling
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
      // Also refetch after a short delay to ensure we catch the status change
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: updateKeys.status() });
      }, 500);
    },
    onError: (error) => {
      console.error('[useApplyUpdates] Failed to start update:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Check for "already in progress" error
      if (errorMessage.includes('already in progress')) {
        toast.info('Update already in progress - monitoring...');
        queryClient.invalidateQueries({ queryKey: updateKeys.status() });
      } else {
        toast.error(`Failed to start update: ${errorMessage}`);
      }
    },
  });
}

/**
 * Reset stuck update status
 * 
 * Use this to clear a stuck status if the update process crashed.
 */
export function useResetUpdateStatus() {
  const queryClient = useQueryClient();

  return useMutation<ResetUpdateResponse>({
    mutationFn: resetUpdateStatus,
    onSuccess: (data) => {
      console.log('[useResetUpdateStatus] Status reset:', data);
      toast.success(`Update status reset: ${data.previousStatus} → ${data.currentStatus}`);
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    },
    onError: (error) => {
      console.error('[useResetUpdateStatus] Failed to reset:', error);
      toast.error(`Failed to reset update status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });
}

/**
 * Save update configuration
 * 
 * Updates the update server URL, channel, and/or storage location.
 * Shows toast notifications for success/failure.
 */
export function useSaveUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation<UpdateConfig, Error, UpdateConfigRequest>({
    mutationFn: saveUpdateConfig,
    onSuccess: () => {
      toast.success('Update settings saved');
      // Invalidate config to refetch with new values
      queryClient.invalidateQueries({ queryKey: updateKeys.config() });
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });
}

/**
 * Get volumes available for update storage
 * 
 * Returns mounted volumes that can be used as dedicated storage for updates.
 */
export function useUpdateVolumes() {
  return useQuery<UpdateVolumeInfo[]>({
    queryKey: updateKeys.volumes(),
    queryFn: listUpdateVolumes,
    staleTime: 30_000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

// =============================================================================
// Update Result Tracking
// =============================================================================

/**
 * Result of an update operation
 */
export interface UpdateResult {
  success: boolean;
  status: UpdateStatusType;
  message?: string;
  version?: string;
  timestamp: Date;
}

// =============================================================================
// Composite Hook
// =============================================================================

/**
 * Combined hook for the Updates tab
 * 
 * Provides all necessary data and actions for the updates UI,
 * including completion tracking and progress logging.
 */
export function useUpdatesTab() {
  const versions = useInstalledVersions();
  const status = useUpdateStatus();
  const config = useUpdateConfig();
  const volumes = useUpdateVolumes();
  const checkMutation = useCheckForUpdates();
  const applyMutation = useApplyUpdates();
  const saveConfigMutation = useSaveUpdateConfig();
  const resetMutation = useResetUpdateStatus();

  // Track the last update result for showing completion/error messages
  const [lastUpdateResult, setLastUpdateResult] = useState<UpdateResult | null>(null);
  
  // Track progress milestones for logging
  const lastLoggedMilestone = useRef<number>(0);
  const updateCorrelationId = useRef<string | null>(null);

  const isUpdating = status.data ? isUpdateInProgress(status.data.status) : false;
  const currentStatus = status.data?.status;

  // Log progress milestones (25%, 50%, 75%, 100%)
  useEffect(() => {
    if (currentStatus === 'downloading' && status.data?.progress) {
      const percentage = status.data.progress.percentage;
      const milestones = [25, 50, 75, 100];
      
      for (const milestone of milestones) {
        if (percentage >= milestone && lastLoggedMilestone.current < milestone) {
          lastLoggedMilestone.current = milestone;
          uiLogger.log(
            'info',
            'button.click', // Using button.click as a proxy for progress event
            'updates',
            `progress-${milestone}`,
            `Update download progress: ${milestone}%`,
            {
              percentage,
              component: status.data.progress.currentComponent,
              downloadedBytes: status.data.progress.downloadedBytes,
              totalBytes: status.data.progress.totalBytes,
              correlationId: updateCorrelationId.current,
            }
          );
        }
      }
    }
  }, [currentStatus, status.data?.progress]);

  // Track status transitions to detect completion/error
  const previousStatus = useRef<UpdateStatusType | undefined>(undefined);
  
  useEffect(() => {
    const prevStatus = previousStatus.current;
    const currStatus = currentStatus;
    
    // Detect transition from in-progress to terminal state
    if (prevStatus && isUpdateInProgress(prevStatus) && currStatus && !isUpdateInProgress(currStatus)) {
      const isSuccess = currStatus === 'complete';
      const isError = currStatus === 'error';
      const isRebootRequired = currStatus === 'reboot_required';
      
      if (isSuccess || isError || isRebootRequired) {
        const result: UpdateResult = {
          success: isSuccess || isRebootRequired,
          status: currStatus,
          message: status.data?.message,
          timestamp: new Date(),
        };
        
        // Extract version from message if available
        const versionMatch = status.data?.message?.match(/version\s+([\d.]+)/i);
        if (versionMatch) {
          result.version = versionMatch[1];
        }
        
        setLastUpdateResult(result);
        
        // Log completion
        if (isSuccess) {
          uiLogger.success('updates', 'apply-update', `Update completed successfully${result.version ? ` to version ${result.version}` : ''}`, {
            version: result.version,
            correlationId: updateCorrelationId.current,
          });
          toast.success(`Update complete${result.version ? `: v${result.version}` : ''}`);
        } else if (isError) {
          uiLogger.error('updates', 'apply-update', status.data?.message || 'Update failed', {
            correlationId: updateCorrelationId.current,
          });
        } else if (isRebootRequired) {
          uiLogger.success('updates', 'apply-update', 'Update applied, reboot required', {
            correlationId: updateCorrelationId.current,
          });
          toast.info('Update applied. Reboot required to complete.');
        }
        
        // Reset milestone tracking
        lastLoggedMilestone.current = 0;
        updateCorrelationId.current = null;
        
        // Refetch versions to show updated info
        versions.refetch();
      }
    }
    
    previousStatus.current = currStatus;
  }, [currentStatus, status.data?.message, versions]);

  // Clear the last update result
  const clearUpdateResult = useCallback(() => {
    setLastUpdateResult(null);
  }, []);

  // Enhanced check for updates with logging
  const handleCheckForUpdates = useCallback(() => {
    uiLogger.click('updates', 'check-updates-btn');
    checkMutation.mutate();
  }, [checkMutation]);

  // Enhanced apply updates with logging and correlation ID
  const handleApplyUpdates = useCallback(() => {
    updateCorrelationId.current = uiLogger.generateCorrelationId();
    lastLoggedMilestone.current = 0;
    
    uiLogger.click('updates', 'apply-update-btn', {
      correlationId: updateCorrelationId.current,
    });
    
    uiLogger.log(
      'info',
      'button.click',
      'updates',
      'update-started',
      'Update process started',
      {
        correlationId: updateCorrelationId.current,
        availableVersion: checkMutation.data?.latestVersion,
        components: checkMutation.data?.components?.map(c => c.name),
      }
    );
    
    applyMutation.mutate();
  }, [applyMutation, checkMutation.data]);

  // Enhanced retry with logging
  const handleRetry = useCallback(() => {
    uiLogger.click('updates', 'retry-update-btn', {
      previousError: lastUpdateResult?.message,
    });
    setLastUpdateResult(null);
    handleApplyUpdates();
  }, [handleApplyUpdates, lastUpdateResult?.message]);

  return {
    // Data
    versions: versions.data,
    versionsLoading: versions.isLoading,
    status: status.data,
    statusLoading: status.isLoading,
    config: config.data,
    configLoading: config.isLoading,
    volumes: volumes.data,
    volumesLoading: volumes.isLoading,
    
    // Check result from last check mutation
    checkResult: checkMutation.data,
    
    // Update result tracking
    lastUpdateResult,
    clearUpdateResult,
    
    // States
    isUpdating,
    isChecking: checkMutation.isPending,
    isApplying: applyMutation.isPending,
    isSavingConfig: saveConfigMutation.isPending,
    isResetting: resetMutation.isPending,
    
    // Actions (with logging)
    checkForUpdates: handleCheckForUpdates,
    applyUpdates: handleApplyUpdates,
    retryUpdate: handleRetry,
    resetUpdateStatus: () => {
      console.log('[useUpdatesTab] Resetting update status...');
      uiLogger.click('updates', 'reset-status-btn');
      resetMutation.mutate();
    },
    saveConfig: (request: UpdateConfigRequest) => {
      uiLogger.submit('updates', 'update-config-form', { 
        serverUrl: request.serverUrl ? '(set)' : undefined,
        channel: request.channel,
        storageLocation: request.storageLocation,
      });
      saveConfigMutation.mutate(request);
    },
    
    // Refetch functions
    refetchStatus: status.refetch,
    refetchVersions: versions.refetch,
    refetchConfig: config.refetch,
    refetchVolumes: volumes.refetch,
  };
}
