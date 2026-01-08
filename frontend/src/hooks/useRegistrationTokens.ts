/**
 * React Query hooks for Registration Token operations
 * 
 * These hooks manage host registration tokens for the cluster.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  registrationTokenApi, 
  type ApiRegistrationToken,
  type CreateTokenRequest,
} from '../lib/api-client';
import { showSuccess, showError } from '../lib/toast';

// Query keys for cache invalidation
export const tokenKeys = {
  all: ['registration-tokens'] as const,
  lists: () => [...tokenKeys.all, 'list'] as const,
  list: (includeExpired: boolean) => [...tokenKeys.lists(), { includeExpired }] as const,
  details: () => [...tokenKeys.all, 'detail'] as const,
  detail: (id: string) => [...tokenKeys.details(), id] as const,
};

/**
 * Hook to list all registration tokens
 */
export function useRegistrationTokens(options?: {
  includeExpired?: boolean;
  enabled?: boolean;
}) {
  const includeExpired = options?.includeExpired ?? false;

  return useQuery({
    queryKey: tokenKeys.list(includeExpired),
    queryFn: () => registrationTokenApi.list(includeExpired),
    enabled: options?.enabled ?? true,
    staleTime: 30000, // Consider fresh for 30 seconds
    retry: 2,
  });
}

/**
 * Hook to get a single registration token by ID
 */
export function useRegistrationToken(id: string, enabled = true) {
  return useQuery({
    queryKey: tokenKeys.detail(id),
    queryFn: () => registrationTokenApi.get(id),
    enabled: enabled && !!id,
    staleTime: 10000,
  });
}

/**
 * Hook to create a new registration token
 */
export function useCreateRegistrationToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTokenRequest) => registrationTokenApi.create(data),
    onSuccess: () => {
      showSuccess('Registration token created');
      // Invalidate token list cache
      queryClient.invalidateQueries({ queryKey: tokenKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to create registration token');
    },
  });
}

/**
 * Hook to revoke a registration token
 */
export function useRevokeRegistrationToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => registrationTokenApi.revoke(id),
    onSuccess: (token) => {
      showSuccess('Registration token revoked');
      // Update the token in the cache
      queryClient.setQueryData(tokenKeys.detail(token.id), token);
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: tokenKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to revoke registration token');
    },
  });
}

/**
 * Hook to delete a registration token
 */
export function useDeleteRegistrationToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => registrationTokenApi.delete(id),
    onSuccess: (_, id) => {
      showSuccess('Registration token deleted');
      // Remove from cache
      queryClient.removeQueries({ queryKey: tokenKeys.detail(id) });
      // Invalidate lists
      queryClient.invalidateQueries({ queryKey: tokenKeys.lists() });
    },
    onError: (error) => {
      showError(error, 'Failed to delete registration token');
    },
  });
}

// Re-export types
export type { ApiRegistrationToken, CreateTokenRequest };
