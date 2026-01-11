/**
 * Image management hooks for QHCI (Quantix Host Console Interface)
 * 
 * Document ID: 000064
 * 
 * Provides hooks for fetching cloud images available on the host.
 */

import { useQuery } from '@tanstack/react-query';

// Types
export interface CloudImage {
  id: string;
  name: string;
  path: string;
  format: string;
  size: number;
  os: string;
  version: string;
  defaultUser?: string;
}

// Catalog of well-known cloud images
export const CLOUD_IMAGE_CATALOG: CloudImage[] = [
  {
    id: 'ubuntu-22.04',
    name: 'Ubuntu 22.04 LTS (Jammy)',
    path: '/var/lib/libvirt/images/jammy-server-cloudimg-amd64.qcow2',
    format: 'qcow2',
    size: 700 * 1024 * 1024,
    os: 'ubuntu',
    version: '22.04',
    defaultUser: 'ubuntu',
  },
  {
    id: 'ubuntu-24.04',
    name: 'Ubuntu 24.04 LTS (Noble)',
    path: '/var/lib/libvirt/images/noble-server-cloudimg-amd64.qcow2',
    format: 'qcow2',
    size: 750 * 1024 * 1024,
    os: 'ubuntu',
    version: '24.04',
    defaultUser: 'ubuntu',
  },
  {
    id: 'debian-12',
    name: 'Debian 12 (Bookworm)',
    path: '/var/lib/libvirt/images/debian-12-genericcloud-amd64.qcow2',
    format: 'qcow2',
    size: 500 * 1024 * 1024,
    os: 'debian',
    version: '12',
    defaultUser: 'debian',
  },
  {
    id: 'rocky-9',
    name: 'Rocky Linux 9',
    path: '/var/lib/libvirt/images/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2',
    format: 'qcow2',
    size: 900 * 1024 * 1024,
    os: 'rocky',
    version: '9',
    defaultUser: 'rocky',
  },
  {
    id: 'centos-stream-9',
    name: 'CentOS Stream 9',
    path: '/var/lib/libvirt/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2',
    format: 'qcow2',
    size: 850 * 1024 * 1024,
    os: 'centos',
    version: '9-stream',
    defaultUser: 'cloud-user',
  },
  {
    id: 'fedora-40',
    name: 'Fedora 40 Cloud',
    path: '/var/lib/libvirt/images/Fedora-Cloud-Base-40.x86_64.qcow2',
    format: 'qcow2',
    size: 400 * 1024 * 1024,
    os: 'fedora',
    version: '40',
    defaultUser: 'fedora',
  },
];

/**
 * Fetch available images from the node daemon
 */
async function fetchImages(): Promise<CloudImage[]> {
  // QHCI talks to the local node daemon
  const response = await fetch('/api/images');

  if (!response.ok) {
    throw new Error(`Failed to fetch images: ${response.statusText}`);
  }

  const data = await response.json();
  return data.images || [];
}

/**
 * Hook to fetch available cloud images
 */
export function useImages() {
  const query = useQuery({
    queryKey: ['images'],
    queryFn: async () => {
      try {
        const images = await fetchImages();
        return { images, isUsingCatalog: false };
      } catch (error) {
        console.warn('Failed to fetch images from API, using catalog:', error);
        return { images: CLOUD_IMAGE_CATALOG, isUsingCatalog: true };
      }
    },
    staleTime: 60000, // 1 minute
  });

  return {
    images: query.data?.images || [],
    isLoading: query.isLoading,
    isUsingCatalog: query.data?.isUsingCatalog ?? true,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Format image size for display
 */
export function formatImageSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/**
 * Get default user for an OS type
 */
export function getDefaultUser(os: string): string {
  switch (os.toLowerCase()) {
    case 'ubuntu':
      return 'ubuntu';
    case 'debian':
      return 'debian';
    case 'centos':
    case 'rhel':
      return 'cloud-user';
    case 'rocky':
    case 'almalinux':
      return 'rocky';
    case 'fedora':
      return 'fedora';
    default:
      return 'cloud-user';
  }
}
