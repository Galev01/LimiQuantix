/**
 * Updates API Client
 * 
 * Provides access to the OTA update system for checking, downloading, 
 * and applying system updates.
 */

import { get, post, put } from './client';

// =============================================================================
// Types
// =============================================================================

export interface UpdateCheckResponse {
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  channel: string;
  components: ComponentUpdateInfo[];
  fullImageAvailable: boolean;
  totalDownloadSize: number;
  releaseNotes?: string;
}

export interface ComponentUpdateInfo {
  name: string;
  currentVersion?: string;
  newVersion: string;
  sizeBytes: number;
}

export interface InstalledVersions {
  osVersion: string;
  qxNode?: string;
  qxConsole?: string;
  hostUi?: string;
}

export type UpdateStatusType = 
  | 'idle' 
  | 'checking' 
  | 'up_to_date' 
  | 'available' 
  | 'downloading' 
  | 'applying' 
  | 'complete' 
  | 'error' 
  | 'reboot_required';

export interface UpdateProgress {
  currentComponent: string;
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
}

export interface UpdateStatusResponse {
  status: UpdateStatusType;
  message?: string;
  progress?: UpdateProgress;
}

export interface UpdateConfig {
  enabled: boolean;
  serverUrl: string;
  channel: string;
  checkInterval: string;
  autoApply: boolean;
  storageLocation: 'local' | 'volume';
  volumePath?: string;
}

export interface ApplyUpdateResponse {
  status: 'started' | 'success' | 'error';
  message: string;
}

/**
 * Request to update the update configuration
 */
export interface UpdateConfigRequest {
  serverUrl?: string;
  channel?: string;
  storageLocation?: 'local' | 'volume';
  volumePath?: string;
}

/**
 * Volume information for update storage
 */
export interface UpdateVolumeInfo {
  path: string;
  name: string;
  poolId: string;
  totalBytes: number;
  availableBytes: number;
  isMounted: boolean;
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Check for available updates
 * 
 * Queries the update server for new versions and returns information
 * about available updates.
 */
export async function checkForUpdates(): Promise<UpdateCheckResponse> {
  return get<UpdateCheckResponse>('/updates/check');
}

/**
 * Get currently installed versions
 * 
 * Returns the versions of all installed components (OS, qx-node, host-ui, etc.)
 */
export async function getCurrentVersions(): Promise<InstalledVersions> {
  return get<InstalledVersions>('/updates/current');
}

/**
 * Get current update status
 * 
 * Returns the current state of the update system (idle, downloading, applying, etc.)
 * Poll this endpoint while an update is in progress to get real-time status.
 */
export async function getUpdateStatus(): Promise<UpdateStatusResponse> {
  const result = await get<UpdateStatusResponse>('/updates/status');
  // Log status changes to console for debugging
  console.log('[Updates API] Status:', result.status, result.message || '', result.progress ? `${result.progress.percentage}%` : '');
  return result;
}

/**
 * Apply available updates
 * 
 * Starts the update process in the background. Returns immediately.
 * Poll getUpdateStatus() to track progress.
 */
export async function applyUpdates(): Promise<ApplyUpdateResponse> {
  console.log('[Updates API] Starting update apply request...');
  const result = await post<ApplyUpdateResponse>('/updates/apply');
  console.log('[Updates API] Apply response:', result);
  return result;
}

/**
 * Reset stuck update status
 * 
 * Use this to clear a stuck status if an update process crashed or timed out.
 * Resets the status to 'idle' so a new update can be started.
 */
export interface ResetUpdateResponse {
  success: boolean;
  message: string;
  previousStatus: string;
  currentStatus: string;
}

export async function resetUpdateStatus(): Promise<ResetUpdateResponse> {
  console.log('[Updates API] Resetting update status...');
  const result = await post<ResetUpdateResponse>('/updates/reset');
  console.log('[Updates API] Reset response:', result);
  return result;
}

/**
 * Get update configuration
 * 
 * Returns the current update settings (server URL, channel, auto-apply, etc.)
 */
export async function getUpdateConfig(): Promise<UpdateConfig> {
  return get<UpdateConfig>('/updates/config');
}

/**
 * Save update configuration
 * 
 * Updates the update server URL, channel, and/or storage location.
 * Changes are applied immediately and persisted to node.yaml.
 */
export async function saveUpdateConfig(request: UpdateConfigRequest): Promise<UpdateConfig> {
  return put<UpdateConfig>('/updates/config', request);
}

/**
 * List volumes available for update storage
 * 
 * Returns mounted volumes that can be used as dedicated storage for updates.
 */
export async function listUpdateVolumes(): Promise<UpdateVolumeInfo[]> {
  const response = await get<{ volumes: UpdateVolumeInfo[] }>('/updates/volumes');
  return response.volumes || [];
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get a human-readable status label
 */
export function getStatusLabel(status: UpdateStatusType): string {
  switch (status) {
    case 'idle': return 'Idle';
    case 'checking': return 'Checking...';
    case 'up_to_date': return 'Up to Date';
    case 'available': return 'Update Available';
    case 'downloading': return 'Downloading...';
    case 'applying': return 'Applying...';
    case 'complete': return 'Complete';
    case 'error': return 'Error';
    case 'reboot_required': return 'Reboot Required';
    default: return 'Unknown';
  }
}

/**
 * Get status badge variant for UI display
 */
export function getStatusVariant(status: UpdateStatusType): 'success' | 'warning' | 'error' | 'info' | 'default' {
  switch (status) {
    case 'up_to_date':
    case 'complete':
      return 'success';
    case 'available':
      return 'info';
    case 'checking':
    case 'downloading':
    case 'applying':
    case 'reboot_required':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'default';
  }
}

/**
 * Check if the status indicates an update is in progress
 */
export function isUpdateInProgress(status: UpdateStatusType): boolean {
  return status === 'checking' || status === 'downloading' || status === 'applying';
}
