/**
 * OVA Template Upload Hooks
 * 
 * Provides React hooks for uploading and managing OVA templates.
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// =============================================================================
// Types
// =============================================================================

export interface OVAMetadata {
  vmName: string;
  description: string;
  osInfo?: {
    osId: number;
    osDescription: string;
    osFamily: string;
  };
  hardware?: {
    cpuCount: number;
    memoryMib: number;
    firmware: string;
  };
  disks?: Array<{
    diskId: string;
    fileRef: string;
    capacityBytes: number;
    populatedSizeBytes: number;
    format: string;
    controllerType: string;
    addressOnParent: number;
    convertedPath?: string;
  }>;
  networks?: Array<{
    name: string;
    description: string;
    adapterType: string;
    instanceId: number;
  }>;
  product?: {
    product: string;
    vendor: string;
    version: string;
    fullVersion: string;
    productUrl: string;
    vendorUrl: string;
  };
}

export interface OVAUploadResponse {
  jobId: string;
  message: string;
  filename: string;
  size: number;
}

export interface OVAUploadStatus {
  jobId: string;
  status: 'UNKNOWN' | 'UPLOADING' | 'EXTRACTING' | 'PARSING' | 'CONVERTING' | 'COMPLETED' | 'FAILED';
  progressPercent: number;
  currentStep: string;
  bytesUploaded: number;
  bytesTotal: number;
  imageId?: string;
  errorMessage?: string;
  metadata?: OVAMetadata;
}

export interface OVATemplate {
  id: string;
  name: string;
  description: string;
  format: string;
  status: {
    phase: string;
    sizeBytes: number;
    virtualSizeBytes: number;
  };
  spec: {
    ovaMetadata?: OVAMetadata;
    os?: {
      family: string;
      distribution: string;
      version: string;
    };
    requirements?: {
      minCpu: number;
      minMemoryMib: number;
      minDiskGib: number;
    };
  };
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// API Configuration
// =============================================================================

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// =============================================================================
// API Functions
// =============================================================================

/**
 * Upload an OVA file to the server with progress tracking.
 */
async function uploadOVAFile(
  file: File,
  onProgress?: (progress: { loaded: number; total: number; percent: number }) => void
): Promise<OVAUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch {
          reject(new Error('Invalid response from server'));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.message || `Upload failed: ${xhr.statusText}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.statusText}`));
        }
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'));
    });

    xhr.open('POST', `${API_BASE_URL}/api/v1/ova/upload`);
    xhr.send(formData);
  });
}

/**
 * Get the status of an OVA upload job.
 */
async function getOVAUploadStatus(jobId: string): Promise<OVAUploadStatus> {
  const response = await fetch(`${API_BASE_URL}/api/v1/ova/status/${jobId}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to get status' }));
    throw new Error(error.message || `Failed to get status: ${response.statusText}`);
  }

  return response.json();
}

/**
 * List all OVA templates.
 */
async function listOVATemplates(): Promise<OVATemplate[]> {
  // Use the Connect-RPC endpoint for listing OVA templates
  const response = await fetch(`${API_BASE_URL}/limiquantix.storage.v1.OVAService/ListOVATemplates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to list templates' }));
    throw new Error(error.message || `Failed to list templates: ${response.statusText}`);
  }

  const data = await response.json();
  return data.templates || [];
}

/**
 * Get a specific OVA template by ID.
 */
async function getOVATemplate(id: string): Promise<OVATemplate> {
  const response = await fetch(`${API_BASE_URL}/limiquantix.storage.v1.OVAService/GetOVATemplate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to get template' }));
    throw new Error(error.message || `Failed to get template: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete an OVA template.
 */
async function deleteOVATemplate(id: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/limiquantix.storage.v1.OVAService/DeleteOVATemplate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Failed to delete template' }));
    throw new Error(error.message || `Failed to delete template: ${response.statusText}`);
  }
}

// =============================================================================
// React Hooks
// =============================================================================

/**
 * Upload progress state
 */
export interface OVAUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

/**
 * Hook to upload an OVA file with progress tracking.
 * 
 * @example
 * ```tsx
 * const { uploadOVA, progress, isUploading, reset } = useUploadOVAWithProgress();
 * 
 * const handleUpload = async (file: File) => {
 *   try {
 *     const result = await uploadOVA(file);
 *     console.log('Job ID:', result.jobId);
 *   } catch (error) {
 *     console.error('Upload failed:', error);
 *   }
 * };
 * 
 * // Display progress
 * if (isUploading) {
 *   console.log(`${progress?.percent}% uploaded`);
 * }
 * ```
 */
export function useUploadOVAWithProgress() {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<OVAUploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const uploadOVA = useCallback(async (file: File): Promise<OVAUploadResponse> => {
    setIsUploading(true);
    setError(null);
    setProgress({ loaded: 0, total: file.size, percent: 0 });

    try {
      const result = await uploadOVAFile(file, (prog) => {
        setProgress(prog);
      });
      
      // Invalidate queries on success
      queryClient.invalidateQueries({ queryKey: ['ova-templates'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
      
      return result;
    } catch (err) {
      const uploadError = err instanceof Error ? err : new Error('Upload failed');
      setError(uploadError);
      throw uploadError;
    } finally {
      setIsUploading(false);
    }
  }, [queryClient]);

  const reset = useCallback(() => {
    setProgress(null);
    setIsUploading(false);
    setError(null);
  }, []);

  return { uploadOVA, progress, isUploading, error, reset };
}

/**
 * Hook to upload an OVA file (legacy, without progress tracking).
 * 
 * @example
 * ```tsx
 * const uploadOVA = useUploadOVA();
 * 
 * const handleUpload = async (file: File) => {
 *   try {
 *     const result = await uploadOVA.mutateAsync(file);
 *     console.log('Job ID:', result.jobId);
 *   } catch (error) {
 *     console.error('Upload failed:', error);
 *   }
 * };
 * ```
 */
export function useUploadOVA() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => uploadOVAFile(file),
    onSuccess: () => {
      // Invalidate templates list when upload completes
      queryClient.invalidateQueries({ queryKey: ['ova-templates'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

/**
 * Hook to poll the status of an OVA upload job.
 * 
 * @param jobId - The job ID returned from the upload
 * @param options - Query options
 * 
 * @example
 * ```tsx
 * const { data: status, isLoading } = useOVAUploadStatus(jobId, {
 *   enabled: !!jobId,
 *   refetchInterval: 1000, // Poll every second
 * });
 * 
 * if (status?.status === 'COMPLETED') {
 *   console.log('Upload complete! Image ID:', status.imageId);
 * }
 * ```
 */
export function useOVAUploadStatus(
  jobId: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number | false;
  }
) {
  return useQuery({
    queryKey: ['ova-upload-status', jobId],
    queryFn: () => getOVAUploadStatus(jobId),
    enabled: options?.enabled ?? !!jobId,
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0, // Always fetch fresh data
  });
}

/**
 * Hook to list all OVA templates.
 * 
 * @example
 * ```tsx
 * const { data: templates, isLoading, error } = useOVATemplates();
 * 
 * return (
 *   <ul>
 *     {templates?.map(t => (
 *       <li key={t.id}>{t.name}</li>
 *     ))}
 *   </ul>
 * );
 * ```
 */
export function useOVATemplates() {
  return useQuery({
    queryKey: ['ova-templates'],
    queryFn: listOVATemplates,
    staleTime: 30000, // Consider fresh for 30 seconds
  });
}

/**
 * Hook to get a specific OVA template.
 * 
 * @param id - The template ID
 * @param options - Query options
 */
export function useOVATemplate(id: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['ova-template', id],
    queryFn: () => getOVATemplate(id),
    enabled: options?.enabled ?? !!id,
    staleTime: 30000,
  });
}

/**
 * Hook to delete an OVA template.
 * 
 * @example
 * ```tsx
 * const deleteTemplate = useDeleteOVATemplate();
 * 
 * const handleDelete = async (id: string) => {
 *   try {
 *     await deleteTemplate.mutateAsync(id);
 *     console.log('Template deleted');
 *   } catch (error) {
 *     console.error('Delete failed:', error);
 *   }
 * };
 * ```
 */
export function useDeleteOVATemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteOVATemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ova-templates'] });
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format bytes to a human-readable string.
 */
export function formatOVASize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if an image is an OVA template.
 */
export function isOVATemplate(image: { spec?: { format?: string } }): boolean {
  return image.spec?.format === 'OVA';
}

/**
 * Get the status color for an OVA upload status.
 */
export function getOVAStatusColor(status: OVAUploadStatus['status']): string {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'UPLOADING':
    case 'EXTRACTING':
    case 'PARSING':
    case 'CONVERTING':
      return 'info';
    default:
      return 'default';
  }
}

/**
 * Get a human-readable label for an OVA upload status.
 */
export function getOVAStatusLabel(status: OVAUploadStatus['status']): string {
  switch (status) {
    case 'UPLOADING':
      return 'Uploading';
    case 'EXTRACTING':
      return 'Extracting';
    case 'PARSING':
      return 'Parsing OVF';
    case 'CONVERTING':
      return 'Converting Disk';
    case 'COMPLETED':
      return 'Complete';
    case 'FAILED':
      return 'Failed';
    default:
      return 'Unknown';
  }
}
