import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { ImageService } from '@/api/limiquantix/storage/v1/storage_service_pb';
import type { Image, OsInfo_OsFamily, ImageSpec_Visibility } from '@/api/limiquantix/storage/v1/storage_pb';

import { API_CONFIG } from '@/lib/api-client';

// Create transport for Connect-RPC
const transport = createConnectTransport({
  baseUrl: API_CONFIG.baseUrl,
});

// Create the ImageService client
const imageClient = createClient(ImageService, transport);

// Query keys
export const imageKeys = {
  all: ['images'] as const,
  lists: () => [...imageKeys.all, 'list'] as const,
  list: (filters: ListImagesFilters) => [...imageKeys.lists(), filters] as const,
  details: () => [...imageKeys.all, 'detail'] as const,
  detail: (id: string) => [...imageKeys.details(), id] as const,
  catalog: () => [...imageKeys.all, 'catalog'] as const,
};

// Filter types
export interface ListImagesFilters {
  projectId?: string;
  osFamily?: OsInfo_OsFamily;
  visibility?: ImageSpec_Visibility;
  nodeId?: string;
}

// Download progress tracking
export interface DownloadProgress {
  progressPercent: number;
  bytesDownloaded: number;
  bytesTotal: number;
}

// Simplified image type for UI
export interface CloudImage {
  id: string;
  name: string;
  description: string;
  path?: string;
  sizeBytes: number;
  os: {
    family: string;
    distribution: string;
    version: string;
    architecture: string;
    defaultUser: string;
    cloudInitEnabled: boolean;
    provisioningMethod: string;
  };
  spec: {
    format: string;
    visibility: string;
  };
  requirements: {
    minCpu: number;
    minMemoryMib: number;
    minDiskGib: number;
    supportedFirmware: string[];
  };
  status: 'pending' | 'downloading' | 'ready' | 'error';
  nodeId?: string;
  // Download progress (only present when status is 'downloading')
  downloadProgress?: DownloadProgress;
}

// Construct cloud image path from OS info
// Path convention: /var/lib/limiquantix/cloud-images/{distro}-{version}.qcow2
function constructCloudImagePath(os: { distribution?: string; version?: string }): string | undefined {
  if (!os.distribution || !os.version) {
    return undefined;
  }
  const distro = os.distribution.toLowerCase();
  const version = os.version;
  return `/var/lib/limiquantix/cloud-images/${distro}-${version}.qcow2`;
}

// Convert proto Image to CloudImage
function toCloudImage(img: Image): CloudImage {
  const osInfo = {
    family: img.spec?.os?.family?.toString() || 'LINUX',
    distribution: img.spec?.os?.distribution || 'unknown',
    version: img.spec?.os?.version || '',
    architecture: img.spec?.os?.architecture || 'x86_64',
    defaultUser: img.spec?.os?.defaultUser || 'root',
    cloudInitEnabled: img.spec?.os?.cloudInitEnabled || false,
    provisioningMethod: img.spec?.os?.provisioningMethod?.toString() || 'NONE',
  };

  const phase = mapPhase(img.status?.phase);
  const progressPercent = img.status?.progressPercent ?? 0;

  return {
    id: img.id,
    name: img.name,
    description: img.description,
    // Construct path from OS info (follows storage convention on hypervisor nodes)
    path: constructCloudImagePath({ distribution: osInfo.distribution, version: osInfo.version }),
    sizeBytes: Number(img.status?.sizeBytes || 0),
    os: osInfo,
    spec: {
      format: img.spec?.format?.toString() || 'UNKNOWN',
      visibility: img.spec?.visibility?.toString() || 'PRIVATE',
    },
    requirements: {
      minCpu: img.spec?.requirements?.minCpu || 1,
      minMemoryMib: Number(img.spec?.requirements?.minMemoryMib || 512),
      minDiskGib: Number(img.spec?.requirements?.minDiskGib || 10),
      supportedFirmware: img.spec?.requirements?.supportedFirmware || ['bios', 'uefi'],
    },
    status: phase,
    nodeId: undefined, // Would need to be added to proto
    // Include download progress from API when downloading
    downloadProgress: phase === 'downloading' ? {
      progressPercent,
      bytesDownloaded: 0, // Not available in ImageStatus proto
      bytesTotal: Number(img.status?.sizeBytes || 0),
    } : undefined,
  };
}

function mapPhase(phase?: number): 'pending' | 'downloading' | 'ready' | 'error' {
  switch (phase) {
    case 1: return 'pending';
    case 2: return 'downloading';
    case 3: return 'downloading'; // converting
    case 4: return 'ready';
    case 5: return 'error';
    default: return 'pending';
  }
}

// Hook to list images
export function useImages(filters: ListImagesFilters = {}) {
  return useQuery({
    queryKey: imageKeys.list(filters),
    queryFn: async () => {
      const response = await imageClient.listImages({
        projectId: filters.projectId,
        osFamily: filters.osFamily,
        visibility: filters.visibility,
      });
      return response.images.map(toCloudImage);
    },
    staleTime: 30_000, // 30 seconds
    retry: false, // Don't retry - fallback to catalog
    retryOnMount: false,
    // Poll every 2 seconds when there are downloading images
    refetchInterval: (query) => {
      const images = query.state.data;
      if (images?.some(img => img.status === 'downloading')) {
        return 2000; // Poll every 2 seconds when downloading
      }
      return false;
    },
  });
}

// Hook to get a single image
export function useImage(id: string, enabled = true) {
  return useQuery({
    queryKey: imageKeys.detail(id),
    queryFn: async () => {
      const response = await imageClient.getImage({ id });
      return toCloudImage(response);
    },
    enabled: enabled && !!id,
  });
}

// Hook to delete an image
export function useDeleteImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await imageClient.deleteImage({ id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
}

// Hook to scan ISOs from storage pools
export function useScanISOs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (storagePoolId?: string) => {
      const response = await imageClient.scanISOs({
        storagePoolId: storagePoolId || '',
      });
      return {
        discoveredCount: response.discoveredCount,
      };
    },
    onSuccess: () => {
      // Invalidate images list to show newly discovered ISOs
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
}

// Hook to create an image (for ISO uploads)
export function useCreateImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      projectId?: string;
      labels?: Record<string, string>;
      spec: {
        format: 'RAW' | 'QCOW2' | 'VMDK' | 'VHD' | 'ISO';
        visibility?: 'PRIVATE' | 'PROJECT' | 'PUBLIC';
        osInfo?: {
          family: 'LINUX' | 'WINDOWS' | 'BSD' | 'OTHER';
          distribution: string;
          version: string;
          architecture?: string;
          defaultUser?: string;
          provisioningMethod?: 'CLOUD_INIT' | 'NONE' | 'SYSPREP';
        };
        requirements?: {
          minCpu?: number;
          minMemoryMib?: number;
          minDiskGib?: number;
        };
      };
    }) => {
      const response = await imageClient.createImage({
        name: params.name,
        description: params.description || '',
        projectId: params.projectId || 'default',
        labels: params.labels || {},
        spec: {
          format: formatToProto(params.spec.format),
          visibility: visibilityToProto(params.spec.visibility || 'PROJECT'),
          os: params.spec.osInfo ? {
            family: osFamilyToProto(params.spec.osInfo.family),
            distribution: params.spec.osInfo.distribution,
            version: params.spec.osInfo.version,
            architecture: params.spec.osInfo.architecture || 'x86_64',
            defaultUser: params.spec.osInfo.defaultUser || '',
            provisioningMethod: provisioningToProto(params.spec.osInfo.provisioningMethod || 'NONE'),
          } : undefined,
          requirements: params.spec.requirements ? {
            minCpu: params.spec.requirements.minCpu || 1,
            minMemoryMib: BigInt(params.spec.requirements.minMemoryMib || 512),
            minDiskGib: BigInt(params.spec.requirements.minDiskGib || 10),
          } : undefined,
        },
      });
      return toCloudImage(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
}

// Helper functions to convert string enums to proto values
function formatToProto(format: string): number {
  const map: Record<string, number> = { RAW: 0, QCOW2: 1, VMDK: 2, VHD: 3, ISO: 4 };
  return map[format] ?? 0;
}

function visibilityToProto(visibility: string): number {
  const map: Record<string, number> = { PRIVATE: 0, PROJECT: 1, PUBLIC: 2 };
  return map[visibility] ?? 1;
}

function osFamilyToProto(family: string): number {
  const map: Record<string, number> = { UNKNOWN: 0, LINUX: 1, WINDOWS: 2, BSD: 3, OTHER: 4 };
  return map[family] ?? 0;
}

function provisioningToProto(method: string): number {
  const map: Record<string, number> = {
    PROVISIONING_UNKNOWN: 0, CLOUD_INIT: 1, IGNITION: 2, SYSPREP: 3,
    KICKSTART: 4, PRESEED: 5, NONE: 6
  };
  return map[method] ?? 6;
}

// Hook to import an image from URL
export function useImportImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      name: string;
      description?: string;
      url: string;
      osInfo?: {
        family: number;
        distribution: string;
        version: string;
        architecture: string;
        defaultUser: string;
      };
      storagePoolId?: string;
      nodeId?: string; // Target node for local storage
    }) => {
      // Note: nodeId is passed for UI context but backend currently uses storagePoolId
      // When nodeId is specified, backend should route to node's local ISO storage
      const response = await imageClient.importImage({
        name: params.name,
        description: params.description,
        url: params.url,
        osInfo: params.osInfo ? {
          family: params.osInfo.family,
          distribution: params.osInfo.distribution,
          version: params.osInfo.version,
          architecture: params.osInfo.architecture,
          defaultUser: params.osInfo.defaultUser,
        } : undefined,
        storagePoolId: params.storagePoolId,
        // TODO: Add nodeId to proto when backend supports direct node targeting
        // nodeId: params.nodeId,
      });
      return {
        jobId: response.jobId,
        image: response.image ? toCloudImage(response.image) : null,
        nodeId: params.nodeId, // Return for UI feedback
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
}

// Hook to download an image from catalog
export function useDownloadImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      catalogId: string;
      nodeId?: string;
      storagePoolId?: string;
      name?: string;
    }) => {
      const response = await imageClient.downloadImage({
        catalogId: params.catalogId,
        nodeId: params.nodeId,
        storagePoolId: params.storagePoolId,
        name: params.name,
      });
      return {
        jobId: response.jobId,
        imageId: response.image?.id,
        image: response.image ? toCloudImage(response.image) : null,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: imageKeys.lists() });
    },
  });
}

// Hook to get import/download status
export function useImportStatus(jobId: string, enabled = true) {
  return useQuery({
    queryKey: [...imageKeys.all, 'import-status', jobId],
    queryFn: async () => {
      const response = await imageClient.getImportStatus({ jobId });
      return {
        jobId: response.jobId,
        imageId: response.imageId,
        status: response.status,
        progressPercent: response.progressPercent,
        bytesDownloaded: Number(response.bytesDownloaded),
        bytesTotal: Number(response.bytesTotal),
        errorMessage: response.errorMessage,
      };
    },
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      // Poll while downloading
      const status = query.state.data?.status;
      if (status === 1 || status === 2 || status === 3) { // pending, downloading, converting
        return 1000; // 1 second
      }
      return false;
    },
  });
}

// Hook to get image catalog
export function useImageCatalog() {
  return useQuery({
    queryKey: imageKeys.catalog(),
    queryFn: async () => {
      const response = await imageClient.getImageCatalog({});
      return response.images.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        url: entry.url,
        checksum: entry.checksum,
        checksumType: entry.checksumType,
        sizeBytes: Number(entry.sizeBytes),
        verified: entry.verified,
        os: {
          family: entry.os?.family?.toString() || 'LINUX',
          distribution: entry.os?.distribution || 'unknown',
          version: entry.os?.version || '',
          architecture: entry.os?.architecture || 'x86_64',
          defaultUser: entry.os?.defaultUser || 'root',
          cloudInitEnabled: entry.os?.cloudInitEnabled || false,
          provisioningMethod: entry.os?.provisioningMethod?.toString() || 'NONE',
        },
        requirements: {
          minCpu: entry.requirements?.minCpu || 1,
          minMemoryMib: Number(entry.requirements?.minMemoryMib || 512),
          minDiskGib: Number(entry.requirements?.minDiskGib || 10),
          supportedFirmware: entry.requirements?.supportedFirmware || ['bios', 'uefi'],
        },
      }));
    },
    staleTime: 60_000, // 1 minute - catalog doesn't change often
  });
}

// =============================================================================
// CATALOG DOWNLOAD STATUS - Check which catalog images are already downloaded
// =============================================================================

// CatalogDownloadStatus represents the download status of a catalog image
export type CatalogDownloadStatusType = 'NOT_DOWNLOADED' | 'DOWNLOADING' | 'READY' | 'ERROR';

export interface CatalogDownloadStatus {
  catalogId: string;
  status: CatalogDownloadStatusType;
  imageId?: string;
  storagePoolId?: string;
  progressPercent?: number;
  errorMessage?: string;
}

// Map proto status enum to our type
function mapCatalogStatus(status: number): CatalogDownloadStatusType {
  switch (status) {
    case 0: return 'NOT_DOWNLOADED';
    case 1: return 'DOWNLOADING';
    case 2: return 'READY';
    case 3: return 'ERROR';
    default: return 'NOT_DOWNLOADED';
  }
}

// Hook to check download status for multiple catalog IDs
export function useCatalogDownloadStatus(catalogIds: string[], enabled = true) {
  return useQuery({
    queryKey: [...imageKeys.all, 'catalog-status', catalogIds.join(',')],
    queryFn: async () => {
      if (catalogIds.length === 0) {
        return new Map<string, CatalogDownloadStatus>();
      }

      const response = await imageClient.getCatalogDownloadStatus({
        catalogIds,
      });

      const statusMap = new Map<string, CatalogDownloadStatus>();
      for (const s of response.statuses) {
        statusMap.set(s.catalogId, {
          catalogId: s.catalogId,
          status: mapCatalogStatus(s.status),
          imageId: s.imageId || undefined,
          storagePoolId: s.storagePoolId || undefined,
          progressPercent: s.progressPercent || 0,
          errorMessage: s.errorMessage || undefined,
        });
      }
      return statusMap;
    },
    enabled: enabled && catalogIds.length > 0,
    staleTime: 5_000, // 5 seconds - check frequently for download progress
    refetchInterval: (query) => {
      // Poll while any image is downloading
      const statusMap = query.state.data;
      if (statusMap) {
        for (const status of statusMap.values()) {
          if (status.status === 'DOWNLOADING') {
            return 2000; // Poll every 2 seconds when downloading
          }
        }
      }
      return false;
    },
  });
}

// =============================================================================
// IMAGE AVAILABILITY - Check if images are available for a specific node
// =============================================================================

export interface ImageAvailabilityResult {
  catalogId: string;
  available: boolean;
  status: CatalogDownloadStatusType;
  progress?: number;
  errorMessage?: string;
  sizeBytes?: number;
}

/**
 * Hook to check image availability for VM creation wizard.
 * This combines catalog download status with node accessibility.
 * 
 * @param catalogIds - Array of catalog IDs to check
 * @param nodeId - Optional node ID to check accessibility (if empty, checks global availability)
 * @param enabled - Whether to enable the query
 */
export function useImageAvailability(
  catalogIds: string[],
  nodeId?: string,
  enabled = true
) {
  const { data: downloadStatus, isLoading, error, refetch } = useCatalogDownloadStatus(catalogIds, enabled);
  const { data: catalog } = useImageCatalog();

  // Build availability map from download status
  const availabilityMap = new Map<string, ImageAvailabilityResult>();

  if (downloadStatus && catalog) {
    for (const catalogId of catalogIds) {
      const status = downloadStatus.get(catalogId);
      const catalogEntry = catalog.find(c => c.id === catalogId);

      if (status) {
        availabilityMap.set(catalogId, {
          catalogId,
          available: status.status === 'READY',
          status: status.status,
          progress: status.progressPercent,
          errorMessage: status.errorMessage,
          sizeBytes: catalogEntry?.sizeBytes,
        });
      } else {
        // Not in download status means not downloaded
        availabilityMap.set(catalogId, {
          catalogId,
          available: false,
          status: 'NOT_DOWNLOADED',
          sizeBytes: catalogEntry?.sizeBytes,
        });
      }
    }
  }

  return {
    availabilityMap,
    isLoading,
    error,
    refetch,
    // Helper function to check single image
    getAvailability: (catalogId: string): ImageAvailabilityResult | undefined => {
      return availabilityMap.get(catalogId);
    },
    // Check if specific image is available
    isAvailable: (catalogId: string): boolean => {
      const result = availabilityMap.get(catalogId);
      return result?.available ?? false;
    },
    // Check if any image is currently downloading
    isAnyDownloading: Array.from(availabilityMap.values()).some(r => r.status === 'DOWNLOADING'),
  };
}

// Catalog entry type
export interface CatalogImage {
  id: string;
  name: string;
  description: string;
  url: string;
  checksum: string;
  checksumType: string;
  sizeBytes: number;
  verified: boolean;
  os: {
    family: string;
    distribution: string;
    version: string;
    architecture: string;
    defaultUser: string;
    cloudInitEnabled: boolean;
    provisioningMethod: string;
  };
  requirements: {
    minCpu: number;
    minMemoryMib: number;
    minDiskGib: number;
    supportedFirmware: string[];
  };
}

// ISO image type (extends CloudImage with ISO-specific fields)
export interface ISOImage {
  id: string;
  name: string;
  description: string;
  sizeBytes: number;
  format: 'ISO';
  os: {
    family: 'LINUX' | 'WINDOWS' | 'BSD' | 'OTHER';
    distribution: string;
    version: string;
  };
  status: 'pending' | 'uploading' | 'ready' | 'error';
  uploadedAt?: Date;
  path?: string;
}

// Built-in ISO catalog for manual installations
export const ISO_CATALOG: ISOImage[] = [
  {
    id: 'iso-ubuntu-22.04',
    name: 'Ubuntu 22.04.4 LTS Server',
    description: 'Ubuntu Server installation ISO',
    sizeBytes: 1.8 * 1024 * 1024 * 1024,
    format: 'ISO',
    os: { family: 'LINUX', distribution: 'ubuntu', version: '22.04' },
    status: 'ready',
  },
  {
    id: 'iso-ubuntu-24.04',
    name: 'Ubuntu 24.04 LTS Server',
    description: 'Latest Ubuntu Server installation ISO',
    sizeBytes: 2.0 * 1024 * 1024 * 1024,
    format: 'ISO',
    os: { family: 'LINUX', distribution: 'ubuntu', version: '24.04' },
    status: 'ready',
  },
  {
    id: 'iso-debian-12',
    name: 'Debian 12 (Bookworm)',
    description: 'Debian netinst installation ISO',
    sizeBytes: 650 * 1024 * 1024,
    format: 'ISO',
    os: { family: 'LINUX', distribution: 'debian', version: '12' },
    status: 'ready',
  },
  {
    id: 'iso-rocky-9',
    name: 'Rocky Linux 9.3',
    description: 'Rocky Linux DVD installation ISO',
    sizeBytes: 10 * 1024 * 1024 * 1024,
    format: 'ISO',
    os: { family: 'LINUX', distribution: 'rocky', version: '9.3' },
    status: 'ready',
  },
  {
    id: 'iso-windows-2022',
    name: 'Windows Server 2022',
    description: 'Windows Server 2022 Evaluation ISO',
    sizeBytes: 5.4 * 1024 * 1024 * 1024,
    format: 'ISO',
    os: { family: 'WINDOWS', distribution: 'windows-server', version: '2022' },
    status: 'ready',
  },
];

// Hook to list ISOs specifically
export function useISOs() {
  const { data: allImages, isLoading, error } = useImages();

  // Filter to only ISOs
  const isos = allImages?.filter(img =>
    img.os.provisioningMethod === 'NONE' ||
    img.name.toLowerCase().includes('iso') ||
    img.description.toLowerCase().includes('iso')
  ) || [];

  // Fallback to catalog if no ISOs from API
  return {
    isos: isos.length > 0 ? isos : ISO_CATALOG,
    isLoading,
    error,
    isUsingCatalog: isos.length === 0,
  };
}

// Built-in catalog of cloud images (matches backend catalog)
// This is a fallback when the backend doesn't have images yet
// Path follows convention: /var/lib/limiquantix/cloud-images/<distro>-<version>.qcow2
export const CLOUD_IMAGE_CATALOG: CloudImage[] = [
  {
    id: 'ubuntu-22.04',
    name: 'Ubuntu 22.04 LTS (Jammy)',
    description: 'Official Ubuntu cloud image with cloud-init. Default user: ubuntu',
    path: '/var/lib/limiquantix/cloud-images/ubuntu-22.04.qcow2',
    sizeBytes: 700 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'ubuntu',
      version: '22.04',
      architecture: 'x86_64',
      defaultUser: 'root',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 512,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'ubuntu-24.04',
    name: 'Ubuntu 24.04 LTS (Noble)',
    description: 'Latest Ubuntu LTS with cloud-init. Default user: ubuntu',
    path: '/var/lib/limiquantix/cloud-images/ubuntu-24.04.qcow2',
    sizeBytes: 750 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'ubuntu',
      version: '24.04',
      architecture: 'x86_64',
      defaultUser: 'root',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 512,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'debian-12',
    name: 'Debian 12 (Bookworm)',
    description: 'Official Debian cloud image. Default user: debian',
    path: '/var/lib/limiquantix/cloud-images/debian-12.qcow2',
    sizeBytes: 350 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'debian',
      version: '12',
      architecture: 'x86_64',
      defaultUser: 'debian',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 256,
      minDiskGib: 5,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'rocky-9',
    name: 'Rocky Linux 9',
    description: 'Enterprise Linux compatible. Default user: rocky',
    path: '/var/lib/limiquantix/cloud-images/rocky-9.qcow2',
    sizeBytes: 1100 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'rocky',
      version: '9',
      architecture: 'x86_64',
      defaultUser: 'rocky',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 1024,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'almalinux-9',
    name: 'AlmaLinux 9',
    description: 'RHEL-compatible. Default user: almalinux',
    path: '/var/lib/limiquantix/cloud-images/almalinux-9.qcow2',
    sizeBytes: 1000 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'almalinux',
      version: '9',
      architecture: 'x86_64',
      defaultUser: 'almalinux',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 1024,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'fedora-40',
    name: 'Fedora 40 Cloud',
    description: 'Latest Fedora cloud image. Default user: fedora',
    path: '/var/lib/limiquantix/cloud-images/fedora-40.qcow2',
    sizeBytes: 400 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'fedora',
      version: '40',
      architecture: 'x86_64',
      defaultUser: 'fedora',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 512,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'centos-stream-9',
    name: 'CentOS Stream 9',
    description: 'CentOS Stream 9 cloud image. Default user: cloud-user',
    path: '/var/lib/limiquantix/cloud-images/centos-stream-9.qcow2',
    sizeBytes: 1100 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'centos',
      version: '9-stream',
      architecture: 'x86_64',
      defaultUser: 'cloud-user',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 1024,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
  {
    id: 'opensuse-leap-15.5',
    name: 'openSUSE Leap 15.5',
    description: 'openSUSE Leap cloud image. Default user: root (set password via cloud-init)',
    path: '/var/lib/limiquantix/cloud-images/opensuse-leap-15.5.qcow2',
    sizeBytes: 300 * 1024 * 1024,
    os: {
      family: 'LINUX',
      distribution: 'opensuse',
      version: '15.5',
      architecture: 'x86_64',
      defaultUser: 'root',
      cloudInitEnabled: true,
      provisioningMethod: 'CLOUD_INIT',
    },
    spec: {
      format: 'QCOW2',
      visibility: 'PUBLIC',
    },
    requirements: {
      minCpu: 1,
      minMemoryMib: 512,
      minDiskGib: 10,
      supportedFirmware: ['bios', 'uefi'],
    },
    status: 'ready',
  },
];

// Hook to get available images (API + catalog fallback)
export function useAvailableImages() {
  const { data: apiImages, isLoading, error } = useImages();

  // Combine API images with catalog (catalog as fallback)
  const images = apiImages && apiImages.length > 0 ? apiImages : CLOUD_IMAGE_CATALOG;

  return {
    images,
    isLoading,
    error,
    isUsingCatalog: !apiImages || apiImages.length === 0,
  };
}

// Get the default user for an OS distribution
export function getDefaultUser(distribution: string): string {
  const map: Record<string, string> = {
    ubuntu: 'ubuntu',
    debian: 'debian',
    rocky: 'rocky',
    almalinux: 'almalinux',
    centos: 'cloud-user',
    fedora: 'fedora',
    opensuse: 'root',
    suse: 'root',
    rhel: 'cloud-user',
    windows: 'Administrator',
  };
  return map[distribution.toLowerCase()] || 'root';
}

// Format size for display
export function formatImageSize(bytes: number): string {
  if (bytes === 0) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
