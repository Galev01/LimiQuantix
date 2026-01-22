/**
 * OTA Update Management Hooks
 * 
 * Document ID: 000083
 * 
 * Provides React hooks for managing OTA updates for Quantix-vDC
 * and connected QHCI hosts.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApiBase } from '@/lib/api-client';

// =============================================================================
// Types
// =============================================================================

export type UpdateStatus = 
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'applying'
  | 'reboot_required'
  | 'error';

export type UpdateChannel = 'dev' | 'beta' | 'stable';

export interface UpdateComponent {
  name: string;
  version: string;
  artifact: string;
  sha256: string;
  size_bytes: number;
  install_path: string;
  restart_service?: string;
}

export interface UpdateManifest {
  product: string;
  version: string;
  channel: string;
  release_date: string;
  update_type: 'component' | 'full';
  components: UpdateComponent[];
  full_image?: {
    artifact: string;
    sha256: string;
    size_bytes: number;
    requires_reboot: boolean;
  };
  min_version: string;
  release_notes: string;
}

export interface VDCUpdateState {
  status: UpdateStatus;
  current_version: string;
  available_version?: string;
  download_progress?: number;
  current_component?: string;
  message?: string;
  error?: string;
  last_check?: string;
  manifest?: UpdateManifest;
}

export interface HostUpdateInfo {
  node_id: string;
  hostname: string;
  management_ip: string;
  current_version: string;
  available_version?: string;
  status: UpdateStatus;
  last_check?: string;
  error?: string;
}

export interface UpdateConfig {
  server_url: string;
  channel: UpdateChannel;
  check_interval: string;
  auto_check: boolean;
  auto_apply: boolean;
  data_dir: string;
}

/**
 * Result of an update operation (persists after completion)
 */
export interface VDCUpdateResult {
  success: boolean;
  version: string;
  previousVersion: string;
  components: string[];
  error?: string;
  completedAt: Date;
}

// =============================================================================
// API Functions
// =============================================================================

const getApiBaseUrl = () => getApiBase();

// vDC Update APIs
async function fetchVDCStatus(): Promise<VDCUpdateState> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/vdc/status`);
  if (!response.ok) {
    throw new Error(`Failed to fetch vDC status: ${response.statusText}`);
  }
  return response.json();
}

async function checkVDCUpdate(): Promise<{
  status: UpdateStatus;
  current_version: string;
  available_version?: string;
  manifest?: UpdateManifest;
}> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/vdc/check`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to check for updates');
  }
  return response.json();
}

async function applyVDCUpdate(): Promise<{ status: string; message: string }> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/vdc/apply`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to apply update');
  }
  return response.json();
}

// Host Update APIs
async function fetchHostsStatus(): Promise<{ hosts: HostUpdateInfo[]; count: number }> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/hosts`);
  if (!response.ok) {
    throw new Error(`Failed to fetch hosts status: ${response.statusText}`);
  }
  return response.json();
}

async function checkAllHostUpdates(): Promise<{
  hosts: HostUpdateInfo[];
  total: number;
  updates_available: number;
}> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/hosts/check`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to check host updates');
  }
  return response.json();
}

async function checkHostUpdate(nodeId: string): Promise<HostUpdateInfo> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/hosts/${nodeId}/check`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to check host update');
  }
  return response.json();
}

async function applyHostUpdate(nodeId: string): Promise<{ status: string; message: string; node_id: string }> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/hosts/${nodeId}/apply`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to apply host update');
  }
  return response.json();
}

// Config APIs
async function fetchUpdateConfig(): Promise<UpdateConfig> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/config`);
  if (!response.ok) {
    throw new Error(`Failed to fetch update config: ${response.statusText}`);
  }
  return response.json();
}

async function updateConfig(config: Partial<UpdateConfig>): Promise<{ status: string; config: UpdateConfig }> {
  const response = await fetch(`${getApiBaseUrl()}/api/v1/updates/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Failed to update config');
  }
  return response.json();
}

// =============================================================================
// Query Keys
// =============================================================================

export const updateKeys = {
  all: ['updates'] as const,
  vdc: () => [...updateKeys.all, 'vdc'] as const,
  vdcStatus: () => [...updateKeys.vdc(), 'status'] as const,
  hosts: () => [...updateKeys.all, 'hosts'] as const,
  hostsStatus: () => [...updateKeys.hosts(), 'status'] as const,
  host: (nodeId: string) => [...updateKeys.hosts(), nodeId] as const,
  config: () => [...updateKeys.all, 'config'] as const,
};

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to get vDC update status (raw query, use useVDCUpdateWithTracking for full lifecycle)
 * Polls faster (2s) when an update is in progress, slower (30s) otherwise
 */
export function useVDCUpdateStatus() {
  return useQuery({
    queryKey: updateKeys.vdcStatus(),
    queryFn: fetchVDCStatus,
    staleTime: 2000, // Consider stale after 2 seconds during updates
    refetchInterval: (query) => {
      const data = query.state.data as VDCUpdateState | undefined;
      // Poll every 2 seconds during download/apply, 30 seconds otherwise
      if (data?.status === 'downloading' || data?.status === 'applying') {
        return 2000;
      }
      return 30000;
    },
  });
}

/**
 * Hook that tracks the full vDC update lifecycle including completion state
 * Returns the update result that persists after completion until dismissed
 */
export function useVDCUpdateWithTracking() {
  const query = useVDCUpdateStatus();
  const [updateResult, setUpdateResult] = useState<VDCUpdateResult | null>(null);
  const [isUpdateInProgress, setIsUpdateInProgress] = useState(false);
  
  // Track the version and components we're updating to
  const updateTargetRef = useRef<{
    version: string;
    previousVersion: string;
    components: string[];
  } | null>(null);

  // Detect when update starts
  useEffect(() => {
    const status = query.data?.status;
    
    if ((status === 'downloading' || status === 'applying') && !isUpdateInProgress) {
      // Update just started
      setIsUpdateInProgress(true);
      setUpdateResult(null); // Clear any previous result
      
      // Store the target version and components
      if (query.data?.available_version && query.data?.manifest) {
        updateTargetRef.current = {
          version: query.data.available_version,
          previousVersion: query.data.current_version,
          components: query.data.manifest.components.map(c => c.name),
        };
      }
    }
  }, [query.data?.status, isUpdateInProgress, query.data?.available_version, query.data?.manifest, query.data?.current_version]);

  // Detect when update completes (success or error)
  useEffect(() => {
    const status = query.data?.status;
    
    if (isUpdateInProgress && status !== 'downloading' && status !== 'applying') {
      // Update finished
      setIsUpdateInProgress(false);
      
      if (status === 'error' && query.data?.error) {
        // Update failed
        setUpdateResult({
          success: false,
          version: updateTargetRef.current?.version || 'unknown',
          previousVersion: updateTargetRef.current?.previousVersion || 'unknown',
          components: updateTargetRef.current?.components || [],
          error: query.data.error,
          completedAt: new Date(),
        });
      } else if (status === 'idle' && updateTargetRef.current) {
        // Update succeeded
        setUpdateResult({
          success: true,
          version: updateTargetRef.current.version,
          previousVersion: updateTargetRef.current.previousVersion,
          components: updateTargetRef.current.components,
          completedAt: new Date(),
        });
        toast.success(`Successfully updated to v${updateTargetRef.current.version}`);
      }
      
      updateTargetRef.current = null;
    }
  }, [query.data?.status, query.data?.error, isUpdateInProgress]);

  const clearUpdateResult = useCallback(() => {
    setUpdateResult(null);
  }, []);

  return {
    ...query,
    updateResult,
    clearUpdateResult,
    isUpdateInProgress,
  };
}

/**
 * Hook to check for vDC updates
 */
export function useCheckVDCUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: checkVDCUpdate,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: updateKeys.vdcStatus() });
      if (data.available_version) {
        toast.success(`Update available: v${data.available_version}`);
      } else {
        toast.info('Quantix-vDC is up to date');
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to check for updates: ${error.message}`);
    },
  });
}

/**
 * Hook to apply vDC update
 */
export function useApplyVDCUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: applyVDCUpdate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.vdcStatus() });
      toast.success('Update started. This may take a few minutes...');
    },
    onError: (error: Error) => {
      toast.error(`Failed to apply update: ${error.message}`);
    },
  });
}

/**
 * Hook to get all hosts update status
 */
export function useHostsUpdateStatus() {
  return useQuery({
    queryKey: updateKeys.hostsStatus(),
    queryFn: fetchHostsStatus,
    staleTime: 10000,
    refetchInterval: 30000,
  });
}

/**
 * Hook to check all hosts for updates
 */
export function useCheckAllHostUpdates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: checkAllHostUpdates,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: updateKeys.hostsStatus() });
      
      // Count hosts with different statuses
      const errorCount = data.hosts?.filter(h => h.status === 'error').length || 0;
      const upToDateCount = data.hosts?.filter(h => h.status === 'idle').length || 0;
      
      if (data.updates_available > 0) {
        toast.success(`${data.updates_available} host(s) have updates available`);
      } else if (errorCount > 0 && errorCount === data.total) {
        // All hosts have errors
        toast.error(`Failed to check ${errorCount} host(s) - check host connectivity`);
      } else if (errorCount > 0) {
        // Some hosts have errors
        toast.warning(`${upToDateCount} host(s) up to date, ${errorCount} host(s) had errors`);
      } else {
        toast.info('All hosts are up to date');
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to check host updates: ${error.message}`);
    },
  });
}

/**
 * Hook to check a specific host for updates
 */
export function useCheckHostUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: checkHostUpdate,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: updateKeys.hostsStatus() });
      if (data.available_version) {
        toast.success(`Update available for ${data.hostname}: v${data.available_version}`);
      } else {
        toast.info(`${data.hostname} is up to date`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to check host update: ${error.message}`);
    },
  });
}

/**
 * Hook to apply update to a specific host
 */
export function useApplyHostUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: applyHostUpdate,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: updateKeys.hostsStatus() });
      toast.success(`Update started on host`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to apply host update: ${error.message}`);
    },
  });
}

/**
 * Hook to get update configuration
 */
export function useUpdateConfig() {
  return useQuery({
    queryKey: updateKeys.config(),
    queryFn: fetchUpdateConfig,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to update configuration
 */
export function useUpdateConfigMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: updateKeys.config() });
      toast.success('Update configuration saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save configuration: ${error.message}`);
    },
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Get status color for display
 */
export function getStatusColor(status: UpdateStatus): string {
  switch (status) {
    case 'idle':
      return 'text-text-muted';
    case 'checking':
    case 'downloading':
    case 'applying':
      return 'text-info';
    case 'available':
      return 'text-success';
    case 'reboot_required':
      return 'text-warning';
    case 'error':
      return 'text-error';
    default:
      return 'text-text-muted';
  }
}

/**
 * Get human-readable status label
 */
export function getStatusLabel(status: UpdateStatus): string {
  switch (status) {
    case 'idle':
      return 'Up to date';
    case 'checking':
      return 'Checking...';
    case 'available':
      return 'Update available';
    case 'downloading':
      return 'Downloading...';
    case 'applying':
      return 'Applying update...';
    case 'reboot_required':
      return 'Reboot required';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
