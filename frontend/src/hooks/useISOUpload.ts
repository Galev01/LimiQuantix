import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { imageKeys } from './useImages';

const API_BASE = 'http://localhost:8080';

export interface ISOUploadProgress {
  jobId: string;
  imageId: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  progressPercent: number;
  bytesUploaded: number;
  bytesTotal: number;
  errorMessage?: string;
}

export interface ISOUploadParams {
  file: File;
  name: string;
  description?: string;
  osFamily: 'LINUX' | 'WINDOWS' | 'BSD' | 'OTHER';
  distribution: string;
  version: string;
  storagePoolId?: string;
  nodeId?: string;
}

export function useISOUpload() {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<ISOUploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (params: ISOUploadParams): Promise<ISOUploadProgress | null> => {
    setIsUploading(true);
    setError(null);
    setProgress({
      jobId: '',
      imageId: '',
      status: 'uploading',
      progressPercent: 0,
      bytesUploaded: 0,
      bytesTotal: params.file.size,
    });

    try {
      const formData = new FormData();
      formData.append('file', params.file);
      formData.append('name', params.name);
      if (params.description) formData.append('description', params.description);
      formData.append('os_family', params.osFamily);
      formData.append('distribution', params.distribution);
      formData.append('version', params.version);
      if (params.storagePoolId) formData.append('storage_pool_id', params.storagePoolId);
      if (params.nodeId) formData.append('node_id', params.nodeId);

      // Use XMLHttpRequest for progress tracking
      const result = await new Promise<{ job_id: string; image_id: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            setProgress(prev => prev ? {
              ...prev,
              progressPercent: percent,
              bytesUploaded: event.loaded,
              bytesTotal: event.total,
            } : null);
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
              const errorResponse = JSON.parse(xhr.responseText);
              reject(new Error(errorResponse.error || 'Upload failed'));
            } catch {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload aborted'));
        });

        xhr.open('POST', `${API_BASE}/api/v1/images/upload`);
        xhr.send(formData);
      });

      // Start polling for server-side processing status
      const finalStatus = await pollUploadStatus(result.job_id, (status) => {
        setProgress({
          jobId: result.job_id,
          imageId: result.image_id,
          status: status.status as ISOUploadProgress['status'],
          progressPercent: status.progress_percent,
          bytesUploaded: status.bytes_uploaded,
          bytesTotal: status.bytes_total,
          errorMessage: status.error_message,
        });
      });

      if (finalStatus.status === 'failed') {
        throw new Error(finalStatus.error_message || 'Upload failed');
      }

      // Invalidate image queries to refresh the list
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });

      const finalProgress: ISOUploadProgress = {
        jobId: result.job_id,
        imageId: result.image_id,
        status: 'completed',
        progressPercent: 100,
        bytesUploaded: finalStatus.bytes_uploaded,
        bytesTotal: finalStatus.bytes_total,
      };

      setProgress(finalProgress);
      setIsUploading(false);
      return finalProgress;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setProgress(prev => prev ? { ...prev, status: 'failed', errorMessage: message } : null);
      setIsUploading(false);
      throw err;
    }
  }, [queryClient]);

  const reset = useCallback(() => {
    setIsUploading(false);
    setProgress(null);
    setError(null);
  }, []);

  return {
    upload,
    isUploading,
    progress,
    error,
    reset,
  };
}

// Poll for upload status until completed or failed
async function pollUploadStatus(
  jobId: string,
  onProgress: (status: UploadStatusResponse) => void,
): Promise<UploadStatusResponse> {
  const maxAttempts = 600; // 10 minutes max (1 second intervals)
  let attempts = 0;

  while (attempts < maxAttempts) {
    const response = await fetch(`${API_BASE}/api/v1/images/upload/status/${jobId}`);
    if (!response.ok) {
      throw new Error('Failed to get upload status');
    }

    const status: UploadStatusResponse = await response.json();
    onProgress(status);

    if (status.status === 'completed' || status.status === 'failed') {
      return status;
    }

    // Wait 1 second before next poll
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }

  throw new Error('Upload timed out');
}

interface UploadStatusResponse {
  id: string;
  image_id: string;
  filename: string;
  status: string;
  progress_percent: number;
  bytes_uploaded: number;
  bytes_total: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}
