/**
 * React hooks for the OTA update system
 * 
 * Provides React Query hooks for interacting with the update API.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import {
  checkForUpdates,
  getCurrentVersions,
  getUpdateStatus,
  applyUpdates,
  getUpdateConfig,
  isUpdateInProgress,
  type UpdateCheckResponse,
  type InstalledVersions,
  type UpdateStatusResponse,
  type UpdateConfig,
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
    staleTime: 5_000, // 5 seconds
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });

  // Dynamic polling based on status
  const shouldPoll = options?.pollingEnabled ?? 
    (query.data && isUpdateInProgress(query.data.status));

  return useQuery<UpdateStatusResponse>({
    queryKey: updateKeys.status(),
    queryFn: getUpdateStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchInterval: shouldPoll ? 2_000 : false,
    enabled: options?.enabled ?? true,
  });
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
      toast.success('Update started');
      // Start polling status
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    },
    onError: (error) => {
      toast.error(`Failed to start update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    },
  });
}

// =============================================================================
// Composite Hook
// =============================================================================

/**
 * Combined hook for the Updates tab
 * 
 * Provides all necessary data and actions for the updates UI.
 */
export function useUpdatesTab() {
  const versions = useInstalledVersions();
  const status = useUpdateStatus();
  const config = useUpdateConfig();
  const checkMutation = useCheckForUpdates();
  const applyMutation = useApplyUpdates();

  const isUpdating = status.data ? isUpdateInProgress(status.data.status) : false;

  return {
    // Data
    versions: versions.data,
    versionsLoading: versions.isLoading,
    status: status.data,
    statusLoading: status.isLoading,
    config: config.data,
    configLoading: config.isLoading,
    
    // Check result from last check mutation
    checkResult: checkMutation.data,
    
    // States
    isUpdating,
    isChecking: checkMutation.isPending,
    isApplying: applyMutation.isPending,
    
    // Actions
    checkForUpdates: () => checkMutation.mutate(),
    applyUpdates: () => applyMutation.mutate(),
    
    // Refetch functions
    refetchStatus: status.refetch,
    refetchVersions: versions.refetch,
  };
}
