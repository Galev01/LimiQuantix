/**
 * useFileTransfer - React hooks for VM file transfer operations
 * 
 * Provides mutations and queries for uploading/downloading files
 * to/from VM guests via the Control Plane file transfer API.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { showSuccess, showError } from '../lib/toast';
import { getApiBase } from '../lib/api-client';

// ============================================================================
// Types
// ============================================================================

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode: number;
  modTime: string;
}

export interface FileListResponse {
  path: string;
  entries: FileEntry[];
}

export interface FileStatResponse {
  path: string;
  exists: boolean;
  isDir: boolean;
  size: number;
  mode: number;
  modTime: string;
}

export interface FileWriteResponse {
  success: boolean;
  path: string;
  vmId: string;
  error?: string;
}

export interface FileReadResponse {
  path: string;
  content: string; // Base64 encoded
  size: number;
  readBytes: number;
  eof: boolean;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

// ============================================================================
// Query Keys
// ============================================================================

export const fileTransferKeys = {
  all: ['files'] as const,
  vm: (vmId: string) => [...fileTransferKeys.all, vmId] as const,
  list: (vmId: string, path: string) => [...fileTransferKeys.vm(vmId), 'list', path] as const,
  stat: (vmId: string, path: string) => [...fileTransferKeys.vm(vmId), 'stat', path] as const,
};

// ============================================================================
// API Functions
// ============================================================================

async function listDirectory(vmId: string, path: string): Promise<FileEntry[]> {
  const apiBase = getApiBase();
  const response = await fetch(
    `${apiBase}/api/vms/${vmId}/files/list?path=${encodeURIComponent(path)}`,
    { method: 'GET' }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list directory: ${text}`);
  }

  const data: FileListResponse = await response.json();
  return data.entries;
}

async function statFile(vmId: string, path: string): Promise<FileStatResponse> {
  const apiBase = getApiBase();
  const response = await fetch(
    `${apiBase}/api/vms/${vmId}/files/stat?path=${encodeURIComponent(path)}`,
    { method: 'GET' }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to stat file: ${text}`);
  }

  return response.json();
}

async function writeFile(
  vmId: string,
  path: string,
  content: string,
  mode: number = 0o644
): Promise<FileWriteResponse> {
  const apiBase = getApiBase();
  const response = await fetch(`${apiBase}/api/vms/${vmId}/files/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, mode }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to write file: ${text}`);
  }

  return response.json();
}

async function readFile(
  vmId: string,
  path: string,
  offset: number = 0,
  length: number = 0
): Promise<FileReadResponse> {
  const apiBase = getApiBase();
  const response = await fetch(`${apiBase}/api/vms/${vmId}/files/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, offset, length }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to read file: ${text}`);
  }

  return response.json();
}

async function deleteFile(vmId: string, path: string): Promise<void> {
  const apiBase = getApiBase();
  const response = await fetch(
    `${apiBase}/api/vms/${vmId}/files/delete?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to delete file: ${text}`);
  }
}

async function uploadFileMultipart(
  vmId: string,
  file: File,
  remotePath: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<FileWriteResponse> {
  const apiBase = getApiBase();
  
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', remotePath);

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
        reject(new Error(`Upload failed: ${xhr.statusText || xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Network error during upload'));
    });

    xhr.open('POST', `${apiBase}/api/vms/${vmId}/files/write`);
    xhr.send(formData);
  });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to list files in a VM directory
 */
export function useListDirectory(vmId: string, path: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: fileTransferKeys.list(vmId, path),
    queryFn: () => listDirectory(vmId, path),
    enabled: options?.enabled !== false && !!vmId,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to get file stats
 */
export function useFileStat(vmId: string, path: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: fileTransferKeys.stat(vmId, path),
    queryFn: () => statFile(vmId, path),
    enabled: options?.enabled !== false && !!vmId && !!path,
    staleTime: 5000,
  });
}

/**
 * Hook to upload a file to a VM
 */
export function useUploadFile(vmId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      remotePath,
      onProgress,
    }: {
      file: File;
      remotePath: string;
      onProgress?: (progress: UploadProgress) => void;
    }) => {
      // For small files (< 1MB), use JSON upload with base64
      if (file.size < 1024 * 1024) {
        const reader = new FileReader();
        const content = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1] || '';
            resolve(base64);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        
        return writeFile(vmId, remotePath, content);
      }
      
      // For larger files, use multipart upload
      return uploadFileMultipart(vmId, file, remotePath, onProgress);
    },
    onSuccess: (_, variables) => {
      showSuccess(`Uploaded ${variables.file.name}`);
      // Invalidate directory listing for parent path
      const parentPath = variables.remotePath.split('/').slice(0, -1).join('/') || '/';
      queryClient.invalidateQueries({ queryKey: fileTransferKeys.list(vmId, parentPath) });
    },
    onError: (error) => {
      showError(error, 'Upload failed');
    },
  });
}

/**
 * Hook to download a file from a VM
 */
export function useDownloadFile(vmId: string) {
  return useMutation({
    mutationFn: async ({ remotePath }: { remotePath: string }) => {
      const response = await readFile(vmId, remotePath);
      
      // Decode base64 content
      const binaryString = atob(response.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Create blob and trigger download
      const blob = new Blob([bytes]);
      const url = URL.createObjectURL(blob);
      const fileName = remotePath.split('/').pop() || 'download';
      
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      return response;
    },
    onSuccess: (_, variables) => {
      const fileName = variables.remotePath.split('/').pop() || 'file';
      showSuccess(`Downloaded ${fileName}`);
    },
    onError: (error) => {
      showError(error, 'Download failed');
    },
  });
}

/**
 * Hook to delete a file in a VM
 */
export function useDeleteFile(vmId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path }: { path: string }) => {
      await deleteFile(vmId, path);
      return path;
    },
    onSuccess: (path) => {
      const fileName = path.split('/').pop() || 'file';
      showSuccess(`Deleted ${fileName}`);
      // Invalidate directory listing for parent path
      const parentPath = path.split('/').slice(0, -1).join('/') || '/';
      queryClient.invalidateQueries({ queryKey: fileTransferKeys.list(vmId, parentPath) });
    },
    onError: (error) => {
      showError(error, 'Delete failed');
    },
  });
}

/**
 * Hook to create a directory in a VM
 * (Creates an empty hidden file in the directory as a workaround)
 */
export function useCreateDirectory(vmId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path }: { path: string }) => {
      // Create a hidden marker file to ensure directory exists
      const markerPath = `${path.replace(/\/$/, '')}/.keep`;
      await writeFile(vmId, markerPath, '', 0o644);
      return path;
    },
    onSuccess: (path) => {
      const dirName = path.split('/').filter(Boolean).pop() || 'directory';
      showSuccess(`Created ${dirName}`);
      // Invalidate parent directory listing
      const parentPath = path.split('/').slice(0, -1).join('/') || '/';
      queryClient.invalidateQueries({ queryKey: fileTransferKeys.list(vmId, parentPath) });
    },
    onError: (error) => {
      showError(error, 'Failed to create directory');
    },
  });
}
