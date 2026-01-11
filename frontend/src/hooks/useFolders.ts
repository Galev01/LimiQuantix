/**
 * Folder management hooks for VM organization
 * 
 * Document ID: 000062
 * 
 * Provides hooks for fetching and managing folders that organize VMs
 * in a hierarchical structure similar to VMware vSphere folders.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// API Configuration
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Types
export interface Folder {
  id: string;
  name: string;
  parentId: string;
  projectId: string;
  type: 'VM' | 'DATASTORE' | 'NETWORK' | 'HOST';
  description: string;
  path: string;
  childCount: number;
  labels: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface FolderTree {
  folder: Folder;
  children: FolderTree[];
}

export interface CreateFolderRequest {
  name: string;
  parentId?: string;
  projectId?: string;
  type?: string;
  description?: string;
  labels?: Record<string, string>;
}

export interface UpdateFolderRequest {
  id: string;
  name?: string;
  parentId?: string;
  description?: string;
  labels?: Record<string, string>;
}

// Fallback folders for when API is unavailable
const FALLBACK_FOLDERS: Folder[] = [
  { 
    id: '10000000-0000-0000-0000-000000000001', 
    name: 'Virtual Machines', 
    parentId: '', 
    projectId: '00000000-0000-0000-0000-000000000001',
    type: 'VM',
    description: 'Root folder for all virtual machines',
    path: '/Virtual Machines',
    childCount: 0,
    labels: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system',
  },
  { 
    id: '10000000-0000-0000-0000-000000000002', 
    name: 'Templates', 
    parentId: '', 
    projectId: '00000000-0000-0000-0000-000000000001',
    type: 'VM',
    description: 'Folder for VM templates',
    path: '/Templates',
    childCount: 0,
    labels: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system',
  },
  { 
    id: '10000000-0000-0000-0000-000000000003', 
    name: 'Discovered VMs', 
    parentId: '', 
    projectId: '00000000-0000-0000-0000-000000000001',
    type: 'VM',
    description: 'Automatically discovered VMs',
    path: '/Discovered VMs',
    childCount: 0,
    labels: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: 'system',
  },
];

/**
 * Fetch folders from the API
 */
async function fetchFolders(projectId?: string, parentId?: string, type?: string): Promise<Folder[]> {
  const params = new URLSearchParams();
  if (projectId) params.append('projectId', projectId);
  if (parentId) params.append('parentId', parentId);
  if (type) params.append('type', type);

  const response = await fetch(`${API_BASE}/limiquantix.compute.v1.FolderService/ListFolders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      projectId: projectId || 'default',
      parentId: parentId || '',
      type: type || 'VM',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch folders: ${response.statusText}`);
  }

  const data = await response.json();
  return data.folders || [];
}

/**
 * Fetch folder tree from the API
 */
async function fetchFolderTree(rootId?: string, projectId?: string, type?: string, depth?: number): Promise<FolderTree | null> {
  const response = await fetch(`${API_BASE}/limiquantix.compute.v1.FolderService/GetFolderTree`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rootId: rootId || '',
      projectId: projectId || 'default',
      type: type || 'VM',
      depth: depth || 10,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch folder tree: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Create a new folder
 */
async function createFolder(request: CreateFolderRequest): Promise<Folder> {
  const response = await fetch(`${API_BASE}/limiquantix.compute.v1.FolderService/CreateFolder`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || 'Failed to create folder');
  }

  return await response.json();
}

/**
 * Delete a folder
 */
async function deleteFolder(id: string, force?: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/limiquantix.compute.v1.FolderService/DeleteFolder`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id, force: force || false }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || 'Failed to delete folder');
  }
}

/**
 * Hook to fetch folders
 */
export function useFolders(options?: { projectId?: string; parentId?: string; type?: string }) {
  const { projectId, parentId, type = 'VM' } = options || {};

  return useQuery({
    queryKey: ['folders', projectId, parentId, type],
    queryFn: async () => {
      try {
        const folders = await fetchFolders(projectId, parentId, type);
        return { folders, isUsingFallback: false };
      } catch (error) {
        console.warn('Failed to fetch folders from API, using fallback:', error);
        return { folders: FALLBACK_FOLDERS, isUsingFallback: true };
      }
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to fetch folder tree
 */
export function useFolderTree(options?: { rootId?: string; projectId?: string; type?: string; depth?: number }) {
  const { rootId, projectId, type = 'VM', depth = 10 } = options || {};

  return useQuery({
    queryKey: ['folder-tree', rootId, projectId, type, depth],
    queryFn: async () => {
      try {
        const tree = await fetchFolderTree(rootId, projectId, type, depth);
        return { tree, isUsingFallback: false };
      } catch (error) {
        console.warn('Failed to fetch folder tree from API, using fallback:', error);
        // Create a simple tree from fallback folders
        const fallbackTree: FolderTree = {
          folder: FALLBACK_FOLDERS[0],
          children: FALLBACK_FOLDERS.slice(1).map(f => ({ folder: f, children: [] })),
        };
        return { tree: fallbackTree, isUsingFallback: true };
      }
    },
    staleTime: 30000,
  });
}

/**
 * Hook to create a folder
 */
export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createFolder,
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
      toast.success(`Folder "${folder.name}" created successfully`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to create folder: ${error.message}`);
    },
  });
}

/**
 * Hook to delete a folder
 */
export function useDeleteFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => deleteFolder(id, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folders'] });
      queryClient.invalidateQueries({ queryKey: ['folder-tree'] });
      toast.success('Folder deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete folder: ${error.message}`);
    },
  });
}

/**
 * Get folder by ID from a list of folders
 */
export function getFolderById(folders: Folder[], id: string): Folder | undefined {
  return folders.find(f => f.id === id);
}

/**
 * Build folder path options for a dropdown (flattened tree)
 */
export function buildFolderOptions(folders: Folder[]): Array<{ id: string; name: string; path: string; depth: number }> {
  // For now, return flat list with paths
  return folders.map(f => ({
    id: f.id,
    name: f.name,
    path: f.path || `/${f.name}`,
    depth: (f.path?.split('/').length || 1) - 1,
  }));
}
