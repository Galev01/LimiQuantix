/**
 * React Query hooks for BGP Service operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bgpApi,
  type ApiBGPSpeaker,
  type ApiBGPPeer,
  type ApiBGPAdvertisement,
  type BGPSpeakerListResponse,
  type BGPPeerListResponse,
  type BGPAdvertisementListResponse,
  type BGPSpeakerDetailedStatus,
} from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

// Query keys for cache management
export const bgpKeys = {
  all: ['bgp'] as const,
  speakers: () => [...bgpKeys.all, 'speakers'] as const,
  speakerList: (projectId?: string) => [...bgpKeys.speakers(), 'list', { projectId }] as const,
  speakerDetail: (id: string) => [...bgpKeys.speakers(), 'detail', id] as const,
  speakerStatus: (id: string) => [...bgpKeys.speakerDetail(id), 'status'] as const,
  peers: (speakerId: string) => [...bgpKeys.speakerDetail(speakerId), 'peers'] as const,
  advertisements: (speakerId: string) => [...bgpKeys.speakerDetail(speakerId), 'advertisements'] as const,
};

/**
 * Hook to fetch list of BGP speakers
 */
export function useBGPSpeakers(options?: {
  projectId?: string;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  return useQuery({
    queryKey: bgpKeys.speakerList(options?.projectId),
    queryFn: () => bgpApi.listSpeakers({ projectId: options?.projectId }),
    enabled: options?.enabled ?? true,
    staleTime: 30000,
    refetchInterval: options?.refetchInterval,
    retry: 2,
  });
}

/**
 * Hook to fetch a single BGP speaker by ID
 */
export function useBGPSpeaker(id: string, enabled = true) {
  return useQuery({
    queryKey: bgpKeys.speakerDetail(id),
    queryFn: () => bgpApi.getSpeaker(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

/**
 * Hook to fetch detailed BGP speaker status
 */
export function useBGPSpeakerStatus(id: string, options?: { enabled?: boolean; refetchInterval?: number }) {
  return useQuery({
    queryKey: bgpKeys.speakerStatus(id),
    queryFn: () => bgpApi.getSpeakerStatus(id),
    enabled: (options?.enabled ?? true) && !!id,
    staleTime: 5000,
    refetchInterval: options?.refetchInterval ?? 10000,
  });
}

/**
 * Hook to fetch BGP peers for a speaker
 */
export function useBGPPeers(speakerId: string, enabled = true) {
  return useQuery({
    queryKey: bgpKeys.peers(speakerId),
    queryFn: () => bgpApi.listPeers(speakerId),
    enabled: enabled && !!speakerId,
    staleTime: 10000,
  });
}

/**
 * Hook to fetch BGP advertisements for a speaker
 */
export function useBGPAdvertisements(speakerId: string, enabled = true) {
  return useQuery({
    queryKey: bgpKeys.advertisements(speakerId),
    queryFn: () => bgpApi.listAdvertisements(speakerId),
    enabled: enabled && !!speakerId,
    staleTime: 10000,
  });
}

/**
 * Hook to create a new BGP speaker
 */
export function useCreateBGPSpeaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      projectId: string;
      description?: string;
      spec?: {
        localAsn: number;
        routerId: string;
        nodeId?: string;
      };
    }) => bgpApi.createSpeaker(data),
    onSuccess: (speaker) => {
      showSuccess(`BGP speaker "${speaker.name}" created successfully`);
      queryClient.invalidateQueries({ queryKey: bgpKeys.speakers() });
    },
    onError: (error) => {
      showError(error, 'Failed to create BGP speaker');
    },
  });
}

/**
 * Hook to delete a BGP speaker
 */
export function useDeleteBGPSpeaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => bgpApi.deleteSpeaker(id),
    onSuccess: (_, id) => {
      showSuccess('BGP speaker deleted successfully');
      queryClient.removeQueries({ queryKey: bgpKeys.speakerDetail(id) });
      queryClient.invalidateQueries({ queryKey: bgpKeys.speakers() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete BGP speaker');
    },
  });
}

/**
 * Hook to add a BGP peer
 */
export function useAddBGPPeer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speakerId, peer }: {
      speakerId: string;
      peer: {
        name?: string;
        peerIp: string;
        remoteAsn: number;
        md5Password?: string;
        holdTime?: number;
        keepaliveInterval?: number;
        bfdEnabled?: boolean;
      };
    }) => bgpApi.addPeer(speakerId, peer),
    onSuccess: (_, { speakerId }) => {
      showSuccess('BGP peer added successfully');
      queryClient.invalidateQueries({ queryKey: bgpKeys.peers(speakerId) });
      queryClient.invalidateQueries({ queryKey: bgpKeys.speakerStatus(speakerId) });
    },
    onError: (error) => {
      showError(error, 'Failed to add BGP peer');
    },
  });
}

/**
 * Hook to remove a BGP peer
 */
export function useRemoveBGPPeer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speakerId, peerId }: { speakerId: string; peerId: string }) =>
      bgpApi.removePeer(speakerId, peerId),
    onSuccess: (_, { speakerId }) => {
      showSuccess('BGP peer removed successfully');
      queryClient.invalidateQueries({ queryKey: bgpKeys.peers(speakerId) });
      queryClient.invalidateQueries({ queryKey: bgpKeys.speakerStatus(speakerId) });
    },
    onError: (error) => {
      showError(error, 'Failed to remove BGP peer');
    },
  });
}

/**
 * Hook to advertise a network prefix
 */
export function useAdvertiseNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speakerId, cidr, options }: {
      speakerId: string;
      cidr: string;
      options?: {
        nextHop?: string;
        communities?: string[];
        localPreference?: number;
      };
    }) => bgpApi.advertiseNetwork(speakerId, cidr, options),
    onSuccess: (_, { speakerId }) => {
      showSuccess('Network advertised successfully');
      queryClient.invalidateQueries({ queryKey: bgpKeys.advertisements(speakerId) });
      queryClient.invalidateQueries({ queryKey: bgpKeys.speakerStatus(speakerId) });
    },
    onError: (error) => {
      showError(error, 'Failed to advertise network');
    },
  });
}

/**
 * Hook to withdraw a network prefix
 */
export function useWithdrawNetwork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ speakerId, advertisementId }: { speakerId: string; advertisementId: string }) =>
      bgpApi.withdrawNetwork(speakerId, advertisementId),
    onSuccess: (_, { speakerId }) => {
      showSuccess('Network withdrawn successfully');
      queryClient.invalidateQueries({ queryKey: bgpKeys.advertisements(speakerId) });
      queryClient.invalidateQueries({ queryKey: bgpKeys.speakerStatus(speakerId) });
    },
    onError: (error) => {
      showError(error, 'Failed to withdraw network');
    },
  });
}

// Type exports
export type {
  ApiBGPSpeaker,
  ApiBGPPeer,
  ApiBGPAdvertisement,
  BGPSpeakerListResponse,
  BGPPeerListResponse,
  BGPAdvertisementListResponse,
  BGPSpeakerDetailedStatus,
};
